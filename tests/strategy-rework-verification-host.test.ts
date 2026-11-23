import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {startTestHost} from './fixtures/host-process.ts';
import {startToolProvider} from './fixtures/tool-provider.ts';

const stores = {kind: 'department' as const, id: 'east-retail', name: '华东零售事业部', enterpriseId: 'ent-1'};
const kickoffFields = {
  horizon: '2027–2029', diagnosis: '缺口。',
  propositions: [{id: 'P1', question: 'q1', whyItMatters: 'w1'}, {id: 'P2', question: 'q2', whyItMatters: 'w2'}, {id: 'P3', question: 'q3', whyItMatters: 'w3'}],
  assumptions: '', evidenceGaps: '', followUp: '',
};
const blocks = [{id: 'B1', label: '定位', text: '深耕门店。'}, {id: 'B2', label: '目标', text: '2027 试点。'}];

async function setup(req: any, provider: any, base: string) {
  const report = (await req(`${base}/reports`, 'POST', {operationId: randomUUID(), fields: kickoffFields, sources: []}, 201)).version;
  await req(`${base}/reports/1/lock`, 'POST', {operationId: randomUUID(), sha256: report.contentSha256});
  await req(`${base}/reports/1/apply`, 'POST', {operationId: randomUUID(), sha256: report.contentSha256, scope: stores});
  provider.setResponder((ctx: any) => ctx.recentToolResults.length
    ? {text: '候选已保存。'}
    : {calls: [{name: 'strategy_goals', arguments: {action: 'initiative-save-candidate', operationId: randomUUID(), candidateBlocks: blocks, candidateGoals: ['目标一']}}]});
  const created = await req(`${base}/candidates`, 'POST', {operationId: randomUUID(), scope: stores, title: '会员复购优先', instruction: '形成方案。'}, 202);
  const cid = created.candidate.candidateId;
  let detail: any;
  for (let n = 0; n < 500; n++) { detail = await req(`${base}/candidates/${cid}/versions/1`); if (detail.candidate.lastRun?.status === 'completed') break; await delay(20); }
  const locked = (await req(`${base}/candidates/${cid}/versions/1/lock`, 'POST', {operationId: randomUUID(), sha256: detail.candidate.contentSha256})).candidate;
  return {cid, locked};
}
const waitGate = async (req: any, base: string, cid: string, no: number, predicate: (b: any) => boolean) => {
  for (let n = 0; n < 600; n++) {
    const {batches} = await req(`${base}/candidates/${cid}/versions/${no}/verifications`);
    const batch = batches.at(-1);
    if (batch && predicate(batch)) return batch;
    await delay(20);
  }
  throw Error('gate did not reach expected state');
};

