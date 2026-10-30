import { createHash } from 'node:crypto';
import { parseDocument, visit, isAlias, isScalar } from 'yaml';

export type Scene = 'daily' | 'topic' | 'recurring';
export type ClarificationPriority = 'must_confirm' | 'should_confirm' | 'can_defer';
export type ClarificationStatus = 'pending' | 'answered' | 'assumed' | 'skipped' | 'deferred';
export type HypothesisStatus = 'proposed' | 'confirmed' | 'rejected' | 'deferred';
export type DataNeedPriority = 'P0' | 'P1' | 'P2';

export type ClarificationItem = Readonly<{
  id: string; category: string; priority: ClarificationPriority;
  question: string; rationale: string; status: ClarificationStatus;
  answer?: string; linkedHypothesisId?: string;
}>;
export type HypothesisItem = Readonly<{
  id: string; statement: string; evidence: string; validationCondition: string; status: HypothesisStatus;
}>;
export type FrameworkDocument = Readonly<{
  metrics: readonly Readonly<{ name: string; definition: string; dimensions: readonly string[]; source: string }>[];
  dataNeeds: readonly Readonly<{ table: string; fields: readonly string[]; priority: DataNeedPriority; purpose: string }>[];
  /** Empty hypothesis means a descriptive question; nonempty values reference a known hypothesis id. */
  analysisPaths: readonly Readonly<{ question: string; hypothesis: string; method: string; requiredData: readonly string[]; expectedOutput: string }>[];
  reportFramework: readonly Readonly<{ section: string; purpose: string; keyQuestions: readonly string[]; evidence: readonly string[]; zeroHallucinationCheck: string }>[];
  openQuestions: readonly string[];
  risks: readonly string[];
}>;

/** Draft groups may be empty; formal publication and direct send need all four structure groups. */
export function missingFrameworkSections(framework: FrameworkDocument | undefined) {
  return (['metrics', 'dataNeeds', 'analysisPaths', 'reportFramework'] as const).filter(section => !framework?.[section].length);
}

export type SnapshotRef = Readonly<{ fingerprint: string; confirmedAt: string; upstreamDigest: string; confirmedBy: string }>;
export type RequirementInstance = Readonly<{
  instance: Readonly<{ version: '0.1'; id: string; scene: Scene; title: string; createdAt: string; updatedAt: string }>;
  context: Readonly<{ background: string; goal: string; decisionScenario: string }>;
  clarifications: readonly ClarificationItem[];
  facts: readonly string[];
  hypotheses: readonly HypothesisItem[];
  framework?: FrameworkDocument;
  snapshot?: SnapshotRef;
}>;

export type RapDocument = Readonly<{
  rap: '0.2'; id: string; version: string; releasedAt: string; releasedBy: string; fingerprint: string;
  instance: Readonly<{ scene: Scene; title: string }>;
  context: RequirementInstance['context'];
  confirmation: SnapshotRef;
  clarifications: readonly ClarificationItem[];
  confirmedFacts: readonly string[];
  assumptions: readonly HypothesisItem[];
  metrics: FrameworkDocument['metrics'];
  dataNeeds: FrameworkDocument['dataNeeds'];
  analysisPaths: FrameworkDocument['analysisPaths'];
  reportFramework: FrameworkDocument['reportFramework'];
  openQuestions: readonly string[];
  risks: readonly string[];
}>;

export class RequirementFault extends Error {
  readonly code: string;
  readonly path: string;
  constructor(code: string, path = '') { super(code); this.code = code; this.path = path; }
}

