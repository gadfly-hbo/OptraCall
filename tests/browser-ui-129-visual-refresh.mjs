// #129: verify the visual refresh through the normal product UI with an isolated Host.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';
import { withCaseGoal } from './fixtures/case-goal.ts';
import { startTestHost } from './fixtures/host-process.ts';
import { startToolProvider } from './fixtures/tool-provider.ts';

const uiPort = Number(process.env.OPTRACALL_UI_129_PORT || 4695);
const origin = `http://127.0.0.1:${uiPort}`;
const provider = await startToolProvider();
const pageErrors = [], externalRequests = [];
let host, frontend, browser;

const firstDraft = '任务一独立草稿\n继续核对订单来源';
const secondDraft = '任务二独立草稿\n只比较库存';
const reportName = '同名阶段报告.md';
const primaryReport = '# 第一项目精确报告\n\n合成原件与版本的核对资料。';
const otherReport = '# 第二项目同名报告\n\n不属于第一项目。';
const reportPath = `060_reports/${reportName}`;
const digest = body => createHash('sha256').update(body).digest('hex');
const reportKey = body => reportPath + '#' + digest(body);
const caseTitle = '与所选报告版本相符的原 Case';
const otherCaseTitle = '同项目同报告但不同任务的 Case';
const citationDeclaration = '仅合成固定来源记录，未核实实际模型采用。';
const evidenceName = '合成固定附件.md';
const evidenceBody = '# 合成固定输入\n只用于验证精确版本。';
const replyLead = '已保存对话核对结果。';
const reply = `${replyLead}\n\n|说明|原记录|范围|\n|---|---|---|\n|长中文样例| ${'门店销售报表核对'.repeat(11)} |仅测试|\n`;
provider.setResponder(() => ({ text: reply }));

const button = (scope, name) => scope.getByRole('button', { name, exact: true });
const heading = (page, name) => page.getByRole('heading', { name, exact: true, level: 1 });
const taskUrl = (projectId, taskId) => `${origin}/?project=${projectId}${taskId ? '&task=' + taskId : ''}`;
const taskApi = (projectId, taskId) => `/api/projects/${projectId}/tasks/${taskId}`;
const inspector = page => page.getByRole('dialog', { name: '任务检视区', exact: true });
const composer = page => page.locator('#message-input');

async function request(route, method = 'GET', payload) {
  const response = await host.request(route, method, payload);
  if (!response.ok) assert.fail(`${method} ${route} returned ${response.status}: ${await response.text()}`);
  return response.json();
}

async function seedReportReferences(project, mainTask, sibling) {
  const projectApi = `/api/projects/${project.id}`;
  const { file: evidence } = await request(projectApi + '/files/upload', 'POST', {
    name: evidenceName, directory: '020_clean', content: Buffer.from(evidenceBody).toString('base64'),
  });
  const dataContext = projectApi + '/data-context';
  const { index } = await request(dataContext);
  const citationId = randomUUID();
  await request(dataContext + '/citations', 'POST', {
    operationId: citationId, citationId, baseIndexRevision: index?.revision ?? 0,
    report: { path: reportPath, sha256: digest(primaryReport), bytes: Buffer.byteLength(primaryReport) },
    attachments: [{ path: evidence.path, sha256: evidence.sha256, bytes: evidence.bytes }],
    selections: [], conceptRefs: [], sapRefs: [],
    declarer: 'user', declaration: citationDeclaration, nativeEvidence: null,
  });
  await request('/api/cases/storage/initialize', 'POST', {});
  for (const [title, task] of [[caseTitle, mainTask], [otherCaseTitle, sibling]]) {
    const { case: record } = await request('/api/cases', 'POST', await withCaseGoal(host, {
      operationId: randomUUID(), title, creationSource: { kind: 'task', projectId: project.id, taskId: task.id },
    }));
    const { case: linked } = await request(`/api/cases/${record.id}/projects`, 'POST', {
      operationId: randomUUID(), expectedRevision: record.revision, projectId: project.id,
    });
    const { artifact } = await request(`/api/cases/${record.id}/artifacts`, 'POST', {
      operationId: randomUUID(), expectedRevision: linked.revision,
      projectId: project.id, taskId: task.id, relativePath: reportPath, role: 'report',
    });
    assert.equal(artifact.observedSha256, digest(primaryReport));
  }
}

