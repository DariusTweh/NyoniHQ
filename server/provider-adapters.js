export class ProviderCompatibilityError extends Error {
  constructor(message, details = {}) { super(message); this.name = 'ProviderCompatibilityError'; this.code = 'PROVIDER_INCOMPATIBLE'; this.details = details; }
}

const KIE_SEEDANCE_RATES = {
  '480p': { withoutVideo: 0.140, withVideo: 0.085 },
  '720p': { withoutVideo: 0.315, withVideo: 0.190 },
  '1080p': { withoutVideo: 0.790, withVideo: 0.475 },
};

const WAVESPEED_H3_RATES = { '480p': 0.05, '540p': 0.075, '768p': 0.10, '1080p': 0.20, '2k': 0.14 };

function refs(packet, kind) { return packet.references.filter((item) => kind(item)); }
function uniqueUrls(items) { return [...new Set(items.map((item) => item.url).filter(Boolean))]; }

function validateDuration(duration, min, max, model) {
  if (!Number.isInteger(duration) || duration < min || duration > max) throw new ProviderCompatibilityError(`${model} requires a whole-second duration from ${min} to ${max}.`, { duration, min, max });
}

export function estimateProviderCost(packet, { referenceVideoSeconds = 0 } = {}) {
  const { provider, model, resolution, durationSeconds } = packet.generation;
  if (provider === 'kie' && model === 'bytedance/seedance-2-5') {
    const rate = KIE_SEEDANCE_RATES[resolution];
    if (!rate) throw new ProviderCompatibilityError(`KIE Seedance 2.5 does not support ${resolution}.`, { supported: Object.keys(KIE_SEEDANCE_RATES) });
    const withVideo = referenceVideoSeconds > 0;
    return { estimatedUsd: Number(((durationSeconds + (withVideo ? referenceVideoSeconds : 0)) * (withVideo ? rate.withVideo : rate.withoutVideo)).toFixed(6)), pricingUnit: 'second', rateUsd: withVideo ? rate.withVideo : rate.withoutVideo, rateBasis: withVideo ? 'input_plus_output_video_seconds' : 'output_seconds', priceVersion: 'kie-seedance-2.5-2026-10' };
  }
  if (provider === 'wavespeed' && /minimax-h3/.test(model)) {
    const normalized = resolution === '2K' ? '2k' : resolution;
    const rate = WAVESPEED_H3_RATES[normalized];
    if (!rate) throw new ProviderCompatibilityError(`WaveSpeed MiniMax H3 does not support ${resolution}.`, { supported: Object.keys(WAVESPEED_H3_RATES) });
    const referenceImageCount = packet.references.filter((item) => item.url).length;
    const extraReferenceCost = model.includes('reference-to-video') ? Math.max(0, referenceImageCount - 5) * 0.05 : 0;
    return { estimatedUsd: Number((durationSeconds * rate + referenceVideoSeconds * rate + extraReferenceCost).toFixed(6)), pricingUnit: 'second', rateUsd: rate, rateBasis: 'output_plus_reference_video_seconds', priceVersion: 'wavespeed-h3-2026-11' };
  }
  throw new ProviderCompatibilityError(`No verified price adapter exists for ${provider}/${model}.`);
}

export function buildKieSeedanceRequest(packet, { referenceVideoUrls = [], referenceAudioUrls = [], sourceVideoUrl = null } = {}) {
  const { mode, durationSeconds, resolution, aspectRatio, generateAudio, returnLastFrame } = packet.generation;
  validateDuration(durationSeconds, 4, 30, 'KIE Seedance 2.5');
  if (!['480p', '720p', '1080p'].includes(resolution)) throw new ProviderCompatibilityError(`KIE Seedance 2.5 does not support ${resolution}.`, { supported: ['480p','720p','1080p'] });
  const imageUrls = uniqueUrls(packet.references);
  const base = { prompt: packet.motionPrompt, generate_audio: generateAudio, return_last_frame: returnLastFrame, resolution, aspect_ratio: aspectRatio, duration: durationSeconds, output_format: 'mp4', nsfw_checker: true };
  if (mode === 'text-to-video') {
    if (imageUrls.length || referenceVideoUrls.length || referenceAudioUrls.length) throw new ProviderCompatibilityError('Text-to-video cannot silently discard assigned references. Choose reference-to-video or remove the references.', { imageReferences: imageUrls.length });
    return { provider: 'kie', model: 'bytedance/seedance-2-5', input: base };
  }
  if (mode === 'image-to-video') {
    const firstFrame = refs(packet, (item) => ['previous_frame','camera_setup','scene_reference'].includes(item.role))[0] || packet.references[0];
    if (!firstFrame) throw new ProviderCompatibilityError('Image-to-video requires an explicit first-frame reference.');
    const criticalOthers = packet.references.filter((item) => item.id !== firstFrame.id && item.priority === 'critical');
    if (criticalOthers.length) throw new ProviderCompatibilityError('First-frame mode cannot carry the additional critical references. Choose reference-to-video instead.', { firstFrameId: firstFrame.id, incompatibleReferenceIds: criticalOthers.map((item) => item.id) });
    return { provider: 'kie', model: 'bytedance/seedance-2-5', input: { ...base, first_frame_url: firstFrame.url } };
  }
  if (mode === 'reference-to-video' || mode === 'video-edit') {
    const videos = uniqueUrls([...(sourceVideoUrl ? [{ url: sourceVideoUrl }] : []), ...referenceVideoUrls.map((url) => ({ url }))]);
    if (!imageUrls.length && !videos.length) throw new ProviderCompatibilityError('Reference/video-edit mode requires at least one image or video reference.');
    if (imageUrls.length > 30 || videos.length > 10 || referenceAudioUrls.length > 10) throw new ProviderCompatibilityError('KIE Seedance reference limits were exceeded.', { imageLimit: 30, videoLimit: 10, audioLimit: 10 });
    return { provider: 'kie', model: 'bytedance/seedance-2-5', input: { ...base, reference_image_urls: imageUrls, reference_video_urls: videos, reference_audio_urls: [...new Set(referenceAudioUrls)], omni_reference_task_type: mode === 'video-edit' ? 'edit' : 'reference' } };
  }
  throw new ProviderCompatibilityError(`KIE Seedance does not implement generation mode ${mode}.`);
}