const SCENES = ['daily', 'topic', 'recurring'];
const CATEGORIES = ['目标', '对象/人群', '时间窗口', '指标口径', '可用数据', '输出形式', '风险'];
const PRIORITIES = ['must_confirm', 'should_confirm', 'can_defer'];
const CLARIFICATION_STATUSES = ['pending', 'answered', 'assumed', 'skipped', 'deferred'];
const HYPOTHESIS_STATUSES = ['proposed', 'confirmed', 'rejected', 'deferred'];
const DATA_PRIORITIES = ['P0', 'P1', 'P2'];
const instanceIdPattern = /^req-[a-z0-9][a-z0-9-]{0,60}$/;
const clarifIdPattern = /^clr-\d{1,6}$/;
const hypothesisIdPattern = /^hyp-\d{1,6}$/;
const semverPattern = /^\d+\.\d+\.\d+$/;
const sha256Pattern = /^sha256:[a-f0-9]{64}$/;
const digestPattern = /^[a-f0-9]{64}$/;
const maxFileBytes = 4 * 1024 * 1024;
const hash = (value: Uint8Array | string) => createHash('sha256').update(value).digest('hex');
const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const fail = (code: string, path = ''): never => { throw new RequirementFault(code, path); };
const text = (value: unknown, path: string, allowEmpty = false): string => {
  if (typeof value !== 'string' || value.length > 100_000 || value.includes('\0') || (!allowEmpty && !value.trim())) return fail('REQ_STRUCTURE', path);
  return value;
};
const list = (value: unknown, path: string): unknown[] => { if (!Array.isArray(value) || value.length > 4096) return fail('REQ_STRUCTURE', path); return value; };
const strings = (value: unknown, path: string, allowEmpty = false): string[] => list(value, path).map((item, index) => text(item, `${path}.${index}`, allowEmpty));
const one = (value: unknown, allowed: readonly string[], path: string) => { if (!allowed.includes(String(value))) fail('REQ_STRUCTURE', path); };
const keys = (value: Record<string, unknown>, allowed: readonly string[], path: string) => { for (const key of Object.keys(value)) if (!allowed.includes(key)) fail('REQ_UNKNOWN_FIELD', `${path}.${key}`); };
const isoDate = (value: unknown, path: string): string => {
  if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\dT/.test(value) || !Number.isFinite(Date.parse(value))) return fail('REQ_STRUCTURE', path);
  return value;
};

/** Recursive UTF-16 key sort, NFC scalars, LF, two-space block YAML — same canonical family as SAP 0.2. */
export function canonicalYaml(value: unknown): string {
  const scalar = (item: unknown): string => {
    if (item === null) return 'null';
    if (typeof item === 'boolean') return String(item);
    if (typeof item === 'number') { if (!Number.isFinite(item)) fail('REQ_STRUCTURE'); return String(item); }
    if (typeof item !== 'string') return fail('REQ_STRUCTURE');
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
      const entries = Object.entries(item).filter(([, entry]) => entry !== undefined).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
      if (!entries.length) return [pad + '{}'];
      return entries.flatMap(([key, entry]) => block(entry) ? [pad + scalar(key) + ':', ...emit(entry, indent + 2)] : [pad + scalar(key) + ': ' + emit(entry, indent + 2)[0]!.slice(indent + 2)]);
    }
    return [pad + scalar(item)];
  };
  return emit(value).join('\n') + '\n';
}
export const canonicalInstanceYaml = (instance: RequirementInstance): string => canonicalYaml(instance);

