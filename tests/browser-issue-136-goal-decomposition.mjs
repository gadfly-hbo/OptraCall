// After npm run build, run with Node 25+, Playwright and Chromium installed.
// Set OPTRACALL_CHROMIUM to use a system Chromium executable.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';
import { createInterface } from 'node:readline';
import { createHost } from '../src/host/server.ts';
import { runtimeEnvironment } from '../scripts/runtime-process.ts';
import { makeNormalDraftPayload } from './fixtures/goal-decomposition-draft.ts';

const root = await mkdtemp(path.join(os.tmpdir(), 'goal-browser-'));
let child, browser, base, faultHost, page;
async function startHost(port = 0) {
  child = spawn(process.execPath, ['scripts/host-entry.mjs', '--port=' + port,
    '--ui-root=' + path.resolve('dist'), '--data-root=' + path.join(root, 'data'),
    '--projects-root=' + path.join(root, 'projects')], {env: runtimeEnvironment(), stdio: ['ignore', 'pipe', 'inherit']});
  for await (const line of createInterface({input: child.stdout})) {
    const info = JSON.parse(line);
    if (info.kind === 'host-ready') {
      base = 'http://127.0.0.1:' + info.port;
      return;
    }
  }
  throw Error('Host stopped before becoming ready');
}
async function stopHost() {
  if (child && child.exitCode === null) {
    const exited = once(child, 'exit');
    child.kill();
    await exited;
  }
}
async function api(route, method = 'GET', data) {
  const res = await fetch(base + route, {method, headers: {'content-type':'application/json', 'x-optracall-client':'1', origin:base},
    ...(data ? {body:JSON.stringify(data)} : {})});
  const result = await res.json();
  assert.ok(res.ok, method + ' ' + route + ' ' + JSON.stringify(result));
  return result;
}

async function seed(title, conflict = false) {
  const {goal} = await api('/api/strategy/goals', 'POST', {operationId:randomUUID(), title, outcome:title,
    perspective:'profit', scope:{kind:'department', id:'retail-dept', name:'零售事业部'},
    measurement:{kind:'deliverable',criterion:'1 月净销售额'}, baseline:{state:'known',description:'108 万'},
    responsible:'零售负责人', dueAt:'2027-01-31', strategies:['零售增长'], formalOrigin:{kind:'manual-exception',
      reason:'尚无适用战略地图',period:'2027-01',targetValue:120,unit:'万元',metricKind:'amount'}});
  const route = '/api/strategy/goals/' + goal.goalId;
  const {gsaPlan} = await api(route + '/gsa-plan/confirm','POST',{operationId:randomUUID(), expectedGoalVersion:1,
    expectedAdoptedVersion:null, expectedPlanVersion:0, plannedActions:[{id:'A1',summary:'核对月度净销售额',checkpoint:'月底门店盘点',observationBasis:'已结账 POS 销售日报'}], decision:title});
  const draft = makeNormalDraftPayload(gsaPlan);
  if (conflict) {
    draft.views[1].cells[0].value = 45;
    draft.views[1].cells[1].value = 35;
  }
  const {validation} = await api(route + '/decomposition/draft','POST',draft);
  assert.equal(validation.ok, !conflict, JSON.stringify(validation.issues));
  return {title,route,id:goal.goalId};
}

