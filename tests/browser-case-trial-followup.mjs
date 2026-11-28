// Real Host + official Pi 1.4.0 + local synthetic Provider + Chromium browser E2E for Issue #154 (CF01–CF07).
// Run via: node tests/browser-case-trial-followup.mjs
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';
import { existsSync } from 'node:fs';
import { startTestHost } from './fixtures/host-process.ts';
import { startToolProvider } from './fixtures/tool-provider.ts';

const chromiumExecutable = process.env.CHROMIUM_PATH
  ?? ['/opt/ms-playwright/chromium_headless_shell-1255/chrome-headless-shell-linux64/chrome-headless-shell', '/opt/ms-playwright/chromium-1255/chrome-linux64/chrome', '/usr/bin/chromium'].find(p => existsSync(p));

const port = Number(process.env.OPTRACALL_CF_TEST_PORT ?? 4389);
const outDir = path.resolve('.local/issue-154/product-verify');
await mkdir(outDir, { recursive: true });

const host = await startTestHost({ uiPort: port });
const provider = await startToolProvider();
const frontend = spawn(process.execPath, ['scripts/frontend.mjs', 'dev', '--port', String(port), '--strictPort'], {
  env: { ...process.env, OPTRACALL_HOST_PORT: String(host.port) },
  stdio: ['ignore', 'pipe', 'pipe'],
});

let browser;
const checks = [];
const pageErrors = [];
const consoleErrors = [];
const apiWrites = [];

