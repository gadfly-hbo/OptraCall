// Issue #116 browser verification: transcript collapse on real product paths.
// Run with: node --test tests/browser-issue116-transcript-collapse.mjs
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';
import { startTestHost } from './fixtures/host-process.ts';
import { startToolProvider } from './fixtures/tool-provider.ts';

const uiPort = Number(process.env.OPTRACALL_ISSUE116_UI_PORT || 4451);
const host = await startTestHost({ uiPort });
const provider = await startToolProvider();
const frontend = spawn(process.execPath, ['scripts/frontend.mjs', 'dev', '--port', String(uiPort), '--strictPort'], {
  env: { ...process.env, OPTRACALL_HOST_PORT: String(host.port) }, stdio: ['ignore', 'pipe', 'inherit']
});
let browser;
try {
  await new Promise((resolve, reject) => {
    frontend.stdout.on('data', chunk => { if (chunk.toString().includes(':' + uiPort + '/')) resolve(); });
    frontend.once('exit', code => reject(Error('Frontend exited during startup: ' + code)));
  });
  await mkdir(path.join(host.dataRoot, 'pi'), { recursive: true });
  await writeFile(path.join(host.dataRoot, 'pi/settings.json'), JSON.stringify({ retry: { enabled: false } }));
  const post = async (route, body, method = 'POST', status = 200) => {
    const r = await host.request(route, method, body);
    if (r.status !== status) throw new Error(route + ' ' + r.status + ' ' + await r.text());
    return r.json();
  };
  await post('/api/configuration', { name: '折叠回归模型', provider: 'openai-compatible', model: 'synthetic-collapse', baseUrl: provider.baseUrl, apiKey: 'synthetic-collapse-only' }, 'PUT');

  const declaration = { completion: 'organize-partial', format: 'chat-summary', summary: '合成阶段整理：过程与折叠回归。', limitations: ['合成资料，无经营结论。'], selfCheck: { performed: true, findings: ['仅核对话呈现，不核业务效果。'] }, methodChecks: [], reports: [] };
  const longReply = '已完成过程与折叠核对。\n' + Array.from({ length: 60 }, (_, i) => '记录 ' + (i + 1) + '：合成内容仅供呈现回归，不代表业务结论。').join('\n');
  provider.setResponder(context => context.recentToolResults.length ? { text: longReply } : { calls: [{ name: 'declare_analysis_delivery', arguments: declaration }] });

  browser = await chromium.launch({ channel: 'chrome' });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: 'block' });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.setDefaultTimeout(20000);
  // ===== E1 项目任务对话：过程组、折叠、身份记忆 =====
  const { project } = await post('/api/projects', { name: '折叠回归项目' }, 'POST', 201);
  const { task } = await post(`/api/projects/${project.id}/tasks`, { name: '折叠回归任务' }, 'POST', 201);
  await page.goto('http://127.0.0.1:' + uiPort);
  page.on('console', message => { if (message.type() === 'error' && !/^Failed to load resource/.test(message.text())) errors.push('console: ' + message.text()); });

  try {
    await page.getByRole('button', { name: project.name, exact: true }).click();
  } catch (error) {
    console.error('page errors:', JSON.stringify(errors));
    console.error('body snippet:', (await page.locator('body').innerText()).slice(0, 600));
    throw error;
  }
  try {
    await page.getByRole('button', { name: task.name, exact: true }).click();
  } catch (error) {
    const names = await page.locator('button').evaluateAll(buttons => buttons.map(button => (button.textContent || '').trim()).filter(Boolean));
    console.error('buttons at failure:', JSON.stringify(names));
    throw error;
  }
  const textbox = page.getByRole('textbox', { name: '消息', exact: true });
  const longQuestion = Array.from({ length: 10 }, (_, i) => '第 ' + (i + 1) + ' 行：这是一个足够长的合成问题，用来验证用户长消息按预览折叠。').join('\n');
  await textbox.fill(longQuestion);
  await page.waitForFunction(() => document.querySelector('.send-button')?.disabled === false);
  await textbox.press('Enter');
  await page.locator('.messages .message.assistant:not(.streaming-message) .fold-toggle').first().waitFor();

  const processGroup = page.locator('.messages .process-group').first();
  assert.equal(await page.locator('.messages .process-group').count(), 1, 'one process group per turn');
  assert.match(await processGroup.locator('.process-toggle').innerText(), /推理过程/);
  assert.match(await processGroup.locator('.process-toggle').innerText(), /1 步/);
  assert.equal(await processGroup.locator('.process-toggle').getAttribute('aria-expanded'), 'false');
  assert.equal(await processGroup.locator('.process-steps').isVisible(), false, 'collapsed process steps are visually hidden');
  await processGroup.locator('.process-toggle').click();
  assert.equal(await processGroup.locator('.process-toggle').getAttribute('aria-expanded'), 'true');
  await assert.doesNotMatch(await processGroup.locator('.process-steps details.tool-message summary').first().innerText(), /^$/);
  assert.match(await processGroup.locator('.process-steps details.tool-message summary').first().innerText(), /declare_analysis_delivery/);

  const userFold = page.locator('.message.user .fold-toggle').first();
  assert.equal(await userFold.getAttribute('aria-expanded'), 'false', 'long user message collapses to a preview');
  const replyFold = page.locator('.message.assistant:not(.streaming-message) .fold-toggle').first();
  assert.equal(await replyFold.getAttribute('aria-expanded'), 'false', 'completed reply collapses by default');
  assert.match(await page.locator('.message.assistant .message-author').first().innerText(), /OptraCall\s+synthetic-collapse/);

  await replyFold.click();
  assert.equal(await replyFold.getAttribute('aria-expanded'), 'true');
  const storeRaw = await page.evaluate(() => sessionStorage.getItem('optracall.transcript-collapse.v1'));
  assert.ok(storeRaw && storeRaw.includes(`task:${project.id}/${task.id}::`), 'fold choice is scoped by conversation key');

  await page.reload();
  await page.getByRole('button', { name: project.name, exact: true }).click();
  await page.getByRole('button', { name: task.name, exact: true }).click();
  await page.locator('.messages .message.assistant:not(.streaming-message) .fold-toggle').first().waitFor();
  assert.equal(await page.locator('.message.assistant:not(.streaming-message) .fold-toggle').first().getAttribute('aria-expanded'), 'true', 'expansion survives reload via sessionStorage');

  await page.getByRole('button', { name: '放大对话', exact: true }).click();
  assert.equal(await page.locator('dialog[open] .message.assistant:not(.streaming-message) .fold-toggle').first().getAttribute('aria-expanded'), 'true', 'expansion survives the inline → expanded drawer move');
  await page.keyboard.press('Escape');
  await page.locator('.message.assistant:not(.streaming-message) .fold-toggle').first().waitFor();

  // short second turn: short user message stays fully readable without a toggle
  await textbox.fill('再补一句短问题。');
  await page.waitForFunction(() => document.querySelector('.send-button')?.disabled === false);
  await textbox.press('Enter');
  await page.waitForFunction(() => document.querySelectorAll('.messages .message.user').length === 2, undefined, { timeout: 20000 }).catch(async error => {
    console.error('user count:', await page.locator('.messages .message.user').count());
    console.error('draft value:', JSON.stringify(await page.locator('#message-input').inputValue().catch(() => 'gone')));
    console.error('status:', await page.locator('.composer-helper [role="status"]').innerText().catch(() => ''));
    console.error('provider requests:', provider.requests?.length ?? 'n/a');
    throw error;
  });
  const shortUser = page.locator('.messages .message.user').nth(1);
  assert.equal(await shortUser.locator('.fold-toggle').count(), 0, 'short user message renders without a fold toggle');

  // ===== E3 战略共创：空 Agent 块消失、品牌署名、过程组、键盘展开 =====
  await page.getByRole('button', { name: '战略选择', exact: true }).click();
  const discussionInput = page.getByLabel('战略讨论问题');
  await discussionInput.waitFor();
  await discussionInput.fill('战略问题：\n' + Array.from({ length: 8 }, (_, i) => '背景 ' + (i + 1) + '：合成战略背景，用于验证长问题折叠与过程分组。').join('\n'));
  await page.getByRole('button', { name: '发送讨论', exact: true }).click();
  await page.locator('.strategy-discussion-messages .strategy-discussion-message.assistant .fold-toggle').first().waitFor();

  const blankAssistants = await page.locator('.strategy-discussion-message.assistant').evaluateAll(articles =>
    articles.filter(article => !article.querySelector('.process-group, .fold, .strategy-discussion-reply')).length
  );
  assert.equal(blankAssistants, 0, 'no blank Agent blocks remain');
  assert.equal(await page.locator('.strategy-discussion-messages .process-group').count(), 1);
  assert.match(await page.locator('.strategy-discussion-message.assistant .message-author').first().innerText(), /OptraCall\s+synthetic-collapse/);
  assert.equal(await page.locator('.strategy-discussion-message.user .fold-toggle').count(), 1, 'long strategy question collapses');

  const strategyToggle = page.locator('.strategy-discussion-messages .process-group .process-toggle').first();
  const strategySteps = page.locator('.strategy-discussion-messages .process-group .process-steps').first();
  assert.equal(await strategySteps.isVisible(), false);
  await strategyToggle.evaluate(el => el.focus());
  await page.keyboard.press('Enter');
  assert.equal(await strategyToggle.getAttribute('aria-expanded'), 'true', 'keyboard Enter expands the process group');
  assert.equal(await strategySteps.isVisible(), true);

  assert.deepEqual(errors, []);
  console.log('PASS Issue #116 browser verification');
} finally {
  await browser?.close();
  frontend.kill();
  await host.close();
  await provider.close();
}
