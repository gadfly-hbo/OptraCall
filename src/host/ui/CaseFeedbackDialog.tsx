import { useEffect, useRef, useState } from 'react';
import { FeedbackDialog, feedbackDraft, type FeedbackDraft } from '../../../extensions/business-plugins/decision-board/ui/DecisionBoardPage.tsx';
import { BoardRequestError, readBoard, saveFeedback, feedbackOperation, type BoardItemView, type BoardTaskView, type BoardView, type FeedbackInput } from '../../../extensions/business-plugins/decision-board/ui/decision-board-client.ts';
import { observationRequestContext } from '../../../extensions/business-plugins/decision-board/ui/observation-request-model.ts';
import type { TaskFeedbackRevision } from '../../../extensions/business-plugins/decision-board/types.ts';
import type { CaseRecord } from '../case-types.ts';
import type { ClientProject } from './project-types.ts';
import type { FeedbackReviewStart } from './FeedbackContextPanel.tsx';
import type { CaseDecisionRequestView } from './workspace-daily-client.ts';
import { caseIssueTimeline } from './case-decisions-client.ts';
import { CaseDialog, CaseFormError, caseError } from './CaseDialogs.tsx';
import { useCaseActionDraft } from './useCaseActionDraft.ts';
import { CaseActionDraftRecovery } from './CaseActionDraftRecovery.tsx';

type Candidate = { item: BoardItemView; task: BoardTaskView; authorizationId: string; roundNumber: number; issueTitle?: string; request?: CaseDecisionRequestView };
type Props = { returnFocusId?: string; record: CaseRecord; issueId: string; projects: ClientProject[]; requests: CaseDecisionRequestView[]; requested?: CaseDecisionRequestView; onClose(): void; onSaved(): void; onBoard?(target?: FeedbackReviewStart): void };

/** Read-only intersection of the original issue's authorizations and the currently readable Board. */
export function caseFeedbackCandidates(caseId: string, issueId: string, timeline: Awaited<ReturnType<typeof caseIssueTimeline>>, board: BoardView, projects: ClientProject[], requests: CaseDecisionRequestView[]): Candidate[] {
  if (timeline.issue.caseId !== caseId || timeline.issue.id !== issueId) return [];
  const candidates: Candidate[] = [];
  timeline.rounds.forEach((round, index) => {
    for (const action of round.actions) {
      if (!action.currentAuthorizationId || !projects.some(project => project.id === action.projectId && !project.archivedAt)
        || !board.projects.some(project => project.id === action.projectId && !project.archivedAt)) continue;
      const item = board.items.find(value => value.id === action.itemId && value.projectId === action.projectId);
      const task = item?.tasks.find(value => value.id === action.taskId && value.itemId === action.itemId);
      if (!item || !task) continue;
      const matching = requests.filter(request => request.caseId === caseId && request.issueId === issueId && request.status === 'open' && request.lifecycle === 'open'
        && request.target.kind === 'observe' && request.target.projectId === item.projectId && request.target.itemId === item.id && request.target.taskId === task.id
        && request.target.authorizationId === action.currentAuthorizationId && request.target.feedbackBaseRevisionId === (task.feedback?.revisionId ?? null));
      candidates.push({ item, task, authorizationId: action.currentAuthorizationId, roundNumber: index + 1, issueTitle: timeline.issue.title, ...(matching.length === 1 ? { request: matching[0] } : {}) });
    }
  });
  return candidates;
}

