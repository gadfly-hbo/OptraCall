// #96: project files are usable before creating a task, through the normal browser UI.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';
import { startTestHost } from './fixtures/host-process.ts';
import { startSyntheticProvider } from './fixtures/synthetic-provider.ts';

const uiPort = Number(process.env.OPTRACALL_PROJECT_FILES_UI_PORT || 4676);
const origin = `http://127.0.0.1:${uiPort}`;
const provider = await startSyntheticProvider();
let host, frontend, browser;
const external = [], pageErrors = [];

const files = page => page.getByRole('complementary', { name: '项目文件', exact: true });
const toggle = page => page.getByRole('button', { name: /^(展开|收起)项目文件$/ });

async function assertDrawer(page, open) {
  const label = (open ? '收起' : '展开') + '项目文件';
  const toolbar = page.locator('.files-toggle');
  await page.waitForFunction(expected => document.querySelector('.files-toggle')?.getAttribute('aria-label') === expected, label);
  assert.equal(await toolbar.getAttribute('aria-label'), label);
  assert.equal(await toolbar.getAttribute('aria-expanded'), String(open));
  await files(page).waitFor({ state: open ? 'visible' : 'hidden', timeout: 2500 }).catch(() => {
    assert.fail(`Project files must be ${open ? 'visible' : 'hidden'} when the toolbar is ${open ? 'expanded' : 'collapsed'}`);
  });
  if (open) assert.equal(await toolbar.getAttribute('aria-controls'), await files(page).getAttribute('id'));
}

async function createProject(page, name) {
  await page.getByRole('button', { name: '新建项目', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '新建项目', exact: true });
  await dialog.getByRole('textbox', { name: '项目名称', exact: true }).fill(name);
  await dialog.getByRole('button', { name: '创建项目', exact: true }).click();
  await page.getByRole('heading', { name, exact: true, level: 1 }).waitFor();
  await page.getByRole('button', { name: '新建第一个任务', exact: true }).waitFor();
  const url = new URL(page.url());
  assert.equal(url.searchParams.has('task'), false);
  const projectId = url.searchParams.get('project');
  assert.ok(projectId, 'The new project is selected');
  return projectId;
}

async function pageAt(width) {
  const context = await browser.newContext({ viewport: { width, height: 900 }, serviceWorkers: 'block' });
  await context.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.origin === origin) return route.continue();
    external.push(url.origin);
    return route.abort();
  });
  const page = await context.newPage();
  page.setDefaultTimeout(8000);
  page.on('pageerror', error => pageErrors.push(error.message));
  return page;
}

async function request(url, method, body) {
  const response = await host.request(url, method, body);
  assert.ok(response.ok, `${url} returned ${response.status}`);
  return response.json();
}

