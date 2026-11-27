import { checkTeachObservationHistory } from './project-history.ts';
import type { BoardActionAuthorization, TaskFeedbackRevision } from '../../extensions/business-plugins/decision-board/types.ts';
import { quotedFeedbackMatches } from './quoted-feedback-origins.ts';
import { caseChoicePermitsAction } from './case-decision-types.ts';
import { CaseStoreError } from './case-types.ts';
import { caseDecisionFields, caseDecisionId, caseDecisionRevision, caseDecisionText, parseCaseDecisionTarget } from './case-decision-validation.ts';
import type { CaseDecisionRef, CaseDecisionRevision, CaseIssueReply, CaseIssueReview, CaseStrategyChoice } from './case-decision-types.ts';
import { requestStatus } from './case-decision-types.ts';
import type { CaseDecisionServiceDependencies } from './case-decision-service.ts';
import { listTaskResultSources, ProjectTaskResultSourceError, type TaskBoundReportsOptions } from './project-task-result-sources.ts';
import { createNativeSnapshotReadBudget, NativeSnapshotError } from './native-session-snapshot.ts';

const fail = (code: string, status = 409): never => { throw new CaseStoreError(code, status); };
type QualifyReply = (source: CaseIssueReply, requestId: string) => Promise<void>;
interface IssueRoundSelection {
  choiceId?: string;
  feedbackRevisionId?: string;
  execution?: { authorizationId: string; projectId: string };
  reviewId?: string;
}
/** An issue has one current choice. Historical choices without an issue are sequenced per strategy. */
export function assertActionableCaseChoice(cases: CaseDecisionServiceDependencies['cases'], choice: CaseStrategyChoice) {
  if (!caseChoicePermitsAction(choice.choice)) return fail('case_choice_not_actionable');
  const current = cases.getStrategyChoices(choice.caseId).filter(row => choice.issueId
    ? row.issueId === choice.issueId
    : !row.issueId && row.strategyRef.recordId === choice.strategyRef.recordId).at(-1);
  if (current?.choiceId !== choice.choiceId) return fail('case_choice_conflict');
}
function replyReference(input: unknown) {
  const target = parseCaseDecisionTarget({ type: 'source', source: input });
  if (target.type !== 'source' || target.source.type !== 'native-reply' || target.source.excerpt) return fail('invalid_case_issue_reply');
  return target.source;
}

// Board authorizations are ordered by their immutable per-action revision. A feedback
// migration's savedAt is the import time, so use the original edit time for that row.
export function authorityAtFeedback(rows: BoardActionAuthorization[], feedback: TaskFeedbackRevision) {
  const observedAt = feedback.origin === 'legacy-current' ? feedback.legacyUpdatedAt : feedback.savedAt;
  const when = observedAt ? Date.parse(observedAt) : NaN;
  if (!Number.isFinite(when)) return undefined;
  let before = -1, after = rows.length, previous = -Infinity;
  for (const [index, row] of rows.entries()) {
    const time = Date.parse(row.createdAt);
    if (!Number.isFinite(time)) continue;
    if (time < previous || time === when) return undefined;
    previous = time;
    if (time < when) before = index;
    else if (after === rows.length) after = index;
  }
  // Missing times outside these two bracketing revisions cannot change the answer.
  if (after !== before + 1) return undefined;
  return before < 0 ? null : { authority:rows[before]!, observedAt:observedAt! };
}

