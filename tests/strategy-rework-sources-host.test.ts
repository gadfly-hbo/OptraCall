import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash, randomUUID} from 'node:crypto';
import {readFile, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {startTestHost} from './fixtures/host-process.ts';
import {startToolProvider, providerMessageText} from './fixtures/tool-provider.ts';
import {setTimeout as delay} from 'node:timers/promises';

const stores = {kind: 'department' as const, id: 'east-retail', name: '华东零售事业部', enterpriseId: 'ent-1'};
const ecommerce = {kind: 'department' as const, id: 'east-ecom', name: '华东电商业务', enterpriseId: 'ent-1'};
const storesKey = 'department:ent-1:east-retail';
const ecommerceKey = 'department:ent-1:east-ecom';
const query = (scopeKey: string) => `?scopeKey=${encodeURIComponent(scopeKey)}`;
const fields = {
  horizon: '2027–2029', diagnosis: '缺口。',
  propositions: [{id: 'P1', question: 'q1', whyItMatters: 'w1'}, {id: 'P2', question: 'q2', whyItMatters: 'w2'}, {id: 'P3', question: 'q3', whyItMatters: 'w3'}],
  assumptions: '', evidenceGaps: '', followUp: '',
};

test('真实 Host：开题来源按 fileId+指纹核对，范围引用与专属文件读取鉴范围', {timeout: 90_000}, async t => {
  const host = await startTestHost();
  t.after(async () => { await host.close(); });
  const req = async (route: string, method = 'GET', body?: unknown, status = 200): Promise<any> => {
    const r = await host.request(route, method, body);
    assert.equal(r.status, status, await r.clone().text());
    return r.json();
  };
  const initiativeId = randomUUID();
  await req('/api/strategy/initiatives', 'POST', {operationId: initiativeId, title: '来源事项', scopes: [stores, ecommerce]}, 201);
  const base = `/api/strategy/initiatives/${initiativeId}`;
  const content = Buffer.from('合成经营复盘正文');
  const uploaded = (await req(`${base}/files`, 'POST', {operationId: randomUUID(), directory: '010_draw', name: '复盘.md', contentBase64: content.toString('base64')}, 201)).file;
  const exclusive = (await req(`${base}/files`, 'POST', {operationId: randomUUID(), directory: '020_clean', name: '范围口径.md', contentBase64: Buffer.from('范围专属').toString('base64'), scopeKey: storesKey}, 201)).file;

  assert.equal((await req(`${base}/files/${exclusive.fileId}`, 'GET', undefined, 404)).code, 'strategy_file_not_found');
  assert.equal((await req(`${base}/files/${exclusive.fileId}?scopeKey=department:ent-1:east-ecom`, 'GET', undefined, 404)).code, 'strategy_file_not_found');
  assert.equal((await req(`${base}/files/${exclusive.fileId}?scopeKey=${encodeURIComponent(storesKey)}`)).file.fileId, exclusive.fileId);

  const goodSource = {kind: 'file', ref: '010_draw/复盘.md', fileId: uploaded.fileId, sha256: uploaded.sha256};
  assert.equal((await req(`${base}/reports`, 'POST', {operationId: randomUUID(), fields, sources: [{kind: 'file', ref: '010_draw/复盘.md', sha256: uploaded.sha256}]}, 400)).code, 'strategy_kickoff_source_invalid');
  assert.equal((await req(`${base}/reports`, 'POST', {operationId: randomUUID(), fields, sources: [{...goodSource, fileId: randomUUID()}]}, 409)).code, 'strategy_kickoff_source_invalid');
  assert.equal((await req(`${base}/reports`, 'POST', {operationId: randomUUID(), fields, sources: [{...goodSource, sha256: '0'.repeat(64)}]}, 409)).code, 'strategy_kickoff_source_invalid');

  const v1 = (await req(`${base}/reports`, 'POST', {operationId: randomUUID(), fields, sources: [goodSource], scopeKeys: [storesKey]}, 201)).version;
  assert.deepEqual(v1.scopeKeys, [storesKey]);
  await req(`${base}/reports/1/lock${query(storesKey)}`, 'POST', {operationId: randomUUID(), sha256: v1.contentSha256});
  assert.equal((await req(`${base}/reports/1/apply`, 'POST', {operationId: randomUUID(), sha256: v1.contentSha256, scope: ecommerce}, 409)).code, 'strategy_kickoff_scope_unknown');
  await req(`${base}/reports/1/apply`, 'POST', {operationId: randomUUID(), sha256: v1.contentSha256, scope: stores});

  const sameName = (await req(`${base}/files`, 'POST', {operationId: randomUUID(), directory: '010_draw', name: '复盘.md', contentBase64: Buffer.from('同名不同内容').toString('base64')}, 201)).file;
  assert.notEqual(sameName.fileId, uploaded.fileId);
  assert.notEqual(sameName.sha256, uploaded.sha256);
  const v2 = (await req(`${base}/reports`, 'POST', {operationId: randomUUID(), fields: {...fields, diagnosis: '第二版诊断。'}, sources: [goodSource], parent: 1}, 201)).version;
  await req(`${base}/reports/2/lock`, 'POST', {operationId: randomUUID(), sha256: v2.contentSha256});

  const stored = join(host.dataRoot, 'strategy-initiatives', initiativeId, 'files', '010_draw');
  const {readdir} = await import('node:fs/promises');
  const storedName = (await readdir(stored)).find(name => name.startsWith(uploaded.fileId));
  assert.ok(storedName);
  await writeFile(join(stored, storedName!), Buffer.from('被篡改的正文'));
  assert.equal((await req(`${base}/reports/2/lock`, 'POST', {operationId: randomUUID(), sha256: v2.contentSha256}, 409)).code, 'strategy_kickoff_source_invalid');
  assert.equal((await req(`${base}/reports`, 'POST', {operationId: randomUUID(), fields: {...fields, diagnosis: '第三版。'}, sources: [goodSource], parent: 2}, 409)).code, 'strategy_kickoff_source_invalid');
  assert.equal((await req(`${base}/reports/1/apply`, 'POST', {operationId: randomUUID(), sha256: v1.contentSha256, scope: stores}, 409)).code, 'strategy_kickoff_source_invalid');
});
test('真实 Host：范围专属报告的读取、锁定、应用和修订均核对范围', {timeout: 90_000}, async t => {
  const host = await startTestHost();
  t.after(async () => { await host.close(); });
  const req = async (route: string, method = 'GET', body?: unknown, status = 200): Promise<any> => {
    const r = await host.request(route, method, body);
    assert.equal(r.status, status, await r.clone().text());
    return r.json();
  };
  const initiativeId = randomUUID();
  await req('/api/strategy/initiatives', 'POST', {operationId: initiativeId, title: '范围来源事项', scopes: [stores, ecommerce]}, 201);
  const base = `/api/strategy/initiatives/${initiativeId}`;
  const exclusive = (await req(`${base}/files`, 'POST', {operationId: randomUUID(), directory: '020_clean', name: 'A范围口径.md', contentBase64: Buffer.from('A 范围专属').toString('base64'), scopeKey: storesKey}, 201)).file;
  const source = {kind: 'file', ref: '020_clean/A范围口径.md', fileId: exclusive.fileId, sha256: exclusive.sha256};
  assert.equal((await req(`${base}/reports`, 'POST', {operationId: randomUUID(), fields, sources: [source], scopeKeys: [storesKey, ecommerceKey]}, 400)).code, 'strategy_kickoff_scope_unknown');
  const v1 = (await req(`${base}/reports`, 'POST', {operationId: randomUUID(), fields, sources: [source]}, 201)).version;
  assert.deepEqual(v1.scopeKeys, [storesKey], 'report applicability derives from the real source scope');
  const lock = {operationId: randomUUID(), sha256: v1.contentSha256};
  assert.equal((await req(`${base}/reports/1/lock${query(ecommerceKey)}`, 'POST', lock, 409)).code, 'strategy_kickoff_scope_unknown');
  assert.equal((await req(`${base}/reports/1/lock`, 'POST', lock, 409)).code, 'strategy_kickoff_scope_unknown');
  await req(`${base}/reports/1/lock${query(storesKey)}`, 'POST', lock);
  assert.equal((await req(`${base}/reports/1/apply`, 'POST', {operationId: randomUUID(), sha256: v1.contentSha256, scope: ecommerce}, 409)).code, 'strategy_kickoff_scope_unknown');
  await req(`${base}/reports/1/apply`, 'POST', {operationId: randomUUID(), sha256: v1.contentSha256, scope: stores});
  const shared = (await req(`${base}/files`, 'POST', {operationId: randomUUID(), directory: '010_draw', name: '共用复盘.md', contentBase64: Buffer.from('共用').toString('base64')}, 201)).file;
  const v2 = (await req(`${base}/reports`, 'POST', {operationId: randomUUID(), fields: {...fields, diagnosis: '共用资料开题。'}, sources: [{kind: 'file', ref: '010_draw/共用复盘.md', fileId: shared.fileId, sha256: shared.sha256}], parent: 1}, 201)).version;
  assert.deepEqual(v2.scopeKeys, [storesKey, ecommerceKey], 'shared sources keep all initiative scopes');
  const revision = {operationId: randomUUID(), baseSha256: v1.contentSha256, request: '仅门店范围保留的修订意图。', patches: [{blockId: 'diagnosis', expectedOldSha256: createHash('sha256').update(fields.diagnosis).digest('hex'), newText: '仅门店范围保留的修订正文。'}]};
  assert.equal((await req(`${base}/reports/1/revise${query(ecommerceKey)}`, 'POST', revision, 409)).code, 'strategy_kickoff_scope_unknown');
  const revised = (await req(`${base}/reports/1/revise${query(storesKey)}`, 'POST', revision, 201)).version;
  assert.deepEqual(revised.scopeKeys, [storesKey]);

  for (const suffix of ['', query(ecommerceKey)]) {
    const list = await req(`${base}/reports${suffix}`);
    const history = await req(`${base}/history${suffix}`);
    assert.deepEqual(history.reports, list);
    for (const number of [1, 3]) {
      const row = list.versions.find((version: any) => version.no === number);
      assert.equal(row.unavailable, 'scope');
      assert.equal(row.contentSha256, number === 1 ? v1.contentSha256 : revised.contentSha256);
      assert.deepEqual(row.scopeKeys, [storesKey]);
      assert.equal('fields' in row || 'sources' in row || 'revision' in row, false);
    }
    assert.deepEqual(list.versions[1], v2, 'shared report remains fully readable');
  }
  const scoped = await req(`${base}/reports${query(storesKey)}`);
  assert.equal(scoped.versions[0].fields.diagnosis, fields.diagnosis);
  assert.equal(scoped.versions[2].revision.request, revision.request);
});

test('真实 Host+Pi：会话按范围拒绝越界开题正文与列表', {timeout: 120_000}, async t => {
  const provider = await startToolProvider(), host = await startTestHost();
  t.after(async () => { await host.close(); await provider.close(); });
  const req = async (route: string, method = 'GET', body?: unknown, status = 200): Promise<any> => {
    const r = await host.request(route, method, body);
    assert.equal(r.status, status, await r.clone().text());
    return r.json();
  };
  await req('/api/configuration', 'PUT', {name: '范围会话', provider: 'openai-compatible', baseUrl: provider.baseUrl, model: 'synthetic-scope-read', apiKey: 'synthetic-scope-read'});
  const initiativeId = randomUUID();
  await req('/api/strategy/initiatives', 'POST', {operationId: initiativeId, title: '范围会话事项', scopes: [stores, ecommerce]}, 201);
  const base = `/api/strategy/initiatives/${initiativeId}`;
  const exclusive = (await req(`${base}/files`, 'POST', {operationId: randomUUID(), directory: '020_clean', name: 'A口径.md', contentBase64: Buffer.from('A 范围专属诊断').toString('base64'), scopeKey: storesKey}, 201)).file;
  const source = {kind: 'file', ref: '020_clean/A口径.md', fileId: exclusive.fileId, sha256: exclusive.sha256};
  await req(`${base}/reports`, 'POST', {operationId: randomUUID(), fields, sources: [source]}, 201);
  await req(`${base}/session`, 'POST', {operationId: randomUUID(), scope: ecommerce}, 201);
  let denied = '', listing = '';
  provider.setResponder((ctx: any) => {
    const step = ctx.recentToolResults.length;
    if (step === 0) return {calls: [{name: 'strategy_goals', arguments: {action: 'initiative-read-kickoff', version: 1}}]};
    if (step === 1) { denied = providerMessageText(ctx.recentToolResults[0].content); return {calls: [{name: 'strategy_goals', arguments: {action: 'initiative-read-kickoff'}}]}; }
    if (step === 2) { listing = providerMessageText(ctx.recentToolResults[1].content); return {text: '已核对范围。'}; }
    return {text: '继续。'};
  });
  await req(`${base}/messages?scopeKey=${encodeURIComponent('department:ent-1:east-ecom')}`, 'POST', {requestId: randomUUID(), text: '读取开题。', expectedRevision: 1}, 202);
  let d: any;
  for (let n = 0; n < 400; n++) { d = await req(`${base}/session?scopeKey=${encodeURIComponent('department:ent-1:east-ecom')}`); if (d.session.lastRun?.status === 'completed') break; await delay(20); }
  assert.equal(d.session.lastRun.status, 'completed');
  assert.match(denied, /strategy_kickoff_scope_unknown/, 'out-of-scope version read is rejected');
  assert.doesNotMatch(listing, /"no":1\b/, 'out-of-scope report is excluded from the list');
  assert.equal(d.reports.versions[0].unavailable, 'scope');
  assert.equal('fields' in d.reports.versions[0], false, 'the normal scope session response also omits the body');
  const proposal = {operationId: randomUUID(), blockId: 'diagnosis', request: '仅在获准范围内拟改。'};
  const before = provider.requests.length;
  assert.equal((await req(`${base}/reports/1/revise-proposal${query(ecommerceKey)}`, 'POST', proposal, 409)).code, 'strategy_kickoff_scope_unknown');
  await req(`${base}/proposals?proposalId=${proposal.operationId}&scopeKey=${encodeURIComponent(storesKey)}`, 'GET', undefined, 404);
  assert.equal(provider.requests.length, before, 'out-of-scope proposal cannot dispatch the original body');
  assert.deepEqual(provider.errors, []);
});
