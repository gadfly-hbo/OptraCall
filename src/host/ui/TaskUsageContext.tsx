import { useEffect, useRef, useState } from 'react';
import type { ClientTask } from './project-types.ts';
import type { ProjectPlanConfirmation } from '../project-plan-types.ts';
import { parseUsageContext } from '../usage-context-types.ts';
import { read as readPlan } from './project-plan-client.ts';
import { usageKindLabels } from './UsageContextSettingsPage.tsx';
const record = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === 'object' && !Array.isArray(value));
export function TaskUsageContextReceipt({ value }: { value: unknown }) {
  if (!record(value)) return <p className="sg-muted">当时未记录用途背景，保持未知；未补入当前默认。</p>;
  let purpose; try { if (value.usageContext !== undefined) purpose = parseUsageContext(value.usageContext); } catch { return <p className="case-error">当时背景记录不可解析，保持未知，未换用当前设置。</p>; }
  return <><p>{purpose ? `本次用途：${usageKindLabels[purpose.kind]}；${purpose.background || '未补充背景。'}` : '当时未记录用途背景，保持未知；未补入当前默认。'}</p>{typeof value.planVersion === 'number' && <p className="sg-muted">准确项目方案 v{value.planVersion} · 原确认 {String(value.confirmationId || '未记录')}</p>}{typeof value.text === 'string' && <details><summary>当时提供的目标准确版与需求正文</summary><pre className="task-usage-context-text">{value.text}</pre></details>}</>;
}
export function TaskUsageContext({ projectId, task, providedContext }: { projectId: string; task: ClientTask; providedContext: unknown }) {
  const [confirmation, setConfirmation] = useState<ProjectPlanConfirmation>(), [loaded, setLoaded] = useState(false), [error, setError] = useState(''), owner = useRef(`${projectId}/${task.id}`); owner.current = `${projectId}/${task.id}`;
  const supplied = record(providedContext) && record(providedContext.projectPlan) ? providedContext.projectPlan : undefined;
  useEffect(() => { setConfirmation(undefined); setLoaded(false); setError(''); }, [projectId, task.id]);
  const load = async () => {
    if (loaded || supplied || !task.planOrigin) return; const expected = owner.current;
    try { const state = await readPlan(projectId); if (owner.current !== expected) return; const original = state.history.find(item => item.id === task.planOrigin!.confirmationId); if (!original || !original.tasks.some(item => item.taskId === task.id)) throw new Error('任务创建时的原方案确认暂不可核对，未换用当前方案。'); setConfirmation(original); setLoaded(true); }
    catch (fault) { if (owner.current === expected) setError(fault instanceof Error ? fault.message : '原方案暂不可读取。'); }
  };
  return <details className="case-message task-usage-context" onToggle={event => { if (event.currentTarget.open) void load(); }}><summary>本任务的用途与目标背景</summary>{supplied ? <><p className="sg-muted">按原生请求记录显示实际提供内容，不代表 Agent 已采用或业务已证实。</p><TaskUsageContextReceipt value={supplied} /></> : confirmation ? <><p className="sg-muted">任务创建时的方案背景，尚不能据此证明已向模型提供、已执行或有效。</p><TaskUsageContextReceipt value={{ ...confirmation.plan, planVersion: confirmation.planVersion, confirmationId: confirmation.id }} />{confirmation.plan.goalContext && <p>创建时来源目标：{confirmation.plan.goalContext.goal.goalId} · v{confirmation.plan.goalContext.goal.version}</p>}</> : <p className="sg-muted">{task.planOrigin ? '展开后核对任务创建时的原确认；不会以当前默认或最新方案补历史。' : '旧任务未记录确定的创建方案背景，保持原意或未知。'}</p>}{error && <p className="case-error" role="status">{error}</p>}</details>;
}
