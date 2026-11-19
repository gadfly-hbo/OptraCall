// #95: run from the repository root with Chrome and the optional Playwright tooling.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { readdir, readFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright';
import { startTestHost } from './fixtures/host-process.ts';
import { startToolProvider } from './fixtures/tool-provider.ts';

const listener = createServer().listen(0, '127.0.0.1');
await once(listener, 'listening');
const uiPort = listener.address().port;
await new Promise(resolve => listener.close(resolve));
const origin = 'http://127.0.0.1:' + uiPort;
const prompt = '## 原始问题 **原话不渲染**';
const toolText = '## 工具原文 **工具标记**';
const markdown = [
  '## 合成渠道结果',
  '',
  '总数**「120 份」**，存于 `020_clean/sample.csv`。',
  '',
  '- 核对样本数量',
  '',
  '| 渠道 | 数量 | 环比 | 依据 |',
  '| --- | --- | --- | --- |',
  '| 直营 | 120 | 10% | 合成表 |',
  '',
  '<span>字面 HTML</span>',
  '',
  '![示意图](https://example.invalid/synthetic.png)',
  '',
  '[合规链接](https://example.invalid/source) [非网页链接](data:text/plain,example)',
].join('\n');
const actions = ['整理为知识', '整理为经验', '反馈到资产体系', '带这条原回复核对目标'];
const provider = await startToolProvider();
const failures = [], traffic = [], pageErrors = [];
let host, frontend, browser;

function check(label, actual, expected) {
  try { assert.deepEqual(actual, expected); }
  catch (error) { failures.push({ label, actual, expected }); }
}

async function api(route, method, body) {
  const response = await host.request(route, method, body);
  assert.ok(response.ok, route + ' ' + response.status);
  return response.json();
}

async function inspectReply(reply) {
  return reply.locator('.message-content').evaluate(body => ({
    heading: Boolean(body.querySelector('h3,h4,h5,h6')),
    strong: body.querySelector('strong')?.textContent ?? null,
    list: body.querySelector('li')?.textContent ?? null,
    code: body.querySelector('code')?.textContent ?? null,
    cells: Array.from(body.querySelectorAll('td'), node => node.textContent),
    literalHtml: body.textContent.includes('<span>字面 HTML</span>'),
    imageCount: body.querySelectorAll('img').length,
    links: Array.from(body.querySelectorAll('a'), node => [node.href, node.rel]),
  }));
}

const rendered = {
  heading: true, strong: '「120 份」', list: '核对样本数量', code: '020_clean/sample.csv',
  cells: ['直营', '120', '10%', '合成表'], literalHtml: true, imageCount: 0,
  links: [['https://example.invalid/source', 'noopener noreferrer']],
};

