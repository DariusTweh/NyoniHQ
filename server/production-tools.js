import { studioClient } from './nyoni-store.js';
import { buildProviderRequest, estimateProviderCost } from './provider-adapters.js';
import { buildPrismVideoUpscale } from './finishing.js';

const KIE_JOBS_URL = 'https://api.kie.ai/api/v1/jobs';
const WAVESPEED_PREDICTIONS_URL = 'https://api.wavespeed.ai/api/v3/predictions';

export const MEDIA_AGENT_CONFIG = {
  lumina: { provider: 'kie', model: 'gpt-image-2-5-flare-text-to-image', kind: 'text-to-image', contentType: 'image', estimatedCostUsd: 0.08 },
  reframe: { provider: 'kie', model: 'gpt-image-2-5-sunburst-image-to-image', kind: 'image-to-image', contentType: 'image', estimatedCostUsd: 0.20, requiresSource: true },
  nova: { provider: 'kie', model: 'bytedance/seedance-2-5', kind: 'text-to-video', contentType: 'video', estimatedCostUsd: 0.70 },
  kinetic: { provider: 'kie', model: 'bytedance/seedance-2-5', kind: 'image-to-video', contentType: 'video', estimatedCostUsd: 0.70, requiresSource: true },
  cutline: { provider: 'kie', model: 'bytedance/seedance-2-5', kind: 'video-edit', contentType: 'video', estimatedCostUsd: 0.70, requiresSource: true },
  sonora: { provider: 'kie', model: 'ai-music-api/generate', kind: 'text-to-music', contentType: 'audio', estimatedCostUsd: 0.25 },
  vox: { provider: 'elevenlabs', model: 'eleven_v3', kind: 'text-to-speech', contentType: 'audio', estimatedCostUsd: 0.10 },
  rally: { provider: 'kie', model: 'nano-banana-2', kind: 'campaign-visual', contentType: 'image', estimatedCostUsd: 0.20 },
};

export function isMediaAgent(agentId) { return Boolean(MEDIA_AGENT_CONFIG[agentId]); }

function isHttpUrl(value) {
  try { return ['http:', 'https:'].includes(new URL(value).protocol); } catch { return false; }
}

function productionPrompt(assignment, deliverable) {
  return `${assignment.title}\n\nCreative direction from the Nyoni specialist:\n${deliverable}`.slice(0, 9000);
}

function legacyKieInput(config, assignment, prompt) {
  const sourceUrl = assignment.source_url;
  if (config.kind === 'text-to-image') return { prompt, aspect_ratio: '1:1', resolution: '1K' };
  if (config.kind === 'image-to-image') return { prompt, input_urls: [sourceUrl], aspect_ratio: '1:1', resolution: '1K' };
  if (config.kind === 'text-to-video') return { prompt, generate_audio: true, return_last_frame: true, resolution: '480p', aspect_ratio: '9:16', duration: 5 };
  if (config.kind === 'image-to-video') return { prompt, first_frame_url: sourceUrl, generate_audio: true, return_last_frame: true, resolution: '480p', aspect_ratio: '9:16', duration: 5 };
  if (config.kind === 'video-edit') return { prompt, reference_video_urls: [sourceUrl], omni_reference_task_type: 'edit', generate_audio: true, resolution: '480p', aspect_ratio: 'adaptive', duration: -1 };
  if (config.kind === 'text-to-music') return { custom_mode: true, instrumental: true, model: 'V6_MINI', title: assignment.title.slice(0, 80), style: prompt.slice(0, 1000), duration: Math.max(10, Math.min(360, Number(assignment.request?.production?.durationSeconds || 10))), variety: 1 };
  return { prompt, image_input: sourceUrl ? [sourceUrl] : [], aspect_ratio: '4:5', resolution: '1K', output_format: 'jpg' };
}

