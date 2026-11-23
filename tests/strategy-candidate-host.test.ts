import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {startTestHost} from './fixtures/host-process.ts';
import {startToolProvider} from './fixtures/tool-provider.ts';

const stores = {kind: 'department' as const, id: 'east-retail', name: '华东零售事业部', enterpriseId: 'ent-1'};
const scopeKey = 'department:ent-1:east-retail';
const kickoffFields = {
  horizon: '2027–2029',
  diagnosis: '华东门店客流企稳，增长缺口集中在新客首购后二次到店。',
  propositions: [
    {id: 'P1', question: '复购提升能否驱动存量门店增长？', whyItMatters: '决定资源投向。'},
    {id: 'P2', question: '导购触达能否用可控工时规模化？', whyItMatters: '决定试点推广。'},
    {id: 'P3', question: '会员投入与门店效率投入如何分配？', whyItMatters: '核心取舍。'},
  ],
  assumptions: '试点期间预算不变。',
  evidenceGaps: '自然复购待补证。',
  followUp: '候选须说明选择与放弃。',
};
const blocksFor = (title: string) => [
  {id: 'B1', label: '战略定位与增长路径', text: `${title}：深耕现有门店，先验证再推广。`},
  {id: 'B2', label: '三年目标与里程碑', text: '2027 试点，2028 推广，2029 达成核心指标。'},
  {id: 'B3', label: '资源分配与明确不做', text: '优先配置试点工时，暂缓大规模开店。'},
];

