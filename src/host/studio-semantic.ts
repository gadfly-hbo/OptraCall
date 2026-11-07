import { createHash, randomUUID } from 'node:crypto';
import { execFile, spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { join } from 'node:path';
import type { SemanticGraphCleanup } from './semantic-graph-process.ts';
import type { SemanticGraphSourceRef } from '../../extensions/business-plugins/semantic-context/graph.ts';

export type StudioSemanticSource = { id: string; revision: string; sha256: string; text: string; locator?: string; ref?: import('../../extensions/business-plugins/studio/contracts.ts').StudioSourceRef };
export type StudioSemanticCompletion = { kind: 'entities' | 'relations'; format: 'typed' | 'structured'; prompt: string; schema?: Record<string, unknown> };
export type StudioSemanticOptions = {
  python: string; codeRoot: string; source: StudioSemanticSource; signal: AbortSignal;
  assertCurrent(): void;
  complete(input: StudioSemanticCompletion, signal: AbortSignal): Promise<unknown>;
  registerCleanup?(cleanup: SemanticGraphCleanup): void;
};
export type StudioSemanticExtraction = {
  component: { name: 'semantica'; version: '0.7.0' }; source: Omit<StudioSemanticSource, 'text'>;
  entities: Array<{ text: string; label: string; confidence: number; actualMethod: string; source: Omit<StudioSemanticSource, 'text'> }>;
  relations: Array<{ source: string; target: string; predicate: string; confidence: number; actualMethod: string; weak: boolean; provenance: Omit<StudioSemanticSource, 'text'> }>;
  calls: Array<{ kind: 'entities' | 'relations'; format: 'typed' | 'structured'; state: 'completed' | 'failed' }>;
  failures: string[]; limitations: string[]; candidateNeedsReview: true;
};
export async function runStudioSemanticExtraction(options: StudioSemanticOptions): Promise<StudioSemanticExtraction> {
  if (createHash('sha256').update(options.source.text).digest('hex') !== options.source.sha256) throw new Error('studio_semantic_source_integrity_mismatch');
  const { source } = options;
  if (!source.id || !source.revision || !source.text.trim() || Buffer.byteLength(source.text) > 256 * 1024) throw new Error('studio_semantic_invalid_source');
  return runStudioWorker<StudioSemanticExtraction>({ ...options, worker: 'studio_extract', command: { type: 'extract', source } });
}


type WorkerOptions = Omit<StudioSemanticOptions, 'source'> & { checkMany?: StudioGraphBuildOptions['checkMany']; worker: 'studio_extract' | 'studio_build'; command: Record<string, unknown> };
const fault = (code: string) => Object.assign(new Error(`studio_semantic_${code}`), { code: `studio_semantic_${code}` });

/** A trusted, bounded tool process. Its model callback belongs to the caller's
 * existing public SessionLease; this module creates no SDK session or provider. */
async function runStudioWorker<T>(options: WorkerOptions): Promise<T> {
  let child: ChildProcessWithoutNullStreams | undefined;
  let reaped = false, closed = false, resultReceived = false, terminal = false;
  let cleanupFailure: unknown, cleanupPromise: Promise<void> | undefined;
  let closeResolve!: () => void;
  const closePromise = new Promise<void>(resolve => { closeResolve = resolve; });
  const current = () => { options.signal.throwIfAborted(); options.assertCurrent(); };
  const cleanup: SemanticGraphCleanup = async ({ retryFailed } = {}) => {
    if (cleanupFailure && !retryFailed) throw cleanupFailure;
    if (cleanupPromise && !cleanupFailure) return cleanupPromise;
    cleanupFailure = undefined;
    cleanupPromise = (async () => {
      if (!child) return;
      if (!reaped && child.pid !== undefined) {
        try { process.kill(-child.pid, 'SIGKILL'); }
        catch (error) { if (!(error && typeof error === 'object' && 'code' in error && error.code === 'ESRCH')) throw fault('cleanup_failed'); }
      } else if (child.pid !== undefined) {
        const absent = await new Promise<boolean>(resolve => execFile('/bin/ps', ['-axo', 'pgid='], { timeout: 1000, maxBuffer: 2 * 1024 * 1024 }, (error, output) => {
          const groups = output.trim().split(/\s+/); resolve(!error && groups.every(value => /^\d+$/.test(value)) && !groups.includes(String(child!.pid)));
        }));
        if (!absent) throw fault('cleanup_unknown');
      }
      if (!closed) {
        let timer: ReturnType<typeof setTimeout> | undefined;
        try { await Promise.race([closePromise, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(fault('cleanup_unknown')), 2500); })]); }
        finally { if (timer) clearTimeout(timer); }
      }
    })().catch(error => { cleanupFailure = error; throw error; });
    return cleanupPromise;
  };
  options.registerCleanup?.(cleanup);
  let resolveResult!: (result: T) => void, rejectResult!: (error: unknown) => void;
  const result = new Promise<T>((resolve, reject) => { resolveResult = resolve; rejectResult = reject; });
  const fail = (error: unknown) => { if (!terminal) { terminal = true; rejectResult(error); } };
  const abort = () => fail(options.signal.reason ?? fault('cancelled'));
  let queue = Promise.resolve(), pending = '', outputBytes = 0, errorBytes = 0;
  try {
    current();
    child = spawn(options.python, ['-B', '-m', `fourbase_l2.${options.worker}`], {
      cwd: options.codeRoot, detached: true, stdio: ['pipe', 'pipe', 'pipe'],
      env: { PATH: '/usr/bin:/bin', PYTHONDONTWRITEBYTECODE: '1', PYTHONPATH: join(options.codeRoot, 'scripts'),
        PYTHONUNBUFFERED: '1', SEMANTICA_CACHE_BACKEND: 'memory', SEMANTICA_CACHE_ENABLED: 'false', LANG: 'en_US.UTF-8', LC_ALL: 'en_US.UTF-8' },
    });
    child.once('error', () => fail(fault('process_unavailable')));
    child.once('exit', () => { reaped = true; if (!resultReceived) fail(fault('process_failed')); });
    child.once('close', () => { reaped = true; closed = true; closeResolve(); });
    child.stdin.on('error', () => { if (!terminal) fail(fault('protocol_failed')); });
    options.signal.addEventListener('abort', abort, { once: true });
    if (options.signal.aborted) abort();
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      outputBytes += Buffer.byteLength(chunk); if (outputBytes > 8 * 1024 * 1024) { fail(fault('protocol_limit')); return; }
      pending += chunk;
      let end: number;
      while ((end = pending.indexOf('\n')) !== -1) {
        const line = pending.slice(0, end); pending = pending.slice(end + 1);
        queue = queue.then(async () => {
          if (terminal) return; current();
          const message = JSON.parse(line) as Record<string, unknown>;
          if (!message || typeof message !== 'object') throw fault('protocol_failed');
          if (message.type === 'completion') {
            if (!Number.isSafeInteger(message.id) || !message.request || typeof message.request !== 'object') throw fault('protocol_failed');
            const request = message.request as StudioSemanticCompletion;
            if (!['entities', 'relations'].includes(request.kind) || !['typed', 'structured'].includes(request.format) || typeof request.prompt !== 'string' || Buffer.byteLength(request.prompt) > 1024 * 1024) throw fault('protocol_limit');
            try { const value = await options.complete(request, options.signal); current(); child!.stdin.write(JSON.stringify({ type: 'completion-result', id: message.id, result: value }) + '\n'); }
            catch { current(); child!.stdin.write(JSON.stringify({ type: 'completion-result', id: message.id, error: 'pi_completion_failed' }) + '\n'); }
          } else if (message.type === 'authority') {
            if (!options.checkMany || !Number.isSafeInteger(message.id) || !Array.isArray(message.refs) || message.refs.length > 4096) throw fault('protocol_failed');
            const results = await options.checkMany(message.refs); current();
            if (results.length !== message.refs.length) throw fault('authority_failed');
            child!.stdin.write(JSON.stringify({ type: 'authority-result', id: message.id, results: results.map(value => ({ state: value.state, gaps: value.gaps })) }) + '\n');
          } else if (message.type === 'result' && message.result && typeof message.result === 'object' && !resultReceived) {
            current(); resultReceived = true; terminal = true; resolveResult(message.result as T);
          } else if (message.type === 'error') throw fault('worker_failed');
          else throw fault('protocol_failed');
        }).catch(fail);
      }
    });
    child.stderr.on('data', (chunk: Buffer) => { errorBytes += chunk.length; if (errorBytes > 64 * 1024) fail(fault('protocol_limit')); });
    child.stdin.write(JSON.stringify(options.command) + '\n');
    const value = await result; await cleanup({}); current(); return value;
  } catch (error) { await cleanup({}); throw error; }
  finally { options.signal.removeEventListener('abort', abort); await queue; }
}

