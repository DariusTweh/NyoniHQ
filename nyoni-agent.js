let cachedStatus = null;

async function apiError(response, fallback) {
  const body = await response.json().catch(() => ({}));
  const requestId = response.headers.get('x-vercel-id') || response.headers.get('x-request-id');
  const reason = body.error || body.message || body.statusMessage || fallback || `Request failed with HTTP ${response.status}`;
  const guidance = response.status === 401 || response.status === 403
    ? ' Check the Studio passcode in Connections.'
    : response.status === 429
      ? ' The service is busy or the budget limit was reached; wait a moment and retry.'
      : response.status >= 500
        ? ' The server or a connected provider failed; retry and check the assignment details.'
        : '';
  const error = new Error(`${reason}${guidance}`);
  error.status = response.status;
  error.requestId = requestId;
  error.code = body.code || 'API_REQUEST_FAILED';
  return error;
}

async function request(url, options, fallback) {
  let response;
  try {
    response = await fetch(url, options);
  } catch (cause) {
    const error = new Error('Nyoni HQ could not reach the server. Check your connection and retry.');
    error.code = 'NETWORK_UNAVAILABLE';
    error.cause = cause;
    throw error;
  }
  if (!response.ok) throw await apiError(response, fallback);
  return response;
}

export async function getAgentRuntimeStatus({ refresh = false } = {}) {
  if (cachedStatus && !refresh) return cachedStatus;
  const response = await request('/api/agents/status', { cache: 'no-store' }, 'Agent runtime status could not be loaded.');
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
  const response = await request('/api/assignments', { headers: studioHeaders(), cache: 'no-store' }, 'Assignments could not be synchronized.');
  return (await response.json()).assignments || [];
}

export async function listStudioActivity() {
  const response = await request('/api/activity', { cache: 'no-store' }, 'Live studio activity could not be loaded.');
  return (await response.json()).activity || [];
}

export async function createStudioAssignment(task) {
  const response = await request('/api/assignments', {
    method: 'POST', headers: studioHeaders(),
    body: JSON.stringify({
      title: task.title, agentId: task.agent, project: task.project, sourceUrl: task.sourceUrl || null,
      workflowKind: task.workflowKind || null, production: task.production || null,
      expectedDeliverables: task.expectedDeliverables || null, voiceProfileId: task.voiceProfileId || null,
    }),
  }, 'The assignment could not be created.');
  return (await response.json()).assignment;
}

export async function updateStudioAssignment(assignmentId, action) {
  const response = await request('/api/assignments', {
    method: 'PATCH', headers: studioHeaders(), body: JSON.stringify({ assignmentId, action }),
  }, `The assignment could not be ${action}d.`);
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

export async function getGoogleAuthorizationUrl() {
  const response = await request('/api/integrations/google/authorize', {
    headers: studioHeaders(), cache: 'no-store',
  }, 'Google authorization could not be started.');
  return (await response.json()).url;
}

export async function getGmailInbox() {
  const response = await request('/api/integrations/google/inbox?limit=8', {
    headers: studioHeaders(), cache: 'no-store',
  }, 'Hunter could not read the connected Gmail inbox.');
  return (await response.json()).messages || [];
}

export async function runCodexAssignment(task, onUpdate = () => {}) {
  const response = await request('/api/agents/run', {
    method: 'POST',
    headers: {
      ...studioHeaders(),
    },
    body: JSON.stringify({
      agentId: task.agent,
      title: task.title,
      project: task.project,
    }),
  }, 'The agent could not start.');
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
