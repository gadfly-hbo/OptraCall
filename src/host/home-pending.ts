import type { CaseDecisionIssue, CaseDecisionRequest, CaseDecisionRequestStatus, CaseFeedbackResponse, CaseStrategyChoice } from './case-decision-types.ts';
import { requestStatus } from './case-decision-types.ts';
import type { CaseRecord, OperationReceipt } from './case-types.ts';

export type HomePendingItem = {
  requestId: string;
  revision: number;
  caseId: string;
  caseTitle: string;
  issueId: string;
  issueTitle: string;
  kind: 'choose' | 'observe';
  actionLabel: '作取舍' | '补原始观察';
  text: string;
  source: CaseDecisionRequest['source'];
  assignee: { label: string | null; source: string | null };
  requestedAt: string;
  dueDate?: string;
  target: CaseDecisionRequest['target'];
  status: CaseDecisionRequestStatus;
};

export type HomeContinueItem = {
  caseId: string;
  caseTitle: string;
  status: CaseRecord['status'];
  updatedAt: string;
  issueId: string | null;
  issueTitle: string | null;
  nextStep: string;
};

export type HomeExternalWaitingItem = {
  caseId: string;
  caseTitle: string;
  issueId: string | null;
  issueTitle: string | null;
  reason: string;
  updatedAt: string;
};

export type HomeOperationToVerify = {
  group: 'operation-to-verify';
  operationId: string;
  kind: OperationReceipt['kind'];
  phase: OperationReceipt['phase'];
  caseId: string | null;
  projectId: string | null;
  updatedAt: string;
};

export type HomeFoundationReminder = {
  key: 'strategy' | 'goals' | 'semantic' | 'analytics';
  label: string;
  gating: false;
};

export type HomePendingProjection = {
  /** Never claims "待你确认" when there is no reliable login-to-assignee identity mapping. */
  pendingHeading: '待处理事项';
  storeState: 'ready' | 'uninitialized' | 'unavailable' | 'restricted';
  pending: HomePendingItem[];
  unresolvedRequests: HomePendingItem[];
  continueWork: HomeContinueItem[];
  externalWaiting: HomeExternalWaitingItem[];
  pendingOperations: HomeOperationToVerify[];
  foundationReminders: HomeFoundationReminder[];
};

export const FOUNDATION_REMINDERS: HomeFoundationReminder[] = [
  { key: 'strategy', label: '战略选择', gating: false },
  { key: 'goals', label: '目标管理', gating: false },
  { key: 'semantic', label: '语义资产', gating: false },
  { key: 'analytics', label: '分析资产', gating: false },
];

export type HomePendingCaseInput = {
  record: CaseRecord;
  issues: CaseDecisionIssue[];
  requests: CaseDecisionRequest[];
  choices?: CaseStrategyChoice[] | null;
  feedbackResponses?: CaseFeedbackResponse[] | null;
  /** Qualified per request; one unavailable action must not hide other requests. */
  requestStatuses?: Readonly<Record<string, CaseDecisionRequestStatus>>;
  pendingOperations?: OperationReceipt[];
};

/**
 * Pure projection of the workspace home sections from authoritative records.
 * - Explicit requests only appear in `pending` when their derived status is `open`.
 * - Missing choice/feedback, `Case.status === 'awaiting_confirmation'`, or plain reports never fabricate a request.
 * - `pendingOperations` are kept in a separate `operation-to-verify` group.
 */
export function projectHomePending(input: {
  storeState: HomePendingProjection['storeState'];
  cases: HomePendingCaseInput[];
}): HomePendingProjection {
  if (input.storeState !== 'ready') {
    return {
      pendingHeading: '待处理事项',
      storeState: input.storeState,
      pending: [],
      unresolvedRequests: [],
      continueWork: [],
      externalWaiting: [],
      pendingOperations: [],
      foundationReminders: FOUNDATION_REMINDERS,
    };
  }
  const pending: HomePendingItem[] = [];
  const unresolvedRequests: HomePendingItem[] = [];
  const continueWork: HomeContinueItem[] = [];
  const externalWaiting: HomeExternalWaitingItem[] = [];
  const pendingOperations: HomeOperationToVerify[] = [];

  for (const entry of input.cases) {
    const { record, issues, requests, choices, feedbackResponses } = entry;
    const issueMap = new Map(issues.map(i => [i.id, i]));
    for (const op of entry.pendingOperations ?? []) {
      if (op.phase !== 'completed') {
        pendingOperations.push({
          group: 'operation-to-verify',
          operationId: op.operationId,
          kind: op.kind,
          phase: op.phase,
          caseId: op.caseId,
          projectId: op.projectId,
          updatedAt: op.updatedAt,
        });
      }
    }
    for (const req of requests) {
      const status = entry.requestStatuses?.[req.requestId] ?? requestStatus(req, req.kind === 'choose' ? choices : undefined, req.kind === 'observe' ? feedbackResponses : undefined);
      const item: HomePendingItem = {
        requestId: req.requestId,
        revision: req.revision,
        caseId: record.id,
        caseTitle: record.title,
        issueId: req.issueId,
        issueTitle: issueMap.get(req.issueId)?.title ?? '原事项暂不可读',
        kind: req.kind,
        actionLabel: req.kind === 'choose' ? '作取舍' : '补原始观察',
        text: req.text,
        source: req.source,
        assignee: req.assignee,
        requestedAt: req.requestedAt,
        ...(req.dueDate ? { dueDate: req.dueDate } : {}),
        target: req.target,
        status,
      };
      if (status === 'open') {
        // Without a declared assignee label or source, do not fabricate a personal obligation; surface in continue/unresolved?
        // Per §4.3: explicit request with assignee label/source goes to pending; without assignee label, still show in continueWork or pending?
        // Spec §4.3: "无承担人或来源不足的材料进入继续工作／待核说明，不伪造个人义务。"
        if (req.assignee.label && req.assignee.source) {
          pending.push(item);
        } else {
          unresolvedRequests.push({ ...item, status: 'unverifiable' });
        }
      } else if (status === 'unverifiable' || status === 'superseded') {
        unresolvedRequests.push(item);
      }
    }
    if (record.status === 'observing') {
      const latestIssue = issues.at(-1) ?? null;
      externalWaiting.push({
        caseId: record.id,
        caseTitle: record.title,
        issueId: latestIssue?.id ?? null,
        issueTitle: latestIssue?.title ?? null,
        reason: record.nextStep || '正在等待外部执行或观察结果',
        updatedAt: record.updatedAt,
      });
    } else if (record.status !== 'closed') {
      const latestIssue = issues.at(-1) ?? null;
      continueWork.push({
        caseId: record.id,
        caseTitle: record.title,
        status: record.status,
        updatedAt: record.updatedAt,
        issueId: latestIssue?.id ?? null,
        issueTitle: latestIssue?.title ?? null,
        nextStep: record.nextStep,
      });
    }
  }

  pending.sort((a, b) => Date.parse(b.requestedAt) - Date.parse(a.requestedAt));
  continueWork.sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
  externalWaiting.sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));

  return {
    pendingHeading: '待处理事项',
    storeState: 'ready',
    pending,
    unresolvedRequests,
    continueWork,
    externalWaiting,
    pendingOperations,
    foundationReminders: FOUNDATION_REMINDERS,
  };
}
