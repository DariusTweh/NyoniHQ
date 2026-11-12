import { runNyoniAgent, verifyAccess } from '../../server/nyoni-runtime.js';

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

  try {
    const result = await runNyoniAgent({
      ...(request.body || {}),
      onEvent: (event) => send(response, { kind: 'progress', ...event }),
    });
    send(response, { kind: 'result', ...result });
  } catch (error) {
    send(response, { kind: 'error', code: error?.code, message: error?.message || 'Agent run failed.' });
  } finally {
    response.end();
  }
}
