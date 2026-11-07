import path from 'node:path';
import { createHash } from 'node:crypto';
import type { StudioSystem, StudioSourceRef } from '../../extensions/business-plugins/studio/contracts.ts';
import { StudioStore, StudioError } from '../../extensions/business-plugins/studio/store.ts';
import { createMetricLibrary } from '../../extensions/business-plugins/metric-factory/library/store.ts';
import { createSapMethodStore } from '../../extensions/business-plugins/metric-factory/methods/store.ts';
import { parseSapDraft } from '../../extensions/business-plugins/metric-factory/sap/validate.ts';
import { digest } from '../../extensions/business-plugins/studio/validation.ts';
import { readBytes, safePath } from './project-data-context-io.ts';
import type { createStudioSources } from './studio-sources.ts';
import type { StudioGraphSourceAuthority, StudioGraphSourceContext } from './semantic-graph-authority.ts';
import type { SemanticGraphBinding } from './semantic-graph-service.ts';
import type { StudioGraphSource } from './studio-semantic.ts';
import type { SemanticGraphSourceRef, StudioSemanticGraphSourceRef } from '../../extensions/business-plugins/semantic-context/graph.ts';

/** Projects retain source authority; graph snapshots are only derived publications. */
export function createStudioGraph(options: { dataRoot: string; codeRoot: string; python?: string; store: StudioStore; sources: ReturnType<typeof createStudioSources>; availableFor(system: StudioSystem, projectId: string): boolean }) {
 const library = createMetricLibrary(path.join(options.dataRoot,'metric-assets')), methods = createSapMethodStore(path.join(options.dataRoot,'metric-assets'));
 const runRoot = (id: string) => path.join(options.dataRoot,'studio-graphs',id);
 const sourceRef = (ref: StudioSemanticGraphSourceRef): StudioSourceRef => ({authority:'studio-source',id:ref.assetId,version:ref.version,sha256:ref.publishedHash,projectId:ref.projectId,locator:ref.systemId});
 async function read(ref: StudioSemanticGraphSourceRef, context: StudioGraphSourceContext) {
  context.signal.throwIfAborted(); context.assertCurrent();
  const system = options.store.get(ref.systemId);
  if (system.projectId!==ref.projectId || !options.availableFor(system,context.projectId)) throw new StudioError('studio_owner_mismatch',403);
  const result = await options.sources.read(sourceRef(ref),context.projectId,system.id);
  context.signal.throwIfAborted(); context.assertCurrent(); return result;
 }
 const authority: StudioGraphSourceAuthority = {
  async check(ref,context) {
   try { await read(ref,context); const system = options.store.get(ref.systemId); return {state:'available',observedHash:ref.publishedHash,gaps:[],revision:digest({system:system.revision,ref})}; }
   catch { context.signal.throwIfAborted(); context.assertCurrent(); return {state:'excluded',gaps:['studio-source-current-qualification-failed']}; }
  },
  async read(ref,context) { try { const result = await read(ref,context); return {state:'available',body:result.text,gaps:[],nature:'asset-publication'}; } catch { context.signal.throwIfAborted(); context.assertCurrent(); return {state:'excluded',body:null,gaps:['studio-source-current-qualification-failed']}; } },
 };
 async function prepare(system: StudioSystem) {
  const sources: StudioGraphSource[] = [], sourceRefs: StudioSourceRef[] = [], excluded: StudioSourceRef[] = [];
  for (const asset of system.assets) {
   if (!asset.formalRevision) continue;
   const version = asset.revisions.find(r=>r.revision===asset.formalRevision)!;
   const ref: StudioSourceRef = {authority:'studio-source',id:asset.id,version:String(version.revision),sha256:version.sha256,projectId:system.projectId,locator:system.id};
   // Qualification includes withdrawn dependencies and known source issues.
   try { const result = await options.sources.read(ref,system.projectId,system.id); sources.push({ref:{kind:'studio-source',systemId:system.id,assetId:asset.id,version:ref.version,publishedHash:version.sha256,projectId:system.projectId},title:version.title,body:result.text,kind:asset.kind}); sourceRefs.push(ref); }
   catch { excluded.push(ref); }
  }
  // Only receipts with actual original-library success admit SAP sources to a graph.
  const published = system.publications.flatMap(p=>p.results.filter(r=>r.status==='succeeded').flatMap(r=>r.refs));
  const distinct = [...new Map(published.map(r=>[digest(r),r])).values()];
  for (const ref of distinct) {
   if(ref.authority==='sap-metric') {
    const result=library.read(ref.id,ref.version); if(result.entry.bytesSha256!==ref.sha256) throw new StudioError('studio_source_changed',409);
    const document=parseSapDraft(new Uint8Array(Buffer.from(result.canonicalYaml)));
    for(const metric of document.metrics) sources.push({ref:{kind:'sap',packageId:ref.id,version:ref.version,metricName:metric.name,publishedHash:result.entry.bytesSha256},title:metric.display_name,body:JSON.stringify(metric),kind:'sap-metric'});
    sourceRefs.push(ref);
   } else if(ref.authority==='sap-method') {
    const result=methods.getPublished(ref.id,Number(ref.version)); if(result.issue?.status==='confirmed'){excluded.push(ref);continue;}
    if(result.version.contentSha256!==ref.sha256)throw new StudioError('studio_source_changed',409);
    const v=result.version; sources.push({ref:{kind:'sap-method',methodId:ref.id,version:v.version,publishedHash:v.contentSha256},title:v.title,body:JSON.stringify({methodId:v.methodId,version:v.version,title:v.title,content:v.content,relation:v.relation}),kind:'sap-method'}); sourceRefs.push(ref);
   }
  }
  if(!sources.length)throw new StudioError('studio_graph_no_eligible_sources',409);
  return {sources,sourceRefs,excluded};
 }
 async function checkBuild(systemId:string, refs: unknown[]) {
  const system=options.store.get(systemId);
  return Promise.all(refs.map(async raw => {
   try {
    const ref=raw as SemanticGraphSourceRef;
    if(ref.kind==='studio-source') { if(ref.systemId!==systemId||ref.projectId!==system.projectId)throw new Error(); await options.sources.validate(sourceRef(ref),system.projectId,systemId); }
    else if(ref.kind==='sap') {const result=library.read(ref.packageId,ref.version);if(result.entry.bytesSha256!==ref.publishedHash||!result.entry.metricNames.includes(ref.metricName!))throw new Error();}
    else if(ref.kind==='sap-method') {const result=methods.getPublished(ref.methodId,ref.version);if(result.version.contentSha256!==ref.publishedHash||result.issue?.status==='confirmed')throw new Error();}
    else throw new Error();
    return {state:'available',gaps:[]};
   }catch{return {state:'excluded',gaps:['source-no-longer-qualified']};}
  }));
 }
 function bindingFor(projectId:string,taskId:string):SemanticGraphBinding|undefined {
  if(!options.python)return;
  const system=options.store.list().find(s=>s.projectId===projectId&&s.taskId===taskId||s.usageTasks?.some(t=>t.projectId===projectId&&t.taskId===taskId));
  const graph=system && [...system.graphs].reverse().find(g=>g.status==='succeeded' && (!system.selectedGraphSnapshotId || g.snapshotId===system.selectedGraphSnapshotId));
  if(!system||!graph)return;
  return {runRoot:runRoot(system.id),snapshotId:graph.snapshotId,python:options.python,codeRoot:options.codeRoot};
 }
 async function inspect(systemId:string,snapshotId:string) {
  const system=options.store.get(systemId); if(!system.graphs.some(g=>g.snapshotId===snapshotId))throw new StudioError('studio_graph_not_found',404);
  if(!/^[a-f0-9-]{36}$/.test(snapshotId))throw new StudioError('studio_graph_invalid_snapshot');
  const root=runRoot(systemId), prefix=`snapshots/${snapshotId}/`;
  const receipt=JSON.parse((await readBytes(await safePath(root,prefix+'receipt.json'))).toString('utf8'));
  const component={name:'semantica',version:'0.7.0',wheelSha256:'faf27d6259ae813ddb44c5213e2f8867592f27e6e3d6b47cea10f1844513799f'};
  if(receipt.formatVersion!==2||receipt.snapshotId!==snapshotId||receipt.graphId!==snapshotId||digest(receipt.component)!==digest(component)||!Array.isArray(receipt.inputs)||!receipt.inputs.length)throw new StudioError('studio_graph_invalid_snapshot',409);
  const inputKeys=new Set<string>(), inputPaths=new Set<string>();
  for(const input of receipt.inputs) {
   if(typeof input.inputKey!=='string'||!input.inputKey||inputKeys.has(input.inputKey)||typeof input.relativePath!=='string'||!/^inputs\/[a-zA-Z0-9._-]+\.json$/.test(input.relativePath)||inputPaths.has(input.relativePath)||input.nature!=='asset-publication')throw new StudioError('studio_graph_invalid_snapshot',409);
   const bytes=await readBytes(await safePath(root,input.relativePath),2*1024*1024);
   if(bytes.length!==input.bytes||createHash('sha256').update(bytes).digest('hex')!==input.sha256)throw new StudioError('studio_graph_invalid_snapshot',409);
   inputKeys.add(input.inputKey); inputPaths.add(input.relativePath);
  }
  let graph: any;
  for(const kind of ['graph','ontology']) {
   const expected=receipt.files?.[kind]; if(expected?.name!==`${kind}.json`)throw new StudioError('studio_graph_invalid_snapshot',409);
   const bytes=await readBytes(await safePath(root,prefix+expected.name),32*1024*1024);
   if(bytes.length!==expected.bytes||createHash('sha256').update(bytes).digest('hex')!==expected.sha256)throw new StudioError('studio_graph_invalid_snapshot',409);
   if(kind==='graph')graph=JSON.parse(bytes.toString('utf8'));
  }
  if(graph?.graph_id!==snapshotId||!Array.isArray(graph.nodes)||!Array.isArray(graph.edges))throw new StudioError('studio_graph_invalid_snapshot',409);
  const refs=[...new Map([...graph.nodes,...graph.edges].flatMap(n=>n.properties?.sourceRefs??[]).map((ref:SemanticGraphSourceRef)=>[digest(ref),ref])).values()];
  if(!refs.length||(await checkBuild(systemId,refs)).some(check=>check.state!=='available'))throw new StudioError('studio_graph_source_ineligible',409);
  const sourceRefs:StudioSourceRef[]=refs.map(raw=>{
    const ref=raw as SemanticGraphSourceRef;
    if(ref.kind==='studio-source')return sourceRef(ref);
    if(ref.kind==='sap')return {authority:'sap-metric',id:ref.packageId,version:ref.version,sha256:ref.publishedHash!};
    if(ref.kind==='sap-method')return {authority:'sap-method',id:ref.methodId,version:String(ref.version),sha256:ref.publishedHash!};
    throw new StudioError('studio_graph_source_ineligible',409);
  });
  return {snapshotId,sourceRefs,detail:'按原快照回执核图与本体哈希及当前源资格；只核结果，不重放构图'};
 }
 return {prepare,authority,checkBuild,bindingFor,runRoot,inspect};
}