try {
  await startHost();
  const normal = await seed('北区正常发布');
  const conflict = await seed('西区交叉冲突', true);
  const lost = await seed('南区发布失答');
  browser = await chromium.launch({headless:true, ...(process.env.OPTRACALL_CHROMIUM ? {executablePath:process.env.OPTRACALL_CHROMIUM} : {})});
  page = await browser.newPage({viewport:{width:1440,height:900}});
  page.setDefaultTimeout(12000);
  const errors = [], writes = [], reads = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('request', r => {
    if (r.method() === 'GET' && r.url().includes('/decomposition/operations/')) reads.push(new URL(r.url()).pathname);
    if (r.method() !== 'GET' && r.url().includes('/decomposition/')) writes.push(new URL(r.url()).pathname);
  });
  const btn = (name, scope = page) => scope.getByRole('button',{name,exact:true});
  const openGoals = async () => {
    await page.goto(base);
    await btn('目标管理',page.getByRole('navigation',{name:'主导航',exact:true})).click();
  };
  const choose = async target => {
    await btn('切换目标').click();
    await page.getByRole('dialog',{name:'切换目标'}).getByRole('listitem').filter({hasText:target.title}).click();
    await page.getByRole('heading',{name:target.title,exact:true}).waitFor();
    await page.getByRole('navigation',{name:'目标管理三阶段流程'}).getByRole('button').first().click();
  };
  const ws = target => api(target.route + '/workspace?goalVersion=1');
  const preview = async () => {
    await btn('核对并发布').click();
    const dialog = page.getByRole('dialog',{name:'核对并发布目标拆解表 v1'});
    await dialog.waitFor();
    return dialog;
  };
  const published = async (target, count = 1) => {
    const state = await ws(target);
    assert.equal(state.publications.length,count);
    assert.equal(state.activePublication?.version, count);
    return state.activePublication;
  };
  await openGoals();
  await choose(normal);
  const estimateField = page.getByRole('spinbutton',{name:'同口径可达测算值'});
  const beforeEdit = await ws(normal);
  await estimateField.fill('111');
  assert.ok(await btn('核对并发布').isDisabled());
  await page.getByRole('heading',{name:/实时拆解表.*rev 2/}).waitFor();
  assert.equal((await ws(normal)).draft.estimate.estimatedValue,111);
  assert.equal(writes.filter(p => p === normal.route + '/decomposition/draft').length,1);
  await estimateField.fill('112');
  await page.getByRole('heading',{name:/实时拆解表.*rev 3/}).waitFor();
  const writesBeforePreview = writes.filter(route=>!route.endsWith('/publish-preview')).length;
  const original = await ws(normal);
  await btn('返回修改草稿',await preview()).click();
  assert.equal((await ws(normal)).draft.contentSha256,original.draft.contentSha256);
  assert.equal((await ws(normal)).draft.revision,original.draft.revision);
  assert.equal((await ws(normal)).publications.length,0);
  assert.equal(writes.filter(route=>!route.endsWith('/publish-preview')).length,writesBeforePreview,'readonly preview and cancel must never save');
  await btn('确认发布 v1',await preview()).click();
  await page.getByText('拆解正式版 v1 生效中',{exact:true}).waitFor();
  const normalPublication = await published(normal);
  assert.equal(normalPublication.committedGoals.length,4);
  console.log('PASS normal publication / read-only preview and cancel');

  await choose(conflict);
  const region = page.getByRole('region',{name:'交叉视角冲突对齐区'});
  await region.waitFor();
  assert.ok(await btn('核对并发布').isDisabled());
  assert.equal((await ws(conflict)).publications.length,0);
  await region.getByLabel('对齐值 offline:down-jacket',{exact:true}).fill('45');
  await region.getByLabel('对齐值 online:down-jacket',{exact:true}).fill('35');
  await region.getByLabel('对齐依据说明').fill('门店和商品负责人核准 45、35');
  await btn('人工确认对齐并重汇总',region).click();
  await region.waitFor({state:'hidden'});
  await btn('确认发布 v1',await preview()).click();
  await page.getByText('拆解正式版 v1 生效中',{exact:true}).waitFor();
  await published(conflict);
  console.log('PASS conflicting cells require alignment before publication');

  await choose(lost);
  const pubRoute = lost.route + '/decomposition/publish';
  await page.route('**' + pubRoute, async route => {
    const response = await route.fetch();
    assert.equal(response.status(),201);
    await route.abort('failed');
  }, {times:1});
  const lookup = lost.route + '/decomposition/operations/';
  await page.route('**' + lookup + '*', route => route.fulfill({status:503,json:{code:'temporarily_unavailable'}}), {times:1});
  await btn('确认发布 v1',await preview()).click();
  await page.getByText(/只读核对暂时失败/).waitFor();
  assert.equal(reads.filter(p => p.startsWith(lookup)).length,1);
  const first = await published(lost);
  const current = await ws(lost);
  const revised = makeNormalDraftPayload(current.activeGsaPlan, {expectedDraftRevision:current.draft.revision});
  revised.rows[0].targetValue = revised.rows[0].checkpoints[0].targetValue = 45;
  revised.rows[1].targetValue = revised.rows[1].checkpoints[0].targetValue = 35;
  for (const view of revised.views) {
    view.cells[0].value = 45;
    view.cells[1].value = 35;
  }
  const {draft:laterDraft,validation} = await api(lost.route+'/decomposition/draft','POST',revised);
  assert.ok(validation.ok,JSON.stringify(validation.issues));
  const laterBasis = {gsaPlanId:revised.gsaPlanId,gsaPlanVersion:revised.gsaPlanVersion,gsaPlanSha256:revised.gsaPlanSha256,
    draftRevision:laterDraft.revision,draftSha256:laterDraft.contentSha256,expectedActiveVersion:1};
  const laterPreview = await api(lost.route+'/decomposition/publish-preview','POST',laterBasis);
  const {publication:later} = await api(pubRoute,'POST',{...laterBasis,operationId:randomUUID(),previewSha256:laterPreview.previewSha256,reason:'其他终端发布第二版'});
  assert.equal(later.version,2);
  const samePort = Number(new URL(base).port);
  await stopHost();
  await startHost(samePort);
  await openGoals();
  await choose(lost);
  const recovered = page.getByRole('region',{name:'原发布操作的冻结回执'});
  await recovered.getByRole('heading',{name:'原操作已发布拆解正式版 v1'}).waitFor();
  await recovered.getByRole('row').filter({hasText:'G-01'}).getByText('50万元',{exact:true}).waitFor();
  await page.getByText('拆解正式版 v2 生效中',{exact:true}).waitFor();
  const exportResponse = page.waitForResponse(r=>new URL(r.url()).pathname === lost.route+'/decomposition/publications/1/export');
  await btn('导出此版',recovered).click();
  assert.equal((await exportResponse).status(),200);
  await btn('核对原发布结果').waitFor({state:'hidden'});
  assert.equal(reads.filter(p => p.startsWith(lookup)).length,2,'a single recovery GET per entry');
  assert.equal((await published(lost,2)).snapshot.rows[0].targetValue,45);
  assert.equal((await api(lost.route+'/decomposition/publications/1')).publication.snapshotSha256,first.snapshotSha256);
  assert.equal(writes.filter(p => p === pubRoute).length,1);
  console.log('PASS committed v1 receipt and export with v2 now active / browser reload and Host restart / one original write');

  await choose(normal);
  const delayed = Promise.withResolvers();
  const release = Promise.withResolvers();
  const delivered = Promise.withResolvers();
  const versionDialog = page.getByRole('dialog',{name:'版本与来源'});
  await page.route('**' + normal.route + '/workspace?goalVersion=1', async route => {
    const response = await route.fetch();
    delayed.resolve();
    await release.promise;
    await route.fulfill({response});
    delivered.resolve();
  }, {times:1});
  await btn('版本与来源').click();
  await delayed.promise;
  await versionDialog.getByText('拆解正式版 v1',{exact:true}).waitFor();
  await page.keyboard.press('Escape');
  await choose(conflict);
  await btn('版本与来源').click();
  await versionDialog.getByText(new RegExp('说明：'+conflict.title)).waitFor();
  release.resolve();
  await delivered.promise;
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  assert.equal(await versionDialog.getByText(new RegExp('说明：'+conflict.title)).count(),1,
    'late auxiliary workspace from the previous goal replaced the selected goal');
  await page.keyboard.press('Escape');
  console.log('PASS delayed previous-goal response cannot replace the visible version and source');

  await choose(normal);
  const followup = () => page.getByRole('navigation',{name:'目标管理三阶段流程'}).getByRole('button',{name:/阶段跟进/}).click();
  await followup();
  const actual = page.getByLabel('实绩报表原文', {exact:true});
  const reportText = '门店周报 r2\n实绩 88 万元，部分门店尚未结账。';
  await actual.fill(reportText);
  await choose(conflict);
  await followup();
  assert.equal(await actual.inputValue(),'','unfinished actual from a different goal entered the selected goal');
  await choose(normal);
  await followup();
  assert.equal(await actual.inputValue(),reportText,'returning to the same checkpoint restores unsent input');
  const uploaded = reportText + '\n原始数据引用 POS/888';
  await page.getByLabel('读取文本报表').setInputFiles({name:'门店周报-r2.txt',mimeType:'text/plain',buffer:Buffer.from(uploaded)});
  await page.waitForFunction(text => document.querySelector('textarea[aria-label="实绩报表原文"]')?.value === text, uploaded);
  await page.getByLabel('实绩数据截至时间').fill('2027-01-17T23:59:59Z');
  const actualResponse = page.waitForResponse(r => new URL(r.url()).pathname === normal.route + '/decomposition/actuals');
  await btn('提交本次实绩，交 Agent 核对').click();
  assert.ok((await actualResponse).ok());
  const analysisDialog = page.getByRole('dialog',{name:'Agent 核对实绩',exact:true});
  await analysisDialog.waitFor();
  const savedActuals = (await ws(normal)).submittedActuals;
  assert.equal(savedActuals.length,1);
  const source = savedActuals[0].input.actualSource;
  assert.equal(source.reportText,uploaded);
  assert.equal(source.ref,'门店周报-r2.txt');
  assert.equal(source.basis,undefined);
  assert.equal(savedActuals[0].input.actualPeriods[0].actualValue,null);
  await page.keyboard.press('Escape');
  await btn('用这份核对').click();
  await analysisDialog.waitFor();
  assert.equal((await ws(normal)).submittedActuals.length,1);
  await page.keyboard.press('Escape');
  console.log('PASS original report bytes, zero manual figures or caliber fields, reuse of submitted evidence');
  const v1 = (await ws(normal)).goal.versions.find(v => v.version === 1);
  const revisedTitle = '北区修订至 130 万';
  await api(normal.route + '/revisions','POST',{...v1, operationId:randomUUID(), expectedVersion:1,
    title:revisedTitle, formalOrigin:{...v1.formalOrigin,targetValue:130}});
  await openGoals();
  await choose(normal);
  await btn('版本与来源').click();
  await btn('查看此版',versionDialog.getByRole('listitem').filter({hasText:revisedTitle})).click();
  await page.getByRole('heading',{name:revisedTitle,exact:true}).waitFor();
  await page.getByLabel('计划 A 1 内容').fill('按修订基线检查本期门店');
  await btn('添加阶段检查点').click();
  await page.getByLabel('阶段检查点 1 名称').fill('月度门店盘点');
  await page.getByLabel('阶段检查点 1 观察依据').fill('已结账净销售日报');
  await page.getByLabel('GSA 修订原因').fill('多月目标未达，负责人核准本周期修订');
  const confirmResponse = page.waitForResponse(r => new URL(r.url()).pathname === normal.route + '/gsa-plan/confirm');
  await btn('确认更新 GSA 计划 v2').click();
  const confirmed = await confirmResponse;
  assert.ok(confirmed.ok(), 'selected v2 GSA failed: ' + await confirmed.text());
  const revisedWorkspace = await api(normal.route + '/workspace?goalVersion=2');
  assert.equal(revisedWorkspace.activeGsaPlan.goal.version,2);
  assert.equal(revisedWorkspace.activeGsaPlan.formalTarget.value,130);
  assert.equal(revisedWorkspace.activeGsaPlan.stageCheckpoints[0].observationBasis,'已结账净销售日报');
  await btn('版本与来源').click();
  await btn('查看此版',versionDialog.getByRole('listitem').filter({hasText:normal.title + ' · v1'})).click();
  await page.getByText('历史只读版本 v1',{exact:true}).waitFor();
  await page.getByRole('navigation',{name:'目标管理三阶段流程'}).getByRole('button').first().click();
  const officialCell = page.locator('.gm-metric-card').filter({hasText:'正式目标值（固定权威）'});
  await officialCell.getByText('120万元',{exact:true}).waitFor();
  assert.ok(await btn('保存草稿').isDisabled());
  await followup();
  assert.ok(await btn('保存阈值').isDisabled(),'historical version can only read thresholds');
  assert.ok(await btn('提交本次实绩，交 Agent 核对').isDisabled());
  const thresholdPath = normal.route + '/decomposition/threshold';
  const stale = await fetch(base + thresholdPath, {method:'POST',
    headers:{'content-type':'application/json','x-optracall-client':'1',origin:base},
    body:JSON.stringify({expectedGoalVersion:1,configured:true,magnitudePct:19})});
  assert.equal(stale.status,409,'a stale v1 form must not update the v2 threshold');
  assert.deepEqual((await api(normal.route+'/workspace?goalVersion=2')).threshold,revisedWorkspace.threshold);
  await page.getByRole('navigation',{name:'目标管理三阶段流程'}).getByRole('button',{name:/到期复盘/}).click();
  assert.ok(await btn('保存到期复盘记录').isDisabled());
  console.log('PASS exact v2 GSA confirmation and v1 historical read-only target');
  assert.deepEqual(errors,[]);
  console.log('PASS cross-goal unsaved actual isolation, no page errors');

  // Exercise proof-before-retry against a separate real Host with the same pre-commit fault seam as GM08.
  let faultGoal;
  faultHost = createHost({cwd:process.cwd(),uiPorts:[4173],transportVersion:'test',staticUiRoot:path.resolve('dist'),
    dataRoot:path.join(root,'fault-data'),projectsRoot:path.join(root,'fault-projects'),
    goalDecompositionPreCommitFault(id) { if (id === faultGoal) throw Error('simulated_pre_commit_io_fault'); }});
  await faultHost.ready;
  await new Promise(resolve => faultHost.server.listen(0,'127.0.0.1',resolve));
  base = 'http://127.0.0.1:' + faultHost.server.address().port;
  const retry = await seed('北区提交前中断');
  const unknown = await seed('南区提交前未送达');
  faultGoal = retry.id;
  await openGoals();
  await choose(unknown);
  const unknownPub = unknown.route + '/decomposition/publish';
  const unknownLookup = unknown.route + '/decomposition/operations/';
  await page.route('**'+unknownPub,route => route.abort('failed'),{times:1});
  await page.route('**'+unknownLookup+'*',route => route.fulfill({status:404,json:{code:'not_found'}}),{times:1});
  await btn('确认发布 v1',await preview()).click();
  await page.getByText(/只读核对暂时失败/).waitFor();
  assert.ok(await btn('保存草稿').isDisabled());
  assert.equal(await btn('重试原发布意图').count(),0);
  assert.equal(reads.filter(p => p.startsWith(unknownLookup)).length,1);
  await btn('核对原发布结果').click();
  await page.getByText(/尚未在 Host 查到该发布意图/).waitFor();
  assert.equal((await ws(unknown)).publications.length,0);
  assert.equal(reads.filter(p => p.startsWith(unknownLookup)).length,2);
  assert.equal(writes.filter(p => p === unknownPub).length,1);
  await choose(retry);
  const retryPub = retry.route + '/decomposition/publish';
  const retryLookup = retry.route + '/decomposition/operations/';
  await btn('确认发布 v1',await preview()).click();
  await btn('重试原发布意图').waitFor();
  assert.equal((await ws(retry)).publications.length,0);
  await choose(unknown);
  await page.getByText(/尚未在 Host 查到该发布意图/).waitFor();
  assert.equal(await btn('重试原发布意图').count(),0);
  await choose(retry);
  await btn('重试原发布意图').waitFor();
  // Confirm the second automatic GET completed. No polling or publication occurs while awaiting the owner.
  await page.waitForFunction(() => [...document.querySelectorAll('button')].some(b => b.textContent.includes('重试原发布意图') && !b.disabled));
  assert.equal(reads.filter(p => p.startsWith(retryLookup)).length,2);
  assert.equal(writes.filter(p => p === retryPub).length,1);
  assert.equal((await ws(retry)).publications.length,0);
  assert.deepEqual(errors,[]);
  console.log('PASS unknown / HTTP 404 stays locked and retryable proof only enables explicit retry');
} catch(error) {
  if(page){await page.screenshot({path:'.local/issue138/legacy-failure.png',fullPage:true});await writeFile('.local/issue138/legacy-failure.txt',await page.locator('body').innerText());}
  throw error;
} finally {
  await browser?.close();
  await faultHost?.close();
  await stopHost();
  await rm(root,{recursive:true,force:true});
}
