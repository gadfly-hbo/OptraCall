import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { ProjectAgent, type ProjectAgentOptions } from '../src/agent/project-runtime.ts';
import { startToolProvider, providerMessageText } from './fixtures/tool-provider.ts';

test('v1.2 strategy discussion uses the official Pi native history and only its narrow tool across restart', {timeout:45000}, async t => {
  const root=await mkdtemp(path.join(os.tmpdir(),'v12-discussion-runtime-'));
  const provider=await startToolProvider();
  const cwd=path.join(root,'workspace');await mkdir(cwd,{recursive:true});
  let calls=0;
  const options={projectId:'strategy-discussion:'+randomUUID(),workspace:{cwd,systemPrompt:['Discuss strategy. Use the narrow strategy tool only when appropriate.'],capabilityPolicy:'strategy-discussion'},sessionDirectory:path.join(root,'native'),resourceRoot:path.join(root,'resources'),codeRoot:process.cwd(),managementPorts:[],configuration:{id:'synthetic',name:'Synthetic',revision:1,provider:'openai-compatible',api:'openai-completions',baseUrl:provider.baseUrl,model:'synthetic-strategy',apiKey:'synthetic-strategy-only'},strategyDiscussion:async(action:string,_input:unknown,context:any)=>{context.assertCurrent();assert.equal(action,'read-goals');calls++;return {content:[{type:'text',text:'EXACT_GOAL_V1'}],details:{claim:'provided-not-adopted'}};}} as unknown as ProjectAgentOptions;
  const agents:ProjectAgent[]=[];t.after(async()=>{for(const a of agents)await a.close();await provider.close();});
  provider.setResponder(ctx=>ctx.recentToolResults.length?{text:'Candidate remains unadopted.'}:{calls:[{name:'strategy_goals',arguments:{action:'read-goals'}}]});
  const first=new ProjectAgent(options);agents.push(first);const opened=await first.open();
  assert.deepEqual(opened.tools,['strategy_goals'],'no inherited execution, MCP, or ordinary business tools');
  const done=await first.start('FIRST_STRATEGY_REQUEST',randomUUID(),undefined,{userQuoteEligible:true,originalUserText:'FIRST_STRATEGY_REQUEST'}).completion;
  assert.equal(done.outcome,'completed');assert.equal(calls,1);
  const original=await readFile(opened.sessionFile!);await first.close();
  const next=new ProjectAgent({...options,sessionFile:opened.sessionFile});agents.push(next);await next.open();
  provider.setResponder(ctx=>{assert.ok(ctx.messages.some(x=>providerMessageText(x.content).includes('FIRST_STRATEGY_REQUEST')));return {text:'Continued without changing the goal.'};});
  assert.equal((await next.start('SECOND_STRATEGY_REQUEST',randomUUID()).completion).outcome,'completed');
  assert.deepEqual((await readFile(opened.sessionFile!)).subarray(0,original.length),original);
  assert.deepEqual(provider.errors,[]);t.diagnostic(root);
});
