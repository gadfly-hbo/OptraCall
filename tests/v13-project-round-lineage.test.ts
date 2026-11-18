import test from 'node:test';
import assert from 'node:assert/strict';
import {copyFile,mkdir,readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {verifyConfirmedRounds} from './fixtures/pm-case-rounds.ts';
import {providerMessageText} from './fixtures/tool-provider.ts';

test('ordinary receivers requalify actual Do authorizations and Teach Plan originals from both current and historical Pi material', {timeout:120000},async t=>{
  let after:()=>Promise<void>;
  await verifyConfirmedRounds(t,async({host,provider,receipt,root})=>{
    const project=String(receipt.work),base='/api/projects/'+project+'/tasks',issue={caseId:receipt.caseId,issueId:receipt.issueId};
    const plan=receipt.plan as {taskId:string;messageId:string;expectedTextSha256:string};
    const teach=receipt.teach as {taskId:string};
    async function api(route:string,method='GET',input?:unknown,status=200){const r=await host.request(route,method,input),data=await r.json();assert.equal(r.status,status,JSON.stringify({route,data}));return data;}
    const consumers:Record<string,string>={},sources:Record<string,{file:string;bytes:Buffer;historical:string}>={};
    const evidence=path.join(root,'synthetic-format-compatibility');await mkdir(evidence);
    for(const [kind,id] of [['do',String(receipt.doId)],['teach',teach.taskId]] as const){
      const sourceRoute=base+'/'+id, state=await api(sourceRoute),file=state.task.sessionFile;
      const bytes=await readFile(file), entries=bytes.toString().trim().split('\n').map(l=>JSON.parse(l));
      const run=entries.find(e=>e.customType==='optracall.run' && e.data.phase==='started'&&e.data.providedContext.taskAssignment.type===kind);
      const original=run.data.providedContext;const rights=original[kind+'SourceRights'],refs=original[kind+'Sources'];
      assert.equal(original.taskRoundReceiptVersion,1);assert.ok(rights.includes(kind==='do'?(receipt.authorization as {authorizationId:string}).authorizationId:receipt.feedbackId));
      assert.ok(refs.some((r:{messageId:string;sha256:string})=>r.messageId===plan.messageId&&r.sha256===plan.expectedTextSha256));
      await copyFile(file,path.join(evidence,kind+'-original.jsonl'));
      for(const row of entries){if(row.customType==='optracall.run'&&row.data?.providedContext){const p=row.data.providedContext;delete p.taskRoundReceiptVersion;delete p[kind+'Sources'];delete p[kind+'SourceRights'];}}
      const historical=entries.map(r=>JSON.stringify(r)).join('\n')+'\n';
      sources[kind]={file,bytes,historical};
      const found=(await api(sourceRoute+'/results')).details.results.find((r:{kind:string})=>r.kind==='native-reply');
      assert.ok(found);
      const {task}=await api(base,'POST',{name:kind+'原件的独立收件任务',operationId:randomUUID(),assignment:{type:'analysis',skill:null,issue,sources:[{taskId:id,key:found.id}]}},201);
      const target=base+'/'+task.id;consumers[kind]=target;
      provider.setResponder(turn=>turn.recentToolResults.length?{text:kind+'原件已读取。'}:{calls:[{name:'read_project_task_results',arguments:{action:'read',id:found.id}}]});
      const requestId=randomUUID();await api(target+'/messages','POST',{requestId,text:'打开准确交付并复核'},202);
      for(let i=0;i<280;i++){const v=await api(target);if(v.task.lastRun?.status==='completed')break;await delay(30);}
      assert.ok(provider.requests.at(-1)!.body.messages?.some(m=>m.role==='tool'&&providerMessageText(m.content).includes(found.messageId)));
      assert.equal((await api(target)).task.lastRun.status,'completed');
      // Only this newly generated test ledger is varied. Keep its exact original bytes alongside it.
      await writeFile(file,historical);
      assert.equal((await api(target)).task.lastRun.status,'completed');
      const altered=historical.split('\n').filter(Boolean).map(line=>JSON.parse(line));
      for(const e of altered)if(e.data?.providedContext?.taskAssignment?.type===kind)e.data.providedContext.requestTextSha256='0'.repeat(64);
      await writeFile(file,altered.map(e=>JSON.stringify(e)).join('\n')+'\n');
      const unknown=await host.request(target);assert.ok([403,409].includes(unknown.status),await unknown.text());
      await writeFile(file,bytes);
    }
    const count=provider.requests.length;
    after=async()=>{
      for(const legacy of [false,true]){
        for(const value of Object.values(sources))await writeFile(value.file,legacy?value.historical:value.bytes);
        const denied=await host.request(consumers.do!);assert.ok([403,409].includes(denied.status),await denied.text());
        assert.equal((await api(consumers.teach!)).task.lastRun.status,'completed');
      }
      await api(base+'/'+plan.taskId+'/archive','POST',{});
      for(const legacy of [false,true]){
        const source=sources.teach!;await writeFile(source.file,legacy?source.historical:source.bytes);
        const denied=await host.request(consumers.teach!);assert.ok([403,409].includes(denied.status),await denied.text());
      }
      for(const value of Object.values(sources))await writeFile(value.file,value.bytes);
      assert.ok(provider.requests.length>=count);
    };
  });
  await after!();
});
