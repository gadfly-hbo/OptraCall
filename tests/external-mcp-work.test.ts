import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { fetch as undiciFetch, Agent } from 'undici';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { createExternalMcpServer } from '../src/host/external-mcp/server.ts';
import { createExternalMcpOAuth } from '../src/host/external-mcp/oauth.ts';
import { createAssetIntersection, sha256Hex } from '../src/host/external-mcp/intersection.ts';
import { registerAssetTools } from '../src/host/external-mcp/asset-tools.ts';
import type { OriginalAssetReader } from '../src/host/external-mcp/asset-tools.ts';
import { registerWorkTools } from '../src/host/external-mcp/work-tools.ts';
import { ExternalWorkStore } from '../src/host/external-work-store.ts';
import type { ExternalAssetRef, WorkGrant } from '../src/host/external-work-types.ts';

// S3b 工程隔离集成测试：work.read/claim/renew/release/deliver 接 S1 台账 CAS
// （spec §6/§8、AB06/AB11）。合成 store 与 TLS/OAuth 闭环，不访问真实网络或凭据。

const execFileAsync = promisify(execFile);

const MANAGEMENT_TOKEN = 'synthetic-management-approval-token';
const VERIFIER = 'cccccccccccccccccccccccccccccccccccccccccccccc3';
const PRINCIPAL_A = 'executor-a-synthetic';
const PRINCIPAL_B = 'executor-b-synthetic';
const PRINCIPAL_C = 'executor-c-synthetic';

const clients = [
  { clientId: PRINCIPAL_A, redirectUris: ['https://a.example.invalid/cb'], scopes: ['mcp'] },
  { clientId: PRINCIPAL_B, redirectUris: ['https://b.example.invalid/cb'], scopes: ['mcp'] },
  { clientId: PRINCIPAL_C, redirectUris: ['https://c.example.invalid/cb'], scopes: ['mcp'] },
];

const T0 = Date.parse('2026-12-01T08:00:00.000Z');
const HOUR = 3_600_000;
const iso = (ms: number) => new Date(ms).toISOString();
const sha = (value: string) => sha256Hex(value);
const ref = (id: string): ExternalAssetRef => ({ authority: 'optracall/studio', id, version: 'published-v1', hash: sha(`asset:${id}`) });
const FACTS = { done: ['合成事项A'], notDone: [], failed: [], unknown: [] };

let tlsMaterial: { key: string; cert: string };

test.before(async () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'optracall-s3b-work-tls-'));
  await execFileAsync('openssl', [
    'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '2',
    '-keyout', path.join(directory, 'key.pem'), '-out', path.join(directory, 'cert.pem'),
    '-subj', '/CN=127.0.0.1', '-addext', 'subjectAltName=IP:127.0.0.1,DNS:localhost',
  ]);
  tlsMaterial = {
    key: readFileSync(path.join(directory, 'key.pem'), 'utf8'),
    cert: readFileSync(path.join(directory, 'cert.pem'), 'utf8'),
  };
  await rm(directory, { recursive: true, force: true }).catch(() => {});
});

const insecureDispatcher = new Agent({ connect: { rejectUnauthorized: false } });

interface Rig {
  origin: string;
  clock: { now: number };
  store: ExternalWorkStore;
  clientA: Client;
  clientB: Client;
  clientC: Client;
  claim: { claimId: string; epoch: number };
  close(): Promise<void>;
}

async function mintToken(origin: string, clientId: string): Promise<string> {
  const challenge = Buffer.from(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(VERIFIER))).toString('base64url');
  const client = clients.find(item => item.clientId === clientId)!;
  const authorizeUrl = new URL(`${origin}/authorize`);
  authorizeUrl.searchParams.set('client_id', clientId);
  authorizeUrl.searchParams.set('redirect_uri', client.redirectUris[0]!);
  authorizeUrl.searchParams.set('response_type', 'code');
  authorizeUrl.searchParams.set('code_challenge', challenge);
  authorizeUrl.searchParams.set('code_challenge_method', 'S256');
  const pending = await (await undiciFetch(authorizeUrl, { dispatcher: insecureDispatcher })).json() as { pending_id: string };
  const approve = await undiciFetch(`${origin}/approve`, {
    method: 'POST', dispatcher: insecureDispatcher,
    headers: { 'content-type': 'application/json', 'x-optracall-management-token': MANAGEMENT_TOKEN },
    body: JSON.stringify({ pendingId: pending.pending_id, operatorId: 'synthetic-operator' }),
  });
  assert.equal(approve.status, 200);
  const { code } = await approve.json() as { code: string };
  const tokenResponse = await undiciFetch(`${origin}/token`, {
    method: 'POST', dispatcher: insecureDispatcher,
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'authorization_code', client_id: clientId, code, code_verifier: VERIFIER, redirect_uri: client.redirectUris[0]!, resource: `${origin}/mcp` }).toString(),
  });
  assert.equal(tokenResponse.status, 200);
  const { access_token } = await tokenResponse.json() as { access_token: string };
  return access_token;
}

