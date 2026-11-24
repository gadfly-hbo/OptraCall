import { useCallback, useEffect, useRef, useState } from 'react';
import { decisionChoiceIssue } from '../../../extensions/business-plugins/studio/enterprise-pack-decisions.ts';
import { PersonalDialog } from './PersonalDialog.tsx';
import type { ClientProject } from './project-types.ts';
import type { StudioSystem } from './studio-api.ts';
import {
  confirmPackPreview,
  createResourceGrant,
  ensureEnterprisePack,
  handlePackFeedback,
  listEnterprisePacks,
  listResourceGrants,
  preparePackPreview,
  readDomainReferenceOriginal,
  readOperatorSession,
  reconcilePackReceipt,
  revokeResourceGrant,
  selectPanoramaRecommendation,
  setPackPurposePreviewExclusion,
  switchOperatorSession,
  upsertPackPurpose,
  type EnterpriseDomainPack,
  type EnterprisePackPreview,
  type EnterprisePackPurpose,
  type GrantAuthorityCredential,
  type GrantAuthorityGuidance,
  type HostOperatorSessionInfo,
  type ResourceAuthorizationGrant,
} from './member-pack-client.ts';
import type {
  EnterprisePanoramaRecommendation,
  ResourceGrantOperation,
} from '../../../extensions/business-plugins/studio/enterprise-pack.ts';
import {
  extractRecommendationStores,
  extractRecommendationWindowDays,
  matchPanoramaRecommendationPurposes,
} from '../../../extensions/business-plugins/studio/enterprise-pack-matching.ts';

const businessStatusText = { active: '已开展', not_launched: '未开展', unknown: '开展情况待核' };
const supportStatusText = {
  ready: '具备建设基础',
  definition_only: '仅可定口径',
  limited_calc: '可做受限计算',
  gap_material: '待补资料',
  gap_decision: '待业务裁定',
  not_needed: '本期无需建设',
};
const tierText = {
  'definition-reference': '定义参考',
  'limited-calculation': '受限计算',
  'formal-calculation': '正式计算',
};
const feedbackCategoryText = {
  task_miscalculation: '本次计算误算（原任务更正）',
  shared_refund_mapping: '共享退款映射（回原资产）',
  sap_formula: 'SAP 指标公式（回 SAP）',
  member_policy: '会员域政策规则（回会员域）',
  case_decision: '经营决定（保留在 Case）',
  ad_hoc_assumption: '临时假设（保留在原任务）',
};
const opText: Record<ResourceGrantOperation, string> = {
  'read-definition': '查阅定义',
  'cite-summary': '引用获准汇总',
  'read-detail-recalculate': '读取明细重算',
};

export interface StudioMemberPackPanelProps {
  enterpriseId: string;
  enterpriseName?: string;
  systems: StudioSystem[];
  projects: ClientProject[];
  currentProjectId?: string;
  operatorProjectReady?: boolean;
  onBuildGoal?: (goal: string, systemId?: string) => void;
  onOpenTask?: (projectId: string, taskId: string) => void;
}

