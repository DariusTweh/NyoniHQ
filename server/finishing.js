const UPSCALE_RATES = { '720p': 0.005, '1080p': 0.005, '2k': 0.01, '4k': 0.02 };

export function buildPrismVideoUpscale({ videoUrl, durationSeconds, targetResolution, preliminaryReview, remainingBudgetUsd }) {
  if (preliminaryReview?.disposition !== 'PASS') throw new Error('Prism cannot spend upscaling credits before preliminary QA passes.');
  if (!videoUrl) throw new Error('Prism video finishing requires a persisted source video URL.');
  const normalized = String(targetResolution || '').toLowerCase();
  const rate = UPSCALE_RATES[normalized];
  if (!rate) throw new Error(`Prism video upscaling does not support ${targetResolution}.`);
  const billedSeconds = Math.max(3, Math.ceil(Number(durationSeconds || 0)));
  const estimatedCostUsd = Number((billedSeconds * rate).toFixed(6));
  if (estimatedCostUsd > Number(remainingBudgetUsd || 0)) throw new Error(`Prism finishing needs $${estimatedCostUsd.toFixed(2)}, exceeding the remaining $${Number(remainingBudgetUsd || 0).toFixed(2)} budget.`);
  return {
    provider: 'wavespeed', model: 'wavespeed-ai/video-upscaler',
    endpoint: 'https://api.wavespeed.ai/api/v3/wavespeed-ai/video-upscaler',
    input: { video: videoUrl, target_resolution: normalized },
    estimatedCostUsd, pricing: { rateUsdPerSecond: rate, billedSeconds, priceVersion: 'wavespeed-video-upscaler-2026-11' },
    preserveOriginal: true,
  };
}

export function assertDeliveredResolution(requested, delivered) {
  if (String(requested).toLowerCase() !== String(delivered).toLowerCase()) throw new Error(`Requested ${requested}, but the persisted export is ${delivered}. The lower-resolution asset cannot be labeled ${requested}.`);
  return true;
}