async function startFrontend() {
  frontend = spawn(process.execPath, ['scripts/frontend.mjs', 'dev', '--port', String(uiPort), '--strictPort'], {
    env: { ...process.env, OPTRACALL_HOST_PORT: String(host.port) },
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  await new Promise((resolve, reject) => {
    let output = '';
    const timer = setTimeout(() => reject(Error('Isolated frontend startup timed out')), 10_000);
    frontend.stdout.on('data', chunk => {
      output += chunk.toString();
      if (output.includes(origin + '/')) {
        clearTimeout(timer);
        resolve();
      }
    });
    frontend.once('error', error => { clearTimeout(timer); reject(error); });
    frontend.once('exit', code => {
      clearTimeout(timer);
      reject(Error(`Isolated frontend stopped (${code}) before reaching ${origin}`));
    });
  });
}

async function pageAt(width) {
  const context = await browser.newContext({
    viewport: { width, height: 900 }, colorScheme: 'light', serviceWorkers: 'block',
  });
  await context.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.origin === origin || url.protocol === 'blob:') return route.continue();
    externalRequests.push(url.origin);
    return route.abort();
  });
  const page = await context.newPage();
  page.setDefaultTimeout(8000);
  page.on('pageerror', error => pageErrors.push(error.message));
  return page;
}

async function activeElementIs(locator, label) {
  await locator.evaluate((element, name) => new Promise((resolve, reject) => {
    requestAnimationFrame(() => requestAnimationFrame(() => {
      if (document.activeElement === element) resolve();
      else reject(Error(`Focus was not restored to ${name}`));
    }));
  }), label);
}

async function modalFocusStaysInside(page, modal, label) {
  assert.ok(await modal.evaluate(element => element.matches(':modal')), `${label} must be modal`);
  const focusables = await modal.locator('button:visible:enabled, a[href]:visible, input:visible:enabled, select:visible:enabled, summary:visible').count();
  assert.ok(focusables > 0, `${label} must have reachable controls`);
  for (const key of ['Tab', 'Shift+Tab']) {
    for (let index = 0; index <= focusables; index++) {
      await page.keyboard.press(key);
      assert.ok(await modal.evaluate(element => element.contains(document.activeElement)),
        `${key} escaped ${label} on step ${index + 1}`);
    }
  }
}

async function narrowInspector(project, task) {
  for (const width of [1024, 390]) {
    const page = await pageAt(width);
    await page.goto(taskUrl(project.id, task.id));
    await heading(page, task.name).waitFor();
    await composer(page).waitFor();
    assert.equal(await composer(page).inputValue(), firstDraft);
    const trigger = button(page, '展开项目文件');
    await trigger.click();
    const drawer = inspector(page);
    await page.getByRole('heading', { name: '项目文件', exact: true }).waitFor();
    assert.ok(await composer(page).isVisible(),
      `V03: opening the ${width}px file overlay must leave the underlying task rendered`);
    const folders = drawer.getByRole('navigation', { name: '项目文件夹', exact: true });
    for (const name of ['010_draw', '020_clean', '060_reports']) {
      await folders.getByText(name, { exact: true }).waitFor();
    }
    await modalFocusStaysInside(page, drawer, `task inspector at ${width}px`);
    await page.keyboard.press('Escape');
    await drawer.waitFor({ state: 'hidden' });
    await activeElementIs(trigger, '展开项目文件');
    assert.equal(await composer(page).inputValue(), firstDraft, 'Opening a drawer keeps the original draft');
    assert.equal(page.url(), taskUrl(project.id, task.id));
    await page.context().close();
  }
  console.log('PASS V03 1024px and 390px modal inspector, rendered task, three folders, Tab/Escape and draft/focus return');
}

