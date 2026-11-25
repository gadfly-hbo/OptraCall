import { hasGsaCheckpoint } from '../strategy-goal-decomposition-types.ts';
import { allocatedTarget } from '../strategy-goal-allocation.ts';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { BusinessRoleOwner } from '../business-role-types.ts';
import type { GoalDraftInput, GoalRef, GoalRoleSuggestionRef, GoalScope, GoalVersion, StrategyGoalRecord } from '../strategy-goals-types.ts';
import type {
  DecompositionDraftInput,
  DecompositionCycleReviewInput,
  DecompositionThresholdConfig,
  DecompositionGapStrategy,
  DecompositionPublication,
  DecompositionPublishOperationRecord,
  DecompositionPublishPreview,
  DecompositionReserve,
  DecompositionRow,
  DecompositionTimePeriod,
  GoalWorkspaceView,
  GsaPlannedAction,
  FormalGoalSelection,
  GsaStageCheckpoint,
  ProgressEvidenceBasis,
  ReachabilityEstimate,
} from '../strategy-goal-decomposition-types.ts';
import { MAX_GOAL_ACTUAL_REPORT_CHARS } from '../strategy-goal-decomposition-types.ts';
import { checkpointPeriods, progressMetric } from '../strategy-goal-progress.ts';
import { BusinessRoleConversation } from './BusinessRoleConversation.tsx';
import { CaseDialog, CaseFormError, caseDate } from './CaseDialogs.tsx';
import { DownloadVersion } from './StrategyChoicePanel.tsx';
import * as api from './strategy-goals-client.ts';

type BusinessStage = 'plan' | 'followup' | 'review';

interface PendingPublishIntent {
  operationId: string;
  goalId: string;
  gsaPlanId: string;
  gsaPlanVersion: number;
  gsaPlanSha256: string;
  draftRevision: number;
  draftSha256: string;
  expectedActiveVersion: number | null;
  previewSha256: string;
  reason: string;
  createdAt: string;
  status: 'unknown' | 'in-flight' | 'not-committed-retryable';
  stateRevision?: number;
  lastCheckedMessage?: string;
}

interface PendingIntentReadResult {
  intent: PendingPublishIntent | null;
  storageError: string | null;
}

const PENDING_PREFIX = 'optracall.goal.pendingPublish.v1:';
const pendingKey = (goalId: string) => `${PENDING_PREFIX}${goalId}`;

const emptyActualInput = {
  checkActualVal: '', checkSourceRef: '', checkCutoffAt: '', checkSourceLabel: '', reportText: '', uploadedName: '', reuseActualId: '',
  checkBasis: { metric: '', unit: '', scope: '', periodId: '', coverage: 'unknown', maturity: 'unknown' } as ProgressEvidenceBasis,
  supplementCheck: '', checkMissingNote: '',
};

function readPendingIntent(goalId: string): PendingIntentReadResult {
  if (typeof window === 'undefined') return { intent: null, storageError: null };
  try {
    if (!window.localStorage) {
      return { intent: null, storageError: '浏览器本地存储不可用，无法核对待核发布状态；已锁定当前目标的编辑与发布，不会生成新发布编号。' };
    }
    const raw = window.localStorage.getItem(pendingKey(goalId));
    if (!raw) return { intent: null, storageError: null };
    const parsed = JSON.parse(raw) as PendingPublishIntent;
    if (
      !parsed ||
      typeof parsed.operationId !== 'string' ||
      !parsed.operationId.trim() ||
      parsed.goalId !== goalId ||
      typeof parsed.draftRevision !== 'number' ||
      typeof parsed.draftSha256 !== 'string'
    ) {
      return { intent: null, storageError: '本地待核发布缓存格式损坏，为防止失答重发，已锁定当前目标编辑与发布。请先刷新核对服务器版本状态。' };
    }
    return { intent: parsed, storageError: null };
  } catch {
    return { intent: null, storageError: '读取本地待核发布缓存失败，为防止失答重发，已锁定当前目标编辑与发布。请先检查浏览器存储权限并核对服务器状态。' };
  }
}

function writePendingIntent(intent: PendingPublishIntent): boolean {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return false;
    window.localStorage.setItem(pendingKey(intent.goalId), JSON.stringify(intent));
    return window.localStorage.getItem(pendingKey(intent.goalId)) !== null;
  } catch {
    return false;
  }
}

function clearPendingIntent(goalId: string): void {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.removeItem(pendingKey(goalId));
    }
  } catch {
    // ignore storage clear error
  }
}

function isUnknownOutcomeError(error: unknown): boolean {
  if (!(error instanceof api.StrategyGoalsRequestError)) return true;
  return error.status >= 500 || error.status === 0;
}

function buildInitialDraft(goal: GoalVersion, workspace: GoalWorkspaceView): DecompositionDraftInput {
  const plan = workspace.activeGsaPlan!;
  const existing = workspace.draft;
  if (existing && existing.gsaPlanId === plan.planId && existing.gsaPlanVersion === plan.planVersion && existing.gsaPlanSha256 === plan.contentSha256) {
    return {
      gsaPlanId: plan.planId,
      gsaPlanVersion: plan.planVersion,
      gsaPlanSha256: plan.contentSha256,
      expectedDraftRevision: existing.revision,
      estimate: structuredClone(existing.estimate),
      rows: structuredClone(existing.rows),
      reserves: structuredClone(existing.reserves),
      gapStrategies: structuredClone(existing.gapStrategies),
      views: structuredClone(existing.views),
      timePlan: structuredClone(existing.timePlan),
      notes: existing.notes,
    };
  }
  const formalVal = plan.formalTarget.value;
  const unit = plan.formalTarget.unit;
  const period = plan.formalTarget.period;
  const est = plan.preConfirmEstimate ?? {
    metricKind: plan.formalTarget.metricKind,
    unit,
    period,
    scopeDescription: goal.scope.name,
    scope: goal.scope,
    ...(goal.measurement.kind === 'quantitative' ? { sapMetric: goal.measurement.sapMetric } : {}),
    formalTargetValue: formalVal,
    estimatedValue: null,
    gapValue: null,
    basis: '',
    evidence: [],
  };
  return {
    gsaPlanId: plan.planId,
    gsaPlanVersion: plan.planVersion,
    gsaPlanSha256: plan.contentSha256,
    expectedDraftRevision: workspace.latestDraftRevision,
    estimate: structuredClone(est),
    rows: [],
    reserves: [],
    gapStrategies: [],
    views: [],
    timePlan: [],
    notes: '',
  };
}

function restoreDraft(key: string, base: DecompositionDraftInput): DecompositionDraftInput | null {
  try {
    const cached = JSON.parse(sessionStorage.getItem(key) ?? 'null') as DecompositionDraftInput | null;
    if (!cached || cached.gsaPlanId !== base.gsaPlanId || cached.gsaPlanVersion !== base.gsaPlanVersion ||
        cached.gsaPlanSha256 !== base.gsaPlanSha256 || cached.expectedDraftRevision !== base.expectedDraftRevision ||
        !cached.estimate || ![cached.rows, cached.reserves, cached.views, cached.timePlan, cached.gapStrategies].every(Array.isArray)) return null;
    return cached;
  } catch {
    return null;
  }
}

