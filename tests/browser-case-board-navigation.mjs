// Environment-only browser rerun, outside npm test/CI: uses this workspace's installed Playwright.
// Actual React/Chromium regression with bounded synthetic HTTP responses; no Provider or business data.
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
await build({ stdin: { contents: `import './src/host/ui/styles.css'; import React,{useState} from 'react'; import {createRoot} from 'react-dom/client'; import {CaseBoard} from './src/host/ui/CaseBoard.tsx'; import {ProjectBoard} from './src/host/ui/ProjectBoard.tsx';
const projects=${JSON.stringify(projects)}; const noop=()=>{}; const refresh=async()=>{};
function Harness(){const [view,setView]=useState('case'),[target,setTarget]=useState({id:'A',seq:1}),[entry,setEntry]=useState(null); window.prepareWithGoal=()=>{setEntry({goal:{goalId:'exact-goal',version:7,strategy:'准确策略',title:'准备标题'},source:{kind:'case',caseId:'A',caseRevision:1}});setView('case')};window.openCase=id=>{setTarget(p=>({id,seq:p.seq+1}));setView('case')};return <><button onClick={()=>setView('case')}>返回 Case 栏目</button><button onClick={()=>setView('project')}>全部项目栏目</button><div hidden={view!=='case'}><CaseBoard visible={view==='case'} initialGoal={entry?.goal} initialSource={entry?.source} onInitialGoalConsumed={()=>setEntry(null)} initialCaseId={target.id} initialCaseSeq={target.seq} projects={projects} configurations={[]} decisionUi={{}} onDecisionUiChange={noop} onOpenTask={noop} onCreateTask={noop} onProjectChange={refresh} onOpenProject={project=>{window.openedOriginalProject=project.id;setView('project')}} onPrepareCase={input=>{window.prepared=input??{};setView('prepare')}} /></div><div hidden={view!=='project'}><ProjectBoard visible={view==='project'} projects={projects} onOpenTask={noop} onCreateProject={noop} onCreateTask={noop} onRename={noop} onArchive={noop} onRestore={noop} onProjectChange={refresh} onOpenCase={window.openCase}/></div></>};createRoot(document.getElementById('root')).render(<Harness/>);`, resolveDir: process.cwd(), loader: 'tsx' }, bundle: true, format: 'esm', outdir: root, entryNames: 'harness', logLevel: 'silent' });
const server = createServer(async (req, res) => { try { const file = req.url === '/harness.js' ? 'harness.js' : req.url === '/harness.css' ? 'harness.css' : null; res.setHeader('Content-Type', file?.endsWith('.js') ? 'text/javascript' : file ? 'text/css' : 'text/html'); res.end(file ? await readFile(path.join(root, file)) : '<html><head><link rel="stylesheet" href="/harness.css"></head><body class="app"><div id="root"></div><script type="module" src="/harness.js"></script></body></html>'); } catch { res.statusCode = 404; res.end(); } });
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH ?? '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
page.setDefaultTimeout(6000);
let detailStatus = 200, timelineStatus = 200;
const errors = [], checks = [];
page.on('pageerror', error => errors.push(error.message));
await page.route('**/api/**', async route => {
  const pathname = new URL(route.request().url()).pathname;
  let status = 200, value = { items: [], choices: [], requests: [], drafts: [], edges: [], enterprises: [], events: [], history: [], goalBinding: null, references: [], available: [], unavailable: [], limitations: [], replies: [], continuation: null };
  if (pathname === '/api/cases/storage') value = { state: 'ready', storeId: 'store' };
  else if (pathname === '/api/cases') value = { cases, projectLinks };
  else if (pathname === '/api/case-relations') value = { items: [], writingEnabled: true, hasMore: false, continuation: null };
  else if (/\/api\/cases\/[AB]$/.test(pathname)) { const id = pathname.split('/').at(-1); status = detailStatus; value = status === 200 ? { case: cases.find(c => c.id === id), projectLinks: projectLinks.filter(l => l.caseId === id), artifacts: [], events: [], projectEvents: [], pendingOperations: [] } : { code: 'case_request_failed' }; }
  else if (/\/decisions\/issues$/.test(pathname)) value = { issues: pathname.includes('/A/') ? issues : [] };
  else if (/\/decisions\/issues\/[ab]$/.test(pathname)) { status = timelineStatus; value = status === 200 ? timeline(pathname.split('/').at(-1)) : {code:'case_request_failed'}; }
  else if (/\/workspace\/drafts\/[^/]+\/[^/]+$/.test(pathname)) { status = 404; value = { code: 'draft_not_found' }; }
  await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(value) });
});
const verify = async (name, fn) => { try { await fn(); checks.push({ name, ok: true }); } catch (e) { checks.push({ name, ok: false, error: e.message }); } };
const drawer = page.locator('.case-detail-dialog');
const tab = key => drawer.locator('.case-detail-tabs button').nth(key).click();
try {
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await drawer.getByLabel('当前事项', { exact: true }).waitFor();
  await drawer.getByLabel('当前事项', { exact: true }).selectOption('a');
  await verify('summary uses exact current issue review and original identity', async () => { await drawer.locator('.case-round-summary').getByText('复盘判断：本轮判断 a',{exact:true}).waitFor(); const text = await drawer.locator('.case-round-summary').innerText(); assert.match(text, /本轮判断 a/); assert.match(text, /本轮下一步 a/); assert.match(text, /choice-a/); assert.doesNotMatch(text, /整 Case/); });
  await verify('four current workspace tabs retain the pinned G/S region', async () => { assert.deepEqual(await drawer.locator('.case-detail-tabs button').allTextContents(), ['当前工作','项目与任务','成果与依据','历史']); for (let i=0;i<4;i++){await tab(i);assert.equal(await drawer.getByRole('region',{name:'常驻目标与具体策略'}).count(),1);} });
  await tab(1); await drawer.getByRole('button', { name: '全部当前 Case', exact: true }).click();
  await verify('all current Case excludes foreign and unbound project tasks with exact row origins',async()=>{assert.equal(await drawer.getByText('任务 a',{exact:true}).count(),1);assert.equal(await drawer.getByText('任务 b',{exact:true}).count(),1);for(const name of ['别案事项任务','原独立旧任务','未绑定Case的分类任务'])assert.equal(await drawer.getByText(name,{exact:true}).count(),0,name);assert.match((await drawer.locator('.case-task-list').allTextContents()).join(' '),/Case A（A）.*事项 a（a）/);assert.match((await drawer.locator('.case-task-list').allTextContents()).join(' '),/Case A（A）.*事项 b（b）/);});
  await verify('zero-task and independent project work stay explicitly reachable',async()=>{assert.equal(await drawer.getByRole('heading',{name:'原零任务项目',exact:true}).count(),1);assert.equal(await drawer.getByRole('button',{name:'打开原项目（全部任务）',exact:true}).count(),2);});
  await page.setViewportSize({width:390,height:1000});await verify('scoped task sources and original project entry fit 390px',async()=>{const size=await drawer.evaluate(el=>({scroll:el.scrollWidth,client:el.clientWidth}));assert.ok(size.scroll<=size.client+2);assert.equal(await drawer.getByRole('button',{name:'打开原项目（全部任务）',exact:true}).count(),2);});await page.screenshot({path:path.join(root,'scope-all-390.png')});await page.setViewportSize({width:1440,height:1000});
  await tab(0); await drawer.getByLabel('当前事项', { exact: true }).selectOption('b'); await tab(1);
  await verify('explicitly choosing a different issue resets both auxiliary views', async () => { assert.equal(await drawer.getByRole('button', { name: '当前事项', exact: true }).getAttribute('aria-pressed'), 'true'); assert.equal(await drawer.getByText('任务 a', { exact: true }).count(), 0); await tab(2); assert.equal(await drawer.getByRole('button',{name:'当前事项',exact:true}).getAttribute('aria-pressed'),'true'); await tab(1); });
  await drawer.getByRole('button', { name: '全部当前 Case', exact: true }).click(); await tab(3); await tab(1);
  await verify('ordinary tab redraw preserves manual range', async () => assert.equal(await drawer.getByRole('button', { name: '全部当前 Case', exact: true }).getAttribute('aria-pressed'), 'true'));
  await page.evaluate(() => window.openCase('B')); await drawer.getByRole('heading', { name: 'Case B', exact: true }).waitFor(); await tab(1);
  await verify('empty Case stays all with no inherited tasks and an original project entry', async () => { assert.equal(await drawer.getByRole('button', { name: '当前事项', exact: true }).isDisabled(), true); assert.equal(await drawer.getByRole('button', { name: '全部当前 Case', exact: true }).getAttribute('aria-pressed'), 'true'); assert.equal(await drawer.getByText('任务 a', { exact: true }).count(), 0); assert.equal(await drawer.getByRole('button',{name:'打开原项目（全部任务）',exact:true}).count(),2); assert.match(await drawer.innerText(),/尚无明确归属本 Case 的任务/); });
  await drawer.locator('.case-linked-project').filter({has:page.getByRole('heading',{name:'原共享项目',exact:true})}).getByRole('button',{name:'打开原项目（全部任务）',exact:true}).click();
  await verify('empty Case original project entry opens independent global work',async()=>{assert.equal(await page.evaluate(()=>window.openedOriginalProject),'P');assert.equal(await page.locator('.project-board').isVisible(),true);});
  await page.evaluate(() => window.openCase('A')); await drawer.getByRole('heading', { name: 'Case A', exact: true }).waitFor();
  await verify('Case return restores saved column and manual scope', async () => { assert.equal(await drawer.locator('.case-detail-tabs button').nth(1).getAttribute('aria-current'), 'page'); assert.equal(await drawer.getByRole('button', { name: '全部当前 Case', exact: true }).getAttribute('aria-pressed'), 'true'); });
  detailStatus = 503; await drawer.getByRole('button', { name: '刷新详情', exact: true }).click();
  await verify('503 labels retained detail as an old snapshot', async () => { await page.waitForTimeout(100); assert.match(await drawer.innerText(), /旧快照/); });
  detailStatus = 403; await drawer.getByRole('button', { name: '重新读取', exact: true }).click();
  await verify('403 removes old detail, source and action entry points', async () => { await page.waitForTimeout(100); assert.equal(await drawer.getByRole('button', { name: '编辑 Case', exact: true }).count(), 0); assert.equal(await drawer.locator('.case-round-summary').count(), 0); assert.doesNotMatch(await drawer.innerText(), /本轮判断|整 Case 判断/); });
  await drawer.getByRole('button', { name: /^关闭/ }).click(); await page.getByRole('button', { name: '全部项目栏目', exact: true }).click();
  const projectBoard = page.locator('.project-board'); await projectBoard.getByRole('searchbox', { name: '搜索项目' }).fill('原共享'); await projectBoard.getByLabel('归档状态', { exact: true }).selectOption('all'); await projectBoard.getByRole('button', { name: '原共享项目', exact: true }).click();
  const projectDialog = page.locator('.case-project-detail-dialog'); await verify('global original project retains every foreign and independent task',async()=>{for(const name of ['别案事项任务','原独立旧任务','未绑定Case的分类任务'])assert.equal(await projectDialog.getByText(name,{exact:true}).count(),1,name);}); await projectDialog.getByRole('button', { name: /^反馈 Teach / }).click(); await projectDialog.getByRole('button', { name: '回到原 Case', exact: true }).first().click();
  await page.evaluate(() => document.querySelector('.case-detail-dialog[open]')?.close());
  await page.getByRole('button', { name: '全部项目栏目', exact: true }).click();
  await verify('global project return restores selection, filters and task type', async () => { assert.equal(await projectBoard.getByRole('searchbox', { name: '搜索项目' }).inputValue(), '原共享'); assert.equal(await projectBoard.getByLabel('归档状态', { exact: true }).inputValue(), 'all'); assert.equal(await projectDialog.count(), 1); assert.equal(await projectDialog.getByRole('button', { name: /^反馈 Teach / }).getAttribute('aria-pressed'), 'true'); });
  await projectDialog.getByRole('button', {name:/^关闭/}).click();
  detailStatus=200; await page.evaluate(()=>window.openCase('A')); await drawer.getByRole('button',{name:'刷新详情',exact:true}).waitFor(); await tab(0);
  await verify('switching issues uses different exact summaries',async()=>{await drawer.getByLabel('当前事项',{exact:true}).selectOption('b');await drawer.locator('.case-round-summary').getByText('复盘判断：本轮判断 b',{exact:true}).waitFor();assert.match(await drawer.locator('.case-round-summary').innerText(),/本轮判断 b/);assert.doesNotMatch(await drawer.locator('.case-round-summary').innerText(),/本轮判断 a/);});
  timelineStatus=503;await drawer.getByRole('button',{name:'刷新详情',exact:true}).click();
  await verify('503 on original timeline marks the retained issue snapshot',async()=>{await drawer.locator('.case-round-summary').getByText(/本轮原记录暂不可用/).waitFor();assert.match(await drawer.locator('.case-round-summary').innerText(),/旧快照/);assert.match(await drawer.locator('.case-round-summary').innerText(),/本轮判断 b/);});
  timelineStatus=403;await drawer.getByRole('button',{name:'刷新详情',exact:true}).click();
  await verify('403 on original timeline removes old issue content and source entries',async()=>{await drawer.locator('.case-round-summary').waitFor({state:'detached'});assert.equal(await drawer.locator('.case-round-summary').count(),0);assert.equal(await drawer.locator('.case-issue-work').count(),0);assert.equal(await drawer.getByRole('button',{name:'编辑 Case',exact:true}).count(),0);});
  timelineStatus=200;await drawer.getByRole('button',{name:'重新读取',exact:true}).click();await drawer.getByRole('button',{name:'刷新详情',exact:true}).waitFor();await tab(0);
  await drawer.locator('.case-round-summary').getByText('复盘判断：本轮判断 a',{exact:true}).waitFor();
  for(const width of [1440,1024,390]){await page.setViewportSize({width,height:1000});await verify(`current work readable at ${width}px`,async()=>{const size=await drawer.evaluate(el=>({width:el.getBoundingClientRect().width,scroll:el.scrollWidth,client:el.clientWidth}));assert.ok(size.width<=width);assert.ok(size.scroll<=size.client+2);});await page.screenshot({path:path.join(root,`current-${width}.png`)});}
  await drawer.getByRole('button',{name:/^关闭/}).click();
  await page.locator('.case-decision-board').getByRole('button',{name:'＋ 新建 Case',exact:true}).click();
  await verify('Case overview new entry uses shared preparation',async()=>assert.deepEqual(await page.evaluate(()=>window.prepared),{}));
  await page.evaluate(()=>window.prepareWithGoal());
  await verify('goal and creation source survive shared preparation handoff',async()=>{await page.waitForTimeout(80);assert.deepEqual(await page.evaluate(()=>window.prepared),{goal:{goalId:'exact-goal',version:7,strategy:'准确策略',title:'准备标题'},source:{kind:'case',caseId:'A',caseRevision:1}});});
  await page.screenshot({ path: path.join(root, 'final.png') });
  await writeFile(path.join(root, 'receipt.json'), JSON.stringify({ checks, errors }, null, 2));
  console.log(JSON.stringify({ root, checks, errors }, null, 2));
  assert.equal(checks.filter(c => !c.ok).length, 0, 'navigation regressions'); assert.deepEqual(errors, []);
} catch (error) { await writeFile(path.join(root, 'receipt.json'), JSON.stringify({ checks, errors, failure: error.message }, null, 2)); console.log(JSON.stringify({root,checks,errors,failure:error.message},null,2)); await page.screenshot({path:path.join(root,'failure.png')}); throw error; } finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
