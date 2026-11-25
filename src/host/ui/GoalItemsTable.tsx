import {useState} from 'react';
import type {GoalVersion,StrategyGoalRecord} from '../strategy-goals-types.ts';
import {structuredGoalRows} from '../structured-goal.ts';
import {DownloadWorkbook} from './StrategyWorkbookImport.tsx';

export function GoalItemsTable({records,selected,onSelect}:{records:StrategyGoalRecord[];selected:string;onSelect:(id:string)=>void}){
  return <div className="sg-table-scroll sg-goal-table" role="region" tabIndex={0} aria-label="目标列表"><table className="sg-table"><thead><tr><th scope="col">目标项</th><th scope="col">指标</th><th scope="col">基线与性质</th><th scope="col">目标值</th><th scope="col">单位</th><th scope="col">版本</th></tr></thead><tbody>{records.map(record=>{
    const v=record.versions.at(-1)!,rows=structuredGoalRows(v);
    return rows.map((m,i)=><tr key={record.id+'/'+i} aria-selected={record.id===selected}>{i===0&&<th scope="row" rowSpan={rows.length}><button type="button" className="text-button sg-goal-item" aria-pressed={record.id===selected} onClick={()=>onSelect(record.id)}>{v.structured&&<small>{v.structured.nodeId} · </small>}{v.title}</button></th>}<td>{m.metric}</td><td>{v.structured?m.baseline??'待建':<details><summary>{v.baseline.state==='pending'?'待补':'查看基线'}</summary>{m.baseline}</details>} {m.baselineKind}</td><td>{v.structured?m.target??'待定':v.measurement.kind==='deliverable'?<details><summary>查看交付标准</summary>{m.target}</details>:m.target??'待定'}</td><td>{m.unit??'—'}</td>{i===0&&<td rowSpan={rows.length}><span className={`sg-badge ${v.status === 'candidate' ? 'pending' : ''}`}>v{v.version} · {v.status==='candidate'?'待采用':'已采用'}</span>{record.adoptedVersion!==null&&record.adoptedVersion!==v.version&&<small className="sg-goal-active-version">采用 v{record.adoptedVersion}</small>}</td>}</tr>);
  })}</tbody></table></div>;
}
export function GoalTableOrigin({goal}:{goal:GoalVersion}){
  const s=goal.structured;if(!s)return null;
  return <details><summary>目标项及准确来源</summary><p>{s.planTitle} · {s.nodeId}{s.parents.length?' · 上级 '+s.parents.join('、'):''}</p>
    {s.map&&<p>候选地图 {s.map.mapId} · v{s.map.version}</p>}{s.workbook&&<><p>{s.workbook.fileName}</p><ul>{s.workbook.rows.map(r=><li key={r.sheet+'!'+r.row}>{r.sheet} · 第 {r.row} 行 · {Object.values(r.columns).join('、')} 列</li>)}</ul><DownloadWorkbook goal={{goalId:goal.goalId,version:goal.version}}/></>}
    {s.metrics.map(m=><p key={m.metric}>{m.metric} · 基线 {m.baseline??'待建'} {m.baselineKind} · 目标 {m.target??'待定'} {m.unit} · {m.period??'期间待核'}</p>)}
  </details>;
}
export function GoalCaseAction({goal,onOpen,disabled}:{goal:GoalVersion;onOpen:(strategy:string)=>Promise<void>;disabled:boolean}){
  const [strategy,setStrategy]=useState(goal.strategies?.length===1?goal.strategies[0]!:'');
  const [busy,setBusy]=useState(false),[error,setError]=useState('');
  async function open(){if(!strategy)return;setBusy(true);setError('');try{await onOpen(strategy);}catch{setError('当前 Case 承接记录无法核对，请重试。');}finally{setBusy(false);}}
  return <div className="sg-row"><label>承接此目标的策略 S <select className="sg-select" value={strategy} onChange={e=>setStrategy(e.target.value)} disabled={disabled||busy}><option value="">选择具体策略</option>{goal.strategies?.map((s,i)=><option key={i}>{s}</option>)}</select></label><button className="secondary-button" disabled={disabled||!strategy||busy} onClick={()=>void open()}>打开或创建 Case</button>{error&&<span role="alert">{error}</span>}</div>;
}
