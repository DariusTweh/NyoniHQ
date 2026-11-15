import { createClient } from '@supabase/supabase-js';

function storeConfig(env = process.env) {
  return {
    url: env.SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL,
    serviceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY,
    projectId: env.NYONI_STUDIO_PROJECT_ID,
  };
}

export function studioStoreStatus(env = process.env) {
  const config = storeConfig(env);
  return Boolean(config.url && config.serviceRoleKey && config.projectId);
}

export function studioClient(env = process.env) {
  const config = storeConfig(env);
  if (!studioStoreStatus(env)) return null;
  return createClient(config.url, config.serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

export async function studioOwner(env = process.env) {
  const client = studioClient(env);
  if (!client) throw new Error('Supabase studio storage is not configured.');
  const { projectId } = storeConfig(env);
  const { data, error } = await client.from('projects').select('id,user_id').eq('id', projectId).single();
  if (error) throw new Error(`Studio owner lookup failed: ${error.message}`);
  return { client, ownerId: data.user_id, defaultProjectId: data.id };
}

export async function resolveStudioProject(projectName, env = process.env) {
  const owner = await studioOwner(env);
  if (!projectName) return { ...owner, projectId: owner.defaultProjectId, projectName: 'Studio Operations' };
  const { data, error } = await owner.client.from('projects').select('id,name').eq('user_id', owner.ownerId).eq('name', projectName).maybeSingle();
  if (error) throw new Error(`Project lookup failed: ${error.message}`);
  return { ...owner, projectId: data?.id || owner.defaultProjectId, projectName: data?.name || projectName };
}

export async function createAssignment(payload, env = process.env) {
  const title = String(payload.title || '').trim();
  if (!title) throw new Error('An assignment title is required.');
  const studio = await resolveStudioProject(payload.project, env);
  const mediaAgents = new Set(['lumina', 'reframe', 'nova', 'kinetic', 'cutline', 'sonora', 'vox', 'rally']);
  const agentId = payload.agentId || 'migo';
  const isCommercialPipeline = studio.projectName === 'Nyoni Commercials' && (agentId === 'rally' || /campaign|commercial|advert|launch creative/i.test(title));
  const workflowKind = isCommercialPipeline ? 'commercial_pipeline' : mediaAgents.has(agentId) ? 'studio_generation' : /carousel|instagram slides?|social slides?/i.test(title) ? 'carousel' : 'general';
  const idempotencyKey = payload.idempotencyKey || `hq:${studio.ownerId}:${Date.now()}:${crypto.randomUUID()}`;
  const { data, error } = await studio.client.from('nyoni_assignments').insert({
    project_id: studio.projectId, owner_id: studio.ownerId, title: title.slice(0, 2000),
    agent_id: agentId, status: 'queued', workflow_kind: workflowKind,
    approval_tier: ['carousel', 'studio_generation'].includes(workflowKind) ? 'B' : 'A', source_url: payload.sourceUrl || null,
    idempotency_key: idempotencyKey, request: { project: studio.projectName, brief: title, sourceUrl: payload.sourceUrl || null },
  }).select('*').single();
  if (error) throw new Error(`Assignment creation failed: ${error.message}`);
  await recordAssignmentEvent(data, 'assignment.created', `Assignment queued for ${data.agent_id}`, { source: 'nyoni-hq' }, env);
  return data;
}

export async function recordAssignmentEvent(assignment, eventType, message, data = {}, env = process.env) {
  const client = studioClient(env);
  if (!client) return;
  const { error } = await client.from('nyoni_assignment_events').insert({
    assignment_id: assignment.id, owner_id: assignment.owner_id, event_type: eventType, message, data,
  });
  if (error) throw new Error(`Assignment event failed: ${error.message}`);
}

export async function listAssignments(env = process.env) {
  const { client, ownerId } = await studioOwner(env);
  const { data, error } = await client.from('nyoni_assignments')
    .select('*, projects(name), nyoni_workflow_steps(*), nyoni_handoffs(*), nyoni_artifacts(*, nyoni_artifact_versions(*))')
    .eq('owner_id', ownerId).order('created_at', { ascending: false }).limit(100);
  if (error) throw new Error(`Assignment list failed: ${error.message}`);
  return data || [];
}

export async function listPublicActivity(env = process.env) {
  const { client, ownerId } = await studioOwner(env);
  const { data, error } = await client.from('nyoni_assignments')
    .select('id,title,agent_id,status,updated_at,nyoni_workflow_steps(agent_id,title,status,position),nyoni_handoffs(id,assignment_id,from_agent_id,to_agent_id,status,context,created_at,accepted_at)')
    .eq('owner_id', ownerId).in('status', ['queued', 'running', 'waiting_approval', 'failed'])
    .order('updated_at', { ascending: false }).limit(20);
  if (error) throw new Error(`Studio activity lookup failed: ${error.message}`);
  return (data || []).map((row) => {
    const steps = [...(row.nyoni_workflow_steps || [])].sort((a, b) => a.position - b.position);
    const current = steps.find((step) => step.status === 'running') || steps.at(-1);
    return {
      id: row.id,
      title: row.title,
      agentId: row.agent_id,
      status: row.status,
      updatedAt: row.updated_at,
      phase: current?.title || (row.status === 'queued' ? 'Waiting for its durable workflow' : row.status === 'waiting_approval' ? 'Deliverable ready for founder review' : 'Studio mission in progress'),
      steps,
      handoffs: row.nyoni_handoffs || [],
    };
  });
}

export async function updateAssignmentRunId(assignmentId, runId, env = process.env) {
  const { client, ownerId } = await studioOwner(env);
  const { error } = await client.from('nyoni_assignments').update({ workflow_run_id: runId, updated_at: new Date().toISOString() }).eq('id', assignmentId).eq('owner_id', ownerId);
  if (error) throw new Error(`Workflow run link failed: ${error.message}`);
}

export async function actOnAssignment(assignmentId, action, env = process.env) {
  const { client, ownerId } = await studioOwner(env);
  const status = { approve: 'done', reject: 'queued', cancel: 'cancelled', retry: 'queued' }[action];
  if (!status) throw new Error('Unsupported assignment action.');
  const patch = { status, updated_at: new Date().toISOString() };
  if (action === 'retry' || action === 'reject') Object.assign(patch, { error: null, available_at: new Date().toISOString(), completed_at: null });
  const { data, error } = await client.from('nyoni_assignments').update(patch).eq('id', assignmentId).eq('owner_id', ownerId).select('*').single();
  if (error) throw new Error(`Assignment action failed: ${error.message}`);
  await recordAssignmentEvent(data, `assignment.${action}`, `Founder ${action}ed assignment`, {}, env);
  return data;
}

export async function beginAgentRun({ agentId, title, project, model }, env = process.env) {
  const client = studioClient(env);
  if (!client) return null;
  const { projectId } = storeConfig(env);
  const { data: studioProject, error: projectError } = await client
    .from('projects')
    .select('id, user_id')
    .eq('id', projectId)
    .single();
  if (projectError) throw new Error(`Movie Studio project lookup failed: ${projectError.message}`);

  const { data, error } = await client
    .from('generation_jobs')
    .insert({
      user_id: studioProject.user_id,
      project_id: studioProject.id,
      provider: 'openai-agents',
      model,
      type: 'nyoni_agent',
      status: 'running',
      input: { agentId, title, project: project || 'Nyoni Studios', source: 'nyoni-hq' },
    })
    .select('id')
    .single();
  if (error) throw new Error(`Movie Studio run creation failed: ${error.message}`);
  return data.id;
}

export async function completeAgentRun(jobId, result, env = process.env) {
  if (!jobId) return;
  const client = studioClient(env);
  if (!client) return;
  const { error } = await client
    .from('generation_jobs')
    .update({
      status: 'completed',
      output: {
        sessionId: result.sessionId,
        deliverable: result.output,
        providers: result.providers,
      },
      updated_at: new Date().toISOString(),
    })
    .eq('id', jobId);
  if (error) throw new Error(`Movie Studio run completion failed: ${error.message}`);
}

export async function failAgentRun(jobId, runError, env = process.env) {
  if (!jobId) return;
  const client = studioClient(env);
  if (!client) return;
  const { error } = await client
    .from('generation_jobs')
    .update({
      status: 'failed',
      error: runError?.message || 'Agent run failed.',
      updated_at: new Date().toISOString(),
    })
    .eq('id', jobId);
  if (error) throw new Error(`Movie Studio run failure update failed: ${error.message}`);
}
