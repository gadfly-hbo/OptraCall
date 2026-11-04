import { Type } from 'typebox';
import type { LearningSourceRef } from '../host/learning-source-types.ts';
import { isLearningSourceRef, learningSourceRef } from '../host/learning-source-validation.ts';
import { canonical, digest } from '../host/project-data-context-io.ts';

export const candidateToolName = 'record_agent_candidate';
export type AgentCandidateContent = { kind: 'knowledge' | 'experience'; title: string; bodyMd: string; aliases: string[]; scope: string | null; caution: string | null };
export type AgentCandidateInput = { content: AgentCandidateContent; sourceRefs: LearningSourceRef[] };
export type AgentCandidateDetails = AgentCandidateInput & {
  schemaVersion: 1 | 2; type: 'optracall.agent-candidate'; claim: 'agent-generated-unconfirmed';
  origin: { projectId: string; taskId: string; sessionId: string; requestId: string; toolCallId: string }; createdAt: string;
};
const nonempty = (maximum: number) => Type.String({ minLength: 1, maxLength: maximum });
const nullable = (maximum: number) => Type.Union([nonempty(maximum), Type.Null()]);
const exact = { additionalProperties: false };
const sourceSchema = Type.Intersect([
  Type.Union([
    Type.Object({ type: Type.Literal('enterprise'), storeId: Type.String(), materialId: Type.String(), revisionId: Type.String() }),
    Type.Object({ type: Type.Literal('citation'), projectId: Type.String(), citationId: Type.String(), target: Type.Union([Type.Object({ type: Type.Literal('report') }, exact), Type.Object({ type: Type.Literal('attachment'), attachmentIndex: Type.Integer({ minimum: 0 }) }, exact)]) }),
    Type.Object({ type: Type.Literal('native-reply'), projectId: Type.String(), taskId: Type.String(), sessionId: Type.String(), messageId: Type.String(), expectedTextSha256: Type.String() }),
    Type.Object({ type: Type.Literal('feedback'), sourceProjectId: Type.String(), boardTaskId: Type.String(), feedbackRevisionId: Type.String() }),
    Type.Object({ type: Type.Literal('agent-candidate'), candidate: Type.Object({ projectId: Type.String(), taskId: Type.String(), originSessionId: Type.String(), entryId: Type.String(), toolCallId: Type.String(), expectedDetailsSha256: Type.String({ pattern: '^[a-f0-9]{64}$' }) }, exact) }),
    Type.Object({ type: Type.Literal('case-decision'), caseStoreId: Type.String(), caseId: Type.String(), recordId: Type.String(), revision: Type.Integer({ minimum: 1 }) }),
    Type.Object({ type: Type.Literal('case-choice'), caseStoreId: Type.String(), caseId: Type.String(), choiceId: Type.String() }),
  ]),
  Type.Object({ excerpt: Type.Optional(Type.Object({ start: Type.Integer({ minimum: 0 }), end: Type.Integer({ minimum: 1 }) }, exact)) }),
]);
export const agentCandidateParameters = Type.Object({
  content: Type.Object({ kind: Type.Union([Type.Literal('knowledge'), Type.Literal('experience')]), title: nonempty(120), bodyMd: nonempty(20_000), aliases: Type.Optional(Type.Array(nonempty(100), { maxItems: 10 })), scope: nullable(2000), caution: nullable(2000) }, exact),
  sourceRefs: Type.Optional(Type.Array(sourceSchema, { maxItems: 8 })),
}, exact);
function object(value: unknown): value is Record<string, unknown> { return Boolean(value && typeof value === 'object' && !Array.isArray(value)); }
function fields(value: Record<string, unknown>, allowed: string[], required = allowed) {
  if (Object.keys(value).some(key => !allowed.includes(key)) || required.some(key => !(key in value))) throw new Error('invalid_agent_candidate_fields');
}
function text(value: unknown, maximum: number): string {
  if (typeof value !== 'string' || !value.trim() || value.length > maximum || value.includes('\0')) throw new Error('invalid_agent_candidate_text');
  return value;
}
/** Structural errors return to the same native Agent loop; no Host rewriting. */
export function parseAgentCandidateInput(value: unknown): AgentCandidateInput {
  if (!object(value) || !object(value.content)) throw new Error('invalid_agent_candidate_input');
  fields(value, ['content', 'sourceRefs'], ['content']);
  const content = value.content;
  fields(content, ['kind', 'title', 'bodyMd', 'aliases', 'scope', 'caution'], ['kind', 'title', 'bodyMd', 'scope', 'caution']);
  if (content.kind !== 'knowledge' && content.kind !== 'experience') throw new Error('invalid_agent_candidate_kind');
  const aliases = content.aliases === undefined ? [] : content.aliases;
  if (!Array.isArray(aliases) || aliases.length > 10) throw new Error('invalid_agent_candidate_aliases');
  const refs = value.sourceRefs === undefined ? [] : value.sourceRefs;
  if (!Array.isArray(refs) || refs.length > 8) throw new Error('invalid_agent_candidate_sources');
  return { content: { kind: content.kind, title: text(content.title, 120), bodyMd: text(content.bodyMd, 20_000), aliases: aliases.map(alias => text(alias, 100)), scope: content.scope === null ? null : text(content.scope, 2000), caution: content.caution === null ? null : text(content.caution, 2000) }, sourceRefs: refs.map(learningSourceRef) };
}
export const candidateDetailsVersion = (input: AgentCandidateInput): 1 | 2 => input.sourceRefs.some(isLearningSourceRef) ? 2 : 1;
export function parseAgentCandidateDetails(value: unknown): AgentCandidateDetails {
  if (!object(value) || !object(value.origin)) throw new Error('invalid_agent_candidate_details');
  fields(value, ['schemaVersion', 'type', 'claim', 'origin', 'createdAt', 'content', 'sourceRefs']);
  if (![1, 2].includes(Number(value.schemaVersion)) || typeof value.schemaVersion !== 'number' || value.type !== 'optracall.agent-candidate' || value.claim !== 'agent-generated-unconfirmed') throw new Error('invalid_agent_candidate_version');
  fields(value.origin, ['projectId', 'taskId', 'sessionId', 'requestId', 'toolCallId']);
  if (typeof value.createdAt !== 'string' || !Number.isFinite(Date.parse(value.createdAt)) || new Date(value.createdAt).toISOString() !== value.createdAt) throw new Error('invalid_agent_candidate_date');
  const input = parseAgentCandidateInput({ content: value.content, sourceRefs: value.sourceRefs });
  if (value.schemaVersion === 1 && candidateDetailsVersion(input) === 2) throw new Error('invalid_agent_candidate_version');
  if (canonicalCandidateJson(input) !== canonicalCandidateJson({ content: value.content, sourceRefs: value.sourceRefs })) throw new Error('invalid_agent_candidate_defaults');
  return { schemaVersion: value.schemaVersion as 1 | 2, type: 'optracall.agent-candidate', claim: 'agent-generated-unconfirmed', origin: { projectId: text(value.origin.projectId, 1000), taskId: text(value.origin.taskId, 1000), sessionId: text(value.origin.sessionId, 1000), requestId: text(value.origin.requestId, 1000), toolCallId: text(value.origin.toolCallId, 1000) }, createdAt: value.createdAt, ...input };
}
/** Canonical JSON preserves all text and array order, and sorts only object keys. */
export const canonicalCandidateJson = canonical;
export const agentCandidateDetailsSha256 = (details: AgentCandidateDetails): string => digest(canonicalCandidateJson(details));
