import OpenAI from 'openai';
import { sleep } from 'workflow';
import { codexModel, runNyoniAgent } from '../server/nyoni-runtime.js';
import { getHunterInboxContext } from '../server/google-tools.js';
import { recordAssignmentEvent, studioClient } from '../server/nyoni-store.js';
import { generateOpenAiDialogueFallback, generateVoxDialogueConversation, isMediaAgent, persistStudioGeneration, pollStudioGeneration, submitPrismFinishing, submitStudioGeneration } from '../server/production-tools.js';
import { resolveProductionContext, persistProductionPacket } from '../server/production-context.js';
import { buildMotionProductionPrompt } from '../server/motion-engine.js';
import { evaluateProductionQuality } from '../server/quality-control.js';
import { estimateProviderCost } from '../server/provider-adapters.js';
import { storyJsonSchema, storyPacketToScreenplay, validateStoryScriptPacket } from '../server/story-engine.js';
import { classifyWorkflowIntent, mergeRequiredAgents } from '../server/workflow-intent.js';
import { assembleDialogueCut, assembleDialogueReferenceMaster } from '../server/cutline.js';

async function getAssignment(assignmentId) {
  'use step';
  console.info('[nyoni] loading assignment', assignmentId);
  const client = studioClient();
  const { data, error } = await client.from('nyoni_assignments').select('*, projects(name)').eq('id', assignmentId).single();
  if (error) throw new Error(`Assignment lookup failed: ${error.message}`);
  if (data.status === 'cancelled') throw new Error('Assignment was cancelled.');
  const now = new Date().toISOString();
  const { data: claimed, error: claimError } = await client.from('nyoni_assignments').update({
    status: 'running', attempt: data.attempt + 1, started_at: data.started_at || now, updated_at: now, error: null,
  }).eq('id', assignmentId).select('*').single();
  if (claimError) throw new Error(`Assignment claim failed: ${claimError.message}`);
  const { data: contextRows, error: contextError } = await client.from('nyoni_project_context')
    .select('context_type,title,content,source_url,metadata').eq('owner_id', claimed.owner_id).eq('project_id', claimed.project_id)
    .order('updated_at', { ascending: false }).limit(20);
  if (contextError) throw new Error(`Project memory lookup failed: ${contextError.message}`);
  await recordAssignmentEvent(claimed, 'workflow.started', 'Durable workflow started', { attempt: claimed.attempt });
  const projectContext = (contextRows || []).map((row) => `[${row.context_type}] ${row.title}\n${row.content}${row.source_url ? `\nSource: ${row.source_url}` : ''}`).join('\n\n').slice(0, 18000);
  return { ...claimed, projectName: data.projects?.name || data.request?.project || 'Nyoni Studios', projectContext };
}

async function writeStep(assignment, step) {
  'use step';
  const client = studioClient();
  const now = new Date().toISOString();
  const { data, error } = await client.from('nyoni_workflow_steps').upsert({
    assignment_id: assignment.id, owner_id: assignment.owner_id, step_key: step.key,
    agent_id: step.agentId || null, position: step.position, title: step.title, status: step.status,
    attempt: step.attempt || (step.status === 'running' ? 1 : 0), input: step.input || {}, output: step.output || null,
    error: step.error || null, started_at: step.status === 'running' ? now : step.startedAt || null,
    completed_at: ['done','failed','skipped'].includes(step.status) ? now : null, updated_at: now,
  }, { onConflict: 'assignment_id,step_key' }).select('*').single();
  if (error) throw new Error(`Workflow step write failed: ${error.message}`);
  await recordAssignmentEvent(assignment, `step.${step.status}`, `${step.title}: ${step.status}`, { stepKey: step.key, agentId: step.agentId });
  return data;
}

async function runPlanningStep(assignment) {
  'use step';
  console.info('[nyoni] MIGO planning', assignment.id);
  await writeStep(assignment, { key: 'migo-plan', position: 1, agentId: 'migo', title: 'MIGO plans and delegates', status: 'running', input: assignment.request });
  const events = [];
  const result = await runNyoniAgent({
    agentId: 'migo', title: `Plan and delegate this assignment. Identify concrete steps, owners, dependencies, approval tiers, and definition of done.\n\n${assignment.title}`,
    project: assignment.projectName, projectContext: assignment.projectContext, onEvent: (event) => events.push(event),
  });
  await writeStep(assignment, { key: 'migo-plan', position: 1, agentId: 'migo', title: 'MIGO plans and delegates', status: 'done', output: { plan: result.output, sessionId: result.sessionId, events } });
  return result.output;
}

const ROUTABLE_AGENTS = {
  scout: 'Live research, trends, evidence, competitors and discovery',
  creative: 'Campaign concepts, art direction, advertising and brand creative',
  hunter: 'Gmail inbox review, client acquisition, prospects and outreach drafts',
  pulse: 'Analytics, measurement, performance and QA',
  story: 'Short films, scripts, scenes, dialogue, character and narrative structure',
  motion: 'Seedance direction, shot design, camera, staging and production planning',
  vault: 'Idea generation, experiments and concept comparison',
  ledger: 'Revenue records, invoices, subscriptions and reconciliation',
  margin: 'Forecasting, profitability, budgets and unit economics',
  treasury: 'Cash flow, receivables, renewals and failed payments',
  audit: 'Risk, compliance, anomalies and controls',
  lumina: 'Text-to-image generation',
  reframe: 'Image-to-image transformation',
  nova: 'Text-to-video generation',
  kinetic: 'Image-to-video animation',
  cutline: 'Video editing and transformation',
  sonora: 'Music composition and score direction',
  vox: 'ElevenLabs voice generation and performance direction',
  rally: 'Cross-channel campaign packaging and asset coordination',
};

function requiredAgentsFor(title) {
  const text = String(title || '').toLowerCase();
  if (/email|inbox|gmail|message from|reply to/.test(text)) return ['hunter'];
  if (/(short film|screenplay|film idea|movie idea|seedance|script|scene)/.test(text)) return ['story', 'motion'];
  if (/(current|live|today|latest|trending|trend)/.test(text)) return ['scout'];
  if (/(invoice|revenue|subscription|reconcil)/.test(text)) return ['ledger'];
  if (/(margin|forecast|profit|unit economics|budget)/.test(text)) return ['margin'];
  return [];
}

function safeRoute(route, assignment) {
  const required = [...requiredAgentsFor(assignment.title), ...mergeRequiredAgents(route, assignment)];
  const requested = Array.isArray(route?.specialists) ? route.specialists : [];
  const specialists = [];
  for (const agentId of [...required, ...requested.map((item) => item?.agentId)]) {
    if (!ROUTABLE_AGENTS[agentId] || specialists.some((item) => item.agentId === agentId)) continue;
    const modelChoice = requested.find((item) => item?.agentId === agentId);
    specialists.push({ agentId, objective: modelChoice?.objective || `Handle the ${ROUTABLE_AGENTS[agentId].toLowerCase()} portion of the mission.` });
  }
  if (!specialists.length) specialists.push({ agentId: 'creative', objective: 'Create the core deliverable requested by the founder.' });
  return { specialists, rationale: route?.rationale || 'MIGO selected the smallest capable team for this mission.' };
}

async function routeMission(assignment, plan) {
  'use step';
  console.info('[nyoni] MIGO routing specialists', assignment.id);
  await writeStep(assignment, { key: 'migo-route', position: 2, agentId: 'migo', title: 'MIGO selects the mission team', status: 'running', input: { title: assignment.title } });
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  let route = null;
  try {
    const response = await openai.responses.create({
      model: process.env.NYONI_ROUTER_MODEL || 'gpt-5.5',
      text: { format: {
        type: 'json_schema', name: 'nyoni_mission_route', strict: true,
        schema: {
          type: 'object', additionalProperties: false, required: ['specialists', 'rationale'],
          properties: {
            specialists: { type: 'array', minItems: 1, maxItems: 12, items: { type: 'object', additionalProperties: false, required: ['agentId', 'objective'], properties: { agentId: { type: 'string', enum: Object.keys(ROUTABLE_AGENTS) }, objective: { type: 'string' } } } },
            rationale: { type: 'string' },
          },
        },
      } },
      input: `You are MIGO, the Nyoni studio director. Select the smallest capable team. Do not select agents merely to appear busy, but never omit a required production stage. Email and inbox work belongs to Hunter. Short-film narrative belongs to Story; Seedance shot and production design belongs to Motion. Current factual trends require Scout. Select media generators only when the founder explicitly asks to generate the asset, not when they only request an idea or plan.\n\nAGENTS:\n${Object.entries(ROUTABLE_AGENTS).map(([id, role]) => `${id}: ${role}`).join('\n')}\n\nMISSION:\n${assignment.title}\n\nMIGO PLAN:\n${plan}`,
    });
    route = JSON.parse(response.output_text || '{}');
  } catch (error) {
    console.warn('[nyoni] model router unavailable; using deterministic routing', error?.message || error);
  }
  const routed = safeRoute(route, assignment);
  await writeStep(assignment, { key: 'migo-route', position: 2, agentId: 'migo', title: 'MIGO selects the mission team', status: 'done', output: routed });
  return routed;
}

async function runRoutedSpecialist(assignment, specialist, plan, priorWork, position) {
  'use step';
  const { agentId, objective } = specialist;
  console.info('[nyoni] routed specialist', agentId, assignment.id);
  const title = `${agentId} completes ${objective}`.slice(0, 180);
  await writeStep(assignment, { key: `routed-${position}-${agentId}`, position, agentId, title, status: 'running', input: { objective, priorAgents: priorWork.map((item) => item.agentId) } });
  let connectedContext = '';
  if (agentId === 'hunter') connectedContext = await getHunterInboxContext();
  let result;
  if (agentId === 'scout' && /(current|live|today|latest|trending|trend)/i.test(assignment.title)) {
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const research = await openai.responses.create({
      model: process.env.NYONI_RESEARCH_MODEL || 'gpt-5.5', tools: [{ type: 'web_search' }], include: ['web_search_call.action.sources'],
      input: `You are Scout. Complete this research objective using current web evidence, dates, and direct source links. Separate verified facts from inference.\n\nMISSION: ${assignment.title}\nOBJECTIVE: ${objective}\nMIGO PLAN:\n${plan}`,
    });
    result = { output: research.output_text || 'Scout completed research without a written result.', sessionId: research.id, providers: { openai: true, webSearch: true } };
  } else {
    result = await runNyoniAgent({
      agentId, project: assignment.projectName,
      projectContext: [assignment.projectContext, connectedContext].filter(Boolean).join('\n\n'),
      title: `Complete your assigned part of this mission. Produce concrete work, not another delegation plan.\n\nMISSION:\n${assignment.title}\n\nYOUR OBJECTIVE:\n${objective}\n\nMIGO PLAN:\n${plan}\n\nPRIOR SPECIALIST WORK:\n${priorWork.length ? priorWork.map((item) => `${item.agentId.toUpperCase()}:\n${item.output}`).join('\n\n') : 'None yet.'}`,
    });
  }
  const deliverable = { agentId, objective, output: result.output, sessionId: result.sessionId, providers: result.providers };
  await writeStep(assignment, { key: `routed-${position}-${agentId}`, position, agentId, title, status: 'done', output: deliverable });
  return deliverable;
}

async function synthesizeRoutedMission(assignment, plan, route, work, position) {
  'use step';
  console.info('[nyoni] MIGO synthesizing routed mission', assignment.id);
  await writeStep(assignment, { key: 'migo-synthesis', position, agentId: 'migo', title: 'MIGO assembles the final mission report', status: 'running', input: { agents: work.map((item) => item.agentId) } });
  const result = await runNyoniAgent({
    agentId: 'migo', project: assignment.projectName, projectContext: assignment.projectContext,
    title: `Assemble the specialists' actual work into one direct, useful final deliverable for the founder. Lead with the requested answer, preserve important specifics, identify which agent contributed what, and do not invent actions or integrations.\n\nMISSION:\n${assignment.title}\n\nPLAN:\n${plan}\n\nROUTING:\n${JSON.stringify(route)}\n\nSPECIALIST WORK:\n${work.map((item) => `${item.agentId.toUpperCase()}:\n${item.output}`).join('\n\n')}`,
  });
  const deliverable = { ...result, agentId: 'migo', collaboration: work.map((item) => item.agentId) };
  await writeStep(assignment, { key: 'migo-synthesis', position, agentId: 'migo', title: 'MIGO assembles the final mission report', status: 'done', output: { deliverable: result.output, collaboration: deliverable.collaboration } });
  return deliverable;
}

