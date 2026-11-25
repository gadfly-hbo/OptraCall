// Compare page content with the Project Map workspace, including mobile and embedded views.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { chromium } from 'playwright';
import { startTestHost } from './fixtures/host-process.ts';

const uiPort = Number(process.env.OPTRACALL_GUTTER_UI_PORT || 4678);
const host = await startTestHost({ uiPort });
const url = `http://127.0.0.1:${uiPort}`;
const ui = spawn(process.execPath, ['scripts/frontend.mjs', 'dev', '--port', String(uiPort), '--strictPort'], {
  env: { ...process.env, OPTRACALL_HOST_PORT: String(host.port) }, stdio: ['ignore', 'pipe', 'inherit'],
});
async function post(route, body, method = 'POST') {
  const response = await host.request(route, method, body);
  if (!response.ok) throw new Error(`${route} returned ${response.status}: ${await response.text()}`);
  return response.json();
}
let browser;
try {
  await new Promise((resolve, reject) => {
    ui.stdout.on('data', data => { if (data.toString().includes(`:${uiPort}/`)) resolve(); });
    ui.once('exit', code => reject(Error(`Frontend exited with ${code}`)));
  });
  await post('/api/configuration', { name: '间距回归', provider: 'openai-compatible', model: 'synthetic', baseUrl: 'http://127.0.0.1:1/v1', apiKey: 'synthetic-only' }, 'PUT');
  const { project } = await post('/api/projects', { name: '历史回执-' + 'LongName'.repeat(5) });
  browser = await chromium.launch({channel: 'chrome'});
  const page = await browser.newPage({viewport: {width: 1500, height: 960}});
  page.setDefaultTimeout(7000);
  await page.goto(url);
  const button = name => page.getByRole('button', {name, exact: true});
  const heading = name => page.getByRole('heading', {name, exact: true});
  const widths = [1500, 960, 390];

  async function leftInsets(item) {
    const result = [];
    for (const width of widths) {
      await page.setViewportSize({width, height: 960});
      const {inset, overflow} = await item.evaluate(async el => {
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        const main = el.closest('main').getBoundingClientRect();
        const box = el.getBoundingClientRect();
        return {inset: Math.round(box.left - main.left), overflow: Math.round(box.right - main.right)};
      });
      result.push(inset);
      assert.ok(overflow <= 1, `Content overflows the workspace by ${overflow}px at ${width}px (left inset ${inset}px)`);
    }
    await page.setViewportSize({width: widths[0], height: 960});
    return result;
  }

  async function openHistory() {
    await page.locator('.project-name-button').getByText(project.name, {exact: true}).click();
    await button('共用约定').click();
    await button('查看原项目方案与历史回执').click();
  }

  await page.getByRole('navigation', {name: '主导航'}).getByRole('button', {name: '项目地图', exact: true}).click();
  const expected = await leftInsets(heading('Project Map'));
  assert.ok(expected.every(value => value > 0));
  await openHistory();
  const historyTitle = heading(project.name + ' · 原方案与历史回执');
  assert.deepEqual(await leftInsets(historyTitle), expected, 'History heading must align with Project');
  assert.deepEqual(await leftInsets(page.getByText('本项目没有原方案记录。', {exact:true})), expected, 'Empty history message');
  await button('返回项目').click();
  await heading('Project Map').waitFor();

  const base = `/api/projects/${project.id}/plan`;
  const plan = { request: '回读确认过的原方案', premises: ['合成回归'], materials: [], coverage: [], tasks: [
    {key: 'summary', name: '间距回归任务', scope: '整理原方案', selected: true, capabilities: []},
  ], taskMode: 'single', summaryTaskKey: 'summary', dependencies: [], caseContext: null };
  const draft = await post(base + '/draft', {operationId: randomUUID(), expectedRevision: 0, plan});
  await post(base + '/confirm', {operationId: randomUUID(), expectedRevision: draft.state.revision, mode: 'create'});
  await page.reload();
  await openHistory();
  const record = page.locator('section.project-plan-section').filter({has: heading('确认方案 v1')});
  await record.getByText('准确方案及授权历史', {exact:true}).click();
  assert.deepEqual(await leftInsets(record), expected, 'Historical record');
  await page.setViewportSize({width: 390, height: 960});
  const savedReceipt = await record.locator('pre').evaluate(el => ({
    request: JSON.parse(el.textContent).plan.request,
    overflow: el.scrollWidth - el.clientWidth,
  }));
  assert.equal(savedReceipt.request, plan.request);
  assert.ok(savedReceipt.overflow <= 1, 'Expanded receipt must fit on mobile');
  await page.setViewportSize({width: widths[0], height: 960});
  await button('打开原任务').click();
  for (const [entry, title] of [['方案比较与经营推演', '经营推演'], ['预测模型与原注册表', '模型注册表']]) {
    if (!(await button(entry).isVisible())) await page.getByText('报告、方案比较与专业能力', {exact:true}).click();
    await button(entry).click();
    assert.deepEqual(await leftInsets(heading(title)), expected, title);
    await button('返回原工作').click();
  }
  await button('设置').click();
  const settingsTabs = page.getByRole('group', {name: '设置分类'});
  await settingsTabs.getByRole('button', {name: '业务模型包', exact: true}).click();
  const registryInsets = await leftInsets(heading('业务模型包'));
  const settingsInsets = await leftInsets(settingsTabs);
  assert.deepEqual(settingsInsets, expected, 'Settings categories align with the workspace gutter');
  assert.ok(registryInsets[0] - settingsInsets[0] >= 216, 'Embedded registry sits beside the desktop Settings rail');
  assert.ok(registryInsets.slice(1).every((inset, index) => inset - settingsInsets[index + 1] > 0 && inset - settingsInsets[index + 1] <= 24), 'Embedded registry has local card padding below the narrow settings categories');
  console.log('PASS history (empty and populated), capability pages and embedded Settings at', widths, 'Project insets', expected);
} finally {
  await browser?.close();
  ui.kill();
  await host.close();
}
