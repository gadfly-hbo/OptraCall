import { caseChoicePermitsAction } from '../case-decision-types.ts';
import type { TeachReviewOwner } from '../business-role-types.ts';
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import type { CaseDecisionIssue, CaseDecisionRevision, CaseIssueReply, CaseStrategyChoiceValue, CaseStrategyChoiceInput } from '../case-decision-types.ts';
import type { CaseRecord } from '../case-types.ts';
import type { TaskCreateIntent } from '../task-assignment.ts';
import type { ClientProject } from './project-types.ts';
import { BusinessRoleConversation } from './BusinessRoleConversation.tsx';
import { flushWorkspaceInputs } from './workspace-input-guards.ts';
import { CaseIssueTreeSidebar } from './CaseIssueTreeSidebar.tsx';
import { listWorkspaceDrafts, readDecisionRequests, type CaseDecisionRequestView } from './workspace-daily-client.ts';
import type { CarryOverFragmentPayload, WorkspaceDraftRecord } from '../workspace-draft-store.ts';
import { CaseDialog, CaseFormError, caseError, useOperationId } from './CaseDialogs.tsx';
import { caseIssues, caseIssueSources, caseIssueTimeline, createCaseIssue, readCaseDecisions, readCaseDecisionRevision, inspectIssueReply, saveCaseStrategyChoice, writeCaseIssue } from './case-decisions-client.ts';
import { projectCaseRoundSummary, type CaseIssueTimeline } from './case-board-navigation-model.ts';
import { projectCaseIssueProgress } from './case-issue-progress.ts';
import { CaseFeedbackDialog } from './CaseFeedbackDialog.tsx';
import { useCaseActionDraft } from './useCaseActionDraft.ts';
import { CaseActionDraftRecovery } from './CaseActionDraftRecovery.tsx';

type IssueRef = { caseId: string; issueId: string };
type Props = { entrySeq?: number; managementFooter?: ReactNode; onTeachReview?(owner:TeachReviewOwner):void; initialIssueId?: string; selectedIssueId?: string; onSelectIssue?: (issueId: string, intent?: 'explicit' | 'restore') => void; initialRequest?: {requestId:string;revision:number;issueId?:string}; record: CaseRecord; projects: ClientProject[]; onChange(): void; onBoard?(target?: import('./FeedbackContextPanel.tsx').FeedbackReviewStart): void; onOpenProject?(project: ClientProject, issue: IssueRef): void; onCreate(project: ClientProject, intent: TaskCreateIntent): void };
const openedRequestEntries = new Set<string>();
const choiceName: Record<CaseStrategyChoiceValue, string> = { trial: '试行', adjust: '调整', continue: '继续', defer: '暂缓', no_action: '本次不行动', gather_evidence: '补证', reject: '不采用', stop_considering: '停止考虑' };

