import { defineConfig } from 'vite';
import { eveVite } from 'eve/vite';
import { runNyoniAgent, runtimeStatus, verifyAccess } from './server/nyoni-runtime.js';

async function readJson(request) {
  let body = '';
  for await (const chunk of request) body += chunk;
  return body ? JSON.parse(body) : {};
}

function nyoniAgentApi() {
  return {
    name: 'nyoni-agent-api',
    configureServer(server) {
      server.middlewares.use('/api/agents/status', (_request, response) => {
        response.setHeader('Content-Type', 'application/json');
        response.setHeader('Cache-Control', 'no-store');
        response.end(JSON.stringify(runtimeStatus()));
      });
      server.middlewares.use('/api/agents/run', async (request, response) => {
        if (request.method !== 'POST') {
          response.statusCode = 405;
          response.setHeader('Content-Type', 'application/json');
          response.end(JSON.stringify({ error: 'Method not allowed' }));
          return;
        }
        if (!verifyAccess(request.headers['x-nyoni-access-token'])) {
          response.statusCode = 401;
          response.setHeader('Content-Type', 'application/json');
          response.end(JSON.stringify({ error: 'Nyoni HQ access is not configured or the studio passcode is incorrect.' }));
          return;
        }
        response.statusCode = 200;
        response.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
        response.setHeader('Cache-Control', 'no-cache, no-transform');
        const send = (event) => response.write(`data: ${JSON.stringify(event)}\n\n`);
        try {
          const body = await readJson(request);
          const result = await runNyoniAgent({
            ...body,
            onEvent: (event) => send({ kind: 'progress', ...event }),
          });
          send({ kind: 'result', ...result });
        } catch (error) {
          send({ kind: 'error', code: error?.code, message: error?.message || 'Agent run failed.' });
        } finally {
          response.end();
        }
      });
    },
  };
}

export default defineConfig({
  // Production uses the OpenAI Codex + Muse API functions. Eve stays as a
  // local Creative fallback; its Vite plugin expects a full Vercel service
  // graph and must not wrap this plain Vite production build.
  plugins: [nyoniAgentApi(), ...(process.env.VERCEL ? [] : [eveVite()])],
  server: {
    host: '127.0.0.1',
    port: 4173,
    strictPort: true,
  },
});
