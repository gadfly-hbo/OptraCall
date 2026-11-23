import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {startTestHost} from './fixtures/host-process.ts';
import {startToolProvider} from './fixtures/tool-provider.ts';

const stores = {kind: 'department' as const, id: 'east-retail', name: '华东零售事业部', enterpriseId: 'ent-1'};
const kickoffFields = {
  horizon: '2027–2029', diagnosis: '增长缺口集中在二次到店。',
  propositions: [
    {id: 'P1', question: '复购能否驱动增长？', whyItMatters: '资源投向。'},
    {id: 'P2', question: '触达能否规模化？', whyItMatters: '试点推广。'},
    {id: 'P3', question: '投入如何分配？', whyItMatters: '核心取舍。'},
  ],
  assumptions: '预算不变。', evidenceGaps: '自然复购待补证。', followUp: '说明选择与放弃。',
};
const blocks = [
  {id: 'B1', label: '战略定位与增长路径', text: '深耕现有门店，先验证再推广。'},
  {id: 'B2', label: '三年目标与里程碑', text: '2027 试点，2028 推广。'},
];

async function setupLockedCandidate(req: any, provider: any, base: string) {
  const report = (await req(`${base}/reports`, 'POST', {operationId: randomUUID(), fields: kickoffFields, sources: []}, 201)).version;
  await req(`${base}/reports/1/lock`, 'POST', {operationId: randomUUID(), sha256: report.contentSha256});
  await req(`${base}/reports/1/apply`, 'POST', {operationId: randomUUID(), sha256: report.contentSha256, scope: stores});
  provider.setResponder((ctx: any) => ctx.recentToolResults.length
    ? {text: '候选已保存。'}
    : {calls: [{name: 'strategy_goals', arguments: {action: 'initiative-save-candidate', operationId: randomUUID(), candidateBlocks: blocks}}]});
  const created = await req(`${base}/candidates`, 'POST', {operationId: randomUUID(), scope: stores, title: '会员复购优先', instruction: '形成方案。'}, 202);
  const cid = created.candidate.candidateId;
  let detail: any;
  for (let n = 0; n < 500; n++) { detail = await req(`${base}/candidates/${cid}/versions/1`); if (detail.candidate.lastRun?.status === 'completed') break; await delay(20); }
  const lockOperationId = randomUUID();
  const locked = (await req(`${base}/candidates/${cid}/versions/1/lock`, 'POST', {operationId: lockOperationId, sha256: detail.candidate.contentSha256})).candidate;
  return {cid, locked, lockOperationId};
}
const waitBatch = async (req: any, base: string, cid: string, no: number, predicate: (b: any) => boolean) => {
  for (let n = 0; n < 600; n++) {
    const {batches} = await req(`${base}/candidates/${cid}/versions/${no}/verifications`);
    const batch = batches.at(-1);
    if (batch && predicate(batch)) return batch;
    await delay(20);
  }
  throw Error('batch did not reach expected state');
};

