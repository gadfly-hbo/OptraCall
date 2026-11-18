import { useEffect, useState } from 'react';
import type { StrategyChoiceDraft, StrategyChoiceVersion, StrategyDiscussionDetail } from '../strategy-discussion-types.ts';
import type { ManagementStage } from './ManagementTabs.tsx';
import type {GoalScope} from '../strategy-goals-types.ts';
import { readStrategyDiscussion, strategyVersionRequest } from './strategy-discussion-client.ts';

export type ChoiceHandoff = {discussionId:string;version:number;destination:NonNullable<StrategyChoiceVersion['destination']>;source:StrategyChoiceVersion['source'];contentSha256:string;summary:string};
type VersionSummary = Pick<StrategyChoiceVersion,'version'|'createdAt'|'handedOffAt'>;

export function DownloadVersion({route,disabled=false}:{route:string;disabled?:boolean}){
  const [notice,setNotice]=useState(''),[pending,setPending]=useState(false);
  const download=async()=>{
    setPending(true);setNotice('');
    try {
      const response=await fetch(route,{mode:'same-origin',cache:'no-store',headers:{'x-optracall-client':'1'}});
      if(!response.ok)throw Error('所选版或原依据当前不可读取，请核对来源和权限。');
      const {html,filename}=await response.json();
      if(typeof html!=='string'||typeof filename!=='string')throw Error('未取得完整导出文稿。');
      const url=URL.createObjectURL(new Blob([html],{type:'text/html;charset=utf-8'}));
      const a=document.createElement('a');a.href=url;a.download=filename;document.body.append(a);a.click();a.remove();
      window.setTimeout(()=>URL.revokeObjectURL(url),3000);setNotice('已下载 '+filename);
    }catch(e){setNotice(e instanceof Error?e.message:'下载失败。');}finally{setPending(false);}
  };
  return <div><button className="secondary-button" type="button" disabled={disabled||pending} onClick={()=>void download()}>导出此版</button> <span role="status">{notice}</span></div>;
}

