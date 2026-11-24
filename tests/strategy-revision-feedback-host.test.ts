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
