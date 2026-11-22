import {useEffect,useId,useRef,useState} from 'react';
import type {GoalScope,GoalVersion} from '../strategy-goals-types.ts';
import {mapTemplates,type StrategyMapPublication,type StrategyMapRef,type StrategyMapVersion} from '../strategy-map-types.ts';
import {strategyWorkbenchRequest} from './strategy-discussion-client.ts';
import {CaseDialog} from './CaseDialogs.tsx';
import {MapGoalHandoff} from './StrategyWorkbookImport.tsx';

const keyOf=(ref:StrategyMapRef)=>ref.mapId+':'+ref.version;
const publicationOf=(records:StrategyMapPublication[],version:StrategyMapVersion)=>records.find(record=>
  record.mapId===version.mapId&&record.version===version.version&&record.contentSha256===version.contentSha256);
const statusOf=(publication?:StrategyMapPublication)=>publication?.state??'candidate';
const statusLabel=(status:string)=>({candidate:'未发布候选',active:'当前发布',superseded:'已被替代',withdrawn:'已撤销'}[status]!);
const statusClass=(status:string)=>({candidate:'pending',active:'ok',superseded:'warn',withdrawn:'error'}[status]!);
const dateText=(value:string)=>new Date(value).toLocaleString('zh-CN');
const strategyCount=(version:StrategyMapVersion)=>version.nodes.filter(node=>node.kind==='strategy').length;
const goalCount=(version:StrategyMapVersion)=>version.nodes.filter(node=>node.kind==='goal').length;
const strategiesFor=(version:StrategyMapVersion,nodeId:string)=>version.edges
  .filter(edge=>edge.to===nodeId&&['supports','hypothesis'].includes(edge.kind)&&version.nodes.some(node=>node.id===edge.from&&node.kind==='strategy'))
  .map(edge=>version.nodes.find(node=>node.id===edge.from)!.title+(edge.kind==='hypothesis'?'（待验证）':''));

function Handoffs({version}:{version:StrategyMapVersion}){
  const [rows,setRows]=useState<{goalId:string;version:number;nodeId:string;title:string;scope:string;status:string;publicationId?:string;historical:boolean}[]>(),[error,setError]=useState('');
  useEffect(()=>{
    const controller=new AbortController();
    setRows(undefined);setError('');
    strategyWorkbenchRequest<{goals:NonNullable<typeof rows>}>(version.discussionId,'/maps/'+version.mapId+'/versions/'+version.version+'/handoffs','GET',undefined,controller.signal)
      .then(result=>{if(!controller.signal.aborted)setRows(result.goals);})
      .catch(fault=>{if(!controller.signal.aborted)setError(fault.message);});
    return()=>controller.abort();
  },[version.discussionId,version.mapId,version.version,version.contentSha256]);
  if(error)return <p role="alert">{error}</p>;
  if(!rows)return <p className="sg-muted">正在读取承接记录…</p>;
  if(!rows.length)return <p className="sg-muted">此版尚无目标承接记录。</p>;
  return <ul className="release-handoff-list">{rows.map(row=><li key={row.goalId+':'+row.version}>
    <div className="release-handoff-item"><strong>{row.nodeId} · {row.title}</strong><span className={`sg-badge ${row.historical?'pending':'ok'}`}>{row.historical?'历史承接':'发布后承接'}</span></div>
    <p className="sg-muted">{row.scope} · v{row.version} · {row.status==='candidate'?'待采用':'已有采用记录'}{row.publicationId?' · '+row.publicationId:' · 发布功能上线前'}</p>
  </li>)}</ul>;
}

