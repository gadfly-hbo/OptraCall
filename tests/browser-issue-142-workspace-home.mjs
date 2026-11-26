// Isolated real Host/Chromium acceptance for Decision Case workspace v5 (#142).
// Usage: npm run build && node tests/browser-issue-142-workspace-home.mjs [before]
// Writes screenshots and a JSON receipt to .local/issue-142/<run>/ (ignored, kept as evidence).
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';
import { createHost } from '../src/host/server.ts';

const mode = process.argv[2] === 'before' ? 'before' : 'after';
const run = process.env.ISSUE142_RUN || `${mode}-${new Date().toISOString().replace(/[:.]/g, '-')}`;
const root = path.resolve('.local/issue-142', run);
await mkdir(root, { recursive: true });
const receipt = { mode, run, checks: [], screenshots: [] };
const check = (id, ok, detail = '') => {
  receipt.checks.push({ id, ok: Boolean(ok), detail });
  if (!ok) throw new Error(`${id} failed ${detail}`);
};

const host = createHost({
  cwd: process.cwd(),
  staticUiRoot: path.resolve('dist'),
  uiPorts: [4173],
  dataRoot: path.join(root, 'data'),
  projectsRoot: path.join(root, 'projects'),
  transportVersion: 'test',
});
await host.ready;
await new Promise(resolve => host.server.listen(0, '127.0.0.1', resolve));
const base = 'http://127.0.0.1:' + host.server.address().port;

