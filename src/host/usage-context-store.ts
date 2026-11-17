import path from 'node:path';
import { constants } from 'node:fs';
import { lstat, mkdir, open, rename, unlink } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { parseUsageContext, UsageContextFault, type UsageContextSettings, type UsageContextUpdate, type UsageContextSettingsResult, type UsageContextOperation } from './usage-context-types.ts';

interface StoredSettings extends UsageContextSettings { operations: UsageContextOperation[] }
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const uuid = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value);
function fail(code: string, status = 409): never { throw new UsageContextFault(code, status); }
const initial = (): StoredSettings => ({ formatVersion: 1, revision: 0, context: null, operations: [] });
const view = ({ operations: _, ...settings }: StoredSettings): UsageContextSettings => structuredClone(settings);
function decode(value: unknown): StoredSettings {
  if (!object(value) || Object.keys(value).some(key => !['formatVersion', 'revision', 'context', 'updatedAt', 'operations'].includes(key)) || value.formatVersion !== 1 || !Number.isSafeInteger(value.revision) || Number(value.revision) < 0 || !Array.isArray(value.operations) || value.updatedAt !== undefined && (typeof value.updatedAt !== 'string' || !Number.isFinite(Date.parse(value.updatedAt)))) fail('usage_context_settings_corrupt');
  try {
    if (value.context !== null) parseUsageContext(value.context);
    const ids = new Set<string>();
    if (value.operations.length !== value.revision) throw new Error();
    for (const [index, item] of value.operations.entries()) {
      if (!object(item) || Object.keys(item).some(key => !['operationId', 'fingerprint', 'revision', 'context'].includes(key)) || !uuid(item.operationId) || ids.has(item.operationId) || typeof item.fingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(item.fingerprint) || item.revision !== index + 1) throw new Error();
      if (item.context !== null) parseUsageContext(item.context);
      ids.add(item.operationId);
    }
  } catch { fail('usage_context_settings_corrupt'); }
  return value as unknown as StoredSettings;
}

/** A preference only: no session, model or business-action callbacks. */
export function createUsageContextStore(options: { dataRoot: string }) {
  const root = path.resolve(options.dataRoot), directory = path.join(root, 'global-settings'), file = path.join(directory, 'usage-context.json');
  let mutation: Promise<unknown> = Promise.resolve();
  const serial = <T>(run: () => Promise<T>): Promise<T> => { const next = mutation.then(run, run); mutation = next.catch(() => {}); return next; };
  async function directories(create = false): Promise<boolean> {
    for (const current of [root, directory]) {
      let stat;
      try { stat = await lstat(current); }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        if (!create) return false;
        await mkdir(current, { recursive: current === root, mode: 0o700 }).catch(error => { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; });
        stat = await lstat(current);
      }
      if (!stat.isDirectory() || stat.isSymbolicLink() || process.getuid && stat.uid !== process.getuid() || (stat.mode & 0o022)) fail('usage_context_settings_unsafe_path');
    }
    return true;
  }
  async function record(): Promise<StoredSettings> {
    if (!await directories()) return initial();
    let handle;
    try {
      const expected = await lstat(file, { bigint: true });
      if (!expected.isFile() || expected.isSymbolicLink() || expected.nlink !== 1n || process.getuid && expected.uid !== BigInt(process.getuid()) || (expected.mode & 0o022n)) fail('usage_context_settings_unsafe_file');
      handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
      const before = await handle.stat({ bigint: true });
      if (before.dev !== expected.dev || before.ino !== expected.ino || before.size > 32n * 1024n * 1024n) fail('usage_context_settings_unsafe_file');
      const bytes = await handle.readFile(), after = await handle.stat({ bigint: true }), current = await lstat(file, { bigint: true });
      if (before.size !== after.size || before.mtimeNs !== after.mtimeNs || before.ctimeNs !== after.ctimeNs || BigInt(bytes.length) !== after.size || current.dev !== before.dev || current.ino !== before.ino || current.nlink !== 1n) fail('usage_context_settings_changed');
      let value: unknown; try { value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); } catch { return fail('usage_context_settings_corrupt'); }
      return decode(value);
    } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return initial(); throw error; }
    finally { await handle?.close(); }
  }
  async function write(value: StoredSettings): Promise<void> {
    await record();
    const temporary = path.join(directory, `.usage-context-${randomUUID()}.tmp`);
    let handle, published = false;
    try {
      handle = await open(temporary, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600);
      await handle.writeFile(JSON.stringify(value, null, 2) + '\n'); await handle.sync(); await handle.close(); handle = undefined;
      await rename(temporary, file); published = true;
      const parent = await open(directory, constants.O_RDONLY); try { await parent.sync(); } finally { await parent.close(); }
    } catch { fail(published ? 'usage_context_settings_write_unknown' : 'usage_context_settings_write_failed', 503); }
    finally { await handle?.close(); await unlink(temporary).catch(() => {}); }
  }
  const read = (): Promise<UsageContextSettings> => serial(async () => view(await record()));
  const update = (input: UsageContextUpdate): Promise<UsageContextSettingsResult> => serial(async () => {
    if (!object(input) || Object.keys(input).some(key => !['operationId', 'expectedRevision', 'context'].includes(key)) || !uuid(input.operationId) || !Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 0) fail('invalid_usage_context_settings', 400);
    const context = input.context === null ? null : parseUsageContext(input.context);
    await directories(true);
    const lock = path.join(directory, '.usage-context.lock'), token = randomUUID();
    let claim;
    try { claim = await open(lock, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600); }
    catch { return fail('usage_context_settings_locked', 503); }
    const lockStat = await claim.stat();
    try {
      await claim.writeFile(token); await claim.sync();
      const previous = await record(), fingerprint = createHash('sha256').update(JSON.stringify([input.expectedRevision, context])).digest('hex');
      const accepted = previous.operations.find(operation => operation.operationId === input.operationId);
      if (accepted) {
        if (accepted.fingerprint !== fingerprint) fail('usage_context_operation_conflict');
        return { settings: view(previous), replayed: true, operationRevision: accepted.revision };
      }
      if (previous.revision !== input.expectedRevision) fail('usage_context_settings_conflict');
      const receipt: UsageContextOperation = { operationId: input.operationId, fingerprint, revision: previous.revision + 1, context };
      const settings: StoredSettings = { formatVersion: 1, revision: receipt.revision, context, updatedAt: new Date().toISOString(), operations: [...previous.operations, receipt] };
      await write(settings);
      return { settings: view(settings), replayed: false, operationRevision: receipt.revision };
    } finally {
      await claim.close();
      const current = await lstat(lock);
      if (!current.isFile() || current.isSymbolicLink() || current.dev !== lockStat.dev || current.ino !== lockStat.ino) fail('usage_context_settings_lock_changed', 503);
      const owner = await open(lock, constants.O_RDONLY | constants.O_NOFOLLOW);
      try { if ((await owner.readFile('utf8')) !== token) fail('usage_context_settings_lock_changed', 503); } finally { await owner.close(); }
      await unlink(lock);
    }
  });
  const readOperation = (id: string): Promise<UsageContextOperation | null> => serial(async () => {
    if (!uuid(id)) fail('invalid_usage_context_operation', 400);
    return structuredClone((await record()).operations.find(item => item.operationId === id) ?? null);
  });
  return { read, update, readOperation };
}