export function CaseIssuePanel({ children, ...props }: Props & { children?: ReactNode }) {
  const { record, initialIssueId } = props;
  const [issues, setIssues] = useState<CaseDecisionIssue[]>(), [selected, setSelected] = useState(props.selectedIssueId ?? '');
  const [composerAppend, setComposerAppend] = useState<{ id: string; text: string } | null>(null);
  const [openRequests, setOpenRequests] = useState<CaseDecisionRequestView[]>([]);
  const [requestsReady, setRequestsReady] = useState(false);
  const [title, setTitle] = useState(''), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(true);
  const [addingIssue, setAddingIssue] = useState(false);
  const [timelines, setTimelines] = useState<Record<string, CaseIssueTimeline>>({});
  const [timelineErrors, setTimelineErrors] = useState<Record<string, string>>({});
  const [actionFocus, setActionFocus] = useState<{kind:'choice'|'feedback'|'history';seq:number;issueId:string}>();
  const [fragments, setFragments] = useState<WorkspaceDraftRecord<CarryOverFragmentPayload>[]>([]);
  const [draftNotice, setDraftNotice] = useState('');
  const conversationId = useId();
  const newIssueId = useId();
  const operation = useOperationId();
  const closed = record.status === 'closed';
  useEffect(() => {
    let active = true;
    void caseIssues(record.id).then(({issues: current}) => {
      if (!active) return;
      setIssues(current);
      setSelected(id => props.selectedIssueId && current.some(i => i.id === props.selectedIssueId) ? props.selectedIssueId
        : current.some(i => i.id === id) ? id
        : initialIssueId ? current.find(i => i.id === initialIssueId)?.id ?? '' : current[0]?.id ?? '');
      setError(initialIssueId && !current.some(i => i.id === initialIssueId) ? '原事项暂不可读取，请核对当前 Case。' : '');
    }, e => { if (active) { setError(caseError(e)); if(e?.status===403){setIssues([]);setSelected('');setFragments([]);setOpenRequests([]);} } });
    return () => { active = false; };
  }, [record.id, record.revision, initialIssueId]);
  useEffect(() => { if(issues&&(issues.some(issue=>issue.id===selected)||!issues.length&&!selected))props.onSelectIssue?.(selected, 'restore'); }, [selected,issues]);
  useEffect(()=>{if(props.selectedIssueId!==undefined&&issues&&(!issues.length&&props.selectedIssueId===''||issues.some(issue=>issue.id===props.selectedIssueId)))setSelected(props.selectedIssueId);},[props.selectedIssueId,issues]);
  useEffect(() => {
    let active = true;
    setTimelines({}); setTimelineErrors({});
    if (issues) void Promise.all(issues.map(async issue => {
      try {
        const value = await caseIssueTimeline(record.id, issue.id);
        if (active) setTimelines(previous => ({ ...previous, [issue.id]: value }));
      } catch (failure) {
        if (active) setTimelineErrors(previous => ({ ...previous, [issue.id]: caseError(failure) }));
      }
    }));
    return () => { active = false; };
  }, [record.id, record.revision, issues]);
  async function selectIssue(id:string) { if(!await flushWorkspaceInputs())return;setSelected(id);props.onSelectIssue?.(id,'explicit'); }
  useEffect(() => {
    let active = true;
    setRequestsReady(false);
    void readDecisionRequests(record.id).then(({ requests }) => { if (active) { setOpenRequests(requests.filter(r => r.status === 'open')); setRequestsReady(true); } }, failure => { if (active) { setOpenRequests([]); setError(caseError(failure)); } });
    void listWorkspaceDrafts<CarryOverFragmentPayload>('carry-over').then(({ drafts }) => {
      if (active) setFragments(drafts.filter(d => d.payload.targetCaseId === record.id && (!d.payload.targetIssueId || d.payload.targetIssueId === selected)));
    }, failure => { if (active && failure?.status === 403) setFragments([]); });
    return () => { active = false; };
  }, [record, selected]);
  async function add() {
    setBusy(true); setError('');
    try {
      const fields = { expectedRevision: record.revision, title };
      const { issue } = await createCaseIssue(record.id, { ...fields, operationId: operation(fields) });
      setIssues(old => old?.some(i => i.id === issue.id) ? old : [...(old ?? []), issue]);
      setSelected(issue.id); props.onSelectIssue?.(issue.id,'explicit'); setTitle(''); setAddingIssue(false); props.onChange();
    }
    catch (e) { setError(caseError(e)); } finally { setBusy(false); }
  }
  const requestIssueId = props.initialRequest?.issueId ?? props.initialIssueId ?? openRequests.find(request => request.requestId === props.initialRequest?.requestId && request.revision === props.initialRequest?.revision)?.issueId;
  const selectedIssue = issues?.find(issue => issue.id === selected);
  const selectedTimeline = timelines[selected];
  const currentRound = selectedTimeline?.rounds.at(-1);
  const progress = projectCaseIssueProgress(selectedTimeline, requestsReady ? openRequests : undefined);
  const pendingChoiceRequest = progress.pendingChoiceRequest;
  const summary = selectedTimeline ? projectCaseRoundSummary(selectedTimeline) : undefined;
  const focusAction = (kind: 'choice' | 'feedback' | 'history') => setActionFocus(previous => ({ kind, seq: (previous?.seq ?? 0) + 1, issueId: selected }));
  function openFeedback() { focusAction('feedback'); }
  return <div className="case-current-layout">
    <div className="case-current-navigation">
      <CaseIssueTreeSidebar record={record} issues={issues ?? []} timelines={timelines} timelineErrors={timelineErrors} selectedIssueId={selected} onSelectIssue={id => { void selectIssue(id); }} onChanged={props.onChange} onAddIssue={() => setAddingIssue(true)} />
      {issues && !closed && <details className="case-add-issue" open={addingIssue || !issues.length} onToggle={event => setAddingIssue(event.currentTarget.open)}>
        <summary>新增事项</summary>
        <div className="case-field">
          <label htmlFor={newIssueId}>需要讨论与取舍的问题</label>
          <input id={newIssueId} maxLength={240} value={title} onChange={e => setTitle(e.target.value)}/>
        </div>
        <button type="button" className="secondary-button" disabled={busy || !title.trim()} onClick={add}>创建事项</button>
      </details>}
      {!issues && !error && <p role="status" className="case-help">正在读取事项…</p>}
      <CaseFormError error={error}/>
    </div>
    <div className="case-current-main">
      {selectedIssue ? <>
        <div className="case-current-topline"><span>当前事项</span><span>／</span><span>{progress.roundLabel}</span><span className={`case-current-phase ${progress.reviewed ? 'reviewed' : ''}`}>{progress.phase}</span></div>
        <div className="case-current-title"><h2>{selectedIssue.title}</h2><div className="case-current-actions">
          <button id={`${conversationId}-feedback`} type="button" className="secondary-button" disabled={closed} onClick={openFeedback}>回录反馈</button>
          <button id={`${conversationId}-choice`} type="button" className="primary-button" disabled={closed} onClick={() => focusAction('choice')}>记录取舍</button>
        </div></div>
        <p className="case-current-question">{openRequests.find(request => request.issueId === selected)?.text ?? '围绕这个事项继续讨论，取舍与观察都保留在原记录中。'}</p>
        {summary ? <section className="case-current-summary" aria-label="本轮概览">
          <header><h3><span aria-hidden="true">◇</span> 本轮概览</h3><span>按已保存记录呈现 · 可查看来源</span></header>
          <dl><div><dt>已明确</dt><dd>{pendingChoiceRequest && currentRound ? `上一轮已保存记录：${summary.known}` : summary.known}</dd></div><div><dt>正在推进</dt><dd>{pendingChoiceRequest ? `本轮明确请求：${pendingChoiceRequest.text}；尚未记录回应这条请求的新取舍。` : summary.advancing}</dd></div><div><dt>接下来</dt><dd>{pendingChoiceRequest ? `由${pendingChoiceRequest.assignee.label ?? '原请求指定的承担人（身份待核）'}回应原请求。` : summary.next}</dd></div></dl>
          <div className="case-current-summary-note">{summary.limited ? '部分原记录暂不可读取，当前进展待核。' : '事项进展与目标结果分别记录；行动完成不代表目标已达成。'}<button type="button" className="text-button" onClick={() => focusAction('history')}>查看本轮原记录</button></div>
        </section> : <p className="case-help" role="status">{timelineErrors[selected] || '正在读取本轮原记录…'}</p>}
      </> : issues?.length === 0 ? <div className="case-current-empty"><h2>从一件需要推进的事开始</h2><p>{closed ? '此 Case 已关闭，尚无独立决策事项可供查看。' : '可以先继续已有项目，也可以新增一个需要讨论与取舍的事项。'}</p></div> : null}
      <section className="case-agent-entry" aria-labelledby={conversationId + '-title'}>
        <div className="case-current-agent-header"><span className="case-current-agent-avatar" aria-hidden="true">ϟ</span><h3 id={conversationId + '-title'}>Case Agent</h3><span>{selectedIssue ? `只围绕「${selectedIssue.title}」继续` : '先选择一件事项'}</span>{selected && <button type="button" className="text-button" aria-expanded={open} aria-controls={conversationId} onClick={() => setOpen(!open)}>{open ? '收起协作' : '与决策 Agent 协作'}</button>}</div>
        {fragments.length > 0 && <div className="case-carry-over-banner" role="region" aria-label="待带入片段">
          <strong>待带入片段（{fragments.length}，不会自动覆盖既有草稿或发送）</strong>
          {fragments.map(frag => <article key={frag.id} className="case-carry-over-item">
            <p>{frag.payload.originalText}</p>
            <details><summary>来源：{frag.payload.origin.label}</summary><p className="case-help">原文：{frag.payload.originalText}{frag.payload.origin.ref ? ` · 引用 ${frag.payload.origin.ref}` : ''}</p></details>
            {!closed && selected && <button type="button" className="secondary-button" onClick={() => {
              setOpen(true); setComposerAppend({ id:frag.id, text:frag.payload.originalText });
              setDraftNotice('正在将片段追加到原事项对话草稿；不会自动发送。');
            }}>{frag.payload.appendedAt ? '已追加（再次点击不重复）' : '追加到事项草稿'}</button>}
          </article>)}
          {draftNotice && <p className="case-notice" role="status">{draftNotice}</p>}
        </div>}
        <div id={conversationId} hidden={!open}>
          {selected && <BusinessRoleConversation owner={{ role:'case', caseId:record.id, itemId:selected }} readOnly={closed} showInlineTitle={false} externalAppend={composerAppend} onExternalAppended={() => { setComposerAppend(null);setDraftNotice('片段已追加到下方可发送的原对话草稿，原文与来处仍可回读。');void listWorkspaceDrafts<CarryOverFragmentPayload>('carry-over').then(({drafts})=>setFragments(drafts.filter(d=>d.payload.targetCaseId===record.id&&(!d.payload.targetIssueId||d.payload.targetIssueId===selected)))); }} />}
          {issues?.length === 0 && <p className="case-help">创建事项后，就可以从最关心的问题开始对话。</p>}
        </div>
      </section>
      {selected && <section className="case-current-records"><h3>本轮记录与交接</h3><IssueWork actionFocusIds={{choice:`${conversationId}-choice`,feedback:`${conversationId}-feedback`}} actionFocus={actionFocus?.issueId === selected ? actionFocus : undefined} openRequests={openRequests} key={`${selected}/${props.initialRequest && requestIssueId === selected ? `${props.initialRequest.requestId}@${props.initialRequest.revision}/${props.entrySeq ?? 'initial'}` : 'ordinary'}`} issueId={selected} {...props} initialRequest={props.initialRequest && requestIssueId === selected ? { ...props.initialRequest, issueId: selected } : undefined}/></section>}
      {children && <details className="case-current-origin"><summary>Case 创建来源</summary>{children}</details>}
      {props.managementFooter}
    </div>
  </div>;
}

