let cachedStatus = null;

export async function getAgentRuntimeStatus({ refresh = false } = {}) {
  if (cachedStatus && !refresh) return cachedStatus;
  const response = await fetch('/api/agents/status', { cache: 'no-store' });
  if (!response.ok) throw new Error(`Agent status failed with ${response.status}`);
  cachedStatus = await response.json();
  return cachedStatus;
}

function accessToken() {
  return sessionStorage.getItem('nyoni-access-token') || '';
}

function studioHeaders() {
  return { 'Content-Type': 'application/json', 'X-Nyoni-Access-Token': accessToken() };
}

export async function listStudioAssignments() {
  const response = await fetch('/api/assignments', { headers: studioHeaders(), cache: 'no-store' });
  if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error || `Assignment sync failed with ${response.status}`);
  return (await response.json()).assignments || [];
}

export async function listStudioActivity() {
  const response = await fetch('/api/activity', { cache: 'no-store' });
  if (!response.ok) throw new Error(`Studio activity failed with ${response.status}`);
  return (await response.json()).activity || [];
}

export async function createStudioAssignment(task) {
  const response = await fetch('/api/assignments', {
    method: 'POST', headers: studioHeaders(),
    body: JSON.stringify({ title: task.title, agentId: task.agent, project: task.project, sourceUrl: task.sourceUrl || null }),
  });
  if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error || `Assignment creation failed with ${response.status}`);
  return (await response.json()).assignment;
}

export async function updateStudioAssignment(assignmentId, action) {
  const response = await fetch('/api/assignments', {
    method: 'PATCH', headers: studioHeaders(), body: JSON.stringify({ assignmentId, action }),
  });
  if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error || `Assignment action failed with ${response.status}`);
  return (await response.json()).assignment;
}

export function saveStudioPasscode(value) {
  const token = String(value || '').trim();
  if (token) sessionStorage.setItem('nyoni-access-token', token);
  else sessionStorage.removeItem('nyoni-access-token');
}

export function hasStudioPasscode() {
  return Boolean(accessToken());
}

export async function runCodexAssignment(task, onUpdate = () => {}) {
  const response = await fetch('/api/agents/run', {
    method: 'POST',
    headers: {
      ...studioHeaders(),
    },
    body: JSON.stringify({
      agentId: task.agent,
      title: task.title,
      project: task.project,
    }),
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error || `Agent request failed with ${response.status}`);
  }
  if (!response.body) throw new Error('The agent stream was unavailable.');

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let result = null;

  while (true) {
    const { value, done } = await reader.read();
    buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
    const frames = buffer.split('\n\n');
    buffer = frames.pop() || '';
    for (const frame of frames) {
      const line = frame.split('\n').find((entry) => entry.startsWith('data: '));
      if (!line) continue;
      const event = JSON.parse(line.slice(6));
      if (event.kind === 'progress') onUpdate(event.message, event);
      if (event.kind === 'error') throw new Error(event.message || 'Agent run failed.');
      if (event.kind === 'result') result = event;
    }
    if (done) break;
  }
  if (!result?.output) throw new Error('The agent finished without a deliverable.');
  return result;
}
