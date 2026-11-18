import type { StudioSourceRef } from './contracts.ts';

/** A projection of the source body, never a second independently editable model. */
export interface FoundationIssue { code: string; path: string; detail: string }
export type FoundationItemKind = 'entity' | 'attribute' | 'key' | 'value-domain' | 'event' | 'rule' | 'dimension' | 'time' | 'concept';
export interface FoundationItem {
  itemId: string; kind: FoundationItemKind; definition: string; sourceRef: StudioSourceRef;
  name?: string; grain?: string; valueType?: string; parentItemId?: string;
  scope?: string; validFrom?: string; validTo?: string; evidenceNature?: string;
}
export interface FoundationItemRef { sourceRef: StudioSourceRef; itemId: string }
export interface FoundationMetricRef { sourceRef: StudioSourceRef; metricName: string; scenario?: string }
export interface FoundationMetricLink {
  metricRef: FoundationMetricRef; entityItemIds?: string[]; eventItemIds?: string[]; ruleItemIds?: string[]; timeItemIds?: string[];
  dimensions?: { name: string; itemId: string }[]; bindingRef?: StudioSourceRef;
}
export type FoundationTarget = { kind: 'item'; itemId: string } | { kind: 'external-item'; itemRef: FoundationItemRef } | { kind: 'metric'; metricRef: FoundationMetricRef };
export interface FoundationRelation {
  relationId: string; type: 'catalog' | 'formula-dependency' | 'statistical-decomposition' | 'analysis-use' | 'domain';
  from: FoundationTarget; to: FoundationTarget; evidenceRefs: StudioSourceRef[];
  scope?: string; validFrom?: string; validTo?: string; detail?: string; role?: string;
  mutuallyExclusive?: boolean; complete?: boolean; additive?: boolean;
}
export interface FoundationAdaptation {
  referenceRef?: FoundationItemRef; targetItemId?: string; action: 'adopt' | 'modify' | 'exclude' | 'add' | 'pending';
  reason: string; evidenceRefs: StudioSourceRef[];
}
export interface FoundationBindingLink {
  sourceRef: StudioSourceRef; field: string; itemId: string; grain: string; detail: string; evidenceRefs: StudioSourceRef[];
}
export type FoundationReadinessKey = 'definition' | 'mapping' | 'computation' | 'use';
export interface FoundationReadiness { status: 'pass' | 'fail' | 'unknown' | 'pending'; detail: string; evidenceRefs: StudioSourceRef[]; scope?: string }
export interface FoundationExecutionRule { ruleId: string; ruleItemId: string; conditions: string[]; conclusion: string }
export interface FoundationExecutionPredicate {
  predicate: string; namespace: string; itemId: string;
  arguments: { name: string; itemId: string; valueType: string }[];
}
/** Requirements describe approved inputs; they do not assert independent fact verification. */
export interface FoundationFactRequirement {
  requirementId: string; predicate: string; sourceRef: StudioSourceRef; bindingRef: StudioSourceRef; fields: string[];
  grain: string; unit: string; timeBasis: string; coverage: string;
  kind: 'observed' | 'external-computation'; calculationRefs?: StudioSourceRef[];
}
export interface FoundationRuleExecution {
  contractVersion: 'studio-rule-execution/1'; engine: { name: 'semantica'; version: '0.7.0' };
  rules: FoundationExecutionRule[]; predicates: FoundationExecutionPredicate[]; factRequirements: FoundationFactRequirement[];
  constraints?: { format: 'shacl-turtle'; shapes: string; sourceRefs: StudioSourceRef[] };
}
export interface FoundationContent {
  contentProfile: 'studio-foundation/1' | 'studio-foundation/2'; items: FoundationItem[]; scope?: string;
  metricLinks?: FoundationMetricLink[]; relations?: FoundationRelation[]; adaptations?: FoundationAdaptation[];
  bindingLinks?: FoundationBindingLink[]; readiness?: Partial<Record<FoundationReadinessKey, FoundationReadiness>>;
  ruleExecution?: FoundationRuleExecution;
}
export interface FoundationParseResult { kind: 'legacy' | 'unsupported' | 'invalid' | 'supported'; profile?: FoundationContent; issues: FoundationIssue[] }

