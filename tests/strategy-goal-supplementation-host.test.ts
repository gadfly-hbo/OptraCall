import {formalGoal} from './fixtures/strategy-formal-goal.ts';
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
    formalGoals: [formalGoal('90天二购率达到12%',12,'%'), formalGoal('试点门店触达率达到80%',80,'%')],
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

  // 3. Locked B v1 -> create child candidate B v2 with parent -> Host provides compact parentVersion + direct-parent readback -> new session, new fingerprint, fresh lock + fresh verify -> publish & handoff
  let parentPromptCaptured = '';
  let parentReadbackBlocks: any[] = [];
  provider.setResponder((ctx: any) => {
    const step = ctx.recentToolResults.length;
    if (step === 0) {
      parentPromptCaptured = ctx.messages.filter((m: any) => m.role === 'user').map((m: any) => providerMessageText(m.content)).join('\n');
      return {calls: [{name: 'strategy_goals', arguments: {action: 'initiative-read-candidate', candidateId: cidB, no: 1}}]};
    }
    if (step === 1) {
      const readback = JSON.parse(providerMessageText(ctx.recentToolResults[0]?.content));
      parentReadbackBlocks = readback.candidate.blocks;
      return {calls: [{name: 'strategy_goals', arguments: {action: 'initiative-save-candidate', operationId: randomUUID(), candidateBlocks: parentReadbackBlocks, candidateGoals: ['门店人效提升15%']}}]};
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
  assert.match(parentPromptCaptured, /parentVersion/, 'child candidate prompt receives compact parentVersion metadata');
  assert.match(parentPromptCaptured, new RegExp(lockedB1.contentSha256), 'child candidate prompt carries exact parent contentSha256');
  assert.equal(parentReadbackBlocks[1]?.text, '试点预算 50 万元，聚焦 2 家成熟店。', 'child reads exact parent blocks via initiative-read-candidate');

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
    formalGoals: [formalGoal('门店人效提升15%',15,'%')],
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

test('I131-D-Rework-5 真实 Host+Pi：合法长父版不触发 413、支持受限分页读回父版，派发前确定性 413 零写入且不假重放', {timeout: 180_000}, async t => {
  const provider = await startToolProvider(), host = await startTestHost();
  t.after(async () => { await host.close(); await provider.close(); });
  const req = async (route: string, method = 'GET', body?: unknown, status = 200): Promise<any> => {
    const r = await host.request(route, method, body);
    assert.equal(r.status, status, await r.clone().text());
    return r.json();
  };
  await req('/api/configuration', 'PUT', {name: '长父版合成', provider: 'openai-compatible', baseUrl: provider.baseUrl, model: 'synthetic-long-parent', apiKey: 'synthetic-long-parent'});
  const initiativeId = randomUUID();
  await req('/api/strategy/initiatives', 'POST', {operationId: initiativeId, title: '长父版补目标事项', scopes: [stores]}, 201);
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
      ? {text: '检验通过。'}
      : {calls: [{name: 'strategy_goals', arguments: {action: 'initiative-save-verification', verdict: 'pass', evidence: '长父版子候选双检验通过。', verificationSources: [{kind: 'candidate', ref: `${cid}:${no}`, sha256}]}}]});
    const started = await req(`${base}/candidates/${cid}/versions/${no}/verify`, 'POST', {operationId: randomUUID()}, 202);
    for (let n = 0; n < 500; n++) {
      const list = (await req(`${base}/candidates/${cid}/versions/${no}/verifications`)).batches;
      const batch = list.find((b: any) => b.batchId === started.batch.batchId);
      if (batch && batch.state !== 'running') return batch;
      await delay(20);
    }
    throw new Error('verification did not settle');
  };

  // Create an unrelated candidate first (for cross-candidate readback isolation check)
  provider.setResponder((ctx: any) => ctx.recentToolResults.length
    ? {text: '其他候选已保存。'}
    : {calls: [{name: 'strategy_goals', arguments: {action: 'initiative-save-candidate', operationId: randomUUID(), candidateBlocks: blocks}}]});
  const otherCand = await req(`${base}/candidates`, 'POST', {operationId: randomUUID(), scope: stores, title: '无关候选', instruction: '无关方向。'}, 202);
  await settleCandidate(otherCand.candidate.candidateId, 1);

  // 1. Legal long parent: 4 blocks x 20,000 chars = 80,000 chars, empty goals
  const longBlocks = [1, 2, 3, 4].map(i => {
    const head = `SECTION_${i}_HEAD_`, tail = `_SECTION_${i}_TAIL`;
    return {id: `L${i}`, label: `长章节 ${i}`, text: head + String(i).repeat(20000 - head.length - tail.length) + tail};
  });
  assert.equal(longBlocks.every(b => b.text.length === 20000), true);
  provider.setResponder((ctx: any) => ctx.recentToolResults.length
    ? {text: '8万字合法父版已保存。'}
    : {calls: [{name: 'strategy_goals', arguments: {action: 'initiative-save-candidate', operationId: randomUUID(), candidateBlocks: longBlocks}}]});
  const createdParent = await req(`${base}/candidates`, 'POST', {operationId: randomUUID(), scope: stores, title: '长方案父版', instruction: '形成完整长方案。'}, 202);
  const parentCid = createdParent.candidate.candidateId;
  const parentDetail = await settleCandidate(parentCid, 1);
  assert.equal(parentDetail.candidate.blocks.length, 4);
  assert.deepEqual(parentDetail.candidate.goals, []);
  const lockedParent = (await req(`${base}/candidates/${parentCid}/versions/1/lock`, 'POST', {operationId: randomUUID(), sha256: parentDetail.candidate.contentSha256})).candidate;

  // 2. Create child candidate v2 from locked 80,000-char parent -> MUST succeed 202 with real requestId, paged readback works, unrelated readback 403!
  let directoryPayload: any = null;
  let crossCandError = '';
  let reconstructedL1 = '';
  const childCreateOp = randomUUID();
  provider.setResponder((ctx: any) => {
    const step = ctx.recentToolResults.length;
    if (step === 0) {
      return {calls: [{name: 'strategy_goals', arguments: {action: 'initiative-read-candidate', candidateId: parentCid, no: 1}}]};
    }
    if (step === 1) {
      directoryPayload = JSON.parse(providerMessageText(ctx.recentToolResults[0]?.content));
      return {calls: [{name: 'strategy_goals', arguments: {action: 'initiative-read-candidate', candidateId: parentCid, no: 1, blockId: 'L1', offset: 0, limit: 8192}}]};
    }
    if (step === 2) {
      const p1 = JSON.parse(providerMessageText(ctx.recentToolResults[1]?.content));
      reconstructedL1 += p1.block.text;
      return {calls: [{name: 'strategy_goals', arguments: {action: 'initiative-read-candidate', candidateId: parentCid, no: 1, blockId: 'L1', offset: p1.block.nextOffset, limit: 8192}}]};
    }
    if (step === 3) {
      const p2 = JSON.parse(providerMessageText(ctx.recentToolResults[2]?.content));
      reconstructedL1 += p2.block.text;
      return {calls: [{name: 'strategy_goals', arguments: {action: 'initiative-read-candidate', candidateId: parentCid, no: 1, blockId: 'L1', offset: p2.block.nextOffset, limit: 8192}}]};
    }
    if (step === 4) {
      const p3 = JSON.parse(providerMessageText(ctx.recentToolResults[3]?.content));
      reconstructedL1 += p3.block.text;
      assert.equal(p3.block.nextOffset, null);
      // Try reading unrelated candidate -> must be rejected
      return {calls: [{name: 'strategy_goals', arguments: {action: 'initiative-read-candidate', candidateId: otherCand.candidate.candidateId, no: 1}}]};
    }
    if (step === 5) {
      crossCandError = providerMessageText(ctx.recentToolResults[4]?.content);
      return {calls: [{name: 'strategy_goals', arguments: {action: 'initiative-save-candidate', operationId: randomUUID(), candidateBlocks: longBlocks, candidateGoals: ['长父版补目标一：华东二购率达到 15%', '长父版补目标二：核心门店人效提升 12%']}}]};
    }
    return {text: '已完整分页读取长父版并保存补目标新候选。'};
  });

  const childInput = {
    operationId: childCreateOp, scope: stores, title: '长方案父版', instruction: '基于父版保留正文并补充两条可承接目标。',
    parent: {candidateId: parentCid, no: 1},
  };
  const createChild = () => req(`${base}/candidates`, 'POST', childInput, 202);
  const childCreated = await createChild();
  assert.equal(childCreated.candidate.no, 2);
  assert.ok(childCreated.requestId, 'create with long parent must return real requestId');
  const childDetail = await settleCandidate(parentCid, 2);
  assert.equal(childDetail.candidate.lastRun.status, 'completed');
  assert.equal(directoryPayload?.pagingRequired, true, 'long parent readback returns bounded directory');
  assert.equal(directoryPayload?.candidate?.blocks?.length, 4);
  assert.equal(directoryPayload?.candidate?.blocks?.[0]?.textLength, 20000);
  assert.equal(reconstructedL1, longBlocks[0]!.text, 'paged readback reconstructs exact 20,000 chars without truncation');
  assert.match(crossCandError, /strategy_candidate_owner_mismatch/, 'unrelated candidate readback denied');
  assert.equal(childDetail.candidate.goals.length, 2);
  assert.notEqual(childDetail.snapshot.sessionFile, parentDetail.snapshot.sessionFile);
  assert.notEqual(childDetail.candidate.contentSha256, lockedParent.contentSha256);

  // 3. Idempotent replay of createOperationId returns 202/replayed with real requestId
  const replayed = await createChild();
  assert.equal(replayed.replayed, true);
  assert.equal(replayed.requestId, childCreated.requestId);

  // 4. Follow-up message to child v2 succeeds 202 (never 413!)
  provider.setResponder(() => ({text: '已核对补目标版本，后续对话正常。'}));
  const followUp = await req(`${base}/candidates/${parentCid}/versions/2/messages`, 'POST', {
    requestId: randomUUID(), text: '请复核刚刚补充的两条目标。', expectedRevision: childDetail.candidate.revision,
  }, 202);
  assert.ok(followUp.requestId);
  const afterFollowUp = await settleCandidate(parentCid, 2);
  assert.equal(afterFollowUp.candidate.lastRun.status, 'completed');
  const runsBeforeReplay = provider.requests.length;
  const afterChatReplay = await createChild();
  assert.equal(afterChatReplay.requestId, childCreated.requestId, 'create replay retains the first accepted request after further conversation');
  assert.equal(afterChatReplay.candidate.lastRun.id, followUp.requestId);
  assert.equal(provider.requests.length, runsBeforeReplay);

  // 5. Fresh lock on 80k-char child v2 + create concise child v3 from locked 80k-char parent to complete full fresh lock + dual verification; parent v1 stays byte-identical
  const lockedChild = (await req(`${base}/candidates/${parentCid}/versions/2/lock`, 'POST', {operationId: randomUUID(), sha256: afterFollowUp.candidate.contentSha256})).candidate;
  assert.ok(lockedChild.lock?.fingerprint);
  assert.notEqual(lockedChild.lock.fingerprint, lockedParent.lock.fingerprint);

  provider.setResponder((ctx: any) => ctx.recentToolResults.length
    ? {text: '已基于长父版形成精炼补目标版。'}
    : {calls: [{name: 'strategy_goals', arguments: {action: 'initiative-save-candidate', operationId: randomUUID(), candidateBlocks: blocks, candidateGoals: ['长父版补目标一：华东二购率达到 15%']}}]});
  const child3Create = await req(`${base}/candidates`, 'POST', {
    operationId: randomUUID(), scope: stores, title: '长方案精炼补目标版', instruction: '基于长父版提炼核心章节并补充可承接目标。',
    parent: {candidateId: parentCid, no: 1},
  }, 202);
  assert.equal(child3Create.candidate.no, 3);
  const child3Detail = await settleCandidate(parentCid, 3);
  const lockedChild3 = (await req(`${base}/candidates/${parentCid}/versions/3/lock`, 'POST', {operationId: randomUUID(), sha256: child3Detail.candidate.contentSha256})).candidate;
  const childBatch = await passDualVerify(parentCid, 3, lockedChild3.lock.fingerprint);
  assert.equal(childBatch.state, 'passed');
  const parentCheck = (await req(`${base}/candidates/${parentCid}/versions/1`)).candidate;
  assert.equal(parentCheck.contentSha256, lockedParent.contentSha256, 'parent v1 remains byte-identical');

  // 6. Legal max boundary: 20 blocks x 20,000 chars + 10 goals x 500 chars -> lock -> child create succeeds 202!
  const maxBlocks = Array.from({length: 20}, (_, idx) => ({
    id: `M${idx + 1}`,
    label: `最大块 ${idx + 1}`,
    text: `MAX_${idx + 1}_` + 'x'.repeat(20000 - `MAX_${idx + 1}_`.length),
  }));
  const maxGoals = Array.from({length: 10}, (_, idx) => `G${idx + 1}_` + '目'.repeat(500 - `G${idx + 1}_`.length));
  provider.setResponder((ctx: any) => ctx.recentToolResults.length
    ? {text: '最大边界父版已保存。'}
    : {calls: [{name: 'strategy_goals', arguments: {action: 'initiative-save-candidate', operationId: randomUUID(), candidateBlocks: maxBlocks, candidateGoals: maxGoals}}]});
  const maxParentCreate = await req(`${base}/candidates`, 'POST', {operationId: randomUUID(), scope: stores, title: '最大边界父版', instruction: '保存最大边界父版。'}, 202);
  const maxParentDetail = await settleCandidate(maxParentCreate.candidate.candidateId, 1);
  assert.equal(maxParentDetail.candidate.blocks.length, 20);
  assert.equal(maxParentDetail.candidate.goals.length, 10);
  await req(`${base}/candidates/${maxParentCreate.candidate.candidateId}/versions/1/lock`, 'POST', {operationId: randomUUID(), sha256: maxParentDetail.candidate.contentSha256});
  provider.setResponder(() => ({text: '最大边界子候选启动成功。'}));
  const maxChildCreate = await req(`${base}/candidates`, 'POST', {
    operationId: randomUUID(), scope: stores, title: '最大边界子候选', instruction: '基于最大边界父版继续细化。',
    parent: {candidateId: maxParentCreate.candidate.candidateId, no: 1},
  }, 202);
  assert.ok(maxChildCreate.requestId);
  await settleCandidate(maxParentCreate.candidate.candidateId, 2);

  // 7. Deterministic pre-dispatch 413 (huge files catalog + 20,000-char instruction > 65536) -> ZERO new version written & replay NOT 202!
  const candidateFile = join(host.dataRoot, 'strategy-initiatives', initiativeId, 'candidates.json');
  for (let i = 0; i < 160; i++) {
    await req(`${base}/files`, 'POST', {
      operationId: randomUUID(), directory: '020_clean',
      name: `catalog-budget-padding-file-${String(i).padStart(3, '0')}-${'a'.repeat(120)}.txt`,
      contentBase64: Buffer.from(`f${i}`).toString('base64'),
    }, 201);
  }
  const before413Hash = createHash('sha256').update(await readFile(candidateFile)).digest('hex');
  const before413Count = (await req(`${base}/candidates?scopeKey=${encodeURIComponent(scopeKey)}`)).candidates.length;
  const providerCountBefore413 = provider.requests.length;
  const tooLargeOp = randomUUID();
  const hugeInstruction = '超预算测试'.repeat(4000); // 20,000 chars
  const res413 = await req(`${base}/candidates`, 'POST', {
    operationId: tooLargeOp, scope: stores, title: '应触发413', instruction: hugeInstruction,
    parent: {candidateId: parentCid, no: 1},
  }, 413);
  assert.equal(res413.code, 'strategy_candidate_materials_too_large');
  assert.equal((await req(`${base}/candidates?scopeKey=${encodeURIComponent(scopeKey)}`)).candidates.length, before413Count, '413 pre-dispatch failure writes zero new candidate versions');
  assert.equal(createHash('sha256').update(await readFile(candidateFile)).digest('hex'), before413Hash, 'candidates.json untouched on deterministic pre-dispatch 413');
  assert.equal(provider.requests.length, providerCountBefore413, 'zero provider calls on pre-dispatch 413');
  // Replaying same operationId must NOT return 202/replayed without requestId
  const replay413 = await req(`${base}/candidates`, 'POST', {
    operationId: tooLargeOp, scope: stores, title: '应触发413', instruction: hugeInstruction,
    parent: {candidateId: parentCid, no: 1},
  }, 413);
  assert.equal(replay413.code, 'strategy_candidate_materials_too_large');
});