export function CaseFeedbackDialog(props: Props) {
  const [candidates, setCandidates] = useState<Candidate[]>(), [selected, setSelected] = useState(''), [error, setError] = useState('');
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    let active = true; setCandidates(undefined); setSelected(''); setError('');
    void Promise.all([caseIssueTimeline(props.record.id, props.issueId), readBoard()]).then(([timeline, board]) => {
      if (!active) return;
      const available = caseFeedbackCandidates(props.record.id, props.issueId, timeline, board, props.projects, props.requests);
      setCandidates(available);
      if (props.requested) {
        const request = props.requested;
        const exact = available.find(candidate => request.target.kind === 'observe' && candidate.task.id === request.target.taskId
          && candidate.item.id === request.target.itemId && candidate.item.projectId === request.target.projectId && candidate.authorizationId === request.target.authorizationId
          && request.caseId === props.record.id && request.issueId === props.issueId);
        if (exact) setSelected(exact.task.id);
        else setError('原请求的行动或当前授权暂不可写，请核对准确原来源。没有改用其他行动。');
      } else if (available.length === 1) setSelected(available[0]!.task.id);
    }).catch(failure => { if (active) { setCandidates([]); setError(caseError(failure)); } });
    return () => { active = false; };
  }, [props.record.id, props.record.revision, props.issueId, props.requested?.requestId, props.requested?.revision, refresh]);
  const current = candidates?.find(candidate => candidate.task.id === selected);
  const currentRequest = props.requested?.target.kind === 'observe' && props.requested.target.taskId === current?.task.id ? props.requested : current?.request;
  if (current && props.record.status !== 'closed') return <CaseFeedbackForm key={`${current.task.id}/${currentRequest ? `${currentRequest.requestId}@${currentRequest.revision}` : 'ordinary'}`} {...props} candidate={current} request={currentRequest} />;
  return <CaseDialog returnFocusId={props.returnFocusId} title="回录实际反馈" subtitle="先确认这条观察对应的原行动与授权范围。" onClose={props.onClose} className="case-feedback-entry-dialog">
    {!candidates && <p role="status">正在读取当前事项的原行动与授权…</p>}
    {props.record.status === 'closed' ? <p>Case 已关闭，已有反馈可从原记录只读查看。</p> : candidates?.length ? <>
      <p className="case-help">请选择实际发生观察的行动。只有保存到这条行动的原反馈，才会回到对应的事项与轮次。</p>
      <div className="case-feedback-action-list">{candidates.map(candidate => <button type="button" className="secondary-button" key={candidate.task.id} onClick={() => setSelected(candidate.task.id)}><strong>{candidate.task.title}</strong><span>第 {candidate.roundNumber} 轮 · {props.projects.find(project => project.id === candidate.item.projectId)?.name}</span></button>)}</div>
    </> : candidates && <p className="case-help">当前事项还没有可写的原行动观察。可先回到当前工作核对行动授权，或查看原行动来源；这里不会把普通说明当作行动反馈。</p>}
    <CaseFormError error={error}/>
    <div className="case-dialog-actions"><button className="secondary-button" onClick={props.onClose}>返回当前事项</button><button className="secondary-button" onClick={() => setRefresh(value => value+1)}>重新读取原行动</button>{props.onBoard && <button className="text-button" onClick={() => { props.onClose(); const request = props.requested; props.onBoard?.(request?.target.kind === 'observe' ? { openOriginal: true, boardTaskId: request.target.taskId, feedbackRevisionId: request.target.feedbackBaseRevisionId, draftKey: crypto.randomUUID() } : undefined); }}>查看原行动来源</button>}</div>
  </CaseDialog>;
}

