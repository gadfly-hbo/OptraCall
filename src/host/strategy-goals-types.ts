import type { UsageContext } from './usage-context-types.ts';

/** Management records only; measures, decisions and action facts remain in their original authorities. */
export type GoalPerspective = 'profit' | 'nonprofit' | 'personal';
export interface GoalScope { kind: 'enterprise' | 'department' | 'personal'; id: string; name: string; enterpriseId?: string }
export interface GoalRef { goalId: string; version: number }
export interface GoalSourceRef {
  authority: 'case' | 'decision-board' | 'project' | 'task' | 'sap-metric' | 'strategy-discussion';
  id: string;
  version: string | number;
  projectId?: string;
  taskId?: string;
  sha256?: string;
  sessionId?: string;
  entryType?: 'message' | 'tool-result';
}
export interface GoalDiscussionSourceRef extends GoalSourceRef {
  authority: 'strategy-discussion'; version: string; sessionId: string; sha256: string; entryType: 'message' | 'tool-result';
}
export interface GoalStrategyContext {
  summary: string;
  methods?: { id: string; name: string; source?: GoalSourceRef }[];
  sources?: GoalSourceRef[];
}
/** The Host binds this proof to a real discussion request or an explicit UI confirmation. */
export interface GoalAdoptionProvenance {
  kind: 'discussion-quote' | 'ui-confirmation';
  discussionId: string;
  sessionId: string;
  goalContentSha256: string;
  requestId?: string;
  userEntryId?: string;
  quoteStart?: number;
  quoteEnd?: number;
  quote?: string;
  quoteSha256?: string;
}
export type GoalMeasurement =
  | { kind: 'quantitative'; sapMetric: { authority: 'sap-metric'; id: string; version: string; metricName?: string }; target?: string }
  | { kind: 'deliverable'; criterion: string };
