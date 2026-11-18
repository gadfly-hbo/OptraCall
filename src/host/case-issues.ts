import { caseChoicePermitsAction } from './case-decision-types.ts';
import { CaseStoreError } from './case-types.ts';
import { caseDecisionFields, caseDecisionId, caseDecisionRevision, caseDecisionText, parseCaseDecisionTarget } from './case-decision-validation.ts';
import type { CaseDecisionRef, CaseDecisionRevision, CaseIssueReply, CaseIssueReview, CaseStrategyChoice } from './case-decision-types.ts';
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
  async function readReply(caseId: string, issueId: string, source: CaseIssueReply, type: 'plan' | 'teach', choiceId?: string, qualify?: QualifyReply) {
    const project = await linkedProject(caseId, source.projectId);
    const task = project.tasks.find(t => t.id === source.taskId && !t.archivedAt);
    const owner = task?.assignment?.issue;
    if (!task || task.assignment?.type !== type || owner?.caseId !== caseId || owner.issueId !== issueId || owner.choiceId !== choiceId) return fail('case_issue_source_scope_mismatch');
    const bindings = await availableReplies(project, task);
    const exact = bindings.replies.find(r => r.sessionId === source.sessionId && r.messageId === source.messageId && r.sha256 === source.expectedTextSha256);
    if (!exact) return fail('case_issue_reply_unavailable');
    await qualify?.(source,exact.requestId);
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
    const rounds = choices.map(choice => ({ choice, historyLimited:false, strategy: cases.getDecision(caseId, choice.strategyRef.recordId, choice.strategyRef.revision),
      review: events.map(e => e.changes.issueReview?.after as CaseIssueReview | undefined).find(r => r?.choiceId === choice.choiceId) ?? null,
      actions: [] as { projectId: string; itemId: string; taskId: string; title: string; status: string; currentAuthorizationId?: string; authorizations: { id: string; scope: string; decision: string; time: string }[];
        feedback: { revisionId: string; effect: string; outcome: string; metricDelta: string; review: string }[] }[] }));
    if (board && rounds.length) {
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
          const feedback = board.listFeedbackHistory(task.id).filter(f => { const a = all.filter(a => a.createdAt <= f.savedAt).at(-1); return a && ours(a); });
          round.actions.push({ currentAuthorizationId, projectId: item.projectId, itemId: item.id, taskId: task.id, title: task.title, status: task.status,
            authorizations: authority.map(a => ({ id: a.authorizationId, scope: a.scope, decision: a.decision, time: a.createdAt })),
            feedback: feedback.map(f => ({ revisionId: f.revisionId, effect: f.effect, outcome: f.outcome, metricDelta: f.metricDelta, review: f.review })) });
        }
      }
    }
    for (const round of rounds) {
      const feedback = round.review?.feedback;
      if (feedback && !round.actions.some(a => a.taskId === feedback.boardTaskId && a.feedback.some(f => f.revisionId === feedback.feedbackRevisionId))) {
        round.historyLimited = true;
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
  function roundSourceKeys(round:Awaited<ReturnType<typeof issueTimeline>>['rounds'][number], issueId:string, feedbackRevisionId?:string) {
    const rights = [round.strategy.recordId+'/'+round.strategy.revision];
    for(const ref of round.strategy.references) if(round.strategy.issueId===issueId && ref.relation==='derived_from' && ref.target.type==='source' && ref.target.source.type==='native-reply') rights.push(replyKey(ref.target.source));
    for(const a of round.actions) {
      rights.push(a.projectId+'/'+a.itemId+'/'+a.taskId);
      for(const f of a.feedback) if (!feedbackRevisionId || f.revisionId===feedbackRevisionId) rights.push(f.revisionId);
    }
    return rights;
  }
  async function currentTeachRights(caseId:string,issueId:string,choiceId:string,feedbackRevisionId?:string) {
    const view=await issueTimeline(caseId,issueId), round=view.rounds.find(r=>r.choice.choiceId===choiceId);
    if (!round) return fail('case_issue_scope_mismatch');
    return roundSourceKeys(round,issueId,feedbackRevisionId);
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
    async function exactReply(source:CaseIssueReply,type:'plan'|'teach',choiceId?:string) {
      const id=replyKey(source);
      if (!replies.has(id)) {
        const read = await readReply(caseId,issueId,source,type,choiceId,qualify);
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
      const selectedActions=reviewId ? allActions.filter(action=>review?.feedback?.boardTaskId===action.taskId&&review.feedback.projectId===action.projectId)
        .map(action=>({...action,authorizations:action.authorizations.filter(a=>a.time<=review!.createdAt)})) : allActions;
      const actions=action ? [action] : feedbackRevisionId ? selectedActions.map(a=>({...a,feedback:a.feedback.filter(f=>f.revisionId===feedbackRevisionId)})) : selectedActions;
      if (execution) rights.add(execution.authorizationId);
      for(const action of actions) {
        rights.add(action.projectId+'/'+action.itemId+'/'+action.taskId);
        for(const f of action.feedback) rights.add(f.revisionId);
      }
      const recorded = (!choiceId || reviewId) && review ? {...review,reply:await exactReply(review.reply,'teach',choice.choiceId)} : null;
      history.push({choice:{id:choice.choiceId,decision:choice.choice,reason:choice.reason,previous:choice.previousChoiceId,
          date:choice.occurredAt,goalBinding:choice.goalBinding,proposed:choice.strategyRef},actions,review:recorded});
    }
    return {issue:timeline.issue,proposals,replies:[...replies.values()],rounds:history,sourceRights:[...rights]};
  }
  async function issueWrite(caseId: string, issueId: string, action: string, input: Record<string, unknown>) {
    const operationId = caseDecisionId(input.operationId);
    return deps.mutate(async () => {
      if (action !== 'authorize') issue(caseId, issueId, true);
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
      const teach = await readReply(caseId, issueId, source, 'teach', choice.choiceId);
      if (teach.feedbackRevisionId && teach.feedbackRevisionId !== input.feedbackRevisionId) return fail('case_round_feedback_unavailable');
      const round = (await issueTimeline(caseId, issueId)).rounds.find(r => r.choice.choiceId === choice.choiceId)!;
      const selected = round.actions.find(a => a.feedback.some(f => f.revisionId === input.feedbackRevisionId));
      if (!selected && (caseChoicePermitsAction(choice.choice) || input.feedbackRevisionId !== undefined)) return fail('case_round_waiting_for_feedback');
      const feedback = selected ? { projectId: selected.projectId, boardTaskId: selected.taskId, feedbackRevisionId: caseDecisionId(input.feedbackRevisionId) } : undefined;
      return { review: cases.saveIssueReview({ caseId, issueId, choiceId: choice.choiceId, operationId, expectedRevision: caseDecisionRevision(input.expectedRevision), reply: source,
        observation: caseDecisionText(input.observation, 4000, true), judgement: caseDecisionText(input.judgement, 4000, true), nextStep: caseDecisionText(input.nextStep, 4000, true), ...(feedback ? { feedback } : {}) }) };
    });
  }
  return {verifyPriorProjectRoundRights, checkDoAuthorization, checkPlan, currentTeachRights, issueModelContext, issueTimeline, issueSources, inspectIssueReply, issueWrite, issueList: (caseId: string) => cases.listDecisionIssues(caseId),
    createIssue: (caseId: string, input: Record<string, unknown>) => deps.mutate(() => cases.createDecisionIssue({ caseId, operationId: caseDecisionId(input.operationId), expectedRevision: caseDecisionRevision(input.expectedRevision), title: caseDecisionText(input.title, 240, true) })) };
}
