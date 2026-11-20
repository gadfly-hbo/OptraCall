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

type Props={
  discussionId:string;versions:StrategyMapVersion[];selected?:StrategyMapRef;focusEdgeId?:string;
  onSelect:(ref:StrategyMapRef)=>void;onSaved:(version:StrategyMapVersion)=>void|Promise<void>;
  onDiscuss:(ref?:StrategyMapRef,edgeId?:string)=>void;onSimulate:(ref:StrategyMapRef,edgeId:string)=>void;onHandoff?:(version:StrategyMapVersion)=>void;
};
export function StrategyMapPanel(props:Props){
  const active=props.selected?props.versions.find(v=>versionKey(v)===versionKey(props.selected!)):props.versions.at(-1);
  if(!active)return <section className="sg-panel"><h2>战略地图</h2><p>可以在原讨论里整理第一个候选方向，也可以导入已有的战略地图。</p><button className="secondary-button" onClick={()=>props.onDiscuss()}>继续原讨论</button></section>;
  const latest=props.versions.filter(v=>v.mapId===active.mapId).reduce((a,b)=>a.version>b.version?a:b);
  return <MapView key={versionKey(active)} {...props} active={active} latest={latest}/>;
}
function MapView({active,latest,discussionId,versions,onSelect,onDiscuss,onSimulate,onSaved,onHandoff,focusEdgeId}:Props & {active:StrategyMapVersion;latest:StrategyMapVersion}){
  const [picked,setPicked]=useState(active.nodes[0]?.id??''),[edit,setEdit]=useState<StrategyMapDraft>(),[reason,setReason]=useState('');
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[edgeId,setEdgeId]=useState(focusEdgeId??active.edges.find(e=>e.kind==='hypothesis')?.id);
  const [newKind,setNewKind]=useState<StrategyMapEdge['kind']>('supports'),[newFrom,setNewFrom]=useState(''),[newTo,setNewTo]=useState('');
  const opener=useRef<HTMLButtonElement>(null),review=useRef<HTMLDetailsElement>(null),edgeButtons=useRef(new Map<string,HTMLButtonElement>());
  const pending=useRef<{fingerprint:string;operationId:string}|undefined>(undefined);
  const map=edit??active, node=map.nodes.find(n=>n.id===picked);
  const edge=active.edges.find(e=>e.kind==='hypothesis' && e.id===edgeId);
  useEffect(()=>{if(focusEdgeId&&review.current){review.current.open=true;edgeButtons.current.get(focusEdgeId)?.focus();}},[focusEdgeId]);
  function cancel(){if(busy)return;setEdit(undefined);setError('');setReason('');requestAnimationFrame(()=>opener.current?.focus());}
  function patchNode(key:keyof StrategyMapNode,value:string){if(edit)setEdit({...edit,nodes:edit.nodes.map(n=>n.id===picked?{...n,[key]:value}:n)});}
  function changeMetrics(metrics:StrategyMapMetric[]){if(edit)setEdit({...edit,nodes:edit.nodes.map(n=>n.id===picked?{...n,metrics}:n)});}
  function updateModel(model:StrategyScenarioModel|undefined){
    if(!edit)return;
    const {scenarioModel:_,...current}=edit;
    setEdit(model?{...current,scenarioModel:model}:current);
  }
  function addNode(kind:StrategyMapNode['kind']){
    if(!edit)return;const prefix={goal:'G',strategy:'S',other:'N'}[kind];let i=1;while(edit.nodes.some(n=>n.id===prefix+i))i++;
    const id=prefix+i;setEdit({...edit,nodes:[...edit.nodes,{id,kind,title:''}]});setPicked(id);
  }
  function addEdge(){
    if(!edit||!newFrom||!newTo||newFrom===newTo)return;
    if(edit.edges.some(e=>e.kind===newKind&&e.from===newFrom&&e.to===newTo)){setError('这条连线已经存在。');return;}
    setEdit({...edit,edges:[...edit.edges,{id:crypto.randomUUID(),kind:newKind,from:newFrom,to:newTo}]});setError('');
  }
  async function save(){
    if(!edit||busy)return;
    const update={mapId:active.mapId,expectedVersion:active.version,reason:reason.trim()||'手工修订战略地图',draft:edit};
    const fingerprint=JSON.stringify(update);
    if(pending.current?.fingerprint!==fingerprint)pending.current={fingerprint,operationId:crypto.randomUUID()};
    setBusy(true);setError('');
    try{
      const {version}=await saveStrategyMap(discussionId,{...update,operationId:pending.current!.operationId});
      await onSaved(version);setEdit(undefined);onSelect(version);
    }catch(e){
      setError(e instanceof StrategyDiscussionRequestError&&e.code.includes('version_conflict')?'此版已由另一位协作者修订。当前输入已保留，请与最新版本核对后再修改。':e instanceof StrategyDiscussionRequestError?e.code:'地图保存失败，请重试。');
    }finally{setBusy(false);}
  }
  const button=(label:string,click:()=>void)=><button type="button" className="secondary-button" onClick={click} disabled={busy}>{label}</button>;
  return <section className="sg-panel strategy-map" aria-label="战略地图" onKeyDown={e=>{if(e.key==='Escape'&&edit){e.preventDefault();cancel();}}}>
    <div className="sg-row-between"><div><h2>{active.title}</h2><span className="sg-muted">候选战略地图 · {mapTemplates[active.template]}</span></div>
      <label className="sg-row">所见版本<select className="sg-select" disabled={!!edit} value={versionKey(active)} onChange={e=>{const v=versions.find(v=>versionKey(v)===e.target.value);if(v)onSelect(v);}}>{[...versions].reverse().map(v=><option key={versionKey(v)} value={versionKey(v)}>{v.title} · v{v.version}</option>)}</select></label></div>
    {map.choice&&<p>{map.choice}</p>}
    <details><summary>取舍与成立条件</summary><dl className="sg-details">{([['放弃的方向',map.excluded],['成立条件',map.assumptions],['待核依据',map.unknowns]] as const).map(([k,v])=><div className="map-dl-row" key={k}><dt>{k}</dt><dd>{v||'待核'}</dd></div>)}</dl></details>
    <div className="sg-row map-toolbar">{button('继续原讨论',()=>onDiscuss(active))}{!edit&&active.version===latest.version&&<button className="secondary-button" ref={opener} onClick={()=>{setEdit(structuredClone(mapDraft(active)));setError('');}}>编辑地图</button>}
    {onHandoff&&button('将此版带入目标管理',()=>onHandoff(active))}</div>
    {edit&&<div className="map-edit-grid"><label>方案名称<input value={edit.title} onChange={e=>setEdit({...edit,title:e.target.value})}/></label>
      <label>地图模板<select value={edit.template} onChange={e=>setEdit({...edit,template:e.target.value as StrategyMapDraft['template']})}>{Object.entries(mapTemplates).map(([k,v])=><option value={k} key={k}>{v}</option>)}</select></label>
      {([['choice','本版选择'],['excluded','放弃的方向'],['assumptions','成立条件'],['unknowns','待核依据']] as const).map(([k,label])=><label key={k}>{label}<textarea value={edit[k]} onChange={e=>setEdit({...edit,[k]:e.target.value})}/></label>)}</div>}
    <MapDrawing map={map} selected={picked} onSelect={setPicked}/>
    {node&&<div className="map-item"><h3>{node.id} · {node.title||'新条目'}</h3>
      {edit?<div className="map-edit-grid">{([['title','条目名称'],['perspective','视角 / 分层'],['detail','说明'],['metric','指标'],['baseline','基线'],['baselineKind','基线性质'],['target','目标值'],['unit','单位'],['period','时段 / 口径'],['owner','负责人']] as const).map(([k,label])=><label key={k}>{label}<input value={node[k]??''} onChange={e=>patchNode(k,e.target.value)}/></label>)}</div>:
        <dl className="sg-details">{([['说明',node.detail],['指标',node.metric],['基线',node.baseline],['性质',node.baselineKind],['目标值',node.target],['单位',node.unit],['时段 / 口径',node.period]] as const).filter(([,v])=>Boolean(v)).map(([k,v])=><div key={k} className="map-dl-row"><dt>{k}</dt><dd>{v}</dd></div>)}</dl>}
      {node.metrics?.map((m,i)=>edit?<fieldset className="map-edit-grid" key={i}><legend>补充指标 {i+1}</legend>{([['metric','指标名称'],['baseline','基线'],['baselineKind','基线性质'],['target','目标值'],['unit','单位'],['period','时段 / 口径']] as const).map(([k,l])=><label key={k}>{l}<input value={m[k]??''} onChange={e=>changeMetrics(node.metrics!.map((v,j)=>j===i?{...v,[k]:e.target.value}:v))}/></label>)}{button('移除此指标',()=>changeMetrics(node.metrics!.filter((_,j)=>i!==j)))}</fieldset>:<p key={i}>{m.metric} · {m.baseline||'待建基线'} → {valueUnit(m.target,m.unit)} · {m.period}</p>)}{edit&&node.kind==='goal'&&button('添加补充指标',()=>changeMetrics([...(node.metrics??[]),{metric:''}]))}</div>}
    {edit&&<div className="sg-row">{button('新增目标项',()=>addNode('goal'))}{button('新增策略',()=>addNode('strategy'))}{button('新增其他条目',()=>addNode('other'))}
      {node&&button('移除此条目与相连关系',()=>{setEdit({...edit,nodes:edit.nodes.filter(n=>n.id!==picked),edges:edit.edges.filter(e=>e.from!==picked&&e.to!==picked)});setPicked(edit.nodes.find(n=>n.id!==picked)?.id??'');})}</div>}
    <details open={edit?true:undefined}><summary>地图连线（{map.edges.length}）</summary>
      <ul className="map-edge-list">{map.edges.map(e=><li key={e.id}><span>{nodeText(map.nodes,e.from)} → {nodeText(map.nodes,e.to)}</span><small>{mapEdgeKinds[e.kind]}</small>{edit&&button('移除连线',()=>setEdit({...edit,edges:edit.edges.filter(x=>x.id!==e.id)}))}</li>)}</ul>
      {edit&&<div className="sg-row map-edge-form">{([['起点',newFrom,setNewFrom],['终点',newTo,setNewTo]] as const).map(([label,val,set])=><label key={label}>{label}<select value={val} onChange={e=>set(e.target.value)}><option value="">选择条目</option>{map.nodes.map(n=><option value={n.id} key={n.id}>{n.id} · {n.title}</option>)}</select></label>)}
      <label>关系<select value={newKind} onChange={e=>setNewKind(e.target.value as StrategyMapEdge['kind'])}>{Object.entries(mapEdgeKinds).map(([k,v])=><option key={k} value={k}>{v}</option>)}</select></label>{button('添加连线',addEdge)}</div>}</details>
    {edit&&<StrategyScenarioEditor model={edit.scenarioModel} onChange={updateModel}/>}
    {edit?<><label className="map-change">本次修改说明<input value={reason} onChange={e=>setReason(e.target.value)} placeholder="例如：补充复购观察周期"/></label><div className="sg-row">{button('保存为新版本',()=>void save())}{button('取消修改',cancel)}</div></>:
      <details ref={review} className="map-review"><summary>因果链审查</summary>
        {active.edges.some(e=>e.kind==='hypothesis')?<div className="map-review-layout"><div className="map-review-nav">{active.edges.filter(e=>e.kind==='hypothesis').map(e=><button key={e.id} ref={el=>{if(el)edgeButtons.current.set(e.id,el);else edgeButtons.current.delete(e.id);}} className="sg-goal-choice" aria-pressed={e.id===edgeId} onClick={()=>setEdgeId(e.id)}>{nodeText(map.nodes,e.from)} → {nodeText(map.nodes,e.to)}</button>)}</div>{edge&&<section>
          {edge.review?<><strong>{edge.review.summary}</strong><dl className="sg-details">{(Object.keys(reviewFields) as (keyof typeof reviewFields)[]).filter(k=>k!=='summary').map(k=><div className="map-dl-row" key={k}><dt>{reviewFields[k]}</dt><dd>{edge.review![k]}</dd></div>)}</dl></>:<p>这条因果假设在 v{active.version} 尚待审查。</p>}
          {active.citations.filter(c=>edge.citationTokens?.includes(c.token)).map(c=><StrategyAttachmentEvidence key={c.token} discussionId={discussionId} citation={c}/>)}
          <div className="sg-row">{button('在原讨论审查此线',()=>onDiscuss(active,edge.id))}{button('带入战略模拟',()=>onSimulate(active,edge.id))}</div></section>}</div>:<p>本版没有声明因果假设。可在原讨论补充机制，或编辑地图添加对应连线。</p>}
      </details>}
    {error&&<p role="alert">{error}</p>}
  </section>;
}
