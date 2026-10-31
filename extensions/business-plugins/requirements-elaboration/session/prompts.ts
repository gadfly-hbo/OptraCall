import { isStale, RequirementFault, type ClarificationItem, type ClarificationPriority, type DataNeedPriority, type FrameworkDocument, type HypothesisItem, type RequirementInstance } from '../contract/validate.ts';

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
    `输入状态：${!instance.snapshot ? '当前工作稿尚未确认' : isStale(instance) ? '确认快照已过期，以下使用当前工作稿，不沿用旧确认' : '当前上游信息已有有效确认快照'}；本次模型输出仍为待用户采纳的草稿，不等于正式确认或发布。`,
    '仅对影响本次决策的业务含义核对单位、对象粒度、分母、去重、退款或取消、时间归属及来源；已有明确共识直接复用，不重复凑问题。缺失内容保留未知，来源冲突并列保留并澄清，不自行写成已确认口径。',
    '分析路径只是可调整的建议，由分析 Agent 按问题和数据自主选方法；不要编排必须执行的固定计算步骤。',
  ].join('\n');
}

/** Three model call points. The plugin owns business state; each generation supplies its full current input. */
export function buildGenerationPrompt(call: GenerationCall, instance: RequirementInstance): string {
  const base = contextBlock(instance);
  const clarifications = instance.clarifications.map(item => `- ${item.id} [${item.priority}/${item.status}] ${item.category}：${item.question}${item.answer ? ` → 回答：${item.answer}` : ''}${item.status === 'assumed' && item.linkedHypothesisId ? `（按假设 ${item.linkedHypothesisId} 推进）` : ''}`).join('\n') || '（暂无）';
  const facts = instance.facts.map(item => `- ${item}`).join('\n') || '（暂无）';
  if (call === 'elicit') {
    return `${base}

当前澄清及回答（不要重复询问已解决的问题）：
${clarifications}

当前工作稿记录的事实：
${facts}

请基于以上业务诉求完成首轮推断，输出一个 JSON 代码块：
{
  "clarifications": [ { "category": "目标|对象/人群|时间窗口|指标口径|可用数据|输出形式|风险", "priority": "must_confirm|should_confirm|can_defer", "question": "……", "rationale": "为什么需要确认" } ],
  "facts": [ "从背景中明确可得的事实，没有则留空数组" ],
  "hypotheses": [ { "statement": "可证伪的推断假设", "evidence": "支持线索", "validationCondition": "怎样验证或证伪" } ],
  "noChangeReason": "若无需新增澄清和假设，用简短原因说明；有新增时可省略此字段"
}
要求：只提出会影响本次任务的真实信息缺口，不设最低数量或分类覆盖配额；已有信息足够时 clarifications 与 hypotheses 均可为空，并填写 noChangeReason。三个数组字段必须完整给出；假设必须可证伪，不适用假设的描述性任务无需编造假设；你的推测不得写成事实。`;
  }
  if (call === 'hypotheses') {
    const existing = instance.hypotheses.map(item => `- ${item.id}（${item.status}）：${item.statement}`).join('\n') || '（暂无）';
    return `${base}

当前工作稿记录的事实：
${facts}

已有假设（不要重复）：
${existing}

请按本次任务实际需要补充新的可证伪假设，输出一个 JSON 代码块：
{ "hypotheses": [ { "statement": "……", "evidence": "支持线索", "validationCondition": "怎样验证或证伪" } ], "noChangeReason": "无需新增时填写原因；有新增时可省略" }
要求：不设最低数量，与已有假设不重复；没有必要新增或本次为描述性任务时返回 hypotheses: [] 并填写 noChangeReason。每条新增假设都要有明确的证伪条件；不确定的内容放进证据或证伪条件的措辞里，不得写成事实。`;
  }
  const hypotheses = instance.hypotheses.map(item => `- ${item.id}（${item.status}）：${item.statement}｜证伪：${item.validationCondition || '未填写'}`).join('\n') || '（暂无）';
  return `${base}

澄清问答：
${clarifications}

当前工作稿记录的事实（结合上方输入状态区分是否已确认）：
${facts}

假设矩阵：
${hypotheses}

请基于以上当前工作稿生成未确认的分析与报告框架草稿，输出一个 JSON 代码块：
{
  "metrics": [ { "name": "指标名", "definition": "计算口径", "dimensions": ["观察维度"], "source": "口径来源说明" } ],
  "dataNeeds": [ { "table": "表或数据主题名", "fields": ["字段"], "priority": "P0|P1|P2", "purpose": "用途" } ],
  "analysisPaths": [ { "question": "业务子问题", "hypothesis": "引用假设 id 如 hyp-1", "method": "验证方法", "requiredData": ["引用表名"], "expectedOutput": "预期产物" } ],
  "reportFramework": [ { "section": "报告章节", "purpose": "章节目的", "keyQuestions": ["要回答的问题"], "evidence": ["所需证据"], "zeroHallucinationCheck": "该章节的零幻觉底线" } ],
  "openQuestions": [ "尚未确认、必须在报告中保留为待决的问题" ],
  "risks": [ "分析风险或混杂因素" ]
}
要求：六个数组字段必须齐全。探索草稿中尚无可靠内容的组可留空数组，并在 openQuestions 或 risks 明确缺口；不要为了凑齐指标、数据或分析路径而编造内容。描述性子问题不需要假设时，analysisPaths.hypothesis 明确写空字符串 ""；非空时只能引用上面出现过的假设 id，requiredData 只能引用 dataNeeds 里出现过的表。未确认的工作稿内容、deferred / proposed 的假设与未回答的澄清不得当作已确认事实使用，其影响写入 openQuestions 或 risks；reportFramework 每个章节必须给出 zeroHallucinationCheck。`;
}