type IssueRound = Awaited<ReturnType<typeof caseIssueTimeline>>['rounds'][number];
type IssueReply = Awaited<ReturnType<typeof caseIssueSources>>['replies'][number];
function exactKey(ref: CaseIssueReply) {
  return JSON.stringify([ref.projectId, ref.taskId, ref.sessionId, ref.messageId, ref.expectedTextSha256]);
}

function RoundReview({ round, replies, disabled, inspect, submit }: {
  round: IssueRound; replies: IssueReply[]; disabled: boolean;
  inspect: (source: CaseIssueReply) => void; submit: (fields: Record<string, unknown>) => void;
}) {
  const [feedbackId, setFeedbackId] = useState(''), [replyKey, setReplyKey] = useState('');
  const [observation, setObservation] = useState(''), [judgement, setJudgement] = useState(''), [nextStep, setNextStep] = useState('');
  const feedback = round.actions.flatMap(action => action.feedback);
  const selected = feedback.length === 1 ? feedback[0]!.revisionId : feedback.find(f => f.revisionId === feedbackId)?.revisionId;
  const passive = !caseChoicePermitsAction(round.choice.choice);
  if (!feedback.length && (!passive || round.historyLimited || round.actions.some(a=>a.quotedFeedbackLimited))) return null;
  const candidates = replies.filter(r => r.type === 'teach' && r.choiceId === round.choice.choiceId && (!r.feedbackRevisionId || r.feedbackRevisionId === selected));
  const reply = candidates.find(r => exactKey(r.source) === replyKey);
  return <details><summary>本轮复盘</summary>
    {feedback.length > 1 && <label>原看板观察<select value={selected ?? ''} onChange={e => { setFeedbackId(e.target.value); setReplyKey(''); }}>
      <option value="">选择本轮的观察</option>{feedback.map(f => <option key={f.revisionId} value={f.revisionId}>{f.outcome} · {f.revisionId.slice(0,8)}</option>)}</select></label>}
    {feedback.length === 1 && <p>原看板观察 · {feedback[0]!.outcome}</p>}
    <label>准确 Teach 原回复<select value={reply ? replyKey : ''} onChange={e => setReplyKey(e.target.value)}>
      <option value="">选择本轮 Teach 回复</option>{candidates.map(r => <option key={exactKey(r.source)} value={exactKey(r.source)}>{r.name} · {r.source.messageId}</option>)}</select></label>
    <button className="text-button" disabled={!reply} onClick={() => reply && inspect(reply.source)}>核对 Teach 原回复</button>
    <label>实际观察<textarea value={observation} onChange={e=>setObservation(e.target.value)}/></label><label>原判断怎样保留或修订<textarea value={judgement} onChange={e=>setJudgement(e.target.value)}/></label><label>下一步或结束理由<textarea value={nextStep} onChange={e=>setNextStep(e.target.value)}/></label>
    <button disabled={disabled || !reply || !observation.trim() || !judgement.trim() || !nextStep.trim() || !passive && !selected}
      onClick={() => reply && submit({choiceId:round.choice.choiceId,source:reply.source,observation,judgement,nextStep,...(selected ? {feedbackRevisionId:selected} : {})})}>保存本轮复盘</button>
  </details>;
}

