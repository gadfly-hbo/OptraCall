import {useEffect, useRef, useState} from 'react';
import type {ManagementStage} from './ManagementTabs.tsx';
import {mapTemplates, type StrategyMapRef, type StrategyMapVersion} from '../strategy-map-types.ts';
import type {GoalDiscussionSourceRef,GoalScope,GoalVersion} from '../strategy-goals-types.ts';
import type {StrategyDiscussionDetail} from '../strategy-discussion-types.ts';
import {StrategyMapPanel, type StrategyMapRereadRequest} from './StrategyMapPanel.tsx';
import {StrategySimulationPanel,type StrategyEdgeLocation} from './StrategySimulationPanel.tsx';
import {StrategyWorkbookImport,MapGoalHandoff,DownloadWorkbook} from './StrategyWorkbookImport.tsx';
import {StrategyAttachmentEvidence} from './StrategyAttachmentEvidence.tsx';
import {DownloadVersion} from './StrategyChoicePanel.tsx';
import {dismissStrategyMapImportDraft, strategyWorkbenchRequest} from './strategy-discussion-client.ts';

const keyOf=(r:StrategyMapRef)=>r.mapId+':'+r.version;

type UnreadableMap = StrategyMapRef & {reason:string};
interface Catalog {versions:StrategyMapVersion[];unavailable?:UnreadableMap[]}
function CandidateChoices({version}:{version:StrategyMapVersion}){
  const options=version.nodes.filter(n=>n.kind==='strategy');
  const goals=new Map(version.nodes.filter(n=>n.kind==='goal').map(n=>[n.id,n.title]));
  return <><div className="wb-table-wrap"><table><thead><tr><th>战略选择</th><th>支撑目标</th></tr></thead><tbody>
    {options.length?options.map(s=><tr key={s.id}><th scope="row">{s.title}</th><td>{version.edges.filter(e=>e.from===s.id && goals.has(e.to) && ['supports','hypothesis'].includes(e.kind)).map(e=>goals.get(e.to)+(e.kind==='hypothesis'?'（待验证）':'')).join('、') || '尚未声明关联'}</td></tr>):
      <tr><th scope="row">{version.title}</th><td>{[...goals.values()].join('、')||'尚未列出目标'}</td></tr>}
  </tbody></table></div>{(version.choice||version.unknowns)&&<details><summary>本版取舍与待核依据</summary><p>{version.choice}</p><p>{version.unknowns}</p></details>}</>;
}
function MapHandoffs({version}:{version:StrategyMapVersion}){
  const [goals,setGoals]=useState<{goalId:string;version:number;nodeId:string;title:string;scope:string;status:string}[]>(),[error,setError]=useState('');
  useEffect(()=>{
    const controller=new AbortController();
    strategyWorkbenchRequest<{goals:NonNullable<typeof goals>}>(version.discussionId,'/maps/'+version.mapId+'/versions/'+version.version+'/handoffs','GET',undefined,controller.signal)
      .then(r=>{if(!controller.signal.aborted)setGoals(r.goals);}).catch(e=>{if(!controller.signal.aborted)setError(e.message);});
    return ()=>controller.abort();
  },[version.discussionId,version.mapId,version.version]);
  if(error)return <p role="alert">{error}</p>;
  if(!goals)return null;
  return goals.length?<details><summary>已交接 {goals.length} 项目标</summary><ul>{goals.map(g=><li key={g.goalId+':'+g.version}>{g.nodeId} · {g.title} · {g.scope} · v{g.version} · {g.status==='candidate'?'待采用':'已有采用记录'}</li>)}</ul></details>:<p className="sg-muted">此版尚无目标交接记录。</p>;
}
import {StrategyMapImportDialog,type StrategyMapExtractRequest} from './StrategyMapImportDialog.tsx';

