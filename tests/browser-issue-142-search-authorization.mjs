// Run after npm run build. Each browser context starts with its own UI state.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { chromium } from 'playwright';
import { createHost } from '../src/host/server.ts';

let host, browser, root, base, fixtureCase, project, task;
const projectName = '复核项目';
const taskName = '复核任务';
const caseTitle = '复核经营问题';

async function write(route, method, body) {
  const response = await fetch(base + route, {
    method, headers: { origin: base, 'content-type': 'application/json', 'x-optracall-client': '1' },
    body: JSON.stringify(body),
  });
  const result = await response.json();
  assert.ok(response.ok, route + ' ' + JSON.stringify(result));
  return result;
}

before(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'optracall-142-search-'));
  host = createHost({ cwd: process.cwd(), staticUiRoot: path.resolve('dist'), uiPorts: [4173],
    dataRoot: path.join(root, 'data'), projectsRoot: path.join(root, 'projects'), transportVersion: 'test' });
  await host.ready;
  await new Promise(resolve => host.server.listen(0, '127.0.0.1', resolve));
  base = 'http://127.0.0.1:' + host.server.address().port;
  browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH });
  await write('/api/cases/storage/initialize', 'POST', {});
  await write('/api/configuration', 'PUT', { name: '合成模型', provider: 'openai-compatible',
    baseUrl: 'http://127.0.0.1:9999/v1', model: 'synthetic', apiKey: 'synthetic-only' });
  const enterprise = await write('/api/studio/enterprises', 'POST', { requestId: randomUUID(), name: '复核企业' });
  const { goal } = await write('/api/strategy/goals', 'POST', { operationId: randomUUID(), title: '复核目标',
    outcome: '复核目标', perspective: 'profit', scope: { kind: 'enterprise', id: enterprise.id, name: enterprise.name },
    measurement: { kind: 'deliverable', criterion: '可核对' }, baseline: { state: 'pending', description: '待核' },
    responsible: '区域负责人', strategies: ['核对来源'] });
  await write('/api/strategy/goals/' + goal.goalId + '/adopt', 'POST', {
    operationId: randomUUID(), expectedVersion: goal.version, version: goal.version, decision: '采纳',
  });
  ({ case: fixtureCase } = await write('/api/cases', 'POST', { operationId: randomUUID(), title: caseTitle,
    description: '合成问题', goalBinding: { primary: { goalId: goal.goalId, version: goal.version }, related: [], strategy: '核对来源' } }));
  ({ project } = await write('/api/projects', 'POST', { name: projectName }));
  ({ task } = await write('/api/projects/' + project.id + '/tasks', 'POST', { name: taskName }));
});

after(async () => {
  await browser?.close();
  if (host) { host.server.close(); await host.close(); }
  if (root) await rm(root, { recursive: true, force: true });
});

async function setup(t, url = base) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  t.after(() => context.close());
  const page = await context.newPage();
  page.setDefaultTimeout(6000);
  await page.goto(String(url));
  const dialog = page.getByRole('dialog', { name: '搜索工作区' });
  const open = async query => {
    await page.getByRole('button', { name: '搜索工作区', exact: true }).click();
    await dialog.getByRole('searchbox').fill(query);
  };
  return { page, dialog, open };
}

test('A new search discloses records only after its own Case and project reads succeed', async t => {
  const { page, dialog, open } = await setup(t);
  await page.getByRole('heading', { name: caseTitle, level: 2, exact: true }).waitFor();
  await open('复核');
  await dialog.getByRole('button', { name: new RegExp(caseTitle) }).waitFor();
  await dialog.getByRole('button', { name: new RegExp(taskName) }).waitFor();
  await page.keyboard.press('Escape');

  const pending = Promise.withResolvers();
  const seen = Promise.withResolvers();
  await page.route('**/api/cases', async route => {
    seen.resolve();
    await pending.promise;
    await route.fulfill({ status: 403, json: { code: 'forbidden' } });
  });
  await page.route('**/api/projects', route => route.fulfill({ status: 403, json: { code: 'forbidden' } }));
  await open('复核');
  await seen.promise;
  const options = await dialog.getByRole('option').allTextContents();
  pending.resolve();
  assert.deepEqual(options, [], 'Prior Case and project titles must already be absent while rechecking access');
  await page.keyboard.press('Escape');
  await page.unroute('**/api/cases');
  await page.unroute('**/api/projects');
  await open('复核');
  await dialog.getByRole('button', { name: new RegExp(caseTitle) }).waitFor();
  await dialog.getByRole('button', { name: new RegExp(taskName) }).waitFor();
});

