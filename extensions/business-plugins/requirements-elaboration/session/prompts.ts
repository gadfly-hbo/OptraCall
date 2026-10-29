import { RequirementFault, type ClarificationItem, type ClarificationPriority, type DataNeedPriority, type FrameworkDocument, type HypothesisItem, type RequirementInstance } from '../contract/validate.ts';

export type GenerationCall = 'elicit' | 'hypotheses' | 'framework';

const CATEGORIES = ['目标', '对象/人群', '时间窗口', '指标口径', '可用数据', '输出形式', '风险'];
const text = (value: unknown): string | undefined => typeof value === 'string' && value.trim() && value.length <= 20_000 ? value.trim() : undefined;
const list = (value: unknown): unknown[] => Array.isArray(value) ? value : [];

function contextBlock(instance: RequirementInstance): string {
  return [
    `需求名称：${instance.instance.title}`,
    `场景：${instance.instance.scene}`,
    `业务背景：${instance.context.background || '（未填写）'}`,
    `核心目标：${instance.context.goal || '（未填写）'}`,
    `决策场景：${instance.context.decisionScenario || '（未填写）'}`,
  ].join('\n');
}

/** Three model call points. Each embeds its full input context; the plugin owns state, the session is stateless per call. */
export function buildGenerationPrompt(call: GenerationCall, instance: RequirementInstance): string {
  const base = contextBlock(instance);
  if (call === 'elicit') {
    return `${base}

请基于以上业务诉求完成首轮推断，输出一个 JSON 代码块：
{
  "clarifications": [ { "category": "目标|对象/人群|时间窗口|指标口径|可用数据|输出形式|风险", "priority": "must_confirm|should_confirm|can_defer", "question": "……", "rationale": "为什么需要确认" } ],
  "facts": [ "从背景中明确可得的事实，没有则留空数组" ],
  "hypotheses": [ { "statement": "可证伪的推断假设", "evidence": "支持线索", "validationCondition": "怎样验证或证伪" } ]
}
要求：clarifications 5–10 条、覆盖至少 5 个不同 category，其中 must_confirm 至少 2 条；hypotheses 0–4 条且必须是可证伪的推断；你的推测不得写成事实。`;
  }
  if (call === 'hypotheses') {
    const existing = instance.hypotheses.map(item => `- ${item.id}（${item.status}）：${item.statement}`).join('\n') || '（暂无）';
    return `${base}

已确认事实：
${instance.facts.map(item => `- ${item}`).join('\n') || '（暂无）'}

已有假设（不要重复）：
${existing}

请补充 2–4 条新的可证伪假设，输出一个 JSON 代码块：
{ "hypotheses": [ { "statement": "……", "evidence": "支持线索", "validationCondition": "怎样验证或证伪" } ] }
要求：与已有假设不重复；每条都要有明确的证伪条件；不确定的内容放进证据或证伪条件的措辞里，不得写成事实。`;
  }
  const clarifications = instance.clarifications.map(item => `- [${item.priority}/${item.status}] ${item.category}：${item.question}${item.answer ? ` → 已答：${item.answer}` : ''}${item.status === 'assumed' && item.linkedHypothesisId ? `（按假设 ${item.linkedHypothesisId} 推进）` : ''}`).join('\n') || '（暂无）';
  const hypotheses = instance.hypotheses.map(item => `- ${item.id}（${item.status}）：${item.statement}｜证伪：${item.validationCondition || '未填写'}`).join('\n') || '（暂无）';
  return `${base}

澄清问答：
${clarifications}

已确认事实：
${instance.facts.map(item => `- ${item}`).join('\n') || '（暂无）'}

假设矩阵：
${hypotheses}

请严格基于以上已确认信息生成分析与报告框架，输出一个 JSON 代码块：
{
  "metrics": [ { "name": "指标名", "definition": "计算口径", "dimensions": ["观察维度"], "source": "口径来源说明" } ],
  "dataNeeds": [ { "table": "表或数据主题名", "fields": ["字段"], "priority": "P0|P1|P2", "purpose": "用途" } ],
  "analysisPaths": [ { "question": "业务子问题", "hypothesis": "引用假设 id 如 hyp-1", "method": "验证方法", "requiredData": ["引用表名"], "expectedOutput": "预期产物" } ],
  "reportFramework": [ { "section": "报告章节", "purpose": "章节目的", "keyQuestions": ["要回答的问题"], "evidence": ["所需证据"], "zeroHallucinationCheck": "该章节的零幻觉底线" } ],
  "openQuestions": [ "尚未确认、必须在报告中保留为待决的问题" ],
  "risks": [ "分析风险或混杂因素" ]
}
要求：analysisPaths.hypothesis 只能引用上面出现过的假设 id，requiredData 只能引用 dataNeeds 里出现过的表；deferred / proposed 的假设与未回答的澄清不得当作事实使用，其影响写入 open_questions 或 risks；reportFramework 每个章节必须给出 zeroHallucinationCheck。`;
}