const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const refIdentity = (ref: StudioSourceRef) => JSON.stringify([ref.authority, ref.id, ref.version, ref.sha256 ?? null, ref.projectId ?? null, ref.taskId ?? null, ref.locator ?? null]);

/** Probe malformed JSON only for a root object property; prose and nested examples remain legacy. */
function declaresRootProfile(body: string): boolean {
  const input = body.trimStart();
  if (!input.startsWith('{')) return false;
  let depth = 0, previous = '';
  for (let index = 0; index < input.length; index++) {
    const char = input[index];
    if (char === '"') {
      const start = index;
      for (index++; index < input.length; index++) {
        if (input[index] === '\\') index++;
        else if (input[index] === '"') break;
      }
      if (depth === 1 && (previous === '{' || previous === ',') && input.slice(index + 1).trimStart().startsWith(':')) {
        try { if (JSON.parse(input.slice(start, index + 1)) === 'contentProfile') return true; } catch { /* An incomplete quoted token is not a declared property. */ }
      }
      previous = '"'; continue;
    }
    if (char === '{' || char === '[') depth++;
    else if (char === '}' || char === ']') depth--;
    if (depth === 0) return false;
    if (!/\s/.test(char)) previous = char;
  }
  return false;
}

class ContentValidator {
  readonly issues: FoundationIssue[] = [];
  issue(code: string, path: string, detail: string) { this.issues.push({ code, path, detail }); }
  object(value: unknown, path: string, fields: string[]): value is Record<string, unknown> {
    if (!record(value)) { this.issue('required_object', path, '需要对象'); return false; }
    for (const key of Object.keys(value)) if (!fields.includes(key)) this.issue('unknown_field', `${path}.${key}`, '该内容约定不支持此字段，不能隐藏另一份定义或来源');
    return true;
  }
  text(value: unknown, path: string, optional = false, limit = 20_000) {
    if (optional && value === undefined) return;
    if (typeof value !== 'string' || !value.trim() || new TextEncoder().encode(value).length > limit || value.includes('\0')) this.issue('required_text', path, '需要非空且有界的文本');
  }
  choice(value: unknown, path: string, choices: string[]) {
    if (typeof value !== 'string' || !choices.includes(value)) this.issue('unknown_type', path, `支持的类型：${choices.join('、')}`);
  }
  array(value: unknown, path: string, optional: boolean, visit: (item: unknown, path: string) => void) {
    if (optional && value === undefined) return;
    if (!Array.isArray(value) || value.length > 2000) { this.issue('required_array', path, '需要条目数不超过2000的数组'); return; }
    value.forEach((item, index) => visit(item, `${path}[${index}]`));
  }
  ref(value: unknown, path: string, authority?: StudioSourceRef['authority']) {
    if (!this.object(value, path, ['authority', 'id', 'version', 'title', 'sha256', 'projectId', 'taskId', 'locator'])) return;
    this.choice(value.authority, `${path}.authority`, authority ? [authority] : ['enterprise', 'rap', 'data', 'sap-metric', 'sap-method', 'studio-source', 'task', 'case']);
    this.text(value.id, `${path}.id`, false, 1000); this.text(value.version, `${path}.version`, false, 200);
    for (const key of ['title', 'projectId', 'taskId', 'locator']) this.text(value[key], `${path}.${key}`, true, 2000);
    if (value.sha256 !== undefined && (typeof value.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(value.sha256))) this.issue('invalid_hash', `${path}.sha256`, '需要准确的SHA-256');
  }
  refs(value: unknown, path: string) { this.array(value, path, false, (ref, at) => this.ref(ref, at)); }
  itemRef(value: unknown, path: string) {
    if (!this.object(value, path, ['sourceRef', 'itemId'])) return;
    this.ref(value.sourceRef, `${path}.sourceRef`); this.text(value.itemId, `${path}.itemId`);
  }
  metricRef(value: unknown, path: string) {
    if (!this.object(value, path, ['sourceRef', 'metricName', 'scenario'])) return;
    this.ref(value.sourceRef, `${path}.sourceRef`, 'sap-metric'); this.text(value.metricName, `${path}.metricName`); this.text(value.scenario, `${path}.scenario`, true);
  }
  period(value: Record<string, unknown>, path: string) {
    for (const key of ['scope', 'validFrom', 'validTo']) this.text(value[key], `${path}.${key}`, true);
    for (const key of ['validFrom', 'validTo']) if (value[key] !== undefined && (typeof value[key] !== 'string' || !Number.isFinite(Date.parse(value[key] as string)))) this.issue('invalid_time', `${path}.${key}`, '需要可解析的生效时间');
    if (typeof value.validFrom === 'string' && typeof value.validTo === 'string' && Date.parse(value.validFrom) > Date.parse(value.validTo)) this.issue('invalid_period', path, '生效起点不能晚于终点');
  }
  local(value: unknown, path: string, items: Map<string, FoundationItem>, kinds?: FoundationItemKind[]) {
    this.text(value, path);
    if (typeof value !== 'string') return;
    const item = items.get(value);
    if (!item) this.issue('missing_item', path, '引用的本地条目不存在');
    else if (kinds && !kinds.includes(item.kind)) this.issue('item_type_mismatch', path, '引用条目的类型与该关联不相符');
  }
  target(value: unknown, path: string, items: Map<string, FoundationItem>) {
    if (!record(value)) { this.issue('required_target', path, '需要带类型的关联端点'); return; }
    if (value.kind === 'item') { this.object(value, path, ['kind', 'itemId']); this.local(value.itemId, `${path}.itemId`, items); }
    else if (value.kind === 'external-item') { this.object(value, path, ['kind', 'itemRef']); this.itemRef(value.itemRef, `${path}.itemRef`); }
    else if (value.kind === 'metric') { this.object(value, path, ['kind', 'metricRef']); this.metricRef(value.metricRef, `${path}.metricRef`); }
    else this.issue('unknown_target_type', `${path}.kind`, '端点需要为本地项、准确外部项或SAP指标引用');
  }
  execution(value: unknown, path: string, items: Map<string, FoundationItem>) {
    if (!this.object(value, path, ['contractVersion', 'engine', 'rules', 'predicates', 'factRequirements', 'constraints'])) return;
    this.choice(value.contractVersion, `${path}.contractVersion`, ['studio-rule-execution/1']);
    if (this.object(value.engine, `${path}.engine`, ['name', 'version'])) {
      this.choice(value.engine.name, `${path}.engine.name`, ['semantica']); this.choice(value.engine.version, `${path}.engine.version`, ['0.7.0']);
    }
    const ruleIds = new Set<unknown>(), predicates = new Set<unknown>(), requirements = new Set<unknown>();
    this.array(value.rules, `${path}.rules`, false, (rule, at) => {
      if (!this.object(rule, at, ['ruleId', 'ruleItemId', 'conditions', 'conclusion'])) return;
      this.text(rule.ruleId, `${at}.ruleId`); this.local(rule.ruleItemId, `${at}.ruleItemId`, items, ['rule']);
      if (ruleIds.has(rule.ruleId)) this.issue('duplicate_rule', `${at}.ruleId`, '执行规则标识重复'); ruleIds.add(rule.ruleId);
      this.array(rule.conditions, `${at}.conditions`, false, (condition, at) => this.text(condition, at)); this.text(rule.conclusion, `${at}.conclusion`);
      if (Array.isArray(rule.conditions) && !rule.conditions.length) this.issue('required_conditions', `${at}.conditions`, '首批执行规则需要明确的正向条件');
    });
    this.array(value.predicates, `${path}.predicates`, false, (predicate, at) => {
      if (!this.object(predicate, at, ['predicate', 'namespace', 'itemId', 'arguments'])) return;
      this.text(predicate.predicate, `${at}.predicate`); this.text(predicate.namespace, `${at}.namespace`); this.local(predicate.itemId, `${at}.itemId`, items);
      if (predicates.has(predicate.predicate)) this.issue('duplicate_predicate', `${at}.predicate`, '同一引擎谓词只能声明一组准确命名空间和参数'); predicates.add(predicate.predicate);
      const argumentsSeen = new Set<unknown>();
      this.array(predicate.arguments, `${at}.arguments`, false, (argument, at) => {
        if (!this.object(argument, at, ['name', 'itemId', 'valueType'])) return;
        this.text(argument.name, `${at}.name`); this.local(argument.itemId, `${at}.itemId`, items); this.text(argument.valueType, `${at}.valueType`);
        if (argumentsSeen.has(argument.name)) this.issue('duplicate_argument', `${at}.name`, '同一谓词参数名重复'); argumentsSeen.add(argument.name);
      });
    });
    this.array(value.factRequirements, `${path}.factRequirements`, false, (requirement, at) => {
      if (!this.object(requirement, at, ['requirementId', 'predicate', 'sourceRef', 'bindingRef', 'fields', 'grain', 'unit', 'timeBasis', 'coverage', 'kind', 'calculationRefs'])) return;
      for (const key of ['requirementId', 'predicate', 'grain', 'unit', 'timeBasis', 'coverage']) this.text(requirement[key], `${at}.${key}`);
      if (requirements.has(requirement.requirementId)) this.issue('duplicate_requirement', `${at}.requirementId`, '事实需求标识重复'); requirements.add(requirement.requirementId);
      if (!predicates.has(requirement.predicate)) this.issue('missing_predicate', `${at}.predicate`, '事实需求需要引用已声明的准确谓词');
      this.ref(requirement.sourceRef, `${at}.sourceRef`); this.ref(requirement.bindingRef, `${at}.bindingRef`, 'studio-source');
      this.array(requirement.fields, `${at}.fields`, false, (field, at) => this.text(field, at));
      if (Array.isArray(requirement.fields) && !requirement.fields.length) this.issue('required_fields', `${at}.fields`, '事实需求需要准确字段或事件定位');
      this.choice(requirement.kind, `${at}.kind`, ['observed', 'external-computation']);
      if (requirement.calculationRefs !== undefined) this.refs(requirement.calculationRefs, `${at}.calculationRefs`);
      if (requirement.kind === 'external-computation' && (!Array.isArray(requirement.calculationRefs) || !requirement.calculationRefs.length)) this.issue('calculation_reference_required', `${at}.calculationRefs`, '外部计算事实必须保留计算依据及输入版本引用');
    });
    if (value.constraints !== undefined && this.object(value.constraints, `${path}.constraints`, ['format', 'shapes', 'sourceRefs'])) {
      this.choice(value.constraints.format, `${path}.constraints.format`, ['shacl-turtle']); this.text(value.constraints.shapes, `${path}.constraints.shapes`); this.refs(value.constraints.sourceRefs, `${path}.constraints.sourceRefs`);
    }
  }
  validate(value: Record<string, unknown>) {
    this.object(value, '$', ['contentProfile', 'items', 'scope', 'metricLinks', 'relations', 'adaptations', 'bindingLinks', 'readiness', ...(value.contentProfile === 'studio-foundation/2' ? ['ruleExecution'] : [])]); this.text(value.scope, '$.scope', true);
    const items = new Map<string, FoundationItem>();
    this.array(value.items, '$.items', false, (item, at) => {
      if (!this.object(item, at, ['itemId', 'kind', 'name', 'definition', 'sourceRef', 'grain', 'valueType', 'parentItemId', 'scope', 'validFrom', 'validTo', 'evidenceNature'])) return;
      this.text(item.itemId, `${at}.itemId`); this.choice(item.kind, `${at}.kind`, ['entity', 'attribute', 'key', 'value-domain', 'event', 'rule', 'dimension', 'time', 'concept']); this.text(item.definition, `${at}.definition`); this.ref(item.sourceRef, `${at}.sourceRef`);
      for (const key of ['name', 'grain', 'valueType', 'parentItemId', 'evidenceNature']) this.text(item[key], `${at}.${key}`, true);
      this.period(item, at);
      if (typeof item.itemId === 'string') { if (items.has(item.itemId)) this.issue('duplicate_item', `${at}.itemId`, '条目标识重复'); else items.set(item.itemId, item as unknown as FoundationItem); }
    });
    if (Array.isArray(value.items)) value.items.forEach((item, index) => { if (record(item) && item.parentItemId !== undefined) {
      this.local(item.parentItemId, `$.items[${index}].parentItemId`, items);
      const visited = new Set<unknown>([item.itemId]); let parent = items.get(item.parentItemId as string);
      while (parent) { if (visited.has(parent.itemId)) { this.issue('cyclic_parent', `$.items[${index}].parentItemId`, '条目所属关系不能循环'); break; } visited.add(parent.itemId); parent = items.get(parent.parentItemId ?? ''); }
    } });
    if (value.contentProfile === 'studio-foundation/2' && value.ruleExecution !== undefined) this.execution(value.ruleExecution, '$.ruleExecution', items);
    const metrics = new Set<string>();
    this.array(value.metricLinks, '$.metricLinks', true, (link, at) => {
      if (!this.object(link, at, ['metricRef', 'entityItemIds', 'eventItemIds', 'ruleItemIds', 'timeItemIds', 'dimensions', 'bindingRef'])) return;
      this.metricRef(link.metricRef, `${at}.metricRef`);
      const metric = link.metricRef;
      if (record(metric) && record(metric.sourceRef)) {
        const identity = JSON.stringify([refIdentity(metric.sourceRef as unknown as StudioSourceRef), metric.metricName, metric.scenario ?? null]);
        if (metrics.has(identity)) this.issue('duplicate_metric_link', at, '同一准确指标的关联应合并表达'); metrics.add(identity);
      }
      for (const [key, kind] of [['entityItemIds', 'entity'], ['eventItemIds', 'event'], ['ruleItemIds', 'rule'], ['timeItemIds', 'time']] as const) {
        const seen = new Set<unknown>();
        this.array(link[key], `${at}.${key}`, true, (id, at) => { this.local(id, at, items, [kind]); if (seen.has(id)) this.issue('duplicate_item_reference', at, '同一关联内条目重复'); seen.add(id); });
      }
      const dimensions = new Set<unknown>();
      this.array(link.dimensions, `${at}.dimensions`, true, (dimension, at) => {
        if (!this.object(dimension, at, ['name', 'itemId'])) return;
        this.text(dimension.name, `${at}.name`); this.local(dimension.itemId, `${at}.itemId`, items, ['attribute', 'dimension', 'time', 'key']);
        if (dimensions.has(dimension.name)) this.issue('duplicate_dimension', `${at}.name`, '维度名称重复'); dimensions.add(dimension.name);
      });
      if (link.bindingRef !== undefined) this.ref(link.bindingRef, `${at}.bindingRef`, 'studio-source');
    });
    const relations = new Set<unknown>();
    this.array(value.relations, '$.relations', true, (relation, at) => {
      if (!this.object(relation, at, ['relationId', 'type', 'from', 'to', 'evidenceRefs', 'scope', 'validFrom', 'validTo', 'detail', 'role', 'mutuallyExclusive', 'complete', 'additive'])) return;
      this.text(relation.relationId, `${at}.relationId`); if (relations.has(relation.relationId)) this.issue('duplicate_relation', `${at}.relationId`, '关系标识重复'); relations.add(relation.relationId);
      this.choice(relation.type, `${at}.type`, ['catalog', 'formula-dependency', 'statistical-decomposition', 'analysis-use', 'domain']);
      this.target(relation.from, `${at}.from`, items); this.target(relation.to, `${at}.to`, items); this.refs(relation.evidenceRefs, `${at}.evidenceRefs`); this.period(relation, at);
      for (const key of ['detail', 'role']) this.text(relation[key], `${at}.${key}`, true);
      for (const key of ['mutuallyExclusive', 'complete', 'additive']) if (relation[key] !== undefined && (relation.type !== 'statistical-decomposition' || typeof relation[key] !== 'boolean')) this.issue('invalid_decomposition', `${at}.${key}`, '统计分解条件仅用于统计分解关系且必须明确为布尔值');
      if (['formula-dependency', 'statistical-decomposition'].includes(relation.type as string) && (!record(relation.from) || relation.from.kind !== 'metric' || !record(relation.to) || relation.to.kind !== 'metric')) this.issue('metric_relation_required', at, '公式依赖和统计分解必须引用准确SAP指标');
    });
    this.array(value.adaptations, '$.adaptations', true, (adaptation, at) => {
      if (!this.object(adaptation, at, ['referenceRef', 'targetItemId', 'action', 'reason', 'evidenceRefs'])) return;
      this.choice(adaptation.action, `${at}.action`, ['adopt', 'modify', 'exclude', 'add', 'pending']); this.text(adaptation.reason, `${at}.reason`); this.refs(adaptation.evidenceRefs, `${at}.evidenceRefs`);
      if (adaptation.referenceRef !== undefined) this.itemRef(adaptation.referenceRef, `${at}.referenceRef`);
      else if (adaptation.action !== 'add') this.issue('reference_required', `${at}.referenceRef`, '参考内化需要准确参考项');
      if (adaptation.targetItemId !== undefined) this.local(adaptation.targetItemId, `${at}.targetItemId`, items);
      else if (['adopt', 'modify', 'add'].includes(adaptation.action as string)) this.issue('target_required', `${at}.targetItemId`, '采用、修改和新增需要目标项');
    });
    this.array(value.bindingLinks, '$.bindingLinks', true, (link, at) => {
      if (!this.object(link, at, ['sourceRef', 'field', 'itemId', 'grain', 'detail', 'evidenceRefs'])) return;
      this.ref(link.sourceRef, `${at}.sourceRef`); this.local(link.itemId, `${at}.itemId`, items); this.refs(link.evidenceRefs, `${at}.evidenceRefs`);
      for (const key of ['field', 'grain', 'detail']) this.text(link[key], `${at}.${key}`);
    });
    if (value.readiness !== undefined && this.object(value.readiness, '$.readiness', ['definition', 'mapping', 'computation', 'use'])) for (const [key, state] of Object.entries(value.readiness)) {
      const at = `$.readiness.${key}`; if (!this.object(state, at, ['status', 'detail', 'evidenceRefs', 'scope'])) continue;
      this.choice(state.status, `${at}.status`, ['pass', 'fail', 'unknown', 'pending']); this.text(state.detail, `${at}.detail`); this.text(state.scope, `${at}.scope`, true); this.refs(state.evidenceRefs, `${at}.evidenceRefs`);
    }
  }
}

