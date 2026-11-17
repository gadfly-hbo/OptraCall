import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import { ProjectStore } from '../src/host/project-store.ts';
import { ProjectDataContextStore } from '../src/host/project-data-context-store.ts';
import { EnterpriseMaterialsStore } from '../src/host/enterprise-materials-store.ts';
import { createStrategyDiscussionSource, createStrategyDiscussionSources } from '../src/host/strategy-discussion-sources.ts';
import { createStrategyDiscussionSourcePermissions } from '../src/host/strategy-discussion-source-permissions.ts';
import type { StrategyDiscussion } from '../src/host/strategy-discussion-types.ts';
import type { RuntimeModelConfiguration } from '../src/host/config-store.ts';

const configuration: RuntimeModelConfiguration = { id: 'pm01-facet-synthetic', revision: 1, name: 'PM01 isolated source facet', provider: 'synthetic', model: 'facet-only', api: 'openai-completions', baseUrl: 'http://127.0.0.1:9/v1', apiKey: 'synthetic-only' };
async function fixture(t: { after(fn: () => Promise<void>): void }) {
  const evidenceRoot = path.resolve('.local/v12-pm01-fix/facet');
  await mkdir(evidenceRoot, { recursive: true });
  const root = await mkdtemp(path.join(evidenceRoot, 'run-'));
  const projects = new ProjectStore({ dataRoot: path.join(root, 'host'), projectsRoot: path.join(root, 'projects') });
  await projects.init(); t.after(() => projects.close());
  const project = await projects.create({ name: '服饰零售：已明确背景范围', configuration });
  const body = '本项目经营计划：先核对会员复购期间与口径，库存和季节解释仍待补证。';
  await projects.upload({ projectId: project.id, name: '经营计划.md', directory: '020_clean', bytes: Buffer.from(body) });
  await projects.upload({ projectId: project.id, name: '会员交易明细.csv', directory: '020_clean', bytes: Buffer.from('member_id,amount\nsynthetic,1\n') });
  const data = new ProjectDataContextStore({ dataRoot: projects.dataRoot, projects });
  const permissions = createStrategyDiscussionSourcePermissions({ projects, data, enterpriseSourceAllowed: () => false, isClosing: () => false });
  let captures = 0;
  const port = createStrategyDiscussionSources({ projects: { get: projects.get.bind(projects), tree: projects.tree.bind(projects), async captureFeedbackFile(...args: Parameters<ProjectStore['captureFeedbackFile']>) { captures++; return projects.captureFeedbackFile(...args); } }, data, assertReadable: permissions });
  const discussion = { id: randomUUID(), title: '已明确本项目背景', revision: 1, configurationId: configuration.id, configurationRevision: 1, methods: [], projectId: project.id, sources: [], sourceScope: { mode: 'project-background' }, createdAt: '2026-11-17T00:00:00Z', updatedAt: '2026-11-17T00:00:00Z' } as StrategyDiscussion;
  const context = { signal: new AbortController().signal, assertCurrent() {} };
  return { root, projects, project, body, data, discussion, port, context, captures: () => captures };
}

test('PM-V12-01: an explicitly bounded Project background is discovered and read without per-file manual selection', async t => {
  const f = await fixture(t);
  const catalog = await f.port.list(f.discussion, configuration, f.context);
  assert.equal(f.captures(), 0, 'catalog metadata does not eagerly read document bodies');
  assert.equal(catalog.length, 1, 'business input CSV is not a strategic background document');
  const document = catalog[0];
  assert.equal(document.title, '经营计划.md');
  assert.equal(JSON.stringify(catalog).includes('库存和季节解释'), false, 'discovery is not content delivery');
  const actual = await f.port.read(document, f.discussion, configuration, f.context, { offset: 0, limit: 8 });
  assert.equal(actual.text, '本项目经营计划：');
  assert.deepEqual(actual.range, { start: 0, end: 8, total: f.body.length });
  assert.equal(actual.complete, false);
  assert.equal(actual.source.sha256, createHash('sha256').update(f.body).digest('hex'));
  assert.deepEqual(f.discussion.sources, [], 'autonomous read does not masquerade as manual user selection');
  await writeFile(path.join(f.root, 'actual-source-read.json'), JSON.stringify({ catalog, actual }, null, 2));
  t.diagnostic(f.root);
});

