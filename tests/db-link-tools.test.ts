import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { ProjectAgent, type ProjectAgentOptions } from '../src/agent/project-runtime.ts';
import { startToolProvider } from './fixtures/tool-provider.ts';
import { createDbLinkTools, type DbLinkPort, type DbLinkToolDispatch } from '../src/agent/db-link-tools.ts';
import { createDbLinkHost, type DbLinkHostOptions } from '../src/host/db-link-host.ts';
import { ProjectStore } from '../src/host/project-store.ts';
import { ProjectDataContextStore } from '../src/host/project-data-context-store.ts';
import type { DbLinkCatalog } from '../src/host/db-link-driver.ts';
import type { DbLinkConnectionInput } from '../src/host/db-link-types.ts';

async function runtimeFixture(t: { after(callback: () => Promise<void>): void }) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'optracall-db-tools-')), projectDirectory = path.join(root, 'project'), resourceRoot = path.join(root, 'resources');
  for (const directory of ['010_draw', '020_clean', '060_reports']) await mkdir(path.join(projectDirectory, directory), { recursive: true });
  await mkdir(resourceRoot); await writeFile(path.join(resourceRoot, 'settings.json'), JSON.stringify({ retry: { enabled: false } }));
  const provider = await startToolProvider(), agents: ProjectAgent[] = [], beforeRemove: (() => Promise<void>)[] = [];
  const options: ProjectAgentOptions = { projectId: 'db-project', taskId: 'db-task', projectDirectory, resourceRoot, sessionDirectory: path.join(root, 'sessions'), codeRoot: process.cwd(), managementPorts: [], configuration: { id: 'db-synthetic', revision: 1, name: 'DB synthetic protocol only', provider: 'synthetic', api: 'openai-completions', baseUrl: provider.baseUrl, model: 'db-synthetic', apiKey: 'synthetic-db-only' } };
  const create = (overrides: Partial<ProjectAgentOptions> = {}) => { const agent = new ProjectAgent({ ...options, ...overrides }); agents.push(agent); return agent; };
  t.after(async () => { for (const agent of agents) await agent.close(); for (const cleanup of beforeRemove) await cleanup(); await provider.close(); await rm(root, { recursive: true, force: true }); });
  return { root, options, create, provider, beforeRemove };
}

test('database tool calls expose orthogonal non-secret operations and pass typed parameters without coercion', async () => {
  const calls: unknown[] = [], signal = new AbortController().signal, context = {};
  const response = { content: [{ type: 'text' as const, text: 'Fixed synthetic result reference.' }], details: { resultId: 'result-1', rows: 2, complete: true } };
  const dispatch: DbLinkToolDispatch = async (...args) => { calls.push(args); return response; };
  const tools = createDbLinkTools(dispatch);
  assert.deepEqual(tools.map(tool => tool.name), ['db_sources', 'db_describe', 'db_query', 'db_result', 'db_save_description']);
  const input = { connectionId: 'connection-1', sql: 'SELECT amount FROM sales.orders WHERE id = $1', parameters: [{ kind: 'number', value: '9007199254740993', databaseType: 'BIGINT' }], scopeNote: 'Synthetic current authorized period.' };
  const result = await tools.find(tool => tool.name === 'db_query')!.execute('real-sdk-call', input, signal, undefined, context);
  assert.equal(result, response);
  assert.deepEqual(calls, [['query', input, signal, 'real-sdk-call', context]]);
});

test('database tool descriptions state account coverage, on-demand field limits and unsupported full-value capabilities', () => {
  const tools = createDbLinkTools(async () => assert.fail('definitions do not execute queries'));
  const describe = tools.find(tool => tool.name === 'db_describe')!.description;
  assert.match(describe, /current.*(?:account|identity)/i);
  assert.match(describe, /(?:view|RLS)/);
  const query = tools.find(tool => tool.name === 'db_query')!.description;
  assert.match(query, /(?:prefix|substring|fragment)/i);
  assert.match(query, /(?:after.*decod|decod.*before)/i);
  assert.match(query, /segmentRead.*unsupported/i);
  const result = tools.find(tool => tool.name === 'db_result')!.description;
  assert.match(result, /(?:SQL.*complete|complete.*SQL)/i);
  assert.match(result, /(?:business|hidden)/i);
});

