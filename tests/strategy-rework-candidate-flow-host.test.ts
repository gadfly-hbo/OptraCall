import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID, createHash} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {startTestHost} from './fixtures/host-process.ts';
import {startToolProvider, providerMessageText} from './fixtures/tool-provider.ts';

const stores = {kind: 'department' as const, id: 'east-retail', name: '华东零售事业部', enterpriseId: 'ent-1'};
const scopeKey = 'department:ent-1:east-retail';
const textSha = (text: string) => createHash('sha256').update(text).digest('hex');
const fields = {
  horizon: '2027–2029', diagnosis: '华东门店客流企稳，增长缺口集中在二次到店。',
  propositions: [{id: 'P1', question: 'q1', whyItMatters: 'w1'}, {id: 'P2', question: 'q2', whyItMatters: 'w2'}, {id: 'P3', question: 'q3', whyItMatters: 'w3'}],
  assumptions: '', evidenceGaps: '', followUp: '',
};
const blocksA = [{id: 'B1', label: '定位', text: '深耕现有门店，以分层回访带动二次到店。'}, {id: 'B2', label: '目标', text: '2027 试点。'}];
const blocksB = [{id: 'B1', label: '定位', text: '先改善陈列与排班，再推广有效做法。'}, {id: 'B2', label: '目标', text: '2027 基线核对。'}];

async function setup(req: any, provider: any, base: string) {
  const report = (await req(`${base}/reports`, 'POST', {operationId: randomUUID(), fields, sources: []}, 201)).version;
  await req(`${base}/reports/1/lock`, 'POST', {operationId: randomUUID(), sha256: report.contentSha256});
  await req(`${base}/reports/1/apply`, 'POST', {operationId: randomUUID(), sha256: report.contentSha256, scope: stores});
  const make = async (title: string, blocks: typeof blocksA) => {
    provider.setResponder((ctx: any) => ctx.recentToolResults.length
      ? {text: '候选已保存。'}
      : {calls: [{name: 'strategy_goals', arguments: {action: 'initiative-save-candidate', operationId: randomUUID(), candidateBlocks: blocks}}]});
    const created = await req(`${base}/candidates`, 'POST', {operationId: randomUUID(), scope: stores, title, instruction: '形成方案。'}, 202);
    const cid = created.candidate.candidateId;
    let d: any;
    for (let n = 0; n < 500; n++) { d = await req(`${base}/candidates/${cid}/versions/1`); if (d.candidate.lastRun?.status === 'completed') break; await delay(20); }
    return d.candidate;
  };
  const a = await make('会员复购优先', blocksA);
  const b = await make('门店效率优先', blocksB);
  return {report, a, b};
}

test('真实 Host+Pi：主会话比较携带准确候选正文并可读候选工具', {timeout: 150_000}, async t => {
  const provider = await startToolProvider(), host = await startTestHost();
  t.after(async () => { await host.close(); await provider.close(); });
  const req = async (route: string, method = 'GET', body?: unknown, status = 200): Promise<any> => {
    const r = await host.request(route, method, body);
    assert.equal(r.status, status, await r.clone().text());
    return r.json();
  };
  await req('/api/configuration', 'PUT', {name: '比较合成', provider: 'openai-compatible', baseUrl: provider.baseUrl, model: 'synthetic-compare', apiKey: 'synthetic-compare'});
  const initiativeId = randomUUID();
  await req('/api/strategy/initiatives', 'POST', {operationId: initiativeId, title: '比较事项', scopes: [stores]}, 201);
  const base = `/api/strategy/initiatives/${initiativeId}`;
  const {a} = await setup(req, provider, base);
  await req(`${base}/session`, 'POST', {operationId: randomUUID(), scope: stores}, 201);
  let captured = '';
  provider.setResponder((ctx: any) => {
    if (!ctx.recentToolResults.length) {
      captured = ctx.messages.filter((m: any) => m.role === 'user').map((m: any) => providerMessageText(m.content)).join('\n');
      return {calls: [{name: 'strategy_goals', arguments: {action: 'initiative-read-candidate', candidateId: a.candidateId, no: 1}}]};
    }
    const toolText = providerMessageText(ctx.recentToolResults.at(-1)?.content);
    assert.match(toolText, /分层回访/, 'read-candidate returns the exact candidate body');
    return {text: '两个方向使用同一开题基线；预算固定时以三店对照判断取舍。'};
  });
  await req(`${base}/messages?scopeKey=${encodeURIComponent(scopeKey)}`, 'POST', {requestId: randomUUID(), text: '比较两个候选方向。', expectedRevision: 1}, 202);
  let d: any;
  for (let n = 0; n < 500; n++) { d = await req(`${base}/session?scopeKey=${encodeURIComponent(scopeKey)}`); if (d.session.lastRun?.status === 'completed') break; await delay(20); }
  assert.equal(d.session.lastRun.status, 'completed');
  assert.match(captured, /会员复购优先/);
  assert.match(captured, /门店效率优先/);
  assert.match(captured, /分层回访/, 'comparison prompt carries exact candidate A body');
  assert.match(captured, /先改善陈列与排班/, 'comparison prompt carries exact candidate B body');
  assert.match(captured, new RegExp(a.contentSha256), 'comparison prompt carries exact candidate identity');
  assert.deepEqual(provider.errors, []);
});

