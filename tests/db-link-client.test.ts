import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DbLinkRequestError, listDbConnections, listDbResults, listDbSources, readDbResult, saveDbConnection, prepareDbGrant, grantDbSource, dbGrantMatches, dbModelTargetAllowed } from '../src/host/ui/db-link-client.ts';
import type { DbLinkConnectionInput, DbLinkProjectGrantInput, DbLinkSource } from '../src/host/db-link-types.ts';

test('db-link client sends one bounded same-origin save and marks a lost response UNKNOWN without replay', async () => {
  const original = globalThis.fetch; const calls: { url: string; options?: RequestInit }[] = [];
  globalThis.fetch = async (url, options) => { calls.push({ url: String(url), options }); throw new TypeError('connection lost including a sensitive driver detail'); };
  try {
    await assert.rejects(saveDbConnection({ name: '合成连接' } as DbLinkConnectionInput, 'host-receipt'), error => error instanceof DbLinkRequestError && error.uncertain && !error.message.includes('sensitive'));
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, '/api/db-link/connections');
    assert.equal(calls[0].options?.method, 'POST');
    assert.equal(calls[0].options?.credentials, 'omit');
    assert.equal(calls[0].options?.mode, 'same-origin');
    assert.equal((JSON.parse(String(calls[0].options?.body)) as { testReceiptId: string }).testReceiptId, 'host-receipt');
  } finally { globalThis.fetch = original; }
});

test('db-link client rejects a save response for a different tested configuration without treating it as safely retryable', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ connection: { id: 'connection-a', revision: 1, fingerprint: 'different-configuration', observation: {} } }));
  try { await assert.rejects(saveDbConnection({ id: 'connection-a' } as DbLinkConnectionInput, 'receipt-a', 'exact-configuration'), error => error instanceof DbLinkRequestError && error.code === 'db_response_mismatch' && error.uncertain); }
  finally { globalThis.fetch = original; }
});

test('db-link client refuses cross-project source and result receipts, including a foreign task under the right project', async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async () => new Response(JSON.stringify({ sources: [{ grant: { projectId: 'project-b', connectionId: 'connection-a', connectionFingerprint: 'fingerprint-a' }, connection: { id: 'connection-a', fingerprint: 'fingerprint-a' } }], projectSources: [] }));
    await assert.rejects(listDbSources('project-a', 'task-a'), error => error instanceof DbLinkRequestError && error.code === 'db_response_mismatch');
    globalThis.fetch = async () => new Response(JSON.stringify({ results: [{ id: 'result-a', owner: { projectId: 'project-a', taskId: 'task-b' } }] }));
    await assert.rejects(listDbResults('project-a', 'task-a'), error => error instanceof DbLinkRequestError && error.code === 'db_response_mismatch');
    globalThis.fetch = async () => new Response(JSON.stringify({ receipt: { id: 'result-a', owner: { projectId: 'project-a', taskId: 'task-a' } }, manifest: { id: 'result-a', owner: { projectId: 'project-b', taskId: 'task-a' } }, rowsPreview: [] }));
    await assert.rejects(readDbResult('project-a', 'result-a', 'task-a'), error => error instanceof DbLinkRequestError && error.code === 'db_response_mismatch');
  } finally { globalThis.fetch = original; }
});

test('db-link client keeps read failure separate from mutation uncertainty', async () => {
  const original = globalThis.fetch; globalThis.fetch = async () => { throw new TypeError('offline'); };
  try { await assert.rejects(listDbConnections(), error => error instanceof DbLinkRequestError && !error.uncertain); }
  finally { globalThis.fetch = original; }
});

test('db-link client freezes Host-resolved references and canonical targets before one grant, then reconciles a lost response by reading only', async () => {
  const original = globalThis.fetch, calls: { url: string; method: string; body?: unknown }[] = [], canonical = `outlet:${'a'.repeat(64)}`;
  const input: DbLinkProjectGrantInput = { connectionId: 'connection-a', connectionRevision: 1, scope: { objects: ['public.orders'] }, modelExport: { targets: ['synthetic'], structure: true, comments: false, queryText: true, results: true } };
  const observed = { connection: { id: 'connection-a', revision: 1, fingerprint: 'exact' }, grant: { projectId: 'project-a', connectionId: 'connection-a', connectionRevision: 1, connectionFingerprint: 'exact', revokedAt: null }, scope: input.scope, modelExport: { ...input.modelExport, targets: [canonical] } } as DbLinkSource;
  globalThis.fetch = async (url, options) => { const method = options?.method ?? 'GET'; calls.push({ url: String(url), method, body: options?.body ? JSON.parse(String(options.body)) : undefined }); if (String(url).includes('/model-targets?')) return new Response(JSON.stringify({ targets: ['synthetic@7'], canonicalTargets: [canonical] })); if (method === 'POST') throw new TypeError('committed response lost'); return new Response(JSON.stringify({ sources: [observed], currentModelTarget: { reference: 'synthetic@7', canonical } })); };
  try {
    const prepared = await prepareDbGrant('project-a', input);
    assert.deepEqual(prepared.input.modelExport.targets, ['synthetic@7']); assert.deepEqual(prepared.expected.modelExport.targets, [canonical]);
    input.modelExport.targets[0] = 'different'; assert.deepEqual(prepared.input.modelExport.targets, ['synthetic@7']);
    await assert.rejects(grantDbSource('project-a', prepared.input), error => error instanceof DbLinkRequestError && error.uncertain);
    const current = await listDbSources('project-a'); assert.equal(dbGrantMatches(current.projectSources[0], prepared.expected), true); assert.equal(dbModelTargetAllowed(current.currentModelTarget, current.sources[0]), true);
    assert.equal(dbModelTargetAllowed({ reference: 'synthetic@8', canonical: `outlet:${'b'.repeat(64)}` }, current.sources[0]), false);
    assert.equal(calls.filter(call => call.method === 'POST').length, 1); assert.deepEqual((calls.find(call => call.method === 'POST')?.body as DbLinkProjectGrantInput).modelExport.targets, ['synthetic@7']);
  } finally { globalThis.fetch = original; }
});