/** Issue identity belongs to Case. Sources, human authorizations, actions and observations keep their original owners. */
export function createCaseIssueService(deps: CaseDecisionServiceDependencies) {
  const { cases } = deps;
  function issue(caseId: string, issueId: string, write = false) {
    const selected = cases.getDecisionIssue(caseId, issueId);
    if (write && (!cases.isDecisionWritingEnabled() || cases.getStatus().state !== 'ready')) fail('case_decisions_disabled');
    if (write && cases.getCase(caseId).status === 'closed') fail('case_closed');
    return selected;
  }
  async function linkedProject(caseId: string, projectId: string) {
    if (!cases.listProjectLinks(caseId).some(link => link.projectId === projectId)) return fail('project_not_linked');
    const project = await deps.projects.get(projectId); deps.assertActive(project); return project;
  }
  async function availableReplies(project: Awaited<ReturnType<typeof linkedProject>>, task: typeof project.tasks[number], options?:TaskBoundReportsOptions) {
    try { return await listTaskResultSources(project,task,options); }
    catch (error) {
      if (error instanceof ProjectTaskResultSourceError || error instanceof NativeSnapshotError || (error as NodeJS.ErrnoException)?.code === 'ENOENT') return {replies:[],limitations:['case_issue_reply_unavailable']};
      throw error;
    }
  }
  async function readReply(caseId: string, issueId: string, source: CaseIssueReply, type: 'plan' | 'teach', choiceId?: string, qualify?: QualifyReply, observation?:import('./task-round-receipts.ts').ObservedAction) {
    const project = await linkedProject(caseId, source.projectId);
    const task = project.tasks.find(t => t.id === source.taskId && !t.archivedAt);
    const owner = task?.assignment?.issue;
    if (!task || task.assignment?.type !== type || owner?.caseId !== caseId || owner.issueId !== issueId || owner.choiceId !== choiceId) return fail('case_issue_source_scope_mismatch');
    const bindings = await availableReplies(project, task);
    const exact = bindings.replies.find(r => r.sessionId === source.sessionId && r.messageId === source.messageId && r.sha256 === source.expectedTextSha256);
    if (!exact) return fail('case_issue_reply_unavailable');
    await qualify?.(source,exact.requestId);
    if (observation) await checkTeachObservationHistory(project,task,observation,source.messageId);
    const actual = await deps.readSource?.(source, { audience: qualify ? 'agent' : 'human' });
    if (actual?.status !== 'available' || !actual.text || actual.sha256 !== source.expectedTextSha256) return fail('case_issue_reply_unavailable');
    return { title: task.name, text: actual.text, requestId:exact.requestId, feedbackRevisionId: owner.feedbackRevisionId };
  }
  async function checkPlan(reference: CaseDecisionRef) {
    const strategy = cases.getDecision(reference.caseId, reference.recordId, reference.revision);
    if (!strategy.issueId) return;
    for (const ref of strategy.references) {
      if (ref.relation !== 'derived_from' || ref.target.type !== 'source' || ref.target.source.type !== 'native-reply') continue;
      const source = ref.target.source;
      const actual = await readReply(strategy.caseId, strategy.issueId, source, 'plan');
      await deps.qualifyPlanReply?.(strategy.caseId, strategy.issueId, source, actual.requestId);
    }
  }
  async function inspectIssueReply(caseId: string, issueId: string, input: unknown) {
    issue(caseId, issueId);
    const source = replyReference(input);
    const project = await linkedProject(caseId, source.projectId);
    const assignment = project.tasks.find(t => t.id === source.taskId)?.assignment;
    if (assignment?.type !== 'teach' && assignment?.type !== 'plan') return fail('case_issue_source_scope_mismatch');
    return readReply(caseId, issueId, source, assignment.type, assignment.issue?.choiceId);
  }
  async function issueSources(caseId: string, issueId: string) {
    issue(caseId, issueId);
    const replies: { name: string; type: 'plan' | 'teach'; choiceId?: string; feedbackRevisionId?: string; source: CaseIssueReply }[] = [];
    const budget = createNativeSnapshotReadBudget(), limitations: string[] = [];
    for (const { projectId } of cases.listProjectLinks(caseId)) {
      const project = await deps.projects.get(projectId);
      if (project.archivedAt) continue;
      for (const task of project.tasks) {
        const assignment = task.assignment;
        if (task.archivedAt || assignment?.issue?.caseId !== caseId || assignment.issue.issueId !== issueId || !['plan', 'teach'].includes(assignment.type)) continue;
        const sources = await availableReplies(project, task, { budget });
        limitations.push(...(sources.limitations ?? []));
        for (const r of sources.replies) replies.push({ name: task.name, type: assignment.type as 'plan' | 'teach', choiceId: assignment.issue.choiceId, feedbackRevisionId: assignment.issue.feedbackRevisionId,
          source: { type: 'native-reply', projectId, taskId: task.id, sessionId: r.sessionId, messageId: r.messageId, expectedTextSha256: r.sha256 } });
      }
    }
    return { replies, limitations };
  }
  async function issueTimeline(caseId: string, issueId: string) {
    const selected = issue(caseId, issueId);
    const choices = cases.getStrategyChoices(caseId).filter(c => c.issueId === issueId);
    const events = cases.getEvents('case', caseId), board = deps.board;
    const unresolvedObservations = new Set<string>();
    const observationKey = (choiceId:string, projectId:string, taskId:string, revisionId:string) => [choiceId,projectId,taskId,revisionId].join('/');
    const reviews = events.flatMap(e => e.changes.issueReview ? [e.changes.issueReview.after as CaseIssueReview] : []);
    const rounds = choices.map(choice => {
      const review = reviews.find(r => r.choiceId === choice.choiceId) ?? null;
      return { choice, reviewSaved: Boolean(review), historyLimited:false, reviewObservationLimited:false, strategy: cases.getDecision(caseId, choice.strategyRef.recordId, choice.strategyRef.revision), review,
      actions: [] as { projectId: string; itemId: string; taskId: string; title: string; status: string; currentAuthorizationId?: string; authorizations: { id: string; scope: string; decision: string; time: string }[]; observationTimeLimited?: boolean; quotedFeedbackLimited?: boolean;
        feedback: { revisionId: string; observedAt: string; authorizationId: string; actionTitle: string; effect: string; outcome: string; metricDelta: string; review: string }[] }[] };
    });
    if (board && rounds.length) {
      const matchesOriginalCall = quotedFeedbackMatches(deps.projects);
      const linked = new Set(cases.listProjectLinks(caseId).map(p => p.projectId));
      for (const task of board.listTasks()) {
        const item = board.getItem(task.itemId);
        const all = board.listActionAuthorizations?.(task.id) ?? [];
        for (const round of rounds) {
          const ours = (a: typeof all[number]) => !('kind' in a.source) && a.source.caseId === caseId && a.source.choiceId === round.choice.choiceId;
          const authority = all.filter(ours);
          if (!authority.length) continue;
          if (!linked.has(item.projectId)) { round.historyLimited = true; continue; }
          if (item.sourceKind === 'report-confirmation') {
            try { if (!deps.assertBoardItemReadable) throw new Error(); await deps.assertBoardItemReadable(item); }
            catch { round.historyLimited = true; continue; }
          }
          const latest = all.at(-1);
          const currentAuthorizationId = latest && ours(latest) && latest.decision === 'authorize' ? latest.authorizationId : undefined;
          let quotedFeedbackLimited=false;
          const observations = await Promise.all(board.listFeedbackHistory(task.id).map(async feedback => {
            let match=authorityAtFeedback(all,feedback);
            const identity = observationKey(round.choice.choiceId,item.projectId,task.id,feedback.revisionId);
            if (match === undefined) unresolvedObservations.add(identity);
            if (match && ours(match.authority) && !await matchesOriginalCall(feedback,match.authority)) {
              unresolvedObservations.add(identity);
              quotedFeedbackLimited=true;
              match=null;
            }
            return { feedback, match };
          }));
          const feedback = observations.flatMap(({ feedback:f, match }) => match && ours(match.authority) ? [{
            revisionId:f.revisionId, observedAt:match.observedAt, authorizationId:match.authority.authorizationId,
            actionTitle:match.authority.taskSnapshot?.title ?? task.id, effect:f.effect, outcome:f.outcome, metricDelta:f.metricDelta, review:f.review,
          }] : []);
          round.actions.push({ currentAuthorizationId, projectId: item.projectId, itemId: item.id, taskId: task.id, title: task.title, status: task.status,
            ...(quotedFeedbackLimited ? {quotedFeedbackLimited:true} : {}),
            ...(observations.some(o => o.match === undefined) ? {observationTimeLimited:true} : {}),
            authorizations: authority.map(a => ({ id: a.authorizationId, scope: a.scope, decision: a.decision, time: a.createdAt })), feedback });
        }
      }
    }
    for (const round of rounds) {
      const feedback = round.review?.feedback;
      if (feedback && !round.actions.some(a => a.taskId === feedback.boardTaskId && a.feedback.some(f => f.revisionId === feedback.feedbackRevisionId && (!feedback.authorizationId || f.authorizationId === feedback.authorizationId)))) {
        const identity = observationKey(round.choice.choiceId,feedback.projectId,feedback.boardTaskId,feedback.feedbackRevisionId);
        if (unresolvedObservations.has(identity)) round.reviewObservationLimited=true;
        else round.historyLimited=true;
        round.review = null;
      }
    }
    return { issue: selected, rounds };
  }
  function replyKey(source:CaseIssueReply) {return JSON.stringify([source.projectId,source.taskId,source.sessionId,source.messageId,source.expectedTextSha256]);}
  function authorizedAction(timeline: Awaited<ReturnType<typeof issueTimeline>>, choiceId: string, authorizationId: string, projectId: string) {
    const round = timeline.rounds.at(-1);
    if (!round || round.choice.choiceId !== choiceId || !caseChoicePermitsAction(round.choice.choice)) return fail('case_do_round_changed');
    const action = round.actions.find(a => a.currentAuthorizationId === authorizationId && a.projectId === projectId);
    if (!action) return fail('case_do_authorization_unavailable');
    return { ...action, authorizations: action.authorizations.filter(a => a.id === authorizationId), feedback: [] };
  }
  async function checkDoAuthorization(caseId:string,issueId:string,choiceId:string,authorizationId:string,projectId:string) {
    const timeline = await issueTimeline(caseId,issueId);
    const action = authorizedAction(timeline,choiceId,authorizationId,projectId);
    return action;
  }
  function roundSourceKeys(round:Awaited<ReturnType<typeof issueTimeline>>['rounds'][number], issueId:string) {
    const rights = [round.strategy.recordId+'/'+round.strategy.revision];
    for(const ref of round.strategy.references) if(round.strategy.issueId===issueId && ref.relation==='derived_from' && ref.target.type==='source' && ref.target.source.type==='native-reply') rights.push(replyKey(ref.target.source));
    for(const a of round.actions) {
      rights.push(a.projectId+'/'+a.itemId+'/'+a.taskId);
      for (const f of a.feedback) rights.push(f.revisionId, f.authorizationId);
    }
    return rights;
  }
  async function currentTeachRights(caseId:string,issueId:string,choiceId:string,feedbackRevisionId?:string) {
    const view=await issueTimeline(caseId,issueId), round=view.rounds.find(r=>r.choice.choiceId===choiceId);
    if (!round) return fail('case_issue_scope_mismatch');
    if (feedbackRevisionId && !round.actions.some(a=>a.feedback.some(f=>f.revisionId===feedbackRevisionId))) return fail('case_round_feedback_unavailable');
    // Old native inputs included all then-readable actions. Qualify those actual
    // sources for original history, even when a new handoff is scoped more narrowly.
    return roundSourceKeys(round,issueId);
  }
  async function verifyPriorProjectRoundRights(caseId:string, issueId:string, prior:ReadonlySet<string>, qualify:QualifyReply) {
    const missing = new Set(prior);
    const timeline = await issueTimeline(caseId,issueId);
    for (const round of timeline.rounds) {
      if (!roundSourceKeys(round,issueId).some(key=>missing.has(key))) continue;
      // Recheck the original Plan against the actual recipient. Only the current
      // turn's context is sent to Pi; the historical bodies stay in their owner.
      const evidence = await issueModelContext(caseId,issueId,qualify,{choiceId:round.choice.choiceId});
      for (const key of evidence.sourceRights) missing.delete(key);
      if (!missing.size) return;
    }
    if (missing.size) fail('role_history_source_no_longer_readable',403);
  }
  async function issueModelContext(caseId: string, issueId: string, qualify: QualifyReply, selection: IssueRoundSelection = {}) {
    const {choiceId, execution, reviewId} = selection;
    let {feedbackRevisionId} = selection;
    const timeline = await issueTimeline(caseId,issueId);
    const action = execution && choiceId ? authorizedAction(timeline, choiceId, execution.authorizationId, execution.projectId) : undefined;
    const rounds = choiceId ? timeline.rounds.filter(r => r.choice.choiceId === choiceId) : timeline.rounds;
    if (reviewId) {
      const review=rounds[0]?.review;
      if (!choiceId || !review || review.operationId!==reviewId || execution) return fail('case_round_review_unavailable');
      feedbackRevisionId=review.feedback?.feedbackRevisionId;
    }
    if (choiceId && !rounds.length) return fail('case_issue_scope_mismatch');
    if (feedbackRevisionId && !rounds.some(r=>r.actions.some(a=>a.feedback.some(f=>f.revisionId===feedbackRevisionId)))) return fail('case_round_feedback_unavailable');
    const rights = new Set<string>(), replies = new Map<string,{source:CaseIssueReply;requestId:string;text:string}>();
    async function exactReply(source:CaseIssueReply,type:'plan'|'teach',choiceId?:string,observation?:import('./task-round-receipts.ts').ObservedAction) {
      const id=replyKey(source);
      if (!replies.has(id)) {
        const read = await readReply(caseId,issueId,source,type,choiceId,qualify,observation);
        replies.set(id,{source,requestId:read.requestId,text:read.text});
        rights.add(id);
      }
      return source;
    }
    const revisions = new Map<string,CaseDecisionRevision>();
    function addProposal(p:CaseDecisionRevision) { revisions.set(p.recordId+'/'+p.revision,p); }
    for (const round of rounds) addProposal(round.strategy);
    // A handed Plan is available for discussion before the user makes the first choice.
    if (!choiceId) {
      let continuation: string | null = null;
      do {
        const page = cases.listDecisions(caseId,{pageSize:50,continuation});
        for (const p of page.items) if (p.issueId === issueId && p.kind === 'strategy') addProposal(p);
        continuation = page.continuation;
      } while (continuation);
    }
    const proposals = [];
    for (const [key,strategy] of revisions) {
      if (strategy.issueId && strategy.issueId !== issueId) return fail('case_issue_scope_mismatch');
      if (strategy.origin.projectId) await linkedProject(caseId,strategy.origin.projectId);
      const planReplies:CaseIssueReply[]=[];
      for (const ref of strategy.references) {
        if (ref.relation === 'derived_from' && ref.target.type === 'source' && ref.target.source.type === 'native-reply' && strategy.issueId === issueId)
          planReplies.push(await exactReply(ref.target.source,'plan'));
      }
      rights.add(key);
      proposals.push({recordId:strategy.recordId,revision:strategy.revision,caseStoreId:strategy.caseStoreId,payload:strategy.payload,planReplies});
    }
    const history=[];
    for(const {choice,actions:allActions,review} of rounds) {
      const actions = action ? [action] : feedbackRevisionId ? allActions.flatMap(a => {
        const f = a.feedback.find(value => value.revisionId === feedbackRevisionId);
        if (!f) return [];
        const original = a.authorizations.find(value => value.id === f.authorizationId);
        if (!original) return fail('case_round_feedback_unavailable');
        return [{projectId:a.projectId,itemId:a.itemId,taskId:a.taskId,title:f.actionTitle,authorizations:[original],feedback:[f]}];
      }) : reviewId ? [] : allActions;
      if (execution) rights.add(execution.authorizationId);
      for(const action of actions) {
        rights.add(action.projectId+'/'+action.itemId+'/'+action.taskId);
        for(const f of action.feedback) { rights.add(f.revisionId); rights.add(f.authorizationId); }
      }
      const observed = feedbackRevisionId && actions.find(a=>a.feedback.some(f=>f.revisionId===feedbackRevisionId));
      const selected = observed && observed.feedback.find(f=>f.revisionId===feedbackRevisionId);
      const observation = observed && selected ? {projectId:observed.projectId,taskId:observed.taskId,authorizationId:selected.authorizationId,feedbackRevisionId:selected.revisionId} : undefined;
      const recorded = (!choiceId || reviewId) && review ? {...review,reply:await exactReply(review.reply,'teach',choice.choiceId,observation)} : null;
      history.push({choice:{id:choice.choiceId,decision:choice.choice,reason:choice.reason,previous:choice.previousChoiceId,
          date:choice.occurredAt,goalBinding:choice.goalBinding,proposed:choice.strategyRef},actions,review:recorded});
    }
    return {issue:timeline.issue,proposals,replies:[...replies.values()],rounds:history,sourceRights:[...rights]};
  }
  async function checkSavedReviewFeedback(caseId: string, feedback: NonNullable<CaseIssueReview['feedback']>) {
    await linkedProject(caseId, feedback.projectId);
    const board = deps.board;
    const observation = board?.getFeedbackRevision(feedback.feedbackRevisionId);
    if (!board || !observation || observation.taskId !== feedback.boardTaskId) return fail('case_round_feedback_unavailable');
    const item = board.getItem(board.getTask(observation.taskId).itemId);
    if (item.projectId !== feedback.projectId) return fail('case_round_feedback_unavailable');
    if (item.sourceKind === 'report-confirmation') {
      if (!deps.assertBoardItemReadable) return fail('confirmation_source_unavailable');
      await deps.assertBoardItemReadable(item);
    }
  }
  async function issueWrite(caseId: string, issueId: string, action: string, input: Record<string, unknown>) {
    const operationId = caseDecisionId(input.operationId);
    return deps.mutate(async () => {
      if (action !== 'authorize') issue(caseId, issueId, action !== 'review');
      if (action === 'plans') {
        caseDecisionFields(input, ['operationId', 'source'], ['source']);
        const source = replyReference(input.source), actual = await readReply(caseId, issueId, source, 'plan');
        return { revision: cases.acceptIssuePlan({ caseId, issueId, source, operationId, title: actual.title, proposal: '见本方案的准确 Plan Task 原回复。' }) };
      }
      const choice = cases.getStrategyChoice(caseId, caseDecisionId(input.choiceId));
      if (choice.issueId !== issueId) return fail('case_issue_scope_mismatch');
      if (action === 'authorize') {
        caseDecisionFields(input, ['operationId', 'choiceId', 'projectId', 'title', 'scope'], ['projectId', 'title', 'scope']);
        const projectId = caseDecisionId(input.projectId), title = caseDecisionText(input.title, 200, true), scope = caseDecisionText(input.scope, 4000, true);
        if (!deps.board?.arrangeActions) return fail('case_choice_not_actionable');
        if (!deps.board.getArrangementOperation?.(operationId)) {
          issue(caseId, issueId, true);
          await linkedProject(caseId, projectId);
          assertActionableCaseChoice(cases, choice);
          await checkPlan(choice.strategyRef);
        }
        return { arrangement: deps.board.arrangeActions({ operationId, projectId, title, scope, source: { caseId, caseStoreId: choice.strategyRef.caseStoreId, choiceId: choice.choiceId, strategyRef: choice.strategyRef },
          actions: [{ kind: 'create', title }], checks: [] }, { confirmedIssueId: issueId, ...(choice.goalBinding?.strategy ? {goal:{...choice.goalBinding.primary,strategy:choice.goalBinding.strategy}} : {}), assertWritable: () => { issue(caseId, issueId, true); } }) };
      }
      caseDecisionFields(input, ['operationId', 'expectedRevision', 'choiceId', 'source', 'observation', 'judgement', 'nextStep', 'feedbackRevisionId'], ['source', 'observation', 'judgement', 'nextStep']);
      const source = replyReference(input.source);
      const command = { caseId, issueId, choiceId: choice.choiceId, operationId, expectedRevision: caseDecisionRevision(input.expectedRevision), reply: source,
        observation: caseDecisionText(input.observation, 4000, true), judgement: caseDecisionText(input.judgement, 4000, true), nextStep: caseDecisionText(input.nextStep, 4000, true) };
      const prior = cases.getOperation(operationId);
      if (prior) {
        const saved = cases.getEvents('case', caseId).find(e => e.operationId === operationId)?.changes.issueReview?.after as CaseIssueReview | undefined;
        if (prior.kind !== 'case_update' || prior.phase !== 'completed' || prior.caseId !== caseId || !saved || saved.operationId !== operationId ||
            saved.issueId !== issueId || saved.choiceId !== choice.choiceId || prior.projectId !== saved.reply.projectId ||
            saved.feedback?.feedbackRevisionId !== input.feedbackRevisionId) return fail('operation_conflict');
        const feedback = saved.feedback && { projectId: saved.feedback.projectId, boardTaskId: saved.feedback.boardTaskId, feedbackRevisionId: saved.feedback.feedbackRevisionId };
        // The existing store verifies the original command digest, including the displayed revision.
        // This human readback never supplies an observation to a new review or model.
        const review = cases.saveIssueReview({ ...command, ...(feedback ? {feedback} : {}) });
        await readReply(caseId, issueId, saved.reply, 'teach', choice.choiceId);
        if (feedback) await checkSavedReviewFeedback(caseId, feedback);
        return { review };
      }
      issue(caseId,issueId,true);
      const round = (await issueTimeline(caseId, issueId)).rounds.find(r => r.choice.choiceId === choice.choiceId)!;
      const selected = round.actions.find(a => a.feedback.some(f => f.revisionId === input.feedbackRevisionId));
      if (!selected && (caseChoicePermitsAction(choice.choice) || input.feedbackRevisionId !== undefined)) return fail('case_round_waiting_for_feedback');
      const original = selected?.feedback.find(f=>f.revisionId===input.feedbackRevisionId);
      const observation = selected && original ? {projectId:selected.projectId,taskId:selected.taskId,authorizationId:original.authorizationId,feedbackRevisionId:original.revisionId} : undefined;
      const teach = await readReply(caseId, issueId, source, 'teach', choice.choiceId, undefined, observation);
      if (teach.feedbackRevisionId && teach.feedbackRevisionId !== input.feedbackRevisionId) return fail('case_round_feedback_unavailable');
      const feedback = selected ? { projectId: selected.projectId, boardTaskId: selected.taskId, feedbackRevisionId: caseDecisionId(input.feedbackRevisionId) } : undefined;
      return { review: cases.saveIssueReview({ ...command, ...(feedback ? { feedback } : {}) }, original?.authorizationId) };
    });
  }
  return {verifyPriorProjectRoundRights, checkDoAuthorization, checkPlan, currentTeachRights, issueModelContext, issueTimeline, issueSources, inspectIssueReply, issueWrite, issueList: (caseId: string) => cases.listDecisionIssues(caseId),
    issueEdges: (caseId: string, includeRemoved = false) => cases.listIssueEdges(caseId, { includeRemoved }),
    saveIssueEdge: (caseId: string, input: Record<string, unknown>, options?: import('./case-decision-types.ts').CaseDecisionWriteOptions) => {
      caseDecisionFields(input, ['operationId', 'expectedRevision', 'edgeId', 'fromIssueId', 'toIssueId', 'action', 'explanation', 'expectedEdgeRevision', 'source']);
      if (input.action !== undefined && input.action !== 'save' && input.action !== 'remove') return fail('invalid_case_issue_edge', 400);
      const src = input.source as { kind?: unknown; ref?: unknown } | undefined;
      if (!src || (src.kind !== 'user-declaration' && src.kind !== 'adopted-candidate')) return fail('invalid_case_issue_edge_source', 400);
      return deps.mutate(() => {
        const opId = caseDecisionId(input.operationId);
        if (cases.getOperation(opId)?.phase !== 'completed') options?.assertWritable?.();
        return cases.saveIssueEdge({ caseId, operationId: opId, expectedRevision: caseDecisionRevision(input.expectedRevision),
          ...(input.edgeId !== undefined ? { edgeId: caseDecisionId(input.edgeId) } : {}), ...(input.fromIssueId !== undefined ? { fromIssueId: caseDecisionId(input.fromIssueId) } : {}),
          ...(input.toIssueId !== undefined ? { toIssueId: caseDecisionId(input.toIssueId) } : {}), ...(input.action ? { action: input.action as 'save' | 'remove' } : {}),
          ...(input.explanation !== undefined ? { explanation: caseDecisionText(input.explanation, 1000, true) } : {}),
          expectedEdgeRevision: Number.isSafeInteger(input.expectedEdgeRevision) && Number(input.expectedEdgeRevision) >= 0 ? Number(input.expectedEdgeRevision) : fail('invalid_revision', 400),
          source: { kind: src.kind as 'user-declaration' | 'adopted-candidate', ref: typeof src.ref === 'string' ? src.ref : null } }, options);
      });
    },
    decisionRequests: (caseId: string) => {
      const choices = cases.getStrategyChoices(caseId);
      return cases.listDecisionRequests(caseId).map(request => {
        if (request.target.kind === 'choose') return { ...request, status: requestStatus(request, choices, undefined) };
        if (!deps.board) return { ...request, status: requestStatus(request, undefined, undefined) };
        try {
          const target = request.target;
          if (!cases.listProjectLinks(caseId).some(l => l.projectId === target.projectId)) return { ...request, status: 'unverifiable' as const };
          const task = deps.board.getTask(target.taskId);
          const item = deps.board.getItem(task.itemId);
          if (item.id !== target.itemId || item.projectId !== target.projectId) return { ...request, status: 'unverifiable' as const };
          const allAuths = deps.board.listActionAuthorizations?.(task.id) ?? [];
          if (!allAuths.some(a => a.authorizationId === target.authorizationId && !('kind' in a.source) && a.source.caseId === caseId)) return { ...request, status: 'unverifiable' as const };
          const history = deps.board.listFeedbackHistory(target.taskId);
          const responses = history.flatMap((rev, idx) => {
            if (!rev.respondsToRequest) return [];
            const activeAuth = authorityAtFeedback(allAuths, rev);
            if (!activeAuth || activeAuth.authority.authorizationId !== rev.respondsToRequest.authorizationId) return [];
            return [{
              requestId: rev.respondsToRequest.requestId, requestRevision: rev.respondsToRequest.revision,
              projectId: item.projectId, itemId: item.id, taskId: task.id, authorizationId: activeAuth.authority.authorizationId,
              revisionId: rev.revisionId, baseRevisionId: idx === 0 ? null : history[idx - 1]!.revisionId,
            }];
          });
          return { ...request, status: requestStatus(request, undefined, responses) };
        } catch {
          return { ...request, status: 'unverifiable' as const };
        }
      });
    },
    saveDecisionRequest: (caseId: string, input: Record<string, unknown>, options?: import('./case-decision-types.ts').CaseDecisionWriteOptions) => {
      caseDecisionFields(input, ['operationId', 'expectedRevision', 'requestId', 'action', 'issueId', 'kind', 'text', 'source', 'assignee', 'requestedAt', 'dueDate', 'target', 'expectedRequestRevision']);
      if (input.action !== undefined && input.action !== 'save' && input.action !== 'withdraw' && input.action !== 'supersede') return fail('invalid_case_decision_request', 400);
      if (input.kind !== undefined && input.kind !== 'choose' && input.kind !== 'observe') return fail('invalid_case_decision_request', 400);
      const src = input.source as { kind?: unknown; ref?: unknown } | undefined;
      if (!src || (src.kind !== 'user-declaration' && src.kind !== 'agent-tool') || typeof src.ref !== 'string' || !src.ref.trim()) return fail('invalid_case_decision_request_source', 400);
      const assignee = input.assignee as { label?: unknown; source?: unknown } | undefined;
      return deps.mutate(() => {
        const opId = caseDecisionId(input.operationId);
        if (cases.getOperation(opId)?.phase !== 'completed') {
          options?.assertWritable?.();
          const tgt = input.target as Record<string, unknown> | undefined;
          if ((!input.action || input.action === 'save') && tgt?.kind === 'observe') {
            if (!deps.board) return fail('case_decision_board_unavailable', 503);
            const projId = caseDecisionId(tgt.projectId), itemId = caseDecisionId(tgt.itemId), taskId = caseDecisionId(tgt.taskId), authId = caseDecisionId(tgt.authorizationId);
            if (!cases.listProjectLinks(caseId).some(l => l.projectId === projId)) return fail('project_not_linked', 409);
            const task = deps.board.getTask(taskId), item = deps.board.getItem(task.itemId);
            if (item.id !== itemId || item.projectId !== projId) return fail('case_decision_scope_mismatch', 409);
            const allAuths = deps.board.listActionAuthorizations?.(taskId) ?? [];
            if (!allAuths.some(a => a.authorizationId === authId && !('kind' in a.source) && a.source.caseId === caseId)) return fail('case_do_authorization_unavailable', 409);
          }
        }
        return cases.saveDecisionRequest({ caseId, operationId: opId, expectedRevision: caseDecisionRevision(input.expectedRevision),
          ...(input.requestId !== undefined ? { requestId: caseDecisionId(input.requestId) } : {}), ...(input.action ? { action: input.action as 'save' | 'withdraw' | 'supersede' } : {}),
          ...(input.issueId !== undefined ? { issueId: caseDecisionId(input.issueId) } : {}), ...(input.kind ? { kind: input.kind as 'choose' | 'observe' } : {}),
          ...(input.text !== undefined ? { text: caseDecisionText(input.text, 4000, true) } : {}), ...(input.requestedAt !== undefined ? { requestedAt: String(input.requestedAt) } : {}),
          ...(input.dueDate !== undefined ? { dueDate: input.dueDate as string | null } : {}), ...(input.target !== undefined ? { target: input.target as never } : {}),
          assignee: { label: typeof assignee?.label === 'string' ? assignee.label : null, source: typeof assignee?.source === 'string' ? assignee.source : null },
          expectedRequestRevision: Number.isSafeInteger(input.expectedRequestRevision) && Number(input.expectedRequestRevision) >= 0 ? Number(input.expectedRequestRevision) : fail('invalid_revision', 400),
          source: { kind: src.kind as 'user-declaration' | 'agent-tool', ref: String(src.ref).trim() } }, options);
      });
    },
    createIssue: (caseId: string, input: Record<string, unknown>) => deps.mutate(() => cases.createDecisionIssue({ caseId, operationId: caseDecisionId(input.operationId), expectedRevision: caseDecisionRevision(input.expectedRevision), title: caseDecisionText(input.title, 240, true) })) };
}