test('真实 Host+Pi：取消轮已存结论不被重试沿用，重试须产生新结论', {timeout: 150_000}, async t => {
  const provider = await startToolProvider(), host = await startTestHost();
  t.after(async () => { await host.close(); await provider.close(); });
  const req = async (route: string, method = 'GET', body?: unknown, status = 200): Promise<any> => {
    const r = await host.request(route, method, body);
    assert.equal(r.status, status, await r.clone().text());
    return r.json();
  };
  await req('/api/configuration', 'PUT', {name: '返工检验', provider: 'openai-compatible', baseUrl: provider.baseUrl, model: 'synthetic-rework', apiKey: 'synthetic-rework'});
  const initiativeId = randomUUID();
  await req('/api/strategy/initiatives', 'POST', {operationId: initiativeId, title: '返工事项', scopes: [stores]}, 201);
  const base = `/api/strategy/initiatives/${initiativeId}`;
  const {cid, locked} = await setup(req, provider, base);

  provider.setResponder((ctx: any) => ctx.recentToolResults.length
    ? {text: '等待', hold: true}
    : {calls: [{name: 'strategy_goals', arguments: {action: 'initiative-save-verification', verdict: 'pass', evidence: '取消前已保存的结论。', verificationSources: [{kind: 'candidate', ref: `${cid}:1`, sha256: locked.contentSha256}]}}]});
  await req(`${base}/candidates/${cid}/versions/1/verify`, 'POST', {operationId: randomUUID()}, 202);
  await waitGate(req, base, cid, 1, b => b.gates[0].verdict === 'pass' && b.gates[0].status === 'running');
  const running = (await req(`${base}/candidates/${cid}/versions/1/verifications`)).batches.at(-1);
  await req(`${base}/verifications/${running.batchId}/stop`, 'POST', {});
  const stopped = await waitGate(req, base, cid, 1, b => b.state === 'stopped');
  assert.equal(stopped.gates[0].status, 'cancelled');

  provider.setResponder(() => ({text: '本轮没有提交新结论。'}));
  await req(`${base}/candidates/${cid}/versions/1/gates/0/retry`, 'POST', {}, 202);
  const after = await waitGate(req, base, cid, 1, b => b.gates[0].status !== 'running' && b.gates[0].requestId !== stopped.gates[0].requestId);
  assert.equal(after.gates[0].status, 'unknown', 'retry without a new conclusion must not reuse the cancelled verdict');
  assert.equal(after.gates[0].verdict, undefined);
  assert.equal(after.gates[1].status, 'waiting');
  assert.equal(after.state, 'unknown');
  assert.ok(after.gates[0].attempts.length >= 2, 'each attempt keeps its true terminal state');
  assert.equal(after.gates[0].attempts[0].status, 'cancelled');
  assert.deepEqual(provider.errors, []);
});

