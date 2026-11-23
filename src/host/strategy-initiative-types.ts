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