async function api(route, method = 'GET', body) {
  const response = await fetch(base + route, {
    method,
    headers: { origin: base, 'content-type': 'application/json', 'x-optracall-client': '1' },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const value = await response.json();
  assert.ok(response.ok, route + ' ' + JSON.stringify(value));
  return value;
}

const sha256 = text => createHash('sha256').update(text).digest('hex');
const launch = process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {};
const browser = await chromium.launch({ headless: true, ...launch });
const errors = [];

async function shot(page, name) {
  const file = path.join(root, name + '.png');
  await page.screenshot({ path: file, fullPage: true });
  receipt.screenshots.push(file);
}

async function open(viewport, theme = 'light', url = base) {
  const context = await browser.newContext({ viewport, colorScheme: theme === 'dark' ? 'dark' : 'light' });
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(url);
  await page.waitForLoadState('domcontentloaded');
  return { context, page };
}

try {
  // 1. Empty workspace (all 4 foundations empty, no Case, no project) + W02 cold-start Case creation.
  {
    const { context, page } = await open({ width: 1440, height: 900 });
    await shot(page, 'empty-1440-light');
    if (mode === 'after') {
      const home = page.getByRole('region', { name: '工作台首页' });
      await home.waitFor();
      check('W01-empty-default-home', await home.isVisible(), 'plain start lands on workspace home');
      check('W01-empty-first-case', await home.getByRole('heading', { name: '从第一个 Case 开始' }).isVisible());
      check('W01-empty-queue', await home.getByText('还没有待处理事项').isVisible());
      check('W01-empty-foundation-tiles', (await home.getByRole('button', { name: /战略选择/ }).count()) >= 1);
      check('W01-empty-project-without-case', await home.getByRole('button', { name: '打开项目地图' }).first().isVisible());

      // W02: Cold-start creation directly from Home when all 4 foundations are empty!
      await home.getByRole('button', { name: '新建 Case' }).click();
      await page.getByRole('button', { name: '启用本机 Case 记录', exact: true }).click();
      const createDialog = page.getByRole('dialog', { name: '新建 Case', exact: true });
      await createDialog.waitFor();
      await createDialog.getByLabel(/Case 名称/).fill('冷启动测试事项');
      await createDialog.getByRole('button', { name: '无适用目标，准备候选', exact: true }).click();
      await createDialog.getByLabel('目标名称').fill('冷启动验证目标');
      await createDialog.getByLabel('预期结果与可核交付').fill('形成可核对首轮结论');
      await createDialog.getByLabel('具体策略 S').fill('优先核对核心门店数据');
      await createDialog.getByLabel('目标归属').selectOption('personal');
      await createDialog.getByLabel('个人归属名称').fill('冷启动测试者');
      await createDialog.getByLabel('责任角色／承担人').fill('门店运营');
      await createDialog.getByRole('button', { name: '保存目标候选', exact: true }).click();
      await createDialog.getByRole('button', { name: '采纳此目标并作为主目标', exact: true }).click();
      await createDialog.getByRole('button', { name: '创建 Case', exact: true }).click();
      await page.getByRole('dialog', { name: '冷启动测试事项', exact: true }).waitFor();
      check('W02-cold-start-create-case', true, 'created Case with empty foundations via in-place G/S candidate & adopt');
      await page.keyboard.press('Escape');
      await page.getByRole('navigation', { name: '主导航', exact: true }).getByRole('button', { name: '工作台首页', exact: true }).click();
      await home.getByRole('heading', { name: '冷启动测试事项', level: 2 }).waitFor();
      check('W01-home-reflects-cold-start-case', true);
    }
    await context.close();
  }

  // 2. Seed rich synthetic workspace (Model config, Enterprise, Projects with 0 tasks / 6-type tasks / archived, Report + 2 Citations, 2 Cases).
  await api('/api/cases/storage/initialize', 'POST', {});
  await api('/api/configuration', 'PUT', {
    name: '合成验收模型', provider: 'openai-compatible', model: 'synthetic-v5',
    baseUrl: 'http://127.0.0.1:9999/v1', apiKey: 'synthetic-key-only',
  });
  const ent = await api('/api/studio/enterprises', 'POST', { requestId: randomUUID(), name: '澄光合成零售' });

  const goalTitle = '改善合成区域会员复购';
  const { goal } = await api('/api/strategy/goals', 'POST', {
    operationId: randomUUID(), title: goalTitle, outcome: goalTitle, perspective: 'profit',
    scope: { kind: 'enterprise', id: ent.id, name: ent.name },
    measurement: { kind: 'deliverable', criterion: goalTitle },
    baseline: { state: 'pending', description: '待核' },
    responsible: '区域负责人',
    strategies: ['优先验证低复购门店的缺货与首购结构'],
  });
  await api(`/api/strategy/goals/${encodeURIComponent(goal.goalId)}/adopt`, 'POST', {
    operationId: randomUUID(), expectedVersion: goal.version, version: goal.version, decision: '合成验收采纳',
  });

  const { case: primaryCase } = await api('/api/cases', 'POST', {
    operationId: randomUUID(), title: '合成低复购门店干预', description: '合成复购问题背景',
    goalBinding: { primary: { goalId: goal.goalId, version: goal.version }, related: [], strategy: '优先验证低复购门店的缺货与首购结构' },
  });
  await api(`/api/cases/${encodeURIComponent(primaryCase.id)}`, 'PATCH', {
    operationId: randomUUID(), expectedRevision: primaryCase.revision,
    title: primaryCase.title, description: primaryCase.description,
    judgement: '优先核查缺货与首购结构', nextStep: '确认首批核查门店及责任人',
  });

  // Create Projects: shared multi-type project + zero-task project + archived project.
  const { project: mainProj } = await api('/api/projects', 'POST', { name: '华东合成诊断项目' });
  const { project: emptyProj } = await api('/api/projects', 'POST', { name: '零任务合成项目' });
  const { project: archivedProj } = await api('/api/projects', 'POST', { name: '已归档合成项目' });
  await api(`/api/projects/${archivedProj.id}/archive`, 'POST', {});

  const { task: tAnalysis1 } = await api(`/api/projects/${mainProj.id}/tasks`, 'POST', {
    name: '华东复购主分析', assignment: { type: 'analysis', skill: null },
  });
  await api(`/api/projects/${mainProj.id}/tasks`, 'POST', {
    name: '门店缺货补充分析', assignment: { type: 'analysis', skill: null },
  });
  await api(`/api/projects/${mainProj.id}/tasks`, 'POST', {
    name: '核查需求界定', assignment: { type: 'requirement', skill: null },
  });
  await api(`/api/projects/${mainProj.id}/tasks`, 'POST', {
    name: '首轮复盘反馈', assignment: { type: 'teach', skill: null },
  });

  const savedDraft = '保留草稿：核对 60 天复购口径后继续';
  await api(`/api/projects/${mainProj.id}/tasks/${tAnalysis1.id}/draft`, 'PATCH', { text: savedDraft });

  // Save report + upload evidence attachment + register citation with 2 readable references (declaration + attachment).
  const reportName = '华东复购诊断报告.md';
  const reportPath = `060_reports/${reportName}`;
  const reportBody = '# 华东合成复购诊断报告\n\n核心发现：60 天复购下滑集中在缺货门店。';
  await api(`/api/projects/${mainProj.id}/files/save-report`, 'POST', { name: reportName, text: reportBody });
  const attachmentBody = '# 门店缺货核查明细\n\n合成 A 店、B 店缺货天数高于均值。';
  const { file: uploadedAttachment } = await api(`/api/projects/${mainProj.id}/files/upload`, 'POST', {
    name: '门店缺货明细.md', directory: '020_clean', content: Buffer.from(attachmentBody).toString('base64'),
  });
  const { index: dcIndex } = await api(`/api/projects/${mainProj.id}/data-context`);
  const citationId = randomUUID();
  const citationDeclaration = '来源声明一：依据合成 020_clean 门店明细统计 60 天复购口径。';
  await api(`/api/projects/${mainProj.id}/data-context/citations`, 'POST', {
    operationId: citationId, citationId, baseIndexRevision: dcIndex?.revision ?? 0,
    report: { path: reportPath, sha256: sha256(reportBody), bytes: Buffer.byteLength(reportBody) },
    attachments: [{ path: uploadedAttachment.path, sha256: uploadedAttachment.sha256, bytes: uploadedAttachment.bytes }],
    selections: [], conceptRefs: [], sapRefs: [],
    declarer: 'user', declaration: citationDeclaration, nativeEvidence: null,
  });

  // Share mainProj with cold-start Case first, then link project & report artifact to primaryCase so primaryCase is most recently updated.
  const allCasesNow = (await api('/api/cases')).cases;
  const coldCase = allCasesNow.find(item => item.id !== primaryCase.id);
  if (coldCase) {
    await api(`/api/cases/${encodeURIComponent(coldCase.id)}/projects`, 'POST', {
      operationId: randomUUID(), expectedRevision: coldCase.revision, projectId: mainProj.id,
    });
  }
  const latestPrimary = (await api(`/api/cases/${encodeURIComponent(primaryCase.id)}`)).case;
  const { case: linkedCase } = await api(`/api/cases/${encodeURIComponent(primaryCase.id)}/projects`, 'POST', {
    operationId: randomUUID(), expectedRevision: latestPrimary.revision, projectId: mainProj.id,
  });
  await api(`/api/cases/${encodeURIComponent(primaryCase.id)}/artifacts`, 'POST', {
    operationId: randomUUID(), expectedRevision: linkedCase.revision,
    projectId: mainProj.id, taskId: tAnalysis1.id, relativePath: reportPath, role: 'report',
  });
  await api(`/api/projects/${mainProj.id}/work`, 'PATCH', {
    operationId: randomUUID(), expectedRevision: 0, workStatus: 'in_progress',
    workScope: '核查缺货与首购结构', assignee: '区域运营', nextStep: '周三回收核查表', statusReason: null,
    originCaseId: primaryCase.id,
  });

  // 3. Seeded workspace at 1440 / 1024 / 390 CSS pixels in light & dark themes (W01 + W09).
  for (const [width, height] of [[1440, 900], [1024, 768], [390, 844]]) {
    for (const theme of ['light', 'dark']) {
      const { context, page } = await open({ width, height }, theme);
      if (mode === 'after') {
        const home = page.getByRole('region', { name: '工作台首页' });
        await home.waitFor();
        await page.getByRole('heading', { name: '确认首批核查门店及责任人', level: 1 }).waitFor();
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
        check(`W09-no-horizontal-overflow-${width}-${theme}`, !overflow);
        if (width === 1440 && theme === 'light') {
          check('W01-seeded-hero-title', await home.getByRole('heading', { name: '合成低复购门店干预' }).isVisible());
          check('W01-seeded-gs', (await home.getByText(goalTitle).first().isVisible()) && (await home.getByText('优先验证低复购门店的缺货与首购结构').first().isVisible()));
          check('W01-seeded-queue-case', await home.getByRole('list', { name: '需要你处理' }).getByText('确认首批核查门店及责任人').isVisible());
          check('W01-seeded-queue-report', await home.getByRole('list', { name: '需要你处理' }).getByText(/华东复购诊断报告/).isVisible());
          check('W01-seeded-enterprise', await home.getByText(/澄光合成零售/).isVisible());
          check('W01-seeded-action-status', await home.getByText(/执行中/).first().isVisible());
        }
      }
      await shot(page, `seeded-${width}-${theme}`);
      await context.close();
    }
  }

  if (mode === 'after') {
    // 4. W01 + W02 + W03 + W04 + W07 + W08 + W09 end-to-end interactive flows.
    const { context, page } = await open({ width: 1440, height: 900 });
    const home = page.getByRole('region', { name: '工作台首页' });
    await home.waitFor();

    // W01: Mutate Case nextStep from Case detail and verify Home updates from real receipt.
    await home.getByRole('button', { name: '继续推进 Case' }).click();
    const caseDialog = page.getByRole('dialog', { name: '合成低复购门店干预', exact: true });
    await caseDialog.waitFor();
    await caseDialog.getByRole('button', { name: '编辑 Case', exact: true }).click();
    const editDialog = page.getByRole('dialog', { name: '编辑 Case', exact: true });
    await editDialog.getByLabel(/下一步/).fill('已确认两家优先核查门店并安排负责人');
    await editDialog.getByRole('button', { name: '保存修改', exact: true }).click();
    await editDialog.waitFor({ state: 'hidden' });
    await page.keyboard.press('Escape');
    await page.getByRole('navigation', { name: '主导航', exact: true }).getByRole('button', { name: '工作台首页', exact: true }).click();
    await home.getByRole('heading', { name: '已确认两家优先核查门店并安排负责人', level: 1 }).waitFor();
    check('W01-home-updates-after-real-case-edit', true);

    // W04 + W08: Home report queue item → Task Report with source Case → open 2 citations → Esc restores trigger focus → Settings (9 categories) → Back preserves report + draft + source Case → return to original Case!
    await home.getByRole('list', { name: '需要你处理' }).getByRole('button', { name: /华东复购诊断报告/ }).click();
    const inspector = page.getByRole('region', { name: '任务检视区', exact: true });
    await inspector.waitFor();
    await inspector.getByText(/来源 Case/).first().waitFor();
    await inspector.locator(`pre[aria-label="${reportPath}"]`).waitFor();
    check('W04-report-opened-from-home-with-source-case', (await page.locator('#message-input').inputValue()) === savedDraft);
    await shot(page, 'w04-report-side-by-side-1440');

    // Open two distinct citations, verify identity metadata, press Escape and verify focus returns to trigger!
    await inspector.getByRole('button', { name: '查看固定输入与计算依据', exact: true }).click();
    const citBtn1 = inspector.getByRole('button', { name: '查看此份固定来源', exact: true });
    await citBtn1.waitFor();
    await citBtn1.click();
    const reader = inspector.getByRole('region', { name: '引用原文检视', exact: true });
    await reader.waitFor();
    const meta1 = await reader.locator('.task-citation-meta').innerText();
    check('W04-citation-1-exact-identity', meta1.includes(mainProj.id) && meta1.includes(citationId) && meta1.includes(reportPath));
    check('W04-citation-1-text', (await reader.locator('pre').innerText()).includes(citationDeclaration));
    await page.keyboard.press('Escape');
    await reader.waitFor({ state: 'hidden' });
    const focused1 = await citBtn1.evaluate(el => document.activeElement === el);
    check('W04-citation-1-esc-focus-return', focused1);

    const citBtn2 = inspector.getByRole('button', { name: '读取这份固定附件', exact: true });
    await citBtn2.click();
    await reader.waitFor();
    check('W04-citation-2-different-text', (await reader.locator('pre').innerText()).includes('合成 A 店、B 店缺货天数'));
    await page.keyboard.press('Escape');
    await reader.waitFor({ state: 'hidden' });
    const focused2 = await citBtn2.evaluate(el => document.activeElement === el);
    check('W04-citation-2-esc-focus-return', focused2);

    // W08: From report with source Case → Settings → switch across groups → Back preserves report, draft, and source Case!
    await page.locator('#sidebar').getByRole('button', { name: '设置', exact: true }).click();
    await page.getByRole('heading', { name: '设置', level: 1 }).waitFor();
    const settingsGroup = page.getByRole('group', { name: '设置分类', exact: true });
    const expectedSettings = ['使用用途', '模型设置', '网络检索', '自动模式', 'Skill 资料与依赖', '连接配置', '个人资料', '业务模型包', '领域资产包'];
    check('W08-nine-settings-items', JSON.stringify(await settingsGroup.getByRole('button').allTextContents()) === JSON.stringify(expectedSettings));
    await settingsGroup.getByRole('button', { name: '连接配置', exact: true }).click();
    await page.locator('.settings-heading .back-button').click();
    await inspector.getByText(/来源 Case/).first().waitFor();
    check('W08-report-settings-return-preserves-report-draft-and-case', (await page.locator('#message-input').inputValue()) === savedDraft);
    await inspector.getByRole('button', { name: '返回来源 Case', exact: true }).click();
    await page.getByRole('dialog', { name: '合成低复购门店干预', exact: true }).waitFor();
    check('W04-return-to-source-case', true);
    await page.keyboard.press('Escape');

    // W03: Project Map — 0-task project, multi-type 6-type filter, multi-Case shared project, archived filter, return to original Case, zero task creation!
    const beforeTasksCount = (await api('/api/projects')).projects.reduce((sum, p) => sum + p.tasks.length, 0);
    await page.getByRole('navigation', { name: '主导航', exact: true }).getByRole('button', { name: '项目地图', exact: true }).click();
    await page.getByRole('heading', { name: 'Project Map', level: 1 }).waitFor();
    const projectBoard = page.locator('.project-board');
    check('W03-zero-task-project-visible', await projectBoard.getByRole('button', { name: emptyProj.name, exact: true }).isVisible());
    await projectBoard.getByRole('button', { name: mainProj.name, exact: true }).click();
    const projDialog = page.getByRole('dialog', { name: mainProj.name, exact: true });
    await projDialog.waitFor();
    const typeGroup = projDialog.getByRole('group', { name: '按六类任务筛选', exact: true });
    check('W03-six-task-types-counts', (await typeGroup.getByRole('button', { name: '分析 Analysis 2' }).isVisible()) && (await typeGroup.getByRole('button', { name: '需求 Requirement 1' }).isVisible()) && (await typeGroup.getByRole('button', { name: '反馈 Teach 1' }).isVisible()));
    await typeGroup.getByRole('button', { name: '分析 Analysis 2' }).click();
    check('W03-filter-same-type-multiple-tasks', (await projDialog.getByRole('button', { name: /华东复购主分析/ }).isVisible()) && (await projDialog.getByRole('button', { name: /门店缺货补充分析/ }).isVisible()));
    check('W03-multi-case-shared-project', (await projDialog.getByRole('button', { name: '回到原 Case', exact: true }).count()) >= 2);
    await projDialog.getByRole('button', { name: '回到原 Case', exact: true }).first().click();
    await page.locator('.case-detail-dialog').waitFor();
    await page.keyboard.press('Escape');
    const afterTasksCount = (await api('/api/projects')).projects.reduce((sum, p) => sum + p.tasks.length, 0);
    check('W03-map-navigation-creates-zero-tasks', beforeTasksCount === afterTasksCount);

    // W07: Semantic & Analytics Studio share the same enterprise scope.
    await page.getByRole('navigation', { name: '主导航', exact: true }).getByRole('button', { name: '语义资产', exact: true }).click();
    await page.getByRole('heading', { name: '语义资产', level: 1 }).waitFor();
    const enterpriseSelect = page.getByLabel('当前企业', { exact: true });
    await enterpriseSelect.waitFor();
    await page.waitForFunction(() => Boolean(document.querySelector('select[aria-label="当前企业"]')?.value));
    const semEnt = await enterpriseSelect.inputValue();
    await page.getByRole('navigation', { name: '主导航', exact: true }).getByRole('button', { name: '分析资产', exact: true }).click();
    await page.getByRole('heading', { name: '分析资产', level: 1 }).waitFor();
    const anaEnt = await enterpriseSelect.inputValue();
    check('W07-shared-enterprise-scope', semEnt === ent.id && anaEnt === ent.id, `sem=${semEnt} ana=${anaEnt}`);

    // W09: Quick search via `/` keyboard shortcut, ArrowDown + Enter navigation, empty hit exit, Esc focus return.
    await page.getByRole('navigation', { name: '主导航', exact: true }).getByRole('button', { name: '工作台首页', exact: true }).click();
    await home.waitFor();
    await page.locator('body').click({ position: { x: 10, y: 10 } });
    await page.keyboard.press('/');
    const searchDialog = page.getByRole('dialog', { name: '搜索工作区', exact: true });
    await searchDialog.waitFor();
    await searchDialog.locator('#workspace-quick-search').fill('不存在的模块xyz');
    await searchDialog.getByText(/没有在当前获准范围内找到/).waitFor();
    await page.keyboard.press('Escape');
    await searchDialog.waitFor({ state: 'hidden' });
    check('W09-search-empty-hit-and-esc-focus', await page.getByRole('button', { name: '搜索工作区', exact: true }).evaluate(el => document.activeElement === el));

    await page.keyboard.press('/');
    await searchDialog.waitFor();
    await searchDialog.locator('#workspace-quick-search').fill('战略选择');
    await page.keyboard.press('Enter');
    await page.getByRole('heading', { name: '战略选择', level: 1 }).waitFor();
    check('W09-search-keyboard-enter-navigates', true);

    await context.close();

    // W01: Deep link priority over Home default (`?management=gsa` and `?project=...&task=...`).
    const deepGoal = await open({ width: 1440, height: 900 }, 'light', base + '/?management=gsa');
    await deepGoal.page.locator('.gm-workspace, .strategy-goals-page, main').first().waitFor();
    check('W01-deep-link-management-priority', !(await deepGoal.page.getByRole('region', { name: '工作台首页' }).isVisible().catch(() => false)));
    await deepGoal.context.close();

    const deepTask = await open({ width: 1440, height: 900 }, 'light', `${base}/?project=${mainProj.id}&task=${tAnalysis1.id}`);
    await deepTask.page.locator('#message-input').waitFor();
    check('W01-deep-link-task-priority', (await deepTask.page.locator('#message-input').inputValue()) === savedDraft);
    await deepTask.context.close();
  }

  check('no-page-errors', errors.length === 0, errors.join(' | '));
} finally {
  await writeFile(path.join(root, 'receipt.json'), JSON.stringify(receipt, null, 2));
  await browser.close();
  host.server.close();
  await host.close?.();
  console.log(JSON.stringify({ root, checks: receipt.checks.length, failed: receipt.checks.filter(item => !item.ok).map(item => item.id) }));
}
