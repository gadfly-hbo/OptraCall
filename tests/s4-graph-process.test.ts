import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runSemanticGraphProcess } from '../src/host/semantic-graph-process.ts';

async function fixture(body: string) {
  const root = await mkdtemp(join(tmpdir(), 'optracall-s4-process-'));
  await mkdir(join(root, 'scripts/fourbase_l2'), { recursive: true });
  await writeFile(join(root, 'scripts/fourbase_l2/__init__.py'), '');
  await writeFile(join(root, 'scripts/fourbase_l2/worker.py'), body);
  return { root, binding: { python: '/usr/bin/python3', codeRoot: root, runRoot: root, snapshotId: 'fixture' } };
}
const normal = `import sys,json,os\nrequest=json.loads(sys.stdin.readline())\nprint(json.dumps({'type':'authority','id':1,'refs':[]}),flush=True)\na=json.loads(sys.stdin.readline())\nprint(json.dumps({'type':'result','result':{'answer':42,'pid':os.getpid()}}),flush=True)\nsys.stdin.readline()\n`;

test('finite trusted Python job proxies authority then resolves only after actual exit', async () => {
  const f = await fixture(normal); const cleanups: ((o: {retryFailed?:boolean})=>Promise<void>)[] = [];
  try {
    const result = await runSemanticGraphProcess<{answer:number;pid:number}>({ binding: f.binding, query: { action: 'graph', operation: 'find', query: 'retail' },
      signal: new AbortController().signal, assertCurrent() {}, checkMany: async () => [], registerCleanup: (fn: (o:{retryFailed?:boolean})=>Promise<void>) => cleanups.push(fn) });
    assert.equal(result.answer,42);assert.equal(live(result.pid),false); assert.equal(cleanups.length, 1); await cleanups[0]!({});
  } finally { await rm(f.root, { recursive: true, force: true }); }
});

const tree = `import os,sys,json,subprocess\np=subprocess.Popen([sys.executable,'-c','import signal,time;signal.signal(signal.SIGTERM,signal.SIG_IGN);time.sleep(90)'])\nprint(json.dumps({'type':'authority','id':1,'refs':[{'pid':os.getpid(),'childPid':p.pid}]}),flush=True)\nsys.stdin.readline()\nimport time\ntime.sleep(90)\n`;
function live(pid: number) { try { process.kill(pid, 0); return true; } catch { return false; } }
async function eventuallyStopped(pid: number) {
  const { execFileSync } = await import('node:child_process');
  for (let attempt = 0; attempt < 60; attempt++) {
    if (!live(pid)) return;
    try { if (execFileSync('/bin/ps', ['-p', String(pid), '-o', 'stat='], { encoding: 'utf8' }).trim().startsWith('Z')) return; } catch { return; }
    await new Promise(resolve => setTimeout(resolve, 15));
  }
  assert.fail('owned process remains live');
}
test('cancel reaps the actual Python leader and intentional TERM-ignoring descendant', async () => {
  const f = await fixture(tree); const cancel = new AbortController(); let observed!: (p: {pid:number;childPid:number}) => void;
  const started = new Promise<{pid:number;childPid:number}>(resolve => { observed = resolve; });
  try {
    const running = runSemanticGraphProcess({ binding:f.binding, query:{}, signal:cancel.signal, assertCurrent() {}, checkMany:async refs => {
      observed(refs[0] as {pid:number;childPid:number}); return [{state:'available',gaps:[]}];
    } });
    const pids = await started; assert.equal(live(pids.pid), true); assert.equal(live(pids.childPid), true);
    cancel.abort(new Error('synthetic cancel')); await assert.rejects(running, /synthetic cancel/);
    await eventuallyStopped(pids.pid); await eventuallyStopped(pids.childPid);
  } finally { await rm(f.root, { recursive:true, force:true }); }
});
test('failed cleanup stays failed until explicit retry and does not replay the query', async () => {
  const f = await fixture(tree); const cancel = new AbortController(); let cleanup!: (o:{retryFailed?:boolean})=>Promise<void>;
  let started!: ()=>void; const ready = new Promise<void>(resolve => { started=resolve; }); let leader=0; let descendant=0; let attempts=0; let queries=0;
  try {
    const running = runSemanticGraphProcess({ binding:f.binding, query:{}, signal:cancel.signal, assertCurrent() {},
      registerCleanup:fn=> {cleanup=fn;}, signalGroup:(pid,signal)=> {attempts++; if(attempts===1) throw new Error('synthetic denied kill'); process.kill(-pid,signal);},
      checkMany:async refs=> {queries++; const ids=refs[0] as {pid:number;childPid:number}; leader=ids.pid;descendant=ids.childPid;started();return [{state:'available',gaps:[]}];} });
    await ready; cancel.abort(); await assert.rejects(running,/semantic_graph_cleanup_failed/); assert.equal(live(leader),true);
    await assert.rejects(cleanup({}),/semantic_graph_cleanup_failed/); assert.equal(attempts,1);
    await cleanup({retryFailed:true}); assert.equal(attempts,2); assert.equal(queries,1); await eventuallyStopped(leader); await eventuallyStopped(descendant);
    await cleanup({retryFailed:true}); assert.equal(attempts,2);
  } finally { if(live(leader)) { try {process.kill(-leader,'SIGKILL');} catch {} } await rm(f.root,{recursive:true,force:true}); }
});

