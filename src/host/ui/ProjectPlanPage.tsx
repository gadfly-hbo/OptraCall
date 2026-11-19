import type { UsageContext } from '../usage-context-types.ts';
import { resolveNewUsageContext } from '../usage-context-types.ts';
import { suggestProjectPlanUsage } from './project-plan-usage-context.ts';
import * as goalApi from './strategy-goals-client.ts';
import { UsageContextFields, usageKindLabels } from './UsageContextSettingsPage.tsx';
import { readUsageContextSettings } from './usage-context-client.ts';
import { useEffect, useId, useRef, useState } from 'react';
import type { GoalRef } from '../strategy-goals-types.ts';
import type { DbLinkPlanningSource } from '../db-link-planning.ts';
import type { ProjectPlanState, ProjectPlanConfirmResult, ProjectPlanContent, ProjectPlanTask, ProjectPlanCapabilityRef, ProjectPlanMaterialRef, ProjectPlanDraftInput, ProjectPlanConfirmInput, ProjectPlanDraftResult, ProjectPlanPreparationProjection, ProjectPlanPreparationResult } from '../project-plan-types.ts';
import type { ClientProject } from './project-types.ts';
import * as api from './project-plan-client.ts';
import type { ProjectPlanCapabilities } from './project-plan-client.ts';
import * as caseApi from './case-client.ts';
import type { CaseDetail, CaseGoalBindingInput, CaseRecord, CaseStorageStatus } from './case-client.ts';
import { CaseEditor, caseError } from './CaseDialogs.tsx';
import { connectProjectPlanCase, readPendingProjectCase, savePendingProjectCase, clearPendingProjectCase, type ProjectPlanCaseConnection, type ProjectPlanCaseContext } from './project-plan-case-client.ts';
import { catalogItems } from './catalog-data.ts';
import './project-plan.css';
export interface ProjectPlanPageProps {
  project: ClientProject;
  historyOnly?: boolean;
  initialGoal?: GoalRef;
  initialUsageContext?: UsageContext;
  initialState?: ProjectPlanState;
  initialCapabilities?: ProjectPlanCapabilities;
  newTaskIntent?: string;
  onBack(): void;
  onConfirmed(result: ProjectPlanConfirmResult): void | Promise<void>;
  onOpenTask(taskId: string): void;
  onManageCapabilities?(): void;
}
const emptyCapabilities = (): ProjectPlanCapabilities => ({ skills: [], methods: [], connectors: [], materials: [], caseContexts: [] });
const referenceKey = (value: { kind: string; id: string; version?: string; sha256?: string }) => JSON.stringify([value.kind, value.id, value.version ?? '', value.sha256 ?? '', 'permissionRef' in value ? value.permissionRef || '' : '']);
const statusLabel: Record<string, string> = { pending: '尚未开始', 'not-required': '复用已有任务', created: '已创建', 'not-requested': '未要求执行', accepted: '已接纳启动', failed: '失败', unknown: 'UNKNOWN · 待核对', cancelled: '已取消' };
const purposeLabels: Record<NonNullable<ProjectPlanContent['goalContext']>['purpose'], string> = { query: '查询与核对', 'asset-construction': 'Studio／资产建设', 'assigned-work': 'GSA已明确安排的工作', 'case-investigation': '持续经营事项调查与推进（由Case承接）' };
const databaseState: Record<DbLinkPlanningSource['state'], string> = { available: '沿原授权使用 · 尚未读取本轮数据', revoked: '本项目已撤权', 'configuration-changed': '配置已变化，请核对原授权', excluded: '本任务已排除此来源' };
function initialPlan(project: ClientProject): ProjectPlanContent {
  const first = project.tasks.find(task => !task.archivedAt);
  const tasks: ProjectPlanTask[] = project.tasks.map(task => ({ key: task.id, name: task.name, taskId: task.id, selected: task.id === first?.id, scope: '', capabilities: [] }));
  if (!first) tasks.push({ key: 'task-' + crypto.randomUUID(), name: '本次分析', selected: true, scope: '', capabilities: [] });
  return { request: project.work?.workScope || project.name, premises: [], materials: [], coverage: [], tasks, taskMode: 'single', summaryTaskKey: first?.id || tasks.at(-1)!.key, dependencies: [], caseContext: null };
}
type Pending = { kind: 'draft' | 'prepare'; input: ProjectPlanDraftInput } | { kind: 'confirm'; input: ProjectPlanConfirmInput };
const preparationLabel = { running: 'Agent 正在轻量梳理，尚未保存完成草稿。', completed: 'Agent 已完成轻量梳理，结果仍是待确认草稿。', cancelled: '本次梳理已取消，未据此确认或启动分析。', failed: '本次梳理失败，保留原方案与失败记录。', unknown: '本次梳理结果 UNKNOWN，先核对原操作，不自动重发。' };
function PlanHistory({ project, onBack, onOpenTask }: Pick<ProjectPlanPageProps, 'project' | 'onBack' | 'onOpenTask'>) {
  const [state, setState] = useState<ProjectPlanState>(), [error, setError] = useState('');
  useEffect(() => {
    let current = true;
    setState(undefined); setError('');
    void api.read(project.id).then(record => { if (current) setState(record); })
      .catch(reason => { if (current) setError(reason instanceof Error ? reason.message : '无法读取原方案'); });
    return () => { current = false; };
  }, [project.id]);
  return <section className="project-plan-page"><header className="case-board-heading"><h1>{project.name} · 原方案与历史回执</h1><button type="button" className="text-button" onClick={onBack}>返回项目</button></header>
    {error && <p role="alert">{error}</p>}
    {state && !state.history.length && !state.draft && <p>本项目没有原方案记录。</p>}
    {state?.draft && <details><summary>原草稿 v{state.draft.version}</summary><pre>{JSON.stringify(state.draft.plan, null, 2)}</pre></details>}
    {state?.history.map(entry => <section key={entry.id} className="project-plan-section"><h2>确认方案 v{entry.planVersion}</h2><p>{entry.plan.request}</p>
      <ul>{entry.plan.premises.map((text, i) => <li key={i}>{text}</li>)}</ul>
      {entry.tasks.map(task => <div key={task.taskKey}>{entry.plan.tasks.find(row => row.key === task.taskKey)?.name} · {statusLabel[task.createStatus]} · {statusLabel[task.startStatus]} {project.tasks.some(row => row.id === task.taskId) && <button type="button" className="text-button" onClick={() => onOpenTask(task.taskId)}>打开原任务</button>}</div>)}
      <details><summary>准确方案及授权历史</summary><pre>{JSON.stringify(entry, null, 2)}</pre></details></section>)}
  </section>;
}
export function ProjectPlanPage(props: ProjectPlanPageProps) {
  return props.historyOnly ? <PlanHistory {...props}/> : <LegacyPlanEditor {...props}/>;
}
function LegacyPlanEditor({ project, initialGoal, initialUsageContext, initialState, initialCapabilities, newTaskIntent, onBack, onConfirmed, onOpenTask, onManageCapabilities }: ProjectPlanPageProps) {
  const id = useId(), scope = useRef(project.id), alive = useRef(true); scope.current = project.id;
  const [state, setState] = useState<ProjectPlanState | undefined>(initialState), [catalog, setCatalog] = useState(initialCapabilities || emptyCapabilities());
  const [catalogKnown, setCatalogKnown] = useState(!!initialCapabilities);
  const [plan, setPlan] = useState<ProjectPlanContent>(() => structuredClone(initialState?.draft?.plan || suggestProjectPlanUsage(initialPlan(project), initialUsageContext, 'goal')));
  const [entranceGoal, setEntranceGoal] = useState<GoalRef | undefined>(() => initialGoal ? structuredClone(initialGoal) : undefined);
  const loadedProject = useRef<string | undefined>(undefined);
  const [loading, setLoading] = useState(!initialState || !initialCapabilities), [busy, setBusy] = useState(false), [dirty, setDirty] = useState(!initialState?.draft), [pending, setPending] = useState<Pending>();
  const [error, setError] = useState(''), [notice, setNotice] = useState(''), [recovery, setRecovery] = useState('');
  const [stopping, setStopping] = useState(false);
  const [caseDirectory, setCaseDirectory] = useState<CaseRecord[]>([]), [caseStorage, setCaseStorage] = useState<CaseStorageStatus | null>(null), [caseNotice, setCaseNotice] = useState('');
  const [caseCreating, setCaseCreating] = useState(false), [caseBusy, setCaseBusy] = useState(false), [selectedCase, setSelectedCase] = useState<CaseDetail | null>(null);
  const [caseConnection, setCaseConnection] = useState<ProjectPlanCaseConnection | null>(null), [connectionStorageError, setConnectionStorageError] = useState('');
  const connection = useRef<ProjectPlanCaseConnection | null>(null), handledTaskIntents = useRef(new Set<string>());
  const preparations = state?.preparations?.map(item => item.status === 'completed' && !state.operations?.some(operation => operation.kind === 'prepare' && operation.operationId === item.operationId && operation.planVersion === item.draftVersion && operation.requestHash === item.inputHash) ? { ...item, status: 'unknown' as const } : item);
  const activePreparation = preparations?.slice().reverse().find(item => item.status === 'running' || item.status === 'unknown');
  const preparation = activePreparation || preparations?.at(-1);
  const readonly = !!project.archivedAt, locked = loading || busy || !!pending || !!activePreparation || readonly || caseBusy || !!caseConnection;
  const current = (projectId: string) => alive.current && scope.current === projectId;
  useEffect(() => {
    alive.current = true; let active = true; const projectId = project.id;
    loadedProject.current = undefined; setEntranceGoal(initialGoal ? structuredClone(initialGoal) : undefined);
    setLoading(true); setError(''); setNotice(''); setRecovery(''); setPending(undefined); setBusy(false); setStopping(false);
    setState(initialState?.projectId === projectId ? initialState : undefined); setPlan(structuredClone(initialState?.projectId === projectId && initialState.draft ? initialState.draft.plan : suggestProjectPlanUsage(initialPlan(project), initialUsageContext, 'goal'))); setDirty(!initialState?.draft);
    setCaseDirectory([]); setCaseStorage(null); setSelectedCase(null); setCaseCreating(false); setCaseBusy(false); setCaseNotice(''); setConnectionStorageError('');
    try { connection.current = readPendingProjectCase(window.sessionStorage, projectId); setCaseConnection(connection.current); }
    catch { connection.current = null; setCaseConnection(null); setConnectionStorageError('原Case关联尝试暂存不可核对，未覆盖或另建。请保留浏览器记录，先核对原Case操作；查询和其他独立工作可继续。'); }
    void Promise.allSettled([caseApi.status(), caseApi.list()]).then(([storage, directory]) => {
      if (!active || !current(projectId)) return;
      if (storage.status === 'fulfilled') setCaseStorage(storage.value);
      if (directory.status === 'fulfilled') setCaseDirectory(directory.value.cases);
      else setCaseNotice('原Case目录暂不可读取；不会据此猜测或建立Case。');
    });
    void Promise.allSettled([api.read(projectId), api.capabilities(projectId), readUsageContextSettings()]).then(results => {
      if (!active || !current(projectId)) return;
      const [saved, capabilities, defaultUsage] = results;
      if (saved.status === 'fulfilled') { setState(saved.value); if (saved.value.draft) { setPlan(structuredClone(saved.value.draft.plan)); setDirty(false); } else if (saved.value.revision === 0 && !saved.value.confirmed && !saved.value.history.length) { const context = initialUsageContext || (defaultUsage.status === 'fulfilled' ? defaultUsage.value.context : undefined); if (context) setPlan(previous => suggestProjectPlanUsage(previous, context, initialUsageContext ? 'goal' : 'default')); } }
      if (capabilities.status === 'fulfilled') { setCatalog(capabilities.value); setCatalogKnown(true); }
      else { setCatalog(emptyCapabilities()); setCatalogKnown(false); }
      if (saved.status === 'rejected' || capabilities.status === 'rejected') setError(api.projectPlanError(saved.status === 'rejected' ? saved.reason : capabilities.status === 'rejected' ? capabilities.reason : undefined));
      loadedProject.current = projectId; setLoading(false);
    });
    return () => { active = false; alive.current = false; };
  }, [project.id]);
  useEffect(() => { if (initialGoal) setEntranceGoal(value => value ?? structuredClone(initialGoal)); }, [initialGoal?.goalId, initialGoal?.version]);
  const taskIdentity = (task: ProjectPlanTask) => task.taskId || state?.confirmed?.tasks.find(receipt => receipt.taskKey === task.key && ['created', 'not-required'].includes(receipt.createStatus))?.taskId;
  function edit(update: (value: ProjectPlanContent) => ProjectPlanContent) { setPlan(value => update({ ...value, tasks: value.tasks.map(task => { const taskId = taskIdentity(task); return !task.taskId && taskId ? { ...task, taskId } : task; }) })); setDirty(true); setNotice(''); }
  function updateTask(taskKey: string, patch: Partial<ProjectPlanTask>) { edit(value => ({ ...value, tasks: value.tasks.map(task => task.key === taskKey ? { ...task, ...patch } : task) })); }
  const taskArchived = (task: ProjectPlanTask) => !!project.tasks.find(existing => existing.id === taskIdentity(task))?.archivedAt;
  const eligible = plan.tasks.filter(task => !taskArchived(task) && (taskIdentity(task) || task.selected));
  const selected = plan.tasks.filter(task => task.selected);
  const databaseSource = (ref: ProjectPlanMaterialRef | ProjectPlanCapabilityRef, taskId?: string) => ref.kind === 'connector' && ref.id.startsWith('db-link:') ? catalog.databaseSources?.find(source => source.taskId === taskId && referenceKey({ kind: 'connector', ...source }) === referenceKey(ref)) : undefined;
  const materials = catalog.materials.filter(material => !material.taskId);
  const capabilitiesForTask = (taskId?: string): (ProjectPlanCapabilityRef & { title: string; enabled: boolean; database?: DbLinkPlanningSource })[] => [
    ...catalog.skills.map(item => ({ kind: 'skill' as const, ...item, enabled: true })),
    ...catalog.methods.map(item => ({ kind: 'sap-method' as const, ...item, enabled: true })),
    ...catalog.connectors.filter(item => !item.id.startsWith('db-link:') || item.taskId === taskId).map(item => {
      const ref = { kind: 'connector' as const, id: item.id, ...(item.version === undefined ? {} : { version: item.version }), ...(item.sha256 === undefined ? {} : { sha256: item.sha256 }), ...(item.permissionRef === undefined ? {} : { permissionRef: item.permissionRef }) };
      const database = databaseSource(ref, taskId);
      return { ...ref, title: item.title, enabled: item.enabled && (!item.id.startsWith('db-link:') || Boolean(database?.enabled)), ...(database ? { database } : {}) };
    }),
  ];
  function selectTask(taskKey: string, checked: boolean) {
    edit(value => ({ ...value, tasks: value.tasks.map(task => ({ ...task, selected: task.key === taskKey ? checked : value.taskMode === 'single' && checked ? false : task.selected })), summaryTaskKey: value.taskMode === 'single' && checked ? taskKey : value.summaryTaskKey }));
  }
  function selectMode(mode: 'single' | 'multi') {
    edit(value => { const first = value.tasks.find(task => task.selected && !taskArchived(task)) || value.tasks.find(task => !taskArchived(task)); return { ...value, taskMode: mode, tasks: value.tasks.map(task => ({ ...task, selected: mode === 'single' ? task.key === first?.key : task.selected })), summaryTaskKey: mode === 'single' ? first?.key || '' : value.summaryTaskKey }; });
  }
  function addTask() {
    edit(value => { const taskKey = 'task-' + crypto.randomUUID(); return { ...value, tasks: [...value.tasks.map(task => ({ ...task, selected: value.taskMode === 'single' ? false : task.selected })), { key: taskKey, name: `新增任务 ${value.tasks.length + 1}`, selected: true, scope: '', capabilities: [] }], summaryTaskKey: value.taskMode === 'single' ? taskKey : value.summaryTaskKey }; });
  }
  useEffect(() => {
    if (loading || loadedProject.current !== project.id || !newTaskIntent || readonly) return;
    const key = `${project.id}:${newTaskIntent}`; if (handledTaskIntents.current.has(key)) return; handledTaskIntents.current.add(key);
    setPlan(value => {
      const taskKey = `task-${newTaskIntent}`; if (value.tasks.some(task => task.key === taskKey)) return value;
      const choose = value.taskMode === 'multi' || !value.tasks.some(task => task.selected);
      return { ...value, tasks: [...value.tasks, { key: taskKey, name: '新增任务', selected: choose, scope: '', capabilities: [] }], summaryTaskKey: value.summaryTaskKey || taskKey };
    });
    setDirty(true); setNotice('已加入一条待确认的新任务草稿，原输入和已有选择保留；请核对所选任务与综合责任。');
  }, [loading, project.id, newTaskIntent, readonly]);
  const sourceGoal = plan.goalContext?.goal ?? entranceGoal;
  useEffect(() => {
    if (loading || plan.usageContextOrigin === 'explicit' || plan.usageContext && plan.usageContextOrigin === undefined) return;
    let active = true; const projectId = project.id;
    if (sourceGoal) void goalApi.list().then(index => {
      const exact = index.goals.find(record => record.id === sourceGoal.goalId)?.versions.find(version => version.version === sourceGoal.version);
      if (!exact) throw new Error('准确目标背景暂不可读取，原输入保留；未换用今日默认。');
      if (active && current(projectId)) setPlan(value => suggestProjectPlanUsage(value, resolveNewUsageContext({ goal: exact }), 'goal'));
    }).catch(fault => { if (active && current(projectId)) setError(fault instanceof Error ? fault.message : '准确目标背景暂不可读取，原输入保留。'); });
    return () => { active = false; };
  }, [loading, project.id, sourceGoal?.goalId, sourceGoal?.version, plan.usageContextOrigin]);
  const matchesSourceGoal = (binding: { primary: GoalRef; related?: GoalRef[] }) => !sourceGoal || [binding.primary, ...(binding.related || [])].some(goal => goal.goalId === sourceGoal.goalId && goal.version === sourceGoal.version);
  function problem(): string {
    if (!plan.request.trim()) return '请先说明本次诉求。';
    if (sourceGoal && !plan.goalContext) return '请明确本次来源目标的用途；持续经营事项由Case承接，查询、建设和已明确工作可直接开展。';
    if (plan.goalContext?.purpose === 'case-investigation' && !plan.caseContext) return '本次明确为持续经营事项调查与推进，请建立或采用真实Case并关联本项目。';
    if (plan.caseContext && !matchesSourceGoal({ primary: plan.caseContext.primaryGoal, related: plan.caseContext.relatedGoals })) return '所选Case的主目标或关联目标未包含本次来源目标准确版本，请回原Case核对后再明确采用。';
    if (!selected.length || selected.some(task => taskArchived(task)) || plan.tasks.some(task => !task.name.trim())) return '请选择至少一个可用任务，并补充待创建任务名称。';
    if (!eligible.some(task => task.key === plan.summaryTaskKey) || plan.taskMode === 'single' && (selected.length !== 1 || selected[0].key !== plan.summaryTaskKey)) return '请明确本项目有效的综合责任。';
    if (plan.coverage.some(item => !item.label.trim())) return '请补充已加入的覆盖方面名称；无需把全部方面建成任务。';
    return '';
  }
  async function inspect(intent: Pending | undefined = pending) {
    const projectId = project.id;
    try {
      const saved = await api.read(projectId); if (!current(projectId)) return;
      setState(saved);
      if (!intent) { setNotice('已只读核对保存状态，本页未保存的输入继续保留。'); return; }
      if (intent.kind === 'prepare') {
        const result = await api.findPreparation(saved, intent.input); if (!current(projectId)) return;
        setRecovery(result.status);
        if (result.status === 'completed') {
          setPending(undefined); setError('');
          if (saved.draft && saved.draft.version === result.preparation?.draftVersion) { setPlan(structuredClone(saved.draft.plan)); setDirty(false); setNotice('已核实原 Agent 梳理草稿；请编辑核对，再一次确认创建或开始。'); }
          else setNotice('原梳理结果已保存，当前另有更新草稿；本页输入保留，请先比较原版本。');
        } else if (result.status === 'cancelled' || result.status === 'failed') { setPending(undefined); setError(''); setNotice(preparationLabel[result.status]); }
        else setError(result.status === 'conflict' ? '原梳理输入与本页意图不一致，请保留原意图；修改应另存新稿。' : result.status === 'running' ? preparationLabel.running : '原梳理结果尚未核实，保留原操作编号；本页没有自动重发。');
        return result.status;
      }
      const result = await api.findOperation(saved, intent.input); if (!current(projectId)) return;
      setRecovery(result.status);
      if (result.status === 'saved') {
        setPending(undefined); setError('');
        if (intent.kind === 'draft' && saved.draft && saved.draft.version === result.operation?.planVersion) { setPlan(structuredClone(saved.draft.plan)); setDirty(false); setNotice('原草稿已核实保存，未执行任务。请按本次意图确认创建或开始。'); }
        else if (intent.kind === 'confirm') {
          const confirmation = saved.history.find(item => item.id === result.operation?.confirmationId);
          if (confirmation) { setNotice('已回读原确认结果，未重发或重复创建；各任务状态见下方。'); await onConfirmed({ state: saved, confirmation, replayed: true }); }
        } else setNotice('原操作已核实，当前另有更新版本；本页输入保留，请比较后再保存。');
      } else setError(result.status === 'conflict' ? '原操作内容与本页意图不一致。保留原意图；修改内容应明确另存新稿。' : '原操作结果尚未核实，输入和原操作编号保留；本页没有自动重发。');
    } catch (fault) { if (current(projectId)) setError(api.projectPlanError(fault)); }
  }
  function applyPreparation(result: ProjectPlanPreparationResult) {
    setState({ ...result.state, preparations: [...(result.state.preparations || []).filter(item => item.operationId !== result.preparation.operationId), result.preparation] });
    if (result.preparation.status === 'completed' && result.draft && result.draft.version === result.preparation.draftVersion) { setPlan(structuredClone(result.draft.plan)); setDirty(false); setPending(undefined); setNotice('Agent 已保存可编辑的轻量草稿；请核对本轮范围、方法与综合责任，再一次确认。'); }
    else if (result.preparation.status === 'cancelled' || result.preparation.status === 'failed') { setPending(undefined); setNotice(preparationLabel[result.preparation.status]); }
  }
  async function prepare() {
    if (locked) return; const issue = problem(); if (issue) { setError(issue); return; }
    const projectId = project.id, intent: Pending & { kind: 'prepare' } = { kind: 'prepare', input: { operationId: crypto.randomUUID(), expectedRevision: state?.revision || 0, plan: structuredClone(plan) } };
    setBusy(true); setError(''); setNotice(''); setPending(intent);
    try {
      const inputHash = await api.projectPlanInputHash(intent.input); if (!current(projectId)) return;
      setState(value => ({ ...(value || { formatVersion: 1, projectId, revision: 0, history: [] }), preparations: [...(value?.preparations || []), { operationId: intent.input.operationId, status: 'running', inputHash }] }));
      const result = await api.prepare(projectId, intent.input); if (!current(projectId)) return;
      applyPreparation(result);
      if (result.preparation.status !== 'completed' || !result.draft) await inspect(intent);
    } catch (fault) { if (!current(projectId)) return; setError(api.projectPlanError(fault)); const outcome = await inspect(intent); if (current(projectId) && fault instanceof api.ProjectPlanRequestError && !fault.uncertain && outcome === 'not-found') setPending(undefined); }
    finally { if (current(projectId)) setBusy(false); }
  }
  async function stopPreparation(operation: ProjectPlanPreparationProjection) {
    if (readonly || stopping) return; const projectId = project.id; setStopping(true); setError('');
    try {
      await api.stopPreparation(projectId, operation.operationId); if (!current(projectId)) return;
      setNotice('已请求停止本次梳理，正在只读核对原会话结果；停止不会启动分析。');
      await inspect(pending?.kind === 'prepare' && pending.input.operationId === operation.operationId ? pending : undefined);
    } catch (fault) { if (current(projectId)) { setError(api.projectPlanError(fault)); await inspect(); } }
    finally { if (current(projectId)) setStopping(false); }
  }
  async function saveIntent(): Promise<ProjectPlanDraftResult | null> {
    const projectId = project.id, intent: Pending & { kind: 'draft' } = { kind: 'draft', input: { operationId: crypto.randomUUID(), expectedRevision: state?.revision || 0, plan: structuredClone(plan) } };
    try {
      const result = await api.saveDraft(projectId, intent.input); if (!current(projectId)) return null;
      setState(result.state); setPlan(structuredClone(result.draft.plan)); setDirty(false); setNotice('项目草稿已保存，尚未确认，也未运行任务。'); return result;
    } catch (fault) {
      if (!current(projectId)) return null;
      setError(api.projectPlanError(fault));
      if (fault instanceof api.ProjectPlanRequestError && fault.uncertain) { setPending(intent); await inspect(intent); }
      return null;
    }
  }
  async function save() { if (locked) return; const issue = problem(); if (issue) { setError(issue); return; } setBusy(true); setError(''); try { await saveIntent(); } finally { if (current(project.id)) setBusy(false); } }
  async function confirm(mode: 'create' | 'start') {
    if (locked) return; const issue = problem(); if (issue) { setError(issue); return; }
    const projectId = project.id; setBusy(true); setError(''); setNotice('');
    try {
      let saved = state;
      if (dirty || !state?.draft) { const result = await saveIntent(); if (!result) return; saved = result.state; }
      if (!current(projectId)) return;
      const intent: Pending & { kind: 'confirm' } = { kind: 'confirm', input: { operationId: crypto.randomUUID(), expectedRevision: saved?.revision || 0, mode } };
      try {
        const result = await api.confirm(projectId, intent.input); if (!current(projectId)) return;
        setState(result.state); setDirty(false); setNotice(mode === 'create' ? '已确认并承接任务创建；未要求执行。各步骤结果见下方。' : '已确认并承接所选任务及综合责任的开始授权；实际执行结果沿原任务核对。');
        await onConfirmed(result);
      } catch (fault) { if (!current(projectId)) return; setError(api.projectPlanError(fault)); if (fault instanceof api.ProjectPlanRequestError && fault.uncertain) { setPending(intent); await inspect(intent); } }
    } finally { if (current(projectId)) setBusy(false); }
  }
  const contextRef = (context: ProjectPlanCaseContext): NonNullable<ProjectPlanContent['caseContext']> => ({ caseId: context.caseId, primaryGoal: structuredClone(context.primaryGoal), ...(context.relatedGoals ? { relatedGoals: structuredClone(context.relatedGoals) } : {}), ...(context.caseRevision === undefined ? {} : { caseRevision: context.caseRevision }), ...(context.projectWorkRevision === undefined ? {} : { projectWorkRevision: context.projectWorkRevision }) });
  async function connectCase(intent: ProjectPlanCaseConnection, readOnly = false) {
    const projectId = intent.projectId; if (readonly || caseBusy) return;
    setCaseBusy(true); setError(''); setCaseNotice('');
    const remember = (value: ProjectPlanCaseConnection) => {
      savePendingProjectCase(window.sessionStorage, value); connection.current = value;
      if (current(projectId)) setCaseConnection(structuredClone(value));
    };
    try {
      remember(intent);
      const context = await connectProjectPlanCase(intent, { readOnly, changed: remember });
      if (!current(projectId)) return;
      if (!context) { setCaseNotice(intent.caseId ? '原Case创建已核实；关联本项目尚未开始，可继续同一关联意图。' : '原Case操作尚未开始；未据此建立或关联。'); return; }
      if (!matchesSourceGoal({ primary: context.primaryGoal, related: context.relatedGoals })) throw new Error('原Case的主目标或关联目标未包含来源目标准确版本，请保留记录并核对。');
      const goalContextKey = (value: NonNullable<ProjectPlanContent['goalContext']>) => JSON.stringify([value.goal.goalId, value.goal.version, value.purpose]);
      if (intent.goalContext && plan.goalContext && goalContextKey(intent.goalContext) !== goalContextKey(plan.goalContext)) throw new Error('原Case关联的目标准确版或用户用途与当前草稿不同，请保留两者核对；未自动改绑或改用途。');
      clearPendingProjectCase(window.sessionStorage, projectId); connection.current = null; setCaseConnection(null);
      setCatalog(value => ({ ...value, caseContexts: [...value.caseContexts.filter(row => row.caseId !== context.caseId), context] }));
      edit(value => ({ ...value, caseContext: contextRef(context), goalContext: structuredClone(intent.goalContext ?? value.goalContext ?? { goal: sourceGoal ?? context.primaryGoal, purpose: 'case-investigation' }) }));
      setSelectedCase(null); setNotice(`已在本页草稿采用原Case第${context.caseRevision}版及主目标第${context.primaryGoal.version}版，并准确关联当前项目；尚未确认或执行。`);
      void caseApi.list().then(directory => { if (current(projectId)) setCaseDirectory(directory.cases); }).catch(() => { if (current(projectId)) setCaseNotice('Case已关联并采用，原Case目录刷新暂不可用；准确引用保留。'); });
    } catch (fault) {
      if (current(projectId)) setError(fault instanceof Error ? fault.message : caseError(fault));
      if (!intent.caseId && !intent.createAttempted && intent.failure) {
        clearPendingProjectCase(window.sessionStorage, projectId); connection.current = null; if (current(projectId)) setCaseConnection(null);
      }
      throw fault;
    } finally { if (current(projectId)) setCaseBusy(false); }
  }
  async function createCase(fields: { title: string; description: string; goalBinding?: CaseGoalBindingInput }, operationId: string) {
    if (!fields.goalBinding) throw new caseApi.CaseRequestError('case_primary_goal_required', 400);
    if (!matchesSourceGoal(fields.goalBinding)) { const error = new caseApi.CaseRequestError('project_plan_goal_case_mismatch', 409); error.message = 'Case主目标或关联目标须包含本次来源目标准确版本；请保留输入并明确选择。'; throw error; }
    let intent = connection.current;
    if (intent && intent.create?.operationId !== operationId) throw new Error('原Case关联仍待核对，请保留原操作；未发起另一创建。');
    intent ??= { projectId: project.id, create: { operationId, title: fields.title, description: fields.description, goalBinding: structuredClone(fields.goalBinding) }, goalBinding: structuredClone(fields.goalBinding), goalContext: structuredClone(plan.goalContext ?? { goal: sourceGoal ?? fields.goalBinding.primary, purpose: 'case-investigation' }), linkOperationId: crypto.randomUUID() };
    await connectCase(intent);
  }
  async function chooseExistingCase(caseId: string) {
    const projectId = project.id; setSelectedCase(null); setCaseNotice(''); if (!caseId) return;
    setCaseBusy(true);
    try { const detail = await caseApi.detail(caseId); if (!current(projectId)) return; setSelectedCase(detail); if (!detail.goalBinding) setCaseNotice('此Case尚未明确主目标，请先回原Case记录明确后再采用；没有补猜目标。'); }
    catch (fault) { if (current(projectId)) setCaseNotice(caseError(fault)); }
    finally { if (current(projectId)) setCaseBusy(false); }
  }
  async function useExistingCase() {
    if (!selectedCase?.goalBinding || !matchesSourceGoal(selectedCase.goalBinding) || selectedCase.case.status === 'closed' || connection.current) return;
    await connectCase({ projectId: project.id, caseId: selectedCase.case.id, caseRevision: selectedCase.case.revision, goalBinding: structuredClone({ primary: selectedCase.goalBinding.primary, related: selectedCase.goalBinding.related }), goalContext: structuredClone(plan.goalContext ?? { goal: sourceGoal ?? selectedCase.goalBinding.primary, purpose: 'case-investigation' }), linkOperationId: crypto.randomUUID() });
  }
  async function initializeCases() {
    const projectId = project.id; setCaseBusy(true); setCaseNotice('');
    try { const status = await caseApi.init(); const directory = await caseApi.list(); if (current(projectId)) { setCaseStorage(status); setCaseDirectory(directory.cases); } }
    catch (fault) { if (current(projectId)) setCaseNotice(caseError(fault)); }
    finally { if (current(projectId)) setCaseBusy(false); }
  }
  async function keepCreatedCase() {
    const value = connection.current; if (!value?.caseId || !value.failure && value.linkedRevision === undefined || caseBusy) return;
    const detail = await caseApi.detail(value.caseId); if (!current(value.projectId)) return;
    clearPendingProjectCase(window.sessionStorage, value.projectId); connection.current = null; setCaseConnection(null); setSelectedCase(detail);
    if (value.goalContext && !plan.goalContext) edit(plan => ({ ...plan, goalContext: structuredClone(value.goalContext) }));
    setCaseNotice('已保留原Case及原操作回执；请核对当前准确版本，再明确关联本项目。没有另建Case。');
  }
  const chosenContext = plan.caseContext && catalog.caseContexts.find(context => context.caseId === plan.caseContext!.caseId);
  const contextChanged = chosenContext && plan.caseContext && (chosenContext.caseRevision !== plan.caseContext.caseRevision || chosenContext.projectWorkRevision !== plan.caseContext.projectWorkRevision);
  const takeContext = (caseId: string) => { const context = catalog.caseContexts.find(context => context.caseId === caseId); if (context && !matchesSourceGoal({ primary: context.primaryGoal, related: context.relatedGoals })) { setError('此Case未包含来源目标准确版本，原草稿保持；请回原Case核对。'); return; } edit(value => ({ ...value, caseContext: context ? contextRef(context) : null, ...(context && !value.goalContext ? { goalContext: { goal: structuredClone(sourceGoal ?? context.primaryGoal), purpose: 'case-investigation' } } : {}) })); };
  const confirmed = state?.confirmed;
  return <section className="case-board project-plan-page" aria-labelledby={`${id}-title`} aria-busy={busy || loading}>
    <header className="case-board-heading"><div><p className="eyebrow">Project · 共享资料，任务独立</p><h1 id={`${id}-title`}>{project.name} / 项目需求方案</h1><p>先轻量明确范围与本轮重点，已有有效方案可以沿用，Task 局部需求仍可选。</p></div><button type="button" className="text-button" onClick={onBack}>← 返回项目</button></header>
    {loading && <p className="case-message" role="status">正在读取本项目方案与实际可用能力…</p>}
    {readonly && <p className="case-message">项目已归档，只读。原方案、任务和成果保留，恢复请返回原项目。{project.tasks.map(task => <button type="button" className="text-button" key={task.id} onClick={() => onOpenTask(task.id)}>查看原任务：{task.name}</button>)}</p>}
    {error && <p id={`${id}-error`} className="case-message case-error" role="alert">{error}</p>}{notice && <p className="case-notice" role="status">{notice}</p>}
    <section className="project-plan-section"><div className="case-section-heading"><div><h2>轻量项目需求梳理</h2><p>可请现有需求 Agent 先梳理，也可直接手动补充下方草稿。只用诉求、资料清单、已有说明和基本前提，准备阶段没有数据工具。</p></div><button type="button" className="secondary-button" disabled={locked || !catalogKnown} onClick={() => { void prepare(); }}>请 Agent 轻量梳理</button></div>
      {preparation && <div className="project-plan-preparation" role="status"><p>{preparationLabel[preparation.status]}</p>{activePreparation && <button type="button" className="secondary-button" disabled={readonly || stopping} onClick={() => { void stopPreparation(activePreparation); }}>{stopping ? '正在请求停止…' : '停止本次梳理'}</button>}<button type="button" className="text-button" disabled={stopping} onClick={() => { void inspect(); }}>核对原梳理结果</button>{preparation.mece && <details><summary>Agent 的 MECE 自查与限制</summary><p>同层：{preparation.mece.sameLevel}</p><p>覆盖：{preparation.mece.coverage}</p><p>边界：{preparation.mece.boundaries}</p><p>深度：{preparation.mece.depth}</p>{preparation.limitations?.map((item, index) => <p key={index}>{item}</p>)}</details>}</div>}
    </section>
    <div className="project-plan-tools"><button type="button" className="text-button" disabled={busy} onClick={() => { void inspect(); }}>只读核对原结果</button>{state?.draft && dirty && <button type="button" className="text-button" disabled={locked} onClick={() => { setPlan(structuredClone(state.draft!.plan)); setDirty(false); setNotice('已采用当前保存的草稿，原已确认版本保持独立。'); }}>采用已保存草稿 v{state.draft.version}</button>}<span className="case-help">{state?.draft ? `草稿 v${state.draft.version}${dirty ? ' · 本页有未保存修改' : ''}` : '本项目尚无方案草稿'}{confirmed ? ` · 已确认 v${confirmed.planVersion}` : ''}</span></div>
    {pending && <section className="project-plan-section project-plan-attention"><h2>先核对原操作</h2><p>原输入与操作保持不变。本页不会换编号自动重发，也不会因读取状态启动任务。</p><button type="button" className="secondary-button" disabled={busy} onClick={() => { void inspect(pending); }}>重新只读核对</button>{recovery === 'conflict' && <button type="button" className="text-button" disabled={busy} onClick={() => { setPending(undefined); setDirty(true); setRecovery(''); setNotice('原意图保留在原记录，本页修改需另存为新草稿；尚未执行。'); }}>将本页修改另存新稿</button>}</section>}
    <fieldset className="project-plan-editor" disabled={locked}>
      <details className="project-plan-section"><summary>本次用途 · {plan.usageContext ? usageKindLabels[plan.usageContext.kind] : '尚未记录，可直接工作'}</summary><UsageContextFields id={`${id}-usage`} value={plan.usageContext || null} disabled={locked} onChange={context => edit(value => { const next = { ...value }; if (context) { next.usageContext = context; next.usageContextOrigin = 'explicit'; } else { delete next.usageContext; delete next.usageContextOrigin; } return next; })} /><p className="case-help">本次新方案的背景，不是资料权限；已确认版本和原任务仍保留当时范围。</p></details>
      <div className="project-plan-grid"><section className="project-plan-section"><h2>本次诉求与基本前提</h2><label htmlFor={`${id}-request`}>本次要解决什么问题</label><textarea id={`${id}-request`} value={plan.request} rows={4} onChange={event => edit(value => ({ ...value, request: event.target.value }))} />
        <label htmlFor={`${id}-premises`}>已有说明与基本前提（每行一项，可留空）</label><textarea id={`${id}-premises`} value={plan.premises.join('\n')} rows={3} onChange={event => edit(value => ({ ...value, premises: event.target.value.split('\n') }))} />
        <p className="case-help">这里只核诉求、清单、已有说明和基本前提，不提前全面读取明细、试算或归因。</p>
      </section><section className="project-plan-section"><h2>Case 与目标范围</h2>
        {sourceGoal && <><div className="project-plan-goal-source"><p>来源目标：v{sourceGoal.version}。{plan.caseContext ? '本页草稿已明确采用Case，主目标以该Case准确引用为准。' : '当前尚未据此新建或绑定 Case。'}</p><details><summary>查看准确目标引用</summary><code>{sourceGoal.goalId}</code></details></div><label htmlFor={`${id}-goal-purpose`}>本次目标用途</label><select id={`${id}-goal-purpose`} required aria-invalid={Boolean(error && !plan.goalContext)} aria-describedby={`${id}-goal-purpose-help${error ? ` ${id}-error` : ''}`} value={plan.goalContext?.purpose || ''} onChange={event => { const purpose = event.target.value as NonNullable<ProjectPlanContent['goalContext']>['purpose']; if (purpose in purposeLabels) edit(value => ({ ...value, goalContext: { goal: structuredClone(sourceGoal), purpose } })); }}><option value="" disabled>请选择实际用途，不依据诉求代猜</option>{Object.entries(purposeLabels).map(([purpose, label]) => <option key={purpose} value={purpose}>{label}</option>)}</select><p id={`${id}-goal-purpose-help`} className="case-help">目标准确版本和这次用途随原项目方案保存；Agent梳理不得删除、改变用途或改绑目标。持续经营事项需Case，其他三种用途可直接承接已明确工作。</p></>}
        <p className="case-help">值得持续推进的经营问题由Case承接；可明确采用已有Case，或复用原表单建立Case并关联当前项目。查询、核对和Studio建设可保留无Case。</p>
        {connectionStorageError && <p className="case-message case-error" role="alert">{connectionStorageError}</p>}
        {caseNotice && <p className="case-help" role="status">{caseNotice}</p>}
        {caseStorage?.state === 'uninitialized' ? <button type="button" className="secondary-button" disabled={!!connectionStorageError} onClick={() => { void initializeCases(); }}>启用原Case记录</button> : <button type="button" className="secondary-button" disabled={caseStorage?.state !== 'ready' || !!connectionStorageError} onClick={() => setCaseCreating(true)}>{sourceGoal ? '从来源目标建立Case并关联本项目' : '建立Case并关联本项目'}</button>}
        <label htmlFor={`${id}-existing-case`}>复用原Case</label><select id={`${id}-existing-case`} value={selectedCase?.case.id || ''} disabled={caseStorage?.state !== 'ready' || !!connectionStorageError} onChange={event => { void chooseExistingCase(event.target.value); }}><option value="">请选择已有Case，核对后明确采用</option>{caseDirectory.filter(record => record.status !== 'closed').map(record => <option key={record.id} value={record.id}>{record.title} · 第{record.revision}版</option>)}</select>
        {selectedCase && <div className="case-help"><p>{selectedCase.case.title} · 当前准确Case第{selectedCase.case.revision}版。{selectedCase.goalBinding ? `主目标第${selectedCase.goalBinding.primary.version}版；采用后沿该Case目标承接，不改写目标。` : '原Case尚无主目标，先在原记录明确。'}</p>{selectedCase.goalBinding && <details><summary>核对主目标准确引用</summary><code>{selectedCase.goalBinding.primary.goalId}</code> · v{selectedCase.goalBinding.primary.version}</details>}{selectedCase.goalBinding && !matchesSourceGoal(selectedCase.goalBinding) && <p>该Case主目标或关联目标未包含本次来源目标准确版，请先回原Case明确；没有自动改绑。</p>}<button type="button" className="secondary-button" disabled={!selectedCase.goalBinding || !matchesSourceGoal(selectedCase.goalBinding) || selectedCase.case.status === 'closed'} onClick={() => { void useExistingCase().catch(() => {}); }}>{selectedCase.projectLinks.some(link => link.projectId === project.id) ? '在本页草稿采用已关联Case' : '关联本项目并采用此Case'}</button></div>}
        <label htmlFor={`${id}-case`}>本次工作范围</label><select id={`${id}-case`} value={plan.caseContext?.caseId || ''} onChange={event => takeContext(event.target.value)}><option value="">无 Case · 查询、核对或 Studio 工作</option>{plan.caseContext && !chosenContext && <option value={plan.caseContext.caseId}>原 Case 当前不在可用目录，待核对</option>}{catalog.caseContexts.map(context => <option key={context.caseId} value={context.caseId}>{context.title}</option>)}</select>
        {plan.caseContext ? <p className="case-help">引用该 Case 已明确的主目标 v{plan.caseContext.primaryGoal.version}，沿原记录和准确版本承接。{contextChanged && <><strong> 当前目录版本已变化，原草稿未自动替换。</strong><button type="button" className="text-button" onClick={() => takeContext(plan.caseContext!.caseId)}>在草稿采用当前 Case 版本</button></>}</p> : <p className="case-help">本次不绑定 Case，不代写其他 Case 或经营选择。无需先编完整组织目标。</p>}
        <p>项目整体采用 TOC/TP，具体工具、顺序和其他方法由 Agent 按需组合。已选 Skill／IR 需实质使用。</p>
      </section></div>
      <section className="project-plan-section"><div className="case-section-heading"><div><h2>资料清单与既有权限</h2><p>选择准确来源；配置可用、范围授权和实际读取分别核对。</p></div>{onManageCapabilities && <button type="button" className="text-button" onClick={onManageCapabilities}>管理来源与能力</button>}</div>
        {!materials.length && <p className="case-help">{catalogKnown ? '当前目录没有可选资料项；不据此断言资料已经齐备。可以沿原项目资料入口补充。' : '实际资料目录暂未取得，原选择保留；不能据此判断没有资料。'}</p>}
        <div className="project-plan-materials">{materials.map(material => { const checked = plan.materials.some(value => referenceKey(value) === referenceKey(material)), database = databaseSource(material); return <label key={referenceKey(material)} className="project-plan-check"><input type="checkbox" checked={checked} disabled={!checked && (material.enabled === false || material.id.startsWith('db-link:') && !database?.enabled)} onChange={event => { const ref: ProjectPlanMaterialRef = { kind: material.kind, id: material.id, ...(material.version === undefined ? {} : { version: material.version }), ...(material.sha256 === undefined ? {} : { sha256: material.sha256 }), ...(material.permissionRef === undefined ? {} : { permissionRef: material.permissionRef }) }; edit(value => ({ ...value, materials: event.target.checked ? [...value.materials, ref] : value.materials.filter(item => referenceKey(item) !== referenceKey(ref)) })); }} /><span>{material.title}<small>{database ? databaseState[database.state] : material.version || '版本随原来源核对'}</small>{database?.scope && <small>项目授权范围：{database.scope.objects.join('、')}</small>}</span></label>; })}</div>
        {plan.materials.filter(material => !materials.some(value => referenceKey(value) === referenceKey(material))).map(material => <p key={referenceKey(material)} className="case-help">已选原引用：{material.id} · {material.version || '版本待核'}，当前目录未列出。<button type="button" className="text-button" onClick={() => edit(value => ({ ...value, materials: value.materials.filter(item => referenceKey(item) !== referenceKey(material)) }))}>取消本次选择</button></p>)}
      </section>
      <section className="project-plan-section"><div className="case-section-heading"><div><h2>覆盖与本轮重点</h2><p>分类可以调整，覆盖和重点分开；覆盖方面不会自动全部创建成 Task。</p></div><button type="button" className="secondary-button" onClick={() => edit(value => ({ ...value, coverage: [...value.coverage, { key: 'coverage-' + crypto.randomUUID(), label: '', disposition: 'unknown', reason: '', taskKeys: [] }] }))}>补充覆盖方面</button></div>
        {!plan.coverage.length && <p className="case-help">尚未列出覆盖方面。先按本次问题说明范围，无需套固定问题树。</p>}
        {plan.coverage.map((item, index) => <div key={item.key} className="project-plan-coverage"><label>覆盖方面<input aria-label={`覆盖方面 ${index + 1}`} value={item.label} onChange={event => edit(value => ({ ...value, coverage: value.coverage.map(row => row.key === item.key ? { ...row, label: event.target.value } : row) }))} /></label><label>本轮处理<select value={item.disposition} onChange={event => edit(value => ({ ...value, coverage: value.coverage.map(row => row.key === item.key ? { ...row, disposition: event.target.value as typeof item.disposition } : row) }))}><option value="focus">本轮重点</option><option value="covered">已覆盖</option><option value="deferred">暂缓</option><option value="unknown">待核</option><option value="out-of-scope">范围外</option></select></label><label>理由或限制<input value={item.reason} onChange={event => edit(value => ({ ...value, coverage: value.coverage.map(row => row.key === item.key ? { ...row, reason: event.target.value } : row) }))} /></label><details><summary>关联任务及父问题</summary><label>父问题<select value={item.parentKey || ''} onChange={event => edit(value => ({ ...value, coverage: value.coverage.map(row => { if (row.key !== item.key) return row; const next = { ...row }; if (event.target.value) next.parentKey = event.target.value; else delete next.parentKey; return next; }) }))}><option value="">本层问题</option>{plan.coverage.filter(row => row.key !== item.key).map(row => <option key={row.key} value={row.key}>{row.label || '未命名方面'}</option>)}</select></label>{plan.tasks.map(task => <label className="project-plan-check" key={task.key}><input type="checkbox" checked={item.taskKeys.includes(task.key)} onChange={event => edit(value => ({ ...value, coverage: value.coverage.map(row => row.key === item.key ? { ...row, taskKeys: event.target.checked ? [...row.taskKeys, task.key] : row.taskKeys.filter(key => key !== task.key) } : row) }))} />{task.name || '待命名任务'}</label>)}</details></div>)}
      </section>
      <section className="project-plan-section"><div className="case-section-heading"><div><h2>所选 Task 与综合责任</h2><p>单任务和多任务都在本方案确认；优先复用已有任务承接综合。</p></div><button type="button" className="secondary-button" onClick={addTask}>加入待创建任务</button></div>
        <label className="project-plan-mode" htmlFor={`${id}-mode`}>任务方式<select id={`${id}-mode`} value={plan.taskMode} onChange={event => selectMode(event.target.value as 'single' | 'multi')}><option value="single">单 Task · 本任务分析并综合</option><option value="multi">多 Task · 明确分工与综合</option></select></label>
        {plan.tasks.map((task, index) => { const allCapabilities = capabilitiesForTask(taskIdentity(task)); return <article key={task.key} className="project-plan-task"><div className="project-plan-task-title"><label className="project-plan-check"><input type="checkbox" checked={task.selected} disabled={taskArchived(task)} onChange={event => selectTask(task.key, event.target.checked)} /><strong>{taskIdentity(task) ? task.name : `待创建任务 ${index + 1}`}</strong></label><span className="case-help">{taskArchived(task) ? '已归档，只读' : taskIdentity(task) ? '已有 Task' : '本次确认后创建'}</span>{taskIdentity(task) && <button type="button" className="text-button" onClick={() => onOpenTask(taskIdentity(task)!)}>打开原任务</button>}</div>
          {!taskIdentity(task) && <label>任务名称<input value={task.name} maxLength={80} onChange={event => updateTask(task.key, { name: event.target.value })} /></label>}
          <label>本轮分工说明（可补充）<textarea rows={2} value={task.scope} onChange={event => updateTask(task.key, { scope: event.target.value })} /></label>
          <details className="project-plan-abilities" open={task.selected}><summary>所选能力与方法 · {task.capabilities.length} 项</summary>{!allCapabilities.length && <p className="case-help">{catalogKnown ? '当前没有可选能力项；未将规划或缺配置项冒充已接入。' : '实际能力目录暂未取得，原选择保留；不能据此判断没有可用能力。'}</p>}{allCapabilities.map(capability => { const checked = task.capabilities.some(ref => referenceKey(ref) === referenceKey(capability)); return <label className="project-plan-check" key={referenceKey(capability)}><input type="checkbox" checked={checked} disabled={taskArchived(task) || !capability.enabled && !checked} onChange={event => { const ref: ProjectPlanCapabilityRef = { kind: capability.kind, id: capability.id, ...(capability.version === undefined ? {} : { version: capability.version }), ...(capability.sha256 === undefined ? {} : { sha256: capability.sha256 }), ...(capability.permissionRef === undefined ? {} : { permissionRef: capability.permissionRef }) }; updateTask(task.key, { capabilities: event.target.checked ? [...task.capabilities, ref] : task.capabilities.filter(item => referenceKey(item) !== referenceKey(ref)) }); }} /><span>{capability.kind === 'skill' ? catalogItems.find(item => item.id === capability.id)?.name || capability.title : capability.title}<small title={capability.version}>{capability.database ? databaseState[capability.database.state] : capability.kind === 'skill' ? 'Skill' : capability.kind === 'sap-method' ? 'SAP / IR' : capability.enabled ? '连接配置已启用 · 项目授权另核' : '连接配置未启用'} {capability.version?.startsWith('sha256:') ? '内容版本 ' + capability.version.slice(7, 15) : capability.version || ''}</small>{capability.database?.scope && <small>范围：{capability.database.scope.objects.join('、')}</small>}{capability.database && !capability.database.queryQualified && <small>保存时尚未满足查询条件；不能据此声称可取数。</small>}</span></label>; })}{task.capabilities.filter(ref => !allCapabilities.some(item => referenceKey(item) === referenceKey(ref))).map(ref => <p key={referenceKey(ref)} className="case-help">原已选引用：{ref.id} / {ref.version || '版本待核'}，当前目录未列出。<button type="button" className="text-button" onClick={() => updateTask(task.key, { capabilities: task.capabilities.filter(item => referenceKey(item) !== referenceKey(ref)) })}>取消本次选择</button></p>)}</details>
        </article>; })}
        <label htmlFor={`${id}-summary`}>综合责任<select id={`${id}-summary`} value={plan.summaryTaskKey} onChange={event => edit(value => ({ ...value, summaryTaskKey: event.target.value }))}><option value="">请选择</option>{eligible.filter(task => plan.taskMode !== 'single' || task.selected).map(task => <option value={task.key} key={task.key}>{task.name || '待命名任务'}{taskIdentity(task) ? ' · 复用已有 Task' : ' · 本次所选待创建'}</option>)}</select></label>
        <details className="project-plan-dependencies"><summary>协作与依赖 · {plan.dependencies.length} 项</summary><p className="case-help">由 Agent 依据本轮问题安排协作、工具与顺序，不按问题树固定执行流水线。</p>{plan.dependencies.map((dependency, index) => <div key={index} className="project-plan-dependency"><label>来源 Task<select value={dependency.from} onChange={event => edit(value => ({ ...value, dependencies: value.dependencies.map((row, n) => n === index ? { ...row, from: event.target.value } : row) }))}>{plan.tasks.map(task => <option key={task.key} value={task.key}>{task.name || '待命名任务'}</option>)}</select></label><label>承接 Task<select value={dependency.to} onChange={event => edit(value => ({ ...value, dependencies: value.dependencies.map((row, n) => n === index ? { ...row, to: event.target.value } : row) }))}>{plan.tasks.map(task => <option key={task.key} value={task.key}>{task.name || '待命名任务'}</option>)}</select></label><label>说明<input value={dependency.reason} onChange={event => edit(value => ({ ...value, dependencies: value.dependencies.map((row, n) => n === index ? { ...row, reason: event.target.value } : row) }))} /></label><button type="button" className="text-button" onClick={() => edit(value => ({ ...value, dependencies: value.dependencies.filter((_row, n) => n !== index) }))}>取消本条关系</button></div>)}<button type="button" className="text-button" disabled={plan.tasks.length < 2} onClick={() => edit(value => ({ ...value, dependencies: [...value.dependencies, { from: value.tasks[0].key, to: value.tasks[1].key, reason: '' }] }))}>补充协作关系</button></details>
      </section>
    </fieldset>
    {caseConnection && <section className="project-plan-section" aria-label="原Case关联操作"><h2>原Case关联待核对</h2><p>{caseConnection.create?.title || '用户所选原Case'} · 原输入和固定操作编号保留；不会另建Case或重复启动任务。</p><details><summary>准确原操作</summary>{caseConnection.create && <p>创建：<code>{caseConnection.create.operationId}</code></p>}<p>关联：<code>{caseConnection.linkOperationId}</code></p>{caseConnection.caseId && <p>原Case：<code>{caseConnection.caseId}</code> · v{caseConnection.caseRevision}</p>}{caseConnection.failure && <p>原失败：{caseConnection.failure}</p>}</details><div className="project-plan-actions"><button type="button" className="secondary-button" disabled={caseBusy || readonly} onClick={() => { void connectCase(connection.current!, true).catch(() => {}); }}>只读核对原Case操作</button><button type="button" className="secondary-button" disabled={caseBusy || readonly || !!caseConnection.failure} onClick={() => { void connectCase(connection.current!).catch(() => {}); }}>继续原Case关联与草稿采用</button>{caseConnection.caseId && (caseConnection.failure || caseConnection.linkedRevision !== undefined) && <button type="button" className="text-button" disabled={caseBusy || readonly} onClick={() => { void keepCreatedCase().catch(fault => setError(caseError(fault))); }}>保留原Case，重新核对当前关联</button>}</div></section>}
    <section className="project-plan-section"><h2>一次确认，直接承接</h2><p>本轮所选 {selected.length} 个 Task；综合由 {plan.tasks.find(task => task.key === plan.summaryTaskKey)?.name || '待明确任务'} 承接。</p><div className="project-plan-actions"><button type="button" className="text-button" disabled={locked || !dirty} onClick={() => { void save(); }}>保存草稿</button><button type="button" className="secondary-button" disabled={locked} onClick={() => { void confirm('create'); }}>仅确认并创建</button><button type="button" className="primary-button" disabled={locked} onClick={() => { void confirm('start'); }}>确认并开始</button></div><p className="case-help">准确需求、资料、所选能力和既有权限直接带入。仅创建不执行；正式 RAP 发布独立，不增加额外启动门槛。</p></section>
    {confirmed && <section className="project-plan-section"><h2>已确认方案与分步结果</h2><p>方案 v{confirmed.planVersion} · {confirmed.mode === 'create' ? '仅确认并创建' : '已明确开始授权'}。草稿编辑不会改写正在运行任务的准确上下文。</p><div className="case-table-scroll"><table className="case-table"><thead><tr><th scope="col">任务</th><th scope="col">创建／复用</th><th scope="col">开始</th><th scope="col">原任务</th></tr></thead><tbody>{confirmed.tasks.map(receipt => <tr key={receipt.taskKey}><th scope="row">{confirmed.plan.tasks.find(task => task.key === receipt.taskKey)?.name || receipt.taskKey}</th><td>{statusLabel[receipt.createStatus] || '状态待核'}{receipt.createCode && <details><summary>具体回执</summary><code>{receipt.createCode}</code></details>}</td><td>{statusLabel[receipt.startStatus] || '状态待核'}{receipt.startCode && <details><summary>具体回执</summary><code>{receipt.startCode}</code></details>}</td><td>{['created', 'not-required'].includes(receipt.createStatus) ? <button type="button" className="text-button" onClick={() => onOpenTask(receipt.taskId)}>打开原任务</button> : <span className="case-help">先核对创建结果</span>}</td></tr>)}</tbody></table></div><p className="case-help">启动接纳不代表分析完成或专业正确。失败、取消及 UNKNOWN 各自保留；请先只读核对原任务／请求，不换编号盲目重做。</p><details><summary>准确方案及授权历史</summary><p>{confirmed.plan.request}</p><p>主目标引用：{confirmed.plan.caseContext ? `Case ${confirmed.plan.caseContext.caseId} / 目标 v${confirmed.plan.caseContext.primaryGoal.version}` : '本次无 Case'}</p><ul>{confirmed.authorizations.map(authorization => <li key={authorization.operationId}>{authorization.mode === 'create' ? '确认并创建' : '明确开始'} · {authorization.authorizedAt}</li>)}</ul></details></section>}
    {caseCreating && <CaseEditor initialGoal={sourceGoal} onSave={createCase} onClose={() => setCaseCreating(false)} />}
  </section>;
}
