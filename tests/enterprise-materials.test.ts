import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdir, mkdtemp, readFile, writeFile, symlink, link } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { EnterpriseMaterialsStore, ENTERPRISE_BODY_LIMIT, ENTERPRISE_FILE_LIMIT } from '../src/host/enterprise-materials-store.ts';
import { CaseStore } from '../src/host/case-store.ts';
import { handleEnterpriseMaterialsRoute } from '../src/host/enterprise-materials-routes.ts';

const evidenceRoot = path.resolve('.local/enterprise-business-context/implementation/materials-storage/test-roots');
async function newRoot() { await mkdir(evidenceRoot, { recursive: true }); return mkdtemp(path.join(evidenceRoot, 'materials-')); }

test('EB01/02: an explicitly saved draft is listed after reopening without being enabled', async () => {
  const root = await newRoot(), store = new EnterpriseMaterialsStore(root);
  const created = await store.create({ title: '合成结算说明', body: '退款规则尚待业务确认。' });
  const reopened = new EnterpriseMaterialsStore(root), list = await reopened.list();
  assert.equal(list.materials.length, 1);
  assert.equal(list.materials[0].id, created.material.id);
  assert.equal(list.materials[0].title, '合成结算说明');
  assert.equal(list.materials[0].enabled, false);
  assert.equal(list.storeId, created.storeId);
});

test('EB03: enabling is explicit and later edits never replace a retained revision', async () => {
  const root = await newRoot(), store = new EnterpriseMaterialsStore(root);
  const created = await store.create({ title: '合成结算说明', body: '旧条款：先保留待确认条件。' });
  const first = await store.enable(created.material.id, created.material.version);
  assert.equal(first.material.enabled, true);
  assert.equal(first.material.revisions.length, 1);
  const firstId = first.material.activeRevisionId!;
  const edited = await store.update(first.material.id, first.material.version, { body: '新条款：按新确认信息解释。' });
  assert.equal((await store.readRevision(first.material.id, firstId)).body, '旧条款：先保留待确认条件。');
  assert.equal(edited.material.activeRevisionId, firstId);
  const second = await store.enable(edited.material.id, edited.material.version);
  assert.notEqual(second.material.activeRevisionId, firstId);
  const disabled = await store.disable(second.material.id, second.material.version);
  assert.equal(disabled.material.enabled, false);
  const reopened = new EnterpriseMaterialsStore(root);
  assert.equal((await reopened.readRevision(first.material.id, firstId)).body, '旧条款：先保留待确认条件。');
  const reenabled = await reopened.enable(disabled.material.id, disabled.material.version, firstId);
  assert.equal(reenabled.material.activeRevisionId, firstId);
  assert.equal(reenabled.material.revisions.length, 2);
});

test('EB01/03: listed readability refers to the active revision rather than an unpublished body draft', async () => {
  const store = new EnterpriseMaterialsStore(await newRoot());
  const created = await store.create({ title: '仅来源修订', body: '' });
  const fileOnly = await store.addFile(created.material.id, created.material.version, { name: '附件.bin', base64: 'AQID', importText: false });
  const first = await store.enable(fileOnly.material.id, fileOnly.material.version);
  const draft = await store.update(first.material.id, first.material.version, { body: '尚未启用的正文' });
  assert.equal((await store.list()).materials[0].bodyReadable, false);
  assert.equal((await store.readRevision(first.material.id, first.material.activeRevisionId!)).body, '');
  await store.enable(draft.material.id, draft.material.version);
  assert.equal((await store.list()).materials[0].bodyReadable, true);
});

test('EB02/03: explicit source bytes are retained per revision and unparsed files never acquire invented text', async () => {
  const store = new EnterpriseMaterialsStore(await newRoot());
  const created = await store.create({ title: '合成附件', body: '' });
  const firstBytes = Buffer.from('合成文本\n旧说明', 'utf8');
  const uploaded = await store.addFile(created.material.id, created.material.version, { name: '说明.txt', base64: firstBytes.toString('base64'), importText: true });
  assert.equal(uploaded.material.files.length, 1);
  assert.equal(uploaded.material.draft.body, '合成文本\n旧说明');
  const enabled = await store.enable(uploaded.material.id, uploaded.material.version);
  const oldRevision = enabled.material.activeRevisionId!, oldFileId = enabled.material.draft.sourceFileId!;
  const changed = await store.addFile(enabled.material.id, enabled.material.version, { name: '登记.pdf', base64: Buffer.from([0xff, 0x00, 0xfe, 0x01]).toString('base64'), importText: false });
  assert.equal(changed.material.draft.body, '合成文本\n旧说明', 'registering a source never silently replaces the user draft');
  assert.notEqual(changed.material.draft.sourceFileId, oldFileId);
  const fileOnly = await store.update(changed.material.id, changed.material.version, { body: '' });
  const next = await store.enable(fileOnly.material.id, fileOnly.material.version);
  assert.equal(next.material.revisions[1].body, '');
  const original = await store.readSourceFile(enabled.material.id, oldFileId);
  assert.ok(original.bytes.equals(firstBytes));
  const old = await store.readRevision(enabled.material.id, oldRevision);
  assert.equal(old.body, '合成文本\n旧说明');
  assert.equal(old.sourceFile?.id, oldFileId);
});

