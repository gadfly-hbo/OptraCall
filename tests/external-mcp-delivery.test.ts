import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import { fetch as undiciFetch, Agent } from 'undici';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { createExternalMcpServer } from '../src/host/external-mcp/server.ts';
import { createExternalMcpOAuth } from '../src/host/external-mcp/oauth.ts';
import { registerWorkTools } from '../src/host/external-mcp/work-tools.ts';
import { registerDeliveryTools } from '../src/host/external-mcp/delivery-tools.ts';
import { ExternalWorkStore } from '../src/host/external-work-store.ts';
import { EXTERNAL_DELIVERY_LIMITS } from '../src/host/external-delivery.ts';
import type { ExternalAssetRef, ExternalWork, WorkGrant } from '../src/host/external-work-types.ts';

// S4a 工程隔离集成测试：delivery.begin / delivery.upload-chunk / delivery.commit 经 S3a
// 受保护 MCP 入口（TLS + OAuth 2.1 + Bearer）完成 chunked 上传 → 保全闭环（spec §8 / AB11）。
// 合成 store / TLS / OAuth，不访问真实网络或凭据。

const execFileAsync = promisify(execFile);

const MANAGEMENT_TOKEN = 'synthetic-management-approval-token';
const VERIFIER = 'cccccccccccccccccccccccccccccccccccccccccccccc3';
const PRINCIPAL_A = 'executor-a-synthetic';
const PRINCIPAL_B = 'executor-b-synthetic';

const clients = [
  { clientId: PRINCIPAL_A, redirectUris: ['https://a.example.invalid/cb'], scopes: ['mcp'] },
  { clientId: PRINCIPAL_B, redirectUris: ['https://b.example.invalid/cb'], scopes: ['mcp'] },
];

const T0 = Date.parse('2026-12-01T08:00:00.000Z');
const HOUR = 3_600_000;
const iso = (ms: number) => new Date(ms).toISOString();
const sha256 = (value: Buffer | string) => createHash('sha256').update(value).digest('hex');
const ref = (id: string): ExternalAssetRef => ({ authority: 'optracall/studio', id, version: 'published-v1', hash: sha256(`asset:${id}`) });
const FACTS = { done: ['合成事项A'], notDone: [], failed: [], unknown: [] };

let tlsMaterial: { key: string; cert: string };

test.before(async () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'optracall-s4a-mcp-tls-'));
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
  dataRoot: string;
  clientA: Client;
  clientB: Client;
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
  const client = new Client({ name: 'synthetic-s4a-delivery-client', version: '1.0.0' });
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

async function seedWork(store: ExternalWorkStore, clock: { now: number }): Promise<void> {
  const grant: WorkGrant = {
    grantId: 'grant-1', grantVersion: 1, projectId: 'project-1', taskId: 'task-1',
    goal: '合成目标', scope: '仅限合成范围', forbidden: '',
    allowedExecutors: [PRINCIPAL_A, PRINCIPAL_B],
    repository: { stableId: 'openai/synthetic', visibility: 'private' },
    assetRefs: [ref('metric-1')], enterprise: '合成企业甲',
    validFrom: iso(clock.now), validUntil: iso(clock.now + 48 * HOUR),
    resourcePolicy: { maxWorks: 1, windowHours: 24 }, autoResumeAllowed: true, createdAt: iso(clock.now),
  };
  await store.createGrantWithWork(grant, {
    workId: 'work-1', projectId: grant.projectId, taskId: grant.taskId, revision: 1,
    summary: '合成摘要', deliveryCriteria: '合成交付标准', inputs: [ref('metric-1')],
    grantId: grant.grantId, grantVersion: grant.grantVersion, status: 'authorized',
    createdAt: iso(clock.now), updatedAt: iso(clock.now),
  } satisfies ExternalWork);
  const attempt = await store.recordPublication({ workId: 'work-1', revision: 1, action: 'issue-create', bodyHash: sha256('issue-1') });
  await store.transitionPublication(attempt.operationId, 'submitted', { expectedStatus: 'prepared' });
  await store.transitionPublication(attempt.operationId, 'succeeded', { expectedStatus: 'submitted', resultRef: { repositoryId: 'openai/synthetic', issueId: '101' } });
}

