// Real product UI and public HTTP against the root-owned isolated synthetic Host.
import { chromium } from '/Users/bendandebaba/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
const fixture=JSON.parse(await readFile('.local/fourbase-modules/m6/implementation/live/ready.json','utf8'));
const mode=process.env.M6_UI_CASE||'comparison', label=process.env.M6_UI_EVIDENCE||`${mode}-${Date.now()}`;
const base=mode==='existing-targets'?'.local/fourbase-modules/m6/implementation/repair-existing-targets':'.local/fourbase-modules/m6/implementation/ui';
const imageBase=mode==='existing-targets'?base:'output/playwright/m6-product';
assert.equal(new URL(fixture.uiUrl).hostname,'127.0.0.1');
assert(fixture.fixtureRoot.includes('/.local/fourbase-modules/m6/implementation/live/fixture'));
await mkdir(base,{recursive:true}); await mkdir(imageBase,{recursive:true});
const files=['src/host/ui/App.tsx','src/host/ui/PersonalMaterialsPage.tsx','src/host/ui/AgentCandidatesPanel.tsx','src/host/ui/ExperienceComparisonDialog.tsx','src/host/ui/experience-learning-client.ts','src/host/ui/personal-retention-client.ts'];
const sources={};for(const file of files){try{sources[file]=createHash('sha256').update(await readFile(file)).digest('hex');}catch{sources[file]=null;}}
await writeFile(`${base}/${label}-source.json`,JSON.stringify({mode,sources},null,2));
const browser=await chromium.launch({headless:true,executablePath:'/Users/bendandebaba/Library/Caches/ms-playwright/chromium_headless_shell-1212/chrome-headless-shell-mac-arm64/chrome-headless-shell'});
const page=await browser.newPage({viewport:{width:Number(process.env.M6_UI_WIDTH||1440),height:1000},colorScheme:process.env.M6_UI_THEME==='dark'?'dark':'light'});
page.setDefaultTimeout(6000);const errors=[],requests=[],checks=[],consoleErrors=[];
page.on('pageerror',error=>errors.push(error.stack));page.on('console',message=>{if(message.type()==='error')consoleErrors.push(message.text());});page.on('request',request=>{if(request.url().includes('/api/')&&request.method()!=='GET')requests.push({url:request.url(),method:request.method(),body:request.postData()});});
const seed=fixture.author, taskRoute=`/api/projects/${seed.project.id}/tasks/${seed.task.id}`;
async function api(route,method='GET',body){const response=await page.request.fetch(fixture.uiUrl+route,{method,headers:{origin:fixture.uiUrl,'x-optracall-client':'1'},...(body===undefined?{}:{data:body})});assert(response.ok(),`${method} ${route}: ${response.status()} ${await response.text()}`);return response.json();}
try{
 await page.goto(`${fixture.uiUrl}/?project=${seed.project.id}&task=${seed.task.id}`);
 await page.getByRole('textbox',{name:'消息',exact:true}).waitFor();
 if(mode==='existing-targets'){
  const marker='M6目标选择修复', taskBefore=await api(taskRoute);
  let dedicated;
  try{dedicated=JSON.parse(await readFile(`${base}/dedicated-fixture.json`,'utf8'));}
  catch(error){
   if(error.code!=='ENOENT')throw error;
   const fields={title:`${marker} · 已保留标题`,category:'经验',body:'这是专用合成经验的准确已保留正文；新草稿不得改变这个历史版本。',source:'M6选择器单片工程验证',owner:'',scope:'纯合成验证',effectiveTime:'',sourceFileId:null};
   const created=await api('/api/enterprise-materials','POST',fields),materialId=created.material.id;
   const metadata={kind:'experience',aliases:[],caution:'纯合成；不是业务规则。',sourceRefs:[]};
   const meta=await api(`/api/personal-retention/items/${materialId}/draft`,'POST',{expectedRevision:0,metadata});
   const snapshot=await api(`/api/personal-retention/items/${materialId}/editor`);
   const retained=await api(`/api/personal-retention/items/${materialId}/retain`,'POST',{operationId:randomUUID(),expectedRevision:meta.item.revision,target:snapshot.draftTarget,metadata,personalLabel:null});
   const current=await api(`/api/enterprise-materials/${materialId}`);
   const draft=await api(`/api/enterprise-materials/${materialId}`,'PUT',{expectedVersion:current.material.version,...current.material.draft,title:`${marker} · 当前未保留草稿标题`,body:'这是独立未保留草稿，选择更新目标时应以当前编辑器的稳定materialId与当前草稿标题识别。'});
   dedicated={materialId,retainedDecisionId:retained.item.currentDecisionId,retained:retained.content??fields,retainedRevisionId:retained.decision.contentRef.revisionId,initialDraft:draft.material.draft};
   await writeFile(`${base}/dedicated-fixture.json`,JSON.stringify(dedicated,null,2));
  }
  const materialId=dedicated.materialId,current=await api(`/api/enterprise-materials/${materialId}`),retained=await api(`/api/personal-retention/items/${materialId}?decisionId=${dedicated.retainedDecisionId}`);
  const lookupRoute=`/api/personal-retention/lookup?category=experience&includeDrafts=true&includeArchived=false&query=${encodeURIComponent(marker)}&pageSize=50`;
  const lookupBefore=await api(lookupRoute),rows=lookupBefore.items.filter(item=>item.materialId===materialId);
  assert.equal(rows.length,2,'公开lookup必须真实同时有一个material的保留版与不同草稿，不能用mock结果复现');assert.deepEqual(new Set(rows.map(item=>item.personalState)),new Set(['retained','draft']));
  await writeFile(`${base}/${label}-input.json`,JSON.stringify({dedicated,current,retained,lookup:lookupBefore,task:taskBefore},null,2));
  const candidateSeed=JSON.parse(await readFile('.local/fourbase-modules/m6/implementation/live/author-seed.json','utf8')),row=candidateSeed.candidates.rows[0];
  await page.getByRole('button',{name:'个人资料',exact:true}).click();await page.getByRole('button',{name:row.details.content.title,exact:true}).click();
  await page.getByRole('dialog',{name:row.details.content.title,exact:true}).getByRole('button',{name:'整理为个人经验',exact:true}).click();
  const editor=page.getByRole('dialog',{name:'整理为个人经验',exact:true});await editor.getByText('查找其他已有经验',{exact:true}).click();
  await editor.getByRole('textbox',{name:'已有经验关键词',exact:true}).fill(marker);
  const found=page.waitForResponse(response=>response.request().method()==='GET'&&new URL(response.url()).pathname==='/api/personal-retention/lookup'&&new URL(response.url()).searchParams.get('query')===marker);
  await editor.getByRole('button',{name:'查找已有经验',exact:true}).click();await found;
  const select=editor.getByRole('combobox',{name:'保存到哪里',exact:true});
  await page.waitForFunction(({id,title})=>[...document.querySelectorAll('dialog[open] select option')].some(option=>option.value===id&&option.textContent.includes(title)),{id:materialId,title:current.material.draft.title});
  const options=await select.locator('option').evaluateAll(options=>options.map(option=>({value:option.value,label:option.textContent})));
  await writeFile(`${base}/${label}-options.json`,JSON.stringify({options,consoleErrors},null,2));
  assert.equal(options.filter(option=>option.value===materialId).length,1,'每个稳定materialId只能有一个实际更新目标，不能仅换React key');
  assert.equal(options.filter(option=>option.value!=='new').length,new Set(options.filter(option=>option.value!=='new').map(option=>option.value)).size);
  assert.equal(options.find(option=>option.value===materialId).label,`更新已有经验：${current.material.draft.title}`,'目标标签优先真实当前草稿，与读取原editor一致');
  const editorRead=page.waitForResponse(response=>new URL(response.url()).pathname===`/api/personal-retention/items/${materialId}/editor`);
  await select.selectOption(materialId);await editorRead;await page.waitForFunction(id=>[...document.querySelectorAll('dialog[open] select')].some(select=>select.value===id),materialId);assert.equal(await select.inputValue(),materialId);
  assert.equal(await editor.getByRole('textbox',{name:'资料正文 *',exact:true}).inputValue(),row.details.content.bodyMd,'明确更新目标仍保留已准确预填的候选正文，不改用保留版或当前草稿冒充输入');
  const newTitle=`${marker} · 回归保存 ${label}`;await editor.getByRole('textbox',{name:'资料标题 *',exact:true}).fill(newTitle);
  await editor.getByRole('button',{name:'保存草稿',exact:true}).click();await page.waitForFunction(()=>[...document.querySelectorAll('button')].some(button=>button.textContent==='保留这份内容'&&!button.disabled));
  const draftAfter=await api(`/api/enterprise-materials/${materialId}`),itemAfter=await api(`/api/personal-retention/items/${materialId}`),lookupAfter=await api(lookupRoute),oldAfter=await api(`/api/personal-retention/items/${materialId}?decisionId=${dedicated.retainedDecisionId}`),taskAfter=await api(taskRoute);
  assert.equal(draftAfter.material.id,materialId);assert.equal(draftAfter.material.draft.title,newTitle);assert.equal(draftAfter.material.draft.body,row.details.content.bodyMd);assert(draftAfter.material.version>current.material.version);assert.equal(itemAfter.item.currentDecisionId,dedicated.retainedDecisionId);assert.equal(oldAfter.content.body,retained.content.body);assert.equal(oldAfter.decision.contentRef.revisionId,dedicated.retainedRevisionId);
  assert.equal(lookupAfter.items.filter(item=>item.materialId===materialId).length,2,'只合并更新目标选项，原目录保留版/草稿行不得被删');
  const writes=requests.filter(request=>new URL(request.url).pathname===`/api/enterprise-materials/${materialId}`&&request.method==='PUT');assert.equal(writes.length,1);assert.equal(JSON.parse(writes[0].body).expectedVersion,current.material.version);
  assert.equal(taskAfter.task.draft,taskBefore.task.draft);assert.deepEqual(taskAfter.snapshot.messages,taskBefore.snapshot.messages);assert.equal(requests.filter(request=>/\/(messages|open|retain)$/.test(new URL(request.url).pathname)).length,0);
  assert.equal(consoleErrors.filter(message=>/Encountered two children with the same key/.test(message)).length,0,'选项真实去重后不应再产生React重复key告警');
  await writeFile(`${base}/${label}-after.json`,JSON.stringify({draft:draftAfter,item:itemAfter,lookup:lookupAfter,old:oldAfter,task:taskAfter},null,2));
  checks.push('公开HTTP真实构造同material保留版＋不同草稿；实际产品selector每materialId仅一个选项，优先当前草稿标签；选择沿原editor稳定ID与version CAS保存，目录两行/旧revision/currentDecisionId及原task/native均保全，零模型/retain');
 } else if(mode==='comparison-size'){
  const before=(await api('/api/projects')).projects.find(project=>project.id===seed.project.id);await page.getByRole('button',{name:'准备增量验证',exact:true}).click();const dialog=page.getByRole('dialog',{name:'准备增量验证',exact:true});
  await dialog.getByRole('textbox',{name:'共同代表问题',exact:true}).fill('字'.repeat(20000));await dialog.getByRole('button',{name:'只创建这一组任务草稿',exact:true}).click();await dialog.getByRole('alert').filter({hasText:'准备草稿超过原普通任务的20,000字符上限'}).waitFor();
  const after=(await api('/api/projects')).projects.find(project=>project.id===seed.project.id);assert.equal(after.tasks.length,before.tasks.length);assert.equal(await dialog.getByRole('textbox',{name:'共同代表问题',exact:true}).inputValue(),'字'.repeat(20000));checks.push('组装后的真实普通任务草稿上限在创建前校验，输入保持，零create/发送');
 } else if(mode==='comparison-memory'){
  const original=await api(taskRoute),before=(await api('/api/projects')).projects.find(project=>project.id===seed.project.id);
  await page.getByRole('button',{name:'准备增量验证',exact:true}).click();await page.keyboard.press('Escape');
  await page.getByRole('button',{name:'个人资料',exact:true}).click();const candidateSeed=JSON.parse(await readFile('.local/fourbase-modules/m6/implementation/live/author-seed.json','utf8')),row=candidateSeed.candidates.rows[0];
  const candidate=page.getByRole('article').filter({has:page.getByRole('button',{name:row.details.content.title,exact:true})});await candidate.getByRole('button',{name:/^加入当前任务/}).click();
  await page.getByRole('region',{name:'本次指定个人资料',exact:true}).waitFor();await page.getByRole('button',{name:'准备增量验证',exact:true}).click();const dialog=page.getByRole('dialog',{name:'准备增量验证',exact:true});
  await dialog.getByRole('textbox',{name:'共同代表问题',exact:true}).fill('M6仅记忆可选对照：独立分析同一合成事项。');await dialog.getByRole('combobox',{name:'当前准备组',exact:true}).selectOption('memory');
  assert(await dialog.getByRole('button',{name:'只创建这一组任务草稿',exact:true}).isEnabled(),'重新打开后应使用当前任务明确指定的经验，而不是第一次打开时的空缓存');
  await dialog.getByRole('button',{name:'只创建这一组任务草稿',exact:true}).click();await dialog.getByText('已明确保存这一组任务草稿；尚未发送，尚无评估结果。',{exact:true}).waitFor();
  const after=(await api('/api/projects')).projects.find(project=>project.id===seed.project.id),created=after.tasks.filter(task=>!before.tasks.some(old=>old.id===task.id));assert.equal(created.length,1);const actual=await api(`/api/projects/${seed.project.id}/tasks/${created[0].id}`);assert(actual.task.draft.includes('仅记忆'));assert(actual.task.draft.includes(row.ref.expectedDetailsSha256));assert(actual.task.draft.includes(row.details.content.title));assert.equal(actual.snapshot.messages.length,0);const old=await api(taskRoute);assert.equal(old.task.draft,original.task.draft);assert.deepEqual(old.snapshot.messages,original.snapshot.messages);assert.equal(requests.filter(r=>/\/(messages|open)$/.test(new URL(r.url).pathname)).length,0);checks.push('取消初次准备后新指定准确candidate，重新打开使用今天明确选择，单组memory草稿有exact ref且不发模型/改旧task');
 } else if(mode==='layout'){
  await page.getByRole('button',{name:'准备增量验证',exact:true}).click();
  const comparison=page.getByRole('dialog',{name:'准备增量验证',exact:true});await comparison.waitFor();
  const inspect=async(dialog,name)=>{
   const bounds=await dialog.evaluate(element=>({left:element.getBoundingClientRect().left,right:element.getBoundingClientRect().right,width:innerWidth,scroll:element.scrollWidth,client:element.clientWidth}));assert(bounds.left>=-1&&bounds.right<=bounds.width+1,JSON.stringify(bounds));assert(bounds.scroll<=bounds.client+1,`${name} horizontal overflow ${JSON.stringify(bounds)}`);
   let nativeChromeBoundaries=0;
   for(const key of ['Tab','Shift+Tab'])for(let i=0;i<35;i++){
    await page.keyboard.press(key);
    const focus=await dialog.evaluate(element=>({inside:element.contains(document.activeElement),body:document.activeElement===document.body,modal:element.matches(':modal'),active:document.activeElement?.tagName}));
    assert(focus.modal&& (focus.inside||focus.body),`${name} background interactive focus: ${JSON.stringify(focus)}`);
    if(focus.body){nativeChromeBoundaries++;await page.keyboard.press(key);assert(await dialog.evaluate(element=>element.contains(document.activeElement)),`${name} next native navigation did not return to modal`);}
   }
   await dialog.getByRole('button',{name:`关闭${name==='comparison'?'准备增量验证':'整理为个人经验'}`,exact:true}).focus();
   await page.evaluate(()=>document.querySelector('.topbar button')?.focus());
   assert(await dialog.evaluate(element=>element.contains(document.activeElement)),`${name} background button gained programmatic focus despite :modal`);
   checks.push(`${name}: 70次正反Tab无背景具体控件focus，${nativeChromeBoundaries}次BODY属于原生chrome边界且下一Tab回modal；背景focus被native inert阻止`);
   await page.screenshot({path:`${imageBase}/${label}-${name}.png`,fullPage:true});
  };
  await inspect(comparison,'comparison');await page.keyboard.press('Escape');await page.waitForFunction(()=>document.activeElement?.textContent==='准备增量验证');
  if(await page.getByRole('button',{name:'展开侧栏',exact:true}).count())await page.getByRole('button',{name:'展开侧栏',exact:true}).click();
  await page.getByRole('button',{name:'个人资料',exact:true}).click();const candidateSeed=JSON.parse(await readFile('.local/fourbase-modules/m6/implementation/live/author-seed.json','utf8')),row=candidateSeed.candidates.rows[0];await page.getByRole('button',{name:row.details.content.title,exact:true}).click();
  await page.getByRole('dialog',{name:row.details.content.title,exact:true}).getByRole('button',{name:'整理为个人经验',exact:true}).click();const editor=page.getByRole('dialog',{name:'整理为个人经验',exact:true});await inspect(editor,'editor');
  await page.keyboard.press('Escape');await page.waitForFunction(()=>document.activeElement?.textContent==='个人资料');assert.equal(requests.filter(r=>/\/api\/enterprise-materials(?:\/[^/]+)?$/.test(new URL(r.url).pathname)||/\/(draft|retain|controls|messages|open)$/.test(new URL(r.url).pathname)).length,0);
  checks.push('实际comparison/editor在当前宽度主题无dialog水平溢出，native modal阻止背景交互focus；Escape恢复触发器或有效页标题，零副作用');
 } else if(mode==='permissions'){
  const beforeTask=await api(taskRoute), beforeCase=await api(`/api/cases/${seed.case.id}`), beforeProject=await api(`/api/projects/${seed.project.id}`);
  await writeFile(`${base}/${label}-before.json`,JSON.stringify({project:beforeProject,case:beforeCase,task:beforeTask},null,2));
  try{
   await api(`/api/cases/${seed.case.id}/close`,'POST',{operationId:randomUUID(),expectedRevision:beforeCase.case.revision,reason:'M6 F1合成权限验证；不代表业务结束。'});
   await api(`/api/projects/${seed.project.id}/archive`,'POST',{});await page.reload();
   await page.getByText('项目已归档，当前为只读查看。',{exact:true}).waitFor();
   assert(await page.getByRole('button',{name:'准备增量验证',exact:true}).isDisabled());assert.equal(await page.getByRole('textbox',{name:'消息',exact:true}).count(),0);
   await page.getByRole('button',{name:'个人资料',exact:true}).click();
   const candidateSeed=JSON.parse(await readFile('.local/fourbase-modules/m6/implementation/live/author-seed.json','utf8')),row=candidateSeed.candidates.rows[0];
   await page.getByRole('button',{name:row.details.content.title,exact:true}).click();
   await page.getByRole('dialog',{name:row.details.content.title,exact:true}).getByRole('button',{name:'整理为个人经验',exact:true}).click();
   const editor=page.getByRole('dialog',{name:'整理为个人经验',exact:true});const title=`M6 F1独立经验 ${label}`;await editor.getByRole('textbox',{name:'资料标题 *',exact:true}).fill(title);
   await editor.getByRole('button',{name:'保存草稿',exact:true}).click();await page.waitForFunction(()=>[...document.querySelectorAll('button')].some(b=>b.textContent==='保留这份内容'&&!b.disabled));
   await editor.getByRole('button',{name:'保留这份内容',exact:true}).click();await page.getByRole('dialog',{name:'保留这份内容',exact:true}).getByRole('button',{name:'确认保留',exact:true}).click();await page.getByRole('dialog',{name:title,exact:true}).waitFor();
   const afterTask=await api(taskRoute);assert.equal(afterTask.task.draft,beforeTask.task.draft);assert.deepEqual(afterTask.snapshot.messages,beforeTask.snapshot.messages);
   assert.equal(requests.filter(r=>/\/(messages|open)$/.test(new URL(r.url).pathname)).length,0);checks.push('真实project archived + source Case closed限制任务发送/新建，人的全局M3候选整理/新建/保存/保留仍独立成功；原task/native不变');
  }finally{const project=await api(`/api/projects/${seed.project.id}`);if(project.project.archivedAt)await api(`/api/projects/${seed.project.id}/restore`,'POST',{});const current=await api(`/api/cases/${seed.case.id}`);if(current.case.status==='closed')await api(`/api/cases/${seed.case.id}/reopen`,'POST',{operationId:randomUUID(),expectedRevision:current.case.revision,status:beforeCase.case.status});await writeFile(`${base}/${label}-after.json`,JSON.stringify({project:await api(`/api/projects/${seed.project.id}`),case:await api(`/api/cases/${seed.case.id}`),task:await api(taskRoute)},null,2));}
 } else if(mode==='source-governance'){
  const candidateSeed=JSON.parse(await readFile('.local/fourbase-modules/m6/implementation/live/author-seed.json','utf8'));const row=candidateSeed.candidates.rows[0];
  const retainedLog=JSON.parse(await readFile(`${base}/retain-new-first.json`,'utf8'));const retainWrite=retainedLog.requests.find(r=>/\/retain$/.test(new URL(r.url).pathname));const materialId=new URL(retainWrite.url).pathname.split('/')[4];
  const before=await api(`/api/personal-retention/items/${materialId}`);
  try{
   await api('/api/personal-retention/candidates/controls','POST',{operationId:randomUUID(),target:row.ref,action:'correct',note:'新的合成反例：需求波动尚未解释；不撤回独立保留正文。'});
   let current=await api('/api/personal-retention/candidates/read','POST',{ref:row.ref});
   await api('/api/personal-retention/candidates/controls','POST',{operationId:randomUUID(),target:row.ref,action:'exclude',note:null,expectedTargetRevision:current.control.targetRevision});
   const evidence=await api('/api/personal-retention/sources/read','POST',{ref:{type:'agent-candidate',candidate:row.ref}});assert.equal(evidence.status,'excluded');assert.equal(evidence.text,row.details.content.bodyMd);
   await page.getByRole('button',{name:'个人资料',exact:true}).click();await page.getByRole('button',{name:before.content.title,exact:true}).click();
   const detail=page.getByRole('dialog',{name:before.content.title,exact:true});await detail.waitFor();
   const source=detail.locator('.pr-source-card').filter({has:page.getByText('准确 Agent 候选',{exact:true})});
   await source.getByText('已排除 · 不再新供给',{exact:true}).waitFor();
   assert((await source.innerText()).includes('新的合成反例：需求波动尚未解释'));assert((await detail.innerText()).includes(before.content.body));
   await source.getByRole('button',{name:'阅读准确原文',exact:true}).click();
   const original=page.getByRole('dialog',{name:row.details.content.title,exact:true});await original.getByText('已排除 · 不再新供给',{exact:true}).waitFor();assert((await original.innerText()).includes(row.details.content.bodyMd));
   const after=await api(`/api/personal-retention/items/${materialId}`);assert.equal(after.item.currentDecisionId,before.item.currentDecisionId);assert.equal(after.content.body,before.content.body);
   checks.push('source当前纠正/排除真实展示，人的原件仍可读；独立M3正文/currentDecisionId不级联改写');
  }finally{const latest=await api('/api/personal-retention/candidates/read','POST',{ref:row.ref});if(latest.control.excluded)await api('/api/personal-retention/candidates/controls','POST',{operationId:randomUUID(),target:row.ref,action:'restore',note:null,expectedTargetRevision:latest.control.targetRevision});}
 } else if(['prefill','retain-new','retain-update','create-unknown','metadata-unknown','retain-unknown','conflict'].includes(mode)){
  const candidateSeed=JSON.parse(await readFile('.local/fourbase-modules/m6/implementation/live/author-seed.json','utf8'));
  const row=candidateSeed.candidates.rows[0];
  await page.getByRole('button',{name:'个人资料',exact:true}).click();
  await page.getByRole('button',{name:row.details.content.title,exact:true}).click();
  const candidate=page.getByRole('dialog',{name:row.details.content.title,exact:true});await candidate.waitFor();
  await candidate.getByRole('button',{name:'整理为个人经验',exact:true}).click();
  const editor=page.getByRole('dialog',{name:'整理为个人经验',exact:true});await editor.waitFor();
  assert.equal(await editor.getByRole('combobox',{name:'保存到哪里',exact:true}).inputValue(),'new');
  assert.equal(await editor.getByRole('textbox',{name:'资料标题 *',exact:true}).inputValue(),row.details.content.title);
  assert.equal(await editor.getByRole('textbox',{name:'资料正文 *',exact:true}).inputValue(),row.details.content.bodyMd);
  assert.equal(await editor.getByRole('textbox',{name:'适用范围',exact:true}).inputValue(),row.details.content.scope);
  assert.equal(await editor.getByRole('textbox',{name:'适用提醒',exact:true}).inputValue(),row.details.content.caution);
  assert.equal(await editor.getByRole('combobox',{name:'整理为',exact:true}).inputValue(),'experience');
  assert((await editor.innerText()).includes('准确 Agent 候选'));
  assert((await editor.locator('pre').allTextContents()).join('\n').includes(row.ref.expectedDetailsSha256));
  assert((await editor.locator('pre').allTextContents()).join('\n').includes(row.details.sourceRefs[0].revisionId));
  assert.equal(requests.filter(r=>/\/api\/enterprise-materials(?:\/[^/]+)?$/.test(new URL(r.url).pathname)||/\/(draft|retain|controls|messages)$/.test(new URL(r.url).pathname)).length,0);
  checks.push('准确candidate重新读取后预填原M3编辑器；默认新建、复制body/scope/caution/aliases及原来源+exact candidateRef；零副作用');
  if(mode!=='prefill'){
   const updating=mode==='retain-update'||mode==='conflict', original=await api(`/api/personal-retention/items/${candidateSeed.retained.materialId}`);
   if(updating) await editor.getByRole('combobox',{name:'保存到哪里',exact:true}).selectOption(candidateSeed.retained.materialId);
   const title=`M6 ${mode} ${label}`, body=`${row.details.content.bodyMd}\n${title}：保留反例、首次失败和未知。`;
   await editor.getByRole('textbox',{name:'资料标题 *',exact:true}).fill(title);
   await editor.getByRole('textbox',{name:'资料正文 *',exact:true}).fill(body);
   if(mode==='conflict'){
    const current=await api(`/api/enterprise-materials/${candidateSeed.retained.materialId}`);
    await api(`/api/enterprise-materials/${candidateSeed.retained.materialId}`,'PUT',{expectedVersion:current.material.version,...current.material.draft,body:'另一窗口已明确保存的新草稿；不能被旧CAS静默覆盖。'});
   }
   const lost=mode==='create-unknown'?'/api/enterprise-materials':mode==='metadata-unknown'?'/api/personal-retention/items/*/draft':mode==='retain-unknown'?'/api/personal-retention/items/*/retain':null;
   if(lost) await page.route(`**${lost}`,async route=>{const response=await route.fetch();assert(response.ok(),`Lost ACK fixture must actually commit: ${response.status()} ${await response.text()}`);await route.abort('failed');});
   const createResponse=!updating?page.waitForResponse(response=>new URL(response.url()).pathname==='/api/enterprise-materials'&&response.request().method()==='POST').catch(()=>null):null;
   await editor.getByRole('button',{name:'保存草稿',exact:true}).click();
   if(mode==='create-unknown'){
    await editor.getByRole('status').filter({hasText:'没有可核定的新资料 ID'}).waitFor();
    assert(await editor.getByRole('button',{name:'保存草稿',exact:true}).isDisabled());assert(await editor.getByRole('button',{name:'保留这份内容',exact:true}).isDisabled());
    assert.equal(await editor.getByRole('button',{name:'回查原操作',exact:true}).count(),0);assert.equal(await editor.getByRole('textbox',{name:'资料正文 *',exact:true}).inputValue(),body);
    await page.keyboard.press('Escape');await page.getByRole('button',{name:'继续编辑草稿',exact:true}).click();assert(await editor.getByRole('button',{name:'保存草稿',exact:true}).isDisabled());
    assert.equal(requests.filter(request=>new URL(request.url).pathname==='/api/enterprise-materials'&&request.method==='POST').length,1);
    checks.push('真实create提交后ACK丢失：输入保留、无ID不造retain op、不再次create，关闭再开仍锁定');
   } else if(mode==='conflict'){
    await editor.getByRole('status').filter({hasText:'正文保存失败'}).waitFor();assert.equal(await editor.getByRole('textbox',{name:'资料正文 *',exact:true}).inputValue(),body);
    await editor.getByRole('button',{name:'回查正文与个人草稿信息',exact:true}).click();
    assert.equal(await editor.getByRole('textbox',{name:'资料正文 *',exact:true}).inputValue(),body);
    const current=await api(`/api/enterprise-materials/${candidateSeed.retained.materialId}`);assert.equal(current.material.draft.body,'另一窗口已明确保存的新草稿；不能被旧CAS静默覆盖。');
    checks.push('真实Enterprise version CAS冲突拒写，输入保持且可明确回查，不自动覆盖另一窗口');
   } else {
    let materialId=updating?candidateSeed.retained.materialId:null;
    if(!materialId){const response=await createResponse;assert(response);materialId=(await response.json()).material.id;}
    if(mode==='metadata-unknown'){
     await editor.getByRole('status').filter({hasText:'正文已保存／精确修订保持，但个人草稿信息未核定成功'}).waitFor();assert(await editor.getByRole('button',{name:'保留这份内容',exact:true}).isDisabled());
     const known=await api(`/api/enterprise-materials/${materialId}`);assert.equal(known.material.draft.body,body);
     await editor.getByRole('button',{name:'回查正文与个人草稿信息',exact:true}).click();await editor.getByRole('status').filter({hasText:'回查确认正文与个人草稿信息均已保存'}).waitFor();
     assert(await editor.getByRole('button',{name:'保留这份内容',exact:true}).isEnabled());assert.equal(requests.filter(r=>/\/retain$/.test(new URL(r.url).pathname)).length,0);
     checks.push('正文实存、metadata真实提交ACK丢失分开显示；精确回查后才开放保留，零自动重放');
    } else {
     await editor.getByRole('button',{name:'保留这份内容',exact:true}).waitFor();await page.waitForFunction(()=>[...document.querySelectorAll('button')].some(button=>button.textContent==='保留这份内容'&&!button.disabled));
     const draft=await api(`/api/personal-retention/items/${materialId}`);assert.equal(draft.item.currentDecisionId,updating?original.item.currentDecisionId:null);
     assert.deepEqual(draft.item.draftMeta.sourceRefs,[...row.details.sourceRefs,{type:'agent-candidate',candidate:row.ref}]);
     await editor.getByRole('button',{name:'保留这份内容',exact:true}).click();await page.getByRole('dialog',{name:'保留这份内容',exact:true}).getByRole('button',{name:'确认保留',exact:true}).click();
     if(mode==='retain-unknown'){
      await editor.getByRole('status').filter({hasText:'保留未能核定成功，原请求已保持'}).waitFor();
      const pending=editor.getByRole('region',{name:'待核对保留操作',exact:true});await pending.waitFor();
      const originalWrite=requests.find(r=>/\/retain$/.test(new URL(r.url).pathname));const originalInput=JSON.parse(originalWrite.body);
      await pending.getByRole('button',{name:'回查原操作',exact:true}).click();
      await page.getByText('同操作已成功，回读原决定；没有改写后来的当前指针。',{exact:true}).first().waitFor();
      const committed=await api(`/api/personal-retention/items/${materialId}`);assert.equal(committed.item.currentDecisionId,originalInput.operationId);assert.equal(requests.filter(r=>/\/retain$/.test(new URL(r.url).pathname)).length,1);
      checks.push('retain真实提交丢ACK：原operation/载荷保持，只GET原结果核定，不换ID不再create/retain');
     } else {
      await page.getByRole('dialog',{name:title,exact:true}).waitFor();const retained=await api(`/api/personal-retention/items/${materialId}`);assert(retained.item.currentDecisionId);assert.equal(retained.content.body,body);
      if(updating){assert.notEqual(retained.item.currentDecisionId,original.item.currentDecisionId);const old=await api(`/api/personal-retention/items/${materialId}?decisionId=${original.item.currentDecisionId}`);assert.equal(old.content.body,original.content.body);assert.notEqual(old.decision.contentRef.revisionId,retained.decision.contentRef.revisionId);}
      checks.push(updating?'明确已有experience目标沿同material追加revision/decision，保存未改currentDecisionId，保留后新旧准确正文并存':'新建正文→metadata→明确retain真实分段成功，预填不先写，保留准确正文与新来源');
     }
    }
   }
  }

 } else if(mode==='comparison'||mode==='comparison-create-unknown'||mode==='comparison-repeat'){
  const original=await api(taskRoute), projectsBefore=(await api('/api/projects')).projects;
  await page.getByRole('button',{name:'准备增量验证',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'准备增量验证',exact:true});await dialog.waitFor();
  await dialog.getByRole('textbox',{name:'共同代表问题',exact:true}).fill('判断合成补货事项中的真实约束，并说明反证与未知。');
  await dialog.getByRole('textbox',{name:'共同材料与版本（可选）',exact:true}).fill('020_clean/synthetic-input.md，固定第1稿；各组保持相同。');
  await dialog.getByRole('combobox',{name:'当前准备组',exact:true}).selectOption('method');
  assert(await dialog.getByRole('button',{name:'只创建这一组任务草稿',exact:true}).isDisabled());
  await dialog.getByText('没有选定的方法候选，本组未运行；不会为凑组数创建或安装方法。',{exact:true}).waitFor();
  await dialog.getByRole('combobox',{name:'当前准备组',exact:true}).selectOption('baseline');
  if(mode==='comparison-create-unknown') await page.route(`**/api/projects/${seed.project.id}/tasks`,async route=>{if(route.request().method()==='POST'){const response=await route.fetch();assert(response.ok());await route.abort('failed');}else await route.continue();});
  await dialog.getByRole('button',{name:'只创建这一组任务草稿',exact:true}).click();
  if(mode==='comparison-create-unknown'){
   await dialog.getByRole('alert').filter({hasText:'创建任务结果 UNKNOWN，尚无准确任务 ID。'}).waitFor();
   assert(await dialog.getByRole('button',{name:'只创建这一组任务草稿',exact:true}).isDisabled());
   await page.keyboard.press('Escape');await page.getByRole('button',{name:'准备增量验证',exact:true}).click();
   assert(await dialog.getByRole('button',{name:'只创建这一组任务草稿',exact:true}).isDisabled());
   assert.equal(await dialog.getByRole('button',{name:'回查已创建任务',exact:true}).count(),0);
  } else await dialog.getByText('已明确保存这一组任务草稿；尚未发送，尚无评估结果。',{exact:true}).waitFor();
  const projectsAfter=(await api('/api/projects')).projects, before=projectsBefore.find(p=>p.id===seed.project.id), after=projectsAfter.find(p=>p.id===seed.project.id);
  const created=after.tasks.filter(t=>!before.tasks.some(old=>old.id===t.id));assert.equal(created.length,1);
  const fresh=await api(`/api/projects/${seed.project.id}/tasks/${created[0].id}`), old=await api(taskRoute);
  assert.equal(old.task.draft,original.task.draft);assert.deepEqual(old.snapshot.messages,original.snapshot.messages);
  if(mode!=='comparison-create-unknown'){assert(fresh.task.draft.includes('判断合成补货事项中的真实约束'));assert(fresh.task.draft.includes('020_clean/synthetic-input.md'));assert(fresh.task.draft.includes('现有基线'));assert(fresh.task.draft.includes('不可归因'));assert(fresh.task.draft.includes('成本未知'));}
  assert.equal(fresh.snapshot.messages.length,0);assert.equal(requests.filter(r=>/\/(messages|open)$/.test(new URL(r.url).pathname)).length,0);
  if(mode==='comparison-repeat'){await dialog.getByRole('button',{name:'准备另一组',exact:true}).click();assert.equal(await dialog.getByRole('textbox',{name:'共同代表问题',exact:true}).inputValue(),'判断合成补货事项中的真实约束，并说明反证与未知。');assert.equal(await dialog.getByRole('textbox',{name:'共同材料与版本（可选）',exact:true}).inputValue(),'020_clean/synthetic-input.md，固定第1稿；各组保持相同。');assert(await dialog.getByRole('button',{name:'只创建这一组任务草稿',exact:true}).isEnabled());}
  checks.push('当前所选基线单组创建普通task及共同草稿，原task draft/messages保持；方法缺候选明确未运行；零send/open');
 }
 assert.equal(errors.length,0,errors.join('\n'));await page.screenshot({path:`${imageBase}/${label}.png`,fullPage:true});
 await writeFile(`${base}/${label}.json`,JSON.stringify({mode,status:'PASS',checks,errors,consoleErrors,requests},null,2));
}catch(error){await page.screenshot({path:`${imageBase}/${label}-failure.png`,fullPage:true}).catch(()=>{});await writeFile(`${base}/${label}.json`,JSON.stringify({mode,status:'FAIL',checks,errors,consoleErrors,requests,error:error.stack},null,2));throw error;}finally{await browser.close();}
