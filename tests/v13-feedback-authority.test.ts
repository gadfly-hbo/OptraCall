import assert from 'node:assert/strict';
import test from 'node:test';
import {randomUUID} from 'node:crypto';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {startTaskRounds} from './fixtures/pm-task-rounds.ts';

test('uncertain observation time stays on the original board and cannot be presented to Teach or its upstreams',async t=>{
  const f=await startTaskRounds(t), a=await f.choose('原店'), action=await f.authorize(a.choiceId,'原店');
  const original=await f.observe(action.taskId,'原店观察');
  const issue={...f.owner,choiceId:a.choiceId,feedbackRevisionId:original.revisionId};
  const task=await f.create('teach','原店复盘',issue);await f.send(task.id,'核对该条观察','该条实际观察');
  const source=(await f.api(f.issuePath+'/sources')).replies.find((r:any)=>r.source.taskId===task.id).source;
  const {review}=await f.api(f.issuePath+'/review','POST',{operationId:randomUUID(),expectedRevision:await f.revision(),choiceId:a.choiceId,
    source,feedbackRevisionId:original.revisionId,observation:'原店观察',judgement:'仍待核',nextStep:'待复核'});
  assert.equal(review.feedback.authorizationId,action.authorizationId);
  const first=(await f.api(f.issuePath)).rounds[0], auth=first.actions[0].authorizations[0];
  const owners=['goal','strategy'].map(role=>'/api/business-role?'+new URLSearchParams({action:'origin',owner:JSON.stringify({
    role,...first.choice.goalBinding.primary,teachReview:{...f.owner,choiceId:a.choiceId,reviewId:review.operationId}
  })}));
  const db=new DatabaseSync(path.join(f.host.dataRoot,'decision-board','decision-board.sqlite3'));t.after(()=>db.close());
  const update=db.prepare('UPDATE feedback_revisions SET saved_at=? WHERE revision_id=?');
  const count=f.provider.requests.length;
  for(const time of ['',auth.time]) {
    update.run(time,original.revisionId);
    const limited=(await f.api(f.issuePath)).rounds[0];
    assert.equal(limited.actions[0].observationTimeLimited,true);
    assert.deepEqual(limited.actions[0].feedback,[]);assert.equal(limited.review,null);
    const board=await f.api('/api/decision-board/feedback/history?taskId='+action.taskId);
    assert.ok(JSON.stringify(board).includes(original.revisionId));
    const post=await f.host.request(f.taskPath,'POST',{name:'待核观察交接',operationId:randomUUID(),assignment:{type:'teach',skill:null,issue}});
    assert.equal(post.status,409);
    for(const route of owners){const denied=await f.host.request(route);assert.ok([403,409].includes(denied.status),await denied.text());}
    assert.equal(f.provider.requests.length,count);
  }
  update.run(original.savedAt,original.revisionId);
  for(const route of owners)assert.equal((await f.host.request(route)).status,200);
  // Only this isolated synthetic row models the old schema's retained import time.
  // Its edit time predates authorization. A later migration timestamp cannot grant it.
  const before=new Date(Date.parse(auth.time)-1000).toISOString();
  db.prepare("UPDATE feedback_revisions SET origin='legacy-current',operation_id=NULL,request_sha256=NULL,legacy_created_at=?,legacy_updated_at=? WHERE revision_id=?").run(before,before,original.revisionId);
  assert.deepEqual((await f.api(f.issuePath)).rounds[0].actions[0].feedback,[]);
  assert.equal(f.provider.requests.length,count);
  t.diagnostic(JSON.stringify({feedback:original.revisionId,authorization:action.authorizationId,unknownTimes:['absent','same-millisecond'],
    oldImport:'original edit predates authorization',originalBoardReadable:true,upstreamRestored:2,providerDelta:0}));
});