async function openInspector(page, side) {
  if (!(await side.isVisible())) {
    await page.locator('.task-workflow').getByRole('button', { name: /^资料准备/ }).click();
  }
  await side.waitFor();
}

async function openReport(page, side, content) {
  await openInspector(page, side);
  await button(side, '报告与依据').click();
  const versions = side.getByLabel('已保存报告版本', { exact: true });
  const key = reportKey(content);
  await versions.selectOption(key);
  const response = page.waitForResponse(reply => {
    const url = new URL(reply.url());
    return url.pathname.endsWith('/files/content') && url.searchParams.get('path') === reportPath;
  });
  await button(side, '查看本版报告').click();
  const request = await response;
  const resolved = new URL(request.url());
  const expectedProject = new URL(page.url()).searchParams.get('project');
  assert.equal(resolved.pathname, `/api/projects/${expectedProject}/files/content`);
  assert.equal(resolved.searchParams.get('expectedSha256'), key.split('#').at(-1));
  assert.ok(request.ok());
  const report = side.locator(`pre[aria-label="${reportPath}"]`);
  await report.waitFor();
  assert.equal(await report.textContent(), content, 'The selected exact version provides its original text');
}

async function verifyReportCaseReturn(page, side, project, task, draft) {
  for (const attach of [false, true]) {
    await openReport(page, side, primaryReport);
    const references = side.getByRole('region', { name: '本版报告关联 Case', exact: true });
    await button(references, '核对关联 Case').click();
    await references.getByText(caseTitle, { exact: true }).waitFor();
    assert.equal(await references.getByText(otherCaseTitle, { exact: true }).count(), 0,
      'A sibling task cannot supply the original report link');
    await button(references, '查看关联 Case').click();
    const dialog = page.getByRole('dialog', { name: caseTitle, exact: true });
    const work = dialog.getByRole('region', { name: '关联分析任务', exact: true });
    assert.equal(await work.getByLabel('继续工作的原任务').inputValue(), `${project.id}/${task.id}`);
    await button(work, attach ? '按此 Case 继续' : '打开原任务').click();
    await heading(page, task.name).waitFor();
    assert.equal(new URL(page.url()).searchParams.get('task'), task.id);
    assert.equal(await composer(page).inputValue(), draft);
    const context = page.locator('.case-context-banner');
    assert.equal(await context.count(), attach ? 1 : 0, 'The plain return attaches no Case context');
    if (attach) assert.ok((await context.textContent()).includes(caseTitle));
  }
}