async function checkCarouselReadiness(assignment, plan) {
  'use step';
  if (assignment.workflow_kind !== 'carousel') return { ready: true };
  const client = studioClient();
  const { data: budget } = await client.from('nyoni_budget_policies').select('*').eq('owner_id', assignment.owner_id).eq('project_id', assignment.project_id).maybeSingle();
  const blockers = [];
  if (!assignment.source_url) blockers.push('A source URL or attached source context is required for evidence-backed retrieval.');
  if (!budget?.paid_actions_enabled || Number(budget?.per_run_usd || 0) <= 0) blockers.push('Paid image generation needs a project spending cap in Budget Policies.');
  if (!process.env.OPENAI_API_KEY) blockers.push('OPENAI_API_KEY is not connected.');
  if (!blockers.length) return { ready: true, budget };
  const now = new Date().toISOString();
  await writeStep(assignment, { key: 'integration-check', position: 2, agentId: 'migo', title: 'Verify source, image provider, and budget', status: 'done', output: { blockers } });
  const payload = { tier: 'B', action: 'enable_carousel_production', blockers, plan };
  await client.from('nyoni_approval_requests').insert({
    assignment_id: assignment.id, owner_id: assignment.owner_id, action_type: 'enable_carousel_production',
    payload, payload_sha256: assignment.id, status: 'pending', created_at: now,
  });
  await client.from('nyoni_assignments').update({ status: 'waiting_approval', result: { plan, blockers, partial: true }, updated_at: now }).eq('id', assignment.id);
  await recordAssignmentEvent(assignment, 'workflow.blocked', 'Carousel plan preserved; required source or paid integration is not configured', { blockers });
  return { ready: false, blockers };
}

async function runSpecialistStep(assignment, plan) {
  'use step';
  const agentId = assignment.agent_id;
  await writeStep(assignment, { key: 'specialist-deliverable', position: 3, agentId, title: `${agentId} creates the deliverable`, status: 'running', input: { brief: assignment.title, plan } });
  const result = await runNyoniAgent({
    agentId, title: `${assignment.title}\n\nMIGO PLAN:\n${plan}`, project: assignment.projectName, projectContext: assignment.projectContext,
    onEvent: () => {},
  });
  await writeStep(assignment, { key: 'specialist-deliverable', position: 3, agentId, title: `${agentId} creates the deliverable`, status: 'done', output: { deliverable: result.output, sessionId: result.sessionId } });
  return { ...result, agentId };
}

async function recordHandoff(assignment, handoffKey, fromAgentId, toAgentId, context) {
  'use step';
  console.info('[nyoni] handoff', handoffKey, fromAgentId, toAgentId);
  const client = studioClient();
  const now = new Date().toISOString();
  const { data, error } = await client.from('nyoni_handoffs').upsert({
    assignment_id: assignment.id, owner_id: assignment.owner_id, handoff_key: handoffKey,
    from_agent_id: fromAgentId, to_agent_id: toAgentId, status: 'accepted', context, accepted_at: now,
  }, { onConflict: 'assignment_id,handoff_key' }).select('*').single();
  if (error) throw new Error(`Agent handoff failed: ${error.message}`);
  await recordAssignmentEvent(assignment, 'handoff.accepted', `${fromAgentId} handed work to ${toAgentId}`, { handoffKey, fromAgentId, toAgentId });
  return data;
}

async function runCommercialResearch(assignment, plan) {
  'use step';
  console.info('[nyoni] Scout commercial research', assignment.id);
  await recordHandoff(assignment, 'migo-to-scout', 'migo', 'scout', { brief: assignment.title, plan });
  await writeStep(assignment, { key: 'commercial-research', position: 2, agentId: 'scout', title: 'Scout verifies campaign evidence', status: 'running', input: { sourceUrl: assignment.source_url || null } });
  let sourceText = '';
  if (assignment.source_url) {
    const response = await fetch(assignment.source_url, { headers: { 'User-Agent': 'NyoniHQ/1.0 (+https://nyoni-hq.vercel.app)' }, signal: AbortSignal.timeout(20000) });
    if (!response.ok) throw new Error(`Campaign source retrieval failed with HTTP ${response.status}.`);
    const raw = await response.text();
    sourceText = raw.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 16000);
  }
  const result = await runNyoniAgent({
    agentId: 'scout', project: assignment.projectName, projectContext: assignment.projectContext,
    title: `Build a verified campaign research brief for this assignment. Use only supplied source material and saved project memory. Clearly label verified evidence, inferences, missing facts, target-audience hypotheses, competitive questions, and research still required.\n\nASSIGNMENT: ${assignment.title}\nMIGO PLAN:\n${plan}\n${sourceText ? `SUPPLIED SOURCE CONTENT:\n${sourceText}` : 'NO EXTERNAL SOURCE WAS SUPPLIED. Do not claim live facts were verified.'}`,
  });
  await writeStep(assignment, { key: 'commercial-research', position: 2, agentId: 'scout', title: 'Scout verifies campaign evidence', status: 'done', output: { research: result.output, sourceUrl: assignment.source_url || null, sourceCharacters: sourceText.length } });
  return result.output;
}

function responseSources(response) {
  const sources = [];
  for (const item of response.output || []) {
    if (item.type !== 'web_search_call') continue;
    for (const source of item.action?.sources || []) {
      if (source?.url && !sources.some((entry) => entry.url === source.url)) {
        sources.push({ title: source.title || source.url, url: source.url });
      }
    }
  }
  return sources.slice(0, 12);
}

async function runLiveTrendRadar(assignment, plan) {
  'use step';
  console.info('[nyoni] Scout live trend radar', assignment.id);
  await recordHandoff(assignment, 'migo-to-scout-content-engine', 'migo', 'scout', { brief: assignment.title, plan });
  await writeStep(assignment, { key: 'live-trend-radar', position: 2, agentId: 'scout', title: 'Scout searches live trends and opportunities', status: 'running', input: { searchedAt: new Date().toISOString() } });
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const response = await openai.responses.create({
    model: process.env.NYONI_RESEARCH_MODEL || 'gpt-5.5',
    tools: [{ type: 'web_search' }],
    include: ['web_search_call.action.sources'],
    input: `You are Scout, Nyoni Studios' live trend researcher. Search the current web for timely short-form video formats, cultural conversations, audience behaviors, commercial opportunities, and visual techniques Nyoni can adapt today. Focus on ideas that fit an original film, animation, and creative studio—not generic engagement bait. Provide dated evidence, direct source URLs, a confidence score, lifespan estimate, brand-safety notes, and choose one strongest opportunity for a vertical video. Never invent trend activity.\n\nSTUDIO MISSION:\n${assignment.title}\n\nMIGO PLAN:\n${plan}`,
  });
  const research = response.output_text?.trim();
  if (!research) throw new Error('Scout live search completed without a research brief.');
  const sources = responseSources(response);
  await writeStep(assignment, { key: 'live-trend-radar', position: 2, agentId: 'scout', title: 'Scout searches live trends and opportunities', status: 'done', output: { research, sources, searchedAt: new Date().toISOString() } });
  return { research, sources };
}

async function runContentCreative(assignment, plan, trendRadar) {
  'use step';
  console.info('[nyoni] Creative content package', assignment.id);
  await recordHandoff(assignment, 'scout-to-creative-content-engine', 'scout', 'creative', trendRadar);
  await writeStep(assignment, { key: 'content-creative', position: 3, agentId: 'creative', title: 'Creative writes the video and asset briefs', status: 'running', input: { plan, sources: trendRadar.sources } });
  const result = await runNyoniAgent({
    agentId: 'creative', project: assignment.projectName, projectContext: assignment.projectContext,
    title: `Turn Scout's verified trend radar into ONE original, producible Nyoni vertical-video concept. Deliver: a title; audience and objective; 20–30 second 9:16 script with timestamped shots, voiceover, on-screen text, and CTA; one precise key-art prompt for Lumina; one precise text-to-video prompt for Nova; a clean voiceover-only script and performance direction for Vox; caption; and platform-safe music direction. Avoid copying a creator or protected character.\n\nMISSION:\n${assignment.title}\n\nMIGO PLAN:\n${plan}\n\nSCOUT LIVE RESEARCH:\n${trendRadar.research}\n\nVERIFIED SOURCES:\n${trendRadar.sources.map((source) => `- ${source.title}: ${source.url}`).join('\n')}`,
  });
  await writeStep(assignment, { key: 'content-creative', position: 3, agentId: 'creative', title: 'Creative writes the video and asset briefs', status: 'done', output: { creative: result.output } });
  return result.output;
}

async function runCommercialCreative(assignment, plan, research) {
  'use step';
  console.info('[nyoni] Creative direction', assignment.id);
  await recordHandoff(assignment, 'scout-to-creative', 'scout', 'creative', { research });
  await writeStep(assignment, { key: 'commercial-direction', position: 3, agentId: 'creative', title: 'Creative defines campaign direction', status: 'running', input: { plan, research } });
  const result = await runNyoniAgent({
    agentId: 'creative', project: assignment.projectName, projectContext: assignment.projectContext,
    title: `Create one production-ready commercial direction from this brief and research. Define the audience, promise, hook, visual system, composition, message hierarchy, exact hero-image prompt, supporting deliverables, and guardrails. Do not generate the image yourself; Lumina owns production.\n\nASSIGNMENT: ${assignment.title}\nMIGO PLAN:\n${plan}\nSCOUT RESEARCH:\n${research}`,
  });
  await writeStep(assignment, { key: 'commercial-direction', position: 3, agentId: 'creative', title: 'Creative defines campaign direction', status: 'done', output: { direction: result.output } });
  return result.output;
}

async function runCommercialImage(assignment, direction) {
  await recordHandoff(assignment, 'creative-to-lumina', 'creative', 'lumina', { direction });
  const luminaAssignment = { ...assignment, agent_id: 'lumina' };
  const deliverable = { output: direction };
  return runMediaProduction(luminaAssignment, deliverable);
}

async function runCommercialQa(assignment, direction, production) {
  'use step';
  console.info('[nyoni] Pulse campaign QA', assignment.id);
  await recordHandoff(assignment, 'lumina-to-pulse', 'lumina', 'pulse', { media: production.media, direction });
  await writeStep(assignment, { key: 'commercial-qa', position: 5, agentId: 'pulse', title: 'Pulse checks the generated campaign asset', status: 'running', input: { media: production.media } });
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const response = await openai.responses.create({
    model: process.env.NYONI_QA_MODEL || 'gpt-5.5',
    input: [{ role: 'user', content: [
      { type: 'input_text', text: `Review this generated commercial image against the requested assignment and Creative direction. Check requirement coverage, visual coherence, obvious artifacts, brand safety, unsupported claims, and production readiness. Return PASS, PASS WITH FIXES, or FAIL followed by concise evidence.\n\nASSIGNMENT: ${assignment.title}\nDIRECTION:\n${direction}` },
      ...production.media.filter((item) => item.type === 'image').map((item) => ({ type: 'input_image', image_url: item.url })),
    ] }],
  });
  const qa = response.output_text || 'QA completed without a written report.';
  await writeStep(assignment, { key: 'commercial-qa', position: 5, agentId: 'pulse', title: 'Pulse checks the generated campaign asset', status: 'done', output: { qa } });
  return qa;
}

async function runCommercialAssembly(assignment, plan, research, direction, production, qa) {
  'use step';
  console.info('[nyoni] Rally campaign assembly', assignment.id);
  await recordHandoff(assignment, 'pulse-to-rally', 'pulse', 'rally', { qa, media: production.media });
  await writeStep(assignment, { key: 'campaign-assembly', position: 6, agentId: 'rally', title: 'Rally assembles the campaign package', status: 'running', input: { qa, media: production.media } });
  const result = await runNyoniAgent({
    agentId: 'rally', project: assignment.projectName, projectContext: assignment.projectContext,
    title: `Assemble the final commercial package. Reconcile MIGO's plan, Scout's evidence, Creative's direction, the generated hero asset, and Pulse QA. Return a concise campaign summary, asset manifest, caption draft, channel adaptations, QA disposition, and next external action. Do not claim anything was published.\n\nASSIGNMENT: ${assignment.title}\nPLAN:\n${plan}\nRESEARCH:\n${research}\nDIRECTION:\n${direction}\nQA:\n${qa}`,
  });
  await writeStep(assignment, { key: 'campaign-assembly', position: 6, agentId: 'rally', title: 'Rally assembles the campaign package', status: 'done', output: { package: result.output } });
  return result;
}