test('db_query accepts only an explicit non-overlapping segmented-value projection plan', async () => {
  const calls: unknown[] = [], signal = new AbortController().signal;
  const tool = createDbLinkTools(async (...args) => { calls.push(args[1]); return { content: [], details: {} }; }).find(tool => tool.name === 'db_query')!;
  const segmentRead = { valueColumn: 2, totalBytesColumn: 1, keyColumns: [0] }, input = { connectionId: 'source', sql: 'SELECT id, octet_length(payload), substring(payload,$1,$2) FROM sales.orders', parameters: [{ kind: 'number', value: '1' }, { kind: 'number', value: '100' }], segmentRead };
  await tool.execute('segments', input, signal, undefined, {}); assert.deepEqual(calls, [input]);
  for (const invalid of [{ ...segmentRead, keyColumns: [] }, { ...segmentRead, keyColumns: [0, 0] }, { ...segmentRead, valueColumn: 1 }, { ...segmentRead, keyColumns: [2] }, { ...segmentRead, valueColumn: Number.MAX_SAFE_INTEGER + 1 }, { ...segmentRead, owner: 'forged' }]) await assert.rejects(tool.execute('invalid-plan', { ...input, segmentRead: invalid }, signal, undefined, {}), /db_link_invalid_arguments/);
  assert.equal(calls.length, 1);
});

test('db_result permits a bounded byte preview of a referenced value and rejects mixed or unsafe ranges', async () => {
  const calls: unknown[] = [], resultId = randomUUID(), valueId = randomUUID(), signal = new AbortController().signal;
  const tool = createDbLinkTools(async (...args) => { calls.push(args[1]); return { content: [], details: {} }; }).find(tool => tool.name === 'db_result')!;
  const input = { resultId, valueId, startByte: 3, maxBytes: 17 };
  await tool.execute('read-value', input, signal, undefined, {}); assert.deepEqual(calls, [input]);
  for (const invalid of [{ resultId, startByte: 0 }, { ...input, startRow: 0 }, { ...input, maxRows: 1 }, { ...input, startByte: Number.MAX_SAFE_INTEGER + 1 }, { ...input, valueId: '../other' }]) await assert.rejects(tool.execute('invalid-value', invalid, signal, undefined, {}), /db_link_invalid_arguments/);
  assert.equal(calls.length, 1);
});

test('database descriptions reuse original unconfirmed statements and mappings without accepting source or owner authority', async () => {
  const calls: unknown[] = [], resultId = randomUUID();
  const tools = createDbLinkTools(async (...args) => { calls.push(args); return { content: [], details: { structureOnly: true } }; });
  const tool = tools.find(tool => tool.name === 'db_save_description');
  assert.ok(tool);
  const statement = { statementId: randomUUID(), scope: 'field', location: { kind: 'json-pointer', pointer: '/columns/0', queryExpression: 'SUM(amount)' }, text: 'Agent inference; currency remains unknown.', unit: null, provenance: 'agent-inference', confirmed: false, confirmedAt: null, confirmedBy: null };
  const input = { resultId, operationId: randomUUID(), name: 'Synthetic structure', description: { statements: [statement], mappings: [] } };
  const signal = new AbortController().signal, context = {};
  await tool.execute('save-call', input, signal, undefined, context);
  assert.deepEqual(calls, [['save-description', input, signal, 'save-call', context]]);
  for (const invalid of [
    { ...input, observationRef: randomUUID() },
    { operationId: input.operationId, description: input.description },
    { ...input, description: { ...input.description, statements: [{ ...statement, provenance: 'user-statement' }] } },
    { ...input, description: { ...input.description, statements: [{ ...statement, confirmed: true, confirmedBy: 'user', confirmedAt: '2026-11-14T01:00:00Z' }] } },
    { ...input, description: { ...input.description, statements: [{ ...statement, location: { ...statement.location, database: { sourceIdentity: 'forged' } } }] } },
    { ...input, projectId: 'other' },
  ]) await assert.rejects(tool.execute('invalid-save', invalid, signal, undefined, context), /db_link_invalid_arguments/);
  assert.equal(calls.length, 1);
});

test('untrusted owner, paths, credentials, unsafe numbers and malformed typed parameters never reach the Host', async () => {
  let calls = 0;
  const tools = createDbLinkTools(async () => { calls++; return { content: [], details: {} }; });
  const query = tools.find(tool => tool.name === 'db_query')!, source = tools.find(tool => tool.name === 'db_sources')!, result = tools.find(tool => tool.name === 'db_result')!;
  const signal = new AbortController().signal;
  for (const extra of [{ owner: { projectId: 'other' } }, { projectId: 'other' }, { taskId: 'other' }, { pid: 42 }, { password: 'do-not-send' }, { dsn: 'mysql://secret' }, { path: '/tmp/source' }]) await assert.rejects(query.execute('call', { connectionId: 'connection-1', sql: 'SELECT 1', ...extra }, signal, undefined, {}), /db_link_invalid_arguments/);
  await assert.rejects(query.execute('call', { connectionId: 'connection-1', sql: 'SELECT $1', parameters: [{ kind: 'number', value: 9007199254740992 }] }, signal, undefined, {}), /db_link_parameter_precision/);
  await assert.rejects(query.execute('call', { connectionId: 'connection-1', sql: 'SELECT $1', parameters: [{ kind: 'text', value: true }] }, signal, undefined, {}), /db_link_invalid_arguments/);
  await assert.rejects(source.execute('call', { projectId: 'other' }, signal, undefined, {}), /db_link_invalid_arguments/);
  await assert.rejects(result.execute('call', { resultId: '../other/result' }, signal, undefined, {}), /db_link_invalid_arguments/);
  assert.equal(calls, 0);
});