export function buildWaveSpeedH3Request(packet, { referenceVideoUrls = [], referenceAudioUrls = [], firstFrameUrl = null } = {}) {
  const { mode, durationSeconds, resolution, aspectRatio } = packet.generation;
  validateDuration(durationSeconds, mode === 'reference-to-video' ? 4 : 3, 15, 'WaveSpeed MiniMax H3');
  const imageUrls = uniqueUrls(packet.references);
  if (mode === 'text-to-video') {
    if (imageUrls.length) throw new ProviderCompatibilityError('WaveSpeed H3 text-to-video cannot discard packet references. Choose reference-to-video.');
    return { provider: 'wavespeed', model: 'minimax/h3/text-to-video', endpoint: 'https://api.wavespeed.ai/api/v3/minimax/h3/text-to-video', input: { prompt: packet.motionPrompt, aspect_ratio: aspectRatio, resolution: resolution === '2K' ? '2k' : resolution, duration: durationSeconds } };
  }
  if (mode === 'image-to-video') {
    const image = firstFrameUrl || imageUrls[0];
    if (!image) throw new ProviderCompatibilityError('WaveSpeed H3 image-to-video requires a first-frame image.');
    if (imageUrls.length > 1) throw new ProviderCompatibilityError('H3 image-to-video accepts a first frame, not multiple identity references. Choose reference-to-video.', { referenceCount: imageUrls.length });
    return { provider: 'wavespeed', model: 'minimax/h3/image-to-video', endpoint: 'https://api.wavespeed.ai/api/v3/minimax/h3/image-to-video', input: { prompt: packet.motionPrompt, image, resolution: resolution === '2K' ? '2k' : resolution, duration: durationSeconds } };
  }
  if (mode === 'reference-to-video') {
    if (!imageUrls.length && !referenceVideoUrls.length) throw new ProviderCompatibilityError('WaveSpeed H3 reference-to-video requires at least one image or video reference.');
    if (imageUrls.length > 9 || referenceVideoUrls.length > 3 || referenceAudioUrls.length > 3) throw new ProviderCompatibilityError('WaveSpeed H3 reference limits were exceeded.', { imageLimit: 9, videoLimit: 3, audioLimit: 3 });
    return { provider: 'wavespeed', model: 'minimax/h3/reference-to-video', endpoint: 'https://api.wavespeed.ai/api/v3/minimax/h3/reference-to-video', input: { prompt: packet.motionPrompt, reference_images: imageUrls, reference_videos: [...new Set(referenceVideoUrls)], reference_audios: [...new Set(referenceAudioUrls)], aspect_ratio: aspectRatio, resolution: resolution === '2K' ? '2k' : resolution, duration: durationSeconds } };
  }
  throw new ProviderCompatibilityError(`WaveSpeed H3 does not implement generation mode ${mode}.`);
}

export function buildProviderRequest(packet, options = {}) {
  if (packet.generation.provider === 'kie' && packet.generation.model === 'bytedance/seedance-2-5') return buildKieSeedanceRequest(packet, options);
  if (packet.generation.provider === 'wavespeed' && /minimax-h3/.test(packet.generation.model)) return buildWaveSpeedH3Request(packet, options);
  throw new ProviderCompatibilityError(`No validated provider adapter exists for ${packet.generation.provider}/${packet.generation.model}.`);
}

