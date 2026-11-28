import { checkTeachObservationHistory } from './project-history.ts';
import type { BoardActionAuthorization, TaskFeedbackRevision } from '../../extensions/business-plugins/decision-board/types.ts';
import { quotedFeedbackMatches } from './quoted-feedback-origins.ts';
import { caseChoicePermitsAction } from './case-decision-types.ts';
import { CaseStoreError } from './case-types.ts';
import { caseDecisionFields, caseDecisionId, caseDecisionRevision, caseDecisionText, parseCaseDecisionRef, parseCaseDecisionTarget } from './case-decision-validation.ts';
import type { CaseDecisionRef, CaseDecisionRevision, CaseIssueReply, CaseIssueReview, CaseStrategyChoice, CaseDecisionRequest, CaseFeedbackResponse } from './case-decision-types.ts';
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

/** The action's original choice, strategy and issue must all belong to this exact Case owner. */
export function observationAuthorizationMatches(cases: CaseDecisionServiceDependencies['cases'], request: Pick<CaseDecisionRequest, 'caseId' | 'issueId'>, authorization: BoardActionAuthorization) {
  const source = authorization.source;
  if ('kind' in source || authorization.decision !== 'authorize' || source.caseId !== request.caseId || source.caseStoreId !== cases.getStatus().storeId) return false;
  try {
    const choice = cases.getStrategyChoice(request.caseId, source.choiceId), ref = choice.strategyRef, supplied = source.strategyRef;
    if (choice.issueId !== request.issueId || !caseChoicePermitsAction(choice.choice) || supplied.type !== 'case-decision'
      || ref.caseStoreId !== source.caseStoreId || ref.caseId !== request.caseId || supplied.caseStoreId !== ref.caseStoreId || supplied.caseId !== ref.caseId
      || supplied.recordId !== ref.recordId || supplied.revision !== ref.revision) return false;
    const strategy = cases.getDecision(request.caseId, ref.recordId, ref.revision);
    return strategy.kind === 'strategy' && (!strategy.issueId || strategy.issueId === request.issueId);
  } catch { return false; }
}

/** One request's read/authorization failure never changes another request's projection. */
function planSources(strategy: CaseDecisionRevision): CaseIssueReply[] {
  if (!strategy.issueId) return [];
  return strategy.references.flatMap(ref => ref.relation === 'derived_from' && ref.target.type === 'source' && ref.target.source.type === 'native-reply' ? [ref.target.source] : []);
}
export async function chooseRequestStatus(cases: CaseDecisionServiceDependencies['cases'], request: CaseDecisionRequest, choices = cases.getStrategyChoices(request.caseId), checkPlan?: (reference: CaseDecisionRef) => Promise<void>) {
  if (request.lifecycle !== 'open') return requestStatus(request, choices, undefined);
  if (request.target.kind !== 'choose') return 'unverifiable' as const;
  try {
    const ref = request.target.strategyRef;
    if (ref.caseId !== request.caseId || ref.caseStoreId !== cases.getStatus().storeId) return 'unverifiable' as const;
    const strategy = cases.getDecision(request.caseId, ref.recordId, ref.revision);
    if (strategy.kind !== 'strategy' || strategy.issueId && strategy.issueId !== request.issueId) return 'unverifiable' as const;
    const status = requestStatus(request, choices, undefined);
    if (status === 'answered') return status;
    try { cases.assertStrategyChoiceTarget({ caseStoreId: ref.caseStoreId, caseId: request.caseId, issueId: request.issueId, strategyRef: ref, expectedPreviousChoiceId: request.target.expectedPreviousChoiceId, allowHistorical: true }); }
    catch (error) {
      const code = (error as { code?: string })?.code;
      if (code === 'case_closed' || code === 'case_decision_archived') return 'superseded' as const;
      if (code === 'case_choice_conflict') return status === 'unverifiable' ? status : 'superseded' as const;
      return 'unverifiable' as const;
    }
    if (checkPlan) await checkPlan(ref);
    else if (planSources(strategy).length) return 'unverifiable' as const;
    return status;
  } catch { return 'unverifiable' as const; }
}

