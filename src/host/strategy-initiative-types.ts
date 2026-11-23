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
  revision?: { operationId: string; request: string; baseNo: number; patches: { blockId: string; oldSha256: string; newSha256: string }[]; at: string };
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

export interface CandidateBlock { id: string; label: string; text: string }
export interface CandidateVersion {
  initiativeId: string;
  candidateId: string;
  no: number;
  scopeKey: string;
  title: string;
  anchor: { reportNo: number; contentSha256: string };
  parent?: { candidateId: string; no: number };
  blocks: CandidateBlock[];
  goals: string[];
  contentSha256: string;
  configurationId: string;
  configurationRevision: number;
  sessionFile?: string;
  revision: number;
  createOperationId: string;
  instruction: string;
  pendingInput?: { requestId: string; text: string; expectedRevision: number };
  lastRun?: { id: string; fingerprint: string; status: string };
  lock?: { operationId: string; operator: string; at: string; fingerprint: string };
  revisionMeta?: { operationId: string; request: string; base: { candidateId: string; no: number }; patches: { blockId: string; oldSha256: string; newSha256: string }[]; at: string };
  lastSave?: { operationId: string; contentSha256: string; at: string; requestId?: string };
  returned?: { batchId: string; at: string };
  createdAt: string;
  updatedAt: string;
}

export interface VerificationGate {
  turn: 0 | 1;
  operationId: string;
  ref: string;
  status: 'waiting' | 'running' | 'completed' | 'failed' | 'cancelled' | 'unknown';
  verdict?: 'pass' | 'fail' | 'insufficient';
  verdictRequestId?: string;
  evidence?: string;
  sources?: { kind: 'file' | 'public' | 'candidate' | 'kickoff'; ref: string; fileId?: string; sha256?: string }[];
  sessionFile?: string;
  configurationId: string;
  configurationRevision: number;
  requestId?: string;
  startedAt?: string;
  finishedAt?: string;
  attempts: { requestId: string; status: VerificationGate['status']; verdict?: VerificationGate['verdict']; at: string; evidence?: string }[];
}
export interface VerificationBatch {
  batchId: string;
  initiativeId: string;
  candidateId: string;
  no: number;
  contentSha256: string;
  lockOperationId: string;
  gates: [VerificationGate, VerificationGate];
  state: 'running' | 'passed' | 'returned' | 'stopped' | 'unknown';
  createdAt: string;
  updatedAt: string;
}
export interface VerificationOwner {
  initiativeId: string;
  candidateId: string;
  no: number;
  batchId: string;
  turn: 0 | 1;
  configurationId: string;
  configurationRevision: number;
  sessionFile?: string;
}