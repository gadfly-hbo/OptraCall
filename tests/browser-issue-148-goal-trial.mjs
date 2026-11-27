// Real headless Chrome (CDP) verification for Issue #148 (A1, A3, A4, A5).
// Run after `npm run build` with Node 25 and google-chrome/chromium available.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHost } from '../src/host/server.ts';
import { makeNormalDraftPayload } from './fixtures/goal-decomposition-draft.ts';

async function waitFor(fn, label, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  let lastErr;
  while (Date.now() < deadline) {
    try {
      const val = await fn();
      if (val) return val;
    } catch (err) {
      lastErr = err;
    }
    await new Promise(r => setTimeout(r, 120));
  }
  assert.fail(`${label}${lastErr ? `: ${lastErr}` : ''}`);
}

class CdpPage {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    ws.addEventListener('message', ev => {
      const msg = JSON.parse(String(ev.data));
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(msg.error.message));
        else resolve(msg.result);
      }
    });
  }
  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  async eval(expression) {
    const res = await this.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (res.exceptionDetails) throw new Error(res.exceptionDetails.text || JSON.stringify(res.exceptionDetails));
    return res.result?.value;
  }
  async goto(url) {
    await this.send('Page.navigate', { url });
    await waitFor(() => this.eval('document.readyState === "complete"'), 'page ready');
  }
  async bodyText() {
    return String((await this.eval('document.body.innerText')) ?? '');
  }
  async clickByText(tag, text) {
    const clicked = await this.eval(`(() => {
      const nodes = [...document.querySelectorAll(${JSON.stringify(tag)})];
      const target = nodes.find(el => (el.textContent || '').includes(${JSON.stringify(text)}) && !el.disabled && el.offsetParent !== null);
      if (!target) return false;
      target.click();
      return true;
    })()`);
    assert.ok(clicked, `button/element not found or disabled: <${tag}> containing "${text}"`);
  }
}

const root = path.join(tmpdir(), `optracall-browser-148-${randomUUID()}`);
const chromeProfile = path.join(root, 'chrome-profile');
await mkdir(chromeProfile, { recursive: true });

