import type { ExactCandidateRef } from './agent-candidate-controls.ts';
import type { PersonalExcerpt, PersonalSourceRef } from './personal-retention-types.ts';
import type { NativeSnapshotReadBudget } from './native-session-snapshot.ts';

/** M6 read/retention references. M5 source writes deliberately use PersonalSourceRef. */
export type CaseLearningSourceRef = (
  | { type: 'case-decision'; caseStoreId: string; caseId: string; recordId: string; revision: number }
  | { type: 'case-choice'; caseStoreId: string; caseId: string; choiceId: string }
) & { excerpt?: PersonalExcerpt };
export type LearningSourceRef = PersonalSourceRef | CaseLearningSourceRef | { type: 'agent-candidate'; candidate: ExactCandidateRef; excerpt?: PersonalExcerpt };
export type LearningSourceReadOptions = { signal?: AbortSignal; budget?: NativeSnapshotReadBudget; audience?: 'human' | 'agent' };
