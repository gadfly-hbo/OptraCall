import {StrategyScenarioEditor} from './StrategyScenarioEditor.tsx';
import {useEffect,useId,useLayoutEffect,useRef,useState} from 'react';
import type {StrategyMapDraft,StrategyMapMetric,StrategyMapEdge,StrategyMapNode,StrategyMapRef,StrategyMapVersion} from '../strategy-map-types.ts';
import type {StrategyScenarioModel} from '../strategy-simulation.ts';
import {mapDraft,mapNodeMetrics,mapEdgeKinds,mapTemplates,reviewFields} from '../strategy-map-types.ts';
import {saveStrategyMap,StrategyDiscussionRequestError} from './strategy-discussion-client.ts';
import {StrategyAttachmentEvidence} from './StrategyAttachmentEvidence.tsx';
import './strategy-map.css';

const nodeLabels={goal:'目标',strategy:'策略',other:'其他条目'} as const;
const dimensions=['财务','客户','内部流程','学习与成长'];
const nodeText=(nodes:StrategyMapNode[],id:string)=>nodes.find(n=>n.id===id)?.title??id;
const versionKey=(v:StrategyMapRef)=>v.mapId+'#'+v.version;
const valueUnit=(value:string|undefined, unit:string|undefined)=>value!==undefined && value!==''?value+(unit&&!value.endsWith(unit)?' '+unit:''):'待定';