test('tool grants only narrow, require a current invocation, and never return aborted content', async () => {
  const controller = new AbortController(); let calls = 0;
  assert.deepEqual(createDbLinkTools(async () => assert.fail(), []).map(tool => tool.name), []);
  const tools = createDbLinkTools(async () => { calls++; controller.abort(); return { content: [{ type: 'text', text: 'late-source' }], details: {} }; }, ['db_sources']);
  assert.deepEqual(tools.map(tool => tool.name), ['db_sources']);
  const tool = tools[0]!;
  await assert.rejects(tool.execute('call', {}, AbortSignal.abort(), undefined, {}), { name: 'AbortError' });
  await assert.rejects(tool.execute('call', {}), /db_link_run_unavailable/);
  await assert.rejects(tool.execute('call', {}, controller.signal, undefined, {}), { name: 'AbortError' });
  assert.equal(calls, 1);
});

test('official Pi direct and nested database calls use only the Host grant and current parent request', async t => {
  for (const nested of [false, true]) await t.test(nested ? 'nested' : 'direct', async t => {
    const fixture = await runtimeFixture(t), calls: { action: string; input: Record<string, unknown>; context: Parameters<DbLinkPort>[2] }[] = [];
    const plan = [
      { name: 'db_sources', arguments: {} },
      { name: 'db_describe', arguments: { connectionId: 'connection-1', object: 'sales.orders' } },
      { name: 'db_query', arguments: { connectionId: 'connection-1', sql: 'SELECT amount FROM sales.orders WHERE id=$1', parameters: [{ kind: 'number', value: '9007199254740993' }] } },
      { name: 'db_result', arguments: { resultId: 'result-1', startRow: 0, maxRows: 20 } },
      { name: 'db_save_description', arguments: { resultId: randomUUID(), operationId: randomUUID(), description: { statements: [], mappings: [] } } },
    ];
    fixture.provider.setResponder(({ requestNumber }) => {
      const call = plan[requestNumber - 1];
      return call ? { calls: [nested ? { name: 'codemode', arguments: { code: `text(await tools.${call.name}(${JSON.stringify(call.arguments)}));` } } : call] } : { text: 'Synthetic DB tools completed; source completeness remains limited.' };
    });
    const agent = fixture.create({ dbLink: async (action, input, context) => {
      context.assertCurrent(); calls.push({ action, input, context });
      return { content: [{ type: 'text', text: `SYNTHETIC_DB_${action}` }], details: { resultId: 'result-1', complete: false } };
    } });
    const opened = await agent.open();
    assert.ok(opened.tools.includes('db_sources'));
    assert.equal(fixture.provider.requests.length, 0, 'opening only grants tools; it does not run a query or model');
    const requestId = randomUUID(), result = await agent.start('Use synthetic granted DB data only.', requestId).completion;
    assert.equal(result.outcome, 'completed');
    assert.deepEqual(calls.map(call => ({ action: call.action, input: call.input })), plan.map((call, index) => ({ action: ['sources', 'describe', 'query', 'read-result', 'save-description'][index], input: call.arguments })));
    assert.ok(calls.every(call => call.context.requestId === requestId && call.context.sessionId === opened.sessionId && call.context.toolCallId && call.context.runToken && typeof call.context.registerCleanup === 'function'));
    assert.ok(fixture.provider.requests[4].body.messages?.some(message => JSON.stringify(message.content).includes('SYNTHETIC_DB_read-result')));
    assert.equal(fixture.provider.errors.length, 0);
    const state = await agent.snapshot(), original = await readFile(state.sessionFile!, 'utf8');
    assert.match(original, /SYNTHETIC_DB_read-result/);
    await agent.close();
    const restored = await fixture.create({ sessionFile: state.sessionFile }).open();
    assert.ok(!restored.tools.some(tool => tool.startsWith('db_')), 'history does not grant a new database capability');
    assert.ok(JSON.stringify(restored.messages).includes('SYNTHETIC_DB_read-result'));
  });
});

