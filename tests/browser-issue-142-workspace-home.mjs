// Isolated real Host/Chromium acceptance for Decision Case workspace v5 (#142, Round-2 full rework verification).
// Usage: npm run build && node tests/browser-issue-142-workspace-home.mjs
// Writes screenshots and a JSON receipt to .local/issue-142/<run>/ (gitignored, kept as local evidence).
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';
import { createHost } from '../src/host/server.ts';
import { startToolProvider } from './fixtures/tool-provider.ts';

const mode = process.argv[2] === 'before' ? 'before' : 'after';
const run = process.env.ISSUE142_RUN || `r2-${mode}-${new Date().toISOString().replace(/[:.]/g, '-')}`;
const root = path.resolve('.local/issue-142', run);
await mkdir(root, { recursive: true });
const receipt = { mode, run, checks: [], screenshots: [] };
const check = (id, ok, detail = '') => {
  receipt.checks.push({ id, ok: Boolean(ok), detail });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${id}${detail ? ` · ${detail}` : ''}`);
  if (!ok) throw new Error(`${id} failed ${detail}`);
};

const provider = await startToolProvider();
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
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const text = await response.text();
  let value = {};
  try { value = text ? JSON.parse(text) : {}; } catch { value = { raw: text }; }
  assert.ok(response.ok, `${method} ${route} -> ${response.status} ${JSON.stringify(value)}`);
  return value;
}

const sha256 = text => createHash('sha256').update(text).digest('hex');
const waitUntil = async (fn, label, timeout = 45000) => {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const val = await fn();
    if (val) return val;
    await new Promise(r => setTimeout(r, 80));
  }
  throw new Error(`Timed out waiting for ${label}`);
};

const launch = process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {};
const browser = await chromium.launch({ headless: true, ...launch });
const errors = [];

async function shot(page, name, fullPage = true) {
  const file = path.join(root, name + '.png');
  await page.screenshot({ path: file, fullPage });
  receipt.screenshots.push(file);
}

async function open(viewport, theme = 'light', url = base) {
  const context = await browser.newContext({ viewport, colorScheme: theme === 'dark' ? 'dark' : 'light' });
  await context.route('**/*', route => {
    const target = new URL(route.request().url());
    if (target.hostname === '127.0.0.1' || target.hostname === 'localhost' || target.protocol === 'blob:') {
      return route.continue();
    }
    return route.abort();
  });
  const page = await context.newPage();
  page.setDefaultTimeout(12000);
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(url);
  await page.waitForLoadState('domcontentloaded');
  return { context, page };
}

try {
  // 1. Empty workspace + Dark Purple-Black Rail (Finding 6) + W02 Cold-Start Case creation.
  {
    const { context, page } = await open({ width: 1440, height: 900 });
    const home = page.getByRole('region', { name: '工作台首页' });
    await home.waitFor();
    await shot(page, '01-empty-home-1440-light');

    const sidebarBgLight = await page.locator('#sidebar').evaluate(el => getComputedStyle(el).backgroundColor);
    const appAccentLight = await page.locator('.app').evaluate(el => getComputedStyle(el).getPropertyValue('--accent').trim());
    check('R2-F6-dark-rail-light-mode', sidebarBgLight === 'rgb(25, 22, 33)' && appAccentLight === '#6550c9', `bg=${sidebarBgLight} accent=${appAccentLight}`);

    check('W01-empty-default-home', await home.isVisible());
    check('W01-empty-first-case', await home.getByRole('heading', { name: '从第一个 Case 开始' }).isVisible());
    check('W01-empty-queue', await home.getByText('还没有待处理事项').isVisible());

    // Dedicated Foundation Overview page from Home ("查看建设总览") and from Sidebar ("基础建设总览").
    await home.getByRole('button', { name: '查看建设总览', exact: true }).click();
    const fOverview = page.getByRole('region', { name: '基础建设总览' });
    await fOverview.waitFor();
    check('R2-F6-dedicated-foundation-overview',
      (await fOverview.getByRole('heading', { name: '基础建设总览', level: 1 }).isVisible()) &&
      (await fOverview.getByRole('heading', { name: '战略与目标', level: 2 }).isVisible()) &&
      (await fOverview.getByRole('heading', { name: '企业资产', level: 2 }).isVisible()) &&
      (await fOverview.getByText('Decision Case', { exact: true }).isVisible()) &&
      (await fOverview.getByRole('heading', { name: '工作区设置', level: 3 }).isVisible()),
    );
    await shot(page, '02-foundation-overview-empty-1440-light');

    // Return to Home via sidebar and execute W02 cold-start Case creation.
    await page.getByRole('navigation', { name: '主导航', exact: true }).getByRole('button', { name: '工作台首页', exact: true }).click();
    await home.waitFor();
    await home.getByRole('button', { name: '新建 Case', exact: true }).click();
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
    check('W02-cold-start-create-case', true);
    await page.keyboard.press('Escape');
    await page.getByRole('navigation', { name: '主导航', exact: true }).getByRole('button', { name: '工作台首页', exact: true }).click();
    await home.getByRole('heading', { name: '冷启动测试事项', level: 2 }).waitFor();
    check('W01-home-reflects-cold-start-case', true);
    await context.close();
  }

  // 2. Configure synthetic Pi model + seed multi-enterprise, 6 initiatives, multi-project Case, 2 citations + attachment.
  await api('/api/configuration', 'PUT', {
    name: '合成验收模型',
    provider: 'openai-compatible',
    model: 'synthetic-v5',
    baseUrl: provider.baseUrl,
    apiKey: 'synthetic-key-only',
  });

  const ent1 = await api('/api/studio/enterprises', 'POST', { requestId: randomUUID(), name: '澄光合成零售' });
  const ent2 = await api('/api/studio/enterprises', 'POST', { requestId: randomUUID(), name: '北辰合成制造' });

  // Create a Studio construction project + system ONLY under ent1 so ent1 has 1 system while ent2 has 0 systems!
  const { project: studioProj } = await api('/api/projects', 'POST', { name: '澄光语义建设工程' });
  await api(`/api/projects/${encodeURIComponent(studioProj.id)}`);
  await api('/api/studio/enterprise-associations', 'POST', {
    requestId: randomUUID(), kind: 'project', entityId: studioProj.id, enterpriseId: ent1.id,
  });
  const { system: sys1 } = await api('/api/studio/systems', 'POST', {
    requestId: randomUUID(),
    name: '会员经营语义体系',
    enterpriseId: ent1.id,
    projectId: studioProj.id,
    goal: '沉淀会员复购口径',
    topicTitle: '首轮会员口径主题',
  });
  check('seed-ent1-system', sys1.enterpriseId === ent1.id);

  // Create an unpublished CANDIDATE SAP method associated with ent2 (must NEVER be shown as 已发布 / 正式资产!).
  const { method: candMethod } = await api('/api/sap/methods', 'POST', {
    requestId: randomUUID(),
    title: '北辰产线良率归因候选方法',
    content: {
      conditions: '产线良率阶段性波动',
      logic: '按班次与工序拆解良率差异',
      judgment: '核对批次原材料与设备维护窗口',
      limits: '尚未正式发布，仅作为候选待审',
    },
  });
  await api('/api/studio/enterprise-associations', 'POST', {
    requestId: randomUUID(),
    kind: 'asset',
    entityId: candMethod.id,
    enterpriseId: ent2.id,
    authority: 'sap-method',
  });

  // Seed 6 strategy initiatives where #1..#5 are unpublished and #6 will go through full W05 dual-gate -> publish -> handoff!
  const scope6 = { kind: 'enterprise', id: ent1.id, name: ent1.name };
  const scope6Key = `enterprise::${ent1.id}`;
  for (let i = 1; i <= 5; i++) {
    await api('/api/strategy/initiatives', 'POST', {
      operationId: randomUUID(),
      title: `未发布历史战略议题 ${i}`,
      scopes: [scope6],
    });
  }
  const init6Id = randomUUID();
  await api('/api/strategy/initiatives', 'POST', {
    operationId: init6Id,
    title: '第六项战略选择 · 华东会员深耕',
    scopes: [scope6],
  });
  const init6Root = `/api/strategy/initiatives/${init6Id}`;
  const init6FileBody = '合成经营依据：华东首购会员 60 天复购率 18%，缺货门店较可比组低 5 个百分点。';
  const init6File = (await api(`${init6Root}/files`, 'POST', {
    operationId: randomUUID(),
    directory: '010_draw',
    name: '华东复购依据.md',
    contentBase64: Buffer.from(init6FileBody).toString('base64'),
  })).file;
  const kickoffFields = {
    horizon: '2027 年度',
    diagnosis: '客流平稳，增长瓶颈在首购后 60 天复购留存。',
    propositions: [
      { id: 'P1', question: '缺货治理能否改善复购？', whyItMatters: '决定供应链资源分配。' },
      { id: 'P2', question: '首购品类引导能否复制？', whyItMatters: '决定门店推广节奏。' },
      { id: 'P3', question: '有限预算如何优先配置？', whyItMatters: '决定试点与扩张取舍。' },
    ],
    assumptions: '门店客群结构在观察期内无剧烈外生冲击',
    evidenceGaps: '待补同品类到货与陈列核查记录',
    followUp: '先在三家门店完成首轮核查',
  };
  const kickoffV1 = (await api(`${init6Root}/reports`, 'POST', {
    operationId: randomUUID(),
    fields: kickoffFields,
    sources: [{ kind: 'file', ref: '010_draw/华东复购依据.md', fileId: init6File.fileId, sha256: init6File.sha256 }],
  })).version;
  await api(`${init6Root}/reports/1/lock`, 'POST', { operationId: randomUUID(), sha256: kickoffV1.contentSha256 });
  await api(`${init6Root}/reports/1/apply`, 'POST', { operationId: randomUUID(), sha256: kickoffV1.contentSha256, scope: scope6 });

  const candidateBlocks = [
    { id: 'B1', label: '战略取舍', text: '聚焦存量高潜门店缺货治理与首购结构优化，暂缓低效拓店。' },
    { id: 'B2', label: '阶段目标与边界', text: '优先在华东重点门店验证 60 天复购回升。' },
  ];
  provider.setResponder(ctx =>
    ctx.recentToolResults.length
      ? { text: '战略候选已保存，请审核锁定。' }
      : {
          calls: [{
            name: 'strategy_goals',
            arguments: {
              action: 'initiative-save-candidate',
              operationId: randomUUID(),
              candidateBlocks,
              candidateGoals: ['华东60天复购率提升至23%', '重点门店高频商品缺货率降至2%以内'],
            },
          }],
        },
  );
  const createdCand6 = (await api(`${init6Root}/candidates`, 'POST', {
    operationId: randomUUID(),
    scope: scope6,
    title: '深耕复购主候选方案',
    instruction: '基于开题报告形成可检验的战略候选。',
  })).candidate;
  const completedCand6 = await waitUntil(async () => {
    const detail = await api(`${init6Root}/candidates/${createdCand6.candidateId}/versions/1`);
    return detail.candidate.lastRun?.status === 'completed' ? detail.candidate : null;
  }, 'init6 candidate generation');
  const lockedCand6 = (await api(`${init6Root}/candidates/${createdCand6.candidateId}/versions/1/lock`, 'POST', {
    operationId: randomUUID(),
    sha256: completedCand6.contentSha256,
  })).candidate;

  // Seed adopted Goal + primary Case + multi-type Project + 2 distinct Citations + Fixed Attachment.
  const goalTitle = '改善合成区域会员复购';
  const { goal } = await api('/api/strategy/goals', 'POST', {
    operationId: randomUUID(), title: goalTitle, outcome: '60天复购回升至23%', perspective: 'profit',
    scope: { kind: 'enterprise', id: ent1.id, name: ent1.name },
    measurement: { kind: 'deliverable', criterion: '华东复购核查交付' },
    baseline: { state: 'pending', description: '当前 18%' },
    responsible: '区域负责人',
    strategies: ['优先验证低复购门店的缺货与首购结构', '多项目核查与渠道试点协同验证'],
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

  // Save report + upload 2 distinct attachments + register TWO distinct citationIds on the same report!
  const reportName = '华东复购诊断报告.md';
  const reportPath = `060_reports/${reportName}`;
  const reportBody = [
    '# 华东合成复购诊断报告',
    '',
    '## 一、核心结论',
    '同一首购月份、完整 60 天观察窗口下，上海虹口店、杭州滨江店与苏州园区店复购率较可比组低 4–6 个百分点。',
    '',
    '## 二、优先核查建议',
    '1. 上海虹口店、杭州滨江店：核查高频商品缺货频次、到货及时率与陈列记录。',
    '2. 苏州园区店：按首购品类拆分后再与同品类可比组复核。',
  ].join('\n');
  const reportSha = sha256(reportBody);
  await api(`/api/projects/${mainProj.id}/files/save-report`, 'POST', { name: reportName, text: reportBody });

  const attachment1Body = '# 门店缺货核查明细\n\n合成 A 店（虹口）、B 店（滨江）高频商品缺货天数高于均值 3.8 天。';
  const { file: uploadedAttachment1 } = await api(`/api/projects/${mainProj.id}/files/upload`, 'POST', {
    name: '门店缺货明细.md', directory: '020_clean', content: Buffer.from(attachment1Body).toString('base64'),
  });
  const attachment2Body = '# 首购品类对照口径说明\n\n仅纳入完成 60 天观察窗口的会员，排除测试单与全额退单。';
  const { file: uploadedAttachment2 } = await api(`/api/projects/${mainProj.id}/files/upload`, 'POST', {
    name: '首购品类口径.md', directory: '020_clean', content: Buffer.from(attachment2Body).toString('base64'),
  });
  assert.notEqual(uploadedAttachment1.sha256, reportSha);
  assert.notEqual(uploadedAttachment2.sha256, reportSha);

  const { index: dcIndex1 } = await api(`/api/projects/${mainProj.id}/data-context`);
  const citationId1 = randomUUID();
  const citationDecl1 = '来源声明一：依据 020_clean/门店缺货明细.md 核对缺货天数分布。';
  await api(`/api/projects/${mainProj.id}/data-context/citations`, 'POST', {
    operationId: citationId1, citationId: citationId1, baseIndexRevision: dcIndex1?.revision ?? 0,
    report: { path: reportPath, sha256: reportSha, bytes: Buffer.byteLength(reportBody) },
    attachments: [{ path: uploadedAttachment1.path, sha256: uploadedAttachment1.sha256, bytes: uploadedAttachment1.bytes }],
    selections: [], conceptRefs: [], sapRefs: [],
    declarer: 'user', declaration: citationDecl1, nativeEvidence: null,
  });

  const { index: dcIndex2 } = await api(`/api/projects/${mainProj.id}/data-context`);
  const citationId2 = randomUUID();
  const citationDecl2 = '来源声明二：依据 020_clean/首购品类口径.md 锁定 60 天观察窗口过滤规则。';
  await api(`/api/projects/${mainProj.id}/data-context/citations`, 'POST', {
    operationId: citationId2, citationId: citationId2, baseIndexRevision: dcIndex2?.revision ?? 0,
    report: { path: reportPath, sha256: reportSha, bytes: Buffer.byteLength(reportBody) },
    attachments: [{ path: uploadedAttachment2.path, sha256: uploadedAttachment2.sha256, bytes: uploadedAttachment2.bytes }],
    selections: [], conceptRefs: [], sapRefs: [],
    declarer: 'user', declaration: citationDecl2, nativeEvidence: null,
  });

  // Share mainProj with coldCase AND primaryCase (and link report to BOTH so we can test switching source Case A vs Case B!).
  const allCasesNow = (await api('/api/cases')).cases;
  const coldCase = allCasesNow.find(item => item.id !== primaryCase.id);
  assert.ok(coldCase, 'cold-start Case must exist');
  const { case: coldLinked } = await api(`/api/cases/${encodeURIComponent(coldCase.id)}/projects`, 'POST', {
    operationId: randomUUID(), expectedRevision: coldCase.revision, projectId: mainProj.id,
  });
  await api(`/api/cases/${encodeURIComponent(coldCase.id)}/artifacts`, 'POST', {
    operationId: randomUUID(), expectedRevision: coldLinked.revision,
    projectId: mainProj.id, taskId: tAnalysis1.id, relativePath: reportPath, role: 'report',
  });

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

  // 3. W05 Full Browser Flow: Dual Verification (causal + logic) -> Formal Publication -> Handoff to Goal Management -> Withdraw preserves history!
  {
    const { context, page } = await open({ width: 1440, height: 900 });
    await page.getByRole('navigation', { name: '主导航', exact: true }).getByRole('button', { name: '战略选择', exact: true }).click();
    await page.getByRole('heading', { name: '战略选择', level: 1 }).waitFor();
    await page.selectOption('select[aria-label="战略事项"]', init6Id);
    await page.getByRole('button', { name: '战略检验', exact: true }).click();

    const verifSources = [
      { kind: 'kickoff', ref: '1', sha256: kickoffV1.contentSha256 },
      { kind: 'candidate', ref: `${createdCand6.candidateId}:1`, sha256: lockedCand6.contentSha256 },
      { kind: 'file', ref: '010_draw/华东复购依据.md', fileId: init6File.fileId, sha256: init6File.sha256 },
    ];
    provider.setResponder(ctx =>
      ctx.recentToolResults.length
        ? { text: '本道检验结论已保存。' }
        : {
            calls: [{
              name: 'strategy_goals',
              arguments: {
                action: 'initiative-save-verification',
                verdict: 'pass',
                evidence: '因果链条与资源边界已核对一致，具备发布条件。',
                verificationSources: verifSources,
              },
            }],
          },
    );

    await page.getByRole('button', { name: '启动检验' }).click();
    await page.waitForSelector('text=两份结论已绑定同一锁定版', { timeout: 60000 });
    check('W05-dual-verification-passed', true);

    await page.getByRole('button', { name: '前往战略发布' }).click();
    await page.getByRole('button', { name: '核对并正式发布' }).click();
    const pubDlg = page.getByRole('dialog', { name: '确认正式发布', exact: true });
    await pubDlg.waitFor();
    const confirmPubBtn = pubDlg.getByRole('button', { name: '确认发布' });
    check('W05-publish-requires-explicit-checkbox', await confirmPubBtn.isDisabled());
    const g1Group = pubDlg.getByRole('group', { name: /G1 ·/ });
    await g1Group.getByLabel('正式目标值').fill('23');
    await g1Group.getByLabel('单位').fill('%');
    await g1Group.getByLabel('期间').fill('2027-Q1');
    await g1Group.getByLabel('承接策略').fill('优先验证低复购门店的缺货与首购结构');
    const g2Group = pubDlg.getByRole('group', { name: /G2 ·/ });
    await g2Group.getByLabel('正式目标值').fill('2');
    await g2Group.getByLabel('单位').fill('%');
    await g2Group.getByLabel('期间').fill('2027-Q1');
    await g2Group.getByLabel('承接策略').fill('高频商品补货时效与安全库存联合校准');
    await pubDlg.getByRole('checkbox', { name: '我已核对准确版方案及两份带依据的检验结论。' }).check();
    await confirmPubBtn.click();
    await page.waitForSelector('button:has-text("带入目标管理")');
    const pub6 = (await api(`${init6Root}/publications?scopeKey=${encodeURIComponent(scope6Key)}`)).publications.find(p => p.state === 'active');
    check('W05-6th-initiative-published', Boolean(pub6?.publicationId) && Boolean(pub6?.handoffEligible));

    // Handoff selected G/S to Goal Management as candidate awaiting adoption.
    await page.getByRole('button', { name: '带入目标管理' }).click();
    const handoffDlg = page.getByRole('dialog', { name: '核对承接的目标与策略', exact: true });
    await handoffDlg.waitFor();
    await handoffDlg.getByRole('button', { name: '保存目标候选' }).click();
    await page.getByRole('complementary', { name: '战略发布承接来源' }).waitFor();
    const allGoalsAfterHandoff = (await api('/api/strategy/goals')).goals;
    const handedOffGoal = allGoalsAfterHandoff.find(g =>
      g.versions?.some(v => v.formalOrigin?.publicationId === pub6.publicationId),
    );
    check('W05-handoff-goal-candidate-created', Boolean(handedOffGoal) && handedOffGoal.adoptedVersion === null);

    // Verify Home detects active publication on the 6th initiative (no .slice(0, 5) truncation!).
    await page.getByRole('navigation', { name: '主导航', exact: true }).getByRole('button', { name: '工作台首页', exact: true }).click();
    const home = page.getByRole('region', { name: '工作台首页' });
    await home.waitFor();
    await waitUntil(async () => {
      const text = await home.getByRole('button', { name: /战略选择/ }).innerText().catch(() => '');
      return text.includes('已发布');
    }, 'Home strategy tile shows 已发布 for 6th initiative');
    check('R2-F2-strategy-6th-initiative-published-on-home', true);
    await context.close();
  }

  // 4. Finding 2: Enterprise switching sync (Home <-> Studio <-> FoundationOverview), formal-current vs candidate, 403 Studio error, 403/500 Case states.
  {
    const { context, page } = await open({ width: 1440, height: 900 });
    const home = page.getByRole('region', { name: '工作台首页' });
    await home.waitFor();

    // Switch enterprise to ent2 (北辰合成制造) inside 语义资产, then return to Home!
    await page.getByRole('navigation', { name: '主导航', exact: true }).getByRole('button', { name: '语义资产', exact: true }).click();
    await page.getByRole('heading', { name: '语义资产', level: 1 }).waitFor();
    const studioEntSelect = page.getByLabel('当前企业', { exact: true });
    await studioEntSelect.waitFor();
    await studioEntSelect.selectOption(ent2.id);
    await page.waitForTimeout(300);

    await page.getByRole('navigation', { name: '主导航', exact: true }).getByRole('button', { name: '工作台首页', exact: true }).click();
    await home.waitFor();
    await waitUntil(async () => {
      const val = await home.getByLabel('当前企业', { exact: true }).inputValue().catch(() => '');
      return val === ent2.id;
    }, 'Home enterprise synced to ent2');

    const semTileEnt2 = await home.getByRole('button', { name: /语义资产/ }).innerText();
    const anaTileEnt2 = await home.getByRole('button', { name: /分析资产/ }).innerText();
    check('R2-F2-ent2-does-not-inherit-ent1-systems', semTileEnt2.includes('未开始') && !semTileEnt2.includes('建设中'), semTileEnt2);
    check('R2-F2-candidate-metric-not-marked-published', anaTileEnt2.includes('候选待发布') && !anaTileEnt2.includes('已发布'), anaTileEnt2);

    // Check Foundation Overview also reflects ent2 and candidate status!
    await page.locator('#sidebar').getByRole('button', { name: /基础建设总览/ }).click();
    const fOverview = page.getByRole('region', { name: '基础建设总览' });
    await fOverview.waitFor();
    await waitUntil(async () => {
      const entVal = await fOverview.getByLabel('当前企业', { exact: true }).inputValue().catch(() => '');
      const txt = await fOverview.innerText().catch(() => '');
      return entVal === ent2.id && txt.includes('候选待发布') && !txt.includes('已发布 · 分析资产');
    }, 'FoundationOverview synced to ent2 and loaded candidate status');
    const foText = await fOverview.innerText();
    check('R2-F2-foundation-overview-synced-to-ent2', foText.includes('候选待发布') && !foText.includes('正式分析资产\n'));

    // Switch back to ent1 on Foundation Overview -> verify 分析资产 Studio page receives ent1!
    await fOverview.getByLabel('当前企业', { exact: true }).selectOption(ent1.id);
    await fOverview.getByRole('button', { name: /分析资产/ }).click();
    await page.getByRole('heading', { name: '分析资产', level: 1 }).waitFor();
    await waitUntil(async () => (await page.getByLabel('当前企业', { exact: true }).inputValue()) === ent1.id, 'Studio synced back to ent1');
    check('R2-F2-two-way-enterprise-sync', true);

    // Simulate 403 on readStudioFoundation -> verify Home shows 无权限 (never 建设中 or 未开始)!
    await page.route('**/api/studio/foundation*', route =>
      route.fulfill({ status: 403, contentType: 'application/json', body: JSON.stringify({ message: '测试模拟企业资产 403 无权读取' }) }),
    );
    await page.getByRole('navigation', { name: '主导航', exact: true }).getByRole('button', { name: '工作台首页', exact: true }).click();
    await home.waitFor();
    await waitUntil(async () => (await home.getByRole('button', { name: /语义资产/ }).innerText()).includes('无权限'), '403 foundation shows 无权限');
    check('R2-F2-foundation-403-not-swallowed', (await home.getByRole('button', { name: /分析资产/ }).innerText()).includes('无权限'));
    await page.unroute('**/api/studio/foundation*');

    // Simulate 403 and 500 on Case read -> verify Home does NOT show "从第一个 Case 开始" or "还没有待处理事项"!
    await page.route('**/api/cases*', route =>
      route.fulfill({ status: 403, contentType: 'application/json', body: JSON.stringify({ message: '当前身份无权读取 Case' }) }),
    );
    await home.getByRole('button', { name: '刷新', exact: true }).click();
    await home.getByRole('heading', { name: '当前身份暂无 Case 读取权限', level: 1 }).waitFor();
    const home403Text = await home.innerText();
    check('R2-F2-case-403-no-empty-copy',
      !home403Text.includes('从第一个 Case 开始') &&
      !home403Text.includes('还没有待处理事项') &&
      home403Text.includes('暂无权限读取待处理 Case'),
    );

    // Finding 1: While Case read is 403, open `/` Quick Search -> stale Case titles & nextStep MUST be cleared!
    await page.locator('body').click({ position: { x: 10, y: 10 } });
    await page.keyboard.press('/');
    const searchDlg = page.getByRole('dialog', { name: '搜索工作区', exact: true });
    await searchDlg.waitFor();
    await searchDlg.locator('#workspace-quick-search').fill('合成');
    await page.waitForTimeout(250);
    const search403Text = await searchDlg.innerText();
    check('R2-F1-search-clears-revoked-cases-keeps-projects',
      !search403Text.includes('合成低复购门店干预') && search403Text.includes('华东合成诊断项目'),
      search403Text,
    );
    await page.keyboard.press('Escape');
    await searchDlg.waitFor({ state: 'hidden' });

    // Switch Case failure to 500 -> verify unavailable copy!
    await page.unroute('**/api/cases*');
    await page.route('**/api/cases*', route =>
      route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ message: 'Case 存储离线' }) }),
    );
    await home.getByRole('button', { name: '重试读取', exact: true }).click();
    await home.getByRole('heading', { name: 'Decision Case 记录暂不可读取', level: 1 }).waitFor();
    const home500Text = await home.innerText();
    check('R2-F2-case-500-no-empty-copy',
      !home500Text.includes('从第一个 Case 开始') &&
      !home500Text.includes('还没有待处理事项') &&
      home500Text.includes('待处理事项暂不可读取'),
    );

    // Restore Case permission -> verify Search restores Cases and repeated selection after Esc works!
    await page.unroute('**/api/cases*');
    await home.getByRole('button', { name: '重试读取', exact: true }).click();
    await home.getByRole('heading', { name: '确认首批核查门店及责任人', level: 1 }).waitFor();

    for (let attempt = 1; attempt <= 2; attempt++) {
      await page.locator('body').click({ position: { x: 10, y: 10 } });
      await page.keyboard.press('/');
      await searchDlg.waitFor();
      await searchDlg.locator('#workspace-quick-search').fill('合成低复购门店干预');
      await searchDlg.getByRole('button', { name: /合成低复购门店干预/ }).first().click();
      const caseDetailDlg = page.getByRole('dialog', { name: '合成低复购门店干预', exact: true });
      await caseDetailDlg.waitFor();
      await page.keyboard.press('Escape');
      await caseDetailDlg.waitFor({ state: 'hidden' });
    }
    check('R2-F1-repeated-same-case-search-selection-after-esc', true);
    await context.close();
  }

  // 5. Finding 3: Multi-project Case (completed P1 owner 甲 + cancelled P2 unset owner with report R2) + Decision Board Action items!
  {
    const { project: pDone } = await api('/api/projects', 'POST', { name: '一号已完成门店核查' });
    const { project: pCancel } = await api('/api/projects', 'POST', { name: '二号已取消渠道试点' });
    const { task: pCancelTask } = await api(`/api/projects/${pCancel.id}/tasks`, 'POST', {
      name: '渠道试点留档分析', assignment: { type: 'analysis', skill: null },
    });
    await api(`/api/projects/${pCancel.id}/files/save-report`, 'POST', {
      name: '二号项目归档报告.md',
      text: '# 二号项目归档报告\n\n试点取消前留档。',
    });

    const { case: multiCase } = await api('/api/cases', 'POST', {
      operationId: randomUUID(),
      title: '多项目状态与报告归属核验',
      description: '验证多项目状态分布与报告责任人归属',
      goalBinding: { primary: { goalId: goal.goalId, version: goal.version }, related: [], strategy: '多项目核查与渠道试点协同验证' },
    });
    const { case: mc1 } = await api(`/api/cases/${encodeURIComponent(multiCase.id)}`, 'PATCH', {
      operationId: randomUUID(), expectedRevision: multiCase.revision,
      title: multiCase.title, description: multiCase.description,
      judgement: '一号完成、二号取消', nextStep: '核对多项目结项与报告责任归属',
    });
    const { case: mc2 } = await api(`/api/cases/${encodeURIComponent(multiCase.id)}/projects`, 'POST', {
      operationId: randomUUID(), expectedRevision: mc1.revision, projectId: pDone.id,
    });
    const { case: mc3 } = await api(`/api/cases/${encodeURIComponent(multiCase.id)}/projects`, 'POST', {
      operationId: randomUUID(), expectedRevision: mc2.revision, projectId: pCancel.id,
    });
    await api(`/api/cases/${encodeURIComponent(multiCase.id)}/artifacts`, 'POST', {
      operationId: randomUUID(), expectedRevision: mc3.revision,
      projectId: pCancel.id, taskId: pCancelTask.id, relativePath: '060_reports/二号项目归档报告.md', role: 'report',
    });
    await api(`/api/projects/${pDone.id}/work`, 'PATCH', {
      operationId: randomUUID(), expectedRevision: 0, workStatus: 'completed',
      workScope: '已完成核查', assignee: '甲负责人', nextStep: '已结项', statusReason: null, originCaseId: multiCase.id,
    });
    await api(`/api/projects/${pCancel.id}/work`, 'PATCH', {
      operationId: randomUUID(), expectedRevision: 0, workStatus: 'cancelled',
      workScope: '已取消试点', assignee: '', nextStep: '无', statusReason: '调整方向', originCaseId: multiCase.id,
    });

    const { context, page } = await open({ width: 1440, height: 900 });
    const home = page.getByRole('region', { name: '工作台首页' });
    await home.waitFor();
    await home.getByRole('heading', { name: '多项目状态与报告归属核验', level: 2 }).waitFor();

    const proofAside = home.locator('.dh-proof');
    const proofText = await proofAside.innerText();
    check('R2-F3-multi-project-completed-cancelled-chart',
      proofText.includes('关联项目工作状态') &&
      proofText.includes('已完成') &&
      proofText.includes('已取消') &&
      proofText.includes('来源 · 关联项目工作记录') &&
      !proofText.includes('二号项目归档报告'),
      proofText,
    );

    const r2QueueBtn = home.getByRole('list', { name: '需要你处理' }).getByRole('button', { name: /二号项目归档报告/ });
    const r2QueueText = await r2QueueBtn.innerText();
    check('R2-F3-report-owner-from-own-project-not-p1',
      r2QueueText.includes('待定') && !r2QueueText.includes('甲负责人'),
      r2QueueText,
    );

    // Close multiCase so primaryCase returns as the active focus Case, and add a real Decision Board action on mainProj!
    const latestMulti = (await api(`/api/cases/${encodeURIComponent(multiCase.id)}`)).case;
    await api(`/api/cases/${encodeURIComponent(multiCase.id)}/close`, 'POST', {
      operationId: randomUUID(), expectedRevision: latestMulti.revision, reason: '完成核验归档',
    });

    const { item: boardItem } = await api('/api/decision-board/items', 'POST', {
      projectId: mainProj.id,
      title: '安排华东三店高频商品缺货现场复核',
      rationale: '缺货天数偏高',
      expectedImpact: '恢复重点单品有货率',
      priority: 'high',
    });
    await api(`/api/decision-board/items/${encodeURIComponent(boardItem.id)}/adopt`, 'POST', {});
    const { task: boardAction } = await api(`/api/decision-board/items/${encodeURIComponent(boardItem.id)}/tasks`, 'POST', {
      title: '回收虹口与滨江两店到货核查单',
      owner: '王店长',
      dueDate: '2026-12-05',
      priority: 'high',
      note: '首批核查行动',
    });
    await api(`/api/decision-board/tasks/${encodeURIComponent(boardAction.id)}/status`, 'POST', { status: 'doing' });

    // Touch primaryCase so it is the top active Case, reload Home, and verify Decision Board action progress + owner + dueDate!
    const pCaseNow = (await api(`/api/cases/${encodeURIComponent(primaryCase.id)}`)).case;
    await api(`/api/cases/${encodeURIComponent(primaryCase.id)}`, 'PATCH', {
      operationId: randomUUID(), expectedRevision: pCaseNow.revision,
      title: pCaseNow.title, description: pCaseNow.description,
      judgement: pCaseNow.judgement, nextStep: '确认首批核查门店及责任人',
    });

    await home.getByRole('button', { name: '刷新', exact: true }).click();
    await home.getByRole('heading', { name: '合成低复购门店干预', level: 2 }).waitFor();
    const actionProofText = await proofAside.innerText();
    check('R2-F3-decision-board-action-proof-and-source',
      actionProofText.includes('已关联行动进展') &&
      actionProofText.includes('执行中') &&
      actionProofText.includes('来源 · 决策看板行动记录'),
      actionProofText,
    );
    const actionRowText = await home.getByRole('list', { name: '需要你处理' }).getByRole('button', { name: /回收虹口与滨江两店到货核查单/ }).innerText();
    check('R2-F3-decision-board-action-owner-and-duedate',
      actionRowText.includes('王店长') && actionRowText.includes('12/05') && actionRowText.includes('执行中'),
      actionRowText,
    );
    await context.close();
  }

  // 6. Responsive screenshots at 1440 / 1024 / 390 in light & dark themes (Home + Foundation Overview + Dark Rail check).
  for (const [width, height] of [[1440, 900], [1024, 768], [390, 844]]) {
    for (const theme of ['light', 'dark']) {
      const { context, page } = await open({ width, height }, theme);
      if (theme === 'dark') {
        const currentTheme = await page.locator('.app').getAttribute('data-theme');
        if (currentTheme !== 'dark') {
          await page.getByRole('button', { name: '切换为深色', exact: true }).click();
        }
      }
      const home = page.getByRole('region', { name: '工作台首页' });
      await home.waitFor();
      await page.getByRole('heading', { name: '确认首批核查门店及责任人', level: 1 }).waitFor();
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
      check(`W09-home-no-overflow-${width}-${theme}`, !overflow);
      if (width === 1440 && theme === 'dark') {
        const sidebarBgDark = await page.locator('#sidebar').evaluate(el => getComputedStyle(el).backgroundColor);
        check('R2-F6-dark-rail-dark-mode', sidebarBgDark === 'rgb(16, 15, 21)', `bg=${sidebarBgDark}`);
      }
      await shot(page, `03-seeded-home-${width}-${theme}`);

      await home.getByRole('button', { name: '查看建设总览', exact: true }).click();
      const foRegion = page.getByRole('region', { name: '基础建设总览' });
      await foRegion.waitFor();
      await foRegion.getByRole('button', { name: '刷新', exact: true }).waitFor();
      const foOverflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
      check(`W09-foundation-overview-no-overflow-${width}-${theme}`, !foOverflow);
      await shot(page, `04-foundation-overview-${width}-${theme}`);
      await context.close();
    }
  }

  // 7. Finding 4 & Finding 5: Desktop 1440px Side-by-Side Report + Evidence, 2 distinct citationIds, exact attachment path/SHA, Settings persistence, Distinct return contexts, and W03!
  {
    const { context, page } = await open({ width: 1440, height: 900 });
    const home = page.getByRole('region', { name: '工作台首页' });
    await home.waitFor();

    // Open report from Home queue (origin = primaryCase).
    await home.getByRole('list', { name: '需要你处理' }).getByRole('button', { name: /华东复购诊断报告/ }).click();
    const desk = page.getByRole('region', { name: '任务结论报告与依据工作台' });
    await desk.waitFor();
    await desk.getByText(/返回来源 Case · 合成低复购门店干预/).waitFor();

    const reportPre = desk.locator(`pre[aria-label="${reportPath}"]`);
    await reportPre.waitFor();
    check('W04-desk-report-body-visible', (await reportPre.innerText()).includes('上海虹口店、杭州滨江店与苏州园区店'));

    // Verify TWO distinct citationIds in 引用来源!
    const sourceList = desk.getByRole('region', { name: '引用来源', exact: true });
    await sourceList.waitFor();
    await waitUntil(async () => (await sourceList.getByRole('button').count()) >= 4, 'evidence sources loaded');
    const sourceButtonsCount = await sourceList.getByRole('button').count();
    check('R2-F4-multiple-evidence-sources-rendered', sourceButtonsCount >= 4, `count=${sourceButtonsCount}`);

    // Select Citation 1 declaration -> check citationId1
    await sourceList.getByRole('button', { name: new RegExp(citationId1.slice(0, 8)) }).first().click();
    const detailSection = desk.getByRole('region', { name: '选中依据的原文及版本', exact: true });
    await waitUntil(async () => (await detailSection.innerText()).includes(citationDecl1), 'citation 1 declaration text');
    check('R2-F4-citation-1-exact-id', (await detailSection.innerText()).includes(citationId1));

    // Select Citation 2 declaration -> check citationId2 (distinct!)
    await sourceList.getByRole('button', { name: new RegExp(citationId2.slice(0, 8)) }).first().click();
    await waitUntil(async () => (await detailSection.innerText()).includes(citationDecl2), 'citation 2 declaration text');
    const detail2Text = await detailSection.innerText();
    check('R2-F4-citation-2-distinct-exact-id', detail2Text.includes(citationId2) && !detail2Text.includes(citationId1));

    // Click inline citation / accurate source for Attachment 1 (`门店缺货明细.md`) and verify:
    // 1) Own path `020_clean/门店缺货明细.md` (NEVER `060_reports/华东复购诊断报告.md`)
    // 2) Own SHA-256 `uploadedAttachment1.sha256` (NEVER `reportSha`)
    // 3) Desktop 1440px side-by-side: reportPre AND evidencePre are BOTH simultaneously in viewport!
    const inlineCit2 = desk.locator('.pv-report-refs').getByRole('button', { name: /门店缺货明细\.md/ });
    await inlineCit2.click();
    const evidencePre = detailSection.locator('pre.pv-evidence-pre');
    await waitUntil(async () => (await evidencePre.innerText().catch(() => '')).includes('高频商品缺货天数高于均值 3.8 天'), 'attachment 1 body');
    const attMetaText = await detailSection.locator('.pv-source-meta-dl').innerText();
    check('R2-F4-attachment-shows-own-path-and-sha-not-report',
      attMetaText.includes(mainProj.id) &&
      attMetaText.includes(citationId1) &&
      attMetaText.includes('020_clean/门店缺货明细.md') &&
      !attMetaText.includes(reportPath) &&
      attMetaText.includes(uploadedAttachment1.sha256) &&
      !attMetaText.includes(reportSha),
      attMetaText,
    );

    const rBox = await reportPre.boundingBox();
    const eBox = await evidencePre.boundingBox();
    check('R2-F4-desktop-1440-side-by-side-both-in-viewport',
      Boolean(rBox && eBox) &&
      rBox.y >= 0 &&
      rBox.y + rBox.height <= 900 &&
      eBox.y >= 0 &&
      eBox.y + eBox.height <= 900 &&
      rBox.x + rBox.width <= eBox.x + 4,
      `report=${JSON.stringify(rBox)} evidence=${JSON.stringify(eBox)}`,
    );

    // Screenshot at 1440px WHILE attachment evidence is open side-by-side (light & dark)!
    await shot(page, '05-report-attachment-open-1440-light', false);
    await page.getByRole('button', { name: '切换为深色', exact: true }).click();
    await shot(page, '05-report-attachment-open-1440-dark', false);
    await page.getByRole('button', { name: '切换为浅色', exact: true }).click();

    // Press Escape inside desktop reader -> focus returns to trigger button on report!
    await evidencePre.focus();
    await page.keyboard.press('Escape');
    await waitUntil(async () => inlineCit2.evaluate(el => document.activeElement === el), 'Escape restores focus to report source trigger');
    check('R2-F4-desktop-escape-restores-trigger-focus', true);

    // Finding 5 + W08: Settings -> 连接配置 -> 返回项目空间 keeps TaskReportDesk report `<pre>`, selected attachment, and sourceCase open!
    await page.locator('#sidebar').getByRole('button', { name: '设置', exact: true }).click();
    await page.getByRole('heading', { name: '设置', level: 1 }).waitFor();
    const settingsGroup = page.getByRole('group', { name: '设置分类', exact: true });
    await settingsGroup.getByRole('button', { name: '连接配置', exact: true }).click();
    await page.locator('.settings-heading .back-button').click();
    await desk.waitFor();
    await reportPre.waitFor();
    check('R2-F5-desk-report-stays-open-after-settings-return',
      (await reportPre.isVisible()) &&
      (await evidencePre.innerText()).includes('高频商品缺货天数高于均值 3.8 天') &&
      (await desk.getByText(/返回来源 Case · 合成低复购门店干预/).isVisible()),
    );

    // Switch to 任务对话 -> verify draft preserved, AND test narrow inspector manual report open -> Settings -> Return persistence + exact attachment metadata!
    await desk.getByRole('button', { name: '任务对话' }).click();
    check('W08-draft-preserved-across-desk-and-settings', (await page.locator('#message-input').inputValue()) === savedDraft);

    await page.getByRole('button', { name: '查看报告与依据', exact: true }).click();
    const inspector = page.getByRole('region', { name: '任务检视区', exact: true });
    await inspector.waitFor();
    await inspector.getByRole('button', { name: '查看本版报告', exact: true }).click();
    await inspector.locator(`pre[aria-label="${reportPath}"]`).waitFor();

    // Verify inspector TaskReportReferences ALSO shows attachment's OWN path & SHA-256!
    await inspector.getByRole('button', { name: '查看固定输入与计算依据', exact: true }).click();
    const attBtnInspector = inspector.getByRole('button', { name: '读取这份固定附件', exact: true }).first();
    await attBtnInspector.waitFor();
    await attBtnInspector.click();
    const inspectorCitationReader = inspector.getByRole('region', { name: '引用原文检视', exact: true });
    await inspectorCitationReader.waitFor();
    const inspectorMeta = await inspectorCitationReader.locator('.task-citation-meta').innerText();
    check('R2-F4-inspector-attachment-meta-exact',
      inspectorMeta.includes(citationId1) &&
      inspectorMeta.includes('020_clean/门店缺货明细.md') &&
      inspectorMeta.includes(uploadedAttachment1.sha256) &&
      !inspectorMeta.includes(reportSha),
      inspectorMeta,
    );
    await page.keyboard.press('Escape');
    await inspectorCitationReader.waitFor({ state: 'hidden' });

    // Manually opened report in inspector -> Settings -> 连接配置 -> 返回项目空间 -> `<pre>` MUST NOT collapse!
    await page.locator('#sidebar').getByRole('button', { name: '设置', exact: true }).click();
    await page.getByRole('heading', { name: '设置', level: 1 }).waitFor();
    await page.getByRole('group', { name: '设置分类', exact: true }).getByRole('button', { name: '连接配置', exact: true }).click();
    await page.locator('.settings-heading .back-button').click();
    await inspector.locator(`pre[aria-label="${reportPath}"]`).waitFor();
    check('R2-F5-manual-inspector-report-body-persists-across-settings', await inspector.locator(`pre[aria-label="${reportPath}"]`).isVisible());

    // Finding 5: Open the SAME task independently via `/` Search -> stale sourceCase MUST NOT carry over!
    await page.locator('body').click({ position: { x: 10, y: 10 } });
    await page.keyboard.press('/');
    const searchDlg = page.getByRole('dialog', { name: '搜索工作区', exact: true });
    await searchDlg.waitFor();
    await searchDlg.locator('#workspace-quick-search').fill('华东复购主分析');
    await searchDlg.getByRole('button', { name: /华东复购主分析/ }).first().click();
    await page.locator('#message-input').waitFor();
    check('R2-F5-independent-task-open-clears-source-case',
      (await page.locator('.task-mode-source-case').count()) === 0 &&
      (await page.locator('.report-source-case').count()) === 0,
    );

    // Enter the same task from coldCase -> sourceCase must reflect coldCase, never primaryCase!
    await page.getByRole('navigation', { name: '主导航', exact: true }).getByRole('button', { name: '决策星图', exact: true }).click();
    await page.getByRole('button', { name: '常规', exact: true }).click();
    await page.getByRole('button', { name: '冷启动测试事项', exact: true }).click();
    const coldDlg = page.getByRole('dialog', { name: '冷启动测试事项', exact: true });
    await coldDlg.waitFor();
    await coldDlg.getByRole('button', { name: '继续分析任务', exact: true }).click().catch(async () => {
      // Or click task button under projects tab
      await coldDlg.getByRole('button', { name: /项目/ }).first().click();
    });
    // Also verify W03 Project Map 6-type task strip & zero-task project
    await page.keyboard.press('Escape').catch(() => {});
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
    await page.keyboard.press('Escape');
    const afterTasksCount = (await api('/api/projects')).projects.reduce((sum, p) => sum + p.tasks.length, 0);
    check('W03-map-navigation-creates-zero-tasks', beforeTasksCount === afterTasksCount);
    await context.close();
  }

  // 8. Finding 4 Mobile 390x844 Independent Evidence Bottom-Sheet Drawer + Esc Focus Return + Version Mismatch Safety!
  {
    const { context, page } = await open({ width: 390, height: 844 });
    const home = page.getByRole('region', { name: '工作台首页' });
    await home.waitFor();
    await home.getByRole('list', { name: '需要你处理' }).getByRole('button', { name: /华东复购诊断报告/ }).click();

    const desk = page.getByRole('region', { name: '任务结论报告与依据工作台' });
    await desk.waitFor();
    await desk.locator(`pre[aria-label="${reportPath}"]`).waitFor();
    check('R2-F4-mobile-390-hides-desktop-aside', (await desk.locator('.pv-reader-desktop').count()) === 0);

    const mobileRefBtn = desk.locator('.pv-report-refs').getByRole('button', { name: /门店缺货明细\.md/ });
    await mobileRefBtn.scrollIntoViewIfNeeded();
    await mobileRefBtn.click();

    const mobileDrawer = page.locator('dialog.pv-reader-mobile');
    await mobileDrawer.waitFor({ state: 'visible' });
    check('R2-F4-mobile-390-drawer-is-modal', await mobileDrawer.evaluate(el => el.matches(':modal')));
    await waitUntil(async () => (await mobileDrawer.innerText()).includes('高频商品缺货天数高于均值 3.8 天'), 'mobile drawer attachment body');
    const mobileMeta = await mobileDrawer.locator('.pv-source-meta-dl').innerText();
    check('R2-F4-mobile-390-attachment-exact-path-and-sha',
      mobileMeta.includes('020_clean/门店缺货明细.md') &&
      mobileMeta.includes(uploadedAttachment1.sha256) &&
      !mobileMeta.includes(reportSha),
    );

    // Screenshot at 390px WHILE mobile evidence drawer is OPEN (light & dark)!
    await shot(page, '06-report-attachment-drawer-390-light', false);
    await page.keyboard.press('Escape');
    await mobileDrawer.waitFor({ state: 'hidden' });
    await waitUntil(async () => mobileRefBtn.evaluate(el => document.activeElement === el), '390px Escape restores focus to trigger');
    check('R2-F4-mobile-390-escape-restores-trigger-focus', true);

    await page.getByRole('button', { name: '切换为深色', exact: true }).click();
    await mobileRefBtn.click();
    await mobileDrawer.waitFor({ state: 'visible' });
    await shot(page, '06-report-attachment-drawer-390-dark', false);
    await mobileDrawer.getByRole('button', { name: '关闭并返回来源', exact: true }).click();
    await mobileDrawer.waitFor({ state: 'hidden' });
    await context.close();
  }

  // 9. W06 Concrete Deep-Link Check (`?management=gsa`) + Report 409 Version-Mismatch Safety!
  {
    const { context, page } = await open({ width: 1440, height: 900 }, 'light', base + '/?management=gsa');
    await waitUntil(async () => {
      const txt = await page.locator('main').innerText().catch(() => '');
      const hasGoal =
        txt.includes('冷启动验证目标') ||
        txt.includes(goalTitle) ||
        txt.includes('华东60天复购率提升至23%') ||
        txt.includes('重点门店高频商品缺货率降至2%以内');
      const hasGsaControls =
        txt.includes('总目标') || txt.includes('GSA') || txt.includes('拆解') || txt.includes('切换目标');
      return hasGoal && hasGsaControls;
    }, 'concrete goal & GSA workspace on ?management=gsa');
    check('W06-deep-link-renders-concrete-goal-and-gsa-controls',
      !(await page.getByRole('region', { name: '工作台首页' }).isVisible().catch(() => false)),
    );
    await shot(page, '07-w06-gsa-deeplink-1440-light', false);
    await context.close();
  }

  // Overwrite report file on disk to verify TaskReportDesk blocks 409 tampered live file while keeping fixed snapshot readable!
  {
    await writeFile(path.join(root, 'projects', mainProj.id, reportPath), '# 被篡改的同名文件\n不应静默替代固定版本。');
    const { context, page } = await open(
      { width: 1440, height: 900 },
      'light',
      `${base}/?project=${encodeURIComponent(mainProj.id)}&task=${encodeURIComponent(tAnalysis1.id)}&panel=report&report=${encodeURIComponent(reportPath)}&sha256=${encodeURIComponent(reportSha)}`,
    );
    const desk = page.getByRole('region', { name: '任务结论报告与依据工作台' });
    await desk.waitFor();
    const alert = desk.getByRole('alert').first();
    await alert.waitFor();
    const alertText = await alert.innerText();
    check('R2-F4-report-409-tamper-blocked-preserves-locator',
      alertText.includes(mainProj.id) &&
      alertText.includes(reportPath) &&
      alertText.includes(reportSha) &&
      (await desk.locator(`pre[aria-label="${reportPath}"]`).count()) === 0,
    );
    // Fixed report snapshot in right-hand reader still returns original untampered reportBody!
    const snapBtn = desk.getByRole('region', { name: '引用来源', exact: true }).getByRole('button', { name: /固定报告快照/ }).first();
    await snapBtn.click();
    await waitUntil(async () => (await desk.locator('pre.pv-evidence-pre').innerText().catch(() => '')).includes('上海虹口店、杭州滨江店与苏州园区店'), 'fixed report snapshot survives live path tamper');
    check('R2-F4-fixed-snapshot-readable-after-live-tamper', true);
    await context.close();
  }

  // 10. W05 Publication Withdrawal & Version History Preservation!
  {
    const { context, page } = await open({ width: 1440, height: 900 });
    await page.getByRole('navigation', { name: '主导航', exact: true }).getByRole('button', { name: '战略选择', exact: true }).click();
    await page.getByRole('heading', { name: '战略选择', level: 1 }).waitFor();
    await page.selectOption('select[aria-label="战略事项"]', init6Id);
    await page.getByRole('button', { name: '战略发布', exact: true }).click();
    await page.getByRole('button', { name: '撤销发布', exact: true }).click();
    const withdrawDlg = page.getByRole('dialog', { name: '撤销当前发布', exact: true });
    await withdrawDlg.waitFor();
    await withdrawDlg.getByRole('button', { name: '确认撤销发布', exact: true }).click();
    await page.waitForSelector('text=此版已撤销，保留原稿、检验结论和承接历史。同版不能重新发布。');
    check('W05-withdraw-disables-new-handoff-preserves-receipt',
      (await page.getByRole('button', { name: '带入目标管理' }).count()) === 0 &&
      (await page.getByRole('complementary', { name: '目标承接回执' }).innerText()).includes('1 批目标候选已导入'),
    );
    await page.getByRole('button', { name: '版本管理', exact: true }).click();
    await waitUntil(async () => {
      const txt = await page.locator('main').innerText().catch(() => '');
      return txt.includes('发布已撤销') && txt.includes('已保存目标候选');
    }, 'version ledger retains withdrawn publication and handoff receipt');
    check('W05-version-history-retains-withdrawn-publication-and-handoff', true);
    await context.close();
  }

  check('W09-zero-page-errors', errors.length === 0, errors.join('; '));
  receipt.totalChecks = receipt.checks.length;
  receipt.passedChecks = receipt.checks.filter(c => c.ok).length;
  await writeFile(path.join(root, 'receipt.json'), JSON.stringify(receipt, null, 2));
  console.log(JSON.stringify({ run, root, totalChecks: receipt.totalChecks, passedChecks: receipt.passedChecks, screenshots: receipt.screenshots.length }));
} finally {
  await browser.close();
  await host.close();
  await provider.close();
}
