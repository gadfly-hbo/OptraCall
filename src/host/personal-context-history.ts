import { learningSourceRef } from './learning-source-validation.ts';
import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createNativeSnapshotReadBudget, readNativeSessionSnapshot, type NativeSnapshotReadBudget } from './native-session-snapshot.ts';
import { parsePersonalContextTarget } from './personal-context-validation.ts';
import type { PersonalContextTarget } from './personal-context-types.ts';
import type { PersonalContextDelivery, PersonalContextDeliveryItem } from '../agent/personal-context.ts';
import type { ProjectRecord, TaskRecord } from './project-store.ts';

export type PersonalContextCurrentStatus = { target: PersonalContextTarget; state: 'available' | 'excluded' | 'unknown'; governance?: PersonalContextDeliveryItem['governance']; issue?: string };
export type PersonalContextHistoryEntry = {
  sessionId: string; entryId: string; toolCallId?: string; action: 'find' | 'read' | 'provided' | 'nested';
  text: string | null; details: PersonalContextDelivery | null; evidence: 'recorded' | 'nested-unknown'; current: PersonalContextCurrentStatus[];
};
export type PersonalContextHistory = { entries: PersonalContextHistoryEntry[]; issues: { code: string; file?: string }[]; partial: boolean };
const object = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === 'object' && !Array.isArray(value));
const toolAction = (name: unknown) => name === 'find_personal_context' ? 'find' : name === 'read_personal_context' ? 'read' : undefined;
const code = (error: unknown) => object(error) && typeof error.code === 'string' ? error.code : 'personal_context_source_unknown';
const actualText = (value: unknown): string | null => typeof value === 'string' ? value : Array.isArray(value) ? value.filter(part => object(part) && part.type === 'text' && typeof part.text === 'string').map(part => part.text).join('') : null;
function delivery(value: unknown, action: 'find' | 'read'): PersonalContextDelivery | null {
  if (!object(value) || value.schemaVersion !== 1 || value.type !== 'optracall.personal-context-delivery' || value.action !== action || !Array.isArray(value.items) || value.items.length > 50 || typeof value.partial !== 'boolean' || !(value.continuation === null || typeof value.continuation === 'string') || !Array.isArray(value.issues)) return null;
  try {
    for (const item of value.items) {
      if (!object(item) || !['catalog', 'content', 'corrections', 'source'].includes(String(item.part)) || !['metadata', 'fragment', 'full'].includes(String(item.extent)) || typeof item.title !== 'string' || !['scope', 'effectiveTime', 'caution'].every(key => item[key] === null || typeof item[key] === 'string') || !Array.isArray(item.limitations) || !item.limitations.every(v => typeof v === 'string') || !object(item.governance) || typeof item.governance.archived !== 'boolean') return null;
      parsePersonalContextTarget(item.target);
      if (item.sourceRef !== undefined) learningSourceRef(item.sourceRef);
      if (item.range !== null && (!object(item.range) || !Number.isSafeInteger(item.range.start) || !Number.isSafeInteger(item.range.end) || Number(item.range.start) < 0 || Number(item.range.end) < Number(item.range.start))) return null;
    }
    return value as PersonalContextDelivery;
  } catch { return null; }
}

