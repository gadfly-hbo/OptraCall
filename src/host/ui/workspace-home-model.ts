import type { CaseArtifactView, CaseDetail, CaseProjectLink, CaseRecord, CaseStatus, WorkEvent } from '../case-types.ts';
import type { CaseDecisionRevision } from '../case-decision-types.ts';
import type { StrategyGoalsIndex } from '../strategy-goals-types.ts';
import { taskPurpose, taskTypes, type TaskType } from '../task-assignment.ts';
import type { ClientProject, ClientTask } from './project-types.ts';

export type InitialWorkspaceView = 'home' | 'foundation' | 'goals' | 'studio' | 'chat' | 'cases';

export function resolveInitialWorkspaceView(locationHref: string): InitialWorkspaceView {
  const url = new URL(locationHref);
  const params = url.searchParams;
  if (params.has('management')) return 'goals';
  if (params.has('studio')) return 'studio';
  if (params.has('project') || params.has('task')) return 'chat';
  if (params.has('returnCase')) return 'cases';
  if (params.get('view') === 'foundation' || url.hash === '#foundation') return 'foundation';
  return 'home';
}

export type HomeCaseAccessState = 'loading' | 'ready' | 'empty' | 'forbidden' | 'unavailable';

export type HomeActionReadState = 'ready' | 'loading' | 'forbidden' | 'unavailable' | 'partial-forbidden' | 'partial-unavailable';

export const actionReadNotice: Record<HomeActionReadState, string> = {
  ready: '',
  loading: '正在读取看板行动。',
  forbidden: '看板行动暂无读取权限。',
  unavailable: '看板行动暂不可读。',
  'partial-forbidden': '部分 Case 的行动关联无读取权限。',
  'partial-unavailable': '部分 Case 的行动关联暂不可读。',
};

export type HomeFoundationId = 'strategy' | 'goals' | 'semantic' | 'analysis';

export interface HomeFoundationSnapshot {
  state: 'ready' | 'forbidden' | 'unavailable';
  status: string;
  detail: string;
}

export interface HomeFoundationTile {
  id: HomeFoundationId;
  title: string;
  rhythm: string;
  status: string;
  tone: 'good' | 'neutral' | 'warn';
  detail: string;
}

export function resolveActiveStudioEnterprise(input: {
  enterprises: readonly { id: string; name: string }[];
  selectedEnterpriseId?: string;
  currentProjectId?: string;
  projectAssignments?: readonly { projectId?: string; enterpriseId: string }[];
}): { enterprise: { id: string; name: string } | null; unselected: boolean } {
  const { enterprises, selectedEnterpriseId, currentProjectId, projectAssignments } = input;
  if (!enterprises.length) return { enterprise: null, unselected: false };
  if (selectedEnterpriseId === '') return { enterprise: null, unselected: true };
  if (selectedEnterpriseId) {
    const matched = enterprises.find(item => item.id === selectedEnterpriseId);
    if (matched) return { enterprise: matched, unselected: false };
  }
  if (currentProjectId && projectAssignments?.length) {
    const assignedId = projectAssignments.find(item => item.projectId === currentProjectId)?.enterpriseId;
    const assigned = assignedId ? enterprises.find(item => item.id === assignedId) : undefined;
    if (assigned) return { enterprise: assigned, unselected: false };
  }
  return enterprises.length === 1
    ? { enterprise: enterprises[0]!, unselected: false }
    : { enterprise: null, unselected: true };
}

export function summarizeStudioFoundationSnapshots(input: {
  enterprise: { id: string; name: string } | null;
  unselected?: boolean;
  systems: readonly { id: string; enterpriseId?: string | null }[];
  foundationResult:
    | { ok: true; items: readonly { authority: string; status: string }[] }
    | { ok: false; state: 'forbidden' | 'unavailable'; message: string }
    | null;
}): { semantic: HomeFoundationSnapshot; analysis: HomeFoundationSnapshot } {
  if (input.foundationResult && !input.foundationResult.ok) {
    const label = input.foundationResult.state === 'forbidden' ? '无权限' : '暂不可读';
    const snap: HomeFoundationSnapshot = {
      state: input.foundationResult.state,
      status: label,
      detail: input.foundationResult.message,
    };
    return { semantic: snap, analysis: { ...snap } };
  }
  if (input.unselected) {
    return {
      semantic: { state: 'ready', status: '待选企业', detail: '请先选择当前企业以核对语义资产范围' },
      analysis: { state: 'ready', status: '待选企业', detail: '请先选择当前企业以核对分析资产范围' },
    };
  }
  if (!input.enterprise) {
    return {
      semantic: { state: 'ready', status: '未开始', detail: '尚未建立企业与语义资产' },
      analysis: { state: 'ready', status: '未开始', detail: '尚未建立企业与分析资产' },
    };
  }

  // Strictly count ONLY systems belonging to the active enterprise.
  const enterpriseSystems = input.systems.filter(system => system.enterpriseId === input.enterprise!.id);
  const systemCount = enterpriseSystems.length;

  let semanticFormal = 0;
  let semanticCandidate = 0;
  let semanticHistory = 0;
  let analyticsFormal = 0;
  let analyticsCandidate = 0;
  let analyticsHistory = 0;

  for (const item of input.foundationResult?.items ?? []) {
    const isAnalytics = item.authority === 'sap-metric' || item.authority === 'sap-method';
    if (item.status === 'formal-current') {
      if (isAnalytics) analyticsFormal += 1;
      else semanticFormal += 1;
    } else if (item.status === 'candidate') {
      if (isAnalytics) analyticsCandidate += 1;
      else semanticCandidate += 1;
    } else if (item.status === 'formal-history') {
      if (isAnalytics) analyticsHistory += 1;
      else semanticHistory += 1;
    }
  }

  const buildDomainSnapshot = (
    formalCount: number,
    candidateCount: number,
    historyCount: number,
    domainNoun: '语义资产' | '分析资产',
  ): HomeFoundationSnapshot => {
    if (formalCount > 0) {
      return {
        state: 'ready',
        status: '已发布',
        detail: `${formalCount} 项正式${domainNoun}${candidateCount > 0 ? ` · ${candidateCount} 项候选待核` : ''}`,
      };
    }
    if (candidateCount > 0) {
      return {
        state: 'ready',
        status: '候选待发布',
        detail: `${candidateCount} 项候选待核查发布（尚无当前正式${domainNoun}）`,
      };
    }
    if (systemCount > 0 || historyCount > 0) {
      return {
        state: 'ready',
        status: '建设中',
        detail: systemCount > 0 ? `${systemCount} 个本企业体系建设中` : `历史版本已停用，尚无当前正式${domainNoun}`,
      };
    }
    return {
      state: 'ready',
      status: '未开始',
      detail: `尚未发布${domainNoun}`,
    };
  };

  return {
    semantic: buildDomainSnapshot(semanticFormal, semanticCandidate, semanticHistory, '语义资产'),
    analysis: buildDomainSnapshot(analyticsFormal, analyticsCandidate, analyticsHistory, '分析资产'),
  };
}