async function taskScenarios(project, task, sibling, otherProject, otherTask) {
  const page = await pageAt(1440);
  await page.goto(taskUrl(project.id, task.id));
  await selectFromNavigation(page, '项目地图');
  const board = page.locator('.project-board');
  const projectCard = board.getByRole('article').filter({ has: button(page, project.name) });
  await projectCard.getByRole('button', { name: new RegExp('^' + task.name + '.*打开任务') }).click();
  await heading(page, task.name).waitFor();
  assert.equal(page.url(), taskUrl(project.id, task.id), 'Project Map opens the original project and task');
  await composer(page).waitFor();
  const side = page.locator('.workspace-panel-inspector:visible');
  await openInspector(page, side);
  assert.ok(await side.evaluate(element => !element.matches(':modal')), '1440px inspector is non-modal');
  const inputBox = await composer(page).boundingBox(), inspectorBox = await side.boundingBox();
  assert.ok(inputBox && inspectorBox && inputBox.x + inputBox.width <= inspectorBox.x + 1, 'Desktop task and inspector sit side by side');
  for (const name of ['资料准备', '需求梳理', '分析对话', '结果与审查']) {
    assert.equal(await page.locator('.task-workflow').getByText(name, { exact: true }).count(), 1);
  }
  await page.locator('button[aria-label="发送消息"]:enabled').waitFor();
  assert.equal(await composer(page).inputValue(), firstDraft);
  await button(page, '发送消息').click();
  await provider.waitForRequests(1);
  const assistant = page.locator('.message.assistant:not(.streaming-message)').filter({ hasText: replyLead }).first();
  await assistant.waitFor();
  const author = assistant.locator('.message-author');
  assert.equal(await author.locator('.brand-mark').count(), 1, 'Assistant uses the original BrandMark');
  assert.match(await author.innerText(), /OptraCall[\s\S]*synthetic/);
  const updatedDraft = '发出后独立保存的下一份草稿';
  const draftSaved = page.waitForResponse(response =>
    response.request().method() === 'PATCH' && response.url().endsWith(taskApi(project.id, task.id) + '/draft'));
  await composer(page).fill(updatedDraft);
  assert.ok((await draftSaved).ok(), 'The original task receives its draft update');
  assert.equal((await request(taskApi(project.id, task.id))).task.draft, updatedDraft);
  await openReport(page, side, primaryReport);
  await button(side, '审查结论').click();
  const reviewVersion = side.getByLabel('报告版本', { exact: true });
  await reviewVersion.locator(`option[value="${reportKey(primaryReport)}"]`).waitFor({ state: 'attached' });
  assert.equal(await reviewVersion.inputValue(), reportKey(primaryReport), 'Review opens on the chosen report version');
  await button(side, '报告与依据').click();
  const evidenceVersion = side.getByLabel('已保存报告版本', { exact: true });
  await evidenceVersion.waitFor();
  assert.equal(await evidenceVersion.inputValue(), reportKey(primaryReport), 'The inspector retains its chosen version across tabs');
  await verifyReportCaseReturn(page, side, project, task, updatedDraft);
  await openReport(page, side, primaryReport);

  await button(side, '查看固定输入与计算依据').click();
  const fixed = side.locator('.pdc-history').filter({ hasText: citationDeclaration });
  await fixed.waitFor();
  await button(fixed, '查看此份固定来源').click();
  const declaration = side.locator('pre[aria-label="固定来源声明"]');
  await declaration.waitFor();
  assert.equal(await declaration.textContent(), citationDeclaration);

  // If a selected report changes after selection, the expected SHA must block a same-path replacement.
  await writeFile(path.join(host.projectsRoot, project.id, reportPath), '# 该路径当前已替换');
  const staleReport = page.waitForResponse(response => response.url().includes('/files/content?') && response.status() === 409);
  await button(side, '查看本版报告').click();
  await staleReport;
  await side.getByRole('alert').waitFor();
  assert.equal(await side.locator(`pre[aria-label="${reportPath}"]`).count(), 0, 'An outdated report does not silently open either body');
  await button(fixed, '读取这份固定报告').click();
  const capturedReport = side.locator('pre[aria-label="固定报告原文"]');
  await capturedReport.waitFor();
  assert.equal(await capturedReport.textContent(), primaryReport, 'Fixed report bytes survive changes to the live path');
  await button(fixed, '读取这份固定附件').click();
  const capturedAttachment = side.locator('pre[aria-label="固定附件 · 020_clean/合成固定附件.md"]');
  await capturedAttachment.waitFor();
  assert.equal(await capturedAttachment.textContent(), evidenceBody);

  await page.goto(taskUrl(project.id, sibling.id));
  await heading(page, sibling.name).waitFor();
  await composer(page).waitFor();
  assert.equal(await composer(page).inputValue(), secondDraft);
  assert.equal(await page.getByText(replyLead, { exact: true }).count(), 0);
  await page.goto(taskUrl(otherProject.id, otherTask.id));
  await heading(page, otherTask.name).waitFor();
  await openReport(page, side, otherReport);
  await page.goto(taskUrl(project.id, task.id));
  await heading(page, task.name).waitFor();
  await composer(page).waitFor();
  assert.equal(await composer(page).inputValue(), updatedDraft);
  await assistant.waitFor();
  assert.equal(provider.requests.length, 1, 'Reading and navigating do not dispatch new model requests');

  await request(`/api/projects/${project.id}/archive`, 'POST', {});
  await page.goto(taskUrl(project.id, task.id));
  await page.getByText('项目已归档，当前为只读查看。', { exact: true }).waitFor();
  assert.equal(await composer(page).count(), 0);
  await assistant.waitFor();
  assert.equal(provider.requests.length, 1, 'Archived history is read without replay');
  await page.goto(taskUrl(otherProject.id, randomUUID()));
  await page.getByRole('alert').filter({ hasText: /原链接指定的.*暂不可读取/ }).waitFor();
  assert.equal(await composer(page).count(), 0, 'An unknown task must never select a different task');
  await page.context().close();
  console.log('PASS V02–V04/V06 exact task, per-task drafts, original author, report/hash and fixed sources, different Case returns, archival and stale-link safety');
}

