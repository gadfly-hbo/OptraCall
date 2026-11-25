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
import type {
  DecompositionAlignmentInput,
  DecompositionCaseDraftIntent,
  DecompositionCaseDraftIntentInput,
  DecompositionCommittedGoal,
  DecompositionCommittedRelation,
  CycleReviewConclusion,
  DecompositionCycleReview,
  DecompositionCycleReviewInput,
  DecompositionDraft,
  DecompositionDraftInput,
  DecompositionOperationRecoveryResult,
  DecompositionProgressCheck,
  DecompositionProgressCheckInput,
  DecompositionProjectHandoff,
  DecompositionProjectHandoffInput,
  DecompositionProjectHandoffPreview,
  DecompositionPublication,
  DecompositionPublicationSnapshot,
  DecompositionPublicationSummary,
  DecompositionPublishInput,
  DecompositionPublishOperationRecord,
  DecompositionPublishPreview,
  DecompositionThresholdConfig,
  GoalWorkspaceView,
  GsaPlanConfirmInput,
  GsaPlanDraft,
  GsaPlanVersion,
  NextCycleDraft,
  NextCycleDraftInput,
  PreConfirmEstimateRecord,
  ProgressCaseChoice,
  ReachabilityEstimate,
  StrategyReturnInput,
  StrategyReturnRecord,
} from './strategy-goal-decomposition-types.ts';
import {
  GoalDecompositionError,
  classifyReviewConclusion,
  evaluateProgressComparison,
  freezeRowCheckpoints,
  parseDecompositionDraftInput,
  parseGoalFormalOrigin,
  parsePlannedActions,
  parseReachabilityEstimate,
  parseStageCheckpoints,
  reqText,
  reqUuid,
  sha256Canonical,
  validateDecompositionForPublish,
} from './strategy-goal-decomposition-validation.ts';

