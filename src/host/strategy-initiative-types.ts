import type {GoalScope} from './strategy-goals-types.ts';

export interface StrategyInitiative {
  id: string;
  title: string;
  revision: number;
  scopes: GoalScope[];
  createdAt: string;
  updatedAt: string;
}
export interface StrategyInitiativeCreate {
  operationId: string;
  title?: string;
  scopes?: GoalScope[];
}
export interface StrategyInitiativeUpdate {
  expectedRevision: number;
  title?: string;
  scopes?: GoalScope[];
}
export const initiativeScopeKey = (scope: GoalScope): string => `${scope.kind}:${scope.enterpriseId ?? ''}:${scope.id}`;

export interface KickoffProposition { id: string; question: string; whyItMatters: string; evidence?: string; gaps?: string }
export interface KickoffFields {
  horizon: string;
  diagnosis: string;
  propositions: KickoffProposition[];
  assumptions: string;
  evidenceGaps: string;
  followUp: string;
  priorReview?: 'applicable' | 'not-applicable';
}
export interface KickoffSourceRef { kind: 'file' | 'public'; ref: string; title?: string; sha256?: string }
export interface KickoffReportVersion {
  no: number;
  fields: KickoffFields;
  sources: KickoffSourceRef[];
  contentSha256: string;
  parent?: number;
  generation: { operationId: string; kind: 'agent' | 'revision' | 'manual'; at: string; requestId?: string };
  lock?: { operationId: string; operator: string; at: string; fingerprint: string };
}
export interface KickoffApplication {
  operationId: string;
  scopeKey: string;
  scope: GoalScope;
  reportNo: number;
  contentSha256: string;
  at: string;
}
export interface KickoffAnchor { scopeKey: string; scope: GoalScope; reportNo: number; contentSha256: string; at: string; operationId: string }