async function connect(origin: string, token: string): Promise<Client> {
  const insecureFetch = ((url: string | URL, init?: RequestInit) => undiciFetch(url, { ...init, dispatcher: insecureDispatcher } as never)) as unknown as typeof fetch;
  const transport = new StreamableHTTPClientTransport(new URL(`${origin}/mcp`), { requestInit: { headers: { authorization: `Bearer ${token}` } }, fetch: insecureFetch });
  const client = new Client({ name: 'synthetic-s3b-work-client', version: '1.0.0' });
  await client.connect(transport);
  return client;
}

async function expectDenied(client: Client, tool: string, args: Record<string, unknown>, code: string): Promise<Record<string, unknown>> {
  const call = await client.callTool({ name: tool, arguments: args });
  assert.equal(call.isError, true, `${tool} must be denied with ${code}, got: ${JSON.stringify(call.structuredContent ?? call.content)}`);
  const payload = call.structuredContent as Record<string, unknown>;
  assert.equal(payload.denied, code, `expected denial ${code}, got ${JSON.stringify(payload)}`);
  return payload;
}

async function expectOk(client: Client, tool: string, args: Record<string, unknown>): Promise<Record<string, unknown>> {
  const call = await client.callTool({ name: tool, arguments: args });
  assert.equal(call.isError, undefined, `${tool} must succeed, got: ${JSON.stringify(call.structuredContent ?? call.content)}`);
  return call.structuredContent as Record<string, unknown>;
}

/** 建一份授权 + work + 已发布 publication（可覆盖执行者集合/企业）。 */
async function seedWork(store: ExternalWorkStore, clock: { now: number }, suffix: string, options: { allowedExecutors?: string[]; enterprise?: string; publish?: boolean } = {}): Promise<void> {
  const grant: WorkGrant = {
    grantId: `grant-${suffix}`, grantVersion: 1, projectId: `project-${suffix}`, taskId: `task-${suffix}`,
    goal: `合成目标 ${suffix}`, scope: '仅限合成范围', forbidden: '',
    allowedExecutors: options.allowedExecutors ?? [PRINCIPAL_A, PRINCIPAL_B],
    repository: { stableId: 'openai/synthetic', visibility: 'private' },
    assetRefs: [ref('metric-1')], enterprise: options.enterprise ?? '合成企业甲',
    validFrom: iso(clock.now), validUntil: iso(clock.now + 48 * HOUR),
    resourcePolicy: { maxWorks: 1, windowHours: 24 }, autoResumeAllowed: true, createdAt: iso(clock.now),
  };
  await store.createGrantWithWork(grant, {
    workId: `work-${suffix}`, projectId: grant.projectId, taskId: grant.taskId, revision: 1,
    summary: `合成摘要 ${suffix}`, deliveryCriteria: '合成交付标准', inputs: [ref('metric-1')],
    grantId: grant.grantId, grantVersion: grant.grantVersion, status: 'authorized',
    createdAt: iso(clock.now), updatedAt: iso(clock.now),
  });
  if (options.publish !== false) {
    const attempt = await store.recordPublication({ workId: `work-${suffix}`, revision: 1, action: 'issue-create', bodyHash: sha(`issue-${suffix}`) });
    await store.transitionPublication(attempt.operationId, 'submitted', { expectedStatus: 'prepared' });
    await store.transitionPublication(attempt.operationId, 'succeeded', { expectedStatus: 'submitted', resultRef: { repositoryId: 'openai/synthetic', issueId: `10${suffix}` } });
  }
}

