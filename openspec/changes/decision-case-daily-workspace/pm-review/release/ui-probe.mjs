import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {randomUUID,createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {build} from 'esbuild';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createHost} from '../../src/host/server.ts';
const out=path.resolve('.local/pm-final');
const scratch=await fs.mkdtemp(path.join(os.tmpdir(),'issue149-independent-ui-'));
const uiRoot=path.join(out,'ui-dist');
await build({entryPoints:{main:'src/host/ui/main.tsx'},outdir:uiRoot,bundle:true,format:'esm',jsx:'automatic',target:'es2022',loader:{'.svg':'dataurl','.png':'dataurl','.woff2':'dataurl'},define:{'process.env.NODE_ENV':'"production"'},logLevel:'silent'});
await fs.copyFile('src/host/ui/favicon.svg',path.join(uiRoot,'favicon.svg'));
await fs.writeFile(path.join(uiRoot,'index.html'),(await fs.readFile('index.html','utf8')).replace('/src/host/ui/main.tsx','/main.js').replace('/src/host/ui/favicon.svg','/favicon.svg').replace('</head>','<link rel="stylesheet" href="/main.css"></head>'));
const files=await Promise.all((await fs.readdir(uiRoot)).filter(n=>n!=='optracall-build.json').map(async name=>{const bytes=await fs.readFile(path.join(uiRoot,name));return {path:name,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')};}));
await fs.writeFile(path.join(uiRoot,'optracall-build.json'),JSON.stringify({schema:1,version:JSON.parse(await fs.readFile('package.json','utf8')).version,commit:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),tree:execFileSync('git',['rev-parse','HEAD^{tree}'],{encoding:'utf8'}).trim(),builtAt:new Date().toISOString(),dirty:false,files}));
const host=createHost({cwd:process.cwd(),uiPorts:[],transportVersion:'1',dataRoot:path.join(scratch,'host'),projectsRoot:path.join(scratch,'projects'),staticUiRoot:uiRoot});
let chrome,ws;const receipt={head:'7fe8e936d2463e514f2d8b08deae23f8c0467e24',scratch,steps:[],networkMessages:[]};
let evalJs,send;
const record=(name,data={})=>{receipt.steps.push({name,...data});console.log(name,JSON.stringify(data));};
try{
 await host.ready;await new Promise(r=>host.server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${host.server.address().port}`;receipt.base=base;
 async function api(route,method='GET',body){const res=await fetch(base+route,{method,headers:{'content-type':'application/json','x-optracall-client':'1',origin:base},...(body?{body:JSON.stringify(body)}:{})});const value=await res.json();if(!res.ok)throw Error(res.status+':'+JSON.stringify(value));return value;}
 await api('/api/configuration','PUT',{name:'独立UI合成配置',provider:'openai-compatible',baseUrl:'http://127.0.0.1:1',model:'synthetic',apiKey:'synthetic-only'});
 await api('/api/cases/storage/initialize','POST',{});
 const {goal}=await api('/api/strategy/goals','POST',{operationId:randomUUID(),title:'独立UI已采纳目标',outcome:'形成独立产品UI验证结果',perspective:'personal',scope:{kind:'personal',id:'independent-ui',name:'独立UI验证'},measurement:{kind:'deliverable',criterion:'UI收据'},baseline:{state:'pending',description:'合成验证'},responsible:'独立UI审核人',strategies:['走真实准备和草稿路径']});
 await api(`/api/strategy/goals/${goal.goalId}/adopt`,'POST',{operationId:randomUUID(),version:goal.version,expectedVersion:goal.version,decision:'仅合成验证'});
 const port=24500+Math.floor(Math.random()*5000);const profile=path.join(scratch,'chrome');
 chrome=spawn('/usr/bin/chromium',['--headless=new','--no-sandbox','--disable-gpu','--disable-dev-shm-usage',`--remote-debugging-port=${port}`,`--user-data-dir=${profile}`,'about:blank'],{stdio:'ignore'});
 let url;for(let i=0;i<70&&!url;i++){await new Promise(r=>setTimeout(r,150));try{const targets=await(await fetch(`http://127.0.0.1:${port}/json`)).json();url=targets.find(t=>t.type==='page')?.webSocketDebuggerUrl;}catch{}}
 assert.ok(url);ws=new WebSocket(url);await new Promise((r,j)=>{ws.onopen=r;ws.onerror=j;});let seq=1;const requests=new Map();
 ws.onmessage=ev=>{const m=JSON.parse(String(ev.data));if(m.id){const p=requests.get(m.id);if(p){requests.delete(m.id);m.error?p.j(Error(m.error.message)):p.r(m.result);}}else if(m.method==='Network.requestWillBeSent'&&m.params.request.url.includes('/api/business-role')&&m.params.request.method==='POST'){receipt.networkMessages.push({url:m.params.request.url,body:m.params.request.postData});}};
 send=(method,params={})=>new Promise((r,j)=>{const id=seq++;requests.set(id,{r,j});ws.send(JSON.stringify({id,method,params}));});
 evalJs=async expression=>{const r=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result?.value;};
 const wait=async (expression,label,ms=15000)=>{const end=Date.now()+ms;while(Date.now()<end){if(await evalJs(expression))return;await new Promise(r=>setTimeout(r,100));}throw Error('Timeout '+label+'\n'+await evalJs('document.body.innerText'));};
 const text=needle=>wait(`document.body.innerText.includes(${JSON.stringify(needle)})`,needle);
 const click=async (label,selector='button')=>{const ok=await evalJs(`(()=>{const b=Array.from(document.querySelectorAll(${JSON.stringify(selector)})).filter(x=>x.getClientRects().length).find(x=>x.textContent.trim()===${JSON.stringify(label)});if(!b)return false;b.click();return true;})()`);assert.equal(ok,true,'click '+label);};
 const fill=async (selector,value)=>{assert.equal(await evalJs(`(()=>{const n=document.querySelector(${JSON.stringify(selector)});if(!n)return false;Object.getOwnPropertyDescriptor(n.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype,'value').set.call(n,${JSON.stringify(value)});n.dispatchEvent(new Event('input',{bubbles:true}));return true;})()`),true,'fill '+selector);};
 const select=async(selector,value)=>{assert.equal(await evalJs(`(()=>{const n=document.querySelector(${JSON.stringify(selector)});if(!n)return false;Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(n,${JSON.stringify(value)});n.dispatchEvent(new Event('change',{bubbles:true}));return true;})()`),true);};
 const shot=async(name)=>{const s=await send('Page.captureScreenshot',{format:'png'});await fs.writeFile(path.join(out,name+'.png'),Buffer.from(s.data,'base64'));};
 await send('Network.enable');await send('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});await send('Page.navigate',{url:base});await text('先记下一句话');await wait(`document.querySelector('.home-daily-quick-input > textarea')?.disabled===false`,'ready preparation');
 const raw='独立轻输入 <img src=x onerror="window.__xss=1">，核对真实新Case路径';
 await fill('.home-daily-quick-input > textarea',raw);await click('准备新 Case');
 await wait(`document.querySelector('.home-daily-prepare-box select')?.options.length>1`,'goal options');
 await fill('.home-daily-prepare-box label input','独立轻建案名称');
 await fill('.home-daily-prepare-box label textarea','独立轻建案背景，必须回读');
 await select('.home-daily-prepare-box select',`${goal.goalId}@${goal.version}`);
 await select('.home-daily-prepare-box select:nth-of-type(1)',`${goal.goalId}@${goal.version}`); // same exact goal; strategy is in second label
 await wait(`document.querySelectorAll('.home-daily-prepare-box select').length>=2`,'strategy select');
 await select('.home-daily-prepare-box label:nth-child(4) select','走真实准备和草稿路径');
 await new Promise(r=>setTimeout(r,350));
 const prep=(await api('/api/workspace/drafts/prepare')).drafts;
 const intent=prep.find(d=>d.payload.rawInput===raw);assert.ok(intent);assert.equal(intent.payload.title,'独立轻建案名称');assert.equal(intent.payload.description,'独立轻建案背景，必须回读');assert.equal(intent.payload.selectedGoal.strategy,'走真实准备和草稿路径');record('PREPARE_PERSISTED_EXACT',{id:intent.id,goal:intent.payload.selectedGoal});
 await click('创建或继续 Case');await text('与第一件事项已建立');
 const completed=(await api('/api/workspace/drafts/prepare')).drafts.find(d=>d.id===intent.id);assert.equal(completed.payload.creationState,'completed');assert.ok(completed.payload.firstIssueReceipt?.issueId);const caseId=completed.payload.creationReceipt.caseId;const issueId=completed.payload.firstIssueReceipt.issueId;receipt.caseId=caseId;receipt.issueId=issueId;
 await click('进入已创建 Case「独立轻建案名称」');await text('待带入片段（1');
 assert.equal(await evalJs('Boolean(window.__xss)'),false);assert.equal(receipt.networkMessages.length,0);record('CREATED_FIRST_ISSUE_AND_UNSENT_FRAGMENT',{caseId,issueId,fragmentText:await evalJs(`document.querySelector('.case-carry-over-item p')?.textContent`)});await shot('ui-created-1440');
 await click('与决策 Agent 协作');await wait(`Boolean(document.querySelector('.case-agent-entry .role-composer textarea')&&!document.querySelector('.case-agent-entry .role-composer textarea').disabled)`,'composer');
 const composer='.case-agent-entry .role-composer textarea';await fill(composer,'已有非空草稿，不可覆盖');await new Promise(r=>setTimeout(r,550));
 await click('追加到事项草稿');await text('片段已追加到下方可发送');
 const appended=await evalJs(`document.querySelector(${JSON.stringify(composer)}).value`);assert.ok(appended.startsWith('已有非空草稿，不可覆盖\n\n'));assert.ok(appended.includes(raw));assert.ok(appended.includes('独立轻建案背景，必须回读'));assert.equal(receipt.networkMessages.length,0);
 await click('已追加（再次点击不重复）');await new Promise(r=>setTimeout(r,450));assert.equal(await evalJs(`document.querySelector(${JSON.stringify(composer)}).value`),appended);record('APPEND_PRESERVES_EXISTING_AND_IS_IDEMPOTENT',{length:appended.length});
 await fill(composer,appended+'\n编辑后再重开也保留');await new Promise(r=>setTimeout(r,550));
 const savedDraft=(await api('/api/workspace/drafts/issue-draft/'+encodeURIComponent(`issue:${caseId}:${issueId}`))).draft;assert.equal(savedDraft.payload.text,appended+'\n编辑后再重开也保留');record('SINGLE_COMPOSER_PERSISTED_EDIT',{revision:savedDraft.revision,text:savedDraft.payload.text});
 await evalJs('sessionStorage.clear()');await send('Page.reload');await text('先记下一句话');await click('Decision Case','nav.primary-nav button');await text('独立轻建案名称');
 record('AFTER_RELOAD_DOM',{text:(await evalJs('document.body.innerText')).slice(-1800)});
 // Open exact created Case, then reopen the single real composer.
 const opened=await evalJs(`(()=>{const a=Array.from(document.querySelectorAll('button')).filter(n=>n.getClientRects().length).find(n=>n.textContent.includes('独立轻建案名称'));if(a){a.click();return a.textContent;}return null;})()`);record('OPEN_CASE_AFTER_RELOAD',{opened});
 await text('待带入片段（1');await click('与决策 Agent 协作');await wait(`document.querySelector(${JSON.stringify(composer)})?.value===${JSON.stringify(savedDraft.payload.text)}`,'restored composer');assert.equal(receipt.networkMessages.length,0);assert.equal(await evalJs('Boolean(window.__xss)'),false);record('RELOAD_RESTORED_SAME_COMPOSER_WITHOUT_SEND');
 await send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});await new Promise(r=>setTimeout(r,180));assert.equal(await evalJs('document.documentElement.scrollWidth>innerWidth+2'),false);await evalJs(`document.querySelector(${JSON.stringify(composer)}).scrollIntoView({block:'center'})`);await shot('ui-composer-390');record('NARROW_SCREEN_NO_PAGE_OVERFLOW');
 await evalJs(`document.querySelector('dialog[open] button')?.focus()`);for(let i=0;i<20;i++){await send('Input.dispatchKeyEvent',{type:'keyDown',key:'Tab',code:'Tab',windowsVirtualKeyCode:9});await send('Input.dispatchKeyEvent',{type:'keyUp',key:'Tab',code:'Tab',windowsVirtualKeyCode:9});assert.equal(await evalJs(`Boolean(document.querySelector('dialog[open]')?.contains(document.activeElement))`),true);}record('KEYBOARD_FOCUS_REMAINED_IN_MODAL_20_TABS');
 
 // UI fault injection affects only a single original detail GET; writes and all other endpoints stay real.
 await send('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
 await evalJs(`window.__realFetch=window.fetch;window.__detailFailure=503;window.fetch=(input,init)=>{const u=String(input);if(u===${JSON.stringify('/api/cases/'+caseId)}&&(!init?.method||init.method==='GET')&&window.__detailFailure)return Promise.resolve(new Response(JSON.stringify({code:'synthetic_detail_failure'}),{status:window.__detailFailure,headers:{'content-type':'application/json'}}));return window.__realFetch(input,init);}`);
 await click('刷新详情');await text('当前显示旧快照');assert.ok(await evalJs(`document.querySelector('.case-gs-pinned')?.textContent.includes('独立UI已采纳目标')`));record('503_RETAINS_LABELED_EXACT_SNAPSHOT');
 await evalJs('window.__detailFailure=403');await click('刷新详情');await text('原详情、来源和操作入口已清除');assert.equal(await evalJs(`Boolean(document.querySelector('.case-gs-pinned')||document.querySelector('.case-issue-work')||document.querySelector('.case-agent-entry'))`),false);record('403_CLEARS_CONTENT_AND_ACTION_ENTRIES');
 await evalJs('window.__detailFailure=0');await click('重新读取');await text('待带入片段（1');assert.equal(receipt.networkMessages.length,0);record('READ_RECOVERY_DOES_NOT_REPLAY_SEND');
 receipt.result='PASS';
}catch(e){receipt.result='FAIL';receipt.error=e.stack;console.error(e);if(evalJs)receipt.lastDom=await evalJs('document.body.innerText').catch(()=>null);}
finally{await fs.writeFile(path.join(out,'ui-probe-receipt.json'),JSON.stringify(receipt,null,2));ws?.close();chrome?.kill('SIGKILL');await host.close();}
if(receipt.result!=='PASS')process.exitCode=1;
