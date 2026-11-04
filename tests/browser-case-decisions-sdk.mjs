// Actual product UI → Host → Pi → loopback canned Provider → Case/native.
// Provider plans are synthetic test inputs, never a production Host workflow.
import {chromium} from '/Users/bendandebaba/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import assert from 'node:assert/strict';
const base='.local/fourbase-modules/m5/implementation/live',ready=JSON.parse(await readFile(base+'/ready.json','utf8')),ui=ready.uiUrl;
assert.equal(ui,'http://127.0.0.1:4198');assert(ready.fixtureRoot.includes('/.local/fourbase-modules/m5/implementation/live/fixture'));
const label=process.env.M5_SDK_UI_RUN||String(Date.now()),evidence=`${base}/sdk-ui-${label}`,shots=`output/playwright/m5-product/sdk-ui-${label}`;await mkdir(evidence,{recursive:true});await mkdir(shots,{recursive:true});
const headers={origin:ui,'x-optracall-client':'1','content-type':'application/json'};
async function api(route,method='GET',body){const response=await fetch(ui+route,{method,headers,...(body===undefined?{}:{body:JSON.stringify(body)})});const text=await response.text();assert(response.ok,`${method} ${route}: ${response.status} ${text}`);return JSON.parse(text);}
const {project}=await api('/api/projects','POST',{name:`M5界面SDK闭环 ${label}`});const {task}=await api(`/api/projects/${project.id}/tasks`,'POST',{name:'原任务连续分析'});
let {case:record}=await api('/api/cases','POST',{operationId:randomUUID(),title:`M5真实界面合成闭环 ${label}`,description:'全部为合成资料，不证明经营效果。'});await api(`/api/cases/${record.id}/projects`,'POST',{operationId:randomUUID(),expectedRevision:record.revision,projectId:project.id});
const route=`/api/projects/${project.id}/tasks/${task.id}`,caseRoute=`/api/cases/${record.id}`;
const browser=await chromium.launch({headless:true,executablePath:'/Users/bendandebaba/Library/Caches/ms-playwright/chromium_headless_shell-1212/chrome-headless-shell-mac-arm64/chrome-headless-shell'});const page=await browser.newPage({viewport:{width:1440,height:1000}});page.setDefaultTimeout(10000);
const errors=[],writes=[],checks=[];page.on('pageerror',e=>errors.push(e.stack));page.on('request',r=>{if(r.method()!=='GET'&&r.url().includes('/api/'))writes.push({path:new URL(r.url()).pathname,body:r.postDataJSON()});});
async function until(fn,ms=30000){const end=Date.now()+ms;while(Date.now()<end){const v=await fn();if(v)return v;await new Promise(r=>setTimeout(r,80));}throw Error('Actual UI/Host did not settle');}
async function openCase(){await page.goto(ui);await page.getByRole('button',{name:record.title,exact:true}).click();const dialog=page.getByRole('dialog',{name:record.title,exact:true});await dialog.getByRole('region',{name:'Case 决策记录',exact:true}).waitFor();return dialog;}
async function send(marker,steps){
  await writeFile(base+'/plan.json',JSON.stringify({marker,steps},null,2));const d=await openCase();await d.getByRole('button',{name:'继续提问',exact:true}).click();
  const box=page.getByRole('textbox',{name:'消息',exact:true});await box.fill(marker);await until(async()=>(await api(route)).task.draft===marker);
  const accepted=page.waitForResponse(r=>new URL(r.url()).pathname===route+'/messages'&&r.request().method()==='POST');await page.getByRole('button',{name:'发送消息',exact:true}).click();const response=await accepted;assert.equal(response.status(),202,await response.text());const input=response.request().postDataJSON();assert.equal(input.caseContext.caseId,record.id);assert.equal(input.text,marker);
  const state=await until(async()=>{const s=await api(route);return s.task.lastRun?.id===input.requestId&&s.task.lastRun.status!=='running'?s:false;});assert.equal(state.task.lastRun.status,'completed');return{input,state};
}
try{
  const first=await send(`M5_UI_CREATE_${label} 请按需要留下判断。`,[{calls:[{name:'save_case_decision_draft',arguments:{kind:'hypothesis',expectedRevision:0,payload:{title:'完全无权限的解释待核',statement:'可能没有权限，也可能权限已有但未执行。'}}}]},{text:'合成有限判断已保存，未证实。'}]);
  let list=await api(caseRoute+'/decisions');assert.equal(list.items.length,1);const h=list.items[0];assert.equal(h.origin.requestId,first.input.requestId);assert.equal(h.origin.actorKind,'agent');checks.push('actual Case UI normal send created Agent hypothesis via Pi, with real origin and no form');
  const ref={type:'case-decision',caseStoreId:list.caseStoreId,caseId:record.id,recordId:h.recordId,revision:1};
  await send(`M5_UI_STRATEGY_${label} 请按需要整理方案。`,[{calls:[{name:'codemode',arguments:{code:`const r=await tools.save_case_decision_draft(${JSON.stringify({kind:'strategy',expectedRevision:0,payload:{title:'核对执行后再考虑扩大授权',proposal:'先核对权限和执行日志，适用性仍待核。'},references:[{relation:'depends_on',target:ref,note:null}]})});text(r);`}}]},{text:'合成方案已保存，可选择也可继续分析。'}]);
  list=await api(caseRoute+'/decisions');assert.equal(list.items.length,2);const s=list.items.find(r=>r.kind==='strategy');assert(s);const beforeChoice=JSON.stringify(s);
  let d=await openCase();const card=d.getByRole('article').filter({has:page.getByRole('heading',{name:s.payload.title,exact:true})});await card.getByRole('button',{name:'先补证',exact:true}).click();await card.getByText('你的最近选择：先补证 · v1',{exact:true}).waitFor();const chosen=(await api(caseRoute+'/decisions')).choices.at(-1);assert.equal(chosen.strategyRef.recordId,s.recordId);checks.push('one human exact-version choice after legal nested SDK save; no Board execution');
  await send(`M5_UI_COUNTER_${label} 新资料说明已有权限，请重看判断和方案。`,[
    {calls:[{name:'save_case_decision_draft',arguments:{kind:'hypothesis',recordId:h.recordId,expectedRevision:1,payload:{title:'撤回完全无权限前提',statement:'合成新证据说明已有权限，执行原因仍未知。',assessment:'refuted',assessmentReason:'作者声明的新反证，非Host判定。'}}}]},
    {calls:[{name:'save_case_decision_draft',arguments:{kind:'strategy',recordId:s.recordId,expectedRevision:1,payload:{title:'先核实实际使用路径',proposal:'保留扩大授权决定，先核实已有权限如何实际使用。'},references:[{relation:'depends_on',target:{...ref,revision:2},note:null}],impactNotes:[{target:{...ref,recordId:s.recordId,revision:1},explanation:'原前提由作者撤回，因此提出新方案。'}]}}]},
    {text:'合成修订完成，原选择仍绑定旧稿，不自动改行动。'},
  ]);
  list=await api(caseRoute+'/decisions');assert.equal(list.items.find(r=>r.recordId===h.recordId).revision,2);assert.equal(list.items.find(r=>r.recordId===s.recordId).revision,2);assert.equal(list.choices.at(-1).choiceId,chosen.choiceId);assert.equal(list.choices.at(-1).strategyRef.revision,1);
  const exact=await api(caseRoute+`/decisions/${s.recordId}/revisions/1`);assert.equal(JSON.stringify(exact.revision),beforeChoice);
  d=await openCase();const current=d.getByRole('article').filter({has:page.getByRole('heading',{name:'先核实实际使用路径',exact:true})});await current.getByText(/选择绑定旧版/).waitFor();await d.screenshot({path:shots+'/current-after-counter.png'});checks.push('new evidence -> separate H/S revisions; original choice, old exact body, original Case/task retained');
  const native=(await api(route)).task.sessionFile;assert(native.startsWith(ready.fixtureRoot+'/data/'));const bytes=await readFile(native,'utf8');assert(bytes.includes('save_case_decision_draft'));assert(bytes.includes('nestedCalls'));assert(bytes.includes(h.operationId));
  assert.equal(writes.filter(w=>w.path.includes('/api/decision-board/')&&w.path!=='').length,0);assert.deepEqual(errors,[]);
  await writeFile(evidence+'/result.json',JSON.stringify({result:'PASS',projectId:project.id,taskId:task.id,caseId:record.id,checks,writes,errors,native,provider:'loopback canned; not real model reasoning'},null,2));console.log(JSON.stringify({result:'PASS',checks:checks.length,evidence}));
}catch(error){await page.screenshot({path:shots+'/failure.png',fullPage:true});await writeFile(evidence+'/result.json',JSON.stringify({result:'FAIL',error:String(error),checks,writes,errors},null,2));throw error;}finally{await browser.close();}
