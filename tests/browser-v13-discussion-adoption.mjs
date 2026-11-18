// Run explicitly against an ephemeral Host, local protocol provider, and the normal Chromium UI.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {setTimeout as wait} from 'node:timers/promises';
import {chromium} from 'playwright';
import {startTestHost} from './fixtures/host-process.ts';
import {startToolProvider} from './fixtures/tool-provider.ts';

const port=Number(process.env.OPTRACALL_DISCUSSION_UI_PORT || 4591);
const host=await startTestHost({uiPort:port}), provider=await startToolProvider();
const ui=spawn(process.execPath,['scripts/frontend.mjs','dev','--port',String(port),'--strictPort'],{stdio:['ignore','pipe','pipe'],env:{...process.env,OPTRACALL_HOST_PORT:String(host.port)}});
let browser;
try {
  await new Promise((resolve,reject)=>{ui.stdout.on('data',b=>{if(String(b).includes(':'+port+'/'))resolve();});ui.once('exit',c=>reject(Error('UI exit '+c)));});
  async function api(route,method='GET',input){const r=await host.request(route,method,input);assert.ok(r.ok,await r.clone().text());return r.json();}
  const id=randomUUID(), discussion='/api/strategy/discussions/'+id;
  await api('/api/configuration','PUT',{name:'本机合成',provider:'openai-compatible',model:'ui-review',baseUrl:provider.baseUrl,apiKey:'synthetic-only'});
  await api('/api/strategy/discussions','POST',{operationId:id,title:'回购策略原讨论'});
  const draft={title:'讨论内候选',outcome:'核对两周经营结果',strategies:['第一版预约'],perspective:'personal',scope:{kind:'personal',id:'self',name:'本人'},measurement:{kind:'deliverable',criterion:'分店周报'},baseline:{state:'pending',description:'观察中'},responsible:'本人'};
  provider.setResponder(t=>t.recentToolResults.length?{text:'已保存供人核对的目标。'}:{calls:[{name:'strategy_goals',arguments:{action:'propose-goal',draft}}]});
  await api(discussion+'/messages','POST',{requestId:randomUUID(),expectedRevision:1,text:'请形成候选以便稍后核对。'});
  let goal;for(let i=0;i<250;i++){const d=await api(discussion);if(!d.busy && d.goals?.length){goal=d.goals[0];break;}await wait(30);}assert.ok(goal);
  const origin='/api/strategy/goals/'+goal.goalId;
  const revise=(version,strategy)=>api(origin+'/revisions','POST',{...draft,strategies:[strategy],source:goal.source,operationId:randomUUID(),expectedVersion:version});
  browser=await chromium.launch({channel:'chrome',headless:true});const page=await browser.newPage({viewport:{width:1320,height:940}});
  page.setDefaultTimeout(7500);const errors=[];page.on('pageerror',e=>errors.push(e.message));
  const click=(name,root=page)=>root.getByRole('button',{name,exact:true}).click();
  async function open(version,button='核对并采用'){
    await page.goto('http://127.0.0.1:'+port);
    await click('战略选择',page.getByRole('navigation',{name:'主导航',exact:true}));
    await page.locator('label').filter({hasText:/^原讨论/}).locator('select').selectOption(id);
    const card=page.locator('.strategy-discussion-candidate').filter({hasText:new RegExp('· v'+version+'(?:\\D|$)')});
    await click(button,card);
    return page.getByRole('dialog',{name:'核对并采用目标／GSA'});
  }
  const confirm='确认采用目标／GSA', before=provider.requests.length;
  let modal=await open(1);
  await modal.getByText('首次采用',{exact:true}).waitFor();
  await click(confirm,modal);await modal.waitFor({state:'hidden'});
  await revise(1,'第二版延时');await revise(2,'第三版分流');
  modal=await open(3);
  await modal.getByRole('group',{name:'当前采用 v1'}).getByText('第一版预约',{exact:true}).waitFor();
  await modal.getByRole('group',{name:'本次候选 v3'}).getByText('第三版分流',{exact:true}).waitFor();
  await modal.getByText('仅 S 变化',{exact:true}).waitFor();
  await api(origin+'/adopt','POST',{operationId:randomUUID(),version:2,expectedVersion:3,decision:'另一窗口已确认第二版'});
  const posted=()=>page.waitForResponse(r=>new URL(r.url()).pathname===discussion+'/adopt' && r.request().method()==='POST');
  const one=posted();await click(confirm,modal);const denied=await one;
  assert.equal(denied.status(),409);assert.equal(denied.request().postDataJSON().expectedAdoptedVersion,1);
  await modal.getByRole('group',{name:'当前采用 v2'}).getByText('第二版延时',{exact:true}).waitFor();
  assert.equal((await api(origin)).goal.adoptedVersion,2);
  await click(confirm,modal);await modal.waitFor({state:'hidden'});assert.equal((await api(origin)).goal.adoptedVersion,3);

  await revise(3,'第四版现场核对');await revise(4,'第五版合作门店');
  modal=await open(5);
  await modal.getByText('策略、资源与必要条件',{exact:true}).click();
  const input=modal.getByLabel('策略安排（每行一项，可选）');await input.fill('手动订正的策略');
  await modal.getByRole('group',{name:'本次候选 v6'}).getByText('手动订正的策略',{exact:true}).waitFor();
  await api(origin+'/adopt','POST',{operationId:randomUUID(),version:4,expectedVersion:5,decision:'同时确认第四版'});
  const second=posted();await click(confirm,modal);assert.equal((await second).status(),409);
  await modal.getByRole('group',{name:'当前采用 v4'}).waitFor();assert.equal(await input.inputValue(),'手动订正的策略');
  assert.equal((await api(origin)).goal.currentVersion,6);
  let loss=0;
  await page.route('**'+discussion+'/adopt',async route=>{const res=await route.fetch();assert.equal(res.status(),200);loss++;await route.abort('failed');});
  await click(confirm,modal);await modal.getByRole('button',{name:'核对原保存／采用结果'}).waitFor();
  const saved=(await api(origin)).goal;assert.equal(saved.adoptedVersion,6);assert.equal(saved.currentVersion,6);
  await page.unroute('**'+discussion+'/adopt');
  // Reopen before querying the committed operation. No second adoption or revision is needed.
  modal=await open(5);await click('核对原保存／采用结果',modal);await modal.waitFor({state:'hidden'});
  assert.equal((await api(origin)).goal.versions.length,6);assert.equal(loss,1);assert.deepEqual(errors,[]);assert.equal(provider.requests.length,before);
  await revise(6,'第七版保留原操作');modal=await open(7);
  await page.route('**'+discussion+'/adopt',async r=>{const saved=await r.fetch();assert.equal(saved.status(),200);await r.abort('failed');});
  await click(confirm,modal);await modal.getByRole('button',{name:'核对原保存／采用结果'}).waitFor();
  await page.unroute('**'+discussion+'/adopt');modal=await open(7,'核对原采用结果');
  await click('核对原保存／采用结果',modal);await modal.waitFor({state:'hidden'});
  const recovered=(await api(origin)).goal;assert.equal(recovered.adoptedVersion,7);assert.equal(recovered.currentVersion,7);
  assert.deepEqual(errors,[]);assert.equal(provider.requests.length,before);
  console.log(JSON.stringify({recoveredAlreadyAdopted:7,goal:goal.goalId,discussion:id,initial:1,priorChangedTo:2,confirmed:3,edited:6,previousAdopted:4,duplicateRevisions:0,lostAndRecovered:loss,providerRequests:before,errors}));
} finally {await browser?.close();ui.kill();await host.close();await provider.close();}
