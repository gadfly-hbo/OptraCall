import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { mkdtempSync,mkdirSync,writeFileSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createSemanticGraphService } from '../src/host/semantic-graph-service.ts';

const snapshotId='11111111-1111-4111-8111-111111111111';
const binding={runRoot:'/approved/fixture',snapshotId,python:'/approved/python',codeRoot:'/approved/code'};
const roots:string[]=[];after(()=>{for(const root of roots)rmSync(root,{recursive:true,force:true});});
const sha=(value:string|Buffer)=>createHash('sha256').update(value).digest('hex');
const canonical=(value:unknown):string=>{if(value===null||typeof value!=='object')return JSON.stringify(value);if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';const o=value as Record<string,unknown>;return '{'+Object.keys(o).sort().map(k=>JSON.stringify(k)+':'+canonical(o[k])).join(',')+'}';};
const context=()=>({signal:new AbortController().signal,requestId:'request',sessionId:'session',toolCallId:'tool',runToken:{},assertCurrent(){}});
test('graph query rejects model owner/path parameters before dispatch', async()=>{
  let dispatches=0;
  const service=createSemanticGraphService({bindingFor(){dispatches++;return binding;},authorityFor(){throw new Error('not reached');}});
  await assert.rejects(service.query('project','task',{action:'graph',operation:'find',query:'refund',projectId:'other',runRoot:'/private'},context()),/semantic_graph_invalid_query/);
  assert.equal(dispatches,0);
});

import type { SemanticGraphAuthorityCheck, SemanticGraphWorkerResult } from '../src/host/semantic-graph-service.ts';
import type { SemanticGraphNode, SemanticGraphEdge, SemanticGraphPath, SemanticGraphSourceRef, SemanticGraphQuery } from '../extensions/business-plugins/semantic-context/graph.ts';
const ref: SemanticGraphSourceRef={kind:'sap',packageId:'core',version:'1.0',metricName:'refund',publishedHash:null};
const metadata=()=>({sourceRefs:[ref],buildSources:[],claimKind:'source-projection' as const,conditions:['refund follows original payment'],limitations:['refund maturity unknown'],businessTime:[]});
const node=(id:string,content='Retail refund definition'):SemanticGraphNode=>({id,type:'MetricVersion',content,metadata:metadata()});
function serviceFixture(nodes:SemanticGraphNode[],edges:SemanticGraphEdge[]=[],paths:SemanticGraphPath[]=[]){
  const root=mkdtempSync(path.join(tmpdir(),'optracall-s4-service-'));roots.push(root);mkdirSync(path.join(root,'inputs'));mkdirSync(path.join(root,'snapshots',snapshotId),{recursive:true});
  const inputs=Array.from({length:9},(_,i)=>{const text='synthetic input '+i;const relativePath='inputs/'+i+'.json';writeFileSync(path.join(root,relativePath),text);return {inputKey:String(i),relativePath,sha256:sha(text),bytes:Buffer.byteLength(text),nature:'engineering-design'};});
  writeFileSync(path.join(root,'snapshots',snapshotId,'graph.json'),'{}');writeFileSync(path.join(root,'snapshots',snapshotId,'ontology.json'),'{}');
  const receipt=JSON.stringify({snapshotId,inputs,files:{graph:{name:'graph.json',sha256:sha('{}'),bytes:2},ontology:{name:'ontology.json',sha256:sha('{}'),bytes:2}}});writeFileSync(path.join(root,'snapshots',snapshotId,'receipt.json'),receipt);
  let revision='1';let generation=sha(canonical(inputs));let body='Source 😀原文';let dispatches=0;let checks=0;let changeOn=0;let changeAfter=0;
  const result:SemanticGraphWorkerResult={snapshot:{id:snapshotId,graphSha256:sha('{}'),ontologySha256:sha('{}'),componentVersion:'0.7.0'},receiptSha256:sha(receipt),inputFingerprint:generation,state:'available',nodes,edges,paths,gaps:[],exhausted:true,currentRefs:[ref]};
  const service=createSemanticGraphService({bindingFor:()=>({...binding,runRoot:root}),authorityFor:()=>({
    async checkMany(refs){
      checks++;if(checks===changeOn)revision='changed';
      const values=refs.map(ref=>({ref,state:'available' as const,gaps:['missing-hash'],revision}));
      if(checks===changeAfter)setImmediate(()=>{revision='changed-during-snapshot-validation';});
      return values;
    },
    async readSource(){return {state:'available' as const,body,gaps:[],nature:'asset-publication'};}
  }),runProcess:async options=>{dispatches++;await options.checkMany([ref]);return {...structuredClone(result),inputFingerprint:generation};}});
  return {service,root,driftInput:()=>writeFileSync(path.join(root,'inputs/0.json'),'drift'),setRevision:(value:string)=>{revision=value;},setGeneration:(value:string)=>{generation=value;},setBody:(value:string)=>{body=value;},changeOnCheck:(value:number)=>{changeOn=value;},changeAfterCheck:(value:number)=>{changeAfter=value;},revision:()=>revision,dispatches:()=>dispatches,checks:()=>checks};
}
test('pagination fixes the exact snapshot, rejects cross-run/query owner and changed source governance',async()=>{
  const f=serviceFixture([node('a'),node('b')]);const ctx=context();const q={action:'graph',operation:'find',query:'refund',pageSize:1} as const;
  const first=await f.service.query('project','task',q,ctx);assert.equal(first.nodes[0]!.id,'a');assert.equal(first.coverage.complete,false);assert.ok(first.coverage.continuation);
  const next={...q,continuation:first.coverage.continuation};const second=await f.service.query('project','task',next,ctx);assert.equal(second.nodes[0]!.id,'b');assert.equal(second.coverage.complete,true);
  await assert.rejects(f.service.query('project','task',next,context()),/invalid_continuation/);
  await assert.rejects(f.service.query('other','task',q,ctx),/owner_mismatch/);
  await assert.rejects(f.service.query('project','task',{...next,query:'sales'},ctx),/invalid_continuation/);
  f.setRevision('2');await assert.rejects(f.service.query('project','task',next,ctx),/scope_changed/);
  f.setGeneration('two');await assert.rejects(f.service.query('project','task',q,ctx),/snapshot_changed/);
});
test('final source qualification changes discard content, including permitted-before-worker results',async()=>{
  const f=serviceFixture([node('a','secret should never return')]);f.changeOnCheck(3);
  await assert.rejects(f.service.query('project','task',{action:'graph',operation:'definition',nodeId:'a'},context()),/scope_changed/);
});
test('SEC-PRE-01 qualification changes during final snapshot validation discard stale model content',async()=>{
  const f=serviceFixture([node('a','qualified before the final snapshot reads')]);
  // Both the worker and the first Host recheck observe the old revision. The
  // queued source change runs while real asynchronous snapshot reads yield.
  f.changeAfterCheck(2);
  await assert.rejects(f.service.query('project','task',{action:'graph',operation:'definition',nodeId:'a'},context()),/semantic_graph_scope_changed/);
  assert.equal(f.revision(),'changed-during-snapshot-validation');
});
test('source handles are authenticated per run and source fragments preserve original UTF16 coordinates under 24KiB',async()=>{
  const f=serviceFixture([node('a')]);const ctx=context();const initial=await f.service.query('project','task',{action:'graph',operation:'definition',nodeId:'a'},ctx);
  const handle=initial.nodes[0]!.metadata.sourceRefs[0]!.sourceHandle!;assert.ok(handle);assert.equal(handle.includes('core'),false);
  await assert.rejects(f.service.query('project','task',{action:'graph',operation:'source',sourceHandle:handle+'x'},ctx),/invalid_continuation/);
  await assert.rejects(f.service.query('project','task',{action:'graph',operation:'source',sourceHandle:handle},context()),/invalid_continuation/);
  const original='😀退款原文\n'.repeat(9000);f.setBody(original);let continuation:string|null=null;let reconstructed='';let offset=0;let pages=0;
  do {
    const page=await f.service.query('project','task',{action:'graph',operation:'source',sourceHandle:handle,continuation},ctx);
    assert.ok(Buffer.byteLength(JSON.stringify(page))<=24*1024);const source=page.sources[0]!;assert.equal(source.range!.start,offset);assert.equal(source.body,original.slice(source.range!.start,source.range!.end));
    assert.doesNotMatch(source.body!,/^[\uDC00-\uDFFF]|[\uD800-\uDBFF]$/);reconstructed+=source.body;offset=source.range!.end;continuation=page.coverage.continuation;pages++;assert.ok(pages<50);
  } while(continuation);
  assert.equal(reconstructed,original);assert.ok(pages>1);
});
test('overlong semantic definitions continue original Unicode content with complete source metadata',async()=>{
  const original='😀 business definition 退款\n'.repeat(7000);const f=serviceFixture([node('a',original)]);const ctx=context();let continuation:string|null=null;let body='';let pages=0;
  do {const page=await f.service.query('project','task',{action:'graph',operation:'definition',nodeId:'a',continuation},ctx);
    assert.ok(Buffer.byteLength(JSON.stringify(page))<=24*1024);assert.equal(page.nodes.length,1);const item=page.nodes[0]!;assert.ok(item.metadata.sourceRefs[0]!.sourceHandle);assert.equal(item.contentRange!.start,body.length);assert.doesNotMatch(item.content,/^[\uDC00-\uDFFF]|[\uD800-\uDBFF]$/);body+=item.content;continuation=page.coverage.continuation;pages++;assert.ok(pages<100);
  }while(continuation);assert.equal(body,original);assert.ok(pages>1);
});
test('parallel paths page as whole bundles with original edges endpoints operand roles and sources',async()=>{
  const nodes=[node('a'),node('b'),node('c')];const edge=(id:string,target:string):SemanticGraphEdge=>({id,source:'a',target,type:'depends_on',metadata:{...metadata(),operandRole:'subtrahend',roleText:'subtract refund'}});
  const edges=[edge('edge1','b'),edge('parallel','b'),edge('edge2','c')];const paths=edges.map(edge=>({nodeIds:['a',edge.target],steps:[{edgeId:edge.id,direction:'forward' as const}]}));const f=serviceFixture(nodes,edges,paths);const ctx=context();let continuation:string|null=null;const seen:string[]=[];
  do {const page=await f.service.query('project','task',{action:'graph',operation:'dependencies',nodeId:'a',pageSize:1,continuation},ctx);assert.equal(page.paths.length,1);const path=page.paths[0]!;const edge=page.edges.find(edge=>edge.id===path.steps[0]!.edgeId)!;
    assert.equal(edge.metadata.operandRole,'subtrahend');assert.equal(edge.metadata.roleText,'subtract refund');assert.ok(edge.metadata.sourceRefs[0]!.sourceHandle);assert.deepEqual(new Set(page.nodes.map(node=>node.id)),new Set(path.nodeIds));seen.push(edge.id);continuation=page.coverage.continuation;
  }while(continuation);assert.deepEqual(new Set(seen),new Set(['edge1','parallel','edge2']));
});

test('snapshot drift during final native qualification rejects before returning content',async()=>{
  const f=serviceFixture([node('a')]);f.driftInput();await assert.rejects(f.service.query('project','task',{action:'graph',operation:'definition',nodeId:'a'},context()),/snapshot_changed/);
});
test('a complete structural unit that cannot fit reports too-large and keeps qualified source entry points',async()=>{
  const huge=node('a');huge.metadata.limitations=['Explicit limitation '.repeat(3000)];const f=serviceFixture([huge]);
  const page=await f.service.query('project','task',{action:'graph',operation:'definition',nodeId:'a'},context());
  assert.equal(page.code,'semantic_graph_too_large');assert.equal(page.coverage.complete,false);assert.equal(page.nodes.length,0);assert.ok(page.sources[0]!.sourceHandle);assert.deepEqual(page.sources[0]!.ref,ref);assert.ok(Buffer.byteLength(JSON.stringify(page))<=24*1024);
});

import { cp,readFile } from 'node:fs/promises';
import { ProjectStore } from '../src/host/project-store.ts';
import { ProjectDataContextStore } from '../src/host/project-data-context-store.ts';
import { EnterpriseMaterialsStore } from '../src/host/enterprise-materials-store.ts';
import { CaseStore } from '../src/host/case-store.ts';
import { SemanticContextService } from '../src/host/semantic-context-service.ts';
import { createMetricLibrary } from '../extensions/business-plugins/metric-factory/library/store.ts';
import { createSapMethodStore } from '../extensions/business-plugins/metric-factory/methods/store.ts';
import { createProjectEnablement } from '../extensions/business-plugins/metric-factory/project/enablement.ts';
import { createSemanticGraphAuthority } from '../src/host/semantic-graph-authority.ts';
const actualFixture=process.env.OPTRACALL_S4_FIXTURE;
const actualPython=process.env.OPTRACALL_S4_PYTHON;
test('actual Host Stores and pinned Semantica worker deliver all six operations without exposing frozen transaction bodies',{skip:!actualFixture||!actualPython},async t=>{
  const root=mkdtempSync(path.join(tmpdir(),'optracall-s4-native-service-'));roots.push(root);
  await cp(path.join(actualFixture!,'asset-root'),path.join(root,'data'),{recursive:true});await cp(path.join(actualFixture!,'projects-root'),path.join(root,'projects'),{recursive:true});
  const build=JSON.parse(await readFile(path.join(actualFixture!,'evidence/scene-v2-corrected-build.json'),'utf8'));
  const projectId=build.refs.input.projectId;
  const projects=new ProjectStore({dataRoot:path.join(root,'data'),projectsRoot:path.join(root,'projects')});await projects.init();t.after(()=>projects.close());
  const task=await projects.createTask(projectId,{name:'S4 synthetic graph service',configuration:{id:'synthetic',revision:1,name:'Synthetic',provider:'synthetic',model:'synthetic',baseUrl:'http://127.0.0.1'}});
  const data=new ProjectDataContextStore({dataRoot:projects.dataRoot,projects});const enterprise=new EnterpriseMaterialsStore(projects.dataRoot);
  const reader=new SemanticContextService({projects,data,enterprise,cases:new CaseStore({dataRoot:projects.dataRoot}),metricLibrary:createMetricLibrary(path.join(projects.dataRoot,'metric-assets')),methodLibrary:createSapMethodStore(path.join(projects.dataRoot,'metric-assets'))});
  createProjectEnablement(path.join(projects.dataRoot,'projects',projectId)).enable(build.refs.metrics[0].packageId,build.refs.metrics[0].version);
  const actualBinding={runRoot:actualFixture!,snapshotId:build.snapshotId,python:actualPython!,codeRoot:path.resolve('.')};
  const service=createSemanticGraphService({bindingFor:()=>actualBinding,authorityFor:()=>createSemanticGraphAuthority({projectId,taskId:task.id,projects,data,enterprise,reader,dataRoot:projects.dataRoot,binding:actualBinding})});
  const ctx=context();
  const definition=await service.query(projectId,task.id,{action:'graph',operation:'definition',nodeId:build.keys.C04},ctx);
  t.diagnostic(JSON.stringify({operation:'definition',state:definition.state,gaps:definition.coverage.gaps}));assert.notEqual(definition.state,'unknown');assert.deepEqual(definition.coverage.gaps,['source-validation-gap']);assert.equal(definition.nodes.length,1);assert.match(definition.nodes[0]!.content,/C04|net_retail_sales|净/);
  const queries:SemanticGraphQuery[]=[{action:'graph',operation:'find',query:'退款',pageSize:1},{action:'graph',operation:'neighbors',nodeId:build.keys.C04},{action:'graph',operation:'dependencies',nodeId:build.keys.method,depth:2},{action:'graph',operation:'impact',nodeId:build.keys['field-orders.gross_amount_yuan'],depth:4}];
  for(const query of queries){const result=await service.query(projectId,task.id,query,ctx);t.diagnostic(JSON.stringify({operation:query.operation,state:result.state,code:result.code,gaps:result.coverage.gaps}));assert.notEqual(result.state,'unknown',result.code??'unexpected unknown graph result');assert.ok(result.nodes.length>0);assert.ok(Buffer.byteLength(JSON.stringify(result))<=24*1024);assert.equal(result.snapshot!.id,build.snapshotId);assert.equal(JSON.stringify(result).includes(actualFixture!),false);}
  const impactQuery={action:'graph',operation:'impact',nodeId:build.keys['field-orders.order_id'],depth:4} as const;
  let continuation:string|null=null;const impactPaths:string[][]=[];let impactPages=0;
  do {
    const page=await service.query(projectId,task.id,{...impactQuery,continuation},ctx);assert.equal(page.code,undefined);assert.equal(page.coverage.exhausted,true);assert.ok(Buffer.byteLength(JSON.stringify(page))<=24*1024);
    for(const p of page.paths){
      p.steps.forEach((step,index)=>{const edge=page.edges.find(edge=>edge.id===step.edgeId)!;assert.ok(edge);assert.ok(page.nodes.some(node=>node.id===p.nodeIds[index]));assert.ok(page.nodes.some(node=>node.id===p.nodeIds[index+1]));assert.ok(edge.metadata.sourceRefs.length||edge.metadata.buildSources.length);assert.deepEqual(step.direction==='forward'?[edge.source,edge.target]:[edge.target,edge.source],p.nodeIds.slice(index,index+2));});
      if(p.nodeIds.at(-1)===build.keys.method)impactPaths.push(p.nodeIds);
    }
    continuation=page.coverage.continuation;assert.ok(++impactPages<20);
  }while(continuation);
  assert.deepEqual(new Set(impactPaths.map(p=>JSON.stringify(p))),new Set([[build.keys['field-orders.order_id'],build.keys.C03,build.keys.method],[build.keys['field-orders.order_id'],build.keys.C03,build.keys.C04,build.keys.method]].map(p=>JSON.stringify(p))));
  const shallow=await service.query(projectId,task.id,{...impactQuery,depth:2},ctx);assert.equal(shallow.coverage.exhausted,false);assert.equal(shallow.coverage.depthReached,2);assert.ok(shallow.coverage.gaps.includes('depth-limit'));
  const sourceHandle=definition.nodes[0]!.metadata.sourceRefs[0]!.sourceHandle!;
  const source=await service.query(projectId,task.id,{action:'graph',operation:'source',sourceHandle},ctx);assert.equal(source.sources.length,1);assert.ok(source.sources[0]!.body);assert.match(source.sources[0]!.body!,/net_retail_sales|净/);assert.doesNotMatch(source.sources[0]!.body!,/synthetic_net_controls/);
  const directInput=await service.query(projectId,task.id,{action:'graph',operation:'definition',nodeId:build.keys.input},ctx);const inputHandle=directInput.nodes[0]!.metadata.sourceRefs.find(ref=>ref.kind==='data-input')!.sourceHandle!;
  const inputSource=await service.query(projectId,task.id,{action:'graph',operation:'source',sourceHandle:inputHandle},ctx);assert.equal(inputSource.sources.length,1);assert.doesNotMatch(inputSource.sources[0]!.body!,/synthetic_net_controls|"orders"|"refunds"|originalPath/);
});
