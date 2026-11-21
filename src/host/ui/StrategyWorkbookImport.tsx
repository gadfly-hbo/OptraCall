import {useEffect,useId,useRef,useState} from 'react';
import type {GoalDraftInput,GoalRef,GoalScope,GoalVersion,StrategyGoalsIndex} from '../strategy-goals-types.ts';
import {groupScopeKey} from '../structured-goal.ts';
import {mapNodeMetrics,mapTemplates,type StrategyMapVersion} from '../strategy-map-types.ts';
import {defaultSelection,guessMapping,mapStrategyWorkbook,unstableWorkbookMatches,workbookFields,workbookKinds,type StrategyWorkbook,type WorkbookSelection,type WorkbookTarget} from '../strategy-workbook-types.ts';
import {CaseDialog} from './CaseDialogs.tsx';
import {list as listGoals} from './strategy-goals-client.ts';

type Result={version?:StrategyMapVersion;goals?:GoalVersion[];errors?:string[]};
const errors:Record<string,string>={
  strategy_workbook_unstable_ids:'新旧工作簿中有按行号临时标识的条目，无法确认是同一项。请补充稳定编号或选择新建。',strategy_goal_table_conflict:'目标已有新版本，请关闭并重新核对。',strategy_workbook_size:'工作簿须在 8 MiB 以内。',invalid_strategy_workbook:'无法读取此工作簿，请确认是有效的 .xlsx 文件。',strategy_workbook_range_limit:'工作表超出可处理范围，请另存要导入的区域。',strategy_workbook_source_changed:'原工作簿指纹已变化。',strategy_map_version_conflict:'地图已有新版本，请重新核对。',strategy_workbook_owner_mismatch:'所选工作簿与当前归属不一致。'};
