import { caseChoicePermitsAction } from '../case-decision-types.ts';
import type { TeachReviewOwner } from '../business-role-types.ts';
import { useEffect, useRef, useState } from 'react';
import type { CaseDecisionIssue, CaseDecisionRevision, CaseIssueReply, CaseStrategyChoiceValue } from '../case-decision-types.ts';
import type { CaseRecord } from '../case-types.ts';
import type { TaskCreateIntent } from '../task-assignment.ts';
import type { ClientProject } from './project-types.ts';
import { BusinessRoleConversation } from './BusinessRoleConversation.tsx';
import { CaseFormError, caseError, useOperationId } from './CaseDialogs.tsx';
import { caseIssues, caseIssueSources, caseIssueTimeline, createCaseIssue, readCaseDecisions, inspectIssueReply, saveCaseStrategyChoice, writeCaseIssue } from './case-decisions-client.ts';

type IssueRef = { caseId: string; issueId: string };
type Props = { onTeachReview?(owner:TeachReviewOwner):void; initialIssueId?: string; record: CaseRecord; projects: ClientProject[]; onChange(): void; onBoard?(target?: import('./FeedbackContextPanel.tsx').FeedbackReviewStart): void; onOpenProject?(project: ClientProject, issue: IssueRef): void; onCreate(project: ClientProject, intent: TaskCreateIntent): void };
const choiceName: Record<CaseStrategyChoiceValue, string> = { trial: '试行', adjust: '调整', continue: '继续', defer: '暂缓', no_action: '本次不行动', gather_evidence: '补证', reject: '不采用', stop_considering: '停止考虑' };