const labels:Record<keyof StrategyChoiceDraft,string>={options:'备选方向',choice:'选择或候选意见',rationale:'比较依据',assumptions:'关键假设',unknowns:'待核项'};
const blank:StrategyChoiceDraft={options:'',choice:'',rationale:'',assumptions:'',unknowns:''};
export function StrategyChoicePanel({detail,stage,onStage,onRefresh,onHandoff,scopes,boundScope}:{scopes:GoalScope[];boundScope?:GoalScope;detail:StrategyDiscussionDetail;stage:ManagementStage;onStage:(s:ManagementStage)=>void;onRefresh:()=>Promise<void>;onHandoff:(v:ChoiceHandoff)=>void}){
  const id=detail.discussion.id,base='/api/strategy/discussions/'+id+'/versions';
  const [replyId,setReplyId]=useState(''),[draft,setDraft]=useState(blank),[versions,setVersions]=useState<VersionSummary[]>([]);
  const [number,setNumber]=useState(0),[selected,setSelected]=useState<{version:StrategyChoiceVersion;reply:string}>();
  const [pending,setPending]=useState(false),[error,setError]=useState('');
  const [scopeKey,setScopeKey]=useState('');
  const scopeId=(s:GoalScope)=>JSON.stringify([s.kind,s.id,s.enterpriseId??null]);
  const kind = detail.discussion.usageContext?.kind;
  const candidates = detail.discussion.goal ? (boundScope ? [boundScope] : []) :
    scopes.filter(s => !kind || s.kind === (kind === 'organization' ? 'enterprise' : kind));
  const [department,setDepartment] = useState('');
  const newDepartment = kind === 'department' && !detail.discussion.goal && !candidates.length;
  const scope = candidates.find(s => scopeId(s) === scopeKey) ?? candidates[0] ??
    (newDepartment && department.trim() ? {kind: 'department' as const,id:department.trim(),name:department.trim()} : undefined);
  const reply=detail.replies.find(r=>r.source.version===replyId);
  useEffect(()=>{let current=true;strategyVersionRequest<{versions:VersionSummary[]}>(id).then(r=>{if(current){setVersions(r.versions);setNumber(n=>n||r.versions.at(-1)?.version||0);}}).catch(()=>{if(current)setError('战略文稿目录不可读取。');});return()=>{current=false;};},[id,detail.discussion.revision,stage]);
  useEffect(()=>{let current=true;setSelected(undefined);if(number && stage==='strategy-versions')strategyVersionRequest<{version:StrategyChoiceVersion;reply:string}>(id,'/'+number).then(r=>{if(current)setSelected(r);}).catch(()=>{if(current)setError('所选文稿或依据已失读。');});return()=>{current=false;};},[id,number,stage,detail.discussion.revision]);
  function openDestination(version: StrategyChoiceVersion) {
    if (version.destination) onHandoff({
      discussionId: id, version: version.version, destination: version.destination, source: version.source,
      contentSha256: version.contentSha256, summary: version.choice || version.rationale || version.title,
    });
  }
  async function deliver(version: StrategyChoiceVersion, expectedRevision: number) {
    const sent = await strategyVersionRequest<{version: StrategyChoiceVersion}>(id, '/'+version.version+'/handoff', 'POST', {expectedRevision,scope});
    await onRefresh();
    openDestination(sent.version);
  }
  async function deliverSaved(version: StrategyChoiceVersion) {
    if (pending || !scope) return;
    setPending(true); setError('');
    try { await deliver(version, detail.discussion.revision); }
    catch (reason) { setError(reason instanceof Error ? reason.message : '请重读所选版本，核对交接结果。'); }
    finally { setPending(false); }
  }
  async function save(handoff:boolean){
    if(!reply || pending)return;
    setPending(true);setError('');
    try{
      const {version}=await strategyVersionRequest<{version:StrategyChoiceVersion}>(id,'','POST',{...draft,source:reply.source,expectedRevision:detail.discussion.revision});
      setNumber(version.version);
      if(handoff) {
        const fresh=await readStrategyDiscussion(id);
        await deliver(version,fresh.discussion.revision);
      } else { await onRefresh(); onStage('strategy-versions'); }
    }catch(e){setError(e instanceof Error?e.message:'保存结果待核。');}finally{setPending(false);}
  }
  const receivingScope = newDepartment
    ? <label>接收部门 <input disabled={pending} maxLength={200} value={department} onChange={e=>setDepartment(e.target.value)}/></label>
    : <label>接收范围 <select disabled={pending} value={scope?scopeId(scope):''} onChange={e=>setScopeKey(e.target.value)}>{candidates.map(s=><option key={scopeId(s)} value={scopeId(s)}>{s.name}</option>)}</select></label>;
  return <section className="sg-panel">
    {stage==='strategy-versions'?<><h3>战略选择表</h3><label>已保存版本 <select disabled={pending} value={number} onChange={e=>{setError('');setNumber(Number(e.target.value));}}><option value={0}>选择版本</option>{versions.map(v=><option key={v.version} value={v.version}>v{v.version} · {v.handedOffAt?'已交接':'候选稿'}</option>)}</select></label>
      {selected && selected.version.version===number && <>
        <p>{selected.version.title} · v{number}</p><p className="workspace-saved-choice-preview">{selected.version.choice||selected.reply}</p>
        <DownloadVersion key={number} route={base+'/'+number+'/export'}/>
        {selected.version.destination ? <button className="text-button" onClick={()=>openDestination(selected.version)}>打开已交接的目标草稿</button>
          : <div className="sg-row">{receivingScope}<button type="button" className="primary-button" disabled={!scope||pending||detail.busy} onClick={()=>void deliverSaved(selected.version)}>将此版带入 GSA</button></div>}
      </>}
      {!versions.length&&<p>此讨论尚无已保存稿。</p>}</>:<>
      <h3>{stage==='compare'?'比较与核对':'选择与交接'}</h3><label>所选原回复 <select value={replyId} onChange={e=>{setReplyId(e.target.value);setDraft(blank);}}><option value="">选择本次依据</option>{detail.replies.map(r=><option key={r.source.version} value={r.source.version}>{r.text.slice(0,80)}</option>)}</select></label>
      {reply && <><p className="workspace-saved-choice-preview">{reply.text}</p>{(Object.entries(labels) as [keyof StrategyChoiceDraft,string][]).map(([key,label])=><label className="case-field" key={key}>{label}<textarea value={draft[key]} maxLength={6000} onChange={e=>setDraft({...draft,[key]:e.target.value})}/></label>)}</>}
      {stage==='handoff' && receivingScope}
      {stage==='compare'?<button className="secondary-button" onClick={()=>onStage('handoff')}>核对要带入的选择</button>:<div className="sg-row"><button className="secondary-button" disabled={!reply||pending||detail.busy} onClick={()=>void save(false)}>保存为版本</button><button className="primary-button" disabled={!scope||!reply||pending||detail.busy} onClick={()=>void save(true)}>确认将所选稿带入 GSA</button></div>}</>}
    {error&&<p role="alert">{error}</p>}
  </section>;
}
