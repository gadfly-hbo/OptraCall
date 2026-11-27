// Actual Chrome UI -> Host user carryover -> native Pi tools, with a local synthetic Provider.
// Run after build: STATIC_UI_ROOT=dist Node25 tests/browser-issue-148-carryover-recovery.mjs
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createHost } from '../src/host/server.ts';
import { makeNormalDraftPayload } from './fixtures/goal-decomposition-draft.ts';
import { startToolProvider, providerMessageText } from './fixtures/tool-provider.ts';

const evidence = '/workspace/issue148-pm-closeout/recovery';
const runName = process.env.RECOVERY_RUN_NAME || 'browser';
const root = path.join(evidence, `${runName}-${randomUUID()}`);
await mkdir(root, { recursive: true });
const provider = await startToolProvider();
const host = createHost({ cwd: process.cwd(), staticUiRoot: path.resolve(process.env.STATIC_UI_ROOT || 'dist'), uiPorts: [4173], transportVersion: 'issue148-carryover-recovery', dataRoot: path.join(root, 'data'), projectsRoot: path.join(root, 'projects') });
await host.ready;
await new Promise(resolve => host.server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${host.server.address().port}`;
const httpWrites = [];
const browserWrites = [];
host.server.on('request', (req) => { if (req.method === 'POST') httpWrites.push({ method: req.method, url: req.url }); });
async function api(route, method = 'GET', body) {
  const response = await fetch(base + route, { method, headers: { origin: base, 'content-type': 'application/json', 'x-optracall-client': '1' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const value = await response.json();
  assert.ok(response.ok, `${method} ${route}: ${response.status} ${JSON.stringify(value)}`);
  return value;
}
async function waitFor(read, label, timeout = 15000) {
  const deadline = Date.now() + timeout;
  let last;
  while (Date.now() < deadline) { last = await read(); if (last) return last; await new Promise(resolve => setTimeout(resolve, 80)); }
  assert.fail(`${label}; last=${JSON.stringify(last)}`);
}
class CdpPage {
  constructor(ws) { this.ws = ws; this.id = 0; this.pending = new Map(); ws.addEventListener('message', event => { const message = JSON.parse(String(event.data)); const pending = this.pending.get(message.id); if (pending) { this.pending.delete(message.id); if (message.error) pending.reject(new Error(message.error.message)); else pending.resolve(message.result); } }); }
  send(method, params = {}) { const id = ++this.id; return new Promise((resolve, reject) => { this.pending.set(id, { resolve, reject }); this.ws.send(JSON.stringify({ id, method, params })); }); }
  async eval(expression) { const result = await this.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); if (result.exceptionDetails) throw Error(JSON.stringify(result.exceptionDetails)); return result.result?.value; }
  async text() { return this.eval('document.body.innerText'); }
  async click(text) { assert.ok(await this.eval(`(() => { const button = [...document.querySelectorAll('button')].find(el => el.textContent.includes(${JSON.stringify(text)}) && !el.disabled && el.offsetParent !== null); if (!button) return false; button.click(); return true; })()`), `visible enabled button ${text}`); }
  async fill(selector, value, last = false) { assert.ok(await this.eval(`(() => { const elements = [...document.querySelectorAll(${JSON.stringify(selector)})].filter(el => el.offsetParent !== null); const input = elements[${last ? 'elements.length - 1' : '0'}]; if (!input || input.disabled) return false; Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, ${JSON.stringify(value)}); input.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`), `editable input ${selector}`); }
  async closeDialog() { assert.ok(await this.eval(`(() => { const close = document.querySelector('dialog[open] button[aria-label^="关闭"]'); if (!close) return false; close.click(); return true; })()`), 'dialog close control'); await waitFor(() => this.eval('!document.querySelector("dialog[open]")'), 'dialog closed'); }
  async capture(name, extra = {}) { const shot = await this.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true }); await writeFile(path.join(root, `${name}.png`), Buffer.from(shot.data, 'base64')); await writeFile(path.join(root, `${name}.json`), JSON.stringify({ text: await this.text(), storage: await this.eval('Object.fromEntries(Object.entries(sessionStorage))'), providerRequests: provider.requests, browserWrites, httpWrites, ...extra }, null, 2)); }
}
const chrome = spawn(process.env.CHROME_BIN || '/usr/bin/chromium', ['--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage', '--remote-debugging-port=0', `--user-data-dir=${path.join(root, 'chrome')}`, 'about:blank'], { stdio: ['ignore', 'pipe', 'pipe'] });
let debuggerUrl = '';
chrome.stderr.on('data', data => { const match = String(data).match(/DevTools listening on (ws:\/\/[^\s]+)/); if (match) debuggerUrl = match[1]; });
let page, ws;
const results = [];
let mode = 'success', heldResolve, scopeArgs;
const synthesis = [];
provider.setResponder(async context => {
  const text = providerMessageText(context.messages.filter(message => message.role === 'user').at(-1)?.content);
  if (mode === 'scope-suggestion') return context.recentToolResults.length ? { text: '范围差异须负责人核对，原输入未覆盖。' } : { calls: [{ name: 'strategy_goals', arguments: { action: 'goal-assess-actual', ...scopeArgs } }] };
  if (mode === 'failure') return { status: 400 };
  if (mode === 'no-save') return { text: '本轮无法形成可核对合并稿，请保留人工输入。' };
  if (['late', 'new-input'].includes(mode) && !context.recentToolResults.length) await new Promise(resolve => { heldResolve = resolve; });
  if (!context.recentToolResults.length) return { calls: [{ name: 'strategy_goals', arguments: { action: 'goal-read-context' } }] };
  if (context.recentToolResults.length > 1) return { text: '已保存可核对的合并草稿，尚未发布。' };
  const source = JSON.parse(providerMessageText(context.recentToolResults[0].content));
  const marker = '\n人工改动\n';
  assert.ok(text.includes(marker), 'actual UI merge request contains human changes');
  const edits = JSON.parse(text.slice(text.indexOf(marker) + marker.length));
  assert.ok(source.draft, 'Agent must read a real current draft after human carryover');
  const draft = structuredClone(source.draft);
  for (const change of edits.changes) {
    const keys = change.path.slice(1).split('/').map(key => key.replace(/~1/g, '/').replace(/~0/g, '~'));
    if (keys.length === 1 && Array.isArray(change.before) && Array.isArray(change.after) && change.before.length === 0) {
      // The human added entries to the empty current-version form. Preserve the carried old entries.
      draft[keys[0]].push(...change.after);
    } else {
      let target = draft; for (const key of keys.slice(0, -1)) target = target[key];
      if (change.after === undefined) delete target[keys.at(-1)]; else target[keys.at(-1)] = change.after;
    }
  }
  const payload = Object.fromEntries(['gsaPlanId', 'gsaPlanVersion', 'gsaPlanSha256', 'estimate', 'rows', 'reserves', 'gapStrategies', 'views', 'timePlan', 'notes'].map(key => [key, draft[key]]));
  payload.expectedDraftRevision = source.draft.revision;
  synthesis.push({ source, edits, payload });
  return { calls: [{ name: 'strategy_goals', arguments: { action: 'goal-save-decomposition-draft', ...payload } }] };
});
async function seed(label, upgrade = true) {
  const { goal } = await api('/api/strategy/goals', 'POST', { operationId: randomUUID(), title: label, outcome: '净销售额达到 120 万元', perspective: 'profit', scope: { kind: 'department', id: 'retail-dept', name: '零售事业部' }, measurement: { kind: 'deliverable', criterion: '净销售额' }, baseline: { state: 'known', description: '108万' }, responsible: '林负责人', strategies: ['新品陈列与会员回访'], dueAt: '2027-01-31', formalOrigin: { kind: 'manual-exception', reason: '合成恢复检查', period: '2027-01', targetValue: 120, unit: '万元', metricKind: 'amount' } });
  const route = `/api/strategy/goals/${goal.goalId}`;
  const { gsaPlan: oldPlan } = await api(`${route}/gsa-plan/confirm`, 'POST', { operationId: randomUUID(), expectedGoalVersion: 1, expectedAdoptedVersion: null, expectedPlanVersion: 0, plannedActions: [{ id: 'A1', summary: '新品陈列', checkpoint: '2027-01-31', observationBasis: 'POS' }], decision: '确认v1' });
  const oldPayload = makeNormalDraftPayload(oldPlan, { notes: `${label}-旧稿原件` });
  const { draft: oldDraft } = await api(`${route}/decomposition/draft`, 'POST', oldPayload);
  let plan = oldPlan;
  if (upgrade) ({ gsaPlan: plan } = await api(`${route}/gsa-plan/confirm`, 'POST', { operationId: randomUUID(), expectedGoalVersion: 1, expectedAdoptedVersion: 1, expectedPlanVersion: 1, goalRevision: { title: label, outcome: '净销售额达到150万元', perspective: 'profit', scope: { kind: 'department', id: 'retail-dept', name: '零售事业部' }, measurement: { kind: 'deliverable', criterion: '净销售额' }, baseline: { state: 'known', description: '108万' }, responsible: '林负责人', strategies: ['新品陈列与团购'], dueAt: '2027-01-31', formalOrigin: { kind: 'manual-exception', reason: '上调', period: '2027-01', targetValue: 150, unit: '万元', metricKind: 'amount' } }, plannedActions: [{ id: 'A1', summary: '新版新品陈列与团购', checkpoint: '2027-01-31', observationBasis: 'POS' }], decision: '确认v2', supersedesReason: '目标调整' }));
  return { goal, route, oldDraft, oldPayload, plan, version: upgrade ? 2 : 1, label };
}
async function openGoal(scenario) {
  await page.send('Page.navigate', { url: base });
  await waitFor(() => page.eval('document.readyState === "complete"'), 'document loaded');
  await waitFor(async () => (await page.text()).includes('目标管理'), 'app loaded');
  await page.click('目标管理');
  await waitFor(() => page.eval('Boolean(document.querySelector(".gm-workspace"))'), 'goal workspace');
  if (await page.eval('document.querySelector(".gm-workspace")?.dataset.goalId') !== scenario.goal.goalId) {
    await page.click('切换目标');
    await waitFor(async () => (await page.text()).includes(scenario.label), 'goal switcher entry');
    await page.click(scenario.label);
  }
  await waitFor(() => page.eval(`document.querySelector('.gm-workspace')?.dataset.goalId === ${JSON.stringify(scenario.goal.goalId)}`), 'exact goal selected');
  if (!scenario.published) await waitFor(async () => (await page.text()).includes('调整计划、预留与补缺'), 'editable draft visible');
}
async function addHumanReserve(purpose) {
  await page.click('调整计划、预留与补缺');
  await page.click('新增预留');
  await page.fill('dialog[open] input[placeholder="预留用途（必填）"]', purpose, true);
  await page.fill('dialog[open] input[placeholder="责任人（必填）"]', '本地负责人', true);
  await page.fill('dialog[open] input[placeholder="金额"]', '2', true);
  await page.closeDialog();
}
function mergeMessages(scenario) {
  return browserWrites.filter(write => {
    const url = new URL(write.url);
    if (url.pathname !== '/api/business-role' || url.searchParams.get('action') !== 'messages' || !write.body?.text?.includes('\n人工改动\n')) return false;
    const owner = JSON.parse(url.searchParams.get('owner'));
    return owner.goalId === scenario.goal.goalId && owner.version === scenario.version && owner.analysisVariant === 'goal-decomposition';
  });
}
async function mergeRequest(scenario) { return waitFor(() => mergeMessages(scenario).at(-1)?.body, 'exact UI merge request captured'); }
function roleDetailUrl(scenario, requestId) { return '/api/business-role?owner=' + encodeURIComponent(JSON.stringify({ role: 'goal', goalId: scenario.goal.goalId, version: scenario.version, analysisVariant: 'goal-decomposition' })) + '&requestId=' + encodeURIComponent(requestId); }
async function cache(scenario) { return page.eval(`JSON.parse(sessionStorage.getItem(${JSON.stringify(`optracall.goal.unsavedDraft.v1:${scenario.goal.goalId}:${scenario.version}`)}) || 'null')`); }
async function conflict(scenario, alreadyCurrent = false) {
  await openGoal(scenario);
  await page.click('核对测算依据');
  await page.fill('dialog[open] input[aria-label="同口径可达测算值"]', '119');
  await page.closeDialog();
  await addHumanReserve(`${scenario.label}-人工未保存`);
  if (alreadyCurrent) await api(`${scenario.route}/decomposition/draft`, 'POST', { ...makeNormalDraftPayload(scenario.plan, { expectedDraftRevision: 1, notes: `${scenario.label}-另一端最新` }), estimate: { ...scenario.oldDraft.estimate, formalTargetValue: 150, gapValue: 38 }, reviewedPreviousPlanVersion: 1 });
  await page.click('已核对，承接原拆解草稿');
  await waitFor(async () => (await page.text()).includes('请 Agent 合并保留的改稿'), 'merge recovery exit available');
  assert.ok((await cache(scenario)).reserves.some(reserve => reserve.purpose === `${scenario.label}-人工未保存`));
  await page.click('请 Agent 合并保留的改稿');
}
try {
  await api('/api/configuration', 'PUT', { name: '恢复合成模型', provider: 'openai-compatible', baseUrl: provider.baseUrl, model: 'synthetic-recovery', apiKey: 'synthetic-key' });
  await waitFor(() => debuggerUrl, 'Chromium debugging endpoint');
  const debugBase = debuggerUrl.replace(/^ws:/, 'http:').replace(/\/devtools\/browser\/.*$/, '');
  const targets = await (await fetch(`${debugBase}/json/list`)).json();
  ws = new WebSocket(targets.find(target => target.type === 'page').webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.addEventListener('open', resolve); ws.addEventListener('error', reject); });
  ws.addEventListener('message', event => { const message = JSON.parse(String(event.data)); if (message.method === 'Network.requestWillBeSent' && message.params.request.method === 'POST') browserWrites.push({ url: message.params.request.url, body: message.params.request.postData ? JSON.parse(message.params.request.postData) : undefined }); });
  page = new CdpPage(ws); await page.send('Page.enable'); await page.send('Runtime.enable'); await page.send('Network.enable');
  await page.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });

  for (const alreadyCurrent of [false, true]) {
    const scenario = await seed(alreadyCurrent ? 'R2另一端已承接' : 'R2旧稿冲突恢复');
    const requestsBefore = provider.requests.length;
    await conflict(scenario, alreadyCurrent);
    try {
      await waitFor(async () => { const value = await api(`${scenario.route}/workspace`); return value.draft?.gsaPlanVersion === 2 && value.draft.reserves.some(reserve => reserve.purpose === `${scenario.label}-人工未保存`) ? value : null; }, 'merge button must execute through real Host/Pi and save the human edits', 10000);
    } catch (error) { await page.capture('recovery-failure', { scenario, workspace: await api(`${scenario.route}/workspace`), requestsBefore }); throw error; }
    const latest = await api(`${scenario.route}/workspace`);
    assert.ok(provider.requests.length > requestsBefore, 'merge invokes actual synthetic Provider through native Pi');
    assert.equal(latest.draft.estimate.estimatedValue, 119, 'actual human estimate survives carryover and native Pi merge');
    assert.equal(latest.draft.estimate.formalTargetValue, 150, 'current formal target stays accurate');
    assert.equal(latest.draft.estimate.gapValue, 31, 'human estimate remains tied to current formal target 150');
    assert.equal(latest.draft.updatedBy, 'agent', 'actual native Pi tool saved the merged draft');
    assert.deepEqual(latest.draft.rows, scenario.oldDraft.rows, 'old rows survive recovery');
    const carries = browserWrites.filter(write => write.url.endsWith(`${scenario.route}/decomposition/draft`));
    assert.equal(carries.length, alreadyCurrent ? 0 : 1, 'only absent current draft requires the original human carryover route');
    if (!alreadyCurrent) { assert.equal(carries[0].body.reviewedPreviousPlanVersion, 1); assert.equal(carries[0].body.expectedDraftRevision, 1); assert.equal(carries[0].body.gsaPlanSha256, scenario.plan.contentSha256); assert.deepEqual(carries[0].body.rows, scenario.oldDraft.rows); }
    assert.ok(latest.draft.reserves.some(reserve => reserve.id === 'RES-01'), 'old reserve survives recovery');
    assert.equal(latest.draft.notes, alreadyCurrent ? `${scenario.label}-另一端最新` : scenario.oldDraft.notes);
    assert.equal(latest.publications.length, 0, 'recovery never publishes');
    assert.equal(latest.draft.gsaPlanSha256, scenario.plan.contentSha256);
    for (const key of ['gapStrategies', 'timePlan', 'views']) assert.deepEqual(latest.draft[key], scenario.oldDraft[key], `carried original ${key} remains intact`);
    await waitFor(() => page.eval(`document.querySelector('[aria-label="草稿保存状态"]')?.textContent === '已保存'`), 'UI must adopt the verified actual saved result');
    assert.equal(await cache(scenario), null, 'successful verified adoption clears only active unsaved cache');
    const backups = await page.eval(`({ local: sessionStorage.getItem(${JSON.stringify(`optracall.goal.unsavedDraft.v1:${scenario.goal.goalId}:${scenario.version}.conflict`)}), base: sessionStorage.getItem(${JSON.stringify(`optracall.goal.unsavedDraft.v1:${scenario.goal.goalId}:${scenario.version}.conflict.base`)}) })`);
    assert.ok(backups.local && backups.base, 'original local input and editing baseline backup survive verified merge');
    assert.equal(JSON.parse(backups.local).estimate.estimatedValue, 119, 'backup preserves exact human estimate');
    const originalRequest = await mergeRequest(scenario);
    const settled = await api(roleDetailUrl(scenario, originalRequest.requestId));
    assert.equal(settled.discussion.lastRun.id, originalRequest.requestId);
    assert.equal(settled.discussion.lastRun.status, 'completed');
    assert.equal(mergeMessages(scenario).length, 1, 'one explicit merge action sends one original request');
    await page.capture(alreadyCurrent ? 'already-current-pass' : 'carryover-pass', { workspace: latest });
    results.push({ scenario: scenario.label, result: 'PASS', revision: latest.draft.revision });
    console.log(`PASS ${scenario.label}: saved actual current draft r${latest.draft.revision}`);
  }

  for (const failureMode of ['failure', 'no-save', 'late']) {
    const scenario = await seed(`R2保全-${failureMode}`);
    mode = failureMode; heldResolve = undefined;
    const requestsBefore = provider.requests.length;
    await conflict(scenario);
    await waitFor(() => provider.requests.length > requestsBefore, 'merge provider request sent');
    if (failureMode === 'late') {
      await waitFor(() => heldResolve, 'delayed original response held');
      await waitFor(() => page.eval(`Boolean([...document.querySelectorAll('button')].find(button => button.textContent === '停止' && !button.disabled))`), 'stop enabled');
      await page.click('停止');
      heldResolve();
    }
    const originalRequest = await mergeRequest(scenario);
    const terminal = await waitFor(async () => { const detail = await api(roleDetailUrl(scenario, originalRequest.requestId)); return !detail.busy && detail.discussion?.lastRun?.id === originalRequest.requestId && !['accepted', 'running'].includes(detail.discussion.lastRun.status) ? detail : null; }, 'the exact failed or cancelled original request settled');
    assert.equal(terminal.discussion.lastRun.status, failureMode === 'late' ? 'cancelled' : failureMode === 'no-save' ? 'completed' : 'failed');
    assert.equal(mergeMessages(scenario).length, 1, 'failure/cancel does not automatically dispatch a replacement request');
    const local = await cache(scenario);
    assert.ok(local?.reserves.some(reserve => reserve.purpose === `${scenario.label}-人工未保存`), 'failed/cancelled/no-save result preserves local input in original cache');
    const baseCache = await page.eval(`sessionStorage.getItem(${JSON.stringify(`optracall.goal.unsavedDraft.v1:${scenario.goal.goalId}:${scenario.version}.base`)})`);
    assert.ok(baseCache, 'original editing baseline remains recoverable');
    const latest = await api(`${scenario.route}/workspace`);
    assert.equal(latest.draft.notes, scenario.oldDraft.notes);
    assert.equal(latest.draft.revision, 2, 'only human carryover saved; failed/cancelled/late model cannot write');
    assert.equal(latest.publications.length, 0);
    await page.capture(`preserved-${failureMode}`, { workspace: latest });
    results.push({ scenario: scenario.label, result: 'PASS' });
    console.log(`PASS ${scenario.label}: original input/base preserved`);
    mode = 'success';
  }

  const newInput = await seed('R2合并期间新输入');
  mode = 'new-input'; heldResolve = undefined;
  await conflict(newInput);
  await waitFor(() => heldResolve, 'merge response delayed before reading/saving');
  await addHumanReserve('合并期间继续填写的本地预留');
  heldResolve();
  await waitFor(async () => { const value = await api(`${newInput.route}/workspace`); return value.draft?.reserves.some(reserve => reserve.purpose === `${newInput.label}-人工未保存`) ? value : null; }, 'original merge persisted');
  const newInputRequest = await mergeRequest(newInput);
  await waitFor(async () => { const detail = await api(roleDetailUrl(newInput, newInputRequest.requestId)); return !detail.busy && detail.discussion?.lastRun?.id === newInputRequest.requestId && detail.discussion.lastRun.status === 'completed'; }, 'exact original merge with newer human input settled');
  await waitFor(async () => (await page.text()).includes('已有新输入'), 'UI finishes receipt verification while preserving newer input');
  await waitFor(async () => {
    const local = await cache(newInput);
    const value = await api(`${newInput.route}/workspace`);
    return local?.reserves.some(reserve => reserve.purpose === '合并期间继续填写的本地预留') || value.draft?.reserves.some(reserve => reserve.purpose === '合并期间继续填写的本地预留');
  }, 'late successful merge never overwrites newer human input');
  await page.click('调整计划、预留与补缺');
  assert.ok(await page.eval(`Array.from(document.querySelectorAll('dialog[open] input[placeholder="预留用途（必填）"]')).some(input => input.value === '合并期间继续填写的本地预留')`), 'new input remains visible in actual UI');
  await page.closeDialog();
  assert.equal((await api(`${newInput.route}/workspace`)).publications.length, 0);
  results.push({ scenario: newInput.label, result: 'PASS' });
  await page.capture('new-input-preserved');
  mode = 'success';

  const normal = await seed('R2普通CAS', false);
  await openGoal(normal);
  await page.click('调整计划、预留与补缺');
  const external = makeNormalDraftPayload(normal.plan, { expectedDraftRevision: 1, notes: '普通CAS另一端备注' });
  await api(`${normal.route}/decomposition/draft`, 'POST', external);
  await page.fill('dialog[open] input[placeholder="预留用途（必填）"]', '普通CAS人工用途');
  await waitFor(async () => (await page.text()).includes('请 Agent 合并保留的改稿'), 'normal CAS conflict detected');
  await page.closeDialog();
  await page.click('请 Agent 合并保留的改稿');
  const latest = await waitFor(async () => { const value = await api(`${normal.route}/workspace`); return value.draft?.reserves[0]?.purpose === '普通CAS人工用途' ? value : null; }, 'normal CAS merged');
  assert.equal(latest.draft.notes, '普通CAS另一端备注');
  assert.equal(latest.publications.length, 0);
  results.push({ scenario: normal.label, result: 'PASS', revision: latest.draft.revision });
  await page.capture('normal-cas-pass', { workspace: latest });
  const scopeScenario = await seed('R1范围建议由人核对', false);
  const scopeWorkspace = await api(`${scopeScenario.route}/workspace`);
  const previewInput = { gsaPlanId: scopeScenario.plan.planId, gsaPlanVersion: scopeScenario.plan.planVersion, gsaPlanSha256: scopeScenario.plan.contentSha256, draftRevision: scopeWorkspace.draft.revision, draftSha256: scopeWorkspace.draft.contentSha256, expectedActiveVersion: null };
  const scopePreview = await api(`${scopeScenario.route}/decomposition/publish-preview`, 'POST', previewInput);
  const { publication } = await api(`${scopeScenario.route}/decomposition/publish`, 'POST', { ...previewInput, operationId: randomUUID(), previewSha256: scopePreview.previewSha256, reason: '合成范围核对检查所需正式计划' });
  const scopePeriod = publication.snapshot.timePlan[0];
  const proposedScope = '零售事业部 · 全渠道与门店';
  const scopeReport = `数据截至 2027-01-07。仅统计零售事业部全部渠道与门店，即${proposedScope}，同一完整范围净销售额 23 万元，完整出数并已结账。`;
  const { actual: scopeActual } = await api(`${scopeScenario.route}/decomposition/actuals`, 'POST', { operationId: randomUUID(), publicationVersion: 1, rowId: 'G-TOTAL', checkpointId: scopePeriod.checkpointId ?? scopePeriod.periodId, actualSource: { ref: 'scope-suggestion-original.txt', label: '原范围待核报表', cutoffAt: '2027-01-07', reportText: scopeReport, basis: { metric: '净销售额', unit: '万元', scope: '仅统计零售事业部全部渠道与门店', periodId: scopePeriod.periodId, coverage: 'complete', maturity: 'closed' } }, actualPeriods: [{ periodId: scopePeriod.periodId, actualValue: 23 }] });
  scopeArgs = { comparability: 'comparable', assessmentNote: '报表写明全范围，建议负责人核对原填范围。', observation: { quote: '净销售额 23 万元', actualValue: 23, basis: { metric: '净销售额', unit: '万元', scope: proposedScope, periodId: scopePeriod.periodId, coverage: 'complete', maturity: 'closed' }, basisMappings: [{ field: 'scope', sourceValue: '仅统计零售事业部全部渠道与门店', mappedValue: proposedScope, evidenceQuote: `仅统计零售事业部全部渠道与门店，即${proposedScope}，同一完整范围`, rationale: '原文明确二者是同一完整范围；请负责人核对后决定是否采用规范范围文字。' }] } };
  mode = 'scope-suggestion';
  const scopeRole = '/api/business-role?owner=' + encodeURIComponent(JSON.stringify({ role: 'goal', goalId: scopeScenario.goal.goalId, version: 1, actualId: scopeActual.actualId, analysisVariant: 'goal-decomposition' }));
  await api(scopeRole + '&action=messages', 'POST', { requestId: randomUUID(), expectedRevision: 0, text: '检查这份实绩，范围差异保留给负责人决定。' });
  const scopeCheck = await waitFor(async () => { const value = await api(`${scopeScenario.route}/workspace`); return value.checks.find(check => check.operationId === scopeActual.actualId); }, 'actual native Pi scope assessment saved');
  assert.equal(scopeCheck.actualSource.basis.scope, '仅统计零售事业部全部渠道与门店', 'Agent proposal does not override explicit human scope');
  assert.equal(scopeCheck.basisSuggestions?.[0]?.proposedValue, proposedScope);
  await openGoal({ ...scopeScenario, published: true });
  await page.click('阶段跟进');
  await waitFor(async () => (await page.text()).includes('将建议范围填入核对表单'), 'human scope suggestion recovery control');
  const writesBeforeSuggestion = browserWrites.length;
  await page.click('将建议范围填入核对表单');
  await waitFor(() => page.eval(`document.querySelector('input[aria-label="凭证所覆盖的业务范围"]')?.value === ${JSON.stringify(proposedScope)}`), 'scope proposal fills the existing correction form');
  const corrected = await page.eval(`({ report: document.querySelector('textarea[aria-label="实绩报表原文"]')?.value, ref: document.querySelector('input[aria-label="实绩来源凭证引用"]')?.value, actual: document.querySelector('input[placeholder="输入实绩数值"]')?.value, supplement: [...document.querySelectorAll('label')].find(label => label.textContent.includes('补充哪次检查'))?.querySelector('select')?.value })`);
  assert.deepEqual(corrected, { report: scopeReport, ref: 'scope-suggestion-original.txt', actual: '23', supplement: scopeCheck.checkId });
  assert.equal(browserWrites.length, writesBeforeSuggestion, 'proposal button only prefills; it does not submit another check or Provider request');
  const scopeAfter = await api(`${scopeScenario.route}/workspace`);
  assert.equal(scopeAfter.checks.length, 1);
  assert.deepEqual(scopeAfter.checks[0], scopeCheck, 'original check and its human scope remain unchanged before explicit submission');
  await page.capture('scope-suggestion-prefilled', { check: scopeCheck, corrected });
  results.push({ scenario: scopeScenario.label, result: 'PASS' });
  mode = 'success';
  assert.equal(provider.errors.length, 0);
  assert.ok(!browserWrites.some(write => /\/decomposition\/publish(?:\?|$)/.test(write.url)), 'recovery UI never issues a publish request');
  await writeFile(path.join(root, 'summary.json'), JSON.stringify({ results, syntheticProviderRequests: provider.requests.length, synthesis, browserWrites, httpWrites }, null, 2));
  console.log(`PASS ${results.length} real browser recovery cases; evidence=${root}`);
} catch (error) {
  if (page) await page.capture('failure', { error: String(error), results }).catch(() => {});
  console.error(`Evidence: ${root}`);
  throw error;
} finally {
  ws?.close(); chrome.kill('SIGTERM');
  await provider.close(); await host.close();
}
