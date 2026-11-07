import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { StudioError, digest, uuid } from '../../extensions/business-plugins/studio/validation.ts';

type Receipt = { requestId: string; fingerprint: string; status: 'unknown' | 'succeeded' | 'failed'; systemId?: string; effect?: {kind:'graph';systemId:string;snapshotId:string}; result?: Record<string, unknown>; statusCode?: number; error?: string };
/** Studio write receipts only: no task execution, scheduling, or automatic replay. */
export function studioOperations(dataRoot: string) {
  const root = path.join(dataRoot, 'studio-operations');
  const file = (id: string) => path.join(root, `${uuid(id)}.json`);
  const ensure = () => { for (const dir of [root]) { fs.mkdirSync(dir, { recursive: true, mode: 0o700 }); const s = fs.lstatSync(dir); if (!s.isDirectory() || s.isSymbolicLink()) throw new StudioError('studio_unsafe_operations', 409); } };
  const read = (id: string): Receipt | undefined => {
    const name = file(id); if (!fs.existsSync(name)) return;
    const stat = fs.lstatSync(name); if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.size > 4 * 1024 * 1024) throw new StudioError('studio_operation_corrupt', 409);
    const fd = fs.openSync(name, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
    try { const actual = fs.fstatSync(fd); if (actual.ino !== stat.ino || actual.dev !== stat.dev || actual.nlink !== 1) throw new StudioError('studio_operation_corrupt', 409); const value = JSON.parse(fs.readFileSync(fd, 'utf8')); if (value.requestId !== id || !['unknown','succeeded','failed'].includes(value.status) || typeof value.fingerprint !== 'string') throw new StudioError('studio_operation_corrupt', 409); return value; } finally { fs.closeSync(fd); }
  };
  const write = (value: Receipt, exclusive = false) => {
    ensure(); const name = file(value.requestId), temp = exclusive ? name : `${name}.${randomUUID()}.tmp`;
    const fd = fs.openSync(temp, fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_WRONLY | fs.constants.O_NOFOLLOW, 0o600);
    try { fs.writeFileSync(fd, JSON.stringify(value) + '\n'); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    if (!exclusive) fs.renameSync(temp, name);
    const dir = fs.openSync(root, 'r'); try { fs.fsyncSync(dir); } finally { fs.closeSync(dir); }
  };
  return { read,
    async run(id: string, identity: unknown, operation: () => Promise<{ statusCode?: number; result: Record<string, unknown>; systemId?: string }>, pending: Pick<Receipt,'systemId'|'effect'> = {}) {
      const fingerprint = digest(identity), previous = read(id);
      if (previous) { if (previous.fingerprint !== fingerprint) throw new StudioError('studio_operation_conflict', 409); if (previous.status === 'unknown') throw new StudioError('studio_operation_unknown', 409); if (previous.status === 'failed') throw new StudioError(previous.error || 'studio_operation_failed', previous.statusCode || 409); return previous; }
      write({ requestId: id, fingerprint, status: 'unknown', ...pending }, true);
      try { const result = await operation(); const receipt: Receipt = { requestId: id, fingerprint, status: 'succeeded', ...result }; write(receipt); return receipt; }
      catch (error) { if (error instanceof StudioError && error.status < 500) write({ requestId: id, fingerprint, status: 'failed', error: error.code, statusCode: error.status }); throw error; }
    },
  };
}
