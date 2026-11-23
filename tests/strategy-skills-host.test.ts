import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {startTestHost} from './fixtures/host-process.ts';
import {startToolProvider, providerMessageText} from './fixtures/tool-provider.ts';

const stores = {kind: 'department' as const, id: 'east-retail', name: '华东零售事业部', enterpriseId: 'ent-1'};
const scopeKey = 'department:ent-1:east-retail';
const fields = {horizon: '2027–2029', diagnosis: '缺口。', propositions: [{id: 'P1', question: 'q1', whyItMatters: 'w1'}, {id: 'P2', question: 'q2', whyItMatters: 'w2'}, {id: 'P3', question: 'q3', whyItMatters: 'w3'}], assumptions: '', evidenceGaps: '', followUp: ''};
const blocks = [{id: 'B1', label: '定位', text: '深耕门店。'}];

test('真实 Host+Pi：战略主会话仅加载 deep-research 与 grill-me，其他会话边界不变', {timeout: 150_000}, async t => {
  const provider = await startToolProvider(), host = await startTestHost();
  t.after(async () => { await host.close(); await provider.close(); });
  const req = async (route: string, method = 'GET', body?: unknown, status = 200): Promise<any> => {
    const r = await host.request(route, method, body);
    assert.equal(r.status, status, await r.clone().text());
    return r.json();
  };
  await req('/api/configuration', 'PUT', {name: '技能合成', provider: 'openai-compatible', baseUrl: provider.baseUrl, model: 'synthetic-skills', apiKey: 'synthetic-skills'});
  const initiativeId = randomUUID();
  await req('/api/strategy/initiatives', 'POST', {operationId: initiativeId, title: '技能事项', scopes: [stores]}, 201);
  const base = `/api/strategy/initiatives/${initiativeId}`;
  await req(`${base}/session`, 'POST', {operationId: randomUUID(), scope: stores}, 201);
  let systemText = '';
  let grillContent = '';
  let researchContent = '';
  provider.setResponder((ctx: any) => {
    if (!systemText) systemText = ctx.messages.filter((m: any) => m.role === 'system' || m.role === 'developer').map((m: any) => providerMessageText(m.content)).join('\n');
    const step = ctx.recentToolResults.length;
    if (step === 0) return {calls: [{name: 'strategy_goals', arguments: {action: 'initiative-read-skill', skill: 'grill-me'}}]};
    if (step === 1) { grillContent = providerMessageText(ctx.recentToolResults[0].content); return {calls: [{name: 'strategy_goals', arguments: {action: 'initiative-read-skill', skill: 'deep-research'}}]}; }
    if (step === 2) { researchContent = providerMessageText(ctx.recentToolResults[1].content); return {text: '追问：试点边界是否包含加盟门店？推荐先限定直营成熟店，依据是工时可控。'}; }
    return {text: '追问继续。'};
  });
  await req(`${base}/messages?scopeKey=${encodeURIComponent(scopeKey)}`, 'POST', {requestId: randomUUID(), text: '请帮我开题。', expectedRevision: 1}, 202);
  let d: any;
  for (let n = 0; n < 500; n++) { d = await req(`${base}/session?scopeKey=${encodeURIComponent(scopeKey)}`); if (d.session.lastRun?.status === 'completed') break; await delay(20); }
  assert.equal(d.session.lastRun.status, 'completed');
  assert.equal(d.snapshot.capabilities.skills, true, 'initiative main session exposes skills');
  assert.match(systemText, /grill-me/, 'grill-me is actually loaded');
  assert.match(systemText, /deep-research/, 'deep-research is actually loaded');
  assert.doesNotMatch(systemText, /data-analysis|ppt-report|roi-forecast/, 'only the two designated assets load');
  assert.match(grillContent, /Interview me relentlessly/, 'grill-me upstream method is actually read through the narrow tool');
  assert.match(grillContent, /OptraCall 战略开题适配/, 'local adaptation is present');
  assert.match(researchContent, /深度研究与研究报告/, 'deep-research package is actually read');

  const report = (await req(`${base}/reports`, 'POST', {operationId: randomUUID(), fields, sources: []}, 201)).version;
  await req(`${base}/reports/1/lock`, 'POST', {operationId: randomUUID(), sha256: report.contentSha256});
  await req(`${base}/reports/1/apply`, 'POST', {operationId: randomUUID(), sha256: report.contentSha256, scope: stores});
  provider.setResponder((ctx: any) => ctx.recentToolResults.length
    ? {text: '候选已保存。'}
    : {calls: [{name: 'strategy_goals', arguments: {action: 'initiative-save-candidate', operationId: randomUUID(), candidateBlocks: blocks}}]});
  const created = await req(`${base}/candidates`, 'POST', {operationId: randomUUID(), scope: stores, title: '边界候选', instruction: '形成方案。'}, 202);
  const cid = created.candidate.candidateId;
  let cd: any;
  for (let n = 0; n < 500; n++) { cd = await req(`${base}/candidates/${cid}/versions/1`); if (cd.candidate.lastRun?.status === 'completed') break; await delay(20); }
  assert.equal(cd.snapshot.capabilities.skills, false, 'candidate session keeps the fixed-input boundary');

  const legacyId = randomUUID();
  await req('/api/strategy/discussions', 'POST', {operationId: legacyId, title: '旧讨论边界'}, 201);
  provider.setResponder(() => ({text: '旧讨论回复。'}));
  await req(`/api/strategy/discussions/${legacyId}/messages`, 'POST', {requestId: randomUUID(), text: '旧讨论。', expectedRevision: 1}, 202);
  let ld: any;
  for (let n = 0; n < 500; n++) { ld = await req(`/api/strategy/discussions/${legacyId}`); if (!ld.busy && ld.discussion.lastRun?.status === 'completed') break; await delay(20); }
  assert.equal(ld.snapshot.capabilities.skills, false, 'legacy discussion keeps the fixed-input boundary');
  assert.deepEqual(provider.errors, []);
});