import {formalGoal} from './fixtures/strategy-formal-goal.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {startTestHost} from './fixtures/host-process.ts';
import {startToolProvider} from './fixtures/tool-provider.ts';

const stores = {kind: 'department' as const, id: 'east-retail', name: '华东零售事业部', enterpriseId: 'ent-1'};
const ecommerce = {kind: 'department' as const, id: 'east-ecom', name: '华东电商业务', enterpriseId: 'ent-1'};
const personal = {kind: 'personal' as const, id: 'self', name: '个人工作'};
const kickoffFields = {
  horizon: '2027–2029', diagnosis: '缺口。',
  propositions: [{id: 'P1', question: 'q1', whyItMatters: 'w1'}, {id: 'P2', question: 'q2', whyItMatters: 'w2'}, {id: 'P3', question: 'q3', whyItMatters: 'w3'}],
  assumptions: '', evidenceGaps: '', followUp: '',
};
const blocks = [{id: 'B1', label: '定位', text: '深耕门店。'}, {id: 'B2', label: '目标', text: '2027 试点。'}];

async function lockedPassedCandidate(req: any, provider: any, base: string, scope: any, title: string, goals: string[]) {
  provider.setResponder((ctx: any) => ctx.recentToolResults.length
    ? {text: '候选已保存。'}
    : {calls: [{name: 'strategy_goals', arguments: {action: 'initiative-save-candidate', operationId: randomUUID(), candidateBlocks: blocks, candidateGoals: goals}}]});
  const created = await req(`${base}/candidates`, 'POST', {operationId: randomUUID(), scope, title, instruction: '形成方案。'}, 202);
  const cid = created.candidate.candidateId;
  let detail: any;
  for (let n = 0; n < 500; n++) { detail = await req(`${base}/candidates/${cid}/versions/1`); if (detail.candidate.lastRun?.status === 'completed') break; await delay(20); }
  const lockOperationId = randomUUID();
  const locked = (await req(`${base}/candidates/${cid}/versions/1/lock`, 'POST', {operationId: lockOperationId, sha256: detail.candidate.contentSha256})).candidate;
  provider.setResponder((ctx: any) => ctx.recentToolResults.length
    ? {text: '结论已提交。'}
    : {calls: [{name: 'strategy_goals', arguments: {action: 'initiative-save-verification', verdict: 'pass', evidence: '因果链与假设已核对。', verificationSources: [{kind: 'candidate', ref: `${cid}:1`, sha256: detail.candidate.contentSha256}]}}]});
  await req(`${base}/candidates/${cid}/versions/1/verify`, 'POST', {operationId: randomUUID()}, 202);
  let batch: any;
  for (let n = 0; n < 600; n++) {
    const {batches} = await req(`${base}/candidates/${cid}/versions/1/verifications`);
    batch = batches.at(-1);
    if (batch?.state === 'passed') break;
    await delay(20);
  }
  assert.equal(batch.state, 'passed');
  return {cid, locked, batch};
}

