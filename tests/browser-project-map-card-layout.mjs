// #100: measure actual task rows and actions in the default Project Map cards.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { chromium } from 'playwright';
import { startTestHost } from './fixtures/host-process.ts';
import { startSyntheticProvider } from './fixtures/synthetic-provider.ts';

const uiPort = Number(process.env.OPTRACALL_PROJECT_MAP_UI_PORT || 4678);
const origin = `http://127.0.0.1:${uiPort}`;
const provider = await startSyntheticProvider();
let host, frontend, browser;
const failures = [], outbound = [], pageErrors = [], geometry = [];

async function request(url, method = 'GET', body) {
  const response = await host.request(url, method, body);
  assert.ok(response.ok, `${method} ${url} returned ${response.status}`);
  return response.json();
}

async function createProject(name, taskCount, archived = false) {
  const { project } = await request('/api/projects', 'POST', { name });
  for (let index = 1; index <= taskCount; index++) {
    await request(`/api/projects/${project.id}/tasks`, 'POST', { name: `${name}的合成任务 ${index}` });
  }
  if (archived) await request(`/api/projects/${project.id}/archive`, 'POST', {});
  return project.id;
}

async function checkCard(card, project, width) {
  const actions = card.locator('footer');
  await card.getByRole('button', { name: 'Project Agent', exact: true }).waitFor();
  await card.getByRole('button', { name: '项目需求与任务方案', exact: true }).waitFor();
  await card.getByRole('button', { name: project.archived ? '恢复项目' : '新建任务', exact: true }).waitFor();
  const edit = actions.getByRole('button', { name: '编辑工作信息', exact: true });
  assert.equal(await edit.isEnabled(), !project.archived, 'Archived work information must remain read-only');
  const taskRows = card.locator('.case-project-tasks > button');
  assert.equal(await taskRows.count(), Math.min(2, project.taskCount), 'Card keeps its two-row task preview');
  const measured = await card.evaluate(element => {
    const box = element.getBoundingClientRect();
    const taskSlot = element.querySelector('.case-project-task-slot');
    const slot = taskSlot.getBoundingClientRect();
    const task = taskSlot.querySelector('.case-project-tasks > button:last-child').getBoundingClientRect();
    const edit = element.querySelector('footer > button');
    const range = document.createRange();
    range.selectNodeContents(edit);
    const buttons = [...element.querySelectorAll('footer button')].map(button => {
      const rect = button.getBoundingClientRect();
      return { label: button.textContent.trim(), top: rect.top, bottom: rect.bottom, left: rect.left, right: rect.right };
    });
    return {
      cardWidth: box.width, cardHeight: box.height, task: { top: task.top, bottom: task.bottom },
      slotBottom: slot.bottom, buttons, editWidth: edit.getBoundingClientRect().width,
      editLines: [...range.getClientRects()].filter(rect => rect.width > 0).length,
      contained: buttons.every(button => button.left >= box.left && button.right <= box.right && button.bottom <= box.bottom),
    };
  });
  const gap = Math.min(...measured.buttons.map(button => button.top)) - measured.task.bottom;
  const result = { project: project.name, width, ...measured, gap };
  geometry.push(result);
  const prefix = `${width}px ${project.name}`;
  if (gap < 4) failures.push(`${prefix}: task-to-action gap expected ≥4px, got ${gap}px`);
  if (measured.task.bottom > measured.slotBottom) failures.push(`${prefix}: last task is clipped by ${measured.task.bottom - measured.slotBottom}px`);
  if (measured.editLines !== 1) failures.push(`${prefix}: edit label expected one line, got ${measured.editLines}`);
  if (!measured.contained) failures.push(`${prefix}: action escapes the card`);
  return measured.cardHeight;
}

