import type { ClientTask } from './project-types.ts';
import type { PersonalContextChoice } from './PersonalContextControls.tsx';
export type ComparisonGroup = 'baseline' | 'memory' | 'method' | 'combined';
export const comparisonGroupNames: Record<ComparisonGroup, string> = { baseline: '现有基线', memory: '仅记忆', method: '仅方法', combined: '组合' };
export type ComparisonDraftInput = { group: ComparisonGroup; question: string; materials: string; method: string; reportPath: string };
/** This is an editable ordinary-task prompt, not an execution plan or an evaluation record. */
export function comparisonTaskDraft(input: ComparisonDraftInput, task: ClientTask, personal: PersonalContextChoice[]): string {
  const memory = input.group === 'memory' || input.group === 'combined';
  const method = input.group === 'method' || input.group === 'combined';
  return `# 可选增量验证 · ${comparisonGroupNames[input.group]}\n\n## 共同代表问题\n${input.question.trim()}\n\n## 共同材料与条件\n${input.materials.trim() || '尚未核定共同材料的准确版本；先核对，不以同名文件代替。'}\n各组的问题、基础材料、权限与预算尽量保持相同。沿原普通任务自主选择方法与工具。\n当前继承配置：${task.configuration.name} / ${task.configuration.model}，配置修订 ${task.configuration.revision}。实际 Provider、协议、线路、reasoning／thinking、上下文及输出限制须按运行时核对，名称相同不代表等价。\n\n## 本组差异\n${memory ? `额外经验候选／个人资料（准确身份供核对，尚未证明实际提供或引用）：\n${personal.map(item => `${item.title}\n${JSON.stringify(item.selection)}`).join('\n\n')}` : '本组不额外指定候选记忆。普通工具仍可自主使用；新任务不保证工作区、skills或检索中没有候选答案。'}\n${method ? `额外方法参考（不自动安装，不强制执行）：\n${input.method.trim()}` : '本组没有新增方法资产。'}\n\n## 原报告约定\n如形成报告，请另存新稿到 ${input.reportPath.trim() || '060_reports/增量验证报告.md'}，保留原首次结果。列明实际任务／native／固定成果、输入与配置差异、首次／重复／取消／失败／UNKNOWN、事实错误与反证修订、维护负担、耗时及费用来源。成本未知保留未知，不填0；SDK估计、用量与供应商结算分别表达。\n核对基线是否接触候选答案；配置不同、材料或权限不同、候选暴露无法核实时写“不可归因／待验证”。改善、无增益、退化与局限均保留，不据存入、引用次数或自评宣称成熟。\n\n此草稿尚未发送；没有自动运行其他组，也没有评估分数。`;
}
