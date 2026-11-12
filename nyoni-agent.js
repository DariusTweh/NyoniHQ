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
      'Content-Type': 'application/json',
      'X-Nyoni-Access-Token': accessToken(),
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
