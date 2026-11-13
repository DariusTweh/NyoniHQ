import { studioClient } from './nyoni-store.js';

const KIE_JOBS_URL = 'https://api.kie.ai/api/v1/jobs';

export const MEDIA_AGENT_CONFIG = {
  lumina: { provider: 'kie', model: 'gpt-image-2-5-flare-text-to-image', kind: 'text-to-image', contentType: 'image', estimatedCostUsd: 0.08 },
  reframe: { provider: 'kie', model: 'gpt-image-2-5-sunburst-image-to-image', kind: 'image-to-image', contentType: 'image', estimatedCostUsd: 0.20, requiresSource: true },
  nova: { provider: 'kie', model: 'bytedance/seedance-2-5', kind: 'text-to-video', contentType: 'video', estimatedCostUsd: 0.70 },
  kinetic: { provider: 'kie', model: 'bytedance/seedance-2-5', kind: 'image-to-video', contentType: 'video', estimatedCostUsd: 0.45, requiresSource: true },
  cutline: { provider: 'kie', model: 'bytedance/seedance-2-5', kind: 'video-edit', contentType: 'video', estimatedCostUsd: 0.45, requiresSource: true },
  sonora: { provider: 'kie', model: 'ai-music-api/generate', kind: 'text-to-music', contentType: 'audio', estimatedCostUsd: 0.25 },
  vox: { provider: 'elevenlabs', model: 'eleven_v4', kind: 'text-to-speech', contentType: 'audio', estimatedCostUsd: 0.10 },
  rally: { provider: 'kie', model: 'nano-banana-2', kind: 'campaign-visual', contentType: 'image', estimatedCostUsd: 0.20 },
};

export function isMediaAgent(agentId) {
  return Boolean(MEDIA_AGENT_CONFIG[agentId]);
}

function isHttpUrl(value) {
  try { return ['http:', 'https:'].includes(new URL(value).protocol); } catch { return false; }
}

function productionPrompt(assignment, deliverable) {
  return `${assignment.title}\n\nCreative direction from the Nyoni specialist:\n${deliverable}`.slice(0, 9000);
}

function kieInput(config, assignment, prompt) {
  const sourceUrl = assignment.source_url;
  if (config.kind === 'text-to-image') return { prompt, aspect_ratio: '1:1', resolution: '1K' };
  if (config.kind === 'image-to-image') return { prompt, input_urls: [sourceUrl], aspect_ratio: '1:1', resolution: '1K' };
  if (config.kind === 'text-to-video') return { prompt, generate_audio: true, return_last_frame: true, resolution: '480p', aspect_ratio: '9:16', duration: 5 };
  if (config.kind === 'image-to-video') return { prompt, first_frame_url: sourceUrl, generate_audio: true, return_last_frame: true, resolution: '480p', aspect_ratio: '9:16', duration: 5 };
  if (config.kind === 'video-edit') return { prompt, reference_video_urls: [sourceUrl], generate_audio: true, resolution: '480p', aspect_ratio: '9:16' };
  if (config.kind === 'text-to-music') return { custom_mode: true, instrumental: true, model: 'V6_MINI', title: assignment.title.slice(0, 80), style: prompt.slice(0, 1000), duration: 30, variety: 1 };
  return { prompt, image_input: sourceUrl ? [sourceUrl] : [], aspect_ratio: '4:5', resolution: '1K', output_format: 'jpg' };
}

async function enforceBudget(assignment, config) {
  const client = studioClient();
  const { data: policy, error } = await client.from('nyoni_budget_policies').select('*').eq('owner_id', assignment.owner_id).eq('project_id', assignment.project_id).maybeSingle();
  if (error) throw new Error(`Budget policy lookup failed: ${error.message}`);
  if (!policy?.paid_actions_enabled) throw new Error('Paid media generation is disabled for this department. Enable its bounded budget policy first.');
  const allowed = policy.allowed_providers || [];
  if (allowed.length && !allowed.includes(config.provider)) throw new Error(`${config.provider} is not allowed by this department's budget policy.`);
  if (config.estimatedCostUsd > Number(policy.per_run_usd || 0)) throw new Error(`This generation exceeds the $${Number(policy.per_run_usd || 0).toFixed(2)} per-run limit.`);
  const now = new Date();
  const dayStart = new Date(now); dayStart.setUTCHours(0, 0, 0, 0);
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const { data: usage, error: usageError } = await client.from('nyoni_usage_ledger').select('cost_usd,created_at').eq('owner_id', assignment.owner_id).eq('project_id', assignment.project_id).gte('created_at', monthStart.toISOString());
  if (usageError) throw new Error(`Budget usage lookup failed: ${usageError.message}`);
  const monthSpend = (usage || []).reduce((sum, row) => sum + Number(row.cost_usd || 0), 0);
  const daySpend = (usage || []).filter((row) => new Date(row.created_at) >= dayStart).reduce((sum, row) => sum + Number(row.cost_usd || 0), 0);
  if (monthSpend + config.estimatedCostUsd > Number(policy.per_month_usd || 0)) throw new Error('This generation would exceed the department monthly budget.');
  if (daySpend + config.estimatedCostUsd > Number(policy.per_day_usd || 0)) throw new Error('This generation would exceed the department daily budget.');
}