test('EB05/06: Case sidecar keeps exact refs and local unknowns, allows unlink, and never rebinds a replaced Case store', async () => {
  const root = await newRoot(), store = new EnterpriseMaterialsStore(root);
  const created = await store.create({ title: '合成公共规则', body: '普通规则与本案例外均为待解释材料。' });
  const first = await store.enable(created.material.id, created.material.version);
  const caseStoreId = randomUUID(), caseId = randomUUID();
  const ref = { storeId: first.storeId, materialId: first.material.id, revisionId: first.material.activeRevisionId! };
  const saved = await store.saveCaseContext(caseStoreId, caseId, { expectedRevision: 0, materials: [ref], supplements: [{ text: '本案有特殊约定，确认情况未知。', source: '', scope: '仅合成活动', confirmation: '' }] });
  assert.equal(saved.revision, 1);
  assert.equal(saved.supplements[0].confirmation, '');
  await store.disable(first.material.id, first.material.version);
  const reopened = new EnterpriseMaterialsStore(root), existing = await reopened.getCaseContext(caseStoreId, caseId);
  assert.deepEqual(existing.materials, [ref]);
  await assert.rejects(reopened.getCaseContext(randomUUID(), caseId), { code: 'enterprise_case_store_mismatch' });
  await assert.rejects(reopened.saveCaseContext(caseStoreId, randomUUID(), { expectedRevision: 0, materials: [ref], supplements: [] }), { code: 'enterprise_material_disabled' });
  const retained = await reopened.saveCaseContext(caseStoreId, caseId, { expectedRevision: existing.revision, materials: [ref], supplements: existing.supplements.map(({ id, text, source, scope, confirmation }) => ({ id, text, source, scope, confirmation })) });
  assert.deepEqual(retained.materials, [ref], 'editing local notes may retain an already linked stopped ref');
  const unlinked = await reopened.saveCaseContext(caseStoreId, caseId, { expectedRevision: retained.revision, materials: [], supplements: [] });
  assert.deepEqual(unlinked.materials, []);
  assert.equal((await reopened.readRevision(ref.materialId, ref.revisionId)).body, '普通规则与本案例外均为待解释材料。');
});