const deliverArgs = (r: Rig, overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  workId: 'work-1', revision: 1, claimId: r.claim.claimId, epoch: r.claim.epoch,
  idempotencyKey: 'delivery-key-1',
  manifest: { files: [{ path: 'reports/result.txt', sha256: sha('result-bytes'), bytes: 12 }] },
  facts: { ...FACTS }, ...overrides,
});

async function rig(t: { after(fn: () => Promise<void>): void }): Promise<Rig> {
  const clock = { now: T0 };
  const now = () => clock.now;
  const dataRoot = await mkdtemp(path.join(tmpdir(), 'optracall-s3b-work-store-'));
  t.after(() => rm(dataRoot, { recursive: true, force: true }));
  const store = new ExternalWorkStore({ dataRoot, now });
  await store.init();
  await seedWork(store, clock, '1');
  const reader: OriginalAssetReader = {
    async catalog(refs) { return refs.map(item => ({ ref: item, title: item.id, applicability: 'x', sha256: item.hash, source: 'synthetic' })); },
    async read(item) { return { title: item.id, body: 'b', sha256: item.hash, source: 'synthetic', limitations: [] }; },
    async readSource(item) { return { title: item.id, fragment: 'b', sha256: item.hash, locator: 'l', source: 's', limitations: [] }; },
    async trace() { return []; },
  };
  const intersection = createAssetIntersection({ store, qualify: async () => ({ ok: true }), now });
  const entry = createExternalMcpServer({
    tls: tlsMaterial,
    managementApprovalToken: MANAGEMENT_TOKEN,
    rateLimit: { windowMs: 60_000, max: 1_000_000 },
    clock: now,
    createOauth: origin => createExternalMcpOAuth({ issuer: origin, resource: `${origin}/mcp`, clients, signingKey: 'synthetic-signing-key', managementApprovalToken: MANAGEMENT_TOKEN, accessTokenTtlSeconds: 100 * 24 * 3600, clock: () => Math.floor(clock.now / 1000) }),
    registerTools: server => {
      registerAssetTools(server, { intersection, reader, now });
      registerWorkTools(server, { store, now });
    },
  });
  await entry.listen({ port: 0, hostname: '127.0.0.1' });
  t.after(() => entry.close());
  const clientA = await connect(entry.origin, await mintToken(entry.origin, PRINCIPAL_A));
  const clientB = await connect(entry.origin, await mintToken(entry.origin, PRINCIPAL_B));
  const clientC = await connect(entry.origin, await mintToken(entry.origin, PRINCIPAL_C));
  t.after(async () => { await Promise.all([clientA.close(), clientB.close(), clientC.close()]); });
  const claimed = await expectOk(clientA, 'work.claim', { workId: 'work-1' }) as { claimId: string; epoch: number };
  return { origin: entry.origin, clock, store, clientA, clientB, clientC, claim: { claimId: claimed.claimId, epoch: claimed.epoch }, close: () => entry.close() };
}

test('work.read lists only explicitly allowed works; others see an empty catalog', async t => {
  const r = await rig(t);
  await seedWork(r.store, r.clock, '2', { allowedExecutors: [PRINCIPAL_B], enterprise: '合成企业乙' });
  const asA = await expectOk(r.clientA, 'work.read', {}) as { works: Array<Record<string, unknown>> };
  assert.deepEqual(asA.works.map(work => work.workId), ['work-1'], 'another task/enterprise work must not be listed');
  const entry = asA.works[0]!;
  assert.equal(entry.phase, 'claimed-by-you');
  assert.equal(entry.publication, 'published');
  const asB = await expectOk(r.clientB, 'work.read', {}) as { works: Array<Record<string, unknown>> };
  assert.deepEqual(asB.works.map(work => work.workId).sort(), ['work-1', 'work-2']);
  const asC = await expectOk(r.clientC, 'work.read', {}) as { works: unknown[] };
  assert.equal(asC.works.length, 0);
});

