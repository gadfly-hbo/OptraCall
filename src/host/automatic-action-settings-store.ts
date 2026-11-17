import path from 'node:path';
import { constants } from 'node:fs';
import { lstat, mkdir, open, rename, unlink } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { automaticActionNodes } from './automatic-action-settings-types.ts';
import type { AutomaticActionSettings, AutomaticActionSettingsUpdate, AutomaticActionSettingsResult, AutomaticActionNode, AutomaticActionStartFacts, AutomaticActionStartDecision } from './automatic-action-settings-types.ts';

export class AutomaticActionSettingsFault extends Error {
  code: string; status: number;
  constructor(code: string, status = 409) { super(code); this.code = code; this.status = status; }
}
const fail = (code: string, status = 409): never => { throw new AutomaticActionSettingsFault(code, status); };
const object = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const defaults = (): AutomaticActionSettings => ({ formatVersion: 1, revision: 0, nodes: { save: false, review: false, ir: false, case: false, assets: false } });
function validSettings(value: unknown): value is AutomaticActionSettings {
  return object(value) && value.formatVersion === 1 && Number.isSafeInteger(value.revision) && (value.revision as number) >= 0
    && object(value.nodes) && Object.keys(value.nodes).length === automaticActionNodes.length && automaticActionNodes.every(node => typeof value.nodes === 'object' && value.nodes !== null && typeof (value.nodes as Record<string, unknown>)[node] === 'boolean')
    && (value.updatedAt === undefined || typeof value.updatedAt === 'string' && Number.isFinite(Date.parse(value.updatedAt)));
}

interface OperationReceipt { operationId: string; fingerprint: string; revision: number }
interface SettingsRecord extends AutomaticActionSettings { operations: OperationReceipt[] }
const operationId = (value: unknown) => typeof value === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value);
const publicSettings = (value: AutomaticActionSettings): AutomaticActionSettings => ({ formatVersion: 1, revision: value.revision, nodes: structuredClone(value.nodes), ...(value.updatedAt === undefined ? {} : { updatedAt: value.updatedAt }) });
const fingerprint = (input: AutomaticActionSettingsUpdate): string => createHash('sha256').update(JSON.stringify([input.expectedRevision, ...automaticActionNodes.map(node => input.nodes[node])])).digest('hex');
function validRecord(value: unknown): value is SettingsRecord {
  if (!validSettings(value) || !object(value) || Object.keys(value).some(key => !['formatVersion', 'revision', 'nodes', 'updatedAt', 'operations'].includes(key)) || !Array.isArray(value.operations)) return false;
  const ids = new Set<string>();
  return value.operations.length === value.revision && value.operations.every((receipt: unknown, index: number) => {
    if (!object(receipt) || Object.keys(receipt).some(key => !['operationId', 'fingerprint', 'revision'].includes(key)) || !operationId(receipt.operationId) || typeof receipt.fingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(receipt.fingerprint) || receipt.revision !== index + 1 || ids.has(receipt.operationId as string)) return false;
    ids.add(receipt.operationId as string); return true;
  });
}