export class StrategyGoalsError extends Error {
  readonly code: string;
  readonly status: number;
  readonly details?: Record<string, unknown>;
  constructor(code: string, status = 400, details?: Record<string, unknown>) { super(code); this.code = code; this.status = status; this.details = details; }
}
function fail(code: string, status = 400, details?: Record<string, unknown>): never { throw new StrategyGoalsError(code, status, details); }
const object = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const text = (v: unknown, max = 4000): string => typeof v === 'string' && v.trim() && v.length <= max ? v.trim() : fail('invalid_strategy_goal');
const uuid = (v: unknown): string => typeof v === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(v) ? v : fail('invalid_strategy_goal_id');
const positive = (v: unknown): number => typeof v === 'number' && Number.isSafeInteger(v) && v > 0 ? v : fail('invalid_strategy_goal_version');
const canonical = (v: unknown): string => Array.isArray(v) ? `[${v.map(canonical).join(',')}]` : object(v) ? `{${Object.keys(v).filter(k => v[k] !== undefined).sort().map(k => `${JSON.stringify(k)}:${canonical(v[k])}`).join(',')}}` : JSON.stringify(v);
type TableGoalRef = GoalRef & { publication?: StrategyMapPublicationIdentity };
type GoalTableRow = { input: GoalDraftInput; expected: GoalRef | null };
type StoredIndex = StrategyGoalsIndex & {
  schemaVersion: 1 | 2 | 3 | 4;
  tableReceipts?: Record<string,TableGoalRef[]>;
  operations: GoalOperationReceipt[];
  preConfirmEstimates?: Record<string, PreConfirmEstimateRecord>;
  gsaDrafts?: Record<string, GsaPlanDraft>;
  gsaPlans?: Record<string, GsaPlanVersion[]>;
  gsaPlanOperations?: Record<string, { operationId: string; requestHash: string; goalId: string; planVersion: number; goalVersion: number; completedAt: string }>;
  decompositionDrafts?: Record<string, DecompositionDraft>;
  decompositionPublications?: Record<string, DecompositionPublicationSummary[]>;
  activeDecompositionVersions?: Record<string, number>;
  decompositionOperations?: DecompositionPublishOperationRecord[];
  thresholds?: Record<string, DecompositionThresholdConfig>;
  progressChecks?: Record<string, DecompositionProgressCheck[]>;
  caseDraftIntents?: Record<string, DecompositionCaseDraftIntent[]>;
  projectHandoffs?: Record<string, DecompositionProjectHandoff[]>;
  cycleReviews?: Record<string, DecompositionCycleReview[]>;
  nextCycleDrafts?: Record<string, NextCycleDraft[]>;
  strategyReturns?: Record<string, StrategyReturnRecord[]>;
};
const empty = (): StoredIndex => ({ schemaVersion: 1, goals: [], relations: [], feedback: [], operations: [] });
const MAX_BYTES = 4 * 1024 * 1024;
const MAX_BLOB_BYTES = 2 * 1024 * 1024;
const defaultThreshold = (): DecompositionThresholdConfig => ({ configured: false, adverseDirection: 'below', unit: 'percent' });
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
    ...(input.formalOrigin === undefined ? {} : { formalOrigin: parseGoalFormalOrigin(input.formalOrigin) }),
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
  readonly blobsDir: string;
  readonly disableDecomposition: boolean;
  private readonly inFlightPublishOps = new Set<string>();
  constructor(dataRoot: string, options?: { disableDecomposition?: boolean }) {
    this.dataRoot = path.resolve(dataRoot);
    this.root = path.join(this.dataRoot, 'strategy-goals');
    this.file = path.join(this.root, 'index.json');
    this.blobsDir = path.join(this.root, 'blobs');
    this.disableDecomposition = options?.disableDecomposition === true;
  }
  assertDecompositionWritable(): void {
    if (this.disableDecomposition) fail('goal_decomposition_disabled', 403);
  }
  private directory(name: string, create: boolean): boolean {
    let stat: fs.Stats;
    try { stat = fs.lstatSync(name); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') return fail('strategy_goals_storage_unavailable', 503); if (!create) return false; fs.mkdirSync(name, { recursive: true, mode: 0o700 }); stat = fs.lstatSync(name); }
    if (!stat.isDirectory() || stat.isSymbolicLink()) fail('unsafe_strategy_goals_storage', 503);
    return true;
  }
  private writeSnapshotBlob(snapshot: DecompositionPublicationSnapshot): string {
    this.directory(this.dataRoot, true);
    this.directory(this.root, true);
    this.directory(this.blobsDir, true);
    const bytes = Buffer.from(JSON.stringify(snapshot, null, 2) + '\n');
    if (bytes.length > MAX_BLOB_BYTES) fail('decomposition_snapshot_too_large', 413);
    const digest = createHash('sha256').update(bytes).digest('hex');
    const target = path.join(this.blobsDir, `${digest}.json`);
    if (fs.existsSync(target)) {
      const existing = fs.lstatSync(target);
      if (!existing.isFile() || existing.isSymbolicLink()) fail('unsafe_strategy_goals_storage', 503);
      return digest;
    }
    const temp = `${target}.${randomUUID()}.tmp`;
    const fd = fs.openSync(temp, fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_WRONLY | fs.constants.O_NOFOLLOW, 0o600);
    try { fs.writeFileSync(fd, bytes); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    try {
      fs.renameSync(temp, target);
      const dir = fs.openSync(this.blobsDir, 'r');
      try { fs.fsyncSync(dir); } finally { fs.closeSync(dir); }
    } catch {
      fail('decomposition_blob_write_failed', 503);
    } finally {
      if (fs.existsSync(temp)) fs.unlinkSync(temp);
    }
    return digest;
  }
  private readSnapshotBlob(expectedSha256: string): DecompositionPublicationSnapshot {
    if (!/^[a-f0-9]{64}$/.test(expectedSha256)) fail('decomposition_publication_unavailable', 409);
    const target = path.join(this.blobsDir, `${expectedSha256}.json`);
    let stat: fs.BigIntStats;
    try { stat = fs.lstatSync(target, { bigint: true }); }
    catch { return fail('decomposition_publication_unavailable', 409); }
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1n || stat.size > BigInt(MAX_BLOB_BYTES)) {
      fail('decomposition_publication_unavailable', 409);
    }
    const fd = fs.openSync(target, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
    try {
      const bytes = fs.readFileSync(fd);
      const actualSha = createHash('sha256').update(bytes).digest('hex');
      if (actualSha !== expectedSha256) fail('decomposition_publication_corrupt', 409);
      return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as DecompositionPublicationSnapshot;
    } catch (error) {
      if (error instanceof StrategyGoalsError) throw error;
      return fail('decomposition_publication_corrupt', 409);
    } finally {
      fs.closeSync(fd);
    }
  }
  private load(ownLock = false): StoredIndex {
    if (!this.directory(this.dataRoot, false) || !this.directory(this.root, false)) return empty();
    let before: fs.BigIntStats;
    try { before = fs.lstatSync(this.file, { bigint: true }); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT' && fs.readdirSync(this.root).every(name => (ownLock && name === '.write.lock') || name === 'blobs')) return empty(); return fail('strategy_goals_storage_unavailable', 503); }
    if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1n || before.size > BigInt(MAX_BYTES)) fail('unsafe_strategy_goals_storage', 503);
    const fd = fs.openSync(this.file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
    try {
      const initial = fs.fstatSync(fd, { bigint: true });
      if (initial.ino !== before.ino || initial.dev !== before.dev || initial.nlink !== 1n || initial.size !== before.size) fail('strategy_goals_storage_changed', 503);
      const bytes = fs.readFileSync(fd), after = fs.fstatSync(fd, { bigint: true }), current = fs.lstatSync(this.file, { bigint: true });
      if (BigInt(bytes.length) !== initial.size || after.mtimeNs !== initial.mtimeNs || after.ctimeNs !== initial.ctimeNs || current.ino !== initial.ino || current.dev !== initial.dev || current.nlink !== 1n) fail('strategy_goals_storage_changed', 503);
      const value: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
      if (!object(value) || ![1, 2, 3, 4].includes(value.schemaVersion as number) || !Array.isArray(value.goals) || !Array.isArray(value.relations) || !Array.isArray(value.feedback) || !Array.isArray(value.operations) || value.schemaVersion !== 1 && !Array.isArray(value.arrangements)) fail('invalid_strategy_goals_storage', 503);
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
  private withLock<T>(apply: (index: StoredIndex) => { result: T; dirty: boolean }): T {
    this.directory(this.dataRoot, true); this.directory(this.root, true);
    const lock = path.join(this.root, '.write.lock'), token = randomUUID();
    let fd: number;
    try { fd = fs.openSync(lock, fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_WRONLY | fs.constants.O_NOFOLLOW, 0o600); }
    catch { return fail('strategy_goals_locked', 503); }
    const lockStat = fs.fstatSync(fd);
    try {
      fs.writeFileSync(fd, token); fs.fsyncSync(fd);
      const index = this.load(true);
      const outcome = apply(index);
      if (outcome.dirty) this.write(index);
      return structuredClone(outcome.result);
    } finally {
      fs.closeSync(fd);
      const current = fs.lstatSync(lock);
      if (!current.isFile() || current.isSymbolicLink() || current.ino !== lockStat.ino || current.dev !== lockStat.dev || fs.readFileSync(lock, 'utf8') !== token) fail('strategy_goals_lock_changed', 503);
      fs.unlinkSync(lock);
    }
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
      if (v12(result) && index.schemaVersion < 3) { index.schemaVersion = 3; index.arrangements ??= []; }
      index.operations.push({ operationId, kind, requestHash, completedAt: new Date().toISOString(), result: structuredClone(result) });
      this.write(index); return structuredClone(result);
    } finally {
      fs.closeSync(fd);
      const current = fs.lstatSync(lock);
      if (!current.isFile() || current.isSymbolicLink() || current.ino !== lockStat.ino || current.dev !== lockStat.dev || fs.readFileSync(lock, 'utf8') !== token) fail('strategy_goals_lock_changed', 503);
      fs.unlinkSync(lock);
    }
  }
  /** Explicitly project only legacy generic directory fields; never leak decomposition drafts/checks/ops. */
  list(): StrategyGoalsIndex {
    const index = this.load();
    return structuredClone({
      goals: index.goals,
      relations: index.relations,
      feedback: index.feedback,
      ...(index.arrangements !== undefined ? { arrangements: index.arrangements } : {}),
    });
  }
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

  // ---- Goal Management & Decomposition (schemaVersion 4, GM01–GM13 / UI01–UI04) ----

  private bumpSchema4(index: StoredIndex): void {
    index.schemaVersion = 4;
    index.arrangements ??= [];
  }

  private resolveFormalTarget(version: GoalVersion): GsaPlanVersion['formalTarget'] {
    if (version.formalOrigin) {
      return {
        value: version.formalOrigin.targetValue,
        unit: version.formalOrigin.unit,
        metricKind: version.formalOrigin.metricKind,
        period: version.formalOrigin.period,
      };
    }
    return fail('gsa_formal_target_required', 400);
  }

  getPreConfirmEstimate(draftId: string): PreConfirmEstimateRecord | null {
    const id = reqUuid(draftId, 'invalid_goal_draft_id');
    return structuredClone(this.load().preConfirmEstimates?.[id] ?? null);
  }

  savePreConfirmEstimate(
    draftId: string,
    scope: import('./strategy-goals-types.ts').GoalScope,
    estimateInput: unknown,
    updatedBy: 'user' | 'agent' = 'user',
    agentSource?: import('./strategy-goals-types.ts').GoalRoleSuggestionRef,
  ): PreConfirmEstimateRecord {
    this.assertDecompositionWritable();
    const id = reqUuid(draftId, 'invalid_goal_draft_id');
    const estimate = parseReachabilityEstimate(estimateInput);
    return this.withLock(index => {
      this.bumpSchema4(index);
      const record: PreConfirmEstimateRecord = {
        draftId: id,
        scope: structuredClone(scope),
        estimate,
        updatedAt: new Date().toISOString(),
        updatedBy,
        ...(agentSource ? { agentSource: parseGoalRoleSuggestion(agentSource) } : {}),
      };
      (index.preConfirmEstimates ??= {})[id] = record;
      return { result: record, dirty: true };
    });
  }

  saveGsaPlanDraft(goalId: string, raw: { plannedActions?: unknown; stageCheckpoints?: unknown; preConfirmEstimate?: unknown }): GsaPlanDraft {
    this.assertDecompositionWritable();
    const id = uuid(goalId);
    const plannedActions = raw.plannedActions === undefined ? [] : parsePlannedActions(raw.plannedActions, false);
    const stageCheckpoints = parseStageCheckpoints(raw.stageCheckpoints);
    const preConfirmEstimate = raw.preConfirmEstimate === undefined ? undefined : parseReachabilityEstimate(raw.preConfirmEstimate);
    return this.withLock(index => {
      if (!index.goals.some(g => g.id === id)) fail('strategy_goal_not_found', 404);
      this.bumpSchema4(index);
      const saved: GsaPlanDraft = {
        goalId: id,
        plannedActions,
        stageCheckpoints,
        ...(preConfirmEstimate ? { preConfirmEstimate } : {}),
        updatedAt: new Date().toISOString(),
      };
      (index.gsaDrafts ??= {})[id] = saved;
      return { result: saved, dirty: true };
    });
  }

  listGsaPlans(goalId: string): GsaPlanVersion[] {
    const id = uuid(goalId);
    const index = this.load();
    if (!index.goals.some(g => g.id === id)) fail('strategy_goal_not_found', 404);
    return structuredClone(index.gsaPlans?.[id] ?? []);
  }

  readGsaPlan(goalId: string, planVersion: number): GsaPlanVersion {
    const id = uuid(goalId);
    positive(planVersion);
    const plans = this.listGsaPlans(id);
    const found = plans.find(p => p.planVersion === planVersion);
    if (!found) fail('gsa_plan_not_found', 404);
    return found;
  }

  /** Atomically confirms G + S + Planned A in a single lock (GM02/GM09). Never creates Tasks/Cases/Board authorizations. */
  confirmGsaPlan(goalId: string, input: GsaPlanConfirmInput): { goal: GoalVersion; gsaPlan: GsaPlanVersion; replayed: boolean } {
    this.assertDecompositionWritable();
    const id = uuid(goalId);
    const operationId = reqUuid(input.operationId);
    positive(input.expectedGoalVersion);
    if (input.expectedAdoptedVersion !== undefined && input.expectedAdoptedVersion !== null) positive(input.expectedAdoptedVersion);
    if (!Number.isSafeInteger(input.expectedPlanVersion) || input.expectedPlanVersion < 0) fail('invalid_gsa_plan_version', 400);
    const plannedActions = parsePlannedActions(input.plannedActions, true);
    const stageCheckpoints = parseStageCheckpoints(input.stageCheckpoints);
    const decision = reqText(input.decision, 4000, 'strategy_goal_decision_required');
    const confirmedBy = input.confirmedBy?.trim() ? reqText(input.confirmedBy, 300) : '负责人';
    const preConfirmEstimate = input.preConfirmEstimate === undefined ? undefined : parseReachabilityEstimate(input.preConfirmEstimate);
    const revisedBody = input.goalRevision === undefined ? undefined : draft(input.goalRevision);
    const supersedesReason = input.supersedesReason?.trim() ? reqText(input.supersedesReason, 1000) : undefined;
    const requestHash = sha256Canonical({
      goalId: id,
      expectedGoalVersion: input.expectedGoalVersion,
      expectedAdoptedVersion: input.expectedAdoptedVersion ?? null,
      expectedPlanVersion: input.expectedPlanVersion,
      revisedBody,
      plannedActions,
      stageCheckpoints,
      decision,
      confirmedBy,
      preConfirmEstimate,
      supersedesReason,
    });

    return this.withLock(index => {
      const priorOp = index.gsaPlanOperations?.[operationId];
      if (priorOp) {
        if (priorOp.requestHash !== requestHash || priorOp.goalId !== id) fail('strategy_goal_operation_conflict', 409);
        const rec = index.goals.find(g => g.id === id);
        const gv = rec?.versions.find(v => v.version === priorOp.goalVersion);
        const pv = index.gsaPlans?.[id]?.find(p => p.planVersion === priorOp.planVersion);
        if (!gv || !pv) fail('strategy_goal_operation_conflict', 409);
        return { result: { goal: gv, gsaPlan: pv, replayed: true as boolean }, dirty: false };
      }
      const record = index.goals.find(g => g.id === id);
      if (!record) fail('strategy_goal_not_found', 404);
      const requestedVersion = record.versions.find(v => v.version === input.expectedGoalVersion);
      if (!requestedVersion) fail('strategy_goal_conflict', 409);
      if (revisedBody && record.currentVersion !== input.expectedGoalVersion) fail('strategy_goal_conflict', 409);
      if (!revisedBody) {
        if (record.adoptedVersion !== null && requestedVersion.version < record.adoptedVersion) {
          fail('strategy_goal_historical_version', 409);
        }
        if (requestedVersion.status === 'candidate' && requestedVersion.version !== record.currentVersion) {
          fail('strategy_goal_conflict', 409);
        }
      }
      if (input.expectedAdoptedVersion !== undefined && record.adoptedVersion !== input.expectedAdoptedVersion) {
        fail('strategy_goal_adoption_changed', 409);
      }
      const existingPlans = index.gsaPlans?.[id] ?? [];
      if (existingPlans.length !== input.expectedPlanVersion) fail('gsa_plan_conflict', 409);

      const now = new Date().toISOString();
      let targetVersion = requestedVersion;
      if (revisedBody) {
        if (targetVersion.structured && groupScopeKey(revisedBody.scope) !== groupScopeKey(targetVersion.scope)) {
          fail('strategy_goal_table_origin_mismatch', 409);
        }
        const nextGoal: GoalVersion = {
          ...revisedBody,
          ...(targetVersion.structured ? { structured: targetVersion.structured } : {}),
          goalId: id,
          version: record.currentVersion + 1,
          status: 'adopted',
          createdAt: now,
          adoptedAt: now,
          adoptionDecision: decision,
        };
        record.versions.push(nextGoal);
        record.currentVersion = nextGoal.version;
        record.adoptedVersion = nextGoal.version;
        targetVersion = nextGoal;
      } else if (targetVersion.status === 'candidate') {
        targetVersion.status = 'adopted';
        targetVersion.adoptedAt = now;
        targetVersion.adoptionDecision = decision;
        record.adoptedVersion = targetVersion.version;
      }
      // Note: if targetVersion is ALREADY 'adopted' (e.g. A-only update while viewing adopted v1),
      // we preserve its original adoptedAt and adoptionDecision untouched and do NOT adopt an unseen v2!

      const planId = existingPlans[0]?.planId ?? randomUUID();
      const planVersion = existingPlans.length + 1;
      const formalTarget = this.resolveFormalTarget(targetVersion);
      const goalHash = goalContentSha256(targetVersion);
      const origin: GsaPlanVersion['origin'] = targetVersion.formalOrigin ?? { kind: 'legacy-adopted-goal' };
      const corePlan = {
        planId,
        planVersion,
        goal: { goalId: targetVersion.goalId, version: targetVersion.version },
        goalContentSha256: goalHash,
        formalTarget,
        strategies: [...(targetVersion.strategies ?? [])],
        plannedActions,
        stageCheckpoints,
        planKind: 'planned-not-authorized' as const,
        origin,
        confirmedBy,
        confirmedAt: now,
        decision,
        ...(planVersion > 1 ? { previousPlanVersion: planVersion - 1 } : {}),
        ...(supersedesReason ? { supersedesReason } : {}),
      };
      const gsaPlan: GsaPlanVersion = {
        ...corePlan,
        contentSha256: sha256Canonical(corePlan),
      };
      this.bumpSchema4(index);
      (index.gsaPlans ??= {})[id] = [...existingPlans, gsaPlan];
      if (index.gsaDrafts?.[id]) delete index.gsaDrafts[id];
      (index.gsaPlanOperations ??= {})[operationId] = {
        operationId,
        requestHash,
        goalId: id,
        planVersion: gsaPlan.planVersion,
        goalVersion: targetVersion.version,
        completedAt: now,
      };
      return { result: { goal: targetVersion, gsaPlan, replayed: false }, dirty: true };
    });
  }

  saveDecompositionDraft(
    goalId: string,
    raw: DecompositionDraftInput,
    meta: { updatedBy: 'user' | 'agent'; agentSource?: import('./strategy-goals-types.ts').GoalRoleSuggestionRef } = { updatedBy: 'user' },
  ): { draft: DecompositionDraft; validation: ReturnType<typeof validateDecompositionForPublish> } {
    this.assertDecompositionWritable();
    const id = uuid(goalId);
    const input = parseDecompositionDraftInput(raw);
    return this.withLock(index => {
      const record = index.goals.find(g => g.id === id);
      if (!record) fail('strategy_goal_not_found', 404);
      const plans = index.gsaPlans?.[id] ?? [];
      const activePlan = plans.at(-1) ?? null;
      if (!activePlan) fail('gsa_plan_required', 409);
      if (record.adoptedVersion === null || activePlan.goal.version !== record.adoptedVersion) {
        fail('gsa_plan_stale_for_adopted_goal', 409);
      }
      if (activePlan.planId !== input.gsaPlanId || activePlan.planVersion !== input.gsaPlanVersion || activePlan.contentSha256 !== input.gsaPlanSha256) {
        fail('gsa_plan_changed', 409);
      }
      const existing = index.decompositionDrafts?.[id];
      const currentRev = existing?.revision ?? 0;
      if (currentRev !== input.expectedDraftRevision) fail('decomposition_draft_conflict', 409);

      const nextRev = currentRev + 1;
      const now = new Date().toISOString();
      const bodyWithoutHash = {
        draftId: existing?.draftId ?? randomUUID(),
        goalId: id,
        gsaPlanId: activePlan.planId,
        gsaPlanVersion: activePlan.planVersion,
        gsaPlanSha256: activePlan.contentSha256,
        revision: nextRev,
        updatedAt: now,
        updatedBy: meta.updatedBy,
        ...(meta.agentSource ? { agentSource: parseGoalRoleSuggestion(meta.agentSource) } : {}),
        estimate: input.estimate,
        rows: input.rows,
        reserves: input.reserves,
        gapStrategies: input.gapStrategies,
        views: input.views,
        timePlan: input.timePlan,
        ...(existing?.alignmentRecord ? { alignmentRecord: existing.alignmentRecord } : {}),
        ...(input.notes ? { notes: input.notes } : {}),
      };
      const contentSha256 = sha256Canonical({
        gsaPlanId: bodyWithoutHash.gsaPlanId,
        gsaPlanVersion: bodyWithoutHash.gsaPlanVersion,
        gsaPlanSha256: bodyWithoutHash.gsaPlanSha256,
        estimate: bodyWithoutHash.estimate,
        rows: bodyWithoutHash.rows,
        reserves: bodyWithoutHash.reserves,
        gapStrategies: bodyWithoutHash.gapStrategies,
        views: bodyWithoutHash.views,
        timePlan: bodyWithoutHash.timePlan,
        notes: bodyWithoutHash.notes,
      });
      const saved: DecompositionDraft = { ...bodyWithoutHash, contentSha256 };
      this.bumpSchema4(index);
      (index.decompositionDrafts ??= {})[id] = saved;
      const validation = validateDecompositionForPublish(activePlan, saved, index.goals);
      return { result: { draft: saved, validation }, dirty: true };
    });
  }

  alignDecompositionCrossConflict(goalId: string, raw: DecompositionAlignmentInput): { draft: DecompositionDraft; validation: ReturnType<typeof validateDecompositionForPublish> } {
    this.assertDecompositionWritable();
    const id = uuid(goalId);
    reqUuid(raw.operationId);
    const alignedBy = reqText(raw.alignedBy, 300, 'alignment_basis_required');
    const basis = reqText(raw.basis, 2000, 'alignment_basis_required');
    if (!Array.isArray(raw.cellUpdates) || !raw.cellUpdates.length || raw.cellUpdates.length > 100) {
      fail('invalid_alignment_updates', 400);
    }
    const updates = new Map<string, number>();
    for (const item of raw.cellUpdates) {
      if (!object(item) || typeof item.value !== 'number' || !Number.isFinite(item.value) || item.value < 0) {
        fail('invalid_alignment_updates', 400);
      }
      updates.set(reqText(item.crossCellId, 200), item.value);
    }

    return this.withLock(index => {
      const record = index.goals.find(g => g.id === id);
      if (!record) fail('strategy_goal_not_found', 404);
      const activePlan = index.gsaPlans?.[id]?.at(-1) ?? null;
      if (!activePlan) fail('gsa_plan_required', 409);
      if (record.adoptedVersion === null || activePlan.goal.version !== record.adoptedVersion) {
        fail('gsa_plan_stale_for_adopted_goal', 409);
      }
      if (activePlan.planId !== raw.gsaPlanId || activePlan.planVersion !== raw.gsaPlanVersion || activePlan.contentSha256 !== raw.gsaPlanSha256) {
        fail('gsa_plan_changed', 409);
      }
      const existing = index.decompositionDrafts?.[id];
      if (!existing) fail('decomposition_draft_not_found', 404);
      if (existing.revision !== raw.expectedDraftRevision) fail('decomposition_draft_conflict', 409);

      const changes: { crossCellId: string; label: string; viewId: string; from: number; to: number }[] = [];
      const nextViews = existing.views.map(view => ({
        ...view,
        cells: view.cells.map(cell => {
          const nextVal = updates.get(cell.crossCellId);
          if (nextVal === undefined) return cell;
          if (Math.abs(cell.value - nextVal) > 1e-6) {
            changes.push({ crossCellId: cell.crossCellId, label: cell.label, viewId: view.viewId, from: cell.value, to: nextVal });
          }
          return { ...cell, value: nextVal, basis: `${cell.basis}（对齐确认：${basis}）` };
        }),
      }));
      const nextRows = existing.rows.map(row => {
        if (!row.crossCellId || !updates.has(row.crossCellId)) return row;
        const nextVal = updates.get(row.crossCellId)!;
        return {
          ...row,
          targetValue: nextVal,
          basis: `${row.basis}（双方对齐：${basis}）`,
          checkpoints: row.checkpoints.map((cp, idx, arr) =>
            idx === arr.length - 1 && cp.status === 'planned' ? { ...cp, targetValue: nextVal } : cp,
          ),
        };
      });

      const now = new Date().toISOString();
      const nextDraftCore = {
        ...existing,
        revision: existing.revision + 1,
        updatedAt: now,
        updatedBy: 'user' as const,
        rows: nextRows,
        views: nextViews,
        alignmentRecord: { alignedAt: now, alignedBy, basis, changes },
      };
      const contentSha256 = sha256Canonical({
        gsaPlanId: nextDraftCore.gsaPlanId,
        gsaPlanVersion: nextDraftCore.gsaPlanVersion,
        gsaPlanSha256: nextDraftCore.gsaPlanSha256,
        estimate: nextDraftCore.estimate,
        rows: nextDraftCore.rows,
        reserves: nextDraftCore.reserves,
        gapStrategies: nextDraftCore.gapStrategies,
        views: nextDraftCore.views,
        timePlan: nextDraftCore.timePlan,
        notes: nextDraftCore.notes,
      });
      const updated: DecompositionDraft = { ...nextDraftCore, contentSha256 };
      this.bumpSchema4(index);
      index.decompositionDrafts![id] = updated;
      const validation = validateDecompositionForPublish(activePlan, updated, index.goals);
      return { result: { draft: updated, validation }, dirty: true };
    });
  }

  /** Strictly read-only publish preview (GM06). Zero writes, zero operation records. */
  previewDecompositionPublish(
    goalId: string,
    input: { gsaPlanId: string; gsaPlanVersion: number; gsaPlanSha256: string; draftRevision: number; draftSha256: string; expectedActiveVersion: number | null },
  ): DecompositionPublishPreview {
    const id = uuid(goalId);
    const index = this.load();
    const record = index.goals.find(g => g.id === id);
    if (!record) fail('strategy_goal_not_found', 404);
    const activePlan = index.gsaPlans?.[id]?.at(-1) ?? null;
    if (!activePlan) fail('gsa_plan_required', 409);
    if (record.adoptedVersion === null || activePlan.goal.version !== record.adoptedVersion) {
      fail('gsa_plan_stale_for_adopted_goal', 409);
    }
    if (activePlan.planId !== input.gsaPlanId || activePlan.planVersion !== input.gsaPlanVersion || activePlan.contentSha256 !== input.gsaPlanSha256) {
      fail('gsa_plan_changed', 409);
    }
    const currentDraft = index.decompositionDrafts?.[id];
    if (!currentDraft) fail('decomposition_draft_not_found', 404);
    if (currentDraft.revision !== input.draftRevision || currentDraft.contentSha256 !== input.draftSha256) {
      fail('decomposition_draft_changed', 409);
    }
    const activeVersion = index.activeDecompositionVersions?.[id] ?? null;
    if (activeVersion !== input.expectedActiveVersion) fail('decomposition_active_version_changed', 409);

    const validation = validateDecompositionForPublish(activePlan, currentDraft, index.goals);
    const existingPubs = index.decompositionPublications?.[id] ?? [];
    const goalsById = new Map(index.goals.map(g => [g.id, g]));
    const committedGoals = currentDraft.rows
      .filter(r => r.commitAsGoal)
      .map(row => {
        const existing = row.linkedGoalId ? goalsById.get(row.linkedGoalId) : undefined;
        let action: 'create-and-adopt' | 'reuse-adopted' | 'revise-and-adopt' = 'create-and-adopt';
        if (existing) {
          const adoptedVer = existing.adoptedVersion ? existing.versions.find(v => v.version === existing.adoptedVersion) : undefined;
          if (
            adoptedVer &&
            adoptedVer.title === row.title &&
            adoptedVer.outcome === row.outcome &&
            adoptedVer.responsible === row.responsible &&
            canonical(adoptedVer.scope) === canonical(row.scope) &&
            (adoptedVer.formalOrigin?.targetValue ?? null) === row.targetValue &&
            (adoptedVer.formalOrigin?.unit ?? row.unit) === row.unit &&
            canonical(adoptedVer.strategies ?? []) === canonical([row.strategy])
          ) {
            action = 'reuse-adopted';
          } else {
            action = 'revise-and-adopt';
          }
        }
        return {
          rowId: row.rowId,
          ...(row.linkedGoalId ? { linkedGoalId: row.linkedGoalId } : {}),
          ...(existing ? { expectedGoalVersion: existing.currentVersion, expectedAdoptedVersion: existing.adoptedVersion } : {}),
          action,
          title: row.title,
          outcome: row.outcome,
          scope: row.scope,
          responsible: row.responsible,
          strategy: row.strategy,
          targetValue: row.targetValue,
          unit: row.unit,
          checkpoints: row.checkpoints,
        };
      });

    return structuredClone({
      ok: validation.ok,
      issues: validation.issues,
      validation,
      gsaPlan: activePlan,
      draftRevision: currentDraft.revision,
      draftSha256: currentDraft.contentSha256,
      expectedActiveVersion: activeVersion,
      nextPublicationVersion: existingPubs.length + 1,
      committedGoals,
      summary: {
        formalTargetValue: validation.formalTargetValue,
        estimatedValue: validation.estimatedValue,
        gapValue: validation.gapValue,
        allocatedTotal: validation.allocatedTotal,
        reserveTotal: validation.reserveTotal,
        gapCoverageTotal: validation.gapCoverageTotal,
      },
    });
  }

  /**
   * Atomic decomposition publish with durable 3-state lost-response recovery (GM06, GM08, GM13).
   * Writes immutable snapshot blob first, then commits publication + committed adopted child Goals +
   * parent-child GoalRelations + active pointer + operation receipt in ONE index.json atomic rename.
   */
  publishDecomposition(
    goalId: string,
    input: DecompositionPublishInput,
    hooks?: { preCommitFault?: () => void },
  ): { publication: DecompositionPublication; operation: DecompositionPublishOperationRecord; replayed: boolean } {
    this.assertDecompositionWritable();
    const id = uuid(goalId);
    const operationId = reqUuid(input.operationId);
    const reason = input.reason?.trim() ? reqText(input.reason, 1000) : undefined;
    const requestFingerprint = sha256Canonical({
      goalId: id,
      gsaPlanId: input.gsaPlanId,
      gsaPlanVersion: input.gsaPlanVersion,
      gsaPlanSha256: input.gsaPlanSha256,
      draftRevision: input.draftRevision,
      draftSha256: input.draftSha256,
      expectedActiveVersion: input.expectedActiveVersion,
      reason,
    });

    this.inFlightPublishOps.add(operationId);
    try {
      return this.withLock(index => {
        const ops = (index.decompositionOperations ??= []);
        const priorOp = ops.find(op => op.operationId === operationId);
        if (priorOp) {
          if (priorOp.goalId !== id || priorOp.requestFingerprint !== requestFingerprint) {
            fail('decomposition_operation_conflict', 409);
          }
          if (priorOp.status === 'committed') {
            const pubSummary = index.decompositionPublications?.[id]?.find(p => p.version === priorOp.publicationVersion);
            if (!pubSummary) fail('decomposition_publication_unavailable', 409);
            const snapshot = this.readSnapshotBlob(pubSummary.snapshotSha256);
            return { result: { publication: { ...pubSummary, snapshot }, operation: priorOp, replayed: true as boolean }, dirty: false };
          }
          if (priorOp.status === 'abandoned') {
            fail('decomposition_operation_abandoned', 409);
          }
          // status === 'not-committed-retryable': strictly requires explicit retry + CAS stateRevision!
          if (input.explicitRetry !== true || input.expectedOperationStateRevision !== priorOp.stateRevision) {
            fail('decomposition_retry_requires_explicit_cas', 409);
          }
        }

        const parentGoalRecord = index.goals.find(g => g.id === id);
        if (!parentGoalRecord) fail('strategy_goal_not_found', 404);
        const activePlan = index.gsaPlans?.[id]?.at(-1) ?? null;
        if (!activePlan) fail('gsa_plan_required', 409);
        if (parentGoalRecord.adoptedVersion === null || activePlan.goal.version !== parentGoalRecord.adoptedVersion) {
          fail('gsa_plan_stale_for_adopted_goal', 409);
        }
        if (activePlan.planId !== input.gsaPlanId || activePlan.planVersion !== input.gsaPlanVersion || activePlan.contentSha256 !== input.gsaPlanSha256) {
          fail('gsa_plan_changed', 409);
        }
        const currentDraft = index.decompositionDrafts?.[id];
        if (!currentDraft) fail('decomposition_draft_not_found', 404);
        if (currentDraft.revision !== input.draftRevision || currentDraft.contentSha256 !== input.draftSha256) {
          fail('decomposition_draft_changed', 409);
        }
        const activeVersion = index.activeDecompositionVersions?.[id] ?? null;
        if (activeVersion !== input.expectedActiveVersion) fail('decomposition_active_version_changed', 409);

        const validation = validateDecompositionForPublish(activePlan, currentDraft, index.goals);
        if (!validation.ok) {
          const hasCas = validation.issues.some(i => i.code === 'row_cas_conflict' || i.code === 'gsa_plan_mismatch');
          fail(hasCas ? 'decomposition_row_cas_conflict' : 'decomposition_validation_failed', hasCas ? 409 : 400, { issues: validation.issues });
        }

        const now = new Date().toISOString();
        // Pre-commit hook / blob persistence: any failure BEFORE mutating goals/publications can be durably
        // recorded as 'not-committed-retryable' with zero partial commit!
        const nextPubVersion = (index.decompositionPublications?.[id]?.length ?? 0) + 1;
        const publicationId = randomUUID();
        const committedGoals: DecompositionCommittedGoal[] = [];
        const committedRelations: DecompositionCommittedRelation[] = [];

        // Stage child goal/relation mutations on a deep clone first so preCommitFault/blob write leaves index untouched!
        const stagedGoals = structuredClone(index.goals);
        const stagedRelations = structuredClone(index.relations);
        const parentGoalVersion = parentGoalRecord.versions.find(v => v.version === activePlan.goal.version)!;
        const updatedDraftRows = currentDraft.rows.map(row => {
          if (!row.commitAsGoal) return structuredClone(row);
          if (row.linkedGoalId === activePlan.goal.goalId) fail('invalid_self_relation', 400);
          let childRecord = row.linkedGoalId ? stagedGoals.find(g => g.id === row.linkedGoalId) : undefined;
          let adoptedChild: GoalVersion;
          const childDraftInput: GoalDraftInput = draft({
            title: row.title,
            outcome: row.outcome,
            perspective: parentGoalVersion.perspective,
            scope: row.scope,
            measurement: { kind: 'deliverable', criterion: row.milestoneCriterion || `${row.scopeLabel}：${row.outcome}` },
            baseline: { state: 'pending', description: row.basis || '由上层目标拆解发布承接' },
            responsible: row.responsible,
            ...(parentGoalVersion.dueAt ? { dueAt: parentGoalVersion.dueAt } : {}),
            strategies: [row.strategy],
            strategyContext: { summary: `来自总目标 ${id} 拆解表 v${nextPubVersion} · 行 ${row.rowId}` },
            ...(row.targetValue !== null ? {
              formalOrigin: {
                kind: 'manual-exception' as const,
                reason: `由总目标 ${id} 拆解正式版 v${nextPubVersion}（行 ${row.rowId}）承接`,
                period: activePlan.formalTarget.period,
                targetValue: row.targetValue,
                unit: row.unit,
                metricKind: row.metricKind,
              },
            } : {}),
          });
          if (!childRecord) {
            const newChildId = randomUUID();
            adoptedChild = {
              ...childDraftInput,
              goalId: newChildId,
              version: 1,
              status: 'adopted',
              createdAt: now,
              adoptedAt: now,
              adoptionDecision: `随总目标拆解表 v${nextPubVersion}（行 ${row.rowId}）一次正式发布采用，未授权经营执行。`,
            };
            childRecord = { id: newChildId, currentVersion: 1, adoptedVersion: 1, versions: [adoptedChild] };
            stagedGoals.push(childRecord);
          } else {
            const currentAdopted = childRecord.adoptedVersion ? childRecord.versions.find(v => v.version === childRecord!.adoptedVersion) : undefined;
            const unchanged = Boolean(
              currentAdopted &&
              currentAdopted.title === childDraftInput.title &&
              currentAdopted.outcome === childDraftInput.outcome &&
              currentAdopted.responsible === childDraftInput.responsible &&
              canonical(currentAdopted.scope) === canonical(childDraftInput.scope) &&
              (currentAdopted.formalOrigin?.targetValue ?? null) === row.targetValue &&
              (currentAdopted.formalOrigin?.unit ?? row.unit) === row.unit &&
              canonical(currentAdopted.strategies ?? []) === canonical(childDraftInput.strategies ?? []),
            );
            if (unchanged && currentAdopted) {
              adoptedChild = currentAdopted;
            } else {
              adoptedChild = {
                ...childDraftInput,
                goalId: childRecord.id,
                version: childRecord.currentVersion + 1,
                status: 'adopted',
                createdAt: now,
                adoptedAt: now,
                adoptionDecision: `随总目标拆解表 v${nextPubVersion}（行 ${row.rowId}）修订发布采用，未授权经营执行。`,
              };
              childRecord.versions.push(adoptedChild);
              childRecord.currentVersion = adoptedChild.version;
              childRecord.adoptedVersion = adoptedChild.version;
            }
          }

          committedGoals.push({
            rowId: row.rowId,
            goalId: adoptedChild.goalId,
            version: adoptedChild.version,
            adoptedVersion: adoptedChild.version,
            title: adoptedChild.title,
            scope: adoptedChild.scope,
            responsible: adoptedChild.responsible,
            strategy: row.strategy,
            targetValue: row.targetValue,
            unit: row.unit,
          });

          // Create or reuse contribution relation from child -> parent exact adopted GoalRef (enforcing same invariant as assertGoalIndex)
          if (adoptedChild.goalId === activePlan.goal.goalId) fail('invalid_self_relation', 400);
          const relBody = {
            from: { goalId: adoptedChild.goalId, version: adoptedChild.version },
            to: { goalId: activePlan.goal.goalId, version: activePlan.goal.version },
            kind: 'contribution' as const,
            responsibility: `${row.responsible}（${row.scopeLabel}）`,
            rationale: row.basis || `总目标拆解表 v${nextPubVersion} 责任行 ${row.rowId}`,
          };
          let rel = stagedRelations.find(r => canonical(relationInput(r)) === canonical(relBody));
          if (!rel) {
            rel = { ...relBody, id: randomUUID(), revision: 1, createdAt: now, history: [] };
            stagedRelations.push(rel);
          }
          committedRelations.push({
            rowId: row.rowId,
            relationId: rel.id,
            revision: rel.revision,
            from: relBody.from,
            to: relBody.to,
          });

          return {
            ...structuredClone(row),
            linkedGoalId: adoptedChild.goalId,
            expectedGoalVersion: childRecord.currentVersion,
            expectedAdoptedVersion: childRecord.adoptedVersion,
          };
        });

        const snapshot: DecompositionPublicationSnapshot = {
          gsaPlan: structuredClone(activePlan),
          estimate: structuredClone(currentDraft.estimate),
          rows: updatedDraftRows,
          reserves: structuredClone(currentDraft.reserves),
          gapStrategies: structuredClone(currentDraft.gapStrategies),
          views: structuredClone(currentDraft.views),
          timePlan: structuredClone(currentDraft.timePlan),
          frozenCheckpoints: freezeRowCheckpoints(updatedDraftRows),
          ...(currentDraft.alignmentRecord ? { alignmentRecord: structuredClone(currentDraft.alignmentRecord) } : {}),
          ...(currentDraft.notes ? { notes: currentDraft.notes } : {}),
        };

        let snapshotSha256: string;
        try {
          hooks?.preCommitFault?.();
          snapshotSha256 = this.writeSnapshotBlob(snapshot);
        } catch (err) {
          // Clean pre-commit failure: zero goals/publications mutated. Durably record 'not-committed-retryable'!
          const code = err instanceof StrategyGoalsError || err instanceof GoalDecompositionError ? err.code : 'decomposition_pre_commit_failed';
          const detail = err instanceof Error ? err.message : String(err);
          this.bumpSchema4(index);
          if (priorOp) {
            priorOp.status = 'not-committed-retryable';
            priorOp.attempts += 1;
            priorOp.settledAt = now;
            priorOp.failureCode = code;
            priorOp.failureDetail = detail;
            priorOp.stateRevision += 1;
          } else {
            ops.push({
              operationId,
              goalId: id,
              action: 'publish-decomposition',
              requestFingerprint,
              status: 'not-committed-retryable',
              attempts: 1,
              startedAt: now,
              settledAt: now,
              failureCode: code,
              failureDetail: detail,
              stateRevision: 1,
            });
          }
          this.write(index);
          fail('decomposition_publish_not_committed', 503, { operationId, retryable: true, failureCode: code });
        }

        // Commit everything atomically into index.json!
        index.goals = stagedGoals;
        index.relations = stagedRelations;
        // Keep draft's stable linkedGoalId & CAS expectations synced AND recompute contentSha256 consistently
        const syncedDraftContent = {
          gsaPlanId: currentDraft.gsaPlanId,
          gsaPlanVersion: currentDraft.gsaPlanVersion,
          gsaPlanSha256: currentDraft.gsaPlanSha256,
          estimate: currentDraft.estimate,
          rows: updatedDraftRows,
          reserves: currentDraft.reserves,
          gapStrategies: currentDraft.gapStrategies,
          views: currentDraft.views,
          timePlan: currentDraft.timePlan,
          ...(currentDraft.alignmentRecord ? { alignmentRecord: currentDraft.alignmentRecord } : {}),
          ...(currentDraft.notes ? { notes: currentDraft.notes } : {}),
        };
        index.decompositionDrafts![id] = {
          ...currentDraft,
          rows: updatedDraftRows,
          contentSha256: sha256Canonical(syncedDraftContent),
        };
        const summary: DecompositionPublicationSummary = {
          publicationId,
          goalId: id,
          version: nextPubVersion,
          gsaPlanId: activePlan.planId,
          gsaPlanVersion: activePlan.planVersion,
          gsaPlanSha256: activePlan.contentSha256,
          draftRevision: currentDraft.revision,
          draftSha256: currentDraft.contentSha256,
          snapshotSha256,
          operationId,
          publishedAt: now,
          ...(reason ? { reason } : {}),
          ...(nextPubVersion > 1 ? { previousVersion: nextPubVersion - 1 } : {}),
          committedGoals,
          committedRelations,
        };
        this.bumpSchema4(index);
        (index.decompositionPublications ??= {})[id] = [...(index.decompositionPublications[id] ?? []), summary];
        (index.activeDecompositionVersions ??= {})[id] = nextPubVersion;

        let settledOp: DecompositionPublishOperationRecord;
        if (priorOp) {
          priorOp.status = 'committed';
          priorOp.attempts += 1;
          priorOp.settledAt = now;
          priorOp.publicationId = publicationId;
          priorOp.publicationVersion = nextPubVersion;
          delete priorOp.failureCode;
          delete priorOp.failureDetail;
          priorOp.stateRevision += 1;
          settledOp = priorOp;
        } else {
          settledOp = {
            operationId,
            goalId: id,
            action: 'publish-decomposition',
            requestFingerprint,
            status: 'committed',
            attempts: 1,
            startedAt: now,
            settledAt: now,
            publicationId,
            publicationVersion: nextPubVersion,
            stateRevision: 1,
          };
          ops.push(settledOp);
        }
        return {
          result: { publication: { ...summary, snapshot }, operation: settledOp, replayed: false },
          dirty: true,
        };
      });
    } finally {
      this.inFlightPublishOps.delete(operationId);
    }
  }

  /** Read-only 3-state operation recovery lookup (GM08). Never creates sessions or writes records. */
  getDecompositionOperation(goalId: string, operationId: string): DecompositionOperationRecoveryResult {
    const id = uuid(goalId);
    const opId = reqUuid(operationId);
    if (this.inFlightPublishOps.has(opId)) {
      return { found: true, status: 'in-flight', retryable: false };
    }
    const index = this.load();
    if (!index.goals.some(g => g.id === id)) fail('strategy_goal_not_found', 404);
    const op = index.decompositionOperations?.find(item => item.operationId === opId && item.goalId === id);
    if (!op) {
      return { found: false, status: 'unknown', retryable: false };
    }
    if (op.status === 'committed') {
      const summary = index.decompositionPublications?.[id]?.find(p => p.version === op.publicationVersion);
      if (!summary) fail('decomposition_publication_unavailable', 409);
      const snapshot = this.readSnapshotBlob(summary.snapshotSha256);
      return structuredClone({
        found: true,
        status: 'committed',
        retryable: false,
        operation: op,
        publication: { ...summary, snapshot },
      });
    }
    if (op.status === 'not-committed-retryable') {
      return structuredClone({
        found: true,
        status: 'not-committed-retryable',
        retryable: true,
        operation: op,
      });
    }
    return structuredClone({
      found: true,
      status: op.status,
      retryable: false,
      operation: op,
    });
  }

  /** Explicitly closes a provably-uncommitted operation so the user can edit and start a new intent. */
  abandonDecompositionOperation(goalId: string, operationId: string, expectedStateRevision: number): DecompositionPublishOperationRecord {
    this.assertDecompositionWritable();
    const id = uuid(goalId);
    const opId = reqUuid(operationId);
    positive(expectedStateRevision);
    return this.withLock(index => {
      const op = index.decompositionOperations?.find(item => item.operationId === opId && item.goalId === id);
      if (!op) fail('decomposition_operation_not_found', 404);
      if (op.status === 'abandoned') return { result: op, dirty: false };
      if (op.status !== 'not-committed-retryable' || op.stateRevision !== expectedStateRevision) {
        fail('decomposition_operation_cannot_abandon', 409);
      }
      op.status = 'abandoned';
      op.settledAt = new Date().toISOString();
      op.stateRevision += 1;
      return { result: op, dirty: true };
    });
  }

  listDecompositionPublications(goalId: string, offset = 0, limit = 20): { total: number; offset: number; limit: number; activeVersion: number | null; items: DecompositionPublicationSummary[] } {
    const id = uuid(goalId);
    const index = this.load();
    if (!index.goals.some(g => g.id === id)) fail('strategy_goal_not_found', 404);
    const all = index.decompositionPublications?.[id] ?? [];
    const safeOffset = Math.max(0, Math.min(all.length, Number.isSafeInteger(offset) ? offset : 0));
    const safeLimit = Math.max(1, Math.min(100, Number.isSafeInteger(limit) ? limit : 20));
    return structuredClone({
      total: all.length,
      offset: safeOffset,
      limit: safeLimit,
      activeVersion: index.activeDecompositionVersions?.[id] ?? null,
      items: all.slice(safeOffset, safeOffset + safeLimit),
    });
  }

  readDecompositionPublication(goalId: string, version: number): DecompositionPublication {
    const id = uuid(goalId);
    positive(version);
    const index = this.load();
    if (!index.goals.some(g => g.id === id)) fail('strategy_goal_not_found', 404);
    const summary = index.decompositionPublications?.[id]?.find(p => p.version === version);
    if (!summary) fail('decomposition_publication_not_found', 404);
    const snapshot = this.readSnapshotBlob(summary.snapshotSha256);
    return structuredClone({ ...summary, snapshot });
  }

  // ---- GM10 / GM11: Thresholds, Immutable Progress Checks & Independent Case Draft Intents ----

  setThreshold(goalId: string, input: Partial<DecompositionThresholdConfig>): DecompositionThresholdConfig {
    this.assertDecompositionWritable();
    const id = uuid(goalId);
    const configured = Boolean(input.configured);
    const adverseDirection = input.adverseDirection === 'above' ? 'above' : 'below';
    const unit = input.unit === 'percentage-points' ? 'percentage-points' : 'percent';
    const magnitudePct = input.magnitudePct === undefined ? undefined : (typeof input.magnitudePct === 'number' && Number.isFinite(input.magnitudePct) && input.magnitudePct > 0 ? input.magnitudePct : fail('invalid_threshold_config', 400));
    const consecutivePeriods = input.consecutivePeriods === undefined ? undefined : (Number.isSafeInteger(input.consecutivePeriods) && Number(input.consecutivePeriods) >= 1 ? Number(input.consecutivePeriods) : fail('invalid_threshold_config', 400));
    if (configured && magnitudePct === undefined && consecutivePeriods === undefined) {
      fail('invalid_threshold_config', 400);
    }
    return this.withLock(index => {
      if (!index.goals.some(g => g.id === id)) fail('strategy_goal_not_found', 404);
      this.bumpSchema4(index);
      const saved: DecompositionThresholdConfig = {
        configured,
        ...(configured && magnitudePct !== undefined ? { magnitudePct } : {}),
        ...(configured && consecutivePeriods !== undefined ? { consecutivePeriods } : {}),
        adverseDirection,
        unit,
        updatedAt: new Date().toISOString(),
      };
      (index.thresholds ??= {})[id] = saved;
      return { result: saved, dirty: true };
    });
  }

  recordProgressCheck(goalId: string, input: DecompositionProgressCheckInput): { check: DecompositionProgressCheck; replayed: boolean } {
    this.assertDecompositionWritable();
    const id = uuid(goalId);
    const operationId = reqUuid(input.operationId);
    positive(input.publicationVersion);
    const rowId = reqText(input.rowId, 120);
    const checkpointId = reqText(input.checkpointId, 120);
    if (!['comparable', 'partial-missing', 'incomparable', 'observing'].includes(input.comparability)) {
      fail('invalid_progress_comparability', 400);
    }
    if (!object(input.actualSource) || !Array.isArray(input.actualPeriods) || !input.actualPeriods.length || input.actualPeriods.length > 52) {
      fail('invalid_progress_check', 400);
    }
    const actualSource = {
      ref: reqText(input.actualSource.ref, 300),
      label: reqText(input.actualSource.label, 300),
      cutoffAt: reqText(input.actualSource.cutoffAt, 100),
      ...(input.actualSource.coverageNote?.trim() ? { coverageNote: reqText(input.actualSource.coverageNote, 1000) } : {}),
    };

    return this.withLock(index => {
      const record = index.goals.find(g => g.id === id);
      if (!record) fail('strategy_goal_not_found', 404);
      const existingChecks = index.progressChecks?.[id] ?? [];
      const prior = existingChecks.find(c => c.operationId === operationId);
      if (prior) return { result: { check: prior, replayed: true as boolean }, dirty: false };

      const pubSummary = index.decompositionPublications?.[id]?.find(p => p.version === input.publicationVersion);
      if (!pubSummary) fail('decomposition_publication_not_found', 404);
      const snapshot = this.readSnapshotBlob(pubSummary.snapshotSha256);

      // Freeze planned values strictly from this exact immutable publication snapshot (NEVER from current draft!)
      // Item 4: Distinguish G-TOTAL summary timePlan vs responsibility row frozen checkpoint!
      let plannedPeriods: { periodId: string; label: string; plannedValue: number | null; status?: string }[];
      if (rowId === 'G-TOTAL') {
        plannedPeriods = input.actualPeriods.map(ap => {
          const tp = snapshot.timePlan.find(t => t.periodId === ap.periodId);
          if (!tp) return fail('decomposition_checkpoint_not_found', 404);
          if (tp.checkpointId && checkpointId !== tp.checkpointId && checkpointId !== tp.periodId) {
            return fail('decomposition_checkpoint_mismatch', 409);
          }
          return { periodId: tp.periodId, label: tp.label, plannedValue: tp.targetValue, status: tp.status };
        });
      } else {
        if (!snapshot.rows.some(r => r.rowId === rowId)) fail('decomposition_row_not_found', 404);
        const cp = snapshot.frozenCheckpoints.find(c => c.checkpointId === checkpointId && c.rowId === rowId);
        if (!cp) fail('decomposition_checkpoint_not_found', 404);
        plannedPeriods = input.actualPeriods.map(ap => ({
          periodId: ap.periodId,
          label: ap.label || cp.label,
          plannedValue: cp.targetValue,
          status: cp.status,
        }));
      }

      const thresholdSnapshot = structuredClone(index.thresholds?.[id] ?? defaultThreshold());
      const scopeKey = rowId === 'G-TOTAL'
        ? `${id}:G-TOTAL`
        : `${id}:${rowId}`;
      const metricId = input.metricId?.trim() || snapshot.estimate.sapMetric?.id || snapshot.estimate.metricKind;
      const periodGranularity = input.periodGranularity ?? (snapshot.timePlan[0]?.granularity ?? 'week');
      const periodSequenceKey = input.periodSequenceKey?.trim() || input.actualPeriods.map(p => p.periodId).join(',');

      const evaluated = evaluateProgressComparison({
        comparability: input.comparability,
        plannedPeriods,
        actualPeriods: input.actualPeriods,
        threshold: thresholdSnapshot,
        priorChecks: existingChecks,
        scopeKey,
        metricId,
        periodGranularity,
        currentSequenceKey: periodSequenceKey,
        ...(input.supplementOfCheckId?.trim() ? { supplementOfCheckId: input.supplementOfCheckId.trim() } : {}),
      });

      const check: DecompositionProgressCheck = {
        checkId: `CHECK-${String(existingChecks.length + 1).padStart(3, '0')}`,
        goalId: id,
        gsaPlanId: pubSummary.gsaPlanId,
        gsaPlanVersion: pubSummary.gsaPlanVersion,
        gsaPlanSha256: pubSummary.gsaPlanSha256,
        publicationId: pubSummary.publicationId,
        publicationVersion: pubSummary.version,
        rowId,
        checkpointId,
        scopeKey,
        metricId,
        periodGranularity,
        periodSequenceKey,
        actualSource,
        comparability: input.comparability,
        ...(input.missingCoverageNote?.trim() ? { missingCoverageNote: reqText(input.missingCoverageNote, 1000) } : {}),
        periods: evaluated.periods,
        overallPending: evaluated.overallPending,
        overallAbsoluteDiff: evaluated.overallAbsoluteDiff,
        overallVariancePct: evaluated.overallVariancePct,
        thresholdSnapshot,
        trigger: evaluated.trigger,
        caseChoice: null,
        ...(input.supplementOfCheckId?.trim() ? { supplementOfCheckId: reqText(input.supplementOfCheckId, 120) } : {}),
        recordedAt: new Date().toISOString(),
        operationId,
      };
      this.bumpSchema4(index);
      (index.progressChecks ??= {})[id] = [...existingChecks, check];
      return { result: { check, replayed: false }, dirty: true };
    });
  }

  setCheckCaseChoice(
    goalId: string,
    checkId: string,
    input: { operationId: string; kind: ProgressCaseChoice['kind']; caseId?: string; intentId?: string; title?: string; strategy?: string; note?: string },
  ): { check: DecompositionProgressCheck; caseDraftIntent?: DecompositionCaseDraftIntent } {
    this.assertDecompositionWritable();
    const id = uuid(goalId);
    const operationId = reqUuid(input.operationId);
    return this.withLock(index => {
      const record = index.goals.find(g => g.id === id);
      if (!record) fail('strategy_goal_not_found', 404);
      const checks = index.progressChecks?.[id] ?? [];
      const check = checks.find(c => c.checkId === checkId);
      if (!check) fail('progress_check_not_found', 404);
      const now = new Date().toISOString();
      const note = input.note?.trim() ? reqText(input.note, 2000) : undefined;
      let createdIntent: DecompositionCaseDraftIntent | undefined;

      if (input.kind === 'observe' || input.kind === 'supplement') {
        check.caseChoice = { kind: input.kind, ...(note ? { note } : {}), decidedAt: now };
      } else if (input.kind === 'continue-existing') {
        const caseId = reqText(input.caseId, 120, 'case_id_required');
        check.caseChoice = { kind: 'continue-existing', caseId, ...(note ? { note } : {}), decidedAt: now };
      } else if (input.kind === 'create-new-draft') {
        const intents = (index.caseDraftIntents ??= {})[id] ?? [];
        const requestedIntentId = input.intentId?.trim() ? reqText(input.intentId, 120) : `CASE-DRAFT-${randomUUID().slice(0, 8)}`;
        const existingIntent = intents.find(item => item.intentId === requestedIntentId || item.operationId === operationId);
        if (existingIntent) {
          createdIntent = existingIntent;
        } else {
          const gsaPlan = index.gsaPlans?.[id]?.find(p => p.planVersion === check.gsaPlanVersion);
          const goalRefBound = gsaPlan?.goal ?? { goalId: id, version: record.adoptedVersion ?? record.currentVersion };
          const goalVer = record.versions.find(v => v.version === goalRefBound.version)!;
          const strategy = input.strategy?.trim() || goalVer.strategies?.[0] || '当前目标策略';
          createdIntent = {
            intentId: requestedIntentId,
            operationId,
            goalId: id,
            goalRef: goalRefBound,
            strategy,
            title: input.title?.trim() || `${check.checkId} 偏差独立决策草稿`,
            scope: goalVer.scope,
            period: gsaPlan?.formalTarget.period ?? goalVer.dueAt?.slice(0, 7) ?? '当期',
            kind: 'deviation-followup',
            status: 'draft-pending-confirmation',
            checkId: check.checkId,
            gsaPlanRef: { planId: check.gsaPlanId, planVersion: check.gsaPlanVersion, contentSha256: check.gsaPlanSha256 },
            publicationRef: { publicationId: check.publicationId, version: check.publicationVersion, rowId: check.rowId, checkpointId: check.checkpointId },
            actualSourceRef: check.actualSource.ref,
            evidenceSummary: note || `负责人在 ${check.checkId}（拆解表 v${check.publicationVersion} / ${check.rowId} / ${check.checkpointId}，实绩 ${check.actualSource.ref}）选择另建 Case 草稿。`,
            createdAt: now,
          };
          index.caseDraftIntents[id] = [...intents, createdIntent];
        }
        check.caseChoice = { kind: 'create-new-draft', intentId: createdIntent.intentId, ...(note ? { note } : {}), decidedAt: now };
      } else {
        fail('invalid_case_choice', 400);
      }

      this.bumpSchema4(index);
      return { result: { check, ...(createdIntent ? { caseDraftIntent: createdIntent } : {}) }, dirty: true };
    });
  }

  /** Supports both proactive pilot Case drafts (directly from adopted G+S) and independent follow-up Case drafts. */
  createCaseDraftIntent(goalId: string, input: DecompositionCaseDraftIntentInput): { intent: DecompositionCaseDraftIntent; replayed: boolean } {
    this.assertDecompositionWritable();
    const id = uuid(goalId);
    const operationId = reqUuid(input.operationId);
    const title = reqText(input.title, 300);
    const strategy = reqText(input.strategy, 2000);
    const evidenceSummary = reqText(input.evidenceSummary, 4000);
    if (input.kind !== 'deviation-followup' && input.kind !== 'proactive-pilot') fail('invalid_case_draft_intent', 400);

    return this.withLock(index => {
      const record = index.goals.find(g => g.id === id);
      if (!record) fail('strategy_goal_not_found', 404);
      const targetVersion = input.goalVersion ?? record.adoptedVersion;
      if (!targetVersion) fail('strategy_goal_not_adopted', 409);
      const goalVer = record.versions.find(v => v.version === targetVersion);
      if (!goalVer || goalVer.status !== 'adopted') fail('strategy_goal_not_adopted', 409);
      if (goalVer.strategies?.length && !goalVer.strategies.includes(strategy)) {
        fail('case_strategy_not_found', 409);
      }

      const intents = (index.caseDraftIntents ??= {})[id] ?? [];
      const priorByOp = intents.find(item => item.operationId === operationId || (input.intentId && item.intentId === input.intentId));
      if (priorByOp) {
        if (priorByOp.title !== title || priorByOp.strategy !== strategy || priorByOp.checkId !== input.checkId) {
          fail('case_draft_intent_conflict', 409);
        }
        return { result: { intent: priorByOp, replayed: true as boolean }, dirty: false };
      }

      const check = input.checkId ? index.progressChecks?.[id]?.find(c => c.checkId === input.checkId) : undefined;
      if (input.checkId && !check) fail('progress_check_not_found', 404);
      const activePlan = index.gsaPlans?.[id]?.at(-1);

      const intent: DecompositionCaseDraftIntent = {
        intentId: input.intentId?.trim() || `CASE-DRAFT-${randomUUID().slice(0, 8)}`,
        operationId,
        goalId: id,
        goalRef: { goalId: id, version: goalVer.version },
        strategy,
        title,
        scope: goalVer.scope,
        period: activePlan?.formalTarget.period ?? goalVer.dueAt?.slice(0, 7) ?? '当期',
        kind: input.kind,
        status: 'draft-pending-confirmation',
        ...(check ? {
          checkId: check.checkId,
          gsaPlanRef: { planId: check.gsaPlanId, planVersion: check.gsaPlanVersion, contentSha256: check.gsaPlanSha256 },
          publicationRef: { publicationId: check.publicationId, version: check.publicationVersion, rowId: check.rowId, checkpointId: check.checkpointId },
          actualSourceRef: check.actualSource.ref,
        } : activePlan ? {
          gsaPlanRef: { planId: activePlan.planId, planVersion: activePlan.planVersion, contentSha256: activePlan.contentSha256 },
        } : {}),
        evidenceSummary,
        createdAt: new Date().toISOString(),
      };
      this.bumpSchema4(index);
      index.caseDraftIntents[id] = [...intents, intent];
      return { result: { intent, replayed: false }, dirty: true };
    });
  }

  // ---- UI04: Read-only Project Handoff Preview & Explicit Handoff Confirmation ----

  previewProjectHandoff(goalId: string, publicationVersion: number, rowId: string, checkpointId?: string): DecompositionProjectHandoffPreview {
    const id = uuid(goalId);
    positive(publicationVersion);
    const cleanRowId = reqText(rowId, 120);
    const index = this.load();
    const pubSummary = index.decompositionPublications?.[id]?.find(p => p.version === publicationVersion);
    if (!pubSummary) fail('decomposition_publication_not_found', 404);
    const snapshot = this.readSnapshotBlob(pubSummary.snapshotSha256);
    const row = snapshot.rows.find(r => r.rowId === cleanRowId);
    if (!row) fail('decomposition_row_not_found', 404);
    const checkpoint = checkpointId
      ? snapshot.frozenCheckpoints.find(cp => cp.rowId === cleanRowId && cp.checkpointId === checkpointId)
      : snapshot.frozenCheckpoints.find(cp => cp.rowId === cleanRowId);
    if (!checkpoint) fail('decomposition_frozen_checkpoint_unavailable', 409);

    const existing = index.projectHandoffs?.[id]?.find(h => h.publicationVersion === publicationVersion && h.rowId === cleanRowId);
    const committed = pubSummary.committedGoals.find(g => g.rowId === cleanRowId);
    const goalRefBound: GoalRef = committed ? { goalId: committed.goalId, version: committed.version } : snapshot.gsaPlan.goal;

    return structuredClone({
      ok: true,
      ...(existing ? { existing } : {}),
      goalRef: goalRefBound,
      gsaPlanRef: { planId: snapshot.gsaPlan.planId, planVersion: snapshot.gsaPlan.planVersion, contentSha256: snapshot.gsaPlan.contentSha256 },
      publicationId: pubSummary.publicationId,
      publicationVersion: pubSummary.version,
      rowId: row.rowId,
      rowTitle: row.title,
      scope: row.scope,
      responsible: row.responsible,
      strategy: row.strategy,
      targetValue: row.targetValue,
      unit: row.unit,
      checkpoint,
      note: '仅预览并固定准确版本引用，不自动创建任务、人员安排或行动授权。',
    });
  }

  confirmProjectHandoff(goalId: string, input: DecompositionProjectHandoffInput): { handoff: DecompositionProjectHandoff; replayed: boolean } {
    this.assertDecompositionWritable();
    const id = uuid(goalId);
    const operationId = reqUuid(input.operationId);
    const preview = this.previewProjectHandoff(id, input.publicationVersion, input.rowId, input.checkpointId);
    return this.withLock(index => {
      const list = (index.projectHandoffs ??= {})[id] ?? [];
      const existing = list.find(h => h.operationId === operationId || (h.publicationVersion === preview.publicationVersion && h.rowId === preview.rowId));
      if (existing) return { result: { handoff: existing, replayed: true as boolean }, dirty: false };
      const handoff: DecompositionProjectHandoff = {
        handoffId: randomUUID(),
        operationId,
        goalId: id,
        goalRef: preview.goalRef,
        gsaPlanRef: preview.gsaPlanRef,
        publicationId: preview.publicationId,
        publicationVersion: preview.publicationVersion,
        rowId: preview.rowId,
        rowTitle: preview.rowTitle,
        scope: preview.scope,
        responsible: preview.responsible,
        strategy: preview.strategy,
        targetValue: preview.targetValue,
        unit: preview.unit,
        checkpoint: preview.checkpoint,
        projectPlanStatus: 'draft-reference-only',
        authorityStatus: 'not-authorized',
        ...(input.linkedProjectId ? { linkedProjectId: reqUuid(input.linkedProjectId) } : {}),
        createdAt: new Date().toISOString(),
      };
      this.bumpSchema4(index);
      index.projectHandoffs[id] = [...list, handoff];
      return { result: { handoff, replayed: false }, dirty: true };
    });
  }

  readProjectHandoff(goalId: string, handoffId: string): DecompositionProjectHandoff {
    const id = uuid(goalId);
    const hid = reqUuid(handoffId);
    const index = this.load();
    if (!index.goals.some(g => g.id === id)) fail('strategy_goal_not_found', 404);
    const found = index.projectHandoffs?.[id]?.find(h => h.handoffId === hid);
    if (!found) fail('project_handoff_not_found', 404);
    return structuredClone(found);
  }

  // ---- GM12: Cycle Review, Next-Cycle Draft & Return to Strategy Choice ----

  recordCycleReview(goalId: string, input: DecompositionCycleReviewInput): { review: DecompositionCycleReview; replayed: boolean } {
    this.assertDecompositionWritable();
    const id = uuid(goalId);
    const operationId = reqUuid(input.operationId);
    const period = reqText(input.period, 100);
    const actualFinalValue = input.actualFinalValue === null || input.actualFinalValue === undefined
      ? null
      : (typeof input.actualFinalValue === 'number' && Number.isFinite(input.actualFinalValue)
        ? input.actualFinalValue
        : fail('invalid_cycle_review', 400));
    const actualSourceRef = actualFinalValue === null
      ? (input.actualSourceRef?.trim() ? reqText(input.actualSourceRef, 500) : '待补实绩凭证')
      : reqText(input.actualSourceRef, 500);
    const conclusions = (input.conclusions ?? []).map(classifyReviewConclusion);

    return this.withLock(index => {
      const record = index.goals.find(g => g.id === id);
      if (!record) fail('strategy_goal_not_found', 404);
      const existingReviews = index.cycleReviews?.[id] ?? [];
      const prior = existingReviews.find(r => r.operationId === operationId);
      if (prior) return { result: { review: prior, replayed: true as boolean }, dirty: false };

      // GM12 (Item 6): Strictly evaluate against CONFIRMED GSA plans for this EXACT reviewed period
      // whose bound goal version is adopted — ignore unconfirmed goal revisions or other periods!
      const periodPlans = (index.gsaPlans?.[id] ?? []).filter(p => {
        const gv = record.versions.find(v => v.version === p.goal.version);
        return p.formalTarget.period === period && gv?.status === 'adopted';
      });
      if (!periodPlans.length) fail('gsa_plan_required_for_review_period', 409);
      const firstPlan = periodPlans[0]!;
      const lastPlan = periodPlans.at(-1)!;
      const initialTarget = firstPlan.formalTarget;
      const lastTarget = lastPlan.formalTarget;

      const varianceValue = actualFinalValue === null ? null : Number((actualFinalValue - lastTarget.value).toFixed(6));
      const outcomeSummary = actualFinalValue === null
        ? `依据本周期最后生效的已确认总 GSA（v${lastPlan.planVersion} · ${lastTarget.value}${lastTarget.unit}），期末最终实绩待补，暂不计算完成差额（期初承诺 ${initialTarget.value}${initialTarget.unit} 仅作备忘）。`
        : varianceValue! >= 0
          ? `依据本周期最后生效的已确认总 GSA（v${lastPlan.planVersion} · ${lastTarget.value}${lastTarget.unit}），实际完成 ${actualFinalValue}${lastTarget.unit}，超出目标 ${varianceValue}${lastTarget.unit}（期初承诺 ${initialTarget.value}${initialTarget.unit} 仅作备忘；总量达成不直接证明单条策略因果成立）。`
          : `依据本周期最后生效的已确认总 GSA（v${lastPlan.planVersion} · ${lastTarget.value}${lastTarget.unit}），实际完成 ${actualFinalValue}${lastTarget.unit}，低于目标 ${Math.abs(varianceValue!)}${lastTarget.unit}（期初承诺 ${initialTarget.value}${initialTarget.unit} 仅作备忘）。`;

      const review: DecompositionCycleReview = {
        reviewId: randomUUID(),
        operationId,
        goalId: id,
        period,
        initialFormalTarget: {
          goalRef: { goalId: id, version: firstPlan.goal.version },
          gsaPlanVersion: firstPlan.planVersion,
          value: initialTarget.value,
          unit: initialTarget.unit,
          memoOnly: true,
        },
        lastEffectiveFormalTarget: {
          goalRef: { goalId: id, version: lastPlan.goal.version },
          gsaPlanVersion: lastPlan.planVersion,
          value: lastTarget.value,
          unit: lastTarget.unit,
        },
        actualFinalValue,
        actualSourceRef,
        varianceValue,
        outcomeSummary,
        preservedCheckIds: (index.progressChecks?.[id] ?? []).map(c => c.checkId),
        conclusions,
        recordedAt: new Date().toISOString(),
      };
      this.bumpSchema4(index);
      (index.cycleReviews ??= {})[id] = [...existingReviews, review];
      return { result: { review, replayed: false }, dirty: true };
    });
  }

  createNextCycleDraft(goalId: string, input: NextCycleDraftInput): { nextCycleDraft: NextCycleDraft; replayed: boolean } {
    this.assertDecompositionWritable();
    const id = uuid(goalId);
    const operationId = reqUuid(input.operationId);
    const reviewId = reqUuid(input.reviewId);
    const nextPeriod = reqText(input.nextPeriod, 100);
    if (!Array.isArray(input.selectedConclusionIds) || !input.selectedConclusionIds.length) {
      fail('cycle_review_conclusions_required', 400);
    }

    return this.withLock(index => {
      const record = index.goals.find(g => g.id === id);
      if (!record) fail('strategy_goal_not_found', 404);
      const list = (index.nextCycleDrafts ??= {})[id] ?? [];
      const prior = list.find(d => d.operationId === operationId);
      if (prior) return { result: { nextCycleDraft: prior, replayed: true as boolean }, dirty: false };
      const review = index.cycleReviews?.[id]?.find(r => r.reviewId === reviewId);
      if (!review) fail('cycle_review_not_found', 404);
      const currentGoal = record.versions.find(v => v.version === (record.adoptedVersion ?? record.currentVersion))!;
      const targetScope = input.targetScope ?? currentGoal.scope;
      const scopeChanged = canonical(targetScope) !== canonical(currentGoal.scope);

      const selectedConclusions = input.selectedConclusionIds.map(cid => {
        const found = review.conclusions.find(c => c.id === cid);
        if (!found) fail('cycle_review_conclusion_not_found', 404);
        // Cross-scope promotion ALWAYS forces hypothesis-unverified!
        if (scopeChanged) {
          return { ...found, targetScopeSameAsOriginal: false, classification: 'hypothesis-unverified' as const };
        }
        return found;
      });

      const nextCycleDraft: NextCycleDraft = {
        draftId: randomUUID(),
        operationId,
        sourceGoalId: id,
        sourceReviewId: reviewId,
        nextPeriod,
        targetScope,
        selectedConclusions,
        status: 'draft-not-adopted',
        createdAt: new Date().toISOString(),
      };
      this.bumpSchema4(index);
      index.nextCycleDrafts[id] = [...list, nextCycleDraft];
      return { result: { nextCycleDraft, replayed: false }, dirty: true };
    });
  }

  recordStrategyReturn(goalId: string, input: StrategyReturnInput): { strategyReturn: StrategyReturnRecord; replayed: boolean } {
    this.assertDecompositionWritable();
    const id = uuid(goalId);
    const operationId = reqUuid(input.operationId);
    const reviewId = reqUuid(input.reviewId);
    const reason = reqText(input.reason, 2000);
    if (!Array.isArray(input.evidenceRefs) || !input.evidenceRefs.length) fail('strategy_return_evidence_required', 400);

    return this.withLock(index => {
      const record = index.goals.find(g => g.id === id);
      if (!record) fail('strategy_goal_not_found', 404);
      const list = (index.strategyReturns ??= {})[id] ?? [];
      const prior = list.find(r => r.operationId === operationId);
      if (prior) return { result: { strategyReturn: prior, replayed: true as boolean }, dirty: false };
      const review = index.cycleReviews?.[id]?.find(r => r.reviewId === reviewId);
      if (!review) fail('cycle_review_not_found', 404);
      const adoptedGoal = record.versions.find(v => v.version === (record.adoptedVersion ?? record.currentVersion));
      const formalOrigin = adoptedGoal?.formalOrigin;

      const strategyReturn: StrategyReturnRecord = {
        returnId: randomUUID(),
        operationId,
        goalId: id,
        reviewId,
        reason,
        selectedConclusionIds: [...(input.selectedConclusionIds ?? [])],
        evidenceRefs: input.evidenceRefs.map(e => reqText(e, 500)),
        ...(formalOrigin?.kind === 'strategy-publication' ? {
          originalStrategyPublicationRef: {
            initiativeId: formalOrigin.initiativeId,
            publicationId: formalOrigin.publicationId,
            contentSha256: formalOrigin.contentSha256,
          },
        } : {}),
        status: 'returned-for-review',
        createdAt: new Date().toISOString(),
      };
      this.bumpSchema4(index);
      index.strategyReturns[id] = [...list, strategyReturn];
      return { result: { strategyReturn, replayed: false }, dirty: true };
    });
  }

  /** Read-only list of returned goal review evidence for Strategy selection (GM12). */
  listStrategyReturns(): {
    strategyReturn: StrategyReturnRecord;
    goal: GoalVersion;
    review: DecompositionCycleReview | null;
    selectedConclusions: CycleReviewConclusion[];
  }[] {
    const index = this.load();
    const out: {
      strategyReturn: StrategyReturnRecord;
      goal: GoalVersion;
      review: DecompositionCycleReview | null;
      selectedConclusions: CycleReviewConclusion[];
    }[] = [];
    for (const [gid, returns] of Object.entries(index.strategyReturns ?? {})) {
      const rec = index.goals.find(g => g.id === gid);
      if (!rec) continue;
      for (const ret of returns) {
        const review = index.cycleReviews?.[gid]?.find(r => r.reviewId === ret.reviewId) ?? null;
        const verNum = review?.lastEffectiveFormalTarget.goalRef.version ?? rec.adoptedVersion ?? rec.currentVersion;
        const gv = rec.versions.find(v => v.version === verNum) ?? rec.versions.at(-1);
        if (!gv) continue;
        const selectedConclusions = review
          ? review.conclusions.filter(c => ret.selectedConclusionIds.includes(c.id))
          : [];
        out.push(structuredClone({ strategyReturn: ret, goal: gv, review, selectedConclusions }));
      }
    }
    return out;
  }

  /** Unified read-only workspace projection for a single goalId (optionally scoped to exact goalVersion). */
  getGoalWorkspace(goalId: string, goalVersion?: number): GoalWorkspaceView {
    const id = uuid(goalId);
    const index = this.load();
    const goal = index.goals.find(g => g.id === id);
    if (!goal) fail('strategy_goal_not_found', 404);
    const allGsaPlans = index.gsaPlans?.[id] ?? [];
    const scopedToHistorical = goalVersion !== undefined && goalVersion !== (goal.adoptedVersion ?? goal.currentVersion);
    if (goalVersion !== undefined && !goal.versions.some(v => v.version === goalVersion)) {
      fail('strategy_goal_not_found', 404);
    }
    const gsaPlans = scopedToHistorical
      ? allGsaPlans.filter(p => p.goal.version === goalVersion)
      : allGsaPlans;
    const activeGsaPlan = gsaPlans.at(-1) ?? null;
    const gsaDraft = scopedToHistorical ? null : (index.gsaDrafts?.[id] ?? null);
    const rawDraft = index.decompositionDrafts?.[id] ?? null;
    const currentDraft = scopedToHistorical
      ? (rawDraft && activeGsaPlan && rawDraft.gsaPlanVersion === activeGsaPlan.planVersion ? rawDraft : null)
      : rawDraft;
    const validation = currentDraft ? validateDecompositionForPublish(activeGsaPlan, currentDraft, index.goals) : null;
    const allPublications = index.decompositionPublications?.[id] ?? [];
    const allowedPlanVersions = new Set(gsaPlans.map(p => p.planVersion));
    const publications = scopedToHistorical
      ? allPublications.filter(p => allowedPlanVersions.has(p.gsaPlanVersion))
      : allPublications;
    const activePublicationVersion = scopedToHistorical
      ? (publications.at(-1)?.version ?? null)
      : (index.activeDecompositionVersions?.[id] ?? null);
    let activePublication: DecompositionPublication | null = null;
    if (activePublicationVersion !== null) {
      const summary = publications.find(p => p.version === activePublicationVersion);
      if (summary) {
        activePublication = { ...summary, snapshot: this.readSnapshotBlob(summary.snapshotSha256) };
      }
    }
    const allChecks = index.progressChecks?.[id] ?? [];
    const checks = scopedToHistorical
      ? allChecks.filter(c => allowedPlanVersions.has(c.gsaPlanVersion))
      : allChecks;
    return structuredClone({
      goal,
      gsaPlans,
      activeGsaPlan,
      gsaDraft,
      draft: currentDraft,
      validation,
      publications,
      activePublicationVersion,
      activePublication,
      checks,
      threshold: index.thresholds?.[id] ?? defaultThreshold(),
      caseDraftIntents: index.caseDraftIntents?.[id] ?? [],
      handoffs: index.projectHandoffs?.[id] ?? [],
      reviews: index.cycleReviews?.[id] ?? [],
      nextCycleDrafts: index.nextCycleDrafts?.[id] ?? [],
      strategyReturns: index.strategyReturns?.[id] ?? [],
    });
  }
}