async function request<T>(action:string,input:unknown):Promise<T>{
  const r=await fetch('/api/strategy/workbooks/'+action,{method:'POST',credentials:'omit',cache:'no-store',mode:'same-origin',headers:{'content-type':'application/json','x-optracall-client':'1'},body:JSON.stringify(input)});
  const data=await r.json();if(!r.ok)throw new Error(errors[data.code]||data.message||data.code||'未完成，请核对原文件及权限。');return data as T;
}
const errorMessage=(e:unknown)=>e instanceof Error?e.message:'无法读取原资料。';
function mapRef(v:StrategyMapVersion){return {discussionId:v.discussionId,mapId:v.mapId,version:v.version,sha256:v.contentSha256};}
function expectedVersions(index:StrategyGoalsIndex|undefined,groupId:string|undefined,scope:GoalScope){
  const refs:Record<string,GoalRef>={};
  for(const g of index?.goals??[]){const v=g.versions.at(-1)!;if(v.structured?.groupId===groupId && v.structured && groupScopeKey(v.scope)===groupScopeKey(scope))refs[v.structured.nodeId]={goalId:g.id,version:g.currentVersion};}
  return refs;
}
export function DownloadWorkbook({version,goal}:{version?:StrategyMapVersion;goal?:GoalRef}){
  const [error,setError]=useState(''),[busy,setBusy]=useState(false);
  async function download(){
    setError('');setBusy(true);
    try{const result=await request<{fileName:string;bytes:string}>(version?'map-source':'goal-source',version?mapRef(version):goal);
      const bytes=Uint8Array.from(atob(result.bytes),c=>c.charCodeAt(0));
      const url=URL.createObjectURL(new Blob([bytes],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'})),a=document.createElement('a');
      a.href=url;a.download=result.fileName;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
    }catch(e){setError(errorMessage(e));}finally{setBusy(false);}
  }
  return <><button className="text-button" disabled={busy} onClick={()=>void download()}>下载原工作簿</button>{error&&<span role="alert">{error}</span>}</>;
}
function ScopeSelect({scopes,scope,onScope,perspective,onPerspective}:{scopes:GoalScope[];scope:GoalScope|undefined;onScope:(s:GoalScope)=>void;perspective:GoalDraftInput['perspective'];onPerspective:(p:GoalDraftInput['perspective'])=>void}){
  return <div className="case-form-row"><label>目标归属<select className="sg-select" value={scope?groupScopeKey(scope):''} onChange={e=>{const next=scopes.find(s=>groupScopeKey(s)===e.target.value);if(next)onScope(next);}}><option value="">选择归属范围</option>{scopes.map(s=><option value={groupScopeKey(s)} key={groupScopeKey(s)}>{s.name}</option>)}</select></label>{scope&&scope.kind!=='personal'&&<label>组织视角<select className="sg-select" value={perspective} onChange={e=>onPerspective(e.target.value as typeof perspective)}><option value="profit">营利组织</option><option value="nonprofit">非营利组织</option></select></label>}</div>;
}
export function MapGoalHandoff({version,scopes,onSaved,openOnMount=false,onClose}:{openOnMount?:boolean;onClose?:()=>void;version:StrategyMapVersion;scopes:GoalScope[];onSaved?:(goals:GoalVersion[])=>void}){
  const [open,setOpen]=useState(false),[selected,setSelected]=useState<string[]>([]),[scope,setScope]=useState<GoalScope>(),[perspective,setPerspective]=useState<'profit'|'nonprofit'|'personal'>('profit');
  const [index,setIndex]=useState<StrategyGoalsIndex>(),[busy,setBusy]=useState(false),[error,setError]=useState('');
  useEffect(()=>{if(openOnMount)void begin();else setOpen(false);},[openOnMount,version.mapId,version.version]);
  const close=()=>{setOpen(false);onClose?.();};
  async function begin(){setSelected(version.nodes.filter(n=>n.kind==='goal').map(n=>n.id));setScope(scopes.length===1?scopes[0]:undefined);setIndex(undefined);setError('');setOpen(true);try{setIndex(await listGoals());}catch(e){setError(errorMessage(e));}}
  async function submit(){if(!scope||!index)return;setBusy(true);setError('');
    try{const result=await request<Result>('handoff',{map:mapRef(version),selected,scope,perspective:scope.kind==='personal'?'personal':perspective,expected:expectedVersions(index,version.mapId,scope)});close();onSaved?.(result.goals??[]);}
    catch(e){setError(errorMessage(e));}finally{setBusy(false);}}
  return <>{!openOnMount&&<button className="secondary-button" type="button" disabled={!version.nodes.some(n=>n.kind==='goal')} onClick={()=>void begin()}>将此版带入目标管理</button>}{open&&<CaseDialog title="核对承接的目标与策略" subtitle={version.title+' · v'+version.version} busy={busy} onClose={close}>
    <ScopeSelect scopes={scopes} scope={scope} onScope={setScope} perspective={perspective} onPerspective={setPerspective}/>
    <fieldset><legend>承接范围</legend>{version.nodes.filter(n=>n.kind==='goal').map(n=><label className="sg-workbook-goal" key={n.id}><input type="checkbox" checked={selected.includes(n.id)} onChange={e=>setSelected(previous=>e.target.checked?[...previous,n.id]:previous.filter(id=>id!==n.id))}/><span>{n.id} · {n.title}<small>{version.edges.filter(edge=>edge.to===n.id && ['supports','hypothesis'].includes(edge.kind)&&version.nodes.some(s=>s.id===edge.from&&s.kind==='strategy')).map(edge=>version.nodes.find(s=>s.id===edge.from)!.title).join('、')||'关联策略待补'}</small></span></label>)}</fieldset>
    {error&&<p role="alert">{error}</p>}<div className="case-dialog-actions"><button className="secondary-button" disabled={busy} onClick={close}>取消</button><button className="primary-button" disabled={busy||!index||!scope||!selected.length} onClick={()=>void submit()}>保存目标候选</button></div>
  </CaseDialog>}</>;
}
export function StrategyWorkbookImport({discussionId,current,target='map',scopes=[],ensureDiscussionId,onSaved,openRequest,onOpenHandled}:{discussionId?:string;current?:StrategyMapVersion;target?:WorkbookTarget;scopes?:GoalScope[];ensureDiscussionId?:()=>Promise<string>;onSaved?:(result:Result)=>void;openRequest?:number;onOpenHandled?:()=>void}){
  const [open,setOpen]=useState(false),[book,setBook]=useState<StrategyWorkbook>(),[bytes,setBytes]=useState(''),[selection,setSelection]=useState<WorkbookSelection>({});
  const [title,setTitle]=useState(''),[template,setTemplate]=useState<keyof typeof mapTemplates>('table'),[revise,setRevise]=useState(false);
  const [scope,setScope]=useState<GoalScope>(),[perspective,setPerspective]=useState<'profit'|'nonprofit'|'personal'>('profit'),[group,setGroup]=useState('');
  const [index,setIndex]=useState<StrategyGoalsIndex>(),[busy,setBusy]=useState(false),[error,setError]=useState(''),[imageOnly,setImageOnly]=useState(false);
  const seq=useRef(0),id=useId();
  useEffect(()=>{if(openRequest){onOpenHandled?.();void begin();}},[openRequest]);
  const mapped=book?mapStrategyWorkbook(book,selection):undefined;
  const matchingGroups=new Map((index?.goals??[]).flatMap(g=>{const v=g.versions.at(-1)!;return scope&&v.structured?.workbook&&!v.structured.map&&groupScopeKey(v.scope)===groupScopeKey(scope)?[[v.structured.groupId,v.structured.planTitle] as const]:[];}));
  const previousNodes=target==='map'&&revise?current?.nodes.map(n=>({...n,metrics:mapNodeMetrics(n),sha:current.importSource?.sha256})):target==='goals'&&group?(index?.goals??[]).flatMap(g=>{const v=g.versions.at(-1)!;return v.structured?.groupId===group?[{id:v.structured.nodeId,title:v.title,metrics:v.structured.metrics,sha:v.structured.workbook?.sha256}]:[];}):undefined;
  const unstable=previousNodes&&mapped?unstableWorkbookMatches(previousNodes,mapped):[];
  function compareNode(n:NonNullable<typeof mapped>['nodes'][number]){
    const prior=previousNodes?.find(row=>row.id===n.id);
    if(!prior)return '新增';
    const values=(rows:typeof n.metrics)=>(rows??[]).map(m=>[m.metric,m.baseline,m.baselineKind,m.target,m.unit,m.period]);
    const changed=prior.title!==n.title||JSON.stringify(values(prior.metrics))!==JSON.stringify(values(n.metrics));
    const oldEdges=revise?current?.edges.filter(e=>e.from===n.id||e.to===n.id):undefined;
    const connections=(edges:{kind:string;from:string;to:string}[])=>edges.map(e=>JSON.stringify([e.kind,e.from,e.to])).sort().join('\n');
    if(changed || oldEdges && connections(oldEdges)!==connections(mapped!.edges.filter(e=>e.from===n.id||e.to===n.id)))return '变更';
    return '编号匹配';
  }
  function close(){seq.current++;setOpen(false);setBusy(false);}
  async function begin(){setBook(undefined);setBytes('');setImageOnly(false);setGroup('');setError('');setIndex(undefined);setScope(scopes.length===1?scopes[0]:undefined);setRevise(false);setTemplate(current?.template??'table');setOpen(true);if(target==='goals'){try{setIndex(await listGoals());}catch(e){setError(errorMessage(e));}}}
  async function loadFile(file:File){
    const token=++seq.current;setBook(undefined);setBytes('');setError('');setImageOnly(false);setBusy(true);
    try{if(file.size>8*1024*1024)throw new Error(errors.strategy_workbook_size);
      const raw=new Uint8Array(await file.arrayBuffer());let encoded='';for(let i=0;i<raw.length;i+=16384)encoded+=String.fromCharCode(...raw.subarray(i,i+16384));
      encoded=btoa(encoded);const {book}=await request<{book:StrategyWorkbook}>('preview',{fileName:file.name,bytes:encoded});
      if(token!==seq.current)return;
      setBook(book);setBytes(encoded);setSelection(defaultSelection(book,target));setTitle(file.name.replace(/\.xlsx$/i,''));}
    catch(e){if(token===seq.current)setError(errorMessage(e));}finally{if(token===seq.current)setBusy(false);}
  }
  async function commit(){
    if(!book||!mapped||!title.trim())return;setBusy(true);setError('');
    try{
      const dId=target==='map'?(discussionId??await ensureDiscussionId?.()):undefined;
      if(target==='map'&&!dId)throw new Error('请先选择一份战略讨论。');
      const input={bytes,fileName:book.fileName,target,title:title.trim(),selection:imageOnly?{}:selection,template,drawingsOnly:imageOnly,discussionId:dId,...(target==='map'&&revise&&current&&{base:mapRef(current)}),
        ...(target==='goals'&&scope&&{...(group&&{groupId:group}),destination:{scope,perspective:scope.kind==='personal'?'personal':perspective,expected:expectedVersions(index,group,scope)}})};
      const result=await request<Result>('commit',input);if(result.errors)throw new Error(result.errors.join(' '));close();onSaved?.(result);
    }catch(e){setError(errorMessage(e));}finally{setBusy(false);}
  }
  return <><button className="secondary-button" type="button" onClick={()=>void begin()}>导入 Excel</button>{open&&<CaseDialog title={target==='map'?'从 Excel 导入战略地图':'从 Excel 导入目标表'} className="sg-workbook-dialog" busy={busy} onClose={close}><div className="case-field"><label htmlFor={id}>线下工作簿（.xlsx）</label><input id={id} type="file" accept=".xlsx" disabled={busy} onChange={e=>{const f=e.target.files?.[0];if(f)void loadFile(f);}}/></div>
    {book&&<><label className="case-field">草稿名称<input value={title} maxLength={300} onChange={e=>setTitle(e.target.value)}/></label>
      {target==='map'?<><label>地图模板<select className="sg-select" value={template} onChange={e=>setTemplate(e.target.value as typeof template)}>{Object.entries(mapTemplates).map(([k,v])=><option key={k} value={k}>{v}</option>)}</select></label>{current&&<label>写入位置<select className="sg-select" value={revise?'revise':'new'} onChange={e=>setRevise(e.target.value==='revise')}><option value="new">新建地图候选</option><option value="revise">修订 {current.title} · v{current.version}</option></select></label>}</>:<><ScopeSelect scopes={scopes} scope={scope} onScope={s=>{setScope(s);setGroup('');}} perspective={perspective} onPerspective={setPerspective}/>{matchingGroups.size>0&&<label>目标表<select className="sg-select" value={group} onChange={e=>setGroup(e.target.value)}><option value="">新建目标表</option>{[...matchingGroups].map(([k,n])=><option key={k} value={k}>修订 {n}</option>)}</select></label>}</>}
      {book.drawings&&<p>工作簿含图形，原图随文件保留；节点和连线需核对。{target==='map'&&<label><input type="checkbox" checked={imageOnly} onChange={e=>setImageOnly(e.target.checked)}/>存为待整理的图形地图</label>}</p>}
      {!imageOnly&&<>{workbookKinds.map(kind=>{
        const m=selection[kind],sheet=book.sheets.find(s=>s.name===m?.name),label=kind==='goals'?'目标表':'战略地图';return <fieldset key={kind}><legend>{label}</legend><label>工作表<select className="sg-select" value={m?.name??''} onChange={e=>{const selected=book.sheets.find(s=>s.name===e.target.value);setSelection(old=>{const next={...old};if(selected)next[kind]=guessMapping(selected,kind);else delete next[kind];return next;});}}><option value="">跳过此类内容</option>{book.sheets.map(s=><option key={s.name}>{s.name}</option>)}</select></label>{sheet&&m&&<><label>表头行<input type="number" min="1" max={sheet.rows.at(-1)?.row??1} value={m.headerRow} onChange={e=>setSelection({...selection,[kind]:guessMapping(sheet,kind,Number(e.target.value))})}/></label><details><summary>核对或调整栏目映射</summary><div className="sg-workbook-fields">{Object.entries(workbookFields[kind]).map(([k,aliases])=><label key={k}>{aliases[0]}<select value={m.columns[k]??''} onChange={e=>setSelection({...selection,[kind]:{...m,columns:{...m.columns,[k]:e.target.value}}})}><option value="">未映射</option>{sheet.columns.map(c=><option key={c} value={c}>{c} · {sheet.rows.find(r=>r.row===m.headerRow)?.values[c]||'空白'}</option>)}</select></label>)}</div></details></>}</fieldset>})}
      {mapped&&<><div className="sg-table-scroll"><table className="sg-table"><caption>生成前核对</caption><thead><tr><th>原行</th><th>业务项</th><th>指标与数值</th><th>关联</th></tr></thead><tbody>{mapped.nodes.map(n=><tr key={n.id}><td>{mapped.importSource.rows.filter(r=>r.nodeId===n.id).map(r=>r.sheet+'!'+r.row).join('、')}</td><td>{n.id} · {n.title}{previousNodes&&<small>{compareNode(n)}</small>}</td><td>{n.metrics?.map(m=><div key={m.metric}>{m.metric} · {m.baseline??'基线待补'} → {m.target??'目标值待定'} {m.unit}</div>)}</td><td>{mapped.edges.filter(e=>e.to===n.id).map(e=>e.from).join('、')}</td></tr>)}</tbody></table></div>
      {previousNodes?.filter(n=>!mapped.nodes.some(next=>next.id===n.id)).map(n=><p key={n.id}>{n.id} · {n.title} 在新表中缺失{target==='map'?'，新版将移除此项':'，原目标版本保留'}。</p>)}
      {unstable.length>0&&<p role="alert">{errors.strategy_workbook_unstable_ids}（{unstable.join("、")}）</p>}{mapped.errors.length>0&&<ul role="status">{mapped.errors.map((e,i)=><li key={i}>{e}</li>)}</ul>}</>}</>}</>}
    {error&&<p role="alert">{error}</p>}<div className="case-dialog-actions"><button className="secondary-button" disabled={busy} onClick={close}>取消</button><button className="primary-button" disabled={busy||!book||!title.trim()||unstable.length>0||(!imageOnly&&!!mapped?.errors.length)||target==='goals'&&(!scope||!index||!mapped?.nodes.some(n=>n.kind==='goal'))} onClick={()=>void commit()}>{busy?'正在处理…':target==='map'?'生成地图草稿':'生成目标草稿'}</button></div>
  </CaseDialog>}</>;
}