test('PM-V12-01: empty legacy and explicit only-selected scopes stay closed while explicit selections and exclusions remain distinct', async t => {
  const f = await fixture(t), catalog = await f.port.list(f.discussion, configuration, f.context), source = catalog[0];
  const legacy = { ...f.discussion, sourceScope: undefined };
  const onlySelected = { ...f.discussion, sourceScope: { mode: 'selected-only' as const } };
  await assert.rejects(f.port.read(source, legacy, configuration, f.context), /strategy_source_not_selected/);
  await assert.rejects(f.port.read(source, onlySelected, configuration, f.context), /strategy_source_not_selected/);
  const manual = { ...onlySelected, sources: [source] };
  assert.equal((await f.port.read(source, manual, configuration, f.context)).text, f.body);
  const excluded = { ...manual, sourceScope: { mode: 'selected-only' as const, excludedSources: [source] } };
  await assert.rejects(f.port.read(source, excluded, configuration, f.context), /strategy_source_excluded/);
  assert.deepEqual((await f.port.list(excluded, configuration, f.context)).map(item => item.id), [source.id], 'manual directory management can still find and unexclude an otherwise qualified source');
  await f.port.verify(excluded, configuration, f.context, [source]);
  assert.equal(f.discussion.sources.length, 0);
  t.diagnostic(f.root);
});

test('PM-V12-01: autonomous exact enterprise reads retain grants and persistent resource exclusions across published versions', async t => {
  const f = await fixture(t), enterprise = new EnterpriseMaterialsStore(path.join(f.root, 'enterprise'));
  const created = await enterprise.create({ title: '原经营计划', body: '第一版：会员范围及未知条件', scope: '明确合成服饰企业' });
  const enabled = await enterprise.enable(created.material.id, created.material.version);
  let granted = true;
  const permissions = createStrategyDiscussionSourcePermissions({ projects: f.projects, data: f.data, enterpriseSourceAllowed: (projectId, target) => granted && projectId === f.project.id && target.kind === 'enterprise' && target.storeId === created.storeId && target.materialId === created.material.id, isClosing: () => false });
  const port = createStrategyDiscussionSources({ projects: f.projects, data: f.data, enterprise, assertReadable: permissions });
  const first = (await port.list(f.discussion, configuration, f.context)).find(source => source.target.kind === 'enterprise')!;
  assert.ok(first);
  assert.equal((await port.read(first, f.discussion, configuration, f.context)).text, '第一版：会员范围及未知条件');
  const edited = await enterprise.update(enabled.material.id, enabled.material.version, { body: '第二版：观察期间发生变化' });
  await enterprise.enable(edited.material.id, edited.material.version);
  const second = (await port.list(f.discussion, configuration, f.context)).find(source => source.target.kind === 'enterprise')!;
  assert.notEqual(second.id, first.id);
  const excluded = { ...f.discussion, sourceScope: { mode: 'project-background' as const, excludedSources: [first] } };
  await assert.rejects(port.read(second, excluded, configuration, f.context), /strategy_source_excluded/);
  assert.equal((await port.read(second, f.discussion, configuration, f.context)).text, '第二版：观察期间发生变化');
  await assert.rejects(port.read(first, f.discussion, configuration, f.context), /strategy_source_unavailable|strategy_source_changed/);
  granted = false;
  await assert.rejects(port.read(second, f.discussion, configuration, f.context), /strategy_source_not_authorized/);
  assert.equal((await port.list(f.discussion, configuration, f.context)).some(source => source.target.kind === 'enterprise'), false);
  t.diagnostic(f.root);
});