test('真实 Host：发布门禁、单一有效、原子替代、撤销禁重发与承接门禁', {timeout: 180_000}, async t => {
  const provider = await startToolProvider(), host = await startTestHost();
  t.after(async () => { await host.close(); await provider.close(); });
  const req = async (route: string, method = 'GET', body?: unknown, status = 200): Promise<any> => {
    const r = await host.request(route, method, body);
    assert.equal(r.status, status, await r.clone().text());
    return r.json();
  };
  await req('/api/configuration', 'PUT', {name: '发布合成', provider: 'openai-compatible', baseUrl: provider.baseUrl, model: 'synthetic-pub', apiKey: 'synthetic-pub-only'});
  const initiativeId = randomUUID();
  await req('/api/strategy/initiatives', 'POST', {operationId: initiativeId, title: '发布事项', scopes: [stores]}, 201);
  const base = `/api/strategy/initiatives/${initiativeId}`;
  const report = (await req(`${base}/reports`, 'POST', {operationId: randomUUID(), fields: kickoffFields, sources: []}, 201)).version;
  await req(`${base}/reports/1/lock`, 'POST', {operationId: randomUUID(), sha256: report.contentSha256});
  await req(`${base}/reports/1/apply`, 'POST', {operationId: randomUUID(), sha256: report.contentSha256, scope: stores});
  const a = await lockedPassedCandidate(req, provider, base, stores, '会员复购优先', ['90天二购率达到12%']);

  assert.deepEqual((await req(`${base}/publications`)).publications, []);
  const publishInput = {operationId: randomUUID(), candidateId: a.cid, no: 1, sha256: a.locked.contentSha256, batchId: a.batch.batchId, confirmed: true, formalGoals: [formalGoal('90天二购率达到12%',12,'%')], expectedActive: null};
  assert.equal((await req(`${base}/publications`, 'POST', {...publishInput, confirmed: false}, 400)).code, 'strategy_publication_confirmation_required');
  assert.deepEqual((await req(`${base}/publications`)).publications, [], 'skipped confirmation writes nothing');
  assert.equal((await req(`${base}/publications`, 'POST', {...publishInput, operationId: randomUUID(), sha256: '0'.repeat(64)}, 409)).code, 'strategy_candidate_version_conflict');
  assert.equal((await req(`${base}/publications`, 'POST', {...publishInput, operationId: randomUUID(), batchId: randomUUID()}, 409)).code, 'strategy_verification_credentials_required');
  const pubA = (await req(`${base}/publications`, 'POST', publishInput, 201)).publication;
  assert.equal(pubA.state, 'active');
  assert.equal(pubA.contentSha256, a.locked.contentSha256);
  assert.equal(pubA.batchId, a.batch.batchId);
  assert.deepEqual((await req(`${base}/publications`, 'POST', publishInput, 201)).publication, pubA);
  assert.equal((await req(`${base}/publications`, 'POST', {...publishInput, template: '条目表'}, 409)).code, 'strategy_publication_operation_conflict');

  const handoffInput = {operationId: randomUUID(), scope: personal, selected: [0]};
  const handoff = (await req(`${base}/publications/${pubA.publicationId}/handoff`, 'POST', handoffInput)).handoff;
  assert.equal(handoff.goals.length, 1);
  const goal = (await req(`/api/strategy/goals/${handoff.goals[0].goalId}`)).goal;
  assert.equal(goal.versions[0].status, 'candidate');
  assert.equal(goal.versions[0].title, '90天二购率达到12%');
  assert.match(goal.versions[0].strategyContext.summary, new RegExp(pubA.publicationId));
  // The selected destination is personal, while the signed source map belongs to stores.
  const adopted = await req(`/api/strategy/goals/${goal.id}/gsa-plan/confirm`, 'POST', {
    operationId: randomUUID(), expectedPlanVersion: 0, expectedGoalVersion:1, expectedAdoptedVersion:null, decision:'沿本批回执承接',
    plannedActions:[{id:'a1',summary:'月初组织复购试点',checkpoint:'月末',observationBasis:'经核实的成交清单'}],
  },201);
  assert.equal(adopted.gsaPlan.origin.publicationId,pubA.publicationId);

  assert.deepEqual((await req(`${base}/publications/${pubA.publicationId}/handoff`, 'POST', handoffInput)).handoff, handoff);
  assert.equal((await req('/api/strategy/goals')).goals.length, 1, 'duplicate handoff does not create goals');

  const b = await lockedPassedCandidate(req, provider, base, stores, '门店效率优先', ['同店转化率提升2个百分点']);
  const pubB = (await req(`${base}/publications`, 'POST', {operationId: randomUUID(), candidateId: b.cid, no: 1, sha256: b.locked.contentSha256, batchId: b.batch.batchId, confirmed: true, expectedActive: pubA.publicationId}, 201)).publication;
  const pubs = (await req(`${base}/publications`)).publications;
  assert.equal(pubs.filter((p: any) => p.state === 'active').length, 1);
  const replacedA = pubs.find((p: any) => p.publicationId === pubA.publicationId);
  assert.equal(replacedA.state, 'replaced');
  assert.equal(replacedA.replacedBy, pubB.publicationId);
  assert.equal((await req(`${base}/publications/${pubA.publicationId}/handoff`, 'POST', {operationId: randomUUID(), scope: personal, selected: [0]}, 409)).code, 'strategy_publication_not_active');
  assert.equal((await req(`/api/strategy/goals/${handoff.goals[0].goalId}`)).goal.versions[0].status, 'adopted', 'the explicitly adopted handoff goal remains readable after replacement');

  const withdrawn = (await req(`${base}/publications/${pubB.publicationId}/withdraw`, 'POST', {operationId: randomUUID()})).publication;
  assert.equal(withdrawn.state, 'withdrawn');
  assert.ok(withdrawn.withdrawnAt);
  assert.equal((await req(`${base}/publications/${pubB.publicationId}/handoff`, 'POST', {operationId: randomUUID(), scope: personal, selected: [0]}, 409)).code, 'strategy_publication_not_active');
  assert.equal((await req(`${base}/publications`, 'POST', {operationId: randomUUID(), candidateId: b.cid, no: 1, sha256: b.locked.contentSha256, batchId: b.batch.batchId, confirmed: true, expectedActive: null}, 409)).code, 'strategy_publication_withdrawn_locked');
  assert.equal((await req(`${base}/publications`)).publications.filter((p: any) => p.state === 'active').length, 0);
  assert.deepEqual(provider.errors, []);
});