export function summarizeStrategyFoundationSnapshot(input: {
  initiatives: readonly { id: string }[];
  publicationChecks: readonly ({ ok: true; hasActive: boolean } | { ok: false; state: 'forbidden' | 'unavailable'; message: string })[];
}): HomeFoundationSnapshot {
  const hasPublished = input.publicationChecks.some(res => res.ok && res.hasActive);
  if (hasPublished) {
    return {
      state: 'ready',
      status: '已发布',
      detail: '存在已发布战略版本',
    };
  }
  const failedChecks = input.publicationChecks.filter(
    (res): res is { ok: false; state: 'forbidden' | 'unavailable'; message: string } => !res.ok,
  );
  if (input.initiatives.length > 0 && failedChecks.length === input.publicationChecks.length && failedChecks[0]) {
    const first = failedChecks[0];
    return {
      state: first.state,
      status: first.state === 'forbidden' ? '无权限' : '暂不可读',
      detail: first.message,
    };
  }
  if (input.initiatives.length > 0) {
    const partialNote = failedChecks.length > 0 ? `（${failedChecks.length} 项发布状态暂不可读）` : '';
    return {
      state: 'ready',
      status: '进行中',
      detail: `${input.initiatives.length} 项战略讨论进行中${partialNote}`,
    };
  }
  return {
    state: 'ready',
    status: '未开始',
    detail: '尚未开展战略选择',
  };
}

export interface HomeBoardActionInput {
  id: string;
  itemId: string;
  projectId: string;
  caseId?: string;
  referencedCaseIds?: readonly string[];
  title: string;
  owner: string;
  dueDate: string;
  status: 'todo' | 'doing' | 'done';
  updatedAt: string;
}

export function extractHomeBoardActions(input: {
  items: readonly {
    id: string;
    projectId: string;
    status: 'suggested' | 'adopted' | 'dismissed';
    tasks: readonly {
      id: string;
      itemId: string;
      title: string;
      owner: string | null;
      dueDate: string | null;
      status: 'todo' | 'doing' | 'done';
      updatedAt: string;
      authorization?: {
        decision: 'authorize' | 'revoke';
        source: { caseId: string } | { kind: 'work'; projectId: string };
      } | null;
    }[];
  }[];
  caseDecisionTaskIdsByCase?: ReadonlyMap<string, ReadonlySet<string>>;
}): HomeBoardActionInput[] {
  const result: HomeBoardActionInput[] = [];
  for (const item of input.items) {
    if (item.status === 'dismissed') continue;
    for (const task of item.tasks) {
      if (task.authorization?.decision === 'revoke') continue;
      const source = task.authorization?.source;
      const caseId = source && 'caseId' in source ? source.caseId : undefined;
      const referencedCaseIds: string[] = [];
      for (const [id, taskIds] of input.caseDecisionTaskIdsByCase ?? []) {
        if (id !== caseId && taskIds.has(task.id)) referencedCaseIds.push(id);
      }
      if (item.status !== 'adopted' && !task.authorization && !referencedCaseIds.length) continue;
      result.push({
        id: task.id,
        itemId: task.itemId,
        projectId: item.projectId,
        caseId,
        referencedCaseIds,
        title: task.title,
        owner: task.owner?.trim() ?? '',
        dueDate: task.dueDate?.trim() ?? '',
        status: task.status,
        updatedAt: task.updatedAt,
      });
    }
  }
  return result;
}