function NodeButton({node,selected,onSelect}:{node:StrategyMapNode;selected:string;onSelect:(id:string)=>void}){
  const [primary,...extra]=mapNodeMetrics(node);
  return <button type="button" className="sg-goal-choice map-node" data-map-node={node.id} aria-pressed={node.id===selected} onClick={()=>onSelect(node.id)}><small>{nodeLabels[node.kind]} · {node.id}</small><strong>{node.title}</strong>{primary&&<span>{primary.metric} · {valueUnit(primary.target,primary.unit)}{extra.length?'（另 '+extra.length+' 项）':''}</span>}</button>;
}
function BSCDrawing({map,selected,onSelect}:{map:StrategyMapDraft;selected:string;onSelect:(id:string)=>void}){
  const root=useRef<HTMLDivElement>(null),arrow=useId();
  const [paths,setPaths]=useState<{id:string;d:string;hypothesis:boolean}[]>([]);
  const groups=new Map<string,StrategyMapNode[]>(dimensions.map(name=>[name,[]]));
  for(const n of map.nodes){
    const group=n.perspective?.trim()||'待归类';
    groups.set(group,[...groups.get(group)??[],n]);
  }
  useLayoutEffect(()=>{
    const region=root.current;
    if(!region)return;
    function measure(){
      const box=region!.getBoundingClientRect();
      const boxes=new Map(Array.from(region!.querySelectorAll<HTMLElement>('[data-map-node]'),n=>[n.dataset.mapNode,n.getBoundingClientRect()]));
      setPaths(map.edges.flatMap(e=>{
        const a=boxes.get(e.from),b=boxes.get(e.to);if(!a||!b)return [];
        const down=b.top>=a.bottom,up=a.top>=b.bottom;
        const startX=(down||up?a.left+a.width/2:a.right)-box.left, endX=(down||up?b.left+b.width/2:b.left)-box.left;
        const startY=(down?a.bottom:up?a.top:a.top+a.height/2)-box.top, endY=(down?b.top:up?b.bottom:b.top+b.height/2)-box.top;
        const mid=(startY+endY)/2;
        return [{id:e.id,hypothesis:e.kind==='hypothesis',d:`M ${startX} ${startY} C ${startX} ${mid} ${endX} ${mid} ${endX} ${endY}`}];
      }));
    }
    measure();
    const observer=new ResizeObserver(measure);
    observer.observe(region);for(const node of region.querySelectorAll('[data-map-node]'))observer.observe(node);
    return ()=>observer.disconnect();
  },[map.nodes,map.edges]);
  return <div className="map-lanes" ref={root}>{[...groups].map(([group,nodes])=><section key={group} className="map-lane"><h3>{group}</h3><div>{nodes.length?nodes.map(node=><NodeButton key={node.id} node={node} selected={selected} onSelect={onSelect}/>):<span className="sg-muted">尚无条目</span>}</div></section>)}
    <svg aria-hidden="true" className="map-arrows"><defs><marker id={arrow} markerWidth="5" markerHeight="6" refX="4" refY="3" orient="auto"><path d="M0,0 L5,3 L0,6 Z" fill="currentColor"/></marker></defs>
      {paths.map(line=><path key={line.id} d={line.d} fill="none" stroke="currentColor" strokeWidth="1.5" strokeDasharray={line.hypothesis?'4 3':undefined} markerEnd={'url(#'+arrow+')'}/>)}</svg></div>;
}
function MapDrawing({map,selected,onSelect}:{map:StrategyMapDraft;selected:string;onSelect:(id:string)=>void}){
  const choose=(node:StrategyMapNode)=><NodeButton key={node.id} node={node} selected={selected} onSelect={onSelect}/>;
  if(map.template==='table')return <div className="sg-table-scroll"><table className="sg-table"><thead><tr>{['条目','类型','指标','基线','目标值','支撑 / 关联'].map(h=><th key={h} scope="col">{h}</th>)}</tr></thead>
    <tbody>{map.nodes.flatMap(n=>{
      const metrics=mapNodeMetrics(n);
      return (metrics.length?metrics:[n]).map((m,i)=><tr key={n.id+':'+i}>
        {i===0 && <><th scope="rowgroup" rowSpan={metrics.length||1}><button className="text-button" aria-pressed={selected===n.id} onClick={()=>onSelect(n.id)}>{n.id} · {n.title}</button></th><td rowSpan={metrics.length||1}>{nodeLabels[n.kind]}</td></>}
        <td>{m.metric||'—'}</td><td>{m.baseline===undefined?'待补':valueUnit(m.baseline,m.unit)} {m.baselineKind}</td><td>{n.kind==='goal'?valueUnit(m.target,m.unit):'—'}</td>
        {i===0 && <td rowSpan={metrics.length||1}>{map.edges.filter(e=>e.from===n.id).map(e=><div key={e.id}>{mapEdgeKinds[e.kind]} → {e.to}</div>)}</td>}
      </tr>);
    })}</tbody></table></div>;
  if(map.template==='bsc')return <BSCDrawing map={map} selected={selected} onSelect={onSelect}/>;
  const parents=map.edges.filter(e=>e.kind==='decomposition'||e.kind==='upstream'), visited=new Set<string>();
  const draw=(n:StrategyMapNode)=>{
    visited.add(n.id);
    const children=parents.filter(e=>e.from===n.id).map(e=>map.nodes.find(row=>row.id===e.to)!);
    return <li key={n.id}>{choose(n)}{children.length>0&&<ul>{children.map(c=>visited.has(c.id)?<li key={c.id}><button className="text-button" onClick={()=>onSelect(c.id)}>{c.id} · {c.title}</button></li>:draw(c))}</ul>}</li>;
  };
  const roots=map.nodes.filter(n=>!parents.some(e=>e.to===n.id));
  // Keep shared children and disconnected or cyclic components reachable.
  const forest=roots.map(draw);
  for(const n of map.nodes)if(!visited.has(n.id))forest.push(draw(n));
  return <ul className="map-tree">{forest}</ul>;
}

import type {StrategyMapImportDraftReceipt} from '../strategy-discussion-types.ts';
import {StrategyMapReviewPane} from './StrategyMapReviewPane.tsx';
import {
  applyManualEditRecord,
  emptyManualEditOverlay,
  hasManualEdits,
  mergeRereadDraftWithManualEdits,
  type ManualEditOverlay,
  type ManualEditRecord,
} from './strategy-map-review-helpers.ts';

export interface StrategyMapRereadRequest {
  baseRef?: StrategyMapRef;
  currentDraft: StrategyMapDraft;
  prompt: string;
  importSourceIds: string[];
  selectedImportPages?: Record<string, number[]>;
}

