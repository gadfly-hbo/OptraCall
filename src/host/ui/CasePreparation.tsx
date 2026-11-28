import { useEffect, useId, useRef, useState } from 'react';
import type { GoalDraftInput, GoalRoleSuggestionRef, GoalScope, GoalVersion } from '../strategy-goals-types.ts';
import type { CaseDirectoryEntry } from '../case-directory.ts';
import type { CaseCreationSource, CaseGoalEntry, CaseGoalIntentRef } from '../case-types.ts';
import { caseIssues, createCaseIssue } from './case-decisions-client.ts';
import type { WorkspaceDraftRecord } from '../workspace-draft-store.ts';
import type { ThreeBranchCreateInput, ThreeBranchCreateResult } from '../case-creation-orchestrator.ts';
import * as goalsApi from './case-client.ts';
import { BusinessRoleConversation } from './BusinessRoleConversation.tsx';
import { registerWorkspaceInputGuard } from './workspace-input-guards.ts';
import { caseError } from './CaseDialogs.tsx';
import { createCaseThreeBranch, discardWorkspaceDraft, listWorkspaceDrafts, readCaseDirectory, readWorkspaceDraft, saveWorkspaceDraft } from './workspace-daily-client.ts';
import { createPreparationDraftSession, emptyPreparePayload, type PreparationDraftPayload } from './case-preparation-model.ts';

type Payload = PreparationDraftPayload & {
  firstIssueAttempt?: { caseId: string; expectedRevision: number; operationId: string; title: string; originalText: string } | null;
  firstIssueReceipt?: { caseId: string; issueId: string; operationId: string } | null;
  creationSource?: CaseCreationSource;
  goalIntent?: CaseGoalIntentRef;
  pendingSuggestion?: GoalDraftInput | null;
  previousSelectedGoal?: Payload['selectedGoal'];
  previousGoalDrafts?: GoalDraftInput[];
  carryFragmentId?: string | null;
  carryTarget?: { caseId: string; issueId: string | null } | null;
};
type Session = ReturnType<typeof createPreparationDraftSession>;
export type CasePreparationProps = {
  onOpenCase: (caseId: string, issueId?: string) => void;
  onCreateCase?: () => void;
  onCaseChanged?: () => void;
  onOpenAllProjects?: () => void;
  onRegisterFlush?: (flush: (() => Promise<boolean>) | null) => void;
  refreshToken?: number;
  expanded?: boolean;
  initialGoal?: CaseGoalEntry;
  initialSource?: CaseCreationSource;
};
function mergeDirectoryEntries(previous: CaseDirectoryEntry[], incoming: CaseDirectoryEntry[]): CaseDirectoryEntry[] {
  const byId = new Map(previous.map(entry => [entry.caseId, entry]));
  for (const entry of incoming) {
    const old = byId.get(entry.caseId);
    if (!old) { byId.set(entry.caseId, entry); continue; }
    const issues = [...new Map([...old.issues, ...entry.issues].map(issue => [issue.issueId, issue])).values()];
    const through = Math.max(old.nextIssueOffset ?? old.totalIssues, entry.nextIssueOffset ?? entry.totalIssues);
    const nextIssueOffset = through < entry.totalIssues ? through : null;
    byId.set(entry.caseId, { ...entry, issues, issuesTruncated: nextIssueOffset !== null, nextIssueOffset });
  }
  return [...byId.values()];
}
const keyOf = (goal: { goalId: string; version: number }) => `${goal.goalId}@${goal.version}`;
const preparationText = (p: Pick<Payload, 'title' | 'description' | 'rawInput'>) => [p.title ? `准备名称：${p.title}` : '', p.description ? `问题背景：${p.description}` : '', p.rawInput ? `原输入：${p.rawInput}` : ''].filter(Boolean).join('\n\n');
const unfinished = (d: WorkspaceDraftRecord<PreparationDraftPayload>) => d.payload.creationState !== 'completed' || Boolean(d.payload.creationReceipt && !(d.payload as Payload).firstIssueReceipt);
const sameScope = (a: GoalScope, b: GoalScope) => a.kind === b.kind && a.id === b.id && a.name === b.name && a.enterpriseId === b.enterpriseId;
const blankGoal = (scope: GoalScope): GoalDraftInput => ({ title: '', outcome: '', strategies: [''], perspective: scope.kind === 'personal' ? 'personal' : 'profit', scope, measurement: { kind: 'deliverable', criterion: '' }, baseline: { state: 'pending', description: '待补可比基线；本次按已说明的可核成果核定。' }, responsible: '' });