test('concurrent claims admit exactly one winner; the competitor receives a conflict', async t => {
  const r = await rig(t);
  await r.store.releaseClaim({ workId: 'work-1', revision: 1, claimId: r.claim.claimId, epoch: r.claim.epoch, reason: 'setup' });
  const results = await Promise.allSettled([
    expectOk(r.clientA, 'work.claim', { workId: 'work-1' }),
    expectOk(r.clientB, 'work.claim', { workId: 'work-1' }),
  ]);
  const fulfilled = results.filter(result => result.status === 'fulfilled');
  const rejected = results.filter(result => result.status === 'rejected');
  assert.equal(fulfilled.length, 1, 'exactly one claim may win');
  assert.equal(rejected.length, 1);
  assert.match(String((rejected[0] as PromiseRejectedResult).reason), /external_claim_conflict/);
});

test('repeated claim by the same principal returns the original receipt', async t => {
  const r = await rig(t);
  const again = await expectOk(r.clientA, 'work.claim', { workId: 'work-1' }) as Record<string, unknown>;
  assert.equal(again.claimId, r.claim.claimId);
  assert.equal(again.idempotent, true);
  assert.equal(again.principal, PRINCIPAL_A);
});

test('self-reported identity is ignored; the verified token principal is the only identity', async t => {
  const r = await rig(t);
  // C 不在允许集合：自报成 A 也不被接受。
  await expectDenied(r.clientC, 'work.claim', { workId: 'work-1', principal: PRINCIPAL_A }, 'external_claim_not_permitted');
  // A 自报成 B：实际领取人仍是服务端核验的 A。
  const claimed = await expectOk(r.clientA, 'work.claim', { workId: 'work-1', principal: PRINCIPAL_B }) as Record<string, unknown>;
  const stored = await r.store.getClaim(String(claimed.claimId));
  assert.equal(stored?.principal, PRINCIPAL_A, 'the ledger must record the server-verified principal, never the self-reported name');
  assert.equal(claimed.principal, PRINCIPAL_A);
});

test('claim requires a published, verified work: pending and unknown publications are refused', async t => {
  const r = await rig(t);
  await seedWork(r.store, r.clock, 'unpub', { publish: false });
  await expectDenied(r.clientA, 'work.claim', { workId: 'work-unpub' }, 'external_claim_not_permitted');
  const unknown = await r.store.recordPublication({ workId: 'work-1', revision: 1, action: 'issue-comment', bodyHash: sha('comment-body') });
  await r.store.transitionPublication(unknown.operationId, 'submitted', { expectedStatus: 'prepared' });
  await r.store.transitionPublication(unknown.operationId, 'unknown', { expectedStatus: 'submitted' });
  await r.store.releaseClaim({ workId: 'work-1', revision: 1, claimId: r.claim.claimId, epoch: r.claim.epoch, reason: 'setup' });
  await expectDenied(r.clientA, 'work.claim', { workId: 'work-1' }, 'external_work_unverified_action');
  // 只读核对核定后恢复可领取。
  await r.store.transitionPublication(unknown.operationId, 'succeeded', { expectedStatus: 'unknown', reconciled: true, resultRef: { repositoryId: 'openai/synthetic', issueId: '101' } });
  const ok = await expectOk(r.clientA, 'work.claim', { workId: 'work-1' }) as Record<string, unknown>;
  assert.equal(typeof ok.claimId, 'string');
});

test('cancelled work and expired grants refuse new claims', async t => {
  const r = await rig(t);
  await r.store.cancelWork('work-1', 'user-cancel');
  await expectDenied(r.clientB, 'work.claim', { workId: 'work-1' }, 'external_work_cancelled');
  const r2 = await rig(t);
  r2.clock.now += 49 * HOUR;
  await expectDenied(r2.clientA, 'work.claim', { workId: 'work-1' }, 'external_grant_not_valid');
});

