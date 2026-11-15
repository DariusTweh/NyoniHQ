import assert from 'node:assert/strict';
import { buildMotionProductionPrompt } from '../server/motion-engine.js';
import { buildProviderRequest, estimateProviderCost } from '../server/provider-adapters.js';
import { evaluateProductionQuality } from '../server/quality-control.js';
import { assertProviderSizedProduction } from '../server/shot-segmentation.js';

function packet({ name, aspectRatio, durationSeconds }) {
  const value = {
    project: { name },
    script: { text: 'The lead crosses the room and discovers the object.', dialogue: [] },
    characters: [{ id: 'lead', name: 'Lead', voiceDirection: null }],
    references: [], locations: [], props: [],
    continuityRules: ['Preserve screen direction and object position across the cut.'],
    cameraDirection: { lens: '35mm', movement: 'motivated dolly' },
    visualDirection: { lighting: 'soft motivated practicals', materials: 'physically grounded' },
    voicePolicy: { mode: 'none', allowAutomaticVoiceSelection: false, voiceProfileId: null, instructions: [] },
    generation: { mode: 'text-to-video', provider: 'kie', model: 'bytedance/seedance-2-5', durationSeconds, resolution: '480p', aspectRatio, generateAudio: true, returnLastFrame: true },
    expectedDeliverables: [{ id: 'final-video', type: 'video', required: true, playable: true, label: 'Playable final video' }],
  };
  value.motionPrompt = buildMotionProductionPrompt(value, { goal: `${name} shot` });
  return value;
}

const cases = [
  packet({ name: 'Watch Nyoni', aspectRatio: '16:9', durationSeconds: 10 }),
  packet({ name: 'Nyoni Commercials', aspectRatio: '9:16', durationSeconds: 8 }),
];

const summary = cases.map((value) => {
  const shots = assertProviderSizedProduction({ totalDurationSeconds: value.generation.durationSeconds });
  const request = buildProviderRequest(value);
  const pricing = estimateProviderCost(value);
  const blockedQa = evaluateProductionQuality({ packet: value, media: [], stage: 'preliminary' });
  assert.equal(blockedQa.disposition, 'FIX');
  assert.equal(request.input.duration, value.generation.durationSeconds);
  assert.equal(request.input.aspect_ratio, value.generation.aspectRatio);
  return {
    project: value.project.name,
    provider: request.provider,
    model: request.model,
    aspectRatio: request.input.aspect_ratio,
    durationSeconds: request.input.duration,
    shotSegments: shots.length,
    estimatedUsd: pricing.estimatedUsd,
    noMediaQa: blockedQa.disposition,
  };
});

console.log(JSON.stringify({ dryRun: true, paidProviderCalls: 0, cases: summary }, null, 2));
