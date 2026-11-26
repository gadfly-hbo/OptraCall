import {useCallback, useEffect, useId, useRef, useState} from 'react';
import {businessRoleNames, type BusinessRoleOwner} from '../business-role-types.ts';
import type {StrategyDiscussionDetail,StrategyDiscussionMessage} from '../strategy-discussion-types.ts';
import type {GoalDraftInput,GoalRoleSuggestionRef} from '../strategy-goals-types.ts';
import {ConversationDrawer} from './ConversationDrawer.tsx';
import {StrategyDiscussionTranscript} from './StrategyDiscussionReply.tsx';
import {canSettleDiscussionMessage, watchStrategyDiscussion} from './strategy-discussion-client.ts';
import {projectDiscussionStreaming} from './strategy-discussion-projection.ts';
import {readConfigurations} from './runtime-client.ts';
import {messageText, type NativeMessage, type PublicModelConfiguration} from './project-types.ts';
import './business-role-conversation.css';

type RoleView = StrategyDiscussionDetail | {discussion:null;busy:false;snapshot?:undefined;configurationId?:string};
const roleQuestions = {
  goal: '想梳理哪一个目标或策略？',
  case: '想讨论当前事项的哪项取舍？',
  project: '这个项目接下来要推进什么？',
  strategy: '想讨论什么战略问题？',
};
export interface BusinessRoleRequest { id:string; text:string; planRequest?:StrategyDiscussionMessage['planRequest']; reviewRequest?:StrategyDiscussionMessage['reviewRequest'] }
type ConversationProps = {
  request?:BusinessRoleRequest;
  onResult?:(detail:StrategyDiscussionDetail,requestId:string)=>void;
  onRunning?:(running:boolean)=>void;
  onFailure?:(message:string)=>void;
  owner: BusinessRoleOwner;
  readOnly?: boolean;
  showInlineTitle?: boolean;
  openingPrompt?: string;
  onGoalDraft?: (draft: GoalDraftInput, source: GoalRoleSuggestionRef) => void;
  onSettled?: () => void;
};
export function BusinessRoleConversation({owner,readOnly,showInlineTitle,openingPrompt,onGoalDraft,onSettled,request,onResult,onRunning,onFailure}:ConversationProps){
  const key=JSON.stringify(owner);
  return <ScopedConversation onFailure={onFailure} request={request} onResult={onResult} onRunning={onRunning} key={key} owner={owner} ownerKey={key} openingPrompt={openingPrompt} readOnly={readOnly} showInlineTitle={showInlineTitle} onGoalDraft={onGoalDraft} onSettled={onSettled}/>;
}
function ScopedConversation({owner,ownerKey,readOnly,showInlineTitle = true,openingPrompt,onGoalDraft,onSettled,request,onResult,onRunning,onFailure}:ConversationProps & {ownerKey:string}){
  const base='/api/business-role?'+new URLSearchParams({owner:ownerKey});
  const title=businessRoleNames[owner.role];
  const inputId=useId();
  const storage='optracall.role-discussion.v1.'+ownerKey;
  const [text,setText]=useState(()=>sessionStorage.getItem(storage+'.draft')??openingPrompt??'');
  const [pending,setPending]=useState<StrategyDiscussionMessage|undefined>(()=>{try{return JSON.parse(sessionStorage.getItem(storage+'.request')??'null')??undefined;}catch{return undefined;}});
  const pendingRef=useRef(pending);
  const settledRun=useRef<string|undefined>(undefined);
  const onSettledRef=useRef(onSettled);
  onSettledRef.current=onSettled;
  const failureRef=useRef(onFailure);failureRef.current=onFailure;
  const resultRef=useRef(onResult);resultRef.current=onResult;
  const alive=useRef(false), seq=useRef(0);
  const [view,setView]=useState<RoleView>();
  const [error,setError]=useState(''),[busy,setBusy]=useState(false),[stream,setStream]=useState('');
  const [configs,setConfigs]=useState<PublicModelConfiguration[]>([]);
  const [model,setModel]=useState('');
  const [retryOf,setRetryOf]=useState<string|undefined>(()=>sessionStorage.getItem(storage+'.replace')??undefined);
  const [checked,setChecked]=useState<string>();
  const onError=(reason:unknown)=>{if(alive.current){const message=reason instanceof Error?reason.message:'对话读取失败。';setError(message);failureRef.current?.(message);}};
  const call=useCallback(async(action:string, method:string, payload?:unknown, signal?:AbortSignal, originalId?:string)=>{
    const response=await fetch(base+(action?'&action='+action:'')+(originalId?'&requestId='+encodeURIComponent(originalId):''),{method,signal,credentials:'omit',cache:'no-store',headers:{'content-type':'application/json','x-optracall-client':'1'},...(payload!==undefined?{body:JSON.stringify(payload)}:{})});
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
    const request=pendingRef.current;
    const next:RoleView=await call('','GET',undefined,signal,request?.requestId);
    if(!alive.current||ticket!==seq.current)return;
    setView(next);if(next.discussion)setModel(next.discussion.configurationId);
    setChecked(request?.requestId);
    const external=request&&sessionStorage.getItem(storage+'.keep.'+request.requestId)==='1';
    if(next.discussion&&request&&canSettleDiscussionMessage(next,request)&&(!external||!next.busy&&next.discussion.lastRun?.id===request.requestId&&next.discussion.lastRun.status==='completed')){
      const keepDraft=sessionStorage.getItem(storage+'.keep.'+request.requestId)==='1';
      remember();sessionStorage.removeItem(storage+'.replace');setRetryOf(undefined);
      if(!keepDraft){sessionStorage.removeItem(storage+'.draft');setText('');}
      if(next.discussion.lastRun?.status==='completed')resultRef.current?.(next,request.requestId);
    } else if(!request && next.discussion?.pendingInput && next.discussion.pendingInput.requestId !== sessionStorage.getItem(storage+'.replace')){
      const original=next.discussion.pendingInput;
      remember(original);if(!original.planRequest&&!original.reviewRequest){setText(original.text);sessionStorage.setItem(storage+'.draft',original.text);}
    }
    const terminal=next.discussion?.lastRun;
    if(!next.busy&&terminal&&terminal.status!=='accepted'&&settledRun.current!==terminal.id){
      settledRun.current=terminal.id;onSettledRef.current?.();
      if(external&&['failed','cancelled'].includes(terminal.status))failureRef.current?.('本次建议未完成，原输入已保留，可重试或继续手填。');
    }
    return next;
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
        setStream('');
        void load(controller.signal).catch(f=>{if(!controller.signal.aborted)onError(f);});
      }
    },controller.signal,base+'&action=events').catch(f=>{if(!controller.signal.aborted)onError(f);});
    return ()=>controller.abort();
  },[id,base,load]);
  async function send(){
    if(readOnly||busy||!text.trim()||!view||pendingRef.current)return;
    const input={requestId:crypto.randomUUID(),text:text.trim(),expectedRevision:view.discussion?.revision??0,...(retryOf?{replacePendingRequestId:retryOf}:{})};
    remember(input);
    await dispatch(input);
  }
  async function dispatch(input:StrategyDiscussionMessage){
    setBusy(true);setError('');setChecked(undefined);
    try{
      await call('messages','POST',input);
      await load();
    } catch(f){
      onError(f);
      try {
        const fresh=await load();
        const rejection=f as {accepted?:boolean;status?:number};
        if (fresh && rejection.accepted===false && Number(rejection.status)<500 &&
            fresh.discussion?.pendingInput?.requestId!==input.requestId &&
            fresh.discussion?.lastRun?.id!==input.requestId && pendingRef.current?.requestId===input.requestId) remember();
      } catch(e){onError(e);}
    } finally{if(alive.current)setBusy(false);}
  }
  const externalSent=useRef<string|undefined>(undefined);
  useEffect(()=>{
    const replace=pendingRef.current&&view?.discussion?.lastRun?.id===pendingRef.current.requestId&&['failed','cancelled'].includes(view.discussion.lastRun.status)?pendingRef.current.requestId:undefined;
    if(!request || externalSent.current===request.id || readOnly || busy || view?.busy || !view || (pendingRef.current&&!replace) ||
       (!view.discussion && !view.configurationId)) return;
    externalSent.current=request.id;
    sessionStorage.setItem(storage+'.keep.'+request.id,'1');
    const input:StrategyDiscussionMessage={requestId:request.id,text:request.text,expectedRevision:view.discussion?.revision??0,...(replace?{replacePendingRequestId:replace}:{}),
      ...(request.planRequest?{planRequest:request.planRequest}:{}),...(request.reviewRequest?{reviewRequest:request.reviewRequest}:{})};
    remember(input);void dispatch(input);
  },[request,view,busy,readOnly,remember,storage]);
  useEffect(()=>{
    const failed=Boolean(pending&&view?.discussion?.lastRun?.id===pending.requestId&&['failed','cancelled'].includes(view.discussion.lastRun.status));
    const ready=Boolean(view&&(view.discussion||view.configurationId));
    onRunning?.(busy||Boolean(view?.busy)||Boolean(pending&&!failed)||Boolean(ready&&request&&externalSent.current!==request.id));
    if(request&&view&&!ready){const message='尚未配置可用模型，可继续手填或在设置中配置后重试。';setError(message);failureRef.current?.(message);}
  },[busy,view,pending,onRunning,request]);
  const openingSent = useRef(false);
  useEffect(() => {
    if (!openingPrompt || openingSent.current || readOnly || busy || !view || view.discussion ||
        !view.configurationId || pendingRef.current || text !== openingPrompt) return;
    openingSent.current = true;
    void send();
  }, [openingPrompt, readOnly, busy, view, text]);

  function prepareReplacement(originalId?:string){
    if(originalId)sessionStorage.setItem(storage+'.replace',originalId);
    else sessionStorage.removeItem(storage+'.replace');
    setRetryOf(originalId);remember();
  }
  async function act(operation:()=>Promise<unknown>){
    setBusy(true);setError('');
    try{await operation();await load();}catch(f){onError(f);}finally{if(alive.current)setBusy(false);}
  }
  const recorded=view?.discussion;
  const defaultModel=view&&!view.discussion?view.configurationId:undefined;
  const running=Boolean(view?.busy);
  const checkedAbsent = pending && checked===pending.requestId && view && !running &&
    recorded?.lastRun?.id!==pending.requestId && recorded?.pendingInput?.requestId!==pending.requestId;
  const sameRevision = pending && (!recorded ? pending.expectedRevision===0 :
    recorded.revision===pending.expectedRevision || (pending.expectedRevision===0 && recorded.revision===1 && !recorded.lastRun));
  const messages = view?.snapshot?.messages
    .filter((message): message is NativeMessage => ['assistant', 'toolResult', 'bashExecution', 'user'].includes(message.role))
    .filter(message => message.role !== 'user' || Boolean(messageText(message))) ?? [];
  const prompt = roleQuestions[owner.role === 'goal-draft' ? 'goal' : owner.role];
  return <ConversationDrawer title={title} showInlineTitle={showInlineTitle} className="role-conversation"><section className="strategy-discussion-panel role-discussion" aria-label={title}>
    {(messages.length > 0 || stream) && <StrategyDiscussionTranscript messages={messages} streaming={stream} label={title+' 对话记录'} conversationKey={`role:${ownerKey}`} modelLabel={configs.find(config => config.id === model && config.revision === view?.discussion?.configurationRevision)?.model ?? '模型待核对'} />}
    {onGoalDraft&&view?.discussion&&view.goalDrafts?.map(item=><button className="secondary-button" type="button" data-return-to-workspace key={item.source.entryId} disabled={busy||running} onClick={()=>void act(async()=>{
      const original:StrategyDiscussionDetail=await call('','GET');
      const fresh=original.goalDrafts?.find(entry=>entry.source.entryId===item.source.entryId&&entry.source.sessionId===item.source.sessionId&&entry.source.sha256===item.source.sha256);
      if(!fresh)throw Error('原建议已不可读。');
      onGoalDraft(fresh.draft,fresh.source);
    })}>带入目标表单 · {item.draft.title}</button>)}
    {readOnly ? <p className="sg-muted">{owner.role==='case'?'Case 已关闭，可阅读原对话。':'当前版本只读，可阅读原对话。'}</p> : <>
      <form className="strategy-discussion-composer role-composer" onSubmit={event => {event.preventDefault(); void send();}}>
        <label className="role-question" htmlFor={inputId}>{prompt}</label>
        <textarea id={inputId} aria-label={'向'+title+'提问'} rows={3} value={text} disabled={Boolean(pending)}
          onChange={event=>{setText(event.target.value);sessionStorage.setItem(storage+'.draft',event.target.value);}}/>
        <div className="role-composer-actions">
          {recorded && configs.length > 0 && <label className="role-model">会话模型
            <select className="sg-select" value={model} disabled={busy||running||!!pending} onChange={event=>void act(()=>call('configuration','POST',{configurationId:event.target.value,expectedRevision:recorded.revision}))}>
              {configs.filter(c=>c.hasApiKey||c.id===model).map(c=><option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </label>}
          {!recorded && defaultModel && <span className="sg-muted">会话模型 · {configs.find(c=>c.id===defaultModel)?.name??defaultModel}</span>}
          <div className="role-send-actions">
            {recorded&&running&&<button type="button" className="secondary-button" disabled={busy} onClick={()=>void act(()=>call('stop','POST',{expectedRequestId:recorded.lastRun?.id}))}>停止</button>}
            <button type="submit" className="primary-button" disabled={!view||!text.trim()||busy||running||!!pending}>发送</button>
          </div>
        </div>
      </form>
      {checkedAbsent && sameRevision && <button type="button" className="secondary-button" disabled={busy} onClick={()=>void dispatch(pending)}>按原编号发送</button>}
      {checkedAbsent && !sameRevision && <button type="button" className="secondary-button" disabled={busy} onClick={()=>prepareReplacement()}>保留原话并核对新的会话状态</button>}
      {pending&&recorded?.lastRun?.id===pending.requestId&&!running&&['failed','cancelled'].includes(recorded.lastRun.status)&&<button type="button" className="secondary-button" onClick={()=>prepareReplacement(pending.requestId)}>保留原话另行发送</button>}
    </>}
    {(pending||error||recorded?.lastRun?.status==='unknown')&&<button type="button" className="text-button" disabled={busy} onClick={()=>void act(()=>Promise.resolve())}>核对原操作</button>}
    {error&&<p className="case-error" role="alert">{error}</p>}
    {running&&<p className="sg-muted" role="status">正在回复…</p>}
    {recorded?.lastRun?.status==='unknown'&&<p className="sg-muted" role="status">上次操作结果待核，原会话已保留。</p>}
  </section></ConversationDrawer>;
}
