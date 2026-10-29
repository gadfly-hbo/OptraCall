import { createHash } from 'node:crypto';
import { parseDocument, visit, isAlias, isScalar } from 'yaml';

export type SapOrigin = 'template' | 'llm' | 'manual';
export type SapMetricType = 'simple' | 'ratio' | 'derived' | 'cumulative';
export type SapUsageRole = 'outcome' | 'driver' | 'guardrail';
export type SapTypeParams = Readonly<Partial<{ measure: string; numerator: string; denominator: string; expr: string; window: string; grain_to_date: string }>>;
export type SapProvenance = Readonly<Partial<{ origin: SapOrigin; model: string; prompt_version: string; reviewed_by: string; note: string; template_ref: string }> & { origin: SapOrigin }>;
export type SapMetric = Readonly<{
  name: string; display_name: string; type: SapMetricType; definition: string;
  dimensions: readonly string[]; time_grains: readonly string[]; owner_role: string;
  caliber_switches: Readonly<Record<string, boolean>>; type_params?: SapTypeParams; provenance: SapProvenance;
}>;
export type SapScenario = Readonly<{
  id: string; version: string; title: string; decision_purpose: string;
  metric_usages: readonly Readonly<{ metric: string; role: SapUsageRole; note?: string }>[];
  method_refs: readonly string[]; evidence_requirements: string;
}>;
export type SapPackage = Readonly<{ id: string; version: string; namespace: string; fingerprint: string }>;
export type SapDocument = Readonly<{ sap: '0.2'; package: SapPackage; dimensions: readonly string[]; metrics: readonly SapMetric[]; scenarios: readonly SapScenario[] }>;

export class SapFault extends Error {
  readonly code: string;
  readonly path: string;
  constructor(code: string, path = '') { super(code); this.code = code; this.path = path; }
}

const TIME_GRAINS = ['day', 'week', 'month', 'quarter', 'year'];
const ROLES = ['outcome', 'driver', 'guardrail'];
const packageIdPattern = /^[a-z][a-z0-9-]*$/;
const identifierPattern = /^[a-z][a-z0-9_]*$/;
const semverPattern = /^\d+\.\d+\.\d+$/;
const sha256Pattern = /^sha256:[a-f0-9]{64}$/;
const maxFileBytes = 2 * 1024 * 1024;
const hash = (value: Uint8Array | string) => createHash('sha256').update(value).digest('hex');
const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const fail = (code: string, path = ''): never => { throw new SapFault(code, path); };
const text = (value: unknown, path: string): string => { if (typeof value !== 'string' || !value.trim() || value.length > 100_000 || value.includes('\0')) return fail('SAP_STRUCTURE', path); return value; };
const list = (value: unknown, path: string): unknown[] => { if (!Array.isArray(value) || value.length > 4096) return fail('SAP_STRUCTURE', path); return value; };
const strings = (value: unknown, path: string): string[] => list(value, path).map((item, index) => text(item, `${path}.${index}`));
const one = (value: unknown, allowed: readonly string[], path: string) => { if (!allowed.includes(String(value))) fail('SAP_STRUCTURE', path); };
const keys = (value: Record<string, unknown>, allowed: readonly string[], path: string) => { for (const key of Object.keys(value)) if (!allowed.includes(key)) fail('SAP_UNKNOWN_FIELD', `${path}.${key}`); };

