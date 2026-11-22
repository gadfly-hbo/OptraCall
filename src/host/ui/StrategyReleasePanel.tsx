import {useEffect,useId,useState} from 'react';
import type {GoalScope,GoalVersion} from '../strategy-goals-types.ts';
import {mapTemplates,type StrategyMapPublication,type StrategyMapRef,type StrategyMapVersion} from '../strategy-map-types.ts';
import {StrategyDiscussionRequestError,strategyWorkbenchRequest} from './strategy-discussion-client.ts';
import {StrategyAttachmentEvidence} from './StrategyAttachmentEvidence.tsx';
import {DownloadVersion} from './StrategyChoicePanel.tsx';
import {CaseDialog} from './CaseDialogs.tsx';
import {MapGoalHandoff} from './StrategyWorkbookImport.tsx';

const keyOf=(ref:StrategyMapRef)=>ref.mapId+':'+ref.version;
const publicationOf=(result:PublicationResult|undefined,version:StrategyMapVersion)=>{
  const record=result?.records.get(version.version);
  return record?.mapId===version.mapId&&record.contentSha256===version.contentSha256?record:undefined;
};
const statusOf=(publication?:StrategyMapPublication)=>publication?.state??'candidate';
const statusLabel=(status:string)=>({candidate:'未发布候选',active:'当前发布',superseded:'已被替代',withdrawn:'已撤销'}[status]!);
const statusClass=(status:string)=>({candidate:'pending',active:'ok',superseded:'warn',withdrawn:'error'}[status]!);
const authorLabel={user:'用户编辑',agent:'Agent 共创',import:'文件导入'};
const dateText=(value:string)=>new Date(value).toLocaleString('zh-CN');
const strategyCount=(version:StrategyMapVersion)=>version.nodes.filter(node=>node.kind==='strategy').length;
const goalCount=(version:StrategyMapVersion)=>version.nodes.filter(node=>node.kind==='goal').length;
const strategiesFor=(version:StrategyMapVersion,nodeId:string)=>version.edges
  .filter(edge=>edge.to===nodeId&&['supports','hypothesis'].includes(edge.kind)&&version.nodes.some(node=>node.id===edge.from&&node.kind==='strategy'))
  .map(edge=>version.nodes.find(node=>node.id===edge.from)!.title+(edge.kind==='hypothesis'?'（待验证）':''));

type PublicationResult={records:Map<number,StrategyMapPublication>;latestPublishedVersion:number;error?:string};
type PublicationChange={version:StrategyMapVersion;operationId:string;publication?:StrategyMapPublication};
const canPublish=(version:StrategyMapVersion,result?:PublicationResult)=>
  Boolean(result&&!result.error&&result.latestPublishedVersion<version.version);

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

