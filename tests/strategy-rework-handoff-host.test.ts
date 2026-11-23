import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {startTestHost} from './fixtures/host-process.ts';
import {startToolProvider} from './fixtures/tool-provider.ts';

const stores = {kind: 'department' as const, id: 'east-retail', name: '华东零售事业部', enterpriseId: 'ent-1'};
const personal = {kind: 'personal' as const, id: 'self', name: '个人工作'};
const kickoffFields = {
  horizon: '2027–2029', diagnosis: '缺口。',
  propositions: [{id: 'P1', question: 'q1', whyItMatters: 'w1'}, {id: 'P2', question: 'q2', whyItMatters: 'w2'}, {id: 'P3', question: 'q3', whyItMatters: 'w3'}],
  assumptions: '', evidenceGaps: '', followUp: '',
};
const blocks = [{id: 'B1', label: '定位', text: '深耕门店。'}];

async function publishedCandidate(req: any, provider: any, base: string, goals: string[]) {
  const report = (await req(`${base}/reports`, 'POST', {operationId: randomUUID(), fields: kickoffFields, sources: []}, 201)).version;
  await req(`${base}/reports/1/lock`, 'POST', {operationId: randomUUID(), sha256: report.contentSha256});
  await req(`${base}/reports/1/apply`, 'POST', {operationId: randomUUID(), sha256: report.contentSha256, scope: stores});
  provider.setResponder((ctx: any) => ctx.recentToolResults.length
    ? {text: '候选已保存。'}
    : {calls: [{name: 'strategy_goals', arguments: {action: 'initiative-save-candidate', operationId: randomUUID(), candidateBlocks: blocks, candidateGoals: goals}}]});
  const created = await req(`${base}/candidates`, 'POST', {operationId: randomUUID(), scope: stores, title: '会员复购优先', instruction: '形成方案。'}, 202);
  const cid = created.candidate.candidateId;
  let detail: any;
  for (let n = 0; n < 500; n++) { detail = await req(`${base}/candidates/${cid}/versions/1`); if (detail.candidate.lastRun?.status === 'completed') break; await delay(20); }
  await req(`${base}/candidates/${cid}/versions/1/lock`, 'POST', {operationId: randomUUID(), sha256: detail.candidate.contentSha256});
  provider.setResponder((ctx: any) => ctx.recentToolResults.length
    ? {text: '结论已提交。'}
    : {calls: [{name: 'strategy_goals', arguments: {action: 'initiative-save-verification', verdict: 'pass', evidence: '已核对。', verificationSources: [{kind: 'candidate', ref: `${cid}:1`, sha256: detail.candidate.contentSha256}]}}]});
  await req(`${base}/candidates/${cid}/versions/1/verify`, 'POST', {operationId: randomUUID()}, 202);
  let batch: any;
  for (let n = 0; n < 600; n++) { batch = (await req(`${base}/candidates/${cid}/versions/1/verifications`)).batches.at(-1); if (batch?.state === 'passed') break; await delay(20); }
  const publication = (await req(`${base}/publications`, 'POST', {operationId: randomUUID(), candidateId: cid, no: 1, sha256: detail.candidate.contentSha256, batchId: batch.batchId, confirmed: true, expectedActive: null}, 201)).publication;
  return {cid, publication};
}

test('真实 Host：多目标承接整批预校验，中途失败不留无回执目标', {timeout: 150_000}, async t => {
  const provider = await startToolProvider(), host = await startTestHost();
  t.after(async () => { await host.close(); await provider.close(); });
  const req = async (route: string, method = 'GET', body?: unknown, status = 200): Promise<any> => {
    const r = await host.request(route, method, body);
    assert.equal(r.status, status, await r.clone().text());
    return r.json();
  };
  await req('/api/configuration', 'PUT', {name: '承接返工', provider: 'openai-compatible', baseUrl: provider.baseUrl, model: 'synthetic-handoff', apiKey: 'synthetic-handoff'});
  const initiativeId = randomUUID();
  await req('/api/strategy/initiatives', 'POST', {operationId: initiativeId, title: '承接事项', scopes: [stores]}, 201);
  const base = `/api/strategy/initiatives/${initiativeId}`;
  const {publication} = await publishedCandidate(req, provider, base, ['短目标', '长'.repeat(350)]);
  const failed = await req(`${base}/publications/${publication.publicationId}/handoff`, 'POST', {operationId: randomUUID(), scope: personal, selected: [0, 1]}, 400);
  assert.ok(failed.code, 'second invalid goal rejects the whole batch');
  assert.equal((await req('/api/strategy/goals')).goals.length, 0, 'no goal may persist without a handoff receipt');
  assert.deepEqual((await req(`${base}/publications`)).publications[0].handoffs, []);
});

