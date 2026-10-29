import { derivedOpenQuestions, isStale, type RequirementInstance } from '../contract/validate.ts';

export type GateLevel = 'hard' | 'warn' | 'info';
export type GateStatus = 'pass' | 'fail' | 'warn' | 'info';
export type GateItem = Readonly<{ id: string; level: GateLevel; status: GateStatus; title: string; detail: string }>;
export type GateReport = Readonly<{ hard: readonly GateItem[]; warn: readonly GateItem[]; info: readonly GateItem[]; publishBlocked: boolean }>;

/** must_confirm items that have not converged to answered or assumed. Advice only — the soft gate never blocks on them. */
export function pendingMustConfirm(instance: RequirementInstance): number {
  return instance.clarifications.filter(item => item.priority === 'must_confirm' && (item.status === 'pending' || item.status === 'skipped')).length;
}

export function instanceStatus(instance: RequirementInstance): 'draft' | 'confirmed' | 'stale' {
  if (!instance.snapshot) return 'draft';
  return isStale(instance) ? 'stale' : 'confirmed';
}

/**
 * Three-tier soft gate. Only "hard" (structural validity of the RAP itself) blocks
 * publishing; consistency warnings and business completeness never block editing,
 * stage navigation, or publishing. This mirrors the product principle that the
 * host never prescribes analysis steps.
 */
export function computeGateReport(instance: RequirementInstance): GateReport {
  const hard: GateItem[] = [
    { id: 'rap-parseable', level: 'hard', status: 'pass', title: 'RAP 结构可解析', detail: '实例通过 schema 校验，canonical 序列化与指纹可复算。' },
    { id: 'framework-present', level: 'hard', status: instance.framework ? 'pass' : 'fail', title: '分析与报告框架非空', detail: instance.framework ? `指标 ×${instance.framework.metrics.length} · 数据需求 ×${instance.framework.dataNeeds.length} · 分析路径 ×${instance.framework.analysisPaths.length} · 报告树 ×${instance.framework.reportFramework.length}。` : '尚未生成框架：到 Stage 03 生成后再发布。' },
    { id: 'snapshot-present', level: 'hard', status: instance.snapshot ? 'pass' : 'fail', title: '存在已确认需求快照', detail: instance.snapshot ? `快照 ${instance.snapshot.fingerprint.slice(0, 19)}…，确认人 ${instance.snapshot.confirmedBy}。` : '尚未确认：到 Stage 02 点击「确认成正式需求」。' },
  ];
  const warn: GateItem[] = [
    { id: 'snapshot-freshness', level: 'warn', status: instance.snapshot && isStale(instance) ? 'warn' : 'pass', title: '快照新鲜度', detail: !instance.snapshot ? '尚无快照；缺失已由结构完整性项提示。' : isStale(instance) ? '上游内容在确认后被修改：建议回 Stage 02 重新确认；可带警告发布，未决项随 open_questions 交付。' : '无 stale 标记。' },
  ];
  const pending = pendingMustConfirm(instance);
  const unsettled = instance.hypotheses.filter(item => item.status === 'proposed' || item.status === 'deferred').length;
  const flowing = derivedOpenQuestions(instance).length;
  const info: GateItem[] = [
    { id: 'must-confirm-pending', level: 'info', status: 'info', title: `must_confirm 待处理 ${pending} 项`, detail: `${pending} 项必确认澄清未收敛（answered / assumed 视为收敛）。仅提示，不阻断发布；未决口径以 open_questions 随包交付。` },
    { id: 'unsettled-hypotheses', level: 'info', status: 'info', title: '假设覆盖情况', detail: `${unsettled} 条 proposed / deferred 假设仅作待验证项引用，严禁混入已确认事实。` },
    { id: 'open-questions-flow', level: 'info', status: 'info', title: '零幻觉归集', detail: `${flowing} 条后置 / 未决项将自动流入 RAP open_questions。` },
    { id: 'sign-off', level: 'info', status: 'info', title: '复核签署', detail: '发布即当前本地用户签署，绑定内容指纹；业务复核备注为可选提示项。' },
  ];
  return { hard, warn, info, publishBlocked: hard.some(item => item.status === 'fail') };
}
