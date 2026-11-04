import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { EnterpriseMaterialsStore, enterpriseDraftSha256 } from '../src/host/enterprise-materials-store.ts';
const evidence = path.resolve('.local/fourbase-modules/m3/implementation/store/roots');
async function fixture() { await fs.mkdir(evidence, {recursive:true}); const root=await fs.mkdtemp(path.join(evidence,'freeze-')); return new EnterpriseMaterialsStore(root); }
test('PR02 freezeExact preserves a selected saved draft without enabling it and replays the old payload after new edits', async () => {
  const store=await fixture(), created=await store.create({title:'Synthetic original',body:'Saved original'}), target=randomUUID();
  const draftHash=enterpriseDraftSha256(created.material.draft);
  const first=await store.freezeExact(created.material.id,created.material.version,target,draftHash);
  assert.equal(first.body,'Saved original'); assert.equal(first.revisionId,target);
  const frozen=await store.get(created.material.id);
  assert.equal(frozen.material.enabled,false); assert.equal(frozen.material.activeRevisionId,null);
  const changed=await store.update(created.material.id,frozen.material.version,{title:'New title',body:'New draft'});
  assert.equal((await store.freezeExact(created.material.id,created.material.version,target,draftHash)).body,'Saved original');
  assert.equal((await store.get(created.material.id)).material.version,changed.material.version);
  await assert.rejects(store.freezeExact(created.material.id,changed.material.version,target,enterpriseDraftSha256(changed.material.draft)),/enterprise_revision_identity_conflict/);
});
test('PR02 freezeExact supports verified attachment-only content and preserves an already active revision',async()=>{
  const store=await fixture(),created=await store.create({title:'Attachment only',body:''});
  const attached=await store.addFile(created.material.id,created.material.version,{name:'synthetic.bin',base64:'AQID'}),firstId=randomUUID();
  const frozen=await store.freezeExact(created.material.id,attached.material.version,firstId,enterpriseDraftSha256(attached.material.draft));
  assert.equal(frozen.body,'');assert.equal(frozen.sourceFile?.bytes,3);
  const afterFreeze=await store.get(created.material.id),enabled=await store.enable(created.material.id,afterFreeze.material.version,firstId),changed=await store.update(created.material.id,enabled.material.version,{title:'Another saved draft',body:'Added text'});
  const secondId=randomUUID();await store.freezeExact(created.material.id,changed.material.version,secondId,enterpriseDraftSha256(changed.material.draft));
  const final=await store.get(created.material.id);assert.equal(final.material.enabled,true);assert.equal(final.material.activeRevisionId,firstId);assert.equal(final.material.revisions.length,2);
});
test('PR02 freezeExact rejects stale complete draft identity and corrupt attachments without adding a revision',async()=>{
  const store=await fixture(),created=await store.create({title:'Original',body:'Same body'}),changed=await store.update(created.material.id,created.material.version,{title:'Changed title'});
  await assert.rejects(store.freezeExact(created.material.id,changed.material.version,randomUUID(),enterpriseDraftSha256(created.material.draft)),/enterprise_draft_identity_conflict/);
  const attached=await store.addFile(created.material.id,changed.material.version,{name:'synthetic.bin',base64:'AQID'});await fs.writeFile(attached.material.files[0].path,Buffer.from([9,9,9]));
  await assert.rejects(store.freezeExact(created.material.id,attached.material.version,randomUUID(),enterpriseDraftSha256(attached.material.draft)),/enterprise_source_changed/);
  assert.equal((await store.referenceIndex()).materials[0].revisions.length,0);
});
