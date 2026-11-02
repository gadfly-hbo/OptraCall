import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import type { IncomingMessage } from 'node:http';
import { createSimLabRoutes } from '../extensions/business-plugins/sim-lab/api/routes.ts';
import { startTestHost } from './fixtures/host-process.ts';

const PROJECT = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

test('SIM-API-04: Host JSON transport errors keep their status and precede plugin validation', async t => {
  const host = await startTestHost(); t.after(() => host.close());
  const route = `/api/simlab/projects/${PROJECT}/drafts`;
  const wrongType = await fetch(host.baseUrl + route, { method: 'POST', headers: { ...host.headers, 'content-type': 'text/plain' }, body: '{}' });
  assert.equal(wrongType.status, 415);
  assert.equal((await wrongType.json()).code, 'json_required');
  const oversized = await host.request(route, 'POST', { name: 'x'.repeat(65_536) });
  assert.equal(oversized.status, 413);
  assert.equal((await oversized.json()).code, 'request_too_large');
});

async function fixture(t: { after: (fn: () => Promise<void>) => void }, archived = false) {
  const dataRoot = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'optracall-simlab-api-')));
  t.after(async () => { await fs.rm(dataRoot, { recursive: true, force: true }); });
  const routes = createSimLabRoutes({
    dataRoot,
    projectExists: async id => id === PROJECT,
    projectArchived: async () => archived,
    readBody: async request => (request as unknown as { __body: Record<string, unknown> }).__body,
  });
  const call = (method: string, target: string, body?: Record<string, unknown>) =>
    routes({ method, __body: body } as unknown as IncomingMessage, new URL(target, 'http://127.0.0.1'));
  return { call };
}

test('SIM-API-01: inspect and unknown paths', async t => {
  const { call } = await fixture(t);
  const inspect = await call('GET', '/api/simlab/inspect');
  assert.equal(inspect?.status, 200);
  assert.equal((inspect?.value as any).engineVersion, 'optracall-sim-1');
  assert.equal(await call('GET', '/api/other'), undefined);
  assert.equal((await call('GET', '/api/simlab/nope'))?.status, 404);
  assert.equal((await call('GET', `/api/simlab/projects/${'b'.repeat(36)}/drafts`))?.status, 404);
});

test('SIM-API-02: draft/run/freeze flow over HTTP transport', async t => {
  const { call } = await fixture(t);
  const created = await call('POST', `/api/simlab/projects/${PROJECT}/drafts`, { name: 'API 草稿' });
  assert.equal(created?.status, 201);
  const draft = (created?.value as any).draft;

  const listed = await call('GET', `/api/simlab/projects/${PROJECT}/drafts`);
  assert.equal((listed?.value as any).drafts.length, 1);

  const conflict = await call('PATCH', `/api/simlab/projects/${PROJECT}/drafts/${draft.id}`, { expectedRevision: 99 });
  assert.equal(conflict?.status, 409);
  assert.equal((conflict?.value as any).code, 'revision_conflict');

  const updated = await call('PATCH', `/api/simlab/projects/${PROJECT}/drafts/${draft.id}`, { parameters: { demand: 210 }, expectedRevision: 1 });
  assert.equal(updated?.status, 200);
  assert.equal((updated?.value as any).draft.revision, 2);

  const ran = await call('POST', `/api/simlab/projects/${PROJECT}/drafts/${draft.id}/runs`, {});
  assert.equal(ran?.status, 201);
  const run = (ran?.value as any).run;
  assert.equal(run.draftRevision, 2);

  const stress = await call('POST', `/api/simlab/projects/${PROJECT}/drafts/${draft.id}/stress`, { perturbation: { demandMultiplier: 1.25 } });
  assert.equal(stress?.status, 200);
  assert.equal((stress?.value as any).rows.length, 3);

  const frozen = await call('POST', `/api/simlab/projects/${PROJECT}/drafts/${draft.id}/freeze`, { runId: run.id, variantId: 'baseline', expectedRevision: 2 });
  assert.equal(frozen?.status, 201);
  const snapshot = (frozen?.value as any).snapshot;
  assert.equal(snapshot.id, 'SNAP-0001');

  const snapshots = await call('GET', `/api/simlab/projects/${PROJECT}/snapshots`);
  assert.equal((snapshots?.value as any).snapshots.length, 1);
  const detail = await call('GET', `/api/simlab/projects/${PROJECT}/snapshots/${snapshot.id}`);
  assert.equal((detail?.value as any).snapshot.result.conservation, true);
});

test('SIM-API-03: archived projects are read-only', async t => {
  const { call } = await fixture(t, true);
  const created = await call('POST', `/api/simlab/projects/${PROJECT}/drafts`, { name: '应被拒绝' });
  assert.equal(created?.status, 409);
  assert.equal((created?.value as any).code, 'project_archived');
  const listed = await call('GET', `/api/simlab/projects/${PROJECT}/drafts`);
  assert.equal(listed?.status, 200);
  const stress = await call('POST', `/api/simlab/projects/${PROJECT}/drafts/some-id/stress`, { perturbation: {} });
  assert.equal(stress?.status, 409);
});