test('真实 Host：承接重试按完整请求指纹，更改选择不得返回旧回执', {timeout: 150_000}, async t => {
  const provider = await startToolProvider(), host = await startTestHost();
  t.after(async () => { await host.close(); await provider.close(); });
  const req = async (route: string, method = 'GET', body?: unknown, status = 200): Promise<any> => {
    const r = await host.request(route, method, body);
    assert.equal(r.status, status, await r.clone().text());
    return r.json();
  };
  await req('/api/configuration', 'PUT', {name: '承接指纹', provider: 'openai-compatible', baseUrl: provider.baseUrl, model: 'synthetic-handoff2', apiKey: 'synthetic-handoff2'});
  const initiativeId = randomUUID();
  await req('/api/strategy/initiatives', 'POST', {operationId: initiativeId, title: '承接指纹事项', scopes: [stores]}, 201);
  const base = `/api/strategy/initiatives/${initiativeId}`;
  const {publication} = await publishedCandidate(req, provider, base, ['目标一', '目标二']);
  const operationId = randomUUID();
  const first = (await req(`${base}/publications/${publication.publicationId}/handoff`, 'POST', {operationId, scope: personal, selected: [0]})).handoff;
  assert.equal(first.goals.length, 1);
  const replay = (await req(`${base}/publications/${publication.publicationId}/handoff`, 'POST', {operationId, scope: personal, selected: [0]})).handoff;
  assert.deepEqual(replay, first);
  assert.equal((await req('/api/strategy/goals')).goals.length, 1);
  const changed = await req(`${base}/publications/${publication.publicationId}/handoff`, 'POST', {operationId, scope: personal, selected: [1]}, 409);
  assert.equal(changed.code, 'strategy_publication_operation_conflict');
  const otherScope = await req(`${base}/publications/${publication.publicationId}/handoff`, 'POST', {operationId, scope: {...personal, name: '另一范围'}, selected: [0]}, 409);
  assert.equal(otherScope.code, 'strategy_publication_operation_conflict');
  const second = (await req(`${base}/publications/${publication.publicationId}/handoff`, 'POST', {operationId: randomUUID(), scope: personal, selected: [1]})).handoff;
  assert.equal(second.goals.length, 1);
  assert.equal((await req('/api/strategy/goals')).goals.length, 2);
  await req(`${base}/publications/${publication.publicationId}/withdraw`, 'POST', {operationId: randomUUID()});
  assert.equal((await req(`${base}/publications/${publication.publicationId}/handoff`, 'POST', {operationId: randomUUID(), scope: personal, selected: [0]}, 409)).code, 'strategy_publication_not_active');
  const goalId = first.goals[0].goalId;
  assert.equal((await req(`/api/strategy/goals/${goalId}`)).goal.versions[0].status, 'candidate', 'existing handoff goal stays readable after withdraw');
});
test('真实 Host：相同承接操作 ID 跨发布不得串目标身份与来源', {timeout: 150_000}, async t => {
  const provider = await startToolProvider(), host = await startTestHost();
  t.after(async () => { await host.close(); await provider.close(); });
  const req = async (route: string, method = 'GET', body?: unknown, status = 200): Promise<any> => {
    const r = await host.request(route, method, body);
    assert.equal(r.status, status, await r.clone().text());
    return r.json();
  };
  await req('/api/configuration', 'PUT', {name: '承接归属', provider: 'openai-compatible', baseUrl: provider.baseUrl, model: 'synthetic-handoff3', apiKey: 'synthetic-handoff3'});
  const initiativeId = randomUUID();
  await req('/api/strategy/initiatives', 'POST', {operationId: initiativeId, title: '承接归属事项', scopes: [stores]}, 201);
  const base = `/api/strategy/initiatives/${initiativeId}`;
  const first = await publishedCandidate(req, provider, base, ['目标一']);
  const sharedOperationId = randomUUID();
  const handoff1 = (await req(`${base}/publications/${first.publication.publicationId}/handoff`, 'POST', {operationId: sharedOperationId, scope: personal, selected: [0]})).handoff;
  assert.equal(handoff1.goals.length, 1);

  const second = await (async () => {
    provider.setResponder((ctx: any) => ctx.recentToolResults.length
      ? {text: '候选已保存。'}
      : {calls: [{name: 'strategy_goals', arguments: {action: 'initiative-save-candidate', operationId: randomUUID(), candidateBlocks: blocks, candidateGoals: ['目标二']}}]});
    const created = await req(`${base}/candidates`, 'POST', {operationId: randomUUID(), scope: stores, title: '门店效率优先', instruction: '形成方案。'}, 202);
    const cid = created.candidate.candidateId;
    let detail: any;
    for (let n = 0; n < 500; n++) { detail = await req(`${base}/candidates/${cid}/versions/1`); if (detail.candidate.lastRun?.status === 'completed') break; await delay(20); }
    await req(`${base}/candidates/${cid}/versions/1/lock`, 'POST', {operationId: randomUUID(), sha256: detail.candidate.contentSha256});
    provider.setResponder((ctx: any) => ctx.recentToolResults.length
      ? {text: '结论已提交。'}
      : {calls: [{name: 'strategy_goals', arguments: {action: 'initiative-save-verification', verdict: 'pass', evidence: '已核对。', verificationSources: [{kind: 'candidate', ref: `${cid}:1`, sha256: detail.candidate.contentSha256}]}}]});
    await req(`${base}/candidates/${cid}/versions/1/verify`, 'POST', {operationId: randomUUID()}, 202);
    let batch: any;
    for (let n = 0; n < 600; n++) { batch = (await req(`${base}/candidates/${cid}/versions/1/verifications`)).batches.at(-1); if (batch?.state === 'passed') break; await delay(20); }
    const publication = (await req(`${base}/publications`, 'POST', {operationId: randomUUID(), candidateId: cid, no: 1, sha256: detail.candidate.contentSha256, batchId: batch.batchId, confirmed: true, expectedActive: first.publication.publicationId}, 201)).publication;
    return {cid, publication};
  })();
  const handoff2 = (await req(`${base}/publications/${second.publication.publicationId}/handoff`, 'POST', {operationId: sharedOperationId, scope: personal, selected: [0]})).handoff;
  assert.equal(handoff2.goals.length, 1);
  assert.notEqual(handoff2.goals[0].goalId, handoff1.goals[0].goalId, 'same handoff operation id on another publication must not return the first goals');
  const goal2 = (await req(`/api/strategy/goals/${handoff2.goals[0].goalId}`)).goal;
  assert.equal(goal2.versions[0].title, '目标二');
  assert.match(goal2.versions[0].strategyContext.summary, new RegExp(second.publication.publicationId));
  const goal1 = (await req(`/api/strategy/goals/${handoff1.goals[0].goalId}`)).goal;
  assert.equal(goal1.versions[0].title, '目标一');
  assert.match(goal1.versions[0].strategyContext.summary, new RegExp(first.publication.publicationId));
  const replay2 = (await req(`${base}/publications/${second.publication.publicationId}/handoff`, 'POST', {operationId: sharedOperationId, scope: personal, selected: [0]})).handoff;
  assert.deepEqual(replay2, handoff2);
  assert.equal((await req('/api/strategy/goals')).goals.length, 2);
});
