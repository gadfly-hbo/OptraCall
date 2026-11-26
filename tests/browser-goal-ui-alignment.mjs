// Isolated real Host/Chromium acceptance for the approved goal journey.
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {chromium} from 'playwright';
import {createHost} from '../src/host/server.ts';
const root=path.resolve('.local/ui-rework',process.env.GOAL_UI_RUN||randomUUID());await mkdir(root,{recursive:true});
const host=createHost({cwd:process.cwd(),staticUiRoot:path.resolve('dist'),uiPorts:[4173],dataRoot:path.join(root,'data'),projectsRoot:path.join(root,'projects')});
await host.ready;await new Promise(r=>host.server.listen(0,'127.0.0.1',r));
const base='http://127.0.0.1:'+host.server.address().port;
async function api(route,method='GET',body){const r=await fetch(base+route,{method,headers:{origin:base,'content-type':'application/json','x-optracall-client':'1'},...(body?{body:JSON.stringify(body)}:{})});const v=await r.json();assert.ok(r.ok,JSON.stringify(v));return v;}
const browser=await chromium.launch({headless:true,executablePath:'/usr/bin/chromium'});
const page=await browser.newPage({viewport:{width:1600,height:1000}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
try{
 const title='90天会员二购率提升试点：一店试点、两店对照，完整30天队列从18%提升至22%。';
 const {goal}=await api('/api/strategy/goals','POST',{operationId:randomUUID(),title,outcome:title,perspective:'personal',scope:{kind:'personal',id:'ui-test',name:'个人工作'},measurement:{kind:'deliverable',criterion:title},baseline:{state:'pending',description:'待核'},responsible:'负责人',strategies:['会员回访优先']});
 await page.goto(base);await page.getByRole('navigation',{name:'主导航',exact:true}).getByRole('button',{name:'目标管理',exact:true}).click();
 await page.locator('.gm-workspace').waitFor();
 for(let i=1;i<=3;i++){
  const revise=page.getByRole('button',{name:'修订基础 G/S 字段',exact:true});
  if(!await revise.isVisible())await page.getByRole('button',{name:'修改 GSA',exact:true}).click();
  await revise.click();const dialog=page.getByRole('dialog',{name:'提出目标修订',exact:true});
  await dialog.getByRole('button',{name:'保存修订候选',exact:true}).click();await dialog.waitFor({state:'hidden'});
  const deadline=Date.now()+5000;while(Date.now()<deadline){const v=await api('/api/strategy/goals');if(v.goals.find(g=>g.id===goal.goalId)?.currentVersion===i+1)break;await page.waitForTimeout(30);}
  await page.waitForTimeout(100);
  const count=await page.locator('.gm-workspace').count();await page.screenshot({path:path.join(root,'revision-'+i+'.png')});
  assert.equal(count,1,'saving a candidate must replace the sole current workspace before refresh');
 }
 const index=await api('/api/strategy/goals');assert.equal(index.goals.length,1);assert.equal(index.goals[0].versions.length,4);assert.deepEqual(errors,[]);
 // Cancelling the same-key editor must also leave one current workspace before confirming GSA.
 const current=index.goals[0].versions.at(-1);
 await api('/api/strategy/goals/'+goal.goalId+'/revisions','POST',{...current,operationId:randomUUID(),expectedVersion:4,formalOrigin:{kind:'manual-exception',reason:'当前尚无正式战略发布',period:'2027-01',targetValue:22,unit:'%',metricKind:'ratio'}});
 await page.reload();await page.locator('.gm-workspace').waitFor();
 await page.getByRole('button',{name:'版本与来源',exact:true}).click();
 await page.getByRole('dialog',{name:'版本与来源',exact:true}).getByRole('listitem').filter({hasText:title+' · v5'}).getByRole('button',{name:'查看此版',exact:true}).click();
 for(let i=0;i<3;i++){
   await page.getByRole('button',{name:'修改 GSA',exact:true}).click();
   await page.getByRole('button',{name:'修订基础 G/S 字段',exact:true}).click();
   await page.getByRole('dialog',{name:'提出目标修订',exact:true}).waitFor();
   await page.keyboard.press('Escape');
   assert.equal(await page.locator('.gm-workspace').count(),1);
 }
 await page.getByRole('button',{name:'修改 GSA',exact:true}).click();
 await page.getByText('另设阶段检查点与确认信息',{exact:true}).click();
 const confirmer=page.getByLabel('确认人',{exact:true}),decision=page.getByLabel('确认说明',{exact:true});
 const beforeActor=await confirmer.inputValue(),beforeDecision=await decision.inputValue();
 await confirmer.fill('取消的署名');await decision.fill('取消的确认说明');
 await page.getByRole('dialog',{name:'修改 GSA',exact:true}).getByRole('button',{name:'取消',exact:true}).click();
 await page.getByRole('button',{name:'修改 GSA',exact:true}).click();
 await page.getByText('另设阶段检查点与确认信息',{exact:true}).click();
 assert.equal(await confirmer.inputValue(),beforeActor);assert.equal(await decision.inputValue(),beforeDecision);
 await page.getByLabel('计划 A 1 内容',{exact:true}).fill('首购会员试点回访');
 await page.getByLabel('计划 A 1 检查点',{exact:true}).fill('每周核对回访与成熟队列');
 await page.getByLabel('计划 A 1 观察依据',{exact:true}).fill('会员回访记录与POS队列');
 await page.getByRole('button',{name:'确认 GSA，开始拆解',exact:true}).click();
 await page.getByRole('button',{name:'按此要求起草',exact:true}).waitFor();
 assert.equal(await page.locator('.gm-workspace').count(),1,'cancel then confirm must not leave orphan workspaces');
 const confirmed=await api('/api/strategy/goals/'+goal.goalId+'/workspace');
 assert.equal(confirmed.gsaPlans.length,1);assert.equal(confirmed.activeGsaPlan.confirmedBy,beforeActor);assert.equal(confirmed.activeGsaPlan.decision,beforeDecision);
 assert.deepEqual(errors,[]);
 console.log('PASS: repeated revisions and cancel/confirm retain one workspace; cancelled signature and decision are not committed');
}catch(e){await page.screenshot({path:path.join(root,'failure.png')});await writeFile(path.join(root,'failure.html'),await page.content());throw e;}
finally{await browser.close();await host.close();}