/** Read-only native projection, not a separate delivery ledger or source-body cache. */
export async function readPersonalContextHistory(project: ProjectRecord, task: TaskRecord, inspect: (target: PersonalContextTarget, budget: NativeSnapshotReadBudget) => Promise<PersonalContextCurrentStatus>): Promise<PersonalContextHistory> {
  const result: PersonalContextHistory = { entries: [], issues: [], partial: false };
  const budget = createNativeSnapshotReadBudget();
  const files = (await readdir(task.sessionDirectory)).filter(name => name.endsWith('.jsonl')).sort();
  const current = new Map<string, Promise<PersonalContextCurrentStatus>>();
  for (const name of files) {
    if (budget.files <= 0) { result.issues.push({ code: 'native_snapshot_budget_exhausted' }); break; }
    const file = path.join(task.sessionDirectory, name);
    try {
      const snapshot = await readNativeSessionSnapshot(file, task.sessionDirectory, path.join(project.rootPath, '020_clean'), budget.bytes, { budget });
      const entries = snapshot.entries;
      const byId = new Map(entries.map(entry => [entry.id, entry]));
      const hasCall = (parent: string | null, id: string, tool: string): boolean => {
        let ancestor = parent;
        while (ancestor !== null) {
          const entry = byId.get(ancestor); if (!entry) return false;
          if (entry.type === 'message' && entry.message.role === 'assistant' && Array.isArray(entry.message.content) && entry.message.content.some(part => part.type === 'toolCall' && part.id === id && part.name === tool)) return true;
          ancestor = entry.parentId;
        }
        return false;
      };
      const consumedMarkers = new Set<string>();
      for (const entry of entries) {
        if (entry.type !== 'message') continue;
        const message = entry.message;
        if (message.role === 'user') {
          // The nearest native run marker owns this prompt. A matching hash in
          // an older run cannot backfill a receipt into a later legacy request.
          let parent = entry.parentId, marker;
          while (parent !== null) {
            const ancestor = byId.get(parent); if (!ancestor) break;
            if (ancestor.type === 'custom' && ancestor.customType === 'optracall.run') { marker = ancestor; break; }
            parent = ancestor.parentId;
          }
          if (!marker || consumedMarkers.has(marker.id)) continue;
          consumedMarkers.add(marker.id);
          const data = marker.data, text = actualText(message.content);
          if (!object(data) || data.phase !== 'started' || data.sessionId !== undefined && data.sessionId !== snapshot.manager.getSessionId() || text === null) continue;
          const supplied = data.providedContext;
          if (!object(supplied) || supplied.version !== 1 || supplied.requestTextSha256 !== createHash('sha256').update(text).digest('hex') || !object(supplied.personal) || supplied.personal.schemaVersion !== 1 || !Array.isArray(supplied.personal.items) || supplied.personal.items.length > 8) continue;
          const details = delivery({ schemaVersion: 1, type: 'optracall.personal-context-delivery', action: 'read', items: supplied.personal.items, partial: false, continuation: null, issues: [] }, 'read');
          if (details) result.entries.push({ sessionId: snapshot.manager.getSessionId(), entryId: entry.id, action: 'provided', text, details, evidence: 'recorded', current: [] });
          continue;
        }
        if (message.role !== 'toolResult') continue;
        const action = toolAction(message.toolName);
        if (action && !message.isError && hasCall(entry.parentId, message.toolCallId, message.toolName)) {
          const details = delivery(message.details, action), text = actualText(message.content);
          if (details && text !== null) result.entries.push({ sessionId: snapshot.manager.getSessionId(), entryId: entry.id, toolCallId: message.toolCallId, action, text, details, evidence: 'recorded', current: [] });
          else result.issues.push({ code: 'personal_context_body_not_recorded', file: name });
        }
        const nested = 'nestedCalls' in message ? message.nestedCalls : undefined;
        if (object(nested) && Array.isArray(nested.calls) && nested.calls.some(call => object(call) && toolAction(call.name))) {
          // Pi saves only finite metadata for these children; do not fabricate text or infer a failed read.
          result.entries.push({ sessionId: snapshot.manager.getSessionId(), entryId: entry.id, toolCallId: message.toolCallId, action: 'nested', text: null, details: null, evidence: 'nested-unknown', current: [] });
        }
      }
    } catch (error) { result.issues.push({ code: code(error), file: name }); }
  }
  for (const entry of result.entries) {
    for (const item of entry.details?.items ?? []) {
      const key = JSON.stringify(item.target);
      let pending = current.get(key);
      if (!pending) { pending = inspect(item.target, budget).catch(error => ({ target: item.target, state: code(error) === 'personal_context_excluded' ? 'excluded' as const : 'unknown' as const, issue: code(error) })); current.set(key, pending); }
      entry.current.push(await pending);
    }
  }
  result.partial = result.issues.length > 0;
  return result;
}
