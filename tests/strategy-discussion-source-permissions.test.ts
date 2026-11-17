import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { createStrategyDiscussionSourcePermissions } from '../src/host/strategy-discussion-source-permissions.ts';
import { dbLinkModelOutlet } from '../src/host/db-link-planning.ts';
import type { RuntimeModelConfiguration } from '../src/host/config-store.ts';
import type { StrategyDiscussion } from '../src/host/strategy-discussion-types.ts';
function fixture() {
  const projectId = randomUUID(), taskId = randomUUID(), datasetId = randomUUID(), inputVersionId = randomUUID(), connectionId = randomUUID(), sourceId = randomUUID(), descriptionRevisionId = randomUUID();
  const config: RuntimeModelConfiguration = { id: 'synthetic', revision: 1, name: 'synthetic', provider: 'synthetic', model: 'A', api: 'openai-completions', baseUrl: 'https://synthetic.invalid', apiKey: 'synthetic-only' };
  const owner = { projectId, taskId, requestId: randomUUID(), operationId: randomUUID() };
  const discussion = { id: randomUUID(), configurationId: config.id, configurationRevision: 1, projectId, methods: [], sources: [] } as unknown as StrategyDiscussion;
  const receivingTaskId = randomUUID(); let receiverEnabled = true, receiverScope: string[] | undefined, receiverResults = true;
  let grant = true, scope = ['public.orders'], exported = true, manifestReads = 0, descriptionReads = 0, sharedAllowed = true;
  const sourceNote = JSON.stringify({ kind: 'db-link-structure-source', sourceKind: 'query-result', sourceId, source: { connectionId, connectionRevision: 2, sourceIdentity: 'synthetic-server' }, owner, structureOnly: true, dataRowsFrozenByDataContext: false });
  const assertReadable = createStrategyDiscussionSourcePermissions({
    projects: { async get(id) { return { id, archivedAt: null, uploads: [{ id: 'upload', path: '020_clean/background.md' }] } as any; }, async getTask(id, task) { assert.equal(id, projectId); assert.ok(task===taskId||task===receivingTaskId); return { id: task, archivedAt: null } as any; } },
    data: { async readVersion() { return { sourceNote } as any; }, async readDescription() { descriptionReads++; return { inputVersionId, observation: { fields: [] }, statements: [], mappings: [] } as any; }, async readCitationManifest() { return { selections: [{ datasetId, inputVersionId, descriptionRevisionId }], conceptRefs: [], sapRefs: [], nativeEvidence: { taskId } } as any; } },
    dbLinks: { async planningSources(_id, options) { assert.ok(options?.taskId===taskId||options?.taskId===receivingTaskId);if(options?.taskId===receivingTaskId&&!receiverEnabled)return []; return grant && options?.modelOutlet === dbLinkModelOutlet(config) ? [{ id: `db-link:${connectionId}`, enabled: true, state: 'available', version: '2', scope: { objects: options?.taskId === receivingTaskId ? receiverScope ?? scope : scope }, modelExport: { structure: true, comments: false, queryText: true, results: options?.taskId === receivingTaskId ? receiverResults : true } }] as any : []; }, async resultManifestSource(_id, task, id) { manifestReads++; assert.equal(task, taskId); assert.equal(id, sourceId); return { receipt: { owner }, manifest: { owner, source: { connectionId, connectionRevision: 2, sourceIdentity: 'synthetic-server', observedObjects: ['public.orders'], declaredObjects: ['public.orders'], unknownObjects: [], modelExport: { targets: [dbLinkModelOutlet(config)], structure: true, comments: false, queryText: true, results: exported } } } } as any; }, metadataReader: { async read() { throw new Error('not selected'); } } },
    enterpriseSourceAllowed: () => sharedAllowed, isClosing: () => false,
  });
  const context = { signal: new AbortController().signal, assertCurrent() {} }, target = { kind: 'data-description', projectId, datasetId, inputVersionId, descriptionRevisionId };
  return { assertReadable, discussion, config, context, target, taskId, projectId, receivingTaskId, excludeReceiver() { receiverEnabled = false; }, narrowReceiver() { receiverScope = ['public.other']; }, denyReceiverResults() { receiverResults = false; }, calls: () => manifestReads, descriptionCalls: () => descriptionReads, revoke() { grant = false; }, narrow() { scope = ['public.other']; }, noFixedExport() { exported = false; }, denyShared() { sharedAllowed = false; } };
}

test('a known DB-derived description reuses current original grant, source Task and actual model outlet without reading result rows', async () => {
  const f = fixture();
  await f.assertReadable(f.discussion, f.config, f.target, f.context);
  assert.ok(f.calls() > 0, 'only the original manifest metadata facet is consulted');
  f.revoke();
  await assert.rejects(f.assertReadable(f.discussion, f.config, f.target, f.context), /strategy_source_not_authorized/);
});