test('unexpected leader exit cannot claim cleanup while an inherited-group child lives with closed stdio', async()=>{
  const script=`import os,sys,json,subprocess\np=subprocess.Popen([sys.executable,'-c','import os,time;os.close(0);os.close(1);os.close(2);time.sleep(90)'])\nprint(json.dumps({'type':'authority','id':1,'refs':[{'pid':os.getpid(),'childPid':p.pid}]}),flush=True)\nsys.stdin.readline()\nos._exit(9)\n`;
  const f=await fixture(script);let childPid=0;let cleanup!:(o:{retryFailed?:boolean})=>Promise<void>;let signals=0;
  try {
    await assert.rejects(runSemanticGraphProcess({binding:f.binding,query:{},signal:new AbortController().signal,assertCurrent(){},registerCleanup:fn=>{cleanup=fn;},signalGroup:(pid,signal)=>{signals++;process.kill(-pid,signal);},checkMany:async refs=>{childPid=(refs[0] as {childPid:number}).childPid;return[{state:'available',gaps:[]}];}}),/semantic_graph_cleanup_unknown/);
    assert.equal(live(childPid),true);assert.equal(signals,0);await assert.rejects(cleanup({retryFailed:true}),/semantic_graph_cleanup_unknown/);assert.equal(signals,0);
  }finally{if(childPid&&live(childPid)){try{process.kill(childPid,'SIGKILL');}catch{}}await rm(f.root,{recursive:true,force:true});}
});

test('cancellation only reaps its matching owned job while a parallel owner keeps running',async()=>{
  const f=await fixture(tree);const firstCancel=new AbortController();const secondCancel=new AbortController();let firstStart!:(ids:{pid:number;childPid:number})=>void;let secondStart!:(ids:{pid:number;childPid:number})=>void;
  const firstReady=new Promise<{pid:number;childPid:number}>(resolve=>{firstStart=resolve;});const secondReady=new Promise<{pid:number;childPid:number}>(resolve=>{secondStart=resolve;});
  const start=(signal:AbortSignal,ready:(ids:{pid:number;childPid:number})=>void)=>runSemanticGraphProcess({binding:f.binding,query:{},signal,assertCurrent(){},checkMany:async refs=>{ready(refs[0] as {pid:number;childPid:number});return[{state:'available',gaps:[]}];}});
  const first=start(firstCancel.signal,firstStart);const second=start(secondCancel.signal,secondStart);void first.catch(()=>{});void second.catch(()=>{});
  try{const [a,b]=await Promise.all([firstReady,secondReady]);firstCancel.abort();await assert.rejects(first);await eventuallyStopped(a.pid);await eventuallyStopped(a.childPid);assert.equal(live(b.pid),true);assert.equal(live(b.childPid),true);secondCancel.abort();await assert.rejects(second);await eventuallyStopped(b.pid);await eventuallyStopped(b.childPid);}
  finally{firstCancel.abort();secondCancel.abort();await Promise.allSettled([first,second]);await rm(f.root,{recursive:true,force:true});}
});

test('cancellation drains an already-started Host authority read before the job promise settles',async()=>{
  const f=await fixture(normal);const controller=new AbortController();let started!:()=>void;let release!:()=>void;const ready=new Promise<void>(resolve=>{started=resolve;});const gate=new Promise<void>(resolve=>{release=resolve;});let settled=false;
  const running=runSemanticGraphProcess({binding:f.binding,query:{},signal:controller.signal,assertCurrent(){},checkMany:async()=>{started();await gate;return[];}});void running.finally(()=>{settled=true;}).catch(()=>{});
  try{await ready;controller.abort(new Error('cancel authority'));await new Promise(resolve=>setTimeout(resolve,20));assert.equal(settled,false);release();await assert.rejects(running,/cancel authority/);}
  finally{release();await running.catch(()=>{});await rm(f.root,{recursive:true,force:true});}
});