async function finalizeCommercial(assignment, stages) {
  'use step';
  console.info('[nyoni] finalizing commercial', assignment.id);
  const client = studioClient();
  const now = new Date().toISOString();
  const { data: artifact, error: artifactError } = await client.from('nyoni_artifacts').insert({
    assignment_id: assignment.id, project_id: assignment.project_id, owner_id: assignment.owner_id,
    artifact_type: 'campaign_package', title: assignment.title, status: 'ready', current_version: 1,
    metadata: { leadAgentId: 'rally', mediaCount: stages.production.media.length, qa: stages.qa },
  }).select('*').single();
  if (artifactError) throw new Error(`Campaign artifact creation failed: ${artifactError.message}`);
  const content = { plan: stages.plan, research: stages.research, direction: stages.direction, deliverable: stages.assembly.output, media: stages.production.media, qa: stages.qa, production: stages.production };
  const { error: versionError } = await client.from('nyoni_artifact_versions').insert({ artifact_id: artifact.id, owner_id: assignment.owner_id, version: 1, content, created_by_agent_id: 'rally' });
  if (versionError) throw new Error(`Campaign version creation failed: ${versionError.message}`);
  const result = { ...content, artifactId: artifact.id, providers: { ...stages.assembly.providers, studio: stages.production.provider, model: stages.production.model }, collaboration: ['migo','scout','creative','lumina','pulse','rally'] };
  const { error: approvalError } = await client.from('nyoni_approval_requests').insert({
    assignment_id: assignment.id, owner_id: assignment.owner_id, action_type: 'approve_content_package',
    payload: { tier: 'B', artifactId: artifact.id, media: stages.production.media, totalCostUsd: stages.production.totalCostUsd, externalAction: 'publishing_remains_separately_gated' },
    payload_sha256: assignment.id, status: 'pending', created_at: now,
  });
  if (approvalError) throw new Error(`Founder approval request failed: ${approvalError.message}`);
  const { error } = await client.from('nyoni_assignments').update({ status: 'waiting_approval', production_state: 'ready_founder_review', result, total_cost_usd: stages.production.totalCostUsd, completed_at: now, updated_at: now }).eq('id', assignment.id);
  if (error) throw new Error(`Campaign finalization failed: ${error.message}`);
  await recordAssignmentEvent(assignment, 'workflow.waiting_approval', 'Collaborative commercial package is ready for founder review', { artifactId: artifact.id, agents: result.collaboration, costUsd: stages.production.totalCostUsd });
  return result;
}

async function submitMediaStep(assignment, deliverable, step = {}, generationOptions = {}) {
  'use step';
  await writeStep(assignment, { key: step.key || 'studio-generation', position: step.position || 4, agentId: assignment.agent_id, title: step.title || `${assignment.agent_id} generates media in Nyoni Studio`, status: 'running', input: { sourceUrl: assignment.source_url || null } });
  return submitStudioGeneration(assignment, deliverable.output, generationOptions);
}

async function pollMediaStep(assignment, job) {
  'use step';
  return pollStudioGeneration(assignment, job);
}

async function persistMediaStep(assignment, job, step = {}) {
  'use step';
  const production = await persistStudioGeneration(assignment, job);
  await writeStep(assignment, { key: step.key || 'studio-generation', position: step.position || 4, agentId: assignment.agent_id, title: step.title || `${assignment.agent_id} generates media in Nyoni Studio`, status: 'done', output: production });
  return production;
}

async function runMediaProduction(assignment, deliverable, step = {}, generationOptions = {}) {
  let job = await submitMediaStep(assignment, deliverable, step, generationOptions);
  for (let attempt = 0; attempt < 90 && job.status !== 'completed'; attempt += 1) {
    await sleep('10s');
    job = await pollMediaStep(assignment, job);
  }
  if (job.status !== 'completed') throw new Error('Studio generation timed out before the provider returned media.');
  return persistMediaStep(assignment, job, step);
}

async function submitOptionalMediaStep(assignment, deliverable, step) {
  'use step';
  await writeStep(assignment, { key: step.key, position: step.position, agentId: assignment.agent_id, title: step.title, status: 'running', input: { sourceUrl: assignment.source_url || null, optional: true } });
  try {
    return await submitStudioGeneration(assignment, deliverable.output);
  } catch (error) {
    const reason = error?.message || 'Paid generation is unavailable.';
    await writeStep(assignment, { key: step.key, position: step.position, agentId: assignment.agent_id, title: step.title, status: 'skipped', output: { skipped: true, reason, media: [] } });
    return { status: 'skipped', reason, media: [], totalCostUsd: 0, provider: null, model: null, kind: assignment.agent_id };
  }
}

async function pollOptionalMediaStep(assignment, job) {
  'use step';
  try {
    return await pollStudioGeneration(assignment, job);
  } catch (error) {
    return { ...job, status: 'skipped', reason: error?.message || 'The paid provider could not finish this generation.' };
  }
}

async function persistOptionalMediaStep(assignment, job, step) {
  'use step';
  if (job.status === 'skipped') {
    await writeStep(assignment, { key: step.key, position: step.position, agentId: assignment.agent_id, title: step.title, status: 'skipped', output: { skipped: true, reason: job.reason, media: [] } });
    return { media: [], totalCostUsd: 0, provider: job.provider || null, model: job.model || null, kind: job.kind, skipped: true, reason: job.reason };
  }
  try {
    const production = await persistStudioGeneration(assignment, job);
    await writeStep(assignment, { key: step.key, position: step.position, agentId: assignment.agent_id, title: step.title, status: 'done', output: production });
    return production;
  } catch (error) {
    const reason = error?.message || 'Generated media could not be saved.';
    await writeStep(assignment, { key: step.key, position: step.position, agentId: assignment.agent_id, title: step.title, status: 'skipped', output: { skipped: true, reason, media: [] } });
    return { media: [], totalCostUsd: 0, provider: job.provider || null, model: job.model || null, kind: job.kind, skipped: true, reason };
  }
}

async function runOptionalMediaProduction(assignment, deliverable, step) {
  let job = await submitOptionalMediaStep(assignment, deliverable, step);
  if (job.status === 'skipped') return job;
  for (let attempt = 0; attempt < 60 && !['completed', 'skipped'].includes(job.status); attempt += 1) {
    await sleep('10s');
    job = await pollOptionalMediaStep(assignment, job);
  }
  if (job.status !== 'completed') job = { ...job, status: 'skipped', reason: job.reason || 'The provider did not finish within ten minutes.' };
  return persistOptionalMediaStep(assignment, job, step);
}

async function runContentAsset(assignment, agentId, fromAgentId, creative, step) {
  await recordHandoff(assignment, `${fromAgentId}-to-${agentId}-content-engine`, fromAgentId, agentId, { creative });
  return runOptionalMediaProduction({ ...assignment, agent_id: agentId }, { output: creative }, step);
}

async function runContentQa(assignment, creative, productions) {
  'use step';
  console.info('[nyoni] Pulse content package QA', assignment.id);
  await recordHandoff(assignment, 'media-team-to-pulse-content-engine', 'nova', 'pulse', { media: productions.flatMap((item) => item.media) });
  await writeStep(assignment, { key: 'content-qa', position: 7, agentId: 'pulse', title: 'Pulse checks the complete content package', status: 'running', input: { media: productions.flatMap((item) => item.media) } });
  const result = await runNyoniAgent({
    agentId: 'pulse', project: assignment.projectName, projectContext: assignment.projectContext,
    title: `QA this autonomous content package before founder review. Check which still, video, and voice assets exist; explicitly list any generation skipped because funding or a provider was unavailable; verify the concept is coherent, claims are supported, the CTA is appropriate, and no step claims the content was published. Missing paid assets should produce PASS WITH FIXES, not block the written package. Return PASS, PASS WITH FIXES, or FAIL with an exact checklist.\n\nCREATIVE PACKAGE:\n${creative}\n\nPRODUCTION RESULTS:\n${JSON.stringify(productions)}`,
  });
  await writeStep(assignment, { key: 'content-qa', position: 7, agentId: 'pulse', title: 'Pulse checks the complete content package', status: 'done', output: { qa: result.output } });
  return result.output;
}

async function runContentAssembly(assignment, plan, trendRadar, creative, productions, qa) {
  'use step';
  console.info('[nyoni] Rally autonomous content assembly', assignment.id);
  const media = productions.flatMap((item) => item.media);
  await recordHandoff(assignment, 'pulse-to-rally-content-engine', 'pulse', 'rally', { qa, media });
  await writeStep(assignment, { key: 'content-assembly', position: 8, agentId: 'rally', title: 'Rally packages the post for founder approval', status: 'running', input: { qa, media } });
  const result = await runNyoniAgent({
    agentId: 'rally', project: assignment.projectName, projectContext: assignment.projectContext,
    title: `Package this autonomous content run for one founder decision. Return: concept summary, trend evidence with source links, final script, exact asset manifest, editing instructions for combining video and voice, final caption, CTA, suggested posting window, QA disposition, and a single APPROVE / REVISE decision request. If paid generation was unavailable, preserve the complete written production package and list the missing assets as optional next actions—do not block or loop. Never claim the content was posted.\n\nMISSION:\n${assignment.title}\n\nPLAN:\n${plan}\n\nSCOUT:\n${trendRadar.research}\n\nCREATIVE:\n${creative}\n\nQA:\n${qa}\n\nPRODUCTION RESULTS:\n${JSON.stringify(productions)}`,
  });
  await writeStep(assignment, { key: 'content-assembly', position: 8, agentId: 'rally', title: 'Rally packages the post for founder approval', status: 'done', output: { package: result.output } });
  return result;
}

async function finalizeAutonomousContent(assignment, stages) {
  'use step';
  console.info('[nyoni] autonomous content awaiting founder approval', assignment.id);
  const client = studioClient();
  const now = new Date().toISOString();
  const media = stages.productions.flatMap((item) => item.media);
  const totalCostUsd = stages.productions.reduce((sum, item) => sum + Number(item.totalCostUsd || 0), 0);
  const playableVideo = media.find((item) => item.type === 'video' && item.url);
  const missingItems = playableVideo ? [] : [{ code: 'FINAL_VIDEO_MISSING', message: 'The workflow requires a playable final video, but no video asset was persisted.', requiredType: 'video' }];
  const { data: artifact, error: artifactError } = await client.from('nyoni_artifacts').insert({
    assignment_id: assignment.id, project_id: assignment.project_id, owner_id: assignment.owner_id,
    artifact_type: 'autonomous_content_package', title: assignment.title, status: playableVideo ? 'ready' : 'incomplete', current_version: 1,
    metadata: { leadAgentId: 'rally', mediaCount: media.length, totalCostUsd, requiresFounderApproval: Boolean(playableVideo), missingItems },
  }).select('*').single();
  if (artifactError) throw new Error(`Content artifact creation failed: ${artifactError.message}`);
  const content = { plan: stages.plan, research: stages.trendRadar.research, sources: stages.trendRadar.sources, creative: stages.creative, deliverable: stages.assembly.output, media, qa: stages.qa };
  const { error: versionError } = await client.from('nyoni_artifact_versions').insert({ artifact_id: artifact.id, owner_id: assignment.owner_id, version: 1, content, created_by_agent_id: 'rally' });
  if (versionError) throw new Error(`Content artifact version failed: ${versionError.message}`);
  const result = { ...content, artifactId: artifact.id, totalCostUsd, missingItems, collaboration: ['migo','scout','creative','lumina','nova','vox','pulse','rally'], approval: playableVideo ? 'required_before_publishing' : 'unavailable_until_required_media_exists' };
  if (playableVideo) {
    const { error: approvalError } = await client.from('nyoni_approval_requests').insert({
      assignment_id: assignment.id, owner_id: assignment.owner_id, action_type: 'approve_content_package',
      payload: { tier: 'B', artifactId: artifact.id, media, totalCostUsd, externalAction: 'publishing_remains_separately_gated' },
      payload_sha256: assignment.id, status: 'pending', created_at: now,
    });
    if (approvalError) throw new Error(`Founder approval request failed: ${approvalError.message}`);
  }
  const { error } = await client.from('nyoni_assignments').update({
    status: playableVideo ? 'waiting_approval' : 'failed', production_state: playableVideo ? 'ready_founder_review' : 'media_blocked',
    result, error: playableVideo ? null : missingItems[0].message, total_cost_usd: totalCostUsd,
    completed_at: playableVideo ? now : null, updated_at: now,
  }).eq('id', assignment.id);
  if (error) throw new Error(`Content pipeline finalization failed: ${error.message}`);
  await recordHandoff(assignment, 'rally-to-migo-content-review', 'rally', 'migo', { artifactId: artifact.id, media, decision: playableVideo ? 'founder_approval' : 'required_media_missing' });
  await recordAssignmentEvent(assignment, playableVideo ? 'workflow.waiting_approval' : 'workflow.media_blocked', playableVideo ? 'Autonomous content package is ready for one founder decision' : 'Production stopped safely because the required playable video is missing', { artifactId: artifact.id, agents: result.collaboration, costUsd: totalCostUsd, missingItems });
  return result;
}