async function rig(t: { after(fn: () => Promise<void>): void }): Promise<Rig> {
  const clock = { now: T0 };
  const now = () => clock.now;
  const dataRoot = await mkdtemp(path.join(tmpdir(), 'optracall-s4a-mcp-store-'));
  t.after(() => rm(dataRoot, { recursive: true, force: true }));
  const store = new ExternalWorkStore({ dataRoot, now });
  await store.init();
  await seedWork(store, clock);
  const entry = createExternalMcpServer({
    tls: tlsMaterial,
    managementApprovalToken: MANAGEMENT_TOKEN,
    rateLimit: { windowMs: 60_000, max: 1_000_000 },
    clock: now,
    createOauth: origin => createExternalMcpOAuth({ issuer: origin, resource: `${origin}/mcp`, clients, signingKey: 'synthetic-signing-key', managementApprovalToken: MANAGEMENT_TOKEN, accessTokenTtlSeconds: 100 * 24 * 3600, clock: () => Math.floor(clock.now / 1000) }),
    registerTools: server => {
      registerWorkTools(server, { store, now });
      registerDeliveryTools(server, { store, dataRoot, now });
    },
  });
  await entry.listen({ port: 0, hostname: '127.0.0.1' });
  t.after(() => entry.close());
  const clientA = await connect(entry.origin, await mintToken(entry.origin, PRINCIPAL_A));
  const clientB = await connect(entry.origin, await mintToken(entry.origin, PRINCIPAL_B));
  t.after(async () => { await Promise.all([clientA.close(), clientB.close()]); });
  const claimed = await expectOk(clientA, 'work.claim', { workId: 'work-1' }) as { claimId: string; epoch: number };
  return { origin: entry.origin, clock, store, dataRoot, clientA, clientB, claim: { claimId: claimed.claimId, epoch: claimed.epoch }, close: () => entry.close() };
}

const claimOf = (r: Rig) => ({ workId: 'work-1', claimId: r.claim.claimId, epoch: r.claim.epoch });

async function uploadViaMcp(r: Rig, client: Client, claim: { workId: string; claimId: string; epoch: number }, logicalPath: string, content: Buffer): Promise<{ uploadId: string }> {
  const began = await expectOk(client, 'delivery.begin', {
    workId: claim.workId, claimId: claim.claimId, epoch: claim.epoch, fileName: logicalPath, totalBytes: content.length, sha256: sha256(content),
  }) as { uploadId: string; chunkBytes: number; totalChunks: number };
  const chunk = EXTERNAL_DELIVERY_LIMITS.maxChunkBytes;
  for (let offset = 0; offset < content.length; offset += chunk) {
    const slice = content.subarray(offset, Math.min(offset + chunk, content.length));
    await expectOk(client, 'delivery.upload-chunk', {
      workId: claim.workId, claimId: claim.claimId, epoch: claim.epoch, uploadId: began.uploadId, offset, sha256: sha256(slice), bytesBase64: slice.toString('base64'),
    });
  }
  return { uploadId: began.uploadId };
}

test('standard MCP client preserves delivery bytes end to end: claim → begin → chunks → commit → preserved', async t => {
  const r = await rig(t);
  const content = Buffer.alloc(EXTERNAL_DELIVERY_LIMITS.maxChunkBytes + 42, 9);
  const { uploadId } = await uploadViaMcp(r, r.clientA, claimOf(r), 'reports/final.txt', content);
  const receipt = await expectOk(r.clientA, 'delivery.commit', {
    ...claimOf(r), revision: 1, idempotencyKey: 'mcp-key-1',
    manifest: { files: [{ path: 'reports/final.txt', sha256: sha256(content), bytes: content.length, uploadId }] },
    facts: { ...FACTS },
  }) as { kind: string; deliveryId: string; preservation: string; late: boolean; storage?: Array<{ relativePath: string; sha256: string; bytes: number }> };
  assert.equal(receipt.kind, 'external-delivery');
  assert.equal(receipt.preservation, 'preserved');
  assert.equal(receipt.late, false);
  const stored = await r.store.getDelivery(receipt.deliveryId);
  assert.equal(stored?.preservation, 'preserved');
  const relativePath = stored?.storage?.[0]?.relativePath ?? '';
  assert.ok(relativePath.startsWith('d/'));
  const bytes = await import('node:fs/promises').then(fs => fs.readFile(path.join(r.dataRoot, 'external-delivery', relativePath)));
  assert.equal(sha256(bytes), sha256(content));
});