async function recordJob(assignment, config, providerJobId, input, status = 'queued') {
  const client = studioClient();
  const { data, error } = await client.from('generation_jobs').insert({
    user_id: assignment.owner_id, project_id: assignment.project_id, provider: config.provider, model: config.model,
    type: config.kind, provider_job_id: providerJobId || null, status, input: { ...input, assignmentId: assignment.id, agentId: assignment.agent_id, source: 'nyoni-hq' },
  }).select('id').single();
  if (error) throw new Error(`Studio generation record failed: ${error.message}`);
  return data.id;
}

async function submitKie(assignment, config, prompt) {
  if (!process.env.KIE_API_KEY) throw new Error('KIE_API_KEY is not connected.');
  const input = kieInput(config, assignment, prompt);
  const response = await fetch(`${KIE_JOBS_URL}/createTask`, {
    method: 'POST', headers: { Authorization: `Bearer ${process.env.KIE_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: config.model, input }), signal: AbortSignal.timeout(30000),
  });
  const body = await response.json().catch(() => null);
  const providerJobId = body?.data?.taskId || body?.data?.task_id;
  if (!response.ok || body?.code !== 200 || !providerJobId) throw new Error(`KIE rejected ${config.kind}: ${body?.msg || `HTTP ${response.status}`}`);
  const jobId = await recordJob(assignment, config, providerJobId, input);
  return { status: 'queued', providerJobId, jobId, provider: config.provider, model: config.model, kind: config.kind, contentType: config.contentType, estimatedCostUsd: config.estimatedCostUsd };
}

async function submitElevenLabs(assignment, config, prompt) {
  if (!process.env.ELEVENLABS_API_KEY) throw new Error('ELEVENLABS_API_KEY is not connected.');
  const headers = { 'xi-api-key': process.env.ELEVENLABS_API_KEY };
  let voiceId = process.env.NYONI_ELEVENLABS_VOICE_ID;
  if (!voiceId) {
    const voicesResponse = await fetch('https://api.elevenlabs.io/v1/voices', { headers, signal: AbortSignal.timeout(20000) });
    const voices = await voicesResponse.json().catch(() => null);
    voiceId = voices?.voices?.[0]?.voice_id;
  }
  if (!voiceId) throw new Error('ElevenLabs has no available voice. Configure NYONI_ELEVENLABS_VOICE_ID.');
  const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}/with-timestamps?output_format=mp3_44100_128`, {
    method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: prompt.slice(0, 5000), model_id: config.model }), signal: AbortSignal.timeout(120000),
  });
  const body = await response.json().catch(() => null);
  if (!response.ok || !body?.audio_base64) throw new Error(`ElevenLabs rejected the voice generation: ${body?.detail?.message || body?.detail || `HTTP ${response.status}`}`);
  const client = studioClient();
  const path = `${assignment.owner_id}/${assignment.id}/voice.mp3`;
  const { error: uploadError } = await client.storage.from('nyoni-artifacts').upload(path, Buffer.from(body.audio_base64, 'base64'), { contentType: 'audio/mpeg', upsert: true });
  if (uploadError) throw new Error(`Voice upload failed: ${uploadError.message}`);
  const url = client.storage.from('nyoni-artifacts').getPublicUrl(path).data.publicUrl;
  const jobId = await recordJob(assignment, config, null, { text: prompt.slice(0, 5000), voiceId }, 'completed');
  await client.from('generation_jobs').update({ output: { urls: [url], voiceId }, updated_at: new Date().toISOString() }).eq('id', jobId);
  return { status: 'completed', jobId, provider: config.provider, model: config.model, kind: config.kind, contentType: config.contentType, estimatedCostUsd: config.estimatedCostUsd, urls: [url] };
}

export async function submitStudioGeneration(assignment, deliverable) {
  const config = MEDIA_AGENT_CONFIG[assignment.agent_id];
  if (!config) throw new Error(`No Studio generation tool is configured for ${assignment.agent_id}.`);
  if (config.requiresSource && !isHttpUrl(assignment.source_url)) throw new Error(`${config.kind} requires a public image or video source URL.`);
  await enforceBudget(assignment, config);
  const prompt = productionPrompt(assignment, deliverable);
  return config.provider === 'elevenlabs' ? submitElevenLabs(assignment, config, prompt) : submitKie(assignment, config, prompt);
}

