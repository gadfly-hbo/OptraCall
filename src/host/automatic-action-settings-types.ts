export const automaticActionNodes = ['save', 'review', 'ir', 'case', 'assets'] as const;
export type AutomaticActionNode = typeof automaticActionNodes[number];
export type AutomaticActionNodes = Record<AutomaticActionNode, boolean>;
export interface AutomaticActionSettings {
  formatVersion: 1;
  revision: number;
  nodes: AutomaticActionNodes;
  updatedAt?: string;
}
export interface AutomaticActionSettingsUpdate {
  operationId: string;
  expectedRevision: number;
  nodes: AutomaticActionNodes;
}
export interface AutomaticActionSettingsResult {
  settings: AutomaticActionSettings;
  replayed: boolean;
  operationRevision: number;
}
export interface AutomaticActionStartFacts {
  authorized: boolean;
  applicable: boolean;
  cancelled: boolean;
}
export type AutomaticActionStartReason = 'enabled' | 'disabled' | 'cancelled' | 'not_authorized' | 'not_applicable';
export interface AutomaticActionStartDecision {
  allowed: boolean;
  reason: AutomaticActionStartReason;
  settingsRevision: number;
}
