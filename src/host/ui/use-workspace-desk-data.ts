import { useEffect, useMemo, useRef, useState } from 'react';
import { readBoard } from '../../../extensions/business-plugins/decision-board/ui/decision-board-client.ts';
import type { CaseDetail, CaseProjectLink, CaseRecord } from '../case-types.ts';
import type { StrategyGoalsIndex } from '../strategy-goals-types.ts';
import * as caseClient from './case-client.ts';
import { readCaseDecisions } from './case-decisions-client.ts';
import { listInitiatives, listPublications } from './strategy-initiative-client.ts';
import { listStudioEnterprises, listStudioSystems, readStudioFoundation } from './studio-api.ts';
import {
  collectCaseActionTaskIds,
  extractHomeBoardActions,
  resolveActiveStudioEnterprise,
  summarizeStrategyFoundationSnapshot,
  summarizeStudioFoundationSnapshots,
  type HomeActionReadState,
  type HomeBoardActionInput,
  type HomeCaseAccessState,
  type HomeFoundationId,
  type HomeFoundationSnapshot,
} from './workspace-home-model.ts';

export function classifyHttpFailure(error: unknown): { state: 'forbidden' | 'unavailable'; message: string } {
  const status = typeof (error as { status?: unknown })?.status === 'number' ? (error as { status: number }).status : 0;
  if (status === 403) {
    return {
      state: 'forbidden',
      message: error instanceof Error && error.message ? error.message : '当前身份暂无权读取该范围记录，可继续使用获准项目或调整权限。',
    };
  }
  return {
    state: 'unavailable',
    message: error instanceof Error && error.message ? error.message : '工作台数据暂时无法读取，现有项目仍可独立打开。',
  };
}

export interface WorkspaceDeskDataOptions {
  active: boolean;
  refreshToken: number;
  preferredCaseId?: string;
  selectedEnterpriseId?: string;
  currentProjectId?: string;
  onResolvedEnterpriseName?: (name: string | undefined) => void;
}

export interface WorkspaceDeskDataState {
  loading: boolean;
  reload: () => void;
  caseAccessState: HomeCaseAccessState;
  caseAccessMessage?: string;
  cases: CaseRecord[];
  projectLinks: CaseProjectLink[];
  focusDetail: CaseDetail | null;
  goals: StrategyGoalsIndex | null;
  boardActions: HomeBoardActionInput[];
  actionReadState: HomeActionReadState;
  enterprises: { id: string; name: string }[];
  activeEnterpriseId: string;
  enterpriseName?: string;
  enterpriseUnselected: boolean;
  foundations: Partial<Record<HomeFoundationId, HomeFoundationSnapshot>>;
}

const INITIAL_LOADING_FOUNDATIONS: Partial<Record<HomeFoundationId, HomeFoundationSnapshot>> = {
  strategy: { state: 'ready', status: '读取中', detail: '正在核对建设状态…' },
  goals: { state: 'ready', status: '读取中', detail: '正在核对建设状态…' },
  semantic: { state: 'ready', status: '读取中', detail: '正在核对建设状态…' },
  analysis: { state: 'ready', status: '读取中', detail: '正在核对建设状态…' },
};

type DeskSnapshot = Omit<WorkspaceDeskDataState, 'reload'>;

const PENDING_DESK: DeskSnapshot = {
  loading: true,
  caseAccessState: 'loading',
  cases: [],
  projectLinks: [],
  focusDetail: null,
  goals: null,
  boardActions: [],
  actionReadState: 'loading',
  enterprises: [],
  activeEnterpriseId: '',
  enterpriseUnselected: false,
  foundations: INITIAL_LOADING_FOUNDATIONS,
};

async function readCaseActionTaskIds(caseId: string, signal: AbortSignal) {
  const taskIds = new Set<string>();
  let continuation: string | null = null;
  do {
    signal.throwIfAborted();
    const page = await readCaseDecisions(caseId, { includeArchived: false, continuation });
    for (const taskId of collectCaseActionTaskIds(page.items)) taskIds.add(taskId);
    continuation = page.continuation;
  } while (continuation);
  return { caseId, taskIds };
}