try {
  host = await startTestHost({ uiPort });
  await request('/api/configuration', 'PUT', {
    name: '零任务文件回归模型', provider: 'openai-compatible', model: 'synthetic',
    baseUrl: provider.baseUrl, apiKey: 'synthetic-only',
  });
  frontend = spawn(process.execPath, ['scripts/frontend.mjs', 'dev', '--port', String(uiPort), '--strictPort'], {
    env: { ...process.env, OPTRACALL_HOST_PORT: String(host.port) }, stdio: ['ignore', 'pipe', 'inherit'],
  });
  await new Promise((resolve, reject) => {
    const clock = setTimeout(() => reject(new Error('Isolated frontend startup timed out')), 10_000);
    frontend.stdout.on('data', chunk => {
      if (chunk.toString().includes(origin + '/')) { clearTimeout(clock); resolve(); }
    });
    frontend.once('exit', code => { clearTimeout(clock); reject(new Error(`Isolated frontend exited: ${code}`)); });
  });
  browser = await chromium.launch({ channel: 'chrome', args: ['--disable-background-networking'] });
  const desktop = await pageAt(1440);
  await desktop.goto(origin);
  const firstName = '零任务上传回归', secondName = '项目隔离回归';
  const firstId = await createProject(desktop, firstName);
  await assertDrawer(desktop, true);
  await toggle(desktop).click();
  await assertDrawer(desktop, false);
  await toggle(desktop).click();
  await assertDrawer(desktop, true);

  const samples = [
    ['010_draw', 'source-sample.csv', 'channel,quantity\nweb,12\n'],
    ['020_clean', 'clean-sample.csv', 'channel,quantity\nstore,8\n'],
  ];
  async function checkSamples() {
    const rawSummary = files(desktop).locator('summary').filter({ hasText: '010_draw' });
    if (!(await rawSummary.evaluate(node => node.parentElement.open))) await rawSummary.click();
    for (const [, name] of samples) await files(desktop).getByRole('button', { name: `下载 ${name}`, exact: true }).waitFor();
  }
  for (const [folder, name, text] of samples) {
    await files(desktop).getByLabel('上传位置', { exact: true }).selectOption(folder);
    const result = desktop.waitForResponse(response => response.request().method() === 'POST' && response.url().endsWith(`/api/projects/${firstId}/files/upload`));
    await files(desktop).getByLabel('选择上传文件', { exact: true }).setInputFiles({ name, mimeType: 'text/csv', buffer: Buffer.from(text) });
    assert.ok((await result).ok(), `Upload to ${folder} must succeed`);
    await files(desktop).getByRole('status').filter({ hasText: folder === '010_draw' ? '上传已保存到原件归档区' : '上传已保存到分析区' }).waitFor();
    const { projects } = await request('/api/projects');
    const first = projects.find(project => project.id === firstId);
    assert.equal(first.tasks.length, 0, 'Uploading a project file must not create a task');
    assert.equal(await readFile(path.join(host.projectsRoot, firstId, folder, name), 'utf8'), text);
  }
  await checkSamples();
  console.log('PASS desktop zero-task toggle and pre-task uploads to both project folders');

  await desktop.getByRole('button', { name: '新建第一个任务', exact: true }).click();
  const taskDialog = desktop.getByRole('dialog', { name: '新建任务', exact: true });
  await taskDialog.getByRole('textbox', { name: '任务名称', exact: true }).fill('沿用项目资料');
  await taskDialog.getByRole('button', { name: '创建任务', exact: true }).click();
  await desktop.getByRole('textbox', { name: '消息', exact: true }).waitFor();
  await assertDrawer(desktop, true);
  await checkSamples();
  const review = desktop.getByRole('button', { name: '审查结论与建议', exact: true });
  await review.click();
  const reviewPanel = desktop.getByRole('heading', { name: '审查结论与建议', exact: true });
  await reviewPanel.waitFor();
  await assertDrawer(desktop, false);
  await toggle(desktop).click();
  await reviewPanel.waitFor({ state: 'hidden' });
  await assertDrawer(desktop, true);
  await checkSamples();
  console.log('PASS the first task sees the same files and switches between files and conclusion review');

  const secondId = await createProject(desktop, secondName);
  await assertDrawer(desktop, true);
  await files(desktop).locator('summary').filter({ hasText: '020_clean' }).waitFor();
  assert.equal(await files(desktop).getByText('clean-sample.csv', { exact: true }).count(), 0, 'The other project must not show previously selected files');
  await desktop.getByRole('navigation', { name: '项目空间列表', exact: true }).getByRole('button', { name: firstName, exact: true }).click();
  await assertDrawer(desktop, true);
  await checkSamples();
  await desktop.getByLabel(`项目操作 ${firstName}`, { exact: true }).click();
  await desktop.getByRole('button', { name: `归档项目 ${firstName}`, exact: true }).click();
  await files(desktop).getByText('项目已归档，可查看和下载文件；恢复后可继续上传和编辑。', { exact: true }).waitFor();
  assert.equal(await files(desktop).getByLabel('选择上传文件', { exact: true }).count(), 0);
  await checkSamples();
  const archivedDownload = desktop.waitForEvent('download');
  await files(desktop).getByRole('button', { name: '下载 clean-sample.csv', exact: true }).click();
  const download = await archivedDownload;
  assert.equal(download.suggestedFilename(), 'clean-sample.csv');
  assert.equal(await readFile(await download.path(), 'utf8'), samples[1][2]);
  console.log('PASS project switching preserves file isolation and archive downloads the exact uploaded file');

  const narrow = await pageAt(390);
  await narrow.goto(`${origin}/?project=${secondId}`);
  await narrow.getByRole('button', { name: '新建第一个任务', exact: true }).waitFor();
  await assertDrawer(narrow, false);
  await toggle(narrow).press('Enter');
  await assertDrawer(narrow, true);
  assert.equal(await narrow.getByRole('dialog', { name: '任务检视区', exact: true }).count(), 1);
  await narrow.waitForFunction(() => document.activeElement === document.querySelector('#project-files h2'));
  await files(narrow).getByRole('button', { name: '关闭项目文件栏', exact: true }).press('Enter');
  await assertDrawer(narrow, false);
  await narrow.waitForFunction(() => document.activeElement?.classList.contains('files-toggle'));
  assert.equal(provider.requests.length, 0, 'Project file and task setup must not call the model');
  assert.deepEqual(external, []);
  assert.deepEqual(pageErrors, []);
  console.log('PASS narrow keyboard opening/closing and restored focus with zero model calls or external requests');
} finally {
  await browser?.close();
  if (frontend && frontend.exitCode === null) {
    const stopped = once(frontend, 'exit');
    if (frontend.kill('SIGTERM')) await stopped;
  }
  await host?.close();
  await provider.close();
}