test('真实 Host+Pi：候选独立持久会话、开题门禁、停止隔离与重开读回', {timeout: 150_000}, async t => {
  const provider = await startToolProvider(), host = await startTestHost();
  t.after(async () => { await host.close(); await provider.close(); });
  const req = async (route: string, method = 'GET', body?: unknown, status = 200): Promise<any> => {
    const r = await host.request(route, method, body);
    assert.equal(r.status, status, await r.clone().text());
    return r.json();
  };
  await req('/api/configuration', 'PUT', {name: '候选合成', provider: 'openai-compatible', baseUrl: provider.baseUrl, model: 'synthetic-candidate', apiKey: 'synthetic-candidate-only'});
  const initiativeId = randomUUID();
  await req('/api/strategy/initiatives', 'POST', {operationId: initiativeId, title: '华东门店增长战略', scopes: [stores]}, 201);
  const base = `/api/strategy/initiatives/${initiativeId}`;
  const createInput = {operationId: randomUUID(), scope: stores, title: '会员复购优先', instruction: '基于锁定开题形成会员复购优先的完整备选方案。'};
  const notApplied = await req(`${base}/candidates`, 'POST', createInput, 409);
  assert.equal(notApplied.code, 'strategy_kickoff_not_applied');

  const report = (await req(`${base}/reports`, 'POST', {operationId: randomUUID(), fields: kickoffFields, sources: []}, 201)).version;
  const draftApply = await req(`${base}/reports/1/apply`, 'POST', {operationId: randomUUID(), sha256: report.contentSha256, scope: stores}, 409);
  assert.equal(draftApply.code, 'strategy_kickoff_not_locked');
  await req(`${base}/reports/1/lock`, 'POST', {operationId: randomUUID(), sha256: report.contentSha256});
  await req(`${base}/reports/1/apply`, 'POST', {operationId: randomUUID(), sha256: report.contentSha256, scope: stores});

  const responderFor = (title: string) => (ctx: any) => {
    const step = ctx.recentToolResults.length;
    if (step === 0) return {calls: [{name: 'strategy_goals', arguments: {action: 'initiative-read-kickoff'}}]};
    if (step === 1) return {calls: [{name: 'strategy_goals', arguments: {action: 'initiative-save-candidate', operationId: randomUUID(), candidateBlocks: blocksFor(title), candidateGoals: [`${title}核心指标`]}}]};
    return {text: `${title}候选已保存，请核对并锁定。`};
  };
  const settled = async (cid: string, no: number) => {
    for (let n = 0; n < 500; n++) {
      const d = await req(`${base}/candidates/${cid}/versions/${no}`);
      if (d.candidate.lastRun?.status && d.candidate.lastRun.status !== 'accepted') return d;
      await delay(20);
    }
    throw Error('candidate did not settle');
  };

  provider.setResponder(responderFor('会员复购优先'));
  const createdA = await req(`${base}/candidates`, 'POST', createInput, 202);
  const a = createdA.candidate;
  assert.equal(a.no, 1);
  assert.deepEqual(a.anchor, {reportNo: 1, contentSha256: report.contentSha256});
  let detailA = await settled(a.candidateId, 1);
  assert.equal(detailA.candidate.lastRun.status, 'completed');
  assert.equal(detailA.candidate.blocks.length, 3);
  assert.equal(detailA.candidate.goals[0], '会员复购优先核心指标');
  assert.ok(detailA.snapshot?.sessionFile);

  const countAfterA = provider.requests.length;
  const replay = await req(`${base}/candidates`, 'POST', createInput, 202);
  assert.equal(replay.replayed, true);
  assert.equal(replay.candidate.candidateId, a.candidateId);
  assert.equal(provider.requests.length, countAfterA, 'idempotent create does not dispatch again');

  provider.setResponder(responderFor('门店效率优先'));
  const createdB = await req(`${base}/candidates`, 'POST', {operationId: randomUUID(), scope: stores, title: '门店效率优先', instruction: '形成门店效率优先的完整备选方案。'}, 202);
  const b = createdB.candidate;
  const detailB = await settled(b.candidateId, 1);
  assert.equal(detailB.candidate.lastRun.status, 'completed');
  assert.notEqual(b.candidateId, a.candidateId);
  assert.notEqual(detailB.snapshot.sessionFile, detailA.snapshot.sessionFile, 'each candidate version owns a distinct persistent native session');
  assert.deepEqual(detailB.candidate.anchor, detailA.candidate.anchor, 'same applied kickoff reference');
  assert.match(detailB.candidate.blocks[0].text, /门店效率优先/);

  const revisionBefore = detailA.candidate.revision;
  provider.setResponder(() => ({text: '补充：试点门店优先选择成熟店。'}));
  await req(`${base}/candidates/${a.candidateId}/versions/1/messages`, 'POST', {requestId: randomUUID(), text: '请补充试点选择说明。', expectedRevision: revisionBefore}, 202);
  detailA = await settled(a.candidateId, 1);
  assert.equal(detailA.candidate.revision, revisionBefore + 1);
  assert.equal(detailA.snapshot.sessionFile, detailA.snapshot.sessionFile);
  const sameSession = await req(`${base}/candidates/${a.candidateId}/versions/1`);
  assert.ok(sameSession.snapshot.sessionFile.endsWith(detailA.snapshot.sessionFile.split('/').pop()), 'continuation stays in the same native session');

  provider.setResponder(() => ({text: '等待补证', hold: true}));
  const beforeC = provider.requests.length;
  const createdC = await req(`${base}/candidates`, 'POST', {operationId: randomUUID(), scope: stores, title: '待停止候选', instruction: '开始形成方案。'}, 202);
  const c = createdC.candidate;
  await provider.waitForRequests(beforeC + 1);
  await req(`${base}/candidates/${c.candidateId}/versions/1/stop`, 'POST', {});
  let detailC: any;
  for (let n = 0; n < 300; n++) { detailC = await req(`${base}/candidates/${c.candidateId}/versions/1`); if (detailC.candidate.lastRun?.status === 'cancelled') break; await delay(20); }
  assert.equal(detailC.candidate.lastRun.status, 'cancelled');
  assert.equal((await req(`${base}/candidates/${a.candidateId}/versions/1`)).candidate.lastRun.status, 'completed', 'stopping one candidate does not affect another');

  const requests = provider.requests.length;
  await req(`${base}/candidates/${a.candidateId}/versions/1/close`, 'POST', {});
  const reopened = await req(`${base}/candidates/${a.candidateId}/versions/1`);
  assert.equal(provider.requests.length, requests, 'close/read does not call model');
  assert.ok(reopened.snapshot?.sessionFile, 'native history reads back after close');
  assert.equal((await req(`${base}/candidates?scopeKey=${encodeURIComponent(scopeKey)}`)).candidates.length, 3);
  assert.deepEqual(provider.errors, []);
});