/** Extracts the single JSON payload from a model reply: fenced block first, then balanced objects from the end. */
export function parseModelJson(reply: string): unknown {
  const trimmed = reply.trim();
  const candidates: string[] = [];
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(trimmed);
  if (fenced?.[1]) candidates.push(fenced[1].trim());
  const opens: number[] = [];
  for (let cursor = trimmed.length - 1; cursor >= 0 && opens.length < 64; cursor--) if (trimmed[cursor] === '{') opens.push(cursor);
  for (const index of opens) {
    let depth = 0, inString = false, escaped = false;
    for (let cursor = index; cursor < trimmed.length; cursor++) {
      const char = trimmed[cursor]!;
      if (inString) {
        if (escaped) escaped = false;
        else if (char === '\\') escaped = true;
        else if (char === '"') inString = false;
        continue;
      }
      if (char === '"') inString = true;
      else if (char === '{') depth++;
      else if (char === '}') { depth--; if (depth === 0) { candidates.push(trimmed.slice(index, cursor + 1)); break; } }
    }
  }
  for (const candidate of candidates) {
    try { return JSON.parse(candidate); } catch { /* try the next candidate */ }
  }
  throw new RequirementFault('REQ_MODEL_OUTPUT_INVALID');
}

const nextSequence = (prefix: string, instance: RequirementInstance): number => {
  const used = [...instance.clarifications, ...instance.hypotheses]
    .map(item => item.id).filter(id => id.startsWith(prefix + '-'))
    .map(id => Number(id.split('-')[1])).reduce((max, value) => Math.max(max, value), 0);
  return Number.isFinite(used) ? used + 1 : 1;
};

export type ElicitProposal = { clarifications: ClarificationItem[]; facts: string[]; hypotheses: HypothesisItem[]; dropped: number };
export type HypothesesProposal = { hypotheses: HypothesisItem[]; dropped: number };
export type FrameworkProposal = { framework: FrameworkDocument; dropped: number };

const PRIORITIES: readonly ClarificationPriority[] = ['must_confirm', 'should_confirm', 'can_defer'];
const DATA_PRIORITIES: readonly DataNeedPriority[] = ['P0', 'P1', 'P2'];

/** Model output is a proposal only: invalid entries are dropped (counted), never silently coerced into facts. */
export function normalizeElicit(parsed: unknown, instance: RequirementInstance): ElicitProposal {
  const root = parsed as Record<string, unknown> | null;
  if (!root || typeof root !== 'object') throw new RequirementFault('REQ_MODEL_OUTPUT_INVALID');
  let clr = nextSequence('clr', instance), hyp = nextSequence('hyp', instance), dropped = 0;
  const clarifications: ClarificationItem[] = [];
  for (const raw of list(root.clarifications).slice(0, 20)) {
    const item = raw as Record<string, unknown>;
    const category = CATEGORIES.includes(String(item?.category)) ? String(item.category) : undefined;
    const priority = PRIORITIES.includes(item?.priority as ClarificationPriority) ? item!.priority as ClarificationPriority : undefined;
    const question = text(item?.question), rationale = text(item?.rationale) ?? '';
    if (!category || !priority || !question) { dropped++; continue; }
    clarifications.push({ id: `clr-${clr++}`, category, priority, question, rationale, status: 'pending' });
  }
  const facts = list(root.facts).slice(0, 20).map(item => text(item)).filter((item): item is string => Boolean(item));
  const hypotheses: HypothesisItem[] = [];
  for (const raw of list(root.hypotheses).slice(0, 10)) {
    const item = raw as Record<string, unknown>;
    const statement = text(item?.statement);
    if (!statement) { dropped++; continue; }
    hypotheses.push({ id: `hyp-${hyp++}`, statement, evidence: text(item?.evidence) ?? '', validationCondition: text(item?.validationCondition) ?? '', status: 'proposed' });
  }
  if (!clarifications.length && !hypotheses.length) throw new RequirementFault('REQ_MODEL_OUTPUT_INVALID');
  return { clarifications, facts, hypotheses, dropped };
}

