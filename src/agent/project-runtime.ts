import { spawn, type ChildProcess } from 'node:child_process';
import { mkdir, open } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { RuntimeModelConfiguration } from '../host/config-store.ts';
import { runtimeEnvironment } from '../../scripts/runtime-process.ts';

export type ProjectAgentOptions = { projectId: string; projectDirectory: string; sessionDirectory: string; sessionFile?: string; draft?: string; codeRoot: string; resourceRoot: string; configuration: Readonly<RuntimeModelConfiguration>; managementPorts: number[]; metricIndexText?: string };
export type BrowserUIRequest = { id: string; method: 'select' | 'confirm' | 'input' | 'editor'; title: string; message?: string; options?: string[]; placeholder?: string; prefill?: string };
export type ProjectSnapshot = { sessionId: string; sessionFile?: string; messages: Record<string, any>[]; tools: string[]; status: 'idle' | 'running'; sdkVersion: string; capabilities: Record<string, unknown>; lastRun?: { requestId: string; outcome?: 'completed' | 'cancelled' | 'failed' }; uiRequests?: BrowserUIRequest[] };
export type ProjectEvent = { type: 'snapshot'; snapshot: ProjectSnapshot } | { type: 'text.delta'; text: string; requestId: string } | { type: 'native'; event: Record<string, any>; requestId?: string } | { type: 'run.settled'; outcome: 'completed' | 'cancelled' | 'failed'; requestId: string; error?: string } | { type: 'run.accepted'; requestId: string; sessionFile?: string } | { type: 'ui.request'; request: BrowserUIRequest; requestId?: string } | { type: 'ui.dismiss'; id: string } | { type: 'ui.notification'; message: string; level?: string } | { type: 'ui.status'; key: string; text?: string } | { type: 'ui.editor'; text: string };
export class ProjectRuntimeError extends Error {
  readonly code: string;
  constructor(code: string) { super(code); this.code = code; }
}

