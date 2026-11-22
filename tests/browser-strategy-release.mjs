// Run against an isolated Host and Vite UI; no model request is needed.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {chromium} from 'playwright';
import {startTestHost} from './fixtures/host-process.ts';

const uiPort=Number(process.env.OPTRACALL_STRATEGY_RELEASE_UI_PORT||4683),origin=`http://127.0.0.1:${uiPort}`,uid=()=>crypto.randomUUID();
let host,frontend,browser;
async function api(path,method='GET',body,status=200){
  const response=await host.request(path,method,body),result=await response.json();
  assert.equal(response.status,status,JSON.stringify({path,result}));return result;
}
try{
  host=await startTestHost({uiPort});
  await api('/api/configuration','PUT',{name:'战略发布浏览器点验',provider:'openai-compatible',baseUrl:'http://127.0.0.1:14998/v1',model:'synthetic',apiKey:'synthetic-only'});
  const discussionId=uid(),mapId=uid(),mapRoute=`/api/strategy/discussions/${discussionId}/maps`;
  await api('/api/strategy/discussions','POST',{operationId:discussionId,title:'战略发布真实 UI 回归'},201);
  const goal=(id,title)=>({id,kind:'goal',title,metric:'90天复购',baseline:'9%',target:'12%'});
  const strategy={id:'S1',kind:'strategy',title:'首购回访'};
  const draft=(title,goals)=>({title,template:'table',choice:title,excluded:'',assumptions:'',unknowns:'因果关系待试点验证',nodes:[...goals,strategy],edges:goals.map(item=>({id:'S1-'+item.id,from:'S1',to:item.id,kind:'supports'}))});
  const save=(version,title,goals)=>api(mapRoute,'POST',{mapId,operationId:uid(),expectedVersion:version-1,reason:'候选 '+title,draft:draft(title,goals)},201);
  const first=(await save(1,'会员优先',[goal('G1','老客复购')])).version;
  const second=(await save(2,'会员优先加覆盖',[goal('G1','老客复购'),goal('G2','新客首购')])).version;
  const firstPublication=(await api(`${mapRoute}/${mapId}/versions/${first.version}/publication`,'POST',{operationId:uid(),sha256:first.contentSha256},201)).publication;

  frontend=spawn(process.execPath,['scripts/frontend.mjs','dev','--port',String(uiPort),'--strictPort'],{env:{...process.env,OPTRACALL_HOST_PORT:String(host.port)},stdio:['ignore','pipe','inherit']});
  await new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>reject(new Error('Isolated frontend startup timed out')),10_000);
    frontend.stdout.on('data',chunk=>{if(chunk.toString().includes(origin+'/')){clearTimeout(timer);resolve();}});
    frontend.once('exit',code=>{clearTimeout(timer);reject(new Error(`Isolated frontend exited: ${code}`));});
  });
  browser=await chromium.launch({channel:'chrome',args:['--disable-background-networking']});
  const context=await browser.newContext({viewport:{width:1360,height:900},serviceWorkers:'block'});const outbound=[];await context.route('**/*',route=>{const target=new URL(route.request().url());if(target.origin===origin)return route.continue();outbound.push(target.origin);return route.abort();});
  const page=await context.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));page.setDefaultTimeout(9000);
  await page.goto(origin);const button=name=>page.getByRole('button',{name,exact:true});
  await button('战略选择').click();await page.getByLabel('原讨论').selectOption(discussionId);
  await button('战略地图').click();assert.equal(await button('将此版带入目标管理').count(),0,'Map page must not carry map handoff');
  await button('版本与来源').click();assert.equal(await button('带入目标管理').count(),0,'History page must not carry map handoff');
  await button('战略发布').click();await page.getByRole('heading',{name:'战略发布',exact:true}).waitFor();
  await page.locator('.release-record-list .sg-badge').filter({hasText:'当前发布'}).waitFor();
  await page.locator('.release-record-list .sg-badge').filter({hasText:'未发布候选'}).waitFor();
  await button('核对此版并正式发布').click();const confirm=page.getByRole('dialog',{name:'确认正式发布战略地图'});
  await confirm.getByText(/正式发布不会创建目标/).waitFor();await confirm.getByRole('button',{name:'取消'}).click();
  await page.getByText('已取消发布确认，未写入发布记录。').waitFor();
  await button('核对此版并正式发布').click();await confirm.getByRole('button',{name:'确认正式发布',exact:true}).click();
  await page.getByText(/已正式发布，发布记录 /).waitFor();await page.locator('.release-record-list .sg-badge').filter({hasText:'当前发布'}).waitFor();
  await page.locator('.release-record-list li').filter({hasText:'会员优先 · v1'}).getByText('已被替代').waitFor();
  const secondPublication=(await api(`${mapRoute}/${mapId}/publications`)).publications.find(item=>item.version===second.version);

  await button('带入目标管理').click();const handoff=page.getByRole('dialog',{name:'核对承接的目标与策略'});
  await handoff.getByRole('combobox',{name:'目标归属'}).waitFor();
  await handoff.getByRole('combobox',{name:'目标归属'}).selectOption({label:'个人工作'});
  assert.notEqual(await handoff.getByRole('combobox',{name:'目标归属'}).inputValue(),'');
  const g2=handoff.getByRole('checkbox',{name:/G2 ·/});await g2.uncheck();
  await page.waitForFunction(()=>![...document.querySelectorAll('[role=dialog] input[type=checkbox]')].some(input=>input.checked&&input.closest('label')?.textContent?.includes('G2')));
  const saveGoalButton=handoff.getByRole('button',{name:'保存目标候选'});await saveGoalButton.waitFor();assert.equal(await saveGoalButton.isDisabled(),false);
  await saveGoalButton.click();await handoff.waitFor({state:'hidden'});await page.getByText('目标管理').first().waitFor();
  const goalsAfterSave=(await api('/api/strategy/goals')).goals;assert.equal(goalsAfterSave.length,1);assert.equal(goalsAfterSave[0].versions[0].structured.map.version,second.version);
  await button('战略选择').click();await page.getByLabel('原讨论').selectOption(discussionId);await button('战略发布').click();
  await page.locator('.release-handoff-list .sg-badge').filter({hasText:'发布后承接'}).waitFor();

  await button('撤销发布').click();const withdraw=page.getByRole('dialog',{name:'撤销这次发布？'});
  await withdraw.getByText(/不允许撤销后重新发布同一版本/).waitFor();await withdraw.getByRole('button',{name:'取消'}).click();
  await page.getByText('已取消撤销发布，当前发布状态保持不变。').waitFor();
  await button('撤销发布').click();await withdraw.getByRole('button',{name:'确认撤销发布'}).click();
  await page.getByText(/已撤销发布，发布记录 /).waitFor();assert.equal(await button('带入目标管理').count(),0);
  const denied=await api('/api/strategy/workbooks/handoff','POST',{map:{discussionId,mapId,version:second.version,sha256:second.contentSha256},publicationId:secondPublication.publicationId,selected:['G1'],scope:{kind:'personal',id:'self',name:'个人工作'},perspective:'personal'},409);
  assert.equal(denied.code,'strategy_map_not_published');assert.equal((await api('/api/strategy/goals')).goals.length,1);

  await page.emulateMedia({colorScheme:'dark'});await page.setViewportSize({width:390,height:844});
  await page.getByRole('heading',{name:'战略发布',exact:true}).waitFor();
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>window.innerWidth),false,'390px release page must not overflow the document');
  assert.deepEqual(outbound,[]);assert.deepEqual(errors,[]);
  console.log('PASS strategy release UI: publish cancel/confirm, sole handoff, candidate save, withdraw, entry removal, dark 390px');
}finally{
  await browser?.close();
  if(frontend?.exitCode===null&&frontend.signalCode===null){const stopped=once(frontend,'exit');frontend.kill('SIGTERM');await stopped;}
  await host?.close();
}
