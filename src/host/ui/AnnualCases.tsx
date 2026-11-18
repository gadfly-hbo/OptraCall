import {useEffect,useState} from 'react';
import {caseError} from './CaseDialogs.tsx';
import {caseGoals,type CaseRecord,type CaseGoalBinding} from './case-client.ts';
import type {GoalRef} from '../strategy-goals-types.ts';

export function AnnualCases({records,goal,onOpen}:{records:CaseRecord[];goal:GoalRef;onOpen:(id:string)=>void}){
  const [year,setYear]=useState(new Date().getFullYear());
  const [rows,setRows]=useState<{record:CaseRecord;history:CaseGoalBinding[]}[]>([]);
  const [error,setError]=useState('');
  useEffect(()=>{
    let current=true; setRows([]);setError('');
    void Promise.allSettled(records.map(async record=>({record,history:(await caseGoals(record.id)).history}))).then(results=>{
      if(!current)return;
      const failed=results.find(r=>r.status==='rejected');
      if(failed?.status==='rejected')setError('部分 Case 的原关系暂不可读取。'+caseError(failed.reason));
      setRows(results.flatMap(r=>r.status==='fulfilled'?[r.value]:[]));
    });return()=>{current=false;};
  },[records]);
  const start=String(year)+'-01-01',end=String(year)+'-12-31';
  const matches=rows.flatMap(({record,history})=>{
    const bindings=history.map(b=>({binding:b,from:b.effectiveFrom??b.confirmedAt.slice(0,10)})).sort((a,b)=>a.from.localeCompare(b.from)||a.binding.caseRevision-b.binding.caseRevision);
    return bindings.flatMap(({binding,from},i)=>from<=end&&(!bindings[i+1]||bindings[i+1]!.from>start)&&binding.primary.goalId===goal.goalId&&binding.primary.version===goal.version?[{record,binding,from}]:[]);
  });
  return <section className="sg-panel"><h2>年度决策事项</h2><label>年度 <input type="number" min="1900" max="9999" value={year||''} onChange={e=>setYear(Number(e.target.value))}/></label>
    {matches.length?<ul>{matches.map(({record,binding,from})=><li key={binding.operationId}><button type="button" className="text-button" onClick={()=>onOpen(record.id)}>{record.title}</button> · {binding.strategy??'旧记录策略待核'} · {from} 生效</li>)}</ul>:<p>本年度尚未读到承接所选目标版本的 Case。</p>}
    {error&&<p role="alert">{error}</p>}</section>;
}
