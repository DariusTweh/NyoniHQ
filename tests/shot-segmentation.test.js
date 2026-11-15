import test from 'node:test';
import assert from 'node:assert/strict';
import { assertProviderSizedProduction, segmentProductionShots, ShotPlanError } from '../server/shot-segmentation.js';

test('long shots split at provider limits without merging distinct shots', () => {
  const segments = segmentProductionShots([
    { id: 'arrival', durationSeconds: 45, action: 'TK enters' },
    { id: 'reveal', durationSeconds: 15, action: 'The chamber opens' },
  ], { maxDurationSeconds: 30 });
  assert.deepEqual(segments.map((item) => [item.id, item.sourceShotId, item.durationSeconds]), [
    ['arrival:segment-1', 'arrival', 30],
    ['arrival:segment-2', 'arrival', 15],
    ['reveal', 'reveal', 15],
  ]);
  assert.equal(segments[2].shotIndex, 1);
});

test('long-form duration requires explicit shots and exact coverage', () => {
  assert.throws(() => assertProviderSizedProduction({ totalDurationSeconds: 300, shots: [] }), ShotPlanError);
  assert.throws(() => assertProviderSizedProduction({ totalDurationSeconds: 60, shots: [{ id: 'only', durationSeconds: 30 }] }), /must equal/);
});

test('one provider-sized shot can be planned without an artificial storyboard', () => {
  assert.deepEqual(assertProviderSizedProduction({ totalDurationSeconds: 8, maxDurationSeconds: 30 }), [{
    id: 'shot-1', sourceShotId: 'shot-1', shotIndex: 0, segmentIndex: 0, segmentCount: 1,
    durationSeconds: 8, startSeconds: 0, endSeconds: 8,
  }]);
});
