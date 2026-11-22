// Issue #115 browser point-check against an isolated Host serving the stamped product UI.
// Uses the globally installed playwright (from @playwright/mcp) with the system Chrome channel,
// so no project dependency is added or changed. Run: node tests/browser-issue-115-strategy-loop.mjs
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, mkdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { startToolProvider } from './fixtures/tool-provider.ts';
import { runtimeEnvironment, workspaceRoot } from '../scripts/runtime-process.ts';

const require = createRequire(import.meta.url);
const { chromium } = require('/opt/homebrew/lib/node_modules/@playwright/mcp/node_modules/playwright');
const root = fileURLToPath(new URL('../', import.meta.url));
const uid = () => crypto.randomUUID();

async function startIsolatedHost() {
  const scratch = await mkdtemp(path.join(os.tmpdir(), 'issue115-browser-host-'));
  const entry = path.join(root, 'scripts/host-entry.mjs');
  const child = spawn(process.execPath, [entry, '--port=0', '--ui-port=4193', `--ui-root=${path.join(root, 'dist')}`, `--data-root=${path.join(scratch, 'host')}`, `--projects-root=${path.join(scratch, 'projects')}`, '--connection-timeout-ms=4000'], { cwd: root, env: runtimeEnvironment(), stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '', stderr = '';
  child.stdout.on('data', c => { stdout += c.toString(); });
  child.stderr.on('data', c => { stderr += c.toString(); });
  const port = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => { child.kill('SIGTERM'); reject(new Error('Host startup timed out: ' + stderr)); }, 15000);
    child.stdout.on('data', () => { for (const line of stdout.split('\n')) { try { const d = JSON.parse(line); if (d.kind === 'host-ready') { clearTimeout(timer); resolve(d.port); } } catch {} } });
    child.once('exit', code => { clearTimeout(timer); reject(new Error(`Host exited during startup (${code}): ${stderr}`)); });
  });
  return { baseUrl: `http://127.0.0.1:${port}`, scratch, close: async () => { if (child.exitCode !== null) return; child.kill('SIGTERM'); await once(child, 'exit'); } };
}

let host, provider, browser;
(async () => {
  host = await startIsolatedHost();
  provider = await startToolProvider();
  const base = host.baseUrl;
  const api = async (route, method = 'GET', body) => {
    const r = await fetch(base + route, { method, headers: { origin: base, 'x-optracall-client': '1', 'content-type': 'application/json' }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
    if (!r.ok) throw new Error(route + ' ' + r.status + ' ' + await r.text());
    return r.json();
  };
  const { configuration } = await api('/api/configuration', 'PUT', { name: 'Issue115 合成循环模型', provider: 'openai-compatible', model: 'synthetic', baseUrl: provider.baseUrl, apiKey: 'synthetic-only' });
  const id = uid();
  await api('/api/strategy/discussions', 'POST', { title: 'Issue115 止损与路径点验', operationId: id, configurationId: configuration.id });

  // Provider keeps calling read-goals; the Host read-loop guard must stop it before the 7th dispatch.
  provider.setResponder(() => ({ calls: [{ name: 'strategy_goals', arguments: { action: 'read-goals', query: '合成循环' } }] }));

  const evidence = path.join(root, '.local/issue-115/browser');
  await mkdir(evidence, { recursive: true });
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: 'block' });
  await context.route('**/*', intercepted => new URL(intercepted.request().url()).origin === base ? intercepted.continue() : intercepted.abort());
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.setDefaultTimeout(20000);

  await page.goto(base);
  await page.getByRole('button', { name: '战略选择', exact: true }).click();
  await page.getByText('说说你正在考虑的战略问题。可以从比较两个方向开始。', { exact: true }).waitFor();
  await page.locator('label').filter({ hasText: /^原讨论/ }).locator('select').selectOption(id);
  const input = page.getByLabel('战略讨论问题');

  // 1. Send a message that drives the read-goals loop; expect the dedicated stop alert.
  await input.fill('请围绕会员复购展开战略讨论。');
  await page.getByRole('button', { name: '发送讨论', exact: true }).click();
  const loopAlert = page.getByRole('alert').filter({ hasText: /连续重复同一读取动作/ });
  await loopAlert.waitFor();
  assert.match(await loopAlert.innerText(), /不代表资料缺失或不可读/);
  assert.match(await loopAlert.innerText(), /改用另一已配置模型/);
  await page.screenshot({ path: path.join(evidence, 'loop-stop-alert.png'), fullPage: true });
  assert.equal(provider.requests.length, 7, 'six Host reads dispatch; the seventh is stopped before Host and no Provider continuation');

  // 2. Refresh restores the loop diagnostic from the saved native run.
  await page.getByRole('button', { name: '刷新讨论记录', exact: true }).click();
  await page.getByRole('alert').filter({ hasText: /连续重复同一读取动作/ }).waitFor();
  await page.screenshot({ path: path.join(evidence, 'loop-alert-after-refresh.png'), fullPage: true });

  // 3. A local file path in the composer shows the non-blocking upload hint; an ordinary question does not.
  await input.fill('请读取 /Users/synthetic/strategy-plan.md 并总结');
  await page.getByText('检测到本地文件路径', { exact: false }).waitFor();
  assert.equal(await page.getByRole('button', { name: '发送讨论', exact: true }).isEnabled(), true, 'path hint must not block sending');
  await page.screenshot({ path: path.join(evidence, 'path-hint.png'), fullPage: true });
  await input.fill('下季度该优先拓新客，还是提高复购？');
  assert.equal(await page.getByText('检测到本地文件路径').count(), 0, 'ordinary question shows no path hint');

  // 4. Narrow viewport: hint and alert do not overflow.
  await page.setViewportSize({ width: 390, height: 844 });
  await input.fill('请读取 /Users/synthetic/strategy-plan.md');
  await page.getByText('检测到本地文件路径').waitFor();
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), false, 'no horizontal overflow at 390px');
  await page.screenshot({ path: path.join(evidence, 'path-hint-narrow.png'), fullPage: true });

  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ providerRequests: provider.requests.length, pageErrors: errors, evidence }));
  console.log('PASS Issue #115 browser verification (loop stop alert, refresh restore, path hint, narrow viewport)');
})().catch(e => { console.error(e); process.exitCode = 1; }).finally(async () => { await browser?.close(); await provider?.close(); await host?.close(); });
