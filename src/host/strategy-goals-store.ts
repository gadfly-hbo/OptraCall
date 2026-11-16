import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import type { GoalAdoptionInput, GoalDraftInput, GoalFeedback, GoalFeedbackInput, GoalMutation, GoalOperationReceipt, GoalRef, GoalRelation, GoalRelationInput, GoalRelationRevisionInput, GoalRelationVersion, GoalRevisionInput, GoalSourceRef, GoalVersion, StrategyGoalRecord, StrategyGoalsIndex } from './strategy-goals-types.ts';

export class StrategyGoalsError extends Error {
  readonly code: string;
  readonly status: number;
  constructor(code: string, status = 400) { super(code); this.code = code; this.status = status; }
}
function fail(code: string, status = 400): never { throw new StrategyGoalsError(code, status); }
const object = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const text = (v: unknown, max = 4000): string => typeof v === 'string' && v.trim() && v.length <= max ? v.trim() : fail('invalid_strategy_goal');
const uuid = (v: unknown): string => typeof v === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(v) ? v : fail('invalid_strategy_goal_id');
const positive = (v: unknown): number => typeof v === 'number' && Number.isSafeInteger(v) && v > 0 ? v : fail('invalid_strategy_goal_version');
const canonical = (v: unknown): string => Array.isArray(v) ? `[${v.map(canonical).join(',')}]` : object(v) ? `{${Object.keys(v).filter(k => v[k] !== undefined).sort().map(k => `${JSON.stringify(k)}:${canonical(v[k])}`).join(',')}}` : JSON.stringify(v);
type StoredIndex = StrategyGoalsIndex & { schemaVersion: 1; operations: GoalOperationReceipt[] };
const empty = (): StoredIndex => ({ schemaVersion: 1, goals: [], relations: [], feedback: [], operations: [] });
const MAX_BYTES = 4 * 1024 * 1024;
function goalRef(value: GoalRef): GoalRef {
  if (!object(value)) fail('invalid_strategy_goal_reference');
  return { goalId: uuid(value.goalId), version: positive(value.version) };
}
function adopted(index: StoredIndex, ref: GoalRef): GoalVersion {
  const version = index.goals.find(x => x.id === ref.goalId)?.versions.find(x => x.version === ref.version);
  if (!version) fail('strategy_goal_version_not_found', 404);
  if (version.status !== 'adopted') fail('strategy_goal_not_adopted', 409);
  return version;
}
function relationInput(input: GoalRelationInput): GoalRelationInput {
  if (!object(input) || !['supports', 'necessary-condition', 'contribution', 'strategy'].includes(input.kind)) fail('invalid_strategy_goal_relation');
  const from = goalRef(input.from), to = goalRef(input.to);
  if (from.goalId === to.goalId && from.version === to.version) fail('invalid_strategy_goal_relation');
  return { from, to, kind: input.kind, responsibility: text(input.responsibility), rationale: text(input.rationale) };
}
function sourceRef(input: GoalSourceRef): GoalSourceRef {
  if (!object(input) || !['case', 'decision-board', 'project', 'task', 'sap-metric'].includes(input.authority)) fail('invalid_strategy_goal_source');
  const version = typeof input.version === 'string' ? text(input.version, 200) : positive(input.version);
  if (['latest', 'current'].includes(String(version).toLowerCase())) fail('invalid_strategy_goal_source');
  const sha256 = input.sha256;
  if (sha256 !== undefined && (typeof sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(sha256))) fail('invalid_strategy_goal_source');
  return { authority: input.authority, id: text(input.id, 300), version, ...(input.projectId === undefined ? {} : { projectId: uuid(input.projectId) }), ...(input.taskId === undefined ? {} : { taskId: uuid(input.taskId) }), ...(sha256 === undefined ? {} : { sha256 }) };
}
function feedbackInput(input: GoalFeedbackInput): GoalFeedbackInput {
  if (!object(input) || !['execution', 'strategy', 'strategic-assumption'].includes(input.level)) fail('invalid_strategy_goal_feedback');
  return { goal: goalRef(input.goal), level: input.level, source: sourceRef(input.source), note: text(input.note) };
}
function feedbackIdentity(input: GoalFeedbackInput): string {
  const body = feedbackInput(input), source = body.source;
  // Exact Board authorization/feedback IDs already name their action Task.
  // Keep stored refs and request hashes intact; omit only this redundant claim
  // when comparing a qualified current ref with its older optional-field form.
  if (source.authority === 'decision-board' && typeof source.version === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(source.version) && source.taskId === source.id) {
    const { taskId: _, ...authority } = source;
    return canonical({ ...body, source: authority });
  }
  return canonical(body);
}