export async function observationRequestStatus(cases: CaseDecisionServiceDependencies['cases'], board: Pick<NonNullable<CaseDecisionServiceDependencies['board']>, 'getTask' | 'getItem' | 'listFeedbackHistory' | 'listActionAuthorizations'> | undefined, request: CaseDecisionRequest, assertBoardItemReadable?: CaseDecisionServiceDependencies['assertBoardItemReadable'], assertActiveProject?: (projectId: string) => Promise<void>) {
  if (request.lifecycle !== 'open') return requestStatus(request, undefined, undefined);
  if (!board || request.target.kind !== 'observe') return 'unverifiable' as const;
  try {
    const target = request.target;
    if (!cases.listProjectLinks(request.caseId).some(l => l.projectId === target.projectId)) return 'unverifiable' as const;
    const task = board.getTask(target.taskId), item = board.getItem(task.itemId);
    if (item.id !== target.itemId || item.projectId !== target.projectId) return 'unverifiable' as const;
    if (item.sourceKind === 'report-confirmation') {
      if (!assertBoardItemReadable) return 'unverifiable' as const;
      await assertBoardItemReadable(item);
    }
    const allAuths = board.listActionAuthorizations?.(task.id) ?? [];
    const authorization = allAuths.find(a => a.authorizationId === target.authorizationId);
    if (!authorization || authorization.projectId !== target.projectId || authorization.itemId !== target.itemId || authorization.taskId !== target.taskId
      || !observationAuthorizationMatches(cases, request, authorization)) return 'unverifiable' as const;
    const history = board.listFeedbackHistory(task.id);
    if (target.feedbackBaseRevisionId !== null && !history.some(row => row.revisionId === target.feedbackBaseRevisionId)) return 'unverifiable' as const;
    const responses: CaseFeedbackResponse[] = history.flatMap((rev, idx) => {
      if (!rev.respondsToRequest) return [];
      const active = authorityAtFeedback(allAuths, rev);
      if (!active || active.authority.authorizationId !== rev.respondsToRequest.authorizationId || !observationAuthorizationMatches(cases, request, active.authority)) return [];
      return [{ requestId: rev.respondsToRequest.requestId, requestRevision: rev.respondsToRequest.revision, projectId: item.projectId, itemId: item.id,
        taskId: task.id, authorizationId: active.authority.authorizationId, revisionId: rev.revisionId, baseRevisionId: idx === 0 ? null : history[idx - 1]!.revisionId }];
    });
    const status = requestStatus(request, undefined, responses);
    if (status === 'answered') return status;
    if (!assertActiveProject) return 'unverifiable' as const;
    try { await assertActiveProject(target.projectId); }
    catch (error) { return (error as { code?: string })?.code === 'project_archived' ? 'superseded' as const : 'unverifiable' as const; }
    if ((history.at(-1)?.revisionId ?? null) !== target.feedbackBaseRevisionId) return 'superseded' as const;
    const source = authorization.source;
    const currentChoice = cases.getStrategyChoices(request.caseId).filter(c => c.issueId === request.issueId).at(-1);
    return allAuths.at(-1)?.authorizationId !== authorization.authorizationId || 'kind' in source || currentChoice?.choiceId !== source.choiceId ? 'superseded' as const : status;
  } catch { return 'unverifiable' as const; }
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
    for (const source of planSources(strategy)) {
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
        feedback: { revisionId: string; observedAt: string; authorizationId: string; actionTitle: string; effect: string; outcome: string; metricDelta: string; review: string; observationDate?: string | null; sourceScope?: string | null }[] }[] };
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
            ...(f.observationDate == null ? {} : { observationDate: f.observationDate }), ...(f.sourceScope == null ? {} : { sourceScope: f.sourceScope }),
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
    /** Bounded original identities for the narrow Case discussion tool; owner is Host-bound. */
    readDeclarations: async (caseId: string, issueId: string, input: Record<string, unknown>) => {
      caseDecisionFields(input, ['section', 'offset', 'limit', 'continuation']);
      issue(caseId, issueId);
      const section = input.section;
      if (!['issues', 'edges', 'requests', 'strategies', 'choices', 'observations'].includes(String(section))) return fail('invalid_case_declarations_section', 400);
      const offset = input.offset ?? 0, limit = input.limit ?? 10;
      if (!Number.isSafeInteger(offset) || Number(offset) < 0 || Number(offset) > 100000 || !Number.isSafeInteger(limit) || Number(limit) < 1 || Number(limit) > 20) return fail('invalid_case_declarations_page', 400);
      const base = { caseStoreId: cases.getStatus().storeId!, caseId, issueId, caseRevision: cases.getCase(caseId).revision, section };
      if (section === 'strategies') {
        if (offset !== 0 || input.continuation !== undefined && typeof input.continuation !== 'string') return fail('invalid_case_declarations_page', 400);
        const page = cases.listDecisions(caseId, { pageSize: Number(limit), continuation: input.continuation as string | undefined });
        const items = page.items.filter(row => row.kind === 'strategy' && (!row.issueId || row.issueId === issueId)).map(row => ({
          strategyRef: { type: 'case-decision' as const, caseStoreId: row.caseStoreId, caseId, recordId: row.recordId, revision: row.revision },
          issueId: row.issueId ?? null, title: row.payload.title, lifecycle: row.lifecycle,
        }));
        return { ...base, items, continuation: page.continuation, partial: page.continuation !== null };
      }
      if (input.continuation !== undefined) return fail('invalid_case_declarations_page', 400);
      let rows: unknown[];
      if (section === 'issues') rows = cases.listDecisionIssues(caseId);
      else if (section === 'edges') rows = cases.listIssueEdges(caseId, { includeRemoved: true });
      else if (section === 'requests') rows = await Promise.all(cases.listDecisionRequests(caseId).filter(row => row.issueId === issueId)
        .map(async row => ({ ...row, status: row.kind === 'observe' ? await observationRequestStatus(cases, deps.board, row, deps.assertBoardItemReadable, async projectId => { await linkedProject(caseId, projectId); }) : await chooseRequestStatus(cases, row, undefined, checkPlan) })));
      else if (section === 'choices') rows = cases.getStrategyChoices(caseId).filter(row => row.issueId === issueId).map(row => ({ choiceId: row.choiceId, caseId, issueId, strategyRef: row.strategyRef, choice: row.choice, previousChoiceId: row.previousChoiceId, occurredAt: row.occurredAt, respondsToRequest: row.respondsToRequest }));
      else {
        if (!deps.board?.listActionAuthorizations) return fail('case_decision_board_unavailable', 503);
        const linked = new Set(cases.listProjectLinks(caseId).map(link => link.projectId));
        const currentChoice = cases.getStrategyChoices(caseId).filter(row => row.issueId === issueId).at(-1);
        rows = (await Promise.all(deps.board.listTasks().map(async task => {
          const item = deps.board!.getItem(task.itemId), authorization = deps.board!.listActionAuthorizations!(task.id).at(-1);
          if (!linked.has(item.projectId) || !authorization || !observationAuthorizationMatches(cases, { caseId, issueId }, authorization)
            || 'kind' in authorization.source || authorization.source.choiceId !== currentChoice?.choiceId) return [];
          try { await linkedProject(caseId, item.projectId); } catch { return []; }
          if (item.sourceKind === 'report-confirmation') {
            try { if (!deps.assertBoardItemReadable) return []; await deps.assertBoardItemReadable(item); } catch { return []; }
          }
          return [{ title: task.title, target: { kind: 'observe', projectId: item.projectId, itemId: item.id, taskId: task.id,
            authorizationId: authorization.authorizationId, feedbackBaseRevisionId: deps.board!.listFeedbackHistory(task.id).at(-1)?.revisionId ?? null },
            choiceId: authorization.source.choiceId, strategyRef: authorization.source.strategyRef }];
        }))).flat();
      }
      // Preserve whole rows and exact IDs; the next page carries any remaining body.
      const items: unknown[] = [];
      for (const row of rows.slice(Number(offset), Number(offset) + Number(limit))) {
        if (JSON.stringify([...items, row]).length > 24000) break;
        items.push(row);
      }
      const nextOffset = Number(offset) + items.length < rows.length ? Number(offset) + items.length : null;
      return { ...base, items, offset, limit, total: rows.length, nextOffset, partial: nextOffset !== null };
    },
    issueEdges: (caseId: string, includeRemoved = false) => cases.listIssueEdges(caseId, { includeRemoved }),
    saveIssueEdge: (caseId: string, input: Record<string, unknown>, options?: import('./case-decision-types.ts').CaseDecisionWriteOptions) => {
      caseDecisionFields(input, ['operationId', 'expectedRevision', 'edgeId', 'fromIssueId', 'toIssueId', 'action', 'explanation', 'expectedEdgeRevision', 'source']);
      if (input.action !== undefined && input.action !== 'save' && input.action !== 'remove') return fail('invalid_case_issue_edge', 400);
      const src = input.source as { kind?: unknown; ref?: unknown } | undefined;
      if (!src || (src.kind !== 'user-declaration' && src.kind !== 'adopted-candidate')) return fail('invalid_case_issue_edge_source', 400);
      return deps.mutate(() => {
        const opId = caseDecisionId(input.operationId);
        if (cases.getOperation(opId)?.phase !== 'completed') options?.assertWritable?.();
        return cases.saveIssueEdge({ caseId, operationId: opId, expectedRevision: options?.currentCaseRevision ? cases.getCase(caseId).revision : caseDecisionRevision(input.expectedRevision),
          ...(input.edgeId !== undefined ? { edgeId: caseDecisionId(input.edgeId) } : {}), ...(input.fromIssueId !== undefined ? { fromIssueId: caseDecisionId(input.fromIssueId) } : {}),
          ...(input.toIssueId !== undefined ? { toIssueId: caseDecisionId(input.toIssueId) } : {}), ...(input.action ? { action: input.action as 'save' | 'remove' } : {}),
          ...(input.explanation !== undefined ? { explanation: caseDecisionText(input.explanation, 1000, true) } : {}),
          expectedEdgeRevision: Number.isSafeInteger(input.expectedEdgeRevision) && Number(input.expectedEdgeRevision) >= 0 ? Number(input.expectedEdgeRevision) : fail('invalid_revision', 400),
          source: { kind: src.kind as 'user-declaration' | 'adopted-candidate', ref: typeof src.ref === 'string' ? src.ref : null } }, options);
      });
    },
    decisionRequests: async (caseId: string) => {
      const choices = cases.getStrategyChoices(caseId);
      return Promise.all(cases.listDecisionRequests(caseId).map(async request => {
        if (request.target.kind === 'choose') return { ...request, status: await chooseRequestStatus(cases, request, choices, checkPlan) };
        return { ...request, status: await observationRequestStatus(cases, deps.board, request, deps.assertBoardItemReadable, async projectId => { await linkedProject(caseId, projectId); }) };
      }));
    },
    saveDecisionRequest: (caseId: string, input: Record<string, unknown>, options?: import('./case-decision-types.ts').CaseDecisionWriteOptions) => {
      caseDecisionFields(input, ['operationId', 'expectedRevision', 'requestId', 'action', 'issueId', 'kind', 'text', 'source', 'assignee', 'requestedAt', 'dueDate', 'target', 'expectedRequestRevision']);
      if (input.action !== undefined && input.action !== 'save' && input.action !== 'withdraw' && input.action !== 'supersede') return fail('invalid_case_decision_request', 400);
      if (input.kind !== undefined && input.kind !== 'choose' && input.kind !== 'observe') return fail('invalid_case_decision_request', 400);
      const src = input.source as { kind?: unknown; ref?: unknown } | undefined;
      if (!src || (src.kind !== 'user-declaration' && src.kind !== 'agent-tool') || typeof src.ref !== 'string' || !src.ref.trim()) return fail('invalid_case_decision_request_source', 400);
      const assignee = input.assignee as { label?: unknown; source?: unknown } | undefined;
      if (input.assignee !== undefined && (!assignee || typeof assignee !== 'object' || Array.isArray(assignee)
        || Object.keys(assignee).some(k => k !== 'label' && k !== 'source')
        || [assignee.label, assignee.source].some(value => value !== undefined && value !== null && typeof value !== 'string'))) return fail('invalid_case_decision_request', 400);
      return deps.mutate(async () => {
        const opId = caseDecisionId(input.operationId);
        if (cases.getOperation(opId)?.phase !== 'completed') {
          options?.assertWritable?.();
          const previous = input.requestId === undefined ? undefined : cases.listDecisionRequests(caseId).find(r => r.requestId === caseDecisionId(input.requestId));
          const tgt = (input.target ?? previous?.target) as Record<string, unknown> | undefined;
          if ((!input.action || input.action === 'save') && tgt?.kind === 'choose') {
            const strategyRef = parseCaseDecisionRef(tgt.strategyRef);
            cases.assertStrategyChoiceTarget({ caseStoreId: cases.getStatus().storeId!, caseId, issueId: previous?.issueId ?? caseDecisionId(input.issueId), strategyRef,
              expectedPreviousChoiceId: tgt.expectedPreviousChoiceId === null ? null : caseDecisionId(tgt.expectedPreviousChoiceId), allowHistorical: true });
            await checkPlan(strategyRef);
          }
          if ((!input.action || input.action === 'save') && tgt?.kind === 'observe') {
            if (!deps.board) return fail('case_decision_board_unavailable', 503);
            const projId = caseDecisionId(tgt.projectId), itemId = caseDecisionId(tgt.itemId), taskId = caseDecisionId(tgt.taskId), authId = caseDecisionId(tgt.authorizationId);
            await linkedProject(caseId, projId);
            const task = deps.board.getTask(taskId), item = deps.board.getItem(task.itemId);
            if (item.id !== itemId || item.projectId !== projId) return fail('case_decision_scope_mismatch', 409);
            if (item.sourceKind === 'report-confirmation') {
              if (!deps.assertBoardItemReadable) return fail('confirmation_source_unavailable', 409);
              await deps.assertBoardItemReadable(item);
            }
            const allAuths = deps.board.listActionAuthorizations?.(taskId) ?? [];
            const authorization = allAuths.find(a => a.authorizationId === authId);
            const issueId = previous?.issueId ?? caseDecisionId(input.issueId);
            if (!authorization || authorization.projectId !== projId || authorization.itemId !== itemId || authorization.taskId !== taskId
              || !observationAuthorizationMatches(cases, { caseId, issueId }, authorization) || allAuths.at(-1)?.authorizationId !== authId) return fail('case_do_authorization_unavailable', 409);
            const source = authorization.source;
            if ('kind' in source || cases.getStrategyChoices(caseId).filter(c => c.issueId === issueId).at(-1)?.choiceId !== source.choiceId) return fail('case_choice_conflict', 409);
            const baseline = tgt.feedbackBaseRevisionId === null ? null : caseDecisionId(tgt.feedbackBaseRevisionId);
            if ((deps.board.listFeedbackHistory(taskId).at(-1)?.revisionId ?? null) !== baseline) return fail('case_feedback_conflict', 409);
          }
        }
        return cases.saveDecisionRequest({ caseId, operationId: opId, expectedRevision: options?.currentCaseRevision ? cases.getCase(caseId).revision : caseDecisionRevision(input.expectedRevision),
          ...(input.requestId !== undefined ? { requestId: caseDecisionId(input.requestId) } : {}), ...(input.action ? { action: input.action as 'save' | 'withdraw' | 'supersede' } : {}),
          ...(input.issueId !== undefined ? { issueId: caseDecisionId(input.issueId) } : {}), ...(input.kind ? { kind: input.kind as 'choose' | 'observe' } : {}),
          ...(input.text !== undefined ? { text: caseDecisionText(input.text, 4000, true) } : {}), ...(input.requestedAt !== undefined ? { requestedAt: String(input.requestedAt) } : {}),
          ...(input.dueDate !== undefined ? { dueDate: input.dueDate as string | null } : {}), ...(input.target !== undefined ? { target: input.target as never } : {}),
          ...(assignee !== undefined ? { assignee: { ...(assignee.label !== undefined ? { label: assignee.label as string | null } : {}), ...(assignee.source !== undefined ? { source: assignee.source as string | null } : {}) } } : {}),
          expectedRequestRevision: Number.isSafeInteger(input.expectedRequestRevision) && Number(input.expectedRequestRevision) >= 0 ? Number(input.expectedRequestRevision) : fail('invalid_revision', 400),
          source: { kind: src.kind as 'user-declaration' | 'agent-tool', ref: String(src.ref).trim() } }, options);
      });
    },
    createIssue: (caseId: string, input: Record<string, unknown>) => deps.mutate(() => cases.createDecisionIssue({ caseId, operationId: caseDecisionId(input.operationId), expectedRevision: caseDecisionRevision(input.expectedRevision), title: caseDecisionText(input.title, 240, true) })) };
}
