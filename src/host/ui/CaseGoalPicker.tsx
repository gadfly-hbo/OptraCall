import { useEffect, useId, useState } from 'react';
import type { CaseGoalBindingInput, GoalDraftInput, GoalRef, GoalVersion, StrategyGoalsIndex } from './case-client.ts';
import * as api from './case-client.ts';
import { CaseFormError, caseError, useOperationId } from './CaseDialogs.tsx';

const refKey = (ref: GoalRef) => `${ref.goalId}@${ref.version}`;
export function adoptedCaseGoals(index: StrategyGoalsIndex): GoalVersion[] { return index.goals.flatMap(record => record.versions.filter(version => version.status === 'adopted')); }
export type CaseGoalPickerProps = {
  value: CaseGoalBindingInput | null;
  onChange: (value: CaseGoalBindingInput | null) => void;
  disabled?: boolean;
  suggestedTitle?: string;
  initialIndex?: StrategyGoalsIndex;
  onBusyChange?: (value: boolean) => void;
  onValidityChange?: (value: boolean) => void;
};

export function CaseGoalPicker({ value, onChange, disabled = false, suggestedTitle = '', initialIndex, onBusyChange, onValidityChange }: CaseGoalPickerProps) {
  const id = useId(), createOperation = useOperationId(), adoptOperation = useOperationId();
  const [index, setIndex] = useState<StrategyGoalsIndex | null>(initialIndex ?? null), [loading, setLoading] = useState(!initialIndex), [error, setError] = useState(''), [busy, setBusy] = useState(false), [building, setBuilding] = useState(false);
  const [enterprises, setEnterprises] = useState<{ id: string; name: string }[]>([]), [scopeError, setScopeError] = useState('');
  const [title, setTitle] = useState(''), [criterion, setCriterion] = useState(''), [responsible, setResponsible] = useState(''), [scope, setScope] = useState(''), [personalName, setPersonalName] = useState(''), [perspective, setPerspective] = useState<'profit' | 'nonprofit'>('profit');
  const [candidate, setCandidate] = useState<GoalVersion | null>(null), [attempt, setAttempt] = useState<(GoalDraftInput & { operationId: string }) | null>(null);
  const available = index ? adoptedCaseGoals(index) : [], selected = value ? available.find(goal => refKey(goal) === refKey(value.primary)) : null;
  const locked = disabled || busy, draftLocked = locked || Boolean(attempt) || Boolean(candidate);
  useEffect(() => { onBusyChange?.(busy); return () => onBusyChange?.(false); }, [busy, onBusyChange]);
  useEffect(() => { onValidityChange?.(Boolean(selected)); }, [Boolean(selected), onValidityChange]);
  useEffect(() => { if (initialIndex) return; let alive = true; void api.strategyGoals().then(result => { if (alive) setIndex(result); }, failure => { if (alive) setError(caseError(failure)); }).finally(() => { if (alive) setLoading(false); }); return () => { alive = false; }; }, []);
  const refresh = async () => { setLoading(true); setError(''); try { setIndex(await api.strategyGoals()); } catch (failure) { setError(caseError(failure)); } finally { setLoading(false); } };
  const prepare = async () => { setBuilding(true); setTitle(previous => previous || suggestedTitle); setScopeError(''); try { setEnterprises((await api.goalEnterprises()).enterprises); } catch { setScopeError('企业目录暂未读到，可重新读取，或明确选择个人目标；未猜测企业归属。'); } };
  const saveCandidate = async () => {
    if (!attempt && (!title.trim() || !criterion.trim() || !responsible.trim() || !scope || scope === 'personal' && !personalName.trim())) { setError('请填写目标、可核成果、责任角色，并明确已有企业或个人归属。'); return; }
    const enterprise = enterprises.find(item => item.id === scope);
    if (!attempt && scope !== 'personal' && !enterprise) { setError('请选择实际可读的已有企业，或明确个人目标。'); return; }
    const fields: GoalDraftInput = { title: title.trim(), outcome: criterion.trim(), perspective: scope === 'personal' ? 'personal' : perspective, scope: scope === 'personal' ? { kind: 'personal', id: `personal:${personalName.trim()}`, name: personalName.trim() } : { kind: 'enterprise', id: enterprise!.id, name: enterprise!.name }, measurement: { kind: 'deliverable', criterion: criterion.trim() }, baseline: { state: 'pending', description: '待补可比基线；本次按已说明的可核成果核定。' }, responsible: responsible.trim() };
    const input = attempt ?? { ...fields, operationId: createOperation(fields) };
    setBusy(true); setError(''); setAttempt(input);
    try {
      if (attempt) { const receipt = (await api.goalOperation(attempt.operationId)).operation; if (receipt) { if (receipt.kind !== 'create' || !('goalId' in receipt.result)) throw new api.CaseRequestError('operation_conflict', 409); setCandidate(receipt.result as GoalVersion); return; } }
      setCandidate((await api.createGoalCandidate(input)).goal);
    }
    catch (failure) { if (failure instanceof api.CaseRequestError && failure.status < 500 && failure.code !== 'operation_conflict') setAttempt(null); setError(`${failure instanceof api.CaseRequestError && failure.status < 500 ? '' : '候选保存结果尚未确认，原输入与操作已保留；请重试原操作核对，不会另建。'}${caseError(failure)}`); }
    finally { setBusy(false); }
  };
  const adopt = async () => {
    if (!candidate) return;
    setBusy(true); setError(''); const input = { expectedVersion: candidate.version, decision: '用户明确采纳此目标准确版本，并选择为当前Case主目标；不代表经营行动已授权或已发生。' };
    try {
      const result = await api.adoptGoalCandidate(candidate, { ...input, operationId: adoptOperation({ goalId: candidate.goalId, version: candidate.version, ...input }) });
      const record = { id: result.goal.goalId, currentVersion: result.goal.version, adoptedVersion: result.goal.version, versions: [result.goal] };
      setIndex(previous => ({ goals: [...(previous?.goals ?? []).filter(item => item.id !== record.id), record], relations: previous?.relations ?? [], feedback: previous?.feedback ?? [] }));
      onChange({ primary: { goalId: result.goal.goalId, version: result.goal.version }, related: value?.related.filter(ref => ref.goalId !== result.goal.goalId) ?? [] });
      setCandidate(null); setAttempt(null); setBuilding(false);
    } catch (failure) {
      // Adoption may have committed before a lost reply; read the exact candidate before any retry.
      try { const current = (await api.goalRecord(candidate.goalId)).goal; const exact = current.versions.find(version => version.version === candidate.version); if (exact?.status === 'adopted') { setIndex(previous => ({ goals: [...(previous?.goals ?? []).filter(item => item.id !== current.id), current], relations: previous?.relations ?? [], feedback: previous?.feedback ?? [] })); onChange({ primary: { goalId: exact.goalId, version: exact.version }, related: value?.related.filter(ref => ref.goalId !== exact.goalId) ?? [] }); setCandidate(null); setAttempt(null); setBuilding(false); return; } } catch { /* Keep the original candidate and operation when readback is unknown. */ }
      setError(`采纳结果需要核对，原候选保留。${caseError(failure)}`);
    } finally { setBusy(false); }
  };
  return <fieldset className="case-reference-picker" disabled={disabled} aria-label="Case目标关联"><legend>目标关联</legend>
    <div className="case-field"><label htmlFor={`${id}-primary`}>主目标 <span>必填</span></label><select id={`${id}-primary`} required disabled={locked || loading} value={value ? refKey(value.primary) : ''} onChange={event => { const goal = available.find(item => refKey(item) === event.target.value); onChange(goal ? { primary: { goalId: goal.goalId, version: goal.version }, related: value?.related.filter(ref => refKey(ref) !== refKey(goal)) ?? [] } : null); }}><option value="">{loading ? '正在读取已采纳目标…' : '请选择已采纳的主目标'}</option>{available.map(goal => <option key={refKey(goal)} value={refKey(goal)}>{goal.title} · v{goal.version} · {goal.scope.name}</option>)}</select>{selected && <p className="case-help">{selected.outcome} · {selected.measurement.kind === 'deliverable' ? selected.measurement.criterion : `SAP指标 ${selected.measurement.sapMetric.id} / ${selected.measurement.sapMetric.version}`}</p>}</div>
    <details><summary>相关目标（可选）</summary>{available.filter(goal => !value || refKey(goal) !== refKey(value.primary)).map(goal => <label key={refKey(goal)}><input type="checkbox" disabled={locked || !value} checked={Boolean(value?.related.some(ref => refKey(ref) === refKey(goal)))} onChange={event => { if (value) onChange({ ...value, related: event.target.checked ? [...value.related, { goalId: goal.goalId, version: goal.version }] : value.related.filter(ref => refKey(ref) !== refKey(goal)) }); }} /><span>{goal.title} · v{goal.version}</span></label>)}{!available.length && <p className="case-help">尚无已采纳目标。</p>}</details>
    <p className="case-help">{value ? '关联保留所选准确版本，不随目标后续修订静默改变。' : '尚未选择主目标。简单查询、核对及Studio建设仍可不建Case。'}</p>
    <CaseFormError error={error} /><div className="case-inline-actions"><button type="button" className="text-button" disabled={locked || loading} onClick={() => { void refresh(); }}>重新读取目标</button>{!building && <button type="button" className="text-button" disabled={locked} onClick={() => { void prepare(); }}>无适用目标，准备候选</button>}</div>
    {building && <section className="case-message" aria-label="准备目标候选"><h3>准备目标候选</h3><p>只补这件事需要的目标，不要求先编完整组织BSC。保存候选与人工采纳分开。</p>
      <div className="case-field"><label htmlFor={`${id}-goal-title`}>目标名称</label><input id={`${id}-goal-title`} value={title} maxLength={200} disabled={draftLocked} onChange={event => setTitle(event.target.value)} /></div>
      <div className="case-field"><label htmlFor={`${id}-criterion`}>预期结果与可核交付</label><textarea id={`${id}-criterion`} rows={3} value={criterion} maxLength={4000} disabled={draftLocked} onChange={event => setCriterion(event.target.value)} placeholder="例如：明确适用窗口的变化及有依据的下一步，未核实的原因保留待核" /></div>
      <div className="case-form-row"><div className="case-field"><label htmlFor={`${id}-scope`}>目标归属</label><select id={`${id}-scope`} value={scope} disabled={draftLocked} onChange={event => setScope(event.target.value)}><option value="">请选择已有企业或个人</option>{enterprises.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}<option value="personal">个人目标</option></select></div><div className="case-field"><label htmlFor={`${id}-responsible`}>责任角色／承担人</label><input id={`${id}-responsible`} value={responsible} disabled={draftLocked} maxLength={300} onChange={event => setResponsible(event.target.value)} /></div></div>
      {scope && scope !== 'personal' && <div className="case-field"><label htmlFor={`${id}-perspective`}>目标视角</label><select id={`${id}-perspective`} value={perspective} disabled={draftLocked} onChange={event => setPerspective(event.target.value as 'profit' | 'nonprofit')}><option value="profit">营利组织</option><option value="nonprofit">非营利组织</option></select></div>}
      {scope === 'personal' && <div className="case-field"><label htmlFor={`${id}-personal`}>个人归属名称</label><input id={`${id}-personal`} value={personalName} maxLength={200} disabled={draftLocked} onChange={event => setPersonalName(event.target.value)} /></div>}{scopeError && <p className="case-help">{scopeError}</p>}
      {candidate ? <><p><strong>{candidate.title}</strong> · 候选v{candidate.version}</p><p>{candidate.outcome}</p><button type="button" className="secondary-button" disabled={locked} onClick={() => { void adopt(); }}>采纳此目标并作为主目标</button><p className="case-help">这次明确操作采纳目标并选择给当前Case；Case仍须点击本表单的创建／保存，不代表经营行动授权。</p></> : <button type="button" className="secondary-button" disabled={locked} onClick={() => { void saveCandidate(); }}>{busy ? '正在保存…' : attempt ? '重试原候选保存并核对' : '保存目标候选'}</button>}
      {attempt && <p className="case-help">原候选操作编号：{attempt.operationId}。保留原请求，不换编号重建。</p>}{!candidate && !attempt && <button type="button" className="text-button" disabled={locked} onClick={() => setBuilding(false)}>暂不准备</button>}
    </section>}
  </fieldset>;
}