test('真实 Host+Pi：串行双检验同批同指纹、第二道自动启动、凭证落盘', {timeout: 150_000}, async t => {
  const provider = await startToolProvider(), host = await startTestHost();
  t.after(async () => { await host.close(); await provider.close(); });
  const req = async (route: string, method = 'GET', body?: unknown, status = 200): Promise<any> => {
    const r = await host.request(route, method, body);
    assert.equal(r.status, status, await r.clone().text());
    return r.json();
  };
  await req('/api/configuration', 'PUT', {name: '检验合成', provider: 'openai-compatible', baseUrl: provider.baseUrl, model: 'synthetic-verify', apiKey: 'synthetic-verify-only'});
  const initiativeId = randomUUID();
  await req('/api/strategy/initiatives', 'POST', {operationId: initiativeId, title: '检验事项', scopes: [stores]}, 201);
  const base = `/api/strategy/initiatives/${initiativeId}`;
  const {cid, locked, lockOperationId} = await setupLockedCandidate(req, provider, base);

  provider.setResponder((ctx: any) => ctx.recentToolResults.length
    ? {text: '本道检验结论已提交。'}
    : {calls: [{name: 'strategy_goals', arguments: {action: 'initiative-save-verification', verdict: 'pass', evidence: `关键因果链与假设已核对（turn=${ctx.requestNumber}）。`, verificationSources: [{kind: 'candidate', ref: `${cid}:1`, sha256: locked.contentSha256}]}}]});
  const started = await req(`${base}/candidates/${cid}/versions/1/verify`, 'POST', {operationId: randomUUID()}, 202);
  assert.equal(started.batch.gates[0].status, 'running');
  assert.equal(started.batch.gates[1].status, 'waiting');
  const batch = await waitBatch(req, base, cid, 1, b => b.state === 'passed');
  assert.equal(batch.contentSha256, locked.contentSha256);
  assert.equal(batch.lockOperationId, lockOperationId);
  assert.equal(batch.gates[0].verdict, 'pass');
  assert.equal(batch.gates[1].verdict, 'pass');
  assert.equal(batch.gates[0].status, 'completed');
  assert.equal(batch.gates[1].status, 'completed');
  assert.ok(batch.gates[0].evidence);
  assert.ok(batch.gates[1].evidence);
  assert.ok(batch.gates[1].startedAt >= batch.gates[0].finishedAt, 'gate 2 starts only after gate 1 valid pass');
  assert.equal(batch.gates[0].sources[0].sha256, locked.contentSha256);
  assert.notEqual(batch.gates[0].sessionFile, batch.gates[1].sessionFile);
  assert.equal((await req(`${base}/candidates/${cid}/versions/1/verify`, 'POST', {operationId: randomUUID()}, 409)).code, 'strategy_verification_batch_exists');
  assert.deepEqual(provider.errors, []);
});