export function normalizeHypotheses(parsed: unknown, instance: RequirementInstance): HypothesesProposal {
  const root = parsed as Record<string, unknown> | null;
  if (!root || typeof root !== 'object') throw new RequirementFault('REQ_MODEL_OUTPUT_INVALID');
  let hyp = nextSequence('hyp', instance), dropped = 0;
  const existing = new Set(instance.hypotheses.map(item => item.statement));
  const hypotheses: HypothesisItem[] = [];
  for (const raw of list(root.hypotheses).slice(0, 10)) {
    const item = raw as Record<string, unknown>;
    const statement = text(item?.statement);
    if (!statement || existing.has(statement)) { dropped++; continue; }
    existing.add(statement);
    hypotheses.push({ id: `hyp-${hyp++}`, statement, evidence: text(item?.evidence) ?? '', validationCondition: text(item?.validationCondition) ?? '', status: 'proposed' });
  }
  if (!hypotheses.length) throw new RequirementFault('REQ_MODEL_OUTPUT_INVALID');
  return { hypotheses, dropped };
}

export function normalizeFramework(parsed: unknown): FrameworkProposal {
  const root = parsed as Record<string, unknown> | null;
  if (!root || typeof root !== 'object') throw new RequirementFault('REQ_MODEL_OUTPUT_INVALID');
  let dropped = 0;
  const metrics = list(root.metrics).slice(0, 40).map(item => item as Record<string, unknown>).filter(item => {
    if (!text(item?.name) || !text(item?.definition)) { dropped++; return false; }
    return true;
  }).map(item => ({ name: text(item.name)!, definition: text(item.definition)!, dimensions: list(item.dimensions).map(dimension => text(dimension)).filter((x): x is string => Boolean(x)), source: text(item.source) ?? '模型生成' }));
  const dataNeeds = list(root.dataNeeds).slice(0, 40).map(item => item as Record<string, unknown>).filter(item => {
    if (!text(item?.table) || !DATA_PRIORITIES.includes(item?.priority as DataNeedPriority)) { dropped++; return false; }
    return true;
  }).map(item => ({ table: text(item.table)!, fields: list(item.fields).map(field => text(field)).filter((x): x is string => Boolean(x)), priority: item.priority as DataNeedPriority, purpose: text(item.purpose) ?? '' }));
  const tables = new Set(dataNeeds.map(item => item.table));
  const analysisPaths = list(root.analysisPaths).slice(0, 40).map(item => item as Record<string, unknown>).filter(item => {
    const hypothesis = text(item?.hypothesis), question = text(item?.question);
    const required = list(item?.requiredData).every(table => tables.has(String(table)));
    if (!hypothesis || !question || !required) { dropped++; return false; }
    return true;
  }).map(item => ({ question: text(item.question)!, hypothesis: text(item.hypothesis)!, method: text(item.method) ?? '', requiredData: list(item.requiredData).map(table => String(table)), expectedOutput: text(item.expectedOutput) ?? '' }));
  const reportFramework = list(root.reportFramework).slice(0, 40).map(item => item as Record<string, unknown>).filter(item => {
    if (!text(item?.section) || !text(item?.zeroHallucinationCheck)) { dropped++; return false; }
    return true;
  }).map(item => ({ section: text(item.section)!, purpose: text(item.purpose) ?? '', keyQuestions: list(item.keyQuestions).map(question => text(question)).filter((x): x is string => Boolean(x)), evidence: list(item.evidence).map(entry => text(entry)).filter((x): x is string => Boolean(x)), zeroHallucinationCheck: text(item.zeroHallucinationCheck)! }));
  const openQuestions = list(root.openQuestions).slice(0, 40).map(item => text(item)).filter((x): x is string => Boolean(x));
  const risks = list(root.risks).slice(0, 40).map(item => text(item)).filter((x): x is string => Boolean(x));
  if (!metrics.length || !dataNeeds.length || !analysisPaths.length || !reportFramework.length) throw new RequirementFault('REQ_MODEL_OUTPUT_INVALID');
  return { framework: { metrics, dataNeeds, analysisPaths, reportFramework, openQuestions, risks }, dropped };
}
