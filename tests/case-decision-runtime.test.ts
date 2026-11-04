import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { ProjectAgent, type ProjectAgentOptions } from '../src/agent/project-runtime.ts';
import { startToolProvider } from './fixtures/tool-provider.ts';

async function fixture(t: TestContext) {
  const root=path.resolve('.local/fourbase-modules/m5/implementation/runtime',randomUUID()),projectDirectory=path.join(root,'project');
  for(const name of ['010_draw','020_clean','060_reports']) await mkdir(path.join(projectDirectory,name),{recursive:true});
  const provider=await startToolProvider();t.after(()=>provider.close());
  const options={projectId:randomUUID(),taskId:randomUUID(),projectDirectory,sessionDirectory:path.join(root,'native'),resourceRoot:path.join(root,'pi'),codeRoot:process.cwd(),managementPorts:[],configuration:{id:'m5-synthetic',revision:1,name:'M5合成',provider:'synthetic',model:'synthetic',api:'openai-completions' as const,apiKey:'synthetic-m5-only',baseUrl:provider.baseUrl}};
  const agents:ProjectAgent[]=[];t.after(async()=>{for(const a of agents)await a.close();});
  return {root,options,provider,create:(extra:Partial<ProjectAgentOptions>={})=>{const a=new ProjectAgent({...options,...extra});agents.push(a);return a;}};
}

test('M5 CD01/08 real Pi seam: same ordinary prompt can save a Case draft directly or nested; actual tool origin and native are distinct', {timeout:60_000},async t=>{
  for(const nested of [false,true])await t.test(nested?'nested':'direct',async t=>{
    const f=await fixture(t),calls:any[]=[];
    const input={kind:'hypothesis',expectedRevision:0,payload:{title:'缺货原因待核',statement:'可能是执行路径不清，仍需核对。'}};
    const callback=async(action:string,value:Record<string,unknown>,context:{signal:AbortSignal;requestId:string;sessionId:string;toolCallId:string})=>{calls.push({action,value,requestId:context.requestId,sessionId:context.sessionId,toolCallId:context.toolCallId});assert.equal(context.signal.aborted,false);return {content:[{type:'text' as const,text:'Case business revision saved: SYNTHETIC_CASE_DRAFT_V1; Agent draft, unverified.'}],details:{schemaVersion:1,type:'optracall.case-decision-result',action}};};
    const agent=f.create({caseDecisions:callback});
    f.provider.setResponder(({recentToolResults})=>recentToolResults.length?{text:'合成回答，保留未知。'}:{calls:[{name:nested?'codemode':'save_case_decision_draft',arguments:nested?{code:`const r=await tools.save_case_decision_draft(${JSON.stringify(input)}); text(r);`}:input}]});
    const opened=await agent.open();
    assert.ok(opened.tools.includes('save_case_decision_draft'),'ordinary callback must expose the approved narrow Case draft capability through Pi');
    assert.ok(opened.tools.includes('read_case_decisions'));
    const requestId=randomUUID(),run=agent.start('合成Case问题；自主选择是否形成草案。',requestId,undefined,{case:{operationId:randomUUID()}});
    await run.accepted;assert.equal((await run.completion).outcome,'completed');assert.equal(calls.length,1);assert.equal(calls[0].action,'save');assert.deepEqual(calls[0].value,input);assert.equal(calls[0].requestId,requestId);assert.equal(calls[0].sessionId,opened.sessionId);assert.ok(calls[0].toolCallId);
    const saved=await agent.snapshot();const native=(await readFile(saved.sessionFile!,'utf8')).trim().split('\n').map(line=>JSON.parse(line));
    const direct=native.filter(e=>e.message?.role==='toolResult'&&e.message.toolName==='save_case_decision_draft');assert.equal(direct.length,nested?0:1);
    assert.ok(JSON.stringify(f.provider.requests.at(-1)?.body.messages).includes('SYNTHETIC_CASE_DRAFT_V1'));
    if(nested)assert.ok(native.some(e=>e.message?.toolName==='codemode'&&e.message.nestedCalls?.calls.some((c:any)=>c.name==='save_case_decision_draft')));
  });
});

