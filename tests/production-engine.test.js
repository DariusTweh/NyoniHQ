import test from 'node:test';
import assert from 'node:assert/strict';
import { buildMotionProductionPrompt } from '../server/motion-engine.js';
import { buildKieSeedanceRequest, buildWaveSpeedH3Request, estimateProviderCost, ProviderCompatibilityError } from '../server/provider-adapters.js';
import { authorizedVoiceId, selectContentUrls, submitStudioGeneration } from '../server/production-tools.js';

function packet(overrides = {}) {
  return {
    project: { name: 'Colony Zero' }, script: { text: 'TK crosses the chamber.', dialogue: [] },
    characters: [{ id: 'C01', name: 'TK', voiceDirection: 'Preserve approved Liberian performance.' }],
    references: [{ id: 'tk-master', url: 'https://assets.example.test/tk.png', role: 'character_master', priority: 'critical', label: 'TK identity' }],
    continuityRules: ['TK remains screen left.'], cameraDirection: { lens: '35mm' }, visualDirection: { lighting: 'cool practicals' },
    voicePolicy: { mode: 'approved-human-master', allowAutomaticVoiceSelection: false, voiceProfileId: null, instructions: ['Use only approved human voice masters.'] },
    generation: { mode: 'reference-to-video', provider: 'kie', model: 'bytedance/seedance-2-5', durationSeconds: 5, resolution: '720p', aspectRatio: '16:9', generateAudio: false, returnLastFrame: true },
    motionPrompt: '', ...overrides,
  };
}

test('Motion compiles a cinematic prompt with reference assignments, timing, physics and voice locks', () => {
  const value = packet();
  value.motionPrompt = buildMotionProductionPrompt(value);
  assert.match(value.motionPrompt, /@Image 1/);
  for (const section of ['A — GENERATION GOAL', 'B — REFERENCE MANIFEST', 'C — CHARACTER IDENTITY LOCKS', 'D — ART STYLE AND ENVIRONMENT', 'E — STAGE GEOGRAPHY AND CHARACTER BLOCKING', 'F — EYELINES AND DIALOGUE RECIPIENTS', 'G — CAMERA DIRECTION', 'H — CHARACTER ACTING AND EMOTIONAL PERFORMANCE', 'I — AUDIO AND DIALOGUE', 'J — SECOND-BY-SECOND ACTION AND PACING', 'K — PHYSICS AND PHYSICAL INTERACTION', 'L — END-STATE CONTINUITY', 'M — NEGATIVE CONSTRAINTS', 'N — TECHNICAL GENERATION SETTINGS']) {
    assert.match(value.motionPrompt, new RegExp(`\\[${section}\\]`));
  }
  assert.match(value.motionPrompt, /Never auto-select a substitute voice/);
  assert.match(value.motionPrompt, /Avoid constantly centered tracking/);
});

test('KIE sends the same ordered audio masters named in the Motion packet', () => {
  const value = packet({
    generation: { ...packet().generation, mode: 'reference-to-video', generateAudio: true },
    audioReferences: [
      { id: 'sonora-1', url: 'https://assets.example.test/score.mp3', role: 'music', label: 'Sonora score', durationSeconds: 10, preservation: 'reference_guidance' },
    ],
    audioStrategy: { mode: 'reference_guided', instructions: ['Follow the approved Sonora timing map.'] },
  });
  value.motionPrompt = buildMotionProductionPrompt(value);
  const request = buildKieSeedanceRequest(value);
  assert.match(value.motionPrompt, /@Audio 1 — Sonora score/);
  assert.deepEqual(request.input.reference_audio_urls, ['https://assets.example.test/score.mp3']);
});

test('KIE reference-to-video preserves multiple ordered images in the actual provider payload', () => {
  const value = packet({ references: [
    { id: 'a', url: 'https://assets.example.test/a.png', role: 'character_master', priority: 'critical', label: 'A' },
    { id: 'b', url: 'https://assets.example.test/b.png', role: 'location_master', priority: 'critical', label: 'B' },
  ] });
  value.motionPrompt = buildMotionProductionPrompt(value);
  const request = buildKieSeedanceRequest(value);
  assert.deepEqual(request.input.reference_image_urls, ['https://assets.example.test/a.png', 'https://assets.example.test/b.png']);
  assert.equal(request.input.first_frame_url, undefined);
  assert.equal(request.input.aspect_ratio, '16:9');
});

test('first-frame mode rejects additional critical references instead of silently dropping them', () => {
  const value = packet({ generation: { ...packet().generation, mode: 'image-to-video' }, references: [
    { id: 'frame', url: 'https://assets.example.test/frame.png', role: 'previous_frame', priority: 'critical', label: 'First frame' },
    { id: 'identity', url: 'https://assets.example.test/identity.png', role: 'character_master', priority: 'critical', label: 'Identity' },
  ] });
  assert.throws(() => buildKieSeedanceRequest(value), ProviderCompatibilityError);
});

test('WaveSpeed H3 enforces reference limits and correct 9:16 configuration', () => {
  const value = packet({ generation: { ...packet().generation, provider: 'wavespeed', model: 'minimax/h3/reference-to-video', resolution: '768p', aspectRatio: '9:16' } });
  value.motionPrompt = buildMotionProductionPrompt(value);
  const request = buildWaveSpeedH3Request(value);
  assert.equal(request.input.aspect_ratio, '9:16');
  assert.deepEqual(request.input.reference_images, ['https://assets.example.test/tk.png']);
});

test('cost estimate is model, duration and resolution specific', () => {
  const five = estimateProviderCost(packet());
  const ten = estimateProviderCost(packet({ generation: { ...packet().generation, durationSeconds: 10 } }));
  assert.equal(five.estimatedUsd, 1.575);
  assert.equal(ten.estimatedUsd, 3.15);
});

test('production generation supports a nonbillable dry run with the exact provider payload', async () => {
  const value = packet(); value.motionPrompt = buildMotionProductionPrompt(value);
  const result = await submitStudioGeneration({ id: '33333333-3333-4333-8333-333333333333', owner_id: '11111111-1111-4111-8111-111111111111', project_id: '22222222-2222-4222-8222-222222222222', agent_id: 'nova', title: 'Test', request: {} }, '', { packet: value, dryRun: true });
  assert.equal(result.status, 'dry_run');
  assert.deepEqual(result.input.reference_image_urls, ['https://assets.example.test/tk.png']);
});

test('voice selection never falls back to the first account voice', () => {
  const previous = process.env.NYONI_ELEVENLABS_VOICE_ID; delete process.env.NYONI_ELEVENLABS_VOICE_ID;
  try {
    assert.equal(authorizedVoiceId({ request: {} }, null), null);
    assert.throws(() => authorizedVoiceId({ request: {} }, { voicePolicy: { mode: 'approved-human-master', voiceProfileId: null } }), /approved human voice masters/);
  } finally { if (previous) process.env.NYONI_ELEVENLABS_VOICE_ID = previous; }
});

test('provider media selection excludes Suno cover art and duplicate streams', () => {
  const urls = [
    'https://cdn.example.test/song.mp3',
    'https://cdn.example.test/cover.jpeg',
    'https://cdn.example.test/song-stream.mp3',
  ];
  assert.deepEqual(selectContentUrls(urls, 'audio'), ['https://cdn.example.test/song.mp3']);
  assert.deepEqual(selectContentUrls(urls, 'image'), ['https://cdn.example.test/cover.jpeg']);
});

