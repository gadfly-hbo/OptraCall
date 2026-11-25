import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID, createHash} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {startTestHost} from './fixtures/host-process.ts';
import {startToolProvider, providerMessageText} from './fixtures/tool-provider.ts';

const stores = {kind: 'department' as const, id: 'hean-east', name: '禾岸华东区'};
const otherScope = {kind: 'department' as const, id: 'hean-south', name: '禾岸华南区'};
const scopeKey = 'department::hean-east';
const otherScopeKey = 'department::hean-south';
const textSha = (text: string) => createHash('sha256').update(text).digest('hex');

const kickoffFields = {
  horizon: '2027–2029',
  diagnosis: '华东门店客流稳定，复购增长集中在首购后 90 天。',
  propositions: [
    {id: 'P1', question: '会员复购能否带动存量增长？', whyItMatters: '决定资源倾斜。'},
    {id: 'P2', question: '试点预算上限如何控制？', whyItMatters: '决定投入风险。'},
    {id: 'P3', question: '导购触达工时能否承受？', whyItMatters: '决定落地可行性。'},
  ],
  assumptions: '试点预算可控。',
  evidenceGaps: '自然复购率待核。',
  followUp: '候选须明确预算与放弃项。',
};

const candidateBlocks = [
  {id: 'positioning', label: '定位与增长', text: '聚焦华东成熟门店会员复购，先试点再推广。'},
  {id: 'budget', label: '预算与资源', text: '2027 试点投入预算 80 万元，覆盖 3 家门店。'},
];