test('M5 CD08 scope regression: unbound and zero-tool prompts stay ordinary; protected/plugin resources gain no Case tools',async t=>{
  const f=await fixture(t);let calls=0;
  const caseDecisions=async()=>{calls++;return {content:[{type:'text' as const,text:'not available without Case'}],details:{}};};
  const agent=f.create({caseDecisions});
  f.provider.setResponder(({recentToolResults})=>recentToolResults.length?{text:'普通回答。'}:{calls:[{name:'read_case_decisions',arguments:{}}]});
  assert.equal((await agent.start('无Case普通分析，无需建Case。',randomUUID()).completion).outcome,'completed');assert.equal(calls,0);
  const ordinaryWorkspace={cwd:path.join(f.options.projectDirectory,'020_clean'),systemPrompt:['Synthetic plugin.']};
  for(const extra of [{taskId:undefined},{workspace:ordinaryWorkspace},{workspace:{...ordinaryWorkspace,capabilityPolicy:'text-only' as const}},{protectedExecution:{id:randomUUID(),profile:'ordinary' as const,cwd:ordinaryWorkspace.cwd,writableRoot:ordinaryWorkspace.cwd,readRoots:[]}}]){
    const a=f.create({...extra,caseDecisions,sessionDirectory:path.join(f.root,randomUUID())});assert.ok(!(await a.open()).tools.includes('save_case_decision_draft'));
  }
  f.provider.setResponder(()=>({text:'零记录正常回答。'}));
  assert.equal((await agent.start('有Case也可零条草案。',randomUUID(),undefined,{case:{operationId:randomUUID()}}).completion).outcome,'completed');assert.equal(calls,0);
});

test('M5 CD07 scope regression: stop revokes the actual deferred Host call before a late save, without replay',async t=>{
  const f=await fixture(t);let entered!:()=>void,release!:()=>void,lateDenied=false,commits=0;
  const waiting=new Promise<void>(resolve=>{entered=resolve;});
  const agent=f.create({caseDecisions:async(_action,_input,ctx)=>{entered();await new Promise<void>(resolve=>{release=resolve;});try{ctx.assertCurrent();}catch{lateDenied=true;throw new Error('case_decision_run_unavailable');}commits++;return {content:[{type:'text',text:'LATE_COMMIT_SHOULD_NOT_APPEAR'}],details:{}};}});
  f.provider.setResponder(({recentToolResults})=>recentToolResults.length?{text:'完成'}:{calls:[{name:'save_case_decision_draft',arguments:{kind:'hypothesis',expectedRevision:0,payload:{title:'待核',statement:'合成未提交'}}}]});
  const run=agent.start('取消前合成问题',randomUUID(),undefined,{case:{operationId:randomUUID()}});await waiting;
  const stopping=agent.stop();await new Promise(resolve=>setTimeout(resolve,20));release();await stopping;assert.equal((await run.completion).outcome,'cancelled');assert.equal(commits,0);assert.equal(lateDenied,true);
  const snapshot=await agent.snapshot();assert.ok(!(await readFile(snapshot.sessionFile!,'utf8')).includes('LATE_COMMIT_SHOULD_NOT_APPEAR'));
});

test('M5 CD08 reused Pi qualification: completed caller ctx cannot save on the next run; current legal nested remains available',async t=>{
  const f=await fixture(t),extensions=path.join(f.options.resourceRoot,'extensions');await mkdir(extensions,{recursive:true});
  const input={kind:'hypothesis',expectedRevision:0,payload:{title:'合成新判断',statement:'仍然未核实。'}};
  await writeFile(path.join(extensions,'case-ctx.ts'),`export default pi=>{const parameters={type:'object',properties:{},additionalProperties:false};pi.registerTool({name:'capture_case_ctx',label:'Capture',description:'Synthetic',parameters,execute:async(_id,_args,_signal,_update,ctx)=>{globalThis.__m5ctx=ctx;return{content:[{type:'text',text:'captured'}],details:{}};}});pi.registerTool({name:'reuse_case_ctx',label:'Reuse',description:'Synthetic',parameters,execute:async(_id,_args,signal)=>{const r=await globalThis.__m5ctx.executeTool('save_case_decision_draft',${JSON.stringify(input)},{signal});return{content:[{type:'text',text:JSON.stringify(r)}],details:{}};}});};`);
  let step=0,calls=0;
  f.provider.setResponder(()=>{const planned=[{calls:[{name:'capture_case_ctx',arguments:{}}]},{text:'capture done'},{calls:[{name:'reuse_case_ctx',arguments:{}}]},{text:'replay rejected'},{calls:[{name:'codemode',arguments:{code:`const r=await tools.save_case_decision_draft(${JSON.stringify(input)});text(r);`}}]},{text:'current saved'}];return planned[step++]??{text:'end'};});
  const agent=f.create({caseDecisions:async()=>{calls++;return{content:[{type:'text',text:'CURRENT_CASE_SAVE'}],details:{}};}}),provided={case:{operationId:randomUUID()}};
  const opened=await agent.open();for(let i=0;i<2;i++)assert.equal((await agent.start('合成运行'+i,randomUUID(),undefined,provided).completion).outcome,'completed');assert.equal(calls,0);assert.equal((await agent.snapshot()).sessionId,opened.sessionId);
  assert.equal((await agent.start('当前合法nested',randomUUID(),undefined,provided).completion).outcome,'completed');assert.equal(calls,1);
});