export function parseFoundationContent(body: string): FoundationParseResult {
  let value: unknown;
  try { value = JSON.parse(body); } catch {
    return declaresRootProfile(body) ? { kind: 'invalid', issues: [{ code: 'invalid_json', path: '$', detail: '显式内容约定必须为有效 JSON' }] } : { kind: 'legacy', issues: [] };
  }
  if (!record(value) || !Object.hasOwn(value, 'contentProfile')) return { kind: 'legacy', issues: [] };
  if (typeof value.contentProfile !== 'string' || !value.contentProfile.trim()) return { kind: 'invalid', issues: [{ code: 'invalid_profile', path: '$.contentProfile', detail: '显式内容约定需要非空版本标识' }] };
  if (!['studio-foundation/1', 'studio-foundation/2'].includes(value.contentProfile)) return { kind: 'unsupported', issues: [{ code: 'unsupported_profile', path: '$.contentProfile', detail: '当前内容约定未支持；不能作为已核验结构发布' }] };
  if (value.contentProfile === 'studio-foundation/2' && record(value.ruleExecution)) {
    const execution = value.ruleExecution, engine = execution.engine, constraints = execution.constraints;
    const formats: [unknown, string, string][] = [[execution.contractVersion, 'studio-rule-execution/1', '$.ruleExecution.contractVersion']];
    if (record(engine)) formats.push([engine.name, 'semantica', '$.ruleExecution.engine.name'], [engine.version, '0.7.0', '$.ruleExecution.engine.version']);
    if (record(constraints)) formats.push([constraints.format, 'shacl-turtle', '$.ruleExecution.constraints.format']);
    const unsupported = formats.find(([actual, expected]) => typeof actual === 'string' && !!actual.trim() && actual !== expected);
    if (unsupported) return { kind: 'unsupported', issues: [{ code: 'unsupported_execution', path: unsupported[2], detail: '当前执行约定或官方组件版本未支持；仅保留原候选，不赋予执行资格' }] };
  }
  const validator = new ContentValidator(); validator.validate(value); const issues = validator.issues;
  return issues.length ? { kind: 'invalid', issues } : { kind: 'supported', profile: value as unknown as FoundationContent, issues };
}

