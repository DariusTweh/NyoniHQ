import test from 'node:test';
import assert from 'node:assert/strict';
import { getGlobalActorById, globalActorReferences } from '../server/movie-studio-library.js';

test('global actor adapter performs exact stable-ID lookup against the canonical Movie Studio endpoint', async () => {
  let requestedUrl = '';
  const actor = await getGlobalActorById('malik-klozu', {
    baseUrl: 'https://studio.example.test',
    fetchImpl: async (url) => {
      requestedUrl = String(url);
      return new Response(JSON.stringify({ actors: [
        { id: 'selah-monet', name: 'Selah' },
        { id: 'malik-klozu', name: 'Malik', references: ['https://assets.example.test/malik.png'] },
      ] }), { status: 200, headers: { 'content-type': 'application/json' } });
    },
  });
  assert.match(requestedUrl, /\/api\/production\/library\?kind=actor/);
  assert.equal(actor.name, 'Malik');
  assert.deepEqual(globalActorReferences(actor), ['https://assets.example.test/malik.png']);
});

test('global actor adapter reads the canonical Movie Studio result/document envelope', async () => {
  const actor = await getGlobalActorById('selah-monet', {
    baseUrl: 'https://studio.example.test',
    fetchImpl: async () => new Response(JSON.stringify({ result: [
      { id: 'selah-monet', revision: 0, document: { id: 'selah-monet', name: 'Selah Monet', references: ['https://assets.example.test/selah.png'] } },
    ] }), { status: 200 }),
  });
  assert.equal(actor.name, 'Selah Monet');
  assert.deepEqual(globalActorReferences(actor), ['https://assets.example.test/selah.png']);
});

test('global actor adapter does not fuzzy-match a different actor', async () => {
  await assert.rejects(() => getGlobalActorById('malik', {
    baseUrl: 'https://studio.example.test',
    fetchImpl: async () => new Response(JSON.stringify({ actors: [{ id: 'malik-klozu', name: 'Malik' }] }), { status: 200 }),
  }), /was not found/);
});

