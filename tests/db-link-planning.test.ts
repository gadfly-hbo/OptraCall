import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { DbLinkStore } from '../src/host/db-link-store.ts';
import { createDbLinkHost, dbLinkModelOutlet } from '../src/host/db-link-host.ts';
import { ProjectStore } from '../src/host/project-store.ts';
import { ProjectDataContextStore } from '../src/host/project-data-context-store.ts';
import type { DbLinkConnectionInput } from '../src/host/db-link-types.ts';
import type { RuntimeModelConfiguration } from '../src/host/config-store.ts';

const model: RuntimeModelConfiguration = { id: 'planning-model', name: 'Synthetic model', revision: 1, provider: 'synthetic', api: 'openai-completions', model: 'synthetic', baseUrl: 'https://model.synthetic.invalid/v1', apiKey: 'MODEL_PRIVATE_SECRET' };
const connection: DbLinkConnectionInput = { name: '已授权交易来源', engine: 'postgresql', host: 'private-db.synthetic.invalid', port: 5432, database: 'PRIVATE_DATABASE', username: 'PRIVATE_USERNAME', password: 'DATABASE_PRIVATE_SECRET', tls: { ca: 'PRIVATE_CA', rejectUnauthorized: true, verifyIdentity: true }, budget: { connectTimeoutMs: 1000, queryTimeoutMs: 5000, lockTimeoutMs: 1000, maxRows: 100, maxBytes: 100000, maxCellBytes: 1000, chunkBytes: 10000, maxConcurrent: 1 } };
const modelExport = { targets: [dbLinkModelOutlet(model)], structure: true, comments: false, queryText: true, results: true };
async function fixture(t: TestContext) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'optracall-db-planning-'));
  const projects = new ProjectStore({ dataRoot: path.join(root, 'data'), projectsRoot: path.join(root, 'projects') }); await projects.init();
  t.after(async () => { await projects.close(); await rm(root, { recursive: true, force: true }); });
  const project = await projects.create({ name: '合成来源推荐项目', configuration: model });
  const task = await projects.createTask(project.id, { name: '现有分析任务' });
  const stored = new DbLinkStore({ dataRoot: projects.dataRoot, projectState: id => id === project.id ? { archived: false } : null, taskProject: id => id === task.id ? project.id : null, probe: async () => ({ observation: { reachable: true, sourceIdentity: 'synthetic-native', permissionBinding: 'synthetic-reader', queryQualified: true, cancelCapability: 'verified', limitations: ['仅保存时观察；未检查本轮数据'] }, resourceState: { remoteTerminal: true, connectionEnded: true, commandTerminal: true, transactionEnded: true } }) });
  await stored.init();
  let driverCalls = 0;
  const forbidden = async (): Promise<never> => { driverCalls++; throw new Error('planning must never access a database'); };
  const makeHost = async () => { const host = createDbLinkHost({ dataRoot: projects.dataRoot, projects, data: new ProjectDataContextStore({ dataRoot: projects.dataRoot, projects }), configurationSnapshot: (id, revision) => id === model.id && (revision === undefined || revision === model.revision) ? model : undefined, mutate: async run => run(), isClosing: () => false, driver: { probe: forbidden, catalog: forbidden, openQuery: forbidden } }); await host.init(); return host; };
  const save = async (input = connection) => { const receipt = await stored.testConnection(input); return stored.saveConnection(input, receipt.id); };
  const grant = async (connectionId: string, permission = modelExport) => stored.grantProject(project.id, { connectionId, scope: { objects: ['public.orders', 'public.members'], description: '交易和会员范围' }, modelExport: permission });
  return { projects, project, task, stored, makeHost, save, grant, driverCalls: () => driverCalls };
}

test('PG05: public DB Host projects an existing exact grant without database access, credentials or a new grant', async t => {
  const f = await fixture(t), saved = await f.save(), grant = await f.grant(saved.id), host = await f.makeHost();
  const before = await readFile(f.stored.settingsPath, 'utf8');
  const sources = await host.planningSources(f.project.id, { modelOutlet: dbLinkModelOutlet(model) });
  assert.equal(sources.length, 1);
  assert.deepEqual({ id: sources[0]!.id, title: sources[0]!.title, version: sources[0]!.version, sha256: sources[0]!.sha256, state: sources[0]!.state, enabled: sources[0]!.enabled }, { id: `db-link:${saved.id}`, title: connection.name, version: '1', sha256: saved.fingerprint, state: 'available', enabled: true });
  assert.match(sources[0]!.permissionRef, new RegExp(`^db-grant:${grant.id}:[a-f0-9]{64}$`));
  assert.deepEqual(sources[0]!.scope, grant.scope);
  assert.equal(sources[0]!.queryQualified, true);
  for (const secret of [connection.host, connection.database, connection.username, connection.password!, connection.tls.ca!, model.apiKey]) assert.ok(!JSON.stringify(sources).includes(secret));
  assert.equal(f.driverCalls(), 0);
  assert.equal(await readFile(f.stored.settingsPath, 'utf8'), before, 'source recommendation never writes or repeats project authorization');
});

