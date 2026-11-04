import type { ExactCandidateRef } from './agent-candidate-controls.ts';
import type { PersonalContextDelivery } from '../agent/personal-context.ts';
import type { NativeSnapshotReadBudget } from './native-session-snapshot.ts';

/** Reuses the original M3 decision or M31 occurrence; never a latest-version pointer. */
export type PersonalContextTarget =
  | { type: 'retained'; storeId: string; materialId: string; decisionId: string; revisionId: string; expectedBodySha256: string }
  | { type: 'agent-candidate'; candidate: ExactCandidateRef };
export type PersonalContextRange = { start: number; end: number };
export type PersonalContextSelection = { target: PersonalContextTarget; range?: PersonalContextRange };
export type PersonalContextFindInput = { query?: string; kind?: 'all' | 'knowledge' | 'experience'; includeArchived?: boolean; pageSize?: number; continuation?: string | null };
export type PersonalContextReadInput = PersonalContextSelection & { part?: 'content' | 'corrections' | 'source'; sourceIndex?: number; continuation?: string | null };
export type PersonalContextReadOptions = { signal?: AbortSignal; budget?: NativeSnapshotReadBudget };
export type PersonalContextResult = { text: string; details: PersonalContextDelivery };