function parse(bytes: Uint8Array): Record<string, unknown> {
  if (!bytes.byteLength || bytes.byteLength > maxFileBytes) fail('REQ_FILE_SIZE');
  let source: string;
  try { source = new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { return fail('REQ_ENCODING'); }
  const document = parseDocument(source, { uniqueKeys: true, version: '1.2', schema: 'core' });
  if (document.errors.length || document.warnings.length) fail('REQ_YAML_INVALID');
  visit(document, (_key, node) => { if (isAlias(node) || node && typeof node === 'object' && 'anchor' in node && node.anchor || isScalar(node) && node.tag) fail('REQ_YAML_UNSAFE'); });
  try { return document.toJS({ maxAliasCount: 0 }) as Record<string, unknown>; } catch { return fail('REQ_YAML_INVALID'); }
}

export function parseInstance(bytes: Uint8Array): RequirementInstance {
  const parsed = parse(bytes);
  const root = isObject(parsed) ? parsed : fail('REQ_STRUCTURE', 'root');
  keys(root, ['instance', 'context', 'clarifications', 'facts', 'hypotheses', 'framework', 'snapshot'], 'root');
  const instance = isObject(root.instance) ? root.instance : fail('REQ_STRUCTURE', 'instance');
  keys(instance, ['version', 'id', 'scene', 'title', 'createdAt', 'updatedAt'], 'instance');
  if (instance.version !== '0.1') fail('REQ_VERSION', 'instance.version');
  text(instance.id, 'instance.id'); text(instance.title, 'instance.title');
  if (!instanceIdPattern.test(instance.id as string)) fail('REQ_STRUCTURE', 'instance.id');
  one(instance.scene, SCENES, 'instance.scene');
  isoDate(instance.createdAt, 'instance.createdAt'); isoDate(instance.updatedAt, 'instance.updatedAt');

  const context = isObject(root.context) ? root.context : fail('REQ_STRUCTURE', 'context');
  keys(context, ['background', 'goal', 'decisionScenario'], 'context');
  const checkedContext = { background: text(context.background, 'context.background', true), goal: text(context.goal, 'context.goal', true), decisionScenario: text(context.decisionScenario, 'context.decisionScenario', true) };

  const clarificationIds = new Set<string>();
  const clarifications = list(root.clarifications, 'clarifications').map((value, index) => {
    const path = `clarifications.${index}`;
    const c = isObject(value) ? value : fail('REQ_STRUCTURE', path);
    keys(c, ['id', 'category', 'priority', 'question', 'rationale', 'answer', 'status', 'linkedHypothesisId'], path);
    if (!clarifIdPattern.test(String(c.id))) fail('REQ_STRUCTURE', `${path}.id`);
    if (clarificationIds.has(c.id as string)) fail('REQ_DUPLICATE_IDENTITY', `${path}.id`);
    clarificationIds.add(c.id as string);
    one(c.category, CATEGORIES, `${path}.category`);
    one(c.priority, PRIORITIES, `${path}.priority`);
    one(c.status, CLARIFICATION_STATUSES, `${path}.status`);
    text(c.question, `${path}.question`); text(c.rationale, `${path}.rationale`, true);
    const status = c.status as ClarificationStatus;
    let answer: string | undefined, linkedHypothesisId: string | undefined;
    if (c.answer !== undefined) answer = text(c.answer, `${path}.answer`);
    if (c.linkedHypothesisId !== undefined) linkedHypothesisId = text(c.linkedHypothesisId, `${path}.linkedHypothesisId`);
    if (status === 'answered' && answer === undefined) fail('REQ_STRUCTURE', `${path}.answer`);
    if (status === 'assumed' && linkedHypothesisId === undefined) fail('REQ_STRUCTURE', `${path}.linkedHypothesisId`);
    return { id: c.id as string, category: c.category as string, priority: c.priority as ClarificationPriority, question: c.question as string, rationale: c.rationale as string, status, ...(answer !== undefined ? { answer } : {}), ...(linkedHypothesisId !== undefined ? { linkedHypothesisId } : {}) };
  });

  const hypothesisIds = new Set<string>();
  const hypotheses = list(root.hypotheses, 'hypotheses').map((value, index) => {
    const path = `hypotheses.${index}`;
    const h = isObject(value) ? value : fail('REQ_STRUCTURE', path);
    keys(h, ['id', 'statement', 'evidence', 'validationCondition', 'status'], path);
    if (!hypothesisIdPattern.test(String(h.id))) fail('REQ_STRUCTURE', `${path}.id`);
    if (hypothesisIds.has(h.id as string)) fail('REQ_DUPLICATE_IDENTITY', `${path}.id`);
    hypothesisIds.add(h.id as string);
    one(h.status, HYPOTHESIS_STATUSES, `${path}.status`);
    return { id: h.id as string, statement: text(h.statement, `${path}.statement`), evidence: text(h.evidence, `${path}.evidence`, true), validationCondition: text(h.validationCondition, `${path}.validationCondition`, true), status: h.status as HypothesisStatus };
  });

  for (const item of clarifications) if (item.linkedHypothesisId !== undefined && !hypothesisIds.has(item.linkedHypothesisId)) fail('REQ_DANGLING_REFERENCE', `clarifications.${item.id}.linkedHypothesisId`);

  let framework: FrameworkDocument | undefined;
  if (root.framework !== undefined) {
    const f = isObject(root.framework) ? root.framework : fail('REQ_STRUCTURE', 'framework');
    keys(f, ['metrics', 'dataNeeds', 'analysisPaths', 'reportFramework', 'openQuestions', 'risks'], 'framework');
    const metrics = list(f.metrics, 'framework.metrics').map((value, index) => {
      const path = `framework.metrics.${index}`;
      const m = isObject(value) ? value : fail('REQ_STRUCTURE', path);
      keys(m, ['name', 'definition', 'dimensions', 'source'], path);
      return { name: text(m.name, `${path}.name`), definition: text(m.definition, `${path}.definition`), dimensions: strings(m.dimensions, `${path}.dimensions`, true), source: text(m.source, `${path}.source`) };
    });
    const tables = new Set<string>();
    const dataNeeds = list(f.dataNeeds, 'framework.dataNeeds').map((value, index) => {
      const path = `framework.dataNeeds.${index}`;
      const d = isObject(value) ? value : fail('REQ_STRUCTURE', path);
      keys(d, ['table', 'fields', 'priority', 'purpose'], path);
      const table = text(d.table, `${path}.table`);
      if (tables.has(table)) fail('REQ_DUPLICATE_IDENTITY', `${path}.table`);
      tables.add(table);
      one(d.priority, DATA_PRIORITIES, `${path}.priority`);
      return { table, fields: strings(d.fields, `${path}.fields`, true), priority: d.priority as DataNeedPriority, purpose: text(d.purpose, `${path}.purpose`, true) };
    });
    const analysisPaths = list(f.analysisPaths, 'framework.analysisPaths').map((value, index) => {
      const path = `framework.analysisPaths.${index}`;
      const a = isObject(value) ? value : fail('REQ_STRUCTURE', path);
      keys(a, ['question', 'hypothesis', 'method', 'requiredData', 'expectedOutput'], path);
      return { question: text(a.question, `${path}.question`), hypothesis: text(a.hypothesis, `${path}.hypothesis`, true), method: text(a.method, `${path}.method`, true), requiredData: strings(a.requiredData, `${path}.requiredData`, true), expectedOutput: text(a.expectedOutput, `${path}.expectedOutput`, true) };
    });
    for (const [index, item] of analysisPaths.entries()) {
      if (item.hypothesis !== '' && !hypothesisIds.has(item.hypothesis)) fail('REQ_DANGLING_REFERENCE', `framework.analysisPaths.${index}.hypothesis`);
      for (const [field, table] of item.requiredData.entries()) if (!tables.has(table)) fail('REQ_DANGLING_REFERENCE', `framework.analysisPaths.${index}.requiredData.${field}`);
    }
    const reportFramework = list(f.reportFramework, 'framework.reportFramework').map((value, index) => {
      const path = `framework.reportFramework.${index}`;
      const r = isObject(value) ? value : fail('REQ_STRUCTURE', path);
      keys(r, ['section', 'purpose', 'keyQuestions', 'evidence', 'zeroHallucinationCheck'], path);
      return { section: text(r.section, `${path}.section`), purpose: text(r.purpose, `${path}.purpose`, true), keyQuestions: strings(r.keyQuestions, `${path}.keyQuestions`, true), evidence: strings(r.evidence, `${path}.evidence`, true), zeroHallucinationCheck: text(r.zeroHallucinationCheck, `${path}.zeroHallucinationCheck`) };
    });
    framework = { metrics, dataNeeds, analysisPaths, reportFramework, openQuestions: strings(f.openQuestions, 'framework.openQuestions', true), risks: strings(f.risks, 'framework.risks', true) };
  }

  let snapshot: SnapshotRef | undefined;
  if (root.snapshot !== undefined) {
    const s = isObject(root.snapshot) ? root.snapshot : fail('REQ_STRUCTURE', 'snapshot');
    keys(s, ['fingerprint', 'confirmedAt', 'upstreamDigest', 'confirmedBy'], 'snapshot');
    if (!sha256Pattern.test(String(s.fingerprint))) fail('REQ_STRUCTURE', 'snapshot.fingerprint');
    if (!digestPattern.test(String(s.upstreamDigest))) fail('REQ_STRUCTURE', 'snapshot.upstreamDigest');
    snapshot = { fingerprint: s.fingerprint as string, confirmedAt: isoDate(s.confirmedAt, 'snapshot.confirmedAt'), upstreamDigest: s.upstreamDigest as string, confirmedBy: text(s.confirmedBy, 'snapshot.confirmedBy') };
  }

  return {
    instance: { version: '0.1', id: instance.id as string, scene: instance.scene as Scene, title: instance.title as string, createdAt: instance.createdAt as string, updatedAt: instance.updatedAt as string },
    context: checkedContext, clarifications, facts: strings(root.facts, 'facts', true), hypotheses,
    ...(framework ? { framework } : {}), ...(snapshot ? { snapshot } : {}),
  };
}

/** Everything the confirm gate freezes. Framework and snapshot identity are downstream and excluded. */
export function upstreamOf(instance: RequirementInstance) {
  return { instance: { id: instance.instance.id, scene: instance.instance.scene, title: instance.instance.title }, context: instance.context, clarifications: instance.clarifications, facts: instance.facts, hypotheses: instance.hypotheses };
}
export const upstreamDigest = (instance: RequirementInstance): string => hash(canonicalYaml(upstreamOf(instance)));
export const upstreamFingerprint = (instance: RequirementInstance): string => 'sha256:' + upstreamDigest(instance);
export const isStale = (instance: RequirementInstance): boolean => instance.snapshot !== undefined && upstreamDigest(instance) !== instance.snapshot.upstreamDigest;

/** Derived open questions: unresolved clarifications and non-settled hypotheses never silently become facts. */
export function derivedOpenQuestions(instance: RequirementInstance): string[] {
  const items: string[] = [];
  for (const item of instance.clarifications) if (item.status === 'deferred' || item.status === 'skipped') items.push(`${item.question}（澄清 ${item.id}，状态：${item.status}，待确认）`);
  for (const item of instance.hypotheses) if (item.status === 'proposed' || item.status === 'deferred') items.push(`${item.statement}（假设 ${item.id}，状态：${item.status}，待验证）`);
  return items;
}

export type RapPublication = { rap: RapDocument; canonicalYamlText: string; packageFingerprint: string; contentFingerprint: string; bytesSha256: string; bytes: number };

function rapContent(rap: RapDocument): Record<string, unknown> {
  // Release metadata (timestamp, publisher) and the fingerprint itself stay out of
  // both fingerprints so rebuilding the same confirmed content is byte-stable.
  return { ...rap, id: '', version: '', releasedAt: '', releasedBy: '', fingerprint: '' };
}

export function buildRapPublication(instance: RequirementInstance, version: string, releasedBy: string): RapPublication {
  // Publication is the only path into the release library: revalidate the whole
  // instance so post-load mutations cannot smuggle dangling references in.
  const checked = parseInstance(new Uint8Array(Buffer.from(canonicalInstanceYaml(instance), 'utf8')));
  const snapshot = checked.snapshot ?? fail('REQ_SNAPSHOT_REQUIRED');
  const framework = checked.framework ?? fail('REQ_FRAMEWORK_REQUIRED');
  const missingSections = missingFrameworkSections(framework);
  if (missingSections.length) fail('REQ_FRAMEWORK_REQUIRED', `framework.${missingSections[0]}`);
  if (isStale(checked)) return fail('REQ_STALE_SNAPSHOT');
  if (!semverPattern.test(version)) return fail('REQ_STRUCTURE', 'version');
  if (!releasedBy.trim() || releasedBy.length > 200) return fail('REQ_STRUCTURE', 'releasedBy');
  const derived = derivedOpenQuestions(checked);
  const openQuestions = [...derived, ...framework.openQuestions.filter(item => !derived.includes(item))];
  const rap: RapDocument = {
    rap: '0.2', id: checked.instance.id, version, releasedAt: new Date().toISOString(), releasedBy: releasedBy.trim(), fingerprint: '',
    instance: { scene: checked.instance.scene, title: checked.instance.title },
    context: checked.context, confirmation: snapshot,
    clarifications: checked.clarifications, confirmedFacts: checked.facts, assumptions: checked.hypotheses,
    metrics: framework.metrics, dataNeeds: framework.dataNeeds, analysisPaths: framework.analysisPaths,
    reportFramework: framework.reportFramework, openQuestions, risks: framework.risks,
  };
  const content = rapContent(rap);
  const contentFingerprint = 'sha256:' + hash(canonicalYaml(content));
  const packageFingerprint = 'sha256:' + hash(canonicalYaml({ ...content, id: rap.id, version: rap.version }));
  const withFingerprint: RapDocument = { ...rap, fingerprint: packageFingerprint };
  const canonicalYamlText = canonicalYaml(withFingerprint);
  return { rap: withFingerprint, canonicalYamlText, packageFingerprint, contentFingerprint, bytesSha256: hash(canonicalYamlText), bytes: Buffer.byteLength(canonicalYamlText, 'utf8') };
}