/** Exactly SAP 0.2 canonical form: recursive UTF-16 key sort, NFC scalars, LF, two-space block YAML. */
export function canonicalSapYaml(value: unknown): string {
  const scalar = (item: unknown): string => {
    if (item === null) return 'null';
    if (typeof item === 'boolean') return String(item);
    if (typeof item === 'number') { if (!Number.isFinite(item)) fail('SAP_STRUCTURE'); return String(item); }
    if (typeof item !== 'string') return fail('SAP_STRUCTURE');
    const normalized = item.normalize('NFC');
    return /^[a-z0-9][a-z0-9_.\-/]*$/.test(normalized) && !/^(?:null|true|false|[-+]?(?:[0-9]+|0x[\da-fA-F]+|0o[0-7]+)|[-+]?(?:\.[0-9]+|[0-9]+(?:\.[0-9]*)?)(?:[eE][-+]?[0-9]+)?)$/.test(normalized) ? normalized : JSON.stringify(normalized);
  };
  const block = (item: unknown): boolean => item !== null && typeof item === 'object' && (Array.isArray(item) ? item.length > 0 : Object.keys(item).length > 0);
  const emit = (item: unknown, indent = 0): string[] => {
    const pad = ' '.repeat(indent);
    if (Array.isArray(item)) {
      if (!item.length) return [pad + '[]'];
      return item.flatMap(entry => { const lines = emit(entry, indent + 2); return [pad + '- ' + lines[0]!.slice(indent + 2), ...lines.slice(1)]; });
    }
    if (item !== null && typeof item === 'object') {
      const entries = Object.entries(item).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
      if (!entries.length) return [pad + '{}'];
      return entries.flatMap(([key, entry]) => block(entry) ? [pad + scalar(key) + ':', ...emit(entry, indent + 2)] : [pad + scalar(key) + ': ' + emit(entry, indent + 2)[0]!.slice(indent + 2)]);
    }
    return [pad + scalar(item)];
  };
  return emit(value).join('\n') + '\n';
}

export function sapFingerprints(document: SapDocument): { packageFingerprint: string; contentFingerprint: string } {
  const p = document.package;
  return {
    packageFingerprint: 'sha256:' + hash(canonicalSapYaml({ ...document, package: { ...p, fingerprint: '' } })),
    contentFingerprint: 'sha256:' + hash(canonicalSapYaml({ ...document, package: { id: p.id, version: '', namespace: '', fingerprint: '' } })),
  };
}

