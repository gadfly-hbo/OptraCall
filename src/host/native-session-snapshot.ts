import fs from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { parseSessionEntries, SessionManager } from '../agent/sdk.ts';

export const nativeSnapshotLimit = 50 * 1024 * 1024;
export type NativeSnapshotReadBudget = { files: number; bytes: number };
export const createNativeSnapshotReadBudget = (): NativeSnapshotReadBudget => ({ files: 20, bytes: nativeSnapshotLimit });
export class NativeSnapshotError extends Error {
  readonly code: string;
  constructor(code: string) { super(code); this.code = code; }
}
const bad = (code = 'session_history_unavailable'): never => { throw new NativeSnapshotError(code); };
const object = (v: unknown): v is Record<string, unknown> => Boolean(v && typeof v === 'object' && !Array.isArray(v));
const text = (v: unknown): v is string => typeof v === 'string' && Boolean(v.trim());
const kinds = new Set(['message', 'thinking_level_change', 'model_change', 'usage', 'compaction', 'branch_summary', 'custom', 'label', 'session_info', 'custom_message', 'context_edit']);

/** This adapter never calls open(), migrates a file, follows parentSession, or repairs JSONL. */
export async function readNativeSessionSnapshot(file: string, directory: string, cwd: string, byteBudget = nativeSnapshotLimit, options: { signal?: AbortSignal; budget?: NativeSnapshotReadBudget } = {}) {
  options.signal?.throwIfAborted();
  if (path.dirname(path.resolve(file)) !== path.resolve(directory) || !file.endsWith('.jsonl')) return bad();
  if (options.budget) {
    if (options.budget.files < 1) return bad('native_snapshot_budget_exhausted');
    options.budget.files--;
  }
  // Check every directory component; O_NOFOLLOW below protects the final file.
  let current = path.resolve(directory);
  while (true) {
    const stat = await fs.lstat(current);
    // macOS exposes the system /var alias for its own temporary directories.
    // This exact OS alias is not a project-controlled session link.
    if (stat.isSymbolicLink() && process.platform === 'darwin' && current === '/var' && await fs.realpath(current) === '/private/var') { current = '/'; continue; }
    if (!stat.isDirectory() || stat.isSymbolicLink()) return bad();
    const parent = path.dirname(current); if (parent === current) break; current = parent;
  }
  const before = await fs.lstat(file);
  options.signal?.throwIfAborted();
  if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1) return bad();
  if (before.size > Math.min(nativeSnapshotLimit, byteBudget)) return bad('native_snapshot_too_large');
  if (options.budget) {
    if (before.size > options.budget.bytes) return bad('native_snapshot_budget_exhausted');
    options.budget.bytes -= before.size;
  }
  const handle = await fs.open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  let bytes: Buffer;
  try {
    const opened = await handle.stat();
    if (opened.ino !== before.ino || opened.dev !== before.dev || opened.nlink !== 1 || opened.size !== before.size) return bad('native_snapshot_changed');
    // A concurrent append must not turn a checked 50MiB read into an unbounded readFile.
    const buffer = Buffer.alloc(before.size + 1); let length = 0;
    while (length < buffer.length) {
      options.signal?.throwIfAborted();
      const read = await handle.read(buffer, length, buffer.length - length, length);
      if (!read.bytesRead) break; length += read.bytesRead;
    }
    bytes = buffer.subarray(0, length);
    const after = await handle.stat(), named = await fs.lstat(file);
    if (bytes.length !== before.size || after.size !== before.size || after.mtimeMs !== before.mtimeMs || after.ctimeMs !== before.ctimeMs || named.ino !== before.ino || named.dev !== before.dev || named.nlink !== 1 || named.size !== before.size || named.mtimeMs !== before.mtimeMs || named.ctimeMs !== before.ctimeMs) return bad('native_snapshot_changed');
  } finally { await handle.close(); }
  options.signal?.throwIfAborted();
  let content: string;
  try { content = new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { return bad(); }
  if (!content || !content.endsWith('\n')) return bad('native_snapshot_incomplete');
  let values: unknown[];
  try { values = content.slice(0, -1).split('\n').map(line => JSON.parse(line)); } catch { return bad(); }
  const header = values[0];
  if (!object(header) || header.type !== 'session' || header.version !== 3 || !text(header.id) || !text(header.timestamp) || !Number.isFinite(Date.parse(header.timestamp)) || typeof header.cwd !== 'string') return bad('native_snapshot_unsupported');
  const parents = new Map<string, string | null>();
  for (const entry of values.slice(1)) {
    if (!object(entry) || !text(entry.type) || !kinds.has(entry.type) || !text(entry.id) || parents.has(entry.id) || !(entry.parentId === null || text(entry.parentId)) || !text(entry.timestamp) || !Number.isFinite(Date.parse(entry.timestamp))) return bad();
    if (entry.type === 'message' && (!object(entry.message) || !text(entry.message.role) || !(Array.isArray(entry.message.content) || typeof entry.message.content === 'string'))) return bad();
    if (entry.type === 'custom' && !text(entry.customType)) return bad();
    parents.set(entry.id, entry.parentId);
  }
  // Guard the SDK's unbounded parent walk without replacing its projection logic.
  const done = new Set<string>();
  for (const id of parents.keys()) {
    let cursor: string | null = id; const seen = new Set<string>();
    while (cursor !== null && !done.has(cursor)) {
      if (!parents.has(cursor) || seen.has(cursor) || seen.size > parents.size) return bad();
      seen.add(cursor); cursor = parents.get(cursor)!;
    }
    for (const item of seen) done.add(item);
  }
  const entries = parseSessionEntries(content);
  if (entries.length !== values.length) return bad();
  const manager = SessionManager.inMemory(cwd, undefined, entries);
  options.signal?.throwIfAborted();
  return { file, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), manager, entries: manager.getEntries(), branchIds: new Set(manager.getBranch().map(entry => entry.id)) };
}
