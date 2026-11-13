import OpenAI from 'openai';
import { sleep } from 'workflow';
import { codexModel, runNyoniAgent } from '../server/nyoni-runtime.js';
import { recordAssignmentEvent, studioClient } from '../server/nyoni-store.js';
import { isMediaAgent, persistStudioGeneration, pollStudioGeneration, submitStudioGeneration } from '../server/studio-tools.js';

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
  const agentId = assignment.agent_id === 'migo' ? 'creative' : assignment.agent_id;
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
  const { error } = await client.from('nyoni_assignments').update({ status: 'done', result, total_cost_usd: stages.production.totalCostUsd, completed_at: now, updated_at: now }).eq('id', assignment.id);
  if (error) throw new Error(`Campaign finalization failed: ${error.message}`);
  await recordAssignmentEvent(assignment, 'workflow.completed', 'Collaborative commercial package completed', { artifactId: artifact.id, agents: result.collaboration, costUsd: stages.production.totalCostUsd });
  return result;
}

async function submitMediaStep(assignment, deliverable) {
  'use step';
  await writeStep(assignment, { key: 'studio-generation', position: 4, agentId: assignment.agent_id, title: `${assignment.agent_id} generates media in Nyoni Studio`, status: 'running', input: { sourceUrl: assignment.source_url || null } });
  return submitStudioGeneration(assignment, deliverable.output);
}

async function pollMediaStep(assignment, job) {
  'use step';
  return pollStudioGeneration(assignment, job);
}

async function persistMediaStep(assignment, job) {
  'use step';
  const production = await persistStudioGeneration(assignment, job);
  await writeStep(assignment, { key: 'studio-generation', position: 4, agentId: assignment.agent_id, title: `${assignment.agent_id} generates media in Nyoni Studio`, status: 'done', output: production });
  return production;
}

async function runMediaProduction(assignment, deliverable) {
  let job = await submitMediaStep(assignment, deliverable);
  for (let attempt = 0; attempt < 90 && job.status !== 'completed'; attempt += 1) {
    await sleep('10s');
    job = await pollMediaStep(assignment, job);
  }
  if (job.status !== 'completed') throw new Error('Studio generation timed out before the provider returned media.');
  return persistMediaStep(assignment, job);
}

async function runCarouselProduction(assignment, plan) {
  'use step';
  const client = studioClient();
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  await writeStep(assignment, { key: 'source-retrieval', position: 3, agentId: 'scout', title: 'Scout retrieves source context', status: 'running', input: { sourceUrl: assignment.source_url } });
  const sourceResponse = await fetch(assignment.source_url, { headers: { 'User-Agent': 'NyoniHQ/1.0 (+https://nyoni-hq.vercel.app)' }, signal: AbortSignal.timeout(20000) });
  if (!sourceResponse.ok) throw new Error(`Source retrieval failed with HTTP ${sourceResponse.status}.`);
  const rawSource = await sourceResponse.text();
  const sourceText = rawSource.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 18000);
  if (sourceText.length < 100) throw new Error('The source URL did not return enough readable context.');
  await writeStep(assignment, { key: 'source-retrieval', position: 3, agentId: 'scout', title: 'Scout retrieves source context', status: 'done', output: { sourceUrl: assignment.source_url, excerpt: sourceText.slice(0, 1200), characters: sourceText.length } });

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

async function finalizeAssignment(assignment, plan, deliverable, production = null) {
  'use step';
  const client = studioClient();
  const now = new Date().toISOString();
  const { data: artifact, error: artifactError } = await client.from('nyoni_artifacts').insert({
    assignment_id: assignment.id, project_id: assignment.project_id, owner_id: assignment.owner_id,
    artifact_type: production ? production.kind : 'document', title: assignment.title, status: 'ready', current_version: 1,
    metadata: { agentId: deliverable.agentId, sessionId: deliverable.sessionId, mediaCount: production?.media?.length || 0 },
  }).select('*').single();
  if (artifactError) throw new Error(`Artifact creation failed: ${artifactError.message}`);
  const { error: versionError } = await client.from('nyoni_artifact_versions').insert({
    artifact_id: artifact.id, owner_id: assignment.owner_id, version: 1,
    content: { plan, deliverable: deliverable.output, media: production?.media || [], production }, created_by_agent_id: deliverable.agentId,
  });
  if (versionError) throw new Error(`Artifact version failed: ${versionError.message}`);
  const result = { plan, deliverable: deliverable.output, artifactId: artifact.id, providers: { ...deliverable.providers, ...(production ? { studio: production.provider, model: production.model } : {}) }, media: production?.media || [], production };
  const { error } = await client.from('nyoni_assignments').update({
    status: 'done', result, total_cost_usd: production?.totalCostUsd || 0, completed_at: now, updated_at: now,
  }).eq('id', assignment.id);
  if (error) throw new Error(`Assignment finalization failed: ${error.message}`);
  await recordAssignmentEvent(assignment, 'workflow.completed', production ? 'Generated media completed and is available in deliverables' : 'Internal deliverable completed', { artifactId: artifact.id, mediaCount: production?.media?.length || 0 });
  return result;
}

async function markFailed(assignmentId, message) {
  'use step';
  const client = studioClient();
  const { data } = await client.from('nyoni_assignments').update({
    status: 'failed', error: message, updated_at: new Date().toISOString(),
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
    if (assignment.workflow_kind === 'commercial_pipeline') {
      const research = await runCommercialResearch(assignment, plan);
      const direction = await runCommercialCreative(assignment, plan, research);
      const production = await runCommercialImage(assignment, direction);
      const qa = await runCommercialQa(assignment, direction, production);
      const assembly = await runCommercialAssembly(assignment, plan, research, direction, production, qa);
      return await finalizeCommercial(assignment, { plan, research, direction, production, qa, assembly });
    }
    if (assignment.workflow_kind === 'carousel') {
      const carousel = await runCarouselProduction(assignment, plan);
      return await finalizeCarousel(assignment, carousel);
    }
    const deliverable = await runSpecialistStep(assignment, plan);
    const production = isMediaAgent(assignment.agent_id) ? await runMediaProduction(assignment, deliverable) : null;
    return await finalizeAssignment(assignment, plan, deliverable, production);
  } catch (error) {
    await markFailed(assignmentId, error?.message || 'Workflow failed.');
    throw error;
  }
}