test('official Pi corrects database argument and SQL errors beyond five attempts in one request without transport retries', async t => {
  const fixture = await runtimeFixture(t), requestId = randomUUID();
  const hostCalls: { sql: string; context: Parameters<DbLinkPort>[2] }[] = [];
  const attempts = [
    { connectionId: 'connection-1', sql: 'SELECT id FROM sales.orders', owner: 'untrusted' },
    { connectionId: 'connection-1', sql: 'SELECT wrong_column FROM sales.orders' },
    { connectionId: 'connection-1', sql: 'SELECT id FROM sales.orders WHERE id=$1', parameters: [{ kind: 'number', value: 9007199254740992 }] },
    { connectionId: 'connection-1', sql: 'SELECT min(note) FROM sales.orders' },
    { connectionId: 'connection-1', sql: 'SELECT repeat(note,100) FROM sales.orders' },
    { connectionId: 'connection-1', sql: 'SELECT min(note) FROM sales.orders' },
    { connectionId: 'connection-1', sql: 'SELECT id FROM sales.orders WHERE id=$1', parameters: [{ kind: 'number', value: '9007199254740993', databaseType: 'BIGINT' }] },
  ];
  const observations: string[] = [];
  fixture.provider.setResponder(context => {
    const index = context.recentToolResults.length;
    if (index) observations.push(JSON.stringify(context.recentToolResults.at(-1)?.content));
    return index < attempts.length
      ? { calls: [{ name: 'db_query', arguments: attempts[index]! }] }
      : { text: 'SYNTHETIC_CORRECTION_COMPLETE; errors remain in the original request history.' };
  });
  const agent = fixture.create({ dbLink: async (action, input, context) => {
    assert.equal(action, 'query'); context.assertCurrent();
    hostCalls.push({ sql: input.sql as string, context });
    if (input.sql !== attempts.at(-1)!.sql) throw Object.assign(new Error('Synthetic Host technical rejection.'), { code: String(input.sql).includes('wrong_column') ? 'db_column_not_supported' : 'db_output_not_bounded' });
    return { content: [{ type: 'text', text: 'SYNTHETIC_EXACT_RESULT_9007199254740993' }], details: { complete: true } };
  } });
  const opened = await agent.open();
  const result = await agent.start('Use the authorized source and correct technical errors yourself.', requestId).completion;
  assert.equal(result.outcome, 'completed');
  assert.deepEqual(hostCalls.map(call => call.sql), [attempts[1]!.sql, attempts[3]!.sql, attempts[4]!.sql, attempts[5]!.sql, attempts[6]!.sql]);
  assert.ok(hostCalls.every(call => call.context.requestId === requestId && call.context.sessionId === opened.sessionId));
  assert.equal(new Set(hostCalls.map(call => call.context.toolCallId)).size, hostCalls.length);
  assert.ok(observations.some(value => value.includes('db_link_invalid_arguments')));
  assert.ok(observations.some(value => value.includes('db_link_parameter_precision')));
  assert.ok(observations.filter(value => value.includes('db_output_not_bounded')).length >= 3, JSON.stringify(observations));
  assert.ok(observations.at(-1)?.includes('SYNTHETIC_EXACT_RESULT_9007199254740993'));
  const state = await agent.snapshot(), original = await readFile(state.sessionFile!, 'utf8');
  assert.match(original, /db_link_invalid_arguments/);
  assert.match(original, /db_link_parameter_precision/);
  assert.match(original, /db_output_not_bounded/);
  assert.match(original, /SYNTHETIC_EXACT_RESULT_9007199254740993/);
  assert.equal(fixture.provider.errors.length, 0);
});

test('stopping while Pi is choosing a SQL correction prevents the late replacement from reaching the Host', async t => {
  const fixture = await runtimeFixture(t); let correcting!: () => void, release!: () => void;
  const choosing = new Promise<void>(resolve => { correcting = resolve; }), heldReply = new Promise<void>(resolve => { release = resolve; });
  let calls = 0;
  fixture.provider.setResponder(async context => {
    if (!context.recentToolResults.length) return { calls: [{ name: 'db_query', arguments: { connectionId: 'connection-1', sql: 'SELECT min(note) FROM sales.orders' } }] };
    assert.ok(JSON.stringify(context.recentToolResults.at(-1)?.content).includes('db_output_not_bounded'));
    correcting(); await heldReply;
    return { calls: [
      { name: 'db_query', arguments: { connectionId: 'connection-1', sql: 'SELECT id FROM sales.orders' } },
      { name: 'write', arguments: { path: path.join(fixture.options.projectDirectory!, '020_clean', 'late-business.txt'), content: 'LATE_BUSINESS_WRITE_MUST_NOT_RUN' } },
      { name: 'db_save_description', arguments: { resultId: randomUUID(), operationId: randomUUID(), description: { statements: [], mappings: [] } } },
    ] };
  });
  const agent = fixture.create({ dbLink: async (_action, _input, context) => {
    context.assertCurrent(); calls++;
    throw Object.assign(new Error('Synthetic Host technical rejection.'), { code: 'db_output_not_bounded' });
  } });
  const active = agent.start('Correct the unsupported SQL within the authorized source.', randomUUID());
  await choosing;
  const stopping = agent.stop();
  try { await stopping; } finally { release(); }
  assert.equal((await active.completion).outcome, 'cancelled');
  assert.equal(calls, 1, 'the late correction is not a new authorized Host call');
  assert.equal(fixture.provider.requests.length, 2, 'stopping the original Pi run does not start a replacement model request');
  await assert.rejects(readFile(path.join(fixture.options.projectDirectory!, '020_clean', 'late-business.txt')), { code: 'ENOENT' });
  assert.equal(fixture.provider.errors.length, 0);
});