async function runCarouselProduction(assignment, plan) {
  'use step';
  const client = studioClient();
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  await recordHandoff(assignment, 'migo-to-scout-carousel', 'migo', 'scout', { brief: assignment.title, plan });
  await writeStep(assignment, { key: 'source-retrieval', position: 3, agentId: 'scout', title: 'Scout retrieves source context', status: 'running', input: { sourceUrl: assignment.source_url } });
  const sourceResponse = await fetch(assignment.source_url, { headers: { 'User-Agent': 'NyoniHQ/1.0 (+https://nyoni-hq.vercel.app)' }, signal: AbortSignal.timeout(20000) });
  if (!sourceResponse.ok) throw new Error(`Source retrieval failed with HTTP ${sourceResponse.status}.`);
  const rawSource = await sourceResponse.text();
  const sourceText = rawSource.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 18000);
  if (sourceText.length < 100) throw new Error('The source URL did not return enough readable context.');
  await writeStep(assignment, { key: 'source-retrieval', position: 3, agentId: 'scout', title: 'Scout retrieves source context', status: 'done', output: { sourceUrl: assignment.source_url, excerpt: sourceText.slice(0, 1200), characters: sourceText.length } });

  await recordHandoff(assignment, 'scout-to-creative-carousel', 'scout', 'creative', { sourceUrl: assignment.source_url, sourceCharacters: sourceText.length });
  await writeStep(assignment, { key: 'carousel-creative', position: 4, agentId: 'creative', title: 'Creative develops carousel narrative', status: 'running', input: { plan, sourceUrl: assignment.source_url } });
  const creative = await runNyoniAgent({
    agentId: 'creative', project: assignment.projectName,
    title: `Create a six-slide social carousel narrative and final caption grounded only in this retrieved source. Include six numbered slide headlines, concise body copy, and a distinct square-image art direction for each slide.\n\nASSIGNMENT: ${assignment.title}\nSOURCE URL: ${assignment.source_url}\nSOURCE CONTEXT:\n${sourceText}`,
    onEvent: () => {},
  });
  await writeStep(assignment, { key: 'carousel-creative', position: 4, agentId: 'creative', title: 'Creative develops carousel narrative', status: 'done', output: { creative: creative.output, sourceUrl: assignment.source_url } });

  await writeStep(assignment, { key: 'image-generation', position: 5, agentId: 'creative', title: 'Creative generates six carousel images', status: 'running', input: { model: process.env.NYONI_IMAGE_MODEL || 'gpt-image-2.5-flare', count: 6 } });
  const model = process.env.NYONI_IMAGE_MODEL || 'gpt-image-2.5-flare';
  const slideRoles = ['bold opening hook','human-centered problem','key evidence or insight','turning point or solution','practical takeaway','memorable closing call to action'];
  const images = [];
  let totalCost = 0;
  for (let index = 0; index < 6; index += 1) {
    const slide = index + 1;
    const { data: existing } = await client.from('assets').select('*').eq('user_id', assignment.owner_id).eq('project_id', assignment.project_id).contains('metadata', { assignmentId: assignment.id, slide }).maybeSingle();
    if (existing) { images.push({ slide, url: existing.url, assetId: existing.id, reused: true }); continue; }
    const prompt = `Create slide ${slide} of a cohesive premium square editorial carousel for Nyoni Studios. Role: ${slideRoles[index]}. Assignment: ${assignment.title}. Ground the concept in this source context: ${sourceText.slice(index * 1800, index * 1800 + 2600)}. Visual system: cinematic African creative studio sensibility, elegant typography-safe negative space, sophisticated color, no logos, no watermarks, no fabricated charts, no embedded text.`;
    const generated = await openai.images.generate({ model, prompt, n: 1, size: '1024x1024', quality: 'low', output_format: 'webp' });
    const encoded = generated.data?.[0]?.b64_json;
    if (!encoded) throw new Error(`Image provider returned no image for slide ${slide}.`);
    const path = `${assignment.owner_id}/${assignment.id}/slide-${slide}.webp`;
    const { error: uploadError } = await client.storage.from('nyoni-artifacts').upload(path, Buffer.from(encoded, 'base64'), { contentType: 'image/webp', upsert: true });
    if (uploadError) throw new Error(`Slide ${slide} upload failed: ${uploadError.message}`);
    const url = client.storage.from('nyoni-artifacts').getPublicUrl(path).data.publicUrl;
    const usage = generated.usage || {};
    const cost = (Number(usage.input_tokens || 0) * 5 + Number(usage.output_tokens || 0) * 30) / 1_000_000;
    totalCost += cost;
    const { data: asset, error: assetError } = await client.from('assets').insert({
      user_id: assignment.owner_id, project_id: assignment.project_id, type: 'image', url, storage_path: path,
      provider: 'openai', model, prompt, metadata: { assignmentId: assignment.id, slide, sourceUrl: assignment.source_url, usage },
    }).select('*').single();
    if (assetError) throw new Error(`Slide ${slide} asset record failed: ${assetError.message}`);
    const { data: toolRun } = await client.from('nyoni_tool_runs').insert({
      assignment_id: assignment.id, owner_id: assignment.owner_id, tool_name: 'image_generation', provider: 'openai', status: 'done',
      idempotency_key: `${assignment.id}:image:${slide}`, input: { prompt, model }, output: { url, assetId: asset.id, usage }, cost_usd: cost, completed_at: new Date().toISOString(),
    }).select('id').single();
    await client.from('nyoni_usage_ledger').insert({ owner_id: assignment.owner_id, project_id: assignment.project_id, assignment_id: assignment.id, tool_run_id: toolRun?.id || null, provider: 'openai', model, units: usage, cost_usd: cost });
    images.push({ slide, url, assetId: asset.id, usage, costUsd: cost });
  }
  await writeStep(assignment, { key: 'image-generation', position: 5, agentId: 'creative', title: 'Creative generates six carousel images', status: 'done', output: { images, model, totalCostUsd: totalCost } });

  await recordHandoff(assignment, 'creative-to-pulse-carousel', 'creative', 'pulse', { images: images.map((image) => image.url), creative: creative.output });
  await writeStep(assignment, { key: 'pulse-qa', position: 6, agentId: 'pulse', title: 'Pulse performs visual QA', status: 'running', input: { images: images.map((image) => image.url) } });
  const qa = await openai.responses.create({
    model: process.env.NYONI_QA_MODEL || 'gpt-5.5',
    input: [{ role: 'user', content: [
      { type: 'input_text', text: `Review these six carousel images for visual consistency, source alignment, obvious artifacts, legibility-safe space, and publish readiness. Return a concise issue list and pass/fail recommendation. Source: ${assignment.source_url}\nCreative brief:\n${creative.output}` },
      ...images.map((image) => ({ type: 'input_image', image_url: image.url })),
    ] }],
  });
  const qaText = qa.output_text || 'QA completed without a text report.';
  await writeStep(assignment, { key: 'pulse-qa', position: 6, agentId: 'pulse', title: 'Pulse performs visual QA', status: 'done', output: { report: qaText, images: images.length } });
  await recordHandoff(assignment, 'pulse-to-migo-carousel-report', 'pulse', 'migo', { report: qaText, images: images.length });
  return { output: creative.output, plan, images, qa: qaText, sourceUrl: assignment.source_url, totalCostUsd: totalCost, agentId: 'creative', providers: { codex: true, image: model } };
}

async function finalizeCarousel(assignment, deliverable) {
  'use step';
  const client = studioClient();
  const now = new Date().toISOString();
  const { data: artifact, error: artifactError } = await client.from('nyoni_artifacts').insert({
    assignment_id: assignment.id, project_id: assignment.project_id, owner_id: assignment.owner_id,
    artifact_type: 'carousel', title: assignment.title, status: 'ready', current_version: 1,
    metadata: { sourceUrl: deliverable.sourceUrl, imageCount: deliverable.images.length, qa: deliverable.qa },
  }).select('*').single();
  if (artifactError) throw new Error(`Carousel artifact creation failed: ${artifactError.message}`);
  await client.from('nyoni_artifact_versions').insert({ artifact_id: artifact.id, owner_id: assignment.owner_id, version: 1, content: deliverable, created_by_agent_id: 'creative' });
  const result = { ...deliverable, artifactId: artifact.id };
  const { error } = await client.from('nyoni_assignments').update({ status: 'done', result, total_cost_usd: deliverable.totalCostUsd, completed_at: now, updated_at: now }).eq('id', assignment.id);
  if (error) throw new Error(`Carousel finalization failed: ${error.message}`);
  await recordAssignmentEvent(assignment, 'workflow.completed', 'Six-image carousel package completed and is available in deliverables', { artifactId: artifact.id, imageCount: 6, costUsd: deliverable.totalCostUsd });
  return result;
}

async function runCoreStory(assignment, plan, workflowKind, research = null) {
  'use step';
  const intent = classifyWorkflowIntent(assignment);
  if (!intent.requiresStory) throw new Error('The production-core workflow requires an explicit scripted narrative intent.');
  const title = 'Story writes and validates the production screenplay';
  const existingClient = studioClient();
  const { data: existingArtifact } = await existingClient.from('nyoni_artifacts').select('id,nyoni_artifact_versions(version,content)').eq('assignment_id', assignment.id).eq('artifact_type', 'story_script_packet').eq('status', 'ready').order('created_at', { ascending: false }).limit(1).maybeSingle();
  const existingVersion = existingArtifact?.nyoni_artifact_versions?.sort((a, b) => b.version - a.version)?.[0];
  if (existingVersion?.content?.packet && existingVersion?.content?.qualityGate?.disposition === 'PASS') {
    const packet = existingVersion.content.packet;
    const output = existingVersion.content.screenplay || storyPacketToScreenplay(packet);
    await writeStep(assignment, { key: 'story-script', position: 2, agentId: 'story', title, status: 'done', output: { script: output, packet, artifactId: existingArtifact.id, version: existingVersion.version, resumed: true } });
    await writeStep(assignment, { key: 'story-quality-gate', position: 3, agentId: 'story', title: 'Story passes the screenplay quality gate', status: 'done', output: { disposition: 'PASS', findings: [], dialogueSignature: packet.dialogueSignature, resumed: true } });
    return { output, packet, artifactId: existingArtifact.id, version: existingVersion.version, sessionId: null, agentId: 'story', resumed: true };
  }
  await recordHandoff(assignment, 'migo-to-story-production-core', 'migo', 'story', { assignment: assignment.title, plan, projectId: assignment.project_id, intent });
  await writeStep(assignment, { key: 'story-script', position: 2, agentId: 'story', title, status: 'running', input: { plan, intent, projectContext: true } });
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const requested = assignment.request?.production || {};
  const durationSeconds = Math.min(10, Number(requested.durationSeconds || 10));
  const boundCharacterIds = Object.keys(requested.voiceBindings || {});
  let findings = [];
  let validated = null;
  let responseId = null;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const response = await openai.responses.create({
      model: process.env.NYONI_STORY_MODEL || 'gpt-5.5',
      text: { format: { type: 'json_schema', name: 'nyoni_story_script_packet', strict: true, schema: storyJsonSchema } },
      input: `You are Story, Nyoni HQ's screenwriter. Write an ORIGINAL, production-feasible ${durationSeconds}-second screenplay packet. It must have exactly two original characters, a clear visual setup, a natural misunderstanding, a clean punchline, realistic pauses and listener reactions, and dialogue that fits the timing. Each line must explicitly name a speaker ID and a different recipient ID. ${boundCharacterIds.length ? `The two character IDs MUST be exactly ${boundCharacterIds.join(' and ')} because Vox already has explicit voice bindings for those stable IDs.` : ''} This test takes place in a police interrogation room and uses cinematic stylized 3D. Do not use or reference Palava 231, any existing Nyoni canon, or protected characters. Do not write camera or provider directions; Motion owns directing. Project ID must be ${assignment.project_id}; assignment ID must be ${assignment.id}; durationSeconds must be ${durationSeconds}.\n\nMISSION:\n${assignment.title}\n\nMIGO PLAN:\n${plan}\n\nPROJECT CONTEXT (facts only, no canon reuse):\n${assignment.projectContext || 'None'}\n\nRESEARCH:\n${research || 'None required.'}\n\n${attempt === 2 ? `REWRITE REQUIRED. Correct these exact quality findings without changing the brief: ${JSON.stringify(findings)}` : ''}`,
    });
    responseId = response.id;
    const parsed = JSON.parse(response.output_text || '{}');
    const review = validateStoryScriptPacket(parsed);
    findings = [...review.findings];
    if (boundCharacterIds.length && JSON.stringify([...new Set(review.packet.characters.map((item) => item.id))].sort()) !== JSON.stringify([...boundCharacterIds].sort())) findings.push({ code: 'VOICE_BINDING_CHARACTER_IDS_MISMATCH', severity: 'blocking', requiredCharacterIds: boundCharacterIds });
    if (findings.length === 0) { validated = review.packet; break; }
  }
  if (!validated) throw new Error(`Story quality gate failed after one bounded rewrite: ${JSON.stringify(findings)}`);
  const screenplay = storyPacketToScreenplay(validated);
  const client = studioClient();
  const { data: artifact, error: artifactError } = await client.from('nyoni_artifacts').insert({ assignment_id: assignment.id, project_id: assignment.project_id, owner_id: assignment.owner_id, artifact_type: 'story_script_packet', title: validated.title, status: 'ready', current_version: 1, metadata: { schemaVersion: validated.schemaVersion, dialogueSignature: validated.dialogueSignature, qualityDisposition: 'PASS' } }).select('*').single();
  if (artifactError) throw new Error(`Story artifact creation failed: ${artifactError.message}`);
  const { error: versionError } = await client.from('nyoni_artifact_versions').insert({ artifact_id: artifact.id, owner_id: assignment.owner_id, version: 1, content: { packet: validated, screenplay, qualityGate: { disposition: 'PASS', findings } }, created_by_agent_id: 'story' });
  if (versionError) throw new Error(`Story artifact version failed: ${versionError.message}`);
  const output = screenplay;
  await writeStep(assignment, { key: 'story-quality-gate', position: 3, agentId: 'story', title: 'Story passes the screenplay quality gate', status: 'done', output: { disposition: 'PASS', findings, dialogueSignature: validated.dialogueSignature } });
  await writeStep(assignment, { key: 'story-script', position: 2, agentId: 'story', title, status: 'done', output: { script: output, packet: validated, artifactId: artifact.id, version: 1, sessionId: responseId } });
  return { output, packet: validated, artifactId: artifact.id, version: 1, sessionId: responseId, agentId: 'story' };
}

