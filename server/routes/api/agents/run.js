import { defineEventHandler, getHeader, readBody, sendStream, setHeader, setResponseStatus } from 'nitro/h3';
import { codexModel, runNyoniAgent, verifyAccess } from '../../../nyoni-runtime.js';
import { beginAgentRun, completeAgentRun, failAgentRun } from '../../../nyoni-store.js';

export default defineEventHandler(async (event) => {
  if (!verifyAccess(getHeader(event, 'x-nyoni-access-token'))) {
    setResponseStatus(event, 401);
    return { error: 'Nyoni HQ access is not configured or the studio passcode is incorrect.' };
  }
  const body = await readBody(event);
  setHeader(event, 'Content-Type', 'text/event-stream; charset=utf-8');
  setHeader(event, 'Cache-Control', 'no-cache, no-transform');
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (payload) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
      let studioJobId = null;
      try {
        studioJobId = await beginAgentRun({ ...body, model: codexModel() });
        if (studioJobId) send({ kind: 'progress', type: 'studio.saved', message: 'Run opened in Movie Studio' });
        const result = await runNyoniAgent({ ...body, onEvent: (progress) => send({ kind: 'progress', ...progress }) });
        await completeAgentRun(studioJobId, result);
        send({ kind: 'result', ...result, studioJobId });
      } catch (error) {
        await failAgentRun(studioJobId, error).catch(() => {});
        send({ kind: 'error', code: error?.code, message: error?.message || 'Agent run failed.' });
      } finally {
        controller.close();
      }
    },
  });
  return sendStream(event, stream);
});