test('I131-C 真实 Host+Pi：限定修改目标带出、不匹配澄清回传、无变化／空理由／技术失败／取消及开题候选共用回归', {timeout: 180_000}, async t => {
  const provider = await startToolProvider(), host = await startTestHost();
  t.after(async () => { await host.close(); await provider.close(); });
  const req = async (route: string, method = 'GET', body?: unknown, status = 200): Promise<any> => {
    const r = await host.request(route, method, body);
    assert.equal(r.status, status, await r.clone().text());
    return r.json();
  };
  await req('/api/configuration', 'PUT', {name: '拟改反馈合成', provider: 'openai-compatible', baseUrl: provider.baseUrl, model: 'synthetic-revision-feedback', apiKey: 'synthetic-revision-feedback'});
  const initiativeId = randomUUID();
  await req('/api/strategy/initiatives', 'POST', {operationId: initiativeId, title: '禾岸拟改反馈事项', scopes: [stores, otherScope]}, 201);
  const base = `/api/strategy/initiatives/${initiativeId}`;

  const report = (await req(`${base}/reports`, 'POST', {operationId: randomUUID(), fields: kickoffFields, sources: []}, 201)).version;
  await req(`${base}/reports/1/lock`, 'POST', {operationId: randomUUID(), sha256: report.contentSha256});
  await req(`${base}/reports/1/apply`, 'POST', {operationId: randomUUID(), sha256: report.contentSha256, scope: stores});

  provider.setResponder((ctx: any) => ctx.recentToolResults.length
    ? {text: '候选已保存。'}
    : {calls: [{name: 'strategy_goals', arguments: {action: 'initiative-save-candidate', operationId: randomUUID(), candidateBlocks}}]});
  const created = await req(`${base}/candidates`, 'POST', {operationId: randomUUID(), scope: stores, title: '会员复购优先', instruction: '形成方案。'}, 202);
  const cid = created.candidate.candidateId;
  let candidate: any;
  for (let n = 0; n < 500; n++) {
    const d = await req(`${base}/candidates/${cid}/versions/1`);
    if (d.candidate.lastRun?.status === 'completed') { candidate = d.candidate; break; }
    await delay(20);
  }
  assert.ok(candidate);

  const waitProposal = async (proposalId: string) => {
    for (let n = 0; n < 500; n++) {
      const p = (await req(`${base}/proposals?proposalId=${proposalId}&scopeKey=${encodeURIComponent(scopeKey)}`)).proposal;
      if (p.status !== 'pending') return p;
      await delay(20);
    }
    throw new Error(`proposal ${proposalId} did not settle`);
  };

  // 1. Mismatched default block ('positioning') with budget intent -> Agent clarifies without patch
  let capturedPrompt = '';
  const mismatchOp = randomUUID();
  const clarifyText = '预算在「预算与资源」块，当前选中「定位与增长」块不包含预算数字，请确认改选「预算与资源」块后再拟改。';
  provider.setResponder((ctx: any) => {
    capturedPrompt = ctx.messages.filter((m: any) => m.role === 'user').map((m: any) => providerMessageText(m.content)).join('\n');
    return {text: clarifyText};
  });
  const mismatchStart = await req(`${base}/candidates/${cid}/versions/1/revise-proposal`, 'POST', {operationId: mismatchOp, blockId: 'positioning', request: '请把试点预算上限改为 50 万元。'}, 202);
  const mismatchProposal = await waitProposal(mismatchOp);
  assert.equal(mismatchProposal.status, 'ended');
  assert.equal(mismatchProposal.requestId, mismatchStart.requestId);
  assert.equal(mismatchProposal.feedback?.requestId, mismatchStart.requestId);
  assert.equal(mismatchProposal.feedback?.outcome, 'completed');
  assert.equal(mismatchProposal.feedback?.replyText, clarifyText);
  assert.match(capturedPrompt, /定位与增长/, 'proposal prompt includes selected blockLabel');
  assert.match(capturedPrompt, /预算与资源/, 'proposal prompt lists available blocks for accurate clarification');
  assert.equal((await req(`${base}/candidates/${cid}/versions/1`)).candidate.contentSha256, candidate.contentSha256, 'original candidate untouched');

  // Cross-scope proposal read must be rejected
  await req(`${base}/proposals?proposalId=${mismatchOp}&scopeKey=${encodeURIComponent(otherScopeKey)}`, 'GET', undefined, 409);

  // 2. User reselects 'budget' block and continues -> Agent proposes patch -> adopt new version v2
  const budgetOp = randomUUID();
  const newBudgetText = '2027 试点投入预算上限调整为 50 万元，先覆盖 2 家成熟门店。';
  provider.setResponder((ctx: any) => ctx.recentToolResults.length
    ? {text: '已提交预算与资源块拟改，请核对差异。'}
    : {calls: [{name: 'strategy_goals', arguments: {action: 'initiative-propose-revision', proposalId: budgetOp, newText: newBudgetText}}]});
  await req(`${base}/candidates/${cid}/versions/1/revise-proposal`, 'POST', {operationId: budgetOp, blockId: 'budget', request: '请把试点预算上限改为 50 万元，先做 2 家店。'}, 202);
  const budgetProposal = await waitProposal(budgetOp);
  assert.equal(budgetProposal.status, 'proposed');
  assert.equal(budgetProposal.newText, newBudgetText);
  const v2 = (await req(`${base}/candidates/${cid}/versions/1/revise`, 'POST', {
    operationId: randomUUID(), baseSha256: candidate.contentSha256, request: '请把试点预算上限改为 50 万元，先做 2 家店。',
    patches: [{blockId: 'budget', expectedOldSha256: textSha(candidateBlocks[1]!.text), newText: newBudgetText}],
    proposalId: budgetOp,
  }, 201)).candidate;
  assert.equal(v2.no, 2);
  assert.deepEqual(v2.parent, {candidateId: cid, no: 1});
  assert.equal(v2.blocks[0].text, candidateBlocks[0]!.text, 'unselected positioning block keeps exact original bytes');
  assert.equal(v2.blocks[1].text, newBudgetText);

  // 3. No-change / ambiguous intent explanation
  const noChangeOp = randomUUID();
  const noChangeReply = '当前预算已满足 50 万元上限要求，无需修改。';
  provider.setResponder(() => ({text: noChangeReply}));
  await req(`${base}/candidates/${cid}/versions/2/revise-proposal`, 'POST', {operationId: noChangeOp, blockId: 'budget', request: '核对预算是否超过 50 万，如已符合则不改。'}, 202);
  const noChangeProposal = await waitProposal(noChangeOp);
  assert.equal(noChangeProposal.status, 'ended');
  assert.equal(noChangeProposal.feedback?.replyText, noChangeReply);

  // 4. Empty reply without patch -> truthful empty replyText
  const emptyOp = randomUUID();
  provider.setResponder(() => ({text: ''}));
  await req(`${base}/candidates/${cid}/versions/2/revise-proposal`, 'POST', {operationId: emptyOp, blockId: 'budget', request: '请确认一下。'}, 202);
  const emptyProposal = await waitProposal(emptyOp);
  assert.equal(emptyProposal.status, 'ended');
  assert.equal(emptyProposal.feedback?.outcome, 'completed');
  assert.equal(emptyProposal.feedback?.replyText, undefined);

  // 5. Technical failure (Provider 400) -> failed with safe failureDetail (no raw provider message leaked)
  const failOp = randomUUID();
  provider.setResponder(() => ({status: 400}));
  await req(`${base}/candidates/${cid}/versions/2/revise-proposal`, 'POST', {operationId: failOp, blockId: 'budget', request: '测试技术失败。'}, 202);
  const failedProposal = await waitProposal(failOp);
  assert.equal(failedProposal.status, 'failed');
  assert.equal(failedProposal.feedback?.outcome, 'failed');
  assert.ok(failedProposal.feedback?.failureDetail, 'safe failure detail should be recorded');
  assert.equal(JSON.stringify(failedProposal).includes('Synthetic provider failure.'), false, 'raw provider payload must never leak');

  // 6. Cancelled proposal -> failed with feedback.outcome === 'cancelled'
  const cancelOp = randomUUID();
  const beforeCancel = provider.requests.length;
  provider.setResponder(() => ({text: '阻塞等待取消', hold: true}));
  const cancelStart = await req(`${base}/candidates/${cid}/versions/2/revise-proposal`, 'POST', {operationId: cancelOp, blockId: 'budget', request: '测试取消拟改。'}, 202);
  await provider.waitForRequests(beforeCancel + 1);
  await req(`${base}/stop?scopeKey=${encodeURIComponent(scopeKey)}`, 'POST', {expectedRequestId: cancelStart.requestId});
  const cancelledProposal = await waitProposal(cancelOp);
  assert.equal(cancelledProposal.status, 'failed');
  assert.equal(cancelledProposal.feedback?.outcome, 'cancelled');
  assert.equal(cancelledProposal.feedback?.requestId, cancelStart.requestId);

  // 7. Kickoff report shared proposal path: clarification feedback works identically
  const reportClarifyOp = randomUUID();
  const reportClarifyText = '该调整涉及证据缺口，请改选「证据缺口」块或说明是否仅改时间视野。';
  provider.setResponder(() => ({text: reportClarifyText}));
  await req(`${base}/reports/1/revise-proposal?scopeKey=${encodeURIComponent(scopeKey)}`, 'POST', {operationId: reportClarifyOp, blockId: 'horizon', request: '补充自然复购缺口。'}, 202);
  const reportClarify = await waitProposal(reportClarifyOp);
  assert.equal(reportClarify.status, 'ended');
  assert.equal(reportClarify.feedback?.replyText, reportClarifyText);
  assert.equal((await req(`${base}/reports?scopeKey=${encodeURIComponent(scopeKey)}`)).versions.length, 1, 'kickoff report untouched');
});