export function foundationReferences(profile: FoundationContent): StudioSourceRef[] {
  const refs = new Map<string, StudioSourceRef>();
  const add = (ref: StudioSourceRef) => {
    const key = refIdentity(ref);
    if (!refs.has(key)) refs.set(key, { ...ref });
  };
  const target = (value: FoundationTarget) => {
    if (value.kind === 'external-item') add(value.itemRef.sourceRef);
    else if (value.kind === 'metric') add(value.metricRef.sourceRef);
  };
  for (const item of profile.items) add(item.sourceRef);
  for (const link of profile.metricLinks ?? []) { add(link.metricRef.sourceRef); if (link.bindingRef) add(link.bindingRef); }
  for (const relation of profile.relations ?? []) { target(relation.from); target(relation.to); relation.evidenceRefs.forEach(add); }
  for (const adaptation of profile.adaptations ?? []) { if (adaptation.referenceRef) add(adaptation.referenceRef.sourceRef); adaptation.evidenceRefs.forEach(add); }
  for (const link of profile.bindingLinks ?? []) { add(link.sourceRef); link.evidenceRefs.forEach(add); }
  for (const state of Object.values(profile.readiness ?? {})) state?.evidenceRefs.forEach(add);
  for (const requirement of profile.ruleExecution?.factRequirements ?? []) { add(requirement.sourceRef); add(requirement.bindingRef); requirement.calculationRefs?.forEach(add); }
  profile.ruleExecution?.constraints?.sourceRefs.forEach(add);
  return [...refs.values()];
}