export function StudioMemberPackPanel({
  enterpriseId,
  enterpriseName,
  systems,
  projects,
  currentProjectId,
  operatorProjectReady = true,
  onBuildGoal,
  onOpenTask,
}: StudioMemberPackPanelProps) {
  const [pack, setPack] = useState<EnterpriseDomainPack | null>(null);
  const [grants, setGrants] = useState<ResourceAuthorizationGrant[]>([]);
  const [grantAuthority, setGrantAuthority] = useState<GrantAuthorityCredential | null>(null);
  const [grantAuthorityGuidance, setGrantAuthorityGuidance] = useState<GrantAuthorityGuidance | null>(null);
  const [operatorSession, setOperatorSession] = useState<HostOperatorSessionInfo | null>(null);
  const [opIdInput, setOpIdInput] = useState('');
  const [opDisplayNameInput, setOpDisplayNameInput] = useState('');
  const [opPasscodeInput, setOpPasscodeInput] = useState('');
  const [readOnlyRollback, setReadOnlyRollback] = useState(false);
  const [subTab, setSubTab] = useState<'panorama' | 'draft' | 'publication' | 'history' | 'grants'>('panorama');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const [goalInput, setGoalInput] = useState('');
  const [activePreview, setActivePreview] = useState<EnterprisePackPreview | null>(null);
  const [selectedPurposeIds, setSelectedPurposeIds] = useState<string[]>([]);
  const [editingPurpose, setEditingPurpose] = useState<{
    purpose: EnterprisePackPurpose;
    title: string;
    limitedCalculationName: string;
    businessQuestion: string;
    scopeKey: string;
    completionCriteria: string;
    exclusions: string;
    remainingGaps: string;
    evidenceNote: string;
  } | null>(null);
  const [decisionMap, setDecisionMap] = useState<Record<string, string>>({});
  const [decisionOwnerMap, setDecisionOwnerMap] = useState<Record<string, string>>({});
  const [confirmByInput, setConfirmByInput] = useState('');
  const [ambiguousRecPicker, setAmbiguousRecPicker] = useState<{
    recKey: string;
    rec: EnterprisePanoramaRecommendation;
    candidates: EnterprisePackPurpose[];
    conflictReason?: string;
  } | null>(null);
  const [refExcerptDrawer, setRefExcerptDrawer] = useState<{
    title: string;
    sourceId: string;
    version: string;
    sectionLocator?: string;
    lineRange?: { start: number; end: number; total: number };
    sha256: string;
    text: string;
  } | null>(null);

  // Grant form state (Host verifies grantor authority & summary scope)
  const [grantProjectId, setGrantProjectId] = useState('');
  const [grantOp, setGrantOp] = useState<ResourceGrantOperation>('read-definition');
  const [grantStores, setGrantStores] = useState('');
  const [grantAllowedPaths, setGrantAllowedPaths] = useState('');
  const [grantPurposeKeys, setGrantPurposeKeys] = useState('*');
  const [grantPeriodFrom, setGrantPeriodFrom] = useState('');
  const [grantPeriodTo, setGrantPeriodTo] = useState('');
  const [grantGrain, setGrantGrain] = useState('store-month');
  const [grantSummaryAssetId, setGrantSummaryAssetId] = useState('');
  const [grantSummaryVer, setGrantSummaryVer] = useState('1');
  const [grantBasis, setGrantBasis] = useState('项目用途资源授权');

  const mounted = useRef(true);
  const lastPackIdRef = useRef<string | null>(null);
  const lastPurposeExcludedRef = useRef<Map<string, boolean>>(new Map());

  const syncSelectedPurposes = useCallback((nextPack: EnterpriseDomainPack | null) => {
    if (!nextPack) {
      lastPackIdRef.current = null;
      lastPurposeExcludedRef.current = new Map();
      setSelectedPurposeIds([]);
      return;
    }
    const samePack = lastPackIdRef.current === nextPack.id;
    const prevExcluded = lastPurposeExcludedRef.current;
    const nextExcluded = new Map(nextPack.purposes.map(p => [p.id, Boolean(p.excludedFromPreview)]));
    lastPackIdRef.current = nextPack.id;
    lastPurposeExcludedRef.current = nextExcluded;

    if (!samePack) {
      setSelectedPurposeIds(nextPack.purposes.filter(p => !p.excludedFromPreview).map(p => p.id));
      return;
    }

    setSelectedPurposeIds(prev => {
      const prevSet = new Set(prev);
      const next: string[] = [];
      for (const p of nextPack.purposes) {
        const excluded = Boolean(p.excludedFromPreview);
        if (!prevExcluded.has(p.id)) {
          if (!excluded) next.push(p.id);
        } else if (prevExcluded.get(p.id) !== excluded) {
          if (!excluded) next.push(p.id);
        } else if (prevSet.has(p.id)) {
          next.push(p.id);
        }
      }
      return next;
    });
  }, []);

  const refresh = useCallback(async (signal?: AbortSignal) => {
    if (!operatorProjectReady) return;
    setLoading(true);
    setError('');
    try {
      const [packRes, grantRes, opRes] = await Promise.all([
        listEnterprisePacks(enterpriseId, 'member-operations', signal, currentProjectId),
        listResourceGrants(enterpriseId, undefined, signal, currentProjectId),
        readOperatorSession(signal).catch(() => null),
      ]);
      if (mounted.current && !signal?.aborted) {
        const nextPack = packRes.packs[0] ?? null;
        setPack(nextPack);
        syncSelectedPurposes(nextPack);
        setGrantAuthority(packRes.grantAuthority ?? null);
        setGrantAuthorityGuidance(packRes.grantAuthorityGuidance ?? null);
        setReadOnlyRollback(packRes.readOnlyRollback);
        setGrants(grantRes.grants);
        if (opRes) setOperatorSession(opRes);
      }
    } catch (fault) {
      if (mounted.current && !signal?.aborted) {
        setError(fault instanceof Error ? fault.message : '会员运营资产包暂不可读。');
      }
    } finally {
      if (mounted.current && !signal?.aborted) setLoading(false);
    }
  }, [enterpriseId, currentProjectId, operatorProjectReady, syncSelectedPurposes]);

  useEffect(() => {
    mounted.current = true;
    const controller = new AbortController();
    lastPackIdRef.current = null;
    lastPurposeExcludedRef.current = new Map();
    setPack(null);
    setSelectedPurposeIds([]);
    setGrantAuthority(null);
    setGrantAuthorityGuidance(null);
    setGrants([]);
    void refresh(controller.signal);
    return () => { mounted.current = false; controller.abort(); };
  }, [refresh]);

  const writableProjects = projects.filter(p => !p.archivedAt);
  const primarySystem = systems[0];

  const handleInitPack = async () => {
    if (busy || !primarySystem) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const res = await ensureEnterprisePack({
        requestId: crypto.randomUUID(),
        enterpriseId,
        systemId: primarySystem.id,
        ...(currentProjectId && writableProjects.some(p => p.id === currentProjectId) ? { projectId: currentProjectId } : {}),
        domain: 'member-operations',
        name: `${enterpriseName || '本企业'} · 会员运营资产包`,
      });
      setPack(res.pack);
      syncSelectedPurposes(res.pack);
      setNotice(`已定位企业会员运营包 ${res.pack.packCode}（跨项目保持同一身份）。`);
      await refresh();
    } catch (fault) {
      setError(fault instanceof Error ? fault.message : '未能建立会员运营资产包。');
    } finally {
      setBusy(false);
    }
  };

  const handleTogglePreviewExclusion = async (purpose: EnterprisePackPurpose, excluded: boolean) => {
    if (!pack || busy || readOnlyRollback) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const activePid = currentProjectId && writableProjects.some(p => p.id === currentProjectId) ? currentProjectId : undefined;
      const res = await setPackPurposePreviewExclusion(pack.id, purpose.id, {
        requestId: crypto.randomUUID(),
        ...(activePid ? { projectId: activePid } : {}),
        excluded,
        ...(excluded ? { reason: '发布前明确排除此误建/待定草案（原草案与历史保留）' } : {}),
      });
      setPack(res.pack);
      syncSelectedPurposes(res.pack);
      setNotice(
        excluded
          ? `已将用途「${purpose.limitedCalculationName || purpose.title}」（${purpose.id}）排除出默认预览与发布，原草案记录保留。`
          : `已恢复将用途「${purpose.limitedCalculationName || purpose.title}」（${purpose.id}）纳入默认预览与发布。`,
      );
    } catch (fault) {
      setError(fault instanceof Error ? fault.message : '更新用途预览排除状态失败。');
    } finally {
      setBusy(false);
    }
  };

  const openEditPurpose = (purpose: EnterprisePackPurpose) => {
    setError('');
    setEditingPurpose({
      purpose,
      title: purpose.title,
      limitedCalculationName: purpose.limitedCalculationName ?? '',
      businessQuestion: purpose.businessQuestion,
      scopeKey: purpose.scope.scopeKey,
      completionCriteria: purpose.completionCriteria,
      exclusions: purpose.exclusions.join('\n'),
      remainingGaps: purpose.remainingGaps.join('\n'),
      evidenceNote: purpose.evidenceNotes?.at(-1)?.note ?? '',
    });
  };

  const handleSavePurposeEdit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!pack || !editingPurpose || busy || readOnlyRollback) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const activePid = currentProjectId && writableProjects.some(p => p.id === currentProjectId) ? currentProjectId : undefined;
      const p = editingPurpose.purpose;
      const res = await upsertPackPurpose(pack.id, {
        requestId: crypto.randomUUID(),
        ...(activePid ? { projectId: activePid } : {}),
        targetPurposeId: p.id,
        purposeKey: p.purposeKey,
        title: editingPurpose.title.trim(),
        businessQuestion: editingPurpose.businessQuestion.trim(),
        subjectUnit: p.subjectUnit,
        ...(p.windowDays !== undefined ? { windowDays: p.windowDays } : {}),
        scope: { ...p.scope, scopeKey: editingPurpose.scopeKey.trim() },
        tier: p.tier,
        ...(editingPurpose.limitedCalculationName.trim() ? { limitedCalculationName: editingPurpose.limitedCalculationName.trim() } : {}),
        businessStatus: p.businessStatus,
        evidenceReadiness: p.evidenceReadiness,
        originalGoal: p.originalGoal,
        ...(p.deliveredSubset ? { deliveredSubset: p.deliveredSubset } : {}),
        remainingGaps: editingPurpose.remainingGaps.split('\n').map(s => s.trim()).filter(Boolean),
        exclusions: editingPurpose.exclusions.split('\n').map(s => s.trim()).filter(Boolean),
        completionCriteria: editingPurpose.completionCriteria.trim(),
        ...(p.dependencies.length ? { dependencies: p.dependencies } : {}),
        ...(p.decisionChoices?.length ? { decisionChoices: p.decisionChoices } : {}),
        ...(p.policyEffectiveFrom ? { policyEffectiveFrom: p.policyEffectiveFrom } : {}),
        ...(p.dataCutoffAt ? { dataCutoffAt: p.dataCutoffAt } : {}),
        ...(p.observationWindowDays !== undefined ? { observationWindowDays: p.observationWindowDays } : {}),
        ...(p.availableHistoryDays !== undefined ? { availableHistoryDays: p.availableHistoryDays } : {}),
        ...(p.ownerRole ? { ownerRole: p.ownerRole } : {}),
        ...(editingPurpose.evidenceNote.trim() && editingPurpose.evidenceNote.trim() !== (p.evidenceNotes?.at(-1)?.note ?? '')
          ? { evidenceNote: { projectId: activePid ?? currentProjectId ?? projects[0]?.id ?? 'studio', note: editingPurpose.evidenceNote.trim(), sourceRefs: [] } }
          : {}),
      });
      setPack(res.pack);
      syncSelectedPurposes(res.pack);
      setEditingPurpose(null);
      setNotice(`已更新用途草案「${res.purpose.limitedCalculationName || res.purpose.title}」（${res.purpose.id}）。`);
    } catch (fault) {
      setError(fault instanceof Error ? fault.message : '保存用途草案修改失败。');
    } finally {
      setBusy(false);
    }
  };

  const handlePreparePreview = async () => {
    if (!pack || busy || !pack.purposes.length) return;
    setError('');
    setNotice('');
    const includedPurposes = pack.purposes.filter(p => selectedPurposeIds.includes(p.id));
    if (!includedPurposes.length) {
      setError('请至少勾选一个纳入本次发布预览的用途；已排除的误建草案将不会进入预览与发布。');
      return;
    }
    // Validate explicit user decision choices and explicit deciders ONLY for included purposes — NEVER silently fall back to options[0] or hardcoded decider!
    const decisions: { purposeId: string; choiceId: string; selectedKey: string; decidedBy: string }[] = [];
    for (const p of includedPurposes) {
      if (decisionChoiceIssue(p.decisionChoices)) {
        setError(`用途「${p.title}」的经营取舍资料不完整。请在原建设任务修订，或取消勾选该用途后继续预览。`);
        return;
      }
      for (const c of p.decisionChoices) {
        const key = (decisionMap[`${p.id}:${c.id}`] ?? c.selectedKey ?? '').trim();
        const owner = (decisionOwnerMap[`${p.id}:${c.id}`] ?? c.decidedBy ?? '').trim();
        if (!key) {
          setError(`用途「${p.limitedCalculationName || p.title}」的经营取舍「${c.question}」尚未选定，请先明确选择。`);
          return;
        }
        if (!owner) {
          setError(`请填写经营取舍「${c.question}」的实际决定人（不自动填充固定角色）。`);
          return;
        }
        decisions.push({ purposeId: p.id, choiceId: c.id, selectedKey: key, decidedBy: owner });
      }
    }
    setBusy(true);
    try {
      const nextNum = pack.packRevisions.length;
      const version = nextNum === 0 ? '1.0' : `1.${nextNum}`;
      const previousVersion = pack.packRevisions.at(-1)?.version;
      const res = await preparePackPreview(pack.id, {
        requestId: crypto.randomUUID(),
        ...(currentProjectId && writableProjects.some(p => p.id === currentProjectId) ? { projectId: currentProjectId } : {}),
        version,
        ...(previousVersion ? { previousVersion } : {}),
        purposeIds: includedPurposes.map(p => p.id),
        decisions,
        policyEffectiveFrom: includedPurposes[0]?.policyEffectiveFrom || pack.purposes[0]?.policyEffectiveFrom || new Date().toISOString().slice(0, 10),
        dataCutoffAt: includedPurposes[0]?.dataCutoffAt || pack.purposes[0]?.dataCutoffAt || new Date().toISOString().slice(0, 10),
        summary: `会员运营资产包 v${version} 按用途发布预览（纳入 ${includedPurposes.length}/${pack.purposes.length} 项）`,
      });
      setPack(res.pack);
      setActivePreview(res.preview);
      setSubTab('publication');
      setNotice(`已生成一份发布预览 v${version}（仅纳入选中的 ${includedPurposes.length} 项用途），确认后将由 Host 直连原 Studio/SAP/资料库权威执行发布并记录真实回执。`);
    } catch (fault) {
      setError(fault instanceof Error ? fault.message : '准备发布预览未能完成。');
    } finally {
      setBusy(false);
    }
  };

  const handleConfirmPreview = async (preview: EnterprisePackPreview) => {
    if (!pack || busy) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      // Browser NEVER fabricates moduleReceipts; Host executes real original authorities and records actual receipts!
      const res = await confirmPackPreview(pack.id, {
        requestId: crypto.randomUUID(),
        ...(currentProjectId && writableProjects.some(p => p.id === currentProjectId) ? { projectId: currentProjectId } : {}),
        previewId: preview.id,
        fingerprint: preview.fingerprint,
        ...(confirmByInput.trim() ? { confirmedBy: confirmByInput.trim() } : {}),
      });
      setPack(res.pack);
      setActivePreview(null);
      const suspendedCount = res.revision.purposeManifests.filter(pm => pm.status !== 'eligible').length;
      setNotice(
        suspendedCount > 0
          ? `已完成 v${res.revision.version} 原权威分项核验；有 ${suspendedCount} 项用途因依赖/前置核验未通过保持挂起，独立合格项已入目录。`
          : `已完成 v${res.revision.version} 原权威分项发布确认；首次独立使用仍需在新分析任务中分别验证。`,
      );
    } catch (fault) {
      setError(fault instanceof Error ? fault.message : '确认发布未能完成。');
    } finally {
      setBusy(false);
    }
  };

  const handleReconcile = async (version: string, targetRequestId: string) => {
    if (!pack || busy) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      // Browser NEVER sends status='succeeded'; Host performs read-only check against the real original authority!
      const res = await reconcilePackReceipt(pack.id, {
        requestId: crypto.randomUUID(),
        ...(currentProjectId && writableProjects.some(p => p.id === currentProjectId) ? { projectId: currentProjectId } : {}),
        version,
        targetRequestId,
      });
      setPack(res.pack);
      const latest = [...res.revision.moduleReceipts].reverse().find(r => r.requestId === targetRequestId);
      setNotice(
        latest?.status === 'succeeded'
          ? `已在原权威只读核实 ${targetRequestId} 已正式发布并恢复依赖用途资格；原历史轨迹完整保留。`
          : `已向原权威只读核查 ${targetRequestId}，当前结果仍为 ${latest?.status ?? 'unknown'}（${latest?.detail ?? ''}），未强行恢复。`,
      );
    } catch (fault) {
      setError(fault instanceof Error ? fault.message : '核查原回执未能完成。');
    } finally {
      setBusy(false);
    }
  };

  const handleToggleRecommendation = async (rec: EnterprisePanoramaRecommendation, selected: boolean) => {
    if (!pack || busy || readOnlyRollback) return;
    setBusy(true);
    setError('');
    try {
      const res = await selectPanoramaRecommendation(pack.id, {
        requestId: crypto.randomUUID(),
        ...(currentProjectId && writableProjects.some(p => p.id === currentProjectId) ? { projectId: currentProjectId } : {}),
        purposeKey: rec.purposeKey,
        ...(rec.targetPurposeId ? { targetPurposeId: rec.targetPurposeId } : {}),
        ...(rec.scopeKey ? { scopeKey: rec.scopeKey } : {}),
        title: rec.title,
        selected,
      });
      setPack(res.pack);
      setNotice(selected ? `已将建议「${rec.title}」选入本轮建设范围。` : `已取消建议「${rec.title}」的本轮选中状态。`);
    } catch (fault) {
      setError(fault instanceof Error ? fault.message : '更新全景建议选择失败。');
    } finally {
      setBusy(false);
    }
  };

  const executeRecommendationContinuation = async (
    rec: EnterprisePanoramaRecommendation,
    existingPurpose?: EnterprisePackPurpose,
    scopeConflictCount = 0,
  ) => {
    if (!pack || !pack.panorama || busy || readOnlyRollback) return;
    setBusy(true);
    setError('');
    setNotice('');
    setAmbiguousRecPicker(null);
    try {
      const activePid = currentProjectId && writableProjects.some(p => p.id === currentProjectId) ? currentProjectId : undefined;
      if (!rec.selected) {
        await selectPanoramaRecommendation(pack.id, {
          requestId: crypto.randomUUID(),
          ...(activePid ? { projectId: activePid } : {}),
          purposeKey: rec.purposeKey,
          ...(rec.targetPurposeId ? { targetPurposeId: rec.targetPurposeId } : {}),
          ...(rec.scopeKey ? { scopeKey: rec.scopeKey } : {}),
          title: rec.title,
          selected: true,
        });
      }
      const parsedRecWindow = extractRecommendationWindowDays(rec);
      const parsedRecStores = extractRecommendationStores(
        rec,
        pack.purposes.flatMap(p => p.scope.stores ?? []),
      );
      const preservedScope = existingPurpose
        ? {
            ...existingPurpose.scope,
            brand: existingPurpose.scope.brand ?? pack.panorama.brand,
            channel: existingPurpose.scope.channel ?? pack.panorama.channel,
            period: existingPurpose.scope.period ?? pack.panorama.period,
            scopeKey: existingPurpose.scope.scopeKey,
          }
        : {
            brand: pack.panorama.brand,
            channel: pack.panorama.channel,
            period: pack.panorama.period,
            ...(parsedRecStores.length ? { stores: parsedRecStores } : {}),
            scopeKey: rec.scopeKey || `${pack.panorama.brand}:${pack.panorama.channel}:${parsedRecStores.join('/') || pack.panorama.period}:${rec.purposeKey}${parsedRecWindow ? `:${parsedRecWindow}d` : ''}`,
          };
      const effectiveWindow = existingPurpose?.windowDays ?? parsedRecWindow;
      const upserted = await upsertPackPurpose(pack.id, {
        requestId: crypto.randomUUID(),
        ...(activePid ? { projectId: activePid } : {}),
        ...(existingPurpose ? { targetPurposeId: existingPurpose.id } : {}),
        purposeKey: rec.purposeKey,
        title: existingPurpose?.title || rec.title,
        businessQuestion: existingPurpose?.businessQuestion || `${pack.panorama.decisionPurpose}（聚焦：${rec.title}）`,
        subjectUnit: existingPurpose?.subjectUnit ?? 'brand_account',
        ...(effectiveWindow !== undefined ? { windowDays: effectiveWindow } : {}),
        scope: preservedScope,
        tier: existingPurpose?.tier ?? 'definition-reference',
        ...(existingPurpose?.limitedCalculationName ? { limitedCalculationName: existingPurpose.limitedCalculationName } : {}),
        businessStatus: existingPurpose?.businessStatus ?? 'active',
        ...(existingPurpose?.evidenceReadiness ? { evidenceReadiness: existingPurpose.evidenceReadiness } : {}),
        originalGoal: existingPurpose?.originalGoal || rec.deliverableNow,
        ...(existingPurpose?.deliveredSubset ? { deliveredSubset: existingPurpose.deliveredSubset } : {}),
        remainingGaps: existingPurpose?.remainingGaps.length
          ? existingPurpose.remainingGaps
          : (rec.minimumEvidence ? [rec.minimumEvidence] : []),
        exclusions: existingPurpose?.exclusions ?? [],
        completionCriteria: existingPurpose?.completionCriteria || rec.completionCriteria,
        ...(existingPurpose?.dependencies.length ? { dependencies: existingPurpose.dependencies } : {}),
        ...(existingPurpose?.decisionChoices?.length ? { decisionChoices: existingPurpose.decisionChoices } : {}),
        ...(existingPurpose?.policyEffectiveFrom ? { policyEffectiveFrom: existingPurpose.policyEffectiveFrom } : {}),
        dataCutoffAt: existingPurpose?.dataCutoffAt || pack.panorama.dataCutoffAt,
        ...(existingPurpose?.observationWindowDays !== undefined ? { observationWindowDays: existingPurpose.observationWindowDays } : {}),
        ...(existingPurpose?.availableHistoryDays !== undefined ? { availableHistoryDays: existingPurpose.availableHistoryDays } : {}),
        ...(existingPurpose?.ownerRole ? { ownerRole: existingPurpose.ownerRole } : rec.ownerRole ? { ownerRole: rec.ownerRole } : {}),
      });
      const storesLabel = preservedScope.stores?.length ? `；门店：${preservedScope.stores.join('、')}` : '';
      const windowLabel = upserted.purpose.windowDays !== undefined ? `；窗口：${upserted.purpose.windowDays}日` : '';
      const scopeIsolationNote = !existingPurpose && scopeConflictCount > 0
        ? '（保留原单店/子范围，未扩大并入既有宽范围用途）'
        : '';
      const continuationGoal = `请沿企业会员包 ${pack.packCode} 全景 v${pack.panorama.version} 原范围继续建设用途「${upserted.purpose.limitedCalculationName || upserted.purpose.title}」（purposeId: ${upserted.purpose.id}；purposeKey: ${rec.purposeKey}；scopeKey: ${preservedScope.scopeKey}；品牌：${preservedScope.brand ?? pack.panorama.brand}；渠道：${preservedScope.channel ?? pack.panorama.channel}；期间：${preservedScope.period ?? pack.panorama.period}${storesLabel}${windowLabel}；资料截止：${upserted.purpose.dataCutoffAt ?? pack.panorama.dataCutoffAt}；完成条件：${upserted.purpose.completionCriteria}；最小补证：${rec.minimumEvidence}）。请直接更新同一用途草案与条目，不要新建重复事项。`;
      setGoalInput(continuationGoal);
      setPack(upserted.pack);
      setSubTab('draft');
      setNotice(`已按全景建议「${upserted.purpose.limitedCalculationName || rec.title}」携带原范围（${preservedScope.brand ?? pack.panorama.brand} · ${preservedScope.channel ?? pack.panorama.channel}${storesLabel}${windowLabel} · 截止 ${upserted.purpose.dataCutoffAt ?? pack.panorama.dataCutoffAt}）${upserted.created ? '新建' : '复用'}用途草案（${upserted.purpose.id}）${scopeIsolationNote}并接入原建设会话。`);
      if (onBuildGoal) {
        onBuildGoal(continuationGoal, pack.systemId);
      }
    } catch (fault) {
      setError(fault instanceof Error ? fault.message : '从全景建议续建失败。');
    } finally {
      setBusy(false);
    }
  };

  const handleContinueFromRecommendation = async (rec: EnterprisePanoramaRecommendation, recKey: string) => {
    if (!pack || !pack.panorama || busy || readOnlyRollback) return;
    const match = matchPanoramaRecommendationPurposes(pack.purposes, rec);
    if (match.ambiguous || match.conflictReason) {
      setAmbiguousRecPicker({
        recKey,
        rec,
        candidates: match.candidates,
        ...(match.conflictReason ? { conflictReason: match.conflictReason } : {}),
      });
      setNotice(
        match.conflictReason
          ? match.conflictReason
          : `同类用途「${rec.purposeKey}」下存在 ${match.candidates.length} 个不同范围用途，请明确选择要续建的原用途或新建独立范围。`,
      );
      return;
    }
    await executeRecommendationContinuation(rec, match.matched, match.scopeConflictCandidates?.length ?? 0);
  };

  const handleSwitchOperator = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy || !opIdInput.trim() || opPasscodeInput.length < 4) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const res = await switchOperatorSession({
        action: 'register',
        operatorId: opIdInput.trim(),
        ...(opDisplayNameInput.trim() ? { displayName: opDisplayNameInput.trim() } : {}),
        passcode: opPasscodeInput,
        ...(currentProjectId ? { activeProjectId: currentProjectId } : {}),
      });
      setOperatorSession(res);
      setOpPasscodeInput('');
      setNotice(`已切换 Host 认证操作者：${res.operator.displayName || res.operator.operatorId}（${res.operator.operatorId}）。`);
      await refresh();
    } catch (fault) {
      setError(fault instanceof Error ? fault.message : '操作者身份验证失败。');
    } finally {
      setBusy(false);
    }
  };

  const handleInspectRefExcerpt = async (link: EnterpriseDomainPack['entries'][number]['referenceLinks'][number]) => {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const res = await readDomainReferenceOriginal(link.refId, link.sectionLocator || undefined, enterpriseId);
      setRefExcerptDrawer({
        title: res.record.title,
        sourceId: res.record.sourceId,
        version: res.record.version,
        sectionLocator: res.sectionLocator ?? link.sectionLocator,
        lineRange: res.lineRange,
        sha256: res.excerptSha256 ?? res.sha256,
        text: res.text,
      });
    } catch (fault) {
      setError(fault instanceof Error ? fault.message : '读取参考原段失败。');
    } finally {
      setBusy(false);
    }
  };

  const handleRouteFeedbackToAuthority = async (fb: EnterpriseDomainPack['feedbackItems'][number]) => {
    if (!pack || busy) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const res = await handlePackFeedback(pack.id, fb.id, {
        requestId: crypto.randomUUID(),
        ...(currentProjectId && writableProjects.some(p => p.id === currentProjectId) ? { projectId: currentProjectId } : {}),
        status: fb.targetAuthority === 'task' ? 'retained_in_task' : 'investigating',
        note: `已按归属（${fb.targetAuthority}）在原 Studio 登记关联工作项与反馈，仅重核受影响用途。`,
        impactedPurposeIds: fb.purposeIds,
      });
      setPack(res.pack);
      const workItemTag = res.feedback.authorityHandling?.studioWorkItemId ? `（Studio 关联工作项 ${res.feedback.authorityHandling.studioWorkItemId.slice(0, 8)}…）` : '';
      setNotice(`事项 ${fb.feedbackCode} 已转入原权威处理（${fb.targetAuthority}）${workItemTag}；不受影响用途与旧报告保持原样。`);
    } catch (fault) {
      setError(fault instanceof Error ? fault.message : '更新反馈处理状态失败。');
    } finally {
      setBusy(false);
    }
  };

  const handleContinueFeedbackInSession = async (fb: EnterpriseDomainPack['feedbackItems'][number]) => {
    if (!pack || !primarySystem || !onBuildGoal || busy || readOnlyRollback) return;
    let workItemId = fb.authorityHandling?.studioWorkItemId;
    if (!workItemId && fb.targetAuthority !== 'task') {
      setBusy(true);
      setError('');
      try {
        const res = await handlePackFeedback(pack.id, fb.id, {
          requestId: crypto.randomUUID(),
          ...(currentProjectId && writableProjects.some(p => p.id === currentProjectId) ? { projectId: currentProjectId } : {}),
          status: 'investigating',
          note: `已创建原 Studio 关联工作项并转入建设会话修订（归属 ${fb.targetAuthority}）。`,
          impactedPurposeIds: fb.purposeIds,
        });
        setPack(res.pack);
        workItemId = res.feedback.authorityHandling?.studioWorkItemId;
      } catch (fault) {
        setError(fault instanceof Error ? fault.message : '建立原权威关联工作项失败。');
        setBusy(false);
        return;
      } finally {
        setBusy(false);
      }
    }
    onBuildGoal(
      `处理会员包反馈 ${fb.feedbackCode}（${fb.title}，归属 ${fb.targetAuthority}${workItemId ? `，原 Studio 关联工作项 ${workItemId}` : ''}${fb.targetAssetRef ? `，目标原资产 ${fb.targetAssetRef.authority}:${fb.targetAssetRef.id}@${fb.targetAssetRef.version}` : ''}）：请在原权威核查并仅修订受影响用途（${fb.purposeIds.join('、') || '待核定'}），不改动未受影响用途与历史报告。`,
      primarySystem.id,
    );
  };

  const handleAddGrant = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy || !grantProjectId || readOnlyRollback) return;
    if (!grantAuthority) {
      setError('当前项目不具备本企业包/体系的原权责授权凭据，无法授予资源权限。');
      return;
    }
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const ops: ResourceGrantOperation[] = grantOp === 'read-definition'
        ? ['read-definition']
        : grantOp === 'cite-summary'
          ? ['read-definition', 'cite-summary']
          : ['read-definition', 'read-detail-recalculate'];
      const stores = grantStores.split(/[、,，\s]+/).map(s => s.trim()).filter(Boolean);
      const allowedDataPaths = grantAllowedPaths.split(/[、,，\s]+/).map(s => s.trim()).filter(Boolean);
      const purposeKeys = grantPurposeKeys.split(/[、,，]+/).map(s => s.trim()).filter(Boolean);
      if (!purposeKeys.length) { setError('授权用途不能为空；请填写至少一个 purposeKey 或 * 表示全部用途。'); setBusy(false); return; }
      await createResourceGrant({
        requestId: crypto.randomUUID(),
        enterpriseId,
        grantorProjectId: grantAuthority.ownerProjectId,
        grantorSystemId: grantAuthority.systemId,
        ...(grantAuthority.ownerTaskId ? { grantorTaskId: grantAuthority.ownerTaskId } : {}),
        authorityToken: grantAuthority.authorityToken,
        grantBasis: grantBasis.trim() || '项目资源授权',
        subjectType: 'project',
        subjectId: grantProjectId,
        resourceKind: grantOp === 'read-definition' ? 'definition' : grantOp === 'cite-summary' ? 'summary' : 'detail',
        operations: ops,
        purposeKeys,
        scope: {
          ...(stores.length ? { stores } : {}),
          ...(allowedDataPaths.length ? { allowedDataPaths } : {}),
          ...(grantPeriodFrom.trim() ? { periodFrom: grantPeriodFrom.trim() } : {}),
          ...(grantPeriodTo.trim() ? { periodTo: grantPeriodTo.trim() } : {}),
          ...(grantOp === 'cite-summary' ? { summaryAssetId: grantSummaryAssetId.trim(), summaryVersion: grantSummaryVer.trim() || '1', grain: grantGrain.trim() || 'store-month' } : {}),
        },
      });
      await refresh();
      setNotice('已保存资源授权记录（授予方与汇总范围由 Host 按原权责凭据与原权威资产核验）；客户端角色名不产生权限。');
    } catch (fault) {
      setError(fault instanceof Error ? fault.message : '保存资源授权未能完成。');
    } finally {
      setBusy(false);
    }
  };

  const handleRevokeGrant = async (grantId: string) => {
    if (busy) return;
    if (!grantAuthority) {
      setError('当前项目不具备本企业包/体系的原权责授权凭据，无法撤回资源权限。');
      return;
    }
    setBusy(true);
    setError('');
    try {
      await revokeResourceGrant(grantId, '权限复核撤回', crypto.randomUUID(), grantAuthority.ownerProjectId, {
        authorityToken: grantAuthority.authorityToken,
        revokerSystemId: grantAuthority.systemId,
        revokerTaskId: grantAuthority.ownerTaskId,
      });
      await refresh();
      setNotice('已撤回该项资源授权；活跃任务隔离工作区与后续查询将立即停止供给受影响项，原历史报告保留。');
    } catch (fault) {
      setError(fault instanceof Error ? fault.message : '撤回授权未能完成。');
    } finally {
      setBusy(false);
    }
  };

  if (!operatorProjectReady) return null;
  const latestRevision = pack?.packRevisions.find(r => r.status === 'active') ?? pack?.packRevisions.at(-1);
  const isNamedOperator = Boolean(operatorSession?.operator.verified && operatorSession.operator.operatorId.startsWith('op:'));

  return (
    <section className="studio-record studio-member-pack" aria-label="企业会员运营资产包">
      <div className="studio-row">
        <div>
          <h3>企业会员运营资产包 {pack ? `· ${pack.packCode}` : ''}</h3>
          <p className="studio-meta">
            同一企业包承接企业线与会员线两条路线；跨人跨项目保持同一包身份，按用途发布、三层鉴权并保留原报告与修订历史。
          </p>
        </div>
        {!pack && primarySystem && !readOnlyRollback && (
          <button type="button" className="primary-button" disabled={busy} onClick={() => { void handleInitPack(); }}>
            初始化本企业会员运营包
          </button>
        )}
      </div>

      {!readOnlyRollback && !operatorSession?.customResolver && (!pack || !isNamedOperator) && (
        <div className={`studio-note ${isNamedOperator ? '' : 'is-warning'}`} role="region" aria-label="企业包维护人身份设置">
          <p>
            <strong>当前 Host 维护身份：</strong>
            {isNamedOperator
              ? `${operatorSession!.operator.displayName || operatorSession!.operator.operatorId}（${operatorSession!.operator.operatorId} · 可复用具名维护身份，换浏览器可重新登录并管理授权）`
              : operatorSession?.operator.verified
                ? `临时浏览器会话（${operatorSession.operator.operatorId}）· 若用临时会话建包，换浏览器后无法重新认证。建议在首次建包前先建立或登录可复用的具名维护身份。`
                : '未认证操作者 · 请先建立或登录具名维护身份后再建包或管理资源授权。'}
          </p>
          <form onSubmit={e => { void handleSwitchOperator(e); }} className="studio-row" style={{ marginTop: 8, gap: 8, flexWrap: 'wrap' }}>
            <input
              aria-label="维护人操作者标识"
              placeholder="维护人 ID（如 yalan-ops）"
              value={opIdInput}
              onChange={e => setOpIdInput(e.target.value)}
            />
            <input
              aria-label="维护人姓名或岗位"
              placeholder="姓名/岗位（可选）"
              value={opDisplayNameInput}
              onChange={e => setOpDisplayNameInput(e.target.value)}
            />
            <input
              type="password"
              aria-label="维护人口令"
              placeholder="口令（至少4位）"
              value={opPasscodeInput}
              onChange={e => setOpPasscodeInput(e.target.value)}
            />
            <button type="submit" className="secondary-button" disabled={busy || !opIdInput.trim() || opPasscodeInput.length < 4}>
              建立/登录具名维护身份
            </button>
          </form>
        </div>
      )}

      {readOnlyRollback && (
        <div className="studio-note is-warning" role="status">
          当前以回退只读模式运行（<code>--disable-member-pack</code>）：已有包版本、回执与历史依据保留只读，新写入与供给已停止。
        </div>
      )}
      {error && <div className="studio-note is-error" role="alert">{error}</div>}
      {notice && <div className="studio-note" role="status">{notice}</div>}
      {loading && <p className="studio-meta" role="status">正在核对本企业会员运营资产包…</p>}

      {!loading && !pack && !primarySystem && (
        <p className="studio-meta">先建立或登录上方的可复用具名维护身份，再在本企业建立一个体系，即可承接会员运营资产包；点名用途可直接发起建设，无需先填全景。</p>
      )}

      {pack && (
        <>
          <nav className="studio-foundation-nav" aria-label="会员运营资产包视图">
            {([
              ['panorama', '覆盖与全景'],
              ['draft', `建设草案 (${pack.entries.length} 条 / ${pack.purposes.length} 用途)`],
              ['publication', `一份预览与分项回执 (${pack.packRevisions.length})`],
              ['history', `反馈、修订与历史 (${pack.feedbackItems.length})`],
              ['grants', `三层资源授权 (${grants.filter(g => !g.revokedAt).length})`],
            ] as const).map(([key, label]) => (
              <button key={key} type="button" aria-pressed={subTab === key} onClick={() => setSubTab(key)}>
                {label}
              </button>
            ))}
          </nav>

          {subTab === 'panorama' && (
            <div className="studio-member-pack-section">
              <div className="studio-row">
                <label className="studio-field" style={{ flex: 1 }}>
                  <span>本轮建设目标（宽目标出全景，点名用途如门店复购/身份归属/生日券/活跃/沉睡可直达）</span>
                  <input
                    value={goalInput}
                    placeholder="例如：盘点会员运营现状并给首批建设建议，或直接建设门店首购 30 日复购率"
                    onChange={e => setGoalInput(e.target.value)}
                  />
                </label>
                {onBuildGoal && (
                  <button
                    type="button"
                    className="primary-button"
                    disabled={readOnlyRollback}
                    onClick={() => onBuildGoal(goalInput.trim() || '请按获准资料梳理本企业会员运营全景与首批建设建议，区分已开展/未开展/待核及用途缺口。', pack.systemId)}
                  >
                    在建设任务中推进
                  </button>
                )}
              </div>

              {pack.panorama ? (
                <>
                  <div className="studio-note">
                    <strong>本企业会员运营全景 · v{pack.panorama.version}</strong>
                    <p className="studio-meta">
                      {pack.panorama.brand} · {pack.panorama.channel} · 期间 {pack.panorama.period} · 资料截止 {pack.panorama.dataCutoffAt} · 经营目的：{pack.panorama.decisionPurpose}
                    </p>
                  </div>
                  {pack.panorama.recommendations.length > 0 && (
                    <section className="studio-record">
                      <h4>首批建设建议（可选定并携带原范围直接续建）</h4>
                      {pack.panorama.recommendations.map((rec, recIdx) => {
                        const recKey = `${rec.purposeKey}:${rec.targetPurposeId ?? rec.scopeKey ?? rec.title}:${recIdx}`;
                        const showDisambiguator = ambiguousRecPicker?.recKey === recKey;
                        return (
                          <article key={recKey} className="studio-coverage">
                            <div className="studio-row">
                              <label className="studio-inline-check">
                                <input
                                  type="checkbox"
                                  checked={Boolean(rec.selected)}
                                  disabled={busy || readOnlyRollback}
                                  onChange={e => { void handleToggleRecommendation(rec, e.target.checked); }}
                                />
                                <strong>{rec.title}</strong>
                              </label>
                              <span className="studio-badge">{rec.ownerRole}</span>
                            </div>
                            <p>{rec.priorityReason}</p>
                            <p className="studio-meta">可先交付：{rec.deliverableNow} · 最小补证：{rec.minimumEvidence}</p>
                            <p className="studio-meta">完成条件：{rec.completionCriteria}</p>
                            {!readOnlyRollback && (
                              <div className="studio-actions">
                                <button
                                  type="button"
                                  className="secondary-button"
                                  disabled={busy}
                                  onClick={() => { void handleContinueFromRecommendation(rec, recKey); }}
                                >
                                  按此建议携带原范围续建
                                </button>
                              </div>
                            )}
                            {showDisambiguator && (
                              <div className="studio-note is-warning" role="region" aria-label={ambiguousRecPicker.conflictReason ? '用途标识与建议范围冲突' : '选择同用途续建范围'}>
                                <p>
                                  <strong>
                                    {ambiguousRecPicker.conflictReason
                                      ? `用途标识与建议范围冲突：${ambiguousRecPicker.conflictReason}`
                                      : '存在多个同类型不同范围用途，请明确选择续建目标（不自动代入首个用途）：'}
                                  </strong>
                                </p>
                                <div className="studio-actions">
                                  <button
                                    type="button"
                                    className={ambiguousRecPicker.conflictReason ? 'primary-button' : 'text-button'}
                                    disabled={busy}
                                    onClick={() => { void executeRecommendationContinuation(rec, undefined, ambiguousRecPicker.candidates.length); }}
                                  >
                                    按建议原范围新建独立用途
                                  </button>
                                  {ambiguousRecPicker.candidates.map(cand => (
                                    <button
                                      key={cand.id}
                                      type="button"
                                      className="secondary-button"
                                      disabled={busy}
                                      onClick={() => { void executeRecommendationContinuation(rec, cand); }}
                                    >
                                      {ambiguousRecPicker.conflictReason ? '仍改选已有宽范围用途 ' : '续建 '}
                                      {cand.id} · {cand.limitedCalculationName || cand.title}
                                      {cand.scope.stores?.length ? `（${cand.scope.stores.join('、')}）` : ''}
                                      {cand.windowDays ? ` · ${cand.windowDays}日` : ''}
                                    </button>
                                  ))}
                                  <button
                                    type="button"
                                    className="text-button"
                                    onClick={() => setAmbiguousRecPicker(null)}
                                  >
                                    取消
                                  </button>
                                </div>
                              </div>
                            )}
                          </article>
                        );
                      })}
                    </section>
                  )}
                  <section className="studio-record">
                    <h4>按经营问题查看业务现状与用途缺口</h4>
                    {pack.panorama.issues.map(iss => (
                      <details key={iss.id} className="studio-coverage">
                        <summary>
                          <strong>{iss.problemName}</strong> · {businessStatusText[iss.businessStatus]} · {supportStatusText[iss.assetSupportStatus]} ({iss.factOrInference === 'fact' ? '事实' : '推断'})
                        </summary>
                        <p>{iss.summary}</p>
                        <p className="studio-meta">对决定的影响：{iss.decisionImpact} · 下一步：{iss.nextStep}</p>
                        {iss.evidence.length > 0 && (
                          <ul>
                            {iss.evidence.map((ev, idx) => (
                              <li key={idx} className="studio-meta">
                                {ev.sourceRef.title || ev.sourceRef.id} ({ev.locator}) · 范围：{ev.scope}
                              </li>
                            ))}
                          </ul>
                        )}
                      </details>
                    ))}
                  </section>
                </>
              ) : (
                <p className="studio-meta">尚无全景记录。可在上方输入宽目标由 Pi Agent 盘点，或直接从已点名用途开始建设。</p>
              )}
            </div>
          )}

          {subTab === 'draft' && (
            <div className="studio-member-pack-section">
              {refExcerptDrawer && (
                <PersonalDialog
                  drawer
                  title={`参考原段回查 · ${refExcerptDrawer.title}`}
                  subtitle={`${refExcerptDrawer.sourceId} · v${refExcerptDrawer.version}${refExcerptDrawer.sectionLocator ? ` · 章节 ${refExcerptDrawer.sectionLocator}` : ''}${refExcerptDrawer.lineRange ? ` · 第 ${refExcerptDrawer.lineRange.start}-${refExcerptDrawer.lineRange.end} 行` : ''} · SHA-256 ${refExcerptDrawer.sha256.slice(0, 16)}…`}
                  onClose={() => setRefExcerptDrawer(null)}
                  footer={<button type="button" className="secondary-button" onClick={() => setRefExcerptDrawer(null)}>关闭</button>}
                >
                  <pre className="sc-paper">{refExcerptDrawer.text}</pre>
                </PersonalDialog>
              )}
              <h4>两条路线合入同一企业草案</h4>
              {pack.entries.length > 0 ? (
                <div className="studio-table-wrap">
                  <table className="studio-foundation-table">
                    <thead>
                      <tr>
                        <th>业务问题与路线</th>
                        <th>采用动作</th>
                        <th>本企业决定、两线依据与参考原段</th>
                        <th>生效期与例外</th>
                        <th>原权威维护</th>
                      </tr>
                    </thead>
                    <tbody>
                      {pack.entries.map(entry => (
                        <tr key={entry.id}>
                          <td>
                            <strong>{entry.title}</strong>
                            <p className="studio-meta">{entry.routes.join(' + ')} · <code>{entry.entryKey}</code></p>
                          </td>
                          <td>{entry.action}</td>
                          <td>
                            <p>{entry.enterpriseBasis}</p>
                            <p className="studio-meta">范围：{entry.scope}{entry.decisionOwner ? ` · 负责人：${entry.decisionOwner}` : ''}</p>
                            {entry.enterpriseSourceRefs.length > 0 && (
                              <div className="studio-meta">
                                <strong>企业线依据：</strong>
                                <ul>
                                  {entry.enterpriseSourceRefs.map((src, idx) => (
                                    <li key={`${src.id}:${src.version}:${idx}`}>
                                      {src.title || src.id}（{src.authority}@{src.version.slice(0, 12)}{src.locator ? ` · ${src.locator}` : ''}）
                                    </li>
                                  ))}
                                </ul>
                              </div>
                            )}
                            {entry.referenceLinks.length > 0 && (
                              <div className="studio-meta">
                                <strong>领域/行业参考原段：</strong>
                                <ul>
                                  {entry.referenceLinks.map((link, idx) => (
                                    <li key={`${link.refId}:${link.sectionLocator}:${idx}`}>
                                      {link.sourceId}@{link.version}（章节：{link.sectionLocator}）{link.excerpt ? ` · ${link.excerpt}` : ''}{' '}
                                      <button
                                        type="button"
                                        className="text-button"
                                        disabled={busy}
                                        onClick={() => { void handleInspectRefExcerpt(link); }}
                                      >
                                        查看参考原段
                                      </button>
                                    </li>
                                  ))}
                                </ul>
                              </div>
                            )}
                          </td>
                          <td>
                            <p className="studio-meta">{entry.validFrom || '未定'} → {entry.validTo || '长期'}</p>
                            {entry.exceptions.length > 0 && (
                              <p className="studio-meta">局部例外 {entry.exceptions.length} 项</p>
                            )}
                          </td>
                          <td>{entry.authorityRef ? `${entry.authorityRef.authority} · ${entry.authorityRef.id}@${entry.authorityRef.version}` : '企业包条目'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="studio-meta">尚未沉淀企业内化条目。</p>
              )}

              <h4>本包已建用途（跨项目同范围自动去重；发布前可修正或明确排除误建草案）</h4>
              {editingPurpose && (
                <PersonalDialog
                  drawer
                  title={`修正用途草案 · ${editingPurpose.purpose.id}`}
                  subtitle={`${editingPurpose.purpose.purposeKey} · 修正仅更新此草案，不改写已发布历史版本`}
                  busy={busy}
                  onClose={() => setEditingPurpose(null)}
                  footer={
                    <>
                      <button type="button" className="secondary-button" disabled={busy} onClick={() => setEditingPurpose(null)}>取消</button>
                      <button type="submit" form="studio-purpose-edit-form" className="primary-button" disabled={busy}>保存草案修正</button>
                    </>
                  }
                >
                  <form id="studio-purpose-edit-form" onSubmit={e => { void handleSavePurposeEdit(e); }}>
                    <label className="studio-field">
                      <span>用途名称（title）</span>
                      <input required value={editingPurpose.title} onChange={e => setEditingPurpose(prev => prev ? { ...prev, title: e.target.value } : null)} />
                    </label>
                    {editingPurpose.purpose.tier === 'limited-calculation' && (
                      <label className="studio-field">
                        <span>受限计算独立名称（limitedCalculationName）</span>
                        <input value={editingPurpose.limitedCalculationName} onChange={e => setEditingPurpose(prev => prev ? { ...prev, limitedCalculationName: e.target.value } : null)} />
                      </label>
                    )}
                    <label className="studio-field">
                      <span>业务问题（businessQuestion）</span>
                      <textarea rows={2} required value={editingPurpose.businessQuestion} onChange={e => setEditingPurpose(prev => prev ? { ...prev, businessQuestion: e.target.value } : null)} />
                    </label>
                    <label className="studio-field">
                      <span>范围标识（scope.scopeKey）</span>
                      <input required value={editingPurpose.scopeKey} onChange={e => setEditingPurpose(prev => prev ? { ...prev, scopeKey: e.target.value } : null)} />
                    </label>
                    <label className="studio-field">
                      <span>完成条件（completionCriteria）</span>
                      <textarea rows={2} required value={editingPurpose.completionCriteria} onChange={e => setEditingPurpose(prev => prev ? { ...prev, completionCriteria: e.target.value } : null)} />
                    </label>
                    <label className="studio-field">
                      <span>排除项（每行一项）</span>
                      <textarea rows={2} value={editingPurpose.exclusions} onChange={e => setEditingPurpose(prev => prev ? { ...prev, exclusions: e.target.value } : null)} />
                    </label>
                    <label className="studio-field">
                      <span>仍存缺口（每行一项）</span>
                      <textarea rows={2} value={editingPurpose.remainingGaps} onChange={e => setEditingPurpose(prev => prev ? { ...prev, remainingGaps: e.target.value } : null)} />
                    </label>
                    <label className="studio-field">
                      <span>补充依据备注（单数 evidenceNote.note，可选）</span>
                      <textarea rows={2} value={editingPurpose.evidenceNote} onChange={e => setEditingPurpose(prev => prev ? { ...prev, evidenceNote: e.target.value } : null)} placeholder="填写本次修订依据备注，保存后可回读验证" />
                    </label>
                  </form>
                </PersonalDialog>
              )}
              {pack.purposes.length > 0 ? (
                <div className="studio-table-wrap">
                  <table className="studio-foundation-table">
                    <thead>
                      <tr>
                        <th>纳入预览</th>
                        <th>用途</th>
                        <th>层级与主体</th>
                        <th>范围、窗口与截止</th>
                        <th>缺口与排除</th>
                        <th>状态与操作</th>
                      </tr>
                    </thead>
                    <tbody>
                      {pack.purposes.map(purpose => {
                        const checked = selectedPurposeIds.includes(purpose.id);
                        return (
                          <tr key={purpose.id} data-purpose-id={purpose.id}>
                            <td>
                              <label className="studio-inline-check">
                                <input
                                  type="checkbox"
                                  aria-label={`纳入本次发布预览：${purpose.limitedCalculationName || purpose.title}`}
                                  checked={checked}
                                  disabled={busy || readOnlyRollback}
                                  onChange={e => setSelectedPurposeIds(prev => e.target.checked ? [...new Set([...prev, purpose.id])] : prev.filter(id => id !== purpose.id))}
                                />
                                <span>{checked ? '纳入' : '不纳入'}</span>
                              </label>
                            </td>
                            <td>
                              <strong>{purpose.limitedCalculationName || purpose.title}</strong>
                              <p className="studio-meta"><code>{purpose.id}</code> · {purpose.purposeKey}</p>
                              {purpose.excludedFromPreview && (
                                <p className="studio-badge is-warning">已排除出默认预览{purpose.excludedReason ? `（${purpose.excludedReason}）` : ''}</p>
                              )}
                              {purpose.evidenceNotes?.length ? (
                                <p className="studio-meta">依据备注：{purpose.evidenceNotes.at(-1)?.note}</p>
                              ) : null}
                              {decisionChoiceIssue(purpose.decisionChoices) ? (
                                <p className="studio-badge is-warning">该用途的经营取舍资料不完整，请在原建设任务修订后再发布。其他用途可单独预览。</p>
                              ) : purpose.decisionChoices.map(c => (
                                <div key={c.id} className="studio-meta">
                                  <span>取舍：{c.question}</span>
                                  <select
                                    aria-label={c.question}
                                    value={decisionMap[`${purpose.id}:${c.id}`] ?? c.selectedKey ?? ''}
                                    onChange={e => setDecisionMap(prev => ({ ...prev, [`${purpose.id}:${c.id}`]: e.target.value }))}
                                  >
                                    <option value="">待负责人选定</option>
                                    {c.options.map(opt => <option key={opt.key} value={opt.key}>{opt.label}</option>)}
                                  </select>
                                  <input
                                    aria-label={`${c.question}决定人`}
                                    placeholder="填写实际决定人"
                                    value={decisionOwnerMap[`${purpose.id}:${c.id}`] ?? c.decidedBy ?? ''}
                                    onChange={e => setDecisionOwnerMap(prev => ({ ...prev, [`${purpose.id}:${c.id}`]: e.target.value }))}
                                  />
                                </div>
                              ))}
                            </td>
                            <td>
                              <span>{tierText[purpose.tier]}</span>
                              <p className="studio-meta">统计单位：{purpose.subjectUnit}{purpose.windowDays ? ` · ${purpose.windowDays}日` : ''}</p>
                              <p className="studio-meta">核验：定义 {purpose.evidenceReadiness.definition} / 映射 {purpose.evidenceReadiness.mapping} / 样算 {purpose.evidenceReadiness.sampleCalculation}</p>
                            </td>
                            <td>
                              <span>{purpose.scope.scopeKey}</span>
                              <p className="studio-meta">生效 {purpose.policyEffectiveFrom || '未定'} · 截止 {purpose.dataCutoffAt || '未核'}</p>
                              {purpose.observationWindowDays !== undefined && purpose.availableHistoryDays === undefined && (
                                <p className="studio-badge is-warning">缺少首购历史长度（所需 {purpose.observationWindowDays}天，待核）</p>
                              )}
                              {purpose.availableHistoryDays !== undefined && purpose.observationWindowDays !== undefined && purpose.availableHistoryDays < purpose.observationWindowDays && (
                                <p className="studio-badge is-warning">历史 {purpose.availableHistoryDays}天 &lt; 所需 {purpose.observationWindowDays}天（待核）</p>
                              )}
                            </td>
                            <td>
                              <p className="studio-meta">排除：{purpose.exclusions.join('；') || '无'}</p>
                              <p className="studio-meta">缺口：{purpose.remainingGaps.join('；') || '无'}</p>
                            </td>
                            <td>
                              <p>{purpose.workItemStatus}</p>
                              {!readOnlyRollback && (
                                <div className="studio-actions" style={{ marginTop: 4 }}>
                                  <button type="button" className="text-button" disabled={busy} onClick={() => openEditPurpose(purpose)}>
                                    修正草案
                                  </button>
                                  <button
                                    type="button"
                                    className="text-button"
                                    disabled={busy}
                                    onClick={() => { void handleTogglePreviewExclusion(purpose, !purpose.excludedFromPreview); }}
                                  >
                                    {purpose.excludedFromPreview ? '恢复纳入默认预览' : '排除出默认预览'}
                                  </button>
                                </div>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="studio-meta">尚无已建用途。</p>
              )}

              {!readOnlyRollback && pack.purposes.length > 0 && (
                <div className="studio-actions">
                  <button type="button" className="primary-button" disabled={busy || selectedPurposeIds.length === 0} onClick={() => { void handlePreparePreview(); }}>
                    生成一份发布预览（已选 {selectedPurposeIds.length}/{pack.purposes.length} 项）
                  </button>
                </div>
              )}
            </div>
          )}

          {subTab === 'publication' && (
            <div className="studio-member-pack-section">
              {activePreview && (
                <PersonalDialog
                  drawer
                  title={`确认发布预览 · v${activePreview.version}`}
                  subtitle={`指纹 ${activePreview.fingerprint.slice(0, 12)}… · 事件生效 ${activePreview.policyEffectiveFrom || '未定'} · 资料截止 ${activePreview.dataCutoffAt || '未核'}`}
                  busy={busy}
                  onClose={() => setActivePreview(null)}
                  footer={
                    <>
                      <button type="button" className="secondary-button" disabled={busy} onClick={() => setActivePreview(null)}>返回</button>
                      <button type="button" className="primary-button" disabled={busy || readOnlyRollback} onClick={() => { void handleConfirmPreview(activePreview); }}>
                        确认并按用途发布
                      </button>
                    </>
                  }
                >
                  <p>{activePreview.summary}</p>
                  <label className="studio-field">
                    <span>确认发布人（可选，不伪造默认角色）</span>
                    <input value={confirmByInput} onChange={e => setConfirmByInput(e.target.value)} placeholder="如：会员运营负责人姓名" />
                  </label>
                  {activePreview.decisions.length > 0 && (
                    <section className="studio-record">
                      <h4>已冻结的业务取舍</h4>
                      <ul>
                        {activePreview.decisions.map(d => (
                          <li key={`${d.purposeId}:${d.choiceId}`}>{d.label}{d.decidedBy ? `（${d.decidedBy}）` : ''}</li>
                        ))}
                      </ul>
                    </section>
                  )}
                  <section className="studio-record">
                    <h4>按用途发布的范围与限制</h4>
                    <ul>
                      {activePreview.purposeSnapshots.map(pm => (
                        <li key={pm.purposeId}>
                          <strong>{pm.limitedCalculationName || pm.title}</strong> · {tierText[pm.tier]} · 状态：{pm.status}
                          {pm.suspensionReason && <p className="studio-meta">限制：{pm.suspensionReason}</p>}
                        </li>
                      ))}
                    </ul>
                  </section>
                </PersonalDialog>
              )}

              {latestRevision ? (
                <>
                  <div className="studio-note">
                    <strong>当前发布版 v{latestRevision.version}</strong> · 状态：{latestRevision.status} · 清单摘要 <code>{latestRevision.manifestSha256.slice(0, 12)}…</code>
                    <p className="studio-meta">发布成功不等于企业首次真实使用已通过；请在新分析任务独立验证。</p>
                  </div>
                  <h4>各用途目录供给资格</h4>
                  <ul>
                    {latestRevision.purposeManifests.map(pm => (
                      <li key={pm.purposeId}>
                        <strong>{pm.limitedCalculationName || pm.title}</strong>（{tierText[pm.tier]}）·{' '}
                        <span className={`studio-badge ${pm.status === 'eligible' ? 'is-success' : 'is-warning'}`}>{pm.status}</span>
                        {pm.suspensionReason && <p className="studio-meta">{pm.suspensionReason}</p>}
                      </li>
                    ))}
                  </ul>
                  <h4>原权威分项发布回执（按发生顺序留存，Host 实核原权威）</h4>
                  <div className="studio-table-wrap">
                    <table className="studio-foundation-table">
                      <thead>
                        <tr><th>原请求</th><th>原维护方</th><th>准确目标</th><th>结果</th><th>核查操作</th></tr>
                      </thead>
                      <tbody>
                        {latestRevision.moduleReceipts.map(r => (
                          <tr key={r.receiptId}>
                            <td><code>{r.requestId}</code></td>
                            <td>{r.authority}</td>
                            <td>{r.targetRef.title || r.targetRef.id}@{r.targetRef.version}</td>
                            <td><span className={`studio-badge ${r.status === 'succeeded' ? 'is-success' : 'is-warning'}`}>{r.status}</span> · {r.detail}</td>
                            <td>
                              {r.status !== 'succeeded' && !readOnlyRollback && (
                                <button
                                  type="button"
                                  className="text-button"
                                  disabled={busy}
                                  onClick={() => { void handleReconcile(latestRevision.version, r.requestId); }}
                                >
                                  只读查原权威并核对
                                </button>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              ) : (
                <p className="studio-meta">尚无已确认的包发布版本。请先在建设草案中准备发布预览。</p>
              )}
            </div>
          )}

          {subTab === 'history' && (
            <div className="studio-member-pack-section">
              <h4>版本与升级影响</h4>
              {pack.packRevisions.length > 0 ? (
                <ul>
                  {[...pack.packRevisions].reverse().map(rev => (
                    <li key={rev.version} className="studio-record">
                      <strong>v{rev.version}</strong>（{rev.status}）· 纳入用途 {rev.purposeManifests.length} 项 · 截止 {rev.dataCutoffAt || '未核'} · 确认于 {rev.confirmedAt}
                      <details style={{ marginTop: 4 }}>
                        <summary>查看 v{rev.version} 收录用途清单（原历史版本保留）</summary>
                        <ul>
                          {rev.purposeManifests.map(pm => (
                            <li key={`${rev.version}:${pm.purposeId}`} className="studio-meta">
                              <strong>{pm.limitedCalculationName || pm.title}</strong>（<code>{pm.purposeId}</code> · {tierText[pm.tier]} · {pm.status}）
                            </li>
                          ))}
                        </ul>
                      </details>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="studio-meta">暂无历史版本。</p>
              )}

              <h4>反馈与归属分流（同题同版追加证据；严格区分线索与已核实实际采用）</h4>
              {pack.feedbackItems.length > 0 ? (
                <ul>
                  {pack.feedbackItems.map(fb => (
                    <li key={fb.id} className="studio-record">
                      <strong>{fb.feedbackCode} · {fb.title}</strong>（{feedbackCategoryText[fb.category]} · 状态 {fb.status}）
                      <p className="studio-meta">
                        处理归属：{fb.targetAuthority}
                        {fb.targetAssetRef ? ` · 目标原资产：${fb.targetAssetRef.id}@${fb.targetAssetRef.version}` : ''}
                        {' '}· 已归集原回复证据 {fb.reports.length} 条
                      </p>
                      {fb.authorityHandling && (
                        <p className="studio-meta">
                          原权威处理记录：{fb.authorityHandling.note}
                          {fb.authorityHandling.studioWorkItemId ? ` · Studio 工作项：${fb.authorityHandling.studioWorkItemId}` : ''}
                          {fb.authorityHandling.studioFeedbackId ? ` · Studio 反馈：${fb.authorityHandling.studioFeedbackId}` : ''}
                          {fb.authorityHandling.revisedRef ? ` · 修订版：${fb.authorityHandling.revisedRef.id}@${fb.authorityHandling.revisedRef.version}` : ''}
                          {fb.authorityHandling.revisedPackVersion ? ` · 新包版：v${fb.authorityHandling.revisedPackVersion}` : ''}
                        </p>
                      )}
                      {fb.revisionLink?.itemVerification && (
                        <div className="studio-meta">
                          <strong>
                            逐笔更正核验（原截止日 {fb.revisionLink.itemVerification.originalCutoffChecked}
                            {fb.revisionLink.itemVerification.newCutoffChecked ? ` · 新截止日 ${fb.revisionLink.itemVerification.newCutoffChecked}` : ''}）：
                          </strong>
                          <span>{fb.revisionLink.itemVerification.transactionAssociationNote}</span>
                          {fb.revisionLink.itemVerification.originalCaseRef && (
                            <p className="studio-meta">
                              原 Case 核查：{fb.revisionLink.itemVerification.originalCaseRef.summary || fb.revisionLink.itemVerification.originalCaseRef.caseTitle || fb.revisionLink.itemVerification.originalCaseRef.caseId}
                              {fb.revisionLink.itemVerification.originalCaseRef.decisionId
                                ? `（决定 ${fb.revisionLink.itemVerification.originalCaseRef.decisionTitle || fb.revisionLink.itemVerification.originalCaseRef.decisionId}${fb.revisionLink.itemVerification.originalCaseRef.decisionRevision !== undefined ? ` rev.${fb.revisionLink.itemVerification.originalCaseRef.decisionRevision}` : ''}）`
                                : ''}
                              {' '}· 原经营决定保持不变：{fb.revisionLink.itemVerification.caseDecisionsPreserved ? '是' : '未确认'}
                            </p>
                          )}
                          <ul>
                            {fb.revisionLink.itemVerification.shouldChange.map((sc, idx) => (
                              <li key={`chg:${sc.itemId}:${idx}`}>
                                应变项 {sc.itemId}
                                {sc.originalOrderId ? `（原单 ${sc.originalOrderId}${sc.refundDate ? ` · 退款 ${sc.refundDate}` : ''}）` : ''}
                                ：{sc.beforeValue} → {sc.afterValue}
                                {sc.sourceFileLocator ? ` · 原表 ${sc.sourceFileLocator}${sc.sourceRowNumber ? `#L${sc.sourceRowNumber}` : ''}` : ''}
                              </li>
                            ))}
                            {(fb.revisionLink.itemVerification.postCutoffNewEvents ?? []).map((pc, idx) => (
                              <li key={`post:${pc.itemId}:${idx}`}>
                                截止日后新发生退款 {pc.itemId}
                                （原单 {pc.originalOrderId} · 退款 {pc.refundDate} · {pc.classification}）
                                ：{pc.beforeValue} → {pc.afterValue}
                                {pc.sourceFileLocator ? ` · 原表 ${pc.sourceFileLocator}${pc.sourceRowNumber ? `#L${pc.sourceRowNumber}` : ''}` : ''}
                              </li>
                            ))}
                            {fb.revisionLink.itemVerification.shouldRetain.map((sr, idx) => (
                              <li key={`ret:${sr.itemId}:${idx}`}>
                                应保留项 {sr.itemId}
                                {sr.originalOrderId ? `（原单 ${sr.originalOrderId}${sr.refundDate ? ` · 退款 ${sr.refundDate}` : ''}）` : ''}
                                ：{sr.unchangedValue}
                                {sr.sourceFileLocator ? ` · 原表 ${sr.sourceFileLocator}${sr.sourceRowNumber ? `#L${sr.sourceRowNumber}` : ''}` : ''}
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                      <ul>
                        {fb.reports.map((rep, idx) => (
                          <li key={`${rep.taskId}:${rep.messageId}:${idx}`} className="studio-meta">
                            <span className={`studio-badge ${rep.adoptionBasis === 'verified_actual_read' ? 'is-success' : 'is-warning'}`}>
                              {rep.adoptionBasis === 'verified_actual_read'
                                ? `已核实实际读取原资产（v${rep.usedPackVersion ?? fb.packVersion}）`
                                : rep.adoptionBasis === 'directory_only_unverified'
                                  ? `线索来自此回复（仅见目录 v${rep.observedDirectoryVersion ?? fb.packVersion}，未核实实际采用）`
                                  : '线索来自此回复（未读取包原资产）'}
                            </span>
                            {' '}· 原任务截止日：{rep.taskCutoffAt || '未指定'}
                            {rep.packDataCutoffAt ? ` · 包版本截止日：${rep.packDataCutoffAt}` : ''}
                            {rep.reportRef.locator?.startsWith('060_reports/') ? ` · 关联报告：${rep.reportRef.locator}` : ''}
                            {rep.independentVerificationStatus ? ` · 独立核验：${rep.independentVerificationStatus}` : ''}
                            {rep.originalCaseRef
                              ? ` · 原 Case：${rep.originalCaseRef.summary || rep.originalCaseRef.caseId}${rep.originalCaseRef.decisionRevision !== undefined ? `（决定 rev.${rep.originalCaseRef.decisionRevision}）` : rep.originalCaseRef.decisionResolutionStatus && rep.originalCaseRef.decisionResolutionStatus !== 'pinned' ? '（原决策待核，未将后续新修订误记为原决定）' : ''}`
                              : ''}
                            {' '}· 证据：{rep.evidenceNote}
                            {onOpenTask && (
                              <button type="button" className="text-button" onClick={() => onOpenTask(rep.projectId, rep.taskId)}>
                                查看原回复任务
                              </button>
                            )}
                          </li>
                        ))}
                      </ul>
                      <div className="studio-actions">
                        {!readOnlyRollback && fb.status === 'recorded' && (
                          <button type="button" className="secondary-button" disabled={busy} onClick={() => { void handleRouteFeedbackToAuthority(fb); }}>
                            转入原权威修订（仅重核受影响用途）
                          </button>
                        )}
                        {onBuildGoal && primarySystem && !readOnlyRollback && fb.targetAuthority !== 'task' && (
                          <button type="button" className="text-button" disabled={busy} onClick={() => { void handleContinueFeedbackInSession(fb); }}>
                            在建设会话继续修订
                          </button>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="studio-meta">暂无从分析回复提交的反馈。</p>
              )}

              <h4>独立使用与核验记录（区分作者声明、同任务自评与独立任务核验）</h4>
              {pack.useRecords.length > 0 ? (
                <ul>
                  {pack.useRecords.map(u => (
                    <li key={u.id}>
                      <strong>{u.reportRef.title || u.reportRef.locator || u.reportRef.id}</strong>（v{u.packVersion} · {u.accessLevel} · 独立核验：{u.independentVerification.status}）
                      <p className="studio-meta">
                        实读原资产：{u.actualReads.length} 项
                        {u.authorDeclaration ? ` · 作者声明：${u.authorDeclaration.summaryText}` : ' · 尚未记录作者声明'}
                      </p>
                      <p className="studio-meta">
                        {u.independentVerification.selfAssessmentOnly
                          ? '【仅同任务自评，非独立核验】'
                          : u.independentVerification.verifierTaskId
                            ? `【独立核验任务 ${u.independentVerification.verifierTaskId.slice(0, 8)}…】`
                            : ''}
                        {u.independentVerification.verdictDetail}
                      </p>
                      {u.impactNotes?.map((note, idx) => (
                        <p key={idx} className="studio-meta">影响说明（v{note.newPackVersion}）：{note.note}</p>
                      ))}
                      {onOpenTask && (
                        <button type="button" className="text-button" onClick={() => onOpenTask(u.projectId, u.taskId)}>
                          查看原分析任务
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="studio-meta">尚无已记录的独立使用依据。</p>
              )}
            </div>
          )}

          {subTab === 'grants' && (
            <div className="studio-member-pack-section">
              <p className="studio-meta">Host 按此授权记录核验定义查阅、汇总引用与明细重算权限；授予方操作者身份、凭据与汇总资产身份由 Host 沿原权威核定，客户端角色名不产生权限。新包对未授权项目默认不授予三层使用权。</p>
              <div className="studio-note" role="region" aria-label="当前 Host 认证操作者身份">
                <p>
                  <strong>当前 Host 认证操作者：</strong>
                  {operatorSession?.operator.verified
                    ? `${operatorSession.operator.displayName || operatorSession.operator.operatorId}（${operatorSession.operator.operatorId}）`
                    : '未认证操作者（禁止授予或撤回资源权限）'}
                </p>
                {!operatorSession?.customResolver && !readOnlyRollback && (
                  <form onSubmit={e => { void handleSwitchOperator(e); }} className="studio-row" style={{ marginTop: 8, gap: 8, flexWrap: 'wrap' }}>
                    <input
                      aria-label="业务操作者标识"
                      placeholder="业务操作者 ID（如 ops-lead）"
                      value={opIdInput}
                      onChange={e => setOpIdInput(e.target.value)}
                    />
                    <input
                      aria-label="业务操作者姓名或岗位"
                      placeholder="显示名（可选）"
                      value={opDisplayNameInput}
                      onChange={e => setOpDisplayNameInput(e.target.value)}
                    />
                    <input
                      type="password"
                      aria-label="操作者口令"
                      placeholder="口令（至少4位）"
                      value={opPasscodeInput}
                      onChange={e => setOpPasscodeInput(e.target.value)}
                    />
                    <button type="submit" className="secondary-button" disabled={busy || !opIdInput.trim() || opPasscodeInput.length < 4}>
                      注册/切换认证操作者
                    </button>
                  </form>
                )}
              </div>
              {!grantAuthority && !readOnlyRollback && (
                <div className="studio-note is-warning" role="status" aria-label="授权权限引导">
                  <p>
                    <strong>当前操作者或项目不是该企业包/体系的原权责维护主体，仅可只读查看授权状态，不可授予或撤回资源权限。</strong>
                  </p>
                  {grantAuthorityGuidance ? (
                    <>
                      <p className="studio-meta">
                        <strong>有权维护方：</strong>
                        {grantAuthorityGuidance.maintainerType === 'named-operator'
                          ? `${grantAuthorityGuidance.maintainerDisplayName || grantAuthorityGuidance.maintainerOperatorId}（${grantAuthorityGuidance.maintainerOperatorId} · 可复用具名维护身份）`
                          : grantAuthorityGuidance.maintainerType === 'ephemeral-session'
                            ? '原临时浏览器会话维护者（无法换浏览器重认证；原绑定历史保留，不静默迁移）'
                            : '未绑定具体维护身份（历史遗留包，不静默迁移权责）'}
                      </p>
                      {grantAuthorityGuidance.ownerProjectName && (
                        <p className="studio-meta">
                          <strong>原权责项目入口：</strong>
                          原权责项目「{grantAuthorityGuidance.ownerProjectName}」→ 企业 Studio →「三层资源授权」
                        </p>
                      )}
                      <p className="studio-meta">
                        <strong>下一步指引：</strong>
                        {grantAuthorityGuidance.nextStep}
                      </p>
                    </>
                  ) : (
                    <p className="studio-meta">
                      当前操作者或项目不是该企业包/体系的原权责维护主体，未获 Host 颁发的授权操作凭据，仅可只读查看授权状态，不可授予或撤回资源权限。
                    </p>
                  )}
                </div>
              )}
              {grants.length > 0 ? (
                <div className="studio-table-wrap">
                  <table className="studio-foundation-table">
                    <thead>
                      <tr><th>授权项目/主体</th><th>授予方（Host 核定）</th><th>允许操作</th><th>范围与粒度</th><th>状态</th><th>操作</th></tr>
                    </thead>
                    <tbody>
                      {grants.map(g => (
                        <tr key={g.id}>
                          <td>{projects.find(p => p.id === g.subjectId)?.name || g.subjectId}</td>
                          <td>{g.grantor}</td>
                          <td>{g.operations.map(op => opText[op]).join('、')}</td>
                          <td>
                            {g.scope.stores?.length ? `门店：${g.scope.stores.join('、')}` : '无门店明细范围'}
                            {g.scope.allowedDataPaths?.length ? ` · 路径：${g.scope.allowedDataPaths.join('、')}` : ''}
                            {g.purposeKeys?.length ? ` · 用途：${g.purposeKeys.join('、')}` : ''}
                            {g.scope.periodFrom || g.scope.periodTo ? ` · 期间：${g.scope.periodFrom || '不限'} 至 ${g.scope.periodTo || '不限'}` : ''}
                            {g.scope.grain ? ` · 粒度：${g.scope.grain}` : ''}
                            {g.scope.summaryAssetId ? ` · 汇总 ${g.scope.summaryAssetId}@${g.scope.summaryVersion || ''}` : ''}
                          </td>
                          <td>{g.revokedAt ? `已撤回 (${g.revokedReason || ''})` : '有效'}</td>
                          <td>
                            {!g.revokedAt && !readOnlyRollback && grantAuthority && (
                              <button type="button" className="text-button" disabled={busy} onClick={() => { void handleRevokeGrant(g.id); }}>
                                撤回授权
                              </button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="studio-meta">尚未为分析项目配置本企业会员包的资源授权；未配置前新包不会仅凭企业归属授予三层使用权。</p>
              )}

              {!readOnlyRollback && grantAuthority && (
                <form onSubmit={e => { void handleAddGrant(e); }} className="studio-record">
                  <h4>新增项目资源授权</h4>
                  <label className="studio-field">
                    <span>被授权项目</span>
                    <select required value={grantProjectId} onChange={e => setGrantProjectId(e.target.value)}>
                      <option value="">选择本企业项目</option>
                      {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                    </select>
                  </label>
                  <label className="studio-field">
                    <span>最高操作层次</span>
                    <select value={grantOp} onChange={e => setGrantOp(e.target.value as ResourceGrantOperation)}>
                      <option value="read-definition">仅查阅正式定义（不提供汇总/明细）</option>
                      <option value="cite-summary">引用已授权汇总（由 Host 校验原汇总资产）</option>
                      <option value="read-detail-recalculate">读取获准门店明细并重算</option>
                    </select>
                  </label>
                  {grantOp === 'cite-summary' && (
                    <>
                      <label className="studio-field"><span>原汇总资产 ID（须已在本企业 Studio/资料库/SAP 正式发布）</span><input required value={grantSummaryAssetId} onChange={e => setGrantSummaryAssetId(e.target.value)} placeholder="原汇总资产 ID" /></label>
                      <label className="studio-field"><span>汇总粒度</span><input required value={grantGrain} onChange={e => setGrantGrain(e.target.value)} /></label>
                      <label className="studio-field"><span>汇总版本</span><input required value={grantSummaryVer} onChange={e => setGrantSummaryVer(e.target.value)} /></label>
                    </>
                  )}
                  {grantOp === 'read-detail-recalculate' && (
                    <>
                      <label className="studio-field"><span>允许读取的门店（顿号或逗号分隔）</span><input value={grantStores} onChange={e => setGrantStores(e.target.value)} placeholder="如：星桥直营店、柳岸直营店" /></label>
                      <label className="studio-field"><span>允许读取的 020_clean 路径（顿号或逗号分隔）</span><input value={grantAllowedPaths} onChange={e => setGrantAllowedPaths(e.target.value)} placeholder="如：020_clean/starbridge_orders.csv" /></label>
                    </>
                  )}
                  <label className="studio-field"><span>授权用途 purposeKeys（逗号分隔，* 表示全部）</span><input required value={grantPurposeKeys} onChange={e => setGrantPurposeKeys(e.target.value)} /></label>
                  <label className="studio-field"><span>数据期间起（YYYY-MM-DD）</span><input type="date" value={grantPeriodFrom} onChange={e => setGrantPeriodFrom(e.target.value)} /></label>
                  <label className="studio-field"><span>数据期间止（YYYY-MM-DD）</span><input type="date" value={grantPeriodTo} onChange={e => setGrantPeriodTo(e.target.value)} /></label>
                  <label className="studio-field"><span>授权依据</span><input required value={grantBasis} onChange={e => setGrantBasis(e.target.value)} /></label>
                  <button type="submit" className="secondary-button" disabled={busy || !grantProjectId}>保存资源授权</button>
                </form>
              )}
            </div>
          )}
        </>
      )}
    </section>
  );
}