test('EB01–06 HTTP: real resource routes maintain version conflicts and Case identity without mutating the Case database', async t => {
  const root = await newRoot(), cases = new CaseStore({ dataRoot: root }), store = new EnterpriseMaterialsStore(root);
  await cases.initialize();
  const record = cases.createCase({ operationId: randomUUID(), title: '合成经营 Case' });
  const databaseBefore = await readFile(path.join(root, 'decision-cases.sqlite3')), markerBefore = await readFile(path.join(root, 'decision-cases-store.json'));
  let gate = Promise.resolve(), admission = () => {};
  const mutate = async <T>(operation: () => T | Promise<T>) => { admission(); await gate; return operation(); };
  const server = createServer((request, response) => { void handleEnterpriseMaterialsRoute({ request, response, url: new URL(request.url!, 'http://127.0.0.1'), store, cases, mutate }).then(handled => { if (!handled) { response.writeHead(404); response.end(); } }); });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { await new Promise<void>(resolve => { server.closeAllConnections(); server.close(() => resolve()); }); cases.close(); });
  const address = server.address(); assert.ok(address && typeof address !== 'string');
  const origin = `http://127.0.0.1:${address.port}`;
  const request = (route: string, method = 'GET', data?: unknown) => fetch(origin + route, { method, headers: data === undefined ? {} : { 'content-type': 'application/json' }, body: data === undefined ? undefined : JSON.stringify(data) });
  assert.equal((await request(`/api/cases/${randomUUID()}/enterprise-materials`)).status, 404);
  const createdResponse = await request('/api/enterprise-materials', 'POST', { title: '合成条款', body: '旧版全文', scope: '' });
  assert.equal(createdResponse.status, 201);
  const created = await createdResponse.json() as any;
  const route = `/api/enterprise-materials/${created.material.id}`;
  const enabledResponse = await request(route + '/enable', 'POST', { expectedVersion: created.material.version });
  assert.equal(enabledResponse.status, 200);
  const enabled = await enabledResponse.json() as any;
  assert.equal((await request(route, 'PUT', { expectedVersion: created.material.version, body: '不应覆盖' })).status, 409);
  assert.equal((await request(route, 'PUT', { expectedVersion: enabled.material.version, arbitraryPath: '/etc/passwd' })).status, 400);
  const revisionResponse = await request(route + '/revisions/' + enabled.material.activeRevisionId);
  assert.equal((await revisionResponse.json() as any).revision.body, '旧版全文');
  const linkedResponse = await request(`/api/cases/${record.id}/enterprise-materials`, 'PUT', { caseRevision: record.revision, expectedRevision: 0, materials: [{ storeId: enabled.storeId, materialId: enabled.material.id, revisionId: enabled.material.activeRevisionId }], supplements: [] });
  assert.equal(linkedResponse.status, 200);
  assert.equal((await linkedResponse.json() as any).revision, 1);
  assert.equal(cases.getCase(record.id).revision, record.revision);
  assert.equal((await request(`/api/cases/${record.id}/enterprise-materials`, 'PUT', { caseRevision: 999, expectedRevision: 1, materials: [], supplements: [] })).status, 409);
  assert.equal((await request(`/api/cases/${record.id}/enterprise-materials`, 'PUT', { caseRevision: record.revision, expectedRevision: 0, materials: [], supplements: [] })).status, 409);
  assert.ok((await readFile(path.join(root, 'decision-cases.sqlite3'))).equals(databaseBefore));
  assert.ok((await readFile(path.join(root, 'decision-cases-store.json'))).equals(markerBefore));
  let release!: () => void, admit!: () => void;
  gate = new Promise<void>(resolve => { release = resolve; });
  const admitted = new Promise<void>(resolve => { admit = resolve; });
  admission = admit;
  const pendingDisable = request(route + '/disable', 'POST', { expectedVersion: enabled.material.version });
  const firstResult = await Promise.race([pendingDisable.then(() => 'completed'), admitted.then(() => 'held')]);
  release();
  assert.equal(firstResult, 'held', 'maintenance must wait at the existing Host mutation boundary, preserving message-context capture order');
  assert.equal((await pendingDisable).status, 200);
  cases.closeCase({ operationId: randomUUID(), caseId: record.id, expectedRevision: record.revision, closeReason: '合成关闭' });
  const closed = cases.getCase(record.id);
  assert.equal((await request(`/api/cases/${record.id}/enterprise-materials`, 'PUT', { caseRevision: closed.revision, expectedRevision: 1, materials: [], supplements: [] })).status, 409);
  assert.equal((await request(`/api/cases/${record.id}/enterprise-materials`)).status, 200);
});

test('EB02/03 validation: limits, unconfirmed metadata, stale edits and invalid source import preserve the saved draft', async () => {
  const store = new EnterpriseMaterialsStore(await newRoot());
  await assert.rejects(store.create({ title: '   ', body: '正文' }), { code: 'enterprise_title_required' });
  await assert.rejects(store.create({ title: '超限', body: 'a'.repeat(ENTERPRISE_BODY_LIMIT + 1) }), { code: 'enterprise_body_too_large', status: 413 });
  const draft = await store.create({ title: '未知保持空值', body: '', source: '', owner: '', effectiveTime: '' });
  await assert.rejects(store.enable(draft.material.id, draft.material.version), { code: 'enterprise_content_required' });
  const saved = await store.update(draft.material.id, draft.material.version, { body: '已保存正文' });
  await assert.rejects(store.update(saved.material.id, draft.material.version, { body: '过期页面不得覆盖' }), { code: 'enterprise_version_conflict' });
  await assert.rejects(store.addFile(saved.material.id, saved.material.version, { name: '错误编码.txt', base64: Buffer.from([0xff]).toString('base64'), importText: true }), { code: 'enterprise_source_not_utf8' });
  await assert.rejects(store.addFile(saved.material.id, saved.material.version, { name: '../越权文件', base64: 'YQ==' }), { code: 'invalid_enterprise_filename' });
  await assert.rejects(store.addFile(saved.material.id, saved.material.version, { name: '超限.bin', base64: Buffer.alloc(ENTERPRISE_FILE_LIMIT + 1).toString('base64') }), { code: 'enterprise_file_too_large', status: 413 });
  assert.equal((await store.get(saved.material.id)).material.draft.body, '已保存正文');
  assert.equal((await store.get(saved.material.id)).material.files.length, 0);
  assert.equal((await store.get(saved.material.id)).material.draft.source, '');
});