export interface StrategyChoiceRef { discussionId: string; version: number; contentSha256: string }
export interface GoalRoleSuggestionRef {
  owner: Extract<import('./business-role-types.ts').BusinessRoleOwner, {role:'goal'|'goal-draft'}>;
  discussionId: string;
  sessionId: string;
  entryId: string;
  sha256: string;
}
export interface GoalDraftInput {
  roleSuggestion?: GoalRoleSuggestionRef;
  strategyChoice?: StrategyChoiceRef;
  title: string;
  outcome: string;
  perspective: GoalPerspective;
  scope: GoalScope;
  bscPerspective?: string;
  measurement: GoalMeasurement;
  baseline: { state: 'known' | 'pending'; description: string };
  responsible: string;
  dueAt?: string;
  strategies?: string[];
  resources?: string[];
  necessaryConditions?: string[];
  source?: GoalSourceRef;
  usageContext?: UsageContext;
  strategyContext?: GoalStrategyContext;
}
export interface GoalVersion extends GoalDraftInput, GoalRef {
  status: 'candidate' | 'adopted';
  createdAt: string;
  adoptedAt?: string;
  adoptionDecision?: string;
  adoptionProvenance?: GoalAdoptionProvenance;
}
export interface StrategyGoalRecord {
  id: string;
  currentVersion: number;
  adoptedVersion: number | null;
  versions: GoalVersion[];
}
export interface GoalRelationInput {
  from: GoalRef;
  to: GoalRef;
  kind: 'supports' | 'necessary-condition' | 'contribution' | 'strategy';
  responsibility: string;
  rationale: string;
}
export interface GoalRelationVersion extends GoalRelationInput { revision: number; createdAt: string }
export interface GoalRelation extends GoalRelationVersion { id: string; history: GoalRelationVersion[] }
export interface GoalRelationRevisionInput extends GoalRelationInput, GoalMutation { expectedRevision: number }
export interface GoalFeedbackInput {
  goal: GoalRef;
  level: 'execution' | 'strategy' | 'strategic-assumption';
  source: GoalSourceRef;
  note: string;
}
export interface GoalFeedback extends GoalFeedbackInput { id: string; createdAt: string }
export interface GoalBasis {
  relations: { id: string; revision: number; sha256: string }[];
  feedback: { id: string; createdAt: string; sha256: string }[];
}
/** Shared structural decoder; resolving identities remains an original-Store operation. */
export function parseGoalBasis(value: unknown): GoalBasis {
  const object = (input: unknown): input is Record<string, unknown> => !!input && typeof input === 'object' && !Array.isArray(input);
  const invalid = (): never => { throw Object.assign(new Error('invalid_strategy_goal_basis'), { code: 'invalid_strategy_goal_basis', status: 400 }); };
  const id = (input: unknown) => typeof input === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(input);
  const hash = (input: unknown) => typeof input === 'string' && /^[a-f0-9]{64}$/.test(input);
  if (!object(value) || Object.keys(value).some(key => !['relations', 'feedback'].includes(key)) || !Array.isArray(value.relations) || !Array.isArray(value.feedback) || value.relations.length > 500 || value.feedback.length > 500) return invalid();
  const relations = value.relations.map(ref => {
    if (!object(ref) || Object.keys(ref).some(key => !['id', 'revision', 'sha256'].includes(key)) || !id(ref.id) || !Number.isSafeInteger(ref.revision) || Number(ref.revision) < 1 || !hash(ref.sha256)) return invalid();
    return { id: ref.id as string, revision: ref.revision as number, sha256: ref.sha256 as string };
  });
  const feedback = value.feedback.map(ref => {
    if (!object(ref) || Object.keys(ref).some(key => !['id', 'createdAt', 'sha256'].includes(key)) || !id(ref.id) || typeof ref.createdAt !== 'string' || !Number.isFinite(Date.parse(ref.createdAt)) || !hash(ref.sha256)) return invalid();
    return { id: ref.id as string, createdAt: ref.createdAt, sha256: ref.sha256 as string };
  });
  if (new Set(relations.map(ref => `${ref.id}:${ref.revision}`)).size !== relations.length || new Set(feedback.map(ref => ref.id)).size !== feedback.length) return invalid();
  return { relations, feedback };
}
/** One read of the original management authority, frozen by its consuming request/Plan. */
export interface GoalContextSnapshot {
  goals: GoalVersion[];
  basis: GoalBasis;
  relations: (GoalRelationVersion & { id: string })[];
  feedback: GoalFeedback[];
}
export interface StrategyGoalsIndex {
  goals: StrategyGoalRecord[];
  relations: GoalRelation[];
  feedback: GoalFeedback[];
  arrangements?: GoalActionArrangement[];
}
export interface GoalActionArrangement {
  id: string;
  goal: GoalRef;
  projectId: string;
  title: string;
  scope: string;
  checks: string[];
  actions: import('../../extensions/business-plugins/decision-board/types.ts').BoardArrangedActionRef[];
  source: import('../../extensions/business-plugins/decision-board/types.ts').BoardAuthorizationSource;
  boardOperationId: string;
  quoteProvenance: import('../agent/quoted-decisions.ts').UserQuoteProvenance;
  createdAt: string;
}
export type GoalArrangementView = Omit<GoalActionArrangement, 'quoteProvenance'> & {
  quoteProvenance?: GoalActionArrangement['quoteProvenance'];
  caseConfirmation?: import('../../extensions/business-plugins/decision-board/types.ts').BoardConfirmation;
};
export type GoalArrangementInput = Omit<GoalActionArrangement, 'id' | 'createdAt'>;
export interface GoalMutation { operationId: string }
export interface GoalRevisionInput extends GoalDraftInput, GoalMutation { expectedVersion: number }
export interface GoalAdoptionInput extends GoalMutation { expectedVersion: number; decision: string; provenance?: GoalAdoptionProvenance }
export interface GoalOperationReceipt {
  operationId: string;
  requestHash: string;
  kind: 'create' | 'revise' | 'adopt' | 'relate' | 'revise-relation' | 'feedback' | 'arrange';
  completedAt: string;
  result: GoalVersion | GoalRelation | GoalFeedback | GoalActionArrangement;
}