async function runCoreCreative(assignment, plan, story, workflowKind) {
  'use step';
  const fromAgent = story.agentId;
  const client = studioClient();
  const { data: existing } = await client.from('nyoni_workflow_steps').select('output').eq('assignment_id', assignment.id).eq('step_key', 'production-art-direction').eq('status', 'done').maybeSingle();
  if (existing?.output?.direction) return { output: existing.output.direction, sessionId: existing.output.sessionId || null, resumed: true };
  await recordHandoff(assignment, `${fromAgent}-to-creative-production-core`, fromAgent, 'creative', { script: story.output, plan });
  await writeStep(assignment, { key: 'production-art-direction', position: 3, agentId: 'creative', title: 'Creative locks art direction and continuity', status: 'running', input: { script: story.output } });
  const result = await runNyoniAgent({
    agentId: 'creative', project: assignment.projectName, projectContext: assignment.projectContext,
    title: `Define production-ready visual direction for the structured screenplay below. Create two visually distinct ORIGINAL characters and a cinematic stylized-3D police interrogation room. Lock facial silhouettes, body shapes, wardrobe, room geography, table/chairs, one practical overhead lamp, materials, lighting, color, props, continuity, and negative constraints. Do not use Palava 231 or any existing Nyoni canon. Do not change a single dialogue word, speaker, recipient, or timing.\n\nWORKFLOW: ${workflowKind}\nMISSION: ${assignment.title}\nSCRIPT PACKET:\n${JSON.stringify(story.packet)}\nPLAN:\n${plan}`,
  });
  await writeStep(assignment, { key: 'production-art-direction', position: 3, agentId: 'creative', title: 'Creative locks art direction and continuity', status: 'done', output: { direction: result.output, sessionId: result.sessionId } });
  return result;
}

async function runCoreVisualReference(assignment, story, creative) {
  await recordHandoff(assignment, 'creative-to-lumina-production-reference', 'creative', 'lumina', { dialogueSignature: story.packet.dialogueSignature });
  const reference = await runMediaProduction(
    { ...assignment, agent_id: 'lumina' },
    { output: `Create one clean 16:9 cinematic stylized-3D reference frame showing BOTH original characters in the police interrogation room with stable, clearly different faces, silhouettes, wardrobe, screen-left/screen-right positions, table, chairs and overhead practical. This is an identity and room reference, not a poster. No text, logos, watermark, extra people, weapons, prison bars, or existing franchise/canon characters.\n\nCHARACTERS:\n${JSON.stringify(story.packet.characters)}\n\nART DIRECTION:\n${creative.output}` },
    { key: 'production-visual-reference', position: 4, title: 'Lumina generates the original character and room reference' },
    { idempotencyKey: `${assignment.id}:lumina:story-reference-v1` },
  );
  return reference;
}

async function runCoreVox(assignment, story, preliminary) {
  'use step';
  const bindings = assignment.request?.production?.voiceBindings || {};
  const missing = story.packet.characters.filter((character) => !bindings[character.id]).map((character) => character.id);
  if (missing.length) throw new Error(`Vox needs explicit ElevenLabs voice bindings for: ${missing.join(', ')}.`);
  if (new Set(story.packet.characters.map((character) => bindings[character.id])).size !== story.packet.characters.length) throw new Error('Vox requires two distinct voice IDs for the two characters.');
  await recordHandoff(assignment, 'motion-preliminary-to-vox', 'motion', 'vox', { dialogueSignature: story.packet.dialogueSignature, lineCount: story.packet.dialogue.length });
  await writeStep(assignment, { key: 'vox-dialogue', position: 5, agentId: 'vox', title: 'Vox performs the exact screenplay with two bound voices', status: 'running', input: { dialogueSignature: story.packet.dialogueSignature, voiceBindings: Object.keys(bindings), preliminary: preliminary.output } });
  let audio;
  try {
    audio = await generateVoxDialogueConversation(assignment, story.packet, bindings);
  } catch (error) {
    const paymentIssue = /payment_issue|payment required|past_due|failed or incomplete payment/i.test(error?.message || '');
    if (!paymentIssue || assignment.request?.production?.allowVoiceFallback === false) throw error;
    await recordAssignmentEvent(assignment, 'vox.fallback', 'ElevenLabs billing was unavailable; Vox switched to two explicitly assigned OpenAI voices so production could continue.', { reason: 'elevenlabs_payment_issue', dialogueSignature: story.packet.dialogueSignature });
    audio = await generateOpenAiDialogueFallback(assignment, story.packet);
  }
  const media = audio.media || [];
  if (media.some((item) => item.dialogueSignature !== story.packet.dialogueSignature)) throw new Error('Vox output changed the immutable dialogue mapping.');
  const distinctVoiceCount = new Set(media.flatMap((item) => item.voiceIds || [item.voiceId]).filter(Boolean)).size;
  const referenceAudio = media.length > 1
    ? await assembleDialogueReferenceMaster(assignment, { dialogueMedia: media, durationSeconds: story.packet.durationSeconds, dialogueSignature: story.packet.dialogueSignature })
    : { media };
  await writeStep(assignment, { key: 'vox-dialogue', position: 5, agentId: 'vox', title: 'Vox performs the exact screenplay with two bound voices', status: 'done', output: { media, referenceMaster: referenceAudio.media, totalCostUsd: audio.totalCostUsd, dialogueSignature: story.packet.dialogueSignature, distinctVoiceCount, mode: audio.fallbackReason ? 'OpenAI two-voice fallback after ElevenLabs billing outage' : 'ElevenLabs v4 multi-speaker dialogue', fallbackReason: audio.fallbackReason || null } });
  return { output: audio.fallbackReason ? 'Vox generated exact line masters with two OpenAI voices after the ElevenLabs billing outage.' : 'One exact two-speaker ElevenLabs v4 dialogue master generated.', audio, referenceAudio, agentId: 'vox' };
}

async function runCoreMotionPreliminary(assignment, plan, story, creative) {
  'use step';
  const client = studioClient();
  const { data: existing } = await client.from('nyoni_workflow_steps').select('output').eq('assignment_id', assignment.id).eq('step_key', 'motion-preliminary').eq('status', 'done').maybeSingle();
  if (existing?.output?.preliminaryDirection) return { output: existing.output.preliminaryDirection, resumed: true };
  await recordHandoff(assignment, 'creative-to-motion-preliminary', 'creative', 'motion', { script: story.output, creative: creative.output });
  await writeStep(assignment, { key: 'motion-preliminary', position: 4, agentId: 'motion', title: 'Motion Preliminary designs blocking and audio requirements', status: 'running', input: { script: story.output } });
  const result = await runNyoniAgent({
    agentId: 'motion', project: assignment.projectName, projectContext: assignment.projectContext,
    title: `Create the PRELIMINARY director plan for one provider-sized shot. Define the single generation goal, stage geography, screen-left/right positions, action axis, eyelines, start/end state, acting progression, camera, physics, exact second-by-second beats, dialogue windows, music/ambience/SFX requirements, and reference needs. Do not write the final provider prompt yet and do not claim audio or media exists. Test clips are capped at 10 seconds unless the founder explicitly overrides test mode.\n\nMISSION: ${assignment.title}\nPLAN: ${plan}\nSCRIPT: ${story.output}\nART DIRECTION: ${creative.output}`,
  });
  await writeStep(assignment, { key: 'motion-preliminary', position: 4, agentId: 'motion', title: 'Motion Preliminary designs blocking and audio requirements', status: 'done', output: { preliminaryDirection: result.output } });
  return result;
}

async function runCoreSoundDirection(assignment, plan, story, creative, preliminary) {
  'use step';
  await recordHandoff(assignment, 'motion-to-sonora-production-core', 'motion', 'sonora', { script: story.output, creative: creative.output, preliminary: preliminary.output });
  await writeStep(assignment, { key: 'production-sound-direction', position: 4, agentId: 'sonora', title: 'Sonora designs synchronized sound direction', status: 'running', input: { script: story.output, kieEmbeddedAudio: true } });
  const result = await runNyoniAgent({
    agentId: 'sonora', project: assignment.projectName, projectContext: assignment.projectContext,
    title: `Design a precise, commercially usable instrumental sound plan for this short video. Follow Motion Preliminary. Specify time-coded ambience, Foley, impacts, transitions, musical texture, dynamics, dialogue windows, and silence. Keep dialogue out unless it is explicitly present in the script. The authorized provider is KIE only; do not request WaveSpeed or ElevenLabs.\n\nMISSION: ${assignment.title}\nPLAN: ${plan}\nSCRIPT: ${story.output}\nVISUAL DIRECTION: ${creative.output}\nMOTION PRELIMINARY: ${preliminary.output}`,
  });
  await writeStep(assignment, { key: 'production-sound-direction', position: 4, agentId: 'sonora', title: 'Sonora designs synchronized sound direction', status: 'done', output: { soundDirection: result.output, providerPlan: 'KIE audio reference plus Seedance synchronization' } });
  return result;
}

async function runCoreSound(assignment, plan, story, creative, preliminary) {
  const result = await runCoreSoundDirection(assignment, plan, story, creative, preliminary);
  if (assignment.request?.production?.generateAudio !== true) return { ...result, audio: null };
  await recordHandoff(assignment, 'sonora-direction-to-sonora-audio', 'sonora', 'sonora', { durationSeconds: assignment.request.production.durationSeconds, provider: 'kie' });
  const audio = await runMediaProduction(
    { ...assignment, agent_id: 'sonora' }, { output: result.output },
    { key: 'sonora-audio-production', position: 5, title: 'Sonora generates the authorized KIE sound master' },
  );
  return { ...result, audio };
}