function IssueWork({ entrySeq, actionFocusIds, actionFocus, openRequests = [], initialRequest: requestEntry, initialIssueId, record, projects, onChange, onBoard, onOpenProject, onCreate, onTeachReview, issueId }: Props & { issueId: string; openRequests?: CaseDecisionRequestView[]; actionFocusIds?: {choice:string;feedback:string}; actionFocus?: {kind:'choice'|'feedback'|'history';seq:number} }) {
  const requestIssueId = requestEntry?.issueId ?? initialIssueId ?? openRequests.find(request => request.requestId === requestEntry?.requestId && request.revision === requestEntry?.revision)?.issueId;
  const initialRequest = requestIssueId === issueId ? requestEntry : undefined;
  const [refresh,setRefresh] = useState(0);
  const [timeline,setTimeline] = useState<Awaited<ReturnType<typeof caseIssueTimeline>>>();
  const [sources,setSources] = useState<Awaited<ReturnType<typeof caseIssueSources>>>();
  const [plans,setPlans] = useState<CaseDecisionRevision[]>([]), [sourceId,setSourceId] = useState(''), [preview,setPreview] = useState('');
  const [projectId,setProjectId] = useState(''), [scope,setScope] = useState(''), [title,setTitle] = useState('');
  const [feedback,setFeedback] = useState('');
  const choiceDraftId = initialRequest ? `choice:${issueId}:${initialRequest.requestId}:${initialRequest.revision}` : `choice:${record.id}:${issueId}`;
  const choiceDraft = useCaseActionDraft({ id: choiceDraftId, caseId: record.id, issueId, kind: 'choice', readOnly: record.status === 'closed', initial: { planId: '', choice: 'trial' as CaseStrategyChoiceValue, reason: '', nextStep: '', responseKey: initialRequest ? `${initialRequest.requestId}@${initialRequest.revision}` : '', pending: null as Omit<CaseStrategyChoiceInput, 'caseId'> | null } });
  const { planId, choice, reason, nextStep, responseKey } = choiceDraft.value;
  const setPlanId = (value: string) => choiceDraft.change(previous => ({ ...previous, planId: value }));
  const setChoice = (value: CaseStrategyChoiceValue) => choiceDraft.change(previous => ({ ...previous, choice: value }));
  const setReason = (value: string) => choiceDraft.change(previous => ({ ...previous, reason: value }));
  const setResponseKey = (value: string) => choiceDraft.change(previous => ({ ...previous, responseKey: value }));
  const [choiceOpen, setChoiceOpen] = useState(false);
  const [choiceSaved, setChoiceSaved] = useState(false), [choiceRetry, setChoiceRetry] = useState(false);
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [feedbackRequest, setFeedbackRequest] = useState<CaseDecisionRequestView>();
  const closeChoice = async () => { if (!choiceDraft.dirty || await choiceDraft.flush()) setChoiceOpen(false); };
  const [requestPlan,setRequestPlan] = useState<Awaited<ReturnType<typeof readCaseDecisionRevision>>>();
  const [historicalConfirmed,setHistoricalConfirmed] = useState(false);
  const planSelectionTouched = useRef(false);
  const [error,setError] = useState(''), [busy,setBusy] = useState(false), [writing,setWriting] = useState(false), lock = useRef(false), operation = useOperationId();
  const feedbackSection = useRef<HTMLDetailsElement>(null), mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    if (!actionFocus) return;
    if (actionFocus.kind === 'choice') { setChoiceOpen(true); return; }
    if (actionFocus.kind === 'feedback') { setFeedbackRequest(undefined); setFeedbackOpen(true); return; }
    const section = feedbackSection.current;
    if (section) { section.open = true; section.scrollIntoView({block:'start',behavior:'smooth'}); section.querySelector('summary')?.focus({preventScroll:true}); }
  }, [actionFocus]);
  useEffect(() => {
    if (!initialRequest || record.status === 'closed') return;
    const key = `${record.id}/${issueId}/${initialRequest.requestId}@${initialRequest.revision}/${entrySeq ?? 'initial'}`;
    if (openedRequestEntries.has(key)) return;
    const request = openRequests.find(value => value.caseId === record.id && value.issueId === issueId && value.requestId === initialRequest.requestId && value.revision === initialRequest.revision);
    if (!request) return;
    openedRequestEntries.add(key);
    // Automatic entry has no surviving home-page trigger. Let the existing dialog
    // capture the corresponding current-work action as its normal return focus.
    const focusId = actionFocusIds?.[request.target.kind === 'choose' ? 'choice' : 'feedback'];
    if (focusId && typeof document !== 'undefined') document.getElementById(focusId)?.focus({ preventScroll: true });
    if (request.target.kind === 'choose') setChoiceOpen(true);
    else { setFeedbackRequest(request); setFeedbackOpen(true); }
  }, [record.id, issueId, initialRequest?.requestId, initialRequest?.revision, entrySeq, openRequests, record.status]);
  const planKey = (value: CaseDecisionRevision) => `${value.recordId}@${value.revision}`;
  const availablePlans = requestPlan && !plans.some(value => planKey(value) === planKey(requestPlan.revision)) ? [...plans, requestPlan.revision] : plans;
  const current = timeline?.rounds.at(-1), project = projects.find(p => p.id === projectId) ?? projects.find(p => !p.archivedAt), plan = availablePlans.find(p => planKey(p) === planId), reply = sources?.replies.find(r => exactKey(r.source) === sourceId);
  const feedbacks = current?.actions.flatMap(a => a.feedback) ?? [];
  const selectedFeedback = feedbacks.find(f => f.revisionId === feedback)?.revisionId ?? (feedbacks.length === 1 ? feedbacks[0]!.revisionId : '');
  const passive = !!current && !caseChoicePermitsAction(current.choice.choice);
  const selectedRequest = openRequests.find(request => request.issueId === issueId && request.target.kind === 'choose' && (responseKey ? `${request.requestId}@${request.revision}` === responseKey : request.requestId === initialRequest?.requestId && request.revision === initialRequest?.revision));
  const requestedStrategy = selectedRequest?.target.kind === 'choose' ? selectedRequest.target.strategyRef : undefined;
  const historical = Boolean(plan && requestPlan && planKey(plan) === planKey(requestPlan.revision) && plan.revision !== requestPlan.current.revision);
  useEffect(() => { if (!choiceDraft.ready || record.status === 'closed') return; planSelectionTouched.current = choiceDraft.restored; setHistoricalConfirmed(false); if (initialRequest && !choiceDraft.restored) setResponseKey(`${initialRequest.requestId}@${initialRequest.revision}`); }, [issueId, initialRequest?.requestId, initialRequest?.revision, choiceDraft.ready, choiceDraft.restored, record.status]);
  useEffect(() => { setHistoricalConfirmed(false); }, [planId, requestPlan]);
  useEffect(() => {
    let active = true;
    setRequestPlan(undefined);
    if (!requestedStrategy) return;
    const target = requestedStrategy;
    void readCaseDecisionRevision(record.id, target.recordId, target.revision).then(value => {
      const exact = value.revision;
      if (exact.caseId !== record.id || exact.caseStoreId !== target.caseStoreId || exact.recordId !== target.recordId || exact.revision !== target.revision || exact.kind !== 'strategy' || exact.issueId && exact.issueId !== issueId) throw Error('原请求的准确方案归属未能核对。');
      if (value.current.lifecycle !== 'active') throw Error('原请求方案已归档，当前不可记录新取舍。');
      if (active) setRequestPlan(value);
    }).catch(failure => { if (active) setError(caseError(failure)); });
    return () => { active = false; };
  }, [record.id, issueId, requestedStrategy?.caseStoreId, requestedStrategy?.recordId, requestedStrategy?.revision, refresh]);
  useEffect(()=>{
    if(record.status === 'closed' || !initialRequest || !choiceDraft.ready || choiceDraft.restored || planSelectionTouched.current)return;
    const request=openRequests.find(r=>r.requestId===initialRequest.requestId&&r.revision===initialRequest.revision&&r.issueId===issueId);
    if(request?.target.kind==='choose'){
      const target=request.target;
      const proposal=availablePlans.find(p=>p.recordId===target.strategyRef.recordId&&p.revision===target.strategyRef.revision&&p.caseStoreId===target.strategyRef.caseStoreId);
      if(proposal){setPlanId(planKey(proposal));setResponseKey(`${request.requestId}@${request.revision}`);}
    }
  },[initialRequest?.requestId,initialRequest?.revision,openRequests,plans,requestPlan,issueId,choiceDraft.ready,choiceDraft.restored,record.status]);
  useEffect(() => {
    let active = true; setBusy(true); setError(''); setPreview('');
    void (async () => {
      const [view, entries] = await Promise.all([caseIssueTimeline(record.id, issueId), caseIssueSources(record.id, issueId)]);
      const available: CaseDecisionRevision[] = []; let page: string | null = null;
      do {
        const listing = await readCaseDecisions(record.id, { includeArchived: false, pageSize: 50, continuation: page });
        available.push(...listing.items.filter(s => s.kind === 'strategy' && (!s.issueId || s.issueId === issueId))); page = listing.continuation;
      } while (page && active);
      if (active) { setTimeline(view); setSources(entries); setPlans(available); }
    })().catch(e => { if (active) { setError(caseError(e)); setTimeline(undefined); } }).finally(() => { if (active) setBusy(false); });
    return () => { active = false; };
  }, [record.id,record.revision,issueId,refresh]);
  function selectPlan(value: string) {
    planSelectionTouched.current = true; setHistoricalConfirmed(false); setPlanId(value);
    const focused = openRequests.find(request => request.issueId === issueId && request.requestId === initialRequest?.requestId && request.revision === initialRequest?.revision);
    setResponseKey(focused?.target.kind === 'choose' && value === `${focused.target.strategyRef.recordId}@${focused.target.strategyRef.revision}` ? `${focused.requestId}@${focused.revision}` : '');
  }
  const disabled = busy || writing || !timeline || record.status === 'closed';
  const choiceDisabled = disabled || !choiceDraft.ready || choiceDraft.isRestricted || Boolean(choiceDraft.value.pending) || choiceSaved;
  async function save(action: string, fields: Record<string, unknown>, post: (id: string) => Promise<unknown>) {
    if (lock.current) return;
    lock.current = true; setWriting(true); setError('');
    try { await post(operation({ action, caseId: record.id, issueId, ...fields })); setRefresh(v => v+1); onChange(); return true; }
    catch(e) { setError(caseError(e)); return false; } finally { lock.current = false; setWriting(false); }
  }
  async function completeChoice() {
    if (!mounted.current) return;
    setChoiceSaved(true);
    choiceDraft.change(previous => ({ ...previous, reason: '', nextStep: '', pending: null }));
    setRefresh(value => value+1); onChange();
    if (await choiceDraft.flush()) { setChoiceOpen(false); setChoiceSaved(false); }
  }
  async function submitChoice(fields: Omit<CaseStrategyChoiceInput, 'caseId' | 'operationId'>) {
    if (lock.current || disabled || !choiceDraft.ready || choiceDraft.isRestricted) return;
    lock.current = true; setWriting(true); setError('');
    const input = choiceDraft.value.pending ?? { ...fields, operationId: operation({ action: 'choice', caseId: record.id, issueId, ...fields }) };
    choiceDraft.change(previous => ({ ...previous, pending: input }));
    try {
      if (!await choiceDraft.flush() || !mounted.current) return;
      await saveCaseStrategyChoice(record.id, input);
      await completeChoice();
    } catch (failure) {
      if (!mounted.current) return;
      if (failure && typeof failure === 'object' && 'status' in failure && Number(failure.status) < 500) {
        choiceDraft.change(previous => ({ ...previous, pending: null })); await choiceDraft.flush();
        setError(caseError(failure));
      } else setError('取舍保存结果尚未确认，原输入和操作身份已保留。请先查询原保存结果。');
    } finally { lock.current = false; setWriting(false); setChoiceRetry(false); }
  }
  async function queryChoice() {
    const pending = choiceDraft.value.pending;
    if (!pending || lock.current) return;
    lock.current = true; setWriting(true); setError('');
    try {
      const original = await caseIssueTimeline(record.id, issueId);
      const receipt = original.rounds.find(round => round.choice.operationId === pending.operationId && round.choice.issueId === issueId && round.choice.caseId === record.id
        && round.choice.strategyRef.caseStoreId === pending.strategyRef.caseStoreId && round.choice.strategyRef.recordId === pending.strategyRef.recordId && round.choice.strategyRef.revision === pending.strategyRef.revision);
      if (receipt) await completeChoice();
      else { setChoiceRetry(true); setError('尚未查到原取舍。输入与原操作仍保留，可明确沿同一保存继续。'); }
    } catch (failure) { setError(caseError(failure)); }
    finally { lock.current = false; setWriting(false); }
  }
  async function showSource(source: CaseIssueReply) {
    setPreview(''); setError(''); try { const read = await inspectIssueReply(record.id,issueId,source); setPreview(read.text); } catch (e) { setError(caseError(e)); }
  }
  const write = (action:'plans'|'authorize'|'review', fields:Record<string,unknown>) => save(action, fields, operationId => writeCaseIssue(record.id,issueId,action,{ ...fields, operationId }));
  const task = (type:'plan'|'teach') => { if (project) onCreate(project,{ type, caseId: record.id, issueId, ...(type === 'teach' && current ? { choiceId: current.choice.choiceId, ...(selectedFeedback ? { feedbackRevisionId:selectedFeedback } : {}) } : {}) }); };
  return <div className="case-issue-work">
    {feedbackOpen && <CaseFeedbackDialog returnFocusId={actionFocusIds?.feedback} record={record} issueId={issueId} projects={projects} requests={openRequests} requested={feedbackRequest} onClose={() => setFeedbackOpen(false)} onSaved={() => { setFeedbackOpen(false); setRefresh(value => value+1); onChange(); }} onBoard={onBoard} />}
    {openRequests.filter(r=>r.issueId===issueId&&r.target.kind==='observe').map(r=><div className="case-message" key={r.requestId}><p>补原始观察：{r.text} · {r.assignee.label??'承担人未声明'}</p><button type="button" className="secondary-button" disabled={record.status==='closed'} onClick={()=>{setFeedbackRequest(r);setFeedbackOpen(true);}}>回录这条请求的原观察</button></div>)}
    <details ref={feedbackSection} className="case-round-history"><summary>历次取舍与实际反馈</summary>
      {timeline && !timeline.rounds.length && <p>尚无取舍。已有项目的原行动与观察仍可从原行动看板回读；这里不会补造行动或反馈。</p>}
      {timeline?.rounds.map(r => <article key={r.choice.choiceId}><h4>{choiceName[r.choice.choice]} · {r.strategy.payload.title} v{r.strategy.revision}</h4><p>{r.choice.reason} · {r.choice.occurredAt}</p>
        {r.strategy.references.map((ref,i) => {
          if (ref.target.type !== 'source' || ref.target.source.type !== 'native-reply') return null;
          const source = ref.target.source;
          return <button key={i} className="text-button" onClick={() => void showSource(source)}>查看准确方案原回复</button>;
        })}
        {r.actions.map(a => <div key={a.taskId}><p>{a.title} · 最近授权记录：{a.authorizations.at(-1)?.scope} · {a.status === 'done' ? '完成' : a.status === 'doing' ? '进行中' : '待办'}</p>
          {a.quotedFeedbackLimited && <p>部分反馈的原话与本轮行动授权未能对应。请核对原看板记录和原任务。</p>}
          {a.observationTimeLimited && <p>部分观察的原时间或授权先后待核。{onBoard && <button className="text-button" onClick={()=>onBoard({openOriginal:true,boardTaskId:a.taskId,feedbackRevisionId:null,draftKey:a.taskId})}>查看原看板记录</button>}</p>}
          {
            current?.choice.choiceId === r.choice.choiceId && a.currentAuthorizationId && <button className="text-button" disabled={disabled || !projects.some(p=>p.id===a.projectId&&!p.archivedAt)} onClick={()=>{
              const target=projects.find(p=>p.id===a.projectId&&!p.archivedAt);
              if(target)onCreate(target,{type:'do',caseId:record.id,issueId,choiceId:r.choice.choiceId,authorizationId:a.currentAuthorizationId});
            }}>交接已授权的 Do Task</button>
          }{a.feedback.length ? a.feedback.map(f => <p key={f.revisionId}>{f.outcome} · {f.metricDelta} · {f.review || '效果待核'}
            {a.authorizations.filter(auth => auth.id === f.authorizationId).map(auth => <small key={auth.id}>{auth.decision === 'revoke' ? '观察时授权已撤回' : '观察时授权范围'} · {auth.scope}</small>)}
            {onBoard && <button className="text-button" onClick={() => onBoard({openOriginal:true,boardTaskId:a.taskId,feedbackRevisionId:f.revisionId,draftKey:f.revisionId})}>查看原看板反馈</button>}
            <button className="text-button" disabled={disabled || !project} onClick={()=>project && onCreate(project,{type:'teach',caseId:record.id,issueId,choiceId:r.choice.choiceId,feedbackRevisionId:f.revisionId})}>按此观察准备 Teach</button></p>) :
            <p>{a.observationTimeLimited || a.quotedFeedbackLimited ? '观察与授权的对应关系待核' : a.currentAuthorizationId ? '待反馈' : '原行动授权已撤回或由后续授权取代'} {onBoard && <button className="text-button" onClick={() => onBoard({openOriginal:true,boardTaskId:a.taskId,feedbackRevisionId:null,draftKey:a.taskId})}>查看原看板行动</button>}</p>}
        </div>)}
        {r.reviewObservationLimited && <p>本轮已保存的复盘引用了归属待核的观察。请核对原看板记录。</p>}
        {r.historyLimited && <p>历史记录有限，当前无法读取原行动或观察。请核对项目关联与原资料权限。</p>}
        {!r.actions.length && !r.historyLimited && <p>
          {r.review ? '已记录实际观察' : !caseChoicePermitsAction(r.choice.choice) ? '等待本轮实际观察' : '尚未授权行动'}
          {!r.reviewSaved && record.status !== 'closed' && r.choice.choiceId !== current?.choice.choiceId &&
            (r.choice.choice === 'defer' || r.choice.choice === 'no_action') &&
            <button type="button" className="text-button" disabled={disabled || !project || Boolean(project.archivedAt)}
              onClick={() => project && onCreate(project, {
                type: 'teach', caseId: record.id, issueId, choiceId: r.choice.choiceId,
                roundSummary: [timeline.issue.title, choiceName[r.choice.choice], r.strategy.payload.title + ' v' + r.strategy.revision, r.choice.reason].filter(Boolean).join(' · '),
              })}>按本轮取舍准备 Teach</button>}
        </p>}
        {r.review && <><p>实际观察 · {r.review.observation}</p><p>复盘判断 · {r.review.judgement}</p><p>下一步或结束理由 · {r.review.nextStep}</p><button className="text-button" onClick={() => void showSource(r.review!.reply)}>查看 Teach 原回复</button></>}
        {!r.reviewSaved && record.status !== 'closed' && <RoundReview round={r} replies={sources?.replies ?? []} disabled={disabled}
          inspect={showSource} submit={fields => void write('review', {expectedRevision:record.revision,...fields})}/>}
        {r.review&&onTeachReview&&(r.choice.goalBinding?.strategy ? <div className="case-inline-actions">{(['goal','strategy'] as const).map(role=>
          <button key={role} type="button" className="text-button" onClick={()=>onTeachReview({role,...r.choice.goalBinding!.primary,teachReview:{caseId:record.id,issueId,choiceId:r.choice.choiceId,reviewId:r.review!.operationId}})}>{role==='goal'?'提交策略复核':'提交战略假设复核'}</button>)}</div> : <p>原轮次的目标或具体策略待核。</p>)}
      </article>)}
      <button className="text-button" onClick={() => setRefresh(n => n+1)}>刷新原记录</button>{onBoard && <button className="text-button" onClick={()=>onBoard()}>打开原行动看板</button>}
    </details>
    <label>关联项目<select value={project?.id ?? ''} onChange={e => setProjectId(e.target.value)}><option value="">请选择项目</option>{projects.filter(p => !p.archivedAt).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
    {!!feedbacks.length && <label>原看板观察<select value={selectedFeedback} onChange={e=>setFeedback(e.target.value)}><option value="">本轮当前可读观察</option>{feedbacks.map(f=><option key={f.revisionId} value={f.revisionId}>{f.outcome} · {f.revisionId.slice(0,8)}</option>)}</select></label>}
    <div className="case-inline-actions">{onOpenProject && project && <button onClick={() => onOpenProject(project, { caseId: record.id, issueId })}>回关联项目协作</button>}<button disabled={disabled || !project} onClick={() => task('plan')}>准备 Plan Task</button><button disabled={disabled || !project || !current} onClick={() => task('teach')}>准备 Teach Task</button></div>
    <details><summary>交接与依据</summary><label>准确 Task 原回复<select value={sourceId} onChange={e => { setSourceId(e.target.value); setPreview(''); }}><option value="">选择原条目</option>{sources?.replies.filter(r => r.type === 'plan').map(r => <option key={exactKey(r.source)} value={exactKey(r.source)}>{r.name} · {r.source.messageId}</option>)}</select></label>{!!sources?.limitations.length && <p>部分原条目暂不可读取。</p>}
      <button disabled={!reply} onClick={() => reply && void showSource(reply.source)}>核对原回复</button><button disabled={disabled || reply?.type !== 'plan'} onClick={() => reply && void write('plans',{ source: reply.source })}>将 Plan 候选交回事项</button></details>
    <button type="button" className="text-button" disabled={record.status==='closed'} onClick={() => setChoiceOpen(true)}>记录本次取舍</button>
    {choiceOpen && <CaseDialog title="记录本轮取舍" returnFocusId={actionFocusIds?.choice} subtitle={`${timeline?.issue.title ?? '当前事项'} · ${projectCaseIssueProgress(timeline, openRequests).roundLabel}`} className="case-round-choice-dialog" busy={writing} onClose={() => { void closeChoice(); }}>
      <div className="case-round-choice"><p className="case-help">保存取舍后才更新本轮记录；本次保存不新增行动授权。</p><label>准确方案<select disabled={choiceDisabled} value={planId} onChange={event => selectPlan(event.target.value)}><option value="">选择方案版本</option>{availablePlans.map(p => <option key={planKey(p)} value={planKey(p)}>{p.payload.title} v{p.revision}{requestPlan && planKey(p) === planKey(requestPlan.revision) && p.revision !== requestPlan.current.revision ? `（原请求历史版本，当前活动 v${requestPlan.current.revision}）` : ''}</option>)}</select></label>
      {historical && requestPlan && <label><input type="checkbox" checked={historicalConfirmed} disabled={disabled} onChange={event => setHistoricalConfirmed(event.target.checked)} />我确认按原请求的历史方案 v{plan?.revision} 记录本次取舍（当前活动 v{requestPlan.current.revision}）。</label>}
      <label>这次怎么选<select disabled={choiceDisabled} value={choice} onChange={e => setChoice(e.target.value as CaseStrategyChoiceValue)}>{Object.entries(choiceName).map(([id,label])=><option key={id} value={id}>{label}</option>)}</select></label><label>为什么这样选（依据与理由）<textarea disabled={choiceDisabled} value={reason} onChange={e => setReason(e.target.value)} /></label><label>接下来（可选）<input disabled={choiceDisabled} maxLength={200} value={nextStep} placeholder="与这件事项有关的下一步或等待条件" onChange={event => choiceDraft.change(previous => ({ ...previous, nextStep: event.target.value }))}/></label>
      {(() => {
        const matches = plan ? openRequests.filter(r => r.issueId === issueId && r.target.kind === 'choose' && r.target.strategyRef.caseStoreId === plan.caseStoreId && r.target.strategyRef.recordId === plan.recordId && r.target.strategyRef.revision === plan.revision && r.target.expectedPreviousChoiceId === (current?.choice.choiceId ?? null)) : [];
        const matchReq = (responseKey ? matches.find(r=>`${r.requestId}@${r.revision}`===responseKey) : undefined) ?? (!initialRequest&&matches.length===1 ? matches[0] : undefined);
        return <>{matches.length>1&&<label>回应哪一条原请求<select value={matchReq?`${matchReq.requestId}@${matchReq.revision}`:''} onChange={e=>{planSelectionTouched.current=true;setResponseKey(e.target.value);}}><option value="">本次不关联请求</option>{matches.map(r=><option key={r.requestId} value={`${r.requestId}@${r.revision}`}>{r.text} · v{r.revision}</option>)}</select></label>}{initialRequest&&!matchReq&&<p role="status">原请求的准确版本或方案尚未核对，本次不会将其他请求当作已回应。</p>}{matchReq && <p className="case-notice" role="status">本次取舍将精确回应明确请求：{matchReq.text}（承担人：{matchReq.assignee.label ?? '未声明'}）</p>}
        <div className="case-dialog-actions"><button type="button" className="secondary-button" disabled={writing} onClick={closeChoice}>取消 · 保留输入</button><button className="primary-button" disabled={choiceDisabled || !plan || !reason.trim() || historical && !historicalConfirmed} onClick={() => { if (!plan || historical && !historicalConfirmed) return; const fields = { caseStoreId: plan.caseStoreId, strategyRef: { type: 'case-decision' as const, caseStoreId:plan.caseStoreId,caseId:record.id,recordId:plan.recordId,revision:plan.revision }, issueId, choice, reason, ...(nextStep.trim() ? { nextStep: nextStep.trim() } : {}), expectedPreviousChoiceId: current?.choice.choiceId ?? null, ...(historical ? { allowHistorical: true } : {}), ...(matchReq ? { respondsToRequest: { requestId: matchReq.requestId, revision: matchReq.revision } } : {}) }; void submitChoice(fields); }}>保存取舍</button></div></>;
      })()}<CaseActionDraftRecovery draft={choiceDraft} owner={{id:choiceDraftId,caseId:record.id,issueId,kind:'choice'}} onDiscard={() => setChoiceOpen(false)}/>{choiceDraft.value.pending && <div className="case-message"><p>原保存结果待核；原输入保持不变，未确认前不会另存一次取舍。</p><button className="secondary-button" disabled={writing} onClick={() => { void queryChoice(); }}>查询原保存结果</button>{choiceRetry && <button className="secondary-button" disabled={writing || disabled} onClick={() => { if (choiceDraft.value.pending) void submitChoice(choiceDraft.value.pending); }}>沿原保存意图继续</button>}</div>}{choiceSaved && <p role="status">本轮取舍已保存。<button className="text-button" onClick={async () => { if (await choiceDraft.flush()) { setChoiceOpen(false); setChoiceSaved(false); } }}>返回当前事项</button></p>}<CaseFormError error={choiceDraft.error || error}/></div></CaseDialog>}
    {current && !passive && !current.actions.length && !current.historyLimited && <details><summary>授权本次行动</summary><label>看板行动<input value={title} onChange={e => setTitle(e.target.value)}/></label><label>授权范围<textarea value={scope} onChange={e => setScope(e.target.value)}/></label><button disabled={disabled || !project || !title.trim() || !scope.trim()} onClick={() => project && void write('authorize',{ projectId:project.id, choiceId: current.choice.choiceId,title,scope })}>确认授权并进入看板</button></details>}
    {preview && <details open><summary>准确原回复</summary><p className="case-prose">{preview}</p></details>}<CaseFormError error={error}/>
  </div>;
}