test('I131-C-Rework-2 真实 Host+Pi：普通主会话或非绑定请求不得接管 pending proposal（开题与候选共用）', {timeout: 180_000}, async t => {
  const provider = await startToolProvider(), host = await startTestHost();
  t.after(async () => { await host.close(); await provider.close(); });
  const req = async (route: string, method = 'GET', body?: unknown, status = 200): Promise<any> => {
    const r = await host.request(route, method, body);
    assert.equal(r.status, status, await r.clone().text());
    return r.json();
  };
  await req('/api/configuration', 'PUT', {name: '绑定守卫合成', provider: 'openai-compatible', baseUrl: provider.baseUrl, model: 'synthetic-proposal-bind', apiKey: 'synthetic-proposal-bind'});
  const initiativeId = randomUUID();
  await req('/api/strategy/initiatives', 'POST', {operationId: initiativeId, title: '绑定守卫事项', scopes: [stores]}, 201);
  const base = `/api/strategy/initiatives/${initiativeId}`;
  const report = (await req(`${base}/reports`, 'POST', {operationId: randomUUID(), fields: kickoffFields, sources: []}, 201)).version;
  await req(`${base}/reports/1/lock`, 'POST', {operationId: randomUUID(), sha256: report.contentSha256});
  await req(`${base}/reports/1/apply`, 'POST', {operationId: randomUUID(), sha256: report.contentSha256, scope: stores});

  provider.setResponder((ctx: any) => ctx.recentToolResults.length
    ? {text: '候选已保存。'}
    : {calls: [{name: 'strategy_goals', arguments: {action: 'initiative-save-candidate', operationId: randomUUID(), candidateBlocks}}]});
  const created = await req(`${base}/candidates`, 'POST', {operationId: randomUUID(), scope: stores, title: '方案一', instruction: '形成方案。'}, 202);
  const cid = created.candidate.candidateId;
  for (let n = 0; n < 500; n++) {
    const d = await req(`${base}/candidates/${cid}/versions/1`);
    if (d.candidate.lastRun?.status === 'completed') break;
    await delay(20);
  }

  // 1. Start a normal main-session request and hold it running
  const session = (await req(`${base}/session`, 'POST', {operationId: randomUUID(), scope: stores}, 201)).session;
  const beforeHold = provider.requests.length;
  provider.setResponder(() => ({text: '阻塞中', hold: true}));
  const req1Id = randomUUID();
  await req(`${base}/messages?scopeKey=${encodeURIComponent(scopeKey)}`, 'POST', {requestId: req1Id, text: '先聊聊整体思路。', expectedRevision: session.revision}, 202);
  await provider.waitForRequests(beforeHold + 1);

  // 2. While busy, create candidate proposal P -> returns 409 busy, leaving P pending
  const orphanCandPropId = randomUUID();
  const busyRes = await req(`${base}/candidates/${cid}/versions/1/revise-proposal`, 'POST', {operationId: orphanCandPropId, blockId: 'budget', request: '预算改为 60 万。'}, 409);
  assert.ok(['strategy_initiative_pending_request', 'session_busy'].includes(busyRes.code));
  // Also create an orphaned kickoff report proposal while busy
  const orphanReportPropId = randomUUID();
  const busyReportRes = await req(`${base}/reports/1/revise-proposal?scopeKey=${encodeURIComponent(scopeKey)}`, 'POST', {operationId: orphanReportPropId, blockId: 'horizon', request: '调整时间视野。'}, 409);
  assert.ok(['strategy_initiative_pending_request', 'session_busy'].includes(busyReportRes.code));

  // 3. Stop the first normal main-session request and wait for settlement
  await req(`${base}/stop?scopeKey=${encodeURIComponent(scopeKey)}`, 'POST', {expectedRequestId: req1Id});
  let settledSession: any;
  for (let n = 0; n < 500; n++) {
    const d = await req(`${base}/session?scopeKey=${encodeURIComponent(scopeKey)}`);
    if (!d.busy && d.session.lastRun?.status !== 'accepted') { settledSession = d.session; break; }
    await delay(20);
  }
  assert.ok(settledSession);

  // 4. Start a SECOND normal main-session request (no proposal) where model tries to hijack both orphan proposals
  const hijackErrors: string[] = [];
  provider.setResponder((ctx: any) => {
    const step = ctx.recentToolResults.length;
    if (step === 0) return {calls: [{name: 'strategy_goals', arguments: {action: 'initiative-propose-revision', proposalId: orphanCandPropId, newText: '普通请求非法篡改候选预算。'}}]};
    if (step === 1) {
      hijackErrors.push(providerMessageText(ctx.recentToolResults[0]?.content));
      return {calls: [{name: 'strategy_goals', arguments: {action: 'initiative-propose-revision', proposalId: orphanReportPropId, newText: '普通请求非法篡改开题视野。'}}]};
    }
    hijackErrors.push(providerMessageText(ctx.recentToolResults[1]?.content));
    return {text: '工具均拒绝了未绑定拟改。'};
  });
  const req2Id = randomUUID();
  await req(`${base}/messages?scopeKey=${encodeURIComponent(scopeKey)}`, 'POST', {
    requestId: req2Id, text: '继续普通讨论，不拟改。', expectedRevision: settledSession.revision,
    ...(settledSession.pendingInput ? {replacePendingRequestId: settledSession.pendingInput.requestId} : {}),
  }, 202);
  for (let n = 0; n < 500; n++) {
    const d = await req(`${base}/session?scopeKey=${encodeURIComponent(scopeKey)}`);
    if (d.session.lastRun?.id === req2Id && d.session.lastRun.status !== 'accepted') break;
    await delay(20);
  }
  assert.equal(hijackErrors.length, 2);
  assert.match(hijackErrors[0]!, /strategy_proposal_unavailable/);
  assert.match(hijackErrors[1]!, /strategy_proposal_unavailable/);

  const candPropAfter = (await req(`${base}/proposals?proposalId=${orphanCandPropId}&scopeKey=${encodeURIComponent(scopeKey)}`)).proposal;
  assert.equal(candPropAfter.status, 'pending', 'normal request must not mutate candidate pending proposal');
  assert.equal(candPropAfter.newText, undefined);
  assert.equal(candPropAfter.requestId, undefined);
  const reportPropAfter = (await req(`${base}/proposals?proposalId=${orphanReportPropId}&scopeKey=${encodeURIComponent(scopeKey)}`)).proposal;
  assert.equal(reportPropAfter.status, 'pending', 'normal request must not mutate report pending proposal');
  assert.equal(reportPropAfter.newText, undefined);
  assert.equal(reportPropAfter.requestId, undefined);

  // 5. Start a DIFFERENT proposal P2 and verify model cannot hijack orphanCandPropId from P2's bound run
  const boundPropId = randomUUID();
  let wrongPropError = '';
  provider.setResponder((ctx: any) => {
    const step = ctx.recentToolResults.length;
    if (step === 0) return {calls: [{name: 'strategy_goals', arguments: {action: 'initiative-propose-revision', proposalId: orphanCandPropId, newText: '跨提案劫持。'}}]};
    if (step === 1) {
      wrongPropError = providerMessageText(ctx.recentToolResults[0]?.content);
      return {calls: [{name: 'strategy_goals', arguments: {action: 'initiative-propose-revision', proposalId: boundPropId, newText: '合法绑定提案的修改。'}}]};
    }
    return {text: '仅合法绑定提案已提交。'};
  });
  await req(`${base}/candidates/${cid}/versions/1/revise-proposal`, 'POST', {operationId: boundPropId, blockId: 'budget', request: '仅合法提案修改预算。'}, 202);
  let boundSettled: any;
  for (let n = 0; n < 500; n++) {
    const p = (await req(`${base}/proposals?proposalId=${boundPropId}&scopeKey=${encodeURIComponent(scopeKey)}`)).proposal;
    if (p.status !== 'pending') { boundSettled = p; break; }
    await delay(20);
  }
  assert.match(wrongPropError, /strategy_proposal_unavailable/);
  assert.equal(boundSettled.status, 'proposed');
  assert.equal((await req(`${base}/proposals?proposalId=${orphanCandPropId}&scopeKey=${encodeURIComponent(scopeKey)}`)).proposal.status, 'pending');
});

