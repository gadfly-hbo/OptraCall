// Exercise the normal Chromium entry on a running isolated synthetic Host.
import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const [base, scenario] = process.argv.slice(2);
if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(base) || base.endsWith(':4173')) throw Error('Use an isolated test Host');
const id = () => crypto.randomUUID();
const name = scenario + '-' + id().slice(0,8);
async function api(route,method='GET',body) {
  const r = await fetch(base+'/api/'+route, {method,headers:{origin:base,'content-type':'application/json','x-optracall-client':'1'},body:body&&JSON.stringify(body)});
  assert.ok(r.ok, route+' '+r.status+' '+(await r.clone().text()).slice(0,200)); return r.json();
}
const browser = await chromium.launch({channel:'chrome'});
const page = await browser.newPage({viewport:{width:1320,height:920}});
page.setDefaultTimeout(8000);
const errors=[];page.on('pageerror',e=>errors.push(e.message));
const button = (name,root=page) => root.getByRole('button',{name,exact:true});
const nav = page.getByRole('navigation',{name:'主导航',exact:true});
const result = {};
async function strategy(){
  const discussion=id(), route='strategy/discussions/'+discussion;
  await api('strategy/discussions','POST',{operationId:discussion,title:name});
  await api(route+'/messages','POST',{requestId:id(),text:'请比较两个窗口的可行性。',expectedRevision:1});
  let detail;
  await page.waitForFunction(async route => {
    const r=await fetch('/api/'+route);const d=await r.json();return !d.busy && !!d.replies?.length;
  },route);
  detail=await api(route);
  const source=detail.replies[0].source;
  for(const choice of ['预约窗口','延时窗口']) {
    await api(route+'/versions','POST',{source,expectedRevision:(await api(route)).discussion.revision,options:'两个窗口',choice,rationale:'保留原比较依据',assumptions:'咨询量保持',unknowns:'晚间量待核'});
  }
  await page.reload();await button('战略选择',nav).click();await page.locator('label').filter({hasText:/^原讨论/}).locator('select').selectOption(discussion);
  await button('版本与导出').click();
  const selectVersion=page.getByLabel('已保存版本');await selectVersion.selectOption('2');await page.getByText('延时窗口',{exact:true}).waitFor();
  const readV1='**/api/'+route+'/versions/1';
  await page.route(readV1,r=>r.fulfill({status:403,json:{code:'strategy_source_not_authorized'}}));
  await selectVersion.selectOption('1');await page.getByRole('alert').filter({hasText:'所选文稿或依据已失读'}).waitFor();
  assert.equal(await button('将此版带入 GSA').count(),0);assert.equal(await page.getByText('延时窗口',{exact:true}).count(),0);
  assert.equal((await api(route+'/versions/2')).version.destination,undefined);
  await page.unroute(readV1);await selectVersion.selectOption('2');await selectVersion.selectOption('1');
  await page.getByText('预约窗口',{exact:true}).waitFor();await page.getByLabel('接收范围').waitFor();
  const before=(await api(route+'/versions/1')).version, previousRevision=(await api(route)).discussion.revision;
  await button('将此版带入 GSA').click();await page.getByRole('navigation',{name:'目标管理工作视图'}).waitFor();
  const after=(await api(route+'/versions/1')).version, other=(await api(route+'/versions/2')).version;
  assert.deepEqual(after.source,source);assert.equal(after.contentSha256,before.contentSha256);assert.equal(after.choice,'预约窗口');assert.ok(after.destination?.scope);assert.ok(!other.destination);assert.equal((await api(route+'/versions')).versions.length,2);
  await button('战略选择',nav).click();await page.locator('label').filter({hasText:/^原讨论/}).locator('select').selectOption(discussion);await button('版本与导出').click();await page.getByLabel('已保存版本').selectOption('1');await button('打开已交接的目标草稿').click();
  const repeated=await api(route+'/versions/1/handoff','POST',{expectedRevision:previousRevision,scope:after.destination.scope});
  assert.deepEqual(repeated.version,after);
  assert.deepEqual((await api(route+'/versions/1')).version,after);
  Object.assign(result,{discussion,version:after.version,sha256:after.contentSha256,scope:after.destination.scope,versionCount:2});
}
async function adoption(){
  const goals='strategy/goals',oldG='旧目标：当日完成接待',oldS='旧策略：延长营业',newG='新目标：优先预约',newS='新策略：预约分流';
  const kinds=[['仅 G 变化',newG,oldS],['仅 S 变化',oldG,newS],['G 和 S 均变化',newG,newS]];
  const confirmations=[];
  for(const [change,outcome,strategy] of kinds){
    const draft={title:name+change,outcome:oldG,perspective:'personal',scope:{kind:'personal',id:'self',name:'个人工作'},measurement:{kind:'deliverable',criterion:'核对原接待单'},baseline:{state:'pending',description:'观察中'},responsible:'经营负责人',strategies:[oldS,'保留既有渠道']};
    const {goal}=await api(goals,'POST',{...draft,operationId:id()});const route=goals+'/'+goal.goalId;
    await api(route+'/adopt','POST',{version:1,expectedVersion:1,decision:'采用第一版',operationId:id()});
    await api(route+'/revisions','POST',{...draft,outcome,strategies:[strategy,'保留既有渠道'],expectedVersion:1,operationId:id()});
    await page.reload();await button('目标管理',nav).click();await button('核对与采用').click();
    await page.getByRole('button',{name:new RegExp(draft.title)}).click();await button('核对并采纳此版本').click();
    const modal=page.getByRole('dialog',{name:'采纳此目标版本'});const compare=modal.getByRole('region',{name:'G 与 S 采用对照'});
    await compare.getByText(change,{exact:true}).waitFor();
    const original=compare.getByRole('group',{name:'当前采用 v1'}),candidate=compare.getByRole('group',{name:'本次候选 v2'});
    for(const [block,g,s] of [[original,oldG,oldS],[candidate,outcome,strategy]]){const text=await block.innerText();for(const fact of [g,s,'核对原接待单','保留既有渠道'])assert.ok(text.includes(fact),text);}
    await modal.getByLabel('本次明确决定').fill('采用对应修改');await button('确认采纳此版本',modal).click();await modal.waitFor({state:'hidden'});assert.equal((await api(route)).goal.adoptedVersion,2);confirmations.push({change,id:goal.goalId});
  }
  const draft={title:name+'并发采用',outcome:oldG,perspective:'personal',scope:{kind:'personal',id:'self',name:'个人工作'},measurement:{kind:'deliverable',criterion:'原始日报'},baseline:{state:'pending',description:'观察中'},responsible:'经营负责人',strategies:[oldS]};
  const {goal}=await api(goals,'POST',{...draft,operationId:id()}), route=goals+'/'+goal.goalId;
  await api(route+'/adopt','POST',{version:1,expectedVersion:1,decision:'采用第一版',operationId:id()});
  for(const n of [2,3])await api(route+'/revisions','POST',{...draft,outcome:'第'+n+'版目标',expectedVersion:n-1,operationId:id()});
  await page.reload();await button('目标管理',nav).click();await button('核对与采用').click();
  await page.getByRole('button',{name:new RegExp(draft.title)}).click();await page.getByLabel('查看准确版本').selectOption('3');await button('核对并采纳此版本').click();
  const modal=page.getByRole('dialog',{name:'采纳此目标版本'});
  await modal.getByRole('group',{name:'当前采用 v1'}).waitFor();
  await api(route+'/adopt','POST',{version:2,expectedVersion:3,decision:'另一人采用第二版',operationId:id()});
  const reason=modal.getByLabel('本次明确决定');await reason.fill('原采用比较待重核');
  const posted=page.waitForResponse(r=>r.url().endsWith('/'+route+'/adopt') && r.request().method()==='POST');
  await button('确认采纳此版本',modal).click();const conflict=await posted;
  assert.equal(conflict.status(),409);assert.equal(conflict.request().postDataJSON().expectedAdoptedVersion,1);
  await modal.getByRole('group',{name:'当前采用 v2'}).waitFor();assert.equal(await reason.inputValue(),'原采用比较待重核');
  assert.equal((await api(route)).goal.adoptedVersion,2);
  await reason.fill('已核对第二版，明确采用第三版');await button('确认采纳此版本',modal).click();
  await modal.waitFor({state:'hidden'});assert.equal((await api(route)).goal.adoptedVersion,3);
  result.conflictingAdoption={goal:goal.goalId,firstStatus:conflict.status(),refreshed:2,confirmed:3};
  result.adopted=confirmations;
}
async function stage(){
  const {project}=await api('projects','POST',{name});await page.reload();await button(name).click();await button('阶段目标').click();
  assert.deepEqual(project.stages??[],[]);const entries=[];
  for(const [goal,condition] of [['核对当期复购',''],['','收到两周实际观察']]){
    await button('设置阶段目标').click();assert.ok(await button('保存阶段目标').isDisabled());
    await page.getByLabel('阶段目标',{exact:true}).fill(goal);await page.getByLabel('结束条件',{exact:true}).fill(condition);
    assert.ok(await button('保存阶段目标').isEnabled(),'one field must suffice');await button('保存阶段目标').click();
    await button('结束本阶段').click();await button('确认结束阶段').click();await button('设置阶段目标').waitFor();
    entries.push({goal,condition,done:false},{goal,condition,done:true});
  }
  await page.reload();await button(name).click();await button('阶段目标').click();
  const {projects}=await api('projects');const history=projects.find(p=>p.id===project.id).stages;
  assert.deepEqual(history.map(({goal,condition,done})=>({goal,condition,done})),entries);result.history=history.map(s=>[s.version,s.done]);
}
async function files(){
  const {project}=await api('projects','POST',{name});const {task}=await api('projects/'+project.id+'/tasks','POST',{name:'资料步骤 '+name});
  await page.reload();await button(name).click();
  const expand=button('展开 '+name+' 的任务');if(await expand.count())await expand.click();await button(task.name).click();
  const box=page.getByRole('textbox',{name:'消息',exact:true});await box.fill('保留未发的草稿 '+name);
  const launch=page.locator('.workspace-conversation-task:visible').getByRole('button',{name:'放大对话'});
  const flows=[];
  for(const width of [1320,390]){
    await page.setViewportSize({width,height:915});
    const dialog=page.getByRole('dialog',{name:'任务对话 · '+task.name});
    for(const [entry,location] of [[/资料准备/,page],[/打开项目文件上传/,dialog]]){
      if(location===dialog) await launch.click();
      const opener=location.getByRole('button',{name:entry});await opener.click();
      await dialog.waitFor({state:'hidden'});const files=page.getByRole('complementary',{name:'项目文件'});await button('刷新文件',files).click();
      await button('关闭项目文件栏',files).click();await files.waitFor({state:'hidden'});const back=page.getByRole('button',{name:entry});
      await page.waitForFunction(el=>document.activeElement===el,await back.elementHandle());
      assert.equal(await back.evaluate(el=>el===document.activeElement),true);assert.equal(await box.inputValue(),'保留未发的草稿 '+name);flows.push([width,String(entry)]);
    }
  }
  result.entries=flows;result.task=task.id;
}
async function native() {
  // Start tests/fixtures/command-browser-environment.ts and supply its loopback provider URL.
  const providerURL = new URL(process.argv[4]);
  assert.equal(providerURL.hostname,'127.0.0.1'); assert.equal(new URL(base).port,'4183');
  await api('configuration','PUT',{name:'本机协议端',provider:'openai-compatible',model:'synthetic',baseUrl:providerURL.href,apiKey:'synthetic-native'});
  const {project}=await api('projects','POST',{name}), {task}=await api('projects/'+project.id+'/tasks','POST',{name:'Pi 提问 '+name});
  await page.reload();await button(name).click();
  const expand=button('展开 '+name+' 的任务');if(await expand.count())await expand.click();await button(task.name).click();
  await page.setViewportSize({width:390,height:844});
  const input=page.getByRole('textbox',{name:'消息',exact:true}),cmds=[],answers=[];
  page.on('request',r=>{if(r.method()!=='POST')return;const url=new URL(r.url());
    if(url.pathname.endsWith('/commands'))cmds.push(r.postDataJSON());
    if(url.pathname.endsWith('/ui-response'))answers.push(r.postDataJSON());
  });
  const enlarge=page.locator('.workspace-conversation-task:visible').getByRole('button',{name:'放大对话'});
  await enlarge.click();await input.fill('/synthetic-confirm');await input.press('Enter');
  const modal=page.getByRole('dialog',{name:'合成确认',exact:true});
  await modal.waitFor();await button('稍后回应',modal).click();await modal.waitFor({state:'hidden'});
  const drawer=page.getByRole('dialog',{name:'任务对话 · '+task.name});await drawer.waitFor();
  await input.fill('下一轮的草稿');
  await drawer.getByRole('button',{name:'打开项目文件上传'}).click();await drawer.waitFor({state:'hidden'});
  const sidebar=page.getByRole('complementary',{name:'项目文件'});await button('刷新文件',sidebar).click();await button('关闭项目文件栏',sidebar).click();
  assert.equal(await input.inputValue(),'下一轮的草稿');
  await enlarge.click();await button('回应 Pi',drawer).click();await modal.waitFor();
  const b=await modal.boundingBox();assert.ok(b && b.x>=0 && b.x+b.width<=391);
  assert.equal(answers.length,0);assert.equal(cmds.length,1);
  await button('不继续',modal).click();await modal.waitFor({state:'hidden'});
  await page.getByText('{"kind":"confirm","value":false,"hasUI":true}',{exact:true}).waitFor();
  const state=await api('projects/'+project.id+'/tasks/'+task.id);assert.equal(state.task.lastRun.id,cmds[0].requestId);
  assert.equal(answers.length,1);assert.equal(await input.inputValue(),'下一轮的草稿');
  Object.assign(result,{task:task.id,request:state.task.lastRun.id,answers:answers.length,commands:cmds.length,draft:await input.inputValue()});
}
async function registry() {
  const {mkdtemp,realpath}=await import('node:fs/promises'),{tmpdir}=await import('node:os'),{join}=await import('node:path');
  const {writeModelPack}=await import('./model-pack-fixtures.ts');
  const packName='pm-ui-'+id().slice(0,8);
  const source=await realpath(await writeModelPack(await mkdtemp(join(tmpdir(),'optracall-pm-pack-')),1,undefined,packName));
  await button('设置').click();await button('业务模型包').click();
  await page.getByRole('button',{name:'导入模型包…'}).first().click();const dialog=page.getByRole('dialog',{name:'导入模型包'});
  await dialog.getByLabel('包目录路径').fill(source);await button('开始验货并导入',dialog).click();
  await page.getByText(new RegExp(packName+' v1 已导入')).first().waitFor();
  const {model}=await api('model-pack/models/'+packName+'/1');assert.equal(model.name,packName);assert.equal(model.version,1);
  Object.assign(result,{name:model.name,version:model.version,stage:model.stage});
}
try{
  await page.goto(base);const actions={strategy,adoption,stage,files,native,registry};assert.ok(actions[scenario]);await actions[scenario]();
  assert.deepEqual(errors,[]);console.log(JSON.stringify({scenario,...result,errors}));
}catch(error){console.error((await page.locator('body').ariaSnapshot()).slice(-9000));throw error;}finally{await browser.close();}
