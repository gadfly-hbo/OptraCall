import { chmodSync, closeSync, constants, existsSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

export type EnablementRecord = Readonly<{ packageId: string; version: string; enabledAt: string }>;

export class EnablementFault extends Error {
  readonly code: string;
  constructor(code: string) { super(code); this.code = code; }
}

const packageIdPattern = /^[a-z][a-z0-9-]*$/;
const semverPattern = /^\d+\.\d+\.\d+$/;
const isoDate = (value: unknown): value is string => typeof value === 'string' && /^\d{4}-\d\d-\d\dT/.test(value) && Number.isFinite(Date.parse(value));
const object = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const fail = (code: string): never => { throw new EnablementFault(code); };

type StoredState = { version: 1; enabled: Record<string, { version: string; enabledAt: string }> };

/** One project's enablement pin file; the library itself stays the single content authority. */
export function createProjectEnablement(projectDirectory: string) {
  const directory = path.resolve(projectDirectory);
  const file = path.join(directory, 'metric-assets.json');

  const ensureDirectory = () => {
    try { mkdirSync(directory, { recursive: true, mode: 0o700 }); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
    const entry = lstatSync(directory);
    if (!entry.isDirectory() || entry.isSymbolicLink()) fail('ENABLEMENT_UNSAFE');
    chmodSync(directory, 0o700);
  };

  const load = (): StoredState => {
    if (!existsSync(file)) return { version: 1, enabled: {} };
    const entry = lstatSync(file);
    if (!entry.isFile() || entry.isSymbolicLink() || entry.nlink !== 1) return fail('ENABLEMENT_CORRUPT');
    let value: unknown;
    try { value = JSON.parse(readFileSync(file, 'utf8')); } catch { return fail('ENABLEMENT_CORRUPT'); }
    if (!object(value) || value.version !== 1 || !object(value.enabled)) return fail('ENABLEMENT_CORRUPT');
    const enabled: StoredState['enabled'] = {};
    for (const [packageId, record] of Object.entries(value.enabled)) {
      if (!packageIdPattern.test(packageId) || !object(record)
        || Object.keys(record).length !== 2
        || typeof record.version !== 'string' || !semverPattern.test(record.version)
        || !isoDate(record.enabledAt)) return fail('ENABLEMENT_CORRUPT');
      enabled[packageId] = { version: record.version, enabledAt: record.enabledAt };
    }
    return { version: 1, enabled };
  };

  const save = (state: StoredState): void => {
    ensureDirectory();
    const temporary = `${file}.${randomUUID().slice(0, 8)}.tmp`;
    try {
      const handle = openSync(temporary, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600);
      try { writeFileSync(handle, JSON.stringify(state, null, 2) + '\n'); fsyncSync(handle); } finally { closeSync(handle); }
      renameSync(temporary, file);
      const parent = openSync(directory, 'r');
      try { fsyncSync(parent); } finally { closeSync(parent); }
    } finally {
      if (existsSync(temporary)) unlinkSync(temporary);
    }
  };

  const identity = (packageId: string, version: string) => {
    if (typeof packageId !== 'string' || !packageIdPattern.test(packageId) || typeof version !== 'string' || !semverPattern.test(version)) return fail('ENABLEMENT_INVALID');
  };

  return {
    file,
    enable(packageId: string, version: string): EnablementRecord {
      identity(packageId, version);
      const state = load();
      const enabledAt = new Date().toISOString();
      save({ version: 1, enabled: { ...state.enabled, [packageId]: { version, enabledAt } } });
      return { packageId, version, enabledAt };
    },
    disable(packageId: string): void {
      if (typeof packageId !== 'string' || !packageIdPattern.test(packageId)) return fail('ENABLEMENT_INVALID');
      const state = load();
      if (!(packageId in state.enabled)) return;
      const { [packageId]: _removed, ...rest } = state.enabled;
      save({ version: 1, enabled: rest });
    },
    list(): readonly EnablementRecord[] {
      return Object.entries(load().enabled)
        .map(([packageId, record]) => ({ packageId, ...record }))
        .sort((a, b) => a.packageId.localeCompare(b.packageId));
    },
    enabled(packageId: string): EnablementRecord | undefined {
      if (typeof packageId !== 'string' || !packageIdPattern.test(packageId)) return fail('ENABLEMENT_INVALID');
      const record = load().enabled[packageId];
      return record ? { packageId, ...record } : undefined;
    },
  };
}