function extractUrls(value, urls = new Set()) {
  if (typeof value === 'string') {
    if (isHttpUrl(value)) urls.add(value);
    else { try { extractUrls(JSON.parse(value), urls); } catch {} }
  } else if (Array.isArray(value)) value.forEach((item) => extractUrls(item, urls));
  else if (value && typeof value === 'object') Object.values(value).forEach((item) => extractUrls(item, urls));
  return [...urls];
}

export async function pollStudioGeneration(assignment, job) {
  if (job.status === 'completed') return job;
  const response = await fetch(`${KIE_JOBS_URL}/recordInfo?taskId=${encodeURIComponent(job.providerJobId)}`, {
    headers: { Authorization: `Bearer ${process.env.KIE_API_KEY}` }, cache: 'no-store', signal: AbortSignal.timeout(30000),
  });
  const body = await response.json().catch(() => null);
  if (!response.ok || body?.code !== 200 || !body?.data) throw new Error(body?.msg || `KIE status check failed with HTTP ${response.status}.`);
  const state = body.data.state;
  const status = state === 'success' ? 'completed' : state === 'fail' ? 'failed' : state === 'generating' || state === 'processing' ? 'processing' : 'queued';
  if (status === 'failed') throw new Error(body.data.failMsg || body.data.failCode || 'KIE generation failed.');
  const urls = status === 'completed' ? extractUrls(body.data.resultJson) : [];
  const client = studioClient();
  await client.from('generation_jobs').update({ status, output: status === 'completed' ? { urls, raw: body.data.resultJson } : null, updated_at: new Date().toISOString() }).eq('id', job.jobId);
  return { ...job, status, urls };
}

export async function persistStudioGeneration(assignment, job) {
  if (job.status !== 'completed' || !job.urls?.length) throw new Error('Studio provider completed without a usable media URL.');
  const client = studioClient();
  const media = [];
  for (let index = 0; index < job.urls.length; index += 1) {
    const sourceUrl = job.urls[index];
    const response = await fetch(sourceUrl, { signal: AbortSignal.timeout(120000) });
    if (!response.ok) throw new Error(`Generated media download failed with HTTP ${response.status}.`);
    const buffer = Buffer.from(await response.arrayBuffer());
    const contentType = response.headers.get('content-type') || `${job.contentType}/${job.contentType === 'image' ? 'jpeg' : job.contentType === 'video' ? 'mp4' : 'mpeg'}`;
    const extension = contentType.includes('webp') ? 'webp' : contentType.includes('png') ? 'png' : contentType.includes('video') ? 'mp4' : contentType.includes('audio') ? 'mp3' : 'jpg';
    const path = `${assignment.owner_id}/${assignment.id}/${job.kind}-${index + 1}.${extension}`;
    const { error: uploadError } = await client.storage.from('nyoni-artifacts').upload(path, buffer, { contentType, upsert: true });
    if (uploadError) throw new Error(`Generated media upload failed: ${uploadError.message}`);
    const url = client.storage.from('nyoni-artifacts').getPublicUrl(path).data.publicUrl;
    const { data: asset, error: assetError } = await client.from('assets').insert({
      user_id: assignment.owner_id, project_id: assignment.project_id, type: job.contentType, url, storage_path: path,
      provider: job.provider, model: job.model, prompt: assignment.title, metadata: { assignmentId: assignment.id, agentId: assignment.agent_id, kind: job.kind, providerUrl: sourceUrl },
    }).select('id').single();
    if (assetError) throw new Error(`Media asset record failed: ${assetError.message}`);
    media.push({ url, assetId: asset.id, type: job.contentType, kind: job.kind, provider: job.provider, model: job.model });
  }
  const { data: toolRun, error: runError } = await client.from('nyoni_tool_runs').insert({
    assignment_id: assignment.id, owner_id: assignment.owner_id, tool_name: job.kind, provider: job.provider, status: 'done',
    idempotency_key: `${assignment.id}:${job.kind}`, input: { prompt: assignment.title, sourceUrl: assignment.source_url || null },
    output: { media, generationJobId: job.jobId }, cost_usd: job.estimatedCostUsd, completed_at: new Date().toISOString(),
  }).select('id').single();
  if (runError) throw new Error(`Media tool run record failed: ${runError.message}`);
  await client.from('nyoni_usage_ledger').insert({ owner_id: assignment.owner_id, project_id: assignment.project_id, assignment_id: assignment.id, tool_run_id: toolRun.id, provider: job.provider, model: job.model, units: { generations: 1 }, cost_usd: job.estimatedCostUsd });
  return { media, totalCostUsd: job.estimatedCostUsd, provider: job.provider, model: job.model, kind: job.kind };
}
