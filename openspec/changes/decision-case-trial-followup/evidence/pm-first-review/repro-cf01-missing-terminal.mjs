// Real Host + official Pi 1.4.0 + local synthetic Provider + Chromium browser E2E for Issue #154 (CF01–CF07).
// Run via: node tests/browser-case-trial-followup.mjs
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
const { chromium } = await import(process.env.OPTRACALL_PLAYWRIGHT_MODULE || 'playwright');
import { existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
const { startTestHost } = await import(pathToFileURL(path.resolve('tests/fixtures/host-process.ts')).href);
const { startToolProvider } = await import(pathToFileURL(path.resolve('tests/fixtures/tool-provider.ts')).href);

const chromiumExecutable = process.env.CHROMIUM_PATH
  ?? ['/opt/ms-playwright/chromium_headless_shell-1255/chrome-headless-shell-linux64/chrome-headless-shell', '/opt/ms-playwright/chromium-1255/chrome-linux64/chrome', '/usr/bin/chromium'].find(p => existsSync(p));

const port = Number(process.env.OPTRACALL_CF_TEST_PORT ?? 43956);
const outDir = path.resolve('.local/pm-review/edge-probe-delayed');
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

  // PM independent CF01 probe: real snapshot + sustained comment heartbeats, deliberately drop terminal events.
  await page.addInitScript(() => {
    const originalFetch = window.fetch.bind(window);
    window.__pmEventStats = { heartbeats: 0, streams: 0, reads: 0 };
    window.fetch = async (input, init) => {
      const url = new URL(typeof input === 'string' ? input : input.url, location.href);
      if (url.pathname === '/api/business-role' && url.searchParams.get('action') === 'events') {
        window.__pmEventStats.streams++;
        const readUrl = new URL(url); readUrl.searchParams.delete('action');
        const response = await originalFetch(readUrl, init); const value = await response.json();
        const encoder = new TextEncoder(); let timer;
        const body = new ReadableStream({
          start(controller) {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({type:'snapshot',snapshot:value.snapshot})}\n\n`));
            timer = setInterval(() => { window.__pmEventStats.heartbeats++; controller.enqueue(encoder.encode(': heartbeat\n\n')); }, 200);
            const close = () => { clearInterval(timer); try { controller.close(); } catch {} };
            init?.signal?.addEventListener('abort', close, {once:true}); window.__pmCloseFault = close;
          },
          cancel() { clearInterval(timer); }
        });
        return new Response(body, {status:200, headers:{'content-type':'text/event-stream'}});
      }
      if (url.pathname === '/api/business-role' && (init?.method ?? 'GET') === 'GET') window.__pmEventStats.reads++;
      return originalFetch(input, init);
    };
  });
  provider.setResponder(async () => { await new Promise(r=>setTimeout(r,3000)); return { text: 'PM 核对：这轮实际已经完成。' }; });
  await page.reload();
  await page.locator('nav.primary-nav').getByRole('button', { name: 'Decision Case', exact: true }).click();
  await page.getByRole('button', { name: 'CF05 验证准备件', exact: true }).first().click();
  const pmAgent = page.getByRole('region', {name:'Case Agent',exact:true});
  await pmAgent.getByText(/会话模型/).waitFor();
  const caseData = (await get('/api/cases')).cases.find(c=>c.title==='CF05 验证准备件');
  const issueData = (await get(`/api/cases/${caseData.id}/decisions/issues`)).issues[0];
  const ownerQuery = new URLSearchParams({owner:JSON.stringify({role:'case',caseId:caseData.id,itemId:issueData.id})});
  await pmAgent.getByRole('textbox').fill('请完成本轮核对');
  await pmAgent.getByRole('button', {name:'发送',exact:true}).click();
  await pmAgent.getByText('正在回复…',{exact:true}).waitFor();
  let state;
  for(let i=0;i<60;i++) {
    state = await get('/api/business-role?'+ownerQuery);
    if(!state.busy && state.discussion?.lastRun?.status==='completed') break;
    await new Promise(r=>setTimeout(r,250));
  }
  assert.equal(state.discussion?.lastRun?.status,'completed'); assert.equal(state.busy,false);
  const checkpoints=[];
  for(let i=0;i<10;i++) {
    await new Promise(r=>setTimeout(r,5000));
    const text = await pmAgent.innerText();
    checkpoints.push({seconds:(i+1)*5,stillReplying:text.includes('正在回复'),hasFinal:text.includes('PM 核对：这轮实际已经完成。'),stats:await page.evaluate(()=>window.__pmEventStats)});
    console.log(JSON.stringify({checkpoint:checkpoints.at(-1)}));
  }
  await page.screenshot({path:path.join(outDir,'pm-cf01-heartbeats-missing-terminal.png'),fullPage:true});
  const textBefore=await pmAgent.innerText();
  const backend = await get('/api/business-role?'+ownerQuery);
  const health = await get('/api/health');
  const writesBeforeClose=apiWrites.filter(w=>w.path.includes('/api/business-role'));
  await page.evaluate(()=>window.__pmCloseFault());
  await pmAgent.getByText('PM 核对：这轮实际已经完成。',{exact:true}).waitFor({timeout:10000});
  await page.screenshot({path:path.join(outDir,'pm-cf01-after-forcing-eof.png'),fullPage:true});
  await writeFile(path.join(outDir,'pm-cf01-heartbeats-receipt.json'),JSON.stringify({candidate:'d674deaa6c80e254bf97e2c4e022d3642f486eb1',condition:'controlled real initial snapshot, sustain heartbeats but omit terminal events; actual Host/Pi completes',runtime:health.runtime,backendBusy:backend.busy,backendStatus:backend.discussion?.lastRun?.status,checkpoints,textBefore,afterClose:await pmAgent.innerText(),writesBeforeClose,pageErrors,providerRequests:provider.requests.length},null,2));
  console.log('PM lost-terminal probe finished; see receipt.');
} finally {
  if (browser) await browser.close();
  frontend.kill('SIGTERM');
  await once(frontend, 'exit').catch(() => {});
  await provider.close();
  await host.close();
}