test('a fixed DB result cannot reuse removed export, narrowed current objects or another actual model outlet', async () => {
  const removed = fixture(); removed.noFixedExport();
  await assert.rejects(removed.assertReadable(removed.discussion, removed.config, removed.target, removed.context), /strategy_source_not_authorized/);
  const narrow = fixture(); narrow.narrow();
  await assert.rejects(narrow.assertReadable(narrow.discussion, narrow.config, narrow.target, narrow.context), /strategy_source_not_authorized/);
  const switched = fixture();
  await assert.rejects(switched.assertReadable(switched.discussion, { ...switched.config, model: 'B' }, switched.target, switched.context), /strategy_source_not_authorized/);
  assert.equal(switched.calls(), 0, 'a blocked outlet is refused before original manifest access');
});

test('metadata catalog qualification does not read description bodies and current purpose never grants shared assets', async () => {
  const f = fixture();
  await f.assertReadable(f.discussion, f.config, f.target, { ...f.context, metadataOnly: true });
  assert.equal(f.descriptionCalls(), 0);
  f.denyShared();
  await assert.rejects(f.assertReadable({ ...f.discussion, usageContext: { kind: 'organization', background: '不能代表权限' } }, f.config, { kind: 'sap-method', methodId: randomUUID(), version: 1 }, f.context), /strategy_source_not_authorized/);
  await assert.rejects(f.assertReadable({ ...f.discussion, projectId: undefined }, f.config, { kind: 'sap-method', methodId: randomUUID(), version: 1 }, f.context), /strategy_source_not_authorized/);
});

test('stopped source work does not revive owner reads or broaden the original citation selection dependencies', async () => {
  const f = fixture(), controller = new AbortController(); controller.abort();
  await assert.rejects(f.assertReadable(f.discussion, f.config, f.target, { ...f.context, signal: controller.signal }), /abort/i);
  assert.equal(f.calls(), 0);
  f.revoke();
  await assert.rejects(f.assertReadable(f.discussion, f.config, { kind: 'citation-report', projectId: f.projectId, taskId: f.taskId, citationId: randomUUID() }, f.context), /strategy_source_not_authorized/);
});

test('a source locator cannot mint a missing Project selection or move a discussion from selected Project A into Project B', async () => {
  const f = fixture(), own = { kind: 'project-document', projectId: f.projectId, uploadId: 'upload', path: '020_clean/background.md' };
  await f.assertReadable(f.discussion, f.config, own, f.context);
  await assert.rejects(f.assertReadable({ ...f.discussion, projectId: undefined }, f.config, own, f.context), /strategy_source_not_authorized/);
  await assert.rejects(f.assertReadable(f.discussion, f.config, { ...own, projectId: randomUUID() }, f.context), /strategy_source_not_authorized/);
  await assert.rejects(f.assertReadable({ ...f.discussion, projectId: undefined }, f.config, { kind: 'source', source: { type: 'native-reply', projectId: f.projectId, taskId: f.taskId } }, f.context), /strategy_source_not_authorized/);
  assert.equal(f.calls(), 0);
});

test('an actual receiving Task exclusion also applies to a Goal source derived from an otherwise permitted original Task',async()=>{const f=fixture();f.excludeReceiver();await assert.rejects(f.assertReadable(f.discussion,f.config,f.target,{...f.context,receivingTask:{projectId:f.projectId,taskId:f.receivingTaskId}}),/strategy_source_not_authorized/);});


test('Goal source reuse intersects receiving Task scope and export with its original source Task', async () => {
  const valid = fixture();
  await valid.assertReadable(valid.discussion, valid.config, valid.target, { ...valid.context, receivingTask: { projectId: valid.projectId, taskId: valid.receivingTaskId } });
  const narrow = fixture(); narrow.narrowReceiver();
  await assert.rejects(narrow.assertReadable(narrow.discussion, narrow.config, narrow.target, { ...narrow.context, receivingTask: { projectId: narrow.projectId, taskId: narrow.receivingTaskId } }), /strategy_source_not_authorized/);
  const noExport = fixture(); noExport.denyReceiverResults();
  await assert.rejects(noExport.assertReadable(noExport.discussion, noExport.config, noExport.target, { ...noExport.context, receivingTask: { projectId: noExport.projectId, taskId: noExport.receivingTaskId } }), /strategy_source_not_authorized/);
  const wrongOwner = fixture();
  await assert.rejects(wrongOwner.assertReadable(wrongOwner.discussion, wrongOwner.config, wrongOwner.target, { ...wrongOwner.context, receivingTask: { projectId: randomUUID(), taskId: wrongOwner.receivingTaskId } }), /strategy_source_not_authorized/);
});
