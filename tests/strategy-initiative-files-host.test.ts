import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID, createHash} from 'node:crypto';
import {startTestHost} from './fixtures/host-process.ts';

const stores = {kind: 'department' as const, id: 'east-retail', name: '华东零售事业部', enterpriseId: 'ent-1'};
const ecommerce = {kind: 'department' as const, id: 'east-ecom', name: '华东电商业务', enterpriseId: 'ent-1'};
const scopeKey = 'department:ent-1:east-retail';
const content = Buffer.from('合成经营复盘：首购会员 90 天二购率约 9%。', 'utf8');
const contentBase64 = content.toString('base64');
const sha256 = createHash('sha256').update(content).digest('hex');

test('真实 Host：事项文件上传、范围归属、读取与越界负例', {timeout: 90_000}, async t => {
  const host = await startTestHost();
  t.after(async () => { await host.close(); });
  async function api(route: string, method = 'GET', input?: unknown, status = 200) {
    const response = await host.request(route, method, input), result = await response.json();
    assert.equal(response.status, status, JSON.stringify({route, result}));
    return result as Record<string, any>;
  }
  const initiativeId = randomUUID();
  await api('/api/strategy/initiatives', 'POST', {operationId: initiativeId, title: '华东门店增长战略', scopes: [stores, ecommerce]}, 201);
  const base = `/api/strategy/initiatives/${initiativeId}/files`;

  assert.deepEqual((await api(base)).files, []);
  const uploadInput = {operationId: randomUUID(), directory: '010_draw', name: '上期经营复盘.pdf', contentBase64};
  const shared = (await api(base, 'POST', uploadInput, 201)).file;
  assert.equal(shared.name, '上期经营复盘.pdf');
  assert.equal(shared.directory, '010_draw');
  assert.equal(shared.scopeKey, undefined);
  assert.equal(shared.sha256, sha256);
  assert.equal(shared.size, content.length);
  assert.deepEqual((await api(base, 'POST', uploadInput, 201)).file, shared);
  const conflict = await api(base, 'POST', {...uploadInput, contentBase64: Buffer.from('不同内容').toString('base64')}, 409);
  assert.equal(conflict.code, 'strategy_file_operation_conflict');

  const scoped = (await api(base, 'POST', {operationId: randomUUID(), directory: '020_clean', name: '门店口径.csv', contentBase64, scopeKey}, 201)).file;
  assert.equal(scoped.scopeKey, scopeKey);
  const badScope = await api(base, 'POST', {operationId: randomUUID(), directory: '020_clean', name: 'x.csv', contentBase64, scopeKey: 'department:ent-1:unknown'}, 409);
  assert.equal(badScope.code, 'strategy_initiative_scope_unknown');
  const badDirectory = await api(base, 'POST', {operationId: randomUUID(), directory: '060_reports', name: 'x.md', contentBase64}, 400);
  assert.equal(badDirectory.code, 'strategy_file_directory_invalid');
  const traversal = await api(base, 'POST', {operationId: randomUUID(), directory: '010_draw', name: '../evil.pdf', contentBase64}, 400);
  assert.equal(traversal.code, 'strategy_file_name_invalid');

  const all = (await api(base)).files;
  assert.equal(all.length, 2);
  const inScope = (await api(`${base}?scopeKey=${encodeURIComponent(scopeKey)}`)).files;
  assert.deepEqual(inScope.map((f: any) => f.fileId).sort(), [shared.fileId, scoped.fileId].sort());
  const otherScope = (await api(`${base}?scopeKey=${encodeURIComponent('department:ent-1:east-ecom')}`)).files;
  assert.deepEqual(otherScope.map((f: any) => f.fileId), [shared.fileId]);

  const read = await api(`${base}/${shared.fileId}`);
  assert.equal(read.file.sha256, sha256);
  assert.equal(Buffer.from(read.contentBase64, 'base64').toString('utf8'), content.toString('utf8'));
  const missing = await api(`${base}/${randomUUID()}`, 'GET', undefined, 404);
  assert.equal(missing.code, 'strategy_file_not_found');

  const otherInitiative = randomUUID();
  await api('/api/strategy/initiatives', 'POST', {operationId: otherInitiative, title: '另一事项', scopes: [stores]}, 201);
  const cross = await api(`/api/strategy/initiatives/${otherInitiative}/files/${shared.fileId}`, 'GET', undefined, 404);
  assert.equal(cross.code, 'strategy_file_not_found');
});