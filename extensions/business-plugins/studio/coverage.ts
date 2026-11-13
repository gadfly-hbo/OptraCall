import type { StudioSourceRef } from './contracts.ts';

export const coverageColumns = ['What', 'How', 'Where', 'Who', 'When', 'Why'] as const;
export interface CoverageCell { row: 1 | 2 | 3 | 4 | 5 | 6; column: typeof coverageColumns[number] }
export interface CoverageIssue { code: string; path: string; detail: string }
export interface CoverageObservation {
  id: string; description: string; subjectLabel: string;
  annotations: { cell: CoverageCell; reason: string }[];
  evidenceRefs: StudioSourceRef[];
  evidenceStatus: 'not-reviewed' | 'located' | 'partial' | 'missing' | 'not-applicable';
  reason?: string;
  sourceSelection?: { sourceRef: StudioSourceRef; itemId?: string; metricName?: string; fragmentLocator?: string };
}
export interface CoverageReport {
  reportProfile: 'studio-coverage/1';
  scope: { enterpriseId: string; systemId: string; topicId: string; purpose: string; included: string[]; excluded: string[]; validFrom?: string; validTo?: string };
  focusCells: CoverageCell[]; methodRefs: StudioSourceRef[]; basisRefs: StudioSourceRef[];
  observations: CoverageObservation[];
  questions: { id: string; observationIds: string[]; kind: 'missing' | 'possible-conflict' | 'dependency' | 'business-decision'; detail: string; impact: string; evidenceRefs: StudioSourceRef[]; workItemId?: string }[];
  limitations: string[];
}
export interface CoverageParseResult { kind: 'legacy' | 'supported' | 'unsupported' | 'invalid'; report?: CoverageReport; issues: CoverageIssue[] }
const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
export const coverageRefIdentity = (ref: StudioSourceRef): string => JSON.stringify([ref.authority, ref.id, ref.version, ref.sha256 ?? null, ref.projectId ?? null, ref.taskId ?? null, ref.locator ?? null]);
export function coverageReferences(report: CoverageReport): StudioSourceRef[] {
  const refs = [...report.methodRefs, ...report.basisRefs, ...report.observations.flatMap(observation => [...observation.evidenceRefs, ...(observation.sourceSelection ? [observation.sourceSelection.sourceRef] : [])]), ...report.questions.flatMap(question => question.evidenceRefs)];
  return [...new Map(refs.map(ref => [coverageRefIdentity(ref), ref])).values()];
}

/** Recognize only a root declaration, including malformed JSON, never a quoted/nested example. */
function declaresProfile(body: string): boolean {
  const input = body.trimStart(); if (!input.startsWith('{')) return false;
  let depth = 0, previous = '';
  for (let index = 0; index < input.length; index++) {
    const char = input[index];
    if (char === '"') {
      const start = index;
      for (index++; index < input.length; index++) { if (input[index] === '\\') index++; else if (input[index] === '"') break; }
      if (depth === 1 && (previous === '{' || previous === ',') && input.slice(index + 1).trimStart().startsWith(':')) {
        try { if (JSON.parse(input.slice(start, index + 1)) === 'reportProfile') return true; } catch { /* Incomplete property names are legacy text. */ }
      }
      previous = '"'; continue;
    }
    if (char === '{' || char === '[') depth++; else if (char === '}' || char === ']') depth--;
    if (depth === 0) return false;
    if (!/\s/.test(char)) previous = char;
  }
  return false;
}

