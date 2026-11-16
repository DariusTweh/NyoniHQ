const NARRATIVE_KINDS = new Set(['watch_nyoni_pipeline', 'nyoni_commercials_pipeline', 'scripted_production_pipeline']);

export function classifyWorkflowIntent(assignment) {
  const production = assignment?.request?.production || {};
  const explicit = String(production.intent || '').toLowerCase();
  const technical = production.requiresStory === false || ['technical', 'utility', 'transcode', 'upscale'].includes(explicit);
  const narrative = !technical && (
    production.requiresStory === true ||
    ['narrative', 'scripted_dialogue', 'commercial_story', 'short_film'].includes(explicit) ||
    NARRATIVE_KINDS.has(assignment?.workflow_kind)
  );
  return {
    kind: technical ? 'technical' : narrative ? 'scripted_narrative' : 'general',
    requiresStory: narrative,
    requiredStages: narrative
      ? ['migo', 'story', 'story_quality_gate', 'creative', 'motion_preliminary', 'vox', 'motion_final', 'nova', 'pulse', 'rally']
      : [],
    source: production.intent || production.requiresStory !== undefined ? 'structured_request' : NARRATIVE_KINDS.has(assignment?.workflow_kind) ? 'workflow_kind' : 'default',
  };
}

export function mergeRequiredAgents(route, assignment) {
  const intent = classifyWorkflowIntent(assignment);
  const required = intent.requiresStory ? ['story', 'creative', 'motion', 'vox', 'nova', 'pulse', 'rally'] : [];
  const requested = Array.isArray(route?.specialists) ? route.specialists : [];
  const ids = [...required, ...requested.map((item) => item?.agentId)].filter(Boolean);
  return [...new Set(ids)];
}