test('PG05: no project source stays empty without probing or borrowing a shared configuration', async t => {
  const f = await fixture(t); await f.save();
  const host = await f.makeHost();
  assert.deepEqual(await host.planningSources(f.project.id), []);
  assert.deepEqual(await host.planningSources(f.project.id, { modelOutlet: dbLinkModelOutlet(model) }), []);
  assert.equal(f.driverCalls(), 0);
});

test('PG05: a Task exclusion and narrower scope are read from original authority and cannot affect another Task', async t => {
  const f = await fixture(t), saved = await f.save(); await f.grant(saved.id);
  const other = await f.projects.createTask(f.project.id, { name: '独立Task' }), host = await f.makeHost();
  const sourcePath = `/api/projects/${f.project.id}/tasks/${f.task.id}/db-link/sources/${saved.id}`;
  const original = (await host.planningSources(f.project.id))[0]!;
  assert.equal((await host.request('PUT', sourcePath, { excluded: false, scope: { objects: ['public.orders'] } }))!.status, 200);
  const narrowed = (await host.planningSources(f.project.id, { taskId: f.task.id, modelOutlet: dbLinkModelOutlet(model) }))[0]!;
  assert.equal(narrowed.state, 'available'); assert.deepEqual(narrowed.scope?.objects, ['public.orders']);
  assert.notEqual(narrowed.permissionRef, original.permissionRef, 'a confirmed narrower effective scope has its own exact snapshot');
  assert.equal((await host.request('PUT', sourcePath, { excluded: true }))!.status, 200);
  const excluded = (await host.planningSources(f.project.id, { taskId: f.task.id, modelOutlet: dbLinkModelOutlet(model) }))[0]!;
  assert.equal(excluded.state, 'excluded'); assert.equal(excluded.enabled, false); assert.equal(excluded.scope, undefined);
  assert.equal((await host.planningSources(f.project.id, { taskId: other.id }))[0]!.state, 'available');
  assert.deepEqual((await host.planningSources(f.project.id))[0], original);
  await assert.rejects(host.planningSources(f.project.id, { taskId: 'ffffffff-ffff-4fff-8fff-ffffffffffff' }));
  assert.equal(f.driverCalls(), 0);
});

test('PG05: connection changes retain the granted revision but disable selection without refreshing or regranting', async t => {
  const f = await fixture(t), saved = await f.save(), originalGrant = await f.grant(saved.id);
  const revised = await f.save({ ...connection, id: saved.id, password: 'REVISED_DATABASE_PRIVATE_SECRET' });
  assert.equal(revised.revision, 2);
  const host = await f.makeHost(), before = await readFile(f.stored.settingsPath, 'utf8');
  const source = (await host.planningSources(f.project.id, { taskId: f.task.id, modelOutlet: dbLinkModelOutlet(model) }))[0]!;
  assert.equal(source.version, '1'); assert.equal(source.sha256, saved.fingerprint);
  assert.equal(source.state, 'configuration-changed'); assert.equal(source.enabled, false); assert.equal(source.scope, undefined);
  assert.match(source.permissionRef, new RegExp(`^db-grant:${originalGrant.id}:`));
  const reopened = await f.makeHost();
  assert.deepEqual(await reopened.planningSources(f.project.id, { taskId: f.task.id }), await host.planningSources(f.project.id, { taskId: f.task.id }));
  assert.equal(await readFile(f.stored.settingsPath, 'utf8'), before);
  assert.equal(f.driverCalls(), 0);
});

test('PG05: the actual model outlet and content export filter metadata without widening the original grant', async t => {
  const f = await fixture(t), saved = await f.save();
  await f.grant(saved.id, { ...modelExport, structure: false, comments: false });
  const host = await f.makeHost(), outlet = dbLinkModelOutlet(model);
  const permitted = (await host.planningSources(f.project.id, { modelOutlet: outlet }))[0]!;
  assert.equal(permitted.title, connection.name); assert.equal(permitted.scope, undefined);
  assert.equal(permitted.modelExport.structure, false); assert.equal(permitted.modelExport.comments, false);
  const denied = await host.planningSources(f.project.id, { modelOutlet: dbLinkModelOutlet({ ...model, model: 'different-model' }) });
  assert.deepEqual(denied, []); assert.ok(!JSON.stringify(denied).includes(connection.name));
  assert.deepEqual(await host.planningSources(f.project.id, { modelOutlet: '' }), [], 'an invalid model outlet must never fall back to the human projection');
  assert.ok((await host.planningSources(f.project.id))[0]!.scope, 'human metadata access remains separate from model export');
  const response = await host.request('DELETE', `/api/projects/${f.project.id}/db-link/sources/${saved.id}`);
  assert.equal(response!.status, 200);
  assert.equal((await host.planningSources(f.project.id))[0]!.state, 'revoked');
  assert.deepEqual(await host.planningSources(f.project.id, { modelOutlet: outlet }), []);
  assert.equal(f.driverCalls(), 0);
});
