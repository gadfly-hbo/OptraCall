import type { CaseIssueTimeline } from './case-board-navigation-model.ts';
import type { CaseDecisionRequestView } from './workspace-daily-client.ts';

export type CaseIssueProgress = {
  roundNumber: number | null;
  roundLabel: string;
  phase: string;
  note: string;
  tone: '' | 'wait' | 'done';
  reviewed: boolean;
  pendingChoiceRequest: CaseDecisionRequestView | undefined;
};

/** One read-only projection for overview, issue sidebar and current work. */
export function projectCaseIssueProgress(timeline: CaseIssueTimeline | undefined, requests: readonly CaseDecisionRequestView[] | undefined): CaseIssueProgress {
  const unknown: CaseIssueProgress = { roundNumber: null, roundLabel: '轮次待核', phase: '进展待核', note: '正在核对原记录', tone: '', reviewed: false, pendingChoiceRequest: undefined };
  if (!timeline) return unknown;
  if (!requests) return { ...unknown, note: '本轮请求待核' };
  const round = timeline.rounds.at(-1);
  const ownRequests = requests.filter(request => request.caseId === timeline.issue.caseId && request.issueId === timeline.issue.id && request.status === 'open' && request.lifecycle === 'open');
  const pendingChoiceRequest = ownRequests.find(request => request.target.kind === 'choose'
    && request.target.strategyRef.caseId === timeline.issue.caseId
    && (!round || request.target.strategyRef.caseStoreId === round.choice.strategyRef.caseStoreId)
    && request.target.expectedPreviousChoiceId === (round?.choice.choiceId ?? null));
  if (pendingChoiceRequest) {
    const roundNumber = timeline.rounds.length + 1;
    return { roundNumber, roundLabel: `第 ${roundNumber} 轮`, phase: '等待本轮取舍', note: '本轮尚未作新选择', tone: '', reviewed: false, pendingChoiceRequest };
  }
  if (!round) return { ...unknown, roundLabel: '尚无取舍轮次', phase: '等待本轮取舍', note: ownRequests.length ? `${ownRequests.length} 项明确请求待回应` : '本事项尚未作选择' };
  const feedback = round.actions.reduce((total, action) => total + action.feedback.length, 0);
  const authorized = round.actions.some(action => action.currentAuthorizationId);
  const limited = round.historyLimited || round.reviewObservationLimited || round.actions.some(action => action.observationTimeLimited || action.quotedFeedbackLimited);
  return {
    roundNumber: timeline.rounds.length, roundLabel: `第 ${timeline.rounds.length} 轮`,
    phase: round.review ? '已完成复盘' : authorized ? '行动已授权' : '已记录取舍',
    note: limited ? '部分原记录待核' : ownRequests.length ? `${ownRequests.length} 项明确请求待回应` : round.review ? '复盘已保存，目标结果另核' : feedback ? `已记录 ${feedback} 条观察` : authorized ? '等待行动反馈' : '按本轮取舍继续',
    tone: round.review ? 'done' : authorized && !feedback ? 'wait' : '', reviewed: Boolean(round.review), pendingChoiceRequest: undefined,
  };
}

export type CaseIssueViewMode = 'list' | 'tree';
const viewKey = (caseId: string) => `optracall.case-issue-view.v1:${caseId}`;
/** A display preference scoped to this browser tab and exact Case; never a business write. */
export function readCaseIssueViewMode(caseId: string): CaseIssueViewMode {
  try { return sessionStorage.getItem(viewKey(caseId)) === 'tree' ? 'tree' : 'list'; } catch { return 'list'; }
}
export function saveCaseIssueViewMode(caseId: string, mode: CaseIssueViewMode): void {
  try { sessionStorage.setItem(viewKey(caseId), mode); } catch { /* The current mounted view remains usable when browser storage is unavailable. */ }
}
