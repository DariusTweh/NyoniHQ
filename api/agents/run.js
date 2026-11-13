import { codexModel, runNyoniAgent, verifyAccess } from '../../server/nyoni-runtime.js';
import { beginAgentRun, completeAgentRun, failAgentRun } from '../../server/nyoni-store.js';

export const maxDuration = 300;

function send(response, event) {
  response.write(`data: ${JSON.stringify(event)}\n\n`);
}

export default async function handler(request, response) {
  if (request.method !== 'POST') {
    response.setHeader('Allow', 'POST');
    return response.status(405).json({ error: 'Method not allowed' });
  }
  if (!verifyAccess(request.headers['x-nyoni-access-token'])) {
    return response.status(401).json({ error: 'Nyoni HQ access is not configured or the studio passcode is incorrect.' });
  }

  response.statusCode = 200;
  response.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  response.setHeader('Cache-Control', 'no-cache, no-transform');
  response.setHeader('Connection', 'keep-alive');
  response.flushHeaders?.();

  let studioJobId = null;
  try {
    try {
      studioJobId = await beginAgentRun({
        ...(request.body || {}),
        model: codexModel(),
      });
      if (studioJobId) send(response, { kind: 'progress', type: 'studio.saved', message: 'Run opened in Movie Studio' });
    } catch (storeError) {
      console.error('Movie Studio run creation failed', storeError);
      send(response, { kind: 'progress', type: 'studio.warning', message: 'Codex is running, but Movie Studio could not open the run ledger' });
    }
    const result = await runNyoniAgent({
      ...(request.body || {}),
      onEvent: (event) => send(response, { kind: 'progress', ...event }),
    });
    try {
      await completeAgentRun(studioJobId, result);
    } catch (storeError) {
      console.error('Movie Studio run completion failed', storeError);
      send(response, { kind: 'progress', type: 'studio.warning', message: 'Deliverable is ready, but its Movie Studio ledger update failed' });
    }
    send(response, { kind: 'result', ...result, studioJobId });
  } catch (error) {
    try {
      await failAgentRun(studioJobId, error);
    } catch (storeError) {
      console.error('Movie Studio run failure update failed', storeError);
    }
    send(response, { kind: 'error', code: error?.code, message: error?.message || 'Agent run failed.' });
  } finally {
    response.end();
  }
}