test('commit verifies the server-verified principal and epoch: foreign or stale callers are denied', async t => {
  const r = await rig(t);
  const content = Buffer.from('owned-body', 'utf8');
  const { uploadId } = await uploadViaMcp(r, r.clientA, claimOf(r), 'a/body.txt', content);
  await expectDenied(r.clientB, 'delivery.commit', {
    ...claimOf(r), revision: 1, idempotencyKey: 'foreign-key',
    manifest: { files: [{ path: 'a/body.txt', sha256: sha256(content), bytes: content.length, uploadId }] },
    facts: { ...FACTS },
  }, 'external_work_claim_not_owned');
  await expectDenied(r.clientA, 'delivery.commit', {
    ...claimOf(r), epoch: 99, revision: 1, idempotencyKey: 'epoch-key',
    manifest: { files: [{ path: 'a/body.txt', sha256: sha256(content), bytes: content.length, uploadId }] },
    facts: { ...FACTS },
  }, 'external_delivery_epoch_conflict');
  await expectDenied(r.clientB, 'delivery.upload-chunk', {
    ...claimOf(r), uploadId, offset: 0, sha256: sha256(content), bytesBase64: content.toString('base64'),
  }, 'external_work_claim_not_owned');
});

test('chunk, file-count and path limits are enforced over MCP', async t => {
  const r = await rig(t);
  const oversized = Buffer.alloc(EXTERNAL_DELIVERY_LIMITS.maxChunkBytes + 1, 3);
  const session = await expectOk(r.clientA, 'delivery.begin', {
    ...claimOf(r), fileName: 'big.bin', totalBytes: oversized.length, sha256: sha256(oversized),
  }) as { uploadId: string };
  await expectDenied(r.clientA, 'delivery.upload-chunk', {
    ...claimOf(r), uploadId: session.uploadId, offset: 0, sha256: sha256(oversized), bytesBase64: oversized.toString('base64'),
  }, 'external_delivery_limit_exceeded');
  const files21 = Array.from({ length: 21 }, (_, index) => ({ path: `f${index}.txt`, link: `https://links.example.invalid/${index}` }));
  await expectDenied(r.clientA, 'delivery.commit', {
    ...claimOf(r), revision: 1, idempotencyKey: 'count-key',
    manifest: { files: files21 }, facts: { ...FACTS },
  }, 'external_delivery_limit_exceeded');
  await expectDenied(r.clientA, 'delivery.begin', {
    ...claimOf(r), fileName: '../escape.txt', totalBytes: 3, sha256: sha256('abc'),
  }, 'external_delivery_path_rejected');
  await expectDenied(r.clientA, 'delivery.commit', {
    ...claimOf(r), revision: 1, idempotencyKey: 'url-key',
    manifest: { files: [{ path: 'x.txt', sha256: sha256('abc'), bytes: 3, url: 'https://attacker.example.invalid/p' }] },
    facts: { ...FACTS },
  }, 'external_delivery_url_rejected');
});

test('commit idempotency and conflicts behave over MCP', async t => {
  const r = await rig(t);
  const content = Buffer.from('mcp-idem', 'utf8');
  const { uploadId } = await uploadViaMcp(r, r.clientA, claimOf(r), 'i/body.txt', content);
  const manifest = { files: [{ path: 'i/body.txt', sha256: sha256(content), bytes: content.length, uploadId }] };
  const first = await expectOk(r.clientA, 'delivery.commit', {
    ...claimOf(r), revision: 1, idempotencyKey: 'idem-mcp', manifest, facts: { ...FACTS },
  }) as { deliveryId: string };
  const replay = await expectOk(r.clientA, 'delivery.commit', {
    ...claimOf(r), revision: 1, idempotencyKey: 'idem-mcp', manifest, facts: { ...FACTS },
  }) as { deliveryId: string; idempotent: boolean };
  assert.equal(replay.deliveryId, first.deliveryId);
  assert.equal(replay.idempotent, true);
  await expectDenied(r.clientA, 'delivery.commit', {
    ...claimOf(r), revision: 1, idempotencyKey: 'idem-mcp',
    manifest: { files: [{ path: 'i/body.txt', sha256: sha256(content), bytes: content.length, uploadId }, { path: 'z.txt', link: 'https://z.example.invalid/' }] },
    facts: { ...FACTS },
  }, 'external_delivery_conflict');
});

