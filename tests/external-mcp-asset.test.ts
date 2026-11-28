import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { fetch as undiciFetch, Agent } from 'undici';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { createExternalMcpServer } from '../src/host/external-mcp/server.ts';
import { createExternalMcpOAuth } from '../src/host/external-mcp/oauth.ts';
import { canonicalAssetRef, createAssetIntersection, sha256Hex } from '../src/host/external-mcp/intersection.ts';
import { registerAssetTools } from '../src/host/external-mcp/asset-tools.ts';
import { registerWorkTools } from '../src/host/external-mcp/work-tools.ts';
import type { OriginalAssetReader } from '../src/host/external-mcp/asset-tools.ts';
import type { AssetQualification } from '../src/host/external-mcp/intersection.ts';
import { ExternalWorkStore } from '../src/host/external-work-store.ts';
import type { ExternalAssetRef, WorkGrant } from '../src/host/external-work-types.ts';

// S3b 工程隔离集成测试：资产只读交集（spec §7/§11 AB06/AB07/AB08/AB10）经 S3a 受保护
// TLS/OAuth/Bearer 入口，用合成 store/reader/qualify，不访问真实公网、账号或资产。
// 每次目录/正文/来源/trace/分页核：可信 principal ∩ 有效 grant ∩ 有效 work/claim epoch ∩
// 显式企业 ∩ 精确 allowlist ∩ 原项目/Studio 当前资格 ∩ 准确 authority/id/version/hash。

const execFileAsync = promisify(execFile);

const MANAGEMENT_TOKEN = 'synthetic-management-approval-token';
const VERIFIER = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb2';
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
const MAX_FRAGMENT = 512 * 1024;
const MAX_ARGS = 1024 * 1024;

const BODY_1 = '指标 metric-1 的已发布公式与口径正文（合成）';
const BODY_2 = 'Y'.repeat(600_000);
const BODY_3 = '原始 metric-3 来源正文（合成）';
const ALLOWED = ['metric-1', 'metric-2', 'metric-3'] as const;

let tlsMaterial: { key: string; cert: string };

test.before(async () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'optracall-s3b-asset-tls-'));
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

const sha = (value: string) => sha256Hex(value);
const bodyOf = (id: string): string => (id === 'metric-1' ? BODY_1 : id === 'metric-2' ? BODY_2 : BODY_3);
/** 允许表 hash 与 reader 实际正文一致（metric-3 故意不一致 → hash-conflict 语义）。 */
const ref = (id: string, overrides: Partial<ExternalAssetRef> = {}): ExternalAssetRef =>
  ({ authority: 'optracall/studio', id, version: 'published-v1', hash: id === 'metric-3' ? sha('expected-published-bytes-for-metric-3') : sha(bodyOf(id)), ...overrides });

interface Rig {
  origin: string;
  clock: { now: number };
  store: ExternalWorkStore;
  qualifyRules: Map<string, AssetQualification>;
  hooks: { beforeReadResolve?: () => void | Promise<unknown> };
  clientA: Client;
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
  const client = new Client({ name: 'synthetic-s3b-asset-client', version: '1.0.0' });
  await client.connect(transport);
  return client;
}

async function expectDenied(client: Client, tool: string, args: Record<string, unknown>, code: string): Promise<Record<string, unknown>> {
  const call = await client.callTool({ name: tool, arguments: args });
  assert.equal(call.isError, true, `${tool} must be denied with ${code}, got: ${JSON.stringify(call.structuredContent ?? call.content)}`);
  const payload = call.structuredContent as Record<string, unknown>;
  assert.equal(payload.denied, code, `expected denial ${code}, got ${JSON.stringify(payload)}`);
  assert.ok(Object.keys(payload).every(key => ['denied', 'message'].includes(key)), 'denials must not carry asset content or extra metadata');
  return payload;
}

async function expectOk(client: Client, tool: string, args: Record<string, unknown>): Promise<Record<string, unknown>> {
  const call = await client.callTool({ name: tool, arguments: args });
  assert.equal(call.isError, undefined, `${tool} must succeed, got: ${JSON.stringify(call.structuredContent ?? call.content)}`);
  return call.structuredContent as Record<string, unknown>;
}