test('PM-V12-01: background discovery cannot broaden the Project, read raw input or replace a changed exact document', async t => {
  const f = await fixture(t), catalog = await f.port.list(f.discussion, configuration, f.context), source = catalog[0];
  const other = await f.projects.create({ name: '另一个项目', configuration });
  const foreign = await f.projects.upload({ projectId: other.id, name: '其他项目计划.md', directory: '020_clean', bytes: Buffer.from('非本轮背景') });
  const otherSource = createStrategyDiscussionSource('其他项目计划.md', { kind: 'project-document', projectId: other.id, path: foreign.path, uploadId: foreign.id }, foreign.sha256, foreign.uploadedAt);
  await assert.rejects(f.port.read(otherSource, f.discussion, configuration, f.context), /strategy_source_not_authorized/);
  assert.equal(f.captures(), 0);
  const raw = (await f.projects.get(f.project.id)).uploads.find(upload => upload.path.endsWith('.csv'))!;
  const rawSource = createStrategyDiscussionSource(raw.originalName, { kind: 'project-document', projectId: f.project.id, path: raw.path, uploadId: raw.id }, raw.sha256, raw.uploadedAt);
  await assert.rejects(f.port.read(rawSource, f.discussion, configuration, f.context), /strategy_source_unavailable|strategy_source_not_authorized/);
  await assert.rejects(f.port.read(rawSource, { ...f.discussion, sources: [rawSource] }, configuration, f.context), /strategy_source_not_authorized/);
  assert.equal(f.captures(), 0, 'neither catalog membership nor human selection opens raw detail');
  await assert.rejects(f.port.read(source, { ...f.discussion, projectId: undefined }, configuration, f.context), /strategy_source_not_selected/);
  await writeFile(path.join(f.project.rootPath, source.target.path as string), '已变化的文件，不能冒原准确正文');
  await assert.rejects(f.port.read(source, f.discussion, configuration, f.context), /strategy_source_changed/);
  assert.equal(source.sha256, createHash('sha256').update(f.body).digest('hex'), 'original source tuple remains fixed');
  t.diagnostic(f.root);
});

test('PM-V12-01: cancelled and stale leases reject autonomous reads without altering manual choices or reading the body', async t => {
  const f = await fixture(t), source = (await f.port.list(f.discussion, configuration, f.context))[0];
  const controller = new AbortController(); controller.abort();
  await assert.rejects(f.port.read(source, f.discussion, configuration, { ...f.context, signal: controller.signal }), /abort/i);
  await assert.rejects(f.port.read(source, f.discussion, configuration, { assertCurrent() { throw new Error('original_lease_no_longer_current'); } }), /original_lease_no_longer_current/);
  assert.equal(f.captures(), 0);
  assert.deepEqual(f.discussion.sources, []);
  t.diagnostic(f.root);
});

test('PM-V12-01: historical catalog metadata rechecks original qualification without reading unprovided document bodies', async t => {
  const f = await fixture(t), source = (await f.port.list(f.discussion, configuration, f.context))[0];
  await writeFile(path.join(f.project.rootPath, source.target.path as string), '原目录之后正文已改变，不可冒称旧正文仍可读');
  await f.port.verify(f.discussion, configuration, { ...f.context, metadataOnly: true }, [source]);
  assert.equal(f.captures(), 0, 'metadata egress qualification does not claim or perform a source body read');
  await assert.rejects(f.port.read(source, f.discussion, configuration, f.context), /strategy_source_changed/);
  await assert.rejects(f.port.verify(f.discussion, configuration, f.context, [source]), /strategy_source_changed/);
  const beforeDenied = f.captures();
  await assert.rejects(f.port.verify(f.discussion, { ...configuration, revision: 2 }, { ...f.context, metadataOnly: true }, [source]), /strategy_source_not_authorized/);
  await f.projects.archive(f.project.id);
  await assert.rejects(f.port.verify(f.discussion, configuration, { ...f.context, metadataOnly: true }, [source]), /strategy_source_not_authorized/);
  assert.equal(f.captures(), beforeDenied, 'metadata-only current outlet/Project refusal never opens the document');
  t.diagnostic(f.root);
});