export function useWorkspaceDeskData({
  active,
  refreshToken,
  preferredCaseId,
  selectedEnterpriseId,
  currentProjectId,
  onResolvedEnterpriseName,
}: WorkspaceDeskDataOptions): WorkspaceDeskDataState {
  const [manualReload, setManualReload] = useState(0);
  // Only render data authorized by the current visit, refresh and enterprise selection.
  const request = useMemo(() => ({
    active, refreshToken, manualReload, preferredCaseId, selectedEnterpriseId, currentProjectId,
  }), [active, refreshToken, manualReload, preferredCaseId, selectedEnterpriseId, currentProjectId]);
  const [result, setResult] = useState<{ request: typeof request; data: DeskSnapshot }>();
  const onResolvedEnterpriseNameRef = useRef(onResolvedEnterpriseName);
  onResolvedEnterpriseNameRef.current = onResolvedEnterpriseName;

  useEffect(() => {
    const { active, preferredCaseId, selectedEnterpriseId, currentProjectId } = request;
    if (!active) return;
    const controller = new AbortController();
    const { signal } = controller;
    onResolvedEnterpriseNameRef.current?.(undefined);

    void (async () => {
      const isCurrent = () => !signal.aborted;
      const nextFoundations: Partial<Record<HomeFoundationId, HomeFoundationSnapshot>> = {};

      // Recheck Case access on every workspace visit and refresh.
      let loadedCases: CaseRecord[] = [];
      let loadedLinks: CaseProjectLink[] = [];
      let accessState: HomeCaseAccessState = 'empty';
      let accessMessage: string | undefined;
      try {
        const storage = await caseClient.status(signal);
        if (!isCurrent()) return;
        if (storage.state === 'ready') {
          const list = await caseClient.list(signal);
          if (!isCurrent()) return;
          loadedCases = list.cases;
          loadedLinks = list.projectLinks;
          accessState = loadedCases.length ? 'ready' : 'empty';
        } else if (storage.state === 'uninitialized') {
          accessState = 'empty';
        } else {
          accessState = 'unavailable';
          accessMessage = 'Case 存储暂时不可用，现有项目仍保留并可独立打开。';
        }
      } catch (error) {
        if (!isCurrent()) return;
        const classified = classifyHttpFailure(error);
        accessState = classified.state;
        accessMessage = classified.message;
      }

      if (accessState === 'forbidden' || accessState === 'unavailable') {
        // A slow asset or board read must not postpone a known Case permission failure.
        setResult({ request, data: { ...PENDING_DESK, caseAccessState: accessState, caseAccessMessage: accessMessage } });
      }

      // 2. Read focused Case detail (read-only) when cases exist.
      let loadedDetail: CaseDetail | null = null;
      if (loadedCases.length) {
        const activeList = loadedCases
          .filter(item => item.status !== 'closed')
          .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
        const preferred = preferredCaseId ? loadedCases.find(item => item.id === preferredCaseId) : undefined;
        const target =
          (preferred && preferred.status !== 'closed' ? preferred : undefined) ??
          activeList[0] ??
          preferred ??
          loadedCases[0];
        if (target) {
          try {
            loadedDetail = await caseClient.detail(target.id, signal);
          } catch {
            loadedDetail = null;
          }
        }
      }

      // 3. Read Decision Board actions + Case decision links + four foundations in parallel (pure read-only).
      const activeCasesForDecisions = loadedCases.filter(item => item.status !== 'closed');
      const [goalsRes, initiativesRes, studioRes, boardRes, caseDecisionsRes] = await Promise.allSettled([
        caseClient.strategyGoals(),
        listInitiatives(signal),
        Promise.all([listStudioEnterprises(signal), listStudioSystems(signal)]),
        readBoard(),
        Promise.allSettled(activeCasesForDecisions.map(record => readCaseActionTaskIds(record.id, signal))),
      ]);
      if (!isCurrent()) return;

      let loadedBoardActions: HomeBoardActionInput[] = [];
      let actionReadState: HomeActionReadState = 'ready';
      if (boardRes.status === 'fulfilled') {
        const taskIdsByCase = new Map<string, ReadonlySet<string>>();
        if (caseDecisionsRes.status === 'fulfilled') {
          for (const entry of caseDecisionsRes.value) {
            if (entry.status === 'fulfilled') {
              taskIdsByCase.set(entry.value.caseId, entry.value.taskIds);
            } else if (classifyHttpFailure(entry.reason).state === 'unavailable') {
              actionReadState = 'partial-unavailable';
            } else if (actionReadState === 'ready') {
              actionReadState = 'partial-forbidden';
            }
          }
        } else {
          actionReadState = 'partial-unavailable';
        }
        loadedBoardActions = extractHomeBoardActions({
          items: boardRes.value.items,
          caseDecisionTaskIdsByCase: taskIdsByCase,
        });
      } else {
        actionReadState = classifyHttpFailure(boardRes.reason).state;
      }

      let loadedGoals: StrategyGoalsIndex | null = null;
      if (goalsRes.status === 'fulfilled') {
        loadedGoals = goalsRes.value;
        const adoptedCount = loadedGoals.goals.filter(g => g.adoptedVersion !== null && g.adoptedVersion !== undefined).length;
        const totalGoals = loadedGoals.goals.length;
        nextFoundations.goals = {
          state: 'ready',
          status: adoptedCount > 0 ? '已采用' : totalGoals > 0 ? '待确认' : '未开始',
          detail: adoptedCount > 0 ? `${adoptedCount} 项已采用目标` : totalGoals > 0 ? `${totalGoals} 项候选待核对` : '尚未设定年度目标',
        };
      } else {
        const fail = classifyHttpFailure(goalsRes.reason);
        nextFoundations.goals = { state: fail.state, status: fail.state === 'forbidden' ? '无权限' : '暂不可读', detail: fail.message };
      }

      if (initiativesRes.status === 'fulfilled') {
        const items = initiativesRes.value.initiatives;
        const pubResults = items.length > 0
          ? await Promise.allSettled(items.map(item => listPublications(item.id)))
          : [];
        if (!isCurrent()) return;
        nextFoundations.strategy = summarizeStrategyFoundationSnapshot({
          initiatives: items,
          publicationChecks: pubResults.map(res => {
            if (res.status === 'fulfilled') {
              return { ok: true as const, hasActive: res.value.publications.some(pub => pub.state === 'active') };
            }
            const fail = classifyHttpFailure(res.reason);
            return { ok: false as const, state: fail.state, message: fail.message };
          }),
        });
      } else {
        const fail = classifyHttpFailure(initiativesRes.reason);
        nextFoundations.strategy = { state: fail.state, status: fail.state === 'forbidden' ? '无权限' : '暂不可读', detail: fail.message };
      }

      let resolvedEnterprises: { id: string; name: string }[] = [];
      let resolvedEnterpriseId = '';
      let resolvedEnterpriseName: string | undefined;
      let resolvedUnselected = false;

      if (studioRes.status === 'fulfilled') {
        const [directory, systems] = studioRes.value;
        resolvedEnterprises = directory.enterprises.map(e => ({ id: e.id, name: e.name }));
        const { enterprise: activeEnt, unselected } = resolveActiveStudioEnterprise({
          enterprises: resolvedEnterprises,
          selectedEnterpriseId,
          currentProjectId,
          projectAssignments: directory.projectAssignments,
        });
        resolvedUnselected = unselected;
        resolvedEnterpriseId = activeEnt?.id ?? '';
        resolvedEnterpriseName = activeEnt?.name ?? (unselected ? '待选择企业' : undefined);

        let foundationResult:
          | { ok: true; items: readonly { authority: string; status: string }[] }
          | { ok: false; state: 'forbidden' | 'unavailable'; message: string }
          | null = null;

        if (activeEnt) {
          try {
            const foundation = await readStudioFoundation(activeEnt.id, signal);
            if (!isCurrent()) return;
            foundationResult = { ok: true, items: foundation.items };
          } catch (error) {
            if (!isCurrent()) return;
            const fail = classifyHttpFailure(error);
            foundationResult = { ok: false, state: fail.state, message: fail.message };
          }
        }

        const studioSnapshots = summarizeStudioFoundationSnapshots({
          enterprise: activeEnt,
          unselected,
          systems,
          foundationResult,
        });
        nextFoundations.semantic = studioSnapshots.semantic;
        nextFoundations.analysis = studioSnapshots.analysis;
      } else {
        const fail = classifyHttpFailure(studioRes.reason);
        const label = fail.state === 'forbidden' ? '无权限' : '暂不可读';
        nextFoundations.semantic = { state: fail.state, status: label, detail: fail.message };
        nextFoundations.analysis = { state: fail.state, status: label, detail: fail.message };
      }

      if (!isCurrent()) return;
      setResult({
        request,
        data: {
          loading: false,
          caseAccessState: accessState,
          caseAccessMessage: accessMessage,
          cases: loadedCases,
          projectLinks: loadedLinks,
          focusDetail: loadedDetail,
          goals: loadedGoals,
          boardActions: loadedBoardActions,
          actionReadState,
          enterprises: resolvedEnterprises,
          activeEnterpriseId: resolvedEnterpriseId,
          enterpriseName: resolvedEnterpriseName,
          enterpriseUnselected: resolvedUnselected,
          foundations: nextFoundations,
        },
      });
      onResolvedEnterpriseNameRef.current?.(resolvedEnterpriseName);
    })();

    return () => { controller.abort(); };
  }, [request]);

  return {
    ...(result?.request === request ? result.data : PENDING_DESK),
    reload: () => setManualReload(value => value + 1),
  };
}
