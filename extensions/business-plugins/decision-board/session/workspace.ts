import path from 'node:path';

export const boardSystemPrompt = [
  '你是 OptraCall 决策看板的建议抽取器。你的唯一任务：从给定分析报告原文中，抽取面向业务决策的“建议行动项”。',
  '你没有数据访问工具，不要假装读取过报告以外的数据；不要新增事实、数字或结论，所有依据必须来自报告原文。',
  '每条建议包含：title（不超过120字的行动标题）、rationale（为什么值得做，依据报告内容）、expectedImpact（预期效果；报告未提及则留空字符串）、priority（high/medium/low）、effort（报告提到的投入；未提及则留空字符串）。',
  'evidence 字段：level 为四级之一——数据支撑（报告中有明确数据结论）、多源佐证（报告内多处内容相互印证）、逻辑推断（由报告内容推导）、经验假设（报告作者的经验判断）；reasoning 为推导说明；facts 为数组，每条含 text（事实概述）和 quote（报告原文逐字引用；必须逐字复制报告原文，禁止改写、拼接或编造；报告无原文可引用时省略 quote）。',
  '只输出一个 ```json 围栏代码块，内容为 JSON 数组，每项含 title、rationale、expectedImpact、priority、effort、evidence；不要输出围栏外的任何文字；全部使用中文；最多 20 条，宁缺毋滥，没有可靠建议时输出 []。',
];

export function boardWorkspace(extractionDirectory: string): { cwd: string; systemPrompt: string[]; defaultTools: readonly string[]; capabilityPolicy: 'text-only' } {
  return { cwd: path.join(extractionDirectory, 'workspace'), systemPrompt: [...boardSystemPrompt], defaultTools: [], capabilityPolicy: 'text-only' };
}

export function boardSessionDirectory(extractionDirectory: string): string {
  return path.join(extractionDirectory, 'sessions');
}

export const MAX_REPORT_CHARS = 20_000;
export type StagedReport = { text: string; chars: number; truncated: boolean };

/** Decodes the report strictly as UTF-8 and bounds what the model receives. */
export function stageReportText(bytes: Buffer): StagedReport | null {
  let text: string;
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { return null; }
  const chars = [...text].length;
  if (chars <= MAX_REPORT_CHARS) return { text, chars, truncated: false };
  return { text: [...text].slice(0, MAX_REPORT_CHARS).join(''), chars, truncated: true };
}

export function buildExtractionPrompt(input: { projectName: string; reportPath: string; staged: StagedReport }): string {
  return [
    '从以下分析报告中抽取决策建议行动项。',
    '',
    `项目：${input.projectName}`,
    `报告文件：${input.reportPath}${input.staged.truncated ? `（报告超长，以下为前 ${MAX_REPORT_CHARS} 字符截断）` : ''}`,
    '',
    '报告原文：',
    '"""',
    input.staged.text,
    '"""',
    '',
    '按系统说明输出恰好一个 ```json 围栏代码块。',
  ].join('\n');
}

import type { NormalizedItem } from '../types.ts';

/** The quote field promises a verbatim report citation. Model output is verified
 * here: anything not found verbatim in the staged report is dropped rather than
 * presented as an original quotation. */
export function enforceVerbatimQuotes(items: NormalizedItem[], reportText: string): { items: NormalizedItem[]; stripped: number } {
  let stripped = 0;
  const verified = items.map(entry => {
    const facts = entry.evidence.facts.map(fact => {
      if (fact.quote === undefined || reportText.includes(fact.quote)) return fact;
      stripped++;
      return { text: fact.text };
    });
    return { ...entry, evidence: { ...entry.evidence, facts } };
  });
  return { items: verified, stripped };
}
