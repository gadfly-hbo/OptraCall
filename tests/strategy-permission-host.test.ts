import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFile, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {startTestHost} from './fixtures/host-process.ts';
import {startToolProvider} from './fixtures/tool-provider.ts';

const stores = {kind: 'department' as const, id: 'east-retail', name: '华东零售事业部', enterpriseId: 'ent-1'};
const scopeKey = 'department:ent-1:east-retail';

test('真实 Host+Pi：跨事项隔离、撤回来源拒绝派发、未获准路径拒绝', {timeout: 120_000}, async t => {
  const provider = await startToolProvider(), host = await startTestHost();
  t.after(async () => { await host.close(); await provider.close(); });
  const req = async (route: string, method = 'GET', body?: unknown, status = 200): Promise<any> => {
    const r = await host.request(route, method, body);
    assert.equal(r.status, status, await r.clone().text());
    return r.json();
  };
  await req('/api/configuration', 'PUT', {name: '权限合成', provider: 'openai-compatible', baseUrl: provider.baseUrl, model: 'synthetic-perm', apiKey: 'synthetic-perm-only'});
  const a = randomUUID(), b = randomUUID();
  await req('/api/strategy/initiatives', 'POST', {operationId: a, title: '事项甲', scopes: [stores]}, 201);
  await req('/api/strategy/initiatives', 'POST', {operationId: b, title: '事项乙', scopes: [stores]}, 201);
  const uploaded = (await req(`/api/strategy/initiatives/${a}/files`, 'POST', {operationId: randomUUID(), directory: '020_clean', name: '口径.md', contentBase64: Buffer.from('合成口径').toString('base64')}, 201)).file;
  await req(`/api/strategy/initiatives/${a}/session`, 'POST', {operationId: randomUUID(), scope: stores}, 201);
  const sessionRoute = `/api/strategy/initiatives/${a}/session?scopeKey=${encodeURIComponent(scopeKey)}`;
  const messageRoute = `/api/strategy/initiatives/${a}/messages?scopeKey=${encodeURIComponent(scopeKey)}`;

  assert.equal((await req(`/api/strategy/initiatives/${b}/files/${uploaded.fileId}`, 'GET', undefined, 404)).code, 'strategy_file_not_found');
  assert.equal((await req(`/api/strategy/initiatives/${b}/candidates/${randomUUID()}/versions/1`, 'GET', undefined, 404)).code, 'strategy_candidate_not_found');
  assert.equal((await req(`/api/strategy/initiatives/${b}/publications/${randomUUID()}/withdraw`, 'POST', {operationId: randomUUID()}, 404)).code, 'strategy_publication_not_found');
  assert.equal((await req(`/api/strategy/initiatives/${b}/reports`, 'GET')).versions.length, 0);
  assert.equal((await req(`/api/strategy/initiatives/${a}/files`, 'POST', {operationId: randomUUID(), directory: '010_draw', name: '../../越界.md', contentBase64: Buffer.from('x').toString('base64')}, 400)).code, 'strategy_file_name_invalid');
  assert.equal((await req(`/api/strategy/initiatives/${a}/files`, 'POST', {operationId: randomUUID(), directory: '060_reports', name: 'x.md', contentBase64: Buffer.from('x').toString('base64')}, 400)).code, 'strategy_file_directory_invalid');

  provider.setResponder((ctx: any) => ctx.recentToolResults.length
    ? {text: '已读取口径。'}
    : {calls: [{name: 'strategy_goals', arguments: {action: 'initiative-read-file', fileId: uploaded.fileId}}]});
  await req(messageRoute, 'POST', {requestId: randomUUID(), text: '开始。', expectedRevision: 1}, 202);
  let detail: any;
  for (let n = 0; n < 300; n++) { detail = await req(sessionRoute); if (detail.session.lastRun?.status === 'completed') break; await delay(20); }
  assert.equal(detail.session.lastRun.status, 'completed');

  const indexFile = join(host.dataRoot, 'strategy-initiatives', a, 'files.json');
  const index = JSON.parse(await readFile(indexFile, 'utf8'));
  index.files = index.files.filter((f: any) => f.fileId !== uploaded.fileId);
  await writeFile(indexFile, JSON.stringify(index));
  const requests = provider.requests.length;
  const denied = await req(messageRoute, 'POST', {requestId: randomUUID(), text: '继续。', expectedRevision: detail.session.revision}, 409);
  assert.equal(denied.code, 'strategy_initiative_source_changed');
  for (let n = 0; n < 300; n++) { detail = await req(sessionRoute); if (detail.session.lastRun?.status !== 'accepted') break; await delay(20); }
  assert.equal(detail.session.lastRun.status, 'failed');
  assert.equal(provider.requests.length, requests, 'revoked source blocks dispatch before any model call');
  assert.deepEqual(provider.errors, []);
});