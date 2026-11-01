import { spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { open, unlink, type FileHandle } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { BashOperations } from './sdk.ts';

const captureError = (cause: unknown) => new Error('protected_bash_capture_failed', { cause });

async function anonymousCapture(root: string): Promise<FileHandle> {
  // Exclusive creation cannot follow a pre-existing file or symlink. Unlink
  // before spawn: neither successful calls nor active background writers leave
  // a capture pathname in the scope. libuv opens this manager FD close-on-exec.
  const name = path.join(root, '.optracall-bash-' + randomUUID());
  const file = await open(name, constants.O_CREAT | constants.O_EXCL | constants.O_RDWR, 0o600);
  try { await unlink(name); }
  catch (error) { await file.close(); throw error; }
  return file;
}

/** Public SDK operations; the caller supplies only a trusted scope TMPDIR. */
export function createProtectedBashOperations(captureRoot = process.env.TMPDIR ?? tmpdir()): BashOperations {
  return { exec: async (command, cwd, options) => {
    if (options.signal?.aborted) throw new Error('aborted');
    if (options.timeout !== undefined && (!Number.isFinite(options.timeout) || options.timeout <= 0 || options.timeout * 1000 > 2_147_483_647)) {
      throw new Error('Invalid timeout: must be a finite positive number of seconds');
    }
    let file: FileHandle;
    try { file = await anonymousCapture(captureRoot); }
    catch (error) { throw captureError(error); }
    let child: ChildProcess | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined, observer: ReturnType<typeof setInterval> | undefined;
    let reading: Promise<void> | undefined, failure: Error | undefined;
    let position = 0, timedOut = false, stopped = false;
    let onExit: ((code: number | null) => void) | undefined, onError: ((error: Error) => void) | undefined;
    const abort = () => { try { child?.kill('SIGKILL'); } catch { /* exited */ } };
    const stopObserving = () => {
      stopped = true;
      if (observer) clearInterval(observer);
      if (timer) clearTimeout(timer);
      observer = undefined; timer = undefined;
    };
    const readTo = async (limit: number) => {
      if (!Number.isSafeInteger(limit) || limit < position) throw new Error('capture_length_changed');
      while (position < limit) {
        const buffer = Buffer.allocUnsafe(Math.min(65_536, limit - position));
        // pread leaves the shared stdout/stderr write offset untouched.
        const { bytesRead } = await file.read(buffer, 0, buffer.length, position);
        if (!bytesRead) throw new Error('capture_ended_before_snapshot');
        position += bytesRead;
        options.onData(buffer.subarray(0, bytesRead));
      }
    };
    const observe = () => {
      // One finite snapshot/read at a time. Slow I/O never creates an interval
      // queue, and ongoing background output cannot extend an in-flight read.
      if (stopped || reading || failure) return;
      reading = (async () => { await readTo((await file.stat()).size); })().catch(error => {
        failure = captureError(error); stopObserving(); abort();
      }).finally(() => { reading = undefined; });
    };
    try {
      if (options.signal?.aborted) throw new Error('aborted');
      // argv, environment, foreground shell and owned process group stay the
      // same. Both descriptors duplicate one open description, preserving the
      // order of writes while the parent reads with independent positions.
      child = spawn('/bin/bash', ['-c', command], { cwd, env: options.env ?? process.env, detached: false, stdio: ['ignore', file.fd, file.fd] });
      const completion = new Promise<number | null>((resolve, reject) => {
        onExit = code => { stopObserving(); resolve(code); };
        onError = error => { stopObserving(); reject(error); };
        child!.once('exit', onExit); child!.once('error', onError);
      });
      options.signal?.addEventListener('abort', abort, { once: true });
      if (options.signal?.aborted) abort();
      if (options.timeout !== undefined) timer = setTimeout(() => { timedOut = true; abort(); }, options.timeout * 1000);
      observer = setInterval(observe, 20); observer.unref();
      const code = await completion;
      await reading;
      if (failure) throw failure;
      try {
        // All foreground writes reached the kernel before exit. Read the
        // complete observed size, not pipe EOF; a background descendant may
        // still own stdout/stderr and may continue computing after this call.
        const limit = (await file.stat()).size;
        await readTo(limit);
      } catch (error) { throw captureError(error); }
      if (options.signal?.aborted) throw new Error('aborted');
      if (timedOut) throw new Error(`timeout:${options.timeout}`);
      return { exitCode: code ?? 1 };
    } finally {
      stopObserving(); options.signal?.removeEventListener('abort', abort);
      if (child && onExit) child.removeListener('exit', onExit);
      if (child && onError) child.removeListener('error', onError);
      await reading;
      try { await file.close(); }
      catch (error) { throw captureError(error); }
    }
  } };
}

// stdout/stderr are anonymous regular files rather than pipes. Programs may
// observe fstat/isatty/seek and buffering differences; this is not a claim of
// complete shell-environment equivalence. No output content is cached in Host.
export const groupedBashOperations = createProtectedBashOperations();
