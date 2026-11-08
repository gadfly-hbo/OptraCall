import type { EnterpriseMaterialsStore } from './enterprise-materials-store.ts';
import type { ProjectStore } from './project-store.ts';
import type { ProjectDataContextStore } from './project-data-context-store.ts';
import type { createDecisionBoardStore } from '../../extensions/business-plugins/decision-board/storage/store.ts';
import type { ReadPersonalSource, PersonalSourceEvidence } from './personal-retention-types.ts';
import type { PersonalExcerpt } from './personal-retention-types.ts';
import type { CaseLearningSourceRef, LearningSourceReadOptions } from './learning-source-types.ts';
import type { createAgentCandidateReader } from './agent-candidate-reader.ts';
import { createHash } from 'node:crypto';
import { learningSourceRef } from './learning-source-validation.ts';
import path from 'node:path';
import { readSavedTaskReply } from './project-history.ts';

export type PersonalSourceDependencies = {
  enterprise: Pick<EnterpriseMaterialsStore, 'referenceIndex' | 'readRevision'>;
  projects: Pick<ProjectStore, 'get' | 'getTask'>;
  dataContext: Pick<ProjectDataContextStore, 'readCitationEvidence'>;
  board: Pick<ReturnType<typeof createDecisionBoardStore>, 'getTask' | 'getItem' | 'getFeedbackRevision'>;
  candidates?: Pick<ReturnType<typeof createAgentCandidateReader>, 'read'>;
  readCaseSource?: (ref: CaseLearningSourceRef, options?: LearningSourceReadOptions) => Promise<PersonalSourceEvidence>;
};

export class PersonalSourceError extends Error {
  readonly code: string;
  readonly status: number;
  constructor(code: string, status = 400) { super(code); this.code = code; this.status = status; }
}
const fail = (code: string, status = 400): never => { throw new PersonalSourceError(code, status); };
const digest = (text: string) => createHash('sha256').update(text).digest('hex');
function selectedText(text: string | null, excerpt: PersonalExcerpt | undefined): string | null {
  if (excerpt === undefined) return text;
  const boundary = (position: number) => !text || position === 0 || position === text.length || !(text.charCodeAt(position - 1) >= 0xd800 && text.charCodeAt(position - 1) <= 0xdbff && text.charCodeAt(position) >= 0xdc00 && text.charCodeAt(position) <= 0xdfff);
  if (!text || !Number.isSafeInteger(excerpt.start) || !Number.isSafeInteger(excerpt.end) || excerpt.start < 0 || excerpt.end <= excerpt.start || excerpt.end > text.length || !boundary(excerpt.start) || !boundary(excerpt.end)) return fail('invalid_personal_excerpt');
  return text.slice(excerpt.start, excerpt.end);
}