export function CaseIssuePanel(props: Props) {
  const { record } = props;
  const [issues, setIssues] = useState<CaseDecisionIssue[]>([]), [selected, setSelected] = useState(props.initialIssueId ?? ''), [title, setTitle] = useState(''), [error,setError] = useState(''), [busy,setBusy] = useState(false);
  const operation = useOperationId();
  useEffect(() => { let active = true; void caseIssues(record.id).then(r => { if (active) { setIssues(r.issues); setSelected(id => r.issues.some(i => i.id === id) ? id : props.initialIssueId ? '' : r.issues[0]?.id ?? ''); if (props.initialIssueId && !r.issues.some(i => i.id === props.initialIssueId)) setError('原事项暂不可读取，请核对当前 Case。'); } }, e => { if (active) setError(caseError(e)); }); return () => { active = false; }; }, [record.id, record.revision, props.initialIssueId]);
  async function add() {
    setBusy(true); setError('');
    try { const fields = { expectedRevision: record.revision, title }; const { issue } = await createCaseIssue(record.id, { ...fields, operationId: operation(fields) }); setIssues(old => old.some(i => i.id === issue.id) ? old : [...old, issue]); setSelected(issue.id); setTitle(''); props.onChange(); }
    catch (e) { setError(caseError(e)); } finally { setBusy(false); }
  }
  return <section className="case-detail-text"><h3>独立决策事项</h3>
    {!!issues.length && <label>当前事项<select value={selected} onChange={e => setSelected(e.target.value)}>{issues.map(i => <option key={i.id} value={i.id}>{i.title}</option>)}</select></label>}
    {record.status !== 'closed' && <details><summary>新增独立事项</summary><label>需要取舍的经营问题<input maxLength={240} value={title} onChange={e => setTitle(e.target.value)} /></label><button className="secondary-button" disabled={busy || !title.trim()} onClick={add}>创建事项</button></details>}
    {!issues.length && <p>历史取舍可在持续工作记录中回看，所属事项待核。</p>}
    <CaseFormError error={error}/>{selected && <IssueWork key={selected} issueId={selected} {...props}/>}
  </section>;
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
  if (!feedback.length && (!passive || round.historyLimited)) return null;
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

function IssueWork({ record, projects, onChange, onBoard, onOpenProject, onCreate, onTeachReview, issueId }: Props & { issueId: string }) {
  const [open,setOpen] = useState(false), [refresh,setRefresh] = useState(0);
  const [timeline,setTimeline] = useState<Awaited<ReturnType<typeof caseIssueTimeline>>>();
  const [sources,setSources] = useState<Awaited<ReturnType<typeof caseIssueSources>>>();
  const [plans,setPlans] = useState<CaseDecisionRevision[]>([]), [planId,setPlanId] = useState(''), [sourceId,setSourceId] = useState(''), [preview,setPreview] = useState('');
  const [projectId,setProjectId] = useState(''), [choice,setChoice] = useState<CaseStrategyChoiceValue>('trial'), [reason,setReason] = useState(''), [scope,setScope] = useState(''), [title,setTitle] = useState('');
  const [feedback,setFeedback] = useState('');
  const [error,setError] = useState(''), [busy,setBusy] = useState(false), [writing,setWriting] = useState(false), lock = useRef(false), operation = useOperationId();
  const current = timeline?.rounds.at(-1), project = projects.find(p => p.id === projectId) ?? projects.find(p => !p.archivedAt), plan = plans.find(p => p.recordId === planId), reply = sources?.replies.find(r => exactKey(r.source) === sourceId);
  const feedbacks = current?.actions.flatMap(a => a.feedback) ?? [];
  const selectedFeedback = feedbacks.find(f => f.revisionId === feedback)?.revisionId ?? (feedbacks.length === 1 ? feedbacks[0]!.revisionId : '');
  const passive = !!current && !caseChoicePermitsAction(current.choice.choice);
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
  const disabled = busy || writing || !timeline || record.status === 'closed';
  async function save(action: string, fields: Record<string, unknown>, post: (id: string) => Promise<unknown>) {
    if (lock.current) return;
    lock.current = true; setWriting(true); setError('');
    try { await post(operation({ action, caseId: record.id, issueId, ...fields })); setRefresh(v => v+1); onChange(); }
    catch(e) { setError(caseError(e)); } finally { lock.current = false; setWriting(false); }
  }
  async function showSource(source: CaseIssueReply) {
    setPreview(''); setError(''); try { const read = await inspectIssueReply(record.id,issueId,source); setPreview(read.text); } catch (e) { setError(caseError(e)); }
  }
  const write = (action:'plans'|'authorize'|'review', fields:Record<string,unknown>) => save(action, fields, operationId => writeCaseIssue(record.id,issueId,action,{ ...fields, operationId }));
  const task = (type:'plan'|'teach') => { if (project) onCreate(project,{ type, caseId: record.id, issueId, ...(type === 'teach' && current ? { choiceId: current.choice.choiceId, ...(selectedFeedback ? { feedbackRevisionId:selectedFeedback } : {}) } : {}) }); };
  return <div className="case-issue-work">
    <button className="secondary-button" aria-expanded={open} onClick={() => setOpen(!open)}>{open ? '收起协作' : '与决策 Agent 协作'}</button>
    <div hidden={!open}><BusinessRoleConversation owner={{ role:'case',caseId:record.id,itemId:issueId }}/></div>
    <details open><summary>历次取舍与实际反馈</summary>
      {timeline && !timeline.rounds.length && <p>尚无取舍。</p>}
      {timeline?.rounds.map(r => <article key={r.choice.choiceId}><h4>{choiceName[r.choice.choice]} · {r.strategy.payload.title} v{r.strategy.revision}</h4><p>{r.choice.reason} · {r.choice.occurredAt}</p>
        {r.strategy.references.map((ref,i) => {
          if (ref.target.type !== 'source' || ref.target.source.type !== 'native-reply') return null;
          const source = ref.target.source;
          return <button key={i} className="text-button" onClick={() => void showSource(source)}>查看准确方案原回复</button>;
        })}
        {r.actions.map(a => <div key={a.taskId}><p>{a.title} · {a.authorizations.at(-1)?.scope} · {a.status === 'done' ? '完成' : a.status === 'doing' ? '进行中' : '待办'}</p>
          {
            current?.choice.choiceId === r.choice.choiceId && a.currentAuthorizationId && <button className="text-button" disabled={disabled || !projects.some(p=>p.id===a.projectId&&!p.archivedAt)} onClick={()=>{
              const target=projects.find(p=>p.id===a.projectId&&!p.archivedAt);
              if(target)onCreate(target,{type:'do',caseId:record.id,issueId,choiceId:r.choice.choiceId,authorizationId:a.currentAuthorizationId});
            }}>交接已授权的 Do Task</button>
          }{a.feedback.length ? a.feedback.map(f => <p key={f.revisionId}>{f.outcome} · {f.metricDelta} · {f.review || '效果待核'}
            {onBoard && <button className="text-button" onClick={() => onBoard({openOriginal:true,boardTaskId:a.taskId,feedbackRevisionId:f.revisionId,draftKey:f.revisionId})}>查看原看板反馈</button>}
            <button className="text-button" disabled={disabled || !project} onClick={()=>project && onCreate(project,{type:'teach',caseId:record.id,issueId,choiceId:r.choice.choiceId,feedbackRevisionId:f.revisionId})}>按此观察准备 Teach</button></p>) :
            <p>{a.currentAuthorizationId ? '待反馈' : '原行动授权已撤回或由后续授权取代'} {onBoard && <button className="text-button" onClick={() => onBoard({openOriginal:true,boardTaskId:a.taskId,feedbackRevisionId:null,draftKey:a.taskId})}>查看原看板行动</button>}</p>}
        </div>)}
        {r.historyLimited && <p>历史记录有限，当前无法读取原行动或观察。请核对项目关联与原资料权限。</p>}
        {!r.actions.length && !r.historyLimited && <p>{r.review ? '已记录实际观察' : !caseChoicePermitsAction(r.choice.choice) ? '等待本轮实际观察' : '尚未授权行动'}</p>}
        {r.review && <><p>实际观察 · {r.review.observation}</p><p>复盘判断 · {r.review.judgement}</p><p>下一步或结束理由 · {r.review.nextStep}</p><button className="text-button" onClick={() => void showSource(r.review!.reply)}>查看 Teach 原回复</button></>}
        {!r.review && record.status !== 'closed' && <RoundReview round={r} replies={sources?.replies ?? []} disabled={disabled}
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
    <details><summary>记录本次取舍</summary><label>准确方案<select value={planId} onChange={e => setPlanId(e.target.value)}><option value="">选择方案版本</option>{plans.map(p => <option key={p.recordId} value={p.recordId}>{p.payload.title} v{p.revision}</option>)}</select></label>
      <label>取舍<select value={choice} onChange={e => setChoice(e.target.value as CaseStrategyChoiceValue)}>{Object.entries(choiceName).map(([id,label])=><option key={id} value={id}>{label}</option>)}</select></label><label>依据与理由<textarea value={reason} onChange={e => setReason(e.target.value)} /></label>
      <button disabled={disabled || !plan || !reason.trim()} onClick={() => { if (!plan) return; const fields = { caseStoreId: plan.caseStoreId, strategyRef: { type: 'case-decision' as const, caseStoreId:plan.caseStoreId,caseId:record.id,recordId:plan.recordId,revision:plan.revision }, issueId, choice, reason, expectedPreviousChoiceId: current?.choice.choiceId ?? null }; void save('choice',fields, operationId => saveCaseStrategyChoice(record.id,{...fields, operationId})); }}>确认取舍</button></details>
    {current && !passive && !current.actions.length && !current.historyLimited && <details><summary>授权本次行动</summary><label>看板行动<input value={title} onChange={e => setTitle(e.target.value)}/></label><label>授权范围<textarea value={scope} onChange={e => setScope(e.target.value)}/></label><button disabled={disabled || !project || !title.trim() || !scope.trim()} onClick={() => project && void write('authorize',{ projectId:project.id, choiceId: current.choice.choiceId,title,scope })}>确认授权并进入看板</button></details>}
    {preview && <details open><summary>准确原回复</summary><p className="case-prose">{preview}</p></details>}<CaseFormError error={error}/>
  </div>;
}