/** One recoverable preparation intent, shared by Home and the Case overview. No Agent request runs on open. */
export function CasePreparation({ onOpenCase, onCreateCase, onCaseChanged, onOpenAllProjects, onRegisterFlush, refreshToken = 0, expanded = false, initialGoal, initialSource }: CasePreparationProps) {
  const inputId = useId();
  const sessionRef = useRef<Session | null>(null);
  const [, redraw] = useState(0);
  const [ready, setReady] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [saved, setSaved] = useState<WorkspaceDraftRecord<PreparationDraftPayload>[]>([]);
  const [goals, setGoals] = useState<GoalVersion[]>([]), [enterprises, setEnterprises] = useState<{ id: string; name: string }[]>([]);
  const [prepOpen, setPrepOpen] = useState(expanded), [agentOpen, setAgentOpen] = useState(false), [manualOpen, setManualOpen] = useState(false);
  const [matches, setMatches] = useState<CaseDirectoryEntry[] | null>(null), [selectedIssues, setSelectedIssues] = useState<Record<string, string>>({});
  const [nextCaseOffset, setNextCaseOffset] = useState<number | null>(null), [loadingDirectory, setLoadingDirectory] = useState<string | null>(null);
  const directoryGeneration = useRef(0);
  const [searching, setSearching] = useState(false), [creating, setCreating] = useState(false), [result, setResult] = useState<ThreeBranchCreateResult | null>(null);
  const busyRef = useRef(false);
  const titleInputRef = useRef<HTMLInputElement>(null);
  const scopeSelectRef = useRef<HTMLSelectElement>(null);
  const personalNameInputRef = useRef<HTMLInputElement>(null);
  const goalTitleInputRef = useRef<HTMLInputElement>(null);
  const goalOutcomeRef = useRef<HTMLTextAreaElement>(null);
  const goalStrategyRef = useRef<HTMLTextAreaElement>(null);
  const goalCriterionRef = useRef<HTMLInputElement>(null);
  const goalResponsibleRef = useRef<HTMLInputElement>(null);
  const selectedStrategyRef = useRef<HTMLSelectElement>(null);
  const focusField = (target: { current: HTMLElement | null }) => {
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => target.current?.focus());
    else target.current?.focus();
  };
  const notify = () => redraw(n => n + 1);
  const remember = (record: WorkspaceDraftRecord<PreparationDraftPayload>) => setSaved(old => [record, ...old.filter(d => d.id !== record.id)]);
  const install = (record?: WorkspaceDraftRecord<PreparationDraftPayload>, initial?: Partial<Payload>) => {
    sessionRef.current = createPreparationDraftSession({
      id: record?.id ?? `prepare-${crypto.randomUUID()}`, payload: record?.payload ?? emptyPreparePayload(), revision: record?.revision ?? 0,
      save: (id, revision, payload) => saveWorkspaceDraft('prepare', id, revision, payload).then(r => r.draft),
      read: id => readWorkspaceDraft<PreparationDraftPayload>('prepare', id).then(r => r.draft).catch(e => { if (e instanceof goalsApi.CaseRequestError && e.status === 404) return null; throw e; }),
      onSaved: draft => { remember(draft); notify(); }, onError: failure => { setError(`草稿尚未保存，输入保留；请重试后再离开。${caseError(failure)}`); notify(); },
    });
    if (initial) { sessionRef.current.update(initial); void sessionRef.current.flush(); }
    directoryGeneration.current++; setNextCaseOffset(null); setLoadingDirectory(null); setSearching(false);
    setResult(null); setMatches(null); setAgentOpen(false); setManualOpen(expanded || Boolean(record?.payload.goalDraft || record?.payload.goalAttempt)); notify();
  };
  useEffect(() => {
    let alive = true;
    void listWorkspaceDrafts<PreparationDraftPayload>('prepare').then(({ drafts }) => {
      if (!alive) return;
      setSaved(drafts);
      // A completed intent and its operation IDs must never be reused for a different Case.
      if (!sessionRef.current) {
        if (initialGoal || initialSource) install(undefined, { ...(initialGoal ? { selectedGoal: { goalId: initialGoal.goalId, version: initialGoal.version, strategy: initialGoal.strategy ?? '' }, title: initialGoal.title ?? '', description: initialGoal.description ?? '', rawInput: initialGoal.description ?? '', goalIntent: initialGoal.goalIntent } : {}), ...(initialSource ? { creationSource: initialSource } : {}) });
        else install(drafts.find(unfinished));
      }
      setReady(true);
    }, failure => { if (alive) { setError(`准备草稿读取失败；为保护已保存输入，请重新读取。${caseError(failure)}`); } });
    return () => { alive = false; };
  }, [refreshToken]);
  useEffect(() => { if (expanded) setPrepOpen(true); }, [expanded]);
  useEffect(() => {
    let alive = true;
    void goalsApi.strategyGoals().then(index => { if (alive) setGoals(index.goals.flatMap(g => g.versions)); }, failure => { if (alive) setError(`目标读取失败；输入仍保留。${caseError(failure)}`); });
    void goalsApi.goalEnterprises().then(index => { if (alive) setEnterprises(index.enterprises); }, () => {});
    return () => { alive = false; };
  }, [refreshToken]);
  const flush = async () => {
    if (!sessionRef.current) return true;
    if (busyRef.current) { setError('正在核对准备记录，请稍后再离开。'); return false; }
    const ok = await sessionRef.current.flush();
    if (ok) setError('');
    notify(); return ok;
  };
  const flushRef = useRef(flush); flushRef.current = flush;
  useEffect(() => { onRegisterFlush?.(() => flushRef.current()); return () => onRegisterFlush?.(null); }, [onRegisterFlush]);
  useEffect(() => {
    const guard = (event: BeforeUnloadEvent) => { if (sessionRef.current?.getSnapshot().dirty || busyRef.current) { event.preventDefault(); event.returnValue = ''; } };
    window.addEventListener('beforeunload', guard); return () => window.removeEventListener('beforeunload', guard);
  }, []);
  useEffect(() => registerWorkspaceInputGuard(() => flushRef.current()), []);
  useEffect(() => () => { directoryGeneration.current++; }, []);
  const snapshot = sessionRef.current?.getSnapshot();
  const payload = (snapshot?.payload ?? emptyPayload) as Payload;
  const draftId = sessionRef.current?.id ?? '';
  const update = (patch: Partial<Payload>) => {
    const session = sessionRef.current; if (!session) return;
    if (['rawInput', 'title', 'description'].some(key => key in patch && patch[key as keyof Payload] !== session.getSnapshot().payload[key as keyof PreparationDraftPayload])) patch = { ...patch, carryFragmentId: null, carryTarget: null };
    session.update(patch); notify();
    // The session serializes overlapping keystrokes and acknowledges only the version actually saved.
    void session.flush().then(ok => { if (ok) setError(''); notify(); });
  };
  const navigate = async (action: () => void) => { if (await flush()) action(); };
  const chosen = payload.selectedGoal;
  const activeGoal = goals.find(g => chosen && keyOf(g) === keyOf(chosen)) ?? (payload.candidateGoal && chosen && keyOf(payload.candidateGoal) === keyOf(chosen) ? payload.candidateGoal : null);
  const scope = payload.scope ?? (payload.goalDraft?.scope.id.trim() && payload.goalDraft.scope.name.trim() ? payload.goalDraft.scope : null) ?? activeGoal?.scope ?? null;
  // Reuse the existing persisted Goal draft fields before ownership is chosen.
  // Empty identity is never treated as a selected scope or submitted as a Goal.
  const goalDraft = payload.goalDraft ?? blankGoal(scope ?? { kind: 'personal', id: '', name: '' });
  const pending = Boolean(payload.goalAttempt || payload.createAttempt && payload.creationState !== 'completed');
  const lockedGoal = Boolean(payload.adoptionReceipt || pending || payload.candidateGoal);
  const patchGoal = (patch: Partial<GoalDraftInput>) => { if (goalDraft) update({ goalDraft: { ...goalDraft, ...patch } }); };
  const chooseScope = (next: GoalScope | null) => {
    if (goalDraft?.roleSuggestion && next && !sameScope(goalDraft.scope, next)) { setError('该 Agent 候选属于原明确范围；请开始另一份准备或先清除候选，不能改写来源归属。'); return; }
    if (!next && goalDraft?.roleSuggestion) { setError('该 Agent 候选的归属随原建议保留；请开始另一份准备来更改归属。'); return; }
    update({ scope: next, goalDraft: { ...goalDraft, scope: next ?? { kind: 'personal', id: '', name: '' }, perspective: next?.kind === 'personal' ? 'personal' : goalDraft.perspective === 'personal' ? 'profit' : goalDraft.perspective } });
  };
  const useSuggestion = (draft: GoalDraftInput, source: GoalRoleSuggestionRef) => {
    if (source.owner.role !== 'goal-draft' || source.owner.draftId !== draftId || !scope || !sameScope(scope, source.owner.scope) || !sameScope(scope, draft.scope)) { setError('候选来源与当前准备身份或归属不一致，未带入。'); return; }
    const proposal = { ...draft, roleSuggestion: source };
    setPrepOpen(true); setManualOpen(true);
    if (chosen || payload.goalDraft && (payload.goalDraft.title || payload.goalDraft.outcome || payload.goalDraft.strategies?.some(s => s))) update({ pendingSuggestion: proposal });
    else update({ goalDraft: proposal });
  };
  const newPreparation = async () => { if (await flush()) { install(); setPrepOpen(true); setNotice('已开始另一份独立准备；原草稿及已保存结果保留。'); } };
  const directoryFailure = (failure: unknown) => {
    if (failure instanceof goalsApi.CaseRequestError && failure.status === 403) { directoryGeneration.current++; setMatches(null); setNextCaseOffset(null); setLoadingDirectory(null); setSearching(false); }
    setError(`目录读取未完成，准备输入仍保留。${caseError(failure)}`);
  };
  const organize = async () => {
    if (!await flush()) return;
    const generation = ++directoryGeneration.current;
    setSearching(true); setError('');
    try {
      const directory = await readCaseDirectory(undefined, 20, { issueLimit: 5 });
      if (generation !== directoryGeneration.current) return;
      setMatches(directory.items); setNextCaseOffset(directory.nextOffset ?? null);
      setNotice(directory.truncated ? '已找到部分可以继续的 Case，可按需查看更多。请明确选择这段输入所属的事项。' : '找到可以继续的 Case。请选择这段输入属于哪件事，也可以请 Agent 帮你整理。');
    } catch (failure) { if (generation === directoryGeneration.current) directoryFailure(failure); }
    finally { if (generation === directoryGeneration.current) setSearching(false); }
  };
  const readMoreCases = async () => {
    if (nextCaseOffset === null || searching || loadingDirectory) return;
    const generation = directoryGeneration.current;
    setLoadingDirectory('cases'); setError('');
    try {
      const directory = await readCaseDirectory(undefined, 20, { offset: nextCaseOffset, issueLimit: 5 });
      if (generation !== directoryGeneration.current) return;
      setMatches(old => mergeDirectoryEntries(old ?? [], directory.items)); setNextCaseOffset(directory.nextOffset ?? null);
    } catch (failure) { if (generation === directoryGeneration.current) directoryFailure(failure); }
    finally { if (generation === directoryGeneration.current) setLoadingDirectory(null); }
  };
  const readMoreIssues = async (entry: CaseDirectoryEntry) => {
    if (entry.nextIssueOffset === null || searching || loadingDirectory) return;
    const generation = directoryGeneration.current;
    setLoadingDirectory(entry.caseId); setError('');
    try {
      const directory = await readCaseDirectory(undefined, 1, { caseId: entry.caseId, issueOffset: entry.nextIssueOffset, issueLimit: 5, includeClosed: true });
      if (generation !== directoryGeneration.current) return;
      setMatches(old => mergeDirectoryEntries(old ?? [], directory.items.filter(item => item.caseId === entry.caseId)));
    } catch (failure) { if (generation === directoryGeneration.current) directoryFailure(failure); }
    finally { if (generation === directoryGeneration.current) setLoadingDirectory(null); }
  };
  const carry = async (entry: CaseDirectoryEntry) => {
    const issueId = selectedIssues[entry.caseId] ?? '';
    if (!issueId) { setError(entry.issues.length ? '请选择要带入的原事项。' : '原 Case 尚无可选事项，请先打开并建立事项；原输入继续保留。'); return; }
    if (!payload.rawInput.trim() || !await flush()) return;
    try {
      const current = sessionRef.current!.getSnapshot().payload as Payload;
      const sameTarget = current.carryTarget?.caseId === entry.caseId && current.carryTarget.issueId === issueId;
      const fragmentId = sameTarget && current.carryFragmentId ? current.carryFragmentId : `frag-${crypto.randomUUID()}`;
      if (!sameTarget || !current.carryFragmentId) { update({ carryFragmentId: fragmentId, carryTarget: { caseId: entry.caseId, issueId } }); if (!await flush()) return; }
      // Query the stable fragment after a lost response before considering the original save again.
      const existing = await readWorkspaceDraft('carry-over', fragmentId).catch(e => { if (e instanceof goalsApi.CaseRequestError && e.status === 404) return null; throw e; });
      if (!existing) await saveWorkspaceDraft('carry-over', fragmentId, 0, { originalText: preparationText(current), origin: { kind: 'prepare-draft', label: 'Case 准备草稿', ref: draftId }, targetCaseId: entry.caseId, targetIssueId: issueId, appendedAt: null });
      onOpenCase(entry.caseId, issueId);
    } catch (failure) { setError(`待带入片段尚需核对，原输入保留。${caseError(failure)}`); }
  };
  const finishFirstIssue = async (session: Session, createdCaseId: string, original?: ThreeBranchCreateInput) => {
    let current = session.getSnapshot().payload as Payload;
    if (current.firstIssueReceipt) return current.firstIssueReceipt;
    let attempt = current.firstIssueAttempt;
    if (!attempt) {
      const exact = (await goalsApi.detail(createdCaseId)).case;
      attempt = { caseId: createdCaseId, expectedRevision: exact.revision, operationId: crypto.randomUUID(), title: ((original?.rawInput ?? current.rawInput).trim() || current.title).slice(0, 240), originalText: preparationText(original ?? current) };
      session.update({ firstIssueAttempt: attempt } as Partial<PreparationDraftPayload>); notify(); if (!await session.flush()) return null;
    }
    const receipt = (await goalsApi.operation(attempt.operationId)).operation;
    let issue: { id: string; caseId: string; title: string };
    if (receipt) {
      if (receipt.kind !== 'case_update' || receipt.phase !== 'completed' || receipt.caseId !== createdCaseId || !receipt.result || receipt.result.caseId !== createdCaseId || receipt.result.title !== attempt.title || typeof receipt.result.id !== 'string') throw new goalsApi.CaseRequestError('operation_conflict', 409);
      issue = receipt.result as unknown as typeof issue;
    } else {
      try { issue = (await createCaseIssue(createdCaseId, { operationId: attempt.operationId, expectedRevision: attempt.expectedRevision, title: attempt.title })).issue; }
      catch (failure) {
        if (failure instanceof goalsApi.CaseRequestError && failure.status === 409 && failure.code !== 'operation_conflict') {
          const originalReceipt = (await goalsApi.operation(attempt.operationId)).operation;
          if (!originalReceipt) { const latest = (await goalsApi.detail(createdCaseId)).case; session.update({ firstIssueAttempt: { ...attempt, expectedRevision: latest.revision } } as Partial<PreparationDraftPayload>); await session.flush(); }
        }
        throw failure;
      }
    }
    const fragmentId = `first-frag-${attempt.operationId}`;
    const existing = await readWorkspaceDraft('carry-over', fragmentId).catch(e => { if (e instanceof goalsApi.CaseRequestError && e.status === 404) return null; throw e; });
    if (!existing) await saveWorkspaceDraft('carry-over', fragmentId, 0, { originalText: attempt.originalText, origin: { kind: 'prepare-draft', label: 'Case 创建时的准备原文', ref: session.id }, targetCaseId: createdCaseId, targetIssueId: issue.id, appendedAt: null });
    const firstIssueReceipt = { caseId: createdCaseId, issueId: issue.id, operationId: attempt.operationId };
    session.update({ firstIssueReceipt, targetLocation: { caseId: createdCaseId, issueId: issue.id } } as Partial<PreparationDraftPayload>); notify(); if (!await session.flush()) return null;
    return firstIssueReceipt;
  };
  const runCreate = async () => {
    const session = sessionRef.current; if (!session || busyRef.current) return;
    if (!await flush()) return;
    let state = session.getSnapshot().payload as Payload;
    if (state.creationState === 'completed') {
      if (!state.creationReceipt) { setError('这份准备已完成；请开始另一份准备。'); return; }
      busyRef.current = true; setCreating(true);
      try { if (await finishFirstIssue(session, state.creationReceipt.caseId, state.createAttempt ?? undefined)) { setError(''); onCaseChanged?.(); setNotice('已核对原创建结果与第一件事项；完整准备原文作为待带入片段保留。'); } }
      catch (failure) { setError(`Case 已创建；第一件事项或原文片段尚未确认。原操作与输入保留，请继续核对。${caseError(failure)}`); }
      finally { busyRef.current = false; setCreating(false); notify(); }
      return;
    }
    if (!state.title.trim()) { setError('请填写这件事的名字。'); setPrepOpen(true); focusField(titleInputRef); return; }
    let selected = state.selectedGoal;
    if (!selected && !state.createAttempt) {
      const fields = state.goalAttempt ?? state.goalDraft;
      const effectiveScope = state.scope ?? (fields?.scope.id.trim() && fields?.scope.name.trim() ? fields.scope : null);
      if (!effectiveScope) { setError('请选择目标归属：已有企业或个人。'); setPrepOpen(true); setManualOpen(true); focusField(scopeSelectRef); return; }
      if (effectiveScope.kind === 'personal' && (!effectiveScope.name.trim() || !effectiveScope.id.trim())) { setError('已选择个人目标，请填写个人归属名称。'); setPrepOpen(true); setManualOpen(true); focusField(personalNameInputRef); return; }
      if (effectiveScope.kind !== 'personal' && (!effectiveScope.id.trim() || !effectiveScope.name.trim() || (!enterprises.some(e => e.id === effectiveScope.id) && !fields?.roleSuggestion))) { setError('请选择实际可读的已有企业，或改选个人归属。'); setPrepOpen(true); setManualOpen(true); focusField(scopeSelectRef); return; }
      if (!fields?.title.trim()) { setError('请填写目标名称（G · 目标名称）。'); setPrepOpen(true); setManualOpen(true); focusField(goalTitleInputRef); return; }
      if (!fields.outcome.trim()) { setError('请填写“想看到什么结果”。'); setPrepOpen(true); setManualOpen(true); focusField(goalOutcomeRef); return; }
      if (!fields.strategies?.[0]?.trim()) { setError('请填写具体策略（S · 这次先怎么推进）。'); setPrepOpen(true); setManualOpen(true); focusField(goalStrategyRef); return; }
      if (fields.measurement.kind === 'deliverable' && !fields.measurement.criterion.trim()) { setError('请填写可核成果。'); setPrepOpen(true); setManualOpen(true); focusField(goalCriterionRef); return; }
      if (!fields.responsible.trim()) { setError('请填写责任角色／承担人。'); setPrepOpen(true); setManualOpen(true); focusField(goalResponsibleRef); return; }
    } else if (!selected?.strategy && !state.createAttempt) {
      setError('请选择准确目标版本及该版具体策略。'); setPrepOpen(true); focusField(selectedStrategyRef); return;
    }
    busyRef.current = true; setCreating(true); setError(''); setNotice('');
    try {
      if (!selected && !state.createAttempt) {
        const fields = (state.goalAttempt ?? state.goalDraft)!;
        const attempt = state.goalAttempt ?? { ...fields, title: fields.title.trim(), strategies: (fields.strategies ?? []).map(s => s.trim()).filter(Boolean), operationId: crypto.randomUUID() };
        session.update({ goalAttempt: attempt }); notify(); if (!await session.flush()) return;
        let candidate: GoalVersion | undefined;
        // Reusing the exact request and operation follows CaseGoalPicker's original Goal API recovery path.
        if (state.goalAttempt) {
          const receipt = (await goalsApi.goalOperation(attempt.operationId)).operation;
          if (receipt) { if (receipt.kind !== 'create' || !('goalId' in receipt.result)) throw new goalsApi.CaseRequestError('operation_conflict', 409); candidate = receipt.result as GoalVersion; }
        }
        candidate ??= (await goalsApi.createGoalCandidate(attempt)).goal;
        selected = { goalId: candidate.goalId, version: candidate.version, strategy: candidate.strategies?.[0] ?? '' };
        session.update({ goalAttempt: null, candidateGoal: candidate, selectedGoal: selected });
        setGoals(old => [...old.filter(g => keyOf(g) !== keyOf(candidate!)), candidate!]); notify(); if (!await session.flush()) return;
        state = session.getSnapshot().payload as Payload;
      }
      const exact = goals.find(g => selected && keyOf(g) === keyOf(selected)) ?? state.candidateGoal;
      const attempt: ThreeBranchCreateInput = state.createAttempt ?? { draftId, title: state.title.trim(), description: state.description, rawInput: state.rawInput, goal: { ...selected!, alreadyAdopted: Boolean(state.adoptionReceipt) || exact?.status === 'adopted' }, adoptOperationId: state.adoptOperationId, createOperationId: state.createOperationId, ...(state.creationSource ? { creationSource: state.creationSource } : {}), ...(state.goalIntent ? { goalIntent: state.goalIntent } : {}) };
      session.update({ createAttempt: attempt }); notify(); if (!await session.flush()) return;
      const edited = structuredClone(session.getSnapshot().payload) as Payload;
      const response = await createCaseThreeBranch(attempt);
      session.accept(response.branch === 'continue' ? response.preservedDraft : response.draft);
      // A retry submits the frozen original operation. Its old input echo cannot replace later saved edits.
      session.update({ rawInput: edited.rawInput, title: edited.title, description: edited.description, scope: edited.scope, goalDraft: edited.goalDraft, selectedGoal: edited.selectedGoal, candidateGoal: edited.candidateGoal });
      // Keep the frozen request until the original operation is completed or identified as an existing Case.
      if (response.branch === 'continue') session.update({ createAttempt: null });
      setResult(response); notify(); await session.flush();
      if (response.branch === 'continue') {
        setNotice(response.isClosed ? '原 Case 已结束，未自动重开；新名称、背景和输入均已保留。' : '这组准确 G/S 已有 Case；新名称、背景和输入均已保留。');
        const originalIssues = await caseIssues(response.existingCase.id).catch(() => null);
        directoryGeneration.current++; setNextCaseOffset(null); setLoadingDirectory(null); setSearching(false);
        if (originalIssues) setMatches([{ caseId: response.existingCase.id, title: response.existingCase.title, status: response.existingCase.status, updatedAt: response.existingCase.updatedAt, goalBinding: { goalId: attempt.goal.goalId, version: attempt.goal.version, strategy: attempt.goal.strategy }, issues: originalIssues.issues.map(i => ({ issueId: i.id, title: i.title })), totalIssues: originalIssues.issues.length, issuesTruncated: false, nextIssueOffset: null }]);
      } else if (response.branch === 'partial') setNotice('目标采纳结果与原操作已保留；Case 创建未完成。继续会核对原操作，不重复采纳。');
      else {
        onCaseChanged?.();
        setNotice(`Case「${response.createdCase.title}」已创建${response.replayedFromOperation ? '，已核对原操作回执' : ''}；正在核对第一件事项。`);
        try { if (await finishFirstIssue(session, response.createdCase.id, attempt)) { onCaseChanged?.(); setNotice(`Case「${response.createdCase.title}」与第一件事项已建立；完整准备原文作为待带入片段保留。`); } }
        catch (failure) { setError(`Case 已创建；第一件事项或原文片段尚未确认。原操作与输入保留，请继续核对。${caseError(failure)}`); }
      }
    } catch (failure) {
      const current = session.getSnapshot().payload as Payload;
      const definiteClientReject = failure instanceof goalsApi.CaseRequestError && failure.status < 500 && failure.code !== 'operation_conflict';
      if (definiteClientReject && !current.createAttempt) { session.update({ goalAttempt: null }); await session.flush(); }
      const after = session.getSnapshot().payload as Payload;
      const stillPending = Boolean(after.goalAttempt || (after.createAttempt && after.creationState !== 'completed'));
      setError(stillPending
        ? `操作未确认完成，原输入和原请求保留。请使用“核对原操作并继续”。${caseError(failure)}`
        : definiteClientReject
          ? `未能提交保存，请按提示检查输入后重试。${caseError(failure)}`
          : `操作未确认完成，当前输入已保留，请核对后重试。${caseError(failure)}`);
    } finally { busyRef.current = false; setCreating(false); notify(); }
  };
  const preserveConflictingCopy = async () => {
    const session = sessionRef.current; if (!session || busyRef.current) return;
    const current = structuredClone(session.getSnapshot().payload) as Payload;
    const copy: Payload = { ...current, ...{ adoptOperationId: crypto.randomUUID(), createOperationId: crypto.randomUUID(), adoptionReceipt: null, creationReceipt: null, creationState: 'idle', targetLocation: null, createAttempt: null, firstIssueAttempt: null, firstIssueReceipt: null, carryFragmentId: null, carryTarget: null } };
    // The source proof remains exact; saved Goal/Case authorities and the original pending intent stay untouched.
    const copyId = `prepare-${crypto.randomUUID()}`;
    try {
      const savedCopy = (await saveWorkspaceDraft('prepare', copyId, 0, { ...copy, preservedFromDraftId: session.id, preservedOriginalIntent: current })).draft;
      install(savedCopy); remember(savedCopy); setError(''); setNotice('当前输入已另存为独立准备；另一窗口的草稿及原保存结果保留。');
    } catch (failure) { setError(`另存未完成，当前输入仍保留。${caseError(failure)}`); }
  };
  const discard = async () => {
    const session = sessionRef.current; if (!session || busyRef.current) return;
    if (!await flush()) return;
    try { await discardWorkspaceDraft('prepare', session.id); setSaved(old => old.filter(d => d.id !== session.id)); install(); setNotice('已放弃这份草稿；已保存目标、Case 与原对话保留。'); }
    catch (failure) { setError(caseError(failure)); }
  };

  const openPreparation = () => {
    if (!payload.title && payload.rawInput.trim()) update({ title: payload.rawInput.trim().slice(0, 80), ...(!payload.description ? { description: payload.rawInput } : {}) });
    if (onCreateCase && !expanded) { void navigate(onCreateCase); return; }
    setPrepOpen(true); setManualOpen(true);
  };
  return <div className={`home-daily-quick-input ${expanded ? 'case-preparation-page' : 'case-intake-panel'}`} role="region" aria-label="轻输入与准备">
    {expanded ? <header className="case-prepare-heading"><div className="case-prepare-status">Case 准备草稿 · 关闭与返回都会保留</div><h1>先把这件事说清楚</h1><p>从一句话出发，先准备可编辑的 G/S。明确采纳并创建后，才会成为新的 Case。</p></header> : <div className="case-intake-heading"><span className="case-intake-icon" aria-hidden="true"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round"><path d="m13 2-8 12h6l-1 8 9-13h-6z" /></svg></span><label htmlFor={inputId}>有什么想推进的？</label><small>先说一句话，不必先填完整计划</small></div>}
    {!ready && <p className="case-help">正在恢复准备草稿…<button type="button" className="text-button" onClick={() => { void listWorkspaceDrafts<PreparationDraftPayload>('prepare').then(({ drafts }) => { setSaved(drafts); install(drafts.find(unfinished)); setReady(true); setError(''); }, failure => setError(caseError(failure))); }}>重新读取</button></p>}
    <div className={expanded ? 'case-prepare-original' : 'case-intake-editor'}>
      {expanded && <label htmlFor={inputId}>保留的输入</label>}
      <textarea id={inputId} rows={2} aria-label="描述想新建或继续的工作" value={payload.rawInput} disabled={!ready || creating || payload.creationState === 'completed'} onChange={e => update({ rawInput: e.target.value, carryFragmentId: null, carryTarget: null })} placeholder="说说你想解决的问题，或给已有工作补充一个新想法…" />
      {!expanded && <div className="home-daily-actions case-intake-controls">
        <button type="button" className="primary-button" disabled={!ready || searching || Boolean(loadingDirectory) || !payload.rawInput.trim()} onClick={() => { void organize(); }}>{searching ? '正在整理与查找…' : '整理与查找'}</button>
        <button type="button" className="secondary-button" disabled={!ready || creating} onClick={openPreparation}>直接准备新 Case</button>
        <span className="case-intake-save">输入会保留，切换页面不用重填{snapshot && (snapshot.revision > 0 || snapshot.dirty) && <button type="button" className="text-button" disabled={creating} onClick={() => { void discard(); }}>放弃这段草稿</button>}</span>
      </div>}
      {expanded && <small>这段输入尚未发送到任何已有对话；新建后将作为待带入片段保留。</small>}
    </div>
    {!expanded && <div className="case-intake-foot"><span>新想法、已有工作的进展，都可以先写在这里。</span><button type="button" className="text-button" disabled={!ready || creating} onClick={() => { setAgentOpen(v => !v); setPrepOpen(true); }}>{agentOpen ? '收起整理 Agent' : '请 Agent 整理与推荐（可选）'}</button>{onOpenAllProjects && <button type="button" className="text-button" onClick={() => { void navigate(onOpenAllProjects); }}>全部项目</button>}</div>}
    {payload.creationState === 'completed' && <button type="button" className="secondary-button" onClick={() => { void newPreparation(); }}>准备另一件 Case</button>}
    {snapshot?.conflict && <div className="case-message" role="alert"><p>准备草稿已在另一窗口修改。当前输入与远端输入均保留，未覆盖。</p><button type="button" className="secondary-button" onClick={() => { void preserveConflictingCopy(); }}>将当前输入另存为独立准备</button></div>}
    {notice && <p className="case-notice" role="status">{notice}</p>}{error && <div className="case-error" role="alert"><p>{error}</p>{snapshot?.dirty && <button type="button" className="text-button" disabled={!ready || creating} onClick={() => { void flush().then(ok => { if (ok) setNotice('准备内容已保存。'); }); }}>保存当前草稿</button>}</div>}
    {prepOpen && <div className="home-daily-prepare-box" role="region" aria-label="三分支 Case 准备">
      <div className="case-prepare-mode"><span>{lockedGoal ? 'G/S 及原保存结果已保留' : chosen ? '沿用已采纳目标版本' : '人工填写 · 无模型依赖'}</span><button type="button" className="text-button" disabled={!ready || creating} onClick={() => { setAgentOpen(v => !v); setManualOpen(true); }}>{agentOpen ? '收起整理 Agent' : '请 Agent 协助整理'}</button></div>
      <label className="case-prepare-existing">或使用已有 G/S<select value={chosen ? keyOf(chosen) : ''} disabled={!ready || creating || lockedGoal || payload.creationState === 'completed'} onChange={e => { const goal = goals.find(g => keyOf(g) === e.target.value); update({ selectedGoal: goal ? { goalId: goal.goalId, version: goal.version, strategy: '' } : null }); }}><option value="">选择已采纳目标版本，或在下方手填</option>{goals.filter(g => g.status === 'adopted').map(g => <option key={keyOf(g)} value={keyOf(g)}>{g.title} · v{g.version} · {g.scope.name}</option>)}</select></label>
      {activeGoal && <label>该版具体策略<select ref={selectedStrategyRef} value={chosen?.strategy ?? ''} disabled={creating || lockedGoal} onChange={e => update({ selectedGoal: { goalId: activeGoal.goalId, version: activeGoal.version, strategy: e.target.value } })}><option value="">请选择具体策略</option>{activeGoal.strategies?.map((s, i) => <option key={i} value={s}>{s}</option>)}</select></label>}
      <label>这件事的名字<input ref={titleInputRef} maxLength={80} value={payload.title} disabled={!ready || creating || payload.creationState === 'completed'} onChange={e => update({ title: e.target.value })} /></label>
      <details className="case-prepare-background"><summary>补充问题背景</summary><label>问题背景<textarea rows={2} value={payload.description} disabled={!ready || creating || payload.creationState === 'completed'} onChange={e => update({ description: e.target.value })} /></label></details>

      {!chosen && !expanded && <button type="button" className="text-button" disabled={!ready || creating} onClick={() => setManualOpen(v => !v)}>{manualOpen ? '收起目标编辑' : '手动填写或修改 G/S（无需模型）'}</button>}
      {!chosen && <>
        {manualOpen && <fieldset className="case-prepare-goal-fields" disabled={creating || lockedGoal}><legend className="sr-only">准备目标与策略</legend>
          <label>G · 目标名称<input ref={goalTitleInputRef} maxLength={200} value={goalDraft.title} onChange={e => patchGoal({ title: e.target.value })} /></label>
          <label>想看到什么结果<textarea ref={goalOutcomeRef} rows={2} maxLength={4000} value={goalDraft.outcome} onChange={e => patchGoal({ outcome: e.target.value })} /></label>
          <label>S · 这次先怎么推进<textarea ref={goalStrategyRef} rows={2} maxLength={2000} value={goalDraft.strategies?.[0] ?? ''} onChange={e => patchGoal({ strategies: [e.target.value, ...(goalDraft.strategies?.slice(1) ?? [])] })} /></label>
          {goalDraft.measurement.kind === 'deliverable' ? <label>可核成果<input ref={goalCriterionRef} maxLength={4000} value={goalDraft.measurement.criterion} onChange={e => patchGoal({ measurement: { kind: 'deliverable', criterion: e.target.value } })} /></label> : <p className="case-help">沿候选保留 SAP 指标 {goalDraft.measurement.sapMetric.id} v{goalDraft.measurement.sapMetric.version}。</p>}
          <label>责任角色／承担人<input ref={goalResponsibleRef} maxLength={300} value={goalDraft.responsible} onChange={e => patchGoal({ responsible: e.target.value })} /></label>
          {scope && scope.kind !== 'personal' && <label>目标视角<select value={goalDraft.perspective} onChange={e => patchGoal({ perspective: e.target.value as 'profit' | 'nonprofit' })}><option value="profit">营利组织</option><option value="nonprofit">非营利组织</option></select></label>}
          {goalDraft.roleSuggestion && <p className="case-help">已保留原 Agent 建议引用；保存时由原目标服务核对来源与归属。</p>}
        </fieldset>}
      </>}
      {(!chosen && (manualOpen || agentOpen)) && <fieldset disabled={creating || lockedGoal} className="case-reference-picker"><legend>明确目标归属</legend>
        <label>已有企业或个人<select ref={scopeSelectRef} value={scope?.kind === 'personal' ? 'personal' : scope?.id ?? ''} onChange={e => { const enterprise = enterprises.find(x => x.id === e.target.value); chooseScope(e.target.value === 'personal' ? { kind: 'personal', id: '', name: '' } : enterprise ? { kind: 'enterprise', id: enterprise.id, name: enterprise.name } : null); }}><option value="">请选择已有企业或个人</option>{enterprises.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}<option value="personal">个人目标</option></select></label>
        {scope?.kind === 'personal' && <label>个人归属名称<input ref={personalNameInputRef} maxLength={200} value={scope.name} onChange={e => chooseScope({ kind: 'personal', id: `personal:${e.target.value.trim()}`, name: e.target.value })} /></label>}
        {scope && !scope.id && <p className="case-help">请明确个人归属名称后使用整理 Agent。</p>}

      </fieldset>}
      {payload.pendingSuggestion && <div className="case-message"><strong>已保留 Agent 候选：{payload.pendingSuggestion.title}</strong><p>当前编辑内容继续保留。使用候选会另存当前编辑稿，再填入建议。</p><button type="button" className="secondary-button" disabled={lockedGoal} onClick={() => update({ previousGoalDrafts: [...(payload.previousGoalDrafts ?? []), ...(payload.goalDraft ? [payload.goalDraft] : [])], goalDraft: payload.pendingSuggestion, pendingSuggestion: null, previousSelectedGoal: chosen, selectedGoal: null, candidateGoal: null })}>保留当前编辑稿并使用候选</button></div>}
      {payload.previousGoalDrafts?.length ? <details><summary>此前保留的目标编辑稿</summary>{payload.previousGoalDrafts.map((d, i) => <article key={i}><strong>{d.title}</strong><p>{d.outcome}</p><p>{d.strategies?.join('；')}</p></article>)}</details> : null}
      {agentOpen && (scope?.id.trim() && scope.name.trim() ? <div className="home-daily-agent-box" role="region" aria-label="创建前整理 Agent"><BusinessRoleConversation key={`${draftId}:${scope.kind}:${scope.id}`} owner={{ role: 'goal-draft', draftId, scope }} openingPrompt={payload.rawInput} showInlineTitle={false} onGoalDraft={useSuggestion} /></div> : <p className="case-help">先明确实际个人或企业归属；手填路径始终可用。</p>)}
      {pending && <p className="case-help">原请求与操作已保留。继续先核原结果，当前名称、背景和输入的后续编辑不会改写原操作。</p>}
      <div className="home-daily-actions"><button type="button" className="primary-button" disabled={!ready || creating || payload.creationState === 'completed' && Boolean(payload.firstIssueReceipt)} onClick={() => { void runCreate(); }}>{creating ? '正在核对与提交…' : payload.creationState === 'completed' && !payload.firstIssueReceipt ? 'Case 已创建，核对并建立第一件事项' : pending ? '核对原操作并继续' : chosen ? activeGoal?.status === 'adopted' ? '创建或继续 Case' : '明确采纳此 G/S 并创建 Case' : '保存候选、明确采纳 G/S 并创建 Case'}</button></div>
      <p className="case-help">创建会建立 Case 与第一件事项，完整名称、背景和原输入保留为待带入片段，仍需明确追加与发送；不创建项目任务、不授权行动或宣布目标达成。</p>
      {result?.branch === 'created' && <button type="button" className="secondary-button" onClick={() => { void navigate(() => onOpenCase(result.createdCase.id, payload.firstIssueReceipt?.issueId)); }}>进入已创建 Case「{result.createdCase.title}」</button>}
      {result?.branch === 'continue' && <button type="button" className="secondary-button" onClick={() => { void navigate(() => onOpenCase(result.existingCase.id)); }}>查看原 Case「{result.existingCase.title}」{result.isClosed ? '（已结束）' : ''}</button>}
      {payload.creationReceipt && !result && <button type="button" className="secondary-button" onClick={() => { void navigate(() => onOpenCase(payload.creationReceipt!.caseId, payload.firstIssueReceipt?.issueId)); }}>查看已创建 Case</button>}
    </div>}
    {matches && <div className="home-daily-matches" aria-label="获准 Case 候选"><div className="case-match-heading"><h3>已找到的 Case</h3><span>由你选择继续哪件事</span></div><p className="case-match-original">保留的原输入：{payload.rawInput}</p>
      {matches.length ? matches.map(entry => <div key={entry.caseId} className="home-daily-match-row"><div><span className="case-match-badge">{entry.status === 'closed' ? '已结束 · 只读查看' : '可继续的原 Case'}</span><strong>{entry.title}</strong>{entry.goalBinding && <p className="case-match-goal">{goals.find(goal => keyOf(goal) === keyOf(entry.goalBinding!))?.title || '原目标版本'} · v{entry.goalBinding.version} · {entry.goalBinding.strategy}</p>}
        {entry.issues.length ? <label>目标事项<select aria-label={`选择 ${entry.title} 的目标事项`} value={selectedIssues[entry.caseId] ?? ''} onChange={e => setSelectedIssues(old => ({ ...old, [entry.caseId]: e.target.value }))}><option value="">请选择原事项</option>{entry.issues.map(i => <option key={i.issueId} value={i.issueId}>{i.title}</option>)}</select></label> : <p className="case-help">{entry.totalIssues > 0 || entry.issuesTruncated ? '事项尚未读完，可继续读取。' : '暂无独立事项，进入后可明确建立事项。'}</p>}
        {entry.issuesTruncated && <div className="case-help">已读取 {entry.issues.length} / {entry.totalIssues} 件事项。<button type="button" className="text-button" aria-label={`读取 ${entry.title} 的更多事项`} disabled={searching || Boolean(loadingDirectory)} onClick={() => { void readMoreIssues(entry); }}>{loadingDirectory === entry.caseId ? '正在读取事项…' : '读取更多事项'}</button></div>}
      </div><div className="home-daily-actions"><button type="button" className="secondary-button" disabled={!payload.rawInput.trim() || !selectedIssues[entry.caseId]} onClick={() => { void carry(entry); }}>带入所选事项</button><button type="button" className="text-button" onClick={() => { void navigate(() => onOpenCase(entry.caseId, selectedIssues[entry.caseId] || undefined)); }}>直接继续</button></div></div>) : <p className="case-help">当前已读目录无适用 Case，可继续查找或人工准备新 G/S。</p>}
      <div className="case-match-footer"><button type="button" className="text-button" onClick={openPreparation}>仍然准备新 Case</button><span>浏览与整理不创建、不采纳、不写入既有对话。</span></div>
      {nextCaseOffset !== null && <button type="button" className="text-button" disabled={searching || Boolean(loadingDirectory)} onClick={() => { void readMoreCases(); }}>{loadingDirectory === 'cases' ? '正在读取 Case…' : '读取更多 Case'}</button>}
    </div>}
    {expanded && <div className="case-prepare-links"><button type="button" className="text-button" disabled={!ready || searching || Boolean(loadingDirectory)} onClick={() => { void organize(); }}>查找已有 Case</button><button type="button" className="text-button" disabled={!ready || creating} onClick={() => { void discard(); }}>明确放弃这份准备草稿</button>{onOpenAllProjects && <button type="button" className="text-button" onClick={() => { void navigate(onOpenAllProjects); }}>查看全部项目</button>}</div>}
    {saved.some(d => d.id !== draftId && unfinished(d)) && <details><summary>继续其他准备草稿</summary>{saved.filter(d => d.id !== draftId && unfinished(d)).map(d => <div key={d.id} className="case-message"><strong>{d.payload.title || d.payload.rawInput.slice(0, 60) || '未命名准备'}</strong><button type="button" className="text-button" onClick={() => { void flush().then(ok => { if (ok) { install(d); setPrepOpen(true); } }); }}>恢复这份准备{d.payload.creationState.startsWith('partial') ? '并核对原操作' : ''}</button></div>)}</details>}
  </div>;
}
// Render-only placeholder. Real intent IDs are allocated once by install(), never during rendering.
const emptyPayload = { rawInput: '', title: '', description: '', selectedGoal: null, adoptionReceipt: null, creationReceipt: null, creationState: 'idle' } as Payload;
