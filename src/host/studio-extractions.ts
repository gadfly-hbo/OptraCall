import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import type { StudioSourceRef } from '../../extensions/business-plugins/studio/contracts.ts';
import { StudioError, object, uuid, sourceRef, digest } from '../../extensions/business-plugins/studio/validation.ts';
import { safePath, readBytes, writeExclusive, parse } from './project-data-context-io.ts';
import type { SemanticContextCallContext } from '../agent/semantic-context.ts';

const maximum = 8 * 1024 * 1024, budget = 28_000;
type Owner = { systemId: string; projectId: string; taskId: string };
type Call = Pick<SemanticContextCallContext, 'requestId' | 'sessionId' | 'toolCallId'>;
export type StudioExtractionReceipt = {
  schema: 2; kind: 'studio-extraction-candidate'; extractionId: string; owner: Owner;
  call: Call; sourceRef: StudioSourceRef; createdAt: string; resultSha256: string; receiptSha256: string;
  result: Record<string, unknown>;
};
const hash = (text: string) => createHash('sha256').update(text).digest('hex');
const missing = (error: unknown) => (error as NodeJS.ErrnoException).code === 'ENOENT';
const fail = (code: string): never => { throw new StudioError(code, 409); };
export function studioExtractionId(owner: Owner, call: Call): string {
  const value = digest([owner, call.requestId, call.sessionId, call.toolCallId]);
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-5${value.slice(13, 16)}-a${value.slice(17, 20)}-${value.slice(20, 32)}`;
}
function ownerPath(owner: Owner) { uuid(owner.projectId); uuid(owner.taskId); return `studio-extractions/${uuid(owner.systemId)}`; }
function validate(value: unknown, owner: Owner, id: string): StudioExtractionReceipt {
  if (!object(value)) return fail('studio_extraction_corrupt');
  const { receiptSha256, ...contents } = value;
  if (typeof receiptSha256 !== 'string' || digest(contents) !== receiptSha256 || value.schema !== 2 || value.kind !== 'studio-extraction-candidate' || value.extractionId !== id || !object(value.owner) || digest(value.owner) !== digest(owner) || !object(value.call) || typeof value.call.requestId !== 'string' || typeof value.call.sessionId !== 'string' || typeof value.call.toolCallId !== 'string' || !object(value.result) || hash(JSON.stringify(value.result)) !== value.resultSha256 || typeof value.createdAt !== 'string' || !Number.isFinite(Date.parse(value.createdAt))) return fail('studio_extraction_corrupt');
  sourceRef(value.sourceRef);
  if (studioExtractionId(owner, value.call as Call) !== id) return fail('studio_extraction_corrupt');
  const source = value.result.source;
  if (object(source) && source.ref !== undefined && (digest(sourceRef(source.ref)) !== digest(value.sourceRef) || source.id !== (value.sourceRef as StudioSourceRef).id || source.revision !== (value.sourceRef as StudioSourceRef).version)) return fail('studio_extraction_corrupt');
  return value as StudioExtractionReceipt;
}
/** Technical receipts only: these do not save, publish or qualify business assets. No directories on reads/startup. */
export function studioExtractions(dataRoot: string) {
  async function read(owner: Owner, id: string): Promise<StudioExtractionReceipt | undefined> {
    try { const file = await safePath(dataRoot, `${ownerPath(owner)}/${uuid(id)}.json`); return validate(parse(await readBytes(file, maximum)), owner, id); }
    catch (error) { if (missing(error)) return; if (error instanceof StudioError) throw error; return fail('studio_extraction_unsafe_or_corrupt'); }
  }
  return {
    read,
    async list(owner: Owner): Promise<StudioExtractionReceipt[]> {
      let directory: string;
      try { directory = path.dirname(await safePath(dataRoot, `${ownerPath(owner)}/list`)); }
      catch (error) { if (missing(error)) return []; return fail('studio_extraction_unsafe_or_corrupt'); }
      const entries = await fsp.readdir(directory), receipts: StudioExtractionReceipt[] = [];
      for (const entry of entries.sort()) if (/^[a-f0-9-]{36}\.json$/.test(entry)) { const receipt = await read(owner, entry.slice(0, -5)); if (receipt) receipts.push(receipt); }
      return receipts.sort((a, b) => b.createdAt.localeCompare(a.createdAt) || a.extractionId.localeCompare(b.extractionId));
    },
    async stage(owner: Owner, ref: StudioSourceRef, call: Call, result: unknown) {
      if (!object(result)) return fail('studio_extraction_invalid_result');
      let resultJson: string;
      try { resultJson = JSON.stringify(result); } catch { return fail('studio_extraction_invalid_result'); }
      const contents = JSON.parse(JSON.stringify({ schema: 2, kind: 'studio-extraction-candidate', extractionId: studioExtractionId(owner, call), owner, call: { requestId: call.requestId, sessionId: call.sessionId, toolCallId: call.toolCallId }, sourceRef: ref, createdAt: new Date().toISOString(), resultSha256: hash(resultJson), result: JSON.parse(resultJson) }));
      const receipt = validate({ ...contents, receiptSha256: digest(contents) }, owner, contents.extractionId);
      const bytes = Buffer.from(JSON.stringify(receipt)); if (bytes.length > maximum) return fail('studio_extraction_too_large');
      const file = await safePath(dataRoot, `${ownerPath(owner)}/${receipt.extractionId}.json`, true), temporary = `${file}.${randomUUID()}.tmp`;
      try { await writeExclusive(temporary, bytes); }
      catch (error) { try { fs.unlinkSync(temporary); } catch (cleanup) { if (!missing(cleanup)) throw cleanup; } throw error; }
      return {
        receipt,
        discard() { try { fs.unlinkSync(temporary); } catch (error) { if (!missing(error)) throw error; } },
        commit(assertCurrent: () => void) {
          // No await between the last owner/cancellation check and immutable publication.
          for (const directory of [dataRoot, path.join(dataRoot, 'studio-extractions'), path.dirname(file)]) { const stat = fs.lstatSync(directory); if (!stat.isDirectory() || stat.isSymbolicLink()) return fail('studio_extraction_unsafe_or_corrupt'); }
          const stat = fs.lstatSync(temporary); if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.size !== bytes.length) return fail('studio_extraction_unsafe_or_corrupt');
          assertCurrent();
          try { fs.linkSync(temporary, file); }
          catch (error) { if ((error as NodeJS.ErrnoException).code === 'EEXIST') return fail('studio_extraction_exists'); throw error; }
          fs.unlinkSync(temporary);
          const directory = fs.openSync(path.dirname(file), fs.constants.O_RDONLY); try { fs.fsyncSync(directory); } finally { fs.closeSync(directory); }
          return receipt;
        },
      };
    },
  };
}
export function extractionSummary(receipt: StudioExtractionReceipt) {
  const result = receipt.result;
  return { extractionId: receipt.extractionId, createdAt: receipt.createdAt, resultSha256: receipt.resultSha256, receiptSha256: receipt.receiptSha256,
    sourceIdentity: { authority: receipt.sourceRef.authority, id: receipt.sourceRef.id, version: receipt.sourceRef.version, ...(receipt.sourceRef.sha256 ? { sha256: receipt.sourceRef.sha256 } : {}) },
    counts: { entities: Array.isArray(result.entities) ? result.entities.length : null, relations: Array.isArray(result.relations) ? result.relations.length : null, calls: Array.isArray(result.calls) ? result.calls.length : null, failures: Array.isArray(result.failures) ? result.failures.length : null },
    candidateNeedsReview: true, authority: 'technical-candidate-receipt-not-business-asset' };
}
export function extractionResponse(receipt: StudioExtractionReceipt) {
  const summary = extractionSummary(receipt), full = { ...receipt.result, ...summary, transport: { complete: true } };
  if (JSON.stringify(full).length < budget) return full;
  return { ...summary, transport: { complete: false, sections: ['result', 'metadata', 'entities', 'relations'], continuation: { extractionId: receipt.extractionId, section: 'metadata', start: 0, length: 12_000 }, note: 'Full original candidate retained. Read only the sections needed and verify sources; this summary is not the full extraction. Saving or publishing remains explicit.' } };
}
/** Pages contain exact JSON text fragments; count/range remains truthful even for one huge entity or metadata field. */
export function extractionPage(receipt: StudioExtractionReceipt, payload: Record<string, unknown>) {
  const section = payload.section ?? 'metadata';
  if (!['result', 'metadata', 'entities', 'relations'].includes(String(section))) return fail('invalid_studio_extraction_section');
  const { entities: _entities, relations: _relations, ...metadata } = receipt.result;
  const value = section === 'result' ? receipt.result : section === 'metadata' ? { owner: receipt.owner, call: receipt.call, sourceRef: receipt.sourceRef, resultMetadata: metadata } : receipt.result[String(section)] ?? null;
  return studioTextPage(JSON.stringify(value), payload, { ...extractionSummary(receipt), section, encoding: 'json-text' }, { extractionId: receipt.extractionId, section }, 'invalid_studio_extraction_range');
}
/** Pure transport: range is measured in the original text, budget in the final JSON reply. */
export function studioTextPage(text: string, payload: Record<string, unknown>, identity: Record<string, unknown>, selector: Record<string, unknown>, invalidRange = 'invalid_studio_source_range') {
  const start = payload.start === undefined ? 0 : Number(payload.start), length = payload.length === undefined ? 12_000 : Number(payload.length);
  if (!Number.isSafeInteger(start) || start < 0 || !Number.isSafeInteger(length) || length < 1 || length > 20_000) return fail(invalidRange);
  const points = Array.from(text); if (start > points.length) return fail(invalidRange);
  const page = (end: number) => ({ ...identity, text: points.slice(start, end).join(''), range: { start, end, total: points.length, unit: 'unicode-codepoints' }, complete: start === 0 && end === points.length, continuation: end < points.length ? { ...selector, start: end, length } : null });
  let low = start, high = Math.min(points.length, start + length);
  while (low < high) { const mid = Math.ceil((low + high) / 2); if (JSON.stringify(page(mid)).length < budget) low = mid; else high = mid - 1; }
  if (JSON.stringify(page(low)).length >= budget || low === start && low < points.length) return fail('studio_result_too_large');
  return page(low);
}
export function studioJsonPage(value: unknown, payload: Record<string, unknown>, identity: Record<string, unknown>, selector: Record<string, unknown>) {
  const serialized = JSON.stringify(value), jsonSha256 = hash(serialized);
  if (payload.expectedJsonSha256 !== undefined && payload.expectedJsonSha256 !== jsonSha256) return fail('studio_read_changed');
  return studioTextPage(serialized, payload, { ...identity, encoding: 'json-text', jsonSha256 }, { ...selector, format: 'json-text', expectedJsonSha256: jsonSha256 });
}