async function rig(t: { after(fn: () => Promise<void>): void }): Promise<Rig> {
  const clock = { now: T0 };
  const now = () => clock.now;
  const { mkdtemp } = await import('node:fs/promises');
  const dataRoot = await mkdtemp(path.join(tmpdir(), 'optracall-s3b-asset-store-'));
  t.after(() => rm(dataRoot, { recursive: true, force: true }));
  const store = new ExternalWorkStore({ dataRoot, now });
  await store.init();
  const grant: WorkGrant = {
    grantId: 'grant-asset-1', grantVersion: 1, projectId: 'project-1', taskId: 'task-1',
    goal: '合成外派目标', scope: '仅限合成资产', forbidden: '禁止读取其他企业资产',
    allowedExecutors: [PRINCIPAL_A, PRINCIPAL_B],
    repository: { stableId: 'openai/synthetic', visibility: 'private' },
    assetRefs: ALLOWED.map(id => ref(id)),
    enterprise: '合成企业甲',
    validFrom: iso(T0), validUntil: iso(T0 + 48 * HOUR),
    resourcePolicy: { maxWorks: 1, windowHours: 24 },
    autoResumeAllowed: true, createdAt: iso(T0),
  };
  await store.createGrantWithWork(grant, {
    workId: 'work-1', projectId: grant.projectId, taskId: grant.taskId, revision: 1,
    summary: '合成工作摘要', deliveryCriteria: '合成交付标准', inputs: [ref('metric-1')],
    grantId: grant.grantId, grantVersion: grant.grantVersion, status: 'authorized',
    createdAt: iso(T0), updatedAt: iso(T0),
  });
  const attempt = await store.recordPublication({ workId: 'work-1', revision: 1, action: 'issue-create', bodyHash: sha('issue-body') });
  await store.transitionPublication(attempt.operationId, 'submitted', { expectedStatus: 'prepared' });
  await store.transitionPublication(attempt.operationId, 'succeeded', { expectedStatus: 'submitted', resultRef: { repositoryId: 'openai/synthetic', issueId: '101' } });

  const qualifyRules = new Map<string, AssetQualification>();
  const qualify = async ({ ref: target }: { projectId: string; taskId: string; enterprise: string; ref: ExternalAssetRef }) =>
    qualifyRules.get(canonicalAssetRef(target)) ?? { ok: true } as const;

  const hooks: Rig['hooks'] = {};
  const reader: OriginalAssetReader = {
    async catalog() {
      // 故意超范围返回：工具必须过滤到 allowlist，不得先泄露后筛选。
      return [
        ...ALLOWED.map(id => ({ ref: ref(id), title: `${id} 标题`, applicability: '仅限合成企业甲当前资格', sha256: id === 'metric-3' ? sha(BODY_3) : sha(bodyOf(id)), source: 'synthetic-studio-original' })),
        { ref: { authority: 'optracall/studio', id: 'metric-secret', version: 'published-v1', hash: sha('secret') }, title: 'secret', applicability: 'x', sha256: sha('secret'), source: 'synthetic-studio-original' },
      ];
    },
    async read(target) {
      await hooks.beforeReadResolve?.();
      return { title: `${target.id} 标题`, body: bodyOf(target.id), sha256: sha(bodyOf(target.id)), source: 'synthetic-studio-original', limitations: ['读取回执只证交付内容与范围，不证专业正确'] };
    },
    async readSource(target, location) {
      const body = bodyOf(target.id);
      return { title: `${target.id} 来源`, fragment: body.slice(location?.start ?? 0, location?.end ?? body.length), sha256: sha(body), locator: `synthetic-source@${target.version}:${location?.start ?? 0}:${location?.end ?? body.length}`, source: 'synthetic-original-source', limitations: [] };
    },
    async trace(target) {
      return [
        { relation: 'derived-from', target: ref('metric-2') },
        { relation: 'extends', target: { authority: 'optracall/studio', id: 'metric-9', version: 'published-v1', hash: sha('metric-9') } },
      ].filter(item => target.id === 'metric-1');
    },
  };

  const intersection = createAssetIntersection({ store, qualify, now });
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
  const clientC = await connect(entry.origin, await mintToken(entry.origin, PRINCIPAL_C));
  t.after(() => clientA.close());
  t.after(() => clientC.close());
  const claimed = await expectOk(clientA, 'work.claim', { workId: 'work-1' }) as { claimId: string; epoch: number };
  return { origin: entry.origin, clock, store, qualifyRules, hooks, clientA, clientC, claim: { claimId: claimed.claimId, epoch: claimed.epoch }, close: () => entry.close() };
}