function parse(bytes: Uint8Array): Record<string, unknown> {
  if (!bytes.byteLength || bytes.byteLength > maxFileBytes) fail('SAP_FILE_SIZE');
  let source: string;
  try { source = new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { return fail('SAP_ENCODING'); }
  const document = parseDocument(source, { uniqueKeys: true, version: '1.2', schema: 'core' });
  if (document.errors.length || document.warnings.length) fail('SAP_YAML_INVALID');
  visit(document, (_key, node) => { if (isAlias(node) || node && typeof node === 'object' && 'anchor' in node && node.anchor || isScalar(node) && node.tag) fail('SAP_YAML_UNSAFE'); });
  try { return document.toJS({ maxAliasCount: 0 }) as Record<string, unknown>; } catch { return fail('SAP_YAML_INVALID'); }
}

function checkShape(raw: unknown): SapDocument {
  const root = isObject(raw) ? raw : fail('SAP_STRUCTURE', 'root');
  keys(root, ['sap', 'package', 'dimensions', 'metrics', 'scenarios'], 'root');
  if (root.sap !== '0.2') fail('SAP_VERSION', 'sap');
  const p = isObject(root.package) ? root.package : fail('SAP_STRUCTURE', 'package');
  keys(p, ['id', 'version', 'namespace', 'fingerprint'], 'package');
  for (const key of ['id', 'version', 'namespace']) text(p[key], `package.${key}`);
  if (typeof p.fingerprint !== 'string' || (p.fingerprint !== '' && !sha256Pattern.test(p.fingerprint))) fail('SAP_STRUCTURE', 'package.fingerprint');

  const dimensions = strings(root.dimensions, 'dimensions');
  if (!dimensions.length || new Set(dimensions).size !== dimensions.length || dimensions.some(name => !identifierPattern.test(name))) fail('SAP_STRUCTURE', 'dimensions');

  const names = new Set<string>();
  const checkedMetrics: { m: Record<string, unknown>; path: string; metricDimensions: string[]; grains: string[]; typeParams?: Record<string, string> }[] = [];
  for (const [index, value] of list(root.metrics, 'metrics').entries()) {
    const path = `metrics.${index}`;
    const m = isObject(value) ? value : fail('SAP_STRUCTURE', path);
    keys(m, ['name', 'display_name', 'type', 'definition', 'dimensions', 'time_grains', 'owner_role', 'caliber_switches', 'type_params', 'provenance'], path);
    for (const key of ['name', 'display_name', 'definition', 'owner_role']) text(m[key], `${path}.${key}`);
    if (!identifierPattern.test(m.name as string) || names.has(m.name as string)) fail('SAP_DUPLICATE_IDENTITY', `${path}.name`);
    names.add(m.name as string);
    one(m.type, ['simple', 'ratio', 'derived', 'cumulative'], `${path}.type`);
    const metricDimensions = strings(m.dimensions, `${path}.dimensions`);
    if (new Set(metricDimensions).size !== metricDimensions.length || metricDimensions.some(name => !dimensions.includes(name))) fail('SAP_STRUCTURE', `${path}.dimensions`);
    const grains = strings(m.time_grains, `${path}.time_grains`);
    if (!grains.length || new Set(grains).size !== grains.length || grains.some(grain => !TIME_GRAINS.includes(grain))) fail('SAP_STRUCTURE', `${path}.time_grains`);
    const switches = isObject(m.caliber_switches) ? m.caliber_switches : fail('SAP_STRUCTURE', `${path}.caliber_switches`);
    for (const [key, entry] of Object.entries(switches)) { text(key, `${path}.caliber_switches`); if (typeof entry !== 'boolean') fail('SAP_STRUCTURE', `${path}.caliber_switches.${key}`); }
    let typeParams: Record<string, string> | undefined;
    if (m.type_params !== undefined) {
      const params = isObject(m.type_params) ? m.type_params : fail('SAP_STRUCTURE', `${path}.type_params`);
      keys(params, ['measure', 'numerator', 'denominator', 'expr', 'window', 'grain_to_date'], `${path}.type_params`);
      typeParams = {};
      for (const [key, entry] of Object.entries(params)) {
        if (entry === undefined) continue;
        text(entry, `${path}.type_params.${key}`);
        typeParams[key] = entry as string;
      }
      if (m.type === 'ratio' && (!typeParams.numerator || !typeParams.denominator)) fail('SAP_STRUCTURE', `${path}.type_params`);
    }
    const provenance = isObject(m.provenance) ? m.provenance : fail('SAP_STRUCTURE', `${path}.provenance`);
    keys(provenance, ['origin', 'model', 'prompt_version', 'reviewed_by', 'note', 'template_ref'], `${path}.provenance`);
    one(provenance.origin, ['template', 'llm', 'manual'], `${path}.provenance.origin`);
    if (provenance.origin === 'template' && (typeof provenance.template_ref !== 'string' || !provenance.template_ref.trim())) fail('SAP_STRUCTURE', `${path}.provenance.template_ref`);
    if (provenance.origin === 'llm') {
      if (typeof provenance.model !== 'string' || !provenance.model.trim()) fail('SAP_STRUCTURE', `${path}.provenance.model`);
      if (typeof provenance.reviewed_by !== 'string' || !provenance.reviewed_by.trim()) fail('SAP_UNREVIEWED', `${path}.provenance.reviewed_by`);
    }
    for (const key of ['model', 'prompt_version', 'reviewed_by', 'template_ref']) if (provenance[key] !== undefined) text(provenance[key], `${path}.provenance.${key}`);
    if (provenance.note !== undefined && typeof provenance.note !== 'string') fail('SAP_STRUCTURE', `${path}.provenance.note`);
    checkedMetrics.push({ m, path, metricDimensions, grains, typeParams });
  }
  if (!checkedMetrics.length) fail('SAP_STRUCTURE', 'metrics');
  // Cross references resolve against the whole package, so forward references work.
  const metrics: SapMetric[] = checkedMetrics.map(({ m, path, metricDimensions, grains, typeParams }) => {
    if (typeParams) for (const key of ['measure', 'numerator', 'denominator', 'grain_to_date'] as const) {
      const entry = typeParams[key];
      if (entry === undefined) continue;
      if (!identifierPattern.test(entry) || !names.has(entry)) fail('SAP_DANGLING_REFERENCE', `${path}.type_params.${key}`);
    }
    return {
      name: m.name as string, display_name: m.display_name as string, type: m.type as SapMetricType, definition: m.definition as string,
      dimensions: metricDimensions, time_grains: grains, owner_role: m.owner_role as string,
      caliber_switches: m.caliber_switches as Record<string, boolean>, ...(typeParams ? { type_params: typeParams } : {}),
      provenance: m.provenance as SapProvenance,
    };
  });

  const scenes = new Set<string>();
  const scenarios: SapScenario[] = list(root.scenarios, 'scenarios').map((value, index) => {
    const path = `scenarios.${index}`;
    const s = isObject(value) ? value : fail('SAP_STRUCTURE', path);
    keys(s, ['id', 'version', 'title', 'decision_purpose', 'metric_usages', 'method_refs', 'evidence_requirements'], path);
    for (const key of ['id', 'version', 'title', 'decision_purpose', 'evidence_requirements']) text(s[key], `${path}.${key}`);
    if (!identifierPattern.test(s.id as string) || !semverPattern.test(s.version as string)) fail('SAP_STRUCTURE', `${path}`);
    const sceneKey = `${s.id}@${s.version}`;
    if (scenes.has(sceneKey)) fail('SAP_DUPLICATE_IDENTITY', `${path}.id`);
    scenes.add(sceneKey);
    const usages = list(s.metric_usages, `${path}.metric_usages`).map((usage, usageIndex) => {
      const u = isObject(usage) ? usage : fail('SAP_STRUCTURE', `${path}.metric_usages.${usageIndex}`);
      keys(u, ['metric', 'role', 'note'], `${path}.metric_usages.${usageIndex}`);
      text(u.metric, `${path}.metric_usages.${usageIndex}.metric`);
      if (!names.has(u.metric as string)) fail('SAP_DANGLING_REFERENCE', `${path}.metric_usages.${usageIndex}.metric`);
      one(u.role, ROLES, `${path}.metric_usages.${usageIndex}.role`);
      if (u.note !== undefined) text(u.note, `${path}.metric_usages.${usageIndex}.note`);
      return { metric: u.metric as string, role: u.role as SapUsageRole, ...(u.note === undefined ? {} : { note: u.note as string }) };
    });
    return { id: s.id as string, version: s.version as string, title: s.title as string, decision_purpose: s.decision_purpose as string, metric_usages: usages, method_refs: strings(s.method_refs, `${path}.method_refs`), evidence_requirements: s.evidence_requirements as string };
  });

  const document: SapDocument = { sap: '0.2', package: p as unknown as SapPackage, dimensions, metrics, scenarios };
  if (p.fingerprint !== '') {
    const { packageFingerprint } = sapFingerprints(document);
    if (p.fingerprint !== packageFingerprint) fail('SAP_FINGERPRINT_MISMATCH', 'package.fingerprint');
  }
  return document;
}

/** Byte-only draft import. Drafts may leave package.fingerprint empty; no paths, code, or network. */
export function parseSapDraft(bytes: Uint8Array): SapDocument {
  return checkShape(parse(bytes));
}

export type SapPublication = { document: SapDocument; canonicalYaml: string; packageFingerprint: string; contentFingerprint: string; bytesSha256: string; bytes: number };

/** Publication is the only path into the library: validate, fill the fingerprint, canonicalize. */
export function preparePublication(bytes: Uint8Array): SapPublication {
  const draft = checkShape(parse(bytes));
  const { packageFingerprint, contentFingerprint } = sapFingerprints(draft);
  const document: SapDocument = { ...draft, package: { ...draft.package, fingerprint: packageFingerprint } };
  const canonicalYaml = canonicalSapYaml(document);
  return { document, canonicalYaml, packageFingerprint, contentFingerprint, bytesSha256: hash(canonicalYaml), bytes: Buffer.byteLength(canonicalYaml, 'utf8') };
}