test('renew verifies current claimant, epoch and timeliness; expiry facts are persisted before denial', async t => {
  const r = await rig(t);
  const renewed = await expectOk(r.clientA, 'work.renew', { workId: 'work-1', claimId: r.claim.claimId, epoch: r.claim.epoch }) as Record<string, unknown>;
  assert.ok(Date.parse(String(renewed.leaseDeadline)) > r.clock.now);
  await expectDenied(r.clientA, 'work.renew', { workId: 'work-1', claimId: r.claim.claimId, epoch: 42 }, 'external_claim_epoch_conflict');
  await expectDenied(r.clientB, 'work.renew', { workId: 'work-1', claimId: r.claim.claimId, epoch: r.claim.epoch }, 'external_work_claim_not_owned');
  const shortRig = await rig(t);
  await shortRig.store.releaseClaim({ workId: 'work-1', revision: 1, claimId: shortRig.claim.claimId, epoch: shortRig.claim.epoch, reason: 'setup' });
  const short = await shortRig.store.recordClaim({ workId: 'work-1', revision: 1, principal: PRINCIPAL_A, leaseDeadline: iso(shortRig.clock.now + 1_000) });
  shortRig.clock.now += 2_000;
  await expectDenied(shortRig.clientA, 'work.renew', { workId: 'work-1', claimId: short.claim.claimId, epoch: short.claim.epoch }, 'external_claim_expired');
  const persisted = await shortRig.store.getClaim(short.claim.claimId);
  assert.equal(persisted?.status, 'expired', 'the expiry fact must be durably recorded, not just reported');
});

test('release is owner-only; releasing again conflicts and release never proves real completion', async t => {
  const r = await rig(t);
  const released = await expectOk(r.clientA, 'work.release', { workId: 'work-1', claimId: r.claim.claimId, epoch: r.claim.epoch, reason: 'done' }) as Record<string, unknown>;
  assert.equal(released.status, 'released');
  assert.ok(String(released.note ?? '').includes('不证明'), 'the response must state release does not prove the real operation ended');
  await expectDenied(r.clientA, 'work.release', { workId: 'work-1', claimId: r.claim.claimId, epoch: r.claim.epoch, reason: 'again' }, 'external_claim_conflict');
  await expectDenied(r.clientB, 'work.release', { workId: 'work-1', claimId: r.claim.claimId, epoch: r.claim.epoch, reason: 'x' }, 'external_work_claim_not_owned');
  // 释放后可再次领取，epoch 递增。
  const next = await expectOk(r.clientA, 'work.claim', { workId: 'work-1' }) as Record<string, unknown>;
  assert.equal(next.epoch, 2);
});

test('deliver binds the current claim and manifest; idempotency returns the original receipt or conflicts', async t => {
  const r = await rig(t);
  const first = await expectOk(r.clientA, 'work.deliver', deliverArgs(r)) as Record<string, unknown>;
  assert.equal(first.preservation, 'pending', 'byte preservation is a later slice; a manifest-only receipt is never marked preserved');
  assert.equal(first.late, false);
  const repeat = await expectOk(r.clientA, 'work.deliver', deliverArgs(r)) as Record<string, unknown>;
  assert.equal(repeat.deliveryId, first.deliveryId, 'same key + same content returns the original receipt');
  assert.equal(repeat.idempotent, true);
  await expectDenied(r.clientA, 'work.deliver', deliverArgs(r, { manifest: { files: [{ path: 'reports/result.txt', sha256: sha('result-bytes'), bytes: 12 }, { path: 'extra.txt', sha256: sha('extra'), bytes: 1 }] } }), 'external_delivery_conflict');
  const stored = await r.store.getDelivery(String(first.deliveryId));
  assert.equal(stored?.preservation, 'pending');
  assert.equal(stored?.facts.done.length, 1);
});

test('deliver verifies principal, epoch and current work revision', async t => {
  const r = await rig(t);
  await expectDenied(r.clientA, 'work.deliver', deliverArgs(r, { epoch: 99 }), 'external_delivery_epoch_conflict');
  await expectDenied(r.clientB, 'work.deliver', deliverArgs(r, { claimId: r.claim.claimId }), 'external_work_claim_not_owned');
  // 旧 revision 领取在修订晋升后失去有效资格。
  await r.store.mutate(state => { const work = state.works.find(item => item.workId === 'work-1'); if (work) { work.revision = 2; work.updatedAt = iso(r.clock.now); } });
  await expectDenied(r.clientA, 'work.deliver', deliverArgs(r), 'external_work_claim_stale_revision');
});