const readArgs = (rig0: Rig, overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  workId: 'work-1', claimId: rig0.claim.claimId, epoch: rig0.claim.epoch, ref: ref('metric-1'), ...overrides,
});

test('asset/work tool surface is exactly the read-only whitelist; reason/pack-read/writes are absent', async t => {
  const r = await rig(t);
  const tools = await r.clientA.listTools();
  assert.deepEqual(tools.tools.map(tool => tool.name).sort(), [
    'asset.catalog', 'asset.read', 'asset.read-source', 'asset.trace',
    'work.claim', 'work.deliver', 'work.read', 'work.release', 'work.renew',
  ]);
  for (const forbidden of ['asset.reason', 'asset.pack-read', 'studio', 'semantic', 'work.write', 'publish', 'execute_sql']) {
    const call = await r.clientA.callTool({ name: forbidden, arguments: {} });
    assert.equal(call.isError, true, `unknown tool ${forbidden} must be rejected`);
  }
});

test('full loop: catalog filters to the exact allowlist and never leaks directory-wide metadata', async t => {
  const r = await rig(t);
  const catalog = await expectOk(r.clientA, 'asset.catalog', { workId: 'work-1', claimId: r.claim.claimId, epoch: r.claim.epoch });
  const entries = catalog.entries as Array<{ ref: ExternalAssetRef; sha256: string; state?: string }>;
  assert.deepEqual(entries.map(entry => entry.ref.id).sort(), ['metric-1', 'metric-2', 'metric-3'], 'only allowlisted assets are listed');
  assert.equal(entries.find(entry => entry.ref.id === 'metric-3')?.state, 'hash-conflict', 'a hash-mismatched allowlist entry is shown as hash-conflict, not silently latest');
  assert.ok(!JSON.stringify(catalog).includes('metric-secret'), 'out-of-allowlist directory metadata must be dropped before the response');
  assert.equal(catalog.receipt ? String((catalog.receipt as Record<string, unknown>).claim).includes('不证专业正确') : false, true, 'read receipt disclaims professional correctness');
});

test('positive read returns exact authority/id/version/hash with paging within the 512KiB fragment ceiling', async t => {
  const r = await rig(t);
  const page1 = await expectOk(r.clientA, 'asset.read', readArgs(r, { ref: ref('metric-2') })) as Record<string, unknown>;
  assert.equal(page1.sha256, sha(BODY_2));
  assert.equal(page1.totalBytes, Buffer.byteLength(BODY_2));
  assert.equal(page1.offset, 0);
  assert.equal(page1.nextOffset, MAX_FRAGMENT);
  assert.equal((page1.text as string).length, MAX_FRAGMENT);
  const page2 = await expectOk(r.clientA, 'asset.read', readArgs(r, { ref: ref('metric-2'), offset: page1.nextOffset as number })) as Record<string, unknown>;
  assert.equal(page2.nextOffset, null);
  assert.equal((page2.text as string).length, Buffer.byteLength(BODY_2) - MAX_FRAGMENT);
  const whole = await expectOk(r.clientA, 'asset.read', readArgs(r, { ref: ref('metric-1') })) as Record<string, unknown>;
  assert.equal(whole.text, BODY_1);
  assert.equal(whole.ref && (whole.ref as ExternalAssetRef).hash, ref('metric-1').hash, 'exact authority/id/version/hash are preserved in the response');
  assert.ok(String(whole.source).length > 0);
});

test('fragment/args/offset limits are explicit denials or pagination, never silent truncation', async t => {
  const r = await rig(t);
  await expectDenied(r.clientA, 'asset.read', readArgs(r, { ref: ref('metric-2'), bytes: MAX_FRAGMENT + 1 }), 'external_asset_fragment_limit');
  await expectDenied(r.clientA, 'asset.read', readArgs(r, { ref: ref('metric-2'), offset: Buffer.byteLength(BODY_2) + 1 }), 'external_asset_offset_out_of_range');
  await expectDenied(r.clientA, 'asset.read', readArgs(r, { filler: 'x'.repeat(MAX_ARGS + 1) }), 'external_args_limit_exceeded');
});