test('a source UNKNOWN does not stop independent authorized file work while its original parent remains current', async t => {
  const fixture = await runtimeFixture(t), independent = path.join(fixture.options.projectDirectory!, '020_clean', 'independent.txt');
  await writeFile(independent, 'INDEPENDENT_AUTHORIZED_FILE_AFTER_SOURCE_UNKNOWN');
  let hostCalls = 0;
  fixture.provider.setResponder(context => {
    if (context.recentToolResults.length === 0) return { calls: [{ name: 'db_query', arguments: { connectionId: 'connection-1', sql: 'SELECT id FROM sales.orders' } }] };
    if (context.recentToolResults.length === 1) return { calls: [{ name: 'read', arguments: { path: independent } }] };
    assert.ok(JSON.stringify(context.recentToolResults.at(-1)?.content).includes('INDEPENDENT_AUTHORIZED_FILE_AFTER_SOURCE_UNKNOWN'));
    return { text: 'Independent file read; original source cleanup remains UNKNOWN.' };
  });
  const agent = fixture.create({ dbLink: async (_action, _input, context) => {
    hostCalls++; context.assertCurrent();
    context.registerCleanup!(async options => { if (!options.retryFailed) throw new Error('synthetic_db_cleanup_unknown'); });
    return { content: [{ type: 'text', text: 'UNKNOWN_SOURCE_VALUE_MUST_NOT_DELIVER' }], details: {} };
  } });
  await assert.rejects(agent.start('The synthetic source and independent file have separate analysis scope.', randomUUID()).completion, /semantic_context_cleanup_unknown/);
  assert.equal(hostCalls, 1);
  assert.ok(fixture.provider.requests.some(request => JSON.stringify(request.body.messages).includes('INDEPENDENT_AUTHORIZED_FILE_AFTER_SOURCE_UNKNOWN')));
  assert.ok(!fixture.provider.requests.some(request => JSON.stringify(request.body.messages).includes('UNKNOWN_SOURCE_VALUE_MUST_NOT_DELIVER')));
  assert.equal(agent.busy, true, 'independent work cannot clear the original unresolved resource');
  await agent.close({ retryFailed: true });
});

