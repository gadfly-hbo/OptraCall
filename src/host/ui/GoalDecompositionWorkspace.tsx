import { GoalFigures, GoalPlanSheet, GoalSource, GsaWorksheet } from './GoalJourneyViews.tsx';
import { goalDraftChanges } from './goal-draft-changes.ts';
import { resolveUpstreamCarryover, savedUpstreamMergeDraft } from './goal-upstream-carryover.ts';
import { GoalReviewDraft } from './GoalReviewDraft.tsx';
import { GoalPlanAssistance } from './GoalPlanAssistance.tsx';
import { hasGsaCheckpoint } from '../strategy-goal-decomposition-types.ts';
import { allocatedTarget } from '../strategy-goal-allocation.ts';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { BusinessRoleOwner } from '../business-role-types.ts';
import type { GoalDraftInput, GoalRef, GoalRoleSuggestionRef, GoalScope, GoalVersion, StrategyGoalRecord } from '../strategy-goals-types.ts';
import type {
  DecompositionDraftInput,
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
  GsaPlanVersion,
  GsaPlanConfirmInput,
  ProgressEvidenceBasis,
  ReachabilityEstimate,
} from '../strategy-goal-decomposition-types.ts';
import { MAX_GOAL_ACTUAL_REPORT_CHARS } from '../strategy-goal-decomposition-types.ts';
import { checkpointPeriods, comparabilityLabel, granularityLabel, progressMetric } from '../strategy-goal-progress.ts';
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
  checkActualVal: '', checkSourceRef: '', checkCutoffAt: '', checkSourceLabel: '', reportText: '', uploadedName: '',
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
        cached.gsaPlanSha256 !== base.gsaPlanSha256 || !cached.estimate || ![cached.rows, cached.reserves, cached.views, cached.timePlan, cached.gapStrategies].every(Array.isArray)) return null;
    return cached;
  } catch {
    return null;
  }
}