test('read-source returns exact locator fragments; oversize fragments are rejected', async t => {
  const r = await rig(t);
  const source = await expectOk(r.clientA, 'asset.read-source', readArgs(r, { location: { start: 0, end: 10 } })) as Record<string, unknown>;
  assert.equal(source.fragment, BODY_1.slice(0, 10));
  assert.equal(source.sha256, ref('metric-1').hash);
  assert.ok(String(source.locator).includes('0:10'));
  await expectDenied(r.clientA, 'asset.read-source', readArgs(r, { ref: ref('metric-2') }), 'external_asset_fragment_limit');
});

test('trace expands only within authorized refs and drops out-of-scope targets without leaking them', async t => {
  const r = await rig(t);
  const trace = await expectOk(r.clientA, 'asset.trace', readArgs(r)) as Record<string, unknown>;
  const relations = trace.relations as Array<{ relation: string; target: ExternalAssetRef }>;
  assert.deepEqual(relations.map(item => item.target.id), ['metric-2']);
  assert.ok(!JSON.stringify(trace).includes('metric-9'), 'out-of-allowlist trace targets must not be disclosed');
});

test('unclaimed or wrong principals get a bare denial with no metadata and no body', async t => {
  const r = await rig(t);
  // 未领取者：work.read 只列获准工作（C 未被允许 → 空目录），资产读取一律拒绝。
  const catalogC = await r.clientC.callTool({ name: 'work.read', arguments: {} });
  assert.equal((catalogC.structuredContent as { works: unknown[] }).works.length, 0, 'a principal outside allowedExecutors sees no works');
  await expectDenied(r.clientC, 'asset.read', readArgs(r, { claimId: r.claim.claimId, epoch: r.claim.epoch }), 'external_asset_no_claim');
  await expectDenied(r.clientC, 'asset.catalog', { workId: 'work-1', claimId: r.claim.claimId, epoch: r.claim.epoch }, 'external_asset_no_claim');
  // 错 principal：拿 A 的 claimId 用 C 的令牌读取。
  const denial = await expectDenied(r.clientC, 'asset.read', readArgs(r), 'external_asset_no_claim');
  assert.ok(!JSON.stringify(denial).includes(BODY_1), 'denials must not carry asset body');
});

test('wrong epoch, cancelled work, expired grant and lapsed lease are distinct explicit denials', async t => {
  const r = await rig(t);
  await expectDenied(r.clientA, 'asset.read', readArgs(r, { epoch: 99 }), 'external_asset_claim_epoch_conflict');
  await r.store.cancelWork('work-1', 'user-cancel');
  await expectDenied(r.clientA, 'asset.read', readArgs(r), 'external_asset_work_cancelled');
  // 撤销后新 rig 再验 grant 过期与租约过期。
  const r2 = await rig(t);
  r2.clock.now += 49 * HOUR;
  await expectDenied(r2.clientA, 'asset.read', readArgs(r2), 'external_asset_grant_not_valid');
  const r3 = await rig(t);
  await r3.store.releaseClaim({ workId: 'work-1', revision: 1, claimId: r3.claim.claimId, epoch: r3.claim.epoch, reason: 'done' });
  await expectDenied(r3.clientA, 'asset.read', readArgs(r3), 'external_asset_no_claim');
  const r4 = await rig(t);
  await r4.store.releaseClaim({ workId: 'work-1', revision: 1, claimId: r4.claim.claimId, epoch: r4.claim.epoch, reason: 'setup' });
  const shortLease = await r4.store.recordClaim({ workId: 'work-1', revision: 1, principal: PRINCIPAL_A, leaseDeadline: iso(r4.clock.now + 1_000) });
  r4.clock.now += 2_000;
  await expectDenied(r4.clientA, 'asset.read', { workId: 'work-1', claimId: shortLease.claim.claimId, epoch: shortLease.claim.epoch, ref: ref('metric-1') }, 'external_asset_claim_expired');
});