try {
  host = await startTestHost({ uiPort });
  await api('/api/configuration', 'PUT', {
    name: '隔离合成模型', provider: 'openai-compatible', model: 'synthetic-analysis',
    baseUrl: provider.baseUrl, apiKey: 'synthetic-analysis',
  });
  const { project } = await api('/api/projects', 'POST', { name: '隔离 Markdown 回归项目' });
  const tasksPath = '/api/projects/' + project.id + '/tasks';
  const { task: saved } = await api(tasksPath, 'POST', { name: '合成历史分析' });
  const { task: live } = await api(tasksPath, 'POST', { name: '合成实时分析' });
  const savedPath = tasksPath + '/' + saved.id;
  provider.setResponder(context => context.recentToolResults.length ? { text: markdown } : {
    calls: [{ name: 'bash', arguments: { command: "printf '%s' '" + toolText + "'" } }],
  });
  await api(savedPath + '/messages', 'POST', { requestId: crypto.randomUUID(), text: prompt });
  const deadline = Date.now() + 20_000;
  let detail;
  do {
    detail = await api(savedPath);
    if (detail.task.lastRun?.status === 'completed') break;
    assert.ok(Date.now() < deadline && detail.task.lastRun?.status !== 'failed', 'Synthetic analysis must complete.');
    await delay(40);
  } while (true);
  const nativeBefore = await readFile(detail.task.sessionFile);
  const native = detail.snapshot.messages.filter(message => message.role === 'assistant' && message.content?.some?.(part => part.text === markdown)).at(-1);
  assert.ok(native?.nativeEntryId && native.nativeSessionId, 'A finalized reply must expose its real native source identity.');
  assert.equal(provider.requests.length, 2, 'One turn with one actual local tool execution.');

  frontend = spawn(process.execPath, ['scripts/frontend.mjs', 'dev', '--port', String(uiPort), '--strictPort'], {
    env: { ...process.env, OPTRACALL_HOST_PORT: String(host.port) }, stdio: ['ignore', 'pipe', 'inherit'],
  });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Isolated frontend startup timed out.')), 10_000);
    frontend.stdout.on('data', chunk => { if (chunk.toString().includes(origin + '/')) { clearTimeout(timer); resolve(); } });
    frontend.once('exit', code => { clearTimeout(timer); reject(new Error('Isolated frontend exited ' + code)); });
  });
  browser = await chromium.launch({ channel: 'chrome', args: ['--disable-background-networking'] });
  const context = await browser.newContext({ viewport: { width: 1440, height: 920 }, serviceWorkers: 'block' });
  await context.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.origin === origin) return route.continue();
    traffic.push(url.origin);
    return route.abort();
  });
  const page = await context.newPage();
  page.setDefaultTimeout(8000);
  page.on('pageerror', error => pageErrors.push(error.message));
  const taskUrl = task => origin + '/?' + new URLSearchParams({ project: project.id, task: task.id });

  await page.goto(taskUrl(saved));
  const reply = page.locator('article.message.assistant').filter({ hasText: '合成渠道结果' });
  await reply.waitFor();
  check('persisted Markdown structure and safe display', await inspectReply(reply), rendered);
  check('one finalized message', await reply.count(), 1);
  check('user text remains literal', await page.locator('.message.user .message-content').textContent(), prompt);
  const tool = page.locator('.tool-message').filter({ hasText: toolText });
  check('tool result remains literal', await tool.locator('pre').textContent(), toolText);
  for (const name of actions) check(name + ' retains native receipt eligibility', await reply.getByRole('button', { name, exact: true }).isEnabled(), true);
  const gaps = await reply.locator(':scope > .report-action-row').evaluateAll(rows => rows.slice(0, 2).map(row => {
    const [left, right] = [...row.querySelectorAll('button')].map(button => button.getBoundingClientRect());
    return right.left - left.right;
  }));
  check('both horizontal groups use the confirmed 14 px gap', gaps, [14, 14]);

  await page.getByRole('button', { name: '将最新回复保存为最终报告', exact: true }).click();
  await page.getByText('这条回复已明确保存为 060_reports 中的最终报告。', { exact: true }).waitFor();
  const reports = path.join(host.projectsRoot, project.id, '060_reports');
  const entries = await readdir(reports);
  assert.equal(entries.length, 1);
  check('report retains the original Markdown bytes', await readFile(path.join(reports, entries[0]), 'utf8'), markdown);

  await page.setViewportSize({ width: 320, height: 900 });
  await page.reload();
  await reply.waitFor();
  check('reopened Markdown structure', await inspectReply(reply), rendered);
  check('reopen does not duplicate reply', await reply.count(), 1);
  const region = reply.getByRole('region', { name: '回复表格' });
  const geometry = await region.count() ? await region.evaluate(element => {
    const rect = element.getBoundingClientRect();
    return {
      scrollsLocally: element.scrollWidth > element.clientWidth && getComputedStyle(element).overflowX === 'auto',
      fitsViewport: rect.left >= 0 && rect.right <= innerWidth && document.documentElement.scrollWidth === innerWidth,
      focusable: element.tabIndex === 0,
    };
  }) : null;
  check('320 px wide table scroll is local and keyboard-accessible', geometry, { scrollsLocally: true, fitsViewport: true, focusable: true });
  check('opening history did not call the provider', provider.requests.length, 2);
  check('native history is byte-identical after reading and report save', (await readFile(detail.task.sessionFile)).equals(nativeBefore), true);

  provider.setResponder(() => ({ text: markdown, hold: true }));
  await page.setViewportSize({ width: 1440, height: 920 });
  await page.goto(taskUrl(live));
  await page.getByRole('textbox', { name: '消息', exact: true }).fill('显示同一份合成结果。');
  await page.getByRole('button', { name: '发送消息', exact: true }).click();
  const stream = page.locator('article.streaming-message').filter({ hasText: '合成渠道结果' });
  await stream.getByText('非网页链接', { exact: false }).waitFor();
  check('live Markdown structure before response completion', await inspectReply(stream), rendered);
  check('unsettled live stream has no source actions', await stream.locator('.report-action-row').count(), 0);
  await page.getByRole('button', { name: '停止生成', exact: true }).click();
  await stream.waitFor({ state: 'hidden' });
  check('only isolated Provider calls', provider.requests.length, 3);
  check('no provider errors', provider.errors, []);
  check('no external browser traffic', traffic, []);
  check('no browser errors', pageErrors, []);
  console.log(JSON.stringify({ gaps, geometry, failures }, null, 2));
  assert.equal(failures.length, 0, '#95 analysis Markdown regression');
} finally {
  await browser?.close();
  if (frontend?.exitCode === null && frontend.signalCode === null) {
    const exited = once(frontend, 'exit');
    frontend.kill('SIGTERM');
    await exited;
  }
  await host?.close();
  await provider.close();
}