test('EB09: the native readable catalog lists all retained revisions of enabled material and drops stopped entries without erasing history', async () => {
  const store = new EnterpriseMaterialsStore(await newRoot());
  const created = await store.create({ title: '自行检索的合成规则', body: '旧版独有条件' });
  const enabled = await store.enable(created.material.id, created.material.version);
  const edited = await store.update(created.material.id, enabled.material.version, { body: '新版独有条件' });
  const next = await store.enable(created.material.id, edited.material.version);
  const list = await store.list(), catalog = JSON.parse(await readFile(list.directoryPath, 'utf8'));
  assert.equal(catalog.materials.length, 1);
  assert.equal(catalog.materials[0].revisions.length, 2);
  assert.equal(await readFile(catalog.materials[0].revisions[0].bodyPath, 'utf8'), '旧版独有条件');
  assert.equal(await readFile(catalog.materials[0].revisions[1].bodyPath, 'utf8'), '新版独有条件');
  await store.disable(created.material.id, next.material.version);
  await store.list();
  assert.equal(JSON.parse(await readFile(list.directoryPath, 'utf8')).materials.length, 0);
  assert.equal((await store.readRevision(created.material.id, enabled.material.activeRevisionId!)).body, '旧版独有条件');
});

test('EB09/12: unknown storage version and unsafe links fail without reset or following outside material bytes', async () => {
  const root = await newRoot(), store = new EnterpriseMaterialsStore(root);
  await store.list();
  const indexPath = path.join(store.root, 'index.json'), future = JSON.stringify({ schemaVersion: 99, storeId: randomUUID(), materials: [] });
  await writeFile(indexPath, future);
  await assert.rejects(new EnterpriseMaterialsStore(root).list(), { code: 'unsupported_enterprise_storage' });
  assert.equal(await readFile(indexPath, 'utf8'), future);
  const outside = await newRoot(), symlinkRoot = await newRoot();
  await symlink(outside, path.join(symlinkRoot, 'enterprise-business-materials'));
  await assert.rejects(new EnterpriseMaterialsStore(symlinkRoot).list(), { code: 'unsafe_enterprise_storage' });
  const otherStore = new EnterpriseMaterialsStore(await newRoot());
  const created = await otherStore.create({ title: '合成原件', body: '' });
  const uploaded = await otherStore.addFile(created.material.id, created.material.version, { name: '原件.bin', base64: 'YQ==' });
  const file = uploaded.material.files[0]!;
  await link(file.path, path.join(outside, 'hardlinked-source'));
  await assert.rejects(otherStore.readSourceFile(created.material.id, file.id), { code: 'unsafe_enterprise_storage' });
});

test('EB10: changed source text reports its identity failure instead of substituting another revision', async () => {
  const store = new EnterpriseMaterialsStore(await newRoot());
  const created = await store.create({ title: '合成原文', body: '原文 A' });
  const enabled = await store.enable(created.material.id, created.material.version);
  const revision = enabled.material.revisions[0]!;
  await writeFile(revision.bodyPath, '变更 B');
  await assert.rejects(store.readRevision(created.material.id, revision.revisionId), { code: 'enterprise_source_changed' });
  assert.equal(await readFile(revision.bodyPath, 'utf8'), '变更 B');
});

test('EB09: selecting a fixed revision verifies retained original bytes as well as the body', async () => {
  const store = new EnterpriseMaterialsStore(await newRoot());
  const created = await store.create({ title: '合成原文件身份', body: '引用正文' });
  const uploaded = await store.addFile(created.material.id, created.material.version, { name: '原件.bin', base64: 'YQ==' });
  const enabled = await store.enable(uploaded.material.id, uploaded.material.version);
  await writeFile(enabled.material.files[0]!.path, 'b');
  await assert.rejects(store.readRevision(enabled.material.id, enabled.material.activeRevisionId!), { code: 'enterprise_source_changed' });
});

test('EB02: an empty registered file does not count as usable source content for enabling an empty draft', async () => {
  const store = new EnterpriseMaterialsStore(await newRoot());
  const created = await store.create({ title: '合成空文件', body: '' });
  const uploaded = await store.addFile(created.material.id, created.material.version, { name: 'empty.txt', base64: '' });
  await assert.rejects(store.enable(uploaded.material.id, uploaded.material.version), { code: 'enterprise_content_required' });
  assert.equal((await store.get(uploaded.material.id)).material.revisions.length, 0);
});