type Props={
  discussionId:string;versions:StrategyMapVersion[];selected?:StrategyMapRef;pendingDraft?:StrategyMapImportDraftReceipt;onDismissPendingDraft?:(entryId:string)=>void;focusEdgeId?:string;
  onSelect:(ref:StrategyMapRef)=>void;onSaved:(version:StrategyMapVersion,settledDraftEntryId?:string)=>void|Promise<void>;
  onDiscuss:(ref?:StrategyMapRef,edgeId?:string)=>void;onSimulate:(ref:StrategyMapRef,edgeId:string)=>void;onHandoff?:(version:StrategyMapVersion)=>void;
  onOpenImport?:()=>void;onReread?:(req:StrategyMapRereadRequest)=>void;onRevoked?:()=>void;
};
export function StrategyMapPanel(props:Props){
  const active=props.selected?props.versions.find(v=>versionKey(v)===versionKey(props.selected!)):props.versions.at(-1);
  if(!active && !props.pendingDraft){
    return <section className="sg-panel"><h2>战略地图</h2><p>可以在原讨论里整理第一个候选方向，也可以导入已有的线下战略地图（Excel / PPT / PDF / 图片）。</p><div className="sg-row"><button className="secondary-button" onClick={()=>props.onDiscuss()}>继续原讨论</button>{props.onOpenImport&&<button className="primary-button" onClick={props.onOpenImport}>导入战略图</button>}</div></section>;
  }
  const latest=active?props.versions.filter(v=>v.mapId===active.mapId).reduce((a,b)=>a.version>b.version?a:b):undefined;
  return <MapView key={props.discussionId} {...props} active={active} latest={latest}/>;
}
function MapView({active,latest,pendingDraft,onDismissPendingDraft,discussionId,versions,onSelect,onDiscuss,onSimulate,onSaved,onHandoff,onOpenImport,onReread,onRevoked,focusEdgeId}:Props & {active?:StrategyMapVersion;latest?:StrategyMapVersion}){
  const isPendingMode=Boolean(pendingDraft);
  const baseDraft=pendingDraft?pendingDraft.draft:mapDraft(active!);
  const [picked,setPicked]=useState(baseDraft.nodes[0]?.id??'');
  const [pickedEdge,setPickedEdge]=useState<string|undefined>(undefined);
  const [edit,setEdit]=useState<StrategyMapDraft>();
  const [manualEdits,setManualEdits]=useState<ManualEditOverlay>(emptyManualEditOverlay);
  const manualEditsRef=useRef<ManualEditOverlay>(manualEdits);
  manualEditsRef.current=manualEdits;
  const [mergeNotices,setMergeNotices]=useState<string[]>([]);
  const [reason,setReason]=useState('');
  const [reviewOpen,setReviewOpen]=useState(Boolean(baseDraft.importSources?.length));
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[edgeId,setEdgeId]=useState(focusEdgeId??active?.edges.find(e=>e.kind==='hypothesis')?.id);
  const [newKind,setNewKind]=useState<StrategyMapEdge['kind']>('supports'),[newFrom,setNewFrom]=useState(''),[newTo,setNewTo]=useState('');
  const opener=useRef<HTMLButtonElement>(null),review=useRef<HTMLDetailsElement>(null),edgeButtons=useRef(new Map<string,HTMLButtonElement>());
  const pending=useRef<{fingerprint:string;operationId:string}|undefined>(undefined);
  const draftMapIdRef=useRef<string|undefined>(undefined);
  const lastPendingEntryIdRef=useRef<string|undefined>(pendingDraft?.entryId);
  const activeKey=active?versionKey(active):undefined;
  const lastActiveKeyRef=useRef<string|undefined>(activeKey);

  function resetManualState(){
    const empty=emptyManualEditOverlay();
    manualEditsRef.current=empty;
    setManualEdits(empty);
    setEdit(undefined);
    setMergeNotices([]);
    setReason('');
    setError('');
    pending.current=undefined;
  }

  // Merge incoming reread/extracted pendingDraft deterministically with any unsaved manual edits
  useEffect(()=>{
    const nextEntryId=pendingDraft?.entryId;
    if(nextEntryId===lastPendingEntryIdRef.current)return;
    lastPendingEntryIdRef.current=nextEntryId;
    if(!pendingDraft)return;
    setReviewOpen(true);
    setError('');
    if(hasManualEdits(manualEditsRef.current)){
      const {merged,notices}=mergeRereadDraftWithManualEdits(pendingDraft.draft,manualEditsRef.current);
      setEdit(merged);
      setMergeNotices(notices);
      if(!merged.nodes.some(n=>n.id===picked))setPicked(merged.nodes[0]?.id??'');
    }else{
      setEdit(undefined);
      setMergeNotices([]);
      setPicked(pendingDraft.draft.nodes[0]?.id??'');
      setPickedEdge(undefined);
    }
  },[pendingDraft?.entryId]);

  // Preserve manual edits if an updated saved version of the same map arrives while editing; reset on manual version switch
  useEffect(()=>{
    if(activeKey===lastActiveKeyRef.current)return;
    const prevKey=lastActiveKeyRef.current;
    lastActiveKeyRef.current=activeKey;
    if(pendingDraft||!active)return;
    setReviewOpen(Boolean(active.importSources?.length));
    setEdgeId(focusEdgeId??active.edges.find(e=>e.kind==='hypothesis')?.id);
    const prevMapId=prevKey?.split('#')[0];
    if(prevMapId===active.mapId&&hasManualEdits(manualEditsRef.current)){
      const {merged,notices}=mergeRereadDraftWithManualEdits(mapDraft(active),manualEditsRef.current);
      setEdit(merged);
      setMergeNotices(notices);
      if(!merged.nodes.some(n=>n.id===picked))setPicked(merged.nodes[0]?.id??'');
    }else{
      resetManualState();
      setPicked(active.nodes[0]?.id??'');
      setPickedEdge(undefined);
    }
  },[activeKey,pendingDraft?.entryId]);

  useEffect(()=>{if(focusEdgeId&&review.current){review.current.open=true;edgeButtons.current.get(focusEdgeId)?.focus();}},[focusEdgeId]);

  const map:StrategyMapDraft=edit??baseDraft;
  const hasMultiImport=Boolean(map.importSources?.length);
  const node=map.nodes.find(n=>n.id===picked);
  const edge=!isPendingMode?active?.edges.find(e=>e.kind==='hypothesis' && e.id===edgeId):undefined;

  function applyDraftChange(next:StrategyMapDraft,record?:ManualEditRecord){
    setEdit(next);
    setError('');
    if(record){
      const updated=applyManualEditRecord(manualEditsRef.current,record);
      manualEditsRef.current=updated;
      setManualEdits(updated);
    }
  }
  function cancel(){
    if(busy)return;
    if(isPendingMode&&pendingDraft){
      draftMapIdRef.current=undefined;
      resetManualState();
      onDismissPendingDraft?.(pendingDraft.entryId);
      return;
    }
    resetManualState();
    requestAnimationFrame(()=>opener.current?.focus());
  }
  function patchNode(key:keyof StrategyMapNode,value:string){
    const current=edit??structuredClone(baseDraft);
    applyDraftChange(
      {...current,nodes:current.nodes.map(n=>n.id===picked?{...n,[key]:value}:n)},
      {kind:'node-patch',id:picked,patch:{[key]:value} as Partial<StrategyMapNode>},
    );
  }
  function changeMetrics(metrics:StrategyMapMetric[]){
    const current=edit??structuredClone(baseDraft);
    applyDraftChange(
      {...current,nodes:current.nodes.map(n=>n.id===picked?{...n,metrics}:n)},
      {kind:'node-patch',id:picked,patch:{metrics}},
    );
  }
  function updateModel(model:StrategyScenarioModel|undefined){
    const current=edit??structuredClone(baseDraft);
    const {scenarioModel:_,...rest}=current;
    setEdit(model?{...rest,scenarioModel:model}:rest);
  }
  function addNode(kind:StrategyMapNode['kind']){
    const current=edit??structuredClone(baseDraft);
    const prefix={goal:'G',strategy:'S',other:'N'}[kind];
    let i=1;while(current.nodes.some(n=>n.id===prefix+i))i++;
    const id=prefix+i;
    const created:StrategyMapNode={id,kind,title:''};
    applyDraftChange({...current,nodes:[...current.nodes,created]},{kind:'node-add',node:created});
    setPicked(id);
  }
  function addEdge(){
    const current=edit??structuredClone(baseDraft);
    if(!newFrom||!newTo||newFrom===newTo)return;
    if(current.edges.some(e=>e.kind===newKind&&e.from===newFrom&&e.to===newTo)){setError('这条连线已经存在。');return;}
    const created:StrategyMapEdge={id:crypto.randomUUID(),kind:newKind,from:newFrom,to:newTo};
    applyDraftChange({...current,edges:[...current.edges,created]},{kind:'edge-add',edge:created});
  }
  async function save(){
    if(busy)return;
    if(!isPendingMode&&!edit)return;
    const draftToSave=edit??baseDraft;
    let targetMapId:string;
    let expectedVersion:number;
    let saveReason:string;
    let importDraftEntryId:string|undefined;
    if(isPendingMode&&pendingDraft){
      importDraftEntryId=pendingDraft.entryId;
      if(pendingDraft.mapId){
        targetMapId=pendingDraft.mapId;
        const mapLatest=versions.filter(v=>v.mapId===targetMapId).reduce<StrategyMapVersion|undefined>((a,b)=>!a||b.version>a.version?b:a,undefined);
        expectedVersion=pendingDraft.expectedVersion??mapLatest?.version??0;
      }else{
        if(!draftMapIdRef.current)draftMapIdRef.current=crypto.randomUUID();
        targetMapId=draftMapIdRef.current;
        expectedVersion=0;
      }
      saveReason=reason.trim()||pendingDraft.reason||'核对并保存导入战略地图';
    }else{
      targetMapId=active!.mapId;
      expectedVersion=active!.version;
      saveReason=reason.trim()||'手工修订战略地图';
    }
    const update={mapId:targetMapId,expectedVersion,reason:saveReason,draft:draftToSave,...(importDraftEntryId?{importDraftEntryId}:{})};
    const fingerprint=JSON.stringify(update);
    if(pending.current?.fingerprint!==fingerprint)pending.current={fingerprint,operationId:crypto.randomUUID()};
    setBusy(true);setError('');
    try{
      const {version}=await saveStrategyMap(discussionId,{...update,operationId:pending.current!.operationId});
      const settledId=importDraftEntryId;
      draftMapIdRef.current=undefined;
      resetManualState();
      await onSaved(version,settledId);
      onSelect(version);
    }catch(e){
      setError(e instanceof StrategyDiscussionRequestError&&e.code.includes('version_conflict')?'此版已由另一位协作者修订。当前输入已保留，请与最新版本核对后再修改。':e instanceof StrategyDiscussionRequestError?(e.message||e.code):'地图保存失败，请重试。');
    }finally{setBusy(false);}
  }
  const editing=Boolean(edit||isPendingMode);
  const button=(label:string,click:()=>void)=><button type="button" className="secondary-button" onClick={click} disabled={busy}>{label}</button>;
  return <section className="sg-panel strategy-map" aria-label="战略地图" onKeyDown={e=>{if(e.key==='Escape'&&edit&&!isPendingMode){e.preventDefault();cancel();}}}>
    {isPendingMode&&pendingDraft&&(
      <div className="map-pending-draft-bar" role="status">
        <div className="sg-row-between">
          <div>
            <span className="sg-badge pending">待核对导入草稿 · 尚未保存为地图版本</span>
            <p className="sg-muted">本轮提取尚未写入正式地图版本；对照原稿修订确认后点击「保存候选版本」一次保存，或点击「放弃本次草稿」不落盘。</p>
          </div>
          <div className="sg-row">
            <button type="button" className="primary-button" disabled={busy} onClick={()=>void save()}>保存候选版本</button>
            <button type="button" className="secondary-button" disabled={busy} onClick={cancel}>放弃本次草稿</button>
          </div>
        </div>
      </div>
    )}
    {mergeNotices.length>0&&(
      <div className="map-import-notice" role="status">
        <strong>局部重读已合入，你的手工修改已保留：</strong>
        <span>{mergeNotices.join('；')}</span>
      </div>
    )}
    <div className="sg-row-between"><div><h2>{map.title}</h2><span className="sg-muted">{isPendingMode?'待核对导入草稿':'候选战略地图'} · {mapTemplates[map.template]}</span></div>
      {!isPendingMode&&active&&<label className="sg-row">所见版本<select className="sg-select" disabled={!!edit} value={versionKey(active)} onChange={e=>{const v=versions.find(v=>versionKey(v)===e.target.value);if(v)onSelect(v);}}>{[...versions].reverse().map(v=><option key={versionKey(v)} value={versionKey(v)}>{v.title} · v{v.version}</option>)}</select></label>}</div>
    {map.choice&&<p>{map.choice}</p>}
    <details><summary>取舍与成立条件</summary><dl className="sg-details">{([['放弃的方向',map.excluded],['成立条件',map.assumptions],['待核依据',map.unknowns]] as const).map(([k,v])=><div className="map-dl-row" key={k}><dt>{k}</dt><dd>{v||'待核'}</dd></div>)}</dl></details>
    <div className="sg-row map-toolbar">
      {button('继续原讨论',()=>onDiscuss(active))}
      {onOpenImport&&button('导入战略图',onOpenImport)}
      {hasMultiImport&&<button type="button" className="secondary-button" aria-pressed={reviewOpen} onClick={()=>setReviewOpen(v=>!v)}>{reviewOpen?'收起原稿对照':'对照原稿核对'}</button>}
      {!isPendingMode&&!edit&&active&&latest&&active.version===latest.version&&<button className="secondary-button" ref={opener} onClick={()=>{setEdit(structuredClone(mapDraft(active)));setError('');}}>编辑地图</button>}
      {!isPendingMode&&active&&onHandoff&&button('将此版带入目标管理',()=>onHandoff(active))}
    </div>
    {hasMultiImport&&reviewOpen&&(
      <StrategyMapReviewPane
        discussionId={discussionId}
        draft={map}
        selectedNodeId={picked}
        selectedEdgeId={pickedEdge}
        onSelectNode={id=>{setPicked(id);setPickedEdge(undefined);}}
        onSelectEdge={id=>setPickedEdge(id)}
        onChangeDraft={applyDraftChange}
        onReread={onReread?(prompt,ids,selectedPagesBySource)=>onReread({
          baseRef:pendingDraft?.mapId&&pendingDraft.expectedVersion?{mapId:pendingDraft.mapId,version:pendingDraft.expectedVersion}:active,
          currentDraft:map,
          prompt,
          importSourceIds:ids,
          selectedImportPages:selectedPagesBySource,
        }):undefined}
        onRevoked={onRevoked}
      />
    )}
    {editing&&<div className="map-edit-grid"><label>方案名称<input value={map.title} onChange={e=>setEdit({...map,title:e.target.value})}/></label>
      <label>地图模板<select value={map.template} onChange={e=>setEdit({...map,template:e.target.value as StrategyMapDraft['template']})}>{Object.entries(mapTemplates).map(([k,v])=><option value={k} key={k}>{v}</option>)}</select></label>
      {([['choice','本版选择'],['excluded','放弃的方向'],['assumptions','成立条件'],['unknowns','待核依据']] as const).map(([k,label])=><label key={k}>{label}<textarea value={map[k]} onChange={e=>setEdit({...map,[k]:e.target.value})}/></label>)}</div>}
    <MapDrawing map={map} selected={picked} onSelect={id=>{setPicked(id);setPickedEdge(undefined);}}/>
    {node&&<div className="map-item"><h3>{node.id} · {node.title||'新条目'}</h3>
      {editing?<div className="map-edit-grid">{([['title','条目名称'],['perspective','视角 / 分层'],['detail','说明'],['metric','指标'],['baseline','基线'],['baselineKind','基线性质'],['target','目标值'],['unit','单位'],['period','时段 / 口径'],['owner','负责人']] as const).map(([k,label])=><label key={k}>{label}<input value={node[k]??''} onChange={e=>patchNode(k,e.target.value)}/></label>)}</div>:
        <dl className="sg-details">{([['说明',node.detail],['指标',node.metric],['基线',node.baseline],['性质',node.baselineKind],['目标值',node.target],['单位',node.unit],['时段 / 口径',node.period]] as const).filter(([,v])=>Boolean(v)).map(([k,v])=><div key={k} className="map-dl-row"><dt>{k}</dt><dd>{v}</dd></div>)}</dl>}
      {node.metrics?.map((m,i)=>editing?<fieldset className="map-edit-grid" key={i}><legend>补充指标 {i+1}</legend>{([['metric','指标名称'],['baseline','基线'],['baselineKind','基线性质'],['target','目标值'],['unit','单位'],['period','时段 / 口径']] as const).map(([k,l])=><label key={k}>{l}<input value={m[k]??''} onChange={e=>changeMetrics(node.metrics!.map((v,j)=>j===i?{...v,[k]:e.target.value}:v))}/></label>)}{button('移除此指标',()=>changeMetrics(node.metrics!.filter((_,j)=>i!==j)))}</fieldset>:<p key={i}>{m.metric} · {m.baseline||'待建基线'} → {valueUnit(m.target,m.unit)} · {m.period}</p>)}{editing&&node.kind==='goal'&&button('添加补充指标',()=>changeMetrics([...(node.metrics??[]),{metric:''}]))}</div>}
    {editing&&<div className="sg-row">{button('新增目标项',()=>addNode('goal'))}{button('新增策略',()=>addNode('strategy'))}{button('新增其他条目',()=>addNode('other'))}
      {node&&button('移除此条目与相连关系',()=>{applyDraftChange({...map,nodes:map.nodes.filter(n=>n.id!==picked),edges:map.edges.filter(e=>e.from!==picked&&e.to!==picked)},{kind:'node-delete',id:picked});setPicked(map.nodes.find(n=>n.id!==picked)?.id??'');})}</div>}
    <details open={editing?true:undefined}><summary>地图连线（{map.edges.length}）</summary>
      <ul className="map-edge-list">{map.edges.map(e=><li key={e.id}><span>{nodeText(map.nodes,e.from)} → {nodeText(map.nodes,e.to)}</span><small>{mapEdgeKinds[e.kind]}</small>{editing&&button('移除连线',()=>applyDraftChange({...map,edges:map.edges.filter(x=>x.id!==e.id)},{kind:'edge-delete',id:e.id}))}</li>)}</ul>
      {editing&&<div className="sg-row map-edge-form">{([['起点',newFrom,setNewFrom],['终点',newTo,setNewTo]] as const).map(([label,val,set])=><label key={label}>{label}<select value={val} onChange={e=>set(e.target.value)}><option value="">选择条目</option>{map.nodes.map(n=><option value={n.id} key={n.id}>{n.id} · {n.title}</option>)}</select></label>)}
      <label>关系<select value={newKind} onChange={e=>setNewKind(e.target.value as StrategyMapEdge['kind'])}>{Object.entries(mapEdgeKinds).map(([k,v])=><option key={k} value={k}>{v}</option>)}</select></label>{button('添加连线',addEdge)}</div>}</details>
    {editing&&<StrategyScenarioEditor model={map.scenarioModel} onChange={updateModel}/>}
    {editing?<><label className="map-change">本次修改说明<input value={reason} onChange={e=>setReason(e.target.value)} placeholder={isPendingMode?'例如：核对并保存战略地图导入版本':'例如：补充复购观察周期'}/></label><div className="sg-row"><button type="button" className="primary-button" disabled={busy} onClick={()=>void save()}>{isPendingMode?'保存候选版本':'保存为新版本'}</button>{button(isPendingMode?'放弃本次草稿':'取消修改',cancel)}</div></>:
      active&&<details ref={review} className="map-review"><summary>因果链审查</summary>
        {active.edges.some(e=>e.kind==='hypothesis')?<div className="map-review-layout"><div className="map-review-nav">{active.edges.filter(e=>e.kind==='hypothesis').map(e=><button key={e.id} ref={el=>{if(el)edgeButtons.current.set(e.id,el);else edgeButtons.current.delete(e.id);}} className="sg-goal-choice" aria-pressed={e.id===edgeId} onClick={()=>setEdgeId(e.id)}>{nodeText(map.nodes,e.from)} → {nodeText(map.nodes,e.to)}</button>)}</div>{edge&&<section>
          {edge.review?<><strong>{edge.review.summary}</strong><dl className="sg-details">{(Object.keys(reviewFields) as (keyof typeof reviewFields)[]).filter(k=>k!=='summary').map(k=><div className="map-dl-row" key={k}><dt>{reviewFields[k]}</dt><dd>{edge.review![k]}</dd></div>)}</dl></>:<p>这条因果假设在 v{active.version} 尚待审查。</p>}
          {active.citations.filter(c=>edge.citationTokens?.includes(c.token)).map(c=><StrategyAttachmentEvidence key={c.token} discussionId={discussionId} citation={c}/>)}
          <div className="sg-row">{button('在原讨论审查此线',()=>onDiscuss(active,edge.id))}{button('带入战略模拟',()=>onSimulate(active,edge.id))}</div></section>}</div>:<p>本版没有声明因果假设。可在原讨论补充机制，或编辑地图添加对应连线。</p>}
      </details>}
    {error&&<p role="alert">{error}</p>}
  </section>;
}
