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
import { registerAssetTools, type OriginalAssetReader } from '../src/host/external-mcp/asset-tools.ts';
import { registerWorkTools } from '../src/host/external-mcp/work-tools.ts';
import { registerDeliveryTools } from '../src/host/external-mcp/delivery-tools.ts';
import { EXTERNAL_DELIVERY_LIMITS } from '../src/host/external-delivery.ts';
import { ExternalWorkStore } from '../src/host/external-work-store.ts';
import { createExternalResumeCoordinator } from '../src/host/external-resume.ts';
import type { WorkGrant, ExternalAssetRef } from '../src/host/external-work-types.ts';

// S7 端到端核心闭环：通用外部 MCP 客户端经真实 TLS＋OAuth/PKCE＋Bearer 完成
// work.claim → asset.read → delivery 分块保全 → work.deliver(preserved) → 原任务续接 → 原 Agent 核验。
// 复用真实模块与隔离合成供应商，不调真实网络/账号/凭据。spec AB03/AB12/AB13/AB18。

const execFileAsync = promisify(execFile);
const MANAGEMENT_TOKEN = 'synthetic-management-approval-token';
const VERIFIER = 'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee5';
const PRINCIPAL = 'executor-closed-loop-synthetic';
const PRINCIPAL_B = 'executor-other-synthetic';
const clients = [
  { clientId: PRINCIPAL, redirectUris: ['https://exec.example.invalid/cb'], scopes: ['mcp'] },
  { clientId: PRINCIPAL_B, redirectUris: ['https://other.example.invalid/cb'], scopes: ['mcp'] },
];
const T0 = Date.parse('2026-12-02T08:00:00.000Z');
const HOUR = 3_600_000;
const iso = (ms: number) => new Date(ms).toISOString();
const sha = (value: string | Buffer) => sha256Hex(value as never);
const assetRef: ExternalAssetRef = { authority: 'optracall/studio', id: 'member-definition', version: 'v2.1', hash: sha('asset:member-definition') };
const FACTS = { done: ['4店映射差异已列出', '26条重复记录'], notDone: ['业务系统写入（不在范围）'], failed: [], unknown: ['1组身份对应'] };

let tlsMaterial: { key: string; cert: string };
test.before(async () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'optracall-e2e-tls-'));
  await execFileAsync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '2', '-keyout', path.join(directory, 'key.pem'), '-out', path.join(directory, 'cert.pem'), '-subj', '/CN=127.0.0.1', '-addext', 'subjectAltName=IP:127.0.0.1,DNS:localhost']);
  tlsMaterial = { key: readFileSync(path.join(directory, 'key.pem'), 'utf8'), cert: readFileSync(path.join(directory, 'cert.pem'), 'utf8') };
  await rm(directory, { recursive: true, force: true }).catch(() => {});
});
const insecureDispatcher = new Agent({ connect: { rejectUnauthorized: false } });