class CoverageValidator {
  readonly issues: CoverageIssue[] = [];
  readonly refs = new Set<string>();
  issue(code: string, path: string, detail: string) { if (this.issues.length < 512) this.issues.push({ code, path, detail }); }
  object(value: unknown, path: string, fields: string[]): value is Record<string, unknown> {
    if (!object(value)) { this.issue('required_object', path, '需要对象'); return false; }
    for (const field of Object.keys(value)) if (!fields.includes(field)) this.issue('unknown_field', `${path}.${field}`, '报告合同不支持此结构字段');
    return true;
  }
  text(value: unknown, path: string, optional = false, limit = 20_000) {
    if (optional && value === undefined) return;
    if (typeof value !== 'string' || !value.trim() || value.includes('\0') || new TextEncoder().encode(value).length > limit) this.issue('required_text', path, '需要非空有界文本');
  }
  array(value: unknown, path: string, limit: number, visit: (value: unknown, path: string) => void) {
    if (!Array.isArray(value) || value.length > limit) { this.issue('bounded_array', path, `需要不超过${limit}项的数组`); return; }
    value.forEach((item, index) => visit(item, `${path}[${index}]`));
  }
  texts(value: unknown, path: string, limit = 128) { this.array(value, path, limit, (value, at) => this.text(value, at)); }
  ref(value: unknown, path: string) {
    if (!this.object(value, path, ['authority', 'id', 'version', 'title', 'sha256', 'projectId', 'taskId', 'locator'])) return;
    this.choice(value.authority, `${path}.authority`, ['enterprise', 'rap', 'data', 'sap-metric', 'sap-method', 'studio-source', 'task', 'case']);
    this.text(value.id, `${path}.id`, false, 1000); this.text(value.version, `${path}.version`, false, 200);
    for (const key of ['title', 'projectId', 'taskId', 'locator']) this.text(value[key], `${path}.${key}`, true, 2000);
    if (value.sha256 !== undefined && (typeof value.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(value.sha256))) this.issue('invalid_hash', `${path}.sha256`, '需要准确SHA-256');
    this.refs.add(coverageRefIdentity(value as unknown as StudioSourceRef));
  }
  references(value: unknown, path: string) { this.array(value, path, 128, (ref, at) => this.ref(ref, at)); }
  choice(value: unknown, path: string, choices: readonly string[]) { if (typeof value !== 'string' || !choices.includes(value)) this.issue('unknown_type', path, `需要${choices.join(' / ')}`); }
  cell(value: unknown, path: string) {
    if (!this.object(value, path, ['row', 'column'])) return;
    if (!Number.isInteger(value.row) || Number(value.row) < 1 || Number(value.row) > 6) this.issue('invalid_coordinate', `${path}.row`, '行必须为1至6');
    this.choice(value.column, `${path}.column`, coverageColumns);
  }
  cells(value: unknown, path: string, annotated = false) {
    const seen = new Set<string>();
    this.array(value, path, 36, (entry, at) => {
      let cell = entry;
      if (annotated) { if (!this.object(entry, at, ['cell', 'reason'])) return; cell = entry.cell; this.text(entry.reason, `${at}.reason`); }
      this.cell(cell, annotated ? `${at}.cell` : at);
      if (!object(cell)) return;
      const key = JSON.stringify([cell.row, cell.column]);
      if (seen.has(key)) this.issue('duplicate_coordinate', at, '同一集合内坐标不能重复'); seen.add(key);
    });
  }
  validate(value: Record<string, unknown>) {
    this.object(value, '$', ['reportProfile', 'scope', 'focusCells', 'methodRefs', 'basisRefs', 'observations', 'questions', 'limitations']);
    if (this.object(value.scope, '$.scope', ['enterpriseId', 'systemId', 'topicId', 'purpose', 'included', 'excluded', 'validFrom', 'validTo'])) {
      for (const key of ['enterpriseId', 'systemId', 'topicId', 'purpose']) this.text(value.scope[key], `$.scope.${key}`);
      this.texts(value.scope.included, '$.scope.included'); this.texts(value.scope.excluded, '$.scope.excluded');
      for (const key of ['validFrom', 'validTo']) if (value.scope[key] !== undefined) {
        this.text(value.scope[key], `$.scope.${key}`);
        if (typeof value.scope[key] !== 'string' || !Number.isFinite(Date.parse(value.scope[key]))) this.issue('invalid_time', `$.scope.${key}`, '需要可解析的适用时间');
      }
      if (typeof value.scope.validFrom === 'string' && typeof value.scope.validTo === 'string' && Date.parse(value.scope.validFrom) > Date.parse(value.scope.validTo)) this.issue('invalid_period', '$.scope', '适用起点不能晚于终点');
    }
    this.cells(value.focusCells, '$.focusCells'); this.references(value.methodRefs, '$.methodRefs'); this.references(value.basisRefs, '$.basisRefs'); this.texts(value.limitations, '$.limitations');
    const ids = new Set<unknown>();
    const id = (value: unknown, at: string) => { this.text(value, at, false, 200); if (ids.has(value)) this.issue('duplicate_id', at, '报告内id必须唯一'); ids.add(value); };
    const observationIds = new Set<unknown>();
    this.array(value.observations, '$.observations', 256, (observation, at) => {
      if (!this.object(observation, at, ['id', 'description', 'subjectLabel', 'annotations', 'evidenceRefs', 'evidenceStatus', 'reason', 'sourceSelection'])) return;
      id(observation.id, `${at}.id`); observationIds.add(observation.id); this.text(observation.description, `${at}.description`); this.text(observation.subjectLabel, `${at}.subjectLabel`);
      this.cells(observation.annotations, `${at}.annotations`, true); this.references(observation.evidenceRefs, `${at}.evidenceRefs`);
      this.choice(observation.evidenceStatus, `${at}.evidenceStatus`, ['not-reviewed', 'located', 'partial', 'missing', 'not-applicable']);
      this.text(observation.reason, `${at}.reason`, observation.evidenceStatus !== 'not-applicable');
      if (observation.sourceSelection !== undefined && this.object(observation.sourceSelection, `${at}.sourceSelection`, ['sourceRef', 'itemId', 'metricName', 'fragmentLocator'])) {
        this.ref(observation.sourceSelection.sourceRef, `${at}.sourceSelection.sourceRef`);
        for (const key of ['itemId', 'metricName', 'fragmentLocator']) this.text(observation.sourceSelection[key], `${at}.sourceSelection.${key}`, true, 2000);
        if (observation.sourceSelection.itemId !== undefined && observation.sourceSelection.metricName !== undefined) this.issue('invalid_selection', `${at}.sourceSelection`, 'itemId与metricName不能并用');
      }
    });
    this.array(value.questions, '$.questions', 128, (question, at) => {
      if (!this.object(question, at, ['id', 'observationIds', 'kind', 'detail', 'impact', 'evidenceRefs', 'workItemId'])) return;
      id(question.id, `${at}.id`); this.choice(question.kind, `${at}.kind`, ['missing', 'possible-conflict', 'dependency', 'business-decision']);
      this.text(question.detail, `${at}.detail`); this.text(question.impact, `${at}.impact`); this.references(question.evidenceRefs, `${at}.evidenceRefs`); this.text(question.workItemId, `${at}.workItemId`, true, 200);
      this.array(question.observationIds, `${at}.observationIds`, 256, (id, path) => { this.text(id, path); if (!observationIds.has(id)) this.issue('missing_observation', path, '引用观察项必须存在'); });
    });
    if (this.refs.size > 128) this.issue('too_many_references', '$', '去重准确引用最多128项');
  }
}

/** Bounded projection of the original immutable business body; never a separate authority. */
export function parseCoverageContent(body: string): CoverageParseResult {
  const declared = declaresProfile(body);
  if (declared && new TextEncoder().encode(body).length > 256 * 1024) return { kind: 'invalid', issues: [{ code: 'body_too_large', path: '$', detail: '盘点报告最多256KiB' }] };
  let value: unknown;
  try { value = JSON.parse(body); } catch { return { kind: declared ? 'invalid' : 'legacy', issues: declared ? [{ code: 'invalid_json', path: '$', detail: '报告JSON损坏' }] : [] }; }
  if (!object(value) || !Object.hasOwn(value, 'reportProfile')) return { kind: 'legacy', issues: [] };
  if (typeof value.reportProfile !== 'string' || !value.reportProfile.trim()) return { kind: 'invalid', issues: [{ code: 'invalid_profile', path: '$.reportProfile', detail: '需要报告版本' }] };
  if (value.reportProfile !== 'studio-coverage/1') return { kind: 'unsupported', issues: [] };
  const validator = new CoverageValidator(); validator.validate(value);
  return validator.issues.length ? { kind: 'invalid', issues: validator.issues } : { kind: 'supported', report: value as unknown as CoverageReport, issues: [] };
}
