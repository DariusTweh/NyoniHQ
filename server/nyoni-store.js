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

function studioClient(env = process.env) {
  const config = storeConfig(env);
  if (!studioStoreStatus(env)) return null;
  return createClient(config.url, config.serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
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
