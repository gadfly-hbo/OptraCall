import {useCallback, useEffect, useRef, useState} from 'react';
import {businessRoleNames, type BusinessRoleOwner} from '../business-role-types.ts';
import type {StrategyDiscussionDetail,StrategyDiscussionMessage} from '../strategy-discussion-types.ts';
import type {GoalDraftInput,GoalRoleSuggestionRef} from '../strategy-goals-types.ts';
import {ConversationDrawer} from './ConversationDrawer.tsx';
import {StrategyDiscussionReply} from './StrategyDiscussionReply.tsx';
import {canSettleDiscussionMessage, watchStrategyDiscussion} from './strategy-discussion-client.ts';
import {projectDiscussionStreaming} from './strategy-discussion-projection.ts';
import {readConfigurations} from './runtime-client.ts';
import type {PublicModelConfiguration} from './project-types.ts';

type RoleView = StrategyDiscussionDetail | {discussion:null;busy:false;snapshot?:undefined;configurationId?:string};
function messageText(message:{content?:unknown;originalUserText?:string}){
  if(message.originalUserText!==undefined)return message.originalUserText;
  if(typeof message.content==='string')return message.content;
  return Array.isArray(message.content)?message.content.filter(p=>p?.type==='text').map(p=>p.text).join(''):'';
}
type ConversationProps = {owner:BusinessRoleOwner;onGoalDraft?:(draft:GoalDraftInput,source:GoalRoleSuggestionRef)=>void};
export function BusinessRoleConversation({owner,onGoalDraft}:ConversationProps){
  const key=JSON.stringify(owner);
  return <ScopedConversation key={key} owner={owner} ownerKey={key} onGoalDraft={onGoalDraft}/>;
}
function ScopedConversation({owner,ownerKey,onGoalDraft}:ConversationProps & {ownerKey:string}){
  const base='/api/business-role?'+new URLSearchParams({owner:ownerKey});
  const title=businessRoleNames[owner.role];
  const storage='optracall.role-discussion.v1.'+ownerKey;
  const [text,setText]=useState(()=>sessionStorage.getItem(storage+'.draft')??'');
  const [pending,setPending]=useState<StrategyDiscussionMessage|undefined>(()=>{try{return JSON.parse(sessionStorage.getItem(storage+'.request')??'null')??undefined;}catch{return undefined;}});
  const pendingRef=useRef(pending);
  const alive=useRef(false), seq=useRef(0);
  const [view,setView]=useState<RoleView>();
  const [error,setError]=useState(''),[busy,setBusy]=useState(false),[stream,setStream]=useState('');
  const [configs,setConfigs]=useState<PublicModelConfiguration[]>([]);
  const [model,setModel]=useState('');
  const [retryOf,setRetryOf]=useState<string>();
  const onError=(reason:unknown)=>{if(alive.current)setError(reason instanceof Error?reason.message:'对话读取失败。');};
  const call=useCallback(async(action:string, method:string, payload?:unknown, signal?:AbortSignal)=>{
    const response=await fetch(base+(action?'&action='+action:''),{method,signal,credentials:'omit',cache:'no-store',headers:{'content-type':'application/json','x-optracall-client':'1'},...(payload!==undefined?{body:JSON.stringify(payload)}:{})});
    const value=await response.json();
    if(!response.ok)throw Object.assign(new Error(value.message||'本轮操作未完成，请核对原记录。'),{accepted:value.accepted,status:response.status});
    return value;
  },[base]);
  const remember=useCallback((value?:StrategyDiscussionMessage)=>{
    if(value)sessionStorage.setItem(storage+'.request',JSON.stringify(value));else sessionStorage.removeItem(storage+'.request');
    pendingRef.current=value;setPending(value);
  },[storage]);
  const load=useCallback(async(signal?:AbortSignal)=>{
    const ticket=++seq.current;
    const next:RoleView=await call('','GET',undefined,signal);
    if(!alive.current||ticket!==seq.current)return;
    setView(next);if(next.discussion)setModel(next.discussion.configurationId);
    const request=pendingRef.current;
    if(next.discussion&&request&&canSettleDiscussionMessage(next,request)){
      remember();sessionStorage.removeItem(storage+'.draft');setText('');setRetryOf(undefined);
    }
  },[call,remember,storage]);
  useEffect(()=>{
    alive.current=true;
    const controller=new AbortController();
    void load(controller.signal).catch(f=>{if(!controller.signal.aborted)onError(f);});
    void readConfigurations(controller.signal).then(v=>{if(alive.current){setConfigs(v.configurations);}}).catch(f=>{if(!controller.signal.aborted)onError(f);});
    return ()=>{alive.current=false;controller.abort();};
  },[load]);
  const id=view?.discussion?.id;
  useEffect(()=>{
    if(!id)return;
    const controller=new AbortController();
    void watchStrategyDiscussion(id,event=>{
      if(controller.signal.aborted)return;
      if(event.type==='text.delta')setStream(old=>projectDiscussionStreaming(old,event));
      if(event.type==='run.settled'||event.type==='snapshot'&&event.snapshot.status==='idle'){
        setStream('');void load(controller.signal).catch(f=>{if(!controller.signal.aborted)onError(f);});
      }
    },controller.signal,base+'&action=events').catch(f=>{if(!controller.signal.aborted)onError(f);});
    return ()=>controller.abort();
  },[id,base,load]);
  async function send(){
    if(busy||!text.trim()||!view||pendingRef.current)return;
    setBusy(true);setError('');
    const input={requestId:crypto.randomUUID(),text:text.trim(),expectedRevision:view.discussion?.revision??0,...(retryOf?{replacePendingRequestId:retryOf}:{})};
    remember(input);
    try{await call('messages','POST',input);await load();}
    catch(f){onError(f);if(alive.current){try{await load();}catch(e){onError(e);}
      if((f as {accepted?:boolean;status?:number}).accepted===false&&Number((f as {status?:number}).status)<500&&alive.current)remember();
    }}finally{if(alive.current)setBusy(false);}
  }
  async function act(operation:()=>Promise<unknown>){
    setBusy(true);setError('');
    try{await operation();await load();}catch(f){onError(f);}finally{if(alive.current)setBusy(false);}
  }
  const recorded=view?.discussion;
  const defaultModel=view&&!view.discussion?view.configurationId:undefined;
  const running=Boolean(view?.busy);
  return <ConversationDrawer title={title}><section className="strategy-discussion-panel" aria-label={title}>
    <h3>{title}</h3>
    {view?.snapshot?.messages.filter(m=>m.role==='user'||m.role==='assistant').map((m,index)=>{
      const body=messageText(m);return body?<div key={m.nativeEntryId??index}>{m.role==='assistant'?<StrategyDiscussionReply text={body}/>:<p>{body}</p>}</div>:null;
    })}
    {onGoalDraft&&view?.discussion&&view.goalDrafts?.map(item=><button type="button" data-return-to-workspace key={item.source.entryId} disabled={busy||running} onClick={()=>void act(async()=>{
      const original:StrategyDiscussionDetail=await call('','GET');
      const fresh=original.goalDrafts?.find(entry=>entry.source.entryId===item.source.entryId&&entry.source.sessionId===item.source.sessionId&&entry.source.sha256===item.source.sha256);
      if(!fresh)throw Error('原建议已不可读。');
      onGoalDraft(fresh.draft,fresh.source);
    })}>带入目标表单 · {item.draft.title}</button>)}
    {stream&&<StrategyDiscussionReply text={stream}/>}
    <label>消息<textarea aria-label={'向'+title+'提问'} value={text} disabled={Boolean(pending)} onChange={e=>{setText(e.target.value);sessionStorage.setItem(storage+'.draft',e.target.value);}}/></label>
    <div className="sg-actions"><button type="button" disabled={!view||!text.trim()||busy||running||!!pending} onClick={()=>void send()}>发送</button>
    {recorded&&running&&<button type="button" disabled={busy} onClick={()=>void act(()=>call('stop','POST',{expectedRequestId:recorded.lastRun?.id}))}>停止</button>}
    {(pending||error||recorded?.lastRun?.status==='unknown')&&<button type="button" disabled={busy} onClick={()=>void act(()=>Promise.resolve())}>核对原操作</button>}
    {pending&&recorded?.lastRun?.id===pending.requestId&&!running&&['failed','cancelled'].includes(recorded.lastRun.status)&&<button type="button" onClick={()=>{setRetryOf(pending.requestId);remember();}}>保留原话另行发送</button>}</div>
    {recorded&&configs.length>0&&<label>会话模型<select value={model} disabled={busy||running||!!pending} onChange={e=>void act(()=>call('configuration','POST',{configurationId:e.target.value,expectedRevision:recorded.revision}))}>{configs.filter(c=>c.hasApiKey||c.id===model).map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></label>}
    {!recorded&&defaultModel&&<small>会话模型 · {configs.find(c=>c.id===defaultModel)?.name??defaultModel}</small>}
    {error&&<p role="alert">{error}</p>}
    {running&&<p role="status">正在回复…</p>}
    {recorded?.lastRun?.status==='unknown'&&<p role="status">上次操作结果待核，原会话已保留。</p>}
  </section></ConversationDrawer>;
}
