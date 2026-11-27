// Deterministic VM only: no product imports, SDK, Host, Provider, sockets or timers.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import vm from 'node:vm';
import {stripTypeScriptTypes} from 'node:module';
const base='a4c563f0632280010e7e12906c69fa6664cffd13';
const waitPath='tests/workspace-daily-pi-loop.test.ts',nativePath='tests/analysis-delivery-native-v020.test.ts';
const oldWaitText=execFileSync('git',['show',`${base}:${waitPath}`],{encoding:'utf8'}),newWaitText=await fs.readFile(waitPath,'utf8'),nativeText=await fs.readFile(nativePath,'utf8');
const rows=[];
function declaration(source,name,kind='function'){
 const start=source.indexOf(kind==='function'?`async function ${name}(`:`const ${name} = async`);assert.ok(start>=0,name);
 const first=source.indexOf('{',start);let depth=1,end=first+1;
 for(;end<source.length&&depth;end++){if(source[end]==='{')depth++;else if(source[end]==='}')depth--;}
 assert.equal(depth,0);const found=source.slice(start,end)+(kind==='variable'?';':'');
 return stripTypeScriptTypes(found,{mode:'strip'});
}
const waitOld=declaration(oldWaitText,'waitForRoleIdle'),waitNew=declaration(newWaitText,'waitForRoleIdle');
async function exerciseWait(code,views,old=false){
 let index=0,clock=0;const host={request:async()=>structuredClone(views[Math.min(index++,views.length-1)])};
 const sandbox={assert,readJson:async value=>value,Date:{now:()=>clock},setTimeout(fn,ms){clock+=ms;fn();}};
 vm.createContext(sandbox);vm.runInContext(code+';globalThis.call=waitForRoleIdle;',sandbox);
 try{const value=await (old?sandbox.call(host,'owner'):sandbox.call(host,'owner','request-current'));return{status:'returned',reads:index,clock,value};}
 catch(error){return{status:'rejected',reads:index,clock,error:error.message};}
}
const progress={busy:true,discussion:{lastRun:{id:'request-current',status:'accepted'}},snapshot:{messages:[{role:'assistant',content:[{type:'toolCall',name:'strategy_goals'}]}]}};
const completedBusy={busy:true,discussion:{lastRun:{id:'request-current',status:'completed'}},snapshot:{messages:[{role:'assistant'}]}};
const done={...completedBusy,busy:false};
let r=await exerciseWait(waitOld,[progress,done],true);assert.equal(r.status,'returned');assert.equal(r.reads,1);assert.equal(r.value.busy,true);rows.push({case:'old helper wrongly accepts first assistant tool-progress',expected:'RED reproduced',status:'PASS',reads:r.reads});
r=await exerciseWait(waitNew,[progress,completedBusy,done]);assert.equal(r.status,'returned');assert.equal(r.reads,3);rows.push({case:'new helper waits for exact completed request and !busy',status:'PASS',reads:r.reads});
r=await exerciseWait(waitNew,[{...done,discussion:{lastRun:{id:'wrong-request',status:'completed'}}},done]);assert.equal(r.status,'returned');assert.equal(r.reads,2);rows.push({case:'wrong completed request is not accepted',status:'PASS',reads:r.reads});
r=await exerciseWait(waitNew,[{...done,discussion:{lastRun:{id:'wrong-request',status:'completed'}}}]);assert.equal(r.status,'rejected');assert.equal(r.clock,20000);rows.push({case:'only wrong request reaches original 20s deadline without success',status:'PASS',simulatedMs:r.clock});
for(const status of ['failed','cancelled','unknown']){r=await exerciseWait(waitNew,[{...done,discussion:{lastRun:{id:'request-current',status}}}]);assert.equal(r.status,'rejected');assert.equal(r.reads,1);assert.equal(r.clock,0);rows.push({case:`exact ${status} fails immediately`,status:'PASS'});}
const nativeCode=declaration(nativeText,'readState','variable')+declaration(nativeText,'pollRead','variable');
const valid='{"type":"session"}\n{"type":"custom","data":"complete"}\n',partial='{"type":"session"}\n{"type":"custom","data":"partial';
const state={project:{id:'project'},task:{sessionFile:'synthetic-native.jsonl',lastRun:{status:'completed'}},snapshot:{status:'idle'}};
function nativeHarness({bodies=[state],statuses=[200],bytes=[valid],httpJsonError,readError}={}){
 let call=0,read=0;const sandbox={assert,route:'/exact-owner',host:{request:async()=>{const i=call++;return{status:statuses[Math.min(i,statuses.length-1)],json:async()=>{if(httpJsonError)throw httpJsonError;return structuredClone(bodies[Math.min(i,bodies.length-1)]);}};}},readFile:async()=>{if(readError)throw readError;return bytes[Math.min(read++,bytes.length-1)];}};
 vm.createContext(sandbox);vm.runInContext('let unavailableSnapshotReads=0;'+nativeCode+';globalThis.api={pollRead,readState,count:()=>unavailableSnapshotReads};',sandbox);
 return{...sandbox.api,reads:()=>read,calls:()=>call};
}
let h=nativeHarness({bytes:[partial,valid]});assert.equal(await h.pollRead(),undefined);assert.equal(h.count(),1);const full=await h.pollRead();assert.equal(full.native.length,2);rows.push({case:'one raw partial prefix is unavailable; later complete bytes required',status:'PASS',unavailable:h.count(),nativeEntries:full.native.length});
for(const code of ['session_history_unavailable','native_snapshot_incomplete']){h=nativeHarness({statuses:[409],bodies:[{code}]});assert.equal(await h.pollRead(),undefined);assert.equal(h.reads(),0);rows.push({case:`only explicit 409/${code} is unavailable`,status:'PASS'});}
h=nativeHarness({httpJsonError:new SyntaxError('HTTP body malformed')});await assert.rejects(h.pollRead(),/HTTP body malformed/);rows.push({case:'HTTP JSON SyntaxError is not swallowed',status:'PASS'});
h=nativeHarness({statuses:[409],bodies:[{code:'forbidden'}]});await assert.rejects(h.pollRead());rows.push({case:'other 409 is not swallowed',status:'PASS'});
h=nativeHarness({readError:Object.assign(Error('read denied'),{code:'EACCES'})});await assert.rejects(h.pollRead(),/read denied/);rows.push({case:'non-SyntaxError filesystem failure is not swallowed',status:'PASS'});
h=nativeHarness({bytes:['{"complete-but-invalid":]\n']});let saved;for(let ms=0;ms<6000;ms+=20){const current=await h.pollRead();if(current)saved=current;}assert.equal(saved,undefined);assert.throws(()=>assert.equal(saved?.state.snapshot.status,'idle'));await assert.rejects(h.readState(state),e=>e.name==='SyntaxError');rows.push({case:'persistent malformed JSON never supplies success at original 6s budget; raw final read still rejects',status:'PASS',unavailable:h.count(),simulatedMs:6000});
const paths=[nativePath,waitPath,'tests/studio-flow.test.ts','tests/v13-project-goal-entry.test.ts'];const hashes={};for(const file of paths)hashes[file]=createHash('sha256').update(await fs.readFile(file)).digest('hex');
const receipt={base,scope:'actual complete helper text extracted verbatim and type-stripped with Node; run only in isolated VM; fake host/clock/native bytes; no product/SDK imports or Host/Provider/test runner',rows,fileHashes:hashes};
await fs.writeFile(new URL('./native-observation-vm-receipt.json',import.meta.url),JSON.stringify(receipt,null,2));console.log(JSON.stringify(receipt,null,2));
