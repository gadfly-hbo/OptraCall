import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { ModelPackStore } from '../src/host/model-pack-store.ts';
import { writeModelPack } from './model-pack-fixtures.ts';
test('MP01 a valid pure package imports as Staging without altering its source',async t=>{
 const root=await fs.mkdtemp(path.resolve('.local/model-pack-store-')); t.after(async()=>{ const unlock=async(d:string)=>{await fs.chmod(d,0o700);for(const f of await fs.readdir(d,{withFileTypes:true}))if(f.isDirectory())await unlock(path.join(d,f.name));};await unlock(root);await fs.rm(root,{recursive:true,force:true}); });
 const source=await writeModelPack(root), before=await fs.readFile(path.join(source,'manifest.json'));
 const store=new ModelPackStore(path.join(root,'models')); t.after(()=>store.close());
 const model=await store.importPack(source); assert.equal(model.stage,'Staging'); assert.equal(model.name,'synthetic-model'); assert.deepEqual(await fs.readFile(path.join(source,'manifest.json')),before);
});

test('MP02 explicit reimport of registered original bytes restores a corrupted snapshot and preserves the damaged bytes',async t=>{
 const root=await fs.mkdtemp(path.resolve('.local/model-pack-recovery-'));
 t.after(async()=>{const unlock=async(d:string)=>{await fs.chmod(d,0o700);for(const f of await fs.readdir(d,{withFileTypes:true}))if(f.isDirectory())await unlock(path.join(d,f.name));};await unlock(root);await fs.rm(root,{recursive:true,force:true});});
 const source=await writeModelPack(root), models=path.join(root,'models'), store=new ModelPackStore(models); t.after(()=>store.close());
 const original=await store.importPack(source);store.promote(original.name,1);
 const snapshot=path.join(models,original.name,'v1'), file=path.join(snapshot,'predict.mjs');await fs.chmod(file,0o644);await fs.writeFile(file,'damaged bytes');
 assert.equal(store.get(original.name,1).corrupted,true);
 const restored=await store.importPack(source);assert.equal(restored.snapshotSha256,original.snapshotSha256);assert.equal(restored.installedAt,original.installedAt);assert.equal(restored.stage,'Production');assert.equal(restored.corrupted,undefined);
 const kept=(await fs.readdir(path.dirname(snapshot))).filter(x=>x.startsWith('.corrupted-v1-'));assert.equal(kept.length,1);assert.equal(await fs.readFile(path.join(path.dirname(snapshot),kept[0],'predict.mjs'),'utf8'),'damaged bytes');
});

test('MP06 in-flight cancellation waits until its actual sandbox child has exited before rejecting',async t=>{
 const {execFileSync}=await import('node:child_process');
 const root=await fs.mkdtemp(path.resolve('.local/model-pack-stop-'));
 t.after(async()=>{const unlock=async(d:string)=>{await fs.chmod(d,0o700);for(const f of await fs.readdir(d,{withFileTypes:true}))if(f.isDirectory())await unlock(path.join(d,f.name));};await unlock(root);await fs.rm(root,{recursive:true,force:true});});
 const source=await writeModelPack(root,1,'export function predict(rows){ if(Number(rows[0].x)===999){while(true){}} return rows.map(r=>({...r,prediction:Number(r.x)*2}));}');
 const store=new ModelPackStore(path.join(root,'models'));t.after(()=>store.close());await store.importPack(source);
 await fs.mkdir(path.join(root,'project/020_clean'),{recursive:true});await fs.mkdir(path.join(root,'project/060_reports'));
 await fs.writeFile(path.join(root,'project/020_clean/in.json'),'[{"x":999}]');
 const controller=new AbortController();const running=store.predict({name:'synthetic-model',version:1,projectRoot:path.join(root,'project'),inputPath:'020_clean/in.json',outputPath:'060_reports/out.json',signal:controller.signal});
 const observed=running.then(()=>({error:null}),error=>({error}));let pid:number|undefined;
 for(let i=0;i<100&&!pid;i++){const listing=execFileSync('ps',['-axo','pid=,ppid=,command='],{encoding:'utf8'});for(const line of listing.split('\n')){const m=/^\s*(\d+)\s+(\d+)\s+(.*)$/.exec(line);if(m&&Number(m[2])===process.pid&&m[3].includes('model-pack-runner.mjs'))pid=Number(m[1]);}if(!pid)await new Promise(r=>setTimeout(r,10));}
 assert.ok(pid,'actual model sandbox child started');controller.abort();const result=await observed;assert.match(result.error?.code??'',/CANCEL/);assert.throws(()=>process.kill(pid!,0),{code:'ESRCH'},'must reap the owned child before settling cancellation');assert.deepEqual(await fs.readdir(path.join(root,'project/060_reports')),[]);
});