test('missing pieces produce failed receipts over MCP, never preserved, zero bytes on disk', async t => {
  const r = await rig(t);
  const content = Buffer.from('never-uploaded', 'utf8');
  const session = await expectOk(r.clientA, 'delivery.begin', {
    ...claimOf(r), fileName: 'm/missing.txt', totalBytes: content.length, sha256: sha256(content),
  }) as { uploadId: string };
  const receipt = await expectOk(r.clientA, 'delivery.commit', {
    ...claimOf(r), revision: 1, idempotencyKey: 'missing-mcp',
    manifest: { files: [{ path: 'm/missing.txt', sha256: sha256(content), bytes: content.length, uploadId: session.uploadId }] },
    facts: { done: [], notDone: ['第二条证据未取得'], failed: [], unknown: [] },
  }) as { preservation: string; preservationReason?: string };
  assert.equal(receipt.preservation, 'failed');
  assert.equal(receipt.preservationReason, 'missing_pieces');
  const deliveryTree = await import('node:fs/promises').then(fs => fs.readdir(path.join(r.dataRoot, 'external-delivery', 'd'))).catch(() => [] as string[]);
  assert.equal(deliveryTree.length, 0);
});

test('late commit on a released claim is isolated and never overrides the current delivery', async t => {
  const r = await rig(t);
  const lateContent = Buffer.from('late-mcp-body', 'utf8');
  const lateUpload = await uploadViaMcp(r, r.clientA, claimOf(r), 'l/late.txt', lateContent);
  await expectOk(r.clientA, 'work.release', { workId: 'work-1', claimId: r.claim.claimId, epoch: r.claim.epoch, reason: 'done-before-commit' });
  const fresh = await expectOk(r.clientB, 'work.claim', { workId: 'work-1' }) as { claimId: string; epoch: number };
  const currentContent = Buffer.from('current-mcp-body', 'utf8');
  const currentUpload = await uploadViaMcp(r, r.clientB, { workId: 'work-1', claimId: fresh.claimId, epoch: fresh.epoch }, 'c/current.txt', currentContent);
  const current = await expectOk(r.clientB, 'delivery.commit', {
    workId: 'work-1', claimId: fresh.claimId, epoch: fresh.epoch, revision: 1, idempotencyKey: 'current-mcp',
    manifest: { files: [{ path: 'c/current.txt', sha256: sha256(currentContent), bytes: currentContent.length, uploadId: currentUpload.uploadId }] },
    facts: { ...FACTS },
  }) as { preservation: string };
  assert.equal(current.preservation, 'preserved');
  const late = await expectOk(r.clientA, 'delivery.commit', {
    ...claimOf(r), revision: 1, idempotencyKey: 'late-mcp',
    manifest: { files: [{ path: 'l/late.txt', sha256: sha256(lateContent), bytes: lateContent.length, uploadId: lateUpload.uploadId }] },
    facts: { ...FACTS },
  }) as { late: boolean; preservation: string; deliveryId: string };
  assert.equal(late.late, true);
  assert.equal(late.preservation, 'pending', 'late evidence never claims byte preservation');
  const storedLate = await r.store.getDelivery(late.deliveryId);
  assert.ok(!storedLate?.storage);
  const claimAfter = await r.store.getClaim(r.claim.claimId);
  assert.equal(claimAfter?.status, 'released', 'late evidence must not reactivate the old claim');
});

test('link-only commits are recorded without bytes over MCP', async t => {
  const r = await rig(t);
  const receipt = await expectOk(r.clientA, 'delivery.commit', {
    ...claimOf(r), revision: 1, idempotencyKey: 'link-mcp',
    manifest: { files: [{ path: 'refs/page.html', link: 'https://source.example.invalid/page' }] },
    facts: { done: ['外部链接已登记'], notDone: ['字节未传输'], failed: [], unknown: [] },
  }) as { preservation: string };
  assert.equal(receipt.preservation, 'link-only');
  // 目录列出不带正文的逻辑名清单即可，任何下载动作都不存在。
  const workTools = await expectOk(r.clientA, 'work.read', {}) as { works: Array<Record<string, unknown>> };
  assert.equal(workTools.works.length, 1);
});