test('missing version, unknown version, wrong hash and out-of-allowlist refs are distinct denials with no latest fallback', async t => {
  const r = await rig(t);
  await expectDenied(r.clientA, 'asset.read', readArgs(r, { ref: { authority: 'optracall/studio', id: 'metric-1', hash: ref('metric-1').hash } }), 'external_asset_version_required');
  await expectDenied(r.clientA, 'asset.read', readArgs(r, { ref: ref('metric-1', { version: 'published-v2' }) }), 'external_asset_version_missing');
  await expectDenied(r.clientA, 'asset.read', readArgs(r, { ref: ref('metric-1', { hash: sha('tampered') }) }), 'external_asset_hash_mismatch');
  await expectDenied(r.clientA, 'asset.read', readArgs(r, { ref: { authority: 'optracall/studio', id: 'metric-1', version: 'published-v1' } }), 'external_asset_hash_required');
  await expectDenied(r.clientA, 'asset.read', readArgs(r, { ref: ref('metric-9') }), 'external_asset_not_allowlisted');
  const latest = await r.clientA.callTool({ name: 'asset.read', arguments: readArgs(r, { ref: ref('metric-1', { version: 'published-v2' }) }) });
  assert.ok(!JSON.stringify(latest).includes(BODY_1), 'version mismatch must never fall back to latest content');
});

test('reader content hash mismatch is an explicit denial, not corrected content', async t => {
  const r = await rig(t);
  // metric-3 的 allowlist hash 与 reader 实际正文 hash 故意不同。
  await expectDenied(r.clientA, 'asset.read', readArgs(r, { ref: ref('metric-3') }), 'external_asset_hash_mismatch');
});

test('original project/Studio qualification: revoked, missing, legacy-no-enterprise and enterprise mismatch are distinct denials', async t => {
  const cases: Array<[AssetQualification, string]> = [
    [{ ok: false, reason: 'revoked' }, 'external_asset_qualification_revoked'],
    [{ ok: false, reason: 'missing' }, 'external_asset_source_missing'],
    [{ ok: false, reason: 'hash-mismatch' }, 'external_asset_source_hash_mismatch'],
    [{ ok: false, reason: 'legacy-no-enterprise' }, 'external_asset_legacy_not_exposed'],
    [{ ok: false, reason: 'enterprise-mismatch' }, 'external_asset_enterprise_mismatch'],
  ];
  for (const [verdict, code] of cases) {
    const r = await rig(t);
    r.qualifyRules.set(canonicalAssetRef(ref('metric-1')), verdict);
    await expectDenied(r.clientA, 'asset.read', readArgs(r), code);
    await expectDenied(r.clientA, 'asset.catalog', { workId: 'work-1', claimId: r.claim.claimId, epoch: r.claim.epoch }, code);
  }
});

test('revocation during an async read never returns the late body', async t => {
  const r = await rig(t);
  r.hooks.beforeReadResolve = () => r.store.cancelWork('work-1', 'user-cancel-mid-read');
  const call = await r.clientA.callTool({ name: 'asset.read', arguments: readArgs(r) });
  assert.equal(call.isError, true, 'content that became ineligible mid-read must not be returned');
  assert.equal((call.structuredContent as Record<string, unknown>).denied, 'external_asset_work_cancelled');
  assert.ok(!JSON.stringify(call).includes(BODY_1), 'the late body must be discarded, not delivered');
});

test('work.read lists only explicitly allowed works with non-sensitive descriptions', async t => {
  const r = await rig(t);
  const asC = await r.clientC.callTool({ name: 'work.read', arguments: {} });
  assert.equal((asC.structuredContent as { works: unknown[] }).works.length, 0);
  const asA = await expectOk(r.clientA, 'work.read', {}) as { works: Array<Record<string, unknown>> };
  assert.equal(asA.works.length, 1);
  const entry = asA.works[0]!;
  assert.equal(entry.workId, 'work-1');
  assert.equal(entry.summary, '合成工作摘要');
  assert.ok(Array.isArray(entry.assetRefs) && (entry.assetRefs as ExternalAssetRef[]).length === 3, 'exact asset refs are part of the non-sensitive work order');
});