test('真实 Host：不同范围的有效发布并存', {timeout: 180_000}, async t => {
  const provider = await startToolProvider(), host = await startTestHost();
  t.after(async () => { await host.close(); await provider.close(); });
  const req = async (route: string, method = 'GET', body?: unknown, status = 200): Promise<any> => {
    const r = await host.request(route, method, body);
    assert.equal(r.status, status, await r.clone().text());
    return r.json();
  };
  await req('/api/configuration', 'PUT', {name: '范围合成', provider: 'openai-compatible', baseUrl: provider.baseUrl, model: 'synthetic-scope', apiKey: 'synthetic-scope-only'});
  const initiativeId = randomUUID();
  await req('/api/strategy/initiatives', 'POST', {operationId: initiativeId, title: '双范围事项', scopes: [stores, ecommerce]}, 201);
  const base = `/api/strategy/initiatives/${initiativeId}`;
  const report = (await req(`${base}/reports`, 'POST', {operationId: randomUUID(), fields: kickoffFields, sources: []}, 201)).version;
  await req(`${base}/reports/1/lock`, 'POST', {operationId: randomUUID(), sha256: report.contentSha256});
  await req(`${base}/reports/1/apply`, 'POST', {operationId: randomUUID(), sha256: report.contentSha256, scope: stores});
  await req(`${base}/reports/1/apply`, 'POST', {operationId: randomUUID(), sha256: report.contentSha256, scope: ecommerce});
  const a = await lockedPassedCandidate(req, provider, base, stores, '会员复购优先', ['二购率12%']);
  const b = await lockedPassedCandidate(req, provider, base, ecommerce, '门店效率优先', ['转化率提升']);
  const pubA = (await req(`${base}/publications`, 'POST', {operationId: randomUUID(), candidateId: a.cid, no: 1, sha256: a.locked.contentSha256, batchId: a.batch.batchId, confirmed: true, expectedActive: null}, 201)).publication;
  const pubB = (await req(`${base}/publications`, 'POST', {operationId: randomUUID(), candidateId: b.cid, no: 1, sha256: b.locked.contentSha256, batchId: b.batch.batchId, confirmed: true, expectedActive: null}, 201)).publication;
  assert.equal(pubA.state, 'active');
  assert.equal(pubB.state, 'active');
  assert.notEqual(pubA.scopeKey, pubB.scopeKey);
  assert.equal((await req(`${base}/publications`)).publications.filter((p: any) => p.state === 'active').length, 2);
  assert.equal((await req(`${base}/publications?scopeKey=${encodeURIComponent('department:ent-1:east-retail')}`)).publications.length, 1);
});