async function reserveBudget(assignment, config, estimatedCostUsd, idempotencyKey, productionJobId = null) {
  const client = studioClient();
  const { data, error } = await client.rpc('nyoni_reserve_generation_budget', {
    p_owner_id: assignment.owner_id, p_project_id: assignment.project_id, p_assignment_id: assignment.id,
    p_production_job_id: productionJobId, p_provider: config.provider, p_model: config.model,
    p_amount_usd: estimatedCostUsd, p_idempotency_key: idempotencyKey,
  });
  if (error) throw new Error(`Budget reservation failed: ${error.message}`);
  return data;
}

async function setReservationState(reservationId, state, actualCostUsd = null) {
  if (!reservationId) return;
  const client = studioClient();
  const patch = { state, updated_at: new Date().toISOString(), ...(actualCostUsd === null ? {} : { actual_cost_usd: actualCostUsd }) };
  const { error } = await client.from('nyoni_budget_reservations').update(patch).eq('id', reservationId).eq('state', 'reserved');
  if (error) throw new Error(`Budget reservation update failed: ${error.message}`);
}

async function recordJob(assignment, config, providerJobId, input, status = 'queued', packet = null) {
  const client = studioClient();
  const { data, error } = await client.from('generation_jobs').insert({
    user_id: assignment.owner_id, project_id: assignment.project_id, provider: config.provider, model: config.model,
    type: config.kind, provider_job_id: providerJobId || null, status,
    reference_snapshot: packet ? { packetId: packet.packetId, packetVersion: packet.packetVersion, references: packet.references.map((item, index) => ({ position: index + 1, id: item.id, assetId: item.assetId || null, role: item.role, priority: item.priority, url: item.url })) } : null,
    input: { ...input, assignmentId: assignment.id, agentId: assignment.agent_id, productionPacketId: packet?.packetId || null, source: 'nyoni-hq' },
  }).select('id').single();
  if (error) throw new Error(`Studio generation record failed: ${error.message}`);
  return data.id;
}