test('真实 Host+Pi：业务不通过/依据不足停链退回、技术未知按原编号重试、取消隔离', {timeout: 180_000}, async t => {
  const provider = await startToolProvider(), host = await startTestHost();
  t.after(async () => { await host.close(); await provider.close(); });
  const req = async (route: string, method = 'GET', body?: unknown, status = 200): Promise<any> => {
    const r = await host.request(route, method, body);
    assert.equal(r.status, status, await r.clone().text());
    return r.json();
  };
  await req('/api/configuration', 'PUT', {name: '检验负例', provider: 'openai-compatible', baseUrl: provider.baseUrl, model: 'synthetic-verify-neg', apiKey: 'synthetic-verify-neg'});
  const initiativeId = randomUUID();
  await req('/api/strategy/initiatives', 'POST', {operationId: initiativeId, title: '检验负例事项', scopes: [stores]}, 201);
  const base = `/api/strategy/initiatives/${initiativeId}`;
  const {cid, locked} = await setupLockedCandidate(req, provider, base);

  provider.setResponder((ctx: any) => ctx.recentToolResults.length
    ? {text: '结论已提交。'}
    : {calls: [{name: 'strategy_goals', arguments: {action: 'initiative-save-verification', verdict: 'fail', evidence: '对照门店出现同等增长，反驳因果主张。'}}]});
  await req(`${base}/candidates/${cid}/versions/1/verify`, 'POST', {operationId: randomUUID()}, 202);
  const returned = await waitBatch(req, base, cid, 1, b => b.state === 'returned');
  assert.equal(returned.gates[0].verdict, 'fail');
  assert.equal(returned.gates[1].status, 'waiting', 'gate 2 never runs after business fail');
  assert.equal((await req(`${base}/candidates/${cid}/versions/1`)).candidate.returned.batchId, returned.batchId);
  assert.equal((await req(`${base}/candidates/${cid}/versions/1/gates/0/retry`, 'POST', {}, 409)).code, 'strategy_verification_returned');

  const newText = '深耕现有门店，以分层回访带动二次到店。';
  const {createHash} = await import('node:crypto');
  const v2 = (await req(`${base}/candidates/${cid}/versions/1/revise`, 'POST', {operationId: randomUUID(), baseSha256: locked.contentSha256, request: '按检验意见修订。', patches: [{blockId: 'B1', expectedOldSha256: createHash('sha256').update(blocks[0].text).digest('hex'), newText}]}, 201)).candidate;
  await req(`${base}/candidates/${cid}/versions/2/lock`, 'POST', {operationId: randomUUID(), sha256: v2.contentSha256});
  provider.setResponder((ctx: any) => ctx.recentToolResults.length
    ? {text: '结论已提交。'}
    : {calls: [{name: 'strategy_goals', arguments: {action: 'initiative-save-verification', verdict: 'insufficient', evidence: '缺少自然复购对照，须补证。'}}]});
  await req(`${base}/candidates/${cid}/versions/2/verify`, 'POST', {operationId: randomUUID()}, 202);
  const insufficient = await waitBatch(req, base, cid, 2, b => b.no === 2 && b.state === 'returned');
  assert.equal(insufficient.gates[0].verdict, 'insufficient');
  assert.equal(insufficient.contentSha256, v2.contentSha256);

  const newText2 = '深耕现有门店，以分层回访带动二次到店并补自然复购对照。';
  const v3 = (await req(`${base}/candidates/${cid}/versions/2/revise`, 'POST', {operationId: randomUUID(), baseSha256: v2.contentSha256, request: '补证后修订。', patches: [{blockId: 'B1', expectedOldSha256: createHash('sha256').update(newText).digest('hex'), newText: newText2}]}, 201)).candidate;
  await req(`${base}/candidates/${cid}/versions/3/lock`, 'POST', {operationId: randomUUID(), sha256: v3.contentSha256});
  provider.setResponder(() => ({text: '尚无结论。'}));
  await req(`${base}/candidates/${cid}/versions/3/verify`, 'POST', {operationId: randomUUID()}, 202);
  const unknown = await waitBatch(req, base, cid, 3, b => b.no === 3 && b.state === 'unknown');
  assert.equal(unknown.gates[0].status, 'unknown');
  assert.equal(unknown.gates[0].verdict, undefined);
  assert.equal(unknown.gates[1].status, 'waiting');
  const originalRef = unknown.gates[0].ref;
  provider.setResponder((ctx: any) => ctx.recentToolResults.length
    ? {text: '结论已提交。'}
    : {calls: [{name: 'strategy_goals', arguments: {action: 'initiative-save-verification', verdict: 'pass', evidence: '补证后因果链与假设已核对。', verificationSources: [{kind: 'candidate', ref: `${cid}:3`, sha256: v3.contentSha256}]}}]});
  await req(`${base}/candidates/${cid}/versions/3/gates/0/retry`, 'POST', {}, 202);
  const passed = await waitBatch(req, base, cid, 3, b => b.no === 3 && b.state === 'passed');
  assert.equal(passed.batchId, unknown.batchId, 'retry keeps the original batch and gate ref');
  assert.equal(passed.gates[0].ref, originalRef);
  assert.equal(passed.gates[1].verdict, 'pass');
  assert.equal((await req(`${base}/candidates/${cid}/versions/2/verify`, 'POST', {operationId: randomUUID()}, 409)).code, 'strategy_verification_returned', 'business-returned locked version cannot start a new batch');

  const newText3 = '深耕现有门店，分层回访与工时核对并行。';
  const v4 = (await req(`${base}/candidates/${cid}/versions/3/revise`, 'POST', {operationId: randomUUID(), baseSha256: v3.contentSha256, request: '再修订。', patches: [{blockId: 'B1', expectedOldSha256: createHash('sha256').update(newText2).digest('hex'), newText: newText3}]}, 201)).candidate;
  await req(`${base}/candidates/${cid}/versions/4/lock`, 'POST', {operationId: randomUUID(), sha256: v4.contentSha256});
  provider.setResponder(() => ({text: '等待', hold: true}));
  await req(`${base}/candidates/${cid}/versions/4/verify`, 'POST', {operationId: randomUUID()}, 202);
  const running = await waitBatch(req, base, cid, 4, b => b.no === 4 && b.gates[0].status === 'running' && b.state === 'running');
  await req(`${base}/verifications/${running.batchId}/stop`, 'POST', {});
  const stopped = await waitBatch(req, base, cid, 4, b => b.batchId === running.batchId && b.state === 'stopped');
  assert.equal(stopped.gates[0].status, 'cancelled');
  assert.equal(stopped.gates[1].status, 'waiting');
  assert.equal(passed.gates[1].verdict, 'pass', 'stopping one batch does not affect another');
  assert.deepEqual(provider.errors, []);
});