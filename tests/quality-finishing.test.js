import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateProductionQuality, boundedRepairDecision } from '../server/quality-control.js';
import { assertDeliveredResolution, buildPrismVideoUpscale } from '../server/finishing.js';

const packet = {
  generation: { resolution: '720p', aspectRatio: '16:9', durationSeconds: 5 },
  expectedDeliverables: [{ id: 'final-video', type: 'video', required: true, playable: true, label: 'Final video' }],
  references: [{ id: 'hero', label: 'Hero identity', priority: 'critical' }],
  voicePolicy: { mode: 'approved-human-master' },
};

test('Pulse returns FIX when required finished media is missing', () => {
  const review = evaluateProductionQuality({ packet, media: [], technical: {}, stage: 'preliminary' });
  assert.equal(review.disposition, 'FIX');
  assert.equal(review.canFinish, false);
});

test('Pulse passes technically matching playable media and flags voice violations', () => {
  const media = [{ type: 'video', url: 'https://assets.example.test/final.mp4', playable: true }];
  const pass = evaluateProductionQuality({ packet, media, technical: { resolution: '720p', aspectRatio: '16:9', durationSeconds: 5, submittedReferenceIds: ['hero'] }, stage: 'final_technical' });
  assert.equal(pass.disposition, 'PASS'); assert.equal(pass.canFounderReview, true);
  const fail = evaluateProductionQuality({ packet, media, technical: { syntheticVoiceUsed: true, submittedReferenceIds: ['hero'] } });
  assert(fail.observations.some((item) => item.code === 'VOICE_POLICY_VIOLATION'));
});

test('repairs are bounded and ambiguous subjective review escalates', () => {
  const review = evaluateProductionQuality({ packet, media: [{ type: 'video', url: 'x', playable: true }], technical: {}, subjectiveObservations: [{ message: 'Possible face drift', confidence: 0.55 }] });
  assert.equal(review.disposition, 'ESCALATE');
  assert.equal(boundedRepairDecision({ disposition: 'FIX' }, 2, 2).action, 'escalate');
});

test('Prism refuses failed QA and enforces finishing budget and exact delivered resolution', () => {
  assert.throws(() => buildPrismVideoUpscale({ videoUrl: 'https://assets.example.test/final.mp4', durationSeconds: 5, targetResolution: '4K', preliminaryReview: { disposition: 'FIX' }, remainingBudgetUsd: 2 }), /before preliminary QA passes/);
  const request = buildPrismVideoUpscale({ videoUrl: 'https://assets.example.test/final.mp4', durationSeconds: 5, targetResolution: '4K', preliminaryReview: { disposition: 'PASS' }, remainingBudgetUsd: 2 });
  assert.equal(request.estimatedCostUsd, 0.1);
  assert.equal(request.preserveOriginal, true);
  assert.throws(() => assertDeliveredResolution('4K', '1080p'), /cannot be labeled/);
});