async function submitKie(assignment, config, input, estimatedCostUsd, packet = null) {
  if (!process.env.KIE_API_KEY) throw new Error('KIE_API_KEY is not connected.');
  const response = await fetch(`${KIE_JOBS_URL}/createTask`, {
    method: 'POST', headers: { Authorization: `Bearer ${process.env.KIE_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: config.model, input }), signal: AbortSignal.timeout(30000),
  });
  const body = await response.json().catch(() => null);
  const providerJobId = body?.data?.taskId || body?.data?.task_id;
  if (!response.ok || body?.code !== 200 || !providerJobId) throw new Error(`KIE rejected ${config.kind}: ${body?.msg || `HTTP ${response.status}`}`);
  const jobId = await recordJob(assignment, config, providerJobId, input, 'queued', packet);
  return { status: 'queued', providerJobId, jobId, provider: config.provider, model: config.model, kind: config.kind, contentType: config.contentType, estimatedCostUsd };
}

async function submitWaveSpeed(assignment, config, endpoint, input, estimatedCostUsd, packet) {
  if (!process.env.WAVESPEED_API_KEY) throw new Error('WAVESPEED_API_KEY is not connected.');
  const response = await fetch(endpoint, {
    method: 'POST', headers: { Authorization: `Bearer ${process.env.WAVESPEED_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(input), signal: AbortSignal.timeout(30000),
  });
  const body = await response.json().catch(() => null); const result = body?.data || body;
  const providerJobId = result?.id;
  if (!response.ok || !providerJobId) throw new Error(`WaveSpeed rejected ${config.kind}: ${result?.error || body?.message || `HTTP ${response.status}`}`);
  const status = result.status === 'completed' ? 'completed' : 'queued';
  const jobId = await recordJob(assignment, config, providerJobId, input, status, packet);
  return { status, providerJobId, jobId, provider: config.provider, model: config.model, kind: config.kind, contentType: config.contentType, estimatedCostUsd, urls: status === 'completed' ? extractUrls(result.outputs) : [] };
}

export function authorizedVoiceId(assignment, packet) {
  if (packet?.voicePolicy?.mode === 'approved-human-master') throw new Error('This production requires approved human voice masters; automatic ElevenLabs dialogue is not authorized.');
  return packet?.voicePolicy?.voiceProfileId || assignment.request?.voiceProfileId || process.env.NYONI_ELEVENLABS_VOICE_ID || null;
}

export async function submitPrismFinishing(assignment, { packet, video, preliminaryReview, targetResolution, remainingBudgetUsd, dryRun = false, productionJobId = null }) {
  const request = buildPrismVideoUpscale({
    videoUrl: video?.url, durationSeconds: video?.durationSeconds || packet.generation.durationSeconds,
    targetResolution, preliminaryReview, remainingBudgetUsd,
  });
  const config = { provider: request.provider, model: request.model, kind: 'video-upscale', contentType: 'video' };
  if (dryRun) return { status: 'dry_run', ...request, kind: config.kind, contentType: config.contentType };
  const idempotencyKey = `${assignment.id}:prism:${targetResolution}:${packet.packetVersion}`;
  const reservation = await reserveBudget(assignment, config, request.estimatedCostUsd, idempotencyKey, productionJobId);
  try {
    const job = await submitWaveSpeed(assignment, config, request.endpoint, request.input, request.estimatedCostUsd, packet);
    return { ...job, reservationId: reservation.id, priceVersion: request.pricing.priceVersion, productionPacketId: packet.packetId, originalAssetId: video.assetId, targetResolution };
  } catch (error) {
    await setReservationState(reservation.id, 'released').catch(() => {}); throw error;
  }
}

async function submitElevenLabs(assignment, config, prompt, packet = null) {
  if (!process.env.ELEVENLABS_API_KEY) throw new Error('ELEVENLABS_API_KEY is not connected.');
  const voiceId = authorizedVoiceId(assignment, packet);
  if (!voiceId) throw new Error('Voice generation needs an explicitly bound ElevenLabs voice ID. Automatic first-voice selection is disabled.');
  const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}/with-timestamps?output_format=mp3_44100_128`, {
    method: 'POST', headers: { 'xi-api-key': process.env.ELEVENLABS_API_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: prompt.slice(0, 5000), model_id: config.model }), signal: AbortSignal.timeout(120000),
  });
  const body = await response.json().catch(() => null);
  if (!response.ok || !body?.audio_base64) throw new Error(`ElevenLabs rejected the voice generation: ${body?.detail?.message || body?.detail || `HTTP ${response.status}`}`);
  const client = studioClient(); const path = `${assignment.owner_id}/${assignment.id}/voice.mp3`;
  const { error: uploadError } = await client.storage.from('nyoni-artifacts').upload(path, Buffer.from(body.audio_base64, 'base64'), { contentType: 'audio/mpeg', upsert: true });
  if (uploadError) throw new Error(`Voice upload failed: ${uploadError.message}`);
  const url = client.storage.from('nyoni-artifacts').getPublicUrl(path).data.publicUrl;
  const jobId = await recordJob(assignment, config, null, { text: prompt.slice(0, 5000), voiceId }, 'completed', packet);
  await client.from('generation_jobs').update({ output: { urls: [url], voiceId }, updated_at: new Date().toISOString() }).eq('id', jobId);
  return { status: 'completed', jobId, provider: config.provider, model: config.model, kind: config.kind, contentType: config.contentType, estimatedCostUsd: config.estimatedCostUsd, urls: [url] };
}

async function findReusableCompletedJob(assignment, config, packet, reservationId, estimate) {
  const client = studioClient();
  let query = client.from('generation_jobs').select('id,provider_job_id,output,input,updated_at')
    .eq('user_id', assignment.owner_id).eq('project_id', assignment.project_id)
    .eq('provider', config.provider).eq('model', config.model).eq('type', config.kind).eq('status', 'completed')
    .contains('input', { assignmentId: assignment.id, agentId: assignment.agent_id })
    .order('updated_at', { ascending: false }).limit(1);
  const { data, error } = await query.maybeSingle();
  if (error) throw new Error(`Completed generation lookup failed: ${error.message}`);
  if (!data || (packet && data.input?.productionPacketId !== packet.packetId)) return null;
  const urls = selectContentUrls(extractUrls(data.output?.urls || data.output), config.contentType);
  if (!urls.length) return null;
  return {
    status: 'completed', providerJobId: data.provider_job_id, jobId: data.id,
    provider: config.provider, model: config.model, kind: config.kind, contentType: config.contentType,
    estimatedCostUsd: estimate.estimatedUsd, reservationId, priceVersion: estimate.priceVersion,
    productionPacketId: packet?.packetId || null, urls, reusedCompletedJob: true,
  };
}

export async function submitStudioGeneration(assignment, deliverable, options = {}) {
  const baseConfig = MEDIA_AGENT_CONFIG[assignment.agent_id];
  if (!baseConfig) throw new Error(`No Studio generation tool is configured for ${assignment.agent_id}.`);
  const packet = options.packet || null; let config = { ...baseConfig }; let input; let endpoint = null;
  let estimate = { estimatedUsd: config.estimatedCostUsd, priceVersion: 'legacy-agent-config' };
  if (packet && config.contentType === 'video') {
    const request = buildProviderRequest(packet, options.providerInputs || {});
    config = { ...config, provider: request.provider, model: request.model, kind: packet.generation.mode };
    input = request.input; endpoint = request.endpoint || null;
    estimate = estimateProviderCost(packet, { referenceVideoSeconds: options.providerInputs?.referenceVideoSeconds || 0 });
  } else {
    if (config.requiresSource && !isHttpUrl(assignment.source_url)) throw new Error(`${config.kind} requires a public image or video source URL.`);
    input = legacyKieInput(config, assignment, productionPrompt(assignment, deliverable));
  }
  if (options.dryRun) return { status: 'dry_run', provider: config.provider, model: config.model, kind: config.kind, contentType: config.contentType, estimatedCostUsd: estimate.estimatedUsd, priceVersion: estimate.priceVersion, input };
  const idempotencyKey = options.idempotencyKey || `${assignment.id}:${config.kind}:${packet?.packetVersion || 1}`;
  const reservation = await reserveBudget(assignment, config, estimate.estimatedUsd, idempotencyKey, options.productionJobId || null);
  try {
    const reusable = await findReusableCompletedJob(assignment, config, packet, reservation.id, estimate);
    if (reusable) return reusable;
    const prompt = packet?.motionPrompt || productionPrompt(assignment, deliverable);
    const job = config.provider === 'elevenlabs'
      ? await submitElevenLabs(assignment, config, prompt, packet)
      : config.provider === 'wavespeed'
        ? await submitWaveSpeed(assignment, config, endpoint, input, estimate.estimatedUsd, packet)
        : await submitKie(assignment, config, input, estimate.estimatedUsd, packet);
    return { ...job, reservationId: reservation.id, priceVersion: estimate.priceVersion, productionPacketId: packet?.packetId || null };
  } catch (error) {
    await setReservationState(reservation.id, 'released').catch(() => {}); throw error;
  }
}

function extractUrls(value, urls = new Set()) {
  if (typeof value === 'string') {
    if (isHttpUrl(value)) urls.add(value); else { try { extractUrls(JSON.parse(value), urls); } catch {} }
  } else if (Array.isArray(value)) value.forEach((item) => extractUrls(item, urls));
  else if (value && typeof value === 'object') Object.values(value).forEach((item) => extractUrls(item, urls));
  return [...urls];
}

export function selectContentUrls(urls, contentType) {
  const unique = [...new Set((urls || []).filter((value) => typeof value === 'string'))];
  const matches = unique.filter((value) => {
    let path = '';
    try { path = new URL(value).pathname.toLowerCase(); } catch { return false; }
    if (contentType === 'audio') return /\.(mp3|wav|aac|m4a|ogg|flac)$/.test(path);
    if (contentType === 'video') return /\.(mp4|mov|webm|m4v)$/.test(path);
    if (contentType === 'image') return /\.(jpe?g|png|webp|gif|avif)$/.test(path);
    return true;
  });
  if (contentType === 'audio' || contentType === 'video') return matches.slice(0, 1);
  return matches;
}

export async function pollStudioGeneration(assignment, job) {
  if (job.status === 'completed') return job;
  let status; let urls = [];
  if (job.provider === 'wavespeed') {
    const response = await fetch(`${WAVESPEED_PREDICTIONS_URL}/${encodeURIComponent(job.providerJobId)}/result`, { headers: { Authorization: `Bearer ${process.env.WAVESPEED_API_KEY}` }, cache: 'no-store', signal: AbortSignal.timeout(30000) });
    const body = await response.json().catch(() => null); const result = body?.data || body;
    if (!response.ok || !result) throw new Error(result?.error || body?.message || `WaveSpeed status check failed with HTTP ${response.status}.`);
    if (['failed','cancelled','timeout','deleted'].includes(result.status)) throw new Error(result.error || `WaveSpeed generation ended with ${result.status}.`);
    status = result.status === 'completed' ? 'completed' : result.status === 'processing' ? 'processing' : 'queued';
    urls = status === 'completed' ? selectContentUrls(extractUrls(result.outputs), job.contentType) : [];
  } else {
    const response = await fetch(`${KIE_JOBS_URL}/recordInfo?taskId=${encodeURIComponent(job.providerJobId)}`, { headers: { Authorization: `Bearer ${process.env.KIE_API_KEY}` }, cache: 'no-store', signal: AbortSignal.timeout(30000) });
    const body = await response.json().catch(() => null);
    if (!response.ok || body?.code !== 200 || !body?.data) throw new Error(body?.msg || `KIE status check failed with HTTP ${response.status}.`);
    const state = body.data.state;
    status = state === 'success' ? 'completed' : state === 'fail' ? 'failed' : state === 'generating' || state === 'processing' ? 'processing' : 'queued';
    if (status === 'failed') throw new Error(body.data.failMsg || body.data.failCode || 'KIE generation failed.');
    urls = status === 'completed' ? selectContentUrls(extractUrls(body.data.resultJson), job.contentType) : [];
  }
  const client = studioClient();
  await client.from('generation_jobs').update({ status, output: status === 'completed' ? { urls } : null, updated_at: new Date().toISOString() }).eq('id', job.jobId);
  return { ...job, status, urls };
}

export async function persistStudioGeneration(assignment, job) {
  if (job.status !== 'completed' || !job.urls?.length) throw new Error('Studio provider completed without a usable media URL.');
  const client = studioClient(); const media = [];
  for (let index = 0; index < job.urls.length; index += 1) {
    const response = await fetch(job.urls[index], { signal: AbortSignal.timeout(120000) });
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
      provider: job.provider, model: job.model, prompt: assignment.title, metadata: { assignmentId: assignment.id, agentId: assignment.agent_id, kind: job.kind, generationJobId: job.jobId },
    }).select('id').single();
    if (assetError) throw new Error(`Media asset record failed: ${assetError.message}`);
    media.push({ url, assetId: asset.id, type: job.contentType, kind: job.kind, provider: job.provider, model: job.model, playable: job.contentType === 'video' || job.contentType === 'audio' });
  }
  const { data: toolRun, error: runError } = await client.from('nyoni_tool_runs').insert({
    assignment_id: assignment.id, owner_id: assignment.owner_id, tool_name: job.kind, provider: job.provider, status: 'done',
    idempotency_key: `${assignment.id}:${job.kind}:${job.jobId}`, input: { productionPacketId: job.productionPacketId || null, sourceAssetId: assignment.request?.sourceAssetId || null },
    output: { media, generationJobId: job.jobId }, cost_usd: job.estimatedCostUsd, completed_at: new Date().toISOString(),
  }).select('id').single();
  if (runError) throw new Error(`Media tool run record failed: ${runError.message}`);
  await client.from('nyoni_usage_ledger').insert({ owner_id: assignment.owner_id, project_id: assignment.project_id, assignment_id: assignment.id, tool_run_id: toolRun.id, provider: job.provider, model: job.model, units: { generations: 1 }, cost_usd: job.estimatedCostUsd });
  await setReservationState(job.reservationId, 'captured', job.estimatedCostUsd);
  return { media, totalCostUsd: job.estimatedCostUsd, provider: job.provider, model: job.model, kind: job.kind };
}