// This adapter only transports SDK calls and events. It never chooses analysis
// steps, parses business data, or implements an agent/tool loop.
export class ProjectAgent {
  #options: ProjectAgentOptions;
  #child?: ChildProcess;
  #opening?: Promise<ProjectSnapshot>;
  #snapshot?: ProjectSnapshot;
  #pending = new Map<string, { resolve: (value: any) => void; reject: (error: Error) => void }>();
  #listeners = new Set<(event: ProjectEvent) => void>();
  #running?: { id: string; completion: Promise<any> };
  #accepted = new Map<string, { resolve: () => void; reject: (error: Error) => void }>();
  #questions = new Map<string, Extract<ProjectEvent, { type: 'ui.request' }>>();
  #closed = false;
  #editorReady = false;
  #closeTask?: Promise<void>;
  constructor(options: ProjectAgentOptions) { this.#options = options; }
  get busy() { return Boolean(this.#running); }
  get alive() { return !this.#closed && Boolean(this.#child?.connected) && this.#child?.exitCode === null && this.#child?.signalCode === null; }
  get pendingUI() { return [...this.#questions.values()]; }
  subscribe(listener: (event: ProjectEvent) => void) { this.#listeners.add(listener); return () => { this.#listeners.delete(listener); }; }
  #emit(event: ProjectEvent) { for (const listener of this.#listeners) listener(event); }
  #rpc(method: string, input?: unknown): Promise<any> {
    if (!this.#child?.connected) return Promise.reject(new ProjectRuntimeError('runtime_unavailable'));
    const id = randomUUID();
    return new Promise((resolve, reject) => {
      this.#pending.set(id, { resolve, reject });
      this.#child!.send({ kind: 'request', id, method, input }, error => { if (error) { this.#pending.delete(id); reject(new ProjectRuntimeError('runtime_unavailable')); } });
    });
  }
  open(): Promise<ProjectSnapshot> {
    if (this.#closed) return Promise.reject(new ProjectRuntimeError('runtime_closed'));
    if (!this.#opening) this.#opening = this.#open();
    return this.#opening;
  }
  async #open(): Promise<ProjectSnapshot> {
    const o = this.#options;
    await mkdir(o.resourceRoot, { recursive: true, mode: 0o700 });
    await mkdir(o.sessionDirectory, { recursive: true, mode: 0o700 });
    const temp = path.join(o.projectDirectory, '020_clean', '.tmp');
    await mkdir(temp, { recursive: true, mode: 0o700 });
    if (this.#closed) throw new ProjectRuntimeError('runtime_closed');
    const child = spawn(process.execPath, [path.join(o.codeRoot, 'scripts/project-entry.mjs')], { cwd: path.join(o.projectDirectory, '020_clean'), env: { ...runtimeEnvironment(), PI_CODING_AGENT_DIR: o.resourceRoot, TMPDIR: temp }, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
    this.#child = child;
    // Provider and extension output is not a log transport. In particular it
    // cannot bypass secret masking through stderr or stdout.
    child.stdout?.resume();
    let startupDiagnostic = '';
    const startupOutput = (chunk: Buffer) => { startupDiagnostic = (startupDiagnostic + chunk.toString()).slice(-2000); };
    child.stderr?.on('data', startupOutput);
    child.on('message', (raw: any) => {
      if (raw?.kind === 'reply') {
        const pending = this.#pending.get(raw.id); if (!pending) return;
        this.#pending.delete(raw.id);
        if (raw.error) { const error = new ProjectRuntimeError(raw.error); error.cause = raw.detail; pending.reject(error); } else pending.resolve(raw.result);
      }
      if (raw?.kind === 'event') {
        if (raw.event?.type === 'snapshot') this.#snapshot = raw.event.snapshot;
        if (raw.event?.type === 'ui.request') this.#questions.set(raw.event.request.id, raw.event);
        if (raw.event?.type === 'ui.dismiss') this.#questions.delete(raw.event.id);
        if (raw.event?.type === 'run.accepted') {
          const ticket = this.#accepted.get(raw.event.requestId);
          const file = raw.event.sessionFile;
          const relative = typeof file === 'string' ? path.relative(this.#options.sessionDirectory, file) : '..';
          if (!file || relative.startsWith('..') || path.isAbsolute(relative)) ticket?.reject(new ProjectRuntimeError('session_persistence_failed'));
          else void (async () => { const handle = await open(file, 'r'); try { await handle.sync(); } finally { await handle.close(); } })().then(() => ticket?.resolve(), () => { ticket?.reject(new ProjectRuntimeError('session_persistence_failed')); void this.stop().catch(() => {}); });
        }
        this.#emit(raw.event);
      }
    });
    const fail = () => { for (const p of this.#pending.values()) p.reject(new ProjectRuntimeError('runtime_process_stopped')); this.#pending.clear(); for (const p of this.#accepted.values()) p.reject(new ProjectRuntimeError('runtime_process_stopped')); this.#accepted.clear(); for (const id of this.#questions.keys()) this.#emit({ type: 'ui.dismiss', id }); this.#questions.clear(); };
    child.on('error', fail); child.on('exit', fail);
    const ready = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => { child.kill('SIGTERM'); reject(new ProjectRuntimeError('runtime_start_timeout')); }, 30_000);
      child.once('exit', () => { clearTimeout(timer); const error = new ProjectRuntimeError('runtime_start_failed'); error.cause = startupDiagnostic; reject(error); });
      child.on('message', (message: any) => { if (message?.kind === 'ready') { clearTimeout(timer); child.stderr?.off('data', startupOutput); child.stderr?.resume(); startupDiagnostic = ''; resolve(); } });
    });
    await ready;
    this.#editorReady = true;
    this.#snapshot = await this.#rpc('open', o);
    return this.#snapshot!;
  }
  async snapshot(): Promise<ProjectSnapshot> { await this.open(); this.#snapshot = await this.#rpc('snapshot'); return this.#snapshot!; }
  #execute(method: 'prompt' | 'command', text: string, requestId: string) {
    if (this.#running) throw new ProjectRuntimeError('session_busy');
    if (!text.trim() || text.length > 20_000) throw new ProjectRuntimeError('invalid_message');
    const accepted = new Promise<void>((resolve, reject) => { this.#accepted.set(requestId, { resolve, reject }); });
    void accepted.catch(() => {});
    const completion = this.open().then(() => this.#rpc(method, { text, requestId })).catch(error => { this.#accepted.get(requestId)?.reject(error); throw error; }).finally(() => { this.#running = undefined; this.#accepted.delete(requestId); });
    this.#running = { id: requestId, completion };
    return { requestId, completion, accepted };
  }
  start(text: string, requestId: string) { return this.#execute('prompt', text, requestId); }
  async stop() { if (!this.#running) return; await this.open(); await this.#rpc('stop'); await this.#running?.completion; }
  async command(text: string, requestId: string = randomUUID()) { const run = this.#execute('command', text, requestId); const [result] = await Promise.all([run.completion, run.accepted]); return result; }
  respondUI(input: { id: string; value?: string | boolean; cancelled?: boolean }) { return this.#rpc('ui-response', input); }
  setEditorState(text: string) { this.#options.draft = text; return this.#editorReady ? this.#rpc('editor-state', { text }) : Promise.resolve(); }
  close(): Promise<void> { if (!this.#closeTask) { this.#closed = true; this.#closeTask = this.#dispose(); } return this.#closeTask; }
  async #dispose() {
    if (!this.#child) return;
    const child = this.#child;
    if (child.exitCode === null && child.signalCode === null) {
      let deadline: ReturnType<typeof setTimeout> | undefined;
      await Promise.race([this.#rpc('close').catch(() => {}), new Promise<void>(resolve => { deadline = setTimeout(() => { child.kill('SIGTERM'); resolve(); }, 3000); })]);
      if (deadline) clearTimeout(deadline);
    }
    // A signal exit has exitCode=null too. Do not wait for an event that already
    // happened when the terminal process group interrupted the native runtime.
    if (child.exitCode === null && child.signalCode === null) await new Promise<void>(resolve => {
      const timer = setTimeout(() => { child.kill('SIGKILL'); }, 1000);
      child.once('exit', () => { clearTimeout(timer); resolve(); });
    });
    this.#listeners.clear();
  }
}