try {
  await Promise.race([
    new Promise(resolve => frontend.stdout.on('data', bytes => {
      if (bytes.toString().includes(`:${port}/`)) resolve();
    })),
    once(frontend, 'exit').then(([code]) => { throw Error(`Frontend exited early during startup: ${code}`); }),
  ]);

  const cfgRes = await host.request('/api/configuration', 'PUT', {
    name: 'CF合成模型',
    provider: 'openai-compatible',
    baseUrl: provider.baseUrl,
    model: 'synthetic',
    apiKey: 'synthetic-local',
  });
  assert.ok(cfgRes.ok, 'model configuration PUT failed');
  const cfgData = await cfgRes.json();
  const configId = cfgData.configurations?.[0]?.id ?? cfgData.configuration?.id;
  assert.ok(configId, 'configuration id missing');

  const initRes = await host.request('/api/cases/storage/initialize', 'POST', {});
  assert.ok(initRes.ok, 'case storage initialize failed');

  browser = await chromium.launch({
    ...(chromiumExecutable ? { executablePath: chromiumExecutable } : { channel: 'chrome' }),
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
  });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  page.setDefaultTimeout(20000);

  page.on('pageerror', err => pageErrors.push(err.message));
  page.on('console', msg => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('request', req => {
    const u = new URL(req.url());
    if (u.pathname.startsWith('/api/') && !['GET', 'HEAD'].includes(req.method())) {
      apiWrites.push({ path: u.pathname + u.search, method: req.method() });
    }
  });

  const baseUrl = `http://127.0.0.1:${port}`;
  const get = async route => {
    const res = await host.request(route, 'GET');
    assert.ok(res.ok, `GET ${route} failed (${res.status})`);
    return res.json();
  };

  await page.goto(baseUrl);
  await page.emulateMedia({ colorScheme: 'light' });
  const appRoot = page.locator('.app');
  if (await appRoot.getAttribute('data-theme') !== 'light') {
    await page.getByRole('button', { name: '切换为浅色' }).click();
  }
  await page.getByRole('heading', { level: 1 }).first().waitFor();
  await page.screenshot({ path: path.join(outDir, '01-home-light-1440.png'), fullPage: true });

  // CF05: CasePreparation validates unset/personal missing scope name with exact focus and zero write POSTs
  await page.getByRole('button', { name: '直接准备新 Case', exact: true }).click();
  await page.getByRole('heading', { level: 1, name: '先把这件事说清楚', exact: true }).waitFor();
  await page.screenshot({ path: path.join(outDir, '02-preparation-1440.png'), fullPage: true });

  await page.getByLabel('这件事的名字', { exact: true }).fill('CF05 验证准备件');
  await page.getByLabel('G · 目标名称', { exact: true }).fill('验证目标CF05');
  await page.getByLabel('想看到什么结果', { exact: true }).fill('表单本地校验先于网络请求并精准聚焦');
  await page.getByLabel('S · 这次先怎么推进', { exact: true }).fill('先不填个人名称直接点击创建');
  await page.getByLabel('可核成果', { exact: true }).fill('不发出写请求并定位个人归属名称');
  await page.getByLabel('责任角色／承担人', { exact: true }).fill('测试负责人');
  const selectScope = (val) => page.locator('label').filter({ hasText: '已有企业或个人' }).locator('select').selectOption(val);
  await selectScope('personal');

  const writesBeforeCf05 = apiWrites.filter(w => w.path.includes('/strategy/goals') || w.path.includes('/workspace/create-case')).length;
  await page.getByRole('button', { name: '保存候选、明确采纳 G/S 并创建 Case', exact: true }).click();
  const prepAlert = page.locator('.case-preparation-page [role="alert"]').first();
  await prepAlert.waitFor();
  const prepAlertText = await prepAlert.innerText();
  assert.match(prepAlertText, /个人归属名称/);
  assert.doesNotMatch(prepAlertText, /核对原操作并继续|本地服务暂时不可用|重试保存/);
  const writesAfterCf05 = apiWrites.filter(w => w.path.includes('/strategy/goals') || w.path.includes('/workspace/create-case')).length;
  assert.equal(writesAfterCf05, writesBeforeCf05, 'CF05: missing personal name must trigger zero Goal/Case write POSTs');
  const activeFieldLabel = await page.evaluate(() => document.activeElement?.closest('label')?.textContent ?? '');
  assert.match(activeFieldLabel, /个人归属名称/, 'CF05: missing personal name must focus 个人归属名称');
  checks.push({ id: 'CF05', detail: 'Empty personal scope name blocked locally with exact focus and zero write POSTs' });

  // Now fill personal name and submit -> Case #1 created!
  await page.getByLabel('个人归属名称', { exact: true }).fill('个体经营实验组');
  await page.getByRole('button', { name: '保存候选、明确采纳 G/S 并创建 Case', exact: true }).click();
  await page.getByText(/与第一件事项已建立/).waitFor();

  // Go to Case overview (CaseBoard), create Case #2 so we verify CF06 with 2 -> 3 Cases
  await page.getByRole('button', { name: '← 返回工作台 · 保留草稿', exact: true }).click();
  await page.locator('.daily-case-preparation-shell').waitFor({ state: 'detached' });
  await page.locator('nav.primary-nav').getByRole('button', { name: 'Decision Case', exact: true }).click();
  await page.getByRole('heading', { level: 1, name: 'Case 总览', exact: true }).waitFor();
  await page.getByText('CF05 验证准备件', { exact: true }).first().waitFor();

  // Create Case #2
  await page.getByRole('button', { name: '＋ 新建 Case', exact: true }).click();
  await page.getByRole('button', { name: '准备另一件 Case', exact: true }).click().catch(() => {});
  await page.getByLabel('这件事的名字', { exact: true }).fill('Case 二号对照');
  await page.getByLabel('G · 目标名称', { exact: true }).fill('第二目标');
  await page.getByLabel('想看到什么结果', { exact: true }).fill('第二目标成果');
  await page.getByLabel('S · 这次先怎么推进', { exact: true }).fill('第二推进策略');
  await page.getByLabel('可核成果', { exact: true }).fill('第二可核成果');
  await page.getByLabel('责任角色／承担人', { exact: true }).fill('第二负责人');
  await selectScope('personal');
  await page.getByLabel('个人归属名称', { exact: true }).fill('个人组二');
  await page.getByRole('button', { name: '保存候选、明确采纳 G/S 并创建 Case', exact: true }).click();
  await page.getByText(/与第一件事项已建立/).waitFor();
  await page.getByRole('button', { name: '← 返回工作台 · 保留草稿', exact: true }).click();
  await page.locator('.daily-case-preparation-shell').waitFor({ state: 'detached' });
  await page.getByText('Case 二号对照', { exact: true }).first().waitFor();

  // CF06: From Case 总览 showing 2 Cases, create 3rd Case and click direct back button -> Case总览 automatically displays all 3 without manual reload
  await page.getByRole('button', { name: '＋ 新建 Case', exact: true }).click();
  await page.getByRole('button', { name: '准备另一件 Case', exact: true }).click().catch(() => {});
  await page.getByLabel('这件事的名字', { exact: true }).fill('Case 三号自动刷新');
  await page.getByLabel('G · 目标名称', { exact: true }).fill('第三目标CF06');
  await page.getByLabel('想看到什么结果', { exact: true }).fill('自动更新总览显示三件 Case');
  await page.getByLabel('S · 这次先怎么推进', { exact: true }).fill('创建后直接返回工作台');
  await page.getByLabel('可核成果', { exact: true }).fill('Case 三号自动出现在总览中');
  await page.getByLabel('责任角色／承担人', { exact: true }).fill('总览负责人');
  await selectScope('personal');
  await page.getByLabel('个人归属名称', { exact: true }).fill('个人组三');
  await page.getByRole('button', { name: '保存候选、明确采纳 G/S 并创建 Case', exact: true }).click();
  await page.getByText(/与第一件事项已建立/).waitFor();
  await page.getByRole('button', { name: '← 返回工作台 · 保留草稿', exact: true }).click();
  await page.locator('.daily-case-preparation-shell').waitFor({ state: 'detached' });
  // Verify on CaseBoard immediately without manual reload/refresh button
  await page.getByRole('heading', { level: 1, name: 'Case 总览', exact: true }).waitFor();
  await page.getByText('Case 三号自动刷新', { exact: true }).first().waitFor();
  await page.screenshot({ path: path.join(outDir, '03-case-overview-map-1440.png'), fullPage: true });
  await page.getByRole('button', { name: 'Case 卡片', exact: true }).click();
  await page.getByRole('button', { name: 'Case 三号自动刷新', exact: true }).waitFor();
  await page.screenshot({ path: path.join(outDir, '04-case-overview-cards-1440.png'), fullPage: true });
  checks.push({ id: 'CF06', detail: 'Creating 3rd Case and returning directly updates Case overview to all 3 Cases with 0 manual reloads' });

  // Open Case #1 detail
  await page.getByRole('button', { name: 'CF05 验证准备件', exact: true }).click();
  const detailRegion = page.getByRole('region', { name: 'Case 详情', exact: true });
  await detailRegion.getByRole('heading', { level: 1, name: 'CF05 验证准备件', exact: true }).waitFor();
  await page.screenshot({ path: path.join(outDir, '05-case-detail-1440.png'), fullPage: true });

  // CF03 Part A: No linked active project -> open 记录取舍 -> see guidance + 去关联或新建项目 + draft preserved
  await detailRegion.getByRole('button', { name: '记录取舍', exact: true }).click();
  const choiceDialog = page.getByRole('dialog', { name: '记录本轮取舍', exact: true });
  await choiceDialog.waitFor();
  await choiceDialog.getByText(/尚无可供取舍的准确方案版本/).waitFor();
  await choiceDialog.getByRole('button', { name: '去关联或新建项目', exact: true }).waitFor();
  await page.screenshot({ path: path.join(outDir, '06-choice-empty-unlinked-1440.png'), fullPage: true });
  await choiceDialog.getByRole('button', { name: '去关联或新建项目', exact: true }).click();
  const linkDialog = page.getByRole('dialog', { name: '关联项目', exact: true });
  await linkDialog.waitFor();
  await linkDialog.getByRole('button', { name: '新建并关联', exact: true }).click();
  await linkDialog.getByLabel('项目名称', { exact: true }).fill('CF03关联实验项目');
  await linkDialog.getByRole('button', { name: '创建并关联', exact: true }).click();
  await linkDialog.waitFor({ state: 'hidden' });

  // CF03 Part B: Linked active project exists -> 记录取舍 shows 去准备 Plan Task + 查看交接与依据, keeps draft
  await detailRegion.getByRole('button', { name: '记录取舍', exact: true }).click();
  await choiceDialog.waitFor();
  await choiceDialog.getByLabel('为什么这样选（依据与理由）', { exact: true }).fill('先做小范围对照试点再决定是否扩量');
  await choiceDialog.getByRole('button', { name: '去准备 Plan Task', exact: true }).waitFor();
  await choiceDialog.getByRole('button', { name: /查看交接与依据/ }).waitFor();
  await page.screenshot({ path: path.join(outDir, '07-choice-empty-linked-1440.png'), fullPage: true });

  // Click 去准备 Plan Task -> creates real Plan Task in CF03关联实验项目 -> test CF02 real send + complete
  await choiceDialog.getByRole('button', { name: '去准备 Plan Task', exact: true }).click();
  const taskDialog = page.getByRole('dialog', { name: '新建任务', exact: true });
  await taskDialog.waitFor();
  await taskDialog.getByLabel('任务名称', { exact: true }).fill('CF03 Plan 方案任务');
  await taskDialog.getByRole('button', { name: '创建任务', exact: true }).click();
  await taskDialog.waitFor({ state: 'hidden' });

  // Send Plan message through real Host + Pi 1.4.0 + synthetic Provider (CF02 normal path)
  provider.setResponder(() => ({
    text: '方案一：仅在两家试点门店试行两周，核对转化率后再决定下一步。',
  }));
  const chatInput = page.locator('#message-input');
  await chatInput.fill('请给出一版可落地的试点方案');
  const sendTaskBtn = page.getByRole('button', { name: '发送消息', exact: true });
  await page.waitForFunction(() => {
    const btn = document.querySelector('button[aria-label="发送消息"]');
    return btn && !btn.hasAttribute('disabled');
  });
  await sendTaskBtn.click();
  await page.locator('.message.assistant .message-content').filter({ hasText: '两家试点门店试行两周' }).first().waitFor();
  await page.waitForFunction(() => !document.querySelector('.stop-button'));

  // Test CF02 abnormal path: heartbeat-only /events stream without initial snapshot must exit connecting and keep draft!
  const projectsBeforeCf02 = (await get('/api/projects')).projects;
  const planProj = projectsBeforeCf02.find(p => p.name === 'CF03关联实验项目');
  assert.ok(planProj, 'linked project must exist');
  const hbTaskRes = await host.request(`/api/projects/${planProj.id}/tasks`, 'POST', { name: 'CF02 心跳超时任务' });
  assert.equal(hbTaskRes.status, 201);
  const { task: hbTask } = await hbTaskRes.json();
  await page.route(`**/api/projects/${planProj.id}/tasks/${hbTask.id}/events*`, async route => {
    await route.fulfill({
      status: 200,
      headers: { 'content-type': 'text/event-stream', 'cache-control': 'no-store' },
      body: ': task connection\n\n: heartbeat\n\n',
    });
  });
  await page.reload();
  await page.getByRole('button', { name: 'CF02 心跳超时任务', exact: true }).click();
  await page.locator('#message-input').fill('CF02 断流前输入草稿保留');
  await page.getByText(/收到首帧前已断开|等待任务首帧状态超时|实时观察暂未恢复/).first().waitFor({ timeout: 15000 });
  assert.equal(await page.locator('#message-input').inputValue(), 'CF02 断流前输入草稿保留');
  checks.push({ id: 'CF02', detail: 'Plan Task completes cleanly via real Pi 1.4.0 and missing-snapshot SSE surfaces safe recovery without losing draft' });
  await page.unroute(`**/api/projects/${planProj.id}/tasks/${hbTask.id}/events*`);

  // Hand Plan reply back to Case #1 -> save Choice -> authorize -> feedback regression
  await page.locator('nav.primary-nav').getByRole('button', { name: 'Decision Case', exact: true }).click();
  await page.getByRole('button', { name: 'CF05 验证准备件', exact: true }).first().click();
  await detailRegion.getByRole('heading', { level: 1, name: 'CF05 验证准备件', exact: true }).waitFor();

  const handoffDetails = detailRegion.locator('details').filter({ hasText: '交接与依据' }).first();
  if (!await handoffDetails.evaluate(d => d.open)) await handoffDetails.locator(':scope > summary').click();
  const replySelect = handoffDetails.locator('label').filter({ hasText: '准确 Task 原回复' }).locator('select');
  await page.waitForFunction(el => el && el.options && el.options.length > 1, await replySelect.elementHandle());
  const firstReplyVal = await replySelect.evaluate(el => el.options[1].value);
  await replySelect.selectOption(firstReplyVal);
  const planResp = page.waitForResponse(res => res.url().includes('/plans') && res.request().method() === 'POST');
  await handoffDetails.getByRole('button', { name: '将 Plan 候选交回事项', exact: true }).click();
  assert.ok((await planResp).ok(), '将 Plan 候选交回事项 must succeed');

  // Open 记录取舍 again -> preserved draft '先做小范围对照试点再决定是否扩量' + new Plan strategy selectable!
  await detailRegion.getByRole('button', { name: '记录取舍', exact: true }).click();
  await choiceDialog.waitFor();
  try {
    assert.equal(await choiceDialog.locator('label').filter({ hasText: '为什么这样选' }).locator('textarea').inputValue(), '先做小范围对照试点再决定是否扩量');
  } catch (err) {
    await page.screenshot({ path: path.join(outDir, 'failure-choice-dialog.png'), fullPage: true });
    throw new Error(`Choice dialog check failed (text=${await choiceDialog.innerText().catch(() => 'closed')}): ${err}`);
  }
  const planSelect = choiceDialog.locator('label').filter({ hasText: '准确方案' }).locator('select');
  const optVal = await planSelect.evaluate(el => el.options[1]?.value ?? '');
  assert.ok(optVal, 'CF03: handed-back Plan strategy must appear in 准确方案');
  await planSelect.selectOption(optVal);
  await choiceDialog.getByRole('button', { name: '保存取舍', exact: true }).click();
  await choiceDialog.waitFor({ state: 'hidden' });
  await detailRegion.getByText('试行').first().waitFor();
  checks.push({ id: 'CF03', detail: 'Empty choice modal guided to Plan Task & handoff, retained draft, and saved real strategy choice cleanly' });

  // CF01 + CF04: Real Case BusinessRoleConversation with injected clean EOF on SSE + Pi 1.4.0 invalid-then-valid caseDeclarationsTool calls
  let sseInterceptCount = 0;
  await page.route('**/api/business-role?*action=events*', async route => {
    sseInterceptCount++;
    if (sseInterceptCount <= 2) {
      const snap = { sessionId: 'eof-sim', sdkVersion: '1.4.0', status: 'idle', messages: [], tools: [] };
      await route.fulfill({
        status: 200,
        headers: { 'content-type': 'text/event-stream', 'cache-control': 'no-store' },
        body: `data: ${JSON.stringify({ type: 'snapshot', snapshot: snap })}\n\n`,
      });
      return;
    }
    await route.continue();
  });

  const casesData = await get('/api/cases');
  const case1 = casesData.cases.find(c => c.title === 'CF05 验证准备件');
  const caseDecisions = await get(`/api/cases/${case1.id}/decisions`);
  const caseStoreId = caseDecisions.caseStoreId;
  const savedStrategy = caseDecisions.items.find(r => r.kind === 'strategy');
  const latestChoice = caseDecisions.choices.at(-1);
  assert.ok(savedStrategy && latestChoice);

  provider.setResponder(ctx => {
    assert.ok(ctx.availableTools.includes('strategy_goals'), `strategy_goals must be exposed to Pi (got: ${ctx.availableTools.join(',')})`);
    if (ctx.recentToolResults.length === 0) {
      return {
        calls: [{
          name: 'strategy_goals',
          arguments: {
            action: 'case-save-decision-request',
            kind: 'choose',
            text: '错误参数测试请求',
            target: {
              kind: 'choose',
              strategyRef: { type: 'case-decision', caseStoreId, caseId: case1.id, recordId: 'invalid-record-id', revision: savedStrategy.revision },
              expectedPreviousChoiceId: latestChoice.choiceId,
            },
          },
        }],
      };
    }
    if (ctx.recentToolResults.length === 1) {
      const schemaResult = JSON.stringify(ctx.recentToolResults[0]);
      assert.match(schemaResult, /strategyRef|Validation failed/, `Pi 1.4.0 must receive schema diagnostic (got: ${schemaResult})`);
      return {
        calls: [{
          name: 'strategy_goals',
          arguments: {
            action: 'case-save-decision-request',
            kind: 'choose',
            text: '不存在方案ID请求',
            target: {
              kind: 'choose',
              strategyRef: { type: 'case-decision', caseStoreId, caseId: case1.id, recordId: '00000000-0000-4000-8000-000000000000', revision: savedStrategy.revision },
              expectedPreviousChoiceId: latestChoice.choiceId,
            },
          },
        }],
      };
    }
    if (ctx.recentToolResults.length === 2) {
      const domainResult = JSON.stringify(ctx.recentToolResults[1]);
      assert.match(domainResult, /case_decision_not_found|target\.strategyRef/, `Pi 1.4.0 must receive safe host field diagnostic (got: ${domainResult})`);
      return {
        calls: [{
          name: 'strategy_goals',
          arguments: {
            action: 'case-save-decision-request',
            kind: 'choose',
            text: '请负责人核对试点两周方案的正式取舍',
            assignee: { label: '试点负责人', source: '用户对话指定' },
            target: {
              kind: 'choose',
              strategyRef: { type: 'case-decision', caseStoreId, caseId: case1.id, recordId: savedStrategy.recordId, revision: savedStrategy.revision },
              expectedPreviousChoiceId: latestChoice.choiceId,
            },
          },
        }],
      };
    }
    return { text: '已按错误定位完成纠正并保存取舍请求（CF01 与 CF04 实测通过）。' };
  });

  // Trigger a fresh mount/SSE read on Case Agent (reload detail clean)
  const roleErrors = [];
  page.on('response', res => {
    if (res.url().includes('/api/business-role') && res.status() >= 400) roleErrors.push(`${res.status()} ${res.url()}`);
  });
  await page.reload();
  await page.locator('nav.primary-nav').getByRole('button', { name: 'Decision Case', exact: true }).click();
  await page.getByRole('button', { name: 'CF05 验证准备件', exact: true }).first().click();
  const caseAgent = detailRegion.getByRole('region', { name: 'Case Agent', exact: true });
  await caseAgent.waitFor();
  try {
    await caseAgent.getByText(/会话模型/).waitFor({ timeout: 10000 });
  } catch (err) {
    await page.screenshot({ path: path.join(outDir, 'failure-cf01-before-send.png'), fullPage: true });
    throw new Error(`Case Agent never showed 会话模型 (text=${await caseAgent.innerText()}, roleErrors=${JSON.stringify(roleErrors)}): ${err}`);
  }
  const caseInput = caseAgent.getByRole('textbox');
  const beforeMsgs = apiWrites.filter(w => w.path.includes('action=messages')).length;
  const beforeStops = apiWrites.filter(w => w.path.includes('action=stop')).length;
  await caseInput.fill('请发起一个由试点负责人核对的取舍请求');
  await caseAgent.getByRole('button', { name: '发送', exact: true }).click();

  try {
    await caseAgent.getByText('已按错误定位完成纠正并保存取舍请求（CF01 与 CF04 实测通过）。').first().waitFor({ timeout: 25000 });
  } catch (err) {
    await page.screenshot({ path: path.join(outDir, 'failure-cf01-after-send.png'), fullPage: true });
    throw new Error(`CF01/CF04 reply missing (text=${await caseAgent.innerText()}, providerErrors=${JSON.stringify(provider.errors)}, providerReqCount=${provider.requests.length}, roleErrors=${JSON.stringify(roleErrors)}): ${err}`);
  }
  assert.equal(await caseAgent.getByText('正在回复…').count(), 0, 'CF01: must exit 正在回复… after recovery');
  assert.equal(apiWrites.filter(w => w.path.includes('action=messages')).length, beforeMsgs + 1, 'CF01: must never replay POST messages');
  assert.equal(apiWrites.filter(w => w.path.includes('action=stop')).length, beforeStops, 'CF01: must never auto-stop');
  const reqList = await get(`/api/cases/${case1.id}/decisions/requests`);
  assert.ok(reqList.requests.some(r => r.text === '请负责人核对试点两周方案的正式取舍'), 'CF04: corrected request must be saved cleanly');
  checks.push({ id: 'CF01+CF04', detail: 'Case Agent recovered automatically after clean SSE EOF and Pi 1.4.0 corrected invalid declaration request via field diagnostics' });
  await page.unroute('**/api/business-role?*action=events*');

  // Responsive & theme screenshots of Case detail (desktop dark, 1024x768, 390x844 mobile)
  await page.getByRole('button', { name: '切换为深色' }).click();
  await page.screenshot({ path: path.join(outDir, '08-case-detail-dark-1440.png'), fullPage: true });
  await page.getByRole('button', { name: '切换为浅色' }).click();
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.screenshot({ path: path.join(outDir, '09-case-detail-1024.png'), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: path.join(outDir, '10-case-detail-390.png'), fullPage: true });
  await page.setViewportSize({ width: 1440, height: 900 });

  // CF07: Two same-named projects in sidebar -> accessible name includes project name, archive targets only the selected project
  const dupA = await (await host.request('/api/projects', 'POST', { name: '同名对照项目' })).json();
  const dupB = await (await host.request('/api/projects', 'POST', { name: '同名对照项目' })).json();
  await page.reload();
  const sidebarNav = page.getByRole('navigation', { name: '项目空间列表', exact: true });
  await sidebarNav.getByLabel('项目操作 同名对照项目', { exact: true }).first().click();
  const visibleArchive = page.getByRole('button', { name: '归档项目 同名对照项目', exact: true }).first();
  await visibleArchive.waitFor();
  await page.keyboard.press('Escape');
  assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('aria-label')), '项目操作 同名对照项目');
  await sidebarNav.getByLabel('项目操作 同名对照项目', { exact: true }).first().click();
  await visibleArchive.click();
  await new Promise(r => setTimeout(r, 400));
  const afterArch = (await get('/api/projects')).projects;
  const resA = afterArch.find(p => p.id === dupA.project.id);
  const resB = afterArch.find(p => p.id === dupB.project.id);
  assert.ok(Boolean(resA?.archivedAt) !== Boolean(resB?.archivedAt), 'CF07: exactly one of the two same-named projects must be archived, not both');
  checks.push({ id: 'CF07', detail: 'Two same-named projects disambiguated via accessible label and only targeted project archived' });

  // All Projects view screenshot via Decision Case top tab -> 全部项目
  await page.locator('nav.primary-nav').getByRole('button', { name: 'Decision Case', exact: true }).click();
  await page.getByRole('button', { name: '全部项目', exact: true }).first().click();
  await page.getByRole('heading', { level: 1, name: '全部项目', exact: true }).waitFor();
  await page.screenshot({ path: path.join(outDir, '11-all-projects-1440.png'), fullPage: true });

  assert.deepEqual(pageErrors, [], `Unexpected page errors: ${pageErrors.join('; ')}`);

  await writeFile(path.join(outDir, 'e2e-receipt.json'), JSON.stringify({
    result: 'PASS',
    boundary: 'Isolated test Host + official Pi 1.4.0 + loopback synthetic Provider + Chromium (synthetic only)',
    checks,
    pageErrors,
    consoleErrors,
    providerRequests: provider.requests.length,
  }, null, 2));
  console.log(JSON.stringify({ result: 'PASS', checks, providerRequests: provider.requests.length, outDir }, null, 2));
} finally {
  if (browser) await browser.close();
  frontend.kill('SIGTERM');
  await once(frontend, 'exit').catch(() => {});
  await provider.close();
  await host.close();
}