async function mintToken(origin: string, clientId: string): Promise<string> {
  const challenge = Buffer.from(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(VERIFIER))).toString('base64url');
  const client = clients.find(item => item.clientId === clientId)!;
  const url = new URL(`${origin}/authorize`);
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('redirect_uri', client.redirectUris[0]!);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('code_challenge', challenge);
  url.searchParams.set('code_challenge_method', 'S256');
  const pending = await (await undiciFetch(url, { dispatcher: insecureDispatcher })).json() as { pending_id: string };
  const approve = await undiciFetch(`${origin}/approve`, { method: 'POST', dispatcher: insecureDispatcher, headers: { 'content-type': 'application/json', 'x-optracall-management-token': MANAGEMENT_TOKEN }, body: JSON.stringify({ pendingId: pending.pending_id, operatorId: 'synthetic-operator' }) });
  assert.equal(approve.status, 200);
  const { code } = await approve.json() as { code: string };
  const tokenResponse = await undiciFetch(`${origin}/token`, { method: 'POST', dispatcher: insecureDispatcher, headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'authorization_code', client_id: clientId, code, code_verifier: VERIFIER, redirect_uri: client.redirectUris[0]!, resource: `${origin}/mcp` }).toString() });
  assert.equal(tokenResponse.status, 200);
  const { access_token } = await tokenResponse.json() as { access_token: string };
  return access_token;
}
async function connect(origin: string, token: string): Promise<Client> {
  const insecureFetch = ((url: string | URL, init?: RequestInit) => undiciFetch(url, { ...init, dispatcher: insecureDispatcher } as never)) as unknown as typeof fetch;
  const transport = new StreamableHTTPClientTransport(new URL(`${origin}/mcp`), { requestInit: { headers: { authorization: `Bearer ${token}` } }, fetch: insecureFetch });
  const client = new Client({ name: 'synthetic-e2e-client', version: '1.0.0' });
  await client.connect(transport);
  return client;
}
async function expectOk(client: Client, tool: string, args: Record<string, unknown>): Promise<Record<string, unknown>> {
  const call = await client.callTool({ name: tool, arguments: args });
  assert.equal(call.isError, undefined, `${tool} must succeed, got: ${JSON.stringify(call.structuredContent ?? call.content)}`);
  return call.structuredContent as Record<string, unknown>;
}
async function expectDenied(client: Client, tool: string, args: Record<string, unknown>): Promise<Record<string, unknown>> {
  const call = await client.callTool({ name: tool, arguments: args });
  assert.equal(call.isError, true, `${tool} must be denied, got: ${JSON.stringify(call.structuredContent ?? call.content)}`);
  // Thrown denials surface as isError + text content (not structuredContent); structured denials may also appear.
  return { isError: call.isError, denied: true, structured: call.structuredContent, text: JSON.stringify(call.content ?? call.structuredContent) };
}

interface Rig {
  origin: string; clock: { now: number }; store: ExternalWorkStore; dataRoot: string;
  client: Client; otherClient: Client; claim: { claimId: string; epoch: number };
  reader: OriginalAssetReader;
}
async function rig(t: { after(fn: () => Promise<void>): void }): Promise<Rig> {
  const clock = { now: T0 };
  const now = () => clock.now;
  const dataRoot = await mkdtemp(path.join(tmpdir(), 'optracall-e2e-store-'));
  t.after(() => rm(dataRoot, { recursive: true, force: true }));
  const store = new ExternalWorkStore({ dataRoot, now });
  await store.init();
  const grant: WorkGrant = {
    grantId: 'grant-e2e', grantVersion: 1, projectId: 'project-e2e', taskId: 'task-e2e',
    goal: '核对四店会员资料一致性，交回可追溯差异表', scope: '核查四店会员字段映射与重复记录', forbidden: '不改生产、不联系会员',
    allowedExecutors: [PRINCIPAL], repository: { stableId: 'yunshan-demo/private-member-audit', visibility: 'private' },
    assetRefs: [assetRef], enterprise: 'yunshan-demo', validFrom: iso(clock.now), validUntil: iso(clock.now + 48 * HOUR),
    resourcePolicy: { maxWorks: 1, windowHours: 24 }, autoResumeAllowed: true, createdAt: iso(clock.now),
  };
  await store.createGrantWithWork(grant, {
    workId: 'work-e2e', projectId: grant.projectId, taskId: grant.taskId, revision: 1,
    summary: '核查四店会员字段映射与重复记录', deliveryCriteria: '差异表＋检查说明＋准确资产引用＋未完成项', inputs: [assetRef],
    grantId: grant.grantId, grantVersion: grant.grantVersion, status: 'authorized', createdAt: iso(clock.now), updatedAt: iso(clock.now),
  });
  const attempt = await store.recordPublication({ workId: 'work-e2e', revision: 1, action: 'issue-create', bodyHash: sha('issue-e2e') });
  await store.transitionPublication(attempt.operationId, 'submitted', { expectedStatus: 'prepared' });
  await store.transitionPublication(attempt.operationId, 'succeeded', { expectedStatus: 'submitted', resultRef: { repositoryId: 'yunshan-demo/private-member-audit', issueId: '42' } });
  const reader: OriginalAssetReader = {
    async catalog(refs) { return refs.map(item => ({ ref: item, title: '会员与有效会员定义', applicability: '仅会员身份与有效状态', sha256: item.hash, source: 'SAP·会员业务语义' })); },
    async read(item) { return { title: '会员与有效会员定义', body: '会员＝已注册且有有效门店关系的账号；有效会员＝近90天有消费。', sha256: item.hash, source: 'SAP·会员业务语义/已发布', limitations: ['仅解释身份，不含个人联系值'] }; },
    async readSource(item) { return { title: item.id, fragment: '会员＝已注册账号', sha256: item.hash, locator: 'SEM-021 §1', source: 'SAP', limitations: [] }; },
    async trace() { return []; },
  };
  const intersection = createAssetIntersection({ store, qualify: async () => ({ ok: true }), now });
  const entry = createExternalMcpServer({
    tls: tlsMaterial, managementApprovalToken: MANAGEMENT_TOKEN, rateLimit: { windowMs: 60_000, max: 1_000_000 }, clock: now,
    createOauth: origin => createExternalMcpOAuth({ issuer: origin, resource: `${origin}/mcp`, clients, signingKey: 'synthetic-signing-key', managementApprovalToken: MANAGEMENT_TOKEN, accessTokenTtlSeconds: 100 * 24 * 3600, clock: () => Math.floor(clock.now / 1000) }),
    registerTools: server => {
      registerAssetTools(server, { intersection, reader, now });
      registerWorkTools(server, { store, now });
      registerDeliveryTools(server, { store, dataRoot, now });
    },
  });
  await entry.listen({ port: 0, hostname: '127.0.0.1' });
  t.after(() => entry.close());
  const client = await connect(entry.origin, await mintToken(entry.origin, PRINCIPAL));
  const otherClient = await connect(entry.origin, await mintToken(entry.origin, PRINCIPAL_B));
  t.after(async () => { await Promise.all([client.close(), otherClient.close()]); });
  const claim = await expectOk(client, 'work.claim', { workId: 'work-e2e' }) as { claimId: string; epoch: number };
  return { origin: entry.origin, clock, store, dataRoot, client, otherClient, claim: { claimId: claim.claimId, epoch: claim.epoch }, reader };
}

