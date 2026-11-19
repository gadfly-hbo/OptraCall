import {useEffect,useState} from 'react';
import type {BusinessRoleOwner} from '../business-role-types.ts';

type Origin =
  | {source:{kind:'case';caseId:string;caseRevision:number};record:{title:string;description:string;judgement:string;nextStep:string}}
  | {source:{kind:'task';projectId:string;taskId:string};project:{name:string};task:{name:string};reply?:{text:string}};

export function GoalOrigin({owner}:{owner:BusinessRoleOwner}){
  const [open,setOpen]=useState(false),[view,setView]=useState<Origin>(),[error,setError]=useState('');
  const key=JSON.stringify(owner);
  useEffect(()=>{
    if(!open)return;
    const controller=new AbortController();
    setView(undefined);setError('');
    void (async()=>{
      const response=await fetch('/api/business-role?'+new URLSearchParams({owner:key,action:'origin'}),{signal:controller.signal,credentials:'omit',cache:'no-store'});
      const value=await response.json();
      if(!response.ok)throw Error(value.message||'原来源不可读。');
      if(!controller.signal.aborted)setView(value.origin);
    })().catch(e=>{if(!controller.signal.aborted)setError(e.message);});
    return ()=>controller.abort();
  },[open,key]);
  return <details onToggle={e=>setOpen(e.currentTarget.open)}><summary>核对带入的原依据</summary>
    {error&&<p role="alert">{error}</p>}
    {view&&('record' in view?<><h4>{view.record.title} · v{view.source.caseRevision}</h4>
      {view.record.description&&<p>{view.record.description}</p>}{view.record.judgement&&<p>当时判断 · {view.record.judgement}</p>}{view.record.nextStep&&<p>当时下一步 · {view.record.nextStep}</p>}</>:
      <><h4>{view.project.name} · {view.task.name}</h4>{view.reply&&<pre>{view.reply.text}</pre>}</>)}
  </details>;
}