test('deliver enforces file-count, size, manifest-size, path and URL limits', async t => {
  const r = await rig(t);
  const files21 = Array.from({ length: 21 }, (_, index) => ({ path: `f${index}.txt`, sha256: sha(`f${index}`), bytes: 1 }));
  await expectDenied(r.clientA, 'work.deliver', deliverArgs(r, { manifest: { files: files21 } }), 'external_delivery_limit_exceeded');
  await expectDenied(r.clientA, 'work.deliver', deliverArgs(r, { manifest: { files: [{ path: 'big.bin', sha256: sha('big'), bytes: 51 * 1024 * 1024 }] } }), 'external_delivery_limit_exceeded');
  await expectDenied(r.clientA, 'work.deliver', deliverArgs(r, { manifest: { files: Array.from({ length: 20 }, (_, index) => ({ path: `f${index}.txt`, sha256: sha(`f${index}`), bytes: 6 * 1024 * 1024 })) } }), 'external_delivery_limit_exceeded');
  await expectDenied(r.clientA, 'work.deliver', deliverArgs(r, { manifest: { files: [{ path: 'ok.txt', sha256: sha('x'), bytes: 1 }], notes: 'x'.repeat(270_000) } }), 'external_delivery_manifest_limit');
  for (const badPath of ['../evil.txt', '/abs/path.txt', 'a/../b.txt', 'dir\\file.txt', 'C:\\temp\\x.txt']) {
    await expectDenied(r.clientA, 'work.deliver', deliverArgs(r, { manifest: { files: [{ path: badPath, sha256: sha('x'), bytes: 1 }] } }), 'external_delivery_path_rejected');
  }
  await expectDenied(r.clientA, 'work.deliver', deliverArgs(r, { manifest: { files: [{ path: 'ok.txt', sha256: sha('x'), bytes: 1, url: 'https://attacker.example.invalid/payload' }] } }), 'external_delivery_url_rejected');
  await expectDenied(r.clientA, 'work.deliver', { ...deliverArgs(r), facts: undefined, note: 'facts omitted' }, 'external_delivery_facts_required');
  await expectDenied(r.clientA, 'work.deliver', deliverArgs(r, { assetsUsed: [ref('metric-9')] }), 'external_delivery_asset_out_of_scope');
});

test('missing pieces keep preservation pending and are never marked preserved', async t => {
  const r = await rig(t);
  const partial = await expectOk(r.clientA, 'work.deliver', deliverArgs(r, { facts: { done: [], notDone: ['第二条证据未取得'], failed: [], unknown: [] } })) as Record<string, unknown>;
  assert.equal(partial.preservation, 'pending');
  const stored = await r.store.getDelivery(String(partial.deliveryId));
  assert.equal(stored?.preservation, 'pending', 'incomplete deliveries must not be marked preserved');
});

test('old-epoch late evidence is isolated: recorded as late, never overrides the current delivery, and never restores asset eligibility', async t => {
  const r = await rig(t);
  await r.store.releaseClaim({ workId: 'work-1', revision: 1, claimId: r.claim.claimId, epoch: r.claim.epoch, reason: 'done-before-deliver' });
  // 历史已授权身份（同一 principal）可提交隔离迟到证据。
  const late = await expectOk(r.clientA, 'work.deliver', deliverArgs(r)) as Record<string, unknown>;
  assert.equal(late.late, true);
  assert.equal(late.preservation, 'pending');
  // 其他 principal 不能借这条历史 claimId 保存任意人材料。
  await expectDenied(r.clientC, 'work.deliver', deliverArgs(r, { idempotencyKey: 'other-key' }), 'external_work_claim_not_owned');
  // 新 epoch 的当前交付不被迟到证据覆盖。
  const fresh = await expectOk(r.clientB, 'work.claim', { workId: 'work-1' }) as Record<string, unknown>;
  const current = await expectOk(r.clientB, 'work.deliver', deliverArgs(r, { claimId: String(fresh.claimId), epoch: Number(fresh.epoch), idempotencyKey: 'current-key' })) as Record<string, unknown>;
  assert.equal(current.late, false);
  assert.notEqual(current.deliveryId, late.deliveryId);
  const storedLate = await r.store.getDelivery(String(late.deliveryId));
  const storedCurrent = await r.store.getDelivery(String(current.deliveryId));
  assert.equal(storedLate?.late, true);
  assert.equal(storedCurrent?.late, false);
  const claimAfterLate = await r.store.getClaim(r.claim.claimId);
  assert.equal(claimAfterLate?.status, 'released', 'late evidence must not reactivate the old claim or restore eligibility');
});
