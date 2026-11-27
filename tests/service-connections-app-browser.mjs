// Isolated full application + real Host routes. Synthetic account identity only; no provider/model calls.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHost } from '../src/host/server.ts';
import { ServiceConnectionStore } from '../src/host/service-connection-store.ts';
const { chromium } = await import(process.env.OPTRACALL_PLAYWRIGHT_MODULE || 'playwright');

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'optracall-service-app-'));
const dataRoot = path.join(root, 'private'), projectsRoot = path.join(root, 'projects');
const store = new ServiceConnectionStore({ dataRoot }); await store.init();
await store.saveConfiguration('github', { scopes: ['read'], repositories: ['fixture/one', 'fixture/two'], credentials: { accessToken: 'synthetic-app-private-token' } }, 0);
await store.verifyConnection('github', { accountId: '42', accountLabel: 'synthetic account', scopes: ['read'], repositories: ['fixture/one', 'fixture/two'], tools: [{ name: 'issue_read', semanticName: 'issue_read', scope: 'read', action: 'read', write: false, requiresConfirmation: false, inputSchema: { type: 'object', properties: { owner: { type: 'string' }, repo: { type: 'string' } }, required: ['owner', 'repo'], additionalProperties: false } }] }, 1);
const host = createHost({ cwd: process.cwd(), transportVersion: 'test', staticUiRoot: path.resolve('dist'), uiPorts: [4173], dataRoot, projectsRoot });
let browser;
try {
  await host.ready; await new Promise(resolve => host.server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${host.server.address().port}`;
  async function api(route, method = 'GET', body) {
    const response = await fetch(base + route, { method, headers: { origin: base, 'content-type': 'application/json', 'x-optracall-client': '1' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const value = await response.json(); assert.ok(response.ok, JSON.stringify(value)); return value;
  }
  await api('/api/configuration', 'PUT', { name: 'synthetic model', provider: 'openai-compatible', baseUrl: 'http://127.0.0.1:1/v1', model: 'synthetic', apiKey: 'synthetic-model-key' });
  const { project } = await api('/api/projects', 'POST', { name: '账号连接集成检查' });
  const { task } = await api(`/api/projects/${project.id}/tasks`, 'POST', { name: '原任务' });
  const draft = '原任务未发送草稿，切换设置后保留';
  await api(`/api/projects/${project.id}/tasks/${task.id}/draft`, 'PATCH', { text: draft });
  browser = await chromium.launch({ headless: true, executablePath: process.env.OPTRACALL_BROWSER_EXECUTABLE || '/usr/bin/chromium', args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [], external = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', route => { if (route.request().url().startsWith(base)) return route.continue(); external.push(route.request().url()); return route.abort(); });
  await page.goto(`${base}/?project=${project.id}&task=${task.id}`);
  await page.getByRole('textbox', { name: '消息', exact: true }).waitFor();
  assert.equal(await page.getByRole('textbox', { name: '消息', exact: true }).inputValue(), draft);
  await page.getByText('任务账号连接', { exact: true }).click();
  const taskPanel = page.locator('.task-service-connections'); await taskPanel.waitFor();
  await taskPanel.getByRole('checkbox').first().click();
  const dialog = page.getByRole('dialog', { name: '开启 GitHub 任务权限', exact: true }); await dialog.waitFor();
  await dialog.getByRole('checkbox', { name: 'fixture/two', exact: true }).uncheck();
  await dialog.getByRole('button', { name: '仅为本任务开启', exact: true }).click(); await dialog.waitFor({ state: 'hidden' });
  const bound = await api(`/api/projects/${project.id}/tasks/${task.id}`);
  assert.deepEqual(bound.task.serviceConnections.github.repositories, ['fixture/one']);
  await taskPanel.getByRole('button', { name: '管理 Gmail 连接', exact: true }).click();
  await page.getByRole('heading', { name: '连接你自己的账号', exact: true }).waitFor();
  assert.equal(await page.locator('.service-connection-card').count(), 4);
  await page.getByRole('button', { name: '连接 腾讯邮箱', exact: true }).click();
  const mailDialog = page.getByRole('dialog', { name: '连接 腾讯邮箱', exact: true }); await mailDialog.waitFor();
  await page.keyboard.press('Escape'); await mailDialog.waitFor({ state: 'hidden' });
  await page.waitForFunction(() => document.activeElement?.textContent === '连接 腾讯邮箱');
  await page.getByRole('button', { name: '返回任务开启连接', exact: true }).click();
  const composer = page.getByRole('textbox', { name: '消息', exact: true }); await composer.waitFor();
  assert.equal(await composer.inputValue(), draft);
  await page.waitForFunction(() => document.activeElement?.id === 'message-input');
  assert.ok(!await page.content().then(text => text.includes('synthetic-app-private-token')));
  await page.getByRole('button', { name: '设置', exact: true }).click(); await page.getByRole('button', { name: '连接配置', exact: true }).click();
  await page.getByRole('heading', { name: '连接你自己的账号', exact: true }).waitFor();
  await page.screenshot({ path: path.join(root, 'desktop.png'), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: path.join(root, 'narrow.png'), fullPage: true });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  assert.deepEqual(errors, []); assert.deepEqual(external, []);
  console.log(JSON.stringify({ result: 'PASS', evidence: root, paths: ['original task', 'task scope dialog', 'real Host persistence', 'settings', 'cancel/focus', 'return with draft', '390px'] }));
} finally {
  await browser?.close(); await host.close();
  // Keep synthetic screenshots as the review artifact; no account data is present.
}
