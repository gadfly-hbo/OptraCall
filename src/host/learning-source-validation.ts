import type { LearningSourceRef } from './learning-source-types.ts';
import { parseExactCandidateRef } from './agent-candidate-controls.ts';
import { object } from './project-data-context-io.ts';
import { fail, id, integer, keys, sourceRef } from './personal-retention-validation.ts';

export function isLearningSourceRef(ref: LearningSourceRef): boolean { return ['agent-candidate', 'case-decision', 'case-choice'].includes(ref.type); }
export function learningSourceRef(value: unknown): LearningSourceRef {
  if (!object(value)) return fail('invalid_personal_source_ref');
  let result: LearningSourceRef;
  if (value.type === 'agent-candidate') {
    keys(value, ['type', 'candidate', 'excerpt'], ['type', 'candidate']);
    result = { type: 'agent-candidate', candidate: parseExactCandidateRef(value.candidate) };
  } else if (value.type === 'case-decision') {
    keys(value, ['type', 'caseStoreId', 'caseId', 'recordId', 'revision', 'excerpt'], ['type', 'caseStoreId', 'caseId', 'recordId', 'revision']);
    const revision = integer(value.revision); if (!revision) return fail('invalid_personal_source_ref');
    result = { type: 'case-decision', caseStoreId: id(value.caseStoreId), caseId: id(value.caseId), recordId: id(value.recordId), revision };
  } else if (value.type === 'case-choice') {
    keys(value, ['type', 'caseStoreId', 'caseId', 'choiceId', 'excerpt'], ['type', 'caseStoreId', 'caseId', 'choiceId']);
    result = { type: 'case-choice', caseStoreId: id(value.caseStoreId), caseId: id(value.caseId), choiceId: id(value.choiceId) };
  } else return sourceRef(value);
  if (value.excerpt !== undefined) {
    if (!object(value.excerpt)) return fail('invalid_personal_excerpt');
    keys(value.excerpt, ['start', 'end']); const start = integer(value.excerpt.start), end = integer(value.excerpt.end);
    if (end <= start) return fail('invalid_personal_excerpt'); result.excerpt = { start, end };
  }
  return result;
}
