import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID, createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {startTestHost} from './fixtures/host-process.ts';
import {startToolProvider, providerMessageText} from './fixtures/tool-provider.ts';

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

test('真实 Host+Pi：候选自读保存回执并从冲突中有限纠正', {timeout: 150_000}, async t => {
  const provider = await startToolProvider(), host = await startTestHost();
  t.after(async () => { await host.close(); await provider.close(); });
  const req = async (route: string, method = 'GET', body?: unknown, status = 200): Promise<any> => {
    const r = await host.request(route, method, body);
    assert.equal(r.status, status, await r.clone().text());
    return r.json();
  };
  await req('/api/configuration', 'PUT', {name: '候选恢复合成', provider: 'openai-compatible', baseUrl: provider.baseUrl, model: 'synthetic-candidate-recovery', apiKey: 'synthetic-candidate-recovery'});
  const initiativeId = randomUUID();
  await req('/api/strategy/initiatives', 'POST', {operationId: initiativeId, title: '候选恢复事项', scopes: [stores]}, 201);
  const base = `/api/strategy/initiatives/${initiativeId}`;
  const report = (await req(`${base}/reports`, 'POST', {operationId: randomUUID(), fields: kickoffFields, sources: []}, 201)).version;
  await req(`${base}/reports/1/lock`, 'POST', {operationId: randomUUID(), sha256: report.contentSha256});
  await req(`${base}/reports/1/apply`, 'POST', {operationId: randomUUID(), sha256: report.contentSha256, scope: stores});

  const operationA = randomUUID(), operationB = randomUUID(), operationC = randomUUID();
  const blocksA = blocksFor('方案 A');
  const blocksB = blocksFor('方案 B');
  const blocksC = blocksFor('有限纠正稿 C');
  const results: string[] = [];
  const candidateFile = join(host.dataRoot, 'strategy-initiatives', initiativeId, 'candidates.json');
  let beforeConflict = '', afterConflict = '';
  provider.setResponder(async (ctx: any) => {
    const step = ctx.recentToolResults.length;
    if (step > 0) results[step - 1] = providerMessageText(ctx.recentToolResults.at(-1)?.content);
    if (step === 0 || step === 1) return {calls: [{name: 'strategy_goals', arguments: {action: 'initiative-save-candidate', operationId: operationA, candidateBlocks: blocksA}}]};
    if (step === 2) return {calls: [{name: 'strategy_goals', arguments: {action: 'initiative-save-candidate', operationId: operationB, candidateBlocks: blocksB}}]};
    if (step === 3) return {calls: [{name: 'strategy_goals', arguments: {action: 'initiative-save-candidate', operationId: operationA, candidateBlocks: blocksA}}]};
    if (step === 4) {
      beforeConflict = createHash('sha256').update(await readFile(candidateFile)).digest('hex');
      return {calls: [{name: 'strategy_goals', arguments: {action: 'initiative-save-candidate', operationId: operationA, candidateBlocks: blocksC}}]};
    }
    if (step === 5) {
      afterConflict = createHash('sha256').update(await readFile(candidateFile)).digest('hex');
      return {calls: [{name: 'strategy_goals', arguments: {action: 'initiative-read-candidate'}}]};
    }
    if (step === 6) return {calls: [{name: 'strategy_goals', arguments: {action: 'operation', operationId: operationA}}]};
    if (step === 7) return {calls: [{name: 'strategy_goals', arguments: {action: 'operation', operationId: randomUUID()}}]};
    if (step === 8) return {calls: [{name: 'strategy_goals', arguments: {action: 'initiative-read-candidate', candidateId: randomUUID(), no: 1}}]};
    if (step === 9) return {calls: [{name: 'strategy_goals', arguments: {action: 'initiative-save-candidate', operationId: operationC, candidateBlocks: blocksC}}]};
    return {text: '已核对原回执，并以新操作身份保存明确纠正稿。'};
  });
  const created = await req(`${base}/candidates`, 'POST', {operationId: randomUUID(), scope: stores, title: '冲突恢复候选', instruction: '保存、核对并修正候选。'}, 202);
  const cid = created.candidate.candidateId;
  let detail: any;
  for (let n = 0; n < 500; n++) { detail = await req(`${base}/candidates/${cid}/versions/1`); if (detail.candidate.lastRun?.status === 'completed') break; await delay(20); }
  assert.equal(detail.candidate.lastRun.status, 'completed');
  assert.equal(afterConflict, beforeConflict, 'conflicting operation does not change persisted bytes');

  const first = JSON.parse(results[0]);
  const savedB = JSON.parse(results[2]);
  const replayedOld = JSON.parse(results[3]);
  assert.deepEqual(replayedOld.receipt, first.receipt, 'an older operation still returns its original receipt after a newer save');
  assert.equal(replayedOld.candidate.contentSha256, first.candidate.contentSha256);
  assert.match(results[4], /strategy_candidate_operation_conflict/);
  assert.match(results[4], /initiative-read-candidate/);
  assert.match(results[4], /operation/);

  const readback = JSON.parse(results[5]);
  assert.equal(readback.candidate.candidateId, cid);
  assert.equal(readback.candidate.no, 1);
  assert.equal(readback.candidate.contentSha256, savedB.candidate.contentSha256, 'self-read returns current B, not replayed A');
  assert.deepEqual(readback.candidate.blocks, blocksB);
  assert.equal(readback.saveReceipts.length, 2);
  const original = JSON.parse(results[6]);
  assert.deepEqual(original.receipt, first.receipt);
  assert.match(results[7], /strategy_candidate_operation_not_found/);
  assert.match(results[8], /strategy_candidate_owner_mismatch/);

  assert.equal(detail.candidate.contentSha256, JSON.parse(results[8 + 1]).candidate.contentSha256);
  assert.deepEqual(detail.candidate.blocks, blocksC);
  assert.equal(detail.candidate.saveReceipts.length, 3);
  await req(`${base}/candidates/${cid}/versions/1/lock`, 'POST', {operationId: randomUUID(), sha256: detail.candidate.contentSha256});
  await req(`${base}/candidates/${cid}/versions/1/close`, 'POST', {});
  const reopened = await req(`${base}/candidates/${cid}/versions/1`);
  assert.equal(reopened.candidate.saveReceipts.length, 3, 'save receipts survive close and native history readback');
  assert.deepEqual(provider.errors, []);
});

