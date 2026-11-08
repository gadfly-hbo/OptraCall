import { canonicalDataContextValue } from './project-data-context-request.ts';
import fs from 'node:fs/promises';
import path from 'node:path';
import { constants } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';

export class ProjectDataContextFault extends Error { code: string; constructor(code: string) { super(code); this.code = code; } }
export const fail = (code: string): never => { throw new ProjectDataContextFault(code); };
export const object = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
export const id = (value: unknown): string => typeof value === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value) ? value : fail('invalid_data_context_id');
export const hash = (value: unknown): string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value) ? value : fail('invalid_data_context_hash');
export const integer = (value: unknown): number => Number.isSafeInteger(value) && (value as number) >= 0 ? value as number : fail('invalid_data_context_number');
export const text = (value: unknown, max = 20000): string => typeof value === 'string' && value.length <= max && !value.includes('\0') ? value : fail('invalid_data_context_text');
export const date = (value: unknown): string => typeof value === 'string' && /^\d{4}-\d\d-\d\dT/.test(value) && Number.isFinite(Date.parse(value)) ? value : fail('invalid_data_context_date');
export const digest = (value: Uint8Array | string): string => createHash('sha256').update(value).digest('hex');
export function canonical(value: unknown): string { return canonicalDataContextValue(value, () => fail('invalid_data_context_value')); }
export const jsonBytes = (value: unknown): Buffer => Buffer.from(canonical(value) + '\n');
export const isMissing = (error: unknown): boolean => (error as NodeJS.ErrnoException).code === 'ENOENT';
export async function exists(file: string): Promise<boolean> { try { await fs.lstat(file); return true; } catch (error) { if (isMissing(error)) return false; throw error; } }
export function relative(value: unknown, directories: string[], extensions?: string[]): string {
  const name = text(value, 1000), parts = name.split('/');
  if (parts.length < 2 || !directories.includes(parts[0]) || parts.some(part => !part || part === '.' || part === '..' || part.includes('\\') || /[\u0000-\u001f\u007f]/.test(part)) || path.isAbsolute(name)) return fail('invalid_data_context_path');
  if (extensions && !extensions.includes(path.extname(name).toLowerCase())) return fail('unsupported_data_context_format');
  return name;
}
export async function directory(directoryPath: string, create = false): Promise<void> {
  if (create) { try { await fs.mkdir(directoryPath, { mode: 0o700 }); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; } }
  const stat = await fs.lstat(directoryPath); if (!stat.isDirectory() || stat.isSymbolicLink()) fail('unsafe_data_context_path');
}
/** Walk every component: O_NOFOLLOW alone does not protect parent directories. */
export async function safePath(root: string, relativePath: string, createParents = false): Promise<string> {
  if (path.isAbsolute(relativePath) || relativePath.split('/').some(part => !part || part === '.' || part === '..' || part.includes('\\'))) return fail('unsafe_data_context_path');
  await directory(root);
  let current = root; const parts = relativePath.split('/');
  for (const part of parts.slice(0, -1)) { current = path.join(current, part); await directory(current, createParents); }
  return path.join(current, parts.at(-1)!);
}
export async function readBytes(file: string, maximum = 10 * 1024 * 1024): Promise<Buffer> {
  const before = await fs.lstat(file, { bigint: true });
  if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1n || before.size > BigInt(maximum)) return fail('unsafe_data_context_file');
  const handle = await fs.open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const initial = await handle.stat({ bigint: true });
    if (!initial.isFile() || initial.nlink !== 1n || initial.ino !== before.ino || initial.dev !== before.dev || initial.size > BigInt(maximum)) return fail('unsafe_data_context_file');
    const chunks: Buffer[] = []; let length = 0;
    for (;;) { const buffer = Buffer.allocUnsafe(65536), read = await handle.read(buffer, 0, buffer.length, null); if (!read.bytesRead) break; length += read.bytesRead; if (length > maximum) fail('data_context_file_too_large'); chunks.push(buffer.subarray(0, read.bytesRead)); }
    const final = await handle.stat({ bigint: true }), current = await fs.lstat(file, { bigint: true });
    if (BigInt(length) !== initial.size || final.size !== initial.size || final.mtimeNs !== initial.mtimeNs || final.ctimeNs !== initial.ctimeNs || current.ino !== initial.ino || current.dev !== initial.dev || current.size !== initial.size || current.mtimeNs !== initial.mtimeNs || current.ctimeNs !== initial.ctimeNs || current.nlink !== 1n || current.isSymbolicLink()) return fail('data_context_file_changed');
    return Buffer.concat(chunks, length);
  } finally { await handle.close(); }
}
export function parse(bytes: Buffer): unknown { try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); } catch { return fail('corrupt_data_context_record'); } }
export async function writeExclusive(file: string, bytes: Buffer): Promise<void> {
  if (bytes.length > 50 * 1024 * 1024) fail('data_context_file_too_large');
  const handle = await fs.open(file, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600);
  try { await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); }
  const parent = await fs.open(path.dirname(file), constants.O_RDONLY); try { await parent.sync(); } finally { await parent.close(); }
}
export async function atomicJson(file: string, value: unknown): Promise<void> {
  const bytes = jsonBytes(value); if (bytes.length > 2 * 1024 * 1024) fail('data_context_metadata_too_large');
  if (await exists(file)) await readBytes(file, 2 * 1024 * 1024);
  const temporary = file + '.' + randomUUID() + '.tmp'; await writeExclusive(temporary, bytes); await fs.rename(temporary, file);
  const parent = await fs.open(path.dirname(file), constants.O_RDONLY); try { await parent.sync(); } finally { await parent.close(); }
}
