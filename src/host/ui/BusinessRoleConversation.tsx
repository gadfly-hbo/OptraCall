import {useCallback, useEffect, useId, useMemo, useRef, useState} from 'react';
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
import { createCaseComposerDraft } from './case-composer-draft.ts';
import { appendCarryOverFragment, readWorkspaceDraft, saveWorkspaceDraft } from './workspace-daily-client.ts';
import type { IssueDraftPayload } from '../workspace-draft-store.ts';
import { registerWorkspaceInputGuard } from './workspace-input-guards.ts';

type RoleView = StrategyDiscussionDetail | {discussion:null;busy:false;snapshot?:undefined;configurationId?:string};
const roleQuestions = {
  goal: '想梳理哪一个目标或策略？',
  case: '想讨论当前事项的哪项取舍？',
  project: '这个项目接下来要推进什么？',
  strategy: '想讨论什么战略问题？',
};
export interface BusinessRoleRequest { id:string; text:string; planRequest?:StrategyDiscussionMessage['planRequest']; reviewRequest?:StrategyDiscussionMessage['reviewRequest'] }
const roleStorage=(ownerKey:string)=>'optracall.role-discussion.v1.'+ownerKey;
export function readPendingBusinessRoleRequest(owner:BusinessRoleOwner):BusinessRoleRequest|undefined {
  try {
    const storage=roleStorage(JSON.stringify(owner));
    const input:StrategyDiscussionMessage|null=JSON.parse(sessionStorage.getItem(storage+'.request')??'null');
    if(!input||typeof input.requestId!=='string'||typeof input.text!=='string'||sessionStorage.getItem(storage+'.keep.'+input.requestId)!=='1')return;
    return {id:input.requestId,text:input.text,...(input.planRequest?{planRequest:input.planRequest}:{}),...(input.reviewRequest?{reviewRequest:input.reviewRequest}:{})};
  }catch{return;}
}
type ConversationProps = { externalAppend?: { id: string; text: string } | null; onExternalAppended?: (id: string) => void;
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
export function BusinessRoleConversation({owner,readOnly,showInlineTitle,openingPrompt,onGoalDraft,onSettled,request,onResult,onRunning,onFailure,externalAppend,onExternalAppended}:ConversationProps){
  const key=JSON.stringify(owner);
  return <ScopedConversation onFailure={onFailure} request={request} onResult={onResult} onRunning={onRunning} externalAppend={externalAppend} onExternalAppended={onExternalAppended} key={key} owner={owner} ownerKey={key} openingPrompt={openingPrompt} readOnly={readOnly} showInlineTitle={showInlineTitle} onGoalDraft={onGoalDraft} onSettled={onSettled}/>;
}
function ScopedConversation({owner,ownerKey,readOnly,showInlineTitle = true,openingPrompt,onGoalDraft,onSettled,request,onResult,onRunning,onFailure,externalAppend,onExternalAppended}:ConversationProps & {ownerKey:string}){
  const base='/api/business-role?'+new URLSearchParams({owner:ownerKey});
  const title=businessRoleNames[owner.role];
  const inputId=useId();
  const storage=roleStorage(ownerKey);
  const [text,setText]=useState(()=>sessionStorage.getItem(storage+'.draft')??openingPrompt??'');
  const [draftReady,setDraftReady]=useState(owner.role !== 'case');
  const [draftError,setDraftError]=useState('');
  const [recoveredText,setRecoveredText]=useState<string | null>(null);
  const [appending,setAppending]=useState(false);
  const [conflictingText,setConflictingText]=useState<string|null>(null);
  const draftAlive=useRef(true);
  const composerDraft=useMemo(() => owner.role === 'case' ? createCaseComposerDraft({
    caseId: owner.caseId, issueId: owner.itemId,
    read: () => readWorkspaceDraft<IssueDraftPayload>('issue-draft', `issue:${owner.caseId}:${owner.itemId}`).then(r=>r.draft).catch(e=>{if(e.status===404)return null;throw e;}),
    save: (revision,payload) => saveWorkspaceDraft('issue-draft', `issue:${owner.caseId}:${owner.itemId}`, revision, payload).then(r=>r.draft),
    append: (fragmentId,revision) => appendCarryOverFragment({ fragmentId, issueDraftId:`issue:${owner.caseId}:${owner.itemId}`, caseId:owner.caseId, issueId:owner.itemId, expectedDraftRevision:revision }),
    onChange: value => { if(draftAlive.current)setText(value); },
  }) : null, [ownerKey]);
  const updateText=(value:string)=>{
    setText(value); sessionStorage.setItem(storage+'.draft',value);
    if(composerDraft){composerDraft.update(value);try{localStorage.setItem(storage+'.recovery',value);}catch{}}
  };
  const flushComposer=useCallback(async()=>{
    if(!composerDraft)return true;
    try { const ok=await composerDraft.flush(); if(ok){localStorage.removeItem(storage+'.recovery');if(draftAlive.current){setDraftError('');setConflictingText(null);}}return ok; }
    catch { if(draftAlive.current){setDraftError('草稿尚未保存，原输入保留。请核对原草稿后重试；当前不会离开或发送。');setConflictingText(composerDraft.getConflict()?.payload.text??null);}return false; }
  },[composerDraft,storage]);
  useEffect(()=>{
    if(!composerDraft)return;
    draftAlive.current=true;
    void composerDraft.load(sessionStorage.getItem(storage+'.draft')??'').then(value=>{
      if(!draftAlive.current)return;
      const recovery=localStorage.getItem(storage+'.recovery')??sessionStorage.getItem(storage+'.draft');
      if(recovery!==null&&recovery!==value)setRecoveredText(recovery);
      setDraftReady(true);
    }).catch(()=>{if(draftAlive.current)setDraftError('原草稿暂不可读取，输入保留；请恢复读取后再编辑或发送。');});
    const remove=registerWorkspaceInputGuard(flushComposer);
    const beforeUnload=(event:BeforeUnloadEvent)=>{if(composerDraft.getSnapshot().dirty){try{localStorage.setItem(storage+'.recovery',composerDraft.getSnapshot().text);}catch{}event.preventDefault();}};
    window.addEventListener('beforeunload',beforeUnload);
    return ()=>{draftAlive.current=false;remove();window.removeEventListener('beforeunload',beforeUnload);void flushComposer();};
  },[composerDraft,flushComposer]);
  useEffect(()=>{if(!composerDraft||!draftReady)return;const timer=setTimeout(()=>void flushComposer(),300);return()=>clearTimeout(timer);},[text,composerDraft,draftReady,flushComposer]);
  async function clearSentDraft(sent:string){
    if(composerDraft){const current=composerDraft.getSnapshot().text;if(current.trim()===sent.trim())await composerDraft.clearSent(current);}
    else setText('');
  }
  const lastAppendedRef = useRef<string>('');
  useEffect(() => {
    if (!externalAppend || !externalAppend.text) return;
    if(lastAppendedRef.current===externalAppend.id){if(!appending)onExternalAppended?.(externalAppend.id);return;}
    if(composerDraft){
      if(!draftReady||appending)return;
      setAppending(true);lastAppendedRef.current=externalAppend.id;
      void composerDraft.append(externalAppend.id).then(()=>{sessionStorage.setItem(storage+'.draft',composerDraft.getSnapshot().text);setDraftError('');onExternalAppended?.(externalAppend.id);},()=>{lastAppendedRef.current='';setDraftError('片段尚未带入，原文与原草稿均保留。请重试追加。');}).finally(()=>setAppending(false));
      return;
    }
    lastAppendedRef.current = externalAppend.id;
    setText(old => {
      const next = old.trim().length > 0 ? `${old}\n\n${externalAppend.text}` : externalAppend.text;
      sessionStorage.setItem(storage + '.draft', next);
      return next;
    });
    onExternalAppended?.(externalAppend.id);
  }, [externalAppend,draftReady]);
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
      if(!keepDraft){sessionStorage.removeItem(storage+'.draft');void clearSentDraft(request.text).catch(()=>{if(alive.current)setDraftError('发送已完成，草稿清理尚未确认；请核对原对话，勿重复发送。');});}
      if(next.discussion.lastRun?.status==='completed')resultRef.current?.(next,request.requestId);
    } else if(!request && next.discussion?.pendingInput && next.discussion.pendingInput.requestId !== sessionStorage.getItem(storage+'.replace')){
      const original=next.discussion.pendingInput;
      remember(original);if(!original.planRequest&&!original.reviewRequest){if(!composerDraft)updateText(original.text);}
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
  const streamEndedRef=useRef(false);
  const [streamSeq,setStreamSeq]=useState(0);
  const inFlight=Boolean(view?.busy||busy||pending);
  useEffect(()=>{
    if(id&&inFlight&&streamEndedRef.current){streamEndedRef.current=false;setStreamSeq(n=>n+1);}
  },[id,inFlight]);
  useEffect(()=>{
    if(!id)return;
    const controller=new AbortController();
    const backoff=[500,1500,3000];
    const wait=(ms:number)=>new Promise<void>(resolve=>{
      if(controller.signal.aborted){resolve();return;}
      const done=()=>{clearTimeout(timer);controller.signal.removeEventListener('abort',done);resolve();};
      const timer=setTimeout(done,ms);
      controller.signal.addEventListener('abort',done,{once:true});
    });
    const isUnresolved=(next:RoleView|undefined)=>{
      if(!next||!next.discussion)return false;
      if(next.busy)return true;
      const req=pendingRef.current;
      if(!req)return false;
      const terminal=next.discussion.lastRun;
      if(terminal?.id===req.requestId&&['failed','cancelled'].includes(terminal.status))return false;
      return !canSettleDiscussionMessage(next,req);
    };
    void (async()=>{
      for(let attempt=0;attempt<=backoff.length&&!controller.signal.aborted;attempt++){
        streamEndedRef.current=false;
        let streamError:unknown;
        try{
          await watchStrategyDiscussion(id,event=>{
            if(controller.signal.aborted)return;
            if(event.type==='text.delta')setStream(old=>projectDiscussionStreaming(old,event));
            if(event.type==='run.settled'||event.type==='snapshot'&&event.snapshot.status==='idle'){
              setStream('');
              void load(controller.signal).catch(f=>{if(!controller.signal.aborted)onError(f);});
            }
          },controller.signal,base+'&action=events',{idleTimeoutMs:45000});
        }catch(f){
          if(controller.signal.aborted)return;
          streamError=f;
        }
        if(controller.signal.aborted)return;
        streamEndedRef.current=true;
        setStream('');
        let next:RoleView|undefined,loadError:unknown;
        try{next=await load(controller.signal);}catch(f){if(controller.signal.aborted)return;loadError=f;}
        if(controller.signal.aborted)return;
        const activeRun=!loadError&&isUnresolved(next);
        if(!loadError&&!activeRun){
          if(!streamError||!next?.busy){if(alive.current&&!streamError)setError('');return;}
        }
        if(attempt===backoff.length){
          onError(loadError??streamError??new Error('实时观察暂未恢复，原操作状态未确认；未重发消息，可点击「核对原操作」重新读取。'));
          return;
        }
        if(!activeRun&&!loadError)return;
        await wait(backoff[attempt]!);
      }
    })();
    return ()=>controller.abort();
  },[id,base,load,streamSeq]);
  // Runtime settlement may precede the business owner's persisted receipt.
  // Re-read that exact external request for a bounded window; never replay it.
  const receiptReads=useRef({requestId:'',attempts:0});
  useEffect(()=>{
    const originalId=pending?.requestId;
    const terminal=view?.discussion?.lastRun;
    if(!originalId||!view||busy||view.busy||sessionStorage.getItem(storage+'.keep.'+originalId)!=='1'||
       terminal?.id===originalId&&['failed','cancelled'].includes(terminal.status))return;
    if(receiptReads.current.requestId!==originalId)receiptReads.current={requestId:originalId,attempts:0};
    const budget=receiptReads.current;
    const controller=new AbortController();
    let timer:ReturnType<typeof setTimeout>|undefined;
    const schedule=()=>{
      if(controller.signal.aborted||pendingRef.current?.requestId!==originalId||budget.attempts>=8)return;
      timer=setTimeout(()=>{
        budget.attempts++;
        void load(controller.signal).then(next=>{
          if(!controller.signal.aborted&&pendingRef.current?.requestId===originalId&&!next?.busy)schedule();
        }).catch(f=>{if(!controller.signal.aborted)onError(f);});
      },Math.min(250*2**budget.attempts,2000));
    };
    schedule();
    return ()=>{controller.abort();if(timer)clearTimeout(timer);};
  },[pending?.requestId,view?.busy,view?.discussion?.lastRun?.id,view?.discussion?.lastRun?.status,busy,load,storage]);
  async function send(){
    if(readOnly||busy||!text.trim()||!view||pendingRef.current||!draftReady||appending)return;
    if(!await flushComposer())return;
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
  const externalSent=useRef<string|undefined>(readPendingBusinessRoleRequest(owner)?.id);
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
        <textarea id={inputId} aria-label={'向'+title+'提问'} rows={3} value={text} disabled={Boolean(pending)||!draftReady||appending}
          onChange={event=>updateText(event.target.value)}/>
        <div className="role-composer-actions">
          {recorded && configs.length > 0 && <label className="role-model">会话模型
            <select className="sg-select" value={model} disabled={busy||running||!!pending} onChange={event=>void act(()=>call('configuration','POST',{configurationId:event.target.value,expectedRevision:recorded.revision}))}>
              {configs.filter(c=>c.hasApiKey||c.id===model).map(c=><option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </label>}
          {!recorded && defaultModel && <span className="sg-muted">会话模型 · {configs.find(c=>c.id===defaultModel)?.name??defaultModel}</span>}
          <div className="role-send-actions">
            {recorded&&running&&<button type="button" className="secondary-button" disabled={busy} onClick={()=>void act(()=>call('stop','POST',{expectedRequestId:recorded.lastRun?.id}))}>停止</button>}
            <button type="submit" className="primary-button" disabled={!view||!text.trim()||busy||running||!!pending||!draftReady||appending}>发送</button>
          </div>
        </div>
      </form>
      {checkedAbsent && sameRevision && <button type="button" className="secondary-button" disabled={busy} onClick={()=>void dispatch(pending)}>按原编号发送</button>}
      {checkedAbsent && !sameRevision && <button type="button" className="secondary-button" disabled={busy} onClick={()=>prepareReplacement()}>保留原话并核对新的会话状态</button>}
      {pending&&recorded?.lastRun?.id===pending.requestId&&!running&&['failed','cancelled'].includes(recorded.lastRun.status)&&<button type="button" className="secondary-button" onClick={()=>prepareReplacement(pending.requestId)}>保留原话另行发送</button>}
    </>}
    {recoveredText!==null&&<div role="status"><p>本机还有一段未保存输入，原草稿保持原样。</p><pre>{recoveredText}</pre><button type="button" className="secondary-button" disabled={!draftReady||appending||!!pending} onClick={()=>{updateText([text,recoveredText].filter(Boolean).join('\n\n'));setRecoveredText(null);}}>追加这段保留输入</button></div>}
    {draftError&&<p className="case-error" role="alert">{draftError}<button type="button" className="text-button" onClick={()=>{if(draftReady)void flushComposer();else void composerDraft?.load().then(()=>{setDraftReady(true);setDraftError('');}).catch(()=>{});}}>核对并重试保存</button></p>}
    {conflictingText!==null&&<div role="region" aria-label="草稿版本冲突"><p>原位置另有更新，下方为原草稿；本页输入仍在上方。</p><pre>{conflictingText}</pre><button type="button" className="secondary-button" disabled={!!pending||appending} onClick={()=>{void composerDraft?.keepBoth().then(()=>void flushComposer()).catch(()=>setDraftError('原草稿又有更新，两份输入均保留，请重新核对。'));}}>保留两份输入并继续编辑</button></div>}
    {(pending||error||recorded?.lastRun?.status==='unknown')&&<button type="button" className="text-button" disabled={busy} onClick={()=>void act(()=>Promise.resolve())}>核对原操作</button>}
    {error&&<p className="case-error" role="alert">{error}</p>}
    {running&&<p className="sg-muted" role="status">正在回复…</p>}
    {recorded?.lastRun?.status==='unknown'&&<p className="sg-muted" role="status">上次操作结果待核，原会话已保留。</p>}
  </section></ConversationDrawer>;
}
