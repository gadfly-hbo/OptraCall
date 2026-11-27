import { useEffect, useRef, useState } from 'react';
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
  onCasesLoaded?: (cases: CaseRecord[]) => void;
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

interface SettledDeskCache {
  enterpriseKey: string;
  caseAccessState: HomeCaseAccessState;
  caseAccessMessage?: string;
  cases: CaseRecord[];
  projectLinks: CaseProjectLink[];
  focusDetail: CaseDetail | null;
  goals: StrategyGoalsIndex | null;
  boardActions: HomeBoardActionInput[];
  enterprises: { id: string; name: string }[];
  activeEnterpriseId: string;
  enterpriseName?: string;
  enterpriseUnselected: boolean;
  foundations: Partial<Record<HomeFoundationId, HomeFoundationSnapshot>>;
}

let lastSettledDeskCache: SettledDeskCache | null = null;

export function useWorkspaceDeskData({
  active,
  refreshToken,
  preferredCaseId,
  selectedEnterpriseId,
  currentProjectId,
  onCasesLoaded,
  onResolvedEnterpriseName,
}: WorkspaceDeskDataOptions): WorkspaceDeskDataState {
  const cacheKey = `${selectedEnterpriseId ?? ''}::${currentProjectId ?? ''}`;
  const seeded = lastSettledDeskCache && lastSettledDeskCache.enterpriseKey === cacheKey ? lastSettledDeskCache : null;

  const [loading, setLoading] = useState(true);
  const [manualReload, setManualReload] = useState(0);
  const [caseAccessState, setCaseAccessState] = useState<HomeCaseAccessState>(seeded?.caseAccessState ?? 'empty');
  const [caseAccessMessage, setCaseAccessMessage] = useState<string | undefined>(seeded?.caseAccessMessage);
  const [cases, setCases] = useState<CaseRecord[]>(seeded?.cases ?? []);
  const [projectLinks, setProjectLinks] = useState<CaseProjectLink[]>(seeded?.projectLinks ?? []);
  const [focusDetail, setFocusDetail] = useState<CaseDetail | null>(seeded?.focusDetail ?? null);
  const [goals, setGoals] = useState<StrategyGoalsIndex | null>(seeded?.goals ?? null);
  const [boardActions, setBoardActions] = useState<HomeBoardActionInput[]>(seeded?.boardActions ?? []);
  const [enterprises, setEnterprises] = useState<{ id: string; name: string }[]>(seeded?.enterprises ?? []);
  const [activeEnterpriseId, setActiveEnterpriseId] = useState(seeded?.activeEnterpriseId ?? '');
  const [enterpriseName, setEnterpriseName] = useState<string | undefined>(seeded?.enterpriseName);
  const [enterpriseUnselected, setEnterpriseUnselected] = useState(seeded?.enterpriseUnselected ?? false);
  const [foundations, setFoundations] = useState<Partial<Record<HomeFoundationId, HomeFoundationSnapshot>>>(
    seeded?.foundations ?? INITIAL_LOADING_FOUNDATIONS,
  );

  const epochRef = useRef(0);
  const onCasesLoadedRef = useRef(onCasesLoaded);
  onCasesLoadedRef.current = onCasesLoaded;
  const onResolvedEnterpriseNameRef = useRef(onResolvedEnterpriseName);
  onResolvedEnterpriseNameRef.current = onResolvedEnterpriseName;

  useEffect(() => {
    if (!active) return;
    const ticket = ++epochRef.current;
    const controller = new AbortController();
    const { signal } = controller;
    setLoading(true);

    void (async () => {
      const isCurrent = () => !signal.aborted && epochRef.current === ticket;
      const nextFoundations: Partial<Record<HomeFoundationId, HomeFoundationSnapshot>> = {};

      // 1. Read Cases (read-only). Clear searchable cases immediately if unauthorized or unavailable.
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
        Promise.allSettled(activeCasesForDecisions.map(async record => ({
          caseId: record.id,
          decisions: await readCaseDecisions(record.id),
        }))),
      ]);
      if (!isCurrent()) return;

      let loadedBoardActions: HomeBoardActionInput[] = [];
      if (boardRes.status === 'fulfilled') {
        const taskIdsByCase = new Map<string, ReadonlySet<string>>();
        if (caseDecisionsRes.status === 'fulfilled') {
          for (const entry of caseDecisionsRes.value) {
            if (entry.status === 'fulfilled') {
              const ids = collectCaseActionTaskIds(entry.value.decisions.items);
              if (ids.size > 0) taskIdsByCase.set(entry.value.caseId, ids);
            }
          }
        }
        loadedBoardActions = extractHomeBoardActions({
          items: boardRes.value.items,
          projectLinks: loadedLinks,
          caseDecisionTaskIdsByCase: taskIdsByCase,
        });
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
      if (accessState === 'forbidden' || accessState === 'unavailable') {
        lastSettledDeskCache = null;
      } else {
        lastSettledDeskCache = {
          enterpriseKey: `${selectedEnterpriseId ?? ''}::${currentProjectId ?? ''}`,
          caseAccessState: accessState,
          caseAccessMessage: accessMessage,
          cases: loadedCases,
          projectLinks: loadedLinks,
          focusDetail: loadedDetail,
          goals: loadedGoals,
          boardActions: loadedBoardActions,
          enterprises: resolvedEnterprises,
          activeEnterpriseId: resolvedEnterpriseId,
          enterpriseName: resolvedEnterpriseName,
          enterpriseUnselected: resolvedUnselected,
          foundations: nextFoundations,
        };
      }
      setCaseAccessState(accessState);
      setCaseAccessMessage(accessMessage);
      setCases(loadedCases);
      setProjectLinks(loadedLinks);
      setFocusDetail(loadedDetail);
      setGoals(loadedGoals);
      setBoardActions(loadedBoardActions);
      setEnterprises(resolvedEnterprises);
      setActiveEnterpriseId(resolvedEnterpriseId);
      setEnterpriseName(resolvedEnterpriseName);
      setEnterpriseUnselected(resolvedUnselected);
      setFoundations(nextFoundations);
      onCasesLoadedRef.current?.(loadedCases);
      onResolvedEnterpriseNameRef.current?.(resolvedEnterpriseName);
      setLoading(false);
    })();

    return () => { controller.abort(); };
  }, [active, refreshToken, manualReload, preferredCaseId, selectedEnterpriseId, currentProjectId]);

  return {
    loading,
    reload: () => setManualReload(value => value + 1),
    caseAccessState,
    caseAccessMessage,
    cases,
    projectLinks,
    focusDetail,
    goals,
    boardActions,
    enterprises,
    activeEnterpriseId,
    enterpriseName,
    enterpriseUnselected,
    foundations,
  };
}
