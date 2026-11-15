export class ShotPlanError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'ShotPlanError';
    this.code = 'SHOT_PLAN_INVALID';
    this.details = details;
  }
}

export function segmentProductionShots(shots, { maxDurationSeconds = 30 } = {}) {
  if (!Array.isArray(shots) || !shots.length) {
    throw new ShotPlanError('Long-form production requires an explicit ordered shot list; distinct shots are never inferred or merged.');
  }
  if (!Number.isFinite(maxDurationSeconds) || maxDurationSeconds <= 0) {
    throw new ShotPlanError('Provider maximum shot duration must be a positive number.');
  }

  const segments = [];
  for (const [shotIndex, shot] of shots.entries()) {
    const shotId = String(shot?.id || '').trim();
    const durationSeconds = Number(shot?.durationSeconds);
    if (!shotId || !Number.isFinite(durationSeconds) || durationSeconds <= 0) {
      throw new ShotPlanError('Every shot needs a stable id and positive duration.', { shotIndex, shotId, durationSeconds });
    }
    const segmentCount = Math.ceil(durationSeconds / maxDurationSeconds);
    let remaining = durationSeconds;
    for (let segmentIndex = 0; segmentIndex < segmentCount; segmentIndex += 1) {
      const segmentDuration = Math.min(maxDurationSeconds, remaining);
      segments.push({
        ...shot,
        sourceShotId: shotId,
        id: segmentCount === 1 ? shotId : `${shotId}:segment-${segmentIndex + 1}`,
        shotIndex,
        segmentIndex,
        segmentCount,
        durationSeconds: segmentDuration,
        startSeconds: Number((durationSeconds - remaining).toFixed(3)),
        endSeconds: Number((durationSeconds - remaining + segmentDuration).toFixed(3)),
      });
      remaining -= segmentDuration;
    }
  }
  return segments;
}

export function assertProviderSizedProduction({ totalDurationSeconds, shots, maxDurationSeconds = 30 }) {
  const total = Number(totalDurationSeconds || 0);
  if (total <= maxDurationSeconds && (!shots || !shots.length)) {
    return [{ id: 'shot-1', sourceShotId: 'shot-1', shotIndex: 0, segmentIndex: 0, segmentCount: 1, durationSeconds: total, startSeconds: 0, endSeconds: total }];
  }
  const segments = segmentProductionShots(shots, { maxDurationSeconds });
  const planned = segments.reduce((sum, item) => sum + item.durationSeconds, 0);
  if (total && Math.abs(planned - total) > 0.01) {
    throw new ShotPlanError('Explicit shot durations must equal the requested production duration.', { requested: total, planned });
  }
  return segments;
}
