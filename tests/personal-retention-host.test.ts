import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile, unlink } from 'node:fs/promises';
import path from 'node:path';
import { startTestHost } from './fixtures/host-process.ts';
import { readJson } from './fixtures/joint-context.ts';

const base = '/api/personal-retention';
const metadata = { kind: 'knowledge', aliases: ['退货对齐'], caution: '仅供口径核对，效果未知。', sourceRefs: [] };

test('PR06/09 personal lookup starts genuinely empty without registering old materials or running an Agent', { timeout: 30_000 }, async t => {
  const host = await startTestHost(); t.after(() => host.close());
  const created = await readJson(await host.request('/api/enterprise-materials', 'POST', { title: '既有资料不会自动保留', body: '未经个人保留的原资料' }), 201);
  const before = await readFile(path.join(host.dataRoot, 'enterprise-business-materials/index.json'));
  const result = await readJson(await host.request(`${base}/lookup?category=all&includeBody=false&includeDrafts=false&includeArchived=false&page=1&pageSize=20`));
  assert.deepEqual(result.items, []); assert.equal(result.total, 0); assert.equal(result.complete, true);
  assert.equal((await readJson(await host.request(`${base}/items/${created.material.id}`))).item, null);
  assert.deepEqual(await readFile(path.join(host.dataRoot, 'enterprise-business-materials/index.json')), before);
  assert.equal((await readJson(await host.request('/api/projects'))).projects.length, 0);
});

test('PR02–04 exact retain stays separate from draft editing, enablement, history and archive through the real Host', { timeout: 30_000 }, async t => {
  const host = await startTestHost(); t.after(() => host.close());
  const created = await readJson(await host.request('/api/enterprise-materials', 'POST', { title: '旧保留标题', body: '旧保留正文，效果尚未知。', scope: '原范围' }), 201);
  const materialId = created.material.id, itemPath = `${base}/items/${materialId}`;
  const saved = await readJson(await host.request(`${itemPath}/draft`, 'POST', { expectedRevision: 0, metadata }));
  const editor = await readJson(await host.request(`${itemPath}/editor`));
  const firstRequest = { operationId: randomUUID(), expectedRevision: saved.item.revision, target: editor.draftTarget, metadata, personalLabel: null };
  const first = await readJson(await host.request(`${itemPath}/retain`, 'POST', firstRequest), 201);
  const exact = await readJson(await host.request(itemPath));
  assert.equal(exact.content.title, '旧保留标题'); assert.equal(exact.content.body, '旧保留正文，效果尚未知。');
  assert.equal(exact.decision.contentRef.revisionId, first.decision.contentRef.revisionId);
  const original = await readJson(await host.request(`/api/enterprise-materials/${materialId}`));
  assert.equal(original.material.enabled, false); assert.equal(original.material.activeRevisionId, null);
  const update = await readJson(await host.request(`/api/enterprise-materials/${materialId}`, 'PUT', { expectedVersion: original.material.version, title: '新草稿标题', body: '新草稿正文，没有自动替换旧经验。' }));
  const secondMeta = { ...metadata, aliases: ['新别名'], caution: '新提醒，仍须自行判断。' };
  const draft = await readJson(await host.request(`${itemPath}/draft`, 'POST', { expectedRevision: first.item.revision, metadata: secondMeta }));
  assert.equal((await readJson(await host.request(itemPath))).content.title, '旧保留标题');
  const oldLookup = await readJson(await host.request(`${base}/lookup?query=${encodeURIComponent('旧保留标题')}`));
  assert.equal(oldLookup.total, 1, 'default lookup keeps the retained content, not current draft title');
  const nextEditor = await readJson(await host.request(`${itemPath}/editor`));
  assert.equal(nextEditor.material.version, update.material.version);
  const second = await readJson(await host.request(`${itemPath}/retain`, 'POST', { operationId: randomUUID(), expectedRevision: draft.item.revision, target: nextEditor.draftTarget, metadata: secondMeta, personalLabel: null }), 201);
  assert.equal((await readJson(await host.request(itemPath))).content.title, '新草稿标题');
  const old = await readJson(await host.request(`${itemPath}?decisionId=${first.decision.operationId}`));
  assert.equal(old.content.title, '旧保留标题'); assert.equal(old.decision.metadata.caution, metadata.caution);
  const archived = await readJson(await host.request(`${itemPath}/archive`, 'POST', { operationId: randomUUID(), expectedRevision: second.item.revision, personalLabel: null }), 201);
  assert.equal((await readJson(await host.request(`${base}/lookup`))).total, 0);
  assert.equal((await readJson(await host.request(`${base}/lookup?includeArchived=true`))).total, 1);
  await readJson(await host.request(`${itemPath}/restore`, 'POST', { operationId: randomUUID(), expectedRevision: archived.item.revision, personalLabel: null }), 201);
  assert.equal((await readJson(await host.request(itemPath))).content.body, '新草稿正文，没有自动替换旧经验。');
  const operation = await readJson(await host.request(`${itemPath}/operations/${firstRequest.operationId}`));
  assert.equal(operation.state, 'committed'); assert.equal(operation.decision.contentRef.revisionId, first.decision.contentRef.revisionId);
});