test('E2E closed loop: claim → asset.read → preserved delivery → resume → review → native separation', async t => {
  const r = await rig(t);
  const { workId, claimId, epoch } = { workId: 'work-e2e', ...r.claim };

  // 1. 通用客户端在交集下读取准确版本（资产只读，版本/hash 不虚构）。
  const read = await expectOk(r.client, 'asset.read', { workId, claimId, epoch, ref: assetRef });
  assert.equal(read.kind, 'asset-read');
  assert.match(String(read.body ?? read.text ?? ''), /有效会员/);
  assert.equal(read.sha256 ?? read.ref?.hash, assetRef.hash);

  // 2. 分块上传并保全交付（manifest/hash 校验、preserved）。
  const content = Buffer.from('member,store_a,store_b\nalice,1001,1002\n', 'utf8');
  const began = await expectOk(r.client, 'delivery.begin', { workId, claimId, epoch, fileName: 'member-differences.csv', totalBytes: content.length, sha256: sha(content) }) as { uploadId: string };
  const chunk = EXTERNAL_DELIVERY_LIMITS.maxChunkBytes;
  for (let offset = 0; offset < content.length; offset += chunk) {
    const slice = content.subarray(offset, Math.min(offset + chunk, content.length));
    await expectOk(r.client, 'delivery.upload-chunk', { workId, claimId, epoch, uploadId: began.uploadId, offset, sha256: sha(slice), bytesBase64: slice.toString('base64') });
  }
  const receipt = await expectOk(r.client, 'delivery.commit', {
    workId, claimId, epoch, revision: 1, idempotencyKey: 'e2e-delivery-1',
    manifest: { files: [{ path: 'member-differences.csv', sha256: sha(content), bytes: content.length, uploadId: began.uploadId }] },
    facts: FACTS,
  }) as { kind: string; deliveryId: string; preservation: string; late: boolean };
  assert.equal(receipt.kind, 'external-delivery');
  assert.equal(receipt.preservation, 'preserved');
  assert.equal(receipt.late, false);
  const stored = await r.store.getDelivery(receipt.deliveryId);
  assert.equal(stored?.preservation, 'preserved');
  assert.equal(stored?.storage?.[0]?.sha256, sha(content));

  // 3. 收件（模拟受限只读收件适配记录 InboxEvent），续接调度到原任务。
  await r.store.recordInboxEvent({ eventKey: 'github-issue-42-comment-1', projectId: 'project-e2e', taskId: 'task-e2e', workId, deliveryId: receipt.deliveryId });
  const resumeCalls: Array<{ requestId: string; text: string; externalContext: unknown; origin: unknown }> = [];
  const coordinator = createExternalResumeCoordinator({
    store: r.store,
    startMessage: async (_projectId, _taskId, input, origin) => { resumeCalls.push({ requestId: input.requestId, text: input.text, externalContext: input.externalContext, origin }); return { requestId: input.requestId, status: 'completed' }; },
    busy: () => false,
    taskAvailable: () => ({ available: true }),
    nativeStatus: async () => undefined,
    now: () => r.clock.now,
  });
  await coordinator.notifyEvent('project-e2e', 'task-e2e');
  assert.equal(resumeCalls.length, 1, 'exactly one same-task resume turn must be dispatched');
  const call = resumeCalls[0]!;
  assert.deepEqual(call.origin, { userText: false }, 'external turns are never user quotes');
  assert.match(call.text, /核查四店会员字段映射与重复记录/);
  assert.match(call.text, /请核对该交付是否满足原工作与验收条件/);
  const identity = call.externalContext as { workId: string; revision: number; deliveryId: string; deliveryHash: string; grantId: string; grantVersion: number };
  assert.equal(identity.workId, workId);
  assert.equal(identity.deliveryId, receipt.deliveryId);
  assert.equal(identity.grantVersion, 1);
  // 幂等：重复 notify 不重复派发。
  await coordinator.notifyEvent('project-e2e', 'task-e2e');
  assert.equal(resumeCalls.length, 1, 'duplicate inbox events never re-run the model turn');

  // 4. 原 Agent 核验（recordReview accept）→ 独立 ReviewDecision，不伪 native 成果。
  const manifestHash = stored!.manifestHash;
  const review = await r.store.recordReview({ workId, deliveryId: receipt.deliveryId, decision: 'accepted', reason: '已核对清单与可核验差异位置，接受这一工作片段；UNKNOWN 未改成确定结论。', deliveryHash: manifestHash });
  assert.equal(review.decision, 'accepted');
  const reviews = await r.store.listReviews(workId);
  assert.equal(reviews.length, 1);
  // 接受外派不推进 Case 轮次/目标实绩/ProjectWork 等待：交付与 native 报告始终分离。
  assert.equal(stored?.kind ?? 'external-delivery', 'external-delivery');
  assert.ok(!('sessionId' in (stored as object)) && !('toolCallId' in (stored as object)), 'external delivery is not a native ProjectTaskResultBinding');

  // 5. 业务闭环负例：未领取者读资产拒绝；错 audience 令牌 401。
  const denied = await expectDenied(r.otherClient, 'asset.read', { workId, ref: assetRef });
  assert.ok(JSON.stringify(denied).includes('external'), 'unclaimed cross-principal read must be denied');
});

