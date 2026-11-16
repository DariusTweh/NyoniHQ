import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const read = (path) => readFile(new URL(path, root), 'utf8');

test('budget reservation is atomic, policy-bound and idempotent', async () => {
  const migration = await read('supabase/migrations/20261115120000_production_core.sql');
  assert.match(migration, /pg_advisory_xact_lock/);
  assert.match(migration, /nyoni_budget_policies/);
  assert.match(migration, /unique\s*\(owner_id\s*,\s*idempotency_key\)/i);
  assert.match(migration, /state\s*=\s*'reserved'/i);
  assert.match(migration, /state in \('reserved','captured','released','expired'\)/i);
});

test('production workflow persists jobs before provider submission and preserves explicit failures', async () => {
  const workflow = await read('workflows/nyoni-assignment.js');
  const jobAt = workflow.indexOf('createCoreProductionJob(assignment');
  const submitAt = workflow.indexOf('runMediaProduction(', jobAt);
  assert(jobAt > -1 && submitAt > jobAt);
  assert.match(workflow, /production_state: ready \? 'ready_founder_review'/);
  assert.match(workflow, /status: ready \? 'waiting_approval' : 'failed'/);
  assert.match(workflow, /runCommercialResearch\(assignment, plan\)/);
  assert.match(workflow, /\$\{production\.agentId\}-to-pulse-final-qa/);
  assert.match(workflow, /generateVoxDialogueConversation/);
  assert.match(workflow, /story-quality-gate/);
  assert.doesNotMatch(workflow, /runCoreCutline|assembleDialogueCut/);
  assert.doesNotMatch(workflow, /specialists\.length === 4/);
});

test('publishing remains a separate founder approval boundary', async () => {
  const workflow = await read('workflows/nyoni-assignment.js');
  assert.match(workflow, /externalAction: 'publishing_remains_separately_gated'/);
  assert.match(workflow, /action_type: 'approve_content_package'/);
  assert.doesNotMatch(workflow, /publishToInstagram|publishToTikTok/);
});

test('legacy commercial and carousel flows and HQ interaction stay present', async () => {
  const workflow = await read('workflows/nyoni-assignment.js');
  const app = await read('app.js');
  const hq = await read('hq-3d.js');
  assert.match(workflow, /workflow_kind === 'carousel'/);
  assert.match(workflow, /workflow_kind === 'commercial_pipeline'/);
  assert.match(app, /NyoniHQ3D\?\.mountHQ3D/);
  assert.match(hq, /pointerdown|click/);
});

test('media persistence keys retries to the durable provider job', async () => {
  const tools = await read('server/production-tools.js');
  assert.match(tools, /const persistenceKey = `\$\{assignment\.id\}:\$\{job\.kind\}:\$\{job\.jobId\}`/);
  assert.match(tools, /idempotency_key: persistenceKey/);
  assert.match(tools, /setReservationState\(job\.reservationId, 'captured'/);
});
