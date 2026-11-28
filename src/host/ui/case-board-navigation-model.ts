import type { CaseDecisionIssue, CaseStrategyChoiceValue } from '../case-decision-types.ts';
import type { caseIssueTimeline } from './case-decisions-client.ts';
import type { ClientTask } from './project-types.ts';

export type CaseAuxScope = { mode: 'issue' | 'all'; issueId: string; manual: boolean };
export type CaseBoardViewState = { tab: 'overview' | 'projects' | 'artifacts' | 'history'; activeIssueId: string; auxScope: CaseAuxScope };
export const initialCaseBoardView = (): CaseBoardViewState => ({ tab: 'overview', activeIssueId: '', auxScope: { mode: 'all', issueId: '', manual: false } });

export function selectCaseBoardIssue(view: CaseBoardViewState, issueId: string, intent: 'explicit' | 'restore' = 'explicit'): CaseBoardViewState {
  if (view.activeIssueId === issueId && intent === 'restore') return view;
  return { ...view, activeIssueId: issueId, auxScope: { mode: issueId ? 'issue' : 'all', issueId, manual: false } };
}

export function reconcileCaseBoardIssues(view: CaseBoardViewState, issues: readonly CaseDecisionIssue[]): CaseBoardViewState {
  if (!issues.length) return { ...view, activeIssueId: '', auxScope: { mode: 'all', issueId: '', manual: false } };
  const active = issues.some(issue => issue.id === view.activeIssueId);
  if (!active) return selectCaseBoardIssue(view, issues[0]!.id, 'restore');
  if (view.auxScope.mode === 'issue' && !issues.some(issue => issue.id === view.auxScope.issueId)) return { ...view, auxScope: { mode: 'issue', issueId: view.activeIssueId, manual: false } };
  return view;
}

/** Sharing a project does not bind its other tasks to a Case. Legacy tasks stay in the original project. */
export function caseTasksInScope(tasks: readonly ClientTask[], caseId: string, scope: CaseAuxScope): ClientTask[] {
  if (!caseId || scope.mode === 'issue' && !scope.issueId) return [];
  return tasks.filter(task => {
    const binding = task.assignment?.issue;
    return binding?.caseId === caseId && Boolean(binding.issueId) && (scope.mode === 'all' || binding.issueId === scope.issueId);
  });
}

const choiceName: Record<CaseStrategyChoiceValue, string> = { trial: '试行', adjust: '调整', continue: '继续', defer: '暂缓', no_action: '本次不行动', gather_evidence: '补证', reject: '不采用', stop_considering: '停止考虑' };
export type CaseIssueTimeline = Awaited<ReturnType<typeof caseIssueTimeline>>;
export type CaseRoundSummary = { title: string; known: string; advancing: string; next: string; sources: string[]; limited: boolean };
/** A read-only projection of the selected issue's original choice chain. Never consumes whole-Case notes. */
export function projectCaseRoundSummary(timeline: CaseIssueTimeline): CaseRoundSummary {
  const round = timeline.rounds.at(-1);
  if (!round) return { title: `${timeline.issue.title} · 尚无取舍轮次`, known: '尚未记录本事项的取舍或复盘判断。', advancing: '尚未记录本轮行动授权。', next: '本事项下一步尚未记录。', sources: [`事项 ${timeline.issue.id}`], limited: false };
  const choice = round.choice;
  const sources = [`事项 ${timeline.issue.id}`, `选择链第 ${timeline.rounds.length} 轮 · ${choice.choiceId}`, `方案 ${choice.strategyRef.recordId}@v${choice.strategyRef.revision}`, `取舍记录于 ${choice.occurredAt}`];
  if (round.review) sources.push(`复盘 ${round.review.operationId} · 原回复 ${round.review.reply.messageId}`);
  const actions = round.actions.map(action => {
    const authorization = action.authorizations.find(item => item.id === action.currentAuthorizationId);
    sources.push(`原项目 ${action.projectId} / 行动 ${action.taskId}${authorization ? ` / 授权 ${authorization.id}` : ''}`);
    action.feedback.forEach(feedback => sources.push(`观察 ${feedback.revisionId} / 授权 ${feedback.authorizationId}`));
    return `${action.title} · ${action.status === 'done' ? '已完成（效果仍按原观察核对）' : action.status === 'doing' ? '进行中' : '待办'}${authorization ? ` · 当前授权范围：${authorization.scope}` : ' · 当前无有效授权'}${action.feedback.length ? ` · 已记录 ${action.feedback.length} 条原始观察` : ' · 尚无准确原始观察'}`;
  });
  const limited = Boolean(round.historyLimited || round.reviewObservationLimited || round.actions.some(action => action.observationTimeLimited || action.quotedFeedbackLimited));
  return { title: `${timeline.issue.title} · 选择链第 ${timeline.rounds.length} 轮`,
    known: round.review ? `复盘判断：${round.review.judgement}` : `已记录取舍：${choiceName[choice.choice]}${choice.reason ? ` · ${choice.reason}` : ' · 原理由未记录'}；本轮复盘判断尚未记录或暂不可读取。`,
    advancing: actions.length ? actions.join('\n') : limited ? '原行动或观察部分不可读取，当前进展待核。' : '尚未记录本轮有效行动授权。',
    next: round.review?.nextStep || choice.nextStep || '本轮下一步尚未记录或暂不可读取，请核对原事项记录。', sources, limited };
}
