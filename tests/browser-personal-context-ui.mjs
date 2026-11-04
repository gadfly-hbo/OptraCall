import { chromium } from '/Users/bendandebaba/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
const mode = process.env.M4_UI_CASE || 'quick-add';
const uiOrigin = process.env.M4_UI_ORIGIN || 'http://127.0.0.1:4193';
assert.equal(new URL(uiOrigin).hostname,'127.0.0.1');
const label = process.env.M4_UI_EVIDENCE || mode;
const evidence = '.local/fourbase-modules/m4/implementation/ui';
await mkdir(evidence, { recursive: true });
const files = ['App.tsx','PersonalMaterialsPage.tsx','AgentCandidatesPanel.tsx','ProjectSpace.tsx','runtime-client.ts','PersonalContextControls.tsx'];
const hashes = {};
for (const file of files) { try { hashes[file] = createHash('sha256').update(await readFile('src/host/ui/'+file)).digest('hex'); } catch {} }
await writeFile(`${evidence}/${label}-source.json`,JSON.stringify({mode,hashes},null,2));
const browser = await chromium.launch({headless:true, executablePath:'/Users/bendandebaba/Library/Caches/ms-playwright/chromium_headless_shell-1212/chrome-headless-shell-mac-arm64/chrome-headless-shell'});
const page = await browser.newPage({ viewport:{width:Number(process.env.M4_UI_WIDTH||1440),height:1000},colorScheme:process.env.M4_UI_THEME==='dark'?'dark':'light' });
page.setDefaultTimeout(6000);
const errors=[]; page.on('pageerror',e=>errors.push(e.stack));
try {
await page.addInitScript(({mode}) => {
 const config={id:'synthetic-model',name:'合成配置',provider:'openai-compatible',baseUrl:'http://127.0.0.1:1',model:'synthetic',hasApiKey:true};
 const task=(id)=>({id,name:'同名任务',draft:id==='task-current'?'保留原问题草稿':'另一任务问题',configuration:config,createdAt:'2026-11-03T00:00:00Z',updatedAt:'2026-11-03T00:00:00Z',sessionStorage:'task'});
 const projects=[{schemaVersion:2,id:'project-current',name:'同名项目',configuration:config,rootPath:'/synthetic/current',createdAt:'2026-11-03T00:00:00Z',updatedAt:'2026-11-03T00:00:00Z',archivedAt:null,tasks:[task('task-current')]},{schemaVersion:2,id:'project-other',name:'同名项目',configuration:config,rootPath:'/synthetic/other',createdAt:'2026-11-03T00:00:00Z',updatedAt:'2026-11-03T00:00:00Z',archivedAt:null,tasks:[task('task-other')]},{schemaVersion:2,id:'project-archived',name:'归档项目',configuration:config,rootPath:'/synthetic/archived',createdAt:'2026-11-03T00:00:00Z',updatedAt:'2026-11-03T00:00:00Z',archivedAt:'2026-11-03T00:00:00Z',tasks:[task('task-archived')]}];
 const row={id:'personal-material',decisionId:'decision-old',bodySha256:'a'.repeat(64),category:'knowledge',title:'准确旧资料',aliases:[],scope:'合成范围',bodyPreview:'准确旧正文',bodyTruncated:false,personalState:'retained',status:'disabled',materialId:'material-old',contentRef:{storeId:'store-exact',materialId:'material-old',revisionId:'revision-old'},caution:null,sourceRefs:[],sourceIssues:[],sources:[],matches:[]};
 const decision={operationId:'decision-old',action:'retain',bodySha256:'a'.repeat(64),contentRef:row.contentRef,metadata:{kind:'knowledge',aliases:[],caution:null,sourceRefs:[]},request:{target:{type:'revision',revisionId:'revision-old',expectedBodySha256:'a'.repeat(64)}}};
 const detail={item:{materialId:'material-old',archived:false,decisions:[decision],draftMeta:decision.metadata,terminations:[],revision:1},decision,content:{title:row.title,body:'准确旧正文',scope:'合成范围',effectiveTime:'',bodySha256:'a'.repeat(64),revisionId:'revision-old'},materialState:{materialId:'material-old',enabled:false}};
 const candidate={ref:{projectId:'original-project',taskId:'original-task',originSessionId:'original-session',entryId:'candidate-entry',toolCallId:'candidate-call',expectedDetailsSha256:'b'.repeat(64)},status:'available',control:null,parentState:'completed',locations:[],details:{createdAt:'2026-11-03T00:00:00Z',origin:{projectId:'original-project',taskId:'original-task'},content:{title:'未收藏准确候选',kind:'knowledge',bodyMd:'准确候选原文',scope:'合成范围',aliases:[],caution:null},sourceRefs:[]}};
 window.__m4={messages:[],requests:[],drafts:[],mode};
 const actual=window.fetch.bind(window);
 window.fetch=async(input,init={})=>{
  const url=new URL(typeof input==='string'?input:input.url,location.href); if(!url.pathname.startsWith('/api/'))return actual(input,init);
  const path=url.pathname, method=init.method||'GET', body=init.body?JSON.parse(init.body):null;
  window.__m4.requests.push({path,method,body});
  const json=(value,status=200)=>Promise.resolve(new Response(JSON.stringify(value),{status,headers:{'content-type':'application/json'}}));
  if(path==='/api/configurations')return json({configurations:[config],selectedId:config.id});
  if(path==='/api/enterprise-materials')return json({materials:[]});
  if(path==='/api/projects')return json({projects});
  if(path.endsWith('/files'))return json({files:[]});
  if(path==='/api/personal-retention/lookup')return json({items:[row],total:1,page:1,pageSize:20,complete:true,issues:[]});
  if(path==='/api/personal-retention/candidates/read')return json(candidate);
  if(path==='/api/personal-retention/candidates/lookup')return json({rows:mode==='candidate'?[candidate]:[],partial:false,issues:[],controlsAvailable:true,nextCursor:null});
  if(path==='/api/personal-retention/items/material-old')return json(mode==='exact'&&!url.searchParams.has('decisionId')?{...detail,decision:{...decision,operationId:'decision-new',contentRef:{...row.contentRef,revisionId:'revision-new'},bodySha256:'c'.repeat(64)},content:{...detail.content,body:'后来新正文'}}:detail);
  const match=path.match(/^\/api\/projects\/([^/]+)\/tasks\/([^/]+)(.*)$/);
  if(match){ const project=projects.find(p=>p.id===match[1]),task=project.tasks.find(t=>t.id===match[2]);const snapshot={sessionId:task.id,messages:[],tools:[],status:'idle',sdkVersion:'synthetic',uiRequests:[]};
   if(match[3]==='/events')return new Response(new ReadableStream({start(controller){controller.enqueue(new TextEncoder().encode('data: '+JSON.stringify({type:'snapshot',snapshot})+'\n\n'));}}),{headers:{'content-type':'text/event-stream'}});
   if(match[3]==='/draft'){task.draft=body.text;window.__m4.drafts.push(body.text);return json({});}
   if(match[3]==='/messages'){window.__m4.messages.push(body);if(mode==='permissions')return json({message:'当前权限不允许',code:'permission_denied',accepted:false,unavailablePersonalContext:[0]},403);if(mode==='ackunknown'||(mode==='ackretry'||mode==='ackreadback')&&window.__m4.messages.length===1)throw new TypeError('synthetic acknowledgement lost');if(mode==='failure'&&window.__m4.messages.length===1)return json({message:'准确旧资料已失读',code:'PERSONAL_CONTEXT_UNAVAILABLE',accepted:false,unavailablePersonalContext:[0]},409);return json({accepted:true},202);}
   if(match[3]==='/personal-context')return json({entries:mode==='history'?[{sessionId:'saved-session',entryId:'saved-read',action:'read',evidence:'recorded',text:'当时准确原文\n当时最新纠正：金额单位为元',details:{schemaVersion:1,type:'optracall.personal-context-delivery',action:'read',items:[{target:{type:'retained',storeId:'store-exact',materialId:'material-old',decisionId:'decision-old',revisionId:'revision-old',expectedBodySha256:'a'.repeat(64)},part:'content',extent:'fragment',range:{start:0,end:6},title:'当时资料标题',scope:'旧范围',effectiveTime:null,caution:'旧局限',governance:{archived:false,enterpriseEnabled:false,sourceProjectArchived:false,targetRevision:1,latestCorrectionOperationId:'then-correction'},limitations:['片段']}],partial:false,continuation:null,issues:[]},current:[{target:{type:'retained'},state:'excluded',issue:'今天已排除'}]},{sessionId:'saved-session',entryId:'parent-only',action:'nested',evidence:'nested-unknown',text:null,details:null,current:[]}]:[],issues:[],partial:false});
   if(mode==='ackreadback'&&window.__m4.messages.length>0&&!match[3]) { window.__m4.readbackCount=(window.__m4.readbackCount||0)+1;if(window.__m4.readbackCount>1)task.lastRun={id:window.__m4.messages[0].requestId,status:'completed'}; }
   return json({project,task,snapshot});
  }
  return json({materials:[],records:[],chains:[],citations:[],entries:[],issues:[]});
 };
},{mode});
await page.goto(`${uiOrigin}/?project=project-current&task=task-current`);
await page.getByRole('textbox',{name:'消息',exact:true}).waitFor();
await page.waitForFunction(()=>!document.querySelector('.send-button')?.disabled);
assert.equal(await page.getByRole('textbox',{name:'消息',exact:true}).inputValue(),'保留原问题草稿');
if(mode==='history') {
 await page.getByRole('button',{name:/查看当时提供/}).click();
 const history=page.getByRole('dialog',{name:'当时提供的个人资料',exact:true});
 await history.waitFor();
 assert((await history.locator('pre').first().innerText()).includes('当时准确原文\n当时最新纠正：金额单位为元'));
 assert((await history.innerText()).includes('今天已排除'));
 assert((await history.innerText()).includes('准确片段'));
 await page.keyboard.press('Escape');
 await page.waitForFunction(()=>document.activeElement?.textContent==='查看当时提供');
 await page.getByRole('button',{name:/查看嵌套记录/}).click();
 const nested=page.getByRole('dialog',{name:'嵌套读取记录',exact:true});await nested.waitFor();
 assert((await nested.innerText()).includes('子正文未单独记录'));assert.equal(await nested.locator('pre').count(),0);
 assert.equal((await page.evaluate(()=>window.__m4)).messages.length,0);
} else if(mode==='normal') {
 await page.getByRole('button',{name:'发送消息',exact:true}).click();
 await page.waitForFunction(()=>window.__m4.messages.length===1);
 const state=await page.evaluate(()=>window.__m4); assert.equal(state.messages[0].text,'保留原问题草稿'); assert.equal(state.messages[0].personalContext,undefined); assert.equal(state.requests.filter(x=>x.path.includes('personal-retention')).length,0);
} else {
 const expand=page.getByRole('button',{name:'展开侧栏',exact:true});if(await expand.isVisible())await expand.click();
 await page.getByRole('button',{name:'个人资料',exact:true}).click();
 const result=page.getByRole('article').filter({has:page.getByRole('button',{name:mode==='candidate'?'未收藏准确候选':'准确旧资料',exact:true})});
 await result.waitFor();
 await result.scrollIntoViewIfNeeded();
 assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Personal results fit viewport before choosing');
 await page.screenshot({path:`output/playwright/m4-implementation/${label}-list.png`,fullPage:true});
 const add=result.getByRole('button',{name:/加入当前任务/});
 assert.equal(await add.count(),1,'RU05 actual list must provide one-click add to the exact current task');
 if(mode==='target') {
   await result.getByRole('button',{name:'选择其他任务',exact:true}).click();
   const picker=page.getByRole('dialog',{name:'选择准确任务',exact:true});
   await picker.waitFor();
   assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Exact target picker fits viewport');
   const buttons=picker.getByRole('button',{name:/同名任务/}).filter({hasNotText:'task-arc'});
   assert.equal(await buttons.count(),2);
   assert.equal(await picker.getByRole('button',{name:/task-arc/}).isDisabled(),true);
   await picker.getByRole('button',{name:/task-oth/}).click();
   await page.getByRole('textbox',{name:'消息',exact:true}).waitFor();
   assert.equal(await page.getByRole('textbox',{name:'消息',exact:true}).inputValue(),'另一任务问题');
   assert.equal(new URL(page.url()).searchParams.get('task'),'task-other');
   assert.equal((await page.evaluate(()=>window.__m4)).messages.length,0);
   await page.getByRole('button',{name:'发送消息',exact:true}).click();
   await page.waitForFunction(()=>window.__m4.messages.length===1);
 } else {
 await add.click();
 await page.getByRole('textbox',{name:'消息',exact:true}).waitFor();
 assert.equal(await page.getByRole('textbox',{name:'消息',exact:true}).inputValue(),'保留原问题草稿');
 let state=await page.evaluate(()=>window.__m4); assert.equal(state.messages.length,0); assert.equal(state.drafts.length,0);
 const chosen=page.getByRole('region',{name:'本次指定个人资料',exact:true}); await chosen.waitFor();
 if(mode==='range') {
   await chosen.getByText('准确身份与范围',{exact:true}).click();
   await chosen.getByLabel('片段起点（UTF-16）',{exact:true}).fill('1');
   await chosen.getByLabel('片段终点（不含）',{exact:true}).fill('5');
   await chosen.getByRole('button',{name:'应用片段范围',exact:true}).click();
   assert((await chosen.innerText()).includes('准确片段 [1, 5)'));
 }
 if(mode==='permissions'||mode==='ackunknown'||mode==='ackretry'||mode==='ackreadback') {
   await page.getByRole('button',{name:'发送消息',exact:true}).click();
   await page.getByRole('alert').filter({hasText:mode==='permissions'?'当前权限不允许':'发送状态尚未确认'}).waitFor();
   assert.equal(await page.getByRole('button',{name:'移除不可用资料并发送',exact:true}).count(),0);
   if(mode==='ackunknown'||mode==='ackretry'||mode==='ackreadback') {
     const message=page.getByRole('textbox',{name:'消息',exact:true});
     if(await message.isEditable())await message.fill('保留原问题草稿');
     const send=page.getByRole('button',{name:'发送消息',exact:true});
     if(await send.isEnabled())await send.click();
     await new Promise(resolve=>setTimeout(resolve,50));
     const sent=await page.evaluate(()=>window.__m4.messages);
     assert.equal(sent.length,1,'UNKNOWN second click must not create a new requestId');
     assert.equal(await message.inputValue(),'保留原问题草稿');
     await page.locator('.harness-panel summary').click();
     assert.equal(await page.getByRole('button',{name:'/tools',exact:true}).isDisabled(),true,'Command shortcuts must not overwrite the locked original question');
     assert.equal(await chosen.getByRole('button',{name:'移除指定资料 准确旧资料',exact:true}).isDisabled(),true);
     await page.getByRole('button',{name:'核对此次发送',exact:true}).click();
     assert.equal((await page.evaluate(()=>window.__m4)).messages.length,1,'Readback is GET only');
     if(mode==='ackreadback') {await page.getByRole('button',{name:'核对此次发送',exact:true}).waitFor({state:'detached'});assert.equal(await message.inputValue(),'');}
     if(mode==='ackretry') {await page.getByRole('button',{name:'按原请求重试此次发送',exact:true}).click();await page.waitForFunction(()=>window.__m4.messages.length===2);const sent=await page.evaluate(()=>window.__m4.messages);assert.deepEqual(sent[1],sent[0],'Explicit retry retains original request ID and whole payload');}
   }
   assert.equal((await page.evaluate(()=>window.__m4)).messages.length,mode==='ackretry'?2:1);
   assert.equal(await chosen.getByText('准确旧资料',{exact:true}).count(),1);
 } else if(mode==='failure') {
   await page.getByRole('button',{name:'发送消息',exact:true}).click();
   await page.getByRole('button',{name:'移除不可用资料并发送',exact:true}).waitFor();
   assert.equal(await page.getByRole('textbox',{name:'消息',exact:true}).inputValue(),'保留原问题草稿');
   assert.equal(await chosen.getByText('准确旧资料',{exact:true}).count(),1);
   await page.getByRole('button',{name:'移除不可用资料并发送',exact:true}).click();
   await page.waitForFunction(()=>window.__m4.messages.length===2);
   state=await page.evaluate(()=>window.__m4); assert.equal(state.messages[1].text,'保留原问题草稿'); assert.equal(state.messages[1].personalContext,undefined);
 } else {
  await page.getByRole('button',{name:'发送消息',exact:true}).click();await page.waitForFunction(()=>window.__m4.messages.length===1);
  state=await page.evaluate(()=>window.__m4);if(mode==='candidate') assert.deepEqual(state.messages[0].personalContext,[{target:{type:'agent-candidate',candidate:{projectId:'original-project',taskId:'original-task',originSessionId:'original-session',entryId:'candidate-entry',toolCallId:'candidate-call',expectedDetailsSha256:'b'.repeat(64)}}}]);
  else assert.deepEqual(state.messages[0].personalContext,[{...(mode==='range'?{range:{start:1,end:5}}:{}),target:{type:'retained',storeId:'store-exact',materialId:'material-old',decisionId:'decision-old',revisionId:'revision-old',expectedBodySha256:'a'.repeat(64)}}]);
 }
}
}
assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Product UI must fit the viewport without document overflow');
assert.deepEqual(errors,[]);
await page.screenshot({path:`output/playwright/m4-implementation/${label}.png`,fullPage:true});
await writeFile(`${evidence}/${label}.json`,JSON.stringify({result:'PASS',mode,errors},null,2));
console.log('PASS '+mode);
} catch(error) {
 await page.screenshot({path:`output/playwright/m4-implementation/${label}.png`,fullPage:true}).catch(()=>{});
 await writeFile(`${evidence}/${label}.json`,JSON.stringify({result:'FAIL',mode,error:error.message,errors},null,2));
 console.error(error);process.exitCode=1;
} finally{await browser.close();}