async function selectFromNavigation(page, label) {
  const toggle = button(page, '展开侧栏');
  if (await toggle.isVisible()) await toggle.click();
  await button(page.locator('#sidebar'), label).click();
}

async function assertPageFits(page, title, width) {
  const current = heading(page, title);
  await current.waitFor();
  const box = await current.evaluate(node => {
    const { left, right, height } = node.getBoundingClientRect();
    return { left, right, height };
  });
  assert.ok(box.height > 0 && box.left >= -1 && box.right <= width + 1,
    `${title} heading fits ${width}px, bounds were ${JSON.stringify(box)}`);
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
    `${title} must not cause root horizontal overflow at ${width}px`);
}

const categories = ['使用用途', '模型设置', '网络检索', '自动模式', 'Skill 资料与依赖', '连接配置', '个人资料', '业务模型包', '领域资产包'];
async function checkSettings(page, width) {
  await selectFromNavigation(page, '设置');
  await assertPageFits(page, '设置', width);
  const group = page.getByRole('group', { name: '设置分类', exact: true });
  assert.deepEqual(await group.getByRole('button').allTextContents(), categories);
  if (width === 390) {
    assert.ok(await group.evaluate(element => {
      return [element, ...element.querySelectorAll('*')].some(node => {
        return node.scrollWidth > node.clientWidth && ['auto', 'scroll'].includes(getComputedStyle(node).overflowX);
      });
    }), 'Narrow settings categories are locally scrollable');
  } else if (width === 1440) {
    const first = await button(group, categories[0]).boundingBox();
    const last = await button(group, categories.at(-1)).boundingBox();
    assert.ok(first && last && last.y > first.y + first.height, 'Desktop settings categories form a vertical rail');
  }
  for (const label of categories) {
    const item = button(group, label);
    await item.click();
    assert.equal(await item.getAttribute('aria-pressed'), 'true', `Settings category ${label} is active`);
  }
  await page.locator('.settings-heading .back-button').click();
  await assertPageFits(page, '决策星图', width);
}

async function checkHelp(page, width) {
  const helpTrigger = button(page, '帮助');
  await helpTrigger.click();
  await assertPageFits(page, 'OptraCall 操作手册', width);
  await page.getByRole('link', { name: '下载完整手册', exact: true }).waitFor();
  if (width === 390) {
    const picker = page.getByRole('combobox', { name: /^选择手册章节/ });
    await picker.selectOption('1');
    assert.ok(await page.getByRole('heading', { name: '从战略讨论到具体目标与 Case', exact: true }).isVisible());
  } else {
    assert.ok(await page.getByRole('navigation', { name: '手册目录', exact: true }).isVisible());
  }
  await button(page, '返回原页面').click();
  await assertPageFits(page, '决策星图', width);
  await activeElementIs(helpTrigger, '帮助');
}