export type StudioGraphSourceRef = SemanticGraphSourceRef;
export type StudioGraphSource = { ref: StudioGraphSourceRef; title: string; body: string; kind: string };
export type StudioGraphBuildOptions = Omit<StudioSemanticOptions, 'source' | 'complete'> & {
  runRoot: string; sources: StudioGraphSource[]; snapshotId?: string;
  checkMany(refs: unknown[]): Promise<Array<{ state: string; gaps: string[] }>>;
};
export type StudioGraphBuildResult = { snapshotId: string; formatVersion: 2; sourceRefs: StudioGraphSourceRef[]; counts: { nodes: number; edges: number }; component: { name: 'semantica'; version: '0.7.0' } };
export async function buildStudioSemanticSnapshot(options: StudioGraphBuildOptions): Promise<StudioGraphBuildResult> {
  if (!Array.isArray(options.sources) || !options.sources.length || options.sources.length > 256) throw fault('invalid_sources');
  const snapshotId = options.snapshotId ?? randomUUID();
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(snapshotId)) throw fault('invalid_snapshot_id');
  const command = { type: 'build', runRoot: options.runRoot, sources: options.sources, snapshotId };
  if (Buffer.byteLength(JSON.stringify(command)) > 2 * 1024 * 1024) throw fault('request_limit');
  try { return await runStudioWorker<StudioGraphBuildResult>({ ...options, complete: async () => { throw fault('build_cannot_generate'); }, worker: 'studio_build', command }); }
  catch (error) { if (error && typeof error === 'object') Object.assign(error, { snapshotId }); throw error; }
}