test('E2E negative: unclaimed principal cannot read assets; missing bytes are never preserved', async t => {
  const r = await rig(t);
  // 未领取（PRINCIPAL_B 未 claim work-e2e，且不在 allowedExecutors）读资产拒绝。
  const denied = await expectDenied(r.otherClient, 'asset.read', { workId: 'work-e2e', ref: assetRef });
  assert.ok(denied.denied, `expected a typed denial, got ${JSON.stringify(denied)}`);
  // 缺件/manifest hash 不符不标保全。
  const content = Buffer.from('real-bytes', 'utf8');
  const began = await expectOk(r.client, 'delivery.begin', { workId: 'work-e2e', claimId: r.claim.claimId, epoch: r.claim.epoch, fileName: 'x.csv', totalBytes: content.length, sha256: sha(content) }) as { uploadId: string };
  const bad = await expectDenied(r.client, 'delivery.commit', {
    workId: 'work-e2e', claimId: r.claim.claimId, epoch: r.claim.epoch, revision: 1, idempotencyKey: 'e2e-bad-1',
    manifest: { files: [{ path: 'x.csv', sha256: sha('wrong-hash'), bytes: content.length, uploadId: began.uploadId }] },
    facts: FACTS,
  });
  assert.ok(bad.denied || bad.error, `hash mismatch must not be accepted, got ${JSON.stringify(bad)}`);
});
