// Isolated full application + real Host routes. Synthetic account identity only; no provider/model calls.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { createHost } from '../src/host/server.ts';
import { ServiceConnectionStore } from '../src/host/service-connection-store.ts';
import { withCaseGoal } from './fixtures/case-goal.ts';
const { chromium } = await import(process.env.OPTRACALL_PLAYWRIGHT_MODULE || 'playwright');

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'optracall-service-app-'));
const dataRoot = path.join(root, 'private'), projectsRoot = path.join(root, 'projects');
const store = new ServiceConnectionStore({ dataRoot }); await store.init();
await store.saveConfiguration('github', { scopes: ['read'], repositories: ['fixture/one', 'fixture/two'], credentials: { accessToken: 'synthetic-app-private-token' } }, 0);
await store.verifyConnection('github', { accountId: '42', accountLabel: 'synthetic account', scopes: ['read'], repositories: ['fixture/one', 'fixture/two'], tools: [{ name: 'issue_read', semanticName: 'issue_read', scope: 'read', action: 'read', write: false, requiresConfirmation: false, inputSchema: { type: 'object', properties: { owner: { type: 'string' }, repo: { type: 'string' } }, required: ['owner', 'repo'], additionalProperties: false } }] }, 1);
const host = createHost({ cwd: process.cwd(), transportVersion: 'test', staticUiRoot: path.resolve('dist'), uiPorts: [4173], dataRoot, projectsRoot });
const phase = process.env.OPTRACALL_SERVICE_APP_PHASE || 'all';
let browser;
try {
  await host.ready; await new Promise(resolve => host.server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${host.server.address().port}`;
  const request = (route, method = 'GET', body) => fetch(base + route, { method, headers: { origin: base, 'content-type': 'application/json', 'x-optracall-client': '1' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  async function api(route, method = 'GET', body) {
    const response = await request(route, method, body);
    const value = await response.json(); assert.ok(response.ok, JSON.stringify(value)); return value;
  }
  await api('/api/configuration', 'PUT', { name: 'synthetic model', provider: 'openai-compatible', baseUrl: 'http://127.0.0.1:1/v1', model: 'synthetic', apiKey: 'synthetic-model-key' });
  const { project } = await api('/api/projects', 'POST', { name: '账号连接集成检查' });
  const { task } = await api(`/api/projects/${project.id}/tasks`, 'POST', { name: '原任务' });
  const draft = '原任务未发送草稿，切换设置后保留';
  await api(`/api/projects/${project.id}/tasks/${task.id}/draft`, 'PATCH', { text: draft });
  browser = await chromium.launch({ headless: true, executablePath: process.env.OPTRACALL_BROWSER_EXECUTABLE || '/usr/bin/chromium', args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.setDefaultTimeout(15000);
  const errors = [], external = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', route => { if (route.request().url().startsWith(base)) return route.continue(); external.push(route.request().url()); return route.abort(); });
  await page.goto(`${base}/?project=${project.id}&task=${task.id}`);
  await page.getByRole('textbox', { name: '消息', exact: true }).waitFor();
  assert.equal(await page.getByRole('textbox', { name: '消息', exact: true }).inputValue(), draft);
  if (phase !== 'workspace-return') {
    await page.locator('.task-capability-navigation > summary').click();
    await page.getByRole('button', { name: '任务能力与显式启用', exact: true }).click();
    const piPanel = page.locator('details.harness-panel').filter({ has: page.getByText('Pi 能力与命令', { exact: true }) });
    assert.equal(await piPanel.evaluate(element => element.open), true, 'Original task capability entry opens the Pi permissions, including weather/trade-area controls');
    assert.equal(await page.locator('details.task-account-panel').evaluate(element => element.open), false, 'Pi navigation does not accidentally open personal account permissions');
    await piPanel.locator('summary').click();
  }
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
  if (phase !== 'permissions') {
    const reportName = '连接往返合成报告.md', reportPath = `060_reports/${reportName}`;
    const reportBody = '# 连接往返合成报告\n\n保留 v5 报告正文、具体依据与来源 Case；未执行任何模型或外部账号操作。';
    const reportSha = createHash('sha256').update(reportBody).digest('hex');
    await api(`/api/projects/${project.id}/files/save-report`, 'POST', { name: reportName, text: reportBody });
    const evidenceText = '同一固定附件：账号设置往返后仍使用这份准确字节。';
    const { file: evidence } = await api(`/api/projects/${project.id}/files/upload`, 'POST', { name: '连接往返固定依据.md', directory: '020_clean', content: Buffer.from(evidenceText).toString('base64') });
    const { index } = await api(`/api/projects/${project.id}/data-context`), citationId = randomUUID();
    await api(`/api/projects/${project.id}/data-context/citations`, 'POST', { operationId: citationId, citationId, baseIndexRevision: index?.revision ?? 0, report: { path: reportPath, sha256: reportSha, bytes: Buffer.byteLength(reportBody) }, attachments: [{ path: evidence.path, sha256: evidence.sha256, bytes: evidence.bytes }], selections: [], conceptRefs: [], sapRefs: [], declarer: 'user', declaration: '连接集成回归的准确来源声明。', nativeEvidence: null });
    await api('/api/cases/storage/initialize', 'POST', {});
    const { case: sourceCase } = await api('/api/cases', 'POST', await withCaseGoal({ request }, { operationId: randomUUID(), title: '连接往返来源 Case' }));
    const { case: linked } = await api(`/api/cases/${sourceCase.id}/projects`, 'POST', { operationId: randomUUID(), expectedRevision: sourceCase.revision, projectId: project.id });
    await api(`/api/cases/${sourceCase.id}/artifacts`, 'POST', { operationId: randomUUID(), expectedRevision: linked.revision, projectId: project.id, taskId: task.id, relativePath: reportPath, role: 'report' });
    const taskCount = (await api('/api/projects')).projects.reduce((count, value) => count + value.tasks.length, 0);

    await page.goto(base);
    const home = page.getByRole('region', { name: '工作台首页', exact: true }); await home.waitFor();
    await home.getByRole('list', { name: '需要你处理', exact: true }).getByRole('button', { name: new RegExp(reportName.replace('.', '\\.')) }).click();
    const desk = page.getByRole('region', { name: '任务结论报告与依据工作台', exact: true }); await desk.waitFor();
    const report = desk.locator(`pre[aria-label="${reportPath}"]`); await report.waitFor(); assert.equal(await report.innerText(), reportBody);
    const sourceReturn = desk.getByRole('button', { name: `← 返回来源 Case · ${sourceCase.title}`, exact: true }); await sourceReturn.waitFor();
    await desk.getByRole('region', { name: '引用来源', exact: true }).getByRole('button', { name: /连接往返固定依据/ }).click();
    const selectedEvidence = desk.getByRole('region', { name: '选中依据的原文及版本', exact: true }); await selectedEvidence.getByText(evidenceText, { exact: true }).waitFor();
    const exactMeta = await selectedEvidence.locator('dl').innerText();
    for (const value of [project.id, citationId, evidence.path, evidence.sha256]) assert.ok(exactMeta.includes(value));

    // Ordinary settings return preserves v5 report selection, fixed source and Case context.
    await page.locator('#sidebar').getByRole('button', { name: '设置', exact: true }).click();
    await page.getByRole('group', { name: '设置分类', exact: true }).getByRole('button', { name: '连接配置', exact: true }).click();
    await page.getByRole('heading', { name: '连接你自己的账号', exact: true }).waitFor();
    await page.locator('.settings-heading .back-button').click();
    await report.waitFor(); assert.equal(await report.innerText(), reportBody);
    await selectedEvidence.getByText(evidenceText, { exact: true }).waitFor();
    await sourceReturn.waitFor();
    assert.equal(new URL(page.url()).searchParams.get('case'), sourceCase.id);
    assert.equal(new URL(page.url()).searchParams.get('panel'), 'report');

    // Explicit connection activation has a different target: this task's chat and account panel.
    await page.locator('#sidebar').getByRole('button', { name: '设置', exact: true }).click();
    await page.getByRole('group', { name: '设置分类', exact: true }).getByRole('button', { name: '连接配置', exact: true }).click();
    await page.getByRole('button', { name: '返回任务开启连接', exact: true }).click();
    const originalComposer = page.getByRole('textbox', { name: '消息', exact: true }); await originalComposer.waitFor();
    assert.equal(await originalComposer.inputValue(), draft);
    await page.waitForFunction(() => document.activeElement?.id === 'message-input');
    assert.equal(await page.locator('details.task-account-panel').evaluate(element => element.open), true, 'Explicit connection return opens personal account permissions');
    assert.equal(await page.locator('.task-service-connections').getByRole('checkbox', { name: /^GitHub/ }).isChecked(), true);
    assert.equal(new URL(page.url()).searchParams.get('case'), sourceCase.id);

    // Returning to the report still restores the saved evidence; Case return uses the original ID.
    await page.getByRole('button', { name: '结论报告', exact: true }).click();
    await report.waitFor(); await selectedEvidence.getByText(evidenceText, { exact: true }).waitFor(); await sourceReturn.waitFor();
    await sourceReturn.click();
    const caseDialog = page.getByRole('dialog', { name: sourceCase.title, exact: true }); await caseDialog.waitFor();
    await page.keyboard.press('Escape'); await caseDialog.waitFor({ state: 'hidden' });
    await page.locator('#sidebar').getByRole('button', { name: '设置', exact: true }).click();
    await page.getByRole('group', { name: '设置分类', exact: true }).getByRole('button', { name: '连接配置', exact: true }).click();
    await page.locator('.settings-heading .back-button').click();
    await page.getByRole('heading', { name: '决策星图', exact: true }).waitFor();
    await caseDialog.waitFor();
    await page.keyboard.press('Escape'); await caseDialog.waitFor({ state: 'hidden' });
    assert.equal((await api('/api/projects')).projects.reduce((count, value) => count + value.tasks.length, 0), taskCount, 'Navigation and report reads never create tasks');
    const savedTask = (await api(`/api/projects/${project.id}/tasks/${task.id}`)).task;
    assert.equal(savedTask.draft, draft); assert.deepEqual(savedTask.serviceConnections.github.repositories, ['fixture/one']);
  }
  await page.getByRole('button', { name: '设置', exact: true }).click(); await page.getByRole('button', { name: '连接配置', exact: true }).click();
  await page.getByRole('heading', { name: '连接你自己的账号', exact: true }).waitFor();
  await page.screenshot({ path: path.join(root, 'desktop.png'), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: path.join(root, 'narrow.png'), fullPage: true });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  assert.deepEqual(errors, []); assert.deepEqual(external, []);
  console.log(JSON.stringify({ result: 'PASS', phase, evidence: root, paths: ['original task', 'Pi permission target', 'task scope dialog', 'real Host persistence', 'settings', 'cancel/focus', 'return with draft', 'workspace report/fixed evidence/Case returns', '390px'] }));
} finally {
  await browser?.close(); await host.close();
  // Keep synthetic screenshots as the review artifact; no account data is present.
}
