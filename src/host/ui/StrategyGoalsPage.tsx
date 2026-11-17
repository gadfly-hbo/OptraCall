import { resolveNewUsageContext, type UsageContext } from '../usage-context-types.ts';
import { StrategyDiscussionPanel } from './StrategyDiscussionPanel.tsx';
import * as discussionApi from './strategy-discussion-client.ts';
import type { ClientProject, PublicModelConfiguration } from './project-types.ts';
import { useEffect, useId, useRef, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import type { GoalDiscussionSourceRef, GoalDraftInput, GoalFeedbackInput, GoalMeasurement, GoalOperationReceipt, GoalPerspective, GoalRef, GoalRelation, GoalRelationInput, GoalScope, GoalSourceRef, GoalVersion, StrategyGoalRecord, StrategyGoalsIndex } from '../strategy-goals-types.ts';
import type { CaseRecord } from '../case-types.ts';
import { CaseDialog, CaseFormError, caseDate, useOperationId } from './CaseDialogs.tsx';
import * as api from './strategy-goals-client.ts';
import { list as listCases } from './case-client.ts';
import { listStudioEnterprises } from './studio-api.ts';
import type { StudioEnterpriseDirectory } from './studio-api.ts';
import './strategy-goals.css';
import { readBoard } from '../../../extensions/business-plugins/decision-board/ui/decision-board-client.ts';
import type { BoardView } from '../../../extensions/business-plugins/decision-board/api/routes.ts';
import type { GoalActionArrangement } from '../strategy-goals-types.ts';

export interface GoalFeedbackSource { label: string; ref: GoalSourceRef }
export interface StrategyGoalsPageProps {
  active?: boolean;
  onOpenCase: (goal: GoalRef) => void;
  onStartProject: (goal: GoalRef, usageContext?: UsageContext) => void;
  onManageMetrics: () => void;
  onOpenBoard?: () => void;
  feedbackSources?: GoalFeedbackSource[];
  projects?: ClientProject[]; configurations?: PublicModelConfiguration[]; selectedConfigurationId?: string | null; onSettings?: () => void;
}
const empty = (): StrategyGoalsIndex => ({ goals: [], relations: [], feedback: [] });
const scopeLabels: Record<GoalScope['kind'], string> = { enterprise: '企业', department: '部门', personal: '个人' };
const perspectiveLabels: Record<GoalPerspective, string> = { profit: '营利组织', nonprofit: '非营利组织', personal: '个人' };
const relationLabels: Record<GoalRelationInput['kind'], string> = { supports: '支持', 'necessary-condition': '必要条件', contribution: '职责贡献', strategy: '策略关系' };
const feedbackLabels: Record<GoalFeedbackInput['level'], string> = { execution: '执行反馈', strategy: '策略反馈', 'strategic-assumption': '战略假设反馈' };
const authorityLabels: Record<GoalSourceRef['authority'], string> = { case: 'Case', project: '项目', task: '项目任务', 'decision-board': '行动看板', 'sap-metric': 'SAP指标', 'strategy-discussion': '战略讨论' };
const sourceKey = (ref: GoalSourceRef) => JSON.stringify([ref.authority, ref.id, ref.version, ref.projectId ?? null, ref.taskId ?? null, ref.sha256 ?? null, ref.sessionId ?? null, ref.entryType ?? null]);
const bscLabels = (perspective: GoalPerspective | 'all') => perspective === 'nonprofit' ? ['使命与服务结果', '服务对象', '内部流程', '学习与能力'] : perspective === 'personal' ? ['当期成果', '服务与协作', '工作流程', '学习与能力'] : ['财务持续性', '客户与服务对象', '内部流程', '学习与能力'];
const refKey = (ref: GoalRef) => `${ref.goalId}:${ref.version}`;
const sameRef = (a: GoalRef, b: GoalRef) => a.goalId === b.goalId && a.version === b.version;
const refOf = (value: GoalVersion): GoalRef => ({ goalId: value.goalId, version: value.version });
const current = (record: StrategyGoalRecord) => record.versions.find(x => x.version === record.currentVersion)!;
const adoptedVersions = (index: StrategyGoalsIndex) => index.goals.flatMap(x => x.versions.filter(v => v.status === 'adopted'));
const versionFor = (index: StrategyGoalsIndex, ref: GoalRef) => index.goals.find(x => x.id === ref.goalId)?.versions.find(x => x.version === ref.version);
const goalName = (index: StrategyGoalsIndex, ref: GoalRef) => `${versionFor(index, ref)?.title ?? '原目标暂不可读取'} · v${ref.version}`;
const lines = (text: string) => text.split('\n').map(x => x.trim()).filter(Boolean);
const errorUnknown = (error: unknown) => !(error instanceof api.StrategyGoalsRequestError) || error.status >= 500;

/** The original CaseDialog lifecycle and stable per-intent operation ID are reused. */
function useGoalMutation(onSaved: () => Promise<void> | void) {
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [pending, setPending] = useState<{ id: string; kind: GoalOperationReceipt['kind'] } | null>(null);
  const operationId = useOperationId();
  const save = async (kind: GoalOperationReceipt['kind'], input: unknown, action: (id: string) => Promise<unknown>) => {
    if (busy || pending) return;
    const id = operationId({ kind, input }); setBusy(true); setError('');
    try { await action(id); await onSaved(); }
    catch (fault) { setError(api.goalError(fault)); if (errorUnknown(fault)) setPending({ id, kind }); }
    finally { setBusy(false); }
  };
  const recover = async () => {
    if (!pending || busy) return; setBusy(true); setError('');
    try {
      const { operation } = await api.operation(pending.id);
      if (!operation) { setError('尚未读到原操作完成回执，当前结果仍待核对；未重新提交。'); return; }
      if (operation.kind !== pending.kind) { setError('原操作身份不一致，未采用另一操作结果。'); return; }
      setPending(null); await onSaved();
    } catch (fault) { setError(api.goalError(fault)); }
    finally { setBusy(false); }
  };
  return { busy, error, pending, save, recover };
}
function MutationNotice({ state }: { state: ReturnType<typeof useGoalMutation> }) {
  return <><CaseFormError error={state.error} />{state.pending && <div className="sg-unknown"><p>原操作结果待核对，输入已保留。核对完成前不会换编号重复提交。</p><button type="button" className="secondary-button" disabled={state.busy} onClick={() => { void state.recover(); }}>核对原操作</button><details><summary>操作记录</summary><code>{state.pending.id}</code></details></div>}</>;
}
function Actions({ state, label, onClose }: { state: ReturnType<typeof useGoalMutation>; label: string; onClose: () => void }) {
  return <div className="case-dialog-actions"><button type="button" className="secondary-button" disabled={state.busy} onClick={onClose}>取消</button><button type="submit" className="primary-button" disabled={state.busy || Boolean(state.pending)}>{state.busy ? '正在保存…' : label}</button></div>;
}
function Field({ label, children, id }: { label: string; children: ReactNode; id: string }) { return <div className="case-field"><label htmlFor={id}>{label}</label>{children}</div>; }

type EditorFields = {
  title: string; outcome: string; perspective: GoalPerspective; scopeKind: GoalScope['kind']; scopeId: string; scopeName: string; enterpriseId: string;
  bsc: string; measureKind: GoalMeasurement['kind']; metricId: string; metricVersion: string; metricName: string; target: string; criterion: string;
  baselineState: 'known' | 'pending'; baseline: string; responsible: string; dueAt: string; strategies: string; resources: string; conditions: string;
};
function GoalEditor({ active, initial, record, index, enterprises, metrics, metricsKnown, onSaved, onClose, onManageMetrics, confirmation }: {
  active: boolean;
  initial?: GoalVersion; record?: StrategyGoalRecord; index: StrategyGoalsIndex; enterprises: StudioEnterpriseDirectory['enterprises'];
  metrics: api.LibraryEntry[]; metricsKnown: boolean;
  onSaved: () => Promise<void>; onClose: () => void; onManageMetrics: () => void;
  confirmation?: { busy: boolean; locked: boolean; notice: ReactNode; onSubmit: (input: GoalDraftInput) => void };
}) {
  const id = useId();
  const [fields, setFields] = useState<EditorFields>(() => ({
    title: initial?.title ?? '', outcome: initial?.outcome ?? '', perspective: initial?.perspective ?? 'profit',
    scopeKind: initial?.scope.kind ?? (enterprises.length ? 'enterprise' : 'personal'), scopeId: initial?.scope.id ?? enterprises[0]?.id ?? 'self', scopeName: initial?.scope.name ?? enterprises[0]?.name ?? index.goals.map(current).find(goal => goal.scope.kind === 'personal' && goal.scope.id === 'self')?.scope.name ?? '个人工作',
    enterpriseId: initial?.scope.kind === 'department' ? initial.scope.enterpriseId ?? '' : initial?.scope.kind === 'enterprise' ? initial.scope.id : '',
    bsc: initial?.bscPerspective ?? '', measureKind: initial?.measurement.kind ?? 'deliverable',
    metricId: initial?.measurement.kind === 'quantitative' ? initial.measurement.sapMetric.id : '', metricVersion: initial?.measurement.kind === 'quantitative' ? initial.measurement.sapMetric.version : '', target: initial?.measurement.kind === 'quantitative' ? initial.measurement.target ?? '' : '',
    metricName: initial?.measurement.kind === 'quantitative' ? initial.measurement.sapMetric.metricName ?? '' : '',
    criterion: initial?.measurement.kind === 'deliverable' ? initial.measurement.criterion : '', baselineState: initial?.baseline.state ?? 'pending', baseline: initial?.baseline.description ?? '', responsible: initial?.responsible ?? '', dueAt: initial?.dueAt?.slice(0, 10) ?? '',
    strategies: initial?.strategies?.join('\n') ?? '', resources: initial?.resources?.join('\n') ?? '', conditions: initial?.necessaryConditions?.join('\n') ?? '',
  }));
  const state = useGoalMutation(onSaved), disabled = state.busy || Boolean(state.pending) || Boolean(confirmation?.busy || confirmation?.locked);
  const metricKey = (metric: { id: string; version: string; metricName: string }) => JSON.stringify([metric.id, metric.version, metric.metricName]);
  const metricOptions = metrics.flatMap(entry => entry.metricNames.map(metricName => ({ id: entry.id, version: entry.version, metricName, label: `${metricName} · ${entry.id} @ ${entry.version}` })));
  const selectedMetric = metricOptions.find(metric => metric.id === fields.metricId && metric.version === fields.metricVersion && metric.metricName === fields.metricName);
  const change = <K extends keyof EditorFields>(key: K, value: EditorFields[K]) => setFields(old => ({ ...old, [key]: value }));
  const knownScopes = [...new Map(index.goals.map(x => current(x).scope).filter(x => x.kind === fields.scopeKind && (x.kind !== 'department' || x.enterpriseId === fields.enterpriseId)).map(x => [x.id, x])).values()];
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const knownScope = fields.scopeKind === 'enterprise' ? enterprises.find(x => x.id === fields.scopeId) : knownScopes.find(x => x.id === fields.scopeId);
    if (fields.scopeKind === 'enterprise' && !knownScope) return;
    if (fields.scopeKind === 'department' && fields.enterpriseId && !enterprises.some(x => x.id === fields.enterpriseId)) return;
    const scope: GoalScope = { kind: fields.scopeKind, id: knownScope?.id ?? (fields.scopeKind === 'personal' ? 'self' : fields.scopeId.trim()), name: knownScope?.name ?? fields.scopeName.trim(), ...(fields.scopeKind === 'department' && fields.enterpriseId ? { enterpriseId: fields.enterpriseId } : {}) };
    const input: GoalDraftInput = {
      title: fields.title.trim(), outcome: fields.outcome.trim(), perspective: fields.perspective, scope, responsible: fields.responsible.trim(),
      measurement: fields.measureKind === 'quantitative' ? { kind: 'quantitative', sapMetric: { authority: 'sap-metric', id: fields.metricId, version: fields.metricVersion, metricName: fields.metricName }, ...(fields.target.trim() ? { target: fields.target.trim() } : {}) } : { kind: 'deliverable', criterion: fields.criterion.trim() },
      baseline: { state: fields.baselineState, description: fields.baseline.trim() }, ...(fields.bsc.trim() ? { bscPerspective: fields.bsc.trim() } : {}), ...(fields.dueAt ? { dueAt: fields.dueAt } : {}),
      strategies: lines(fields.strategies), resources: lines(fields.resources), necessaryConditions: lines(fields.conditions), ...(initial?.source ? { source: initial.source } : {}), ...(initial?.usageContext ? { usageContext: initial.usageContext } : {}), ...(initial?.strategyContext ? { strategyContext: initial.strategyContext } : {}),
    };
    if (confirmation) { confirmation.onSubmit(input); return; }
    void state.save(initial ? 'revise' : 'create', input, operationId => initial && record ? api.revise(record.id, { ...input, expectedVersion: record.currentVersion, operationId }) : api.create({ ...input, operationId }));
  };
  return <CaseDialog active={active} title={confirmation ? '核对并采用目标／GSA' : initial ? '提出目标修订' : '新建候选目标'} subtitle="先保存候选，核对范围、衡量和待补前提，再明确采纳。旧Case和报告继续引用当时版本。" className="sg-dialog" busy={state.busy || Boolean(confirmation?.busy)} onClose={onClose}><form onSubmit={submit}>
    <Field id={`${id}-title`} label="目标名称"><input id={`${id}-title`} required maxLength={300} disabled={disabled} value={fields.title} onChange={e => change('title', e.target.value)} /></Field>
    <Field id={`${id}-outcome`} label="当期结果要求"><textarea id={`${id}-outcome`} required rows={3} maxLength={4000} disabled={disabled} value={fields.outcome} onChange={e => change('outcome', e.target.value)} /></Field>
    <div className="case-form-row"><Field id={`${id}-perspective`} label="适用视角"><select id={`${id}-perspective`} disabled={disabled} value={fields.perspective} onChange={e => change('perspective', e.target.value as GoalPerspective)}>{Object.entries(perspectiveLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></Field><Field id={`${id}-scope-kind`} label="职责层级"><select id={`${id}-scope-kind`} disabled={disabled} value={fields.scopeKind} onChange={e => { const kind = e.target.value as GoalScope['kind']; setFields(old => ({ ...old, scopeKind: kind, scopeId: kind === 'enterprise' ? enterprises[0]?.id ?? '' : kind === 'personal' ? 'self' : '', scopeName: kind === 'enterprise' ? enterprises[0]?.name ?? '' : kind === 'personal' ? '个人工作' : '', enterpriseId: '' })); }}>{Object.entries(scopeLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></Field></div>
    {fields.scopeKind !== 'personal' && <Field id={`${id}-enterprise`} label={fields.scopeKind === 'department' ? '上层组织（已知时引用，可选）' : '当前企业'}><select id={`${id}-enterprise`} required={fields.scopeKind === 'enterprise'} disabled={disabled} value={fields.scopeKind === 'enterprise' ? fields.scopeId : fields.enterpriseId} onChange={e => fields.scopeKind === 'enterprise' ? change('scopeId', e.target.value) : setFields(old => ({ ...old, enterpriseId: e.target.value, scopeId: '', scopeName: '' }))}><option value="">{fields.scopeKind === 'department' ? '上层未知 · 仍可开展' : '请选择已明确的企业'}</option>{enterprises.map(x => <option key={x.id} value={x.id}>{x.name}</option>)}</select>{!enterprises.length && <p className="case-help">当前尚未取得企业目录；部门与个人可沿已知职责开展，不据此获得企业资料权限。组织主体需在原Studio明确。<button type="button" className="text-button" disabled={disabled} onClick={onManageMetrics}>前往原Studio</button></p>}</Field>}
    {fields.scopeKind !== 'enterprise' && <><Field id={`${id}-known-scope`} label="已有职责范围（可选）"><select id={`${id}-known-scope`} disabled={disabled} value={knownScopes.some(x => x.id === fields.scopeId) ? fields.scopeId : ''} onChange={e => { const item = knownScopes.find(x => x.id === e.target.value); setFields(old => ({ ...old, scopeId: item?.id ?? '', scopeName: item?.name ?? old.scopeName })); }}><option value="">本次明确范围</option>{knownScopes.map(x => <option key={x.id} value={x.id}>{x.name}</option>)}</select></Field>{fields.scopeKind === 'department' && <><p className="case-help">这是本次声明的部门／业务模块职责；上层未知时保持未知，不强建组织，也不自动取得企业资料或SAP指标权限。</p><Field id={`${id}-department-id`} label="部门职责标识（用户声明）"><input id={`${id}-department-id`} required maxLength={300} disabled={disabled || knownScopes.some(x => x.id === fields.scopeId)} value={fields.scopeId} onChange={e => change('scopeId', e.target.value)} /></Field></>}<Field id={`${id}-scope-name`} label={fields.scopeKind === 'department' ? '部门职责名称（用户声明）' : '职责范围名称'}><input id={`${id}-scope-name`} required maxLength={300} disabled={disabled || knownScopes.some(x => x.id === fields.scopeId)} value={fields.scopeName} onChange={e => change('scopeName', e.target.value)} /></Field></>}
    <div className="case-form-row"><Field id={`${id}-responsible`} label="责任与协同"><input id={`${id}-responsible`} required maxLength={300} disabled={disabled} value={fields.responsible} onChange={e => change('responsible', e.target.value)} /></Field><Field id={`${id}-due`} label="期限（可选）"><input id={`${id}-due`} type="date" disabled={disabled} value={fields.dueAt} onChange={e => change('dueAt', e.target.value)} /></Field></div>
    <details><summary>BSC 视角（可选）</summary><Field id={`${id}-bsc`} label="BSC归属／目标关系视角（可选）"><input id={`${id}-bsc`} list={`${id}-bsc-options`} maxLength={300} disabled={disabled} value={fields.bsc} onChange={e => change('bsc', e.target.value)} /><datalist id={`${id}-bsc-options`}>{bscLabels(fields.perspective).map(x => <option key={x} value={x} />)}</datalist><p className="case-help">按组织或个人的实际贡献归类，不要求四类齐备或平均分配资源。</p></Field></details>
    <Field id={`${id}-measure`} label="衡量方式"><select id={`${id}-measure`} disabled={disabled} value={fields.measureKind} onChange={e => change('measureKind', e.target.value as GoalMeasurement['kind'])}><option value="deliverable">可核对的成果／交付标准</option><option value="quantitative">引用已发布SAP指标</option></select></Field>
    {fields.measureKind === 'deliverable' ? <Field id={`${id}-criterion`} label="成果核对标准"><textarea id={`${id}-criterion`} required rows={3} maxLength={4000} disabled={disabled} value={fields.criterion} onChange={e => change('criterion', e.target.value)} /></Field> : <><p className="case-help">从原Studio正式发布目录选择具体指标及准确包版本；定义和口径沿原SAP，选择不代表效果已经验证。<button type="button" className="text-button" disabled={disabled} onClick={onManageMetrics}>查看原SAP指标管理</button></p><Field id={`${id}-metric`} label="准确SAP指标与发布包版本"><select id={`${id}-metric`} required disabled={disabled} value={selectedMetric ? metricKey(selectedMetric) : ''} onChange={e => { const metric = metricOptions.find(value => metricKey(value) === e.target.value); setFields(old => ({ ...old, metricId: metric?.id ?? '', metricVersion: metric?.version ?? '', metricName: metric?.metricName ?? '' })); }}><option value="">请选择原目录中准确已发布的具体指标</option>{metricOptions.map(metric => <option key={metricKey(metric)} value={metricKey(metric)}>{metric.label}</option>)}</select>{!metricsKnown && <p className="case-help">原SAP发布目录暂不可读取，请在原Studio核对；未据此判定没有指标。</p>}{metricsKnown && !metricOptions.length && <p className="case-help">原目录尚无可选发布指标，可先在原Studio建设，或明确可核对的成果标准。</p>}{fields.metricId && !selectedMetric && <p className="case-help">旧准确引用保留：{fields.metricId} @ {fields.metricVersion} / {fields.metricName || '旧版尚未明确具体指标'}。本次新稿需从原目录明确选择；不会自动跟随最新版。</p>}</Field><Field id={`${id}-target`} label="当期衡量要求（可选）"><textarea id={`${id}-target`} rows={2} maxLength={4000} disabled={disabled} value={fields.target} onChange={e => change('target', e.target.value)} /></Field></>}
    <Field id={`${id}-baseline-state`} label="基线状态"><select id={`${id}-baseline-state`} disabled={disabled} value={fields.baselineState} onChange={e => change('baselineState', e.target.value as 'known' | 'pending')}><option value="pending">待补可比基线</option><option value="known">已有可核基线</option></select></Field><Field id={`${id}-baseline`} label={fields.baselineState === 'pending' ? '待补内容及影响' : '基线及来源说明'}><textarea id={`${id}-baseline`} required rows={2} maxLength={4000} disabled={disabled} value={fields.baseline} onChange={e => change('baseline', e.target.value)} /></Field>
    <details><summary>策略、资源与必要条件</summary>{([['strategies', '策略安排'], ['resources', '资源与约束'], ['conditions', '必要条件／待验证前提']] as const).map(([key, label]) => <Field key={key} id={`${id}-${key}`} label={`${label}（每行一项，可选）`}><textarea id={`${id}-${key}`} rows={3} maxLength={20000} disabled={disabled} value={fields[key]} onChange={e => change(key, e.target.value)} /></Field>)}</details>
    {confirmation ? <><p className="case-help">本次确认只采用所见目标与GSA；不证明因果成立，不授权实际经营执行。</p>{confirmation.notice}<div className="case-dialog-actions"><button type="button" className="secondary-button" disabled={confirmation.busy} onClick={onClose}>返回讨论</button><button type="submit" className="primary-button" disabled={disabled}>{confirmation.busy ? '正在保存…' : '确认采用目标／GSA'}</button></div></> : <><MutationNotice state={state} /><Actions state={state} label={initial ? '保存修订候选' : '保存候选目标'} onClose={onClose} /></>}
  </form></CaseDialog>;
}

function GoalAdoptionDialog({ active, value, record, onSaved, onClose }: { active: boolean; value: GoalVersion; record: StrategyGoalRecord; onSaved: () => Promise<void>; onClose: () => void }) {
  const id = useId(), [decision, setDecision] = useState(''), state = useGoalMutation(onSaved);
  return <CaseDialog active={active} title="采纳此目标版本" subtitle={`${value.title} · v${value.version}`} busy={state.busy} onClose={onClose}><form onSubmit={e => { e.preventDefault(); void state.save('adopt', { ref: refOf(value), expectedVersion: record.currentVersion, decision }, operationId => api.adopt(value, { expectedVersion: record.currentVersion, decision, operationId })); }}><p className="case-prose">{value.outcome}</p><p className="case-help">采纳后可作为Case主目标或关联目标。已有Case、项目方案与报告继续引用当时版本，本操作不会替你作经营选择或启动任务。</p><Field id={`${id}-decision`} label="本次明确决定"><textarea id={`${id}-decision`} required rows={3} maxLength={4000} disabled={state.busy || Boolean(state.pending)} value={decision} onChange={e => setDecision(e.target.value)} placeholder="说明本次采用的目标及仍待补的条件" /></Field><MutationNotice state={state} /><Actions state={state} label="确认采纳此版本" onClose={onClose} /></form></CaseDialog>;
}

function draftBody(value: GoalDraftInput): GoalDraftInput {
  return { title: value.title, outcome: value.outcome, perspective: value.perspective, scope: value.scope, measurement: value.measurement, baseline: value.baseline, responsible: value.responsible, strategies: value.strategies || [], resources: value.resources || [], necessaryConditions: value.necessaryConditions || [], ...(value.bscPerspective ? { bscPerspective: value.bscPerspective } : {}), ...(value.dueAt ? { dueAt: value.dueAt.slice(0, 10) } : {}), ...(value.source ? { source: value.source } : {}), ...(value.usageContext ? { usageContext: value.usageContext } : {}), ...(value.strategyContext ? { strategyContext: value.strategyContext } : {}) };
}
const canonicalDraft = (value: unknown): string => Array.isArray(value) ? `[${value.map(canonicalDraft).join(',')}]` : value && typeof value === 'object' ? `{${Object.entries(value).filter(([, item]) => item !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${canonicalDraft(item)}`).join(',')}}` : JSON.stringify(value);
function DiscussionCandidateAdoption({ active, candidate, discussionId, index, enterprises, metrics, metricsKnown, onManageMetrics, onClose, onAdopted }: {
  active: boolean; candidate: GoalVersion; discussionId: string; index: StrategyGoalsIndex; enterprises: StudioEnterpriseDirectory['enterprises']; metrics: api.LibraryEntry[]; metricsKnown: boolean;
  onManageMetrics: () => void; onClose: () => void; onAdopted: (ref: GoalRef) => Promise<void>;
}) {
  type Intent = { input: GoalDraftInput; draftId: string; adoptId: string; expectedVersion: number; phase: 'revise' | 'adopt'; target: GoalVersion };
  const key = `optracall.discussion-goal-adoption.v1:${discussionId}:${candidate.goalId}:${candidate.version}`;
  const [restore] = useState(() => { try { const raw = sessionStorage.getItem(key); return { intent: raw ? JSON.parse(raw) as Intent : undefined, error: '' }; } catch { return { intent: undefined, error: '原采用请求暂存不可读取，请保留记录，暂不能重新提交。' }; } });
  const intent = useRef<Intent | undefined>(restore.intent), [busy, setBusy] = useState(false), [pending, setPending] = useState(Boolean(restore.intent)), [error, setError] = useState(restore.error);
  const record = index.goals.find(item => item.id === candidate.goalId), alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const preserve = () => sessionStorage.setItem(key, JSON.stringify(intent.current));
  const complete = async (goal: GoalVersion) => { if (goal.goalId !== candidate.goalId || goal.status !== 'adopted') throw new Error('采用回执的目标身份不一致，原请求保持。'); sessionStorage.removeItem(key); setPending(false); await onAdopted(refOf(goal)); };
  const adopt = async () => {
    const original = intent.current!; const detail = await discussionApi.readStrategyDiscussion(discussionId), target = detail.goals.find(goal => sameRef(goal, original.target));
    const hash = detail.goalContentHashes[refKey(original.target)];
    if (!target || !hash || canonicalDraft(draftBody(target)) !== canonicalDraft(draftBody(original.target))) throw new Error('原候选内容或准确讨论来源未能核对，输入与原编号保持，没有采用其他版本。');
    original.phase = 'adopt'; preserve();
    const result = await discussionApi.adoptDiscussionGoal(discussionId, { operationId: original.adoptId, goalId: target.goalId, version: target.version, expectedVersion: original.expectedVersion, goalContentSha256: hash, decision: '明确采用本次集中核对的目标与GSA内容，保留待验证前提；不授权实际经营执行。' });
    await complete(result.goal);
  };
  const failed = (fault: unknown) => { if (alive.current) { setPending(Boolean(intent.current)); setError(fault instanceof Error ? fault.message : '采用结果尚未核实，原输入与操作编号保留。'); } };
  const submit = async (input: GoalDraftInput) => {
    if (busy || pending || !record || restore.error) return; setBusy(true); setError('');
    try {
      const edited = canonicalDraft(draftBody(input)) !== canonicalDraft(draftBody(candidate));
      intent.current = { input: structuredClone(input), draftId: crypto.randomUUID(), adoptId: crypto.randomUUID(), expectedVersion: record.currentVersion, phase: edited ? 'revise' : 'adopt', target: structuredClone(candidate) }; preserve();
      if (edited) { const result = await api.revise(candidate.goalId, { ...input, operationId: intent.current.draftId, expectedVersion: record.currentVersion }); intent.current.target = result.goal; intent.current.expectedVersion = result.goal.version; intent.current.phase = 'adopt'; preserve(); }
      await adopt();
    } catch (fault) { failed(fault); } finally { if (alive.current) setBusy(false); }
  };
  const recover = async () => {
    if (!intent.current || busy) return; setBusy(true); setError('');
    try { const original = intent.current, id = original.phase === 'revise' ? original.draftId : original.adoptId; const { operation } = await api.operation(id); if (!operation || !('goalId' in operation.result)) throw new Error('原操作尚未核对完成，输入与编号保留；没有换编号重建候选。'); const target = operation.result as GoalVersion; if (target.goalId !== candidate.goalId) throw new Error('原操作归属不一致，未采用其他目标。'); if (original.phase === 'adopt') { if (!sameRef(target, original.target)) throw new Error('原采用回执版本不一致。'); await complete(target); } else { original.target = target; original.expectedVersion = target.version; original.phase = 'adopt'; preserve(); await adopt(); } }
    catch (fault) { failed(fault); } finally { if (alive.current) setBusy(false); }
  };
  const notice = <>{!record && <p className="case-error" role="alert">原目标目录尚未核对，候选与输入保持，请返回后刷新原记录。</p>}{error && <p className="case-error" role="alert">{error}</p>}{pending && <div className="sg-unknown"><p>原采用操作结果待核，输入、版本与编号保留；未重发模型或另建目标。</p><button type="button" className="secondary-button" disabled={busy} onClick={() => { void recover(); }}>核对原保存／采用结果</button><details><summary>原操作编号</summary><code>{intent.current?.phase === 'revise' ? intent.current?.draftId : intent.current?.adoptId}</code></details></div>}</>;
  return <GoalEditor active={active} initial={intent.current ? { ...candidate, ...intent.current.input } : candidate} record={record} index={index} enterprises={enterprises} metrics={metrics} metricsKnown={metricsKnown} onManageMetrics={onManageMetrics} onSaved={async () => {}} onClose={onClose} confirmation={{ busy, locked: pending || Boolean(restore.error) || !record, notice, onSubmit: input => { void submit(input); } }} />;
}

function RelationEditor({ active, index, selected, initial, onSaved, onClose }: { active: boolean; index: StrategyGoalsIndex; selected: GoalVersion; initial?: GoalRelation; onSaved: () => Promise<void>; onClose: () => void }) {
  const id = useId(), options = adoptedVersions(index), [from, setFrom] = useState(initial ? refKey(initial.from) : ''), [to, setTo] = useState(initial ? refKey(initial.to) : refKey(selected));
  const [kind, setKind] = useState<GoalRelationInput['kind']>(initial?.kind ?? 'contribution'), [responsibility, setResponsibility] = useState(initial?.responsibility ?? ''), [rationale, setRationale] = useState(initial?.rationale ?? '');
  const state = useGoalMutation(onSaved), disabled = state.busy || Boolean(state.pending);
  const submit = (e: FormEvent) => {
    e.preventDefault(); const a = options.find(x => refKey(x) === from), b = options.find(x => refKey(x) === to); if (!a || !b || sameRef(a, b)) return;
    const input: GoalRelationInput = { from: refOf(a), to: refOf(b), kind, responsibility, rationale };
    void state.save(initial ? 'revise-relation' : 'relate', { ...input, ...(initial ? { id: initial.id, expectedRevision: initial.revision } : {}) }, operationId => initial ? api.reviseRelation(initial.id, { ...input, expectedRevision: initial.revision, operationId }) : api.relate({ ...input, operationId }));
  };
  return <CaseDialog active={active} title={initial ? '修订目标关系与职责' : '增加目标关系与职责'} subtitle="BSC与企业GSA共用目标；下层按职责贡献，不机械分摊上层指标。" className="sg-dialog" busy={state.busy} onClose={onClose}><form onSubmit={submit}><div className="case-form-row"><Field id={`${id}-from`} label="贡献／支持目标"><select id={`${id}-from`} required disabled={disabled} value={from} onChange={e => setFrom(e.target.value)}><option value="">请选择准确已采纳目标</option>{options.map(x => <option key={refKey(x)} value={refKey(x)}>{x.scope.name} · {x.title} v{x.version}</option>)}</select></Field><Field id={`${id}-to`} label="承接／依赖目标"><select id={`${id}-to`} required disabled={disabled} value={to} onChange={e => setTo(e.target.value)}><option value="">请选择准确已采纳目标</option>{options.map(x => <option key={refKey(x)} value={refKey(x)}>{x.scope.name} · {x.title} v{x.version}</option>)}</select></Field></div><Field id={`${id}-kind`} label="关系"><select id={`${id}-kind`} disabled={disabled} value={kind} onChange={e => setKind(e.target.value as GoalRelationInput['kind'])}>{Object.entries(relationLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></Field><Field id={`${id}-responsibility`} label="职责与协同"><textarea id={`${id}-responsibility`} required rows={3} maxLength={4000} disabled={disabled} value={responsibility} onChange={e => setResponsibility(e.target.value)} /></Field><Field id={`${id}-rationale`} label="贡献关系及必要条件的依据"><textarea id={`${id}-rationale`} required rows={3} maxLength={4000} disabled={disabled} value={rationale} onChange={e => setRationale(e.target.value)} /></Field>{from && from === to && <p className="case-error">请选择两个不同的目标版本；企业BSC与GSA本身直接引用同一目标。</p>}<MutationNotice state={state} /><Actions state={state} label={initial ? '保存关系修订' : '保存关系'} onClose={onClose} /></form></CaseDialog>;
}

function FeedbackEditor({ active, goal, sources, onSaved, onClose }: { active: boolean; goal: GoalVersion; sources: GoalFeedbackSource[]; onSaved: () => Promise<void>; onClose: () => void }) {
  const id = useId(), [sourceIndex, setSourceIndex] = useState(''), [level, setLevel] = useState<GoalFeedbackInput['level']>('execution'), [note, setNote] = useState('');
  const state = useGoalMutation(onSaved), disabled = state.busy || Boolean(state.pending);
  return <CaseDialog active={active} title="记录目标层反馈" subtitle={`${goal.title} v${goal.version} · 具体行动和发生事实仍回原记录维护。`} busy={state.busy} onClose={onClose}><form onSubmit={e => { e.preventDefault(); const source = sources[Number(sourceIndex)]; if (sourceIndex === '' || !source) return; const input = { goal: refOf(goal), level, source: source.ref, note }; void state.save('feedback', input, operationId => api.feedback({ ...input, operationId })); }}><Field id={`${id}-source`} label="依据的原记录"><select id={`${id}-source`} required disabled={disabled} value={sourceIndex} onChange={e => setSourceIndex(e.target.value)}><option value="">请选择当前可读的准确来源</option>{sources.map((x, i) => <option key={sourceKey(x.ref)} value={i}>{x.label} · v{x.ref.version}</option>)}</select>{!sources.length && <p className="case-help">尚未取得可核对来源，请从原Case、项目或看板记录发起；没有代填其他记录。</p>}</Field><Field id={`${id}-level`} label="反馈层级"><select id={`${id}-level`} disabled={disabled} value={level} onChange={e => setLevel(e.target.value as GoalFeedbackInput['level'])}>{Object.entries(feedbackLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></Field><Field id={`${id}-note`} label="对目标或安排的影响及待核项"><textarea id={`${id}-note`} required maxLength={4000} rows={4} disabled={disabled} value={note} onChange={e => setNote(e.target.value)} /></Field><p className="case-help">不从“已采纳”推定已经执行或效果改善；目标和经营取舍变化另作明确决定。</p><MutationNotice state={state} /><Actions state={state} label="保留反馈引用" onClose={onClose} /></form></CaseDialog>;
}

export function GoalArrangements({ arrangements, board, onOpenBoard }: { arrangements: GoalActionArrangement[]; board?: BoardView; onOpenBoard?: () => void }) {
  return <section className="sg-panel"><h2>上层行动与检查安排</h2><p className="sg-muted">具体负责人、期限、进度和反馈读取原看板；安排不代表已经执行或效果成立。</p>{arrangements.length ? arrangements.map(arrangement => <article key={arrangement.id} className="sg-history"><h3>{arrangement.title}</h3><p>{arrangement.scope}</p>{arrangement.checks.length > 0 && <><h4>检查安排</h4><ul>{arrangement.checks.map((check, index) => <li key={index}>{check}</li>)}</ul></>}<ul>{arrangement.actions.map(ref => {
    const item = board?.items.find(item => item.id === ref.itemId && item.projectId === arrangement.projectId), task = item?.tasks.find(task => task.id === ref.taskId);
    return <li key={ref.taskId}>{task ? <><strong>{task.title}</strong><p>当前行动授权：{task.authorization ? task.authorization.decision === 'revoke' ? '已撤回' : '已记录明确授权' : task.authorization === null ? '未记录明确授权' : '暂不可读取'}；实际发生与效果另据原反馈。</p><p>原看板当前记录：{task.owner || '负责人待明确'} · {task.dueDate || '期限待明确'} · {task.status === 'done' ? '完成' : task.status === 'doing' ? '进行中' : '待办'}</p><p>实际反馈：{task.feedback ? task.feedback.outcome || '有原反馈记录' : '尚未回录'}；效果未独立验证。</p></> : <p>原行动暂不可读取，具体进度与反馈保持未知。</p>}<details><summary>原行动及准确引用</summary><p>原建议 {ref.itemId}<br />原行动 {ref.taskId}<br />登记时建议版本 <code>{ref.itemVersion}</code><br />登记时行动版本 <code>{ref.taskVersion}</code><br />原授权 {ref.authorizationId}</p></details></li>;
  })}</ul>{onOpenBoard && <button type="button" className="text-button" onClick={onOpenBoard}>到原看板维护行动</button>}<details><summary>准确安排来源</summary><p>{'kind' in arrangement.source ? `原确认 ${arrangement.source.workContext?.confirmationId ?? '无项目方案确认，仅本轮明确工作'}` : `Case ${arrangement.source.caseId} · 原选择 ${arrangement.source.choiceId}`}</p><blockquote>{arrangement.quoteProvenance.quote.text}</blockquote><p>原请求 {arrangement.quoteProvenance.requestId} · 原会话 {arrangement.quoteProvenance.sessionId}</p></details><p className="sg-muted">目标 v{arrangement.goal.version} · 原安排 {arrangement.boardOperationId}</p></article>) : <p className="sg-muted">此准确目标版本尚无已记录的上层行动安排，不据此推断没有行动。</p>}</section>;
}

export function StrategyGoalsPage({ active = true, onOpenCase, onStartProject, onManageMetrics, onOpenBoard, feedbackSources = [], projects = [], configurations = [], selectedConfigurationId, onSettings = onManageMetrics }: StrategyGoalsPageProps) {
  const [index, setIndex] = useState<StrategyGoalsIndex>(empty), [cases, setCases] = useState<CaseRecord[]>([]), [enterprises, setEnterprises] = useState<StudioEnterpriseDirectory['enterprises']>([]);
  const [originalSources, setOriginalSources] = useState<GoalFeedbackSource[]>([]), [sourceNotice, setSourceNotice] = useState('');
  const [metrics, setMetrics] = useState<api.LibraryEntry[]>([]), [metricsKnown, setMetricsKnown] = useState(false);
  const [board, setBoard] = useState<BoardView>();
  const [loading, setLoading] = useState(true), [error, setError] = useState(''), [notice, setNotice] = useState(''), [view, setView] = useState<'bsc' | 'gsa' | 'history'>('gsa');
  const [perspective, setPerspective] = useState<'all' | GoalPerspective>('all'), [selectedId, setSelectedId] = useState(''), [selectedVersion, setSelectedVersion] = useState<number | null>(null);
  const [editor, setEditor] = useState<'create' | 'revise' | 'adopt' | 'relation' | 'feedback' | null>(null), [relationEditor, setRelationEditor] = useState<GoalRelation | undefined>();
  const [editorGoal, setEditorGoal] = useState<{ value: GoalVersion; record: StrategyGoalRecord } | null>(null);
  const [editorSources, setEditorSources] = useState<GoalFeedbackSource[]>([]);
  const [discussionCandidate, setDiscussionCandidate] = useState<{ goal: GoalVersion; discussionId: string; reload: () => Promise<void> }>();
  const [discussionFocus, setDiscussionFocus] = useState<{ source: GoalDiscussionSourceRef; id: string }>();
  const alive = useRef(true), requestId = useRef(0), id = useId();
  const refresh = async () => {
    const request = ++requestId.current; setLoading(true); setError('');
    const [goals, caseResult, enterpriseResult, sourceResult, metricResult, boardResult] = await Promise.allSettled([api.list(), listCases(), listStudioEnterprises(), api.feedbackSources(), api.publishedMetrics(), readBoard()]);
    if (!alive.current || request !== requestId.current) return;
    if (goals.status === 'fulfilled') { setIndex(goals.value); setSelectedId(old => goals.value.goals.some(x => x.id === old) ? old : goals.value.goals[0]?.id ?? ''); }
    else setError(api.goalError(goals.reason));
    if (caseResult.status === 'fulfilled') setCases(caseResult.value.cases); else setCases([]);
    if (enterpriseResult.status === 'fulfilled') setEnterprises(enterpriseResult.value.enterprises); else setEnterprises([]);
    if (metricResult.status === 'fulfilled') { setMetrics(metricResult.value); setMetricsKnown(true); } else { setMetrics([]); setMetricsKnown(false); }
    setBoard(boardResult.status === 'fulfilled' ? boardResult.value : undefined);
    if (sourceResult.status === 'fulfilled') {
      setOriginalSources(sourceResult.value.sources);
      setSourceNotice(sourceResult.value.unavailable.length ? `${[...new Set(sourceResult.value.unavailable.map(x => authorityLabels[x.authority]))].join('、')}的部分原来源暂不可核对，请回原入口处理；可独立核对的来源仍可使用。` : '');
    } else { setOriginalSources([]); setSourceNotice('原反馈来源目录暂不可读取，请刷新或回原Case、项目、行动看板及SAP入口核对。已保存的原引用保留。'); }
    setLoading(false);
  };
  useEffect(() => { alive.current = true; return () => { alive.current = false; requestId.current++; }; }, []);
  useEffect(() => { if (active) void refresh(); }, [active]);
  const saved = async () => { setEditor(null); setRelationEditor(undefined); setSelectedVersion(null); setNotice('已保存本次管理记录；原Case、项目和报告的准确引用保留。'); await refresh(); };
  const record = index.goals.find(x => x.id === selectedId), value = record?.versions.find(x => x.version === (selectedVersion ?? record.adoptedVersion ?? record.currentVersion));
  const visible = index.goals.filter(x => perspective === 'all' || current(x).perspective === perspective);
  const options = adoptedVersions(index), sources = [...new Map([...originalSources, ...feedbackSources, ...cases.map(x => ({ label: `Case：${x.title}`, ref: { authority: 'case' as const, id: x.id, version: x.revision } }))].map(x => [sourceKey(x.ref), x])).values()];
  const select = (id: string) => { setSelectedId(id); setSelectedVersion(index.goals.find(record => record.id === id)?.currentVersion ?? null); };
  const relations = value ? index.relations.filter(x => sameRef(x.from, value) || sameRef(x.to, value)) : [];
  const feedback = value ? index.feedback.filter(x => sameRef(x.goal, value)) : [];
  const ready = value?.status === 'adopted';
  const openEditor = (mode: typeof editor) => { setEditorGoal(value && record ? structuredClone({ value, record }) : null); if (mode === 'feedback') setEditorSources(structuredClone(sources)); setEditor(mode); };
  const openRelation = (initial?: GoalRelation) => { setRelationEditor(initial); openEditor('relation'); };
  const relationTable = <div className="sg-table-scroll"><table className="sg-table"><thead><tr><th>目标关系</th><th>职责与协同</th><th>依据／必要条件</th><th>版本</th></tr></thead><tbody>{relations.map(x => <tr key={x.id}><td>{goalName(index, x.from)}<br /><strong>{relationLabels[x.kind]}</strong> → {goalName(index, x.to)}</td><td>{x.responsibility}</td><td>{x.rationale}</td><td>关系 v{x.revision}<br /><button type="button" className="text-button" onClick={() => openRelation(x)}>修订关系</button>{x.history.length > 0 && <details><summary>历史</summary>{x.history.map(v => <p key={v.revision}>v{v.revision} · {goalName(index, v.from)} → {goalName(index, v.to)}<br />{v.responsibility}<br />{v.rationale}</p>)}</details>}</td></tr>)}</tbody></table>{!relations.length && <p className="sg-muted">此准确目标版本尚无已记录关系，不据此推断业务上没有贡献或必要条件。</p>}</div>;
  return <section className="case-board strategy-goals-page" aria-labelledby={`${id}-heading`}><header className="case-board-heading"><div><p className="eyebrow">目标与持续经营承接</p><h1 id={`${id}-heading`}>战略与目标</h1><p>从当期目标承接Case和项目；简单查询、核对与Studio建设可直接开展。</p></div><button type="button" className="primary-button" disabled={loading} onClick={() => openEditor('create')}>＋ 新建候选目标</button></header>
    <CaseFormError error={error} />{notice && <p className="case-notice" role="status">{notice}</p>}{sourceNotice && <p className="case-notice" role="status">{sourceNotice}</p>}
    <nav className="sg-tabs" aria-label="目标工作视图">{([['gsa', 'GSA承接'], ['history', '版本与反馈']] as const).map(([key, label]) => <button type="button" key={key} aria-current={view === key ? 'page' : undefined} onClick={() => setView(key)}>{label}</button>)}<details className="sg-optional-tools"><summary>按需工具{view === 'bsc' ? ' · BSC已展开' : ''}</summary><button type="button" className="text-button" aria-current={view === 'bsc' ? 'page' : undefined} onClick={() => setView('bsc')}>BSC／战略目标关系</button><p className="sg-muted">同一批目标、关系、来源与准确历史，不新建另一份目标。</p></details></nav>
    <StrategyDiscussionPanel active={active} focusRequest={discussionFocus} selectedGoal={value} projects={projects} configurations={configurations} selectedConfigurationId={selectedConfigurationId} onSettings={onSettings} onGoalsChanged={refresh} onReviewCandidate={(goal, discussionId, reload) => { void refresh().then(() => setDiscussionCandidate({ goal: structuredClone(goal), discussionId, reload })); }} />
    <div className="case-board-toolbar"><div className="case-board-filters"><label htmlFor={`${id}-perspective`}>适用视角</label><select id={`${id}-perspective`} value={perspective} onChange={e => setPerspective(e.target.value as typeof perspective)}><option value="all">全部视角</option>{Object.entries(perspectiveLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select><button type="button" className="text-button" disabled={loading} onClick={() => { void refresh(); }}>刷新目标与来源</button></div><span className="sg-muted">{index.goals.length}个目标 · 候选与已采纳版本分别保留</span></div>
    {loading && !index.goals.length ? <p className="case-message" role="status">正在读取目标记录…</p> : !visible.length ? <div className="sg-empty"><h2>{index.goals.length ? '此视角尚无已记录目标' : '从一个适用目标开始'}</h2><p>可以复用已有目标，也可先保存候选。无需先编完整组织层级或填满全部BSC维度。</p><button type="button" className="secondary-button" onClick={() => openEditor('create')}>新建候选目标</button></div> : <div className="sg-grid" aria-label="目标列表">{visible.map(x => { const v = current(x); return <button type="button" className="sg-goal-choice" key={x.id} aria-pressed={x.id === selectedId} onClick={() => select(x.id)}><span className={`sg-badge ${v.status === 'candidate' ? 'pending' : ''}`}>{v.status === 'candidate' ? '候选待采纳' : '已采纳'} · v{v.version}</span><strong>{v.title}</strong><small>{scopeLabels[v.scope.kind]} · {v.scope.name} · {v.responsible}</small><small>{v.baseline.state === 'pending' ? '基线待补' : '已有基线说明'}{x.adoptedVersion !== null && x.adoptedVersion !== v.version ? ` · 正式采用仍为v${x.adoptedVersion}` : ''}</small></button>; })}</div>}
    {value && record && <><section className="sg-panel"><div className="sg-row-between"><div><h2>{value.title}</h2><p className="sg-muted">{perspectiveLabels[value.perspective]} · {scopeLabels[value.scope.kind]}：{value.scope.name}</p></div><label>查看准确版本 <select className="sg-select" value={value.version} onChange={e => setSelectedVersion(Number(e.target.value))}>{record.versions.map(x => <option key={x.version} value={x.version}>v{x.version} · {x.status === 'candidate' ? '候选' : '已采纳'}{x.version === record.adoptedVersion ? ' · 当前采用' : ''}</option>)}</select></label></div><p>{value.outcome}</p>{(value.strategyContext || value.usageContext || value.source) && <details className="sg-origin"><summary>战略背景与准确来源</summary>{value.usageContext && <p>本目标用途：{value.usageContext.kind === 'organization' ? '组织' : value.usageContext.kind === 'department' ? '部门／业务模块' : '个人'} · {value.usageContext.background || '未补充背景'}</p>}{value.strategyContext && <><p>{value.strategyContext.summary}</p>{value.strategyContext.methods?.length ? <p>参考方法：{value.strategyContext.methods.map(method => method.name).join(' ＋ ')}</p> : null}</>}{value.source && <><p>原来源：{authorityLabels[value.source.authority]} · 准确版 {value.source.version}</p>{value.source.authority === 'strategy-discussion' && <button type="button" className="text-button" onClick={() => setDiscussionFocus({ source: value.source as GoalDiscussionSourceRef, id: crypto.randomUUID() })}>查看原战略讨论</button>}<details><summary>准确引用身份</summary><pre>{JSON.stringify(value.source, null, 2)}</pre></details></>}</details>}<dl className="sg-details"><dt>衡量依据</dt><dd>{value.measurement.kind === 'quantitative' ? <>SAP指标 {value.measurement.sapMetric.metricName || '旧版未明确具体指标'} · {value.measurement.sapMetric.id} · 准确发布版 {value.measurement.sapMetric.version}<br />{value.measurement.target}<br /><button type="button" className="text-button" onClick={onManageMetrics}>查看原SAP指标</button></> : value.measurement.criterion}</dd><dt>基线</dt><dd>{value.baseline.state === 'pending' ? '待补：' : ''}{value.baseline.description}</dd><dt>责任与期限</dt><dd>{value.responsible} · {value.dueAt ? value.dueAt.slice(0, 10) : '期限未记录'}</dd></dl><div className="sg-row">{!ready && <button type="button" className="primary-button" disabled={loading} onClick={() => openEditor('adopt')}>核对并采纳此版本</button>}<button type="button" className="secondary-button" disabled={!ready || loading} onClick={() => onOpenCase(refOf(value))}>从此目标创建Case</button><button type="button" className="secondary-button" disabled={!ready || loading} onClick={() => onStartProject(refOf(value), resolveNewUsageContext({ goal: value }))}>从此目标开始项目</button><button type="button" className="text-button" disabled={loading} onClick={() => openEditor('revise')}>提出目标修订</button></div>{!ready && <p className="sg-muted">候选尚不能作为正式Case主目标。采纳不会替换旧引用，也不会自动创建Case、启动任务或执行经营动作。</p>}</section>
      {view === 'bsc' && <><div className="sg-grid">{[...new Set([...bscLabels(perspective), ...visible.map(x => current(x).bscPerspective).filter((x): x is string => Boolean(x))])].map(label => <section className="sg-panel" key={label}><h3>{label}</h3>{visible.filter(x => current(x).bscPerspective === label).map(x => <p key={x.id}><button type="button" className="text-button" onClick={() => select(x.id)}>{current(x).title} · v{current(x).version}</button></p>)}{!visible.some(x => current(x).bscPerspective === label) && <p className="sg-muted">尚未记录此类目标；不要求平均配置或凑齐维度。</p>}</section>)}</div><section className="sg-panel"><div className="sg-row-between"><h2>当前准确版本的目标关系</h2><button type="button" className="secondary-button" disabled={!ready || options.length < 2 || loading} onClick={() => openRelation()}>增加目标关系</button></div>{relationTable}</section></>}
      {view === 'gsa' && <><section className="sg-panel"><div className="sg-row-between"><h2>同一目标，按职责承接</h2><button type="button" className="secondary-button" disabled={!ready || options.length < 2 || loading} onClick={() => openRelation()}>记录贡献关系</button></div><p className="sg-muted">企业BSC与GSA直接引用同一目标版本；部门和个人按职责贡献，不复制一份企业指标或机械分摊比例。</p>{relationTable}</section><section className="sg-panel"><h2>策略、资源与必要条件</h2><div className="sg-grid">{([['策略安排', value.strategies], ['资源与约束', value.resources], ['必要条件／待核前提', value.necessaryConditions]] as const).map(([label, items]) => <div key={label}><h3>{label}</h3>{items?.length ? <ul>{items.map((item, i) => <li key={i}>{item}</li>)}</ul> : <p className="sg-muted">尚未记录，不据此推定前提成立。</p>}</div>)}</div></section><GoalArrangements arrangements={(index.arrangements ?? []).filter(arrangement => sameRef(arrangement.goal, value))} board={board} onOpenBoard={onOpenBoard} /></>}
      {view === 'history' && <><section className="sg-panel"><h2>目标版本</h2><ul className="sg-history">{record.versions.slice().reverse().map(x => <li key={x.version}><div className="sg-row-between"><strong>{x.title} · v{x.version}</strong><span className={`sg-badge ${x.status === 'candidate' ? 'pending' : ''}`}>{x.status === 'candidate' ? '候选待采纳' : '已采纳'}</span></div><p className="sg-muted">保存于{caseDate(x.createdAt)}{x.adoptedAt ? ` · 采纳于${caseDate(x.adoptedAt)}` : ''}</p>{x.adoptionDecision && <p>明确决定：{x.adoptionDecision}</p>}<button type="button" className="text-button" onClick={() => setSelectedVersion(x.version)}>查看这一版</button></li>)}</ul><p className="sg-muted">目标更新不会静默改写已确认方案、Case、报告或人的旧选择。受影响工作按原引用核对。</p></section><section className="sg-panel"><div className="sg-row-between"><h2>三层反馈及原记录</h2><button type="button" className="secondary-button" disabled={!ready || loading} onClick={() => openEditor('feedback')}>记录目标层反馈</button></div>{feedback.length ? <ul className="sg-history">{feedback.map(x => <li key={x.id}><strong>{feedbackLabels[x.level]}</strong><p>{x.note}</p><p className="sg-muted">来源：{sources.find(s => s.ref.authority === x.source.authority && s.ref.id === x.source.id)?.label ?? '原记录'} · 准确版{x.source.version} · {caseDate(x.createdAt)}</p></li>)}</ul> : <p className="sg-muted">此准确目标版本尚无反馈引用。选择、实际执行、效果成熟度分别以原记录核对。</p>}</section></>}
    </>}
    {discussionCandidate && <DiscussionCandidateAdoption active={active} candidate={discussionCandidate.goal} discussionId={discussionCandidate.discussionId} index={index} enterprises={enterprises} metrics={metrics} metricsKnown={metricsKnown} onManageMetrics={onManageMetrics} onClose={() => setDiscussionCandidate(undefined)} onAdopted={async ref => { await discussionCandidate.reload(); setSelectedId(ref.goalId); setSelectedVersion(ref.version); setView('gsa'); setDiscussionCandidate(undefined); setNotice('已采用准确目标版本；原GSA与Case／项目入口沿同一记录承接，未授权经营执行。'); }} />}
    {(editor === 'create' || editor === 'revise') && <GoalEditor active={active} key={editor === 'create' ? 'new' : editorGoal ? refKey(editorGoal.value) : 'revise'} initial={editor === 'revise' ? editorGoal?.value : undefined} record={editor === 'revise' ? editorGoal?.record : undefined} index={index} enterprises={enterprises} metrics={metrics} metricsKnown={metricsKnown} onSaved={saved} onClose={() => setEditor(null)} onManageMetrics={onManageMetrics} />}
    {editor === 'adopt' && editorGoal && <GoalAdoptionDialog active={active} value={editorGoal.value} record={editorGoal.record} onSaved={saved} onClose={() => setEditor(null)} />}
    {editor === 'relation' && editorGoal && <RelationEditor active={active} index={index} selected={editorGoal.value} initial={relationEditor} onSaved={saved} onClose={() => { setEditor(null); setRelationEditor(undefined); }} />}
    {editor === 'feedback' && editorGoal && <FeedbackEditor active={active} goal={editorGoal.value} sources={editorSources} onSaved={saved} onClose={() => setEditor(null)} />}
  </section>;
}