test('official Pi keeps UNKNOWN in its original Host source domain while describing another authorized source', async t => {
  const f = await runtimeFixture(t), configuration = f.options.configuration;
  const projects = new ProjectStore({ dataRoot: path.join(f.root, 'host-data'), projectsRoot: path.join(f.root, 'host-projects') }); await projects.init();
  f.beforeRemove.push(() => projects.close());
  const project = await projects.create({ name: 'Synthetic separate source domains', configuration }), task = await projects.createTask(project.id, { name: 'Independent source reads' });
  const state = (value: boolean) => ({ remoteTerminal: value, connectionEnded: value, commandTerminal: value, transactionEnded: value });
  let reconciled = false, aReads = 0, bReads = 0, reading = false;
  const observation = (host: string) => ({ reachable: true as const, queryQualified: true, cancelCapability: 'verified' as const, sourceIdentity: host, permissionBinding: 'synthetic-reader', limitations: [] });
  const driver: DbLinkHostOptions['driver'] = { probe: async runtime => observation(runtime.host), openQuery: async () => assert.fail('this test never opens query admission'), catalog: async runtime => {
    const unknown = reading && runtime.host === 'unknown.synthetic.invalid'; if (reading) { if (unknown) aReads++; else bReads++; }
    const catalog: DbLinkCatalog = { observation: observation(runtime.host), objects: [{ object: 'public.orders', schema: 'public', name: 'orders', kind: 'table', queryable: true, limitations: [], comment: null, columns: [], primaryKey: [], foreignKeys: [] }], session: { timezone: 'UTC', encoding: 'UTF8', isolation: 'repeatable read' }, limitations: [], completeness: 'complete', resourceState: state(!unknown) };
    if (unknown) catalog.cleanup = async () => state(reconciled);
    return catalog;
  } };
  const host = createDbLinkHost({ dataRoot: projects.dataRoot, projects, data: new ProjectDataContextStore({ dataRoot: projects.dataRoot, projects }), configurationSnapshot: (id, revision) => id === configuration.id && (revision === undefined || revision === configuration.revision) ? structuredClone(configuration) : undefined, mutate: operation => operation(), isClosing: () => false, driver }); await host.init();
  const input: DbLinkConnectionInput = { name: 'Unknown synthetic source', engine: 'postgresql', host: 'unknown.synthetic.invalid', port: 5432, database: 'synthetic', username: 'reader', password: 'synthetic-source-only', tls: { rejectUnauthorized: true, verifyIdentity: true }, budget: { connectTimeoutMs: 1000, queryTimeoutMs: 5000, lockTimeoutMs: 1000, maxRows: 100, maxBytes: 100000, maxCellBytes: 1000, chunkBytes: 10000, maxConcurrent: 1 } };
  const sources: string[] = [];
  for (const candidate of [input, { ...input, name: 'Independent synthetic source', host: 'independent.synthetic.invalid' }]) {
    const tested = await host.request('POST', '/api/db-link/connections/test', candidate); assert.equal(tested?.status, 200);
    const saved = await host.request('POST', '/api/db-link/connections', { configuration: candidate, testReceiptId: (tested!.body.receipt as { id: string }).id }); assert.equal(saved?.status, 200);
    const connectionId = (saved!.body.connection as { id: string }).id; sources.push(connectionId);
    assert.equal((await host.request('POST', `/api/projects/${project.id}/db-link/sources`, { connectionId, scope: { objects: ['public.orders'] }, modelExport: { targets: [configuration.id], structure: true, comments: false, queryText: true, results: true } }))?.status, 200);
  }
  reading = true;
  f.provider.setResponder(context => context.recentToolResults.length < 2 ? { calls: [{ name: 'db_describe', arguments: { connectionId: sources[context.recentToolResults.length]! } }] } : { text: 'The independent description may be used; the original source remains UNKNOWN.' });
  const agent = f.create({ projectId: project.id, taskId: task.id, projectDirectory: project.rootPath, dbLink: host.port(project.id, task.id, configuration) });
  try {
    await assert.rejects(agent.start('Describe the two separately authorized sources; do not replay unresolved work.', randomUUID()).completion, /semantic_context_cleanup_unknown/);
    assert.equal(aReads, 1); assert.equal(bReads, 1, 'another authorized source is governed by its own actual Host domain');
    assert.ok(f.provider.requests.some(request => JSON.stringify(request.body.messages).includes('observationRef')));
    assert.equal(agent.busy, true, 'reading another source does not clear the original unresolved resource');
  } finally { reconciled = true; await agent.close({ retryFailed: true }); }
});

test('database capabilities cannot be enabled by JSON, missing owners, sealed workspaces or protected cold readers', async t => {
  const fixture = await runtimeFixture(t), work = path.join(fixture.options.projectDirectory!, '020_clean');
  let calls = 0;
  const port: DbLinkPort = async () => { calls++; return { content: [], details: {} }; };
  const scopes: Partial<ProjectAgentOptions>[] = [
    { dbLink: undefined, ...({ dbLinkEnabled: true } as unknown as Partial<ProjectAgentOptions>) },
    { projectId: '' }, { taskId: undefined },
    ...(['fixed-draft', 'text-only', 'source-reader', 'public-search'] as const).map(capabilityPolicy => ({ workspace: { cwd: work, capabilityPolicy, systemPrompt: ['Synthetic sealed input only.'] } })),
    { workspace: { cwd: work, systemPrompt: ['Synthetic plugin owner.'] } },
  ];
  if (process.platform === 'darwin') scopes.push({ protectedExecution: { id: randomUUID(), profile: 'protected', cwd: work, writableRoot: work, readRoots: [] } });
  for (const scope of scopes) {
    const agent = fixture.create({ dbLink: port, sessionDirectory: path.join(fixture.root, randomUUID()), ...scope });
    assert.ok(!(await agent.open()).tools.some(tool => tool.startsWith('db_')));
    await agent.close();
  }
  if (process.platform === 'darwin') {
    const ordinary = fixture.create({ dbLink: port, sessionDirectory: path.join(fixture.root, randomUUID()), protectedExecution: { id: randomUUID(), profile: 'ordinary', cwd: work, writableRoot: work, readRoots: [] } });
    assert.ok((await ordinary.open()).tools.includes('db_query'));
    await ordinary.close();
  }
  assert.equal(calls, 0); assert.equal(fixture.provider.requests.length, 0);
});