function draft(input: GoalDraftInput): GoalDraftInput {
  if (!object(input) || !['profit', 'nonprofit', 'personal'].includes(input.perspective) || !object(input.scope) || !['enterprise', 'department', 'personal'].includes(input.scope.kind) || !object(input.measurement) || !object(input.baseline) || !['known', 'pending'].includes(input.baseline.state)) fail('invalid_strategy_goal');
  const measurement = input.measurement.kind === 'quantitative' ? (() => {
    if (!object(input.measurement.sapMetric) || input.measurement.sapMetric.authority !== 'sap-metric') fail('invalid_strategy_goal_metric');
    const version = text(input.measurement.sapMetric.version, 200);
    if (['latest', 'current'].includes(version.toLowerCase())) fail('invalid_strategy_goal_metric');
    return { kind: 'quantitative' as const, sapMetric: { authority: 'sap-metric' as const, id: text(input.measurement.sapMetric.id, 300), version, ...(input.measurement.sapMetric.metricName === undefined ? {} : { metricName: text(input.measurement.sapMetric.metricName, 200) }) }, ...(input.measurement.target === undefined ? {} : { target: text(input.measurement.target) }) };
  })() : input.measurement.kind === 'deliverable' ? { kind: 'deliverable' as const, criterion: text(input.measurement.criterion) } : fail('invalid_strategy_goal_measurement');
  const list = (value: unknown) => {
    if (value === undefined) return undefined;
    if (!Array.isArray(value) || value.length > 100) fail('invalid_strategy_goal');
    return value.map(x => text(x));
  };
  const value: GoalDraftInput = {
    title: text(input.title, 300), outcome: text(input.outcome), perspective: input.perspective,
    scope: { kind: input.scope.kind, id: text(input.scope.id, 300), name: text(input.scope.name, 300), ...(input.scope.enterpriseId === undefined ? {} : { enterpriseId: uuid(input.scope.enterpriseId) }) }, measurement,
    baseline: { state: input.baseline.state, description: text(input.baseline.description) }, responsible: text(input.responsible, 300),
    ...(input.bscPerspective === undefined ? {} : { bscPerspective: text(input.bscPerspective, 300) }),
    ...(input.dueAt === undefined ? {} : { dueAt: text(input.dueAt, 100) }),
    ...(input.strategies === undefined ? {} : { strategies: list(input.strategies) }),
    ...(input.resources === undefined ? {} : { resources: list(input.resources) }),
    ...(input.necessaryConditions === undefined ? {} : { necessaryConditions: list(input.necessaryConditions) }),
    ...(input.source === undefined ? {} : { source: sourceRef(input.source) }),
  };
  if (value.dueAt && !Number.isFinite(Date.parse(value.dueAt))) fail('invalid_strategy_goal_due_date');
  return value;
}

