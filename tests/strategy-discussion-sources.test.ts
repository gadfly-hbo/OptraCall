import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { createStrategyDiscussionSources, createStrategyDiscussionSource, type StrategyDiscussionSourcesOptions } from '../src/host/strategy-discussion-sources.ts';
import type { StrategyDiscussion } from '../src/host/strategy-discussion-types.ts';
const sha = (bytes: string | Buffer) => createHash('sha256').update(bytes).digest('hex');
function fixture() {
  const projectId = randomUUID(), uploadId = randomUUID(), body = '已有战略说明：优先服务核心会员。资源与因果前提仍待核。';
  let currentBody = body, allowed = true, captureCount = 0, catalogCount = 0;
  const configuration = { id: randomUUID(), revision: 1, provider: 'synthetic', model: 'A' };
  const project = { id: projectId, name: '合成服饰', archivedAt: null, tasks: [], uploads: [{ id: uploadId, originalName: '原战略.md', path: '020_clean/strategy.md', bytes: Buffer.byteLength(body), sha256: sha(body), uploadedAt: '2026-11-17T00:00:00.000Z', source: { kind: 'upload' } }] };
  const discussion = { id: randomUUID(), title: '讨论方向', revision: 1, configurationId: configuration.id, configurationRevision: 1, methods: [], projectId, sources: [], createdAt: '2026-11-17T00:00:00Z', updatedAt: '2026-11-17T00:00:00Z' } as StrategyDiscussion;
  const options: StrategyDiscussionSourcesOptions<typeof configuration> = {
    projects: { async get(id: string) { assert.equal(id, projectId); catalogCount++; return project as any; }, async tree() { return [{ kind: 'directory' as const, name: '020_clean', path: '020_clean', children: [{ kind: 'file' as const, name: 'strategy.md', path: '020_clean/strategy.md', bytes: Buffer.byteLength(currentBody) }] }]; }, async captureFeedbackFile() { captureCount++; return { bytes: Buffer.from(currentBody), sha256: sha(currentBody), observedAt: '2026-11-17T00:00:00Z' }; } },
    data: { async getIndex() { return null; }, async readDescription() { throw new Error('not selected'); }, async readCitationManifest() { throw new Error('not selected'); }, async readCitationEvidenceFile() { throw new Error('not selected'); } },
    assertReadable(_owner, actualConfiguration) { assert.equal(actualConfiguration.model, 'A'); if (!allowed) throw Object.assign(new Error('revoked'), { code: 'permission_revoked' }); },
  };
  const port = createStrategyDiscussionSources(options);
  const context = { signal: new AbortController().signal, assertCurrent() {} };
  return { port, options, projectId, project, discussion, configuration, context, body, revoke() { allowed = false; }, changeBody(value: string) { currentBody = value; }, counts() { return { captureCount, catalogCount }; } };
}

test('a strategic background catalog uses stored upload metadata without reading business file bytes until the Agent explicitly reads its exact selection', async () => {
  const f = fixture(), sources = await f.port.list(f.discussion, f.configuration, f.context);
  assert.equal(sources.length, 1);
  assert.equal(sources[0].title, '原战略.md');
  assert.equal(sources[0].sha256, sha(f.body));
  assert.equal(f.counts().captureCount, 0);
  const result = await f.port.read(sources[0], { ...f.discussion, sources }, f.configuration, f.context, { offset: 0, limit: 10 });
  assert.equal(result.text, '已有战略说明：优先服');
  assert.deepEqual(result.range, { start: 0, end: 10, total: f.body.length });
  assert.equal(result.complete, false);
  assert.equal(f.counts().captureCount, 1);
});

test('current authorization is rechecked after catalog capture and before a selected source can leave the Host', async () => {
  const f = fixture(), sources = await f.port.list(f.discussion, f.configuration, f.context), discussion = { ...f.discussion, sources };
  f.revoke();
  await assert.rejects(f.port.verify(discussion, f.configuration, f.context), /strategy_source_not_authorized/);
  await assert.rejects(f.port.read(sources[0], discussion, f.configuration, f.context), /strategy_source_not_authorized/);
  assert.equal(f.counts().captureCount, 0, 'a revoked projection is refused before reading its document');
});

test('changed selected content is refused and unrelated project metadata does not change its exact source identity', async () => {
  const f = fixture(), sources = await f.port.list(f.discussion, f.configuration, f.context), discussion = { ...f.discussion, sources };
  f.project.name = '只修改项目名称';
  await f.port.verify(discussion, f.configuration, f.context);
  f.changeBody('这已经是另一份正文');
  await assert.rejects(f.port.verify(discussion, f.configuration, f.context), /strategy_source_changed/);
  assert.equal(discussion.sources[0].sha256, sha(f.body));
});