async function buildCorePacket(assignment, story, creative, preliminary, sound, workflowKind, visualReference = null) {
  'use step';
  await recordHandoff(assignment, `${sound.agentId || 'vox'}-to-motion-final`, sound.agentId || 'vox', 'motion', { scriptArtifactId: story.artifactId, dialogueSignature: story.packet.dialogueSignature, preliminary: preliminary.output, soundDirection: sound.output, audio: sound.audio?.media || [] });
  await writeStep(assignment, { key: 'production-context', position: 6, agentId: 'motion', title: 'Motion Final resolves canon and compiles the Director Shot Packet', status: 'running', input: { stableIds: assignment.request?.production || {}, audioAssetIds: sound.audio?.media?.map((item) => item.assetId) || [] } });
  const requested = assignment.request?.production || {};
  const founderDirected = ['Colony Zero', 'Palava 231'].includes(assignment.projectName);
  const generation = {
    mode: requested.mode || (visualReference?.media?.length || requested.referenceAssetIds?.length ? 'reference-to-video' : 'text-to-video'),
    provider: requested.provider || 'kie', model: requested.model || 'bytedance/seedance-2-5',
    durationSeconds: Number(requested.durationSeconds || (workflowKind === 'nyoni_commercials_pipeline' ? 8 : 10)),
    resolution: requested.resolution || '720p',
    aspectRatio: requested.aspectRatio || (workflowKind === 'nyoni_commercials_pipeline' ? '9:16' : '16:9'),
    generateAudio: requested.generateAudio === true, returnLastFrame: true,
  };
  if (requested.testMode !== false && generation.durationSeconds > 10) {
    throw new Error('Test-mode video clips are capped at 10 seconds. Set production.testMode=false only when the founder explicitly authorizes a longer production.');
  }
  const audioReferences = (sound.referenceAudio?.media || sound.audio?.media || []).filter((item) => item.type === 'audio' && item.url).map((item, index) => ({
    id: `vox-dialogue-${index + 1}`, assetId: item.assetId, url: item.url, role: 'dialogue',
    label: item.lineId ? `Vox exact dialogue line ${item.lineId}` : `Vox exact two-speaker dialogue master ${index + 1}`,
    durationSeconds: item.startSeconds !== undefined && item.endSeconds !== undefined ? Math.max(0.1, Number(item.endSeconds) - Number(item.startSeconds)) : null,
    ...(item.speakerId ? { characterId: item.speakerId } : {}), preservation: 'exact_master',
  }));
  const referenceAssetIds = [...new Set([...(requested.referenceAssetIds || []), ...(visualReference?.media || []).map((item) => item.assetId).filter(Boolean)])];
  let packet = await resolveProductionContext(assignment, {
    requiresSeries: founderDirected && assignment.request?.production?.allowExistingCanon === true,
    seriesDocumentId: requested.seriesDocumentId, productionDocumentId: requested.productionDocumentId,
    episodeId: requested.episodeId, sceneId: requested.sceneId, shotId: requested.shotId,
    characterIds: requested.characterIds || [], assetIds: referenceAssetIds,
    scriptText: story.output, dialogue: story.packet.dialogue.map((line) => ({ id: line.id, speaker: line.speakerId, recipient: line.recipientId, text: line.text, emotion: line.emotion, performance: line.performance, startSeconds: line.startSeconds, endSeconds: line.endSeconds })),
    generation, estimatedUsd: 0, approvedLimitUsd: Number(requested.approvedLimitUsd || 0),
    expectedDeliverables: assignment.request?.expectedDeliverables || [
      { id: 'final-video', type: 'video', required: true, playable: true, label: 'Playable final video' },
      { id: 'review-package', type: 'review_package', required: true, playable: false, label: 'Founder review package' },
    ],
    directingPhase: 'final', frameRateIntent: requested.frameRateIntent || '24fps cinematic motion',
    audioReferences, audioStrategy: { mode: audioReferences.length ? 'exact_post_mix' : generation.generateAudio ? 'provider_generated' : 'none', exactMastersRequired: Boolean(audioReferences.length), instructions: [sound.output, 'Preserve the exact line order, words, speaker identities, listener targets and conversational pauses in the Vox master. Cutline will use this exact master in the final export.'] },
    continuityRules: story.packet.continuityRules,
    stageGeography: requested.stageGeography || { location: story.packet.location, characterPositions: story.packet.characters.map((item, index) => ({ characterId: item.id, side: index === 0 ? 'screen-left' : 'screen-right' })) },
    eyelines: requested.eyelines || story.packet.dialogue.map((line) => ({ speakerId: line.speakerId, listenerId: line.recipientId, rule: `${line.speakerId} looks to ${line.recipientId}; ${line.recipientId} visibly listens and reacts.` })),
    actionTimeline: requested.actionTimeline || story.packet.beats,
    endState: requested.endState || { payoff: story.packet.payoff, holdReaction: true }, negativeConstraints: [...(requested.negativeConstraints || []), 'No Palava 231 characters, wardrobe, names, props, or canon.'],
    visualDirection: { approvedDirection: 'Use Motion Final below. Raw Creative Markdown is intentionally excluded from the provider prompt.' },
  });
  packet = { ...packet,
    characters: story.packet.characters.map((character) => ({ id: character.id, name: character.name, versionId: null, canonState: { originalForAssignment: assignment.id, motivation: character.motivation, relationship: character.relationship }, voiceDirection: character.voiceDirection })),
    voicePolicy: { mode: 'bound-synthetic-voice', allowAutomaticVoiceSelection: false, voiceProfileId: null, instructions: ['Use only the explicit Vox dialogue master and its character-to-voice bindings.', `Immutable dialogue signature: ${story.packet.dialogueSignature}.`] },
  };
  packet = { ...packet, budget: { ...packet.budget, estimatedUsd: estimateProviderCost(packet).estimatedUsd } };
  const motionText = `You are Motion FINAL. Inspect the ACTUAL generated starting-frame image(s) attached below before writing the video direction. Using those exact visible identities, props, composition and room geography, the authoritative packet, Motion Preliminary, actual Vox dialogue masters, and approved art direction, create the definitive director-grade shot direction. You MUST NOT rewrite, reorder, omit, paraphrase, or reassign dialogue; preserve signature ${story.packet.dialogueSignature}. Reconcile visual timing around the actual audio. Specify the single goal, every reference role and exclusion, identity locks, exact screen-left/right blocking, action axis, speaker-to-listener eyelines for every line, listener reactions, expressive facial acting, lens/camera, environment/materials, exact timestamps, physics/contact, end-state continuity, synchronized audio cues, and shot-specific negative constraints. Never discard a critical reference.\n\nSTRUCTURED SCRIPT:\n${JSON.stringify(story.packet)}\n\nMOTION PRELIMINARY:\n${preliminary.output}\n\nAPPROVED ART DIRECTION:\n${creative.output}\n\nVOX MASTER MANIFEST:\n${JSON.stringify(sound.audio?.media || [])}\n\nVISUAL REFERENCES:\n${packet.references.map((item, index) => `@Image ${index + 1}: ${item.label} — ${item.role} — ${item.priority}`).join('\n') || 'None'}\nAUDIO REFERENCES:\n${audioReferences.map((item, index) => `@Audio ${index + 1}: ${item.label} — ${item.url}`).join('\n') || 'None'}`;
  const motionOpenAI = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const motionResponse = await motionOpenAI.responses.create({
    model: process.env.NYONI_MOTION_MODEL || 'gpt-5.5',
    input: [{ role: 'user', content: [
      { type: 'input_text', text: motionText },
      ...packet.references.map((item) => ({ type: 'input_image', image_url: item.url })),
    ] }],
  });
  const motionDraft = { output: motionResponse.output_text || '', sessionId: motionResponse.id };
  if (!motionDraft.output) throw new Error('Motion Final inspected the starting frame but returned no directing packet.');
  packet = { ...packet, motionPrompt: buildMotionProductionPrompt(packet, { goal: motionDraft.output }) };
  const persisted = await persistProductionPacket(packet);
  await writeStep(assignment, { key: 'production-context', position: 6, agentId: 'motion', title: 'Motion Final compiles the Director Shot Packet', status: packet.blockers.length ? 'failed' : 'done', output: { packetId: persisted.id, schemaVersion: packet.schemaVersion, packetVersion: packet.packetVersion, blockers: packet.blockers, referenceManifest: packet.references.map((item, position) => ({ token: `@Image ${position + 1}`, position: position + 1, id: item.id, role: item.role, priority: item.priority })), audioManifest: packet.audioReferences.map((item, position) => ({ token: `@Audio ${position + 1}`, id: item.id, assetId: item.assetId, durationSeconds: item.durationSeconds })) }, error: packet.blockers.length ? packet.blockers.map((item) => item.message).join(' ') : null });
  return { packet, packetRowId: persisted.id, motionSessionId: motionDraft.sessionId };
}

async function createCoreProductionJob(assignment, packetRowId, packet, agentId, jobKind = packet.generation.mode) {
  'use step';
  const client = studioClient();
  const { data, error } = await client.from('nyoni_production_jobs').upsert({
    owner_id: assignment.owner_id, project_id: assignment.project_id, assignment_id: assignment.id,
    packet_id: packetRowId, agent_id: agentId, job_kind: jobKind, state: 'queued',
    idempotency_key: `${assignment.id}:packet:${packet.packetId}:${packet.packetVersion}:${agentId}:${jobKind}`,
    input: { packetId: packet.packetId, packetVersion: packet.packetVersion, expectedDeliverables: packet.expectedDeliverables },
    estimated_cost_usd: packet.budget.estimatedUsd,
  }, { onConflict: 'owner_id,idempotency_key' }).select('*').single();
  if (error) throw new Error(`Production job creation failed: ${error.message}`);
  return data;
}

async function updateCoreProductionJob(jobId, patch) {
  'use step';
  const client = studioClient();
  const { error } = await client.from('nyoni_production_jobs').update({ ...patch, updated_at: new Date().toISOString() }).eq('id', jobId);
  if (error) throw new Error(`Production job update failed: ${error.message}`);
}

async function runCoreGeneration(assignment, core) {
  const packet = core.packet;
  const agentId = packet.generation.mode === 'image-to-video' ? 'kinetic' : packet.generation.mode === 'video-edit' ? 'cutline' : 'nova';
  await recordHandoff(assignment, `motion-to-${agentId}-production-core`, 'motion', agentId, { packetId: core.packetRowId, mode: packet.generation.mode, referenceCount: packet.references.length });
  if (packet.blockers.length) return { blocked: true, reason: packet.blockers.map((item) => item.message).join(' '), media: [], totalCostUsd: 0, agentId };
  const jobRow = await createCoreProductionJob(assignment, core.packetRowId, packet, agentId);
  await updateCoreProductionJob(jobRow.id, { state: 'running', started_at: new Date().toISOString(), attempt: Number(jobRow.attempt || 0) + 1 });
  try {
    const production = await runMediaProduction(
      { ...assignment, agent_id: agentId }, { output: packet.motionPrompt },
      { key: 'core-video-generation', position: 5, title: `${agentId} generates the packet's final video` },
      { packet, productionJobId: jobRow.id, idempotencyKey: jobRow.idempotency_key },
    );
    await updateCoreProductionJob(jobRow.id, { state: 'completed', output: production, provider: production.provider, actual_cost_usd: production.totalCostUsd, completed_at: new Date().toISOString() });
    return { ...production, agentId, productionJobId: jobRow.id };
  } catch (error) {
    const reason = error?.message || 'Video generation failed.';
    await updateCoreProductionJob(jobRow.id, { state: 'blocked', error: { code: 'GENERATION_BLOCKED', message: reason } });
    await writeStep(assignment, { key: 'core-video-generation', position: 5, agentId, title: `${agentId} generates the packet's final video`, status: 'failed', error: reason, output: { media: [], blocked: true, reason } });
    return { blocked: true, reason, media: [], totalCostUsd: 0, agentId, productionJobId: jobRow.id };
  }
}

async function runCoreQa(assignment, core, production) {
  'use step';
  await recordHandoff(assignment, `${production.agentId}-to-pulse-production-core`, production.agentId, 'pulse', { packetId: core.packetRowId, productionJobId: production.productionJobId, media: production.media || [] });
  await writeStep(assignment, { key: 'core-preliminary-qa', position: 6, agentId: 'pulse', title: 'Pulse performs structured preliminary QA', status: 'running', input: { packetId: core.packetRowId, media: production.media || [] } });
  const review = evaluateProductionQuality({
    packet: core.packet, media: production.media || [], stage: 'preliminary',
    technical: production.media?.length ? {
      resolution: core.packet.generation.resolution, aspectRatio: core.packet.generation.aspectRatio,
      durationSeconds: core.packet.generation.durationSeconds, submittedReferenceIds: core.packet.references.map((item) => item.id), syntheticVoiceUsed: false,
      verificationScope: 'provider-request-and-persisted-media; codec probing pending',
    } : {},
  });
  const client = studioClient();
  const { error } = await client.from('nyoni_quality_reviews').insert({
    owner_id: assignment.owner_id, project_id: assignment.project_id, assignment_id: assignment.id,
    packet_id: core.packetRowId, asset_id: production.media?.find((item) => item.type === 'video')?.assetId || null,
    stage: 'preliminary', disposition: review.disposition, observations: review.observations, measurements: review.measurements, reviewer_agent_id: 'pulse',
  });
  if (error) throw new Error(`Pulse review persistence failed: ${error.message}`);
  await writeStep(assignment, { key: 'core-preliminary-qa', position: 6, agentId: 'pulse', title: 'Pulse performs structured preliminary QA', status: review.disposition === 'PASS' ? 'done' : 'failed', output: review, error: review.disposition === 'PASS' ? null : `${review.disposition}: ${review.observations.map((item) => item.message).join(' ')}` });
  return review;
}