/** Goal versions are owned here; SAP measurement bodies and business facts stay in their original authorities. */
export class StrategyGoalsStore {
  readonly dataRoot: string;
  readonly root: string;
  readonly file: string;
  constructor(dataRoot: string) { this.dataRoot = path.resolve(dataRoot); this.root = path.join(this.dataRoot, 'strategy-goals'); this.file = path.join(this.root, 'index.json'); }
  private directory(name: string, create: boolean): boolean {
    let stat: fs.Stats;
    try { stat = fs.lstatSync(name); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') return fail('strategy_goals_storage_unavailable', 503); if (!create) return false; fs.mkdirSync(name, { recursive: true, mode: 0o700 }); stat = fs.lstatSync(name); }
    if (!stat.isDirectory() || stat.isSymbolicLink()) fail('unsafe_strategy_goals_storage', 503);
    return true;
  }
  private load(ownLock = false): StoredIndex {
    if (!this.directory(this.dataRoot, false) || !this.directory(this.root, false)) return empty();
    let before: fs.BigIntStats;
    try { before = fs.lstatSync(this.file, { bigint: true }); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT' && fs.readdirSync(this.root).every(name => ownLock && name === '.write.lock')) return empty(); return fail('strategy_goals_storage_unavailable', 503); }
    if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1n || before.size > BigInt(MAX_BYTES)) fail('unsafe_strategy_goals_storage', 503);
    const fd = fs.openSync(this.file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
    try {
      const initial = fs.fstatSync(fd, { bigint: true });
      if (initial.ino !== before.ino || initial.dev !== before.dev || initial.nlink !== 1n || initial.size !== before.size) fail('strategy_goals_storage_changed', 503);
      const bytes = fs.readFileSync(fd), after = fs.fstatSync(fd, { bigint: true }), current = fs.lstatSync(this.file, { bigint: true });
      if (BigInt(bytes.length) !== initial.size || after.mtimeNs !== initial.mtimeNs || after.ctimeNs !== initial.ctimeNs || current.ino !== initial.ino || current.dev !== initial.dev || current.nlink !== 1n) fail('strategy_goals_storage_changed', 503);
      const value: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
      if (!object(value) || value.schemaVersion !== 1 || !Array.isArray(value.goals) || !Array.isArray(value.relations) || !Array.isArray(value.feedback) || !Array.isArray(value.operations)) fail('invalid_strategy_goals_storage', 503);
      const index = value as unknown as StoredIndex, ids = new Set<string>();
      for (const record of index.goals) {
        uuid(record.id); positive(record.currentVersion);
        if (ids.has(record.id) || !Array.isArray(record.versions) || record.versions.length !== record.currentVersion) fail('invalid_strategy_goals_storage', 503);
        ids.add(record.id);
        for (const [i, version] of record.versions.entries()) {
          if (version.goalId !== record.id || version.version !== i + 1 || !['candidate', 'adopted'].includes(version.status) || !Number.isFinite(Date.parse(version.createdAt))) fail('invalid_strategy_goals_storage', 503);
          draft(version);
          if (version.status === 'adopted' ? !Number.isFinite(Date.parse(version.adoptedAt!)) || !text(version.adoptionDecision) : version.adoptedAt !== undefined || version.adoptionDecision !== undefined) fail('invalid_strategy_goals_storage', 503);
        }
        if (record.adoptedVersion !== null && !record.versions.some(v => v.version === record.adoptedVersion && v.status === 'adopted')) fail('invalid_strategy_goals_storage', 503);
      }
      const relationIds = new Set<string>();
      for (const relation of index.relations) {
        uuid(relation.id); positive(relation.revision);
        if (relationIds.has(relation.id) || !Array.isArray(relation.history) || relation.history.length !== relation.revision - 1) fail('invalid_strategy_goals_storage', 503);
        relationIds.add(relation.id);
        for (const [i, version] of [...relation.history, relation].entries()) {
          relationInput(version); adopted(index, version.from); adopted(index, version.to);
          if (version.revision !== i + 1 || !Number.isFinite(Date.parse(version.createdAt))) fail('invalid_strategy_goals_storage', 503);
        }
      }
      const feedbackIds = new Set<string>();
      for (const feedback of index.feedback) {
        uuid(feedback.id); feedbackInput(feedback); adopted(index, feedback.goal);
        if (feedbackIds.has(feedback.id) || !Number.isFinite(Date.parse(feedback.createdAt))) fail('invalid_strategy_goals_storage', 503);
        feedbackIds.add(feedback.id);
      }
      const operationIds = new Set<string>();
      for (const operation of index.operations) {
        uuid(operation.operationId);
        if (operationIds.has(operation.operationId) || !/^[a-f0-9]{64}$/.test(operation.requestHash) || !['create', 'revise', 'adopt', 'relate', 'revise-relation', 'feedback'].includes(operation.kind) || !Number.isFinite(Date.parse(operation.completedAt)) || !object(operation.result)) fail('invalid_strategy_goals_storage', 503);
        operationIds.add(operation.operationId);
        if (['create', 'revise', 'adopt'].includes(operation.kind)) {
          const result = operation.result as GoalVersion; goalRef(result); draft(result);
          const current = index.goals.find(x => x.id === result.goalId)?.versions.find(x => x.version === result.version);
          if (!current || canonical(draft(current)) !== canonical(draft(result)) || current.createdAt !== result.createdAt || !['candidate', 'adopted'].includes(result.status)) fail('invalid_strategy_goals_storage', 503);
        } else if (operation.kind === 'feedback') {
          const current = index.feedback.find(x => x.id === (operation.result as GoalFeedback).id);
          if (!current || canonical(current) !== canonical(operation.result)) fail('invalid_strategy_goals_storage', 503);
        } else {
          const result = operation.result as GoalRelation, current = index.relations.find(x => x.id === result.id);
          const version = current?.revision === result.revision ? current : current?.history.find(x => x.revision === result.revision);
          if (!version || canonical(relationInput(version)) !== canonical(relationInput(result)) || version.createdAt !== result.createdAt) fail('invalid_strategy_goals_storage', 503);
        }
      }
      return index;
    } catch (error) { if (error instanceof StrategyGoalsError && ['strategy_goals_storage_changed', 'unsafe_strategy_goals_storage'].includes(error.code)) throw error; return fail('invalid_strategy_goals_storage', 503); }
    finally { fs.closeSync(fd); }
  }
  private write(index: StoredIndex): void {
    this.directory(this.dataRoot, true); this.directory(this.root, true);
    const bytes = Buffer.from(JSON.stringify(index, null, 2) + '\n');
    if (bytes.length > MAX_BYTES) fail('strategy_goals_too_large', 413);
    const temp = `${this.file}.${randomUUID()}.tmp`, fd = fs.openSync(temp, fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_WRONLY | fs.constants.O_NOFOLLOW, 0o600);
    try { fs.writeFileSync(fd, bytes); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    try { fs.renameSync(temp, this.file); const dir = fs.openSync(this.root, 'r'); try { fs.fsyncSync(dir); } finally { fs.closeSync(dir); } }
    catch { fail('strategy_goals_write_unknown', 503); }
    finally { if (fs.existsSync(temp)) fs.unlinkSync(temp); }
  }
  private mutate<T extends GoalOperationReceipt['result']>(operationId: string, kind: GoalOperationReceipt['kind'], request: unknown, apply: (index: StoredIndex) => T): T {
    uuid(operationId);
    this.directory(this.dataRoot, true); this.directory(this.root, true);
    const lock = path.join(this.root, '.write.lock'), token = randomUUID();
    let fd: number;
    try { fd = fs.openSync(lock, fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_WRONLY | fs.constants.O_NOFOLLOW, 0o600); }
    catch { return fail('strategy_goals_locked', 503); }
    const lockStat = fs.fstatSync(fd);
    try {
      fs.writeFileSync(fd, token); fs.fsyncSync(fd);
      const index = this.load(true), requestHash = createHash('sha256').update(canonical({ kind, request })).digest('hex');
      const previous = index.operations.find(x => x.operationId === operationId);
      if (previous) {
        if (previous.requestHash !== requestHash || previous.kind !== kind) fail('strategy_goal_operation_conflict', 409);
        return structuredClone(previous.result) as T;
      }
      const result = apply(index);
      index.operations.push({ operationId, kind, requestHash, completedAt: new Date().toISOString(), result: structuredClone(result) });
      this.write(index); return structuredClone(result);
    } finally {
      fs.closeSync(fd);
      const current = fs.lstatSync(lock);
      if (!current.isFile() || current.isSymbolicLink() || current.ino !== lockStat.ino || current.dev !== lockStat.dev || fs.readFileSync(lock, 'utf8') !== token) fail('strategy_goals_lock_changed', 503);
      fs.unlinkSync(lock);
    }
  }
  list(): StrategyGoalsIndex { const { schemaVersion: _, operations: __, ...value } = this.load(); return structuredClone(value); }
  getOperation(id: string): GoalOperationReceipt | null { return structuredClone(this.load().operations.find(x => x.operationId === uuid(id)) ?? null); }
  get(id: string): StrategyGoalRecord {
    const record = this.load().goals.find(x => x.id === uuid(id));
    return record ? structuredClone(record) : fail('strategy_goal_not_found', 404);
  }
  read(ref: GoalRef): GoalVersion {
    const value = this.get(ref.goalId).versions.find(x => x.version === positive(ref.version));
    return value ? structuredClone(value) : fail('strategy_goal_version_not_found', 404);
  }
  relate(input: GoalRelationInput & GoalMutation): GoalRelation {
    const body = relationInput(input);
    return this.mutate(input.operationId, 'relate', body, index => {
      adopted(index, body.from); adopted(index, body.to);
      const existing = index.relations.find(x => canonical(relationInput(x)) === canonical(body));
      if (existing) return existing;
      const value: GoalRelation = { ...body, id: randomUUID(), revision: 1, createdAt: new Date().toISOString(), history: [] };
      index.relations.push(value); return value;
    });
  }
  readRelation(id: string, revision: number): GoalRelationVersion {
    const relation = this.load().relations.find(x => x.id === uuid(id));
    if (!relation) fail('strategy_goal_relation_not_found', 404);
    positive(revision);
    const value = relation.revision === revision ? relation : relation.history.find(x => x.revision === revision);
    if (!value) fail('strategy_goal_relation_version_not_found', 404);
    return structuredClone({ ...relationInput(value), revision: value.revision, createdAt: value.createdAt });
  }
  reviseRelation(id: string, input: GoalRelationRevisionInput): GoalRelation {
    uuid(id); positive(input.expectedRevision);
    const body = relationInput(input);
    return this.mutate(input.operationId, 'revise-relation', { id, body, expectedRevision: input.expectedRevision }, index => {
      const relation = index.relations.find(x => x.id === id);
      if (!relation) fail('strategy_goal_relation_not_found', 404);
      if (relation.revision !== input.expectedRevision) fail('strategy_goal_relation_conflict', 409);
      adopted(index, body.from); adopted(index, body.to);
      relation.history.push({ ...relationInput(relation), revision: relation.revision, createdAt: relation.createdAt });
      Object.assign(relation, body, { revision: relation.revision + 1, createdAt: new Date().toISOString() });
      return relation;
    });
  }
  recordFeedback(input: GoalFeedbackInput & GoalMutation): GoalFeedback {
    const body = feedbackInput(input), identity = feedbackIdentity(body);
    return this.mutate(input.operationId, 'feedback', body, index => {
      adopted(index, body.goal);
      const existing = index.feedback.find(x => feedbackIdentity(x) === identity);
      if (existing) return existing;
      const value: GoalFeedback = { ...body, id: randomUUID(), createdAt: new Date().toISOString() };
      index.feedback.push(value); return value;
    });
  }
  adopt(ref: GoalRef, input: GoalAdoptionInput): GoalVersion {
    uuid(input.operationId); positive(input.expectedVersion); uuid(ref.goalId); positive(ref.version);
    const decision = text(input.decision);
    return this.mutate(input.operationId, 'adopt', { ref, expectedVersion: input.expectedVersion, decision }, index => {
      const record = index.goals.find(x => x.id === ref.goalId);
      if (!record) fail('strategy_goal_not_found', 404);
      if (record.currentVersion !== input.expectedVersion) fail('strategy_goal_conflict', 409);
      const version = record.versions.find(x => x.version === ref.version);
      if (!version) fail('strategy_goal_version_not_found', 404);
      if (version.status === 'adopted') return version;
      version.status = 'adopted'; version.adoptedAt = new Date().toISOString(); version.adoptionDecision = decision;
      record.adoptedVersion = version.version; return version;
    });
  }
  revise(id: string, input: GoalRevisionInput): GoalVersion {
    uuid(id); uuid(input.operationId); positive(input.expectedVersion);
    const body = draft(input);
    return this.mutate(input.operationId, 'revise', { id, body, expectedVersion: input.expectedVersion }, index => {
      const record = index.goals.find(x => x.id === id);
      if (!record) fail('strategy_goal_not_found', 404);
      if (record.currentVersion !== input.expectedVersion) fail('strategy_goal_conflict', 409);
      const value: GoalVersion = { ...body, goalId: id, version: record.currentVersion + 1, status: 'candidate', createdAt: new Date().toISOString() };
      record.versions.push(value); record.currentVersion = value.version; return value;
    });
  }
  create(input: GoalDraftInput & GoalMutation): GoalVersion {
    uuid(input.operationId);
    const body = draft(input);
    return this.mutate(input.operationId, 'create', body, index => {
      const id = randomUUID(), value: GoalVersion = { ...body, goalId: id, version: 1, status: 'candidate', createdAt: new Date().toISOString() };
      index.goals.push({ id, currentVersion: 1, adoptedVersion: null, versions: [value] }); return value;
    });
  }
}