test('I131-C-Rework-4 真实 Host+Pi：目标块变化后，旧基线 proposal 在派发、工具提交与采纳边界均被拒绝', {timeout: 180_000}, async t => {
  const provider = await startToolProvider(), host = await startTestHost();
  t.after(async () => { await host.close(); await provider.close(); });
  const req = async (route: string, method = 'GET', body?: unknown, status = 200): Promise<any> => {
    const r = await host.request(route, method, body);
    assert.equal(r.status, status, await r.clone().text());
    return r.json();
  };
  await req('/api/configuration', 'PUT', {name: '基线守卫合成', provider: 'openai-compatible', baseUrl: provider.baseUrl, model: 'synthetic-baseline-guard', apiKey: 'synthetic-baseline-guard'});
  const initiativeId = randomUUID();
  await req('/api/strategy/initiatives', 'POST', {operationId: initiativeId, title: '基线守卫事项', scopes: [stores]}, 201);
  const base = `/api/strategy/initiatives/${initiativeId}`;
  const report = (await req(`${base}/reports`, 'POST', {operationId: randomUUID(), fields: kickoffFields, sources: []}, 201)).version;
  await req(`${base}/reports/1/lock`, 'POST', {operationId: randomUUID(), sha256: report.contentSha256});
  await req(`${base}/reports/1/apply`, 'POST', {operationId: randomUUID(), sha256: report.contentSha256, scope: stores});

  const settleCand = async (cid: string, no: number) => {
    for (let n = 0; n < 500; n++) {
      const d = await req(`${base}/candidates/${cid}/versions/${no}`);
      if (d.candidate.lastRun?.status && d.candidate.lastRun.status !== 'accepted') return d.candidate;
      await delay(20);
    }
    throw new Error('candidate did not settle');
  };
  const waitProposal = async (proposalId: string) => {
    for (let n = 0; n < 500; n++) {
      const p = (await req(`${base}/proposals?proposalId=${proposalId}&scopeKey=${encodeURIComponent(scopeKey)}`)).proposal;
      if (p.status !== 'pending') return p;
      await delay(20);
    }
    throw new Error('proposal did not settle');
  };

  // Initial candidate v1 with budget 200000
  const blocks200k = [
    {id: 'positioning', label: '定位与增长', text: '聚焦华东成熟门店。'},
    {id: 'budget', label: '预算与资源', text: '2027 试点预算 200000 元。'},
  ];
  provider.setResponder((ctx: any) => ctx.recentToolResults.length
    ? {text: '初始候选已保存。'}
    : {calls: [{name: 'strategy_goals', arguments: {action: 'initiative-save-candidate', operationId: randomUUID(), candidateBlocks: blocks200k}}]});
  const created = await req(`${base}/candidates`, 'POST', {operationId: randomUUID(), scope: stores, title: '方案一', instruction: '形成方案。'}, 202);
  const cid = created.candidate.candidateId;
  let v1 = await settleCand(cid, 1);

  // Case A: Proposal P1 proposed on 200000 -> candidate session updates v1 to 500000 -> adopt with refreshed CAS must REJECT
  const p1Id = randomUUID();
  provider.setResponder((ctx: any) => ctx.recentToolResults.length
    ? {text: '已拟改为 300000。'}
    : {calls: [{name: 'strategy_goals', arguments: {action: 'initiative-propose-revision', proposalId: p1Id, newText: '2027 试点预算 300000 元。'}}]});
  await req(`${base}/candidates/${cid}/versions/1/revise-proposal`, 'POST', {operationId: p1Id, blockId: 'budget', request: '预算改为 300000。'}, 202);
  const p1 = await waitProposal(p1Id);
  assert.equal(p1.status, 'proposed');
  assert.equal(p1.baselineSha256, textSha(blocks200k[1]!.text));

  const blocks500k = [blocks200k[0]!, {id: 'budget', label: '预算与资源', text: '2027 试点预算 500000 元。'}];
  provider.setResponder((ctx: any) => ctx.recentToolResults.length
    ? {text: '已更新为 500000。'}
    : {calls: [{name: 'strategy_goals', arguments: {action: 'initiative-save-candidate', operationId: randomUUID(), candidateBlocks: blocks500k}}]});
  await req(`${base}/candidates/${cid}/versions/1/messages`, 'POST', {requestId: randomUUID(), text: '将预算改为 500000 元。', expectedRevision: v1.revision}, 202);
  v1 = await settleCand(cid, 1);
  assert.equal(v1.blocks[1].text, '2027 试点预算 500000 元。');

  const staleAdopt = await req(`${base}/candidates/${cid}/versions/1/revise`, 'POST', {
    operationId: randomUUID(), baseSha256: v1.contentSha256, request: '预算改为 300000。',
    patches: [{blockId: 'budget', expectedOldSha256: textSha(v1.blocks[1].text), newText: '2027 试点预算 300000 元。'}],
    proposalId: p1Id,
  }, 409);
  assert.equal(staleAdopt.code, 'strategy_proposal_baseline_changed');
  assert.equal((await req(`${base}/candidates?scopeKey=${encodeURIComponent(scopeKey)}`)).candidates.length, 1, 'stale adopt creates zero new versions');
  assert.equal((await req(`${base}/candidates/${cid}/versions/1`)).candidate.blocks[1].text, '2027 试点预算 500000 元。', 'v1 500000 preserved');
  assert.equal((await req(`${base}/proposals?proposalId=${p1Id}&scopeKey=${encodeURIComponent(scopeKey)}`)).proposal.status, 'proposed');

  // Case B: Mid-run change before tool submit -> tool must REJECT with strategy_proposal_baseline_changed
  const p2Id = randomUUID();
  let midRunToolError = '';
  let releaseModel!: () => void;
  const holdPromise = new Promise<void>(resolve => { releaseModel = resolve; });
  let holdMainHit!: () => void;
  const mainHeld = new Promise<void>(resolve => { holdMainHit = resolve; });
  provider.setResponder(async (ctx: any) => {
    const userText = ctx.messages.filter((m: any) => m.role === 'user').map((m: any) => providerMessageText(m.content)).join('\n');
    if (userText.includes(p2Id)) {
      if (ctx.recentToolResults.length === 0) {
        holdMainHit();
        await holdPromise;
        return {calls: [{name: 'strategy_goals', arguments: {action: 'initiative-propose-revision', proposalId: p2Id, newText: '2027 试点预算 550000 元。'}}]};
      }
      midRunToolError = providerMessageText(ctx.recentToolResults[0]?.content);
      return {text: '基线已变，拒绝提交。'};
    }
    return ctx.recentToolResults.length
      ? {text: '候选已更新为 600000。'}
      : {calls: [{name: 'strategy_goals', arguments: {action: 'initiative-save-candidate', operationId: randomUUID(), candidateBlocks: [blocks200k[0]!, {id: 'budget', label: '预算与资源', text: '2027 试点预算 600000 元。'}]}}]};
  });
  await req(`${base}/candidates/${cid}/versions/1/revise-proposal`, 'POST', {operationId: p2Id, blockId: 'budget', request: '预算改为 550000。'}, 202);
  await mainHeld;
  // While proposal run is in flight, candidate session legally updates budget to 600000
  await req(`${base}/candidates/${cid}/versions/1/messages`, 'POST', {requestId: randomUUID(), text: '将预算改为 600000 元。', expectedRevision: v1.revision}, 202);
  v1 = await settleCand(cid, 1);
  assert.equal(v1.blocks[1].text, '2027 试点预算 600000 元。');
  // Now release the main proposal run so model calls initiative-propose-revision(p2Id)
  releaseModel();
  const p2 = await waitProposal(p2Id);
  assert.match(midRunToolError, /strategy_proposal_baseline_changed/);
  assert.equal(p2.status, 'ended', 'mid-run baseline change must prevent proposal from becoming proposed');
  assert.equal(p2.newText, undefined);

  // Case C: Created before busy rejection, then block changes before retry dispatch -> dispatch must REJECT 409 strategy_proposal_baseline_changed
  const mainSession = (await req(`${base}/session?scopeKey=${encodeURIComponent(scopeKey)}`)).session;
  const beforeHold2 = provider.requests.length;
  provider.setResponder(() => ({text: '阻塞', hold: true}));
  const holdReqId = randomUUID();
  await req(`${base}/messages?scopeKey=${encodeURIComponent(scopeKey)}`, 'POST', {requestId: holdReqId, text: '先占住主会话。', expectedRevision: mainSession.revision}, 202);
  await provider.waitForRequests(beforeHold2 + 1);
  const p3Id = randomUUID();
  await req(`${base}/candidates/${cid}/versions/1/revise-proposal`, 'POST', {operationId: p3Id, blockId: 'budget', request: '预算改为 650000。'}, 409);
  await req(`${base}/stop?scopeKey=${encodeURIComponent(scopeKey)}`, 'POST', {expectedRequestId: holdReqId});
  for (let n = 0; n < 500; n++) {
    const d = await req(`${base}/session?scopeKey=${encodeURIComponent(scopeKey)}`);
    if (!d.busy && d.session.lastRun?.status !== 'accepted') break;
    await delay(20);
  }
  // Candidate session updates budget to 700000 before P3 is dispatched
  provider.setResponder((ctx: any) => ctx.recentToolResults.length
    ? {text: '更新到 700000。'}
    : {calls: [{name: 'strategy_goals', arguments: {action: 'initiative-save-candidate', operationId: randomUUID(), candidateBlocks: [blocks200k[0]!, {id: 'budget', label: '预算与资源', text: '2027 试点预算 700000 元。'}]}}]}
  );
  await req(`${base}/candidates/${cid}/versions/1/messages`, 'POST', {requestId: randomUUID(), text: '将预算改为 700000 元。', expectedRevision: v1.revision}, 202);
  v1 = await settleCand(cid, 1);
  const providerCountBeforeDispatch = provider.requests.length;
  const staleDispatch = await req(`${base}/candidates/${cid}/versions/1/revise-proposal`, 'POST', {operationId: p3Id, blockId: 'budget', request: '预算改为 650000。'}, 409);
  assert.equal(staleDispatch.code, 'strategy_proposal_baseline_changed');
  assert.equal(provider.requests.length, providerCountBeforeDispatch, 'stale baseline must reject before invoking provider');
});