test('真实 Host：业务退回同锁定版禁再启批，证据来源须解析到准确身份，被替代版禁再发布', {timeout: 150_000}, async t => {
  const provider = await startToolProvider(), host = await startTestHost();
  t.after(async () => { await host.close(); await provider.close(); });
  const req = async (route: string, method = 'GET', body?: unknown, status = 200): Promise<any> => {
    const r = await host.request(route, method, body);
    assert.equal(r.status, status, await r.clone().text());
    return r.json();
  };
  await req('/api/configuration', 'PUT', {name: '返工发布', provider: 'openai-compatible', baseUrl: provider.baseUrl, model: 'synthetic-rework2', apiKey: 'synthetic-rework2'});
  const initiativeId = randomUUID();
  await req('/api/strategy/initiatives', 'POST', {operationId: initiativeId, title: '返工发布事项', scopes: [stores]}, 201);
  const base = `/api/strategy/initiatives/${initiativeId}`;
  const {cid, locked} = await setup(req, provider, base);

  provider.setResponder((ctx: any) => ctx.recentToolResults.length
    ? {text: '结论已提交。'}
    : {calls: [{name: 'strategy_goals', arguments: {action: 'initiative-save-verification', verdict: 'pass', evidence: '依据。', verificationSources: [{kind: 'file', ref: '010_draw/不存在.pdf'}]}}]});
  await req(`${base}/candidates/${cid}/versions/1/verify`, 'POST', {operationId: randomUUID()}, 202);
  const badSource = await waitGate(req, base, cid, 1, b => b.gates[0].status !== 'running');
  assert.equal(badSource.gates[0].verdict, undefined, 'unresolvable file evidence must not record a verdict');
  assert.equal(badSource.state, 'unknown');

  provider.setResponder((ctx: any) => ctx.recentToolResults.length
    ? {text: '结论已提交。'}
    : {calls: [{name: 'strategy_goals', arguments: {action: 'initiative-save-verification', verdict: 'fail', evidence: '反例推翻因果主张。', verificationSources: [{kind: 'candidate', ref: `${cid}:1`, sha256: locked.contentSha256}]}}]});
  await req(`${base}/candidates/${cid}/versions/1/gates/0/retry`, 'POST', {}, 202);
  const returned = await waitGate(req, base, cid, 1, b => b.state === 'returned');
  assert.equal(returned.gates[0].verdict, 'fail');
  assert.equal((await req(`${base}/candidates/${cid}/versions/1/verify`, 'POST', {operationId: randomUUID()}, 409)).code, 'strategy_verification_returned');

  const newText = '深耕门店，分层回访。';
  const {createHash} = await import('node:crypto');
  const v2 = (await req(`${base}/candidates/${cid}/versions/1/revise`, 'POST', {operationId: randomUUID(), baseSha256: locked.contentSha256, request: '按意见修订。', patches: [{blockId: 'B1', expectedOldSha256: createHash('sha256').update(blocks[0].text).digest('hex'), newText}]}, 201)).candidate;
  await req(`${base}/candidates/${cid}/versions/2/lock`, 'POST', {operationId: randomUUID(), sha256: v2.contentSha256});
  provider.setResponder((ctx: any) => ctx.recentToolResults.length
    ? {text: '结论已提交。'}
    : {calls: [{name: 'strategy_goals', arguments: {action: 'initiative-save-verification', verdict: 'pass', evidence: '修订后因果链已核对。', verificationSources: [{kind: 'candidate', ref: `${cid}:2`, sha256: v2.contentSha256}]}}]});
  await req(`${base}/candidates/${cid}/versions/2/verify`, 'POST', {operationId: randomUUID()}, 202);
  const passed = await waitGate(req, base, cid, 2, b => b.no === 2 && b.state === 'passed');
  const pubInput = {operationId: randomUUID(), candidateId: cid, no: 2, sha256: v2.contentSha256, batchId: passed.batchId, confirmed: true, expectedActive: null};
  const pub2 = (await req(`${base}/publications`, 'POST', pubInput, 201)).publication;
  assert.equal(pub2.state, 'active');
  assert.equal((await req(`${base}/publications`, 'POST', {...pubInput, operationId: randomUUID(), expectedActive: randomUUID()}, 409)).code, 'strategy_publication_context_changed');

  const v3 = (await req(`${base}/candidates/${cid}/versions/2/revise`, 'POST', {operationId: randomUUID(), baseSha256: v2.contentSha256, request: '再修订。', patches: [{blockId: 'B1', expectedOldSha256: createHash('sha256').update(newText).digest('hex'), newText: '深耕门店，分层回访与工时核对。'}]}, 201)).candidate;
  await req(`${base}/candidates/${cid}/versions/3/lock`, 'POST', {operationId: randomUUID(), sha256: v3.contentSha256});
  provider.setResponder((ctx: any) => ctx.recentToolResults.length
    ? {text: '结论已提交。'}
    : {calls: [{name: 'strategy_goals', arguments: {action: 'initiative-save-verification', verdict: 'pass', evidence: '再修订后因果链已核对。', verificationSources: [{kind: 'candidate', ref: `${cid}:3`, sha256: v3.contentSha256}]}}]});
  await req(`${base}/candidates/${cid}/versions/3/verify`, 'POST', {operationId: randomUUID()}, 202);
  const passed3 = await waitGate(req, base, cid, 3, b => b.no === 3 && b.state === 'passed');
  const pub3 = (await req(`${base}/publications`, 'POST', {operationId: randomUUID(), candidateId: cid, no: 3, sha256: v3.contentSha256, batchId: passed3.batchId, confirmed: true, expectedActive: pub2.publicationId}, 201)).publication;
  assert.equal(pub3.state, 'active');
  const replaced2 = (await req(`${base}/publications`)).publications.find((p: any) => p.publicationId === pub2.publicationId);
  assert.equal(replaced2.state, 'replaced');
  assert.equal((await req(`${base}/publications`, 'POST', {operationId: randomUUID(), candidateId: cid, no: 2, sha256: v2.contentSha256, batchId: passed.batchId, confirmed: true, expectedActive: pub3.publicationId}, 409)).code, 'strategy_publication_replaced_locked');
  assert.deepEqual(provider.errors, []);
});