test('真实 Host+Pi：对话式限定修改（意图→Agent 拟改→核对采纳）与精确重放负例', {timeout: 180_000}, async t => {
  const provider = await startToolProvider(), host = await startTestHost();
  t.after(async () => { await host.close(); await provider.close(); });
  const req = async (route: string, method = 'GET', body?: unknown, status = 200): Promise<any> => {
    const r = await host.request(route, method, body);
    assert.equal(r.status, status, await r.clone().text());
    return r.json();
  };
  await req('/api/configuration', 'PUT', {name: '拟改合成', provider: 'openai-compatible', baseUrl: provider.baseUrl, model: 'synthetic-propose', apiKey: 'synthetic-propose'});
  const initiativeId = randomUUID();
  await req('/api/strategy/initiatives', 'POST', {operationId: initiativeId, title: '拟改事项', scopes: [stores]}, 201);
  const base = `/api/strategy/initiatives/${initiativeId}`;
  const {report, a} = await setup(req, provider, base);

  const newDiagnosis = '华东门店客流企稳，增长缺口集中在二次到店与导购触达。';
  const reportProposalOp = randomUUID();
  provider.setResponder((ctx: any) => ctx.recentToolResults.length
    ? {text: '拟改已提交，请核对。'}
    : {calls: [{name: 'strategy_goals', arguments: {action: 'initiative-propose-revision', proposalId: reportProposalOp, newText: newDiagnosis}}]});
  const started = await req(`${base}/reports/1/revise-proposal?scopeKey=${encodeURIComponent(scopeKey)}`, 'POST', {operationId: reportProposalOp, blockId: 'diagnosis', request: '把诊断补充导购触达。'}, 202);
  assert.equal(started.proposal.status, 'pending');
  let proposal: any;
  for (let n = 0; n < 500; n++) { proposal = (await req(`${base}/proposals?proposalId=${reportProposalOp}`)).proposal; if (proposal.status === 'proposed') break; await delay(20); }
  assert.equal(proposal.status, 'proposed');
  assert.equal(proposal.newText, newDiagnosis);
  assert.equal(proposal.blockId, 'diagnosis');
  const v2 = (await req(`${base}/reports/1/revise`, 'POST', {operationId: randomUUID(), baseSha256: report.contentSha256, request: '把诊断补充导购触达。', patches: [{blockId: 'diagnosis', expectedOldSha256: textSha(fields.diagnosis), newText: newDiagnosis}], proposalId: reportProposalOp}, 201)).version;
  assert.equal(v2.no, 2);
  assert.equal(v2.fields.diagnosis, newDiagnosis);
  assert.equal((await req(`${base}/proposals?proposalId=${reportProposalOp}`)).proposal.status, 'adopted');
  assert.equal((await req(`${base}/reports/1/revise`, 'POST', {operationId: randomUUID(), baseSha256: report.contentSha256, request: 'x', patches: [{blockId: 'diagnosis', expectedOldSha256: textSha(fields.diagnosis), newText: '别的文本'}], proposalId: reportProposalOp}, 409)).code, 'strategy_proposal_unavailable');

  const newBlock = '深耕现有门店，以分层回访带动二次到店；先验证成熟店。';
  const candProposalOp = randomUUID();
  provider.setResponder((ctx: any) => ctx.recentToolResults.length
    ? {text: '拟改已提交，请核对。'}
    : {calls: [{name: 'strategy_goals', arguments: {action: 'initiative-propose-revision', proposalId: candProposalOp, newText: newBlock}}]});
  await req(`${base}/candidates/${a.candidateId}/versions/1/revise-proposal`, 'POST', {operationId: candProposalOp, blockId: 'B1', request: '定位补充成熟店验证。'}, 202);
  let candProposal: any;
  for (let n = 0; n < 500; n++) { candProposal = (await req(`${base}/proposals?proposalId=${candProposalOp}`)).proposal; if (candProposal.status === 'proposed') break; await delay(20); }
  assert.equal(candProposal.status, 'proposed');
  const reviseInput = {operationId: randomUUID(), baseSha256: a.contentSha256, request: '定位补充成熟店验证。', patches: [{blockId: 'B1', expectedOldSha256: textSha(blocksA[0].text), newText: newBlock}], proposalId: candProposalOp};
  const cv2 = (await req(`${base}/candidates/${a.candidateId}/versions/1/revise`, 'POST', reviseInput, 201)).candidate;
  assert.equal(cv2.no, 2);
  assert.equal(cv2.blocks[0].text, newBlock);
  assert.equal(cv2.blocks[1].text, blocksA[1].text);
  assert.equal(cv2.sessionFile, undefined, 'revision version gets its own session on first message');
  const replayConflict = await req(`${base}/candidates/${a.candidateId}/versions/1/revise`, 'POST', {...reviseInput, patches: [{...reviseInput.patches[0], newText: '不同文本'}]}, 409);
  assert.equal(replayConflict.code, 'strategy_candidate_operation_conflict');
  assert.deepEqual((await req(`${base}/candidates/${a.candidateId}/versions/1/revise`, 'POST', reviseInput, 201)).candidate, cv2);
  assert.deepEqual(provider.errors, []);
});
test('真实 Host+Pi：拟改本轮未提出补丁落终态，连续拟改不被 pending 误拒', {timeout: 150_000}, async t => {
  const provider = await startToolProvider(), host = await startTestHost();
  t.after(async () => { await host.close(); await provider.close(); });
  const req = async (route: string, method = 'GET', body?: unknown, status = 200): Promise<any> => {
    const r = await host.request(route, method, body);
    assert.equal(r.status, status, await r.clone().text());
    return r.json();
  };
  await req('/api/configuration', 'PUT', {name: '拟改终态', provider: 'openai-compatible', baseUrl: provider.baseUrl, model: 'synthetic-propose-end', apiKey: 'synthetic-propose-end'});
  const initiativeId = randomUUID();
  await req('/api/strategy/initiatives', 'POST', {operationId: initiativeId, title: '拟改终态事项', scopes: [stores]}, 201);
  const base = `/api/strategy/initiatives/${initiativeId}`;
  const {report, a} = await setup(req, provider, base);

  provider.setResponder(() => ({text: '本轮没有提出补丁。'}));
  const endedOp = randomUUID();
  await req(`${base}/reports/1/revise-proposal?scopeKey=${encodeURIComponent(scopeKey)}`, 'POST', {operationId: endedOp, blockId: 'diagnosis', request: '请拟改。'}, 202);
  let ended: any;
  for (let n = 0; n < 500; n++) { ended = (await req(`${base}/proposals?proposalId=${endedOp}`)).proposal; if (ended.status !== 'pending') break; await delay(20); }
  assert.equal(ended.status, 'ended', 'turn ended without a patch reaches a terminal state');
  assert.equal(ended.newText, undefined);

  const op1 = randomUUID();
  provider.setResponder((ctx: any) => ctx.recentToolResults.length
    ? {text: '拟改已提交。'}
    : {calls: [{name: 'strategy_goals', arguments: {action: 'initiative-propose-revision', proposalId: op1, newText: '第一次拟改文本。'}}]});
  await req(`${base}/reports/1/revise-proposal?scopeKey=${encodeURIComponent(scopeKey)}`, 'POST', {operationId: op1, blockId: 'diagnosis', request: '第一次拟改。'}, 202);
  let p1: any;
  for (let n = 0; n < 500; n++) { p1 = (await req(`${base}/proposals?proposalId=${op1}`)).proposal; if (p1.status === 'proposed') break; await delay(20); }
  assert.equal(p1.status, 'proposed');
  const op2 = randomUUID();
  provider.setResponder((ctx: any) => ctx.recentToolResults.length
    ? {text: '拟改已提交。'}
    : {calls: [{name: 'strategy_goals', arguments: {action: 'initiative-propose-revision', proposalId: op2, newText: '第二次拟改文本。'}}]});
  await req(`${base}/reports/1/revise-proposal?scopeKey=${encodeURIComponent(scopeKey)}`, 'POST', {operationId: op2, blockId: 'diagnosis', request: '紧接着第二次拟改。'}, 202);
  let p2: any;
  for (let n = 0; n < 500; n++) { p2 = (await req(`${base}/proposals?proposalId=${op2}`)).proposal; if (p2.status === 'proposed') break; await delay(20); }
  assert.equal(p2.status, 'proposed', 'consecutive proposal right after a saved patch is not blocked by pending');
  assert.notEqual(p2.newText, p1.newText);
  assert.deepEqual(provider.errors, []);
});
