import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID, createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {startTestHost} from './fixtures/host-process.ts';
import {startToolProvider, providerMessageText} from './fixtures/tool-provider.ts';

const stores = {kind: 'department' as const, id: 'hean-east', name: '禾岸华东区'};
const scopeKey = 'department::hean-east';
const kickoffFields = {
  horizon: '2027–2029',
  diagnosis: '华东门店客流稳定，增长缺口集中在会员首购后二次到店。',
  propositions: [
    {id: 'P1', question: '会员复购能否带动增长？', whyItMatters: '决定资源投入。'},
    {id: 'P2', question: '导购触达能否规模化？', whyItMatters: '决定试点范围。'},
    {id: 'P3', question: '预算如何在会员与效率间分配？', whyItMatters: '核心取舍。'},
  ],
  assumptions: '试点预算固定。',
  evidenceGaps: '自然复购待补证。',
  followUp: '方案须明确选择与放弃。',
};
const blocks = [
  {id: 'positioning', label: '定位与增长', text: '聚焦华东存量门店会员复购，先试点再推广。'},
  {id: 'resources', label: '预算与资源', text: '试点预算 50 万元，聚焦 2 家成熟店。'},
];

test('I131-D 真实 Host+Pi：无目标合法发布、未锁草稿补目标承接、锁后父版新建候选补目标重锁重检与凭证隔离', {timeout: 180_000}, async t => {
  const provider = await startToolProvider(), host = await startTestHost();
  t.after(async () => { await host.close(); await provider.close(); });
  const req = async (route: string, method = 'GET', body?: unknown, status = 200): Promise<any> => {
    const r = await host.request(route, method, body);
    assert.equal(r.status, status, await r.clone().text());
    return r.json();
  };
  await req('/api/configuration', 'PUT', {name: '目标补全合成', provider: 'openai-compatible', baseUrl: provider.baseUrl, model: 'synthetic-goals-supp', apiKey: 'synthetic-goals-supp'});
  const initiativeId = randomUUID();
  await req('/api/strategy/initiatives', 'POST', {operationId: initiativeId, title: '禾岸目标承接事项', scopes: [stores]}, 201);
  const base = `/api/strategy/initiatives/${initiativeId}`;
  const report = (await req(`${base}/reports`, 'POST', {operationId: randomUUID(), fields: kickoffFields, sources: []}, 201)).version;
  await req(`${base}/reports/1/lock`, 'POST', {operationId: randomUUID(), sha256: report.contentSha256});
  await req(`${base}/reports/1/apply`, 'POST', {operationId: randomUUID(), sha256: report.contentSha256, scope: stores});

  const settleCandidate = async (cid: string, no: number) => {
    for (let n = 0; n < 500; n++) {
      const d = await req(`${base}/candidates/${cid}/versions/${no}`);
      if (d.candidate.lastRun?.status && d.candidate.lastRun.status !== 'accepted') return d;
      await delay(20);
    }
    throw new Error(`candidate ${cid}:${no} did not settle`);
  };
  const passDualVerify = async (cid: string, no: number, sha256: string) => {
    provider.setResponder((ctx: any) => ctx.recentToolResults.length
      ? {text: '检验结论已提交。'}
      : {calls: [{name: 'strategy_goals', arguments: {action: 'initiative-save-verification', verdict: 'pass', evidence: '因果链与战略假设已核对通过。', verificationSources: [{kind: 'candidate', ref: `${cid}:${no}`, sha256}]}}]});
    const started = await req(`${base}/candidates/${cid}/versions/${no}/verify`, 'POST', {operationId: randomUUID()}, 202);
    for (let n = 0; n < 500; n++) {
      const list = (await req(`${base}/candidates/${cid}/versions/${no}/verifications`)).batches;
      const batch = list.find((b: any) => b.batchId === started.batch.batchId);
      if (batch && batch.state !== 'running') return batch;
      await delay(20);
    }
    throw new Error('verification did not settle');
  };

  // 1. Candidate A: created with 0 goals -> unlocked draft supplements goals via candidate session -> lock -> verify -> publish -> handoff to current department
  provider.setResponder((ctx: any) => ctx.recentToolResults.length
    ? {text: '初稿已保存（暂未列目标）。'}
    : {calls: [{name: 'strategy_goals', arguments: {action: 'initiative-save-candidate', operationId: randomUUID(), candidateBlocks: blocks}}]});
  const createdA = await req(`${base}/candidates`, 'POST', {operationId: randomUUID(), scope: stores, title: '会员复购优先', instruction: '形成方案初稿。'}, 202);
  const cidA = createdA.candidate.candidateId;
  let detailA = await settleCandidate(cidA, 1);
  assert.deepEqual(detailA.candidate.goals, []);
  const shaBeforeGoals = detailA.candidate.contentSha256;

  provider.setResponder((ctx: any) => {
    const step = ctx.recentToolResults.length;
    if (step === 0) return {calls: [{name: 'strategy_goals', arguments: {action: 'initiative-read-candidate'}}]};
    if (step === 1) {
      const readback = JSON.parse(providerMessageText(ctx.recentToolResults[0]?.content));
      return {calls: [{name: 'strategy_goals', arguments: {action: 'initiative-save-candidate', operationId: randomUUID(), candidateBlocks: readback.candidate.blocks, candidateGoals: ['90天二购率达到12%', '试点门店触达率达到80%']}}]};
    }
    return {text: '已读回原正文并补充两条可承接目标。'};
  });
  await req(`${base}/candidates/${cidA}/versions/1/messages`, 'POST', {requestId: randomUUID(), text: '请读回正文并补充两条可承接的战略目标。', expectedRevision: detailA.candidate.revision}, 202);
  detailA = await settleCandidate(cidA, 1);
  assert.equal(detailA.candidate.lastRun.status, 'completed');
  assert.deepEqual(detailA.candidate.goals, ['90天二购率达到12%', '试点门店触达率达到80%']);
  assert.notEqual(detailA.candidate.contentSha256, shaBeforeGoals, 'adding goals updates contentSha256');

  const lockedA = (await req(`${base}/candidates/${cidA}/versions/1/lock`, 'POST', {operationId: randomUUID(), sha256: detailA.candidate.contentSha256})).candidate;
  const batchA = await passDualVerify(cidA, 1, lockedA.lock.fingerprint);
  assert.equal(batchA.state, 'passed');
  const pubA = (await req(`${base}/publications`, 'POST', {
    operationId: randomUUID(), candidateId: cidA, no: 1, sha256: lockedA.lock.fingerprint,
    batchId: batchA.batchId, template: '树形地图', confirmed: true, expectedActive: null,
  }, 201)).publication;
  assert.equal(pubA.state, 'active');
  const handoffA = (await req(`${base}/publications/${pubA.publicationId}/handoff`, 'POST', {operationId: randomUUID(), scope: stores, selected: [0, 1]})).handoff;
  assert.equal(handoffA.goals.length, 2);
  assert.equal(handoffA.scope.id, stores.id);

  // 2. Candidate B v1: 0 goals -> locked -> verified -> legally published as strategy record (replaces A); locked in-place mutation rejected
  provider.setResponder((ctx: any) => ctx.recentToolResults.length
    ? {text: '无目标战略方案已保存。'}
    : {calls: [{name: 'strategy_goals', arguments: {action: 'initiative-save-candidate', operationId: randomUUID(), candidateBlocks: blocks}}]});
  const createdB = await req(`${base}/candidates`, 'POST', {operationId: randomUUID(), scope: stores, title: '门店效率优先', instruction: '形成门店效率优先方案。'}, 202);
  const cidB = createdB.candidate.candidateId;
  const detailB1 = await settleCandidate(cidB, 1);
  assert.deepEqual(detailB1.candidate.goals, []);
  const lockedB1 = (await req(`${base}/candidates/${cidB}/versions/1/lock`, 'POST', {operationId: randomUUID(), sha256: detailB1.candidate.contentSha256})).candidate;
  const batchB1 = await passDualVerify(cidB, 1, lockedB1.lock.fingerprint);
  assert.equal(batchB1.state, 'passed');
  const pubB1 = (await req(`${base}/publications`, 'POST', {
    operationId: randomUUID(), candidateId: cidB, no: 1, sha256: lockedB1.lock.fingerprint,
    batchId: batchB1.batchId, template: '条目表', confirmed: true, expectedActive: pubA.publicationId,
  }, 201)).publication;
  assert.equal(pubB1.state, 'active');

  const candidateFile = join(host.dataRoot, 'strategy-initiatives', initiativeId, 'candidates.json');
  const beforeLockedMsg = createHash('sha256').update(await readFile(candidateFile)).digest('hex');
  const lockedRejected = await req(`${base}/candidates/${cidB}/versions/1/messages`, 'POST', {requestId: randomUUID(), text: '请直接补充目标。', expectedRevision: lockedB1.revision}, 409);
  assert.equal(lockedRejected.code, 'strategy_candidate_locked');
  assert.equal(createHash('sha256').update(await readFile(candidateFile)).digest('hex'), beforeLockedMsg, 'locked version rejects mutation with zero write');

  // 3. Locked B v1 -> create child candidate B v2 with parent -> Host provides exact parentVersion context -> new session, new fingerprint, fresh lock + fresh verify -> publish & handoff
  let parentPromptCaptured = '';
  provider.setResponder((ctx: any) => {
    if (!ctx.recentToolResults.length) {
      parentPromptCaptured = ctx.messages.filter((m: any) => m.role === 'user').map((m: any) => providerMessageText(m.content)).join('\n');
      return {calls: [{name: 'strategy_goals', arguments: {action: 'initiative-save-candidate', operationId: randomUUID(), candidateBlocks: blocks, candidateGoals: ['门店人效提升15%']}}]};
    }
    return {text: '已基于父版正文补充可承接目标并保存为新版本。'};
  });
  const createdB2 = await req(`${base}/candidates`, 'POST', {
    operationId: randomUUID(), scope: stores, title: '门店效率优先', instruction: '基于父版保留原正文并补充可承接目标。',
    parent: {candidateId: cidB, no: 1},
  }, 202);
  assert.equal(createdB2.candidate.no, 2);
  assert.deepEqual(createdB2.candidate.parent, {candidateId: cidB, no: 1});
  const detailB2 = await settleCandidate(cidB, 2);
  assert.equal(detailB2.candidate.lastRun.status, 'completed');
  assert.notEqual(detailB2.snapshot.sessionFile, detailB1.snapshot.sessionFile, 'child version owns a new independent Pi session');
  assert.notEqual(detailB2.candidate.contentSha256, lockedB1.contentSha256, 'new goals produce a new contentSha256');
  assert.equal(detailB2.candidate.lock, undefined, 'child version does not inherit lock');
  assert.match(parentPromptCaptured, /parentVersion/, 'child candidate prompt receives exact parentVersion context');
  assert.match(parentPromptCaptured, new RegExp(lockedB1.contentSha256), 'child candidate prompt carries exact parent contentSha256');
  assert.match(parentPromptCaptured, /试点预算 50 万元/, 'child candidate prompt carries exact parent blocks');

  // Old verification batch from v1 cannot publish v2
  const reuseDenied = await req(`${base}/publications`, 'POST', {
    operationId: randomUUID(), candidateId: cidB, no: 2, sha256: detailB2.candidate.contentSha256,
    batchId: batchB1.batchId, template: '树形地图', confirmed: true, expectedActive: pubB1.publicationId,
  }, 409);
  assert.notEqual(reuseDenied.code, undefined);

  const lockedB2 = (await req(`${base}/candidates/${cidB}/versions/2/lock`, 'POST', {operationId: randomUUID(), sha256: detailB2.candidate.contentSha256})).candidate;
  const batchB2 = await passDualVerify(cidB, 2, lockedB2.lock.fingerprint);
  assert.equal(batchB2.state, 'passed');
  const pubB2 = (await req(`${base}/publications`, 'POST', {
    operationId: randomUUID(), candidateId: cidB, no: 2, sha256: lockedB2.lock.fingerprint,
    batchId: batchB2.batchId, template: '树形地图', confirmed: true, expectedActive: pubB1.publicationId,
  }, 201)).publication;
  assert.equal(pubB2.state, 'active');
  const handoffB2 = (await req(`${base}/publications/${pubB2.publicationId}/handoff`, 'POST', {operationId: randomUUID(), scope: stores, selected: [0]})).handoff;
  assert.equal(handoffB2.goals.length, 1);

  // Verify old publication / handoff provenance remains readable
  const history = await req(`${base}/history?scopeKey=${encodeURIComponent(scopeKey)}`);
  assert.equal(history.publications.length, 3);
  assert.equal(history.publications.find((p: any) => p.publicationId === pubA.publicationId).handoffs.length, 1);
  assert.equal(history.publications.find((p: any) => p.publicationId === pubB1.publicationId).state, 'replaced');
  assert.equal(history.publications.find((p: any) => p.publicationId === pubB2.publicationId).state, 'active');
  assert.deepEqual(provider.errors, []);
});