const host = createHost({
  cwd: process.cwd(),
  staticUiRoot: path.resolve('dist'),
  uiPorts: [4173],
  transportVersion: 'issue148-browser-test',
  dataRoot: path.join(root, 'data'),
  projectsRoot: path.join(root, 'projects'),
});
await host.ready;
await new Promise(resolve => host.server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${host.server.address().port}`;

async function api(route, method = 'GET', body) {
  const res = await fetch(base + route, {
    method,
    headers: { origin: base, 'content-type': 'application/json', 'x-optracall-client': '1' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const data = await res.json();
  assert.ok(res.ok, `${method} ${route} -> ${res.status}: ${JSON.stringify(data)}`);
  return data;
}

const chromeBin = process.env.CHROME_BIN || '/usr/bin/google-chrome';
const chrome = spawn(
  chromeBin,
  [
    '--headless=new',
    '--no-sandbox',
    '--disable-gpu',
    '--disable-dev-shm-usage',
    '--remote-debugging-port=0',
    `--user-data-dir=${chromeProfile}`,
    'about:blank',
  ],
  { stdio: ['ignore', 'pipe', 'pipe'] },
);

let wsUrl = '';
chrome.stderr.on('data', chunk => {
  const m = String(chunk).match(/DevTools listening on (ws:\/\/[^\s]+)/);
  if (m) wsUrl = m[1];
});

try {
  await waitFor(() => wsUrl, 'DevTools websocket URL', 15_000);
  const debugOrigin = wsUrl.replace(/^ws:/, 'http:').replace(/\/devtools\/browser\/.*$/, '');
  const targets = await (await fetch(`${debugOrigin}/json/list`)).json();
  const pageTarget = targets.find(t => t.type === 'page') ?? targets[0];
  assert.ok(pageTarget?.webSocketDebuggerUrl, 'page target missing');

  const ws = new WebSocket(pageTarget.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve);
    ws.addEventListener('error', reject);
  });
  const page = new CdpPage(ws);
  await page.send('Page.enable');
  await page.send('Runtime.enable');
  await page.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });

  // Seed Goal 1 for A1 (cross-version G/S carryover)
  const { goal: g1 } = await api('/api/strategy/goals', 'POST', {
    operationId: randomUUID(),
    title: '浏览器A1跨版本承接目标',
    outcome: '净销售额达到 120 万元',
    perspective: 'profit',
    scope: { kind: 'department', id: 'retail-dept', name: '零售事业部' },
    measurement: { kind: 'deliverable', criterion: '净销售额' },
    baseline: { state: 'known', description: '108万' },
    responsible: '林负责人',
    strategies: ['新品陈列与会员回访'],
    dueAt: '2027-01-31',
    formalOrigin: { kind: 'manual-exception', reason: '测试', period: '2027-01', targetValue: 120, unit: '万元', metricKind: 'amount' },
  });
  const r1 = `/api/strategy/goals/${g1.goalId}`;
  const { gsaPlan: p1 } = await api(`${r1}/gsa-plan/confirm`, 'POST', {
    operationId: randomUUID(),
    expectedGoalVersion: 1, expectedAdoptedVersion: null, expectedPlanVersion: 0,
    plannedActions: [{ id: 'A1', summary: '新品陈列', checkpoint: '2027-01-31', observationBasis: 'POS' }],
    decision: '确认 v1',
  });
  await api(`${r1}/decomposition/draft`, 'POST', makeNormalDraftPayload(p1, { notes: '浏览器未发布备注-v1' }));
  // Revise G/S to v2 and confirm GSA v2
  await api(`${r1}/gsa-plan/confirm`, 'POST', {
    operationId: randomUUID(),
    expectedGoalVersion: 1, expectedAdoptedVersion: 1, expectedPlanVersion: 1,
    goalRevision: {
      title: '浏览器A1跨版本承接目标（v2）',
      outcome: '净销售额达到 150 万元',
      perspective: 'profit',
      scope: { kind: 'department', id: 'retail-dept', name: '零售事业部' },
      measurement: { kind: 'deliverable', criterion: '净销售额' },
      baseline: { state: 'known', description: '108万' },
      responsible: '林负责人',
      strategies: ['新品陈列与会员回访', '团购增量'],
      dueAt: '2027-01-31',
      formalOrigin: { kind: 'manual-exception', reason: '上调', period: '2027-01', targetValue: 150, unit: '万元', metricKind: 'amount' },
    },
    plannedActions: [{ id: 'A1', summary: '新品陈列+团购', checkpoint: '2027-01-31', observationBasis: 'POS' }],
    decision: '确认 v2', supersedesReason: '目标上调',
  });

  // Seed Goal 2 for A5 (publish preview details) + A3 + A4
  const { goal: g2 } = await api('/api/strategy/goals', 'POST', {
    operationId: randomUUID(),
    title: '浏览器A3A4A5核对目标',
    outcome: '净销售额达到 120 万元',
    perspective: 'profit',
    scope: { kind: 'department', id: 'retail-dept', name: '零售事业部' },
    measurement: { kind: 'deliverable', criterion: '净销售额' },
    baseline: { state: 'known', description: '108万' },
    responsible: '林负责人',
    strategies: ['新品陈列与会员回访'],
    dueAt: '2027-01-31',
    formalOrigin: { kind: 'manual-exception', reason: '测试', period: '2027-01', targetValue: 120, unit: '万元', metricKind: 'amount' },
  });
  const r2 = `/api/strategy/goals/${g2.goalId}`;
  const { gsaPlan: p2 } = await api(`${r2}/gsa-plan/confirm`, 'POST', {
    operationId: randomUUID(),
    expectedGoalVersion: 1, expectedAdoptedVersion: null, expectedPlanVersion: 0,
    plannedActions: [{ id: 'A1', summary: '新品陈列', checkpoint: '2027-01-31', observationBasis: 'POS' }],
    decision: '确认',
  });
  const d2Payload = makeNormalDraftPayload(p2);
  d2Payload.reserves = [{ id: 'RES-1', amount: 5, unit: '万元', purpose: '华东新品陈列机动预留', owner: '陈总', basis: '首周补货' }];
  d2Payload.gapStrategies = [
    { id: 'GAP-1', name: '高潜老客定向激活', strategy: '定向券包', expectedContribution: 5, unit: '万元', nonOverlappingScope: '沉睡会员', scopeKey: 'dormant', basis: '历史转化4.2%', kind: 'expected-increment' },
    { id: 'GAP-2', name: '企业福利团购增量', strategy: '企采礼盒', expectedContribution: 3, unit: '万元', nonOverlappingScope: 'B2B企采', scopeKey: 'b2b', basis: '6家意向', kind: 'expected-increment' },
  ];
  d2Payload.timePlan.push({
    periodId: '2027-01-03', granularity: 'day', label: '2027-01-03 日检查',
    startDate: '2027-01-03', endDate: '2027-01-03', targetValue: 10, unit: '万元', status: 'planned', checkpointId: '2027-01-03',
  });
  const { draft: d2 } = await api(`${r2}/decomposition/draft`, 'POST', d2Payload);

  // Navigate to app and open Goals workspace
  await page.goto(base);
  await waitFor(async () => (await page.bodyText()).includes('目标管理'), 'app loaded');
  await page.clickByText('button', '目标管理');

  // --- Verify A1 in Chromium ---
  await waitFor(async () => (await page.bodyText()).includes('浏览器A1跨版本承接目标（v2）'), 'A1 goal visible');
  if (!(await page.bodyText()).includes('已核对，承接原拆解草稿')) {
    await page.clickByText('button', '切换目标');
    await waitFor(async () => (await page.bodyText()).includes('浏览器A1跨版本承接目标（v2）'), 'A1 goal in switcher');
    await page.clickByText('button', '浏览器A1跨版本承接目标（v2）');
  }
  await waitFor(async () => (await page.bodyText()).includes('已核对，承接原拆解草稿'), 'A1 carryover banner visible');
  await page.clickByText('button', '已核对，承接原拆解草稿');
  await waitFor(async () => {
    const ws = await api(`${r1}/workspace`);
    return ws.draft && ws.draft.revision === 2 && ws.draft.notes === '浏览器未发布备注-v1';
  }, 'A1 carryover saved rev 2 cleanly');
  const a1Text = await page.bodyText();
  assert.ok(!a1Text.includes('原拆解草稿暂不可读'), 'must not show unreadable draft error');
  console.log('Browser A1 PASS');

  // --- Verify A5 in Chromium (Desktop 1440px, Mobile 390px, Dark mode) ---
  await page.clickByText('button', '切换目标');
  await waitFor(async () => (await page.bodyText()).includes('浏览器A3A4A5核对目标'), 'A5 goal visible in switcher');
  await page.clickByText('button', '浏览器A3A4A5核对目标');
  await waitFor(async () => (await page.bodyText()).includes('核对并发布'), 'publish preview button visible');
  await page.clickByText('button', '核对并发布');
  await waitFor(async () => (await page.bodyText()).includes('华东新品陈列机动预留'), 'A5 reserve purpose visible in preview');
  const previewText = await page.bodyText();
  for (const needle of ['120万元', '112万元', '8万元', '已分配 115 + 预留 5万元', '华东新品陈列机动预留', '陈总', '高潜老客定向激活', '企业福利团购增量', '沉睡会员', 'B2B企采']) {
    assert.ok(previewText.includes(needle), `A5 preview missing: ${needle}`);
  }
  // Check 390px mobile + dark mode readability (no JS errors, dialog visible)
  await page.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await page.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'dark' }] });
  const mobileDialogOk = await page.eval(`(() => {
    const dlg = document.querySelector('dialog[open]');
    if (!dlg) return false;
    const rect = dlg.getBoundingClientRect();
    return rect.width > 200 && rect.width <= 390 && dlg.innerText.includes('华东新品陈列机动预留');
  })()`);
  assert.ok(mobileDialogOk, 'A5 preview dialog must fit 390px dark mode');
  await page.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await page.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'light' }] });
  // Cancel preview -> zero publish side effects
  await page.clickByText('button', '返回修改草稿');
  const wsBeforePub = await api(`${r2}/workspace`);
  assert.equal(wsBeforePub.publications.length, 0, 'cancel preview must have zero publish side effects');
  console.log('Browser A5 PASS');

  // --- Verify A3 & A4 in Chromium ---
  // Publish v1, configure ONLY week threshold, record an incomparable check and a day check
  const prev2 = await api(`${r2}/decomposition/publish-preview`, 'POST', {
    gsaPlanId: p2.planId, gsaPlanVersion: p2.planVersion, gsaPlanSha256: p2.contentSha256,
    draftRevision: d2.revision, draftSha256: d2.contentSha256, expectedActiveVersion: null,
  });
  await api(`${r2}/decomposition/publish`, 'POST', {
    operationId: randomUUID(),
    gsaPlanId: p2.planId, gsaPlanVersion: p2.planVersion, gsaPlanSha256: p2.contentSha256,
    draftRevision: d2.revision, draftSha256: d2.contentSha256, previewSha256: prev2.previewSha256, expectedActiveVersion: null,
  });
  await api(`${r2}/decomposition/threshold`, 'POST', {
    expectedGoalVersion: 1, configured: true, magnitudePct: 10, consecutivePeriods: 2,
    adverseDirection: 'below', unit: 'percent', metricId: '净销售额', periodGranularity: 'week',
  });
  await api(`${r2}/decomposition/checks`, 'POST', {
    operationId: randomUUID(), publicationVersion: 1, rowId: 'G-TOTAL', checkpointId: '2027-01-03',
    comparability: 'comparable',
    actualSource: {
      ref: 'pos-mismatch.csv', label: '摘要口径日结', cutoffAt: '2027-01-03T23:59:59Z',
      basis: { metric: '已结账净销售额', unit: '万元', scope: '零售事业部 · 全渠道与门店', periodId: '2027-01-03', coverage: 'complete', maturity: 'closed' },
    },
    actualPeriods: [{ periodId: '2027-01-03', actualValue: 8 }],
  });

  await page.goto(base);
  await waitFor(async () => (await page.bodyText()).includes('目标管理'), 'app reloaded');
  await page.clickByText('button', '目标管理');
  await waitFor(async () => (await page.bodyText()).includes('切换目标'), 'goal workspace loaded');
  if (!(await page.bodyText()).includes('浏览器A3A4A5核对目标')) {
    await page.clickByText('button', '切换目标');
    await waitFor(async () => (await page.bodyText()).includes('浏览器A3A4A5核对目标'), 'goal in switcher');
    await page.clickByText('button', '浏览器A3A4A5核对目标');
  }
  await waitFor(async () => (await page.bodyText()).includes('阶段跟进'), 'stage tabs visible');
  await page.clickByText('button', '阶段跟进');
  await waitFor(async () => (await page.bodyText()).includes('具体待核／冲突项'), 'A3 comparability issues visible');
  const followupText = await page.bodyText();
  assert.ok(followupText.includes('口径/期间不可比'), 'A3 consistent incomparable label');
  assert.ok(followupText.includes('指标不匹配'), 'A3 pinpoints metric mismatch');
  assert.ok(followupText.includes('补充／纠正待核项后重新核对'), 'A3 provides correctable entry');
  assert.ok(followupText.includes('不适用该日检查'), 'A4 warns week rule did not apply to latest day check');
  // Click A3 one-click correction button -> selects G-TOTAL + day period 2027-01-03 and pre-fills basis
  await page.clickByText('button', '补充／纠正待核项后重新核对');
  await waitFor(async () => (await page.bodyText()).includes('不适用当前日检查'), 'A4 warns week rule does not apply to current day check');
  await waitFor(async () => (await page.bodyText()).includes('立即配置日粒度阈值'), 'A4 provides in-place day threshold setup button');
  await page.clickByText('button', '立即配置日粒度阈值');
  const selectedGran = await page.eval(`document.querySelector('[aria-label="阈值检查周期"]')?.value`);
  assert.equal(selectedGran, 'day', 'A4 quick setup must switch granularity select to day');
  console.log('Browser A3 & A4 PASS');

  ws.close();
} catch (err) {
  console.error('Browser test failed:', err);
  throw err;
} finally {
  chrome.kill('SIGKILL');
  await new Promise(r => chrome.once('exit', r));
  await host.close();
  await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}