function linkedCasesOfAction(action: HomeBoardActionInput): readonly string[] {
  const referenced = action.referencedCaseIds ?? [];
  return action.caseId ? [action.caseId, ...referenced] : referenced;
}

export function collectCaseActionTaskIds(decisions: readonly CaseDecisionRevision[]): Set<string> {
  const ids = new Set<string>();
  for (const record of decisions) {
    if (record.lifecycle === 'archived') continue;
    for (const ref of record.references) {
      if (ref.relation === 'action' && ref.target.type === 'board-task') {
        ids.add(ref.target.taskId);
      }
    }
  }
  return ids;
}

export type HomeProofSource =
  | { kind: 'report'; label: string; caseId: string; caseTitle: string; projectId: string; taskId: string; relativePath: string; sha256: string }
  | { kind: 'case'; label: string; caseId: string }
  | { kind: 'projects'; label: string }
  | { kind: 'decision'; label: string };

export type HomeProofModel =
  | {
      kind: 'grouped';
      caption: string;
      total: number;
      unit: string;
      portion: number;
      groups: { label: string; count: number; unit: string }[];
      source: HomeProofSource | null;
    }
  | {
      kind: 'readiness';
      caption: string;
      completedCount: number;
      totalCount: 3;
      portion: number;
      facts: { text: string; confirmed: boolean }[];
      nextActionLabel: string;
      source: HomeProofSource | null;
    };

export type HomeQueueItem =
  | {
      kind: 'case';
      id: string;
      caseId: string;
      title: string;
      context: string;
      statusLabel: string;
      tone: 'attention' | 'active' | 'review';
      owner: string;
      dateLabel: string;
    }
  | {
      kind: 'action';
      id: string;
      actionId: string;
      projectId: string;
      caseId?: string;
      title: string;
      context: string;
      statusLabel: string;
      tone: 'attention' | 'active';
      owner: string;
      dateLabel: string;
    }
  | {
      kind: 'report';
      id: string;
      caseId: string;
      caseTitle: string;
      projectId: string;
      taskId: string;
      relativePath: string;
      sha256: string;
      title: string;
      context: string;
      statusLabel: string;
      tone: 'review';
      owner: string;
      dateLabel: string;
    };

export type HomeActivityTarget =
  | { kind: 'case'; caseId: string }
  | { kind: 'project'; projectId: string }
  | { kind: 'task'; projectId: string; taskId: string; caseId?: string; caseTitle?: string; openReport?: boolean; reportPath?: string; reportSha256?: string };

export interface HomeActivityItem {
  id: string;
  timeLabel: string;
  timestamp: string;
  title: string;
  detail: string;
  target: HomeActivityTarget;
}

export interface WorkspaceHomeInput {
  caseAccessState: HomeCaseAccessState;
  caseAccessMessage?: string;
  enterpriseName?: string;
  cases: readonly CaseRecord[];
  projectLinks: readonly CaseProjectLink[];
  focusCaseId?: string;
  focusDetail?: CaseDetail | null;
  projects: readonly ClientProject[];
  goals?: StrategyGoalsIndex | null;
  boardActions?: readonly HomeBoardActionInput[];
  actionReadState?: HomeActionReadState;
  foundations?: Partial<Record<HomeFoundationId, HomeFoundationSnapshot>>;
}

export interface WorkspaceHomeModel {
  caseAccessState: HomeCaseAccessState;
  caseAccessMessage?: string;
  enterpriseName: string;
  headline: string;
  focusCase: CaseRecord | null;
  focusStatusLabel: string;
  focusActionBadge?: string;
  linkedProject: ClientProject | null;
  goalSummary: { goalText: string; strategyText: string; hasBinding: boolean };
  proof: HomeProofModel;
  queue: HomeQueueItem[];
  activities: HomeActivityItem[];
  counts: {
    activeCases: number;
    totalCases: number;
    activeProjects: number;
    totalProjects: number;
    inProgressActions: number | null;
  };
  foundations: HomeFoundationTile[];
}

const CASE_STATUS_LABELS: Record<CaseStatus, string> = {
  pending: '待处理',
  analyzing: '分析中',
  awaiting_confirmation: '待确认',
  observing: '待观察',
  closed: '已结束',
};

const EVENT_LABELS: Record<WorkEvent['eventType'], string> = {
  case_created: '创建决策 Case',
  case_updated: '更新 Case 进展',
  case_closed: '结束 Case',
  case_reopened: '重新打开 Case',
  project_linked: '关联执行项目',
  project_unlinked: '解除项目关联',
  artifact_linked: '关联分析产物',
  artifact_updated: '更新产物记录',
  artifact_unlinked: '解除产物引用',
  note_added: '追加 Case 说明',
  project_work_updated: '更新项目工作进展',
  project_work_note_added: '追加项目说明',
  case_strategy_choice: '记录策略取舍',
};