/** Task report receipts are provenance, not a grant to read another task during analysis. */
export function foundationDependencyReferences(profile: FoundationContent): StudioSourceRef[] {
  const required = new Set<string>();
  const add = (ref: StudioSourceRef) => required.add(refIdentity(ref));
  const target = (value: FoundationTarget) => { if (value.kind === 'external-item') add(value.itemRef.sourceRef); else if (value.kind === 'metric') add(value.metricRef.sourceRef); };
  profile.items.forEach(item => add(item.sourceRef));
  for (const link of profile.metricLinks ?? []) { add(link.metricRef.sourceRef); if (link.bindingRef) add(link.bindingRef); }
  for (const relation of profile.relations ?? []) { target(relation.from); target(relation.to); }
  for (const adaptation of profile.adaptations ?? []) if (adaptation.referenceRef) add(adaptation.referenceRef.sourceRef);
  for (const link of profile.bindingLinks ?? []) add(link.sourceRef);
  for (const requirement of profile.ruleExecution?.factRequirements ?? []) { add(requirement.sourceRef); add(requirement.bindingRef); requirement.calculationRefs?.forEach(add); }
  profile.ruleExecution?.constraints?.sourceRefs.forEach(add);
  return foundationReferences(profile).filter(ref => ref.authority !== 'task' || required.has(refIdentity(ref)));
}

/** Manual edits invalidate declarations; independent use records remain in their original authority. */
export function invalidateFoundationReadiness(body: string): string {
  const parsed = parseFoundationContent(body);
  if (parsed.kind !== 'supported' || !parsed.profile?.readiness) return body;
  const profile = parsed.profile;
  for (const state of Object.values(profile.readiness!)) if (state) { state.status = 'pending'; state.detail = '正文已人工修改，需重新核查'; state.evidenceRefs = []; }
  return JSON.stringify(profile, null, 2);
}