try {
  host = await startTestHost({ uiPort });
  await request('/api/configuration', 'PUT', {
    name: '项目地图合成配置', provider: 'openai-compatible', model: 'synthetic',
    baseUrl: provider.baseUrl, apiKey: 'synthetic-only',
  });
  await request('/api/cases/storage/initialize', 'POST', {});
  const projects = [
    { name: '进行中双任务项目', taskCount: 2, archived: false },
    { name: '已归档三任务项目', taskCount: 3, archived: true },
  ];
  const activeId = await createProject(projects[0].name, projects[0].taskCount);
  await createProject(projects[1].name, projects[1].taskCount, true);

  frontend = spawn(process.execPath, ['scripts/frontend.mjs', 'dev', '--port', String(uiPort), '--strictPort'], {
    env: { ...process.env, OPTRACALL_HOST_PORT: String(host.port) }, stdio: ['ignore', 'pipe', 'inherit'],
  });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Isolated frontend startup timed out')), 10_000);
    frontend.stdout.on('data', chunk => {
      if (chunk.toString().includes(origin + '/')) { clearTimeout(timer); resolve(); }
    });
    frontend.once('exit', code => { clearTimeout(timer); reject(new Error(`Isolated frontend exited: ${code}`)); });
  });
  browser = await chromium.launch({ channel: 'chrome', args: ['--disable-background-networking'] });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, serviceWorkers: 'block' });
  await context.route('**/*', route => {
    const target = new URL(route.request().url());
    if (target.origin === origin) return route.continue();
    outbound.push(target.origin);
    return route.abort();
  });
  const page = await context.newPage();
  page.setDefaultTimeout(8000);
  page.on('pageerror', error => pageErrors.push(error.message));
  await page.goto(origin);
  const openMap = () => page.getByRole('navigation', { name: '主导航' }).getByRole('button', { name: '项目地图', exact: true }).click();
  await openMap();
  const board = page.getByRole('region', { name: 'Project Map', exact: true });
  assert.equal(await board.getByRole('button', { name: '方块', exact: true }).getAttribute('aria-pressed'), 'true');
  const showAll = () => board.getByLabel('归档状态', { exact: true }).selectOption('all');
  await showAll();
  const cardFor = project => board.getByRole('article').filter({ has: page.getByRole('heading', { name: project.name, exact: true }) });
  for (const width of [1440, 1720, 1000, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    const activeHeight = await checkCard(cardFor(projects[0]), projects[0], width);
    const archivedHeight = await checkCard(cardFor(projects[1]), projects[1], width);
    if (Math.abs(activeHeight - archivedHeight) > 0.01) failures.push(`${width}px: card heights must match across rows`);
    if (width >= 1440 && activeHeight !== 420) failures.push(`${width}px: expected 420px desktop card height, got ${activeHeight}px`);
  }
  console.log(JSON.stringify({ geometry, failures }, null, 2));
  assert.deepEqual(failures, [], 'Project card geometry must not overlap, clip, wrap the edit label, or overflow');

  await page.setViewportSize({ width: 1440, height: 900 });
  const archivedCard = cardFor(projects[1]);
  await archivedCard.getByRole('button', { name: '查看全部任务', exact: true }).click();
  const drawer = page.getByRole('dialog', { name: projects[1].name, exact: true });
  assert.equal(await drawer.locator('.case-project-tasks > button').count(), 3, 'Drawer still exposes all tasks');
  await drawer.getByRole('button', { name: /^关闭/ }).first().click();
  await drawer.waitFor({ state: 'hidden' });
  await board.getByRole('button', { name: '列表', exact: true }).click();
  await board.getByRole('row').filter({ hasText: projects[0].name }).getByRole('button', { name: '全部 2 个任务', exact: true }).waitFor();
  await board.getByRole('button', { name: '方块', exact: true }).click();
  await cardFor(projects[0]).locator('.case-project-tasks > button').last().click();
  await page.waitForURL(url => url.searchParams.get('project') === activeId && Boolean(url.searchParams.get('task')));

  assert.deepEqual(outbound, []);
  assert.deepEqual(pageErrors, []);
  assert.equal(provider.requests.length, 0, 'Checking project and task links does not call the model');
} finally {
  await browser?.close();
  if (frontend?.exitCode === null && frontend.signalCode === null) {
    const stopped = once(frontend, 'exit');
    frontend.kill('SIGTERM');
    await stopped;
  }
  await host?.close();
  await provider.close();
}