test('I131-B 真实 Host+Pi：候选保存角色字段／操作身份／块与目标校验定位、自修保存及旧 lastSave 兼容', {timeout: 180_000}, async t => {
  const provider = await startToolProvider(), host = await startTestHost();
  let releaseAdmission!: () => void;
  const admission = new Promise<void>(resolve => { releaseAdmission = resolve; });
  t.after(async () => { releaseAdmission(); await host.close(); await provider.close(); });
  const req = async (route: string, method = 'GET', body?: unknown, status = 200): Promise<any> => {
    const r = await host.request(route, method, body);
    assert.equal(r.status, status, await r.clone().text());
    return r.json();
  };
  await req('/api/configuration', 'PUT', {name: '候选校验合成', provider: 'openai-compatible', baseUrl: provider.baseUrl, model: 'synthetic-candidate-validation', apiKey: 'synthetic-candidate-validation'});
  const initiativeId = randomUUID();
  await req('/api/strategy/initiatives', 'POST', {operationId: initiativeId, title: '候选校验事项', scopes: [stores]}, 201);
  const base = `/api/strategy/initiatives/${initiativeId}`;
  const report = (await req(`${base}/reports`, 'POST', {operationId: randomUUID(), fields: kickoffFields, sources: []}, 201)).version;
  await req(`${base}/reports/1/lock`, 'POST', {operationId: randomUUID(), sha256: report.contentSha256});
  await req(`${base}/reports/1/apply`, 'POST', {operationId: randomUUID(), sha256: report.contentSha256, scope: stores});

  const candidateFile = join(host.dataRoot, 'strategy-initiatives', initiativeId, 'candidates.json');
  const results: string[] = [];
  let bytesBefore = '', bytesAfterFailures = '';
  const opNoGoals = randomUUID(), opWithGoals = randomUUID();
  provider.setResponder(async (ctx: any) => {
    const step = ctx.recentToolResults.length;
    if (step > 0) results[step - 1] = providerMessageText(ctx.recentToolResults.at(-1)?.content);
    if (step === 0) {
      // Freeze after the original create acknowledgement has persisted its
      // createRequestId; that normal admission write is not an invalid save.
      await admission;
      bytesBefore = createHash('sha256').update(await readFile(candidateFile)).digest('hex');
      // Role-disallowed fields: version & no
      return {calls: [{name: 'strategy_goals', arguments: {action: 'initiative-save-candidate', operationId: randomUUID(), version: 1, no: 1, candidateBlocks: blocksFor('夹带字段')}}]};
    }
    if (step === 1) {
      // Missing operationId
      return {calls: [{name: 'strategy_goals', arguments: {action: 'initiative-save-candidate', candidateBlocks: blocksFor('缺操作编号')}}]};
    }
    if (step === 2) {
      // Empty candidateBlocks
      return {calls: [{name: 'strategy_goals', arguments: {action: 'initiative-save-candidate', operationId: randomUUID(), candidateBlocks: []}}]};
    }
    if (step === 3) {
      // Duplicate block ID
      return {calls: [{name: 'strategy_goals', arguments: {action: 'initiative-save-candidate', operationId: randomUUID(), candidateBlocks: [
        {id: 'B1', label: '定位', text: '正文1'},
        {id: 'B1', label: '重复', text: '正文2'},
      ]}}]};
    }
    if (step === 4) {
      // Invalid block ID (spaces/punctuation not matching ^[A-Za-z0-9_-]{1,40}$)
      return {calls: [{name: 'strategy_goals', arguments: {action: 'initiative-save-candidate', operationId: randomUUID(), candidateBlocks: [
        {id: 'bad id!', label: '非法ID', text: '正文'},
      ]}}]};
    }
    if (step === 5) {
      // Object-shaped candidateGoals (SDK-level validation stays visible)
      return {calls: [{name: 'strategy_goals', arguments: {action: 'initiative-save-candidate', operationId: randomUUID(), candidateBlocks: blocksFor('对象目标'), candidateGoals: [{title: '非法对象目标'}]}}]};
    }
    if (step === 6) {
      bytesAfterFailures = createHash('sha256').update(await readFile(candidateFile)).digest('hex');
      // Corrected save without goals (legal)
      return {calls: [{name: 'strategy_goals', arguments: {action: 'initiative-save-candidate', operationId: opNoGoals, candidateBlocks: blocksFor('无目标合法稿')}}]};
    }
    if (step === 7) {
      // Corrected save with valid string-array goals
      return {calls: [{name: 'strategy_goals', arguments: {action: 'initiative-save-candidate', operationId: opWithGoals, candidateBlocks: blocksFor('带目标合法稿'), candidateGoals: ['90天二购率提升至12%', '试点门店导购覆盖率达到80%']}}]};
    }
    return {text: '已按安全错误定位完成修正并保存候选。'};
  });

  const created = await req(`${base}/candidates`, 'POST', {operationId: randomUUID(), scope: stores, title: '校验修正候选', instruction: '测试校验定位并修正保存。'}, 202);
  releaseAdmission();
  const cid = created.candidate.candidateId;
  let detail: any;
  for (let n = 0; n < 500; n++) { detail = await req(`${base}/candidates/${cid}/versions/1`); if (detail.candidate.lastRun?.status === 'completed') break; await delay(20); }
  assert.equal(detail.candidate.lastRun.status, 'completed');
  assert.equal(bytesAfterFailures, bytesBefore, 'all validation failures must produce zero persisted writes');

  // Step 0: role fields
  assert.match(results[0], /strategy_candidate_fields_invalid/);
  assert.match(results[0], /"path":"version"/);
  assert.match(results[0], /"path":"no"/);
  assert.match(results[0], /unknown_field/);
  // Step 1: missing operationId
  assert.match(results[1], /strategy_candidate_operation_invalid/);
  assert.match(results[1], /"path":"operationId"/);
  assert.match(results[1], /required/);
  // Step 2: empty candidateBlocks
  assert.match(results[2], /strategy_candidate_schema_invalid/);
  assert.match(results[2], /"path":"candidateBlocks"/);
  assert.match(results[2], /too_few/);
  // Step 3: duplicate block ID
  assert.match(results[3], /strategy_candidate_schema_invalid/);
  assert.match(results[3], /candidateBlocks\[1\]\.id/);
  assert.match(results[3], /duplicate_id/);
  // Step 4: invalid block ID
  assert.match(results[4], /strategy_candidate_schema_invalid/);
  assert.match(results[4], /candidateBlocks\[0\]\.id/);
  assert.match(results[4], /invalid_id/);
  // Step 5: SDK-level candidateGoals object error stays visible
  assert.match(results[5], /candidateGoals/i);
  // Step 6 & 7: both legal saves succeeded
  const savedNoGoals = JSON.parse(results[6]);
  assert.equal(savedNoGoals.receipt.operationId, opNoGoals);
  const savedWithGoals = JSON.parse(results[7]);
  assert.equal(savedWithGoals.receipt.operationId, opWithGoals);
  assert.deepEqual(detail.candidate.goals, ['90天二购率提升至12%', '试点门店导购覆盖率达到80%']);
  assert.equal(detail.candidate.saveReceipts.length, 2);
  assert.deepEqual(provider.errors, []);
});