test('no Project means no automatic global source catalog and a discussion cannot use unselected, raw-data or closed-resource locators', async () => {
  const f = fixture();
  assert.deepEqual(await f.port.list({ ...f.discussion, projectId: undefined }, f.configuration, f.context), []);
  assert.equal(f.counts().catalogCount, 0);
  const sources = await f.port.list(f.discussion, f.configuration, f.context);
  await assert.rejects(f.port.read(sources[0], f.discussion, f.configuration, f.context), /strategy_source_not_selected/);
  for (const target of [{ kind: 'data-input', projectId: f.projectId, datasetId: randomUUID(), inputVersionId: randomUUID() }, { kind: 'managed-workspace', projectId: f.projectId, path: '060_reports/output.md' }, { kind: 'project-document', projectId: f.projectId, uploadId: randomUUID(), path: '010_draw/original.txt' }]) {
    const forbidden = createStrategyDiscussionSource('不可提升来源', target, 'f'.repeat(64), 'v1');
    await assert.rejects(f.port.read(forbidden, { ...f.discussion, sources: [forbidden] }, f.configuration, f.context), /strategy_source_not_authorized/);
  }
  assert.equal(f.counts().captureCount, 0);
});

test('an exact native reply keeps the original reader and explicitly selected excerpt is not claimed as a full source read', async () => {
  const f = fixture(), sourceRef = { type: 'native-reply', projectId: f.projectId, taskId: randomUUID(), sessionId: 'native-original', messageId: 'reply-original', expectedTextSha256: sha('完整原文'), excerpt: { start: 0, end: 2 } };
  const selected = createStrategyDiscussionSource('原聊天成果', { kind: 'source', source: sourceRef }, sha('完整原文'), 'reply-original');
  let read = false;
  const port = createStrategyDiscussionSources({ ...f.options, async readSource(ref, options) { read = true; assert.deepEqual(ref, sourceRef); assert.equal(options?.audience, 'agent'); return { ref, title: '原聊天成果', text: '完整', sha256: sha('完整原文'), status: 'available' }; } });
  const result = await port.read(selected, { ...f.discussion, sources: [selected] }, f.configuration, f.context);
  assert.equal(read, true); assert.equal(result.text, '完整'); assert.equal(result.complete, false);
});

test('a known bad method remains unreadable while the Agent can receive stable selection metadata and read an independent document', async () => {
  const f = fixture(), methodId = randomUUID(); let issue: null | { status: 'confirmed' } = null;
  const port = createStrategyDiscussionSources({ ...f.options, methods: { listPublished() { return [{ id: methodId, title: '原方法', publishedVersion: 1, issue }] as any; }, getPublished() { return { version: { title: '原方法', version: 1, contentSha256: 'd'.repeat(64), content: { logic: '方法原文' } }, issue } as any; } } });
  const sources = await port.list(f.discussion, f.configuration, f.context), method = sources.find(value => value.target.kind === 'sap-method')!, document = sources.find(value => value.target.kind === 'project-document')!, discussion = { ...f.discussion, sources };
  issue = { status: 'confirmed' };
  await port.verify(discussion, f.configuration, f.context);
  await assert.rejects(port.read(method, discussion, f.configuration, f.context), /strategy_source_disabled/);
  assert.match((await port.read(document, discussion, f.configuration, f.context)).text, /已有战略说明/);
  assert.equal((await port.list(discussion, f.configuration, f.context)).some(value => value.target.kind === 'sap-method'), false);
});

test('an exact existing data description and published IR can be selected without reading input rows or creating a method copy', async () => {
  const f = fixture(), datasetId = randomUUID(), inputVersionId = randomUUID(), descriptionRevisionId = randomUUID(), methodId = randomUUID();
  let descriptionReads = 0;
  const description = { descriptionRevisionId, inputVersionId, statements: [{ text: '时间可比性仍需核对' }] };
  const method = { version: { title: '原SAP改善方法', version: 2, contentSha256: 'd'.repeat(64), content: { conditions: '资料可比', logic: '自主选择工具', judgment: '保留替代解释', limits: '不证明因果' } }, publication: { version: 2, contentSha256: 'd'.repeat(64) }, issue: null };
  const port = createStrategyDiscussionSources({ ...f.options,
    data: { ...f.options.data, async getIndex() { return { schemaVersion: 2, projectId: f.projectId, revision: 1, datasets: [{ datasetId, name: '原会员资料', createdAt: '2026-11-17T00:00:00Z', sourcePath: '020_clean/members.csv', uploadId: null, versions: [{ inputVersionId, recordSha256: 'c'.repeat(64) }], descriptions: [{ descriptionRevisionId, inputVersionId, recordSha256: 'e'.repeat(64) }], latestDescriptionByInputVersion: { [inputVersionId]: descriptionRevisionId } }], citations: [] } as const; }, async readDescription() { descriptionReads++; return description as any; } },
    methods: { listPublished() { return [{ id: methodId, title: '原SAP改善方法', publishedVersion: 2, origin: 'ir' }] as any; }, getPublished() { return method as any; } },
  });
  const sources = await port.list(f.discussion, f.configuration, f.context);
  const dataSource = sources.find(value => value.target.kind === 'data-description');
  const methodSource = sources.find(value => value.target.kind === 'sap-method');
  assert.ok(dataSource); assert.ok(methodSource);
  assert.equal(descriptionReads, 0);
  assert.equal(f.counts().captureCount, 0);
  const discussion = { ...f.discussion, sources: [dataSource, methodSource] };
  assert.match((await port.read(dataSource, discussion, f.configuration, f.context)).text, /时间可比性仍需核对/);
  assert.match((await port.read(methodSource, discussion, f.configuration, f.context)).text, /保留替代解释/);
  assert.equal(descriptionReads, 1);
  assert.equal(f.counts().captureCount, 0);
});

