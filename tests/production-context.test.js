import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveProductionContextFromSnapshot } from '../server/production-context.js';
import { requiredMediaState } from '../server/production-contracts.js';

const ownerId = '11111111-1111-4111-8111-111111111111';
const projectId = '22222222-2222-4222-8222-222222222222';
const assignmentId = '33333333-3333-4333-8333-333333333333';
const otherProjectId = '44444444-4444-4444-8444-444444444444';

function snapshot(overrides = {}) {
  return {
    assignment: { id: assignmentId, owner_id: ownerId, project_id: projectId },
    project: { id: projectId, user_id: ownerId, name: 'Colony Zero', production_mode: 'entertainment', production_plan: {} },
    projectContexts: [{ id: 'map-1', context_type: 'series_mapping', title: 'Mapping', metadata: { series_document_id: 'colony-zero', memory_version: 1 } }],
    seriesDocuments: [{ user_id: ownerId, kind: 'series', id: 'colony-zero', revision: 2, document: {
      bible: { continuityRules: ['Preserve approved canon.'] },
      characters: [{ id: 'C01', name: 'TK', image: 'https://assets.example.test/tk.png', canonState: { status: 'approved' }, voiceDirection: 'Use approved human master.' }],
      episodes: [{ id: 'S1E1', scenes: [{ id: 'SC01', characterIds: ['C01'], description: 'TK enters the chamber.', shots: [{ id: 'SH01', characterIds: ['C01'], camera: { lens: '35mm' } }] }] }],
    }}],
    productionDocuments: [], assets: [], ...overrides,
  };
}

function input(overrides = {}) {
  return { episodeId: 'S1E1', sceneId: 'SC01', shotId: 'SH01', characterIds: ['C01'], createdAt: '2026-11-15T12:00:00.000Z', packetId: '55555555-5555-4555-8555-555555555555', ...overrides };
}

test('resolves an explicitly mapped series and known Colony Zero character image', () => {
  const packet = resolveProductionContextFromSnapshot(snapshot(), input());
  assert.equal(packet.series.id, 'colony-zero');
  assert.equal(packet.series.revision, 2);
  assert.equal(packet.characters[0].id, 'C01');
  assert.equal(packet.references[0].role, 'character_master');
  assert.equal(packet.references[0].url, 'https://assets.example.test/tk.png');
  assert.equal(packet.generation.aspectRatio, '16:9');
  assert.equal(packet.voicePolicy.mode, 'approved-human-master');
  assert.equal(packet.blockers.length, 0);
});

test('requires explicit series mapping and never guesses the detective series for Palava 231', () => {
  const base = snapshot({ projectContexts: [], seriesDocuments: [] });
  base.project.name = 'Palava 231';
  const packet = resolveProductionContextFromSnapshot(base, input({ episodeId: null, sceneId: null, shotId: null, characterIds: [] }));
  assert.equal(packet.series, null);
  assert(packet.blockers.some((item) => item.code === 'SERIES_MAPPING_REQUIRED'));
});

test('returns structured blockers instead of fabricating missing character references', () => {
  const packet = resolveProductionContextFromSnapshot(snapshot(), input({ characterIds: ['C99'] }));
  assert(packet.blockers.some((item) => item.code === 'CHARACTER_NOT_FOUND' && item.resourceId === 'C99'));
  assert.equal(packet.references.length, 0);
});

test('rejects cross-project assets and preserves ordered multiple references', () => {
  const base = snapshot({ assets: [
    { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', user_id: ownerId, project_id: projectId, url: 'https://assets.example.test/prop.png', metadata: { referenceRole: 'prop', referencePriority: 'high' } },
    { id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', user_id: ownerId, project_id: otherProjectId, url: 'https://assets.example.test/private.png', metadata: {} },
  ] });
  base.seriesDocuments[0].document.characters[0].references = ['https://assets.example.test/tk-side.png'];
  const packet = resolveProductionContextFromSnapshot(base, input({ assetIds: ['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'] }));
  assert.deepEqual(packet.references.map((item) => item.role), ['character_master', 'character_supporting', 'prop']);
  assert(packet.blockers.some((item) => item.code === 'ASSET_NOT_FOUND_OR_FORBIDDEN'));
  assert(!packet.references.some((item) => item.url.includes('private.png')));
});

test('finished media invariant rejects a written package without its required playable video', () => {
  const packet = resolveProductionContextFromSnapshot(snapshot(), input());
  assert.equal(requiredMediaState(packet, []).complete, false);
  assert.equal(requiredMediaState(packet, [{ type: 'video', url: 'https://assets.example.test/final.mp4', playable: true }]).complete, true);
});