test('stopping a current database call waits for its own cleanup and excludes a late result from later requests', async t => {
  const fixture = await runtimeFixture(t); let entered!: () => void, release!: () => void, context: Parameters<DbLinkPort>[2] | undefined, cleanups = 0;
  const started = new Promise<void>(resolve => { entered = resolve; }), blocked = new Promise<void>(resolve => { release = resolve; });
  fixture.provider.setResponder(({ requestNumber }) => requestNumber === 1 ? { calls: [{ name: 'db_query', arguments: { connectionId: 'connection-1', sql: 'SELECT 1' } }] } : { text: 'Synthetic later request only.' });
  const agent = fixture.create({ dbLink: async (_action, _input, current) => {
    context = current; current.registerCleanup!(async () => { cleanups++; }); entered(); await blocked;
    return { content: [{ type: 'text', text: 'LATE_DB_RESULT_MUST_NOT_DELIVER' }], details: {} };
  } });
  const active = agent.start('Synthetic blocked query.', randomUUID()); await started;
  const stopping = agent.stop();
  try {
    assert.equal(context!.signal.aborted, true); assert.equal(agent.busy, true);
    assert.throws(() => context!.assertCurrent(), /db_link_run_unavailable/);
  } finally { release(); }
  await stopping;
  assert.equal((await active.completion).outcome, 'cancelled'); assert.equal(cleanups, 1); assert.equal(agent.busy, false);
  await agent.start('Synthetic next request without a query.', randomUUID()).completion;
  assert.ok(!JSON.stringify(fixture.provider.requests).includes('LATE_DB_RESULT_MUST_NOT_DELIVER'));
  assert.ok(!JSON.stringify((await agent.snapshot()).messages).includes('LATE_DB_RESULT_MUST_NOT_DELIVER'));
});

test('unknown database cleanup remains occupied and never retries until an explicit cleanup retry', async t => {
  const fixture = await runtimeFixture(t), retries: boolean[] = []; let calls = 0;
  fixture.provider.setResponder(({ requestNumber }) => requestNumber === 1 ? { calls: [{ name: 'db_sources', arguments: {} }] } : requestNumber === 2 ? { calls: [{ name: 'db_query', arguments: { connectionId: 'connection-1', sql: 'SELECT 1' } }] } : { text: 'Model text cannot prove resource cleanup.' });
  const agent = fixture.create({ dbLink: async (_action, _input, current) => {
    // This isolated port models one source domain; the Host owns this admission in production.
    if (calls) throw Object.assign(new Error('Synthetic original source domain remains occupied.'), { code: 'db_connection_busy' });
    calls++;
    current.registerCleanup!(async options => { retries.push(options.retryFailed === true); if (!options.retryFailed) throw new Error('synthetic_db_cleanup_unknown'); });
    return { content: [{ type: 'text', text: 'This source result must not override a cleanup failure.' }], details: {} };
  } });
  await assert.rejects(agent.start('Synthetic cleanup unknown.', randomUUID()).completion, /semantic_context_cleanup_unknown/);
  assert.equal(calls, 1, 'a new database call in the same SDK turn is refused while earlier cleanup remains unknown');
  assert.equal(agent.busy, true); assert.equal((await agent.snapshot()).status, 'running');
  await assert.rejects(agent.drain(), /semantic_context_cleanup_unknown/);
  assert.deepEqual(retries, [false]);
  await assert.rejects(agent.close({ retryFailed: false }), /semantic_context_cleanup_unknown/);
  assert.equal(agent.busy, true); assert.deepEqual(retries, [false]);
  await agent.close({ retryFailed: true });
  assert.equal(agent.busy, false); assert.deepEqual(retries, [false, true]);
});

