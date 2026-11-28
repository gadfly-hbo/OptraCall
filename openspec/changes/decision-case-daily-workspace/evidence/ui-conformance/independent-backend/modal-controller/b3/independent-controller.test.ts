
import test from 'node:test';
import assert from 'node:assert/strict';
import { createCaseActionDraft } from '/workspace/OptraCall-issue149-ui-conformance/src/host/ui/case-action-draft.ts';
import { createWorkspaceDraftStore } from '/workspace/OptraCall-issue149-ui-conformance/src/host/workspace-draft-store.ts';
const owner = { id:'choice:case:issue', caseId:'case', issueId:'issue', kind:'choice' as const };
const initial = { reason:'', operationId:'local-op', responseKey:'' };
function fixture() {
 let remote:any=null;const writes:any[]=[];const backups:any[]=[];
 return { get remote(){return remote;},set remote(v:any){remote=v;},writes,backups,
 read:async()=>remote,
 save:async(revision:number,payload:any)=>{if(revision !== (remote?.revision??0))throw Object.assign(Error('CAS'),{status:409});writes.push(payload);return remote={id:owner.id,kind:'issue-draft',revision:revision+1,payload,createdAt:'',updatedAt:''};},
 backup:async(id:string,payload:any)=>{const r={id,kind:'issue-draft',revision:1,payload,createdAt:'',updatedAt:''};backups.push(r);return r;}
 };
}
const payload=(reason:string)=>({caseId:'case',issueId:'issue',text:'',appendedFragmentIds:[],actionForm:{kind:'choice' as const,fields:{...initial,reason}}});
test('independent: malformed backup receipts cannot authorize original overwrite',async()=>{
 for(const mode of ['owner','content','revision']){
  const api=fixture();const draft=createCaseActionDraft({...owner,initial,read:api.read,save:api.save,backup:async(id,p)=>{const r=await api.backup(id,p);return mode==='owner'?{...r,id:'wrong'}:mode==='content'?{...r,payload:{...p,actionForm:{kind:'choice' as const,fields:{...initial,reason:'wrong'}}}}:{...r,revision:0};}});
  await draft.load();draft.update({...initial,reason:'mine'});await api.save(0,payload('remote'));await assert.rejects(draft.flush());await assert.rejects(draft.resolveConflict(1));await assert.rejects(draft.flush());
  assert.equal(api.remote.payload.actionForm.fields.reason,'remote');assert.equal(api.writes.length,1);assert.equal(draft.getSnapshot().value.reason,'mine');
 }
});
test('independent: prior conversation draft survives real store conflict recovery and reopen untouched',async()=>{
 const store=createWorkspaceDraftStore({root:process.cwd()+'/.local/ui-conformance/backend-independent/modal-controller/b3/store-probe'});
 const conversation=await store.save('issue-draft','issue:case:issue',0,{caseId:'case',issueId:'issue',text:'Original conversation input',appendedFragmentIds:['original-fragment']});
 const draft=createCaseActionDraft({...owner,initial,read:()=>store.read('issue-draft',owner.id),save:(r,p)=>store.save('issue-draft',owner.id,r,p),backup:(id,p)=>store.save('issue-draft',id,0,p)});
 await draft.load();draft.update({...initial,reason:'mine'});await store.save('issue-draft',owner.id,0,payload('another writer'));await assert.rejects(draft.flush());assert.equal(await draft.resolveConflict(1),true);assert.equal(await draft.flush(false),false);assert.equal(await draft.flush(),true);
 assert.deepEqual(await store.read('issue-draft','issue:case:issue'),conversation);
 const reopened=createCaseActionDraft({...owner,initial,read:()=>store.read('issue-draft',owner.id),save:(r,p)=>store.save('issue-draft',owner.id,r,p)});await reopened.load();assert.equal(reopened.getSnapshot().value.reason,'mine');const id=reopened.getSnapshot().recoveryDraftId!;assert.equal((await store.read<any>('issue-draft',id))!.payload.actionForm.fields.reason,'another writer');
});
test('independent: permission loss while saving clears remote fields and never retries after local discard',async()=>{
 const api=fixture();await api.save(0,{...payload('remote-private'),actionForm:{kind:'choice',fields:{...initial,reason:'remote-private',responseKey:'remote-request'}}});let calls=0;
 const draft=createCaseActionDraft({...owner,initial,read:api.read,save:async()=>{calls++;throw Object.assign(Error('forbidden'),{status:403});}});
 await draft.load();draft.update(v=>({...v,reason:'session text'}));await assert.rejects(draft.flush());const s=draft.getSnapshot();assert.equal(s.value.reason,'');assert.equal(s.value.responseKey,'');assert.equal(s.retainedInput!.reason,'session text');assert.equal(s.retainedInput!.responseKey,'');assert.equal(s.ready,false);await assert.rejects(draft.load());await assert.rejects(draft.flush());assert.equal(calls,1);draft.discardLocal();assert.equal(draft.getSnapshot().dirty,false);assert.equal(api.remote.payload.actionForm.fields.reason,'remote-private');
});
test('independent: late first load plus local edits requires exact conflict preservation before write',async()=>{
 const api=fixture();await api.save(0,payload('remote-before-open'));let release!:()=>void;const gate=new Promise<void>(r=>release=r);
 const draft=createCaseActionDraft({...owner,initial,read:async()=>{await gate;return api.remote;},save:api.save,backup:api.backup});const loading=draft.load();draft.update({...initial,reason:'early local'});release();await loading;await assert.rejects(draft.flush());assert.equal(await draft.resolveConflict(1),true);assert.equal(await draft.flush(),true);assert.equal(api.remote.payload.actionForm.fields.reason,'early local');assert.equal(api.backups[0].payload.actionForm.fields.reason,'remote-before-open');
});
