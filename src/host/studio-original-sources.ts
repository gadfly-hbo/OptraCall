import { createHash } from 'node:crypto';
import type { SemanticContextService } from './semantic-context-service.ts';
import type { SemanticTarget } from '../../extensions/business-plugins/semantic-context/types.ts';
import type { StudioSourceRef } from '../../extensions/business-plugins/studio/contracts.ts';
import { parseSemanticQueryInput } from '../../extensions/business-plugins/semantic-context/reader.ts';
import { canonical, fail, object, sourceRef } from '../../extensions/business-plugins/studio/validation.ts';

const maximumBytes = 512 * 1024;
const paginationGaps = new Set(['original-content-or-relations-continued', 'oversized-original-metadata-in-exact-json-fragments']);
export type StudioOriginalSourceRead = { text: string; complete: true; ref: StudioSourceRef; governance?: { original: Record<string, unknown> | null; gaps: string[] } };
type Range = { start: number; end: number; total: number };
const hash = (text: string) => createHash('sha256').update(text).digest('hex');
function append(text: string, range: Range | null, collected: string, total: number | undefined): { text: string; total: number } {
  if (!range || ![range.start, range.end, range.total].every(Number.isSafeInteger) || range.start !== collected.length || range.end < range.start || range.end > range.total || range.end - range.start !== text.length || (total !== undefined && range.total !== total)) fail('studio_source_fragment_invalid', 409);
  if (range.total > maximumBytes) fail('studio_source_too_large', 413);
  const next = collected + text;
  if (Buffer.byteLength(next) > maximumBytes || Buffer.from(next).toString('utf8') !== next) fail('studio_source_too_large', 413);
  return { text: next, total: range.total };
}
function exactTarget(ref: StudioSourceRef, projectId: string): SemanticTarget {
  let raw: unknown; try { raw = JSON.parse(ref.locator ?? ''); } catch { fail('studio_source_locator_invalid'); }
  const target = parseSemanticQueryInput({ action: 'read', target: raw }).target!;
  if (ref.authority === 'case') {
    if (target.kind === 'case-decision' && (target.recordId !== ref.id || String(target.revision) !== ref.version) || target.kind === 'case-choice' && (target.choiceId !== ref.id || ref.version !== '1')) fail('studio_source_identity_mismatch', 409);
    if (target.kind !== 'case-decision' && target.kind !== 'case-choice') fail('studio_source_unsupported');
  } else if (ref.authority === 'data') {
    if (target.kind !== 'data-description' && target.kind !== 'data-input') fail('studio_source_unsupported');
    if (ref.projectId !== projectId || target.projectId !== projectId) fail('studio_source_project_mismatch', 403);
    if (target.datasetId !== ref.id || (target.kind === 'data-description' ? target.descriptionRevisionId : target.inputVersionId) !== ref.version) fail('studio_source_identity_mismatch', 409);
  } else fail('studio_source_unsupported');
  return target;
}

/** Only reassembles the existing reader's exact transport fragments. It creates
 * no source Store, model session or alternative source authority. */
export function createStudioOriginalSources({ reader }: { reader: SemanticContextService }) {
  return {
    async read(raw: StudioSourceRef, projectId: string, taskId?: string): Promise<StudioOriginalSourceRead> {
      const ref = sourceRef(raw), target = exactTarget(ref, projectId), callerTask = taskId ?? ref.taskId;
      if (!callerTask) fail('studio_source_task_required', 403);
      let text = '', bodyTotal: number | undefined, metadata = '', metadataTotal: number | undefined, expectedHash: string | undefined;
      let governance: Record<string, unknown> | null | undefined, continuation: string | null = null, complete = false;
      const seen = new Set<string>(), gaps = new Set<string>();
      for (let pageNumber = 0; pageNumber < 256; pageNumber++) {
        const page = await reader.query(projectId, callerTask, { action: 'read', target, pageSize: 100, ...(continuation ? { continuation } : {}) }, { audience: 'agent' });
        const rows = [...page.items, ...page.unknownTime], item = rows[0];
        if (page.type !== 'optracall.semantic-context-result' || page.schemaVersion !== 1 || page.action !== 'read' || rows.length !== 1 || !item || canonical(item.target) !== canonical(target)) fail('studio_source_read_invalid', 409);
        if (!['available', 'partial'].includes(page.state) || !['available', 'partial'].includes(item.state) || typeof item.body !== 'string' || !item.sha256 || !/^[a-f0-9]{64}$/.test(item.sha256)) fail('studio_source_unavailable', 409);
        if (expectedHash !== undefined && item.sha256 !== expectedHash || ref.sha256 !== undefined && item.sha256 !== ref.sha256) fail('studio_source_changed', 409);
        expectedHash = item.sha256;
        if (governance !== undefined && canonical(governance) !== canonical(item.governance)) fail('studio_source_changed', 409);
        governance = item.governance;
        const body = append(item.body, item.range, text, bodyTotal); text = body.text; bodyTotal = body.total;
        if (item.metadataFragment) { const part = append(item.metadataFragment.text, item.metadataFragment.range, metadata, metadataTotal); metadata = part.text; metadataTotal = part.total; }
        [...item.gaps, ...page.coverage.gaps].filter(gap => !paginationGaps.has(gap)).forEach(gap => gaps.add(gap));
        if (page.coverage.sourceContinuations?.length) fail('studio_source_incomplete', 409);
        if (page.coverage.complete) {
          if (page.coverage.continuation !== null || item.state !== 'available' || text.length !== bodyTotal || metadataTotal !== undefined && metadata.length !== metadataTotal) fail('studio_source_incomplete', 409);
          complete = true; break;
        }
        continuation = page.coverage.continuation;
        if (!continuation || seen.has(continuation)) fail('studio_source_incomplete', 409);
        seen.add(continuation);
      }
      if (!complete || !expectedHash) fail('studio_source_incomplete', 409);
      if (metadataTotal !== undefined) {
        let parsed: unknown; try { parsed = JSON.parse(metadata); } catch { fail('studio_source_fragment_invalid', 409); }
        if (!object(parsed) || parsed.governance !== null && !object(parsed.governance)) fail('studio_source_fragment_invalid', 409);
        governance = parsed.governance as Record<string, unknown> | null;
      }
      // M2 description sha256 qualifies its original record bytes, while the
      // reader presents pretty JSON. It must not be replaced by sha256(text).
      if (target.kind !== 'data-description' && hash(text) !== expectedHash) fail('studio_source_changed', 409);
      return { text, complete: true, ref: { ...ref, sha256: expectedHash }, ...(governance || gaps.size ? { governance: { original: governance ?? null, gaps: [...gaps] } } : {}) };
    },
  };
}
