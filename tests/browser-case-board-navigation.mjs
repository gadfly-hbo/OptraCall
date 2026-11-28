// Environment-only browser rerun, outside npm test/CI: uses this workspace's installed Playwright.
// Actual React components and production CSS in Chromium with bounded synthetic HTTP responses.
// This harness is not the real Host and its screenshots are regression evidence, not user product-UI acceptance.
// Frozen v0.6 uses inline Case/project pages; do not restore obsolete drawers to satisfy old selectors.
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { createServer } from 'node:http';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from '/opt/codex/runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs';
const run = process.env.CASE_NAV_RUN ?? `run-${Date.now()}`;
const root = path.resolve('.local/pm-second-ui/navigation', run);
await mkdir(root, { recursive: true });
const now = '2026-11-27T12:00:00Z';
const cases = ['A', 'B'].map(id => ({ id, title: `Case ${id}`, description: `背景 ${id}`, judgement: '整 Case 判断不得当本轮结论', nextStep: '整 Case 下一步不得当本轮下一步', revision: 1, status: 'pending', createdAt: now, updatedAt: now, closedAt: null, closeReason: null }));
const issues = ['a', 'b'].map(id => ({ id, caseId: 'A', title: `事项 ${id}`, createdAt: now }));
const configuration = { id: 'model', name: '合成', provider: 'openai-compatible', api: 'openai-completions', model: 'synthetic', revision: 1 };
const projects = [{ id: 'P', name: '原共享项目', schemaVersion: 2, configuration, rootPath: '/synthetic', createdAt: now, updatedAt: now, archivedAt: null, tasks: issues.map(i => ({ id: `task-${i.id}`, name: `任务 ${i.id}`, draft: '', configuration, createdAt: now, updatedAt: now, sessionStorage: 'task', assignment: { type: i.id === 'a' ? 'plan' : 'teach', issue: { caseId: 'A', issueId: i.id } } })) }];
projects[0].tasks.push({id:'foreign',name:'别案事项任务',configuration,createdAt:now,updatedAt:now,draft:'',sessionStorage:'task',assignment:{type:'analysis',issue:{caseId:'C',issueId:'foreign-issue'}}},{id:'legacy',name:'原独立旧任务',configuration,createdAt:now,updatedAt:now,draft:'',sessionStorage:'task'},{id:'unbound',name:'未绑定Case的分类任务',configuration,createdAt:now,updatedAt:now,draft:'',sessionStorage:'task',assignment:{type:'plan'}});
projects.push({id:'Q',name:'原零任务项目',schemaVersion:2,configuration,rootPath:'/synthetic-empty',createdAt:now,updatedAt:now,archivedAt:null,tasks:[]});
const projectLinks = cases.flatMap(c => projects.map(project=>({ caseId: c.id, projectId:project.id, linkedAt: now })));
const timeline = id => ({ issue: issues.find(i => i.id === id), rounds: [{ choice: { choiceId: `choice-${id}`, caseId: 'A', issueId: id, choice: 'defer', reason: `取舍 ${id}`, occurredAt: now, strategyRef: { type: 'case-decision', caseStoreId: 'store', caseId: 'A', recordId: `plan-${id}`, revision: 2 } }, strategy: { recordId: `plan-${id}`, revision: 2, payload: { title: `方案 ${id}` }, references: [] }, actions: [], reviewSaved: true, review: { judgement: `本轮判断 ${id}`, nextStep: `本轮下一步 ${id}`, observation: `本轮观察 ${id}`, operationId: `review-${id}`, createdAt: now, reply: { type: 'native-reply', projectId: 'P', taskId: `task-${id}`, sessionId: 'native', messageId: `reply-${id}`, expectedTextSha256: 'a'.repeat(64) } } }] });
await build({ stdin: { contents: `import React,{useState} from 'react'; import {createRoot} from 'react-dom/client'; import {CaseBoard} from './src/host/ui/CaseBoard.tsx'; import {ProjectBoard} from './src/host/ui/ProjectBoard.tsx';
import './src/host/ui/styles.css';import './src/host/ui/workspace-visual.css';import './src/host/ui/visual-refresh-settings.css';import './src/host/ui/daily-case-current.css';import './src/host/ui/daily-workspace.css';
const projects=${JSON.stringify(projects)}; const noop=()=>{}; const refresh=async()=>{};
function Harness(){const [view,setView]=useState('case'),[target,setTarget]=useState({id:'A',seq:1}),[entry,setEntry]=useState(null); window.prepareWithGoal=()=>{setEntry({goal:{goalId:'exact-goal',version:7,strategy:'准确策略',title:'准备标题'},source:{kind:'case',caseId:'A',caseRevision:1}});setView('case')};window.openCase=id=>{setTarget(p=>({id,seq:p.seq+1}));setView('case')};return <div className="app" data-daily-workspace="true"><main className="main"><nav aria-label="回归测试栏目导航"><button onClick={()=>setView('case')}>返回 Case 栏目</button><button onClick={()=>setView('project')}>全部项目栏目</button></nav><div className="workspace-panel-body" hidden={view!=='case'} style={{display:view==='case'?'flex':'none'}}><CaseBoard visible={view==='case'} initialGoal={entry?.goal} initialSource={entry?.source} onInitialGoalConsumed={()=>setEntry(null)} initialCaseId={target.id} initialCaseSeq={target.seq} projects={projects} configurations={[]} decisionUi={{}} onDecisionUiChange={noop} onOpenTask={noop} onCreateTask={noop} onProjectChange={refresh} onOpenProject={project=>{window.openedOriginalProject=project.id;setView('project')}} onPrepareCase={input=>{window.prepared=input??{};setView('prepare')}} /></div><div className="workspace-panel-body" hidden={view!=='project'} style={{display:view==='project'?'flex':'none'}}><ProjectBoard visible={view==='project'} projects={projects} onOpenTask={noop} onCreateProject={noop} onCreateTask={noop} onRename={noop} onArchive={noop} onRestore={noop} onProjectChange={refresh} onOpenCase={window.openCase}/></div></main></div>};createRoot(document.getElementById('root')).render(<Harness/>);`, resolveDir: process.cwd(), loader: 'tsx' }, bundle: true, format: 'esm', outdir: root, entryNames: 'harness', logLevel: 'silent' });
const server = createServer(async (req, res) => { try { const file = req.url === '/harness.js' ? 'harness.js' : req.url === '/harness.css' ? 'harness.css' : null; res.setHeader('Content-Type', file?.endsWith('.js') ? 'text/javascript' : file ? 'text/css' : 'text/html'); res.end(file ? await readFile(path.join(root, file)) : '<html><head><link rel="stylesheet" href="/harness.css"></head><body><div id="root"></div><script type="module" src="/harness.js"></script></body></html>'); } catch { res.statusCode = 404; res.end(); } });
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH ?? '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
page.setDefaultTimeout(6000);
let detailStatus = 200, timelineStatus = 200, draftWriteStatus = 200;
const errors = [], checks = [], sourceReads = [], modelWrites = [];
const drafts = new Map();
page.on('pageerror', error => errors.push(error.message));
await page.route('**/api/**', async route => {
  const pathname = new URL(route.request().url()).pathname;
  let status = 200, value = { items: [], choices: [], requests: [], drafts: [], edges: [], enterprises: [], events: [], history: [], goalBinding: null, references: [], available: [], unavailable: [], limitations: [], replies: [], continuation: null };
  if (pathname === '/api/configurations') value = { configurations: [configuration], selectedId: configuration.id };
  else if (pathname === '/api/business-role') { value = { discussion: null, busy: false }; if(route.request().method() !== 'GET') modelWrites.push(route.request().postDataJSON()); }
  else if (pathname === '/api/cases/storage') value = { state: 'ready', storeId: 'store' };
  else if (pathname === '/api/cases') value = { cases, projectLinks };
  else if (pathname === '/api/case-relations') value = { items: [], writingEnabled: true, hasMore: false, continuation: null };
  else if (/\/api\/cases\/[AB]$/.test(pathname)) { const id = pathname.split('/').at(-1); status = detailStatus; value = status === 200 ? { case: cases.find(c => c.id === id), projectLinks: projectLinks.filter(l => l.caseId === id), artifacts: [], events: [], projectEvents: [], pendingOperations: [] } : { code: 'case_request_failed' }; }
  else if (/\/decisions\/issues$/.test(pathname)) value = { issues: pathname.includes('/A/') ? issues : [] };
  else if (/\/decisions\/issues\/[ab]$/.test(pathname)) { status = timelineStatus; value = status === 200 ? timeline(pathname.split('/').at(-1)) : {code:'case_request_failed'}; }
  else if (/\/decisions\/issues\/[ab]\/reply$/.test(pathname)) { const source = route.request().postDataJSON(); sourceReads.push({ pathname, source }); value = {title: '准确原回复', text: `原回复 ${source.messageId} · 保留准确来源`}; }
  else if (/\/workspace\/drafts\/[^/]+\/[^/]+$/.test(pathname)) {
    const id = decodeURIComponent(pathname.split('/').at(-1)), previous = drafts.get(id);
    if (route.request().method() === 'PUT') {
      if (draftWriteStatus !== 200) { await route.fulfill({status:draftWriteStatus,contentType:'application/json',body:JSON.stringify({code:'draft_storage_unavailable'})}); return; }
      const input = route.request().postDataJSON();
      if ((previous?.revision ?? 0) !== input.expectedRevision) { status = 409; value = { code: 'workspace_draft_conflict' }; }
      else { const draft = { kind:'issue-draft', id, revision:(previous?.revision ?? 0)+1, payload:input.payload, createdAt:now, updatedAt:now }; drafts.set(id, draft); value = {draft}; }
    } else if (previous) value = {draft:previous};
    else { status = 404; value = { code: 'draft_not_found' }; }
  }
  await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(value) });
});
const verify = async (name, fn) => { try { await fn(); checks.push({ name, ok: true }); } catch (e) { checks.push({ name, ok: false, error: e.message }); } };
const detail = page.getByRole('region', { name: 'Case 详情', exact: true });
const tab = key => detail.locator('.case-detail-tabs button').nth(key).click();
const summary = () => detail.getByRole('region', { name: '本轮概览', exact: true });
const selectIssue = async id => {
  const sidebar = detail.getByRole('complementary', { name: '事项关系与视图切换', exact: true });
  const mobileSelect = sidebar.getByLabel('当前事项', { exact: true });
  if (await mobileSelect.isVisible()) await mobileSelect.selectOption(id);
  else await sidebar.locator('.case-issue-list').first().getByRole('button', { name: new RegExp(`^事项 ${id}`) }).click();
  // Selection awaits draft flush; observe the selected owner before editing its composer.
  await detail.locator('.case-current-title').getByRole('heading', {name:`事项 ${id}`,exact:true}).waitFor();
};
const refreshDetail = async () => {
  const management = detail.locator('.daily-case-actions');
  if (!await management.evaluate(node => node.open)) await management.locator('summary').click();
  await management.getByRole('button', { name: '刷新详情', exact: true }).click();
};
const returnCaseOverview = () => detail.getByRole('button', { name: '← 返回 Case 总览', exact: true }).click();
try {
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await detail.getByRole('heading', { name: 'Case A', exact: true }).waitFor();
  await selectIssue('a');
  await verify('summary uses exact current issue review and original identity', async () => {
    await summary().getByText('复盘判断：本轮判断 a', { exact: true }).waitFor();
    const text = await summary().innerText(); assert.match(text, /本轮判断 a/); assert.match(text, /本轮下一步 a/); assert.doesNotMatch(text, /整 Case/);
    // Raw choice IDs need not clutter the frozen UI. Follow the real source action and verify the complete original reply identity.
    await summary().getByRole('button', { name: '查看本轮原记录', exact: true }).click();
    await detail.getByText('复盘判断 · 本轮判断 a', { exact: true }).waitFor();
    await detail.getByRole('button', { name: '查看 Teach 原回复', exact: true }).click();
    await detail.getByText('原回复 reply-a · 保留准确来源', { exact: true }).waitFor();
    assert.deepEqual(sourceReads.at(-1), { pathname: '/api/cases/A/decisions/issues/a/reply', source: timeline('a').rounds[0].review.reply });
  });
  await verify('inline Case page uses sidebar selection, keyboard focus and reachable original composer', async () => {
    assert.equal(await detail.getByRole('dialog').count(), 0);
    await page.evaluate(() => window.openCase('B')); await detail.getByRole('heading', { name: 'Case B', exact: true }).waitFor();
    await page.waitForFunction(() => document.activeElement?.id === 'daily-case-title');
    await page.evaluate(() => window.openCase('A')); await detail.getByRole('heading', { name: 'Case A', exact: true }).waitFor();
    await tab(0); await selectIssue('a');
    const composer = detail.locator('.case-agent-entry .role-composer textarea');
    await composer.fill('事项 a 原草稿 <img src=x onerror="window.__draftXss=1">');
    await page.waitForFunction(() => document.querySelector('.case-agent-entry .role-composer textarea')?.value.includes('事项 a 原草稿'));
    await selectIssue('b'); await composer.fill('事项 b 独立草稿'); await selectIssue('a');
    await page.waitForFunction(() => document.querySelector('.case-agent-entry .role-composer textarea')?.value === '事项 a 原草稿 <img src=x onerror="window.__draftXss=1">');
    assert.equal(await composer.inputValue(), '事项 a 原草稿 <img src=x onerror="window.__draftXss=1">');
    assert.equal(await page.evaluate(() => window.__draftXss), undefined); assert.deepEqual(modelWrites, []);
  });
  await verify('a failed draft save blocks tab navigation and preserves input until recovery', async () => {
    const composer = detail.locator('.case-agent-entry textarea');
    draftWriteStatus = 503;
    await composer.fill('保存503时必须保留的原输入');
    await tab(3);
    await detail.getByText('输入尚未确认保存，已保留在当前事项，请核对草稿后再切换。', { exact: true }).waitFor();
    assert.equal(await detail.locator('.case-detail-tabs button').nth(0).getAttribute('aria-current'), 'page');
    assert.equal(await composer.inputValue(), '保存503时必须保留的原输入');
    draftWriteStatus = 200;
    await tab(3); await detail.getByRole('heading', {name:'历史与轮次',exact:true}).waitFor();
    await tab(0); await composer.waitFor();
    await page.waitForFunction(() => document.querySelector('.case-agent-entry textarea')?.value === '保存503时必须保留的原输入');
    assert.equal(await composer.inputValue(), '保存503时必须保留的原输入');
  });
  await verify('four current workspace tabs retain the pinned G/S region', async () => {
    assert.deepEqual(await detail.locator('.case-detail-tabs button').evaluateAll(buttons => buttons.map(button => [...button.childNodes].filter(node => node.nodeType === Node.TEXT_NODE).map(node => node.textContent).join(''))), ['当前工作', '项目与任务', '成果与依据', '历史']);
    assert.equal(await detail.locator('.case-detail-tabs button').nth(1).locator('span').textContent(), '2');
    for (let i = 0; i < 4; i++) { await tab(i); assert.equal(await detail.getByRole('region', { name: '常驻目标与具体策略' }).count(), 1); }
  });
  await tab(1); await detail.getByLabel('项目页事项范围', { exact: true }).selectOption('');
  await verify('all current Case excludes foreign and unbound project tasks with exact row origins', async () => {
    assert.equal(await detail.locator('.dcp-task-name').filter({ hasText: /^任务 a/ }).count(), 1); assert.equal(await detail.locator('.dcp-task-name').filter({ hasText: /^任务 b/ }).count(), 1);
    for (const name of ['别案事项任务', '原独立旧任务', '未绑定Case的分类任务']) assert.equal(await detail.getByText(name, { exact: true }).count(), 0, name);
    assert.match((await detail.locator('.dcp-task-table').allTextContents()).join(' '), /Case A.*事项 a/);
    assert.match((await detail.locator('.dcp-task-table').allTextContents()).join(' '), /Case A.*事项 b/);
  });
  await verify('zero-task and independent project work stay explicitly reachable', async () => {
    assert.equal(await detail.getByRole('heading', { name: '原零任务项目', exact: true }).count(), 1);
    assert.equal(await detail.locator('.dcp-project-title button').count(), 2);
  });
  await page.setViewportSize({ width: 390, height: 1000 });
  await verify('scoped task sources and original project entry fit 390px', async () => {
    const size = await detail.evaluate(el => ({ scroll: el.scrollWidth, client: el.clientWidth })); assert.ok(size.scroll <= size.client + 2);
    assert.equal(await detail.locator('.dcp-project-title button').count(), 2);
  });
  await page.screenshot({ path: path.join(root, 'scope-all-390.png') }); await page.setViewportSize({ width: 1440, height: 1000 });
  await tab(0); await selectIssue('b'); await tab(1);
  await verify('explicitly choosing a different issue resets both auxiliary views', async () => {
    assert.equal(await detail.locator('.case-scope-bar select').inputValue(), 'b');
    assert.equal(await detail.locator('.dcp-task-name').filter({ hasText: /^任务 a/ }).count(), 0); await tab(2);
    assert.equal(await detail.locator('.case-scope-bar select').inputValue(), 'b'); await tab(1);
  });
  await detail.getByLabel('项目页事项范围', { exact: true }).selectOption(''); await tab(3); await tab(1);
  await verify('ordinary tab redraw preserves manual range', async () => assert.equal(await detail.getByLabel('项目页事项范围', { exact: true }).inputValue(), ''));
  await page.evaluate(() => window.openCase('B')); await detail.getByRole('heading', { name: 'Case B', exact: true }).waitFor(); await tab(1);
  await verify('empty Case stays all with no inherited tasks and an original project entry', async () => {
    await page.waitForFunction(() => document.querySelector('.case-scope-bar option[value="__no_issue"]')?.disabled === true);
    assert.equal(await detail.locator('.case-scope-bar option[value="__no_issue"]').evaluate(option => option.disabled), true);
    assert.equal(await detail.getByLabel('项目页事项范围', { exact: true }).inputValue(), '');
    assert.equal(await detail.locator('.dcp-task-name').filter({ hasText: /^任务 a/ }).count(), 0);
    assert.equal(await detail.locator('.dcp-project-title button').count(), 2);
    assert.match(await detail.innerText(), /尚无明确归属本 Case 的任务/);
  });
  await detail.locator('.dcp-project-section').filter({ has: page.getByRole('heading', { name: '原共享项目', exact: true }) }).locator('summary').click();
  await detail.locator('.dcp-project-section').filter({ has: page.getByRole('heading', { name: '原共享项目', exact: true }) }).getByRole('button', { name: '打开原项目（全部任务）', exact: true }).click();
  await verify('empty Case original project entry opens independent global work', async () => {
    assert.equal(await page.evaluate(() => window.openedOriginalProject), 'P'); assert.equal(await page.locator('.project-board').isVisible(), true);
  });
  await page.evaluate(() => window.openCase('A')); await detail.getByRole('heading', { name: 'Case A', exact: true }).waitFor();
  await verify('Case return restores saved column and manual scope', async () => {
    assert.equal(await detail.locator('.case-detail-tabs button').nth(1).getAttribute('aria-current'), 'page');
    assert.equal(await detail.getByLabel('项目页事项范围', { exact: true }).inputValue(), '');
  });
  detailStatus = 503; await refreshDetail();
  await verify('503 labels retained detail as an old snapshot', async () => { await detail.getByText(/当前显示旧快照/).waitFor(); assert.match(await detail.innerText(), /旧快照/); });
  detailStatus = 403; await detail.getByRole('button', { name: '重新读取', exact: true }).click();
  await verify('403 removes old detail, source and action entry points', async () => {
    await detail.getByText(/当前身份无权读取/).waitFor();
    assert.equal(await detail.getByRole('button', { name: '编辑 Case', exact: true }).count(), 0); assert.equal(await summary().count(), 0);
    assert.doesNotMatch(await detail.innerText(), /本轮判断|整 Case 判断/);
  });
  await returnCaseOverview(); await page.getByRole('button', { name: '全部项目栏目', exact: true }).click();
  const projectBoard = page.locator('.project-board');
  await projectBoard.getByRole('searchbox', { name: '搜索项目', exact: true }).fill('原共享');
  await projectBoard.getByRole('group', { name: '项目筛选' }).getByRole('button', { name: /^共享/ }).click();
  await projectBoard.getByRole('button', { name: '原共享项目', exact: true }).click();
  const projectDetail = projectBoard.locator('.daily-project-detail');
  await verify('global original project retains every foreign and independent task', async () => {
    assert.equal(await projectBoard.getByRole('dialog').count(), 0);
    for (const name of ['别案事项任务', '原独立旧任务', '未绑定Case的分类任务']) assert.equal(await projectDetail.getByRole('button', { name, exact: true }).count(), 1, name);
  });
  await projectDetail.getByRole('button', { name: /^反馈 Teach / }).click();
  await projectDetail.locator('.daily-project-detail-cases').getByRole('button', { name: /^Case A/ }).click();
  await page.getByRole('button', { name: '全部项目栏目', exact: true }).click();
  await verify('global project return restores selection, filters and task type', async () => {
    assert.equal(await projectDetail.count(), 1);
    assert.equal(await projectDetail.getByRole('button', { name: /^反馈 Teach / }).getAttribute('aria-pressed'), 'true');
    await projectDetail.getByRole('button', { name: /^返回全部项目/ }).click();
    assert.equal(await projectBoard.getByRole('searchbox', { name: '搜索项目', exact: true }).inputValue(), '原共享');
    assert.equal(await projectBoard.getByRole('group', { name: '项目筛选' }).getByRole('button', { name: /^共享/ }).getAttribute('aria-pressed'), 'true');
  });
  detailStatus = 200; await page.evaluate(() => window.openCase('A')); await detail.getByRole('heading', { name: 'Case A', exact: true }).waitFor(); await tab(0);
  await verify('switching issues uses different exact summaries', async () => {
    await selectIssue('b'); await summary().getByText('复盘判断：本轮判断 b', { exact: true }).waitFor();
    assert.match(await summary().innerText(), /本轮判断 b/); assert.doesNotMatch(await summary().innerText(), /本轮判断 a/);
    await page.waitForFunction(() => document.querySelector('.case-agent-entry .role-composer textarea')?.value === '事项 b 独立草稿');
    assert.equal(await detail.locator('.case-agent-entry .role-composer textarea').inputValue(), '事项 b 独立草稿');
  });
  timelineStatus = 503; await refreshDetail();
  await verify('503 on original timeline marks the retained issue snapshot', async () => {
    await detail.getByText(/本轮原记录暂不可用/).waitFor(); assert.match(await detail.innerText(), /旧快照/); assert.match(await summary().innerText(), /本轮判断 b/);
  });
  timelineStatus = 403; await refreshDetail();
  await verify('403 on original timeline removes old issue content and source entries', async () => {
    await detail.getByText(/当前身份无权读取本事项/).waitFor(); assert.equal(await summary().count(), 0);
    assert.equal(await detail.locator('.case-issue-work').count(), 0); assert.equal(await detail.getByRole('button', { name: '编辑 Case', exact: true }).count(), 0);
  });
  timelineStatus = 200; await detail.getByRole('button', { name: '重新读取', exact: true }).click(); await detail.getByRole('heading', { name: 'Case A', exact: true }).waitFor(); await tab(0);
  await summary().getByText('复盘判断：本轮判断 a', { exact: true }).waitFor();
  for (const width of [1440, 1024, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    await verify(`current work readable at ${width}px`, async () => {
      const size = await detail.evaluate(el => ({ width: el.getBoundingClientRect().width, scroll: el.scrollWidth, client: el.clientWidth })); assert.ok(size.width <= width); assert.ok(size.scroll <= size.client + 2);
      if (width === 390) { const mobile = detail.getByLabel('当前事项', { exact: true }); assert.equal(await mobile.isVisible(), true); await selectIssue('b'); await summary().getByText('复盘判断：本轮判断 b', { exact: true }).waitFor(); }
    });
    await page.screenshot({ path: path.join(root, `current-${width}.png`) });
  }
  await returnCaseOverview();
  await page.locator('.case-decision-board').getByRole('button', { name: '＋ 新建 Case', exact: true }).click();
  await verify('Case overview new entry uses shared preparation', async () => assert.deepEqual(await page.evaluate(() => window.prepared), {}));
  await page.evaluate(() => window.prepareWithGoal());
  await verify('goal and creation source survive shared preparation handoff', async () => {
    await page.waitForFunction(() => window.prepared?.goal?.goalId === 'exact-goal');
    assert.deepEqual(await page.evaluate(() => window.prepared), { goal: { goalId: 'exact-goal', version: 7, strategy: '准确策略', title: '准备标题' }, source: { kind: 'case', caseId: 'A', caseRevision: 1 } });
  });
  await verify('navigation and protected drafts never send to Agent', async () => { assert.deepEqual(modelWrites, []); assert.equal(drafts.get('issue:A:a')?.payload.text, '保存503时必须保留的原输入'); assert.equal(drafts.get('issue:A:b')?.payload.text, '事项 b 独立草稿'); });
  await page.screenshot({ path: path.join(root, 'final.png') });
  await writeFile(path.join(root, 'receipt.json'), JSON.stringify({ boundary: 'Bounded synthetic HTTP; real components and production CSS, not real Host product-UI acceptance', checks, errors, sourceReads, modelWrites }, null, 2));
  console.log(JSON.stringify({ root, checks, errors }, null, 2));
  assert.equal(checks.filter(c => !c.ok).length, 0, 'navigation regressions'); assert.deepEqual(errors, []);
} catch (error) { await writeFile(path.join(root, 'receipt.json'), JSON.stringify({ checks, errors, failure: error.message }, null, 2)); console.log(JSON.stringify({root,checks,errors,failure:error.message},null,2)); await page.screenshot({path:path.join(root,'failure.png')}); throw error; } finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