type StoredFeedbackDraft = { form: FeedbackDraft; unknownOperation: string | null };
export function caseObservationDraft(task: BoardTaskView): FeedbackDraft {
  const today = new Date();
  const observationDate = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`;
  return { executed: 'unknown', outcome: '', metricDelta: '', review: '', score: '', effect: 'unknown', expectedLatestRevisionId: task.feedback?.revisionId ?? null, operationId: crypto.randomUUID(), observationDate, sourceScope: '' };
}
function CaseFeedbackForm({ candidate, request, ...props }: Props & { candidate: Candidate; request?: CaseDecisionRequestView }) {
  const { task, item } = candidate;
  const draftId = request ? `feedback:${task.id}:${request.requestId}:${request.revision}` : `feedback:${props.record.id}:${props.issueId}:${task.id}`;
  const draft = useCaseActionDraft<StoredFeedbackDraft>({ id: draftId, caseId: props.record.id, issueId: props.issueId, kind: 'feedback', readOnly: props.record.status === 'closed', empty: { form: feedbackDraft({ ...task, feedback: undefined }), unknownOperation: null }, initial: { form: { ...caseObservationDraft(task), ...(request ? { requestContext: observationRequestContext(request) ?? undefined } : {}) }, unknownOperation: null } });
  const [error, setError] = useState(''), [busy, setBusy] = useState(false), [saved, setSaved] = useState(false);
  const locked = useRef(false), mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const close = async () => { if (!draft.dirty || await draft.flush()) props.onClose(); };
  async function complete(feedback: TaskFeedbackRevision, operationId: string) {
    if (feedback.taskId !== task.id || feedback.operationId !== operationId) throw Error('feedback_receipt_owner_mismatch');
    if (!mounted.current) return;
    setSaved(true);
    draft.change({ form: caseObservationDraft({ ...task, feedback }), unknownOperation: null });
    if (await draft.flush() && mounted.current) props.onSaved();
  }
  async function submit(input: FeedbackInput) {
    if (locked.current || props.record.status === 'closed' || !draft.ready || draft.isRestricted) return;
    locked.current = true; setBusy(true); setError('');
    try {
      const [timeline, board] = await Promise.all([caseIssueTimeline(props.record.id, props.issueId), readBoard()]);
      const exact = caseFeedbackCandidates(props.record.id, props.issueId, timeline, board, props.projects, props.requests)
        .some(value => value.task.id === task.id && value.item.id === item.id && value.item.projectId === item.projectId && value.authorizationId === candidate.authorizationId);
      if (!mounted.current) return;
      if (!exact) { setError('原行动的可见范围、项目状态或实际授权已变化。输入保留，请回到原行动核对。'); return; }
      // Persist the exact original intent before its network call, so a reopen can query an uncertain save.
      draft.change(previous => ({ ...previous, unknownOperation: input.operationId }));
      if (!await draft.flush() || !mounted.current) return;
      const result = await saveFeedback(task.id, input);
      await complete(result.feedback, input.operationId);
    } catch (failure) {
      if (!mounted.current) return;
      if (failure instanceof BoardRequestError && failure.status < 500) {
        draft.change(previous => ({ ...previous, unknownOperation: null }));
        await draft.flush();
      }
      setError(failure instanceof BoardRequestError ? failure.message : '保存结果未知。原输入与保存意图已保留，请先查询原结果。');
    } finally { locked.current = false; if (mounted.current) setBusy(false); }
  }
  async function query() {
    if (locked.current || !draft.value.unknownOperation) return;
    locked.current = true; setBusy(true);
    try {
      const result = await feedbackOperation(draft.value.unknownOperation);
      if (result.feedback) await complete(result.feedback, draft.value.unknownOperation);
      else if (mounted.current) { draft.change(previous => ({ ...previous, unknownOperation: null })); await draft.flush(); setError('尚未查到原保存结果。可明确继续同一保存，原操作身份和输入保持不变。'); }
    } catch { if (mounted.current) setError('原保存结果仍未知，请保留输入，稍后再次查询。'); }
    finally { locked.current = false; if (mounted.current) setBusy(false); }
  }
  if (saved) return <CaseDialog returnFocusId={props.returnFocusId} title="反馈已保存" onClose={() => { void close(); }}><p>原行动反馈已新增一版，旧记录保留。</p><CaseFormError error={draft.error}/><button className="primary-button" onClick={async () => { if (await draft.flush()) props.onSaved(); }}>返回当前事项</button></CaseDialog>;
  const legacyDraft = draft.restored && !Object.hasOwn(draft.value.form, 'observationDate');
  return <FeedbackDialog returnFocusId={props.returnFocusId} presentation={legacyDraft ? 'board' : 'case'} contextLabel={`${candidate.issueTitle ?? '当前事项'} · 原行动第 ${candidate.roundNumber} 轮`} task={task} subject={{ projectId: item.projectId, itemId: item.id, taskId: task.id }} draft={draft.value.form} busy={busy} readOnly={!draft.ready || draft.isRestricted || props.record.status === 'closed'} draftControls={<>{legacyDraft && <p className="case-help">已恢复原完整反馈草稿，保留原字段、正文和保存意图。可直接继续原保存，无需补填观察日期。</p>}<CaseActionDraftRecovery draft={draft} owner={{id:draftId,caseId:props.record.id,issueId:props.issueId,kind:'feedback'}} onDiscard={props.onClose}/></>} requestScope={request ? observationRequestContext(request) ?? undefined : undefined} error={draft.error || error} unknownOperation={draft.value.unknownOperation}
    onChange={form => draft.change(previous => ({ ...previous, form }))} onClose={() => { void close(); }} onSubmit={submit} onQuery={query}
    onAsk={() => { void (async () => { if (!await draft.flush()) return; props.onClose(); props.onBoard?.({ boardTaskId: task.id, feedbackRevisionId: null, draftKey: crypto.randomUUID() }); })(); }} />;
}