export function StrategyWorkbench({detail,stage,active,scopes,onStage,ensureDiscussionId,onDiscuss,onGoalsChanged,onSelectContext,sentRequest,onReconciled,importDialogOpen,onImportDialogOpenChange,onExtractMapImport,onRereadMap,onRefreshDiscussion}:{
 detail?:StrategyDiscussionDetail;stage:ManagementStage;active:boolean;scopes:GoalScope[];
 onStage:(stage:ManagementStage)=>void;ensureDiscussionId:()=>Promise<string>;
 sentRequest?:string;onReconciled:()=>void;onSelectContext:(ref:StrategyMapRef)=>void;
 onDiscuss:(ref?:StrategyMapRef,edgeId?:string,source?:GoalDiscussionSourceRef)=>void;onGoalsChanged:(goals?:GoalVersion[])=>Promise<void>;
 importDialogOpen?:boolean;onImportDialogOpenChange?:(open:boolean)=>void;
 onExtractMapImport?:(req:StrategyMapExtractRequest)=>Promise<void>;
 onRereadMap?:(req:StrategyMapRereadRequest)=>void;
 onRefreshDiscussion?:()=>Promise<void>|void;
}){
  const id=detail?.discussion.id;
  const [catalog,setCatalog]=useState<Catalog>({versions:[]}), [selected,setSelected]=useState<StrategyMapRef>();
  const [activeDraftGroupId,setActiveDraftGroupId]=useState<string>();
  const [localImportOpen,setLocalImportOpen]=useState(false);
  const [excelImportReq,setExcelImportReq]=useState(0);
  const [simulationEdge,setSimulationEdge]=useState<StrategyEdgeLocation>(),[returnEdge,setReturnEdge]=useState<StrategyEdgeLocation>();
  const [handoff,setHandoff]=useState<StrategyMapRef>(), [error,setError]=useState(''),[loading,setLoading]=useState(false),[refresh,setRefresh]=useState(0);
  const [status,setStatus]=useState(''),[simulationVisit,setSimulationVisit]=useState(0);
  const fetched=useRef(0);
  const openImport=importDialogOpen!==undefined?importDialogOpen:localImportOpen;
  const setOpenImport=(next:boolean)=>{if(onImportDialogOpenChange)onImportDialogOpenChange(next);else setLocalImportOpen(next);};
  const version=selected?catalog.versions.find(v=>keyOf(v)===keyOf(selected)):catalog.versions.at(-1);
  const handoffMap=catalog.versions.find(v=>handoff && keyOf(v)===keyOf(handoff));

  const pendingDrafts=detail?.mapImportDrafts ?? [];
  const pendingDraft=pendingDrafts.find(d=>d.draftGroupId===activeDraftGroupId) ?? pendingDrafts[0];

  useEffect(()=>{
    if(!pendingDrafts.length){
      setActiveDraftGroupId(undefined);
    }else if(!activeDraftGroupId || !pendingDrafts.some(d=>d.draftGroupId===activeDraftGroupId)){
      setActiveDraftGroupId(pendingDrafts[0]!.draftGroupId);
    }
  },[id,pendingDrafts.map(d=>d.draftGroupId).join(',')]);

  useEffect(()=>{
    if(!active || !id)return;
    const controller=new AbortController(),ticket=++fetched.current;
    setLoading(true);setError('');
    strategyWorkbenchRequest<Catalog>(id,'/maps','GET',undefined,controller.signal).then(data=>{
      if(controller.signal.aborted || fetched.current!==ticket)return;
      setCatalog(data);
      if(sentRequest && sentRequest===detail?.discussion.lastRun?.id && detail.discussion.lastRun.status==='completed'){
        const candidate=data.versions.filter(v=>v.requestId===sentRequest).at(-1);
        if(candidate){setSelected(candidate);onSelectContext(candidate);}
        onReconciled();
      }
    }).catch(e=>{if(!controller.signal.aborted && fetched.current===ticket){setCatalog({versions:[]});setError(e.message);}})
      .finally(()=>{if(!controller.signal.aborted && fetched.current===ticket)setLoading(false);});
    return ()=>controller.abort();
  },[active,id,detail?.discussion.revision,detail?.discussion.lastRun?.status,detail?.mapImportDrafts?.map(d=>d.entryId).join(','),sentRequest,stage,refresh]);

  async function saved(v:StrategyMapVersion){
    ++fetched.current;setLoading(false);
    setCatalog(old=>({...old,versions:[...old.versions.filter(x=>keyOf(x)!==keyOf(v)),v]}));
    setSelected(v);onSelectContext(v);setReturnEdge(undefined);setRefresh(n=>n+1);
    await onRefreshDiscussion?.();
    setStatus('已保存 '+v.title+' · v'+v.version);
  }
  async function dismissPendingDraft(entryId:string){
    if(!id)return;
    await dismissStrategyMapImportDraft(id,entryId);
    await onRefreshDiscussion?.();
    setStatus('已放弃本次导入草稿，未写入新的战略地图版本。');
  }
  function select(ref:StrategyMapRef){setSelected(ref);onSelectContext(ref);setHandoff(undefined);setReturnEdge(undefined);}
  const versionOptions=catalog.versions.map(v=><option key={keyOf(v)} value={keyOf(v)}>{v.title} · v{v.version}</option>);
  const picker=Boolean(catalog.versions.length) && <label>地图版本 <select value={version?keyOf(version):''} onChange={e=>{const v=catalog.versions.find(x=>keyOf(x)===e.target.value);if(v)select(v);}}>{!version && <option value="">所选版本不可读 · 选择其他版本</option>}{versionOptions}</select></label>;
  const importer=<StrategyWorkbookImport discussionId={id} current={version} ensureDiscussionId={ensureDiscussionId} openRequest={excelImportReq} onOpenHandled={()=>setExcelImportReq(0)} onSaved={result=>{if(result.version){void saved(result.version);onStage('compare');}}}/>;
  return <div className="strategy-workbench">
    {error && <p role="alert">{error} <button className="text-button" onClick={()=>setRefresh(n=>n+1)}>重新读取地图</button></p>}
    {Boolean(catalog.unavailable?.length) && <details><summary>{catalog.unavailable!.length} 个版本的来源当前不可读取</summary>{catalog.unavailable!.map(v=><p key={keyOf(v)}>{v.mapId} · v{v.version} · {v.reason}</p>)}</details>}
    {Boolean(detail?.unavailableMapImportDrafts?.length) && <details><summary>{detail!.unavailableMapImportDrafts!.length} 份导入草稿的原稿当前不可读取（已撤权或不可用）</summary>{detail!.unavailableMapImportDrafts!.map(d=><p key={d.entryId}>{d.entryId} · {d.reason}</p>)}</details>}
    {stage==='direction' && pendingDraft && <section className="wb-candidate"><div className="sg-row-between"><h3>待核对导入草稿{pendingDrafts.length>1?`（共 ${pendingDrafts.length} 份）`:''} · {pendingDraft.draft.title}（尚未保存）</h3><button className="primary-button" onClick={()=>onStage('compare')}>前往对照原稿核对</button></div></section>}
    {stage==='direction' && version && <section className="wb-candidate"><div className="sg-row-between"><h3>当前候选 · {version.title}</h3><button className="text-button" onClick={()=>onStage('compare')}>打开战略地图 · v{version.version}</button></div><CandidateChoices version={version}/></section>}
    {stage==='compare' && <>
      {selected && !version && picker}
      {id && <StrategyMapPanel discussionId={id} versions={catalog.versions} selected={selected??version} pendingDrafts={pendingDrafts} pendingDraft={pendingDraft} onSelectPendingDraft={setActiveDraftGroupId} onDismissPendingDraft={dismissPendingDraft} onDraftConflictRefresh={async()=>{setRefresh(n=>n+1);await onRefreshDiscussion?.();}} onSelect={select} onSaved={saved} onDiscuss={onDiscuss} onOpenImport={onExtractMapImport?()=>setOpenImport(true):undefined} onReread={onRereadMap} onRevoked={()=>{setRefresh(n=>n+1);void onRefreshDiscussion?.();}} onSimulate={(ref,edgeId)=>{setSimulationEdge({mapId:ref.mapId,version:ref.version,edgeId});setSimulationVisit(v=>v+1);onStage('handoff');}} onHandoff={v=>{select(v);setHandoff(v);}} focusEdgeId={returnEdge && version && keyOf(version)===keyOf(returnEdge)?returnEdge.edgeId:undefined}/>}
      {!id && <div className="sg-row"><p>可从原战略讨论形成候选，或导入线下整理的战略图。</p>{onExtractMapImport&&<button type="button" className="primary-button" onClick={()=>setOpenImport(true)}>导入战略图</button>}</div>}{importer}
    </>}
    {stage==='handoff' && (id && (catalog.versions.length || !loading) ? <StrategySimulationPanel key={id+':'+simulationVisit} discussionId={id} versions={catalog.versions} origin={simulationEdge} onReturn={e=>{setSelected(e);setReturnEdge(e);onStage('compare');}}/>:<p>{loading?'正在读取可比较的版本…':'选择原讨论后，可比较其中的候选版本。'}</p>)}
    {stage==='strategy-versions' && <section className="wb-history"><div className="sg-row-between"><h3>地图修订记录</h3>{picker}</div>
      {version?<><h4>{version.title} · v{version.version}</h4><p>{version.reason}</p><p className="sg-muted">{mapTemplates[version.template]} · {{user:'用户编辑',agent:'Agent 共创',import:'Excel 导入'}[version.author]} · {new Date(version.createdAt).toLocaleString('zh-CN')}</p>
        <div className="sg-row"><button className="secondary-button" onClick={()=>{setSelected(version);onStage('compare');}}>查看此版地图</button><button className="text-button" onClick={()=>onDiscuss(version,undefined,version.replySource??version.source)}>返回原讨论</button><DownloadVersion key={keyOf(version)} route={'/api/strategy/discussions/'+id+'/maps/'+version.mapId+'/versions/'+version.version+'/export'}/><button className="text-button" onClick={()=>setHandoff(version)}>带入目标管理</button></div>
        <MapHandoffs key={keyOf(version)} version={version}/>{version.citations.map(c=><StrategyAttachmentEvidence key={c.token} discussionId={id!} citation={c}/>)}
        {version.importSource && <details><summary>{version.importSource.fileName} · 导入工作表</summary><DownloadWorkbook version={version}/><p>SHA-256 {version.importSource.sha256}</p>{version.importSource.rows.map((r,i)=><p key={i}>{r.nodeId} · {r.sheet} · 第 {r.row} 行</p>)}</details>}
        {version.importSources?.map(src=><details key={src.sourceId}><summary>{src.fileName} · 多格式导入原稿（{src.format.toUpperCase()}）</summary><p>来源：{src.origin} · SHA-256 {src.sha256}{src.selectedPages?.length?` · 选页 ${src.selectedPages.join('、')}`:''}</p></details>)}
      </>:<p>{loading?'正在读取地图版本…':'这段讨论尚无可读取的地图修订。'}</p>}
    </section>}
    {onExtractMapImport && <StrategyMapImportDialog open={openImport} discussionId={id} busy={Boolean(detail?.busy)} ensureDiscussionId={ensureDiscussionId} onClose={()=>setOpenImport(false)} onExtract={onExtractMapImport} onOpenExcelFast={()=>{onStage('compare');setExcelImportReq(n=>n+1);}}/>}
    {handoffMap && (stage==='compare' || stage==='strategy-versions') && <MapGoalHandoff key={keyOf(handoffMap)} version={handoffMap} scopes={scopes} openOnMount={true} onClose={()=>setHandoff(undefined)} onSaved={goals=>{void onGoalsChanged(goals).then(()=>onStage('goals')).catch(e=>setError(String(e)));}}/>}
    {status && <p role="status">{status}</p>}
  </div>;
}
