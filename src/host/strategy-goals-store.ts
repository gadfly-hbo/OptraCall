import { parseStructuredGoal, groupScopeKey } from './structured-goal.ts';
import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { parseUserQuoteProvenance } from '../agent/quoted-decisions.ts';
import { parseBusinessRoleOwner, businessRoleConversationId } from './business-role-conversations.ts';
import { parseUsageContext } from './usage-context-types.ts';
import { parseGoalBasis } from './strategy-goals-types.ts';
import type { GoalActionArrangement, GoalArrangementInput } from './strategy-goals-types.ts';
import type { GoalAdoptionInput, GoalAdoptionProvenance, GoalBasis, GoalContextSnapshot, GoalDraftInput, GoalFeedback, GoalFeedbackInput, GoalMutation, GoalOperationReceipt, GoalRef, GoalRelation, GoalRelationInput, GoalRelationRevisionInput, GoalRelationVersion, GoalRevisionInput, GoalSourceRef, GoalVersion, StrategyGoalRecord, StrategyGoalsIndex } from './strategy-goals-types.ts';
import type { StrategyMapPublicationIdentity } from './strategy-map-types.ts';

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
type TableGoalRef = GoalRef & { publication?: StrategyMapPublicationIdentity };
type GoalTableRow = { input: GoalDraftInput; expected: GoalRef | null };
type StoredIndex = StrategyGoalsIndex & { schemaVersion: 1 | 2 | 3; tableReceipts?: Record<string,TableGoalRef[]>; operations: GoalOperationReceipt[] };
const empty = (): StoredIndex => ({ schemaVersion: 1, goals: [], relations: [], feedback: [], operations: [] });
const MAX_BYTES = 4 * 1024 * 1024;
function goalRef(value: GoalRef): GoalRef {
  if (!object(value)) fail('invalid_strategy_goal_reference');
  return { goalId: uuid(value.goalId), version: positive(value.version) };
}
const goalRefKey = (ref: GoalRef) => `${ref.goalId}:${ref.version}`;
function parseTablePublication(value: unknown): StrategyMapPublicationIdentity {
  if (!object(value) || Object.keys(value).length !== 2 || typeof value.publishedAt !== 'string')
    fail('invalid_strategy_map_publication_receipt');
  const timestamp = Date.parse(value.publishedAt);
  if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString() !== value.publishedAt)
    fail('invalid_strategy_map_publication_receipt');
  return { publicationId: uuid(value.publicationId), publishedAt: value.publishedAt };
}
function arrangementInput(input: GoalArrangementInput): GoalArrangementInput {
  if (!object(input) || !Array.isArray(input.checks) || input.checks.length > 20 || !Array.isArray(input.actions) || input.actions.length < 1 || input.actions.length > 20 || !object(input.source)) fail('invalid_strategy_goal_arrangement');
  const quoteProvenance = parseUserQuoteProvenance(input.quoteProvenance), projectId = uuid(input.projectId);
  if (quoteProvenance.projectId !== projectId) fail('invalid_strategy_goal_arrangement');
  const source = input.source;
  if ('kind' in source) {
    if (source.kind !== 'work' || source.projectId !== projectId || source.taskId !== quoteProvenance.taskId || source.requestId !== quoteProvenance.requestId) fail('invalid_strategy_goal_arrangement');
    uuid(source.projectId); uuid(source.taskId); uuid(source.requestId);
    if (source.workContext) {
      uuid(source.workContext.confirmationId); positive(source.workContext.planVersion); text(source.workContext.taskKey, 200);
      if (canonical(goalRef(source.workContext.goal)) !== canonical(goalRef(input.goal))) fail('invalid_strategy_goal_arrangement');
    }
  } else {
    uuid(source.caseStoreId); uuid(source.caseId); uuid(source.choiceId);
    if (!object(source.strategyRef) || source.strategyRef.type !== 'case-decision' || source.strategyRef.caseStoreId !== source.caseStoreId || source.strategyRef.caseId !== source.caseId) fail('invalid_strategy_goal_arrangement');
    uuid(source.strategyRef.recordId); positive(source.strategyRef.revision);
  }
  const actions = input.actions.map(action => {
    if (!object(action) || typeof action.created !== 'boolean' || !/^[a-f0-9]{64}$/.test(action.itemVersion) || !/^[a-f0-9]{64}$/.test(action.taskVersion)) fail('invalid_strategy_goal_arrangement');
    return { itemId: uuid(action.itemId), taskId: uuid(action.taskId), itemVersion: action.itemVersion, taskVersion: action.taskVersion, authorizationId: uuid(action.authorizationId), created: action.created };
  });
  if (new Set(actions.map(action => action.taskId)).size !== actions.length) fail('invalid_strategy_goal_arrangement');
  return { goal: goalRef(input.goal), projectId, title: text(input.title, 200), scope: text(input.scope), checks: input.checks.map(value => text(value, 2000)), actions, source: structuredClone(input.source), boardOperationId: uuid(input.boardOperationId), quoteProvenance };
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
export function parseGoalSourceRef(input: GoalSourceRef): GoalSourceRef {
  if (!object(input) || !['case', 'decision-board', 'project', 'task', 'sap-metric', 'strategy-discussion'].includes(input.authority)) fail('invalid_strategy_goal_source');
  const version = typeof input.version === 'string' ? text(input.version, 200) : positive(input.version);
  if (['latest', 'current'].includes(String(version).toLowerCase())) fail('invalid_strategy_goal_source');
  const sha256 = input.sha256;
  if (sha256 !== undefined && (typeof sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(sha256))) fail('invalid_strategy_goal_source');
  if (input.authority === 'strategy-discussion') {
    if (typeof version !== 'string' || !sha256 || typeof input.sessionId !== 'string' || !input.sessionId.trim() || input.sessionId.length > 200 || !['message', 'tool-result'].includes(input.entryType ?? '') || input.projectId !== undefined || input.taskId !== undefined || Object.keys(input).some(key => !['authority', 'id', 'version', 'sha256', 'sessionId', 'entryType'].includes(key))) fail('invalid_strategy_goal_source');
    return { authority: 'strategy-discussion', id: uuid(input.id), version, sessionId: input.sessionId, entryType: input.entryType, sha256 };
  }
  if (input.sessionId !== undefined || input.entryType !== undefined) fail('invalid_strategy_goal_source');
  return { authority: input.authority, id: text(input.id, 300), version, ...(input.projectId === undefined ? {} : { projectId: uuid(input.projectId) }), ...(input.taskId === undefined ? {} : { taskId: uuid(input.taskId) }), ...(sha256 === undefined ? {} : { sha256 }) };
}
const sourceRef = parseGoalSourceRef;
function strategyContext(input: GoalDraftInput['strategyContext']): NonNullable<GoalDraftInput['strategyContext']> {
  if (!object(input) || Object.keys(input).some(key => !['summary', 'methods', 'sources'].includes(key)) || input.methods !== undefined && (!Array.isArray(input.methods) || input.methods.length > 30) || input.sources !== undefined && (!Array.isArray(input.sources) || input.sources.length > 100)) fail('invalid_strategy_goal_context');
  return { summary: text(input.summary), ...(input.methods === undefined ? {} : { methods: input.methods.map(method => {
    if (!object(method) || Object.keys(method).some(key => !['id', 'name', 'source'].includes(key))) fail('invalid_strategy_goal_context');
    return { id: text(method.id, 200), name: text(method.name, 300), ...(method.source === undefined ? {} : { source: sourceRef(method.source) }) };
  }) }), ...(input.sources === undefined ? {} : { sources: input.sources.map(sourceRef) }) };
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

export function parseGoalRoleSuggestion(value: unknown): NonNullable<GoalDraftInput['roleSuggestion']> {
  if(!object(value) || Object.keys(value).some(k=>!['owner','discussionId','sessionId','entryId','sha256'].includes(k))) fail('invalid_goal_role_suggestion');
  const owner=parseBusinessRoleOwner(value.owner);
  if((owner.role!=='goal'&&owner.role!=='goal-draft')||value.discussionId!==businessRoleConversationId(owner)||
      typeof value.sha256!=='string'||!/^[0-9a-f]{64}$/.test(value.sha256)) fail('invalid_goal_role_suggestion');
  return {owner,discussionId:uuid(value.discussionId),sessionId:uuid(value.sessionId),entryId:text(value.entryId,200),sha256:value.sha256};
}
export { draft as parseGoalDraft };
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
  const choice = input.strategyChoice;
  if (choice !== undefined && (!object(choice) || typeof choice.contentSha256 !== 'string' || !/^[0-9a-f]{64}$/.test(choice.contentSha256))) fail('invalid_strategy_goal_context');
  const value: GoalDraftInput = {
    ...(input.structured===undefined?{}:{structured:(()=>{try{return parseStructuredGoal(input.structured);}catch{return fail('invalid_structured_goal');}})()}),
    ...(input.roleSuggestion===undefined?{}:{roleSuggestion:parseGoalRoleSuggestion(input.roleSuggestion)}),
    ...(choice ? {strategyChoice:{discussionId:uuid(choice.discussionId),version:positive(choice.version),contentSha256:choice.contentSha256}} : {}),
    title: text(input.title, 300), outcome: text(input.outcome), perspective: input.perspective,
    scope: { kind: input.scope.kind, id: text(input.scope.id, 300), name: text(input.scope.name, 300), ...(input.scope.enterpriseId === undefined ? {} : { enterpriseId: uuid(input.scope.enterpriseId) }) }, measurement,
    baseline: { state: input.baseline.state, description: text(input.baseline.description) }, responsible: text(input.responsible, 300),
    ...(input.bscPerspective === undefined ? {} : { bscPerspective: text(input.bscPerspective, 300) }),
    ...(input.dueAt === undefined ? {} : { dueAt: text(input.dueAt, 100) }),
    ...(input.strategies === undefined ? {} : { strategies: list(input.strategies) }),
    ...(input.resources === undefined ? {} : { resources: list(input.resources) }),
    ...(input.necessaryConditions === undefined ? {} : { necessaryConditions: list(input.necessaryConditions) }),
    ...(input.source === undefined ? {} : { source: sourceRef(input.source) }),
    ...(input.usageContext === undefined ? {} : { usageContext: parseUsageContext(input.usageContext) }),
    ...(input.strategyContext === undefined ? {} : { strategyContext: strategyContext(input.strategyContext) }),
  };
  if (value.dueAt && !Number.isFinite(Date.parse(value.dueAt))) fail('invalid_strategy_goal_due_date');
  return value;
}

/** Hashes the exact GoalRef and business content, so adopting it does not change the seen-content identity. */
export function goalContentSha256(value: GoalVersion): string {
  return createHash('sha256').update(canonical({ ...goalRef(value), ...draft(value) })).digest('hex');
}
/** Structural decoding only; the discussion adapter must separately bind the real user request and lease. */
export function parseGoalAdoptionProvenance(input: unknown): GoalAdoptionProvenance {
  const invalid = (): never => fail('invalid_strategy_goal_adoption_provenance');
  if (!object(input) || !['discussion-quote', 'ui-confirmation'].includes(input.kind as string) || Object.keys(input).some(key => !['kind', 'discussionId', 'sessionId', 'goalContentSha256', 'requestId', 'userEntryId', 'quoteStart', 'quoteEnd', 'quote', 'quoteSha256'].includes(key)) || typeof input.discussionId !== 'string' || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(input.discussionId) || typeof input.sessionId !== 'string' || !input.sessionId.trim() || input.sessionId.length > 200 || typeof input.goalContentSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(input.goalContentSha256)) return invalid();
  const base: GoalAdoptionProvenance = { kind: input.kind as GoalAdoptionProvenance['kind'], discussionId: input.discussionId, sessionId: input.sessionId, goalContentSha256: input.goalContentSha256 };
  if (input.kind === 'ui-confirmation') {
    if (['requestId', 'userEntryId', 'quoteStart', 'quoteEnd', 'quote', 'quoteSha256'].some(key => input[key] !== undefined)) return invalid();
    return base;
  }
  if (typeof input.requestId !== 'string' || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(input.requestId) || typeof input.userEntryId !== 'string' || !input.userEntryId.trim() || input.userEntryId.length > 200 || !Number.isSafeInteger(input.quoteStart) || Number(input.quoteStart) < 0 || !Number.isSafeInteger(input.quoteEnd) || Number(input.quoteEnd) <= Number(input.quoteStart) || typeof input.quote !== 'string' || !input.quote.trim() || input.quote.length > 20000 || Number(input.quoteEnd) - Number(input.quoteStart) !== input.quote.length || typeof input.quoteSha256 !== 'string' || input.quoteSha256 !== createHash('sha256').update(input.quote).digest('hex')) return invalid();
  return { ...base, requestId: input.requestId, userEntryId: input.userEntryId, quoteStart: Number(input.quoteStart), quoteEnd: Number(input.quoteEnd), quote: input.quote, quoteSha256: input.quoteSha256 };
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
      if (!object(value) || ![1, 2, 3].includes(value.schemaVersion as number) || !Array.isArray(value.goals) || !Array.isArray(value.relations) || !Array.isArray(value.feedback) || !Array.isArray(value.operations) || value.schemaVersion !== 1 && !Array.isArray(value.arrangements)) fail('invalid_strategy_goals_storage', 503);
      const index = value as unknown as StoredIndex, ids = new Set<string>();
      for (const record of index.goals) {
        uuid(record.id); positive(record.currentVersion);
        if (ids.has(record.id) || !Array.isArray(record.versions) || record.versions.length !== record.currentVersion) fail('invalid_strategy_goals_storage', 503);
        ids.add(record.id);
        for (const [i, version] of record.versions.entries()) {
          if (version.goalId !== record.id || version.version !== i + 1 || !['candidate', 'adopted'].includes(version.status) || !Number.isFinite(Date.parse(version.createdAt))) fail('invalid_strategy_goals_storage', 503);
          draft(version);
          if (version.status === 'adopted' ? !Number.isFinite(Date.parse(version.adoptedAt!)) || !text(version.adoptionDecision) : version.adoptedAt !== undefined || version.adoptionDecision !== undefined) fail('invalid_strategy_goals_storage', 503);
          if (version.adoptionProvenance !== undefined && (version.status !== 'adopted' || parseGoalAdoptionProvenance(version.adoptionProvenance).goalContentSha256 !== goalContentSha256(version))) fail('invalid_strategy_goals_storage', 503);
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
      const arrangementIds = new Set<string>();
      for (const arrangement of index.arrangements ?? []) {
        uuid(arrangement.id); arrangementInput(arrangement); adopted(index, arrangement.goal);
        if (arrangementIds.has(arrangement.id) || !Number.isFinite(Date.parse(arrangement.createdAt))) fail('invalid_strategy_goals_storage', 503);
        arrangementIds.add(arrangement.id);
      }
      for (const operation of index.operations) {
        uuid(operation.operationId);
        if (operationIds.has(operation.operationId) || !/^[a-f0-9]{64}$/.test(operation.requestHash) || !['create', 'revise', 'adopt', 'relate', 'revise-relation', 'feedback', 'arrange'].includes(operation.kind) || !Number.isFinite(Date.parse(operation.completedAt)) || !object(operation.result)) fail('invalid_strategy_goals_storage', 503);
        operationIds.add(operation.operationId);
        if (['create', 'revise', 'adopt'].includes(operation.kind)) {
          const result = operation.result as GoalVersion; goalRef(result); draft(result);
          if (result.adoptionProvenance !== undefined && (result.status !== 'adopted' || parseGoalAdoptionProvenance(result.adoptionProvenance).goalContentSha256 !== goalContentSha256(result))) fail('invalid_strategy_goals_storage', 503);
          const current = index.goals.find(x => x.id === result.goalId)?.versions.find(x => x.version === result.version);
          if (!current || canonical(draft(current)) !== canonical(draft(result)) || current.createdAt !== result.createdAt || !['candidate', 'adopted'].includes(result.status)) fail('invalid_strategy_goals_storage', 503);
        } else if (operation.kind === 'arrange') {
          const current = index.arrangements?.find(x => x.id === (operation.result as GoalActionArrangement).id);
          if (!current || canonical(current) !== canonical(operation.result)) fail('invalid_strategy_goals_storage', 503);
        } else if (operation.kind === 'feedback') {
          const current = index.feedback.find(x => x.id === (operation.result as GoalFeedback).id);
          if (!current || canonical(current) !== canonical(operation.result)) fail('invalid_strategy_goals_storage', 503);
        } else {
          const result = operation.result as GoalRelation, current = index.relations.find(x => x.id === result.id);
          const version = current?.revision === result.revision ? current : current?.history.find(x => x.revision === result.revision);
          if (!version || canonical(relationInput(version)) !== canonical(relationInput(result)) || version.createdAt !== result.createdAt) fail('invalid_strategy_goals_storage', 503);
        }
      }
      if(index.tableReceipts!==undefined){
        if(!object(index.tableReceipts))fail('invalid_strategy_goals_storage',503);
        const publicationBindings = new Map<string, StrategyMapPublicationIdentity>();
        for(const [key,refs] of Object.entries(index.tableReceipts)){
          const receipt=index.operations.find(r=>r.operationId===key);
          if(!receipt || receipt.kind!=='create'||!Array.isArray(refs)||!refs.length)fail('invalid_strategy_goals_storage',503);
          for(const ref of refs){
            const goal=index.goals.find(g=>g.id===ref.goalId)?.versions.find(v=>v.version===ref.version);
            if(!goal?.structured)fail('invalid_strategy_goals_storage',503);
            if(ref.publication===undefined)continue;
            if(!goal.structured.map)fail('invalid_strategy_goals_storage',503);
            const publication=parseTablePublication(ref.publication);
            const refKey=goalRefKey(ref),previous=publicationBindings.get(refKey);
            if(previous && canonical(previous)!==canonical(publication))fail('invalid_strategy_goals_storage',503);
            publicationBindings.set(refKey,publication);
          }
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
  private mutate<T extends GoalOperationReceipt['result']>(operationId: string, kind: GoalOperationReceipt['kind'], request: unknown, apply: (index: StoredIndex) => T, previousRequests: readonly unknown[] = []): T {
    uuid(operationId);
    this.directory(this.dataRoot, true); this.directory(this.root, true);
    const lock = path.join(this.root, '.write.lock'), token = randomUUID();
    let fd: number;
    try { fd = fs.openSync(lock, fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_WRONLY | fs.constants.O_NOFOLLOW, 0o600); }
    catch { return fail('strategy_goals_locked', 503); }
    const lockStat = fs.fstatSync(fd);
    try {
      fs.writeFileSync(fd, token); fs.fsyncSync(fd);
      const index = this.load(true);
      const fingerprint = (request: unknown) => createHash('sha256').update(canonical({ kind, request })).digest('hex');
      const requestHash = fingerprint(request);
      const previous = index.operations.find(x => x.operationId === operationId);
      if (previous) {
        if (previous.kind !== kind || (previous.requestHash !== requestHash && !previousRequests.some(value => fingerprint(value) === previous.requestHash))) fail('strategy_goal_operation_conflict', 409);
        return structuredClone(previous.result) as T;
      }
      const result = apply(index);
      // Existing versions are never rewritten on read; the first v1.2 write
      // marks the original authority's format and later writes never downgrade it.
      const v12 = (value: unknown): boolean => object(value) && (value.usageContext !== undefined || value.strategyContext !== undefined || value.adoptionProvenance !== undefined || object(value.source) && value.source.authority === 'strategy-discussion');
      if (v12(result)) { index.schemaVersion = 3; index.arrangements ??= []; }
      index.operations.push({ operationId, kind, requestHash, completedAt: new Date().toISOString(), result: structuredClone(result) });
      this.write(index); return structuredClone(result);
    } finally {
      fs.closeSync(fd);
      const current = fs.lstatSync(lock);
      if (!current.isFile() || current.isSymbolicLink() || current.ino !== lockStat.ino || current.dev !== lockStat.dev || fs.readFileSync(lock, 'utf8') !== token) fail('strategy_goals_lock_changed', 503);
      fs.unlinkSync(lock);
    }
  }
  list(): StrategyGoalsIndex { const { schemaVersion: _, operations: __, tableReceipts: ___, ...value } = this.load(); return structuredClone(value); }
  recordArrangement(input: GoalArrangementInput & GoalMutation, options?: { assertWritable?(): void }): GoalActionArrangement {
    const body = arrangementInput(input);
    return this.mutate(input.operationId, 'arrange', body, index => {
      options?.assertWritable?.(); adopted(index, body.goal);
      const existing = index.arrangements?.find(value => value.boardOperationId === body.boardOperationId);
      if (existing) { if (canonical(arrangementInput(existing)) !== canonical(body)) fail('strategy_goal_operation_conflict', 409); return existing; }
      const value = { ...body, id: randomUUID(), createdAt: new Date().toISOString() };
      if (index.schemaVersion === 1) index.schemaVersion = 2;
      (index.arrangements ??= []).push(value); options?.assertWritable?.(); return value;
    });
  }
  getOperation(id: string): GoalOperationReceipt | null { return structuredClone(this.load().operations.find(x => x.operationId === uuid(id)) ?? null); }
  /** Resolve only the bodies actually returned by the immutable operation. */
  operationContext(receipt:GoalOperationReceipt):GoalContextSnapshot[] {
    const original=this.getOperation(receipt.operationId);
    if(!original || canonical(receipt)!==canonical(original))return fail('strategy_goal_operation_changed',409);
    const empty:GoalBasis={relations:[],feedback:[]};
    const digest=(value:unknown)=>createHash('sha256').update(canonical(value)).digest('hex');
    if(original.kind==='feedback'){
      const feedback=original.result as GoalFeedback;
      return [this.readContext([feedback.goal],{relations:[],feedback:[{id:feedback.id,createdAt:feedback.createdAt,sha256:digest(feedback)}]})];
    }
    if(original.kind==='relate' || original.kind==='revise-relation'){
      const relation=original.result as GoalRelation;
      return [...relation.history,relation].map(row=>{
        const value={id:relation.id,...relationInput(row),revision:row.revision,createdAt:row.createdAt};
        return this.readContext([row.from,row.to],{feedback:[],relations:[{id:value.id,revision:value.revision,sha256:digest(value)}]});
      });
    }
    if(original.kind==='arrange')return [this.readContext([(original.result as GoalActionArrangement).goal],empty)];
    return [{goals:[original.result as GoalVersion],basis:empty,relations:[],feedback:[]}];
  }
  get(id: string): StrategyGoalRecord {
    const record = this.load().goals.find(x => x.id === uuid(id));
    return record ? structuredClone(record) : fail('strategy_goal_not_found', 404);
  }
  read(ref: GoalRef): GoalVersion {
    const value = this.get(ref.goalId).versions.find(x => x.version === positive(ref.version));
    return value ? structuredClone(value) : fail('strategy_goal_version_not_found', 404);
  }
  readContext(refs: readonly GoalRef[], frozenBasis?: GoalBasis): GoalContextSnapshot {
    if (!Array.isArray(refs) || refs.length > 20) fail('invalid_strategy_goal_reference');
    const selected = refs.map(goalRef), keys = new Set(selected.map(ref => `${ref.goalId}:${ref.version}`)), index = this.load();
    const goals = [...new Map(selected.map(ref => {
      const value = index.goals.find(goal => goal.id === ref.goalId)?.versions.find(version => version.version === ref.version);
      if (!value) fail('strategy_goal_version_not_found', 404);
      return [`${ref.goalId}:${ref.version}`, value] as const;
    })).values()];
    const matches = (ref: GoalRef) => keys.has(`${ref.goalId}:${ref.version}`);
    const relationVersion = (id: string, value: GoalRelationVersion) => ({ id, ...relationInput(value), revision: value.revision, createdAt: value.createdAt });
    const digest = (value: unknown) => createHash('sha256').update(canonical(value)).digest('hex');
    let relations: GoalContextSnapshot['relations'], feedback: GoalFeedback[], basis: GoalBasis;
    if (frozenBasis === undefined) {
      relations = index.relations.filter(value => matches(value.from) || matches(value.to)).map(value => relationVersion(value.id, value));
      feedback = index.feedback.filter(value => matches(value.goal));
      basis = parseGoalBasis({ relations: relations.map(value => ({ id: value.id, revision: value.revision, sha256: digest(value) })), feedback: feedback.map(value => ({ id: value.id, createdAt: value.createdAt, sha256: digest(value) })) });
    } else {
      basis = parseGoalBasis(frozenBasis);
      relations = basis.relations.map(ref => {
        const relation = index.relations.find(value => value.id === ref.id), value = relation?.revision === ref.revision ? relation : relation?.history.find(value => value.revision === ref.revision);
        if (!value) fail('strategy_goal_basis_unavailable', 409);
        const result = relationVersion(ref.id, value);
        if ((!matches(result.from) && !matches(result.to)) || digest(result) !== ref.sha256) fail('strategy_goal_basis_changed', 409);
        return result;
      });
      feedback = basis.feedback.map(ref => {
        const value = index.feedback.find(value => value.id === ref.id);
        if (!value) fail('strategy_goal_basis_unavailable', 409);
        if (!matches(value.goal) || value.createdAt !== ref.createdAt || digest(value) !== ref.sha256) fail('strategy_goal_basis_changed', 409);
        return value;
      });
    }
    return structuredClone({ goals, basis, relations, feedback });
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
    if(input.expectedAdoptedVersion!==undefined && input.expectedAdoptedVersion!==null)positive(input.expectedAdoptedVersion);
    const decision = text(input.decision), provenance = input.provenance === undefined ? undefined : parseGoalAdoptionProvenance(input.provenance);
    const request = { ref: goalRef(ref), expectedVersion: input.expectedVersion, expectedAdoptedVersion: input.expectedAdoptedVersion, decision, provenance };
    // Older discussion receipts fingerprinted the whole version as it was before the write.
    const previousRequests: unknown[] = [];
    if ('status' in ref) {
      const { adoptedAt, adoptionDecision, adoptionProvenance, ...version } = ref as GoalVersion;
      previousRequests.push({ ...request, ref }, { ...request, ref: { ...version, status: 'candidate' } });
    }
    return this.mutate(input.operationId, 'adopt', request, index => {
      const record = index.goals.find(x => x.id === ref.goalId);
      if (!record) fail('strategy_goal_not_found', 404);
      if (record.currentVersion !== input.expectedVersion) fail('strategy_goal_conflict', 409);
      if(input.expectedAdoptedVersion!==undefined && record.adoptedVersion!==input.expectedAdoptedVersion)fail('strategy_goal_adoption_changed',409);
      const version = record.versions.find(x => x.version === ref.version);
      if (!version) fail('strategy_goal_version_not_found', 404);
      if (provenance && provenance.goalContentSha256 !== goalContentSha256(version)) fail('strategy_goal_content_changed', 409);
      if (version.status === 'adopted') return version;
      version.status = 'adopted'; version.adoptedAt = new Date().toISOString(); version.adoptionDecision = decision;
      if (provenance) version.adoptionProvenance = provenance;
      record.adoptedVersion = version.version; return version;
    }, previousRequests);
  }
  revise(id: string, input: GoalRevisionInput): GoalVersion {
    uuid(id); uuid(input.operationId); positive(input.expectedVersion);
    const prior=this.read({goalId:id,version:input.expectedVersion});
    if (input.structured!==undefined && canonical(input.structured)!==canonical(prior.structured) || prior.structured && groupScopeKey(input.scope)!==groupScopeKey(prior.scope))
      fail('strategy_goal_table_origin_mismatch',409);
    const body = draft({...input,...(prior.structured&&{structured:prior.structured})});
    return this.mutate(input.operationId, 'revise', { id, body, expectedVersion: input.expectedVersion }, index => {
      const record = index.goals.find(x => x.id === id);
      if (!record) fail('strategy_goal_not_found', 404);
      if (record.currentVersion !== input.expectedVersion) fail('strategy_goal_conflict', 409);
      const value: GoalVersion = { ...body, goalId: id, version: record.currentVersion + 1, status: 'candidate', createdAt: new Date().toISOString() };
      record.versions.push(value); record.currentVersion = value.version; return value;
    });
  }
  mapHandoffs(discussionId:string,mapId:string,version:number,sha256:string) {
    const index=this.load();
    const goals=new Map(index.goals.map(g=>[g.id,g]));
    const matches=new Map<string,{goalId:string;version:number;nodeId:string;title:string;scope:string;status:GoalVersion['status'];publicationId?:string;historical:boolean}>();
    for(const refs of Object.values(index.tableReceipts??{})) {
      for(const ref of refs) {
        const value=goals.get(ref.goalId)?.versions[ref.version-1];
        const structured=value?.structured,origin=structured?.map;
        if(!value || !structured || !origin || origin.discussionId!==discussionId || origin.mapId!==mapId || origin.version!==version || origin.sha256!==sha256)continue;
        const key=goalRefKey(ref);
        if(matches.get(key)?.publicationId&&!ref.publication)continue;
        matches.set(key,{...goalRef(ref),nodeId:structured.nodeId,title:value.title,scope:value.scope.name,status:value.status,...(ref.publication&&{publicationId:ref.publication.publicationId}),historical:!ref.publication});
      }
    }
    return [...matches.values()];
  }
  tableResult(operationId: string):GoalVersion[] {
    const index=this.load(), refs=index.tableReceipts?.[uuid(operationId)];
    if(!refs)fail('strategy_goal_table_conflict',409);
    return structuredClone(refs.map(ref=>index.goals.find(g=>g.id===ref.goalId)!.versions[ref.version-1]!));
  }
  private tablePlan(index:StoredIndex, rows:GoalTableRow[], publication?:StrategyMapPublicationIdentity) {
    if(!Array.isArray(rows)||!rows.length||rows.length>500)fail('invalid_strategy_goal_selection');
    const values=rows.map(row=>({input:draft(row.input),expected:row.expected&&goalRef(row.expected)}));
    const key=(v:GoalDraftInput)=>canonical([groupScopeKey(v.scope),v.structured?.groupId,v.structured?.nodeId]);
    if(values.some(row=>!row.input.structured)||new Set(values.map(row=>key(row.input))).size!==values.length)fail('invalid_structured_goal');
    if(publication&&values.some(row=>!row.input.structured?.map))fail('invalid_strategy_map_publication_receipt');
    const publicationBindings=new Map<string,StrategyMapPublicationIdentity>();
    for(const refs of Object.values(index.tableReceipts??{})){
      for(const ref of refs)if(ref.publication)publicationBindings.set(goalRefKey(ref),ref.publication);
    }
    return values.map(({input,expected})=>{
      const matches=index.goals.filter(g=>g.versions.some(v=>v.structured&&key(v)===key(input)));
      if(matches.length>1)fail('strategy_goal_table_conflict',409);
      const record=matches[0],same=record?.versions.find(v=>canonical(draft(v))===canonical(input) &&
        canonical(publicationBindings.get(goalRefKey(v)))===canonical(publication));
      if(!same&&(record?(!expected||expected.goalId!==record.id||expected.version!==record.currentVersion):expected!==null))
        fail('strategy_goal_table_conflict',409);
      return {input,record,same};
    });
  }
  checkTable(rows:GoalTableRow[]):void{this.tablePlan(this.load(),rows);}
  /** All rows from one confirmed table use the same file lock and atomic index replacement. */
  saveTable(operationId: string, rows: GoalTableRow[], publication?: StrategyMapPublicationIdentity): GoalVersion[] {
    const identity=publication===undefined?undefined:parseTablePublication(publication);
    this.mutate(operationId,'create',{table:rows,...(identity&&{publication:identity})},index=>{
      const batch:GoalVersion[]=[];
      for (const {input,record:previous,same} of this.tablePlan(index,rows,identity)) {
        if(same){batch.push(same);continue;}
        const record=previous??{id:randomUUID(),currentVersion:0,adoptedVersion:null,versions:[]};
        if(!previous)index.goals.push(record);
        const goal:GoalVersion={...input,goalId:record.id,version:++record.currentVersion,status:'candidate',createdAt:new Date().toISOString()};
        record.versions.push(goal);batch.push(goal);
      }
      // Keep the release identity with the exact receipt; older builds can still read and write the goal versions.
      (index.tableReceipts??={})[operationId]=batch.map(goal=>({...goalRef(goal),...(identity&&{publication:identity})}));
      return batch[0]!;
    });
    return this.tableResult(operationId);
  }
  create(input: GoalDraftInput & GoalMutation): GoalVersion {
    if (input.structured!==undefined)fail('strategy_goal_table_origin_mismatch',409);
    uuid(input.operationId);
    const body = draft(input);
    return this.mutate(input.operationId, 'create', body, index => {
      const id = randomUUID(), value: GoalVersion = { ...body, goalId: id, version: 1, status: 'candidate', createdAt: new Date().toISOString() };
      index.goals.push({ id, currentVersion: 1, adoptedVersion: null, versions: [value] }); return value;
    });
  }
}