test('normal saved reports and no-file replies are discovered from original Task receipts without requiring an upload or citation copy', async () => {
  const f = fixture(), taskId = randomUUID(), requestId = randomUUID(), body = '普通Task原文件报告', reply = '无文件Task原聊天成果';
  f.project.tasks.push({ id: taskId, name: '原分析Task' } as never);
  const reports = [{ projectId: f.projectId, taskId, requestId, sessionId: 'task-native', toolCallId: 'saved-tool', relativePath: '060_reports/normal.md', sha256: sha(body), bytes: Buffer.byteLength(body), nativeEntryId: 'saved-entry' }], replies = [{ projectId: f.projectId, taskId, requestId, sessionId: 'task-native', messageId: 'reply-entry', sha256: sha(reply), bytes: Buffer.byteLength(reply) }];
  const port = createStrategyDiscussionSources({ ...f.options, projects: { ...f.options.projects, async captureFeedbackFile(_projectId, path) { assert.equal(path, '060_reports/normal.md'); return { bytes: Buffer.from(body), sha256: sha(body), observedAt: '2026-11-17T00:00:00Z' }; } }, async listTaskSources() { return { reports, replies }; }, async readSource(ref) { assert.equal(ref.type, 'native-reply'); return { ref, title: '原分析Task', text: reply, sha256: sha(reply), status: 'available' }; } });
  const sources = await port.list(f.discussion, f.configuration, f.context), report = sources.find(source => source.target.kind === 'task-report'), native = sources.find(source => source.target.kind === 'task-native-reply');
  assert.ok(report); assert.ok(native);
  assert.equal(report.version, requestId); assert.equal(native.version, requestId);
  const discussion = { ...f.discussion, sources: [report, native] };
  assert.equal((await port.read(report, discussion, f.configuration, f.context)).text, body);
  assert.equal((await port.read(native, discussion, f.configuration, f.context)).text, reply);
  reports[0] = { ...reports[0], requestId: randomUUID(), sha256: 'c'.repeat(64) };
  await assert.rejects(port.read(report, discussion, f.configuration, f.context), /strategy_source_changed|strategy_source_unavailable/);
  assert.equal(discussion.sources[0].version, requestId);
});

test('only an absent optional enterprise directory is isolated during catalog discovery, while exact reads and permission failures stay unavailable', async () => {
  const f = fixture(); let bodyReads = 0;
  const enterprise = { async referenceIndex() { throw Object.assign(new Error('enterprise_source_missing'), { code: 'enterprise_source_missing' }); }, async readRevision() { bodyReads++; throw new Error('should not open enterprise body'); } };
  const port = createStrategyDiscussionSources({ ...f.options, enterprise });
  const sources = await port.list(f.discussion, f.configuration, f.context);
  assert.equal(sources.length, 1); assert.equal(sources[0].target.kind, 'project-document');
  assert.equal(f.counts().captureCount, 0); assert.equal(bodyReads, 0);
  const missing = createStrategyDiscussionSource('明确但失读的企业来源', { kind: 'enterprise', storeId: randomUUID(), materialId: randomUUID(), revisionId: randomUUID() }, 'a'.repeat(64), 'original-revision');
  await assert.rejects(port.read(missing, { ...f.discussion, sources: [missing] }, f.configuration, f.context), /enterprise_source_missing/);
  const denied = createStrategyDiscussionSources({ ...f.options, enterprise: { ...enterprise, async referenceIndex() { throw Object.assign(new Error('enterprise_source_forbidden'), { code: 'enterprise_source_forbidden' }); } } });
  await assert.rejects(denied.list(f.discussion, f.configuration, f.context), /enterprise_source_forbidden/);
  assert.equal(bodyReads, 0);
});