test('a changed SQL chosen by Pi cannot bypass UNKNOWN cleanup in the same original request', async t => {
  const fixture = await runtimeFixture(t), requestId = randomUUID(), contexts: Parameters<DbLinkPort>[2][] = [], cleanupOptions: boolean[] = [];
  const sqls = ['SELECT id FROM sales.orders', 'SELECT id FROM sales.orders WHERE id=$1'];
  fixture.provider.setResponder(context => {
    const index = context.recentToolResults.length;
    if (index === 0) return { calls: [{ name: 'db_query', arguments: { connectionId: 'connection-1', sql: sqls[0]! } }] };
    if (index === 1) {
      assert.ok(JSON.stringify(context.recentToolResults[0]?.content).includes('semantic_context_cleanup_unknown'));
      return { calls: [{ name: 'db_query', arguments: { connectionId: 'connection-1', sql: sqls[1]!, parameters: [{ kind: 'number', value: '9007199254740993' }] } }] };
    }
    assert.ok(JSON.stringify(context.recentToolResults.at(-1)?.content).includes('db_connection_busy'));
    return { text: 'SYNTHETIC_UNKNOWN_IS_NOT_COMPLETE' };
  });
  const agent = fixture.create({ dbLink: async (_action, input, context) => {
    // The fake domain refuses a replacement just as the real Host's held source does.
    if (contexts.length) throw Object.assign(new Error('Synthetic original source domain remains occupied.'), { code: 'db_connection_busy' });
    assert.equal(input.sql, sqls[0]); contexts.push(context);
    context.registerCleanup!(async options => {
      cleanupOptions.push(options.retryFailed === true);
      if (!options.retryFailed) throw new Error('synthetic_db_cleanup_unknown');
    });
    return { content: [{ type: 'text', text: 'UNKNOWN_ORIGINAL_VALUE_MUST_NOT_BECOME_COMPLETE' }], details: { complete: false } };
  } });
  await assert.rejects(agent.start('Read authorized orders; do not replay unknown work.', requestId).completion, /semantic_context_cleanup_unknown/);
  assert.equal(contexts.length, 1, 'a rewritten SQL did not create a replacement Host operation');
  assert.equal(contexts[0]!.requestId, requestId);
  assert.equal(agent.busy, true);
  assert.deepEqual(cleanupOptions, [false]);
  const beforeCleanup = fixture.provider.requests.length;
  await agent.close({ retryFailed: true });
  assert.equal(fixture.provider.requests.length, beforeCleanup, 'explicit safe cleanup does not replay a model request');
  assert.deepEqual(cleanupOptions, [false, true]);
  assert.equal(contexts.length, 1, 'cleanup retry does not replay the original or revised business SQL');
  assert.equal(agent.busy, false);
});

test('foreground subagents inherit only the intersection of the parent database grant and role tools', async t => {
  const fixture = await runtimeFixture(t), roleRoot = path.join(fixture.options.resourceRoot, 'skills', 'db-fixture');
  await mkdir(path.join(roleRoot, 'agents'), { recursive: true });
  await writeFile(path.join(roleRoot, 'SKILL.md'), '---\nname: db-fixture\ndescription: Synthetic database delegation fixture.\n---\nOptional delegated source inspection.\n');
  await writeFile(path.join(roleRoot, 'agents', 'reader.md'), '---\nname: reader\ndescription: Read only the source index.\ntools: [db_sources]\n---\nDB_CHILD_LIMITED\n');
  const calls: Parameters<DbLinkPort>[2][] = [];
  fixture.provider.setResponder(context => {
    const child = context.messages.some(message => ['system', 'developer'].includes(message.role) && JSON.stringify(message.content).includes('DB_CHILD_LIMITED'));
    if (child) {
      assert.deepEqual(context.availableTools.filter(name => name.startsWith('db_')), ['db_sources']);
      if (context.recentToolResults.length === 0) return { calls: [{ name: 'db_sources', arguments: {} }] };
      if (context.recentToolResults.length === 1) return { calls: [{ name: 'db_query', arguments: { connectionId: 'connection-1', sql: 'SELECT 1' } }] };
      return { text: 'CHILD_DB_INDEX_ONLY' };
    }
    return context.recentToolResults.length ? { text: 'PARENT_DB_DELEGATION_DONE' } : { calls: [{ name: 'subagent', arguments: { agent: 'db-fixture/reader', task: 'Synthetic authorized index only.' } }] };
  });
  const agent = fixture.create({ dbLink: async (action, _input, context) => {
    assert.equal(action, 'sources'); context.assertCurrent(); calls.push(context);
    return { content: [{ type: 'text', text: 'SYNTHETIC_CHILD_SOURCE_INDEX' }], details: {} };
  } });
  const opened = await agent.open(), requestId = randomUUID();
  assert.equal((await agent.start('Synthetic parent delegation.', requestId).completion).outcome, 'completed');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].requestId, requestId); assert.equal(calls[0].sessionId, opened.sessionId);
  assert.match(calls[0].toolCallId, /^subagent-[a-f0-9-]+\//);
  assert.ok(fixture.provider.requests.some(request => JSON.stringify(request.body.messages).includes('CHILD_DB_INDEX_ONLY')));
  await agent.close();
  const before = fixture.provider.requests.length, withoutGrant = fixture.create({ sessionDirectory: path.join(fixture.root, randomUUID()) });
  assert.equal((await withoutGrant.start('Role text cannot grant database tools.', randomUUID()).completion).outcome, 'completed');
  const denied = fixture.provider.requests.slice(before);
  assert.ok(denied.every(request => !JSON.stringify(request.body.messages?.filter(message => ['system', 'developer'].includes(message.role))).includes('DB_CHILD_LIMITED')));
  // The existing subagent tool deliberately exposes a failed child receipt, not its internal rejection code.
  assert.ok(denied.some(request => JSON.stringify(request.body.messages).includes('Subagent execution did not complete.')));
  assert.equal(calls.length, 1);
});