/** Keeps a complete JSON payload intact, then tolerates a code fence or surrounding prose. */
export function parseModelJson(reply: string): unknown {
  const trimmed = reply.trim();
  const candidates: string[] = [trimmed];
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

export type ElicitProposal = { clarifications: ClarificationItem[]; facts: string[]; hypotheses: HypothesisItem[]; dropped: number; noChangeReason?: string };
export type HypothesesProposal = { hypotheses: HypothesisItem[]; dropped: number; noChangeReason?: string };
export type FrameworkProposal = { framework: FrameworkDocument; dropped: number };

const PRIORITIES: readonly ClarificationPriority[] = ['must_confirm', 'should_confirm', 'can_defer'];
const DATA_PRIORITIES: readonly DataNeedPriority[] = ['P0', 'P1', 'P2'];

function outputWithArrays(parsed: unknown, fields: readonly string[]): Record<string, unknown> {
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new RequirementFault('REQ_MODEL_OUTPUT_INVALID', 'root');
  const root = parsed as Record<string, unknown>;
  for (const field of fields) if (!Array.isArray(root[field])) throw new RequirementFault('REQ_MODEL_OUTPUT_INVALID', field);
  return root;
}

/** Model output is a proposal only: invalid entries are dropped (counted), never silently coerced into facts. */
export function normalizeElicit(parsed: unknown, instance: RequirementInstance): ElicitProposal {
  const root = outputWithArrays(parsed, ['clarifications', 'facts', 'hypotheses']);
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
  const facts: string[] = [];
  for (const raw of list(root.facts).slice(0, 20)) {
    const fact = text(raw);
    if (!fact) { dropped++; continue; }
    facts.push(fact);
  }
  const hypotheses: HypothesisItem[] = [];
  for (const raw of list(root.hypotheses).slice(0, 10)) {
    const item = raw as Record<string, unknown>;
    const statement = text(item?.statement);
    if (!statement) { dropped++; continue; }
    hypotheses.push({ id: `hyp-${hyp++}`, statement, evidence: text(item?.evidence) ?? '', validationCondition: text(item?.validationCondition) ?? '', status: 'proposed' });
  }
  const noChangeReason = text(root.noChangeReason);
  if (!clarifications.length && !hypotheses.length) {
    if (list(root.clarifications).length) throw new RequirementFault('REQ_MODEL_OUTPUT_INVALID', 'clarifications');
    if (list(root.hypotheses).length) throw new RequirementFault('REQ_MODEL_OUTPUT_INVALID', 'hypotheses');
    if (list(root.facts).length && !facts.length) throw new RequirementFault('REQ_MODEL_OUTPUT_INVALID', 'facts');
    if (!noChangeReason) throw new RequirementFault('REQ_MODEL_OUTPUT_INVALID', 'noChangeReason');
  }
  return { clarifications, facts, hypotheses, dropped, ...(noChangeReason ? { noChangeReason } : {}) };
}

export function normalizeHypotheses(parsed: unknown, instance: RequirementInstance): HypothesesProposal {
  const root = outputWithArrays(parsed, ['hypotheses']);
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
  const noChangeReason = text(root.noChangeReason);
  if (!hypotheses.length) {
    if (list(root.hypotheses).length) throw new RequirementFault('REQ_MODEL_OUTPUT_INVALID', 'hypotheses');
    if (!noChangeReason) throw new RequirementFault('REQ_MODEL_OUTPUT_INVALID', 'noChangeReason');
  }
  return { hypotheses, dropped, ...(noChangeReason ? { noChangeReason } : {}) };
}

export function normalizeFramework(parsed: unknown, instance?: RequirementInstance): FrameworkProposal {
  const root = outputWithArrays(parsed, ['metrics', 'dataNeeds', 'analysisPaths', 'reportFramework', 'openQuestions', 'risks']);
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
  const hypotheses = instance ? new Set(instance.hypotheses.map(item => item.id)) : undefined;
  const analysisPaths = list(root.analysisPaths).slice(0, 40).map(item => item as Record<string, unknown>).filter(item => {
    const hypothesis = item?.hypothesis === '' ? '' : text(item?.hypothesis), question = text(item?.question);
    const required = Array.isArray(item?.requiredData) && item.requiredData.every(table => tables.has(String(table)));
    if (hypothesis === undefined || (hypothesis !== '' && hypotheses && !hypotheses.has(hypothesis)) || !question || !required) { dropped++; return false; }
    return true;
  }).map(item => ({ question: text(item.question)!, hypothesis: item.hypothesis === '' ? '' : text(item.hypothesis)!, method: text(item.method) ?? '', requiredData: list(item.requiredData).map(table => String(table)), expectedOutput: text(item.expectedOutput) ?? '' }));
  const reportFramework = list(root.reportFramework).slice(0, 40).map(item => item as Record<string, unknown>).filter(item => {
    if (!text(item?.section) || !text(item?.zeroHallucinationCheck)) { dropped++; return false; }
    return true;
  }).map(item => ({ section: text(item.section)!, purpose: text(item.purpose) ?? '', keyQuestions: list(item.keyQuestions).map(question => text(question)).filter((x): x is string => Boolean(x)), evidence: list(item.evidence).map(entry => text(entry)).filter((x): x is string => Boolean(x)), zeroHallucinationCheck: text(item.zeroHallucinationCheck)! }));
  const openQuestions = list(root.openQuestions).slice(0, 40).map(item => text(item)).filter((x): x is string => Boolean(x));
  const risks = list(root.risks).slice(0, 40).map(item => text(item)).filter((x): x is string => Boolean(x));
  for (const [field, accepted] of [['metrics', metrics], ['dataNeeds', dataNeeds], ['analysisPaths', analysisPaths], ['reportFramework', reportFramework]] as const) {
    if (list(root[field]).length && !accepted.length) throw new RequirementFault('REQ_MODEL_OUTPUT_INVALID', field);
  }
  if (!metrics.length && !dataNeeds.length && !analysisPaths.length && !reportFramework.length && !openQuestions.length && !risks.length) throw new RequirementFault('REQ_MODEL_OUTPUT_INVALID', 'framework');
  return { framework: { metrics, dataNeeds, analysisPaths, reportFramework, openQuestions, risks }, dropped };
}