async function shellScenarios(project, task) {
  const pages = [
    ['项目地图', 'Project Map'], ['战略选择', '战略选择'], ['目标管理', '目标管理'],
    ['语义资产', '语义资产'], ['分析资产', '分析资产'], ['决策星图', '决策星图'],
  ];
  for (const width of [1440, 1024, 390]) {
    const page = await pageAt(width);
    await page.goto(taskUrl(project.id, task.id));
    await heading(page, task.name).waitFor();
    if (width === 390) {
      const toggle = button(page, '展开侧栏');
      await toggle.click();
      const sidebar = page.getByRole('dialog', { name: '工作台导航', exact: true });
      await modalFocusStaysInside(page, sidebar, 'workspace navigation');
      assert.equal(await sidebar.locator('.brand-mark').count(), 1);
      await page.keyboard.press('Escape');
      await sidebar.waitFor({ state: 'hidden' });
      await activeElementIs(toggle, '展开侧栏');
      assert.equal(page.url(), taskUrl(project.id, task.id));
    } else {
      assert.equal(await page.locator('#sidebar .brand-mark').count(), 1);
    }
    assert.ok(await page.locator('link[rel="icon"]').getAttribute('href'));
    for (const [theme, accent] of [['light', '#6550c9'], ['dark', '#b7a7ff']]) {
      if (theme === 'dark') await button(page, '切换为深色').click();
      assert.equal(await page.locator('.app').getAttribute('data-theme'), theme);
      assert.equal(await page.locator('.app').evaluate(node => getComputedStyle(node).getPropertyValue('--accent').trim()), accent);
      for (const [label, title] of pages) {
        await selectFromNavigation(page, label);
        await assertPageFits(page, title, width);
      }
      await checkSettings(page, width);
      await checkHelp(page, width);
      await page.getByRole('group', { name: '工作区切换', exact: true }).getByRole('button', { name: '决策', exact: true }).click();
      await assertPageFits(page, '决策看板', width);
    }
    await page.context().close();
    console.log(`PASS V01 responsive workspaces, settings, Help and focus at ${width}px in light/dark`);
  }
}

try {
  host = await startTestHost({ uiPort });
  await startFrontend();
  await request('/api/configuration', 'PUT', {
    name: '视觉回归合成模型', provider: 'openai-compatible', model: 'synthetic',
    baseUrl: provider.baseUrl, apiKey: 'synthetic-only',
  });
  const { project } = await request('/api/projects', 'POST', { name: '春季商品经营分析' });
  const { task } = await request(`/api/projects/${project.id}/tasks`, 'POST', { name: '春季新品首周表现' });
  const { task: sibling } = await request(`/api/projects/${project.id}/tasks`, 'POST', { name: '重点门店库存核查' });
  const { project: other } = await request('/api/projects', 'POST', { name: '第二项目独立核查' });
  const { task: otherTask } = await request(`/api/projects/${other.id}/tasks`, 'POST', { name: '第二项目独立任务' });
  await request(taskApi(project.id, task.id) + '/draft', 'PATCH', { text: firstDraft });
  await request(taskApi(project.id, sibling.id) + '/draft', 'PATCH', { text: secondDraft });
  await request(`/api/projects/${project.id}/files/save-report`, 'POST', { name: reportName, text: primaryReport });
  await request(`/api/projects/${project.id}/files/save-report`, 'POST', { name: '对照未选报告.md', text: '# 对照报告' });
  await request(`/api/projects/${other.id}/files/save-report`, 'POST', { name: reportName, text: otherReport });
  await seedReportReferences(project, task, sibling);
  const executablePath = process.env.OPTRACALL_BROWSER_EXECUTABLE || (existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined);
  const launchOptions = executablePath ? { executablePath } : { channel: 'chrome' };
  browser = await chromium.launch({ ...launchOptions, args: ['--disable-background-networking'] });
  await narrowInspector(project, task);
  await taskScenarios(project, task, sibling, other, otherTask);
  await shellScenarios(other, otherTask);
  assert.deepEqual(pageErrors, [], 'Browser page errors');
  assert.deepEqual(externalRequests, [], 'Browser external requests');
  assert.deepEqual(provider.errors, [], 'Synthetic provider fixture errors');
} finally {
  try { await browser?.close(); }
  finally {
    frontend?.kill('SIGTERM');
    try { await host?.close(); }
    finally { await provider.close(); }
  }
}