/** One Host-owned preference source. Saving has no action/session callbacks. */
export function createAutomaticActionSettingsStore(options: { dataRoot: string }) {
  const root = path.resolve(options.dataRoot), directory = path.join(root, 'global-settings'), file = path.join(directory, 'automatic-actions.json');
  let mutation: Promise<unknown> = Promise.resolve();
  const serial = <T>(run: () => Promise<T>): Promise<T> => { const next = mutation.then(run, run); mutation = next.catch(() => {}); return next; };
  async function safeDirectory(create = false): Promise<boolean> {
    for (const current of [root, directory]) {
      let stat;
      try { stat = await lstat(current); } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        if (!create) return false;
        await mkdir(current, { recursive: current === root, mode: 0o700 }).catch(error => { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; });
        stat = await lstat(current);
      }
      if (!stat.isDirectory() || stat.isSymbolicLink() || process.getuid && stat.uid !== process.getuid() || (stat.mode & 0o022) !== 0) fail('automatic_action_settings_unsafe_path');
    }
    return true;
  }
  async function readRecord(): Promise<SettingsRecord> {
    if (!await safeDirectory()) return { ...defaults(), operations: [] };
    let handle;
    try {
      const expected = await lstat(file);
      if (!expected.isFile() || expected.isSymbolicLink() || expected.nlink !== 1 || process.getuid && expected.uid !== process.getuid() || (expected.mode & 0o022) !== 0) fail('automatic_action_settings_unsafe_file');
      handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
      const before = await handle.stat();
      if (!before.isFile() || before.dev !== expected.dev || before.ino !== expected.ino || before.size > 32 * 1024 * 1024) fail('automatic_action_settings_unsafe_file');
      const bytes = await handle.readFile(), after = await handle.stat();
      if (before.size !== after.size || before.mtimeMs !== after.mtimeMs || bytes.length !== after.size) fail('automatic_action_settings_changed');
      let value: unknown;
      try { value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); } catch { return fail('automatic_action_settings_corrupt'); }
      if (!validRecord(value)) return fail('automatic_action_settings_corrupt');
      return value;
    } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { ...defaults(), operations: [] }; throw error; }
    finally { await handle?.close(); }
  }
  async function read(): Promise<AutomaticActionSettings> { return serial(async () => publicSettings(await readRecord())); }
  async function write(value: SettingsRecord): Promise<void> {
    await safeDirectory(true);
    // Validate any existing file rather than silently replacing corrupt/unsafe settings.
    await readRecord();
    const temporary = path.join(directory, `.automatic-actions-${randomUUID()}.tmp`);
    let handle, published = false;
    try {
      handle = await open(temporary, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600);
      await handle.writeFile(JSON.stringify(value, null, 2) + '\n'); await handle.sync(); await handle.close(); handle = undefined;
      await rename(temporary, file); published = true;
      const parent = await open(directory, constants.O_RDONLY); try { await parent.sync(); } finally { await parent.close(); }
    } catch (error) { if (error instanceof AutomaticActionSettingsFault) throw error; fail(published ? 'automatic_action_settings_write_unknown' : 'automatic_action_settings_write_failed', 503); }
    finally { await handle?.close(); await unlink(temporary).catch(() => {}); }
  }
  async function update(input: AutomaticActionSettingsUpdate): Promise<AutomaticActionSettingsResult> {
    return serial(async () => {
      if (!object(input) || Object.keys(input).some(key => !['operationId', 'expectedRevision', 'nodes'].includes(key)) || !operationId(input.operationId) || !Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 0 || !validSettings({ formatVersion: 1, revision: 0, nodes: input.nodes })) fail('invalid_automatic_action_settings', 400);
      const previous = await readRecord(), digest = fingerprint(input), receipt = previous.operations.find(receipt => receipt.operationId === input.operationId);
      if (receipt) {
        if (receipt.fingerprint !== digest) fail('automatic_action_operation_conflict');
        return { settings: publicSettings(previous), replayed: true, operationRevision: receipt.revision };
      }
      if (!Number.isSafeInteger(input.expectedRevision) || input.expectedRevision !== previous.revision) fail('automatic_action_settings_conflict');
      const settings: SettingsRecord = { formatVersion: 1, revision: previous.revision + 1, nodes: structuredClone(input.nodes), updatedAt: new Date().toISOString(), operations: [...previous.operations, { operationId: input.operationId, fingerprint: digest, revision: previous.revision + 1 }] };
      await write(settings);
      return { settings: publicSettings(settings), replayed: false, operationRevision: settings.revision };
    });
  }
  async function readCurrent(node: AutomaticActionNode, facts: AutomaticActionStartFacts): Promise<AutomaticActionStartDecision> {
    if (!automaticActionNodes.includes(node) || !object(facts) || ['authorized', 'applicable', 'cancelled'].some(key => typeof facts[key] !== 'boolean')) fail('invalid_automatic_action_start', 400);
    const settings = await read();
    // A preference observation is not a session lease. Callers still use the
    // original SessionContext/signal to admit the action immediately afterwards.
    const reason = facts.cancelled ? 'cancelled' : !facts.authorized ? 'not_authorized' : !facts.applicable ? 'not_applicable' : !settings.nodes[node] ? 'disabled' : 'enabled';
    return { allowed: reason === 'enabled', reason, settingsRevision: settings.revision };
  }
  const readOperation = (id: string) => serial(async () => { if (!operationId(id)) return fail('invalid_automatic_action_settings_operation', 400); const receipt = (await readRecord()).operations.find(item => item.operationId === id); return receipt ? { ...receipt } : null; });
  return { read, update, readCurrent, readOperation };
}