function shortDate(iso?: string | null): string {
  if (!iso) return '待定';
  const trimmed = iso.trim();
  if (!trimmed) return '待定';
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return trimmed.slice(5).replace('-', '/');
  }
  const date = new Date(trimmed);
  if (Number.isNaN(date.getTime())) return trimmed;
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${month}/${day}`;
}

function activityTime(iso?: string | null): string {
  if (!iso) return '最近';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '最近';
  const now = new Date();
  if (date.toDateString() === now.toDateString()) {
    return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
  }
  return shortDate(iso);
}

function caseTone(status: CaseStatus): 'attention' | 'active' | 'review' {
  if (status === 'awaiting_confirmation') return 'attention';
  if (status === 'observing') return 'review';
  if (status === 'analyzing') return 'active';
  return 'attention';
}

export function defaultFoundationTile(id: HomeFoundationId, snapshot?: HomeFoundationSnapshot): HomeFoundationTile {
  const meta: Record<HomeFoundationId, { title: string; rhythm: string }> = {
    strategy: { title: '战略选择', rhythm: '年度规划 · 季度或月度回顾' },
    goals: { title: '目标管理', rhythm: '年度设定 · 月度或周度跟进' },
    semantic: { title: '语义资产', rhythm: '按需建设业务口径' },
    analysis: { title: '分析资产', rhythm: '按需沉淀分析方法' },
  };
  const info = meta[id];
  if (!snapshot) {
    return { id, ...info, status: '未开始', tone: 'neutral', detail: '按需开展建设' };
  }
  if (snapshot.state === 'forbidden' || snapshot.state === 'unavailable') {
    return { id, ...info, status: snapshot.status || '暂不可读', tone: 'warn', detail: snapshot.detail };
  }
  const good = snapshot.status === '已发布' || snapshot.status === '已采用';
  return { id, ...info, status: snapshot.status, tone: good ? 'good' : 'neutral', detail: snapshot.detail };
}

function findAvailableReport(detail: CaseDetail | null | undefined): CaseArtifactView | undefined {
  if (!detail) return undefined;
  return detail.artifacts.find(
    item => !item.unlinkedAt && item.role === 'report' && item.availability === 'available' && item.taskId && item.observedSha256,
  );
}

export function buildWorkspaceHomeModel(input: WorkspaceHomeInput): WorkspaceHomeModel {
  const activeProjects = input.projects.filter(project => !project.archivedAt);
  const projectMap = new Map(input.projects.map(project => [project.id, project]));
  const cases = input.caseAccessState === 'ready' ? input.cases : [];
  const caseMap = new Map(cases.map(record => [record.id, record]));
  const activeCases = cases
    .filter(item => item.status !== 'closed')
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const preferredFocus = input.focusCaseId ? caseMap.get(input.focusCaseId) : undefined;
  const focusCase =
    (preferredFocus && preferredFocus.status !== 'closed' ? preferredFocus : undefined) ??
    activeCases[0] ??
    preferredFocus ??
    cases[0] ??
    null;

  const focusDetail = input.focusDetail && focusCase && input.focusDetail.case.id === focusCase.id ? input.focusDetail : null;
  const focusLinks = focusCase
    ? input.projectLinks.filter(link => link.caseId === focusCase.id)
    : [];
  const focusProjects = focusLinks
    .map(link => projectMap.get(link.projectId))
    .filter((item): item is ClientProject => Boolean(item));
  const linkedProject = focusProjects.find(project => !project.archivedAt) ?? focusProjects[0] ?? null;

  const activeCaseIds = new Set(activeCases.map(record => record.id));
  const boardActions = (input.boardActions ?? []).filter(action => {
    const caseIds = linkedCasesOfAction(action);
    return !caseIds.length || caseIds.some(id => activeCaseIds.has(id));
  });
  const actionsComplete = (input.actionReadState ?? 'ready') === 'ready';
  const inProgressActions = actionsComplete ? boardActions.filter(action => action.status === 'doing').length : null;

  const focusActions = !focusCase || focusCase.status === 'closed' ? [] : boardActions.filter(action => {
    const caseIds = linkedCasesOfAction(action);
    return caseIds.length ? caseIds.includes(focusCase.id) : focusLinks.some(link => link.projectId === action.projectId);
  });

  // Resolve exact pinned goal version from goalBinding (never silently switching to latest).
  let goalText = '为眼前的问题确定一个可核对的目标';
  let strategyText = '选择一条值得尝试的策略';
  let hasBinding = false;
  let boundGoalOwner: string | undefined;
  if (input.caseAccessState === 'forbidden') {
    goalText = '当前身份暂无 Case 读取权限，不会展示或推测未授权的目标绑定';
    strategyText = '已获准的项目、任务与基础建设仍可按各自权限正常访问';
  } else if (input.caseAccessState === 'unavailable') {
    goalText = 'Case 存储暂时不可读取，保留原有记录不作覆盖';
    strategyText = '可先进入项目地图继续任务，待存储恢复后重试读取';
  } else if (focusDetail?.goalBinding) {
    hasBinding = true;
    const binding = focusDetail.goalBinding;
    const goalRecord = input.goals?.goals.find(item => item.id === binding.primary.goalId);
    const exactVersion = goalRecord?.versions.find(item => item.version === binding.primary.version);
    if (exactVersion) {
      goalText = `${exactVersion.title}（v${exactVersion.version}）`;
      boundGoalOwner = exactVersion.responsible?.trim() || undefined;
      strategyText = binding.strategy || '已关联目标版本，具体策略待核对';
    } else {
      goalText = `目标 ${binding.primary.goalId}（v${binding.primary.version}）`;
      strategyText = binding.strategy || '原目标版本暂未读到，保留准确引用';
    }
  } else if (focusCase) {
    goalText = focusDetail ? '尚未关联目标版本' : '目标关联暂不可读';
    strategyText = focusDetail ? '尚未关联具体策略' : '具体策略暂不可读';
  }

  const primaryReport = focusCase && focusCase.status !== 'closed' ? findAvailableReport(focusDetail) : undefined;
  const reportSource: HomeProofSource | null =
    primaryReport && focusCase && primaryReport.taskId && primaryReport.observedSha256
      ? {
          kind: 'report',
          label: `来源 · ${primaryReport.displayName || primaryReport.relativePath.split('/').at(-1)}`,
          caseId: focusCase.id,
          caseTitle: focusCase.title,
          projectId: primaryReport.projectId,
          taskId: primaryReport.taskId,
          relativePath: primaryReport.relativePath,
          sha256: primaryReport.observedSha256,
        }
      : focusCase
        ? { kind: 'case', label: `来源 · Case 修订 v${focusCase.revision}`, caseId: focusCase.id }
        : null;

  // Build proof panel strictly from real records; ensure Proof source matches the exact data shown!
  let proof: HomeProofModel;
  const activeArtifacts = focusDetail?.artifacts.filter(item => !item.unlinkedAt) ?? [];
  if (input.caseAccessState === 'forbidden' || input.caseAccessState === 'unavailable') {
    const label = input.caseAccessState === 'forbidden' ? 'Case 记录受权限限制' : 'Case 记录暂不可读取';
    const facts = [
      { text: '核对 Case 访问权限或存储状态', confirmed: false },
      { text: '可访问执行项目保持就绪', confirmed: activeProjects.length > 0 },
      { text: '按权限独立打开项目与任务', confirmed: activeProjects.some(p => p.tasks.length > 0) },
    ];
    const completedCount = facts.filter(fact => fact.confirmed).length;
    proof = {
      kind: 'readiness',
      caption: label,
      completedCount,
      totalCount: 3,
      portion: Math.round(100 * completedCount / facts.length),
      facts,
      nextActionLabel: '打开项目地图继续工作',
      source: { kind: 'projects', label: '打开项目地图继续工作' },
    };
  } else if (focusCase && focusActions.length >= 1) {
    const doingCount = focusActions.filter(a => a.status === 'doing').length;
    const todoCount = focusActions.filter(a => a.status === 'todo').length;
    const doneCount = focusActions.filter(a => a.status === 'done').length;
    const groups = [
      { label: '执行中', count: doingCount, unit: '项' },
      { label: '待执行', count: todoCount, unit: '项' },
      { label: '已完成', count: doneCount, unit: '项' },
    ].filter(group => group.count > 0);
    proof = {
      kind: 'grouped',
      caption: (actionsComplete ? '已关联行动进展' : '已核对的关联行动进展') + (focusActions.some(action => !linkedCasesOfAction(action).length) ? '（含项目行动）' : ''),
      total: focusActions.length,
      unit: '项行动',
      portion: Math.round(((doingCount + doneCount) / focusActions.length) * 100),
      groups: groups.length > 0 ? groups : [{ label: '待执行', count: 0, unit: '项' }],
      source: { kind: 'decision', label: '来源 · 决策看板行动记录' },
    };
  } else if (focusCase && focusProjects.length >= 2) {
    const statusCounts = { in_progress: 0, not_started: 0, awaiting_feedback: 0, completed: 0, cancelled: 0, unset: 0, unavailable: 0 };
    for (const project of focusProjects) {
      const status = project.workUnavailable ? 'unavailable' : project.work?.workStatus ?? 'unset';
      statusCounts[status]++;
    }
    const buckets = [
      { label: '执行中', count: statusCounts.in_progress },
      { label: '未开始', count: statusCounts.not_started },
      { label: '待反馈', count: statusCounts.awaiting_feedback },
      { label: '已完成', count: statusCounts.completed },
      { label: '已取消', count: statusCounts.cancelled },
      { label: '未设置', count: statusCounts.unset },
      { label: '暂不可读', count: statusCounts.unavailable },
    ];
    proof = {
      kind: 'grouped',
      caption: '关联项目工作状态',
      total: focusProjects.length,
      unit: '个项目',
      portion: Math.round(((statusCounts.in_progress + statusCounts.completed) / focusProjects.length) * 100),
      groups: buckets.filter(bucket => bucket.count > 0).map(bucket => ({ ...bucket, unit: '个' })),
      source: { kind: 'projects', label: '来源 · 关联项目工作记录' },
    };
  } else if (focusCase && activeArtifacts.length >= 2) {
    const reports = activeArtifacts.filter(item => item.role === 'report').length;
    const others = activeArtifacts.length - reports;
    proof = {
      kind: 'grouped',
      caption: '已关联依据与产物',
      total: activeArtifacts.length,
      unit: '份记录',
      portion: Math.round((reports / activeArtifacts.length) * 100),
      groups: [
        { label: '正式报告', count: reports, unit: '份' },
        { label: '分析与资料', count: others, unit: '份' },
      ],
      source: reportSource,
    };
  } else {
    const facts = [
      { text: '明确目标与策略', confirmed: hasBinding },
      { text: '关联执行项目', confirmed: focusProjects.length > 0 },
      { text: '留存报告或决策记录', confirmed: activeArtifacts.length > 0 || Boolean(focusCase?.judgement.trim()) },
    ];
    const completedCount = facts.filter(item => item.confirmed).length;
    proof = {
      kind: 'readiness',
      caption: focusCase ? '当前 Case 工作记录' : '已有工作记录',
      completedCount,
      totalCount: 3,
      portion: Math.round((completedCount / 3) * 100),
      facts,
      nextActionLabel: !focusCase
        ? '从业务问题创建首个 Case'
        : focusCase.status === 'closed'
          ? '新建下一个 Case'
          : !hasBinding
            ? '核对目标与策略版本'
            : focusProjects.length === 0
              ? '关联或新建执行项目'
              : '继续在 Case 中补充依据与决定',
      source: reportSource,
    };
  }

  // Build "需要你处理" queue from active Cases + pending/doing Decision Board actions + available focus report review.
  const orderedActiveCases = focusCase && focusCase.status !== 'closed'
    ? [focusCase, ...activeCases.filter(item => item.id !== focusCase.id)]
    : activeCases;

  const queue: HomeQueueItem[] = [];

  for (const record of orderedActiveCases.slice(0, 2)) {
    const links = input.projectLinks.filter(link => link.caseId === record.id);
    const linked = links.map(link => projectMap.get(link.projectId)).filter((item): item is ClientProject => Boolean(item));
    const caseBoardActions = boardActions.filter(action => linkedCasesOfAction(action).includes(record.id) && action.status !== 'done');
    const distinctAssignees = [
      ...new Set(
        linked
          .filter(project => !project.workUnavailable && project.work?.workStatus !== 'cancelled')
          .map(project => project.work?.assignee?.trim())
          .filter((name): name is string => Boolean(name)),
      ),
    ];
    let owner = record.id === focusCase?.id && boundGoalOwner ? `目标负责人 · ${boundGoalOwner}` : '待定';
    if (distinctAssignees.length) {
      const others = distinctAssignees.length > 1 ? ` 等 ${distinctAssignees.length} 人` : '';
      owner = `项目负责人 · ${distinctAssignees[0]}${others}`;
    }
    const nearestDue = caseBoardActions
      .map(action => action.dueDate)
      .filter(Boolean)
      .sort()[0];
    queue.push({
      kind: 'case',
      id: `case:${record.id}`,
      caseId: record.id,
      title: record.nextStep.trim() || '明确这件事的下一步',
      context: record.title,
      statusLabel: CASE_STATUS_LABELS[record.status],
      tone: caseTone(record.status),
      owner,
      dateLabel: nearestDue ? `行动期限 ${shortDate(nearestDue)}` : actionsComplete ? '期限待定' : '行动期限待核对',
    });
  }

  const pendingBoardActions = boardActions
    .filter(action => action.status !== 'done')
    .sort((a, b) => {
      if (a.status !== b.status) return a.status === 'doing' ? -1 : 1;
      return b.updatedAt.localeCompare(a.updatedAt);
    });

  for (const action of pendingBoardActions.slice(0, 2)) {
    const actionCases = linkedCasesOfAction(action)
      .map(id => caseMap.get(id))
      .filter((record): record is CaseRecord => record !== undefined && record.status !== 'closed');
    const actionProject = projectMap.get(action.projectId);
    queue.push({
      kind: 'action',
      id: `action:${action.id}`,
      actionId: action.id,
      projectId: action.projectId,
      caseId: actionCases.length === 1 ? actionCases[0].id : undefined,
      title: action.title,
      context: [...actionCases.map(record => record.title), actionProject?.name].filter(Boolean).join(' · ') || '决策看板行动',
      statusLabel: action.status === 'doing' ? '执行中' : '待执行',
      tone: action.status === 'doing' ? 'active' : 'attention',
      owner: action.owner.trim() || '待定',
      dateLabel: action.dueDate.trim() ? shortDate(action.dueDate) : '期限待定',
    });
  }

  if (primaryReport && focusCase && focusCase.status !== 'closed' && primaryReport.taskId && primaryReport.observedSha256) {
    const reportProject = projectMap.get(primaryReport.projectId);
    const reportOwner =
      !reportProject?.workUnavailable && reportProject?.work?.assignee?.trim()
        ? reportProject.work.assignee.trim()
        : '待定';
    queue.push({
      kind: 'report',
      id: `report:${primaryReport.id}`,
      caseId: focusCase.id,
      caseTitle: focusCase.title,
      projectId: primaryReport.projectId,
      taskId: primaryReport.taskId,
      relativePath: primaryReport.relativePath,
      sha256: primaryReport.observedSha256,
      title: `核对「${primaryReport.displayName || primaryReport.relativePath.split('/').at(-1)}」的依据`,
      context: `${primaryReport.taskName || primaryReport.projectName || reportProject?.name || '项目报告'} · ${primaryReport.observedSha256.slice(0, 8)}`,
      statusLabel: '待核对',
      tone: 'review',
      owner: reportOwner,
      dateLabel: primaryReport.observedAt || primaryReport.updatedAt ? `生成 ${shortDate(primaryReport.observedAt || primaryReport.updatedAt)}` : '待定',
    });
  }

  // Build "最近活动" from real Case events, project events, and recent tasks.
  const activityEntries: HomeActivityItem[] = [];
  if (focusDetail && focusCase) {
    for (const event of [...focusDetail.events, ...focusDetail.projectEvents]) {
      const targetProject = event.subjectType === 'project' ? projectMap.get(event.subjectId) : undefined;
      activityEntries.push({
        id: `event:${event.id}`,
        timeLabel: activityTime(event.occurredAt),
        timestamp: event.occurredAt,
        title: EVENT_LABELS[event.eventType] ?? '更新工作记录',
        detail: event.note || (targetProject ? targetProject.name : focusCase.title),
        target: targetProject ? { kind: 'project', projectId: targetProject.id } : { kind: 'case', caseId: focusCase.id },
      });
    }
  }
  for (const project of activeProjects) {
    for (const task of project.tasks) {
      if (task.archivedAt) continue;
      activityEntries.push({
        id: `task:${project.id}/${task.id}`,
        timeLabel: activityTime(task.updatedAt),
        timestamp: task.updatedAt,
        title: task.name,
        detail: `${project.name}${task.assignment ? ` · ${taskPurpose[task.assignment.type].label}` : ''}`,
        target: {
          kind: 'task',
          projectId: project.id,
          taskId: task.id,
          ...(focusCase && focusCase.status !== 'closed' && focusLinks.some(link => link.projectId === project.id)
            ? { caseId: focusCase.id, caseTitle: focusCase.title }
            : {}),
        },
      });
    }
  }
  activityEntries.sort((a, b) => b.timestamp.localeCompare(a.timestamp));

  const headline =
    input.caseAccessState === 'loading' ? '正在读取 Decision Case' : input.caseAccessState === 'forbidden'
      ? '当前身份暂无 Case 读取权限'
      : input.caseAccessState === 'unavailable'
        ? 'Decision Case 记录暂不可读取'
        : focusCase
          ? focusCase.status === 'closed'
            ? `${focusCase.title}（已结束）`
            : focusCase.nextStep.trim() || focusCase.judgement.trim() || focusCase.title
          : '从第一个 Case 开始';

  const focusStatusLabel =
    input.caseAccessState === 'loading' ? '读取中' : input.caseAccessState === 'forbidden'
      ? '无权限读取'
      : input.caseAccessState === 'unavailable'
        ? '暂不可读'
        : focusCase
          ? CASE_STATUS_LABELS[focusCase.status]
          : '项目可独立开始';

  const focusActionBadge = focusActions.some(action => action.status === 'doing') ? '关联行动执行中' : undefined;

  return {
    caseAccessState: input.caseAccessState,
    caseAccessMessage: input.caseAccessMessage,
    enterpriseName: input.enterpriseName || '当前工作区',
    headline,
    focusCase,
    focusStatusLabel,
    focusActionBadge,
    linkedProject,
    goalSummary: { goalText, strategyText, hasBinding },
    proof,
    queue: queue.slice(0, 5),
    activities: activityEntries.slice(0, 3),
    counts: {
      activeCases: activeCases.length,
      totalCases: cases.length,
      activeProjects: activeProjects.length,
      totalProjects: input.projects.length,
      inProgressActions,
    },
    foundations: (['strategy', 'goals', 'semantic', 'analysis'] as const).map(id =>
      defaultFoundationTile(id, input.foundations?.[id]),
    ),
  };
}

export interface ProjectTaskTypeSummary {
  byType: Record<TaskType, number>;
  unassigned: number;
  archived: number;
  total: number;
}

export function summarizeProjectTaskTypes(tasks: readonly ClientTask[]): ProjectTaskTypeSummary {
  const byType: Record<TaskType, number> = {
    requirement: 0,
    analysis: 0,
    plan: 0,
    decision: 0,
    do: 0,
    teach: 0,
  };
  let unassigned = 0;
  let archived = 0;
  for (const task of tasks) {
    if (task.archivedAt) archived += 1;
    const type = task.assignment?.type;
    if (type && taskTypes.includes(type)) byType[type] += 1;
    else unassigned += 1;
  }
  return { byType, unassigned, archived, total: tasks.length };
}

export type WorkspaceSearchTarget =
  | { kind: 'view'; id: string; group: string; title: string; subtitle: string; view: 'home' | 'foundation' | 'cases' | 'projects' | 'decision' | 'help' }
  | { kind: 'foundation'; id: string; group: string; title: string; subtitle: string; foundation: HomeFoundationId }
  | { kind: 'settings'; id: string; group: string; title: string; subtitle: string; settingsView: 'usage-context-settings' | 'settings' | 'web-search-settings' | 'automatic-action-settings' | 'skill-settings' | 'connection-settings' | 'personal-materials' | 'model-pack-settings' | 'capability-plans' }
  | { kind: 'case'; id: string; group: string; title: string; subtitle: string; caseId: string }
  | { kind: 'project'; id: string; group: string; title: string; subtitle: string; projectId: string }
  | { kind: 'task'; id: string; group: string; title: string; subtitle: string; projectId: string; taskId: string };

const STATIC_SEARCH_ITEMS: readonly WorkspaceSearchTarget[] = [
  { kind: 'view', id: 'nav:home', group: '日常工作', title: '工作台首页', subtitle: '当前待决定事项、队列、最近活动与基础建设提醒', view: 'home' },
  { kind: 'view', id: 'nav:cases', group: '日常工作', title: '决策星图', subtitle: 'Decision Case 与项目关联关系', view: 'cases' },
  { kind: 'view', id: 'nav:projects', group: '日常工作', title: '项目地图', subtitle: '查看项目与六类任务', view: 'projects' },
  { kind: 'view', id: 'nav:decision', group: '日常工作', title: '决策工作台', subtitle: '决策看板与反馈复盘', view: 'decision' },
  { kind: 'view', id: 'nav:foundation', group: '基础建设', title: '基础建设总览', subtitle: '查看战略选择、目标管理、语义资产与分析资产整体状态', view: 'foundation' },
  { kind: 'foundation', id: 'foundation:strategy', group: '基础建设', title: '战略选择', subtitle: '战略共创、检验、发布与版本管理', foundation: 'strategy' },
  { kind: 'foundation', id: 'foundation:goals', group: '基础建设', title: '目标管理', subtitle: '总 GSA、拆解草稿、阶段跟进与到期复盘', foundation: 'goals' },
  { kind: 'foundation', id: 'foundation:semantic', group: '基础建设', title: '语义资产', subtitle: '业务语义、数据映射、企业资料与体系工作台', foundation: 'semantic' },
  { kind: 'foundation', id: 'foundation:analysis', group: '基础建设', title: '分析资产', subtitle: '分析指标、分析方法与体系工作台', foundation: 'analysis' },
  { kind: 'settings', id: 'settings:usage-context-settings', group: '设置 · 基础与模型', title: '使用用途', subtitle: '选择当前工作用途与上下文偏好', settingsView: 'usage-context-settings' },
  { kind: 'settings', id: 'settings:settings', group: '设置 · 基础与模型', title: '模型设置', subtitle: '配置本机模型、线路与凭据', settingsView: 'settings' },
  { kind: 'settings', id: 'settings:web-search-settings', group: '设置 · 基础与模型', title: '网络检索', subtitle: '配置网络搜索顺序与策略', settingsView: 'web-search-settings' },
  { kind: 'settings', id: 'settings:automatic-action-settings', group: '设置 · 能力与连接', title: '自动模式', subtitle: '控制保存、审查、Case 等自动动作开关', settingsView: 'automatic-action-settings' },
  { kind: 'settings', id: 'settings:skill-settings', group: '设置 · 能力与连接', title: 'Skill 资料与依赖', subtitle: '查看已安装 Skill 与运行依赖', settingsView: 'skill-settings' },
  { kind: 'settings', id: 'settings:connection-settings', group: '设置 · 能力与连接', title: '连接配置', subtitle: '共享数据库连接与项目来源配置', settingsView: 'connection-settings' },
  { kind: 'settings', id: 'settings:personal-materials', group: '设置 · 资料与资产包', title: '个人资料', subtitle: '管理个人知识、经验与留存记录', settingsView: 'personal-materials' },
  { kind: 'settings', id: 'settings:model-pack-settings', group: '设置 · 资料与资产包', title: '业务模型包', subtitle: '查看与注册纯计算模型包', settingsView: 'model-pack-settings' },
  { kind: 'settings', id: 'settings:capability-plans', group: '设置 · 资料与资产包', title: '领域资产包', subtitle: '查看领域资产包与项目授权', settingsView: 'capability-plans' },
  { kind: 'view', id: 'nav:help', group: '帮助', title: '帮助与操作手册', subtitle: '查看完整操作指南与离线手册', view: 'help' },
];

export function filterWorkspaceSearchItems(input: {
  query: string;
  projects: readonly ClientProject[];
  cases: readonly CaseRecord[];
}): WorkspaceSearchTarget[] {
  const dynamicItems: WorkspaceSearchTarget[] = [
    ...input.cases.map<WorkspaceSearchTarget>(record => ({
      kind: 'case',
      id: `case:${record.id}`,
      group: 'Decision Case',
      title: record.title,
      subtitle: `${CASE_STATUS_LABELS[record.status]} · ${record.nextStep || record.judgement || '查看 Case 详情'}`,
      caseId: record.id,
    })),
    ...input.projects.map<WorkspaceSearchTarget>(project => ({
      kind: 'project',
      id: `project:${project.id}`,
      group: project.archivedAt ? '已归档项目' : '项目',
      title: project.name,
      subtitle: `${project.tasks.length} 个任务${project.work?.assignee ? ` · ${project.work.assignee}` : ''}`,
      projectId: project.id,
    })),
    ...input.projects.flatMap(project =>
      project.tasks.map<WorkspaceSearchTarget>(task => ({
        kind: 'task',
        id: `task:${project.id}/${task.id}`,
        group: '任务',
        title: task.name,
        subtitle: `${project.name}${task.assignment ? ` · ${taskPurpose[task.assignment.type].label}` : ''}${task.archivedAt ? ' · 已归档' : ''}`,
        projectId: project.id,
        taskId: task.id,
      })),
    ),
  ];

  const all = [...STATIC_SEARCH_ITEMS, ...dynamicItems];
  const needle = input.query.trim().toLocaleLowerCase();
  if (!needle) return all.slice(0, 12);
  return all.filter(item => `${item.title}\n${item.subtitle}\n${item.group}`.toLocaleLowerCase().includes(needle)).slice(0, 20);
}
