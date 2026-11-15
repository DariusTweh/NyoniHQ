import { requiredMediaState } from './production-contracts.js';

function observation(code, severity, message, evidence = {}, confidence = 1) {
  return { code, severity, message, evidence, confidence };
}

function normalizeResolution(value) { return String(value || '').toLowerCase().replace('k', 'k'); }

export function evaluateProductionQuality({ packet, media = [], technical = {}, subjectiveObservations = [], stage = 'preliminary' }) {
  const observations = [];
  const required = requiredMediaState(packet, media);
  for (const missing of required.missing) observations.push(observation('DELIVERABLE_MISSING', 'consequential', `Required ${missing.type} deliverable is missing: ${missing.label}.`, { deliverableId: missing.id }));

  const finalVideo = media.find((item) => item.type === 'video' && item.url);
  if (finalVideo) {
    const actualResolution = technical.resolution || finalVideo.resolution;
    const actualAspectRatio = technical.aspectRatio || finalVideo.aspectRatio;
    const actualDuration = Number(technical.durationSeconds || finalVideo.durationSeconds || 0);
    if (actualResolution && normalizeResolution(actualResolution) !== normalizeResolution(packet.generation.resolution)) observations.push(observation('RESOLUTION_MISMATCH', 'consequential', `Expected ${packet.generation.resolution}, received ${actualResolution}.`, { expected: packet.generation.resolution, actual: actualResolution }));
    if (actualAspectRatio && actualAspectRatio !== packet.generation.aspectRatio) observations.push(observation('ASPECT_RATIO_MISMATCH', 'consequential', `Expected ${packet.generation.aspectRatio}, received ${actualAspectRatio}.`, { expected: packet.generation.aspectRatio, actual: actualAspectRatio }));
    if (actualDuration && Math.abs(actualDuration - packet.generation.durationSeconds) > 0.75) observations.push(observation('DURATION_MISMATCH', 'repairable', `Expected approximately ${packet.generation.durationSeconds}s, received ${actualDuration}s.`, { expected: packet.generation.durationSeconds, actual: actualDuration }));
  }

  const submittedReferenceIds = new Set(technical.submittedReferenceIds || []);
  for (const reference of packet.references.filter((item) => item.priority === 'critical')) {
    if (submittedReferenceIds.size && !submittedReferenceIds.has(reference.id)) observations.push(observation('CRITICAL_REFERENCE_NOT_SUBMITTED', 'consequential', `Critical reference ${reference.label} was not present in the submitted provider manifest.`, { referenceId: reference.id }));
  }
  if (packet.voicePolicy.mode === 'approved-human-master' && technical.syntheticVoiceUsed) observations.push(observation('VOICE_POLICY_VIOLATION', 'consequential', 'Synthetic voice was used where approved human voice masters are required.', {}));

  for (const item of subjectiveObservations) observations.push({
    code: item.code || 'SUBJECTIVE_REVIEW', severity: item.severity || 'ambiguous',
    message: item.message || String(item), evidence: item.evidence || {}, confidence: Number(item.confidence ?? 0.5),
  });
  const consequential = observations.some((item) => item.severity === 'consequential');
  const ambiguous = observations.some((item) => item.severity === 'ambiguous' || item.confidence < 0.75);
  const repairable = observations.some((item) => item.severity === 'repairable');
  const disposition = consequential || repairable ? 'FIX' : ambiguous ? 'ESCALATE' : 'PASS';
  return {
    stage, disposition, observations,
    measurements: { expected: { resolution: packet.generation.resolution, aspectRatio: packet.generation.aspectRatio, durationSeconds: packet.generation.durationSeconds }, actual: technical },
    canFinish: stage === 'preliminary' && disposition === 'PASS',
    canFounderReview: stage === 'final_technical' && disposition === 'PASS' && required.complete,
    reliabilityNote: 'Automated subjective visual assessment is advisory. Ambiguous or consequential observations require escalation or repair.',
  };
}

export function boundedRepairDecision(review, attempt, maxAttempts = 2) {
  if (review.disposition === 'PASS') return { action: 'continue', attempt, maxAttempts };
  if (review.disposition === 'ESCALATE') return { action: 'escalate', attempt, maxAttempts };
  if (attempt >= maxAttempts) return { action: 'escalate', attempt, maxAttempts, reason: 'Repair attempt limit reached.' };
  return { action: 'repair', attempt: attempt + 1, maxAttempts };
}

