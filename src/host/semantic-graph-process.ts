import { spawn, execFile, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { join } from 'node:path';

/** Host-selected paths only. This tuple never crosses the model/SDK boundary. */
export type SemanticGraphBinding = { runRoot: string; snapshotId: string; python: string; codeRoot: string };
export type SemanticGraphCleanup = (options: { retryFailed?: boolean }) => Promise<void>;
export class SemanticGraphProcessFault extends Error {
  readonly code: string;
  constructor(code: string) { super(code); this.code = code; }
}
export type SemanticGraphProcessOptions = {
  binding: SemanticGraphBinding; query: Record<string, unknown>; signal: AbortSignal; assertCurrent: () => void;
  checkMany: (refs: unknown[]) => Promise<unknown[]>;
  registerCleanup?: (cleanup: SemanticGraphCleanup) => void;
  /** Process-control seam used by real-child failure tests; never a model argument. */
  signalGroup?: (pid: number, signal: NodeJS.Signals) => void;
  cleanupWaitMs?: number;
};
const fault = (code: string) => new SemanticGraphProcessFault(code);

/** One bounded stdio RPC job. Completion includes reap; failed cleanup stays retryable. */
export async function runSemanticGraphProcess<T = unknown>(options: SemanticGraphProcessOptions): Promise<T> {
  let child: ChildProcessWithoutNullStreams | undefined;
  let reaped = false; let closed = false; let groupKilled = false; let cleanupDone = false; let cleanupFailure: unknown;
  let cleanupPromise: Promise<void> | undefined;
  let closeResolve!: () => void;
  const closePromise = new Promise<void>(resolve => { closeResolve = resolve; });
  const cleanup: SemanticGraphCleanup = async ({ retryFailed } = {}) => {
    if (cleanupDone) return;
    if (cleanupFailure && !retryFailed) throw cleanupFailure;
    if (cleanupPromise && !cleanupFailure) return cleanupPromise;
    cleanupFailure = undefined;
    cleanupPromise = (async () => {
      if (!child) { cleanupDone = true; return; }
      if (!reaped && child.pid !== undefined) {
        try {
          // The trusted worker holds its leader alive after its result. Signal
          // the owned group once, while that leader is still ours; never a
          // saved/reaped PGID. SIGKILL also covers TERM-ignoring descendants.
          (options.signalGroup ?? ((pid, signal) => process.kill(-pid, signal)))(child.pid, 'SIGKILL');
          groupKilled = true;
        } catch (error) {
          if (!(error && typeof error === 'object' && 'code' in error && error.code === 'ESRCH')) throw fault('semantic_graph_cleanup_failed');
        }
      }
      if (!closed) {
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
          await Promise.race([closePromise, new Promise<never>((_, reject) => {
            timer = setTimeout(() => reject(fault('semantic_graph_cleanup_unknown')), options.cleanupWaitMs ?? 2500);
          })]);
        } finally { if (timer) clearTimeout(timer); }
      }
      if (reaped && !groupKilled && child.pid !== undefined) {
        // An unexpectedly exited leader may leave children with closed stdio.
        // Never terminate a remembered numeric PGID after reap. A finite,
        // read-only OS inventory can prove that group absent; otherwise keep
        // UNKNOWN. A reused/unreadable group conservatively remains UNKNOWN.
        const absent = await new Promise<boolean>(resolve => {
          execFile('/bin/ps', ['-axo', 'pgid='], { encoding: 'utf8', timeout: 1000, maxBuffer: 2 * 1024 * 1024 }, (failure, stdout) => {
            if (failure) { resolve(false); return; }
            const groups = stdout.trim().split(/\s+/);
            resolve(groups.every(value => /^\d+$/.test(value)) && !groups.includes(String(child!.pid)));
          });
        });
        if (!absent) throw fault('semantic_graph_cleanup_unknown');
      }
      cleanupDone = true;
    })().catch(error => { cleanupFailure = error; throw error; });
    return cleanupPromise;
  };
  // The Resource sees the cleanup before any asynchronous work or spawn.
  options.registerCleanup?.(cleanup);
  let resultResolve!: (value: T) => void; let resultReject!: (error: unknown) => void;
  const resultPromise = new Promise<T>((resolve, reject) => { resultResolve = resolve; resultReject = reject; });
  let terminal = false; let resultReceived = false; let pending = ''; let outputBytes = 0; let errorsBytes = 0; let authorityCalls = 0;
  let queue = Promise.resolve();
  const fail = (error: unknown) => { if (!terminal) { terminal = true; resultReject(error); } };
  const current = () => { options.signal.throwIfAborted(); options.assertCurrent(); };
  const abort = () => fail(options.signal.reason ?? fault('semantic_graph_cancelled'));
  try {
    current();
    child = spawn(options.binding.python, ['-B', '-m', 'fourbase_l2.worker'], {
      cwd: options.binding.codeRoot, detached: true,
      env: { PATH: '/usr/bin:/bin', PYTHONDONTWRITEBYTECODE: '1', PYTHONPATH: join(options.binding.codeRoot, 'scripts'), PYTHONUNBUFFERED: '1',
        LANG: 'en_US.UTF-8', LC_ALL: 'en_US.UTF-8' }, stdio: ['pipe', 'pipe', 'pipe'],
    });
    child.once('error', () => fail(fault('semantic_graph_process_unavailable')));
    child.once('exit', () => { reaped = true; if (!resultReceived) fail(fault('semantic_graph_process_failed')); });
    child.once('close', () => { reaped = true; closed = true; closeResolve(); });
    child.stdin.on('error', () => { if (!terminal) fail(fault('semantic_graph_protocol_failed')); });
    options.signal.addEventListener('abort', abort, { once: true });
    if (options.signal.aborted) abort();
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      outputBytes += Buffer.byteLength(chunk);
      if (outputBytes > 8 * 1024 * 1024) { fail(fault('semantic_graph_protocol_limit')); return; }
      pending += chunk;
      let index: number;
      while ((index = pending.indexOf('\n')) !== -1) {
        const line = pending.slice(0, index); pending = pending.slice(index + 1);
        queue = queue.then(async () => {
          if (terminal) return;
          current();
          let message: Record<string, unknown>;
          try { message = JSON.parse(line) as Record<string, unknown>; } catch { throw fault('semantic_graph_protocol_failed'); }
          if (!message || typeof message !== 'object') throw fault('semantic_graph_protocol_failed');
          if (message.type === 'authority') {
            if (++authorityCalls > 8 || !Number.isSafeInteger(message.id) || !Array.isArray(message.refs) || message.refs.length > 4096 || Buffer.byteLength(line) > 2 * 1024 * 1024) throw fault('semantic_graph_protocol_limit');
            const values = await options.checkMany(message.refs); current();
            if (!Array.isArray(values) || values.length !== message.refs.length) throw fault('semantic_graph_authority_failed');
            const safeValues = values.map(value => {
              if (!value || typeof value !== 'object' || !('state' in value) || !('gaps' in value) || typeof value.state !== 'string' || !Array.isArray(value.gaps)) throw fault('semantic_graph_authority_failed');
              return { state: value.state, gaps: value.gaps };
            });
            child!.stdin.write(JSON.stringify({ type: 'authority-result', id: message.id, results: safeValues }) + '\n');
          } else if (message.type === 'result' && !resultReceived && message.result && typeof message.result === 'object') {
            resultReceived = true; terminal = true; resultResolve(message.result as T);
          } else if (message.type === 'error') {
            const code = typeof message.code === 'string' && /^[a-z0-9_-]{1,80}$/.test(message.code) ? message.code : 'worker_failed';
            throw fault(`semantic_graph_${code}`);
          } else throw fault('semantic_graph_protocol_failed');
        }).catch(fail);
      }
    });
    child.stderr.on('data', (chunk: Buffer) => { errorsBytes += chunk.length; if (errorsBytes > 64 * 1024) fail(fault('semantic_graph_protocol_limit')); });
    child.stdin.write(JSON.stringify({ type: 'query', runRoot: options.binding.runRoot, snapshotId: options.binding.snapshotId, query: options.query }) + '\n');
    const result = await resultPromise;
    await cleanup({}); current(); return result;
  } catch (error) {
    await cleanup({}); throw error;
  } finally {
    options.signal.removeEventListener('abort', abort);
    // A read already dispatched into the original Host Store remains part of
    // this request, even after its Python peer has been reaped. Its current
    // check prevents any late reply; awaiting it preserves Resource occupancy.
    await queue;
  }
}