test('A late home refresh cannot repopulate a search after its Case read is denied', async t => {
  const { page, dialog, open } = await setup(t);
  const home = page.getByRole('region', { name: '工作台首页' });
  const refresh = home.getByRole('button', { name: '刷新', exact: true });
  await home.getByRole('heading', { name: caseTitle, level: 2, exact: true }).waitFor();
  const pending = Promise.withResolvers();
  const seen = Promise.withResolvers();
  await page.route('**/api/studio/systems', async route => {
    seen.resolve();
    await pending.promise;
    await route.continue();
  });
  await refresh.click();
  await seen.promise; // The earlier home refresh has read the Case list and is waiting on Studio.
  await page.route('**/api/cases', route => route.fulfill({ status: 403, json: { code: 'forbidden' } }));
  const denied = page.waitForResponse(r => r.url().endsWith('/api/cases') && r.status() === 403);
  await open('复核');
  await denied;
  await dialog.getByRole('button', { name: new RegExp('^' + projectName) }).waitFor();
  pending.resolve();
  await refresh.waitFor(); // React has rendered the delayed home result.
  assert.equal(await dialog.getByRole('button', { name: new RegExp(caseTitle) }).count(), 0);
});

test('Keyboard selection stays on the chosen task when Case search results arrive later', async t => {
  const { page, dialog, open } = await setup(t);
  await page.getByRole('heading', { name: caseTitle, level: 2 }).waitFor();
  const pending = Promise.withResolvers();
  await page.route('**/api/cases', async route => {
    await pending.promise;
    await route.continue();
  });
  await open('复核');
  await dialog.getByRole('button', { name: new RegExp(taskName) }).waitFor();
  await dialog.getByRole('searchbox').press('ArrowDown'); // project -> task
  pending.resolve();
  await dialog.getByRole('button', { name: new RegExp(caseTitle) }).waitFor();
  const choice = dialog.getByRole('option', { selected: true });
  assert.ok((await choice.innerText()).includes(taskName));
  await dialog.getByRole('searchbox').press('Enter');
  await page.locator('#message-input').waitFor();
  assert.equal(new URL(page.url()).searchParams.get('task'), task.id);
});

test('Independent task navigation clears a previous report and source Case from the reload URL', async t => {
  const url = new URL(base);
  url.search = new URLSearchParams({ project: project.id, task: task.id, case: fixtureCase.id, panel: 'report' });
  const { page, dialog, open } = await setup(t, url);
  await page.getByRole('region', { name: '任务结论报告与依据工作台' }).waitFor();
  await open(taskName);
  await dialog.getByRole('button', { name: new RegExp(taskName) }).click();
  await page.locator('#message-input').waitFor();
  await page.reload();
  await page.locator('#message-input').waitFor();
  assert.equal(await page.locator('.task-mode-source-case').count(), 0);
});

test('Home clears prior Case details during revalidation and shows a denial while unrelated reads are pending', async t => {
  const { page } = await setup(t);
  const home = page.getByRole('region', { name: '工作台首页', exact: true });
  const title = page.getByText(caseTitle, { exact: true });
  await home.getByRole('heading', { name: caseTitle, level: 2, exact: true }).waitFor();
  const caseRequested = Promise.withResolvers();
  const deny = Promise.withResolvers();
  const finishStudio = Promise.withResolvers();
  try {
    await page.route('**/api/cases', async route => {
      caseRequested.resolve();
      await deny.promise;
      await route.fulfill({ status: 403, json: { code: 'forbidden' } });
    });
    await page.route('**/api/studio/systems', async route => {
      await finishStudio.promise;
      await route.continue();
    });
    await home.getByRole('button', { name: '刷新', exact: true }).click();
    await caseRequested.promise;
    assert.equal(await title.count(), 0);
    deny.resolve();
    await home.getByRole('heading', { name: '当前身份暂无 Case 读取权限' }).waitFor();
    assert.equal(await title.count(), 0);
  } finally {
    deny.resolve();
    finishStudio.resolve();
  }
});