export function GoalDecompositionWorkspace({
  record,
  goal,
  onInspectCase,
  estimateDraftId,
  onOpenSwitcher,
  onOpenVersions,
  onOpenDecisions,
  onOpenHandoffs,
  onCreateNewGoal,
  onReviseGoal,
  onAdoptGoal,
  onOpenCase,
  onStartProject,
  onGoalsReload,
  onGoalDraftSuggestion,
}: {
  record: StrategyGoalRecord;
  goal: GoalVersion;
  onInspectCase?: (caseId: string) => void;
  estimateDraftId: string;
  onOpenSwitcher: () => void;
  onOpenVersions: () => void;
  onOpenDecisions: () => void;
  onOpenHandoffs: () => void;
  onCreateNewGoal: () => void;
  onReviseGoal: () => void;
  onAdoptGoal: () => void;
  onOpenCase: (goal: GoalRef & { strategy?: string }) => void;
  onStartProject: () => void;
  onGoalsReload: () => Promise<void>;
  onGoalDraftSuggestion: (draft: GoalDraftInput, source: GoalRoleSuggestionRef) => void;
}) {
  const [workspace, setWorkspace] = useState<GoalWorkspaceView | null>(null);
  const [loadingWs, setLoadingWs] = useState(true);
  const [wsError, setWsError] = useState('');
  const [notice, setNotice] = useState('');
  const [stage, setStage] = useState<BusinessStage>('plan');
  const [analysisRequest, setAnalysisRequest] = useState<{kind:'actual'|'next-cycle'; id:string} | null>(null);
  const [editingGsa, setEditingGsa] = useState(false);

  // Stage 1a: GSA Plan editor fields
  const [gsaDecision, setGsaDecision] = useState('确认总目标 G、策略 S 与上层计划 A，开始拆解');
  const [gsaConfirmedBy, setGsaConfirmedBy] = useState(goal.responsible || '负责人');
  const [plannedActions, setPlannedActions] = useState<GsaPlannedAction[]>([
    { id: 'act-1', summary: '', checkpoint: '' },
  ]);
  const [stageCheckpoints, setStageCheckpoints] = useState<GsaStageCheckpoint[]>([]);
  const [preEstimate, setPreEstimate] = useState<ReachabilityEstimate | null>(null);
  const [showEstimateAgent, setShowEstimateAgent] = useState(false);

  // Stage 1b: Editable decomposition draft + cross-conflict alignment + publish preview + durable recovery
  const [draftForm, setDraftForm] = useState<DecompositionDraftInput | null>(null);
  const [draftDirty, setDraftDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [publishReason, setPublishReason] = useState('正式发布目标拆解表');
  const [preview, setPreview] = useState<DecompositionPublishPreview | null>(null);
  const [recoveredReceipt, setRecoveredReceipt] = useState<{ operationId: string; publication: DecompositionPublication } | null>(null);
  const receiptKey = `optracall.goal.lastRecovered.v1:${record.id}`;
  useEffect(() => {
    let active = true;
    const pending = readPendingIntent(record.id);
    if (!pending.intent && !pending.storageError) {
      try {
        const ref = JSON.parse(sessionStorage.getItem(receiptKey) ?? 'null');
        if (ref && typeof ref.operationId === 'string' && Number.isSafeInteger(ref.version) && typeof ref.sha256 === 'string') {
          void api.readDecompositionPublication(record.id, ref.version).then(({ publication }) => {
            if (active && publication.snapshotSha256 === ref.sha256 && publication.operationId === ref.operationId) {
              setRecoveredReceipt({ operationId: ref.operationId, publication });
            }
          }).catch(() => { /* The exact version may no longer be readable. */ });
        }
      } catch { /* A missing tab receipt never changes a publication. */ }
    }
    return () => { active = false; };
  }, [record.id, receiptKey]);
  const [pendingIntent, setPendingIntent] = useState<PendingPublishIntent | null>(null);
  const [pendingStorageError, setPendingStorageError] = useState<string | null>(null);
  const [alignBasis, setAlignBasis] = useState('双视角负责人已核对口径并达成一致');
  const [alignBy, setAlignBy] = useState(goal.responsible || '负责人');
  const [alignValues, setAlignValues] = useState<Record<string, string>>({});

  // Stage 2: Follow-up checks & threshold & pilot Case draft
  const [threshMagnitude, setThreshMagnitude] = useState('10');
  const [threshDirection, setThreshDirection] = useState<DecompositionThresholdConfig['adverseDirection']>('below');
  const [threshUnit, setThreshUnit] = useState<DecompositionThresholdConfig['unit']>('percent');
  const [threshGranularity, setThreshGranularity] = useState<DecompositionTimePeriod['granularity']>('week');
  const [threshConsecutive, setThreshConsecutive] = useState('2');
  const [checkPubVersion, setCheckPubVersion] = useState<number | null>(null);
  const [selectedCheckPub, setSelectedCheckPub] = useState<DecompositionPublication | null>(null);
  const [checkRowId, setCheckRowId] = useState('');
  const [checkCheckpointId, setCheckCheckpointId] = useState('');
  const [checkPeriodId, setCheckPeriodId] = useState('');
  const evidenceCache = `optracall.goal.unsentActual.v1:${record.id}:${goal.version}`;
  const evidenceTarget = JSON.stringify([checkPubVersion, checkRowId, checkCheckpointId, checkPeriodId]);
  const [actualInputs, setActualInputs] = useState<Record<string, typeof emptyActualInput>>(() => {
    try { return JSON.parse(sessionStorage.getItem(evidenceCache) ?? '{}') ?? {}; } catch { return {}; }
  });
  const actualInput = {...emptyActualInput, ...actualInputs[evidenceTarget]};
  const { checkActualVal, checkSourceRef, checkCutoffAt, checkSourceLabel, checkBasis, supplementCheck, checkMissingNote, reportText, uploadedName, reuseActualId } = actualInput;
  const editActual = (patch: Partial<typeof emptyActualInput>) => setActualInputs(inputs => ({
    ...inputs, [evidenceTarget]: { ...emptyActualInput, ...inputs[evidenceTarget], ...patch },
  }));
  useEffect(() => {
    try { sessionStorage.setItem(evidenceCache, JSON.stringify(actualInputs)); } catch { /* Keep the in-memory form. */ }
  }, [evidenceCache, actualInputs]);
  const [checkStrategies, setCheckStrategies] = useState<Record<string, string>>({});
  const [pilotTitle, setPilotTitle] = useState('');
  const [pilotStrategy, setPilotStrategy] = useState('');
  const [pilotSummary, setPilotSummary] = useState('');

  // Stage 3: Cycle review
  const [reviewPeriod, setReviewPeriod] = useState('');
  const [reviewConclusions, setReviewConclusions] = useState<DecompositionCycleReviewInput['conclusions']>([]);
  const [reviewActual, setReviewActual] = useState('');
  const [reviewSourceRef, setReviewSourceRef] = useState('');
  const [reviewConcTitle, setReviewConcTitle] = useState('');
  const [conclusionEvidence, setConclusionEvidence] = useState('');
  const [conclusionScope, setConclusionScope] = useState('');
  const [reviewConcSummary, setReviewConcSummary] = useState('');
  const [reviewMature, setReviewMature] = useState(false);
  const [reviewCausal, setReviewCausal] = useState(false);
  const [reviewSameScope, setReviewSameScope] = useState(true);
  const [selectedReviewConclusions, setSelectedReviewConclusions] = useState<Record<string, string[]>>({});
  const [nextPeriod, setNextPeriod] = useState('下一周期');
  const [returnReason, setReturnReason] = useState('原战略假设与本期实绩存在差异，带原证据回战略重审');

  const draftDirtyRef = useRef(draftDirty);
  draftDirtyRef.current = draftDirty;
  const loadSeqRef = useRef(0);
  const checkPublicationSeq = useRef(0);
  const recoverySeq = useRef(0);
  const autoCheckedOperation = useRef<string | null>(null);
  const goalVersion = goal.version;
  const draftCacheKey = `optracall.goal.unsavedDraft.v1:${record.id}:${goalVersion}`;
  useEffect(() => {
    if (draftDirty && draftForm) {
      try { sessionStorage.setItem(draftCacheKey, JSON.stringify(draftForm)); } catch { /* Edits remain in memory. */ }
    }
  }, [draftDirty, draftForm, draftCacheKey]);


  const effectiveVersion = record.adoptedVersion ?? record.currentVersion;
  // Item 1: Latest candidate v2 (when v1 is adopted) is NOT historical; only superseded versions are read-only!
  const isHistoricalVersion =
    (record.adoptedVersion !== null && goal.version < record.adoptedVersion) ||
    (goal.status === 'candidate' && goal.version < record.currentVersion);
  const pendingLocked = Boolean(pendingIntent || pendingStorageError);
  const mutationsLocked = pendingLocked || isHistoricalVersion;


  const syncCheckSelectors = useCallback((pub: DecompositionPublication | null) => {
    setSelectedCheckPub(pub);
    if (!pub) {
      setCheckPubVersion(null);
      setCheckRowId('');
      setCheckCheckpointId('');
      setCheckPeriodId('');
      return;
    }
    setCheckPubVersion(pub.version);
    const defaultRow = pub.snapshot.rows[0]?.rowId ?? 'G-TOTAL';
    setCheckRowId(old => (old && (old === 'G-TOTAL' || pub.snapshot.rows.some(r => r.rowId === old)) ? old : defaultRow));
    const defaultCp = pub.snapshot.frozenCheckpoints.find(c => c.rowId === defaultRow)?.checkpointId ?? pub.snapshot.frozenCheckpoints[0]?.checkpointId ?? '';
    setCheckCheckpointId(old => (old && pub.snapshot.frozenCheckpoints.some(c => c.checkpointId === old) ? old : defaultCp));
    const defaultPeriod = pub.snapshot.timePlan[0]?.periodId ?? '';
    setCheckPeriodId(old => (old && pub.snapshot.timePlan.some(p => p.periodId === old) ? old : defaultPeriod));
  }, []);

  const loadWorkspace = useCallback(async (forceResetDraft = false) => {
    const seq = ++loadSeqRef.current;
    setLoadingWs(true);
    setWsError('');
    try {
      const ws = await api.getWorkspace(record.id, goalVersion);
      if (seq !== loadSeqRef.current) return;
      setWorkspace(ws);
      if (ws.activeGsaPlan) {
        setPlannedActions(ws.activeGsaPlan.plannedActions.length ? structuredClone(ws.activeGsaPlan.plannedActions) : [{ id: 'act-1', summary: '', checkpoint: '' }]);
        setStageCheckpoints(ws.activeGsaPlan.stageCheckpoints.length ? structuredClone(ws.activeGsaPlan.stageCheckpoints) : []);
        if (forceResetDraft || !draftDirtyRef.current) {
          const visibleGoal = ws.goal.versions.find(v => v.version === goalVersion);
          if (!visibleGoal) throw new Error('找不到所选目标准确版本。');
          const built = buildInitialDraft(visibleGoal, ws);
          const unsaved = restoreDraft(draftCacheKey, built);
          setDraftForm(unsaved ?? built);
          setDraftDirty(Boolean(unsaved));
        }
      } else if (ws.gsaDraft) {
        setPlannedActions(ws.gsaDraft.plannedActions.length ? structuredClone(ws.gsaDraft.plannedActions) : [{ id: 'act-1', summary: '', checkpoint: '' }]);
        setStageCheckpoints(ws.gsaDraft.stageCheckpoints.length ? structuredClone(ws.gsaDraft.stageCheckpoints) : []);
        setDraftForm(null);
      } else {
        setPlannedActions([{ id: 'act-1', summary: '', checkpoint: '' }]);
        setStageCheckpoints([]);
        setDraftForm(null);
      }
      if (ws.activePublication) {
        syncCheckSelectors(ws.activePublication);
      } else {
        syncCheckSelectors(null);
      }
    } catch (fault) {
      if (seq !== loadSeqRef.current) return;
      setWsError(api.goalError(fault));
    } finally {
      if (seq === loadSeqRef.current) setLoadingWs(false);
    }
  }, [record.id, goalVersion, draftCacheKey, syncCheckSelectors]);

  useEffect(() => {
    loadSeqRef.current += 1;
    setWorkspace(null);
    setDraftForm(null);
    setNotice('');
    setWsError('');
    setPreview(null);
    setEditingGsa(false);
    setDraftDirty(false);
    const read = readPendingIntent(record.id);
    setPendingIntent(read.intent);
    setPendingStorageError(read.storageError);
    setGsaConfirmedBy(goal.responsible || '负责人');
    void loadWorkspace(true);
    return () => { loadSeqRef.current++; checkPublicationSeq.current++; recoverySeq.current++; };
  }, [record.id, goalVersion, loadWorkspace, goal.responsible]);

  const handleSelectCheckPublication = async (ver: number) => {
    const seq = ++checkPublicationSeq.current;
    setCheckPubVersion(ver);
    if (workspace?.activePublication?.version === ver) {
      syncCheckSelectors(workspace.activePublication);
      setBusy(false);
      return;
    }
    setBusy(true);
    setWsError('');
    try {
      const { publication } = await api.readDecompositionPublication(record.id, ver);
      if (seq === checkPublicationSeq.current) syncCheckSelectors(publication);
    } catch (fault) {
      if (seq === checkPublicationSeq.current) setWsError(api.goalError(fault));
    } finally {
      if (seq === checkPublicationSeq.current) setBusy(false);
    }
  };

  const estimateReadSeq = useRef(0);
  const loadPreEstimate = useCallback(async () => {
    const seq = ++estimateReadSeq.current;
    try {
      const {estimateRecord} = await api.getPreConfirmEstimate(estimateDraftId, goal.version);
      if (seq !== estimateReadSeq.current) return;
      setPreEstimate(estimateRecord?.draftId === estimateDraftId && estimateRecord.goalRef?.goalId === goal.goalId &&
        estimateRecord.goalRef.version === goal.version ? estimateRecord.estimate : null);
    } catch {
      if (seq === estimateReadSeq.current) setPreEstimate(null);
    }
  }, [estimateDraftId, goal.goalId, goal.version]);

  useEffect(() => {
    setPreEstimate(null);
    void loadPreEstimate();
    return () => { estimateReadSeq.current++; };
  }, [loadPreEstimate]);

  // Conflict details extracted from validation issues (GM07)
  const crossConflicts = useMemo(() => {
    const issues = workspace?.validation?.issues ?? [];
    return issues.filter(i => i.code === 'cross_view_conflict' && i.crossCellId);
  }, [workspace?.validation]);

  useEffect(() => {
    if (!crossConflicts.length) return;
    setAlignValues(old => {
      const next = { ...old };
      for (const item of crossConflicts) {
        const cid = item.crossCellId!;
        if (next[cid] === undefined) {
          const left = (item.details?.left as { value?: number } | undefined)?.value;
          next[cid] = left !== undefined ? String(left) : '';
        }
      }
      return next;
    });
  }, [crossConflicts]);

  const activeGsaPlan = workspace?.activeGsaPlan ?? null;
  const activePub = workspace?.activePublication ?? null;
  const thresholdMetric = activePub ? progressMetric(activePub.snapshot, record.versions.find(v => v.version === activePub.snapshot.gsaPlan.goal.version)?.measurement ?? goal.measurement) : '';
  const displayedThreshold = workspace?.thresholdStreams?.find(t => t.metricId === thresholdMetric && t.periodGranularity === threshGranularity) ?? workspace?.threshold;
  useEffect(() => {
    setThreshMagnitude(displayedThreshold?.magnitudePct?.toString() ?? '');
    setThreshConsecutive(displayedThreshold?.consecutivePeriods?.toString() ?? '');
    setThreshDirection(displayedThreshold?.adverseDirection ?? 'below');
    setThreshUnit(displayedThreshold?.unit ?? 'percent');
  }, [displayedThreshold, threshGranularity, thresholdMetric]);
  const activeStageMode = !activeGsaPlan || editingGsa ? 'gsa-confirm' : 'decompose';

  const statusBadge = useMemo(() => {
    if (pendingStorageError) return { label: '本地发布缓存异常（已锁定）', tone: 'danger' };
    if (pendingIntent) return { label: '待核对发布结果', tone: 'warn' };
    if (isHistoricalVersion) return { label: `历史只读版本 v${goal.version}`, tone: 'pending' };
    if (!activeGsaPlan) return { label: '待确认总目标 GSA', tone: 'pending' };
    if (crossConflicts.length) return { label: `交叉冲突待对齐 (${crossConflicts.length})`, tone: 'danger' };
    if (activePub) return { label: `拆解正式版 v${activePub.version} 生效中`, tone: 'ok' };
    return { label: '总 GSA 已确认 · 拆解草稿中', tone: 'accent' };
  }, [pendingStorageError, pendingIntent, isHistoricalVersion, goal.version, activeGsaPlan, crossConflicts.length, activePub]);

  const estimateOwner: BusinessRoleOwner = useMemo(() => ({
    role: 'goal-draft',
    draftId: estimateDraftId,
    goalRef: {goalId:goal.goalId, version:goal.version},
    scope: goal.scope,
    analysisVariant: 'goal-estimate',
  }), [estimateDraftId, goal.goalId, goal.version, goal.scope]);

  const decompositionOwner: BusinessRoleOwner = useMemo(() => ({
    role: 'goal',
    goalId: goal.goalId,
    version: goal.version,
    analysisVariant: 'goal-decomposition',
  }), [goal.goalId, goal.version]);

  const selectedActual = analysisRequest?.kind === 'actual' && workspace?.submittedActuals?.find(a => a.actualId === analysisRequest.id);
  const selectedCycle = analysisRequest?.kind === 'next-cycle' && workspace?.nextCycleDrafts.find(d => d.draftId === analysisRequest.id);
  const analysisOwner: BusinessRoleOwner | null = selectedActual
    ? {role:'goal', goalId:record.id, version:selectedActual.goalVersion, actualId:selectedActual.actualId, analysisVariant:'goal-decomposition'}
    : selectedCycle ? {role:'goal-draft', draftId:selectedCycle.draftId, scope:selectedCycle.targetScope, nextCycleSourceGoalId:record.id} : null;

  // --- Actions ---
  const handleReconcileFormal = async (source: FormalGoalSelection) => {
    if (mutationsLocked) return;
    setBusy(true);
    setWsError('');
    setNotice('');
    try {
      const res = await api.reconcileFormal(record.id, {
        publicationId: source.publicationId,
        contentSha256: source.contentSha256,
        formalGoalId: source.formalGoal.id,
        operationId: crypto.randomUUID(),
        expectedVersion: goal.version,
      });
      setNotice(`已按正式战略发布核对并生成新版本 v${res.goal.version}（原手动版本完整保留：${res.comparison.manualValue ?? '—'} → 正式发布 ${res.comparison.publishedValue}${res.comparison.unit}）。`);
      await onGoalsReload();
      await loadWorkspace(true);
    } catch (fault) {
      setWsError(api.goalError(fault));
    } finally {
      setBusy(false);
    }
  };

  const handleConfirmGsa = async () => {
    if (mutationsLocked) return;
    const validActions = plannedActions.filter(a => a.summary.trim());
    if (!workspace) return;
    if (!validActions.length) {
      setWsError('总目标 GSA 至少需要填写一条明确的计划 A 才能确认并进入拆解。');
      return;
    }
    if (!hasGsaCheckpoint(validActions, stageCheckpoints)) {
      setWsError('请补充至少一个阶段检查点和对应的观察依据，可填写在计划 A 中或单列阶段检查点。');
      return;
    }
    setBusy(true);
    setWsError('');
    setNotice('');
    try {
      const res = await api.confirmGsaPlan(record.id, {
        operationId: crypto.randomUUID(),
        expectedGoalVersion: goal.version,
        expectedAdoptedVersion: record.adoptedVersion ?? null,
        expectedPlanVersion: workspace.latestGsaPlanVersion,
        plannedActions: validActions.map((a, idx) => ({
          id: a.id.trim() || `act-${idx + 1}`,
          summary: a.summary.trim(),
          ...(a.checkpoint?.trim() ? { checkpoint: a.checkpoint.trim() } : {}),
          ...(a.observationBasis?.trim() ? { observationBasis: a.observationBasis.trim() } : {}),
        })),
        stageCheckpoints: stageCheckpoints
          .filter(c => c.label.trim())
          .map((c, idx) => ({
            id: c.id.trim() || `stg-${idx + 1}`,
            label: c.label.trim(),
            ...(c.targetDate?.trim() ? { targetDate: c.targetDate.trim() } : {}),
            ...(c.observationBasis?.trim() ? { observationBasis: c.observationBasis.trim() } : {}),
          })),
        decision: gsaDecision.trim() || '确认总目标 GSA 计划',
        confirmedBy: gsaConfirmedBy.trim() || goal.responsible || '负责人',
        ...(preEstimate ? { preConfirmEstimate: preEstimate } : {}),
      });
      setEditingGsa(false);
      setNotice(`已确认总目标 GSA 计划 v${res.gsaPlan.planVersion}（绑定目标 v${res.goal.version}；计划 A 仅代表管理计划，不代表已授权经营行动）。`);
      await onGoalsReload();
      await loadWorkspace(true);
    } catch (fault) {
      setWsError(api.goalError(fault));
    } finally {
      setBusy(false);
    }
  };

  const handleSaveDraft = async (): Promise<{ draft: NonNullable<GoalWorkspaceView['draft']>; validation: NonNullable<GoalWorkspaceView['validation']> } | null> => {
    if (mutationsLocked) return null;
    if (!draftForm || !activeGsaPlan) return null;
    setBusy(true);
    setWsError('');
    setNotice('');
    try {
      const payload: DecompositionDraftInput = {
        ...draftForm,
        gsaPlanId: activeGsaPlan.planId,
        gsaPlanVersion: activeGsaPlan.planVersion,
        gsaPlanSha256: activeGsaPlan.contentSha256,
        expectedDraftRevision: draftForm.expectedDraftRevision,
      };
      const res = await api.saveDecompositionDraft(record.id, payload);
      try { sessionStorage.removeItem(draftCacheKey); } catch { /* Revision protects subsequent restores. */ }
      setDraftDirty(false);
      setNotice(`已保存拆解草稿 rev ${res.draft.revision}（尚未正式发布）。`);
      await loadWorkspace(true);
      return res;
    } catch (fault) {
      setWsError(api.goalError(fault));
      return null;
    } finally {
      setBusy(false);
    }
  };

  const handleAlignConflict = async () => {
    if (mutationsLocked) return;
    if (!workspace?.draft || !activeGsaPlan) return;
    const cellUpdates = crossConflicts.map(issue => ({
      crossCellId: issue.crossCellId!,
      value: Number(alignValues[issue.crossCellId!]),
    }));
    if (cellUpdates.some(u => !Number.isFinite(u.value))) {
      setWsError('请为每一项冲突交叉单元填写有效数字后再确认对齐。');
      return;
    }
    setBusy(true);
    setWsError('');
    setNotice('');
    try {
      await api.alignDecompositionCrossConflict(record.id, {
        operationId: crypto.randomUUID(),
        gsaPlanId: activeGsaPlan.planId,
        gsaPlanVersion: activeGsaPlan.planVersion,
        gsaPlanSha256: activeGsaPlan.contentSha256,
        expectedDraftRevision: workspace.draft.revision,
        alignedBy: alignBy.trim() || goal.responsible || '负责人',
        basis: alignBasis.trim() || '负责人核对交叉视角并确认对齐',
        cellUpdates,
      });
      setNotice('已完成交叉冲突人工对齐并重汇总草稿；请核对后进入只读发布预览。');
      await loadWorkspace(true);
    } catch (fault) {
      setWsError(api.goalError(fault));
    } finally {
      setBusy(false);
    }
  };

  // Item 2: Publish preview MUST be strictly read-only (ZERO writes, never auto-save dirty/missing draft!)
  const handleOpenPublishPreview = async () => {
    if (mutationsLocked) return;
    setWsError('');
    setNotice('');
    const targetDraft = workspace?.draft ?? null;
    if (!targetDraft || draftDirty) {
      setWsError('当前拆解草稿尚未保存或有未保存改动，请先点击「保存草稿」，再进入只读发布预览（预览不产生任何写入）。');
      return;
    }
    if (!activeGsaPlan) return;
    setBusy(true);
    try {
      const res = await api.previewDecompositionPublish(record.id, {
        gsaPlanId: activeGsaPlan.planId,
        gsaPlanVersion: activeGsaPlan.planVersion,
        gsaPlanSha256: activeGsaPlan.contentSha256,
        draftRevision: targetDraft.revision,
        draftSha256: targetDraft.contentSha256,
        expectedActiveVersion: workspace?.activePublicationVersion ?? null,
      });
      setPreview(res);
    } catch (fault) {
      setWsError(api.goalError(fault));
    } finally {
      setBusy(false);
    }
  };

  const handleConfirmPublish = async () => {
    if (!preview || mutationsLocked) return;
    if (!preview.ok) {
      setWsError('当前拆解预览存在阻断项，不能正式发布；请先修正草稿。');
      return;
    }
    // P0 #1: Verify current workspace has not drifted from the exact preview snapshot, and bind strictly to preview fields
    if (
      draftDirty ||
      !workspace?.draft ||
      !activeGsaPlan ||
      workspace.draft.revision !== preview.draftRevision ||
      workspace.draft.contentSha256 !== preview.draftSha256 ||
      activeGsaPlan.planId !== preview.gsaPlan.planId ||
      activeGsaPlan.planVersion !== preview.gsaPlan.planVersion ||
      activeGsaPlan.contentSha256 !== preview.gsaPlan.contentSha256 ||
      (workspace.activePublicationVersion ?? null) !== preview.expectedActiveVersion
    ) {
      setPreview(null);
      setWsError('当前草稿、总 GSA 计划或正式版状态已相对预览发生变化，请重新打开只读发布预览确认后再发布。');
      return;
    }
    const intent: PendingPublishIntent = {
      operationId: crypto.randomUUID(),
      goalId: record.id,
      gsaPlanId: preview.gsaPlan.planId,
      gsaPlanVersion: preview.gsaPlan.planVersion,
      gsaPlanSha256: preview.gsaPlan.contentSha256,
      draftRevision: preview.draftRevision,
      draftSha256: preview.draftSha256,
      expectedActiveVersion: preview.expectedActiveVersion,
      previewSha256: preview.previewSha256,
      reason: publishReason.trim() || '正式发布目标拆解表',
      createdAt: new Date().toISOString(),
      status: 'unknown',
    };
    // Spec GM08 / UI03: MUST durably persist pending intent BEFORE sending publish request; refuse if storage write fails!
    if (!writePendingIntent(intent)) {
      setWsError('本机持久化待核发布意图失败，为防止失答重发，本次未发出正式发布请求。请检查浏览器存储权限后重试。');
      return;
    }
    setRecoveredReceipt(null);
    try { sessionStorage.removeItem(receiptKey); } catch { /* Browser receipt history is optional. */ }
    setPendingIntent(intent);
    setBusy(true);
    setWsError('');
    setNotice('');
    try {
      const res = await api.publishDecomposition(record.id, {
        operationId: intent.operationId,
        gsaPlanId: intent.gsaPlanId,
        gsaPlanVersion: intent.gsaPlanVersion,
        gsaPlanSha256: intent.gsaPlanSha256,
        draftRevision: intent.draftRevision,
        draftSha256: intent.draftSha256,
        expectedActiveVersion: intent.expectedActiveVersion,
        previewSha256: intent.previewSha256,
        reason: intent.reason,
      });
      clearPendingIntent(record.id);
      setPendingIntent(null);
      setPreview(null);
      setNotice(`已正式发布目标拆解表 v${res.publication.version}（提交子目标 ${res.publication.committedGoals.length} 条，原草稿与历史版本分别保留）。`);
      await onGoalsReload();
      await loadWorkspace(true);
    } catch (fault) {
      if (isUnknownOutcomeError(fault)) {
        setPreview(null);
        setWsError('正式发布请求尚未收到确定回执（网络中断或服务异常）。已保留原发布编号并锁定编辑，正在核对服务器记录。');
      } else {
        // A rejected confirmation must return to the workspace for a fresh preview.
        setPreview(null);
        clearPendingIntent(record.id);
        setPendingIntent(null);
        setWsError(api.goalError(fault));
      }
    } finally {
      setBusy(false);
    }
  };

  const recoverPending = useCallback(async (intent: PendingPublishIntent) => {
    const seq = ++recoverySeq.current;
    setBusy(true);
    setWsError('');
    setNotice('');
    try {
      const res = await api.getDecompositionOperation(record.id, intent.operationId);
      if (seq !== recoverySeq.current || readPendingIntent(record.id).intent?.operationId !== intent.operationId) return;
      if (res.status === 'committed' && res.publication) {
        const publication = res.publication;
        setRecoveredReceipt({ operationId: intent.operationId, publication });
        try {
          sessionStorage.setItem(receiptKey, JSON.stringify({ operationId: intent.operationId, version: publication.version, sha256: publication.snapshotSha256 }));
        } catch { /* The fetched frozen receipt remains available on this screen. */ }
        clearPendingIntent(record.id);
        setPendingIntent(null);
        setNotice(`核对完成：原发布意图已落盘为拆解正式版 v${res.publication.version}，已直接恢复该版（未重复发布）。`);
        await onGoalsReload();
        await loadWorkspace(true);
      } else if (res.status === 'not-committed-retryable' && res.operation) {
        const updated: PendingPublishIntent = {
          ...intent,
          status: 'not-committed-retryable',
          stateRevision: res.operation.stateRevision,
          lastCheckedMessage: 'Host 确认原发布在落盘前中断且未提交任何版本。您可以显式按原编号重试，或放弃该意图后重新编辑。',
        };
        writePendingIntent(updated);
        setPendingIntent(updated);
      } else if (res.status === 'abandoned') {
        clearPendingIntent(record.id);
        setPendingIntent(null);
        setNotice('原未提交意图已在服务端放弃，现已恢复可编辑状态。');
        await loadWorkspace(true);
      } else {
        const updated: PendingPublishIntent = {
          ...intent,
          stateRevision: undefined,
          status: res.status === 'in-flight' ? 'in-flight' : 'unknown',
          lastCheckedMessage: res.status === 'in-flight'
            ? '原发布仍在处理中，请稍后再次只读核对；未自动重试。'
            : '尚未在 Host 查到该发布意图的完成或未提交证明，结果仍保持未知；已保留原编号，请核对本地服务后再次只读核对。',
        };
        writePendingIntent(updated);
        setPendingIntent(updated);
      }
    } catch (fault) {
      if (seq !== recoverySeq.current || readPendingIntent(record.id).intent?.operationId !== intent.operationId) return;
      const lastCheckedMessage = `只读核对暂时失败，已继续保持待核锁定状态：${api.goalError(fault)}`;
      const updated: PendingPublishIntent = { ...intent, status: 'unknown', stateRevision: undefined, lastCheckedMessage };
      writePendingIntent(updated);
      setPendingIntent(updated);
    } finally {
      if (seq === recoverySeq.current) setBusy(false);
    }
  }, [record.id, receiptKey, onGoalsReload, loadWorkspace]);

  useEffect(() => {
    if (!busy && pendingIntent && autoCheckedOperation.current !== pendingIntent.operationId) {
      autoCheckedOperation.current = pendingIntent.operationId;
      void recoverPending(pendingIntent);
    }
  }, [busy, pendingIntent, recoverPending]);

  const handleExplicitRetryPending = async () => {
    if (isHistoricalVersion) return;
    if (!pendingIntent || pendingIntent.status !== 'not-committed-retryable' || pendingIntent.stateRevision === undefined) return;
    setBusy(true);
    setWsError('');
    setNotice('');
    try {
      const res = await api.publishDecomposition(record.id, {
        operationId: pendingIntent.operationId,
        gsaPlanId: pendingIntent.gsaPlanId,
        gsaPlanVersion: pendingIntent.gsaPlanVersion,
        gsaPlanSha256: pendingIntent.gsaPlanSha256,
        draftRevision: pendingIntent.draftRevision,
        draftSha256: pendingIntent.draftSha256,
        expectedActiveVersion: pendingIntent.expectedActiveVersion,
        // Older local intents stored draftSha256 here but sent no preview fingerprint.
        ...(pendingIntent.previewSha256 !== pendingIntent.draftSha256 ? { previewSha256: pendingIntent.previewSha256 } : {}),
        reason: pendingIntent.reason,
        explicitRetry: true,
        expectedOperationStateRevision: pendingIntent.stateRevision,
      });
      clearPendingIntent(record.id);
      setPendingIntent(null);
      setNotice(`已按原意图显式重试并正式发布拆解表 v${res.publication.version}。`);
      await onGoalsReload();
      await loadWorkspace(true);
    } catch (fault) {
      if (isUnknownOutcomeError(fault)) {
        const reverted: PendingPublishIntent = {
          ...pendingIntent,
          status: 'unknown',
          stateRevision: undefined,
          lastCheckedMessage: '显式重试请求尚未收到确定回执（网络中断或服务异常）。已保留原编号，正在核对服务器记录。',
        };
        autoCheckedOperation.current = null;
        writePendingIntent(reverted);
        setPendingIntent(reverted);
        setWsError(reverted.lastCheckedMessage!);
      } else {
        setWsError(api.goalError(fault));
      }
    } finally {
      setBusy(false);
    }
  };

  const handleAbandonPending = async () => {
    if (isHistoricalVersion) return;
    if (!pendingIntent || pendingIntent.status !== 'not-committed-retryable' || pendingIntent.stateRevision === undefined) return;
    setBusy(true);
    setWsError('');
    setNotice('');
    try {
      await api.abandonDecompositionOperation(record.id, pendingIntent.operationId, pendingIntent.stateRevision);
      clearPendingIntent(record.id);
      setPendingIntent(null);
      setNotice('已放弃原未提交发布意图，现可继续编辑草稿并发起新发布。');
      await loadWorkspace(true);
    } catch (fault) {
      setWsError(api.goalError(fault));
    } finally {
      setBusy(false);
    }
  };

  // --- Stage 2: Follow-up Checks ---
  const handleSaveThreshold = async () => {
    if (mutationsLocked) return;
    setBusy(true);
    setWsError('');
    setNotice('');
    try {
      await api.setDecompositionThreshold(record.id, {
        expectedGoalVersion: goal.version,
        configured: Boolean(threshMagnitude || threshConsecutive),
        ...(threshMagnitude ? { magnitudePct: Number(threshMagnitude) } : {}),
        ...(threshConsecutive ? { consecutivePeriods: Number(threshConsecutive) } : {}),
        adverseDirection: threshDirection, unit: threshUnit,
        metricId: thresholdMetric, periodGranularity: threshGranularity,
      });
      setNotice('已保存本目标的跟进偏差阈值设置。');
      await loadWorkspace();
    } catch (fault) {
      setWsError(api.goalError(fault));
    } finally {
      setBusy(false);
    }
  };

  const loadActualReport = async (file: File) => {
    if (mutationsLocked) return;
    if (file.size > MAX_GOAL_ACTUAL_REPORT_CHARS * 4) {
      setWsError(`请截取本次检查所需的报表段落，最多 ${MAX_GOAL_ACTUAL_REPORT_CHARS} 字符。`); return;
    }
    try {
      const contents = new TextDecoder('utf-8', {fatal: true}).decode(await file.arrayBuffer());
      if (contents.includes('\0') || !contents.trim()) { setWsError('请选择含报表正文的 UTF-8 文本文件。'); return; }
      if (contents.length > MAX_GOAL_ACTUAL_REPORT_CHARS) { setWsError(`报表正文超过 ${MAX_GOAL_ACTUAL_REPORT_CHARS} 字符，请截取相关段落。`); return; }
      editActual({ reportText: contents, uploadedName: file.name,
        checkSourceRef: !checkSourceRef || checkSourceRef === uploadedName ? file.name : checkSourceRef });
      setWsError('');
    } catch { setWsError('无法读取报表，请选择 UTF-8 文本文件或直接粘贴原文。'); }
  };

  const handleRecordCheck = async () => {
    if (mutationsLocked) return;
    const targetPub = selectedCheckPub ?? activePub;
    if (!targetPub) return;
    const resolvedRowId = checkRowId || targetPub.snapshot.rows[0]?.rowId || 'G-TOTAL';
    const rowCheckpoint = resolvedRowId === 'G-TOTAL' ? undefined :
      targetPub.snapshot.frozenCheckpoints.find(c => c.rowId === resolvedRowId && c.checkpointId === checkCheckpointId);
    const periods = rowCheckpoint ? checkpointPeriods(targetPub.snapshot.timePlan, rowCheckpoint) : targetPub.snapshot.timePlan;
    const period = periods.find(p => p.periodId === checkPeriodId) ?? periods[0];
    if (!period || (resolvedRowId !== 'G-TOTAL' && !rowCheckpoint)) {
      setWsError('请选择与责任行匹配的冻结检查点和对应期间。');
      return;
    }
    if (!checkSourceRef.trim() || !checkCutoffAt.trim()) {
      setWsError('请填写实绩来源凭证引用（如报表编号/文件路径）与真实数据截至日期/时间，Host 不自动伪造凭证或截至日。');
      return;
    }
    if (reportText.length > MAX_GOAL_ACTUAL_REPORT_CHARS) {
      setWsError(`报表正文超过 ${MAX_GOAL_ACTUAL_REPORT_CHARS} 字符，请截取本次检查相关段落。`); return;
    }
    const hasManualBasis = checkBasis.metric.trim() || checkBasis.unit.trim() || checkBasis.scope.trim() ||
      checkBasis.periodId.trim() || checkBasis.coverage !== 'unknown' || checkBasis.maturity !== 'unknown';
    const actualNum = checkActualVal.trim() === '' ? null : Number(checkActualVal);
    if (actualNum !== null && !Number.isFinite(actualNum)) {
      setWsError('请输入有效的实绩数值。');
      return;
    }
    setBusy(true);
    setWsError('');
    setNotice('');
    try {
      const res = await api.submitGoalActual(record.id, {
        operationId: crypto.randomUUID(), publicationVersion: targetPub.version, rowId: resolvedRowId,
        checkpointId: rowCheckpoint?.checkpointId ?? period.checkpointId ?? period.periodId,
        actualSource: {
          ref: checkSourceRef.trim(), label: checkSourceLabel.trim() || checkSourceRef.trim(), cutoffAt: checkCutoffAt.trim(),
          ...(reportText.trim() ? {reportText} : {}),
          ...(hasManualBasis ? {basis: checkBasis} : {}),
          ...(checkMissingNote.trim() ? {coverageNote: checkMissingNote.trim()} : {}),
        },
        ...(checkMissingNote.trim() ? { missingCoverageNote: checkMissingNote.trim() } : {}),
        ...(supplementCheck ? { supplementOfCheckId: supplementCheck } : {}),
        actualPeriods: [{periodId: period.periodId, label: rowCheckpoint?.label ?? period.label, actualValue: actualNum}],
      });
      editActual(emptyActualInput);
      setAnalysisRequest({kind: 'actual', id: res.actual.actualId});
      setNotice('本次实绩已保存，请让 Agent 核对凭据与冻结计划。');
      await loadWorkspace();
    } catch (fault) {
      setWsError(api.goalError(fault));
    } finally {
      setBusy(false);
    }
  };

  const handleCheckChoice = async (
    checkId: string,
    kind: 'observe' | 'supplement' | 'create-new-draft' | 'continue-existing',
    existingCaseId?: string,
    strategy?: string,
  ) => {
    if (mutationsLocked) return;
    if (kind === 'continue-existing' && !existingCaseId) {
      setWsError('请先选择一个未关闭的已有 Case 再续接。');
      return;
    }
    setBusy(true);
    setWsError('');
    setNotice('');
    try {
      const res = await api.setCheckCaseChoice(record.id, checkId, {
        operationId: crypto.randomUUID(),
        kind,
        ...(kind === 'continue-existing' && existingCaseId ? { caseId: existingCaseId, sameIssueConfirmed: true } : {}),
        ...(strategy ? {strategy} : {}),
        ...(kind === 'create-new-draft' ? { intentId: `CASE-INTENT-${crypto.randomUUID().slice(0, 8)}`, title: `${goal.title} · ${checkId} 偏差决策草稿` } : {}),
        note:
          kind === 'observe'
            ? '负责人选择继续观察下一周期'
            : kind === 'supplement'
              ? '安排补齐缺失口径/门店数据'
              : kind === 'continue-existing'
                ? `续接已有未关闭 Case (${existingCaseId})`
                : '另建独立 Case 草稿待确认',
      });
      setNotice(
        kind === 'create-new-draft' && res.caseDraftIntent
          ? `已创建独立 Case 草稿意图 ${res.caseDraftIntent.intentId}（绑定检查 ${checkId}，未自动建案）。`
          : kind === 'continue-existing'
            ? `已记录续接已有 Case (${existingCaseId}) 跟进本轮偏差检查。`
            : '已记录负责人本轮处理选择。',
      );
      await loadWorkspace();
    } catch (fault) {
      setWsError(api.goalError(fault));
    } finally {
      setBusy(false);
    }
  };

  const handleCreatePilotCase = async () => {
    if (mutationsLocked) return;
    const strategy = goal.strategies?.length === 1 ? goal.strategies[0] : pilotStrategy;
    if (!pilotTitle.trim() || !strategy || !goal.strategies?.includes(strategy) || !pilotSummary.trim()) {
      setWsError('请选定已采用的具体策略，填写试点标题与观察依据。');
      return;
    }
    setBusy(true);
    setWsError('');
    setNotice('');
    try {
      const res = await api.createCaseDraftIntent(record.id, {
        operationId: crypto.randomUUID(),
        intentId: `PILOT-${crypto.randomUUID().slice(0, 8)}`,
        title: pilotTitle.trim(),
        goalVersion: goal.version,
        strategy,
        kind: 'proactive-pilot',
        evidenceSummary: pilotSummary.trim(),
      });
      setPilotTitle('');
      setPilotStrategy('');
      setPilotSummary('');
      setNotice(`已生成主动试点 Case 草稿意图 ${res.intent.intentId}（可在「关联决策」查看，未自动创建正式 Case）。`);
      await loadWorkspace();
    } catch (fault) {
      setWsError(api.goalError(fault));
    } finally {
      setBusy(false);
    }
  };

  // --- Stage 3: Cycle Review ---
  const buildConclusion = (): DecompositionCycleReviewInput['conclusions'][number] | null => {
    if (!reviewConcTitle.trim() || !reviewConcSummary.trim() || !conclusionEvidence.trim() || !conclusionScope.trim()) return null;
    return { id: crypto.randomUUID(), title: reviewConcTitle.trim(), summary: reviewConcSummary.trim(),
      sourceRef: conclusionEvidence.trim(), applicableScope: conclusionScope.trim(), evidenceMature: reviewMature,
      causalVerified: reviewCausal, targetScopeSameAsOriginal: reviewSameScope };
  };
  const clearConclusion = () => {
    setReviewConcTitle(''); setReviewConcSummary(''); setConclusionEvidence(''); setConclusionScope('');
    setReviewMature(false); setReviewCausal(false); setReviewSameScope(true);
  };
  const appendReviewConclusion = () => {
    const conclusion = buildConclusion();
    if (!conclusion) { setWsError('请补齐结论标题、摘要、原证据引用和适用范围。'); return; }
    setReviewConclusions(old => [...old, conclusion]);
    clearConclusion();
    setWsError('');
  };
  const handleRecordReview = async () => {
    if (mutationsLocked) return;
    const trimmed = reviewActual.trim();
    const val = trimmed === '' ? null : Number(trimmed);
    if (val !== null && !Number.isFinite(val)) {
      setWsError('请填写有效的到期最终实际值，或留空保持待补。');
      return;
    }
    const conclusion = buildConclusion();
    if ((val !== null && !reviewSourceRef.trim()) || (!conclusion && (reviewConcTitle.trim() || reviewConcSummary.trim() || conclusionEvidence.trim() || conclusionScope.trim()))) {
      setWsError('实绩需注明凭证，结论需注明标题、摘要、原证据引用和适用范围。');
      return;
    }
    setBusy(true);
    setWsError('');
    setNotice('');
    try {
      const res = await api.recordCycleReview(record.id, {
        operationId: crypto.randomUUID(),
        period: reviewPeriod || activeGsaPlan?.formalTarget.period || '',
        actualFinalValue: val,
        actualSourceRef: reviewSourceRef.trim(),
        conclusions: conclusion ? [...reviewConclusions, conclusion] : reviewConclusions,
      });
      setReviewActual(''); setReviewConclusions([]); clearConclusion();
      setNotice(
        res.review.actualFinalValue === null
          ? `已记录到期复盘（期末实绩待补，按末版已确认总 GSA ${res.review.lastEffectiveFormalTarget.value}${res.review.lastEffectiveFormalTarget.unit} 备查）。`
          : `已完成到期复盘（按末版已确认总 GSA ${res.review.lastEffectiveFormalTarget.value}${res.review.lastEffectiveFormalTarget.unit} 评估；期初 ${res.review.initialFormalTarget.value}${res.review.initialFormalTarget.unit} 仅作备忘）。`,
      );
      await loadWorkspace();
    } catch (fault) {
      setWsError(api.goalError(fault));
    } finally {
      setBusy(false);
    }
  };

  const handleNextCycleDraft = async (reviewId: string, conclusionIds: string[]) => {
    if (mutationsLocked) return;
    if (!conclusionIds.length) {
      setWsError('请先勾选至少一条复盘结论再起草下一期草案。');
      return;
    }
    setBusy(true);
    setWsError('');
    setNotice('');
    try {
      const res = await api.createNextCycleDraft(record.id, {
        operationId: crypto.randomUUID(),
        reviewId,
        nextPeriod: nextPeriod.trim() || '下一周期',
        selectedConclusionIds: conclusionIds,
      });
      setAnalysisRequest({kind: 'next-cycle', id: res.nextCycleDraft.draftId});
      setNotice(`已向 Agent 提供所选 ${conclusionIds.length} 条结论及原依据，等待起草下一期目标。`);
      await loadWorkspace();
    } catch (fault) {
      setWsError(api.goalError(fault));
    } finally {
      setBusy(false);
    }
  };

  const handleReturnToStrategy = async (reviewId: string, conclusionIds: string[]) => {
    if (mutationsLocked) return;
    if (!conclusionIds.length) {
      setWsError('请先勾选至少一条复盘结论再回送战略重审。');
      return;
    }
    setBusy(true);
    setWsError('');
    setNotice('');
    try {
      const res = await api.recordStrategyReturn(record.id, {
        operationId: crypto.randomUUID(),
        reviewId,
        reason: returnReason.trim() || '带原证据回战略重审',
        selectedConclusionIds: conclusionIds,
        evidenceRefs: [],
      });
      setNotice(`已记录回送战略讨论凭证 ${res.strategyReturn.returnId.slice(0, 8)}（带入所选 ${conclusionIds.length} 条结论与原证据，已同步至战略选择页，不覆写原战略发布）。`);
      await loadWorkspace();
    } catch (fault) {
      setWsError(api.goalError(fault));
    } finally {
      setBusy(false);
    }
  };

  // --- Draft mutation helpers ---
  const updateDraft = (updater: (prev: DecompositionDraftInput) => DecompositionDraftInput) => {
    setDraftForm(prev => (prev ? updater(prev) : prev));
    setDraftDirty(true);
  };

  const updateRow = (idx: number, patch: Partial<DecompositionRow>) => {
    updateDraft(prev => ({
      ...prev,
      rows: prev.rows.map((r, i) => (i === idx ? { ...r, ...patch } : r)),
    }));
  };

  const addRow = () => {
    if (!draftForm) return;
    const n = draftForm.rows.length + 1;
    updateDraft(prev => ({
      ...prev,
      rows: [
        ...prev.rows,
        {
          rowId: `row-${n}`,
          title: `拆解子项 ${n}`,
          outcome: `完成子项 ${n} 责任目标`,
          scope: { kind: 'department', id: `sub-scope-${n}`, name: `子范围 ${n}` },
          scopeLabel: `子范围 ${n}`,
          responsible: goal.responsible || '待明确',
          strategy: activeGsaPlan?.strategies[0] ?? '主策略',
          contributionNature: 'allocation',
          commitAsGoal: false,
          metricKind: prev.estimate.metricKind,
          targetValue: null,
          unit: prev.estimate.unit,
          basis: '人工新增拆解行',
          checkpoints: [
            { id: `cp-r${n}-1`, label: '阶段检查', date: goal.dueAt?.slice(0, 10) ?? '', targetValue: null, unit: prev.estimate.unit, status: 'planned', evidenceSource: '' },
          ],
          tracked: true,
        },
      ],
    }));
  };

  const addReserve = () => {
    if (!draftForm) return;
    const n = draftForm.reserves.length + 1;
    updateDraft(prev => ({
      ...prev,
      reserves: [
        ...prev.reserves,
        { id: `res-${n}`, purpose: '', amount: 0, unit: prev.estimate.unit, owner: goal.responsible || '', basis: '单独预留，不自动采用为子目标' },
      ],
    }));
  };

  const addGapStrategy = () => {
    if (!draftForm) return;
    const n = draftForm.gapStrategies.length + 1;
    updateDraft(prev => ({
      ...prev,
      gapStrategies: [
        ...prev.gapStrategies,
        { id: `gap-${n}`, name: `补缺策略 ${n}`, strategy: '', expectedContribution: 0, unit: prev.estimate.unit, nonOverlappingScope: '', scopeKey: `gap-scope-${n}`, basis: '', kind: 'expected-increment' },
      ],
    }));
  };

  const allocatedSum = draftForm && activeGsaPlan
    ? allocatedTarget(draftForm.rows, activeGsaPlan.formalTarget.metricKind, activeGsaPlan.formalTarget.unit) : null;

  const reserveSum = useMemo(() => {
    if (!draftForm) return 0;
    return Number(draftForm.reserves.reduce((s, r) => s + (Number.isFinite(r.amount) ? r.amount : 0), 0).toFixed(4));
  }, [draftForm]);

  const formalVal = activeGsaPlan?.formalTarget.value ?? goal.formalOrigin?.targetValue ?? null;
  const formalUnit = activeGsaPlan?.formalTarget.unit ?? goal.formalOrigin?.unit ?? '';
  const estVal = draftForm?.estimate.estimatedValue ?? null;
  const gapVal = formalVal !== null && estVal !== null ? Number((formalVal - estVal).toFixed(4)) : null;

  return (
    <div className="gm-workspace" data-goal-id={record.id}>
      {/* Confirmed A Goal Header + Effective Version Toolbar */}
      <header className="gm-goal-header">
        <div className="gm-goal-header-main">
          <div className="gm-goal-title-row">
            <h2 className="gm-goal-title">{goal.title}</h2>
            <span className={`gm-status-pill gm-status-${statusBadge.tone}`}>{statusBadge.label}</span>
          </div>
          <p className="sg-muted gm-goal-meta">
            范围：{goal.scope.name} · 负责：{goal.responsible} · 版本：v{goal.version}
            {activeGsaPlan ? ` · GSA 计划 v${activeGsaPlan.planVersion}` : ''}
            {activePub ? ` · 拆解正式版 v${activePub.version}` : ''}
            {goal.dueAt ? ` · 期限 ${goal.dueAt.slice(0, 10)}` : ''}
          </p>
        </div>
        <div className="gm-goal-header-actions">
          <button type="button" className="secondary-button" onClick={onOpenSwitcher}>切换目标</button>
          <button type="button" className="secondary-button" onClick={onOpenVersions}>版本与来源</button>
          <button type="button" className="secondary-button" onClick={onOpenDecisions}>
            关联决策{(workspace?.caseDraftIntents.length ?? 0) > 0 ? ` (${workspace!.caseDraftIntents.length})` : ''}
          </button>
          <button type="button" className="secondary-button" onClick={onOpenHandoffs}>
            执行承接 ({workspace?.handoffs.length ?? 0})
          </button>
          <button type="button" className="primary-button" onClick={onCreateNewGoal}>＋ 新建目标</button>
        </div>
      </header>

      {/* Historical Version Read-Only Banner (P1 #8) */}
      {isHistoricalVersion && (
        <aside className="gm-recovery-card" role="status" aria-label="历史只读版本提示">
          <div className="sg-row-between">
            <div>
              <strong>正在查看历史目标版本 v{goal.version}（当前有效版本为 v{effectiveVersion}）</strong>
              <p className="sg-muted">历史目标版本保持只读，已锁定本页编辑、GSA 更新与正式发布；如需修改请点击「版本与来源」切回当前有效版本。</p>
            </div>
            <button type="button" className="secondary-button" onClick={onOpenVersions}>打开版本与来源</button>
          </div>
        </aside>
      )}

      {/* Pending Storage Error Recovery Lock Banner (P0 #3) */}
      {pendingStorageError && (
        <aside className="gm-recovery-card" role="alert" aria-label="本地待核发布缓存异常锁定提示">
          <div className="sg-row-between">
            <div>
              <strong>本地待核发布缓存不可读（已锁定编辑与发布，未生成新发布编号）</strong>
              <p>{pendingStorageError}</p>
            </div>
            <div className="sg-row">
              <button
                type="button"
                className="primary-button"
                disabled={busy}
                onClick={() => {
                  const reread = readPendingIntent(record.id);
                  setPendingIntent(reread.intent);
                  setPendingStorageError(reread.storageError);
                  void loadWorkspace(true);
                }}
              >
                重新读取缓存并核对服务状态
              </button>
            </div>
          </div>
        </aside>
      )}

      {/* Formal Strategy Reconciliation Banner (GM01) */}
      {workspace?.formalReconciliation?.hasApplicableFormalPublication && (
        <aside className="gm-reconcile-banner" role="region" aria-label="正式战略发布核对提示">
          <div>
            <strong>选择要承接的正式战略目标</strong>
            <p>当前手动目标为 {workspace.formalReconciliation.manualTargetValue}{goal.formalOrigin?.unit}。核对后将保存为新版本。</p>
            {workspace.formalReconciliation.formalPublications.map(source => (
              <div key={JSON.stringify([source.publicationId, source.formalGoal.id])}>
                <p>{source.formalGoal.title} · {source.formalGoal.period} · {source.formalGoal.targetValue}{source.formalGoal.unit} · 发布 {source.publicationId.slice(0, 8)}</p>
                <button type="button" className="secondary-button" disabled={busy || mutationsLocked} onClick={() => void handleReconcileFormal(source)}>
                  按正式战略核对补挂
                </button>
              </div>
            ))}
          </div>
        </aside>
      )}

      {/* Durable Lost-Response Recovery Card (GM08 / UI03) */}
      {pendingIntent && (
        <aside className="gm-recovery-card" role="alert" aria-label="发布结果待核对恢复区">
          <div className="sg-row-between">
            <div>
              <strong>正式发布结果待核对（已锁定当前目标编辑，未暴露未确认版本）</strong>
              <p className="sg-muted">
                原发布操作编号：<code>{pendingIntent.operationId}</code> · 基线草稿 rev {pendingIntent.draftRevision}
              </p>
              <p>{pendingIntent.lastCheckedMessage || '系统正在按原操作编号核对服务器记录。'}</p>
            </div>
            <div className="sg-row">
              <button type="button" className="primary-button" disabled={busy} onClick={() => void recoverPending(pendingIntent)}>
                核对原发布结果
              </button>
              {pendingIntent.status === 'not-committed-retryable' && (
                <>
                  <button type="button" className="secondary-button" disabled={busy || isHistoricalVersion} onClick={() => void handleExplicitRetryPending()}>
                    重试原发布意图
                  </button>
                  <button type="button" className="text-button" disabled={busy || isHistoricalVersion} onClick={() => void handleAbandonPending()}>
                    放弃未提交意图
                  </button>
                </>
              )}
            </div>
          </div>
        </aside>
      )}

      {recoveredReceipt && !pendingLocked && (
        <section className="sg-panel" aria-label="原发布操作的冻结回执">
          <h3>原操作已发布拆解正式版 v{recoveredReceipt.publication.version}</h3>
          <p className="sg-muted">操作编号 {recoveredReceipt.operationId} · 目标 v{recoveredReceipt.publication.snapshot.gsaPlan.goal.version} · 总 GSA v{recoveredReceipt.publication.gsaPlanVersion}</p>
          <div className="sg-table-scroll">
            <table className="sg-table">
              <thead><tr><th>责任行</th><th>发布时的目标</th><th>目标值</th></tr></thead>
              <tbody>{recoveredReceipt.publication.snapshot.rows.map(row => (
                <tr key={row.rowId}><td>{row.rowId}</td><td>{row.title}</td><td>{row.targetValue === null ? '待定' : row.targetValue + row.unit}</td></tr>
              ))}</tbody>
            </table>
          </div>
          <DownloadVersion route={`/api/strategy/goals/${record.id}/decomposition/publications/${recoveredReceipt.publication.version}/export`} />
        </section>
      )}

      <CaseFormError error={wsError} />
      {workspace?.draftUnavailable && <p role="status">原拆解草稿的范围或引用暂不可读，请核对原授权。</p>}
      {notice && <p className="case-notice" role="status">{notice}</p>}

      {/* Confirmed A 3-Stage Business Stepper */}
      <nav className="gm-stage-tabs" aria-label="目标管理三阶段流程">
        <button type="button" aria-current={stage === 'plan' ? 'step' : undefined} onClick={() => setStage('plan')}>
          <span className="gm-step-num">1</span> 确认总目标 GSA / 拆解与发布
        </button>
        <button type="button" aria-current={stage === 'followup' ? 'step' : undefined} onClick={() => setStage('followup')}>
          <span className="gm-step-num">2</span> 阶段跟进
          {workspace?.checks.length ? <span className="gm-tab-count">{workspace.checks.length}</span> : null}
        </button>
        <button type="button" aria-current={stage === 'review' ? 'step' : undefined} onClick={() => setStage('review')}>
          <span className="gm-step-num">3</span> 到期复盘
          {workspace?.reviews.length ? <span className="gm-tab-count">{workspace.reviews.length}</span> : null}
        </button>
      </nav>

      {loadingWs && !workspace ? (
        <p className="case-message" role="status">正在加载目标工作台…</p>
      ) : null}

      {/* STAGE 1: GSA Confirmation (1a) OR Side-by-Side Decomposition & Publish (1b) */}
      {stage === 'plan' && workspace && (
        activeStageMode === 'gsa-confirm' ? (
          <section className="sg-panel gm-gsa-confirm" aria-label="确认总目标 GSA">
            <div className="sg-row-between">
              <div>
                <h3>{activeGsaPlan ? `更新总目标 GSA 计划（当前 v${activeGsaPlan.planVersion}）` : '步骤 1a · 确认总目标 G、策略 S 与计划 A'}</h3>
                <p className="sg-muted">
                  一次确认即完成总目标采用与上层 GSA 计划冻结，随后进入拆解工作台；计划 A 仅代表管理计划，不代表已授权经营行动。
                </p>
              </div>
              <div className="sg-row">
                {activeGsaPlan && (
                  <button type="button" className="text-button" onClick={() => setEditingGsa(false)}>返回拆解工作台</button>
                )}
                <button type="button" className="secondary-button" disabled={mutationsLocked} onClick={onReviseGoal}>修订基础 G/S 字段</button>
                {goal.status !== 'adopted' && (
                  <button type="button" className="text-button" disabled={mutationsLocked} onClick={onAdoptGoal}>单独采纳候选</button>
                )}
              </div>
            </div>

            <div className="gm-gsa-grid">
              <div className="gm-card">
                <strong>G · 正式目标</strong>
                <p>{goal.outcome}</p>
                <p className="sg-muted">
                  {goal.formalOrigin
                    ? `正式值：${goal.formalOrigin.targetValue}${goal.formalOrigin.unit}（${goal.formalOrigin.period} · ${goal.formalOrigin.kind === 'strategy-publication' ? '来自正式战略发布' : '手动拟定例外'}）`
                    : '沿用既有目标记录（补充计划 A 即可进入拆解）'}
                </p>
              </div>
              <div className="gm-card">
                <strong>S · 核心策略</strong>
                {goal.strategies?.length ? (
                  <ul>{goal.strategies.map((s, i) => <li key={i}>{s}</li>)}</ul>
                ) : (
                  <p className="sg-muted">尚未填写策略，可点击右上「修订基础 G/S 字段」补充。</p>
                )}
              </div>
            </div>

            <div className="gm-card gm-plan-a-editor">
              <div className="sg-row-between">
                <div>
                  <strong>A · 上层计划动作（必填至少 1 条 · 仅管理计划，非经营行动授权）</strong>
                  <p className="sg-muted">仅修改上层计划 A 确认后会生成新的 GSA 计划版（vN+1），保留原已采用目标历史。</p>
                </div>
                <button
                  type="button"
                  className="secondary-button"
                  disabled={mutationsLocked}
                  onClick={() => setPlannedActions(old => [...old, { id: `act-${old.length + 1}`, summary: '', checkpoint: '' }])}
                >
                  ＋ 添加计划 A
                </button>
              </div>
              {plannedActions.map((act, idx) => (
                <div key={idx} className="gm-inline-row">
                  <input
                    className="gm-input"
                    aria-label={`计划 A ${idx + 1} 内容`}
                    placeholder="填写明确的计划动作（例如：上线冬季礼盒与复购券包）"
                    disabled={mutationsLocked}
                    value={act.summary}
                    onChange={e => setPlannedActions(old => old.map((x, i) => (i === idx ? { ...x, summary: e.target.value } : x)))}
                  />
                  <input
                    className="gm-input gm-input-sm"
                    aria-label={`计划 A ${idx + 1} 检查点`}
                    placeholder="检查点（可选）"
                    disabled={mutationsLocked}
                    value={act.checkpoint ?? ''}
                    onChange={e => setPlannedActions(old => old.map((x, i) => (i === idx ? { ...x, checkpoint: e.target.value } : x)))}
                  />
                  <input className="gm-input" aria-label={`计划 A ${idx + 1} 观察依据`} placeholder="核对这项行动所用的观察依据"
                    disabled={mutationsLocked} value={act.observationBasis ?? ''}
                    onChange={e => setPlannedActions(old => old.map((action, i) => i === idx ? { ...action, observationBasis: e.target.value } : action))}
                  />
                  {plannedActions.length > 1 && (
                    <button type="button" className="text-button" disabled={mutationsLocked} onClick={() => setPlannedActions(old => old.filter((_, i) => i !== idx))}>移除</button>
                  )}
                </div>
              ))}
            </div>

            <div className="gm-gsa-action-editor">
              <div className="sg-row-between">
                <strong>上层阶段检查点</strong>
                <button type="button" className="secondary-button" disabled={mutationsLocked}
                  onClick={() => setStageCheckpoints(items => [...items, { id: crypto.randomUUID(), label: '' }])}>
                  添加阶段检查点
                </button>
              </div>
              {stageCheckpoints.map((point, index) => (
                <div key={point.id} className="gm-inline-row">
                  <input className="gm-input" aria-label={`阶段检查点 ${index + 1} 名称`} placeholder="检查内容"
                    disabled={mutationsLocked} value={point.label}
                    onChange={e => setStageCheckpoints(items => items.map(p => p.id === point.id ? { ...p, label: e.target.value } : p))} />
                  <input className="gm-input gm-input-sm" aria-label={`阶段检查点 ${index + 1} 日期`} type="date"
                    disabled={mutationsLocked} value={point.targetDate ?? ''}
                    onChange={e => setStageCheckpoints(items => items.map(p => p.id === point.id ? { ...p, targetDate: e.target.value } : p))} />
                  <input className="gm-input" aria-label={`阶段检查点 ${index + 1} 观察依据`} placeholder="观察依据"
                    disabled={mutationsLocked} value={point.observationBasis ?? ''}
                    onChange={e => setStageCheckpoints(items => items.map(p => p.id === point.id ? { ...p, observationBasis: e.target.value } : p))} />
                  <button type="button" className="text-button" disabled={mutationsLocked}
                    onClick={() => setStageCheckpoints(items => items.filter(p => p.id !== point.id))}>移除检查点</button>
                </div>
              ))}
            </div>

            <div className="gm-form-grid">
              <label className="case-field">
                <span>确认说明</span>
                <input className="gm-input" disabled={mutationsLocked} value={gsaDecision} onChange={e => setGsaDecision(e.target.value)} />
              </label>
              <label className="case-field">
                <span>确认人</span>
                <input className="gm-input" disabled={mutationsLocked} value={gsaConfirmedBy} onChange={e => setGsaConfirmedBy(e.target.value)} />
              </label>
            </div>

            <div className="gm-pre-estimate-box">
              <div className="sg-row-between">
                <strong>确认前可达性测算（可选 · 复用统一 Pi Agent）</strong>
                <button type="button" className="text-button" onClick={() => setShowEstimateAgent(v => !v)}>
                  {showEstimateAgent ? '收起测算对话' : '打开确认前测算 Agent'}
                </button>
              </div>
              {preEstimate && (
                <p className="sg-muted">
                  已保存测算：正式 {preEstimate.formalTargetValue}{preEstimate.unit} · 测算 {preEstimate.estimatedValue ?? '待补'}{preEstimate.unit} · 差额 {preEstimate.gapValue ?? '待核'}{preEstimate.unit}（{preEstimate.basis}）
                </p>
              )}
              {showEstimateAgent && (
                <div className="gm-agent-embed">
                  <BusinessRoleConversation
                    owner={estimateOwner}
                    readOnly={mutationsLocked}
                    showInlineTitle={false}
                    onGoalDraft={onGoalDraftSuggestion}
                    onSettled={() => void loadPreEstimate()}
                  />
                </div>
              )}
            </div>

            <div className="gm-confirm-bar">
              <button
                type="button"
                className="primary-button"
                disabled={busy || mutationsLocked || !plannedActions.some(a => a.summary.trim())}
                onClick={() => void handleConfirmGsa()}
              >
                {activeGsaPlan ? `确认更新 GSA 计划 v${activeGsaPlan.planVersion + 1}` : '确认 GSA，开始拆解'}
              </button>
              {goal.status === 'adopted' && (
                <div className="sg-row">
                  <button type="button" className="secondary-button" onClick={() => onOpenCase({ goalId: goal.goalId, version: goal.version, strategy: goal.strategies?.[0] })}>
                    从此目标创建 Case
                  </button>
                  <button type="button" className="secondary-button" onClick={onStartProject}>
                    从此目标开始项目
                  </button>
                </div>
              )}
            </div>
          </section>
        ) : (
          /* Stage 1b: Confirmed A Side-by-Side Main Workspace */
          <div className="gm-split-workspace">
            {/* LEFT COLUMN: Real Unified BusinessRoleConversation (goal-decomposition) */}
            <section className="gm-left-agent" aria-label="目标拆解 Agent 协作区">
              <div className="sg-row-between gm-pane-header">
                <div>
                  <h3>目标拆解 Agent</h3>
                  <p className="sg-muted">自动读写本目标拆解草稿与固定技能脚本；不会自行正式发布。</p>
                </div>
                <button type="button" className="text-button" disabled={mutationsLocked} onClick={() => setEditingGsa(true)}>
                  调整总 GSA / 计划 A
                </button>
              </div>
              <BusinessRoleConversation
                owner={decompositionOwner}
                readOnly={mutationsLocked}
                showInlineTitle={false}
                onGoalDraft={onGoalDraftSuggestion}
                onSettled={() => void loadWorkspace(true)}
              />
            </section>

            {/* RIGHT COLUMN: Live Decomposition Table, Conflicts, Time Plan, Preview & Publish */}
            <section className="gm-right-table" aria-label="实时拆解表与发布区">
              <div className="sg-row-between gm-pane-header">
                <div>
                  <h3>实时拆解表 {workspace.draft ? `· 草稿 rev ${workspace.draft.revision}` : '· 初始草稿'}</h3>
                  <p className="sg-muted">
                    绑定总目标 GSA 计划 v{activeGsaPlan!.planVersion} · 正式目标值、可达测算值与差额始终分别保留
                  </p>
                </div>
                <div className="sg-row">
                  <button type="button" className="text-button" disabled={busy} onClick={() => void loadWorkspace(true)}>
                    同步最新草稿
                  </button>
                  <button type="button" className="secondary-button" disabled={busy || mutationsLocked} onClick={() => void handleSaveDraft()}>
                    保存草稿
                  </button>
                  <button
                    type="button"
                    className="primary-button"
                    disabled={busy || mutationsLocked || crossConflicts.length > 0}
                    onClick={() => void handleOpenPublishPreview()}
                  >
                    核对并发布
                  </button>
                </div>
              </div>

              {/* Three Separate Metric Cards (GM03 / GM06) */}
              {draftForm && (
                <div className="gm-metric-cards">
                  <div className="gm-metric-card">
                    <span>正式目标值（固定权威）</span>
                    <strong>{formalVal ?? '—'}{formalUnit}</strong>
                    <small>{activeGsaPlan?.formalTarget.metricKind === 'amount'
                      ? `已分配 ${allocatedSum ?? '待核'} + 预留 ${reserveSum} = ${allocatedSum === null ? '待核' : Number((allocatedSum + reserveSum).toFixed(4))}${formalUnit}`
                      : activeGsaPlan?.formalTarget.metricKind === 'ratio' ? `按分子分母汇总 ${allocatedSum ?? '待核'}${formalUnit}` : '按各项成果标准核对'}</small>
                  </div>
                  <div className="gm-metric-card">
                    <span>同口径可达测算值</span>
                    <div className="gm-metric-edit">
                      <input
                        type="number"
                        step="any"
                        aria-label="同口径可达测算值"
                        className="gm-input gm-input-num"
                        disabled={mutationsLocked}
                        value={draftForm.estimate.estimatedValue ?? ''}
                        onChange={e => {
                          const v = e.target.value === '' ? null : Number(e.target.value);
                          updateDraft(prev => ({
                            ...prev,
                            estimate: {
                              ...prev.estimate,
                              estimatedValue: v,
                              gapValue: v === null ? null : Number((prev.estimate.formalTargetValue - v).toFixed(4)),
                            },
                          }));
                        }}
                      />
                      <span>{formalUnit}</span>
                    </div>
                    <small>{draftForm.estimate.basis}</small>
                  </div>
                  <div className="gm-metric-card">
                    <span>{gapVal !== null && gapVal < 0 ? '测算盈余（正式 − 测算）' : '测算缺口（正式 − 测算）'}</span>
                    <strong>{gapVal === null ? '待核' : `${gapVal > 0 ? '+' : ''}${gapVal}${formalUnit}`}</strong>
                    <small>{gapVal !== null && gapVal > 0 ? '正缺口须列不重叠补缺策略' : '无正缺口，无需强列补缺策略'}</small>
                  </div>
                </div>
              )}

              {/* GM07 Cross-View Conflict Alignment Card */}
              {crossConflicts.length > 0 && (
                <div className="gm-conflict-card" role="region" aria-label="交叉视角冲突对齐区">
                  <strong>交叉视角冲突（共 {crossConflicts.length} 项）— 已阻断正式发布</strong>
                  <p className="sg-muted">不可用预留或缺口抵消冲突，须列出各视角原值与依据并由负责人确认对齐后重汇总。</p>
                  {crossConflicts.map(issue => {
                    const left = issue.details?.left as { viewName: string; value: number; unit: string; basis: string } | undefined;
                    const right = issue.details?.right as { viewName: string; value: number; unit: string; basis: string } | undefined;
                    const cid = issue.crossCellId!;
                    return (
                      <div key={cid} className="gm-conflict-row">
                        <div>
                          <strong>{String(issue.details?.label ?? cid)}</strong>
                          <p className="sg-muted">
                            {left ? `${left.viewName}：${left.value}${left.unit}（${left.basis}）` : ''}
                            {left && right ? ' vs ' : ''}
                            {right ? `${right.viewName}：${right.value}${right.unit}（${right.basis}）` : ''}
                          </p>
                        </div>
                        <label className="gm-align-input">
                          <span>确认对齐值</span>
                          <input
                            type="number"
                            step="any"
                            aria-label={`对齐值 ${cid}`}
                            className="gm-input gm-input-num"
                            value={alignValues[cid] ?? ''}
                            onChange={e => setAlignValues(old => ({ ...old, [cid]: e.target.value }))}
                          />
                        </label>
                      </div>
                    );
                  })}
                  <div className="gm-form-grid">
                    <label className="case-field">
                      <span>对齐确认人</span>
                      <input className="gm-input" value={alignBy} onChange={e => setAlignBy(e.target.value)} />
                    </label>
                    <label className="case-field">
                      <span>对齐依据说明</span>
                      <input className="gm-input" value={alignBasis} onChange={e => setAlignBasis(e.target.value)} />
                    </label>
                  </div>
                  <button type="button" className="primary-button" disabled={busy || mutationsLocked} onClick={() => void handleAlignConflict()}>
                    人工确认对齐并重汇总
                  </button>
                </div>
              )}

              {/* Validation Issues */}
              {workspace.validation && !workspace.validation.ok && (
                <div className="gm-validation-box" role="status">
                  <strong>当前草稿存在 {workspace.validation.issues.length} 项发布校验提示（不自动平差）：</strong>
                  <ul>
                    {workspace.validation.issues.map((issue, idx) => (
                      <li key={idx}>[{issue.code}] {issue.message}</li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Allocation Rows Table */}
              {draftForm && (
                <div className="gm-section-block">
                  <div className="sg-row-between">
                    <h4>责任拆解明细 ({draftForm.rows.length})</h4>
                    <button type="button" className="secondary-button" disabled={mutationsLocked} onClick={addRow}>＋ 新增拆解行</button>
                  </div>
                  <div className="sg-table-scroll">
                    <table className="sg-table gm-decomp-table">
                      <thead>
                        <tr>
                          <th>责任范围 / 标题</th>
                          <th>正式值 ({formalUnit})</th>
                          <th>负责人</th>
                          <th>策略 S</th>
                          <th>性质 / 正式采用</th>
                          <th>操作</th>
                        </tr>
                      </thead>
                      <tbody>
                        {draftForm.rows.map((row, idx) => (
                          <tr key={row.rowId}>
                            <td>
                              <input
                                className="gm-input"
                                aria-label={`行 ${idx + 1} 范围名称`}
                                disabled={mutationsLocked}
                                value={row.scopeLabel}
                                onChange={e => updateRow(idx, { scopeLabel: e.target.value, title: e.target.value, scope: { ...row.scope, name: e.target.value } })}
                              />
                            </td>
                            <td>
                              <input
                                type="number"
                                step="any"
                                className="gm-input gm-input-num"
                                aria-label={`行 ${idx + 1} 正式值`}
                                disabled={mutationsLocked}
                                value={row.targetValue ?? ''}
                                onChange={e => updateRow(idx, { targetValue: e.target.value === '' ? null : Number(e.target.value) })}
                              />
                            </td>
                            <td>
                              <input
                                className="gm-input"
                                aria-label={`行 ${idx + 1} 负责人`}
                                disabled={mutationsLocked}
                                value={row.responsible}
                                onChange={e => updateRow(idx, { responsible: e.target.value })}
                              />
                            </td>
                            <td>
                              <input
                                className="gm-input"
                                aria-label={`行 ${idx + 1} 策略`}
                                disabled={mutationsLocked}
                                value={row.strategy}
                                onChange={e => updateRow(idx, { strategy: e.target.value })}
                              />
                            </td>
                            <td>
                              <select
                                className="sg-select"
                                aria-label={`行 ${idx + 1} 贡献性质`}
                                disabled={mutationsLocked}
                                value={row.contributionNature}
                                onChange={e => {
                                  const nature = e.target.value as DecompositionRow['contributionNature'];
                                  updateRow(idx, { contributionNature: nature, commitAsGoal: nature === 'allocation' ? row.commitAsGoal : false });
                                }}
                              >
                                <option value="allocation">正式分配行</option>
                                <option value="driver-hypothesis">驱动假设行</option>
                                <option value="aggregation">汇总参考行</option>
                                <option value="milestone">里程碑行</option>
                              </select>
                              <label className="gm-checkbox">
                                <input
                                  type="checkbox"
                                  disabled={mutationsLocked || row.contributionNature !== 'allocation'}
                                  checked={row.commitAsGoal}
                                  onChange={e => updateRow(idx, { commitAsGoal: e.target.checked })}
                                />
                                <span>提交为正式子目标</span>
                              </label>
                            </td>
                            <td>
                              {draftForm.rows.length > 1 && (
                                <button
                                  type="button"
                                  className="text-button"
                                  disabled={mutationsLocked}
                                  onClick={() => updateDraft(prev => ({ ...prev, rows: prev.rows.filter((_, i) => i !== idx) }))}
                                >
                                  删除
                                </button>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* Reserves & Gap Strategies & Time Plan */}
              {draftForm && (
                <details className="gm-collapsible" open={draftForm.reserves.length > 0 || (gapVal !== null && gapVal > 0)}>
                  <summary>
                    预留项 ({draftForm.reserves.length} · 合计 {reserveSum}{formalUnit}) · 补缺策略 ({draftForm.gapStrategies.length}) · 时间计划 ({draftForm.timePlan.length} 阶段)
                  </summary>
                  <div className="gm-section-block">
                    <div className="sg-row-between">
                      <h4>明确预留项（须写用途与责任人，不自动采用为子目标）</h4>
                      <button type="button" className="secondary-button" disabled={mutationsLocked} onClick={addReserve}>＋ 新增预留</button>
                    </div>
                    {draftForm.reserves.map((res: DecompositionReserve, idx: number) => (
                      <div key={res.id} className="gm-inline-row">
                        <input
                          className="gm-input"
                          placeholder="预留用途（必填）"
                          disabled={mutationsLocked}
                          value={res.purpose}
                          onChange={e => updateDraft(prev => ({ ...prev, reserves: prev.reserves.map((x, i) => (i === idx ? { ...x, purpose: e.target.value } : x)) }))}
                        />
                        <input
                          type="number"
                          step="any"
                          className="gm-input gm-input-num"
                          placeholder="金额"
                          disabled={mutationsLocked}
                          value={res.amount}
                          onChange={e => updateDraft(prev => ({ ...prev, reserves: prev.reserves.map((x, i) => (i === idx ? { ...x, amount: Number(e.target.value) } : x)) }))}
                        />
                        <input
                          className="gm-input gm-input-sm"
                          placeholder="责任人（必填）"
                          disabled={mutationsLocked}
                          value={res.owner}
                          onChange={e => updateDraft(prev => ({ ...prev, reserves: prev.reserves.map((x, i) => (i === idx ? { ...x, owner: e.target.value } : x)) }))}
                        />
                        <button type="button" className="text-button" disabled={mutationsLocked} onClick={() => updateDraft(prev => ({ ...prev, reserves: prev.reserves.filter((_, i) => i !== idx) }))}>删除</button>
                      </div>
                    ))}
                  </div>

                  <div className="gm-section-block">
                    <div className="sg-row-between">
                      <h4>测算缺口补足策略（预期增量，非已实现结果）</h4>
                      <button type="button" className="secondary-button" disabled={mutationsLocked} onClick={addGapStrategy}>＋ 新增补缺策略</button>
                    </div>
                    {draftForm.gapStrategies.map((g: DecompositionGapStrategy, idx: number) => (
                      <div key={g.id} className="gm-card">
                        <div className="gm-inline-row">
                          <input
                            className="gm-input"
                            aria-label={`补缺策略 ${idx + 1} 名称`}
                            placeholder="策略名称（必填）"
                            disabled={mutationsLocked}
                            value={g.name}
                            onChange={e => updateDraft(prev => ({ ...prev, gapStrategies: prev.gapStrategies.map((x, i) => (i === idx ? { ...x, name: e.target.value } : x)) }))}
                          />
                          <input
                            className="gm-input"
                            aria-label={`补缺策略 ${idx + 1} 不重叠范围`}
                            placeholder="不重叠范围说明（必填）"
                            disabled={mutationsLocked}
                            value={g.nonOverlappingScope}
                            onChange={e => {
                              const scopeText = e.target.value;
                              const normalizedKey = scopeText.trim().toLowerCase().replace(/\s+/g, '-') || `gap-scope-${idx + 1}`;
                              updateDraft(prev => ({
                                ...prev,
                                gapStrategies: prev.gapStrategies.map((x, i) => (i === idx ? { ...x, nonOverlappingScope: scopeText, scopeKey: normalizedKey } : x)),
                              }));
                            }}
                          />
                          <input
                            type="number"
                            step="any"
                            className="gm-input gm-input-num"
                            aria-label={`补缺策略 ${idx + 1} 预期贡献`}
                            placeholder="预期贡献（>0）"
                            disabled={mutationsLocked}
                            value={g.expectedContribution}
                            onChange={e => updateDraft(prev => ({ ...prev, gapStrategies: prev.gapStrategies.map((x, i) => (i === idx ? { ...x, expectedContribution: Number(e.target.value) } : x)) }))}
                          />
                          <button type="button" className="text-button" disabled={mutationsLocked} onClick={() => updateDraft(prev => ({ ...prev, gapStrategies: prev.gapStrategies.filter((_, i) => i !== idx) }))}>删除</button>
                        </div>
                        <div className="gm-inline-row">
                          <input
                            className="gm-input"
                            aria-label={`补缺策略 ${idx + 1} 具体做法`}
                            placeholder="具体补缺策略做法（必填）"
                            disabled={mutationsLocked}
                            value={g.strategy}
                            onChange={e => updateDraft(prev => ({ ...prev, gapStrategies: prev.gapStrategies.map((x, i) => (i === idx ? { ...x, strategy: e.target.value } : x)) }))}
                          />
                          <input
                            className="gm-input"
                            aria-label={`补缺策略 ${idx + 1} 测算依据`}
                            placeholder="预期贡献测算依据（必填）"
                            disabled={mutationsLocked}
                            value={g.basis}
                            onChange={e => updateDraft(prev => ({ ...prev, gapStrategies: prev.gapStrategies.map((x, i) => (i === idx ? { ...x, basis: e.target.value } : x)) }))}
                          />
                        </div>
                      </div>
                    ))}
                  </div>

                  <div className="gm-section-block">
                    <h4>时间节奏计划（支持「本期未定计划」与「观察中」）</h4>
                    <div className="sg-table-scroll">
                      <table className="sg-table">
                        <thead>
                          <tr><th>阶段</th><th>区间</th><th>计划值</th><th>状态</th></tr>
                        </thead>
                        <tbody>
                          {draftForm.timePlan.map((tp: DecompositionTimePeriod, idx: number) => (
                            <tr key={tp.periodId}>
                              <td>{tp.label}</td>
                              <td>{tp.startDate} ~ {tp.endDate}</td>
                              <td>
                                <input
                                  type="number"
                                  step="any"
                                  className="gm-input gm-input-num"
                                  disabled={mutationsLocked || tp.status === 'undecided'}
                                  value={tp.targetValue ?? ''}
                                  onChange={e => updateDraft(prev => ({ ...prev, timePlan: prev.timePlan.map((x, i) => (i === idx ? { ...x, targetValue: e.target.value === '' ? null : Number(e.target.value) } : x)) }))}
                                />
                              </td>
                              <td>
                                <select
                                  className="sg-select"
                                  disabled={mutationsLocked}
                                  value={tp.status}
                                  onChange={e => {
                                    const st = e.target.value as DecompositionTimePeriod['status'];
                                    updateDraft(prev => ({ ...prev, timePlan: prev.timePlan.map((x, i) => (i === idx ? { ...x, status: st, targetValue: st === 'undecided' ? null : (x.targetValue ?? 0) } : x)) }));
                                  }}
                                >
                                  <option value="planned">已定计划</option>
                                  <option value="undecided">本期未定计划</option>
                                  <option value="observing">观察中</option>
                                </select>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </details>
              )}
            </section>
          </div>
        )
      )}

      {/* STAGE 2: Follow-up Checks & Case Draft Intents (GM10 / GM11) */}
      {stage === 'followup' && workspace && (
        <section className="sg-panel gm-stage-panel" aria-label="阶段跟进与偏差核对">
          <div className="sg-row-between">
            <div>
              <h3>步骤 2 · 阶段跟进与偏差核对</h3>
              <p className="sg-muted">
                每次检查严格绑定当时的拆解正式版冻结计划；部分门店未出数时仅展示已出数对比，不给整体偏差百分比，也不计入连续触发。
              </p>
            </div>
            <div className="sg-row gm-threshold-bar">
              <label>检查周期<select disabled={mutationsLocked} className="sg-select" value={threshGranularity} onChange={e => setThreshGranularity(e.target.value as DecompositionTimePeriod['granularity'])}><option value="day">日</option><option value="week">周</option><option value="month">月</option></select></label>
              <label>不利方向<select disabled={mutationsLocked} className="sg-select" value={threshDirection} onChange={e => setThreshDirection(e.target.value as typeof threshDirection)}><option value="below">低于计划</option><option value="above">高于计划</option></select></label>
              <label>幅度单位<select disabled={mutationsLocked} className="sg-select" value={threshUnit} onChange={e => setThreshUnit(e.target.value as typeof threshUnit)}><option value="percent">百分比</option><option value="percentage-points">百分点</option></select></label>
              <label>单期幅度阈值
                <input disabled={mutationsLocked} type="number" className="gm-input gm-input-xs" value={threshMagnitude} onChange={e => setThreshMagnitude(e.target.value)} />
              </label>
              <label>连续期数
                <input disabled={mutationsLocked} type="number" className="gm-input gm-input-xs" value={threshConsecutive} onChange={e => setThreshConsecutive(e.target.value)} />
              </label>
              <button type="button" className="secondary-button" disabled={mutationsLocked || busy || !activePub} onClick={() => void handleSaveThreshold()}>保存阈值</button>
            </div>
          </div>

          {activePub ? (() => {
            const targetPub = selectedCheckPub ?? activePub;
            const visibleCheckpoints = checkRowId && checkRowId !== 'G-TOTAL'
              ? targetPub.snapshot.frozenCheckpoints.filter(c => c.rowId === checkRowId)
              : targetPub.snapshot.frozenCheckpoints;
            const rowCheckpoint = checkRowId === 'G-TOTAL' ? undefined : visibleCheckpoints.find(c => c.checkpointId === checkCheckpointId);
            const checkPeriods = rowCheckpoint ? checkpointPeriods(targetPub.snapshot.timePlan, rowCheckpoint) : targetPub.snapshot.timePlan;
            const selectedPeriod = checkPeriods.find(p => p.periodId === checkPeriodId) ?? checkPeriods[0];
            const targetRow = targetPub.snapshot.rows.find(r => r.rowId === checkRowId);
            const original = record.versions.find(v => v.version === targetPub.snapshot.gsaPlan.goal.version);
            const savedForPeriod = (workspace.submittedActuals ?? []).filter(actual => {
              const input = actual.input;
              return input.publicationVersion === targetPub.version && input.rowId === checkRowId &&
                input.checkpointId === (rowCheckpoint?.checkpointId ?? selectedPeriod?.checkpointId ?? selectedPeriod?.periodId) &&
                input.actualPeriods[0]?.periodId === selectedPeriod?.periodId;
            });
            const saved = savedForPeriod.find(actual => actual.actualId === reuseActualId);
            return (
            <div className="gm-card">
              <strong>按所选冻结拆解版 v{targetPub.version} 记录一次阶段检查</strong>
              <div className="gm-form-grid">
                <label className="case-field">
                  <span>选择拆解正式版</span>
                  <select
                    className="sg-select"
                    aria-label="选择拆解正式版"
                    disabled={busy}
                    value={String(checkPubVersion ?? targetPub.version)}
                    onChange={e => void handleSelectCheckPublication(Number(e.target.value))}
                  >
                    {workspace.publications.slice().reverse().map(p => (
                      <option key={p.version} value={String(p.version)}>
                        v{p.version}{workspace.activePublicationVersion === p.version ? '（当前生效）' : '（历史冻结版）'}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="case-field">
                  <span>选择责任行</span>
                  <select
                    className="sg-select"
                    aria-label="选择检查责任行"
                    value={checkRowId || targetPub.snapshot.rows[0]?.rowId || 'G-TOTAL'}
                    onChange={e => {
                      const nextRow = e.target.value;
                      setCheckRowId(nextRow);
                      const nextCps = nextRow === 'G-TOTAL'
                        ? targetPub.snapshot.frozenCheckpoints
                        : targetPub.snapshot.frozenCheckpoints.filter(c => c.rowId === nextRow);
                      setCheckCheckpointId(nextCps[0]?.checkpointId ?? targetPub.snapshot.frozenCheckpoints[0]?.checkpointId ?? '');
                    }}
                  >
                    {targetPub.snapshot.rows.map(r => (
                      <option key={r.rowId} value={r.rowId}>
                        {r.scopeLabel}（{r.rowId} · 负责 {r.responsible}）
                      </option>
                    ))}
                    <option value="G-TOTAL">总目标汇总 (G-TOTAL)</option>
                  </select>
                </label>
                {checkRowId !== 'G-TOTAL' && <label className="case-field">
                  <span>选择冻结检查点</span>
                  <select
                    className="sg-select"
                    aria-label="选择冻结检查点"
                    value={checkCheckpointId}
                    onChange={e => setCheckCheckpointId(e.target.value)}
                  >
                    {visibleCheckpoints.map(cp => (
                      <option key={cp.checkpointId} value={cp.checkpointId}>
                        {cp.label}（{cp.date} · 计划 {cp.targetValue ?? '待定'}{cp.unit}）
                      </option>
                    ))}
                  </select>
                </label>}
                <label className="case-field">
                  <span>选择冻结计划阶段</span>
                  <select className="sg-select" value={selectedPeriod?.periodId ?? ''} onChange={e => setCheckPeriodId(e.target.value)}>
                    {checkPeriods.map(tp => (
                      <option key={tp.periodId} value={tp.periodId}>
                        {tp.label}（计划 {tp.targetValue ?? '本期未定'}{tp.unit}）
                      </option>
                    ))}
                  </select>
                </label>
                {savedForPeriod.length > 0 && <div className="case-field">
                  <label>选定本期已保存的实绩
                    <select disabled={mutationsLocked} className="sg-select" aria-label="选定本期已保存的实绩" value={saved?.actualId ?? ''} onChange={e => editActual({reuseActualId:e.target.value})}>
                      <option value="">选择一份已保存的实绩</option>
                      {savedForPeriod.map(actual => <option key={actual.actualId} value={actual.actualId}>{actual.input.actualSource.ref} · 截至 {actual.input.actualSource.cutoffAt}</option>)}
                    </select>
                  </label>
                  <button type="button" className="secondary-button" disabled={mutationsLocked || !saved} onClick={() => saved && setAnalysisRequest({kind:'actual',id:saved.actualId})}>用选定实绩核对</button>
                </div>}
                <label className="case-field"><span>实绩报表原文</span>
                  <textarea disabled={mutationsLocked} className="gm-input" aria-label="实绩报表原文" value={reportText}
                    placeholder="粘贴报表或本次检查相关段落，Agent 将从原文核对数值、口径和覆盖范围。"
                    onChange={e => editActual({reportText:e.target.value})} />
                </label>
                <label className="case-field"><span>读取文本报表</span>
                  <input disabled={mutationsLocked} type="file" aria-label="读取文本报表" accept=".txt,.csv,.tsv,.md,.json,.log,text/*,application/json"
                    onChange={e => { const file = e.currentTarget.files?.[0]; e.currentTarget.value = ''; if (file) void loadActualReport(file); }} />
                </label>
                <label className="case-field">
                  <span>实绩来源凭证引用（必填）</span>
                  <input disabled={mutationsLocked}
                    className="gm-input"
                    aria-label="实绩来源凭证引用"
                    placeholder="例如：pos-2027-w02.csv 或 财务日结单号"
                    value={checkSourceRef}
                    onChange={e => editActual({ checkSourceRef: e.target.value })}
                  />
                </label>
                <label className="case-field">
                  <span>实绩数据截至日期/时间（必填）</span>
                  <input disabled={mutationsLocked}
                    className="gm-input"
                    aria-label="实绩数据截至时间"
                    placeholder="例如：2027-01-14T23:59:59Z"
                    value={checkCutoffAt}
                    onChange={e => editActual({ checkCutoffAt: e.target.value })}
                  />
                </label>
              </div>
              <details><summary>可选补充数值、口径与覆盖说明</summary>
                <div className="gm-form-grid">
                <label className="case-field">
                  <span>实绩数据来源说明</span>
                  <input disabled={mutationsLocked} className="gm-input" value={checkSourceLabel} onChange={e => editActual({ checkSourceLabel: e.target.value })} />
                </label>
                <label className="case-field">
                  <span>实绩值 ({formalUnit})</span>
                  <input disabled={mutationsLocked} type="number" step="any" className="gm-input" value={checkActualVal} onChange={e => editActual({ checkActualVal: e.target.value })} placeholder="输入实绩数值" />
                </label>
                <label className="case-field"><span>凭证中的指标定义或 SAP 版本</span>
                  <input disabled={mutationsLocked} className="gm-input" value={checkBasis.metric} placeholder={original && progressMetric(targetPub.snapshot, original.measurement)} onChange={e => editActual({ checkBasis: {...checkBasis, metric: e.target.value} })} />
                </label>
                <label className="case-field"><span>凭证单位</span><input disabled={mutationsLocked} className="gm-input" value={checkBasis.unit} placeholder={rowCheckpoint?.unit ?? selectedPeriod?.unit} onChange={e => editActual({ checkBasis: {...checkBasis, unit: e.target.value} })}/></label>
                <label className="case-field"><span>凭证所覆盖的业务范围</span><input disabled={mutationsLocked} className="gm-input" value={checkBasis.scope} placeholder={targetRow?.scopeLabel ?? targetPub.snapshot.estimate.scopeDescription} onChange={e => editActual({ checkBasis: {...checkBasis, scope: e.target.value} })}/></label>
                <label className="case-field"><span>凭证归属期间</span><input disabled={mutationsLocked} className="gm-input" value={checkBasis.periodId} placeholder={selectedPeriod?.periodId} onChange={e => editActual({ checkBasis: {...checkBasis, periodId: e.target.value} })}/></label>
                <label className="case-field"><span>凭证覆盖情况</span>
                  <select disabled={mutationsLocked} className="sg-select" value={checkBasis.coverage} onChange={e => editActual({ checkBasis: {...checkBasis, coverage: e.target.value as ProgressEvidenceBasis['coverage']} })}>
                    <option value="unknown">待核</option><option value="complete">凭证覆盖全范围</option><option value="partial">部分范围未出数</option>
                  </select>
                </label>
                <label className="case-field"><span>凭证观察窗</span>
                  <select disabled={mutationsLocked} className="sg-select" value={checkBasis.maturity} onChange={e => editActual({ checkBasis: {...checkBasis, maturity: e.target.value as ProgressEvidenceBasis['maturity']} })}>
                    <option value="unknown">待核</option><option value="closed">已结账</option><option value="open">尚未结账</option>
                  </select>
                </label>
                <label className="case-field"><span>补充哪次检查</span>
                  <select disabled={mutationsLocked} className="sg-select" value={supplementCheck} onChange={e => editActual({ supplementCheck: e.target.value })}>
                    <option value="">本次独立检查</option>
                    {workspace.checks.filter(c => c.publicationVersion === targetPub.version && c.rowId === checkRowId && c.periods[0]?.periodId === selectedPeriod?.periodId && c.checkpointId === (rowCheckpoint?.checkpointId ?? selectedPeriod?.checkpointId ?? selectedPeriod?.periodId)).map(c => <option key={c.checkId}>{c.checkId}</option>)}
                  </select>
                </label>
                </div>
              {checkBasis.coverage === 'partial' && (
                <label className="case-field">
                  <span>未出数门店/范围说明</span>
                  <input disabled={mutationsLocked} className="gm-input" placeholder="例如：华东旗舰店、苏州中心店尚未上传日结" value={checkMissingNote} onChange={e => editActual({ checkMissingNote: e.target.value })} />
                </label>
              )}
              </details>
              <button type="button" className="primary-button" disabled={busy || mutationsLocked} onClick={() => void handleRecordCheck()}>
                提交本次实绩，交 Agent 核对
              </button>
            </div>
            );
          })() : (
            <p className="sg-muted">尚未发布正式拆解表。若无需拆解表，您仍可直接在下方从已采用 G+S 发起主动试点 Case 草稿。</p>
          )}

          {/* Check History */}
          <div className="gm-section-block">
            <h4>历史阶段检查记录 ({workspace.checks.length})</h4>
            {workspace.checks.length ? (
              <ul className="sg-history">
                {workspace.checks.slice().reverse().map(chk => (
                  <li key={chk.checkId}>
                    <div className="sg-row-between">
                      <div>
                        <strong>{chk.checkId} · 拆解版 v{chk.publicationVersion} · {chk.rowId} · {chk.actualSource.label}</strong>{' '}
                        <span className={`sg-badge ${chk.trigger.triggered ? '' : 'pending'}`}>
                          {chk.overallPending
                            ? '部分未出数 · 整体偏差待补'
                            : chk.trigger.triggered
                              ? `已触发偏差提示 (${chk.trigger.type})`
                              : '未触发阈值'}
                        </span>
                      </div>
                      <span className="sg-muted">{caseDate(chk.recordedAt)}</span>
                    </div>
                    <p className="sg-muted">
                      实绩凭证：{chk.actualSource.ref}（截至 {chk.actualSource.cutoffAt}）·{' '}
                      {chk.overallPending
                        ? `整体偏差：待补（${chk.missingCoverageNote || '部分门店未出数，不自动折算整体百分比'}）`
                        : `整体绝对差额：${chk.overallAbsoluteDiff ?? '—'} · 整体偏差百分比：${chk.overallVariancePct === null ? '无法计算（计划为 0 或未定）' : `${chk.overallVariancePct}%`}`}
                    </p>
                    <p>{chk.trigger.reason}</p>
                    {chk.caseChoice ? (
                      <p className="sg-muted">已选择处理方式：{chk.caseChoice.kind}（{chk.caseChoice.note || '已记录'}）{chk.caseChoice.kind === 'continue-existing' && onInspectCase && <button disabled={mutationsLocked} type="button" className="text-button"
                        onClick={() => { if (chk.caseChoice?.kind === 'continue-existing') onInspectCase(chk.caseChoice.caseId); }}>查看原 Case</button>}</p>
                    ) : (
                      <div className="sg-row">
                        <button type="button" className="secondary-button" disabled={mutationsLocked || busy} onClick={() => void handleCheckChoice(chk.checkId, 'observe')}>继续观察</button>
                        <button type="button" className="secondary-button" disabled={mutationsLocked || busy} onClick={() => void handleCheckChoice(chk.checkId, 'supplement')}>安排补证</button>
                        {chk.caseCandidatesUnavailable && <span className="sg-muted">原 Case 暂待核对。</span>}
                        {(chk.caseCandidates ?? []).map(candidate => (
                          <button key={candidate.caseId} type="button" className="secondary-button" disabled={mutationsLocked || busy}
                            onClick={() => void handleCheckChoice(chk.checkId, 'continue-existing', candidate.caseId, candidate.strategy)}>
                            确认同一问题并续接「{candidate.title}」· {candidate.strategy}
                          </button>
                        ))}
                        {(chk.caseStrategies?.length ?? 0) > 1 && <select disabled={mutationsLocked} className="sg-select" aria-label="新 Case 采用的具体策略"
                          value={checkStrategies[chk.checkId] ?? ''} onChange={e => setCheckStrategies(old => ({...old, [chk.checkId]: e.target.value}))}>
                          <option value="">选择具体策略</option>
                          {chk.caseStrategies?.map(strategy => <option key={strategy}>{strategy}</option>)}
                        </select>}
                        <button type="button" className="primary-button" disabled={mutationsLocked || busy || (chk.caseStrategies?.length ?? 0) > 1 && !checkStrategies[chk.checkId]}
                          onClick={() => void handleCheckChoice(chk.checkId, 'create-new-draft', undefined, checkStrategies[chk.checkId])}>另建独立 Case 草稿</button>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="sg-muted">尚无阶段检查记录。</p>
            )}
          </div>

          {/* Proactive Pilot Case Draft (works even without decomposition table!) */}
          <div className="gm-card">
            <strong>主动试点 Case 草稿（无拆解表也可从已采用 G+S 发起）</strong>
            <div className="gm-form-grid">
              {(goal.strategies?.length ?? 0) > 1 && <label className="case-field"><span>试点采用的具体策略</span>
                <select disabled={mutationsLocked} className="sg-select" value={pilotStrategy} onChange={e => setPilotStrategy(e.target.value)}>
                  <option value="">选择已采用的策略</option>
                  {goal.strategies?.map(strategy => <option key={strategy}>{strategy}</option>)}
                </select>
              </label>}
              <label className="case-field">
                <span>试点 Case 标题</span>
                <input disabled={mutationsLocked} className="gm-input" placeholder="例如：核心门店老客复购策略试点" value={pilotTitle} onChange={e => setPilotTitle(e.target.value)} />
              </label>
              <label className="case-field">
                <span>背景与观察依据</span>
                <input disabled={mutationsLocked} className="gm-input" placeholder="说明拟验证的策略假设与观察范围" value={pilotSummary} onChange={e => setPilotSummary(e.target.value)} />
              </label>
            </div>
            <button type="button" className="secondary-button" disabled={mutationsLocked || busy || goal.status !== 'adopted'} onClick={() => void handleCreatePilotCase()}>
              生成主动试点 Case 草稿意图
            </button>
          </div>
        </section>
      )}

      {/* STAGE 3: Cycle Review, Next Cycle Draft & Strategy Return (GM12) */}
      {stage === 'review' && workspace && (
        <section className="sg-panel gm-stage-panel" aria-label="到期复盘与下期起草">
          <h3>步骤 3 · 到期复盘</h3>
          <p className="sg-muted">
            严格以本周期最后生效的已确认总目标 GSA 评估完成情况（期初目标仅作备忘），完整保留历史阶段检查；空白实绩保持待补，不自动记为 0；由负责人勾选结论子集起草下期或回送战略。
          </p>

          <div className="gm-card">
            <strong>记录本周期到期复盘</strong>
            <div className="gm-form-grid">
              <label className="case-field">
                <span>复盘期间</span><select disabled={mutationsLocked} className="sg-select" value={reviewPeriod || activeGsaPlan?.formalTarget.period || ''} onChange={e => setReviewPeriod(e.target.value)}>{[...new Set(workspace.gsaPlans.map(p => p.formalTarget.period))].map(period => <option key={period}>{period}</option>)}</select>
              </label>
              <label className="case-field"><span>最终实绩值 ({workspace.gsaPlans.filter(p => p.formalTarget.period === (reviewPeriod || activeGsaPlan?.formalTarget.period)).at(-1)?.formalTarget.unit}，留空则记为待补)</span>
                <input disabled={mutationsLocked} type="number" step="any" className="gm-input" value={reviewActual} onChange={e => setReviewActual(e.target.value)} placeholder="输入周期结账最终实绩（留空保持待补）" />
              </label>
              <label className="case-field">
                <span>最终实绩来源凭证</span>
                <input disabled={mutationsLocked} className="gm-input" value={reviewSourceRef} onChange={e => setReviewSourceRef(e.target.value)} />
              </label>
              <label className="case-field">
                <span>策略复盘结论标题</span>
                <input disabled={mutationsLocked} className="gm-input" value={reviewConcTitle} onChange={e => setReviewConcTitle(e.target.value)} />
              </label>
              <label className="case-field"><span>结论的原证据引用与版本</span><input disabled={mutationsLocked} className="gm-input" value={conclusionEvidence} onChange={e => setConclusionEvidence(e.target.value)} /></label>
              <label className="case-field"><span>结论适用范围</span><input disabled={mutationsLocked} className="gm-input" value={conclusionScope} onChange={e => setConclusionScope(e.target.value)} /></label>
              <label className="case-field">
                <span>证据与复盘摘要</span>
                <input disabled={mutationsLocked} className="gm-input" value={reviewConcSummary} onChange={e => setReviewConcSummary(e.target.value)} placeholder="说明证据成熟度、因果验证与适用范围" />
              </label>
            </div>
            <div className="sg-row">
              <label className="gm-checkbox"><input disabled={mutationsLocked} type="checkbox" checked={reviewMature} onChange={e => setReviewMature(e.target.checked)} /><span>证据已成熟</span></label>
              <label className="gm-checkbox"><input disabled={mutationsLocked} type="checkbox" checked={reviewCausal} onChange={e => setReviewCausal(e.target.checked)} /><span>因果机制已核验</span></label>
              <label className="gm-checkbox"><input disabled={mutationsLocked} type="checkbox" checked={reviewSameScope} onChange={e => setReviewSameScope(e.target.checked)} /><span>下期适用范围与本期一致</span></label>
            </div>
            <button disabled={mutationsLocked} type="button" className="secondary-button" onClick={appendReviewConclusion}>加入本次复盘结论</button>
            {reviewConclusions.length > 0 && <ul>{reviewConclusions.map(c => <li key={c.id}>{c.title} · {c.sourceRef} · {c.applicableScope} <button disabled={mutationsLocked} className="text-button" onClick={() => setReviewConclusions(rows => rows.filter(row => row.id !== c.id))}>移除</button></li>)}</ul>}
            <button type="button" className="primary-button" disabled={busy || mutationsLocked || !workspace.gsaPlans.length} onClick={() => void handleRecordReview()}>
              保存到期复盘记录
            </button>
          </div>

          <div className="gm-section-block">
            <h4>已保存复盘记录 ({workspace.reviews.length})</h4>
            {workspace.reviews.length ? (
              <ul className="sg-history">
                {workspace.reviews.slice().reverse().map(rev => {
                  const chosenIds = selectedReviewConclusions[rev.reviewId] ?? [];
                  const toggleConclusion = (cid: string, checked: boolean) => {
                    setSelectedReviewConclusions(old => {
                      const prev = old[rev.reviewId] ?? [];
                      const next = checked ? [...new Set([...prev, cid])] : prev.filter(x => x !== cid);
                      return { ...old, [rev.reviewId]: next };
                    });
                  };
                  return (
                  <li key={rev.reviewId}>
                    <div className="sg-row-between">
                      <strong>
                        {rev.period} 复盘 · 末版已确认 GSA 目标 {rev.lastEffectiveFormalTarget.value}{rev.lastEffectiveFormalTarget.unit} vs 实绩{' '}
                        {rev.actualFinalValue === null ? '待补' : `${rev.actualFinalValue}${rev.lastEffectiveFormalTarget.unit}`}
                        （差额 {rev.varianceValue === null ? '待补' : `${rev.varianceValue >= 0 ? '+' : ''}${rev.varianceValue}`}）
                      </strong>
                      <span className="sg-muted">期初备忘：{rev.initialFormalTarget.value}{rev.initialFormalTarget.unit}</span>
                    </div>
                    <p>{rev.outcomeSummary}</p>
                    <ul>
                      {rev.conclusions.map(c => (
                        <li key={c.id}>
                          <label className="gm-checkbox">
                            <input disabled={mutationsLocked}
                              type="checkbox"
                              checked={chosenIds.includes(c.id)}
                              onChange={e => toggleConclusion(c.id, e.target.checked)}
                            />
                            <span>
                              <strong>{c.title}</strong> — <span className={`sg-badge ${c.classification === 'confirmed-evidence' ? '' : 'pending'}`}>
                                {c.classification === 'confirmed-evidence' ? '已核验结论' : '待验证假设'}
                              </span> · {c.summary}
                            </span>
                          </label>
                        </li>
                      ))}
                    </ul>
                    <div className="gm-inline-row">
                      <input disabled={mutationsLocked} className="gm-input gm-input-sm" value={nextPeriod} onChange={e => setNextPeriod(e.target.value)} placeholder="下期周期名称" />
                      <button type="button" className="secondary-button" disabled={busy || mutationsLocked || !chosenIds.length} onClick={() => void handleNextCycleDraft(rev.reviewId, chosenIds)}>
                        交 Agent 按所选结论起草（{chosenIds.length}/{rev.conclusions.length}）
                      </button>
                      <input disabled={mutationsLocked} className="gm-input" value={returnReason} onChange={e => setReturnReason(e.target.value)} placeholder="回送战略重审说明" />
                      <button type="button" className="text-button" disabled={busy || mutationsLocked || !chosenIds.length} onClick={() => void handleReturnToStrategy(rev.reviewId, chosenIds)}>
                        回送所选原证据重审战略
                      </button>
                    </div>
                  </li>
                  );
                })}
              </ul>
            ) : (
              <p className="sg-muted">尚无到期复盘记录。</p>
            )}
          </div>
        </section>
      )}

      {stage === 'followup' && workspace?.submittedActuals?.map(actual => {
        const checked = workspace.checks.find(c => c.operationId === actual.actualId);
        return <p key={actual.actualId}><button disabled={mutationsLocked} className="text-button" onClick={() => setAnalysisRequest({kind:'actual', id:actual.actualId})}>
          {actual.input.actualSource.label} · {checked ? '查看 Agent 核对' : '待 Agent 核对'}
        </button>{checked?.assessmentNote}</p>;
      })}
      {stage === 'review' && workspace?.nextCycleDrafts.map(draft => <p key={draft.draftId}>
        <button disabled={mutationsLocked} className="text-button" onClick={() => setAnalysisRequest({kind:'next-cycle', id:draft.draftId})}>
          {draft.nextPeriod} · 查看起草对话
        </button></p>)}
      {analysisOwner && <CaseDialog active title={selectedActual ? 'Agent 核对实绩' : 'Agent 起草下一期目标'} busy={false}
        onClose={() => setAnalysisRequest(null)}>
        {selectedActual && <details><summary>查看本次原始实绩</summary>
          <p>{selectedActual.input.actualSource.ref} · 截至 {selectedActual.input.actualSource.cutoffAt}</p>
          {selectedActual.input.actualSource.reportText && <pre>{selectedActual.input.actualSource.reportText}</pre>}
        </details>}
        <BusinessRoleConversation owner={analysisOwner} readOnly={mutationsLocked} showInlineTitle={false}
          openingPrompt={selectedActual ? '请对照这份实绩和冻结计划，核验指标、单位、范围、期间及观察成熟度。请用 goal-assess-actual 保存这一次核对的结论和依据。' :
            '请按负责人选定的复盘结论、原证据和适用范围，用 propose-goal 起草下一期可编辑目标。保留尚待验证的假设。'}
          onSettled={() => void loadWorkspace(true)} onGoalDraft={selectedCycle ? onGoalDraftSuggestion : undefined} />
      </CaseDialog>}

      {/* Read-Only Publish Preview Modal (GM06 / UI03) */}
      {preview && (
        <CaseDialog
          active={Boolean(preview)}
          title={`核对并发布目标拆解表 v${preview.nextPublicationVersion}`}
          subtitle="本窗口为只读发布预览（零写入）。确认后将原子提交冻结拆解正式版及所选正式子目标与关系；不自动建 Case、项目或授权行动。"
          className="sg-dialog gm-aux-dialog"
          busy={busy}
          onClose={() => setPreview(null)}
        >
          {!preview.ok && (
            <div className="gm-validation-box">
              <strong>存在阻断项，当前不能确认发布：</strong>
              <ul>
                {preview.validation.issues.map((i, idx) => <li key={idx}>[{i.code}] {i.message}</li>)}
              </ul>
            </div>
          )}
          <dl className="sg-details">
            <dt>正式目标值</dt><dd>{preview.summary.formalTargetValue}{formalUnit}</dd>
            <dt>分配核对</dt><dd>{preview.gsaPlan.formalTarget.metricKind === 'amount'
              ? `已分配 ${preview.summary.allocatedTotal ?? '待核'} + 预留 ${preview.summary.reserveTotal}${formalUnit}`
              : preview.gsaPlan.formalTarget.metricKind === 'ratio' ? `按分子分母汇总 ${preview.summary.allocatedTotal ?? '待核'}${formalUnit}` : '按各项成果标准核对'}</dd>
            <dt>可达测算 / 差额</dt><dd>{preview.summary.estimatedValue ?? '部分待补'}{formalUnit} / 差额 {preview.summary.gapValue ?? '待核'}{formalUnit}</dd>
            <dt>将正式采用子目标</dt><dd>{preview.committedGoals.length} 条（{preview.committedGoals.map(g => `${g.title} ${g.targetValue ?? '待定'}${g.unit}`).join('、') || '无'}）</dd>
            <dt>非目标行/预留</dt><dd>仅记录，不自动采用为子目标（预留合计 {preview.summary.reserveTotal}{formalUnit}）</dd>
            <dt>将冻结行级检查点</dt><dd>{preview.committedGoals.reduce((sum, g) => sum + g.checkpoints.length, 0)} 个</dd>
            <dt>草稿内容指纹</dt><dd><code>{preview.draftSha256.slice(0, 16)}</code></dd>
          </dl>
          {preview.committedGoals.length > 0 && <details>
            <summary>核对正式承诺行与贡献关系</summary>
            <ul>{preview.committedGoals.map(row => <li key={row.rowId}>
              <strong>{row.title}</strong> · {row.scope.name} · {row.responsible}
              <p>策略：{row.strategy} · 结果：{row.outcome}</p>
              {row.linkedGoalId && <p>关联目标 {row.linkedGoalId} · 最新 v{row.expectedGoalVersion} · 已采用 {row.expectedAdoptedVersion ? `v${row.expectedAdoptedVersion}` : '待采用'}</p>}
              {row.relations.map(rel => <p key={rel.id}>贡献关系 {rel.id} v{rel.revision} · {rel.responsibility} · {rel.rationale}</p>)}
              {row.checkpoints.map(cp => <p key={cp.id}>{cp.label} · {cp.date} · {cp.targetValue ?? '待定'}{cp.unit}</p>)}
            </li>)}</ul>
          </details>}
          <label className="case-field">
            <span>发布说明</span>
            <input className="gm-input" value={publishReason} onChange={e => setPublishReason(e.target.value)} />
          </label>
          <div className="case-dialog-actions">
            <button type="button" className="secondary-button" disabled={busy} onClick={() => setPreview(null)}>返回修改草稿</button>
            <button
              type="button"
              className="primary-button"
              disabled={busy || !preview.ok || mutationsLocked}
              onClick={() => void handleConfirmPublish()}
            >
              {busy ? '正在发布…' : `确认发布 v${preview.nextPublicationVersion}`}
            </button>
          </div>
        </CaseDialog>
      )}
    </div>
  );
}