async function runCoreCutline(assignment, core, production, vox) {
  'use step';
  const sourceVideo = production.media?.find((item) => item.type === 'video' && item.provider !== 'cutline');
  const dialogueMedia = vox.audio?.media || [];
  await recordHandoff(assignment, 'pulse-to-cutline-dialogue-edit', 'pulse', 'cutline', { packetId: core.packetRowId, sourceAssetId: sourceVideo?.assetId, dialogueAssetIds: dialogueMedia.map((item) => item.assetId), dialogueSignature: core.packet.script.dialogue?.length ? vox.audio?.media?.[0]?.dialogueSignature : null });
  await writeStep(assignment, { key: 'core-cutline', position: 8, agentId: 'cutline', title: 'Cutline assembles the exact Vox dialogue master with the generated video', status: 'running', input: { sourceAssetId: sourceVideo?.assetId, dialogueAssetIds: dialogueMedia.map((item) => item.assetId), durationSeconds: core.packet.generation.durationSeconds } });
  const cutline = await assembleDialogueCut(assignment, { video: sourceVideo, dialogueMedia, durationSeconds: core.packet.generation.durationSeconds });
  await writeStep(assignment, { key: 'core-cutline', position: 8, agentId: 'cutline', title: 'Cutline assembles the exact Vox dialogue master with the generated video', status: 'done', output: { media: cutline.media, reviewFrames: cutline.reviewFrames, sourcePreserved: true, costUsd: 0 } });
  return { ...production, media: [...(production.media || []).map((item) => ({ ...item, role: item.role || 'source_generation' })), ...cutline.media], cutline, totalCostUsd: Number(production.totalCostUsd || 0) };
}

async function runCoreFinalQa(assignment, core, production, story) {
  'use step';
  await recordHandoff(assignment, 'cutline-to-pulse-final-qa', 'cutline', 'pulse', { packetId: core.packetRowId, finalAssetId: production.cutline?.media?.[0]?.assetId, reviewFrames: production.cutline?.reviewFrames || [] });
  await writeStep(assignment, { key: 'core-final-qa', position: 9, agentId: 'pulse', title: 'Pulse evaluates the actual finished media', status: 'running', input: { finalAssetId: production.cutline?.media?.[0]?.assetId, reviewFrameCount: production.cutline?.reviewFrames?.length || 0 } });
  const probe = production.cutline?.probe || '';
  const hasVideo = /Video:/i.test(probe);
  const hasAudio = /Audio:/i.test(probe);
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const frames = production.cutline?.reviewFrames || [];
  const response = await openai.responses.create({
    model: process.env.NYONI_QA_MODEL || 'gpt-5.5',
    input: [{ role: 'user', content: [
      { type: 'input_text', text: `You are Pulse. Evaluate these extracted frames from the ACTUAL finished 10-second clip against the screenplay and art direction. Check: exactly two visually distinct original characters; police interrogation room readability; consistent identities; correct conversational screen-left/right geography and plausible eyelines; expressive speaker/listener facial acting; cinematic stylized 3D quality; no Palava 231/canon reuse; no obvious anatomy, duplicate-person, prop, lighting, or continuity failures. Return PASS or FIX, then concise evidence. Do not claim to have heard audio; technical probing separately confirmed audio/video streams.\n\nSCREENPLAY PACKET:\n${JSON.stringify(story.packet)}` },
      ...frames.map((item) => ({ type: 'input_image', image_url: item.url })),
    ] }],
  });
  const visualReport = response.output_text || 'FIX: no visual report returned.';
  const disposition = hasVideo && hasAudio && /^\s*PASS\b/i.test(visualReport) ? 'PASS' : 'FIX';
  const review = { disposition, stage: 'final_technical', canFounderReview: disposition === 'PASS', observations: [
    { code: hasVideo ? 'VIDEO_STREAM_PRESENT' : 'VIDEO_STREAM_MISSING', severity: hasVideo ? 'info' : 'blocking', message: hasVideo ? 'FFmpeg decoded the finished video stream.' : 'Finished file has no decodable video stream.' },
    { code: hasAudio ? 'EXACT_DIALOGUE_STREAM_PRESENT' : 'AUDIO_STREAM_MISSING', severity: hasAudio ? 'info' : 'blocking', message: hasAudio ? 'FFmpeg decoded the Cutline audio stream assembled from the exact Vox dialogue master.' : 'Finished file has no decodable audio stream.' },
    { code: 'FRAME_SAMPLED_VISUAL_QA', severity: disposition === 'PASS' ? 'info' : 'consequential', message: visualReport },
  ], measurements: { durationSeconds: core.packet.generation.durationSeconds, resolution: core.packet.generation.resolution, aspectRatio: core.packet.generation.aspectRatio, reviewFrameCount: frames.length, dialogueSignature: story.packet.dialogueSignature, verificationScope: 'actual finished MP4 decode plus three extracted-frame visual review' } };
  const client = studioClient();
  const { error } = await client.from('nyoni_quality_reviews').insert({ owner_id: assignment.owner_id, project_id: assignment.project_id, assignment_id: assignment.id, packet_id: core.packetRowId, asset_id: production.cutline?.media?.[0]?.assetId || null, stage: 'final_technical', disposition, observations: review.observations, measurements: review.measurements, reviewer_agent_id: 'pulse' });
  if (error) throw new Error(`Final actual-media QA persistence failed: ${error.message}`);
  await writeStep(assignment, { key: 'core-final-qa', position: 9, agentId: 'pulse', title: 'Pulse evaluates the actual finished media', status: disposition === 'PASS' ? 'done' : 'failed', output: review, error: disposition === 'PASS' ? null : visualReport });
  return review;
}

async function runCoreFinishing(assignment, core, production, preliminaryQa) {
  const targetResolution = assignment.request?.production?.targetResolution;
  if (!targetResolution || String(targetResolution).toLowerCase() === String(core.packet.generation.resolution).toLowerCase()) {
    await writeStep(assignment, { key: 'core-finishing', position: 7, agentId: 'cutline', title: 'Cutline / Prism finishing', status: 'skipped', output: { skipped: true, reason: 'No higher final-resolution export was requested.', preservedOriginals: true } });
    return { production, finalQa: { ...preliminaryQa, stage: 'final_technical', canFounderReview: preliminaryQa.disposition === 'PASS' }, finished: false };
  }
  await recordHandoff(assignment, 'pulse-to-prism-finishing', 'pulse', 'cutline', { packetId: core.packetRowId, targetResolution, preliminaryQa: preliminaryQa.disposition });
  const sourceVideo = production.media?.find((item) => item.type === 'video');
  const jobRow = await createCoreProductionJob(assignment, core.packetRowId, core.packet, 'cutline', 'video-upscale');
  await writeStep(assignment, { key: 'core-finishing', position: 7, agentId: 'cutline', title: `Prism finishes the video at ${targetResolution}`, status: 'running', input: { sourceAssetId: sourceVideo?.assetId, targetResolution, preserveOriginal: true } });
  try {
    let job = await submitPrismFinishing(assignment, {
      packet: core.packet, video: sourceVideo, preliminaryReview: preliminaryQa, targetResolution,
      remainingBudgetUsd: Math.max(0, Number(core.packet.budget.approvedLimitUsd || 0) - Number(production.totalCostUsd || 0)),
      productionJobId: jobRow.id,
    });
    for (let attempt = 0; attempt < 90 && job.status !== 'completed'; attempt += 1) { await sleep('10s'); job = await pollMediaStep(assignment, job); }
    if (job.status !== 'completed') throw new Error('Prism finishing timed out before WaveSpeed returned the export.');
    const finished = await persistStudioGeneration(assignment, job);
    finished.media = finished.media.map((item) => ({ ...item, resolution: targetResolution, durationSeconds: core.packet.generation.durationSeconds, role: 'finished_export' }));
    const combined = { ...production, media: [...(production.media || []).map((item) => ({ ...item, role: item.role || 'original_generation' })), ...finished.media], totalCostUsd: Number(production.totalCostUsd || 0) + Number(finished.totalCostUsd || 0), finishing: finished };
    const finalPacket = { ...core.packet, generation: { ...core.packet.generation, resolution: targetResolution } };
    const finalQa = evaluateProductionQuality({ packet: finalPacket, media: finished.media, stage: 'final_technical', technical: { resolution: targetResolution, aspectRatio: core.packet.generation.aspectRatio, durationSeconds: core.packet.generation.durationSeconds, submittedReferenceIds: core.packet.references.map((item) => item.id), verificationScope: 'persisted finishing output metadata; codec probing pending' } });
    const client = studioClient();
    const { error } = await client.from('nyoni_quality_reviews').insert({ owner_id: assignment.owner_id, project_id: assignment.project_id, assignment_id: assignment.id, packet_id: core.packetRowId, asset_id: finished.media[0]?.assetId || null, stage: 'final_technical', disposition: finalQa.disposition, observations: finalQa.observations, measurements: finalQa.measurements, reviewer_agent_id: 'pulse' });
    if (error) throw new Error(`Final technical review persistence failed: ${error.message}`);
    await updateCoreProductionJob(jobRow.id, { state: finalQa.disposition === 'PASS' ? 'completed' : 'needs_repair', output: finished, provider: finished.provider, actual_cost_usd: finished.totalCostUsd, completed_at: new Date().toISOString() });
    await recordHandoff(assignment, 'cutline-to-pulse-final-qa', 'cutline', 'pulse', { packetId: core.packetRowId, finishingJobId: jobRow.id, finishedAssetIds: finished.media.map((item) => item.assetId) });
    await writeStep(assignment, { key: 'core-finishing', position: 7, agentId: 'cutline', title: `Prism finishes the video at ${targetResolution}`, status: finalQa.disposition === 'PASS' ? 'done' : 'failed', output: { finished, finalQa, preservedOriginals: true }, error: finalQa.disposition === 'PASS' ? null : finalQa.observations.map((item) => item.message).join(' ') });
    return { production: combined, finalQa, finished: true };
  } catch (error) {
    const reason = error?.message || 'Prism finishing failed.';
    await updateCoreProductionJob(jobRow.id, { state: 'blocked', error: { code: 'FINISHING_BLOCKED', message: reason } });
    await writeStep(assignment, { key: 'core-finishing', position: 7, agentId: 'cutline', title: `Prism finishes the video at ${targetResolution}`, status: 'failed', error: reason, output: { preservedOriginals: true } });
    return { production: { ...production, blocked: true, reason, finishingBlocked: true }, finalQa: { ...preliminaryQa, disposition: 'FIX', stage: 'final_technical', observations: [...preliminaryQa.observations, { code: 'FINISHING_BLOCKED', severity: 'consequential', message: reason }] }, finished: false };
  }
}

async function runCoreRally(assignment, plan, story, creative, core, production, qa) {
  'use step';
  await recordHandoff(assignment, 'pulse-to-rally-production-core', 'pulse', 'rally', { packetId: core.packetRowId, qa: qa.disposition, media: production.media || [] });
  await writeStep(assignment, { key: 'core-review-package', position: 8, agentId: 'rally', title: 'Rally assembles the founder review package', status: 'running', input: { packetId: core.packetRowId, qa: qa.disposition } });
  const result = await runNyoniAgent({
    agentId: 'rally', project: assignment.projectName, projectContext: assignment.projectContext,
    title: `Assemble a concise founder review package. Include project, concept, script summary, exact media manifest, provider/model, references used, resolution/duration/aspect ratio, QA disposition, estimated/actual spend, missing items, caption variants, and one approve/request-changes/reject decision. Do not claim publishing occurred.\n\nMISSION: ${assignment.title}\nPLAN: ${plan}\nSCRIPT: ${story.output}\nCREATIVE: ${creative.output}\nPACKET: ${JSON.stringify({ id: core.packet.packetId, generation: core.packet.generation, references: core.packet.references.map((item) => ({ id: item.id, label: item.label, role: item.role })) })}\nPRODUCTION: ${JSON.stringify(production)}\nQA: ${JSON.stringify(qa)}`,
  });
  await writeStep(assignment, { key: 'core-review-package', position: 8, agentId: 'rally', title: 'Rally assembles the founder review package', status: 'done', output: { package: result.output } });
  return result;
}

