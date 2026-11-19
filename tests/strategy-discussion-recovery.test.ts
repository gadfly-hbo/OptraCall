import test from 'node:test';import assert from 'node:assert/strict';import {mkdtemp} from 'node:fs/promises';import os from 'node:os';import path from 'node:path';import {randomUUID} from 'node:crypto';
import {createStrategyDiscussionHost} from '../src/host/strategy-discussion-host.ts';import {StrategyGoalsStore} from '../src/host/strategy-goals-store.ts';
test('v1.2 pre-dispatch failure preserves the only original input across Host reopen and is not a native receipt',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'v12-undispatched-'));let allowed=true;
 const config={id:'synthetic',name:'synthetic',revision:1,provider:'openai-compatible',api:'openai-completions' as const,baseUrl:'http://127.0.0.1:1/v1',model:'synthetic',apiKey:'synthetic-only'};
 const options={dataRoot:root,codeRoot:process.cwd(),goals:new StrategyGoalsStore(root),configuration:()=>allowed?config:null,defaultUsageContext:async()=>{allowed=false;return null;},mutate:async<T>(fn:()=>T|Promise<T>)=>fn(),isClosing:()=>false,validateGoal:()=>{}};
 const host=createStrategyDiscussionHost(options),owner=await host.create({operationId:randomUUID()});const requestId=randomUUID(),text='唯一原始输入，尚未派发，不得清掉。';
 await assert.rejects(host.send(owner.id,{requestId,text,expectedRevision:owner.revision}));
 const detail=await host.detail(owner.id);assert.equal(detail.snapshot.messages.length,0);assert.equal(detail.requestReceipt,undefined);assert.equal(detail.discussion.pendingInput?.text,text);await host.closeAll();
 const reopened=createStrategyDiscussionHost(options);assert.equal((await reopened.detail(owner.id)).discussion.pendingInput?.requestId,requestId);assert.equal((await reopened.detail(owner.id)).discussion.pendingInput?.text,text);await reopened.closeAll();
});

test('v1.2 unknown acknowledgment after terminal persistence remains UNKNOWN while native completion is preserved',{timeout:30000},async t=>{
 const {startToolProvider}=await import('./fixtures/tool-provider.ts');const provider=await startToolProvider();t.after(()=>provider.close());
 const root=await mkdtemp(path.join(os.tmpdir(),'v12-terminal-unknown-'));const config={id:'synthetic',name:'synthetic',revision:1,provider:'openai-compatible',api:'openai-completions' as const,baseUrl:provider.baseUrl,model:'synthetic',apiKey:'synthetic-only'};
 let feature:ReturnType<typeof createStrategyDiscussionHost>,id='',injected=false;
 feature=createStrategyDiscussionHost({dataRoot:root,codeRoot:process.cwd(),goals:new StrategyGoalsStore(root),configuration:()=>config,defaultUsageContext:async()=>null,isClosing:()=>false,validateGoal:()=>{},mutate:async<T>(fn:()=>T|Promise<T>)=>{const result=await fn();if(id&&!injected&&feature.store.get(id).lastRun?.status==='completed'){injected=true;throw Object.assign(new Error('terminal acknowledgment unknown'),{code:'strategy_discussion_write_unknown'});}return result;}});
 t.after(()=>feature.closeAll());provider.setResponder(()=>({text:'正常完成的原生回复保留。'}));const owner=await feature.create({operationId:randomUUID()});id=owner.id;
 await feature.send(id,{requestId:randomUUID(),text:'检查原结果，不证明专业收益。',expectedRevision:owner.revision});
 let detail;for(let n=0;n<200;n++){detail=await feature.detail(id);if(!detail.busy&&detail.discussion.lastRun?.status==='unknown')break;await new Promise(resolve=>setTimeout(resolve,20));}
 assert.equal(injected,true);assert.equal(detail!.discussion.lastRun?.status,'unknown');assert.ok(detail!.requestReceipt);assert.equal(provider.requests.length,1);
 const {readFile}=await import('node:fs/promises');const entries=(await readFile(detail!.snapshot.sessionFile!,'utf8')).trim().split('\n').map(line=>JSON.parse(line));assert.ok(entries.some(e=>e.customType==='optracall.run'&&e.data.phase==='settled'&&e.data.outcome==='completed'));
});

test('a role finishing during source checks returns its newly verified reply with completed status', async t => {
 const root=await mkdtemp(path.join(os.tmpdir(),'v13-completed-role-'));
 const {mkdir,rm}=await import('node:fs/promises'), {syntheticNativeHistory}=await import('./fixtures/synthetic-native-history.ts');
 const config={id:'synthetic',name:'合成',revision:1,provider:'openai-compatible',api:'openai-completions' as const,baseUrl:'http://127.0.0.1:1/v1',model:'synthetic',apiKey:'synthetic-only'};
 let settle:(()=>void)|undefined, checked=0;
 const host=createStrategyDiscussionHost({dataRoot:root,codeRoot:process.cwd(),goals:new StrategyGoalsStore(root),configuration:()=>config,defaultUsageContext:async()=>null,mutate:async<T>(fn:()=>T|Promise<T>)=>fn(),isClosing:()=>false,validateGoal:()=>{},
  roleContext:async()=>{checked++;if(settle){const finish=settle;settle=undefined;finish();}return {};}});
 t.after(async()=>{await host.closeAll();await rm(root,{recursive:true,force:true});});
 const id=randomUUID(),requestId=randomUUID(), role={role:'goal-draft' as const,draftId:randomUUID(),scope:{kind:'personal' as const,id:'self',name:'合成'}};
 host.store.create({operationId:id},config,role);
 await mkdir(host.store.nativeDirectory(id),{recursive:true});await mkdir(host.store.workspace(id),{recursive:true});
 const ledger=syntheticNativeHistory(host.store.nativeDirectory(id),host.store.workspace(id));
 ledger.message('user','原问题');ledger.message('assistant','上一轮');ledger.message('user','新问题');
 const before=host.store.get(id);before.sessionFile=ledger.file;before.lastRun={id:requestId,fingerprint:'synthetic',status:'accepted'};host.store.write(before);
 settle=()=>{ledger.message('assistant','本轮最终回答');const done=host.store.get(id);done.lastRun!.status='completed';host.store.write(done);};
 const result=await host.detail(id,undefined,true);
 assert.equal(result.discussion.lastRun?.status,'completed');assert.equal(result.discussion.revision,before.revision);
 assert.equal(checked,2);
 const last=result.snapshot.messages.at(-1)!;assert.equal(last.role,'assistant');assert.match(JSON.stringify(last.content),/本轮最终回答/);
});
