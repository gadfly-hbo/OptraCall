import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { startTestHost } from './fixtures/host-process.ts';
import { startToolProvider, providerMessageText } from './fixtures/tool-provider.ts';
import { ProjectStore } from '../src/host/project-store.ts';
import { ProjectDataContextStore } from '../src/host/project-data-context-store.ts';
import { createDbLinkHost, type DbLinkHostOptions } from '../src/host/db-link-host.ts';
import type { DbLinkCatalog } from '../src/host/db-link-driver.ts';
import type { DbLinkConnectionInput } from '../src/host/db-link-types.ts';
import type { RuntimeModelConfiguration } from '../src/host/config-store.ts';
import type { DbLinkCallContext } from '../src/agent/db-link-tools.ts';

const callContext = (): DbLinkCallContext => ({ signal: new AbortController().signal, requestId: randomUUID(), sessionId: randomUUID(), toolCallId: randomUUID(), assertCurrent() {}, registerCleanup() {} });

test('PM-V12-01: actual receiving Task DB exclusion requalifies an autonomously read background within the same Project', { timeout: 120_000 }, async t => {
  // This is new regression evidence, not an original-candidate RED. All writes
  // stay below a new directory; the reused fixtures never run legacy UI scripts.
  const evidenceRoot = path.resolve('.local/v12-pm01-fix/db-recipient');
  await mkdir(evidenceRoot, { recursive: true });
  const evidence = await mkdtemp(path.join(evidenceRoot, 'same-project-'));
  const dataRoot = path.join(evidence, 'host'), projectsRoot = path.join(evidence, 'projects');
  const provider = await startToolProvider();
  let host: Awaited<ReturnType<typeof startTestHost>> | undefined;
  const http: unknown[] = [], seed: unknown[] = [], observations: Record<string, unknown> = {};
  const driverCalls = { probe: 0, catalog: 0, query: 0 };
  t.diagnostic(evidence);
  t.after(async () => {
    try { await host?.close(); }
    finally {
      await provider.close();
      await writeFile(path.join(evidence, 'http.json'), JSON.stringify(http, null, 2));
      await writeFile(path.join(evidence, 'seed.json'), JSON.stringify({ seed, driverCalls }, null, 2));
      await writeFile(path.join(evidence, 'observations.json'), JSON.stringify(observations, null, 2));
      await writeFile(path.join(evidence, 'provider.json'), JSON.stringify({ requests: provider.requests, errors: provider.errors }, null, 2));
    }
  });
  const request = async (route: string, method = 'GET', body?: unknown, expected = 200): Promise<any> => {
    assert.ok(host, 'actual Host must own the roots during HTTP requests');
    const response = await host.request(route, method, body);
    const text = await response.text();
    const value = JSON.parse(text);
    http.push({ route, method, input: body, status: response.status, body: value });
    assert.equal(response.status, expected, text);
    return value;
  };
  host = await startTestHost({ dataRoot, projectsRoot });
  const fakeKey = 'synthetic-pm01-db-only';
  const selected = (await request('/api/configuration', 'PUT', { name: 'PM01 DB recipient synthetic', provider: 'openai-compatible', baseUrl: provider.baseUrl, model: 'synthetic-pm01-db-recipient', apiKey: fakeKey })).configuration;
  const configuration: RuntimeModelConfiguration = { ...selected, apiKey: fakeKey };
  const project = (await request('/api/projects', 'POST', { name: '服饰复购：同项目原数据库背景承接' }, 201)).project;
  const sourceTask = (await request(`/api/projects/${project.id}/tasks`, 'POST', { name: '原结构说明所属Task' }, 201)).task;
  observations.project = project; observations.sourceTask = sourceTask;
  await host.close(); host = undefined;

  // Sequential seed through the original DB Host API. No second store or
  // parallel runtime is opened while the actual Host owns these roots.
  const projects = new ProjectStore({ dataRoot, projectsRoot });
  await projects.init();
  const marker = 'PM01_DB_BACKGROUND_EXACT_AUTO_READ_NO_DATA_ROWS';
  let connectionId = '', sourceId = '';
  try {
    const data = new ProjectDataContextStore({ dataRoot, projects });
    const catalog: DbLinkCatalog = {
      observation: { reachable: true, sourceIdentity: 'pm01-synthetic-native-instance', permissionBinding: 'pm01-synthetic-reader', queryQualified: true, cancelCapability: 'verified', limitations: ['synthetic structure only; no query rows'] },
      objects: [{ object: 'public.orders', schema: 'public', name: 'orders', kind: 'table', queryable: true, limitations: [], comment: null, columns: [{ ordinal: 0, name: 'amount', databaseType: 'numeric', precision: 20, scale: 4, comment: null, readable: true }], primaryKey: [], foreignKeys: [] }],
      completeness: 'complete', limitations: [], session: { timezone: 'UTC', encoding: 'UTF8', isolation: 'repeatable read' },
      resourceState: { remoteTerminal: true, connectionEnded: true, commandTerminal: true, transactionEnded: true },
    };
    const driver: DbLinkHostOptions['driver'] = {
      probe: async () => { driverCalls.probe++; return structuredClone(catalog.observation); },
      catalog: async () => { driverCalls.catalog++; return structuredClone(catalog); },
      openQuery: async () => { driverCalls.query++; return assert.fail('this regression must never query a database or read business rows'); },
    };
    let tail: Promise<unknown> = Promise.resolve();
    const db = createDbLinkHost({ dataRoot, projects, data, driver, isClosing: () => false, configurationSnapshot: (id, revision) => id === configuration.id && (revision === undefined || revision === configuration.revision) ? structuredClone(configuration) : undefined, mutate: operation => { const next = tail.then(operation); tail = next.catch(() => {}); return next; } });
    await db.init();
    const dbRequest = async (method: string, route: string, input?: unknown) => {
      const response = await db.request(method, route, input); seed.push({ method, route, status: response?.status, body: response?.body });
      assert.equal(response?.status, 200, JSON.stringify(response)); return response!.body;
    };
    const connection: DbLinkConnectionInput = { name: 'PM01合成原数据库背景', engine: 'postgresql', host: 'pm01-db.synthetic.invalid', port: 5432, database: 'synthetic-background', username: 'synthetic-reader', password: 'SYNTHETIC_DB_ONLY', tls: { rejectUnauthorized: true, verifyIdentity: true }, budget: { connectTimeoutMs: 1000, queryTimeoutMs: 5000, lockTimeoutMs: 1000, maxRows: 100, maxBytes: 100000, maxCellBytes: 1000, chunkBytes: 10000, maxConcurrent: 1 } };
    const tested = await dbRequest('POST', '/api/db-link/connections/test', connection);
    const saved = await dbRequest('POST', '/api/db-link/connections', { configuration: connection, testReceiptId: (tested.receipt as { id: string }).id });
    connectionId = (saved.connection as { id: string }).id;
    await dbRequest('POST', `/api/projects/${project.id}/db-link/sources`, { connectionId, scope: { objects: ['public.orders'] }, modelExport: { targets: [configuration.id], structure: true, comments: false, queryText: false, results: false } });
    const port = db.port(project.id, sourceTask.id, configuration);
    const described = await port('describe', { connectionId }, callContext());
    sourceId = described.details.observationRef as string;
    const stored = await port('save-description', { observationRef: sourceId, operationId: randomUUID(), name: '已获准的经营计划结构背景', description: { statements: [{ statementId: randomUUID(), scope: 'source-and-limitations', location: null, text: marker + '：会员复购口径与期间未知，仅固定原结构背景，不提供交易明细。', unit: null, provenance: 'unknown', confirmed: false, confirmedAt: null, confirmedBy: null }], mappings: [] } }, callContext());
    const index = await data.getIndex(project.id);
    const version = await data.readVersion(project.id, sourceId, sourceId);
    const note = JSON.parse(version.sourceNote!);
    assert.equal(stored.details.structureOnly, true); assert.equal(note.kind, 'db-link-structure-source');
    assert.equal(note.sourceKind, 'metadata-observation'); assert.equal(note.owner.taskId, sourceTask.id);
    assert.equal(note.dataRowsFrozenByDataContext, false); assert.equal(driverCalls.query, 0);
    seed.push({ described, stored, index, version, sourceNote: note });
  } finally { await projects.close(); }

  host = await startTestHost({ dataRoot, projectsRoot });
  const discussion = (await request('/api/strategy/discussions', 'POST', { operationId: randomUUID(), projectId: project.id, sources: [], usageContext: { kind: 'organization', background: '明确本项目获准背景范围；未手选也未限选。' } }, 201)).discussion;
  const directory = await request(`/api/strategy/discussions/${discussion.id}/sources`);
  const expectedSource = directory.sources.find((source: any) => source.target?.kind === 'data-description' && source.target.datasetId === sourceId);
  assert.ok(expectedSource, 'the original qualified directory must expose the authentic saved description');
  let discovered: any, actualRead: any;
  const draft = { title: '独立核对服饰会员期间口径', outcome: '保留未知并核对期间口径', perspective: 'personal', scope: { kind: 'personal', id: 'self', name: '本人' }, measurement: { kind: 'deliverable', criterion: '形成可核对口径说明' }, baseline: { state: 'pending', description: '可比基线待补' }, responsible: '本人' };
  provider.setResponder(call => {
    if (!call.recentToolResults.length) return { calls: [{ name: 'strategy_goals', arguments: { action: 'find-sources' } }] };
    const value = JSON.parse(providerMessageText(call.recentToolResults.at(-1)?.content));
    if (value.claim === 'catalog-not-read') {
      discovered = value;
      const source = value.sources.find((item: any) => item.id === expectedSource.id);
      assert.ok(source, 'autonomous discovery must include the permitted DB-derived description');
      return { calls: [{ name: 'strategy_goals', arguments: { action: 'read-source', sourceId: source.id, limit: 8192 } }] };
    }
    if (value.read) { actualRead = value; return { text: marker, calls: [{ name: 'strategy_goals', arguments: { action: 'propose-goal', draft } }] }; }
    return { text: '准确候选已保存，尚不执行经营动作。' };
  });
  const discussionRequestId = randomUUID();
  await request(`/api/strategy/discussions/${discussion.id}/messages`, 'POST', { requestId: discussionRequestId, expectedRevision: discussion.revision, text: '在本项目获准背景内自主查读结构说明，再形成候选；不读取明细、不发起数据库查询。' }, 202);
  let detail: any;
  for (let i = 0; i < 500; i++) { detail = await request(`/api/strategy/discussions/${discussion.id}`); if (!detail.busy && detail.discussion.lastRun?.status === 'completed') break; await delay(20); }
  observations.discussion = { discussionRequestId, directory, discovered, actualRead, detail };
  assert.equal(detail.discussion.lastRun?.status, 'completed');
  assert.ok(actualRead?.read?.text.includes(marker), 'actual body delivery must be proved beyond catalog visibility');
  assert.equal(actualRead.source.id, expectedSource.id); assert.equal(actualRead.source.sha256, expectedSource.sha256);
  assert.deepEqual(detail.discussion.sources, [], 'automatic read must not rewrite manual source choices');
  const discussionNative = await readFile(detail.snapshot.sessionFile, 'utf8');
  await writeFile(path.join(evidence, 'discussion-native.jsonl'), discussionNative);
  assert.ok(discussionNative.includes('catalog-not-read') && discussionNative.includes(marker));
  const goal = detail.goals[0]; assert.ok(goal); assert.ok(!JSON.stringify(goal).includes(marker));
  const adoption = await request(`/api/strategy/discussions/${discussion.id}/adopt`, 'POST', { operationId: randomUUID(), goalId: goal.goalId, version: goal.version, expectedVersion: goal.version, goalContentSha256: detail.goalContentHashes[`${goal.goalId}:${goal.version}`], decision: '明确采用准确目标；详细背景仍按各接收Task原授权核查。' });
  observations.goal = goal; observations.adoption = adoption;
  const plan = { request: '沿准确目标核查背景权限，不增加原数据库授权', premises: [], materials: [], coverage: [], tasks: [{ key: 'excluded', name: '接收Task已排除原来源', selected: true, scope: '只核原来源资格并保留独立工作', capabilities: [] }, { key: 'allowed', name: '未排除的独立接收Task', selected: true, scope: '读取准确目标依据并保留未知', capabilities: [] }], taskMode: 'multi', summaryTaskKey: 'allowed', dependencies: [], caseContext: null, goalContext: { goal: { goalId: goal.goalId, version: goal.version }, purpose: 'assigned-work' } };
  await request(`/api/projects/${project.id}/plan/draft`, 'POST', { operationId: randomUUID(), expectedRevision: 0, plan });
  const planState = await request(`/api/projects/${project.id}/plan`);
  const confirmed = await request(`/api/projects/${project.id}/plan/confirm`, 'POST', { operationId: randomUUID(), expectedRevision: planState.revision, mode: 'create' });
  observations.confirmation = confirmed.confirmation;
  const excluded = confirmed.confirmation.tasks.find((task: any) => task.taskKey === 'excluded');
  const allowed = confirmed.confirmation.tasks.find((task: any) => task.taskKey === 'allowed');
  assert.ok(excluded && allowed); assert.notEqual(excluded.taskId, sourceTask.id); assert.notEqual(allowed.taskId, sourceTask.id);
  const sourcePath = (taskId: string) => `/api/projects/${project.id}/tasks/${taskId}/db-link/sources`;
  const beforePolicy = await request(sourcePath(sourceTask.id));
  await request(`${sourcePath(excluded.taskId)}/${connectionId}`, 'PUT', { excluded: true });
  const excludedPolicy = await request(sourcePath(excluded.taskId)), allowedPolicy = await request(sourcePath(allowed.taskId)), sourcePolicy = await request(sourcePath(sourceTask.id));
  const connection = (policy: any) => policy.sources.find((source: any) => source.connection.id === connectionId);
  assert.equal(connection(excludedPolicy), undefined, 'the original Task-source projection omits an excluded source');
  assert.ok(connection({ sources: excludedPolicy.projectSources }), 'the same original project grant remains present');
  assert.ok(connection(allowedPolicy), 'an unexcluded receiving Task still inherits the original source');
  assert.deepEqual(sourcePolicy, beforePolicy, 'receiving exclusion must not mutate original source Task eligibility');
  const persisted = JSON.parse(await readFile(path.join(dataRoot, 'db-link', 'connections.json'), 'utf8'));
  const taskPolicy = persisted.taskPolicies.find((row: any) => row.projectId === project.id && row.taskId === excluded.taskId && row.connectionId === connectionId);
  assert.deepEqual(taskPolicy.policy, { excluded: true }, 'the real HTTP exclusion must persist under the actual receiving Task');
  assert.equal(persisted.taskPolicies.some((row: any) => row.taskId === sourceTask.id || row.taskId === allowed.taskId), false, 'other Task policies must not be invented');
  observations.policies = { beforePolicy, excludedPolicy, allowedPolicy, sourcePolicy, persistedTaskPolicies: persisted.taskPolicies, persistedGrants: persisted.grants };
  for (const [key, receipt] of [['excluded', excluded], ['allowed', allowed]] as const) {
    let reply = '';
    const providerStart = provider.requests.length;
    provider.setResponder(call => !call.recentToolResults.length ? { calls: [{ name: 'read_goal_context_source', arguments: { goalId: goal.goalId, version: goal.version } }] } : (reply = providerMessageText(call.recentToolResults.at(-1)?.content), { text: '只依据准确回源回执继续，未知不冒称已读。' }));
    const taskRequestId = randomUUID();
    await request(`/api/projects/${project.id}/tasks/${receipt.taskId}/messages`, 'POST', { requestId: taskRequestId, text: '读取本任务已经提供的准确目标准确依据，按本Task原数据库排除状态核查。', projectPlan: { confirmationId: confirmed.confirmation.id, taskKey: key } }, 202);
    let actual: any;
    for (let i = 0; i < 500; i++) { actual = await request(`/api/projects/${project.id}/tasks/${receipt.taskId}`); if (actual.task.lastRun?.status === 'completed' && actual.snapshot.status === 'idle') break; await delay(20); }
    assert.equal(typeof actual.snapshot.sessionFile, 'string');
    const native = await readFile(actual.snapshot.sessionFile, 'utf8');
    await writeFile(path.join(evidence, `${key}-task-native.jsonl`), native);
    const result = native.split('\n').filter(Boolean).map(line => JSON.parse(line)).find(row => row.message?.role === 'toolResult' && row.message.toolName === 'read_goal_context_source');
    assert.ok(result, 'the real SDK must persist the actual source tool result');
    assert.equal(providerMessageText(result.message.content), reply); assert.equal(result.message.isError, key === 'excluded');
    observations[key] = { taskRequestId, receipt, reply, actual, providerStart, providerEnd: provider.requests.length };
    assert.equal(actual.task.lastRun?.status, 'completed'); assert.ok(native.includes('read_goal_context_source'));
    if (key === 'excluded') {
      assert.equal(reply, 'strategy_source_not_authorized'); assert.ok(!reply.includes(marker));
      assert.ok(!JSON.stringify(provider.requests.slice(providerStart)).includes(marker), 'the rejected background must never reach this receiving Task Provider request');
    } else {
      assert.ok(reply.includes(marker), 'the same exact source must remain readable by a receiving Task without the exclusion');
      const provided = JSON.parse(reply); assert.equal(provided.claim, 'provided-not-used-or-verified');
      assert.equal(provided.source.sha256, goal.source.sha256); assert.equal(provided.source.version, goal.source.version);
    }
  }
  assert.equal(driverCalls.query, 0); assert.equal(provider.errors.length, 0);
  const finalSourcePolicy = await request(sourcePath(sourceTask.id));
  assert.deepEqual(finalSourcePolicy, beforePolicy);
  observations.finalSourcePolicy = finalSourcePolicy;
  const providerText = JSON.stringify(provider.requests);
  for (const credential of ['SYNTHETIC_DB_ONLY', 'pm01-db.synthetic.invalid', 'synthetic-reader']) assert.ok(!providerText.includes(credential), 'DB connection credentials or host must not be exported with the background');
});