export function StrategyReleasePanel({discussionId,versions,selected,scopes,onSelect,onStage,onDiscuss,onGoalsChanged}:{
  discussionId?:string;versions:StrategyMapVersion[];selected?:StrategyMapRef;scopes:GoalScope[];
  onSelect:(version:StrategyMapVersion)=>void;onStage:(stage:'compare'|'goals')=>void;onDiscuss:(version:StrategyMapVersion)=>void;
  onGoalsChanged:(goals?:GoalVersion[])=>Promise<void>;
}){
  const id=useId();
  const [catalog,setCatalog]=useState<{key:string;byMap:Map<string,PublicationResult>}>();
  const [error,setError]=useState('');
  const [status,setStatus]=useState(''),[busy,setBusy]=useState(false),[refresh,setRefresh]=useState(0);
  const [change,setChange]=useState<PublicationChange>();
  const [handoff,setHandoff]=useState<{version:StrategyMapVersion;publication:StrategyMapPublication}>();
  const available=versions.filter(item=>item.discussionId===discussionId);
  const newest=available.slice().reverse();
  const groups=new Map<string,StrategyMapVersion[]>();
  for(const item of newest){
    const group=groups.get(item.mapId);
    if(group)group.push(item);
    else groups.set(item.mapId,[item]);
  }
  const mapIds=[...groups.keys()].sort().join(',');
  const catalogKey=discussionId+':'+mapIds+':'+refresh;
  const byMap=catalog?.key===catalogKey?catalog.byMap:undefined;
  const version=available.find(item=>selected&&keyOf(item)===keyOf(selected))
    ??newest.find(item=>canPublish(item,byMap?.get(item.mapId)))??newest[0];
  const latestCandidates=new Map([...groups].map(([mapId,items])=>[mapId,items.find(item=>canPublish(item,byMap?.get(mapId)))]));

  useEffect(()=>{
    if(!discussionId||!mapIds)return;
    const controller=new AbortController();
    const read=async(mapId:string):Promise<[string,PublicationResult]>=>{
      try{
        const {publications}=await strategyWorkbenchRequest<{publications:StrategyMapPublication[]}>(discussionId,'/maps/'+mapId+'/publications','GET',undefined,controller.signal);
        const records=new Map(publications.map(record=>[record.version,record]));
        const latestPublishedVersion=publications.reduce((latest,record)=>Math.max(latest,record.version),0);
        return [mapId,{records,latestPublishedVersion}];
      }catch(fault){
        return [mapId,{records:new Map(),latestPublishedVersion:0,error:fault instanceof Error?fault.message:String(fault)}];
      }
    };
    void Promise.all(mapIds.split(',').map(read)).then(results=>{
      if(!controller.signal.aborted)setCatalog({key:catalogKey,byMap:new Map(results)});
    });
    return()=>controller.abort();
  },[discussionId,mapIds,catalogKey]);

  function beginChange(version:StrategyMapVersion,publication?:StrategyMapPublication){
    onSelect(version);setStatus('');setError('');
    setChange({version,publication,operationId:crypto.randomUUID()});
  }
  function closeChange(){
    if(!error)setStatus(change?.publication?'已取消撤销发布，当前发布状态保持不变。':'已取消发布确认，未写入发布记录。');
    setError('');setChange(undefined);
  }
  async function mutateVersion(){
    if(!change||busy)return;
    const {version,operationId,publication}=change,withdraw=Boolean(publication);
    setBusy(true);setError('');
    try{
      const input={operationId,sha256:version.contentSha256,...(publication&&{publicationId:publication.publicationId})};
      const suffix='/maps/'+version.mapId+'/versions/'+version.version+'/publication'+(withdraw?'/withdraw':'');
      const result=await strategyWorkbenchRequest<{publication:StrategyMapPublication}>(version.discussionId,suffix,'POST',input);
      setStatus((withdraw?'已撤销发布，发布记录 ':'已正式发布，发布记录 ')+result.publication.publicationId+'。');
      setChange(undefined);
    }catch(fault){
      const code=fault instanceof StrategyDiscussionRequestError?fault.code:undefined;
      setError(code==='strategy_map_publication_version_outdated'?'此版早于已有的发布版本。请核对更新的候选。'
        :code==='strategy_map_publication_already_published'?'此版已有发布记录，请重新核对。'
        :fault instanceof Error?fault.message:String(fault));
    }finally{
      setRefresh(value=>value+1);
      setBusy(false);
    }
  }

  if(!discussionId||!version)return <section className="sg-panel strategy-release"><h2>战略发布</h2><p className="sg-muted">选择原讨论后，可核对候选地图并正式发布。</p></section>;
  const selectedResult=byMap?.get(version.mapId);
  const publication=publicationOf(selectedResult,version);
  const releaseStatus=statusOf(publication);
  const stateLabel=(item:StrategyMapVersion)=>{
    const result=byMap?.get(item.mapId);
    if(!result)return '正在读取';
    if(result.error)return '发布状态不可读取';
    const state=statusOf(publicationOf(result,item));
    if(state==='active'&&!goalCount(item))return '当前发布 · 无可承接目标';
    return latestCandidates.get(item.mapId)===item?'未发布候选（最新）':statusLabel(state);
  };
  const confirming=change&&!change.publication?change.version:undefined;
  const withdrawing=change?.publication?change.version:undefined;
  const goals=version.nodes.filter(node=>node.kind==='goal');
  return <section className="sg-panel strategy-release" aria-labelledby={id+'-title'}>
    <div><h2 id={id+'-title'}>战略发布</h2><p className="sg-muted">先核对候选地图的准确版本；正式发布后，才能从本页带入目标管理。</p></div>
    <div className="release-grid">
      <label>待核对地图版本<select value={keyOf(version)} onChange={event=>{const next=available.find(item=>keyOf(item)===event.target.value);if(next)onSelect(next);}}>
        {[...groups].map(([mapId,items])=><optgroup key={mapId} label={items[0]!.title}>
          {items.map(item=><option key={keyOf(item)} value={keyOf(item)}>{item.title} · v{item.version} · {stateLabel(item)}</option>)}
        </optgroup>)}
      </select></label>
      <div className="release-identity"><span className="sg-muted">准确身份</span><strong className="mono">{version.mapId} · v{version.version}</strong><span className="mono">sha256:{version.contentSha256}</span></div>
    </div>

    <div className="release-summary">
      <div className="sg-row-between"><h3>{version.title} · v{version.version}</h3><span className={`sg-badge ${statusClass(releaseStatus)}`}>{stateLabel(version)}</span></div>
      <dl className="sg-details">
        <div><dt>来源</dt><dd>{mapTemplates[version.template]} · {authorLabel[version.author]} · {version.reason}</dd></div>
        <div><dt>保存时间</dt><dd>{dateText(version.createdAt)}</dd></div>
        <div><dt>发布记录</dt><dd>{publication?publication.publicationId+' · 发布 '+dateText(publication.publishedAt)+(publication.supersededAt?' · 替代 '+dateText(publication.supersededAt):'')+(publication.withdrawnAt?' · 撤销 '+dateText(publication.withdrawnAt):''):stateLabel(version)}</dd></div>
        <div><dt>范围</dt><dd>{goalCount(version)} 个目标 · {strategyCount(version)} 个策略</dd></div>
      </dl>
      <details open><summary>目标与策略核对</summary><div className="wb-table-wrap"><table><thead><tr><th>目标</th><th>关联策略</th></tr></thead><tbody>
        {goals.length?goals.map(goal=><tr key={goal.id}><th scope="row">{goal.id} · {goal.title}</th><td>{strategiesFor(version,goal.id).join('、')||'关联策略待补'}</td></tr>):
          <tr><th scope="row">此版无目标节点</th><td>可发布为地图记录；无可承接目标。</td></tr>}
      </tbody></table></div></details>
      <details><summary>取舍、成立条件与来源</summary><dl className="sg-details">
        {([['选择',version.choice],['排除项',version.excluded],['成立条件',version.assumptions],['待核依据',version.unknowns]] as const)
          .filter(([,value])=>value).map(([label,value])=><div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}
        {version.importSource&&<div><dt>工作簿</dt><dd>{version.importSource.fileName}</dd></div>}
        {version.importSources?.map(source=><div key={source.sourceId}><dt>导入原稿</dt><dd>{source.fileName}</dd></div>)}
      </dl>
        {version.citations.map(citation=><StrategyAttachmentEvidence key={citation.token} discussionId={discussionId} citation={citation}/>)}
        <button type="button" className="text-button" onClick={()=>onDiscuss(version)}>返回原讨论</button>
      </details>
      <div className="release-actions">
        {canPublish(version,selectedResult)&&<button type="button" className="secondary-button" disabled={busy} onClick={()=>beginChange(version)}>核对此版并正式发布</button>}
        {selectedResult&&!selectedResult.error&&releaseStatus==='candidate'&&!canPublish(version,selectedResult)&&<span className="sg-muted">此候选早于已有发布版本。请核对更新的候选。</span>}
        {releaseStatus==='active'&&publication&&<><button type="button" className="primary-button" disabled={busy||!goals.length} onClick={()=>setHandoff({version,publication})}>带入目标管理</button><button type="button" className="secondary-button" disabled={busy} onClick={()=>beginChange(version,publication)}>撤销发布</button></>}
        {releaseStatus==='active'&&!goals.length&&<span className="sg-muted">此版无目标节点，不能带入目标管理。</span>}
        <button type="button" className="secondary-button" onClick={()=>{onSelect(version);onStage('compare');}}>查看此版地图</button>
      </div>
      {status&&<p className="sg-status" role="status">{status}</p>}
      {!change&&error&&<p role="alert">{error}</p>}
      {byMap&&[...byMap.values()].some(result=>result.error)&&<p role="alert">{selectedResult?.error??'部分地图的发布记录暂不可读。'} <button className="text-button" type="button" onClick={()=>setRefresh(value=>value+1)}>重新读取发布记录</button></p>}
    </div>

    <div className="release-columns">
      <div><h3>发布记录</h3><p className="sg-muted">同一地图只有一个当前发布；发布新版后，旧发布转为「已被替代」并保留记录。</p>
        {[...groups].map(([mapId,items])=><section className="release-map-records" key={mapId}>
          <h4>{items[0]!.title}</h4>
          <ul className="release-record-list">{items.map(item=>{const record=publicationOf(byMap?.get(mapId),item);return <li key={keyOf(item)}>
            <div className="release-handoff-item"><strong>{item.title} · v{item.version}</strong><span className={`sg-badge ${statusClass(statusOf(record))}`}>{stateLabel(item)}</span></div>
            <p className="sg-muted">{record?record.publicationId+' · 发布 '+dateText(record.publishedAt)+(record.supersededAt?' · 替代 '+dateText(record.supersededAt):'')+(record.withdrawnAt?' · 撤销 '+dateText(record.withdrawnAt):''):'保存 '+dateText(item.createdAt)} · <span className="mono">{item.contentSha256}</span></p>
            <div className="sg-row">
              <button className="text-button" type="button" onClick={()=>onSelect(item)}>选择核对</button>
              <button className="text-button" type="button" onClick={()=>{onSelect(item);onStage('compare');}}>查看此版地图</button>
              <button className="text-button" type="button" onClick={()=>onDiscuss(item)}>返回原讨论</button>
              <DownloadVersion route={`/api/strategy/discussions/${discussionId}/maps/${mapId}/versions/${item.version}/export`}/>
            </div>
          </li>;})}</ul>
        </section>)}
      </div>
      <div><h3>承接记录</h3><p className="sg-muted">旧数据保留；缺少发布身份的记录标为历史承接，不自动升级到最新发布。</p><Handoffs key={keyOf(version)} version={version}/></div>
    </div>

    {confirming&&<CaseDialog title="确认正式发布战略地图" subtitle={confirming.title+' · v'+confirming.version} busy={busy} onClose={closeChange}>
      <dl className="sg-details">
        <div><dt>准确身份</dt><dd className="mono">{confirming.mapId} · v{confirming.version} · {confirming.contentSha256}</dd></div>
        <div><dt>版本来源</dt><dd>{authorLabel[confirming.author]} · {confirming.reason}</dd></div>
        <div><dt>将冻结</dt><dd>{goalCount(confirming)} 个目标节点、{strategyCount(confirming)} 个策略节点</dd></div>
      </dl>
      <p className="case-help">正式发布不会创建目标、采用目标、启动 Case 或项目。后续编辑会生成新的候选版本，需再次核对发布。</p>
      {error&&<p role="alert">{error}</p>}
      <div className="case-dialog-actions"><button className="secondary-button" disabled={busy} onClick={closeChange}>取消</button><button className="primary-button" disabled={busy} onClick={()=>void mutateVersion()}>确认正式发布</button></div>
    </CaseDialog>}

    {withdrawing&&change?.publication&&<CaseDialog title="撤销这次发布？" subtitle={withdrawing.title+' · v'+withdrawing.version+' · '+change.publication.publicationId} busy={busy} onClose={closeChange}>
      <p>撤销后，这个版本不能再被带入目标管理；地图版本、发布记录、已保存目标候选和历史引用都保留。</p>
      <p className="sg-muted">本产品不允许撤销后重新发布同一版本；恢复承接需先编辑产生新的候选版本。</p>
      {error&&<p role="alert">{error}</p>}
      <div className="case-dialog-actions"><button className="secondary-button" disabled={busy} onClick={closeChange}>取消</button><button className="secondary-button danger-button" disabled={busy} onClick={()=>void mutateVersion()}>确认撤销发布</button></div>
    </CaseDialog>}

    {handoff&&<MapGoalHandoff key={handoff.publication.publicationId} version={handoff.version} publication={handoff.publication} scopes={scopes} openOnMount
      onClose={()=>setHandoff(undefined)} onSaved={goals=>void onGoalsChanged(goals).then(()=>{setStatus('已保存 '+goals.length+' 项目标候选；后续采用仍在目标管理中核对。');onStage('goals');}).catch(fault=>setError(String(fault)))}/>}
  </section>;
}