export function createPersonalSourceReader(deps: PersonalSourceDependencies): ReadPersonalSource {
  const read: ReadPersonalSource = async (raw, options = {}) => {
    options.signal?.throwIfAborted();
    const ref = learningSourceRef(raw);
    if (ref.type === 'case-decision' || ref.type === 'case-choice') {
      if (!deps.readCaseSource) return fail('personal_source_case_unavailable', 409);
      return deps.readCaseSource(ref, options);
    }
    if (ref.type === 'agent-candidate') {
      if (!deps.candidates) return fail('personal_source_candidate_unavailable', 409);
      const row = await deps.candidates.read(ref.candidate, options);
      if (row.status !== 'available' || !row.details) return fail(row.reason ?? 'personal_source_candidate_unknown', 409);
      const governance = row.control, blocked = options.audience === 'agent' && (!governance || governance.excluded);
      return { ref, title: blocked ? '候选来源当前不可供给' : row.details.content.title,
        text: blocked ? null : selectedText(row.details.content.bodyMd, ref.excerpt),
        sha256: ref.candidate.expectedDetailsSha256,
        status: !governance ? 'governance-unknown' : governance.excluded ? 'excluded' : 'available',
        ...(governance ? { candidateGovernance: governance } : {}) };
    }
    if (ref.type === 'citation') {
      const project = await deps.projects.get(ref.projectId);
      const { file, bytes } = await deps.dataContext.readCitationEvidence(ref.projectId, ref.citationId, ref.target.type === 'report' ? null : ref.target.attachmentIndex);
      let text: string | null = null;
      // Use the existing supported text-file contract; decodable binary or
      // document-container bytes are not a text extraction capability.
      if (['.csv', '.json', '.md', '.txt', '.py', '.sql'].includes(path.extname(file.originalPath).toLowerCase())) {
        try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { /* Keep exact binary identity without inventing prose. */ }
      }
      return { ref, title: path.basename(file.originalPath), text: selectedText(text, ref.excerpt), sha256: file.sha256, status: 'available', project: { id: project.id, name: project.name, archived: project.archivedAt !== null }, ...(ref.target.type === 'attachment' ? { attachment: { name: path.basename(file.originalPath), bytes: file.bytes, sha256: file.sha256 } } : {}) };
    }
    if (ref.type === 'native-reply') {
      const project = await deps.projects.get(ref.projectId), task = await deps.projects.getTask(ref.projectId, ref.taskId);
      const reply = await readSavedTaskReply(project, task, { sessionId: ref.sessionId, messageId: ref.messageId }, options);
      const sha256 = digest(reply.text);
      if (sha256 !== ref.expectedTextSha256) return fail('personal_source_text_changed', 409);
      return { ref, title: `原生回复 · ${task.name}`, text: selectedText(reply.text, ref.excerpt), sha256, status: 'available', project: { id: project.id, name: project.name, archived: project.archivedAt !== null } };
    }
    if (ref.type === 'feedback') {
      const task = deps.board.getTask(ref.boardTaskId), item = deps.board.getItem(task.itemId);
      if (item.projectId !== ref.sourceProjectId) return fail('personal_source_project_mismatch', 409);
      const revision = deps.board.getFeedbackRevision(ref.feedbackRevisionId);
      if (!revision) return fail('personal_source_feedback_missing', 404);
      if (revision.taskId !== task.id) return fail('personal_source_feedback_mismatch', 409);
      const project = await deps.projects.get(item.projectId), text = JSON.stringify(revision, null, 2);
      return { ref, title: `反馈修订 v${revision.revisionNumber}`, text: selectedText(text, ref.excerpt), sha256: digest(text), status: 'available', project: { id: project.id, name: project.name, archived: project.archivedAt !== null } };
    }
    const index = await deps.enterprise.referenceIndex();
    if (index.storeId !== ref.storeId) return fail('personal_source_store_mismatch', 409);
    const material = index.materials.find(item => item.materialId === ref.materialId);
    const revision = await deps.enterprise.readRevision(ref.materialId, ref.revisionId);
    return { ref: structuredClone(ref), title: revision.title, text: selectedText(revision.body || null, ref.excerpt), sha256: digest(revision.body), status: material?.enabled ? 'available' : 'disabled', ...(revision.sourceFile ? { attachment: { name: revision.sourceFile.name, bytes: revision.sourceFile.bytes, sha256: revision.sourceFile.sha256 } } : {}) };
  };
  return async (ref, options = {}) => {
    try { const result = await read(ref, options); options.signal?.throwIfAborted(); return result; }
    catch (error) {
      options.signal?.throwIfAborted();
      const value = error as { code?: unknown; status?: unknown };
      const code = value?.code === 'ENOENT' ? 'personal_source_missing' : typeof value?.code === 'string' && /^[a-z][a-z0-9_]{0,120}$/.test(value.code) ? value.code : 'personal_source_unavailable';
      throw new PersonalSourceError(code, typeof value?.status === 'number' ? value.status : code.includes('missing') || code.includes('not_found') ? 404 : 409);
    }
  };
}