async function finalizeCoreProduction(assignment, stages) {
  'use step';
  const client = studioClient(); const now = new Date().toISOString();
  const media = stages.production.media || [];
  const ready = !stages.production.blocked && stages.qa.disposition === 'PASS' && media.some((item) => item.type === 'video' && item.url);
  const missingItems = ready ? [] : [
    ...(stages.production.blocked ? [{ code: 'GENERATION_BLOCKED', message: stages.production.reason }] : []),
    ...stages.qa.observations.map((item) => ({ code: item.code, message: item.message })),
  ];
  const { data: artifact, error: artifactError } = await client.from('nyoni_artifacts').insert({
    assignment_id: assignment.id, project_id: assignment.project_id, owner_id: assignment.owner_id,
    artifact_type: 'production_review_package', title: assignment.title, status: ready ? 'ready' : 'incomplete', current_version: 1,
    metadata: { packetId: stages.core.packetRowId, mediaCount: media.length, qa: stages.qa.disposition, missingItems, requiresFounderApproval: ready },
  }).select('*').single();
  if (artifactError) throw new Error(`Production review artifact failed: ${artifactError.message}`);
  const content = { plan: stages.plan, research: stages.research || null, screenplay: stages.story.output, storyScriptPacket: stages.story.packet, storyArtifactId: stages.story.artifactId, creative: stages.creative.output, motionPreliminary: stages.preliminary?.output || null, vox: stages.sound?.audio || null, motionPacket: stages.core.packet, deliverable: stages.rally.output, media, qa: stages.qa, production: stages.production, missingItems };
  const { error: versionError } = await client.from('nyoni_artifact_versions').insert({ artifact_id: artifact.id, owner_id: assignment.owner_id, version: 1, content, created_by_agent_id: 'rally' });
  if (versionError) throw new Error(`Production review version failed: ${versionError.message}`);
  const result = { ...content, artifactId: artifact.id, totalCostUsd: stages.production.totalCostUsd || 0, providers: { studio: stages.production.provider, model: stages.production.model }, collaboration: ['migo', ...(stages.research ? ['scout'] : []), 'story', 'creative', 'lumina', 'motion', 'vox', stages.production.agentId, 'pulse', 'cutline', 'pulse', 'rally'] };
  if (ready) {
    const { error: approvalError } = await client.from('nyoni_approval_requests').insert({
      assignment_id: assignment.id, owner_id: assignment.owner_id, action_type: 'approve_content_package',
      payload: { tier: 'B', artifactId: artifact.id, packetId: stages.core.packetRowId, media, totalCostUsd: result.totalCostUsd, externalAction: 'publishing_remains_separately_gated' },
      payload_sha256: assignment.id, status: 'pending', created_at: now,
    });
    if (approvalError) throw new Error(`Founder approval request failed: ${approvalError.message}`);
  }
  const { error } = await client.from('nyoni_assignments').update({
    status: ready ? 'waiting_approval' : 'failed', production_state: ready ? 'ready_founder_review' : stages.qa.disposition === 'FIX' && !stages.production.blocked ? 'needs_qa_repair' : 'media_blocked',
    result, error: ready ? null : missingItems.map((item) => item.message).join(' '), total_cost_usd: result.totalCostUsd,
    completed_at: ready ? now : null, updated_at: now,
  }).eq('id', assignment.id);
  if (error) throw new Error(`Production finalization failed: ${error.message}`);
  await recordHandoff(assignment, 'rally-to-migo-production-review', 'rally', 'migo', { artifactId: artifact.id, packetId: stages.core.packetRowId, ready, missingItems });
  await recordAssignmentEvent(assignment, ready ? 'workflow.waiting_approval' : 'workflow.incomplete', ready ? 'Finished production is ready for founder review' : 'Production stopped with explicit missing media or QA issues', { artifactId: artifact.id, packetId: stages.core.packetRowId, missingItems, costUsd: result.totalCostUsd });
  return result;
}

async function runProductionCoreWorkflow(assignment, plan, workflowKind) {
  const research = workflowKind === 'nyoni_commercials_pipeline' ? await runCommercialResearch(assignment, plan) : null;
  const story = await runCoreStory(assignment, plan, workflowKind, research);
  const creative = await runCoreCreative(assignment, plan, story, workflowKind);
  const visualReference = await runCoreVisualReference(assignment, story, creative);
  const preliminary = await runCoreMotionPreliminary(assignment, plan, story, creative);
  const sound = await runCoreVox(assignment, story, preliminary);
  const core = await buildCorePacket(assignment, story, creative, preliminary, sound, workflowKind, visualReference);
  const videoProduction = await runCoreGeneration(assignment, core);
  const generated = { ...videoProduction, media: [...(visualReference.media || []), ...(sound.audio?.media || []), ...(videoProduction.media || [])], totalCostUsd: Number(visualReference.totalCostUsd || 0) + Number(sound.audio?.totalCostUsd || 0) + Number(videoProduction.totalCostUsd || 0) };
  await runCoreQa(assignment, core, generated);
  const production = await runCoreCutline(assignment, core, generated, sound);
  const qa = await runCoreFinalQa(assignment, core, production, story);
  const rally = await runCoreRally(assignment, plan, story, creative, core, production, qa);
  return finalizeCoreProduction(assignment, { plan, research, story, creative, preliminary, sound, core, production, qa, rally });
}

async function finalizeAssignment(assignment, plan, deliverable, production = null) {
  'use step';
  const client = studioClient();
  const now = new Date().toISOString();
  const productionSucceeded = Boolean(production?.media?.length);
  const requiredMediaRequested = ['studio_generation','watch_nyoni_pipeline','nyoni_commercials_pipeline'].includes(assignment.workflow_kind) || Boolean(assignment.request?.expectedDeliverables?.some((item) => item.required && ['video','image','audio'].includes(item.type)));
  const mediaIncomplete = requiredMediaRequested && !productionSucceeded;
  const { data: artifact, error: artifactError } = await client.from('nyoni_artifacts').insert({
    assignment_id: assignment.id, project_id: assignment.project_id, owner_id: assignment.owner_id,
    artifact_type: productionSucceeded ? production.kind : 'document', title: assignment.title, status: mediaIncomplete ? 'incomplete' : 'ready', current_version: 1,
    metadata: { agentId: deliverable.agentId, sessionId: deliverable.sessionId, mediaCount: production?.media?.length || 0, generationSkipped: Boolean(production?.skipped), generationReason: production?.reason || null },
  }).select('*').single();
  if (artifactError) throw new Error(`Artifact creation failed: ${artifactError.message}`);
  const { error: versionError } = await client.from('nyoni_artifact_versions').insert({
    artifact_id: artifact.id, owner_id: assignment.owner_id, version: 1,
    content: { plan, deliverable: deliverable.output, collaboration: deliverable.collaboration || [deliverable.agentId], media: production?.media || [], production }, created_by_agent_id: deliverable.agentId,
  });
  if (versionError) throw new Error(`Artifact version failed: ${versionError.message}`);
  const result = { plan, deliverable: deliverable.output, collaboration: deliverable.collaboration || [deliverable.agentId], artifactId: artifact.id, providers: { ...deliverable.providers, ...(productionSucceeded ? { studio: production.provider, model: production.model } : {}) }, media: production?.media || [], production };
  const { error } = await client.from('nyoni_assignments').update({
    status: mediaIncomplete ? 'failed' : 'done', production_state: mediaIncomplete ? 'media_blocked' : productionSucceeded ? 'ready_founder_review' : 'creative_planning',
    result, error: mediaIncomplete ? production?.reason || 'Required media was not produced.' : null,
    total_cost_usd: production?.totalCostUsd || 0, completed_at: mediaIncomplete ? null : now, updated_at: now,
  }).eq('id', assignment.id);
  if (error) throw new Error(`Assignment finalization failed: ${error.message}`);
  await recordAssignmentEvent(assignment, mediaIncomplete ? 'workflow.media_blocked' : 'workflow.completed', productionSucceeded ? 'Generated media completed and is available in deliverables' : mediaIncomplete ? `Required media was not completed: ${production?.reason || 'provider returned no durable media'}` : 'Internal planning deliverable completed', { artifactId: artifact.id, mediaCount: production?.media?.length || 0, generationSkipped: Boolean(production?.skipped) });
  return result;
}

async function markFailed(assignmentId, message) {
  'use step';
  const client = studioClient();
  const { data } = await client.from('nyoni_assignments').update({
    status: 'failed', production_state: 'failed', error: message, updated_at: new Date().toISOString(),
  }).eq('id', assignmentId).select('*').maybeSingle();
  if (data) await recordAssignmentEvent(data, 'workflow.failed', message);
}

export async function runNyoniAssignmentWorkflow(assignmentId) {
  'use workflow';
  console.info('[nyoni] workflow started', assignmentId);
  let assignment;
  try {
    assignment = await getAssignment(assignmentId);
    const plan = await runPlanningStep(assignment);
    const readiness = await checkCarouselReadiness(assignment, plan);
    if (!readiness.ready) return { status: 'waiting_approval', blockers: readiness.blockers };
    if (['watch_nyoni_pipeline', 'nyoni_commercials_pipeline', 'scripted_production_pipeline'].includes(assignment.workflow_kind)) {
      return await runProductionCoreWorkflow(assignment, plan, assignment.workflow_kind);
    }
    if (assignment.workflow_kind === 'autonomous_content_pipeline') {
      const trendRadar = await runLiveTrendRadar(assignment, plan);
      const creative = await runContentCreative(assignment, plan, trendRadar);
      const still = await runContentAsset(assignment, 'lumina', 'creative', creative, { key: 'content-still', position: 4, title: 'Lumina generates the campaign still' });
      const video = await runContentAsset(assignment, 'nova', 'creative', creative, { key: 'content-video', position: 5, title: 'Nova generates the vertical video' });
      const voice = await runContentAsset(assignment, 'vox', 'creative', creative, { key: 'content-voice', position: 6, title: 'Vox generates the voice track' });
      const productions = [still, video, voice];
      const qa = await runContentQa(assignment, creative, productions);
      const assembly = await runContentAssembly(assignment, plan, trendRadar, creative, productions, qa);
      return await finalizeAutonomousContent(assignment, { plan, trendRadar, creative, productions, qa, assembly });
    }
    if (assignment.workflow_kind === 'commercial_pipeline') {
      const research = await runCommercialResearch(assignment, plan);
      const direction = await runCommercialCreative(assignment, plan, research);
      const production = await runCommercialImage(assignment, direction);
      const qa = await runCommercialQa(assignment, direction, production);
      const assembly = await runCommercialAssembly(assignment, plan, research, direction, production, qa);
      await recordHandoff(assignment, 'rally-to-migo-final-report', 'rally', 'migo', { report: assembly.output, media: production.media });
      return await finalizeCommercial(assignment, { plan, research, direction, production, qa, assembly });
    }
    if (assignment.workflow_kind === 'carousel') {
      const carousel = await runCarouselProduction(assignment, plan);
      return await finalizeCarousel(assignment, carousel);
    }
    if (assignment.agent_id === 'migo') {
      const route = await routeMission(assignment, plan);
      const work = [];
      let fromAgentId = 'migo';
      for (let index = 0; index < route.specialists.length; index += 1) {
        const specialist = route.specialists[index];
        await recordHandoff(assignment, `route-${index + 1}-${fromAgentId}-to-${specialist.agentId}`, fromAgentId, specialist.agentId, {
          brief: assignment.title,
          objective: specialist.objective,
          priorAgents: work.map((item) => item.agentId),
        });
        const result = await runRoutedSpecialist(assignment, specialist, plan, work, index + 3);
        work.push(result);
        fromAgentId = specialist.agentId;
      }
      await recordHandoff(assignment, `route-${fromAgentId}-to-migo-report`, fromAgentId, 'migo', {
        brief: assignment.title,
        contributors: work.map((item) => item.agentId),
      });
      const deliverable = await synthesizeRoutedMission(assignment, plan, route, work, route.specialists.length + 3);
      return await finalizeAssignment(assignment, plan, deliverable, null);
    }
    const specialistId = assignment.agent_id;
    await recordHandoff(assignment, `migo-to-${specialistId}`, 'migo', specialistId, { brief: assignment.title, plan });
    const deliverable = await runSpecialistStep(assignment, plan);
    const production = assignment.agent_id === 'rally'
      ? await runOptionalMediaProduction(assignment, deliverable, { key: 'studio-generation', position: 4, title: 'Rally attempts the paid campaign visual' })
      : isMediaAgent(assignment.agent_id) ? await runMediaProduction(assignment, deliverable) : null;
    await recordHandoff(assignment, `${specialistId}-to-migo-report`, specialistId, 'migo', { report: deliverable.output, media: production?.media || [] });
    return await finalizeAssignment(assignment, plan, deliverable, production);
  } catch (error) {
    await markFailed(assignmentId, error?.message || 'Workflow failed.');
    throw error;
  }
}
