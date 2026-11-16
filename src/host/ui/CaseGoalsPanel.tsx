import { useEffect, useState } from 'react';
import type { CaseGoalBinding, CaseGoalBindingInput, CaseRecord, GoalRef, GoalVersion, StrategyGoalsIndex } from './case-client.ts';
import * as api from './case-client.ts';
import { CaseGoalPicker } from './CaseGoalPicker.tsx';
import { CaseFormError, caseDate, caseError, useOperationId } from './CaseDialogs.tsx';

type Props = { record: CaseRecord; binding?: CaseGoalBinding | null; onChanged: () => Promise<void>; initialIndex?: StrategyGoalsIndex; onBusyChange?: (busy: boolean) => void };
export function CaseGoalsPanel({ record, binding, onChanged, initialIndex, onBusyChange }: Props) {
  const [index, setIndex] = useState<StrategyGoalsIndex | null>(initialIndex ?? null), [readError, setReadError] = useState('');
  const [editing, setEditing] = useState<{ expectedRevision: number; value: CaseGoalBindingInput | null } | null>(null), [ready, setReady] = useState(false), [goalBusy, setGoalBusy] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [attempt, setAttempt] = useState<{ operationId: string; expectedRevision: number; goalBinding: CaseGoalBindingInput } | null>(null), [savedBinding, setSavedBinding] = useState<CaseGoalBinding | null>(null), [notice, setNotice] = useState('');
  useEffect(() => { onBusyChange?.(busy || goalBusy); return () => onBusyChange?.(false); }, [busy, goalBusy, onBusyChange]);
  const operationId = useOperationId(), closed = record.status === 'closed', current = savedBinding ?? binding;
  useEffect(() => { if (initialIndex) return; let alive = true; void api.strategyGoals().then(value => { if (alive) setIndex(value); }, failure => { if (alive) setReadError(caseError(failure)); }); return () => { alive = false; }; }, []);
  useEffect(() => { if (binding && savedBinding && binding.caseRevision >= savedBinding.caseRevision) setSavedBinding(null); }, [binding]);
  const exact = (ref: GoalRef): GoalVersion | undefined => index?.goals.find(goal => goal.id === ref.goalId)?.versions.find(version => version.version === ref.version);
  const goal = (ref: GoalRef) => { const value = exact(ref); return <div><strong>{value?.title ?? '原目标准确版本暂不可读取'} · v{ref.version}</strong>{value ? <><p>{value.outcome}</p><p className="case-help">{value.measurement.kind === 'deliverable' ? value.measurement.criterion : `SAP指标 ${value.measurement.sapMetric.id} / ${value.measurement.sapMetric.version}`} · {value.scope.name}</p></> : <p className="case-help">原目标引用保留，未改用当前新版：{ref.goalId}</p>}</div>; };
  const readback = async () => {
    if (!attempt) return;
    setBusy(true); setError('');
    try {
      const receipt = (await api.operation(attempt.operationId)).operation;
      if (receipt?.phase !== 'completed' || receipt.caseId !== record.id) { setError('原操作尚未确认完成。保留原输入及编号，可继续核对，或重试同一原操作。'); return; }
      const result = await api.caseGoals(record.id);
      const saved = result.history.find(item => item.operationId === attempt.operationId) ?? (result.goalBinding?.operationId === attempt.operationId ? result.goalBinding : null);
      if (!saved) { setError('原操作回执存在，但准确目标关联暂未读到；保留UNKNOWN，不会重建关联。'); return; }
      setSavedBinding(saved); setEditing(null); setAttempt(null); setNotice('原目标关联已准确核对，历史版本保留。'); await onChanged();
    } catch (failure) { setError(caseError(failure)); } finally { setBusy(false); }
  };
  const save = async () => {
    if (!editing || closed || !attempt && (!editing.value || !ready)) return;
    const fields = attempt ?? { expectedRevision: editing.expectedRevision, goalBinding: editing.value!, operationId: operationId({ caseId: record.id, expectedRevision: editing.expectedRevision, goalBinding: editing.value }) };
    setAttempt(fields); setBusy(true); setError(''); let saved = false;
    try {
      const result = await api.setCaseGoals(record.id, fields); saved = true;
      setSavedBinding(result.goalBinding); setEditing(null); setAttempt(null); setNotice('目标关联已保存；旧关联与报告仍保留当时版本。'); await onChanged();
    } catch (failure) {
      if (!saved && failure instanceof api.CaseRequestError && failure.status < 500 && failure.code !== 'operation_conflict') setAttempt(null);
      setError(`${saved ? '保存已完成，当前详情刷新未完成，请重新读取。' : !(failure instanceof api.CaseRequestError) || failure.status >= 500 || failure.code === 'operation_conflict' ? '保存结果尚未确认，原输入和操作已保留，请先核对原结果。' : ''}${caseError(failure)}`);
    } finally { setBusy(false); }
  };
  return <section className="case-detail-text" aria-label="Case目标关联"><div className="case-section-heading"><div><h3>目标关联</h3><p>主目标与相关目标引用准确版本，管理承接沿原目标记录。</p></div>{!closed && !editing && <button type="button" className="secondary-button" onClick={() => { setEditing({ expectedRevision: record.revision, value: current ? { primary: current.primary, related: [...current.related] } : null }); setError(''); setNotice(''); }}>{current ? '调整目标关联' : '补充目标关联'}</button>}</div>
    {current ? <><div className="case-detail-text"><h4>主目标</h4>{goal(current.primary)}</div>{current.related.length > 0 && <details><summary>相关目标 · {current.related.length}</summary>{current.related.map(ref => <div key={`${ref.goalId}/${ref.version}`}>{goal(ref)}</div>)}</details>}<p className="case-help">关联确认于 {caseDate(current.confirmedAt)} · Case修订 {current.caseRevision}。后补关联按真实时间记录。</p></> : <p className="case-message">待补关联：此旧Case尚未记录主目标，原判断、项目、任务和历史仍保留。</p>}
    {readError && <><CaseFormError error={readError} /><button type="button" className="text-button" disabled={busy} onClick={async () => { setBusy(true); try { setIndex(await api.strategyGoals()); setReadError(''); } catch (failure) { setReadError(caseError(failure)); } finally { setBusy(false); } }}>重新读取原目标</button></>}
    {closed && <p className="case-help">已结束Case的目标关联只读；重新打开后才能明确修改。</p>}
    {editing && <div className="case-message"><p>本次依据Case修订 {editing.expectedRevision}。若其他操作已更新，不覆盖当前关联；输入保留供核对。</p><CaseGoalPicker value={editing.value} onChange={value => setEditing(previous => previous ? { ...previous, value } : null)} initialIndex={index ?? undefined} disabled={closed || busy || Boolean(attempt)} onBusyChange={setGoalBusy} onValidityChange={setReady} />
      <div className="case-inline-actions"><button type="button" className="secondary-button" disabled={busy || goalBusy || closed || !attempt && !ready} onClick={() => { void save(); }}>{attempt ? '重试原目标关联' : '确认保存目标关联'}</button>{attempt ? <button type="button" className="text-button" disabled={busy || goalBusy} onClick={() => { void readback(); }}>核对原保存结果</button> : <button type="button" className="text-button" disabled={busy || goalBusy} onClick={() => setEditing(null)}>取消调整</button>}</div>{attempt && <p className="case-help">原操作编号：{attempt.operationId}</p>}
    </div>}
    {notice && <p className="case-notice" role="status">{notice}</p>}<CaseFormError error={error} />
  </section>;
}