function readPendingGsa(goalId:string):{input:GsaPlanConfirmInput|null;error:string|null}{
  try{
    const raw=localStorage.getItem('optracall.goal.pendingGsa.v1:'+goalId);
    if(!raw)return {input:null,error:null};
    const saved=JSON.parse(raw);
    if(saved.goalId!==goalId||typeof saved.input?.operationId!=='string'||!Number.isSafeInteger(saved.input.expectedGoalVersion)||!Array.isArray(saved.input.plannedActions))throw Error('invalid');
    return {input:saved.input,error:null};
  }catch{return {input:null,error:'原 GSA 确认缓存暂不可读，请先恢复浏览器存储并核对原操作。'};}
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
  managementTools,
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
  managementTools?: import('react').ReactNode;
  onReviseGoal: () => void;
  onAdoptGoal: () => void;
  onOpenCase: (goal: GoalRef & { strategy?: string }) => void;
  onStartProject: () => void;
  onGoalsReload: (target?:GoalRef) => Promise<void>;
  onGoalDraftSuggestion: (draft: GoalDraftInput, source: GoalRoleSuggestionRef) => void;
}) {
  const [workspace, setWorkspace] = useState<GoalWorkspaceView | null>(null);
  const [loadingWs, setLoadingWs] = useState(true);
  const [wsError, setWsError] = useState('');
  const [notice, setNotice] = useState('');
  useEffect(()=>{if(!notice)return;const timeout=setTimeout(()=>setNotice(''),6500);return()=>clearTimeout(timeout);},[notice]);
  const [stage, setStage] = useState<BusinessStage>(()=>{try{const saved=sessionStorage.getItem('optracall.goal.stage:'+record.id);return saved==='followup'||saved==='review'?saved:'plan';}catch{return 'plan';}});
  useEffect(()=>{try{sessionStorage.setItem('optracall.goal.stage:'+record.id,stage);}catch{}},[record.id,stage]);
  const [analysisDialogOpen,setAnalysisDialogOpen]=useState(false);
  const [analysisRunning,setAnalysisRunning]=useState(false);
  const [analysisTurn,setAnalysisTurn]=useState<{kind:'actual'|'next-cycle';ownerId:string;request:import('./BusinessRoleConversation.tsx').BusinessRoleRequest}>();
  const [analysisRequest, setAnalysisRequest] = useState<{kind:'actual'|'next-cycle'; id:string} | null>(null);
  const [editingGsa, setEditingGsa] = useState(false);
  const [editingDecomposition,setEditingDecomposition]=useState(false);
  const [editPart,setEditPart]=useState<'rows'|'details'|'estimate'|null>(null);
  const agentPane=useRef<HTMLElement>(null), resultPane=useRef<HTMLElement>(null);
  const gsaBeforeEdit=useRef<{actions:GsaPlannedAction[];points:GsaStageCheckpoint[];reason:string;confirmedBy:string;decision:string}|null>(null);
  const openGsaEditor=()=>{gsaBeforeEdit.current={actions:structuredClone(plannedActions),points:structuredClone(stageCheckpoints),reason:gsaReason,confirmedBy:gsaConfirmedBy,decision:gsaDecision};setEditingGsa(true);};
  const closeGsaEditor=()=>{const before=gsaBeforeEdit.current;if(before){setPlannedActions(before.actions);setStageCheckpoints(before.points);setGsaReason(before.reason);setGsaConfirmedBy(before.confirmedBy);setGsaDecision(before.decision);}setEditingGsa(false);};
  const editingGsaRef=useRef(editingGsa);editingGsaRef.current=editingGsa;
  const [gsaRecovery,setGsaRecovery]=useState(()=>readPendingGsa(record.id));
  const [recoveredGsa,setRecoveredGsa]=useState<GsaPlanVersion|null>(null);
  const gsaAutoChecked=useRef<string|null>(null);
  const gsaIntentKey='optracall.goal.pendingGsa.v1:'+record.id;
  const [gsaReason,setGsaReason]=useState('');
  const [previousGsa,setPreviousGsa]=useState<GsaPlanVersion|null>(null);
  const [gsaDraftNotice,setGsaDraftNotice]=useState('');
  const [splitRequest,setSplitRequest]=useState<import('./BusinessRoleConversation.tsx').BusinessRoleRequest>();
  const [splitRunning,setSplitRunning]=useState(false);
  const splitRequirement='请基于已确认的总 GSA 和可用依据，先测算整体可达值，再按业务贡献维度拆解，并结合产品、节假日和活动安排适用的阶段计划。分别保留测算值、正式目标值、差额和假设，形成可核对的拆解草稿。';

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
  const [draftSaveState,setDraftSaveState]=useState<'saved'|'unsaved'|'saving'|'error'>('saved');
  const [draftSaveError,setDraftSaveError]=useState('');
  const [draftConflict,setDraftConflict]=useState<GoalWorkspaceView|null>(null);
  const saveInFlight=useRef(false);
  const editSerial=useRef(0);
  const editBase=useRef<DecompositionDraftInput|null>(null);
  const mergeAttempt=useRef<{id:string;ownerKey:string;serial:number;baseline:NonNullable<GoalWorkspaceView['draft']>}|null>(null);
  const draftOwnerKey=`${record.id}:${goal.version}`;
  const draftOwnerRef=useRef(draftOwnerKey);draftOwnerRef.current=draftOwnerKey;
  const draftFormRef=useRef(draftForm);draftFormRef.current=draftForm;
  const mounted=useRef(true);
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
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
  const { checkActualVal, checkSourceRef, checkCutoffAt, checkSourceLabel, checkBasis, supplementCheck, checkMissingNote, reportText, uploadedName } = actualInput;
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
  const [selectedReviewConclusions, setSelectedReviewConclusions] = useState<Record<string, string[]>>({});
  const [nextPeriod, setNextPeriod] = useState('下一周期');
  const [returnReason, setReturnReason] = useState('原战略假设与本期实绩存在差异，带原证据回战略重审');

  const draftDirtyRef = useRef(draftDirty);
  draftDirtyRef.current = draftDirty;
  const loadSeqRef = useRef(0);
  const firstWorkspaceRead=useRef(true);
  const checkPublicationSeq = useRef(0);
  const recoverySeq = useRef(0);
  const autoCheckedOperation = useRef<string | null>(null);
  const goalVersion = goal.version;
  const draftCacheKey = `optracall.goal.unsavedDraft.v1:${record.id}:${goalVersion}`;
  useEffect(() => {
    if (draftDirty && draftForm) {
      try { sessionStorage.setItem(draftCacheKey, JSON.stringify(draftForm));if(editBase.current)sessionStorage.setItem(draftCacheKey+'.base',JSON.stringify(editBase.current)); } catch { /* Edits remain in memory. */ }
    }
  }, [draftDirty, draftForm, draftCacheKey]);


  const effectiveVersion = record.adoptedVersion ?? record.currentVersion;
  // Item 1: Latest candidate v2 (when v1 is adopted) is NOT historical; only superseded versions are read-only!
  const isHistoricalVersion =
    (record.adoptedVersion !== null && goal.version < record.adoptedVersion) ||
    (goal.status === 'candidate' && goal.version < record.currentVersion);
  const endedCycle=Boolean(goal.dueAt&&goal.dueAt.slice(0,10)<new Date().toISOString().slice(0,10));
  const pendingLocked = Boolean(pendingIntent || pendingStorageError || gsaRecovery.input || gsaRecovery.error);
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
      if(firstWorkspaceRead.current){firstWorkspaceRead.current=false;if(!ws.activeGsaPlan)setStage('plan');}
      if (ws.activeGsaPlan) {
        const editable=ws.gsaDraft?.goalVersion===goalVersion ? ws.gsaDraft : ws.activeGsaPlan;
        if(forceResetDraft||!editingGsaRef.current){
          setPlannedActions(editable.plannedActions.length ? structuredClone(editable.plannedActions) : [{ id: 'act-1', summary: '', checkpoint: '' }]);
          setStageCheckpoints(structuredClone(editable.stageCheckpoints));
        }
        if (forceResetDraft || !draftDirtyRef.current) {
          const visibleGoal = ws.goal.versions.find(v => v.version === goalVersion);
          if (!visibleGoal) throw new Error('找不到所选目标准确版本。');
          const built = buildInitialDraft(visibleGoal, ws);
          const unsaved = restoreDraft(draftCacheKey, built);
          editBase.current=unsaved?restoreDraft(draftCacheKey+'.base',built):null;
          setDraftForm(unsaved ?? built);
          setDraftDirty(Boolean(unsaved));
          if(unsaved)setEditingDecomposition(true);
          if(unsaved&&unsaved.expectedDraftRevision!==built.expectedDraftRevision){
            setDraftSaveState('error');setDraftSaveError('服务器草稿已有新修订，本地改稿已保留，请先核对并合并。');setDraftConflict(ws);
          }

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
    mergeAttempt.current=null;
    setBusy(false);
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
  useEffect(()=>{
    let active=true;
    if(workspace?.latestGsaPlanVersion)void api.listGsaPlans(record.id).then(({gsaPlans})=>{if(active)setPreviousGsa(gsaPlans.at(-1)??null);}).catch(()=>{if(active)setPreviousGsa(null);});
    return()=>{active=false;};
  },[record.id,workspace?.latestGsaPlanVersion]);
  const comparisonGsa=activeGsaPlan??previousGsa;
  const revisingGsa=Boolean(workspace?.latestGsaPlanVersion);

  const activePub = workspace?.activePublication ?? null;
  const thresholdMetric = activePub ? progressMetric(activePub.snapshot, record.versions.find(v => v.version === activePub.snapshot.gsaPlan.goal.version)?.measurement ?? goal.measurement) : '';
  const exactThresholdStream = workspace?.thresholdStreams?.find(t => t.metricId === thresholdMetric && t.periodGranularity === threshGranularity);
  const legacyApplicableThreshold = !exactThresholdStream && workspace?.threshold?.configured &&
    (!workspace.threshold.metricId || workspace.threshold.metricId === thresholdMetric) &&
    (!workspace.threshold.periodGranularity || workspace.threshold.periodGranularity === threshGranularity)
    ? workspace.threshold : undefined;
  const displayedThreshold = exactThresholdStream ?? legacyApplicableThreshold;
  const [thresholdOpen, setThresholdOpen] = useState(false);
  const [actualReportOpen, setActualReportOpen] = useState(false);
  const [actualBasisOpen, setActualBasisOpen] = useState(false);

  const formatThresholdRule = (cfg: DecompositionThresholdConfig | undefined) => {
    if (!cfg?.configured) return '尚未配置';
    const parts = [
      cfg.magnitudePct === undefined ? '' : `不利偏差 ${cfg.magnitudePct}${cfg.unit === 'percentage-points' ? '个百分点' : '%'}`,
      cfg.consecutivePeriods === undefined ? '' : `连续 ${cfg.consecutivePeriods} 期`,
    ].filter(Boolean);
    return parts.join(' 或 ') || '尚未配置';
  };

  const currentCheckTargetPub = selectedCheckPub ?? activePub;
  const currentCheckPeriod = useMemo(() => {
    if (!currentCheckTargetPub) return undefined;
    const rowId = checkRowId || currentCheckTargetPub.snapshot.rows[0]?.rowId || 'G-TOTAL';
    const visibleCps = rowId !== 'G-TOTAL'
      ? currentCheckTargetPub.snapshot.frozenCheckpoints.filter(c => c.rowId === rowId)
      : currentCheckTargetPub.snapshot.frozenCheckpoints;
    const rowCp = rowId === 'G-TOTAL' ? undefined : visibleCps.find(c => c.checkpointId === checkCheckpointId);
    const periods = rowCp ? checkpointPeriods(currentCheckTargetPub.snapshot.timePlan, rowCp) : currentCheckTargetPub.snapshot.timePlan;
    return periods.find(p => p.periodId === checkPeriodId) ?? periods[0];
  }, [currentCheckTargetPub, checkRowId, checkCheckpointId, checkPeriodId]);
  const currentCheckGranularity = currentCheckPeriod?.granularity ?? workspace?.checks.at(-1)?.periodGranularity;
  const currentCheckMetric = currentCheckTargetPub
    ? progressMetric(currentCheckTargetPub.snapshot, record.versions.find(v => v.version === currentCheckTargetPub.snapshot.gsaPlan.goal.version)?.measurement ?? goal.measurement)
    : thresholdMetric;
  const currentCheckThreshold = currentCheckGranularity
    ? (workspace?.thresholdStreams?.find(t => t.metricId === currentCheckMetric && t.periodGranularity === currentCheckGranularity) ??
       (workspace?.threshold?.configured && (!workspace.threshold.metricId || workspace.threshold.metricId === currentCheckMetric) && (!workspace.threshold.periodGranularity || workspace.threshold.periodGranularity === currentCheckGranularity) ? workspace.threshold : undefined))
    : undefined;
  const otherConfiguredCheckStreams = currentCheckGranularity
    ? (workspace?.thresholdStreams ?? []).filter(t => t.configured && t.metricId === currentCheckMetric && t.periodGranularity && t.periodGranularity !== currentCheckGranularity)
    : [];

  useEffect(() => {
    setThreshMagnitude(displayedThreshold?.configured && displayedThreshold.magnitudePct !== undefined ? String(displayedThreshold.magnitudePct) : '');
    setThreshConsecutive(displayedThreshold?.configured && displayedThreshold.consecutivePeriods !== undefined ? String(displayedThreshold.consecutivePeriods) : '');
    setThreshDirection(displayedThreshold?.adverseDirection ?? 'below');
    setThreshUnit(displayedThreshold?.unit ?? 'percent');
  }, [displayedThreshold, threshGranularity, thresholdMetric]);
  const activeStageMode = !activeGsaPlan ? 'gsa-confirm' : 'decompose';
  const upstreamNeedsReview=Boolean(activeGsaPlan&&workspace&&workspace.latestDraftRevision>0&&(!workspace.draft||workspace.draft.gsaPlanVersion!==activeGsaPlan.planVersion)&&draftForm?.reviewedPreviousPlanVersion===undefined);
  const reviewUpstream=async()=>{
    if(!activeGsaPlan||mutationsLocked)return;
    const startSerial=editSerial.current;
    const hadLocalEdits=draftDirty;
    setBusy(true);setWsError('');
    try{
      // Always query the global latest workspace (without historical ?goalVersion=) so newer goal/GSA upgrades cannot be masked.
      const full=await api.getWorkspace(record.id);
      const outcome=resolveUpstreamCarryover({
        currentGoalVersion:goal.version,
        currentActivePlan:activeGsaPlan,
        latestWorkspace:full,
        hadLocalEdits,
        startEditSerial:startSerial,
        currentEditSerial:editSerial.current,
      });
      if(outcome.kind==='gsa-changed'||outcome.kind==='error'){
        setWsError(outcome.message);
        return;
      }
      if(outcome.kind==='conflict'){
        setDraftConflict(outcome.latestWorkspace);
        setDraftSaveState('error');
        setDraftSaveError(outcome.message);
        setWsError(outcome.message);
        return;
      }
      if(outcome.kind==='already-current'){
        setWorkspace(outcome.latestWorkspace);
        setDraftForm(buildInitialDraft(goal, outcome.latestWorkspace));
        setDraftDirty(false);setDraftSaveState('saved');setDraftConflict(null);
        setNotice(outcome.message);
        return;
      }
      setDraftForm(outcome.draftForm);
      editSerial.current++;setDraftDirty(true);setDraftSaveState('unsaved');setPreview(null);
      setEditingDecomposition(true);
      setNotice(outcome.message);
    }catch(fault){setWsError(fault instanceof Error?fault.message:api.goalError(fault));}finally{setBusy(false);}
  };

  const gsaMissing=[...(!goal.formalOrigin?['正式目标值、周期及来源']:[]),...(!goal.strategies?.length?['策略 S']:[]),
    ...(!plannedActions.some(a=>a.summary.trim())?['计划 A']:[]),...(!hasGsaCheckpoint(plannedActions,stageCheckpoints)?['阶段检查点及观察依据']:[])];
  const gsaChanged=!comparisonGsa||comparisonGsa.goal.version!==goal.version||JSON.stringify(comparisonGsa.plannedActions)!==JSON.stringify(plannedActions)||
    JSON.stringify(comparisonGsa.stageCheckpoints)!==JSON.stringify(stageCheckpoints);
  const planOwner:BusinessRoleOwner={role:'goal',goalId:goal.goalId,version:goal.version,analysisVariant:'goal-plan'};
  const saveGsaCandidate=async()=>{
    setBusy(true);setWsError('');
    try{await api.saveGsaPlanDraft(record.id,{goalVersion:goal.version,plannedActions,stageCheckpoints,...(preEstimate?{preConfirmEstimate:preEstimate}:{})});setGsaDraftNotice('GSA 候选已保存，正式版继续以已确认版本为准。');setEditingGsa(false);await loadWorkspace();}
    catch(fault){setWsError(api.goalError(fault));}finally{setBusy(false);}
  };


  const statusBadge = useMemo(() => {
    if(gsaRecovery.input||gsaRecovery.error)return {label:'总 GSA 确认结果待核',tone:'warn'};
    if (pendingStorageError) return { label: '本地发布缓存异常（已锁定）', tone: 'danger' };
    if (pendingIntent) return { label: '待核对发布结果', tone: 'warn' };
    if (isHistoricalVersion) return { label: `历史只读版本 v${goal.version}`, tone: 'pending' };
    if (!activeGsaPlan) return { label: '待确认总目标 GSA', tone: 'pending' };
    if (crossConflicts.length) return { label: `交叉冲突待对齐 (${crossConflicts.length})`, tone: 'danger' };
    if (activePub) return { label: `拆解正式版 v${activePub.version} 生效中`, tone: 'ok' };
    return { label: '总 GSA 已确认 · 拆解草稿中', tone: 'accent' };
  }, [gsaRecovery,pendingStorageError, pendingIntent, isHistoricalVersion, goal.version, activeGsaPlan, crossConflicts.length, activePub]);

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
      await onGoalsReload({goalId:res.goal.goalId,version:res.goal.version});
      await loadWorkspace(true);
    } catch (fault) {
      setWsError(api.goalError(fault));
    } finally {
      setBusy(false);
    }
  };

  const handleConfirmGsa = async () => {
    if (mutationsLocked||busy) return;
    if(gsaMissing.length){setWsError('请补齐'+gsaMissing.join('、'));return;}
    if(revisingGsa&&(!gsaChanged||!gsaReason.trim())){setWsError('请修改计划并填写修订原因后确认。');return;}
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
    const input:GsaPlanConfirmInput={
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
        ...(revisingGsa ? {supersedesReason:gsaReason.trim()} : {}),
    };
    try{
      const raw=JSON.stringify({goalId:record.id,input});localStorage.setItem(gsaIntentKey,raw);
      if(localStorage.getItem(gsaIntentKey)!==raw)throw Error('storage');
    }catch{setWsError('无法保存本次确认意图，计划输入已保留，请恢复浏览器存储后重试。');return;}
    setGsaRecovery({input,error:null});gsaAutoChecked.current=null;
    await dispatchGsa(input);
  };

  const acceptGsa=async(result:{goal:GoalVersion;gsaPlan:GsaPlanVersion},recovered=false)=>{
    try{localStorage.removeItem(gsaIntentKey);if(localStorage.getItem(gsaIntentKey)!==null)throw Error('storage');}
    catch{setGsaRecovery(previous=>({...previous,error:'已读到确认回执，本地待核标记清理失败，已锁定后续操作。'}));return;}
    setGsaRecovery({input:null,error:null});setEditingGsa(false);
    if(recovered)setRecoveredGsa(result.gsaPlan);
    setNotice(`已核定总 GSA 确认回执 v${result.gsaPlan.planVersion}，绑定目标 v${result.goal.version}。`);
    await onGoalsReload({goalId:result.goal.goalId,version:result.goal.version});await loadWorkspace(true);
  };
  const dispatchGsa=async(input:GsaPlanConfirmInput)=>{
    setBusy(true);setWsError('');
    try{await acceptGsa(await api.confirmGsaPlan(record.id,input));}
    catch(fault){
      setWsError(api.goalError(fault));
      if(fault instanceof api.StrategyGoalsRequestError&&fault.status>=400&&fault.status<500){
        try{localStorage.removeItem(gsaIntentKey);setGsaRecovery({input:null,error:null});}catch{}
      }
    }finally{setBusy(false);}
  };
  const recoverGsa=async()=>{
    const input=gsaRecovery.input;if(!input||busy)return;
    setBusy(true);setWsError('');
    try{
      const result=await api.readGsaConfirmation(record.id,input.operationId);
      if(result.found)await acceptGsa(result,true);
      else setNotice('尚未读到原 GSA 确认回执，当前编辑已锁定。可继续核对，或明确按原编号与原内容重试。');
    }catch(fault){setWsError(api.goalError(fault));}finally{setBusy(false);}
  };
  useEffect(()=>{
    if(!gsaRecovery.input||busy||gsaAutoChecked.current===gsaRecovery.input.operationId)return;
    gsaAutoChecked.current=gsaRecovery.input.operationId;void recoverGsa();
  },[gsaRecovery.input,busy]);

  const handleSaveDraft = async (): Promise<{ draft: NonNullable<GoalWorkspaceView['draft']>; validation: NonNullable<GoalWorkspaceView['validation']> } | null> => {
    const current=draftFormRef.current;
    if (mutationsLocked || endedCycle || upstreamNeedsReview || !current || !activeGsaPlan || saveInFlight.current || mergeAttempt.current) return null;
    saveInFlight.current=true;
    const serial=editSerial.current;
    const payload=structuredClone(current);
    setDraftSaveState('saving');setDraftSaveError('');
    try {
      const res=await api.saveDecompositionDraft(record.id,payload);
      if(!mounted.current)return res;
      setWorkspace(ws=>ws?{...ws,draft:res.draft,priorDraft:null,latestDraftRevision:res.draft.revision,validation:res.validation}:ws);
      setDraftForm(form=>form?{...form,expectedDraftRevision:res.draft.revision,reviewedPreviousPlanVersion:undefined}:form);
      const unchanged=serial===editSerial.current;
      editBase.current=unchanged?null:{...payload,expectedDraftRevision:res.draft.revision};
      setDraftConflict(null);
      setDraftDirty(!unchanged);setDraftSaveState(unchanged?'saved':'unsaved');
      if(unchanged)try{sessionStorage.removeItem(draftCacheKey);sessionStorage.removeItem(draftCacheKey+'.base');}catch{}
      return res;
    } catch(fault) {
      if(mounted.current){setDraftSaveError(api.goalError(fault));setDraftSaveState('error');}
      if(fault instanceof api.StrategyGoalsRequestError&&fault.code==='decomposition_draft_conflict'){
        try{const latest=await api.getWorkspace(record.id,goal.version);if(mounted.current)setDraftConflict(latest);}catch{}
      }

      return null;
    } finally {saveInFlight.current=false;}
  };
  useEffect(()=>{
    if(!draftDirty||!draftForm||mutationsLocked||endedCycle||upstreamNeedsReview||saveInFlight.current||draftSaveState==='error')return;
    const timer=setTimeout(()=>{void handleSaveDraft();},450);
    return()=>clearTimeout(timer);
  },[draftDirty,draftForm,mutationsLocked,upstreamNeedsReview,draftSaveState]);

  const mergeDraftConflict=async()=>{
    if(!draftConflict?.activeGsaPlan||!draftForm||!activeGsaPlan||mutationsLocked||endedCycle||busy||splitRunning||saveInFlight.current||mergeAttempt.current)return;
    if(!editBase.current){setDraftSaveError('原编辑基线暂不可读，本地改稿已保留，请先核对原版本后继续。');return;}
    const local=structuredClone(draftForm),base=structuredClone(editBase.current),serial=editSerial.current,ownerKey=draftOwnerKey;
    const changes=goalDraftChanges(base,local)
      .filter(change=>!['/expectedDraftRevision','/operationId'].includes(change.path));
    const text='请读取当前准确总 GSA 和服务器最新拆解草稿，把以下人工改动合并到最新稿，保留服务器其他改动。存在业务冲突时说明原值并请负责人决定，仅保存可核对草稿。\n人工改动\n'+JSON.stringify({fromRevision:local.expectedDraftRevision,changes});
    if(text.length>20000){setDraftSaveError('本地改动较多，请分项与 Agent 核对；完整改稿仍保存在本机。');return;}
    try{
      sessionStorage.setItem(draftCacheKey,JSON.stringify(local));sessionStorage.setItem(draftCacheKey+'.base',JSON.stringify(base));
      sessionStorage.setItem(draftCacheKey+'.conflict',JSON.stringify(local));sessionStorage.setItem(draftCacheKey+'.conflict.base',JSON.stringify(base));
    }catch{setDraftSaveError('本地备份保存失败，改稿继续保留在原框，请恢复存储后重试。');return;}
    const current=()=>mounted.current&&draftOwnerRef.current===ownerKey;
    saveInFlight.current=true;setBusy(true);setDraftSaveState('error');setWsError('');
    try{
      let latest=await api.getWorkspace(record.id);
      if(!current())return;
      const outcome=resolveUpstreamCarryover({currentGoalVersion:goal.version,currentActivePlan:activeGsaPlan,latestWorkspace:latest,hadLocalEdits:false,startEditSerial:serial,currentEditSerial:serial});
      if(outcome.kind!=='carryover'&&outcome.kind!=='already-current'){
        setDraftSaveError(outcome.message);return;
      }
      if(outcome.kind==='carryover'){
        // The user's explicit review/merge action carries the exact readable prior body through the original user route.
        // The Agent never receives the authority to bypass upstream review.
        const saved=await api.saveDecompositionDraft(record.id,outcome.draftForm);
        if(!current())return;
        latest={...latest,draft:saved.draft,priorDraft:null,latestDraftRevision:saved.draft.revision,validation:saved.validation};
      }
      setWorkspace(latest);setDraftConflict(latest);setPreview(null);
      if(serial!==editSerial.current){setDraftSaveError('承接期间新增的本地改稿已保留，请再次核对并合并。');return;}
      if(!latest.draft)throw new Error('尚未核实新版总 GSA 草稿保存，本地改稿已保留。');
      const id=crypto.randomUUID();
      mergeAttempt.current={id,ownerKey,serial,baseline:latest.draft};
      setDraftSaveError('Agent 正在合并，本地改稿和原编辑基线继续保留，待核实实际保存结果。');
      setSplitRunning(true);setSplitRequest({id,text});
      setNotice('已核对新版草稿，Agent 将对照最新稿合并；本地改稿继续保留，核对结果后再发布。');
    }catch(fault){
      if(current()){
        setDraftSaveError(api.goalError(fault));
        try{const latest=await api.getWorkspace(record.id);if(current())setDraftConflict(latest);}catch{}
      }
    }finally{saveInFlight.current=false;if(current())setBusy(false);}
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
      setWsError('当前拆解草稿尚未保存或有未保存改动，请等待自动保存成功或重试保存，再进入只读发布预览（预览不产生任何写入）。');
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
      setEditingDecomposition(false);
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
        setEditingDecomposition(false);
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

  const startActualCheck=(actualId:string)=>{
    setAnalysisDialogOpen(true);
    if(analysisRunning&&analysisRequest?.kind==='actual'&&analysisRequest.id===actualId)return;
    setAnalysisRequest({kind:'actual',id:actualId});
    setAnalysisTurn({kind:'actual',ownerId:actualId,request:{id:crypto.randomUUID(),text:'请对照已明确选定的实绩与准确冻结计划核验指标、单位、范围、期间、数值及成熟度。报表没有手填截至日期时从原文提取数据截至日期与原句，缺失或冲突保持待核。用 goal-assess-actual 保存本次结果。'}});
  };
  // --- Stage 2: Follow-up Checks ---
  const handleSaveThreshold = async () => {
    if (mutationsLocked) return;
    setBusy(true);
    setWsError('');
    setNotice('');
    try {
      const { threshold: saved } = await api.setDecompositionThreshold(record.id, {
        expectedGoalVersion: goal.version,
        configured: Boolean(threshMagnitude || threshConsecutive),
        ...(threshMagnitude ? { magnitudePct: Number(threshMagnitude) } : {}),
        ...(threshConsecutive ? { consecutivePeriods: Number(threshConsecutive) } : {}),
        adverseDirection: threshDirection, unit: threshUnit,
        metricId: thresholdMetric, periodGranularity: threshGranularity,
      });
      const granText = granularityLabel(saved.periodGranularity ?? threshGranularity);
      const metricText = saved.metricId || thresholdMetric || '当前目标';
      const ruleText = formatThresholdRule(saved);
      const granMismatch = Boolean(currentCheckGranularity && (saved.periodGranularity ?? threshGranularity) !== currentCheckGranularity);
      const metricMismatch = Boolean(currentCheckMetric && (saved.metricId || thresholdMetric) && (saved.metricId || thresholdMetric) !== currentCheckMetric);
      const mismatchHint = granMismatch || metricMismatch
        ? `（提示：该${granText}粒度 · 「${metricText}」规则不适用当前${granularityLabel(currentCheckGranularity)}检查）`
        : '';
      setNotice(`已保存「${granText}粒度 · ${metricText}」阈值：${ruleText}${mismatchHint}。`);
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
    if ((!checkSourceRef.trim()&&!reportText.trim()) || (!checkCutoffAt.trim()&&!reportText.trim())) {
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
          ref: checkSourceRef.trim()||uploadedName||'本次粘贴报表', label: checkSourceLabel.trim() || checkSourceRef.trim()||uploadedName||'本次粘贴报表', cutoffAt: checkCutoffAt.trim(),
          ...(reportText.trim() ? {reportText} : {}),
          ...(hasManualBasis ? {basis: checkBasis} : {}),
          ...(checkMissingNote.trim() ? {coverageNote: checkMissingNote.trim()} : {}),
        },
        ...(checkMissingNote.trim() ? { missingCoverageNote: checkMissingNote.trim() } : {}),
        ...(supplementCheck ? { supplementOfCheckId: supplementCheck } : {}),
        actualPeriods: [{periodId: period.periodId, label: rowCheckpoint?.label ?? period.label, actualValue: actualNum}],
      });
      editActual(emptyActualInput);
      startActualCheck(res.actual.actualId);
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
      setAnalysisDialogOpen(true);setAnalysisRequest({kind: 'next-cycle', id: res.nextCycleDraft.draftId});
      setAnalysisTurn({kind:'next-cycle',ownerId:res.nextCycleDraft.draftId,request:{id:crypto.randomUUID(),text:'请根据负责人选定的复盘结论、原证据和适用范围起草下一期目标草案。范围扩大仍保持待验证，不自动采用、发布或创建 Case。'}});
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
    if(!draftDirtyRef.current&&draftFormRef.current)editBase.current=structuredClone(draftFormRef.current);
    editSerial.current++;setPreview(null);
    if(mergeAttempt.current){setDraftSaveState('error');setDraftSaveError('Agent 合并期间新增的改稿已保留，待本轮结束后核对并合并。');}
    else {setDraftSaveState('unsaved');setDraftSaveError('');}
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

  const draftFeedback=<div role="status"><p>{draftSaveState==='saving'?'正在保存…':draftDirty?'改稿待保存':'草稿已保存'}</p>{draftSaveState==='error'&&<div role="alert"><p>{draftSaveError}</p><button className="secondary-button" onClick={()=>void handleSaveDraft()}>重试保存草稿</button>{draftConflict&&<button className="secondary-button" disabled={splitRunning||mutationsLocked} onClick={mergeDraftConflict}>请 Agent 合并保留的改稿</button>}</div>}</div>;

  return (
    <div className="gm-workspace" data-goal-id={record.id}>
      <header className="gj-page-head">
        <div><div className="gj-eyebrow">目标管理</div><h1 className="gm-goal-title">{goal.title}</h1>
          <p className="gj-context">{goal.formalOrigin?.period||goal.dueAt?.slice(0,10)||'周期待补'} · {goal.scope.name} · {goal.responsible}
            <button type="button" className="text-button" onClick={onOpenSwitcher}>切换目标</button></p></div>
        <div className="gj-title-actions"><span className={`gm-status-pill gm-status-${statusBadge.tone}`}>{statusBadge.label}</span>
          <button type="button" className="secondary-button" disabled={busy||mutationsLocked||endedCycle||draftDirty||draftSaveState==='saving'} onClick={openGsaEditor}>{activeGsaPlan?'修订总 GSA':'修改 GSA'}</button>
          {stage==='plan'&&workspace&&!activeGsaPlan&&!revisingGsa&&<button type="button" className="primary-button" disabled={busy||mutationsLocked||endedCycle} onClick={()=>gsaMissing.length?openGsaEditor():void handleConfirmGsa()}>{gsaMissing.length?'补齐 GSA 后开始拆解':'确认并进入拆解'}</button>}
        </div>
      </header>
      <section className="gj-toolbar" aria-label="当前目标的版本、决策与执行"><div>{goal.status==='adopted'?'当前生效版':'本期候选'} <strong>目标 v{goal.version}{activeGsaPlan?` · 总 GSA v${activeGsaPlan.planVersion}`:''}{activePub?` · 拆解正式版 v${activePub.version}`:''}</strong></div>
        <div className="sg-row"><button type="button" className="secondary-button" onClick={onOpenVersions}>版本与来源</button><button type="button" className="secondary-button" onClick={onOpenDecisions}>关联决策</button><button type="button" className="secondary-button" onClick={onOpenHandoffs}>执行承接 ({workspace?.handoffs.length??0})</button><details className="gj-more"><summary>更多</summary><button type="button" className="text-button" onClick={onCreateNewGoal}>＋ 新建目标</button>{managementTools}</details></div>
      </section>

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

      <CaseFormError error={wsError} />
      {workspace?.draftUnavailable && <p role="status">原拆解草稿的范围或引用暂不可读，请核对原授权。</p>}
      {notice && <p className="case-notice" role="status">{notice}</p>}
      {gsaDraftNotice&&!editingGsa&&!notice&&<p className="case-notice" role="status">{gsaDraftNotice}</p>}

      {(gsaRecovery.input||gsaRecovery.error)&&<aside className="gm-recovery-card" aria-label="总 GSA 确认结果待核"><strong>总 GSA 确认结果待核</strong><p>{gsaRecovery.error||'正在按原确认编号核对结果，原输入和版本保留。'}</p><div className="sg-row"><button className="primary-button" disabled={busy||!gsaRecovery.input} onClick={()=>void recoverGsa()}>核对原 GSA 确认</button><button className="secondary-button" disabled={busy||!gsaRecovery.input||Boolean(gsaRecovery.error)} onClick={()=>gsaRecovery.input&&void dispatchGsa(gsaRecovery.input)}>按原意图重试确认</button></div></aside>}


      {upstreamNeedsReview&&<aside className="gm-card" aria-label="核对新版总 GSA"><strong>总 GSA 已更新，原拆解仍引用旧版</strong><p>请在「版本与来源」核对原版与新版，再明确承接旧稿继续拆解。</p><button type="button" className="secondary-button" disabled={busy||mutationsLocked} onClick={()=>void reviewUpstream()}>已核对，承接原拆解草稿</button></aside>}
      {/* Confirmed A 3-Stage Business Stepper */}
      <nav className="gm-stage-tabs" aria-label="目标管理三阶段流程">
        <button type="button" aria-current={stage === 'plan' ? 'step' : undefined} onClick={() => setStage('plan')}>
          <span className="gm-step-num">1</span> {activeGsaPlan?'目标拆解与发布':'目标拆解 · 核对 GSA'}
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
      {stage === 'plan' && workspace && <>
        {endedCycle&&<aside role="status"><p>本周期已结束，计划只读。可继续阶段跟进和到期复盘，或切换到当前目标。</p><button type="button" onClick={onOpenSwitcher}>切换当前目标</button></aside>}
        <fieldset className="gm-plan-fieldset" disabled={endedCycle}>{activeStageMode === 'gsa-confirm' ? (
          <GsaWorksheet goal={goal} actions={plannedActions} checkpoints={stageCheckpoints} estimate={preEstimate} missing={gsaMissing} onEdit={openGsaEditor} onConfirm={()=>void handleConfirmGsa()} disabled={busy||mutationsLocked||endedCycle} onEstimate={()=>{openGsaEditor();setShowEstimateAgent(true);}}/>
        ) : activePub&&!editingDecomposition&&!pendingLocked ? (
          <section className="gj-card gj-published" aria-label="当前正式拆解版"><header className="gj-card-head"><div><h2>正式目标拆解表 <span className="gm-status-pill gm-status-ok">v{activePub.version} 已发布</span></h2><p>总 GSA v{activePub.gsaPlanVersion} · 下游按此准确版本引用</p></div><div className="sg-row"><button className="secondary-button" disabled={mutationsLocked} onClick={()=>setEditingDecomposition(true)}>修订拆解草稿</button><button className="primary-button" onClick={()=>setStage('followup')}>开始阶段跟进</button></div></header>
            <GoalPlanSheet sheet={activePub.snapshot} formalValue={activePub.snapshot.gsaPlan.formalTarget.value} unit={activePub.snapshot.gsaPlan.formalTarget.unit} published/>
            <div className="gj-card-body"><DownloadVersion route={`/api/strategy/goals/${record.id}/decomposition/publications/${activePub.version}/export`} /></div>
          </section>
        ) : (
          /* Stage 1b: Confirmed A Side-by-Side Main Workspace */
          <div className="gm-split-workspace">
            {/* LEFT COLUMN: Real Unified BusinessRoleConversation (goal-decomposition) */}
            <section ref={agentPane} tabIndex={-1} className="gm-left-agent" aria-label="目标拆解 Agent 协作区">
              <div className="sg-row-between gm-pane-header">
                <div>
                  <h3>目标拆解 Agent</h3>
                  <p className="sg-muted">用一句业务要求形成拆解草稿，核对后由负责人发布。</p>
                </div>
                <button type="button" className="text-button" disabled={mutationsLocked||draftDirty||draftSaveState==='saving'} onClick={openGsaEditor}>
                  调整总 GSA / 计划 A
                </button>
              </div>
              <button className="gj-mobile-jump secondary-button" onClick={()=>{resultPane.current?.scrollIntoView({behavior:'smooth'});resultPane.current?.focus({preventScroll:true});}}>查看拆解表 ↓</button>
              <section className="gj-note"><strong>当前已带入</strong><p>{goal.outcome}</p><p>{goal.scope.name} · {activeGsaPlan?.formalTarget.period} · 总 GSA v{activeGsaPlan?.planVersion}</p><GoalSource goal={goal}/><details><summary>计划与可用依据</summary><p>{activeGsaPlan?.plannedActions.map(a=>a.summary).join('；')}</p><p>{draftForm?.estimate.basis||'可在对话中补充经营资料'}</p></details></section>
              <div className="gj-quick-prompt"><p>{splitRequirement}</p><button type="button" className="secondary-button" disabled={mutationsLocked||upstreamNeedsReview||splitRunning} onClick={()=>{setSplitRunning(true);setSplitRequest({id:crypto.randomUUID(),text:splitRequirement});}}>按此要求起草</button></div>
              <BusinessRoleConversation
                owner={decompositionOwner} request={splitRequest} onRunning={setSplitRunning}
                readOnly={mutationsLocked||endedCycle||upstreamNeedsReview}
                showInlineTitle={false}
                onGoalDraft={onGoalDraftSuggestion}
                onFailure={message=>{if(mergeAttempt.current){mergeAttempt.current=null;setDraftSaveState('error');setDraftSaveError(message+' 本地改稿和原编辑基线继续保留，请核对后再合并。');}}}
                onResult={async(detail,id)=>{
                  const attempt=mergeAttempt.current;
                  if(!attempt||attempt.id!==id||attempt.ownerKey!==draftOwnerRef.current)return;
                  const saved=savedUpstreamMergeDraft(detail,id,attempt.baseline);
                  try{
                    const latest=await api.getWorkspace(record.id);
                    if(!mounted.current||mergeAttempt.current!==attempt||attempt.ownerKey!==draftOwnerRef.current)return;
                    setWorkspace(latest);setDraftConflict(latest);mergeAttempt.current=null;
                    const samePlan=latest.goal.adoptedVersion===goal.version&&latest.latestGsaPlanVersion===attempt.baseline.gsaPlanVersion&&
                      latest.activeGsaPlan?.planId===attempt.baseline.gsaPlanId&&latest.activeGsaPlan.contentSha256===attempt.baseline.gsaPlanSha256;
                    if(!samePlan||!saved||latest.draft?.revision!==saved.revision||latest.draft.contentSha256!==saved.contentSha256||attempt.serial!==editSerial.current){
                      setDraftSaveState('error');setDraftSaveError('本地改稿继续保留；本轮未核实相同版本的合并保存，或已有新输入／服务器修订，请核对后再合并。');return;
                    }
                    setDraftForm(buildInitialDraft(goal,latest));setDraftDirty(false);setDraftSaveState('saved');setDraftSaveError('');setDraftConflict(null);editBase.current=null;
                    try{sessionStorage.removeItem(draftCacheKey);sessionStorage.removeItem(draftCacheKey+'.base');}catch{}
                    setNotice('Agent 合并草稿已实际保存，请核对内容后再发布；原本地改稿与编辑基线备份仍保留。');
                  }catch(fault){if(mounted.current&&mergeAttempt.current===attempt){mergeAttempt.current=null;setDraftSaveState('error');setDraftSaveError(api.goalError(fault));}}
                }}
                onSettled={() => void loadWorkspace()}
              />
            </section>

            {/* RIGHT COLUMN: Live Decomposition Table, Conflicts, Time Plan, Preview & Publish */}
            <section ref={resultPane} tabIndex={-1} className="gm-right-table" aria-label="实时拆解表与发布区">
              <button className="gj-mobile-jump secondary-button" onClick={()=>{agentPane.current?.scrollIntoView({behavior:'smooth'});agentPane.current?.focus({preventScroll:true});}}>↑ 返回对话</button>
              <div className="sg-row-between gm-pane-header">
                <div>
                  <h3>实时拆解表 {workspace.draft ? `· 草稿 rev ${workspace.draft.revision}` : '· 初始草稿'}</h3>
                  <p role="status" aria-label="草稿保存状态">{draftSaveState==='saving'?'正在保存…':draftSaveState==='error'?'保存失败，改稿已保留':draftDirty?'待保存':workspace.draft?'已保存':'等待形成拆解草稿'}</p>
                  {!editPart&&draftSaveState==='error'&&<div role="alert"><p>{draftSaveError}</p><button type="button" className="secondary-button" onClick={()=>void handleSaveDraft()}>重试保存草稿</button>{draftConflict&&<button type="button" className="secondary-button" disabled={splitRunning||mutationsLocked} onClick={mergeDraftConflict}>请 Agent 合并保留的改稿</button>}</div>}
                  <p className="sg-muted">
                    绑定总目标 GSA 计划 v{activeGsaPlan!.planVersion} · 正式目标值、可达测算值与差额始终分别保留
                  </p>
                </div>
                <div className="sg-row">
                  {activePub&&<button type="button" className="text-button" onClick={()=>setEditingDecomposition(false)}>查看正式版</button>}
                  <details className="gj-more"><summary>草稿操作</summary><button type="button" className="text-button" disabled={busy} onClick={() => void loadWorkspace()}>
                    同步最新草稿
                  </button>
                  <button type="button" className="secondary-button" disabled={busy || mutationsLocked} onClick={() => void handleSaveDraft()}>
                    保存草稿
                  </button></details>
                  <button
                    type="button"
                    className="primary-button"
                    disabled={busy || loadingWs || mutationsLocked || upstreamNeedsReview || draftDirty || draftSaveState==='saving' || !workspace.draft || crossConflicts.length > 0}
                    onClick={() => void handleOpenPublishPreview()}
                  >
                    核对并发布
                  </button>
                </div>
              </div>

              {draftForm&&<GoalPlanSheet sheet={draftForm} formalValue={formalVal??0} unit={formalUnit} onEdit={part=>setEditPart(part)}/>}
              {/* Three Separate Metric Cards (GM03 / GM06) */}
              {draftForm && editPart==='estimate' && (
                <CaseDialog active title="核对可达测算" onClose={()=>setEditPart(null)}>{draftFeedback}<div className="gm-metric-cards">
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
                </div></CaseDialog>
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
              {draftForm && editPart==='rows' && (
                <CaseDialog active title="调整责任分配" className="sg-dialog gm-aux-dialog" onClose={()=>setEditPart(null)}>{draftFeedback}<div className="gm-section-block">
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
                </div></CaseDialog>
              )}

              {/* Reserves & Gap Strategies & Time Plan */}
              {draftForm && editPart==='details' && (
                <CaseDialog active title="调整预留、补缺与时间计划" className="sg-dialog gm-aux-dialog" onClose={()=>setEditPart(null)}>{draftFeedback}<div className="gm-collapsible">
                  <h3>
                    预留项 ({draftForm.reserves.length} · 合计 {reserveSum}{formalUnit}) · 补缺策略 ({draftForm.gapStrategies.length}) · 时间计划 ({draftForm.timePlan.length} 阶段)
                  </h3>
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
                </div></CaseDialog>
              )}
            </section>
          </div>
        )
      }</fieldset></>}

      {editingGsa&&workspace&&<CaseDialog active title={activeGsaPlan?'修订总 GSA':'修改 GSA'} className="sg-dialog gj-gsa-dialog" busy={busy} onClose={closeGsaEditor}>
        <CaseFormError error={wsError}/><fieldset className="gm-plan-fieldset" disabled={endedCycle}>
          <section className="sg-panel gm-gsa-confirm" aria-label="确认总目标 GSA">
            <section className="gj-gsa-editor-source" aria-label="本期 G 与 S 来源"><div className="sg-row-between"><strong>{goal.formalOrigin?`本期目标 · ${goal.formalOrigin.targetValue}${goal.formalOrigin.unit}`:'正式目标待补齐'}</strong><button type="button" className="text-button" disabled={mutationsLocked} onClick={()=>{closeGsaEditor();onReviseGoal();}}>修订基础 G/S 字段</button></div>
              <p>{goal.formalOrigin?.period||'周期待补'} · {goal.scope.name}</p><p>策略 S · {goal.strategies?.join('；')||'待补齐'}</p><GoalSource goal={goal}/>
              <details><summary>查看完整目标</summary><p>{goal.outcome}</p></details>
            </section>

            <div className="gm-card gm-plan-a-editor">
              <div className="sg-row-between">
                <div>
                  <strong>本期计划与检查依据</strong>
                  <p className="sg-muted">计划可由 Agent 推荐或优化，再由你修改确认。</p>
                </div>
                <button
                  type="button"
                  className="secondary-button"
                  disabled={mutationsLocked}
                  onClick={() => setPlannedActions(old => [...old, { id: crypto.randomUUID(), summary: '', checkpoint: '' }])}
                >
                  ＋ 添加计划 A
                </button>
              </div>
              {plannedActions.map((act, idx) => (
                <div key={act.id} className="gm-card"><div className="gj-plan-fields"><label>计划 A
                  <input
                    className="gm-input"
                    aria-label={`计划 A ${idx + 1} 内容`}
                    placeholder="填写明确的计划动作（例如：上线冬季礼盒与复购券包）"
                    disabled={mutationsLocked}
                    value={act.summary}
                    onChange={e => setPlannedActions(old => old.map((x, i) => (i === idx ? { ...x, summary: e.target.value } : x)))}
                  />
                  </label><label>阶段检查点<input
                    className="gm-input"
                    aria-label={`计划 A ${idx + 1} 检查点`}
                    placeholder="写明何时检查、核对什么"
                    disabled={mutationsLocked}
                    value={act.checkpoint ?? ''}
                    onChange={e => setPlannedActions(old => old.map((x, i) => (i === idx ? { ...x, checkpoint: e.target.value } : x)))}
                  />
                  </label><label>观察依据<input className="gm-input" aria-label={`计划 A ${idx + 1} 观察依据`} placeholder="核对这项行动所用的观察依据"
                    disabled={mutationsLocked} value={act.observationBasis ?? ''}
                    onChange={e => setPlannedActions(old => old.map((action, i) => i === idx ? { ...action, observationBasis: e.target.value } : action))}
                  />
                  </label>{plannedActions.length > 1 && (
                    <button type="button" className="text-button" disabled={mutationsLocked} onClick={() => setPlannedActions(old => old.filter((_, i) => i !== idx))}>移除</button>
                  )}
                </div><GoalPlanAssistance key={JSON.stringify([goal.goalId,goal.version,goal.strategies,act.id,editingGsa])}
                  owner={planOwner} action={act} ready={Boolean(goal.formalOrigin&&goal.strategies?.length)} disabled={mutationsLocked}
                  onChange={next=>setPlannedActions(actions=>actions.map(a=>a.id===next.id?next:a))}/></div>
              ))}
            </div>

            <details className="gj-details"><summary>另设阶段检查点与确认信息</summary><div className="gm-gsa-action-editor">
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

            </details><details className="gj-details" open={showEstimateAgent}><summary>确认前可达性测算</summary><div className="gm-pre-estimate-box">
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

            </details>
            {revisingGsa&&<div className="gm-card"><label>修订原因<input className="gm-input" aria-label="GSA 修订原因" value={gsaReason} disabled={mutationsLocked} onChange={e=>setGsaReason(e.target.value)}/></label>
              <details><summary>核对原版与本次计划</summary><p>原版 {comparisonGsa?.formalTarget.value}{comparisonGsa?.formalTarget.unit} · {comparisonGsa?.plannedActions.map(a=>[a.summary,a.checkpoint,a.observationBasis].filter(Boolean).join(' · ')).join('；')}</p><p>本次 {plannedActions.map(a=>[a.summary,a.checkpoint,a.observationBasis].filter(Boolean).join(' · ')).join('；')}</p></details></div>}
            {gsaDraftNotice&&<p role="status">{gsaDraftNotice}</p>}
            <div className="gm-confirm-bar gj-dialog-footer"><button type="button" className="text-button" disabled={busy} onClick={closeGsaEditor}>取消</button>
              <button type="button" className="secondary-button" disabled={busy||mutationsLocked} onClick={()=>void saveGsaCandidate()}>保存 GSA 候选</button>
              <button
                type="button"
                className="primary-button"
                disabled={busy || mutationsLocked || gsaMissing.length>0 || !gsaChanged || Boolean(revisingGsa&&!gsaReason.trim())}
                onClick={() => void handleConfirmGsa()}
              >
                {revisingGsa ? `确认更新 GSA 计划 v${workspace.latestGsaPlanVersion + 1}` : '确认 GSA，开始拆解'}
              </button>
            </div>
          </section>
        </fieldset></CaseDialog>}

      {/* STAGE 2: Follow-up Checks & Case Draft Intents (GM10 / GM11) */}
      {stage === 'followup' && workspace && (
        <section className="gj-followup" aria-label="阶段跟进与偏差核对"><div className="gj-card gj-follow-main">
          <div className="sg-row-between">
            <div>
              <h3>阶段跟进 · 对照正式计划核对实绩</h3>
              <p className="sg-muted">
                选用本期实绩，由 Agent 核对可比性、分析偏差。每次检查保留当时的准确版本。
              </p>
            </div>

          </div>

          {/* Check History */}
          <section className="gj-check-results">
            <h3>实绩核对结果</h3>
            {workspace.checks.length ? (
              <ul className="sg-history">
                {workspace.checks.slice().reverse().map(chk => {
                  const issueFieldLabel = (field: string) => ({
                    metric: '指标', scope: '业务范围', unit: '单位', period: '归属期间',
                    coverage: '覆盖范围', maturity: '观察窗', cutoff: '截至时间', plan: '冻结计划', actual: '实绩数值',
                  }[field] ?? field);
                  const focusFieldSelector = (field: string | undefined) => {
                    if (field === 'cutoff') return '[aria-label="实绩数据截至时间"]';
                    if (field === 'metric') return '[aria-label="凭证中的指标定义或 SAP 版本"]';
                    if (field === 'scope') return '[aria-label="凭证所覆盖的业务范围"]';
                    if (field === 'unit') return '[aria-label="凭证单位"]';
                    if (field === 'period') return '[aria-label="凭证归属期间"]';
                    if (field === 'coverage') return '[aria-label="凭证覆盖情况"]';
                    if (field === 'maturity') return '[aria-label="凭证观察窗"]';
                    return '[aria-label="实绩报表原文"]';
                  };
                  const statusBadgeLabel = chk.comparability === 'partial-missing'
                    ? '部分未出数 · 整体偏差待补'
                    : chk.comparability === 'observing'
                      ? '观察窗未满 · 暂不计偏离'
                      : chk.comparability === 'incomparable'
                        ? '口径/期间不可比 · 整体待核'
                        : chk.trigger.triggered
                          ? `已触发偏差提示 (${chk.trigger.type})`
                          : '未触发阈值';
                  const issueSummary = chk.comparabilityIssues?.map(i => i.message).join('；');
                  const openCheckCorrection=async(scopeSuggestion?:string)=>{
                    if(mutationsLocked||busy)return;
                    const ownerKey=draftOwnerKey;
                    setBusy(true);setWsError('');
                    try{
                      const publication=selectedCheckPub?.version===chk.publicationVersion?selectedCheckPub:
                        workspace.activePublication?.version===chk.publicationVersion?workspace.activePublication:
                        (await api.readDecompositionPublication(record.id,chk.publicationVersion)).publication;
                      if(!mounted.current||draftOwnerRef.current!==ownerKey)return;
                      const periodId=chk.periods[0]?.periodId??'';
                      const originalInput=workspace.submittedActuals.find(actual=>actual.actualId===chk.operationId&&actual.input.operationId===chk.operationId&&
                        actual.input.publicationVersion===chk.publicationVersion&&actual.input.rowId===chk.rowId&&actual.input.checkpointId===chk.checkpointId)?.input;
                      const originalPeriod=originalInput?.actualPeriods.find(period=>period.periodId===periodId);
                      const source=originalInput?.actualSource??chk.actualSource;
                      // Keep the original numeric/unit/report tuple together; checked values may already be converted.
                      const sourceBasis=originalInput?originalInput.actualSource.basis??emptyActualInput.checkBasis:
                        chk.submittedBasis??chk.actualSource.basis??emptyActualInput.checkBasis;
                      const key=JSON.stringify([chk.publicationVersion,chk.rowId,chk.checkpointId,periodId]);
                      setSelectedCheckPub(publication);setCheckPubVersion(chk.publicationVersion);setCheckRowId(chk.rowId);setCheckCheckpointId(chk.checkpointId);setCheckPeriodId(periodId);
                      setActualInputs(inputs=>({...inputs,[key]:{
                        ...emptyActualInput,...inputs[key],uploadedName:'',
                        reportText:source.reportText??'',checkSourceRef:source.ref,checkSourceLabel:source.label,
                        checkCutoffAt:source.cutoffAt,checkActualVal:originalPeriod?.actualValue!=null?String(originalPeriod.actualValue):'',
                        checkBasis:{...sourceBasis,...(scopeSuggestion!==undefined?{scope:scopeSuggestion}:{})},
                        checkMissingNote:originalInput?originalInput.missingCoverageNote??source.coverageNote??'':chk.missingCoverageNote??source.coverageNote??'',supplementCheck:chk.checkId,
                      }}));
                      setActualReportOpen(true);setActualBasisOpen(true);
                      if(!originalPeriod)setNotice('原实绩提交或该期间数值暂不可读，数值已留空待核；请核对原报表后再提交。');
                      const selector=focusFieldSelector(scopeSuggestion!==undefined?'scope':chk.comparabilityIssues?.[0]?.field);
                      setTimeout(()=>{if(draftOwnerRef.current===ownerKey)document.querySelector<HTMLElement>(selector)?.focus();},60);
                    }catch(fault){if(mounted.current&&draftOwnerRef.current===ownerKey)setWsError(api.goalError(fault));}
                    finally{if(mounted.current&&draftOwnerRef.current===ownerKey)setBusy(false);}
                  };
                  return (
                  <li key={chk.checkId}><details className="gj-check" open={chk.checkId===workspace.checks.at(-1)?.checkId}><summary>{chk.periods.map(p=>p.label).join('、')} · 拆解正式版 v{chk.publicationVersion} · {chk.actualSource.label} · {comparabilityLabel(chk.comparability)}{chk.checkId===workspace.checks.at(-1)?.checkId?' · 最新检查':''}</summary>
                    <div className="gj-check-body"><GoalFigures items={[
                      {label:'冻结计划',value:chk.periods.length===1?`${chk.periods[0].plannedValue??'待定'}${chk.actualSource.basis?.unit??''}`:'见逐期对照',note:`总 GSA v${chk.gsaPlanVersion} · 拆解 v${chk.publicationVersion}`},
                      {label:'本期实绩',value:chk.periods.length===1?`${chk.periods[0].actualValue??'待补'}${chk.actualSource.basis?.unit??''}`:'见逐期对照',note:chk.actualSource.cutoffAt},
                      {label:'整体偏差',value:chk.overallPending?'待核':chk.overallVariancePct==null?'暂不能计算':`${chk.overallVariancePct}%`,note:chk.overallPending?(issueSummary||chk.missingCoverageNote||chk.trigger.reason):chk.trigger.reason}]}/>
                    <div className="sg-table-scroll"><table className="gj-result-table"><thead><tr><th>检查阶段</th><th>冻结计划</th><th>实绩</th><th>偏差</th></tr></thead><tbody>{chk.periods.map(p=><tr key={p.periodId}><td>{p.label}</td><td>{p.plannedValue??'未定'}</td><td>{p.actualValue??'待补'}</td><td>{p.variancePct==null?'待核':`${p.variancePct}%`}</td></tr>)}</tbody></table></div>
                    {chk.comparabilityIssues && chk.comparabilityIssues.length > 0 && (
                      <div className="gm-validation-box" aria-label="本次待核与冲突项">
                        <strong>具体待核／冲突项（{comparabilityLabel(chk.comparability)}）：</strong>
                        <ul>
                          {chk.comparabilityIssues.map((issue, idx) => (
                            <li key={`${issue.field}-${idx}`}>
                              <strong>{issueFieldLabel(issue.field)}</strong>：{issue.message}
                            </li>
                          ))}
                        </ul>
                        {chk.basisSuggestions?.map((suggestion,index)=>(
                          <div className="gj-note" key={`${suggestion.field}-${index}`}>
                            <strong>业务范围建议（待负责人核对）</strong>
                            <p>原提交「{suggestion.submittedValue}」→ 建议「{suggestion.proposedValue}」</p>
                            <details><summary>查看建议依据</summary><p>{suggestion.rationale}</p><blockquote>{suggestion.evidenceQuote}</blockquote></details>
                            <button type="button" className="secondary-button" disabled={mutationsLocked||busy} onClick={()=>void openCheckCorrection(suggestion.proposedValue)}>将建议范围填入核对表单</button>
                          </div>
                        ))}
                        {!mutationsLocked && (
                          <div className="sg-row">
                            <button
                              type="button"
                              className="secondary-button"
                              disabled={busy}
                              onClick={() => void openCheckCorrection()}
                            >
                              补充／纠正待核项后重新核对
                            </button>
                          </div>
                        )}
                      </div>
                    )}
                    <div className="gj-note"><strong>核对说明</strong><p>{chk.assessmentNote||chk.trigger.reason}</p>{chk.evidenceQuote&&<blockquote>{chk.evidenceQuote}</blockquote>}</div>
                    <details className="gj-details"><summary>本次实绩凭证与准确引用</summary>
                    <div className="sg-row-between">
                      <div>
                        <strong>{chk.checkId} · 拆解版 v{chk.publicationVersion} · {chk.rowId} · {chk.actualSource.label}</strong>{' '}
                        <span className={`sg-badge ${chk.trigger.triggered ? '' : 'pending'}`}>
                          {statusBadgeLabel}
                        </span>
                      </div>
                      <span className="sg-muted">{caseDate(chk.recordedAt)}</span>
                    </div>
                    <p className="sg-muted">
                      {chk.actualSource.cutoffQuote&&<span>截至时间原句「{chk.actualSource.cutoffQuote}」<br/></span>}
                      实绩凭证：{chk.actualSource.ref}（截至 {chk.actualSource.cutoffAt}）·{' '}
                      {chk.overallPending
                        ? `整体偏差：待核（${issueSummary || chk.missingCoverageNote || '未满足口径/覆盖/观察窗条件，不自动折算整体百分比'}）`
                        : `整体绝对差额：${chk.overallAbsoluteDiff ?? '—'} · 整体偏差百分比：${chk.overallVariancePct === null ? '无法计算（计划为 0 或未定）' : `${chk.overallVariancePct}%`}`}
                    </p>
                    {chk.basisResolution && chk.basisResolution.length > 0 && (
                      <div className="gj-note">
                        <strong>口径映射与未知项补充依据</strong>
                        <ul>
                          {chk.basisResolution.map((item, idx) => (
                            <li key={`${item.field}-${idx}`}>
                              {issueFieldLabel(item.field)}（{item.action === 'mapped' ? '口径映射' : '补齐未知项'}）：
                              {item.submittedValue ? `原提交「${item.submittedValue}」→ ` : item.sourceValue ? `原文「${item.sourceValue}」→ ` : ''}
                              采用「{item.adoptedValue}」· 依据：{item.rationale}（原文：「{item.evidenceQuote}」）
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                    {chk.agentAssessmentNote && (
                      <p className="sg-muted">
                        Agent 原始说明（已被结构核验降级，不作为最终结论）：{chk.agentAssessmentNote}
                      </p>
                    )}
                    <p>{chk.trigger.reason}</p></details><h4>本次处理</h4>
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
                  </div></details></li>
                  );
                })}
              </ul>
            ) : (
              <p className="sg-muted">尚无阶段检查记录。</p>
            )}
          </section>

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
            return (
            <div className="gm-card">
              <div className="gj-section-heading"><h3>选用本期实绩</h3><span className="sg-muted">拆解正式版 v{targetPub.version} · {targetRow?.scopeLabel||'总目标'} · {selectedPeriod?.label||'阶段待定'}</span></div>
              <details className="gj-details"><summary>调整检查版本、责任范围与阶段</summary><div className="gm-form-grid">
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
              </div></details><div className="gj-receipts">
                {savedForPeriod.length>0&&<div className="case-field"><strong>选用已保存的实绩</strong>{savedForPeriod.map(actual=>{const assessed=workspace.checks.find(check=>check.operationId===actual.actualId);const receipt=assessed?.actualSource??actual.input.actualSource;return <div className="gm-card" key={actual.actualId}>
                  <p>{receipt.label} · {receipt.cutoffAt||'截至日期待核'} · {receipt.basis?.scope||receipt.coverageNote||'覆盖范围待核'}</p>
                  {receipt.cutoffQuote&&<p>原句「{receipt.cutoffQuote}」</p>}
                  {actual.assessment&&!assessed&&<><p role="status">{actual.assessment.note}</p><button type="button" className="text-button" disabled={mutationsLocked} onClick={()=>{
                    editActual({reportText:actual.input.actualSource.reportText??'',checkSourceRef:actual.input.actualSource.ref,checkSourceLabel:actual.input.actualSource.label,checkCutoffAt:'',checkActualVal:actual.input.actualPeriods[0]?.actualValue?.toString()??'',checkBasis:actual.input.actualSource.basis??emptyActualInput.checkBasis});
                    document.querySelector<HTMLInputElement>('[aria-label="实绩数据截至时间"]')?.focus();
                  }}>补充截至时间后重新核对</button></>}
                  <button type="button" className="secondary-button" disabled={mutationsLocked||busy} onClick={()=>startActualCheck(actual.actualId)}>用这份核对</button>
                </div>})}</div>}
              </div><details className="gj-details gj-report" open={actualReportOpen || savedForPeriod.length===0} onToggle={e => setActualReportOpen(e.currentTarget.open)}><summary>提交新的实绩报表</summary><div className="gm-form-grid">
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
                  <span>实绩凭证名称（上传或粘贴时可自动带入）</span>
                  <input disabled={mutationsLocked}
                    className="gm-input"
                    aria-label="实绩来源凭证引用"
                    placeholder="例如：pos-2027-w02.csv 或 财务日结单号"
                    value={checkSourceRef}
                    onChange={e => editActual({ checkSourceRef: e.target.value })}
                  />
                </label>
                <label className="case-field">
                  <span>实绩数据截至日期（原文明确时由 Agent 提取）</span>
                  <input disabled={mutationsLocked}
                    className="gm-input"
                    aria-label="实绩数据截至时间"
                    placeholder="例如：2027-01-14T23:59:59Z"
                    value={checkCutoffAt}
                    onChange={e => editActual({ checkCutoffAt: e.target.value })}
                  />
                </label>
              </div>
              <details open={actualBasisOpen} onToggle={e => setActualBasisOpen(e.currentTarget.open)}><summary>可选补充数值、口径与覆盖说明</summary>
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
                  <input disabled={mutationsLocked} aria-label="凭证中的指标定义或 SAP 版本" className="gm-input" value={checkBasis.metric} placeholder={original && progressMetric(targetPub.snapshot, original.measurement)} onChange={e => editActual({ checkBasis: {...checkBasis, metric: e.target.value} })} />
                </label>
                <label className="case-field"><span>凭证单位</span><input disabled={mutationsLocked} aria-label="凭证单位" className="gm-input" value={checkBasis.unit} placeholder={rowCheckpoint?.unit ?? selectedPeriod?.unit} onChange={e => editActual({ checkBasis: {...checkBasis, unit: e.target.value} })}/></label>
                <label className="case-field"><span>凭证所覆盖的业务范围</span><input disabled={mutationsLocked} aria-label="凭证所覆盖的业务范围" className="gm-input" value={checkBasis.scope} placeholder={targetRow?.scopeLabel ?? targetPub.snapshot.estimate.scopeDescription} onChange={e => editActual({ checkBasis: {...checkBasis, scope: e.target.value} })}/></label>
                <label className="case-field"><span>凭证归属期间</span><input disabled={mutationsLocked} aria-label="凭证归属期间" className="gm-input" value={checkBasis.periodId} placeholder={selectedPeriod?.periodId} onChange={e => editActual({ checkBasis: {...checkBasis, periodId: e.target.value} })}/></label>
                <label className="case-field"><span>凭证覆盖情况</span>
                  <select disabled={mutationsLocked} aria-label="凭证覆盖情况" className="sg-select" value={checkBasis.coverage} onChange={e => editActual({ checkBasis: {...checkBasis, coverage: e.target.value as ProgressEvidenceBasis['coverage']} })}>
                    <option value="unknown">待核</option><option value="complete">凭证覆盖全范围</option><option value="partial">部分范围未出数</option>
                  </select>
                </label>
                <label className="case-field"><span>凭证观察窗</span>
                  <select disabled={mutationsLocked} aria-label="凭证观察窗" className="sg-select" value={checkBasis.maturity} onChange={e => editActual({ checkBasis: {...checkBasis, maturity: e.target.value as ProgressEvidenceBasis['maturity']} })}>
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
              </button></details>
            </div>
            );
          })() : (
            <p className="sg-muted">尚未发布正式拆解表。若无需拆解表，您仍可直接在下方从已采用 G+S 发起主动试点 Case 草稿。</p>
          )}

          {/* Proactive Pilot Case Draft (works even without decomposition table!) */}
          <details className="gj-details"><summary>另行发起主动试点 Case</summary><div className="gm-card">
            <strong>从已采用 G+S 发起主动试点</strong>
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
          </div></details>
        </div><aside className="gj-card gj-case-rules"><header className="gj-card-head"><h3>Case 提示规则</h3></header><div className="gj-card-body">
          <p>可比实绩达到任一条件时，提示负责人核对已有事项。日／周／月粒度规则互相隔离，续接或新建 Case 由负责人决定。</p>
          {workspace.checks.at(-1)&&(() => {
            const latestChk = workspace.checks.at(-1)!;
            const otherForLatest = !latestChk.thresholdSnapshot.configured
              ? (workspace.thresholdStreams ?? []).filter(t => t.configured && t.metricId === latestChk.metricId && t.periodGranularity && t.periodGranularity !== latestChk.periodGranularity)
              : [];
            return <><h4>最新检查采用的规则</h4><p>
              {granularityLabel(latestChk.periodGranularity)}粒度 · 指标「{latestChk.metricId || '当前目标'}」：{latestChk.thresholdSnapshot.configured ? formatThresholdRule(latestChk.thresholdSnapshot) : '当时尚未配置阈值'}
              {otherForLatest.length > 0 ? `（已配置${otherForLatest.map(t => `${granularityLabel(t.periodGranularity)}粒度`).join('、')}规则，不适用该${granularityLabel(latestChk.periodGranularity)}检查）` : ''}
            </p></>;
          })()}
          <h4>当前检查适用规则</h4>
          {currentCheckGranularity ? (
            currentCheckThreshold?.configured ? (
              <p>适用当前{granularityLabel(currentCheckGranularity)}检查（指标「{currentCheckMetric || '当前目标'}」）：{formatThresholdRule(currentCheckThreshold)}。</p>
            ) : (
              <div>
                <p>
                  当前{granularityLabel(currentCheckGranularity)}检查（指标「{currentCheckMetric || '当前目标'}」）<strong>尚未配置阈值</strong>。
                  {otherConfiguredCheckStreams.length > 0 && (
                    <> 已配置{otherConfiguredCheckStreams.map(t => `${granularityLabel(t.periodGranularity)}粒度（${formatThresholdRule(t)}）`).join('、')}，<strong>不适用当前{granularityLabel(currentCheckGranularity)}检查</strong>。</>
                  )}
                </p>
                {!mutationsLocked && activePub && (
                  <button
                    type="button"
                    className="text-button"
                    onClick={() => {
                      setThreshGranularity(currentCheckGranularity);
                      setThresholdOpen(true);
                    }}
                  >
                    立即配置{granularityLabel(currentCheckGranularity)}粒度阈值
                  </button>
                )}
              </div>
            )
          ) : (
            <p className="sg-muted">发布正式拆解表并选定检查阶段后，按对应指标与周期粒度生效。</p>
          )}
          <h4>按指标与周期配置</h4>
            <details className="gj-details gj-threshold" open={thresholdOpen} onToggle={e => setThresholdOpen(e.currentTarget.open)}>
              <summary>
                偏差提醒设置（{granularityLabel(threshGranularity)}粒度{thresholdMetric ? ` · ${thresholdMetric}` : ''}）· {formatThresholdRule(displayedThreshold)}
                {(currentCheckGranularity && threshGranularity !== currentCheckGranularity) || (currentCheckMetric && thresholdMetric && thresholdMetric !== currentCheckMetric) ? ` · 不适用当前${granularityLabel(currentCheckGranularity)}检查` : ''}
              </summary>
              <div className="sg-row gm-threshold-bar">
                <label>检查周期<select disabled={mutationsLocked} className="sg-select" aria-label="阈值检查周期" value={threshGranularity} onChange={e => setThreshGranularity(e.target.value as DecompositionTimePeriod['granularity'])}><option value="day">日</option><option value="week">周</option><option value="month">月</option></select></label>
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
            </details>
            <button type="button" className="text-button" onClick={onOpenVersions}>查看计划引用</button>
        </div></aside>
        </section>
      )}

      {/* STAGE 3: Cycle Review, Next Cycle Draft & Strategy Return (GM12) */}
      {stage === 'review' && workspace && (
        <section className="sg-panel gm-stage-panel" aria-label="到期复盘与下期起草">
          <header className="gj-review-head"><div><h3>到期复盘</h3><p className="sg-muted">以本期最后生效目标评估达成，由负责人选定要带入下一期的经验。</p></div>
          <details className="gj-review-period"><summary>本期复盘口径 · {reviewPeriod||activeGsaPlan?.formalTarget.period||'待选择'}</summary><label className="case-field">复盘期间<select className="sg-select" value={reviewPeriod||activeGsaPlan?.formalTarget.period||''} onChange={e=>setReviewPeriod(e.target.value)}>{[...new Set(workspace.gsaPlans.map(p=>p.formalTarget.period))].map(period=><option key={period}>{period}</option>)}</select></label></details>
          </header>
          {(reviewPeriod||activeGsaPlan?.formalTarget.period)&&<GoalReviewDraft key={reviewPeriod||activeGsaPlan?.formalTarget.period} goal={goal} workspace={workspace} period={reviewPeriod||activeGsaPlan!.formalTarget.period} disabled={mutationsLocked} onSaved={loadWorkspace} onNext={handleNextCycleDraft}/>}

          <details className="gj-details"><summary>历史复盘记录与战略回送 ({workspace.reviews.length})</summary><div className="gm-section-block">
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
          </div></details>
        </section>
      )}

      {recoveredReceipt && !pendingLocked && (
        <details className="gj-details" aria-label="原发布操作的冻结回执"><summary>原发布操作的冻结回执</summary>
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
        </details>
      )}

      {recoveredGsa&&<details className="gj-details" aria-label="原 GSA 确认回执"><summary>原 GSA 确认回执</summary><strong>原确认回执 · 总 GSA v{recoveredGsa.planVersion}</strong><p>{recoveredGsa.plannedActions.map(action=>[action.summary,action.checkpoint,action.observationBasis].filter(Boolean).join(' · ')).join('；')}</p></details>}
      {stage === 'followup' && Boolean(workspace?.submittedActuals?.length) && <details className="gj-details"><summary>实绩核对对话记录</summary>{workspace?.submittedActuals?.map(actual => {
        const checked = workspace.checks.find(c => c.operationId === actual.actualId);
        return <p key={actual.actualId}><button className="text-button" onClick={() => {setAnalysisTurn(undefined);setAnalysisDialogOpen(true);setAnalysisRequest({kind:'actual', id:actual.actualId});}}>
          {actual.input.actualSource.label} · {checked ? '查看 Agent 核对' : '待 Agent 核对'}
        </button>{checked?.assessmentNote}</p>;
      })}</details>}
      {stage === 'review' && workspace?.nextCycleDrafts.map(draft => <p key={draft.draftId}>
        <button className="text-button" onClick={() => {setAnalysisTurn(undefined);setAnalysisDialogOpen(true);setAnalysisRequest({kind:'next-cycle', id:draft.draftId});}}>
          {draft.nextPeriod} · 查看起草对话
        </button></p>)}
      {analysisOwner && <CaseDialog active={analysisDialogOpen} title={selectedActual ? 'Agent 核对实绩' : 'Agent 起草下一期目标'} busy={false}
        onClose={() => setAnalysisDialogOpen(false)}>
        {selectedActual && <details><summary>查看本次原始实绩</summary>
          <p>{selectedActual.input.actualSource.ref} · 截至 {selectedActual.input.actualSource.cutoffAt||'待 Agent 从原文核对'}</p>
          {selectedActual.input.actualSource.reportText && <pre>{selectedActual.input.actualSource.reportText}</pre>}
        </details>}
        <BusinessRoleConversation owner={analysisOwner} onRunning={setAnalysisRunning} request={analysisRequest&&analysisTurn?.kind===analysisRequest.kind&&analysisTurn.ownerId===analysisRequest.id?analysisTurn.request:undefined} readOnly={mutationsLocked} showInlineTitle={false}
          onSettled={() => void loadWorkspace()} onGoalDraft={selectedCycle ? onGoalDraftSuggestion : undefined} />
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
            <dt>补缺策略预期贡献</dt><dd>{preview.gapStrategies.length} 条，合计 {preview.summary.gapCoverageTotal}{formalUnit}（独立核对预期增量，不与已分配或预留互相抵消）</dd>
            <dt>将正式采用子目标</dt><dd>{preview.committedGoals.length} 条（{preview.committedGoals.map(g => `${g.title} ${g.targetValue ?? '待定'}${g.unit}`).join('、') || '无'}）</dd>
            <dt>非目标行/预留</dt><dd>仅记录，不自动采用为子目标（共 {preview.reserves.length} 笔，预留合计 {preview.summary.reserveTotal}{formalUnit}）</dd>
            <dt>将冻结行级检查点</dt><dd>{preview.committedGoals.reduce((sum, g) => sum + g.checkpoints.length, 0)} 个</dd>
            <dt>草稿身份</dt><dd>总 GSA v{preview.gsaPlan.planVersion} · 草稿 r{preview.draftRevision} · <code>{preview.draftSha256.slice(0, 16)}</code></dd>
          </dl>
          {preview.reserves.length > 0 && <details open>
            <summary>核对预留明细（{preview.reserves.length} 笔，合计 {preview.summary.reserveTotal}{formalUnit}）</summary>
            <ul>{preview.reserves.map((res, idx) => <li key={res.id || idx}>
              <strong>{res.amount}{res.unit || formalUnit}</strong> · 用途：{res.purpose || '未填'} · 负责人：{res.owner || '未填'}
              {res.basis && <p className="sg-muted">依据：{res.basis}</p>}
            </li>)}</ul>
          </details>}
          {preview.gapStrategies.length > 0 && <details open>
            <summary>核对补缺策略明细（{preview.gapStrategies.length} 条，预期贡献合计 {preview.summary.gapCoverageTotal}{formalUnit}）</summary>
            <ul>{preview.gapStrategies.map((gap, idx) => <li key={gap.id || idx}>
              <strong>{gap.name || gap.id || `补缺策略 ${idx + 1}`}</strong> · 预期贡献 {gap.expectedContribution}{gap.unit || formalUnit}
              <p>策略：{gap.strategy || '未填'}</p>
              <p>不重叠范围：{gap.nonOverlappingScope || '未填'}</p>
              <p className="sg-muted">依据：{gap.basis || '未填'}</p>
            </li>)}</ul>
          </details>}
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
