import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { ProjectStore } from '../src/host/project-store.ts';
const configuration = { id: 'synthetic', revision: 1, provider: 'synthetic', model: 'fixture', name: 'fixture', baseUrl: 'http://127.0.0.1:1' };
test('CASE-CREATE: reserved original project identity is exclusive and replay cannot overwrite metadata or files', async t => {
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'case-project-')), store=new ProjectStore({dataRoot:path.join(root,'data'),projectsRoot:path.join(root,'projects')});
  await store.init(); t.after(async()=>{await store.close();await fs.rm(root,{recursive:true,force:true});});
  const reservedId=randomUUID();
  const project=await store.create({name:'Reserved',configuration,reservedId});
  assert.equal(project.id,reservedId);
  const metadata=path.join(root,'data','projects',project.id,'project.json'),before=await fs.readFile(metadata);
  await assert.rejects(()=>store.create({name:'Overwrite',configuration,reservedId}),/project_identity_exists/);
  assert.deepEqual(await fs.readFile(metadata),before);
});
test('CASE-ARTIFACT: observe current bytes without changing source; reject links outside the project', async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'case-file-')),store=new ProjectStore({dataRoot:path.join(root,'data'),projectsRoot:path.join(root,'projects')});
 await store.init();t.after(async()=>{await store.close();await fs.rm(root,{recursive:true,force:true});});
 const project=await store.create({name:'Files',configuration}),file=await store.upload({projectId:project.id,name:'source.txt',bytes:Buffer.from('original'),directory:'020_clean'});
 const source=path.join(project.rootPath,file.path);await fs.writeFile(source,'updated');
 const observed=await store.observeFile(project.id,file.path);assert.equal(observed.sha256,createHash('sha256').update('updated').digest('hex'));assert.equal(observed.bytes,7);assert.ok(observed.observedAt);assert.equal(await fs.readFile(source,'utf8'),'updated');
 await fs.symlink(source,path.join(project.rootPath,'020_clean','link.txt'));await assert.rejects(()=>store.observeFile(project.id,'020_clean/link.txt'),/unsafe/);
 await assert.rejects(()=>store.observeFile(project.id,'../outside'),/invalid|unsafe/);
});
test('CASE-STARTUP: Finder metadata in the project root does not block preserved projects; unknown entries still fail',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'case-startup-')),options={dataRoot:path.join(root,'data'),projectsRoot:path.join(root,'projects')},store=new ProjectStore(options);
 await store.init();const project=await store.create({name:'原项目',configuration});await store.close();
 const metadata=path.join(options.dataRoot,'projects',project.id,'project.json'),before=await fs.readFile(metadata),finder=Buffer.from('synthetic Finder metadata');
 await fs.writeFile(path.join(options.projectsRoot,'.DS_Store'),finder);
 const reopened=new ProjectStore(options);t.after(async()=>{await reopened.close();await fs.rm(root,{recursive:true,force:true});});
 await reopened.init();assert.equal((await reopened.list())[0]?.id,project.id);assert.deepEqual(await fs.readFile(metadata),before);assert.deepEqual(await fs.readFile(path.join(options.projectsRoot,'.DS_Store')),finder);
 await reopened.close();await fs.writeFile(path.join(options.projectsRoot,'unknown.txt'),'preserve');const unknown=new ProjectStore(options);await assert.rejects(()=>unknown.init(),/unrecognized_project_root/);assert.equal(await fs.readFile(path.join(options.projectsRoot,'unknown.txt'),'utf8'),'preserve');
 await fs.unlink(path.join(options.projectsRoot,'unknown.txt'));await fs.unlink(path.join(options.projectsRoot,'.DS_Store'));await fs.symlink(metadata,path.join(options.projectsRoot,'.DS_Store'));const linked=new ProjectStore(options);await assert.rejects(()=>linked.init(),/unrecognized_project_root/);assert.deepEqual(await fs.readFile(metadata),before);
});
