// #87: release a cold historical task's real /open response after Escape restores focus.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright';
import { startTestHost } from './fixtures/host-process.ts';
import { startToolProvider } from './fixtures/tool-provider.ts';

const uiPort = Number(process.env.OPTRACALL_FOCUS_UI_PORT || 4674);
const provider = await startToolProvider();
let host, frontend, browser;

async function request(path, method, body) {
  const response = await host.request(path, method, body);
  assert.ok(response.ok, path + ' ' + response.status);
  return response.json();
}

try {
  host = await startTestHost({ uiPort });
  provider.setResponder(() => ({ text: '既有对话的原回复' }));
  await request('/api/configuration', 'PUT', {
    name: '本地合成模型', provider: 'openai-compatible', model: 'synthetic',
    baseUrl: provider.baseUrl, apiKey: 'synthetic-only',
  });
  const { project } = await request('/api/projects', 'POST', { name: '焦点回归项目' });
  const tasksPath = '/api/projects/' + project.id + '/tasks';
  const { task: fresh } = await request(tasksPath, 'POST', { name: '空白任务' });
  const history = [];
  for (const [name, scenario] of [
    ['收起对话', 'escape'], ['手动移焦', 'keyboard'], ['正常打开', 'ordinary'],
  ]) {
    const { task } = await request(tasksPath, 'POST', { name });
    const taskPath = tasksPath + '/' + task.id;
    await request(taskPath + '/messages', 'POST', { requestId: crypto.randomUUID(), text: '留存原回复' });
    const deadline = Date.now() + 20_000;
    for (;;) {
      const saved = await request(taskPath);
      if (saved.task.lastRun?.status === 'completed' && saved.task.sessionFile) break;
      assert.ok(Date.now() < deadline, 'Synthetic history was not saved');
      await delay(50);
    }
    history.push({ task, taskPath, scenario });
  }
  const { dataRoot, projectsRoot } = host;
  await host.close();
  host = undefined;
  host = await startTestHost({ uiPort, dataRoot, projectsRoot });
  frontend = spawn(process.execPath, ['scripts/frontend.mjs', 'dev', '--port', String(uiPort), '--strictPort'], {
    env: { ...process.env, OPTRACALL_HOST_PORT: String(host.port) }, stdio: ['ignore', 'pipe', 'inherit'],
  });
  await new Promise((resolve, reject) => {
    frontend.stdout.on('data', chunk => { if (chunk.toString().includes(':' + uiPort + '/')) resolve(); });
    frontend.once('exit', code => reject(Error('Frontend stopped: ' + code)));
  });
  browser = await chromium.launch({ channel: 'chrome' });
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
  page.setDefaultTimeout(8000);
  await page.goto('http://127.0.0.1:' + uiPort);
  await page.getByRole('button', { name: project.name, exact: true }).click();

  const composer = page.getByRole('textbox', { name: '消息', exact: true });
  await page.getByRole('button', { name: fresh.name, exact: true }).click();
  await page.waitForFunction(() => document.activeElement === document.querySelector('#message-input'));
  console.log('PASS new task focuses the composer');

  for (const { task, taskPath, scenario } of history) {
    const openPath = taskPath + '/open';
    const openUrl = '**' + openPath;
    const isTaskOpen = req => new URL(req.url()).pathname === openPath && req.method() === 'POST';
    const releaseResponse = Promise.withResolvers();
    const openRequest = page.waitForRequest(isTaskOpen);
    await page.route(openUrl, async route => {
      const response = await route.fetch();
      await releaseResponse.promise;
      await route.fulfill({ response });
    });
    try {
      await page.getByRole('button', { name: task.name, exact: true }).click();
      await openRequest;
      let expectedFocus = await composer.elementHandle();
      if (scenario !== 'ordinary') {
        const launch = page.getByRole('button', { name: '放大对话', exact: true });
        const launchButton = await launch.elementHandle();
        await launch.click();
        const drawer = page.getByRole('dialog', { name: '任务对话 · ' + task.name });
        await drawer.waitFor();
        await page.keyboard.press('Escape');
        await drawer.waitFor({ state: 'hidden' });
        assert.ok(await launchButton.evaluate(button => document.activeElement === button), 'Escape must return to the original launch button');
        expectedFocus = launchButton;
        if (scenario === 'keyboard') {
          await page.keyboard.press('Shift+Tab');
          expectedFocus = await page.evaluateHandle(() => document.activeElement);
          assert.ok(await expectedFocus.evaluate(e => e.matches('button,summary,input,select,a,textarea') && e.id !== 'message-input'));
          assert.equal(await launchButton.evaluate(button => document.activeElement === button), false, 'Shift+Tab must move focus to another control');
        }
      }
      const reopened = page.waitForResponse(response => isTaskOpen(response.request()));
      releaseResponse.resolve();
      assert.equal((await reopened).status(), 200);
      await page.locator('.task-workflow-status').filter({ hasText: '任务和历史已保存在本机' }).waitFor();
      await page.getByText('既有对话的原回复', { exact: true }).waitFor();
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      assert.ok(await expectedFocus.evaluate(e => document.activeElement === e), task.name + ': activation changed the intended focus');
      console.log('PASS', task.name, 'after the real historical session reopens');
    } finally {
      releaseResponse.resolve();
      await page.unroute(openUrl);
    }
  }
  assert.equal(provider.requests.length, history.length, 'Opening tasks must not send new messages');
} finally {
  await browser?.close();
  frontend?.kill('SIGTERM');
  await host?.close();
  await provider.close();
}