export function StrategyReleasePanel({discussionId,versions,selected,scopes,onSelect,onStage,onGoalsChanged,onRefresh}:{
  discussionId?:string;versions:StrategyMapVersion[];selected?:StrategyMapRef;scopes:GoalScope[];
  onSelect:(version:StrategyMapVersion)=>void;onStage:(stage:'compare'|'goals')=>void;
  onGoalsChanged:(goals?:GoalVersion[])=>Promise<void>;onRefresh:()=>Promise<void>|void;
}){
  const id=useId(),ticket=useRef(0);
  const version=selected?versions.find(item=>keyOf(item)===keyOf(selected)):versions.at(-1);
  const [records,setRecords]=useState<StrategyMapPublication[]>([]),[loading,setLoading]=useState(false),[error,setError]=useState('');
  const [status,setStatus]=useState(''),[busy,setBusy]=useState(false),[refresh,setRefresh]=useState(0);
  const [confirming,setConfirming]=useState<StrategyMapVersion>(),[withdrawing,setWithdrawing]=useState<StrategyMapVersion>();
  const [handoff,setHandoff]=useState<{version:StrategyMapVersion;publication:StrategyMapPublication}>();

  useEffect(()=>{
    if(!discussionId||!version?.mapId){setRecords([]);return;}
    const controller=new AbortController(),current=++ticket.current;
    setLoading(true);setError('');
    strategyWorkbenchRequest<{publications:StrategyMapPublication[]}>(discussionId,'/maps/'+version.mapId+'/publications','GET',undefined,controller.signal)
      .then(result=>{if(controller.signal.aborted||ticket.current!==current)return;setRecords(result.publications);})
      .catch(fault=>{if(controller.signal.aborted||ticket.current!==current)return;setRecords([]);setError(fault.message);})
      .finally(()=>{if(!controller.signal.aborted&&ticket.current===current)setLoading(false);});
    return()=>controller.abort();
  },[discussionId,version?.mapId,version?.version,version?.contentSha256,refresh,versions.map(item=>keyOf(item)).join(',')]);

  const publication=version?publicationOf(records,version):undefined,releaseStatus=statusOf(publication),mapVersions=versions.filter(item=>!version||item.mapId===version.mapId).slice().reverse();
  async function mutateVersion(target:StrategyMapVersion,path:'publication'|'publication/withdraw',success:string){
    if(!discussionId)return;
    setBusy(true);setError('');
    try{
      const input=path==='publication'
        ?{operationId:crypto.randomUUID(),sha256:target.contentSha256}
        :{operationId:crypto.randomUUID(),publicationId:publicationOf(records,target)?.publicationId,sha256:target.contentSha256};
      const result=await strategyWorkbenchRequest<{publication:StrategyMapPublication}>(discussionId,'/maps/'+target.mapId+'/versions/'+target.version+'/'+path,'POST',input);
      setRecords(old=>path==='publication'
        ? [...old.map(record=>record.mapId===target.mapId&&record.state==='active'?{...record,state:'superseded' as const,supersededAt:result.publication.publishedAt}:record),result.publication]
        : old.map(record=>record.publicationId===result.publication.publicationId?result.publication:record));
      setStatus(success+result.publication.publicationId+'。');
      await onRefresh();
    }catch(fault){setError(fault instanceof Error?fault.message:String(fault));}
    finally{setBusy(false);}
  }

  if(!discussionId||!version)return <section className="sg-panel strategy-release"><h2>战略发布</h2><p className="sg-muted">选择原讨论后，可核对候选地图并正式发布。</p></section>;
  const goals=version.nodes.filter(node=>node.kind==='goal');
  return <section className="sg-panel strategy-release" aria-labelledby={id+'-title'}>
    <div className="sg-row-between"><div><h2 id={id+'-title'}>战略发布</h2><p className="sg-muted">先核对候选地图的准确版本；正式发布后，才能从本页带入目标管理。</p></div><span className={`sg-badge ${statusClass(releaseStatus)}`}>{statusLabel(releaseStatus)}</span></div>
    <div className="release-grid">
      <label>待核对地图版本<select value={keyOf(version)} onChange={event=>{const next=versions.find(item=>keyOf(item)===event.target.value);if(next)onSelect(next);}}>
        {mapVersions.map(item=><option key={keyOf(item)} value={keyOf(item)}>{item.title} · v{item.version} · {statusLabel(statusOf(publicationOf(records,item)))}</option>)}
      </select></label>
      <div className="release-identity"><span className="sg-muted">准确身份</span><strong className="mono">{version.mapId} · v{version.version}</strong><span className="mono">sha256:{version.contentSha256}</span></div>
    </div>

    <div className="release-summary">
      <div className="sg-row-between"><h3>{version.title} · v{version.version}</h3><span className={`sg-badge ${statusClass(releaseStatus)}`}>{statusLabel(releaseStatus)}</span></div>
      <dl className="sg-details">
        <div><dt>来源</dt><dd>{mapTemplates[version.template]} · {version.author} · {version.reason}</dd></div>
        <div><dt>保存时间</dt><dd>{dateText(version.createdAt)}</dd></div>
        <div><dt>发布记录</dt><dd>{publication?publication.publicationId+' · 发布 '+dateText(publication.publishedAt)+(publication.supersededAt?' · 替代 '+dateText(publication.supersededAt):'')+(publication.withdrawnAt?' · 撤销 '+dateText(publication.withdrawnAt):''):'尚未发布'}</dd></div>
        <div><dt>范围</dt><dd>{goalCount(version)} 个目标 · {strategyCount(version)} 个策略</dd></div>
      </dl>
      <details open><summary>目标与策略核对</summary><div className="wb-table-wrap"><table><thead><tr><th>目标</th><th>关联策略</th></tr></thead><tbody>
        {goals.length?goals.map(goal=><tr key={goal.id}><th scope="row">{goal.id} · {goal.title}</th><td>{strategiesFor(version,goal.id).join('、')||'关联策略待补'}</td></tr>):
          <tr><th scope="row">此版无目标节点</th><td>可发布为地图记录；无可承接目标。</td></tr>}
      </tbody></table></div></details>
      {(version.choice||version.unknowns)&&<details><summary>取舍与待核依据</summary><p>{version.choice}</p><p className="sg-muted">{version.unknowns}</p></details>}
      <div className="release-actions">
        {releaseStatus==='candidate'&&<button type="button" className="secondary-button" disabled={busy} onClick={()=>setConfirming(version)}>核对此版并正式发布</button>}
        {releaseStatus==='active'&&publication&&<><button type="button" className="primary-button" disabled={!goals.length} onClick={()=>setHandoff({version,publication})}>带入目标管理</button><button type="button" className="secondary-button" disabled={busy} onClick={()=>setWithdrawing(version)}>撤销发布</button></>}
        {releaseStatus==='active'&&!goals.length&&<span className="sg-muted">此版无目标节点，不能带入目标管理。</span>}
        <button type="button" className="secondary-button" onClick={()=>{onSelect(version);onStage('compare');}}>查看此版地图</button>
      </div>
      {status&&<p className="sg-status" role="status">{status}</p>}
      {error&&<p role="alert">{error} <button className="text-button" type="button" onClick={()=>setRefresh(value=>value+1)}>重新读取发布记录</button></p>}
      {loading&&<p className="sg-muted">正在读取发布记录…</p>}
    </div>

    <div className="release-columns">
      <div><h3>发布记录</h3><p className="sg-muted">同一地图只有一个当前发布；发布新版后，旧发布转为「已被替代」并保留记录。</p>
        <ul className="release-record-list">{mapVersions.map(item=>{const record=publicationOf(records,item),state=statusOf(record);return <li key={keyOf(item)}>
          <div className="release-handoff-item"><strong>{item.title} · v{item.version}</strong><span className={`sg-badge ${statusClass(state)}`}>{statusLabel(state)}</span></div>
          <p className="sg-muted">{record?record.publicationId+' · 发布 '+dateText(record.publishedAt)+(record.supersededAt?' · 替代 '+dateText(record.supersededAt):'')+(record.withdrawnAt?' · 撤销 '+dateText(record.withdrawnAt):''):'尚未发布 · 保存 '+dateText(item.createdAt)} · <span className="mono">{item.contentSha256}</span></p>
          <div className="sg-row"><button className="text-button" type="button" onClick={()=>onSelect(item)}>选择核对</button><span className="sg-muted">{state==='active'?'当前唯一可承接版本':'不可承接'}</span></div>
        </li>;})}</ul>
      </div>
      <div><h3>承接记录</h3><p className="sg-muted">旧数据保留；缺少发布身份的记录标为历史承接，不自动升级到最新发布。</p><Handoffs version={version}/></div>
    </div>

    {confirming&&<CaseDialog title="确认正式发布战略地图" subtitle={confirming.title+' · v'+confirming.version} busy={busy} onClose={()=>setConfirming(undefined)}>
      <dl className="sg-details">
        <div><dt>准确身份</dt><dd className="mono">{confirming.mapId} · v{confirming.version} · {confirming.contentSha256}</dd></div>
        <div><dt>版本来源</dt><dd>{confirming.author} · {confirming.reason}</dd></div>
        <div><dt>将冻结</dt><dd>{goalCount(confirming)} 个目标节点、{strategyCount(confirming)} 个策略节点</dd></div>
      </dl>
      <p className="case-help">正式发布不会创建目标、采用目标、启动 Case 或项目。后续编辑会生成新的候选版本，需再次核对发布。</p>
      <div className="case-dialog-actions"><button className="secondary-button" disabled={busy} onClick={()=>{setConfirming(undefined);setStatus('已取消发布确认，未写入发布记录。');}}>取消</button><button className="primary-button" disabled={busy} onClick={()=>void mutateVersion(confirming,'publication','已正式发布，发布记录 ').then(()=>setConfirming(undefined))}>确认正式发布</button></div>
    </CaseDialog>}

    {withdrawing&&publication&&<CaseDialog title="撤销这次发布？" subtitle={withdrawing.title+' · v'+withdrawing.version+' · '+publication.publicationId} busy={busy} onClose={()=>setWithdrawing(undefined)}>
      <p>撤销后，这个版本不能再被带入目标管理；地图版本、发布记录、已保存目标候选和历史引用都保留。</p>
      <p className="sg-muted">本产品不允许撤销后重新发布同一版本；恢复承接需先编辑产生新的候选版本。</p>
      <div className="case-dialog-actions"><button className="secondary-button" disabled={busy} onClick={()=>{setWithdrawing(undefined);setStatus('已取消撤销发布，当前发布状态保持不变。');}}>取消</button><button className="secondary-button danger-button" disabled={busy} onClick={()=>void mutateVersion(withdrawing,'publication/withdraw','已撤销发布，发布记录 ').then(()=>setWithdrawing(undefined))}>确认撤销发布</button></div>
    </CaseDialog>}

    {handoff&&<MapGoalHandoff key={handoff.publication.publicationId} version={handoff.version} publication={handoff.publication} scopes={scopes} openOnMount
      onClose={()=>setHandoff(undefined)} onSaved={goals=>void onGoalsChanged(goals).then(()=>{setStatus('已保存 '+goals.length+' 项目标候选；后续采用仍在目标管理中核对。');onStage('goals');}).catch(fault=>setError(String(fault)))}/>}
  </section>;
}
