// Actual React components, synthetic loopback API only. No provider login or external call.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { build } from 'esbuild';
const { chromium } = await import(process.env.OPTRACALL_PLAYWRIGHT_MODULE || 'playwright');

const work = await mkdtemp(path.join(tmpdir(), 'optracall-service-ui-'));
const connections = new Map();
const calls = [];
const pending = new Map();
const authorizationResults = new Map();
let task = { id: 'task-a', serviceConnections: {} }, nextOAuthError, disconnectUnknown = false, attemptNumber = 0;
const secrets = ['synthetic-pat-sentinel', 'synthetic-authorization-code-sentinel', 'synthetic-provider-error-sentinel'];
const tool = { name: 'read_content', semanticName: 'read_content', inputSchema: { type: 'object' }, scope: 'read', action: 'read', write: false, requiresConfirmation: false };
const presence = { accessToken: false, refreshToken: false, clientSecret: false, authorizationCode: false };
function snapshot(service) { return { connection: connections.get(service), ...(pending.has(service) ? { authorization: pending.get(service) } : {}), ...(authorizationResults.has(service) ? { authorizationResult: authorizationResults.get(service) } : {}), affectedTasks: task.serviceConnections[service] ? ['合成项目 / 原任务'] : [] }; }
function binding(connection, input) {
  return { service: connection.service, connectionId: connection.connectionId, accountId: connection.accountId, accountLabel: connection.accountLabel, revision: connection.revision, scopes: input.scopes, tools: [tool], ...(connection.repositories ? { repositories: input.repositories ?? connection.repositories } : {}), ...(connection.mailboxType ? { mailboxType: connection.mailboxType } : {}), ...(connection.tenantId ? { tenantId: connection.tenantId, appId: connection.appId } : {}) };
}
let browser, server;
try {
  const bundle = await build({ stdin: { contents: `
    import {useState} from 'react'; import {createRoot} from 'react-dom/client';
    import {ServiceConnectionsSettings,TaskServiceConnections} from './src/host/ui/ServiceConnections.tsx';
    import './src/host/ui/styles.css';
    function Fixture(){const [settings,setSettings]=useState(true),[draft,setDraft]=useState('保留的原任务草稿'),[task,setTask]=useState({id:'task-a',serviceConnections:{}}),[busy,setBusy]=useState(false);
      return <div className="app" style={{overflow:'auto',display:'block',height:'auto',minHeight:'100vh'}}><main style={{maxWidth:1000,margin:'auto',padding:20}}><button onClick={()=>setSettings(true)}>打开连接设置</button><button onClick={()=>setSettings(false)}>返回原任务</button><div hidden={!settings}><ServiceConnectionsSettings onProject={()=>setSettings(false)}/></div><section hidden={settings}><label>原任务消息<textarea aria-label="原任务消息" value={draft} onChange={e=>setDraft(e.target.value)}/></label><button onClick={()=>setBusy(value=>!value)}>切换合成任务占用</button><TaskServiceConnections projectId="project-a" taskId="task-a" bindings={task.serviceConnections} disabled={busy} onChanged={setTask} onSettings={()=>setSettings(true)}/></section></main></div>};createRoot(document.getElementById('root')).render(<Fixture/>);
  `, resolveDir: process.cwd(), loader: 'tsx' }, bundle: true, outfile: path.join(work, 'bundle.js'), jsx: 'automatic', format: 'esm', define: { 'process.env.NODE_ENV': '"test"' }, write: true });
  await writeFile(path.join(work, 'index.html'), '<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/bundle.css"><div id="root"></div><script type="module" src="/bundle.js"></script></html>');
  server = createServer(async (request, response) => { try { const filename = request.url === '/bundle.js' ? 'bundle.js' : request.url === '/bundle.css' ? 'bundle.css' : 'index.html'; response.setHeader('content-type', filename.endsWith('.js') ? 'text/javascript' : filename.endsWith('.css') ? 'text/css' : 'text/html'); response.end(await readFile(path.join(work, filename))); } catch { response.writeHead(404).end(); } });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  browser = await chromium.launch({ executablePath: process.env.OPTRACALL_CHROMIUM_PATH || '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
  page.setDefaultTimeout(15000);
  const consoleErrors = []; page.on('pageerror', error => consoleErrors.push(error.message));
  await page.route('**/api/**', async route => {
    const request = route.request(), url = new URL(request.url()), method = request.method(), input = request.postDataJSON(); calls.push({ path: url.pathname, method, input });
    let value, status = 200;
    const parts = url.pathname.split('/'), service = parts[3], action = parts.slice(4).join('/');
    if (url.pathname === '/api/service-connections') value = { connections: [...connections.values()] };
    else if (url.pathname.startsWith('/api/service-connections/')) {
      if (method === 'PUT') {
        const old = connections.get(service), credentialsConfigured = { ...presence, ...old?.credentialsConfigured };
        for (const key of Object.keys(input.credentials ?? {})) if (key in credentialsConfigured) credentialsConfigured[key] = true;
        authorizationResults.delete(service);
        // A replacement configuration is staged; old verified A stays authoritative until adoption.
        if (old?.status !== 'verified') connections.set(service, { ...old, ...input.config, service, connectionId: old?.connectionId ?? 'connection-' + service, revision: (old?.revision ?? 0) + 1, status: 'unverified', tools: [], credentialsConfigured, updatedAt: '2026-11-27T00:00:00Z' }); value = snapshot(service);
      } else if (action === 'connect' || action === 'verify') {
        const connection = connections.get(service); Object.assign(connection, { status: 'verified', accountId: service + '-account-a', accountLabel: service === 'github' ? '@synthetic-a' : connection.email ?? service + '-synthetic@example.invalid', verifiedAt: '2026-11-27T00:00:00Z', tools: [tool] }); value = snapshot(service);
      } else if (action === 'oauth/start') {
        if (nextOAuthError) { status = 403; value = { code: nextOAuthError, message: secrets[2] }; nextOAuthError = undefined; }
        else { authorizationResults.delete(service); if (connections.get(service).status !== 'verified') connections.get(service).status = 'authorizing'; pending.set(service, { url: service === 'gmail' ? 'https://accounts.google.com/o/oauth2/v2/auth?state=synthetic' : service === 'github' ? 'https://github.com/login/oauth/authorize?state=synthetic' : 'https://accounts.feishu.cn/authorize?state=synthetic', attemptId: 'attempt-' + service + '-' + ++attemptNumber }); value = snapshot(service); }
      } else if (action === 'oauth/cancel') { assert.equal(input.attemptId, pending.get(service)?.attemptId); pending.delete(service); if (connections.get(service).status !== 'verified') connections.get(service).status = 'unverified'; authorizationResults.set(service, { attemptId: input.attemptId, status: 'cancelled' }); value = snapshot(service); }
      else if (action === 'disconnect') { connections.get(service).status = disconnectUnknown ? 'unknown' : 'disconnected'; if (disconnectUnknown) { status = 409; value = { code: 'service_cleanup_unknown' }; } else value = snapshot(service); }
      else value = snapshot(service);
    } else if (url.pathname.includes('/tasks/task-a/service-connections/')) {
      const selected = parts.at(-1), connection = connections.get(selected);
      if (input.enabled) task.serviceConnections[selected] = binding(connection, input); else delete task.serviceConnections[selected];
      value = { task: structuredClone(task) };
    } else { status = 404; value = { code: 'fixture_route_missing' }; }
    await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(value) });
  });
  await page.route('https://**/*', route => route.abort());
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  await page.getByRole('heading', { name: '连接你自己的账号' }).waitFor();
  const card = service => page.getByRole('article').filter({ has: page.getByRole('heading', { name: service, exact: true }) });
  await card('GitHub').getByRole('button', { name: '连接 GitHub', exact: true }).click();
  let dialog = page.getByRole('dialog', { name: '连接 GitHub', exact: true });
  await dialog.getByLabel('连接方式').selectOption('pat');
  await dialog.getByLabel('允许使用的仓库').fill('team/one, team/two');
  await dialog.getByRole('radio', { name: '读取、Issue / PR 协作', exact: true }).check();
  await dialog.getByLabel('细粒度访问令牌', { exact: true }).fill(secrets[0]);
  await dialog.getByRole('button', { name: '仅保存配置' }).click();
  await dialog.getByText('配置已保存。尚需连接并核验实际账号与权限。', { exact: true }).waitFor();
  assert.equal(await dialog.getByLabel('细粒度访问令牌', { exact: true }).inputValue(), '');
  assert.match(await card('GitHub').textContent(), /已保存 · 尚未核验/);
  assert.equal(calls.some(call => call.path.endsWith('/connect')), false, 'Save does not prove connectivity or call connect');
  await dialog.getByRole('button', { name: '保存并核验连接' }).click();
  await dialog.getByText(/当前已核验：@synthetic-a/).waitFor();
  await dialog.getByRole('button', { name: '取消', exact: true }).click();
  await page.waitForFunction(() => document.activeElement?.textContent === '管理连接');
  assert.equal(await page.locator('body').textContent().then(text => secrets.some(secret => text.includes(secret))), false);
  assert.equal(await page.evaluate(() => localStorage.length + sessionStorage.length), 0);

  const originalGithub = structuredClone(connections.get('github'));
  await card('GitHub').getByRole('button', { name: '管理连接', exact: true }).click();
  dialog = page.getByRole('dialog', { name: '连接 GitHub', exact: true });
  await dialog.getByLabel('连接方式').selectOption('oauth');
  await dialog.getByLabel('OAuth Client ID', { exact: true }).fill('synthetic-github-client');
  await dialog.getByRole('button', { name: '保存并开始授权' }).click();
  await dialog.getByRole('link', { name: /前往 GitHub 官方授权页面/ }).waitFor();
  assert.equal(await dialog.getByText('已核验实际账号与工具。回到原任务后可单独开启。', { exact: true }).count(), 0, 'Existing verified A cannot prove the new pending attempt succeeded');
  const failedAttempt = pending.get('github').attemptId;
  pending.delete('github'); authorizationResults.set('github', { attemptId: failedAttempt, status: 'failed', code: 'provider_failed', message: secrets[2] });
  await dialog.getByRole('alert').getByText(/本次账号授权失败/).waitFor();
  await dialog.getByRole('button', { name: '查询当前连接状态', exact: true }).click();
  await dialog.getByRole('alert').getByText(/本次账号授权失败/).waitFor();
  await page.waitForFunction(() => document.activeElement?.textContent === '查询当前连接状态' && document.activeElement.getAttribute('aria-disabled') !== 'true');
  assert.equal(await dialog.getByText(/本次账号授权已完成/).count(), 0);
  assert.equal((await dialog.textContent()).includes(secrets[2]), false);
  assert.deepEqual(connections.get('github'), originalGithub, 'Failed replacement authorization preserves verified A byte-for-byte');
  await dialog.getByRole('button', { name: '取消', exact: true }).click();
  assert.match(await card('GitHub').textContent(), /已核验/);
  assert.match(await card('GitHub').textContent(), /@synthetic-a/);

  await card('GitHub').getByRole('button', { name: '管理连接', exact: true }).click();
  dialog = page.getByRole('dialog', { name: '连接 GitHub', exact: true });
  await dialog.getByLabel('连接方式').selectOption('oauth');
  await dialog.getByLabel('OAuth Client ID', { exact: true }).fill('synthetic-github-client');
  await dialog.getByRole('button', { name: '保存并开始授权' }).click();
  await dialog.getByRole('button', { name: '取消本次授权', exact: true }).click();
  await dialog.waitFor({ state: 'hidden' });
  await page.getByText('本次账号授权已取消。原有连接与任务选择保留。', { exact: true }).waitFor();
  assert.deepEqual(connections.get('github'), originalGithub, 'Cancelling replacement authorization preserves verified A');

  await card('Gmail').getByRole('button', { name: '连接 Gmail', exact: true }).click();
  dialog = page.getByRole('dialog', { name: '连接 Gmail', exact: true });
  await dialog.getByLabel('OAuth Client ID', { exact: true }).fill('synthetic-client-id');
  await dialog.getByRole('button', { name: '保存并开始授权' }).click();
  assert.match(await dialog.getByRole('link', { name: /前往 Gmail 官方授权页面/ }).getAttribute('href'), /^https:\/\/accounts\.google\.com\//);
  await dialog.getByRole('button', { name: '取消本次授权' }).click();
  await dialog.waitFor({ state: 'hidden' });
  assert.equal(calls.filter(call => call.path === '/api/service-connections/gmail/oauth/cancel').length, 1);
  assert.equal(calls.some(call => call.path === '/api/service-connections/github/disconnect'), false);
  assert.equal(connections.get('github').status, 'verified');
  nextOAuthError = 'service_permission_missing';
  await card('Gmail').getByRole('button', { name: '连接 Gmail', exact: true }).click();
  dialog = page.getByRole('dialog', { name: '连接 Gmail', exact: true });
  await dialog.getByRole('button', { name: '保存并开始授权' }).click();
  await dialog.getByRole('alert').getByText(/账号未获得所需权限/).waitFor();
  assert.equal((await dialog.textContent()).includes(secrets[2]), false);
  await page.keyboard.press('Escape');
  await dialog.waitFor({ state: 'hidden' });

  await card('腾讯邮箱').getByRole('button', { name: '连接 腾讯邮箱', exact: true }).click();
  dialog = page.getByRole('dialog', { name: '连接 腾讯邮箱', exact: true });
  await dialog.getByLabel('邮箱地址', { exact: true }).fill('synthetic@qq.com');
  const codeInput = dialog.getByLabel('客户端授权码', { exact: true }); assert.equal(await codeInput.getAttribute('type'), 'password');
  await codeInput.fill(secrets[1]);
  await dialog.getByRole('button', { name: '保存并核验连接' }).click();
  await dialog.getByText(/当前已核验：synthetic@qq.com/).waitFor();
  assert.equal(await codeInput.inputValue(), '');
  await dialog.getByRole('button', { name: '取消', exact: true }).click();
  nextOAuthError = 'feishu_admin_required';
  await card('飞书').getByRole('button', { name: '连接 飞书', exact: true }).click();
  dialog = page.getByRole('dialog', { name: '连接 飞书', exact: true });
  await dialog.getByRole('button', { name: '保存并开始授权' }).click();
  await dialog.getByRole('alert').getByText(/企业管理员尚未安装官方应用/).waitFor();
  await page.keyboard.press('Escape');

  await page.getByRole('button', { name: '返回原任务', exact: true }).click();
  const draft = page.getByRole('textbox', { name: '原任务消息', exact: true });
  assert.equal(await draft.inputValue(), '保留的原任务草稿');
  const githubToggle = page.getByRole('checkbox', { name: 'GitHub', exact: false });
  assert.equal(await githubToggle.isChecked(), false);
  await githubToggle.click();
  dialog = page.getByRole('dialog', { name: '开启 GitHub 任务权限', exact: true });
  await dialog.getByRole('checkbox', { name: 'team/two', exact: true }).uncheck();
  await dialog.getByRole('button', { name: '仅为本任务开启', exact: true }).click();
  await dialog.waitFor({ state: 'hidden' });
  assert.deepEqual(task.serviceConnections.github.scopes, ['read']);
  assert.deepEqual(connections.get('github').scopes, ['read', 'collaborate']);
  assert.deepEqual(task.serviceConnections.github.repositories, ['team/one']);
  assert.equal(await githubToggle.isChecked(), true);
  const taskCalls = () => calls.filter(call => call.path.includes('/tasks/task-a/service-connections/'));
  const beforeRebind = taskCalls().length;
  Object.assign(connections.get('github'), { revision: connections.get('github').revision + 1, accountId: 'github-account-b', accountLabel: '@synthetic-b' });
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await page.getByText(/绑定已变化 · 请重新选择/).waitFor();
  assert.equal(await githubToggle.isChecked(), true, 'Changed identity keeps the original selection');
  assert.equal(taskCalls().length, beforeRebind, 'Identity observation never silently rebinds');
  await page.getByRole('button', { name: '核对当前账号并重新选择' }).click();
  dialog = page.getByRole('dialog', { name: '核对 GitHub 任务权限', exact: true });
  assert.match(await dialog.textContent(), /原任务绑定：@synthetic-a/); assert.match(await dialog.textContent(), /当前已核验：@synthetic-b/);
  await dialog.getByRole('button', { name: '取消', exact: true }).click();
  assert.equal(task.serviceConnections.github.accountId, 'github-account-a');
  await page.getByRole('button', { name: '核对当前账号并重新选择' }).click();
  await page.getByRole('dialog').getByRole('button', { name: '确认账号并重新绑定' }).click();
  await page.getByRole('dialog').waitFor({ state: 'hidden' });
  assert.equal(task.serviceConnections.github.accountId, 'github-account-b');
  assert.deepEqual(task.serviceConnections.github.repositories, ['team/one']);
  assert.equal(taskCalls().at(-1).input.expectedConnectionRevision, connections.get('github').revision);
  connections.get('github').status = 'expired';
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await page.getByText(/连接暂不可用 · 保留原选择/).waitFor();
  assert.equal(await githubToggle.isChecked(), true);
  await page.getByRole('button', { name: '切换合成任务占用' }).click(); assert.equal(await githubToggle.isDisabled(), true);
  await page.getByRole('button', { name: '切换合成任务占用' }).click();

  connections.get('github').status = 'verified';
  await page.getByRole('button', { name: '打开连接设置', exact: true }).click();
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await card('GitHub').getByRole('button', { name: '断开', exact: true }).click();
  dialog = page.getByRole('dialog', { name: '断开 GitHub', exact: true });
  await dialog.getByText('合成项目 / 原任务', { exact: true }).waitFor();
  disconnectUnknown = true;
  await dialog.getByRole('button', { name: '断开连接', exact: true }).click();
  try { await page.getByRole('alert').getByText('后续调用资格已撤销，连接资源收尾结果尚待核对。请先查询当前状态。', { exact: true }).waitFor(); }
  catch (error) { console.error('Visible fixed notices:', await page.getByRole('alert').allTextContents()); console.error('Recent request paths:', calls.slice(-8).map(call => `${call.method} ${call.path}`)); throw error; }
  assert.equal(calls.filter(call => call.path === '/api/service-connections/github/disconnect').length, 1, 'Failed cleanup is observed, never automatically repeated');
  assert.match(await card('GitHub').textContent(), /结果待核/);
  assert.equal(task.serviceConnections.github.accountId, 'github-account-b');
  assert.equal(connections.get('tencent').status, 'verified');

  const artifacts = process.env.OPTRACALL_SERVICE_UI_ARTIFACTS;
  if (artifacts) { await mkdir(artifacts, { recursive: true }); await page.screenshot({ path: path.join(artifacts, 'service-connections-desktop.png'), fullPage: true }); }
  await page.setViewportSize({ width: 390, height: 844 });
  if (artifacts) await page.screenshot({ path: path.join(artifacts, 'service-connections-narrow.png'), fullPage: true });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'Narrow settings have no horizontal overflow');
  await card('腾讯邮箱').getByRole('button', { name: '管理连接', exact: true }).click();
  dialog = page.getByRole('dialog', { name: '连接 腾讯邮箱', exact: true });
  if (artifacts) await page.screenshot({ path: path.join(artifacts, 'service-connections-dialog-narrow.png'), fullPage: true });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.keyboard.press('Escape'); await dialog.waitFor({ state: 'hidden' });
  await page.getByRole('button', { name: '返回原任务', exact: true }).click();
  assert.equal(await draft.inputValue(), '保留的原任务草稿');
  assert.equal(await page.evaluate(() => localStorage.length + sessionStorage.length), 0);
  assert.equal(await page.locator('body').textContent().then(text => secrets.some(secret => text.includes(secret))), false);
  assert.deepEqual(consoleErrors, []);
  console.log('PASS actual four-service React UI: save/verify, credential redaction, exact OAuth attempt failures/cancellation preserving verified A, admin guidance, explicit task rebind/narrowing, expired intent, busy protection, disconnect UNKNOWN, focus and 390px layout.');
} finally {
  await browser?.close();
  await new Promise(resolve => server ? server.close(resolve) : resolve());
  await rm(work, { recursive: true, force: true });
}
