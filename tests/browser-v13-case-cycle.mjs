// Run on the synthetic directory printed by v13-case-cycle.test.ts.
import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import { startTestHost } from './fixtures/host-process.ts';
const root=path.resolve(process.argv[2] ?? ''), uiPort=Number(process.env.OPTRACALL_CASE_TEST_PORT || 4367);
assert.equal(path.dirname(root),path.resolve('.local/product-v13/case'));
assert.match(path.basename(root),/^cycle-[a-zA-Z0-9]+$/);
const host=await startTestHost({uiPort,dataRoot:path.join(root,'host'),projectsRoot:path.join(root,'projects')});
const ui=spawn(process.execPath,['scripts/frontend.mjs','dev','--port',String(uiPort),'--strictPort'], {stdio:['ignore','pipe','pipe'],env:{...process.env,OPTRACALL_HOST_PORT:String(host.port)}});
let browser;
try {
  await new Promise((resolve,reject)=>{ui.stdout.on('data',b=>{if(b.toString().includes(':'+uiPort+'/'))resolve()});ui.on('exit',c=>reject(Error('UI exit '+c)));});
  browser=await chromium.launch({channel:'chrome',headless:true});const page=await browser.newPage({viewport:{width:1500,height:990}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
  const call=async(route,method='GET',input)=>{const r=await host.request(route,method,input);const value=await r.json();assert.ok(r.ok,JSON.stringify(value));return value};
  const title='浏览器创建失答核对 '+Date.now();
  const {goal}=await call('/api/strategy/goals','POST',{operationId:crypto.randomUUID(),title,outcome:'核对北区本期回访',perspective:'personal',scope:{kind:'personal',id:'test-browser',name:'点验'},measurement:{kind:'deliverable',criterion:'有明细可复核'},baseline:{state:'known',description:'已取得本期数据'},responsible:'负责人',strategies:['两店先试']});
  await call('/api/strategy/goals/'+goal.goalId+'/adopt','POST',{operationId:crypto.randomUUID(),version:1,expectedVersion:1,decision:'明确采用'});
  await page.goto('http://127.0.0.1:'+uiPort);const nav=page.getByRole('navigation',{name:'主导航',exact:true});await nav.getByRole('button',{name:'决策星图',exact:true}).click();
  const board=page.locator('.case-board');await board.getByRole('button',{name:'常规',exact:true}).click();
  await board.getByRole('button',{name:'会员回访',exact:true}).click();
  const dialog=page.locator('.case-detail-dialog');const work=dialog.locator('.case-issue-work');
  await work.getByText('复盘判断 · 原判断尚未证实',{exact:true}).first().waitFor();await work.getByText(/两店完成回访/).first().waitFor();
  await work.getByRole('button',{name:'查看准确方案原回复'}).first().click();
  await work.getByText('两店先试，店长回访，周五对照同店复购，若毛利下降则停止。',{exact:true}).waitFor();
  await work.getByRole('button',{name:'查看 Teach 原回复'}).nth(1).click();
  await work.getByText('暂缓后观察到来店人数持平，待扩大样本再核。',{exact:true}).waitFor();
  await page.screenshot({path:path.resolve('.local/product-v13/case/cycle-browser.png')});
  const observed=work.locator('p').filter({hasText:'两店完成回访'}).filter({has:page.getByRole('button',{name:'查看原看板反馈'})}).first();
  await observed.getByRole('button',{name:'按此观察准备 Teach'}).click();
  const taskForm=page.getByRole('dialog',{name:'新建任务'});await taskForm.getByText(/原看板反馈 [a-f0-9-]{36}/).waitFor();
  await taskForm.getByRole('button',{name:'取消',exact:true}).click();
  await observed.getByRole('button',{name:'查看原看板反馈'}).click(); await page.getByRole('heading',{name:'已保存反馈历史'}).waitFor(); await page.getByText('两店完成回访',{exact:true}).waitFor();
  const close=page.getByRole('dialog').getByRole('button',{name:/^关闭/});await close.first().click();
  await nav.getByRole('button',{name:'决策星图',exact:true}).click();
  await board.getByRole('button',{name:'＋ 新建 Case',exact:true}).click();
  const gsa=page.getByRole('navigation',{name:'目标管理工作视图'});await gsa.getByRole('button',{name:'版本与反馈'}).click();
  await page.locator('.sg-goal-choice').filter({hasText:'候选待采纳 · v2'}).first().click();await page.getByLabel(/查看准确版本/).selectOption('1');await page.getByRole('heading',{name:'两店回访',exact:true}).waitFor();
  async function exportOffline(v) {
    const captured=page.waitForEvent('download');
    await page.getByRole('button',{name:'导出此版'}).click();
    const file=path.join(root,'gsa-browser-v'+v+'.html');await (await captured).saveAs(file);
    const offline=await browser.newContext({offline:true});
    try {
      const document=await offline.newPage();await document.goto(pathToFileURL(file).href);
      const table=document.getByRole('table').first();assert.match(await table.innerText(),/核对本次议题的原资料/);
      if(v===1){assert.match(await table.innerText(),/两店回访/);assert.match(await table.innerText(),/原决策事项/);}
      else assert.doesNotMatch(await table.innerText(),/两店回访/);
    } finally {await offline.close();}
  }
  await exportOffline(1);
  await page.getByLabel(/查看准确版本/).selectOption('2');await page.getByText(/此准确目标版本尚无已记录的上层行动安排/).waitFor();await exportOffline(2);
  await page.locator('.sg-goal-choice').filter({hasText:title}).click();await page.getByRole('button',{name:'从此目标创建Case'}).click();
  const form=page.getByRole('dialog').filter({has:page.getByRole('textbox',{name:/Case 名称/})});await form.getByRole('textbox',{name:/Case 名称/}).fill(title);
  await form.getByLabel(/具体策略 S/).first().selectOption('两店先试');
  let posts=0,lookups=0;page.on('request',r=>{if(r.method()==='GET' && new URL(r.url()).pathname.startsWith('/api/cases/operations/'))lookups++});
  await page.route('**/api/cases',async route=>{if(route.request().method()!=='POST')return route.continue();posts++;if(posts===1){const r=await route.fetch();assert.equal(r.status(),201);await route.abort('failed')}else await route.continue()});
  await form.getByRole('button',{name:'创建 Case',exact:true}).click();await form.getByRole('button',{name:'核对原创建结果'}).click();await dialog.getByRole('heading',{name:title,exact:true}).waitFor();
  assert.equal(posts,1);assert.equal(lookups,1);assert.deepEqual(errors,[]);console.log(JSON.stringify({root,uiPort,observations:['星图到常规','选择同一事项','查原看板准确反馈，带该版本到用户Teach表单','Plan与Teach原回复','新建Case到目标管理','版本与反馈同版有行动异版无','两个GSA版本实际下载，离线复核表格','已采用G/S建Case失答只读恢复'],posts,lookups,errors}));
} finally { await browser?.close();ui.kill('SIGTERM');await host.close(); }