test('MP06 UTF-8 text survives sandbox stdout chunk boundaries exactly',async t=>{
 const root=await fs.mkdtemp(path.resolve('.local/model-pack-utf8-'));
 t.after(async()=>{const unlock=async(d:string)=>{await fs.chmod(d,0o700);for(const f of await fs.readdir(d,{withFileTypes:true}))if(f.isDirectory())await unlock(path.join(d,f.name));};await unlock(root);await fs.rm(root,{recursive:true,force:true});});
 const store=new ModelPackStore(path.join(root,'models'));t.after(()=>store.close());await store.importPack(await writeModelPack(root));
 await fs.mkdir(path.join(root,'project/020_clean'),{recursive:true});await fs.mkdir(path.join(root,'project/060_reports'));
 const label='测'.repeat(80000);await fs.writeFile(path.join(root,'project/020_clean/in.json'),JSON.stringify([{x:2,label}]));
 await store.predict({name:'synthetic-model',version:1,projectRoot:path.join(root,'project'),inputPath:'020_clean/in.json',outputPath:'060_reports/out.json'});
 const rows=JSON.parse(await fs.readFile(path.join(root,'project/060_reports/out.json'),'utf8'));assert.equal(rows[0].label,label);assert.equal(rows[0].prediction,4);
});

test('MP02 unknown registry schemas are rejected before any mutation and retain exact original bytes',async t=>{
 const {DatabaseSync}=await import('node:sqlite');const root=await fs.mkdtemp(path.resolve('.local/model-pack-schema-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const models=path.join(root,'models');await fs.mkdir(models);const file=path.join(models,'registry.sqlite'), db=new DatabaseSync(file);db.exec('CREATE TABLE future_ledger(value TEXT); INSERT INTO future_ledger VALUES (\'preserve\'); PRAGMA user_version=77;');db.close();const before=await fs.readFile(file);
 const store=new ModelPackStore(models);t.after(()=>store.close());await assert.rejects(store.importPack(await writeModelPack(root)),{code:'REGISTRY_SCHEMA_UNSUPPORTED'});assert.deepEqual(await fs.readFile(file),before);for(let attempt=0;attempt<2;attempt++){assert.throws(()=>store.list(),{code:'REGISTRY_SCHEMA_UNSUPPORTED'});assert.throws(()=>store.promote('synthetic-model',1),{code:'REGISTRY_SCHEMA_UNSUPPORTED'});}const readOnly=new ModelPackStore(models,{readOnly:true});t.after(()=>readOnly.close());for(let attempt=0;attempt<2;attempt++)assert.throws(()=>readOnly.list(),{code:'REGISTRY_SCHEMA_UNSUPPORTED'});assert.deepEqual(await fs.readFile(file),before);assert.deepEqual(await fs.readdir(models),['registry.sqlite']);
});

test('MP01 provided training groups must be valid; malformed metadata is never silently discarded',async t=>{
 const root=await fs.mkdtemp(path.resolve('.local/model-pack-groups-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 for(const [index,groups] of [null,42,['target'],{segment:42},{segment:[]}].entries()){
  const source=await writeModelPack(path.join(root,'case-'+index));const file=path.join(source,'manifest.json');const manifest=JSON.parse(await fs.readFile(file,'utf8'));manifest.training.groups=groups;await fs.writeFile(file,JSON.stringify(manifest));
  const models=path.join(root,'models-'+index),store=new ModelPackStore(models);t.after(()=>store.close());await assert.rejects(store.importPack(source),{code:'TRAINING_INVALID'});await assert.rejects(fs.lstat(models),{code:'ENOENT'});
 }
});

test('MP02 an unknown table in a nominal schema1 registry is rejected without adopting its schema',async t=>{
 const {DatabaseSync}=await import('node:sqlite'), root=await fs.mkdtemp(path.resolve('.local/model-pack-inventory-'));
 t.after(async()=>{const unlock=async(d:string)=>{await fs.chmod(d,0o700);for(const f of await fs.readdir(d,{withFileTypes:true}))if(f.isDirectory())await unlock(path.join(d,f.name));};await unlock(root);await fs.rm(root,{recursive:true,force:true});});
 const models=path.join(root,'models'), store=new ModelPackStore(models);t.after(()=>store.close());await store.importPack(await writeModelPack(root));
 const file=path.join(models,'registry.sqlite'), db=new DatabaseSync(file);db.exec('CREATE TABLE unrecognized_future_data(value TEXT);');db.close();const before=await fs.readFile(file);
 for(let attempt=0;attempt<2;attempt++)assert.throws(()=>store.promote('synthetic-model',1),{code:'REGISTRY_SCHEMA_UNSUPPORTED'});assert.deepEqual(await fs.readFile(file),before);
});
