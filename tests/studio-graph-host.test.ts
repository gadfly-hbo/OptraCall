import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { ProjectStore } from '../src/host/project-store.ts';
import { EnterpriseMaterialsStore } from '../src/host/enterprise-materials-store.ts';
import { StudioStore } from '../extensions/business-plugins/studio/store.ts';
import { createStudioSources } from '../src/host/studio-sources.ts';
import { createStudioGraph } from '../src/host/studio-graph.ts';
import { buildStudioSemanticSnapshot } from '../src/host/studio-semantic.ts';
const configuration = { id: 'synthetic-model', revision: 1, name: '合成配置', provider: 'synthetic', model: 'synthetic', baseUrl: 'http://127.0.0.1:1' };
test('Studio graph binds exact saved usage tasks and requalifies formal sources without exposing construction data', async t => {
 const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'studio-graph-host-'))), dataRoot = path.join(root,'data');
 const projects = new ProjectStore({ dataRoot, projectsRoot: path.join(root,'projects') }); await projects.init();
 t.after(async()=>{await projects.close(); await fs.rm(root,{recursive:true,force:true});});
 const enterpriseMaterials = new EnterpriseMaterialsStore(dataRoot), store = new StudioStore(dataRoot), sources = createStudioSources({dataRoot,projects,enterpriseMaterials,studio:store});
 const project = await projects.create({name:'合成建设',configuration}), task = await projects.createTask(project.id,{name:'建设'}), using = await projects.create({name:'合成使用',configuration}), useTask = await projects.createTask(using.id,{name:'使用'});
 const material = await enterpriseMaterials.create({title:'合成退款规则',body:'退款事件按发生期间'}); await enterpriseMaterials.enable(material.material.id,material.material.version);
 const ref = (await sources.inventory(project.id)).find(m=>m.ref.authority==='enterprise')!.ref;
 const system = store.create({name:'合成资产',projectId:project.id,taskId:task.id,goal:'退款',topicTitle:'销售退款'});
 const asset = store.saveAsset(system.id,{kind:'rule',title:'退款',body:'成功退款按事件发生期间',scope:'合成',sources:[ref],checks:[{name:'合成作者检查',status:'pass',detail:'工程夹具'}],readyForPublication:true});
 const preview = store.preparePublication(system.id,{assetIds:[asset.id],summary:'合成范围',scope:'合成',checks:[],limitations:[]}); store.confirmPublication(system.id,preview.id,preview.fingerprint);
 store.linkUsageProject(system.id,using.id,useTask.id);
 const graph = createStudioGraph({dataRoot,codeRoot:process.cwd(),python:'/trusted/python',store,sources,availableFor:(s,p)=>s.projectId===p||s.usageProjectIds.includes(p)});
 const prepared = await graph.prepare(store.get(system.id)); assert.equal(prepared.sources.length,1); assert.equal(prepared.sources[0].ref.kind,'studio-source');
 assert.equal(graph.bindingFor(using.id,useTask.id),undefined);
 store.recordGraph(system.id,{snapshotId:'11111111-1111-4111-8111-111111111111',sourceRefs:prepared.sourceRefs,status:'succeeded',detail:'合成构图结果'});
 assert.equal(graph.bindingFor(using.id,useTask.id)?.snapshotId,'11111111-1111-4111-8111-111111111111'); assert.equal(graph.bindingFor(using.id,task.id),undefined);
 if(process.env.OPTRACALL_STUDIO_TEST_PYTHON) {
  const runRoot=graph.runRoot(system.id); await fs.mkdir(runRoot,{recursive:true,mode:0o700});
  await buildStudioSemanticSnapshot({python:process.env.OPTRACALL_STUDIO_TEST_PYTHON,codeRoot:process.cwd(),runRoot,snapshotId:'11111111-1111-4111-8111-111111111111',sources:prepared.sources,signal:new AbortController().signal,assertCurrent(){},checkMany:refs=>graph.checkBuild(system.id,refs)});
  await graph.inspect(system.id,'11111111-1111-4111-8111-111111111111');
  const receipt=JSON.parse(await fs.readFile(path.join(runRoot,'snapshots/11111111-1111-4111-8111-111111111111/receipt.json'),'utf8'));
  const inputFile=path.join(runRoot,receipt.inputs[0].relativePath), original=await fs.readFile(inputFile);
  await fs.writeFile(inputFile,'CORRUPTED INPUT');
  await assert.rejects(()=>graph.inspect(system.id,'11111111-1111-4111-8111-111111111111'),/studio_graph_invalid_snapshot/);
  await fs.writeFile(inputFile,original);
 }
 const context = {projectId:using.id,taskId:useTask.id,signal:new AbortController().signal,assertCurrent(){}};
 const formal = prepared.sources[0].ref; assert.equal(formal.kind,'studio-source'); if(formal.kind!=='studio-source')return;
 assert.equal((await graph.authority.check(formal,context)).state,'available');
 await enterpriseMaterials.disable(material.material.id,(await enterpriseMaterials.get(material.material.id)).material.version);
 assert.notEqual((await graph.authority.check(formal,context)).state,'available'); assert.equal((await graph.authority.read(formal,context)).body,null);
});

test('selecting an exact older successful graph preserves history and binds it only to subsequent reads', async t => {
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'studio-selection-')); t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const store=new StudioStore(root), system=store.create({name:'合成体系',projectId:'project',taskId:'task',goal:'销售退款',topicTitle:'销售'});
 const refs=[{authority:'enterprise' as const,id:'synthetic',version:'1'}];
 store.recordGraph(system.id,{snapshotId:'11111111-1111-4111-8111-111111111111',sourceRefs:refs,status:'succeeded',detail:'合成旧图'});
 store.recordGraph(system.id,{snapshotId:'22222222-2222-4222-8222-222222222222',sourceRefs:refs,status:'succeeded',detail:'合成新图'});
 store.selectGraphSnapshot(system.id,'11111111-1111-4111-8111-111111111111');
 const graph=createStudioGraph({dataRoot:root,codeRoot:process.cwd(),python:'/trusted/python',store,sources:{} as any,availableFor:()=>true});
 assert.equal(graph.bindingFor('project','task')?.snapshotId,'11111111-1111-4111-8111-111111111111'); assert.equal(store.get(system.id).graphs.length,2);
 assert.throws(()=>store.selectGraphSnapshot(system.id,'33333333-3333-4333-8333-333333333333'),/studio_graph_not_found/);
});
