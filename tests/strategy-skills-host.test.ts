import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdir, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {startTestHost} from './fixtures/host-process.ts';
import {startToolProvider, providerMessageText} from './fixtures/tool-provider.ts';

const stores = {kind: 'department' as const, id: 'east-retail', name: '华东零售事业部', enterpriseId: 'ent-1'};
const scopeKey = 'department:ent-1:east-retail';
const fields = {horizon: '2027–2029', diagnosis: '缺口。', propositions: [{id: 'P1', question: 'q1', whyItMatters: 'w1'}, {id: 'P2', question: 'q2', whyItMatters: 'w2'}, {id: 'P3', question: 'q3', whyItMatters: 'w3'}], assumptions: '', evidenceGaps: '', followUp: ''};
const blocks = [{id: 'B1', label: '定位', text: '深耕门店。'}];

test('真实 Host+Pi：战略主会话仅加载 deep-research 与 grill-me，其他会话边界不变', {timeout: 150_000}, async t => {
  const provider = await startToolProvider();
  t.after(() => provider.close());
  const host = await startTestHost();
  t.after(() => host.close());
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
  const localSkill = join(host.dataRoot, 'strategy-initiatives', initiativeId, 'resources', 'skills', 'deep-research');
  await mkdir(localSkill, {recursive: true});
  await writeFile(join(localSkill, 'SKILL.md'), '---\nname: deep-research\ndescription: Synthetic local name collision\n---\nUnapproved local asset.\n');
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
  t.diagnostic(JSON.stringify(d.session.lastRun)); t.diagnostic(JSON.stringify(provider.errors)); assert.equal(d.session.lastRun.status, 'completed');
  assert.deepEqual(d.snapshot.capabilities.strategySkills, ['deep-research', 'grill-me'], 'Pi loads both bundled assets despite a same-name local skill');
  assert.equal(d.snapshot.capabilities.skills, true, 'initiative main session exposes skills');
  assert.match(systemText, /grill-me/, 'the strategy prompt explains when to use the interview skill');
  assert.match(systemText, /deep-research/, 'the strategy prompt explains when to use the research skill');
  assert.doesNotMatch(systemText, /data-analysis|ppt-report|roi-forecast|Synthetic local name collision/);
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
test('真实 Host+Pi：普通项目任务不加载 grill-me，包内获准资料与越界负例', {timeout: 150_000}, async t => {
  const provider = await startToolProvider();
  t.after(() => provider.close());
  const host = await startTestHost();
  t.after(() => host.close());
  const req = async (route: string, method = 'GET', body?: unknown, status = 200): Promise<any> => {
    const r = await host.request(route, method, body);
    assert.equal(r.status, status, await r.clone().text());
    return r.json();
  };
  await req('/api/configuration', 'PUT', {name: '技能边界', provider: 'openai-compatible', baseUrl: provider.baseUrl, model: 'synthetic-skill-boundary', apiKey: 'synthetic-skill-boundary'});
  const goal = (await req('/api/strategy/goals', 'POST', {operationId: randomUUID(), title: '边界目标', outcome: '普通分析', perspective: 'personal', scope: {kind: 'personal', id: 'self', name: '个人工作'}, measurement: {kind: 'deliverable', criterion: '普通资料分析'}, baseline: {state: 'pending', description: '待补'}, responsible: '本人'}, 201)).goal;
  await req(`/api/strategy/goals/${goal.goalId}/adopt`, 'POST', {version: 1, expectedVersion: 1, operationId: randomUUID(), decision: '明确采用'});
  const {project} = await req('/api/projects', 'POST', {name: '普通项目任务'}, 201);
  const plan = {request: '沿普通分析继续', premises: [], materials: [], coverage: [], tasks: [{key: 'analysis', name: '普通资料分析', selected: true, scope: '普通资料分析', capabilities: []}], taskMode: 'single', summaryTaskKey: 'analysis', dependencies: [], caseContext: null, goalContext: {goal: {goalId: goal.goalId, version: 1}, purpose: 'assigned-work'}};
  await req(`/api/projects/${project.id}/plan/draft`, 'POST', {operationId: randomUUID(), expectedRevision: 0, plan});
  const currentPlan = await req(`/api/projects/${project.id}/plan`);
  let systemText = '';
  provider.setResponder((ctx: any) => {
    if (!systemText) systemText = ctx.messages.filter((m: any) => m.role === 'system' || m.role === 'developer').map((m: any) => providerMessageText(m.content)).join('\n');
    return {text: '普通分析结果。'};
  });
  const confirmed = await req(`/api/projects/${project.id}/plan/confirm`, 'POST', {operationId: randomUUID(), expectedRevision: currentPlan.revision, mode: 'start'});
  await provider.waitForRequests(1);
  assert.doesNotMatch(systemText, /grill-me|Interview me relentlessly/, 'ordinary project task never loads the strategy-only skill');

  const initiativeId = randomUUID();
  await req('/api/strategy/initiatives', 'POST', {operationId: initiativeId, title: '包内资料事项', scopes: [stores]}, 201);
  const base = `/api/strategy/initiatives/${initiativeId}`;
  await req(`${base}/session`, 'POST', {operationId: randomUUID(), scope: stores}, 201);
  let standards = '', denied = '';
  provider.setResponder((ctx: any) => {
    const step = ctx.recentToolResults.length;
    if (step === 0) return {calls: [{name: 'strategy_goals', arguments: {action: 'initiative-read-skill', skill: 'deep-research', path: 'references/source-standards.md'}}]};
    if (step === 1) { standards = providerMessageText(ctx.recentToolResults[0].content); return {calls: [{name: 'strategy_goals', arguments: {action: 'initiative-read-skill', skill: 'deep-research', path: '../secret.md'}}]}; }
    if (step === 2) { denied = providerMessageText(ctx.recentToolResults.at(-1)?.content); return {text: '已读取来源规范。'}; }
    return {text: '继续。'};
  });
  await req(`${base}/messages?scopeKey=${encodeURIComponent(scopeKey)}`, 'POST', {requestId: randomUUID(), text: '请读取来源规范。', expectedRevision: 1}, 202);
  let d: any;
  for (let n = 0; n < 500; n++) { d = await req(`${base}/session?scopeKey=${encodeURIComponent(scopeKey)}`); if (d.session.lastRun?.status === 'completed') break; await delay(20); }
  t.diagnostic(JSON.stringify(d.session.lastRun)); t.diagnostic(JSON.stringify(provider.errors)); assert.equal(d.session.lastRun.status, 'completed');
  assert.match(standards, /来源|引用/, 'package-internal approved references are readable');
  assert.match(denied, /strategy_skill_unavailable/, 'path traversal outside the package is rejected');
  assert.deepEqual(provider.errors, []);
});