test('PR08 an explicitly ended unobserved request cannot be revived by a late original POST', { timeout: 30_000 }, async t => {
  const host = await startTestHost(); t.after(() => host.close());
  const created = await readJson(await host.request('/api/enterprise-materials', 'POST', { title: '未送达保留', body: '正文已保存，未发表个人决定。' }), 201);
  const itemPath = `${base}/items/${created.material.id}`;
  const draft = await readJson(await host.request(`${itemPath}/draft`, 'POST', { expectedRevision: 0, metadata }));
  const editor = await readJson(await host.request(`${itemPath}/editor`));
  const request = { operationId: randomUUID(), expectedRevision: draft.item.revision, target: editor.draftTarget, metadata, personalLabel: null };
  assert.equal((await readJson(await host.request(`${itemPath}/operations/${request.operationId}`))).state, 'not-found');
  const ended = await readJson(await host.request(`${itemPath}/end-pending`, 'POST', { operationId: request.operationId, request }));
  assert.equal(ended.termination.outcome, 'ended-unpublished'); assert.equal(ended.item.currentDecisionId, null);
  const late = await readJson(await host.request(`${itemPath}/retain`, 'POST', request));
  assert.equal(late.replayed, true); assert.equal(late.termination.operationId, request.operationId); assert.equal(late.item.currentDecisionId, null);
  assert.equal((await readJson(await host.request(`/api/enterprise-materials/${created.material.id}`))).material.revisions.length, 0);
  const changed = await host.request(`${itemPath}/retain`, 'POST', { ...request, metadata: { ...metadata, kind: 'experience' } });
  assert.equal(changed.status, 409);
  assert.equal((await readJson(await host.request(`${itemPath}/operations/${request.operationId}`))).state, 'ended');
});

test('PR08 ending a first unobserved retain can register its receipt before any personal item exists', { timeout: 30_000 }, async t => {
  const host = await startTestHost(); t.after(() => host.close());
  const created = await readJson(await host.request('/api/enterprise-materials', 'POST', { title: '首次保留尚未受理', body: '不能让迟到的原请求复活。' }), 201);
  const itemPath = `${base}/items/${created.material.id}`;
  const editor = await readJson(await host.request(`${itemPath}/editor`));
  const request = { operationId: randomUUID(), expectedRevision: 0, target: editor.draftTarget, metadata, personalLabel: null };
  assert.equal((await readJson(await host.request(itemPath))).item, null);
  const ended = await readJson(await host.request(`${itemPath}/end-pending`, 'POST', { operationId: request.operationId, request }));
  assert.equal(ended.item.currentDecisionId, null); assert.equal(ended.termination.operationId, request.operationId);
  const late = await readJson(await host.request(`${itemPath}/retain`, 'POST', request));
  assert.equal(late.replayed, true); assert.equal(late.termination.operationId, request.operationId); assert.equal(late.decision, null);
  assert.equal((await readJson(await host.request(`/api/enterprise-materials/${created.material.id}`))).material.revisions.length, 0);
});

test('PR05/08 lost personal history fails closed while source bytes and partial lookup remain observable', { timeout: 30_000 }, async t => {
  const host = await startTestHost(); t.after(() => host.close());
  const created = await readJson(await host.request('/api/enterprise-materials', 'POST', { title: '保留原正文', body: '历史丢失也不重建空库。' }), 201);
  const itemPath = `${base}/items/${created.material.id}`;
  await readJson(await host.request(`${itemPath}/draft`, 'POST', { expectedRevision: 0, metadata }));
  const authority = await readFile(path.join(host.dataRoot, 'enterprise-business-materials/index.json'));
  const recordPath = path.join(host.dataRoot, 'personal-retention/records.json');
  const old = await readFile(recordPath); assert.ok(old.length > 0);
  await unlink(recordPath);
  const lookup = await readJson(await host.request(`${base}/lookup?category=knowledge`));
  assert.equal(lookup.complete, false); assert.ok(lookup.issues.some((issue: { code: string }) => issue.code === 'personal_records_missing'));
  const write = await host.request(`${itemPath}/draft`, 'POST', { expectedRevision: 0, metadata });
  assert.equal(write.status, 503); assert.equal((await write.json()).code, 'personal_records_missing');
  await assert.rejects(readFile(recordPath), { code: 'ENOENT' });
  assert.deepEqual(await readFile(path.join(host.dataRoot, 'enterprise-business-materials/index.json')), authority);
});

test('PR05/07 thin personal transport rejects malformed lookup and arbitrary source fields', { timeout: 30_000 }, async t => {
  const host = await startTestHost(); t.after(() => host.close());
  for (const query of ['includeBody=1', 'page=0', 'page=1&page=2', 'query=' + 'x'.repeat(201), 'category=unknown']) assert.equal((await host.request(`${base}/lookup?${query}`)).status, 400);
  const ref = { type: 'enterprise', storeId: randomUUID(), materialId: randomUUID(), revisionId: randomUUID(), path: '/arbitrary/file' };
  assert.equal((await host.request(`${base}/sources/read`, 'POST', { ref })).status, 400);
  const missing = await host.request(`${base}/sources/read`, 'POST', { ref: { ...ref, path: undefined } });
  assert.equal(missing.status, 409, 'well-formed ref from another store cannot resolve against this store');
});
