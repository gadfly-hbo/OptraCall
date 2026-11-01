import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { homedir } from 'node:os';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { existsSync, realpathSync, statSync } from 'node:fs';
import { StringDecoder } from 'node:string_decoder';
import { lstat, mkdir, mkdtemp, readdir, realpath, writeFile } from 'node:fs/promises';
import { createReadToolDefinition, createWriteToolDefinition, createEditToolDefinition, createBashToolDefinition, createGrepToolDefinition, createFindToolDefinition, createLsToolDefinition, createCodemodeExtension, type ExtensionAPI, type ToolDefinition } from './sdk.ts';

/** Host-minted execution inputs. They are never accepted from a tool call. */
export type ProtectedExecutionScope = { id: string; cwd: string; writableRoot: string; readRoots: readonly string[]; skillRoot?: string; profile?: 'ordinary' | 'protected'; writeRoots?: readonly string[] };
const within = (parent: string, target: string) => target === parent || (!path.relative(parent, target).startsWith('..' + path.sep) && !path.isAbsolute(path.relative(parent, target)) && path.relative(parent, target) !== '..');
const fail = (code: string): never => { throw new Error(code); };

async function plainTree(root: string, readOnly = false, allowMissingEntry = false): Promise<void> {
  let info;
  try { info = await lstat(root); }
  catch (error) { if (allowMissingEntry && (error as NodeJS.ErrnoException).code === 'ENOENT') return; throw error; }
  if (info.isSymbolicLink() || (!info.isDirectory() && (!info.isFile() || info.nlink !== 1))) fail(readOnly ? 'protected_unsafe_read_root' : 'protected_unsafe_workspace');
  if (info.isDirectory()) {
    if (!readOnly && ((info.mode & 0o022) !== 0 || (process.getuid && info.uid !== process.getuid()))) fail('protected_unsafe_workspace');
    // Task-owned parallel work may atomically rename a temporary entry while
    // it is being checked. An entry already gone exposes no alias; root loss
    // and every observed symlink/hardlink still fail closed.
    for (const name of await readdir(root)) await plainTree(path.join(root, name), readOnly, true);
  }
}

export async function createProtectedExecutionScope(input: ProtectedExecutionScope): Promise<ProtectedExecutionScope> {
  if (!input || typeof input.id !== 'string' || !/^[a-zA-Z0-9_./:-]{1,240}$/.test(input.id) || !path.isAbsolute(input.cwd) || !path.isAbsolute(input.writableRoot) || !Array.isArray(input.readRoots)) fail('protected_invalid_scope');
  if (input.profile !== undefined && !['ordinary', 'protected'].includes(input.profile) || input.writeRoots !== undefined && (!Array.isArray(input.writeRoots) || input.profile !== 'ordinary')) fail('protected_invalid_scope');
  for (const directory of [input.cwd, input.writableRoot, ...(input.skillRoot ? [input.skillRoot] : []), ...(input.writeRoots ?? [])]) {
    if (typeof directory !== 'string' || !path.isAbsolute(directory)) fail('protected_invalid_scope');
    const info = await lstat(directory);
    if (info.isSymbolicLink() || !info.isDirectory()) fail('protected_unsafe_workspace');
  }
  const root = await realpath(input.writableRoot), cwd = await realpath(input.cwd);
  const writes: string[] = [];
  for (const directory of input.writeRoots ?? []) {
    const resolved = await realpath(directory);
    if (resolved === path.parse(resolved).root) fail('protected_invalid_scope');
    await plainTree(directory); writes.push(resolved);
  }
  if (![root, ...writes].some(directory => within(directory, cwd)) || root === path.parse(root).root) fail('protected_invalid_scope');
  await plainTree(root);
  const reads: string[] = [];
  for (const entry of input.readRoots) {
    if (typeof entry !== 'string' || !path.isAbsolute(entry)) fail('protected_invalid_scope');
    // A hard link inside an otherwise approved directory could expose native or
    // credential bytes through an allowed path. Accept only unaliased materials.
    await plainTree(entry, true);
    reads.push(await realpath(entry));
  }
  let skillRoot: string | undefined;
  if (input.skillRoot) {
    skillRoot = await realpath(input.skillRoot);
    if ([root, ...writes].some(directory => within(directory, skillRoot!) || within(skillRoot!, directory))) fail('protected_invalid_skill_root');
    await plainTree(skillRoot);
  }
  return Object.freeze({ id: input.id, cwd, writableRoot: root, readRoots: Object.freeze([...new Set(reads)]), ...(skillRoot ? { skillRoot } : {}), ...(input.profile ? { profile: input.profile } : {}), ...(input.writeRoots ? { writeRoots: Object.freeze([...new Set(writes)]) } : {}) });
}

/** Only metadata creation happens in the trusted SDK process. */
export function protectedToolDefinitions(cwd: string): ToolDefinition<any, any>[] {
  const definitions: ToolDefinition<any, any>[] = [createReadToolDefinition(cwd), createWriteToolDefinition(cwd), createEditToolDefinition(cwd), createBashToolDefinition(cwd, { exposeSessionEnvironment: false, shellPath: '/bin/bash' }), createGrepToolDefinition(cwd), createFindToolDefinition(cwd), createLsToolDefinition(cwd)];
  // Keep the pinned SDK's codemode schema/loadout/renderers. Its execute callback
  // is replaced before registration; Agent code is never run in this process.
  const api = {
    registerTool: (definition: ToolDefinition<any, any>) => { definitions.push(definition); },
    getAllTools: () => definitions,
    getSettings: () => ({}),
    appendEntry: () => { throw new Error('protected_journal_write_unavailable'); },
  };
  createCodemodeExtension({ models: false, mode: 'on' })(api as unknown as ExtensionAPI);
  return definitions;
}

const executionPath = () => [...new Set([path.dirname(process.execPath), '/opt/homebrew/bin', '/usr/bin', '/bin', '/usr/sbin', '/sbin'])].join(':');
function programPath(command: string): string | undefined {
  return path.isAbsolute(command) ? command : spawnSync('/usr/bin/which', [command], { encoding: 'utf8', env: { PATH: executionPath(), HOME: process.env.HOME ?? homedir() } }).stdout?.trim() || undefined;
}
function runtimeRoots(codeRoot: string, interpreters: readonly string[]): string[] {
  const result = ['/System/Library', '/usr/lib', '/usr/share', '/usr/bin', '/usr/libexec', '/bin', '/sbin', '/Library/Apple', '/dev/null', '/dev/urandom', '/dev/random', path.join(codeRoot, 'node_modules'), path.join(codeRoot, 'src', 'agent'), path.join(codeRoot, 'scripts', 'protected-tool-entry.mjs'), path.join(codeRoot, 'scripts', 'protected-file-entry.mjs'), path.join(codeRoot, 'package.json')];
  const hostExecutable = realpathSync(process.execPath), privateLibraryRoot = path.resolve(path.dirname(hostExecutable), '..', 'lib');
  const visited = new Set<string>();
  const libraryRoots = (file: string) => {
    const resolved = realpathSync(file);
    if (visited.has(resolved)) return; visited.add(resolved);
    const match = resolved.match(/^(\/opt\/homebrew\/Cellar\/[^/]+\/[^/]+)(?:\/|$)/)
      // The selected Apple launcher resolves to a direct framework executable.
      // Read its versioned runtime, never the Developer directory or user home.
      ?? resolved.match(/^(\/Library\/Developer\/CommandLineTools\/Library\/Frameworks\/Python3\.framework\/Versions\/\d+\.\d+(?:\.\d+)?)(?:\/|$)/);
    result.push(match?.[1] ?? resolved);
    const lines = spawnSync('/usr/bin/otool', ['-L', resolved], { encoding: 'utf8' }).stdout?.split('\n') ?? [];
    for (const line of lines) {
      const dependency = line.trim().split(' (')[0];
      // Relocated app-private runtimes retain the same Mach-O dependency
      // identities. Grant each actual library file, not their parent directory.
      const relative = dependency.startsWith('@loader_path/') ? path.resolve(path.dirname(resolved), dependency.slice('@loader_path/'.length))
        : dependency.startsWith('@executable_path/') ? path.resolve(path.dirname(hostExecutable), dependency.slice('@executable_path/'.length)) : undefined;
      const library = relative && within(privateLibraryRoot, relative) ? relative : dependency.startsWith('/opt/homebrew/') ? dependency : undefined;
      if (library && existsSync(library)) libraryRoots(library);
    }
  };
  for (const command of [process.execPath, 'python3', 'python', 'rg', 'fd', 'fdfind', ...interpreters]) {
    const found = programPath(command);
    if (!found || !existsSync(found)) continue;
    libraryRoots(found);
  }
  const brewLib = '/opt/homebrew/lib';
  // Python's separately installed site packages are approved runtime libraries,
  // not the Homebrew configuration tree or the user's home directory.
  if (existsSync(brewLib)) {
    const listed = spawnSync('/bin/ls', ['-1', brewLib], { encoding: 'utf8' }).stdout?.split('\n') ?? [];
    for (const name of listed) if (/^python\d+(\.\d+)?$/.test(name)) result.push(path.join(brewLib, name));
  }
  return [...new Set(result.filter(existsSync).map(entry => realpathSync(entry)))];
}

function profileFor(scope: ProtectedExecutionScope, codeRoot: string, forbiddenRoots: readonly string[], executableRoot: string, interpreters: readonly string[]): string {
  const writes = [scope.writableRoot, ...(scope.writeRoots ?? [])];
  const reads = [...runtimeRoots(codeRoot, interpreters), ...scope.readRoots, ...writes, executableRoot, ...(scope.skillRoot ? [scope.skillRoot] : [])];
  const rule = (entry: string) => `(${statSync(entry).isDirectory() ? 'subpath' : 'literal'} ${JSON.stringify(entry)})`;
  return [
    '(version 1)', '(deny default)', '(allow file-read-metadata)', '(allow file-read* (literal "/") ' + reads.map(rule).join(' ') + ')',
    '(allow file-write* ' + writes.map(entry => '(subpath ' + JSON.stringify(entry) + ')').join(' ') + ' (literal "/dev/null"))',
    ...forbiddenRoots.map(entry => '(deny file-read-data file-write* (subpath ' + JSON.stringify(entry) + '))'),
    '(allow process-exec)', '(allow process-fork)', '(allow sysctl-read)', '(allow signal (target self) (target children) (target same-sandbox))',
    // A forked process must stay in this invocation's owned process group.
    // posix_spawn can change groups inside the kernel without entering either
    // setsid/setpgid syscall, so rejecting just those two is insufficient.
    // ENOSYS preserves the pinned libuv's normal fork/exec fallback.
    '(deny syscall-unix (syscall-number SYS_setsid SYS_setpgid))',
    '(deny syscall-unix (with errno ENOSYS) (syscall-number SYS_posix_spawn))',
  ].join('\n');
}

// Homebrew framework launchers require posix_spawn(SETEXEC), which is not
// available in this permission boundary. Preserve the installed interpreter and
// libraries through read-only aliases to the actual same-version executable.
// These are environment entrypoints, not new analysis or calculation tools.
async function executionBin(scope: ProtectedExecutionScope): Promise<{ directory: string; interpreters: { command: string; executable: string; version: string; fallbackAlias: boolean }[] }> {
  const directory = await mkdtemp(path.join(path.dirname(scope.writableRoot), '.protected-bin-'));
  const query = "import json,os,sys; framework=os.path.join(sys.prefix,'Resources','Python.app','Contents','MacOS','Python'); print(json.dumps({'executable':os.path.realpath(framework if os.path.isfile(framework) else sys.executable),'major':sys.version_info.major,'version':'.'.join(map(str,sys.version_info[:3]))}))";
  const interpreters: { command: string; executable: string; version: string; fallbackAlias: boolean }[] = [];
  let python3: { executable: string; version: string } | undefined;
  for (const name of ['python3', 'python']) {
    const program = programPath(name);
    if (!program && !(name === 'python' && python3)) continue;
    let executable = python3?.executable, version = python3?.version;
    if (program) {
      const observed = spawnSync(program, ['-I', '-S', '-c', query], { encoding: 'utf8', env: { PATH: executionPath(), HOME: process.env.HOME ?? homedir() }, timeout: 5000 });
      if (observed.status !== 0) fail('protected_python_runtime_unavailable');
      const parsed = JSON.parse(observed.stdout);
      if (typeof parsed.executable !== 'string' || !path.isAbsolute(parsed.executable) || !existsSync(parsed.executable) || parsed.major !== 3 || typeof parsed.version !== 'string') fail('protected_python_runtime_unavailable');
      executable = realpathSync(parsed.executable); version = parsed.version;
    }
    if (!executable || !version) continue;
    if (name === 'python3') python3 = { executable, version };
    interpreters.push({ command: name, executable, version, fallbackAlias: !program });
    const quote = (value: string) => "'" + value.replaceAll("'", "'\"'\"'") + "'";
    await writeFile(path.join(directory, name), '#!/bin/bash\nexport PYTHONEXECUTABLE=' + quote(executable) + '\nexec ' + quote(executable) + ' "$@"\n', { flag: 'wx', mode: 0o700 });
  }
  return { directory, interpreters };
}

function executionEnvironment(scope: ProtectedExecutionScope, executableRoot: string) {
  return { HOME: process.env.HOME ?? homedir(), PATH: executableRoot + ':' + executionPath(), TMPDIR: path.join(scope.writableRoot, '.tmp'), NODE_DISABLE_COMPILE_CACHE: '1', PI_CODING_AGENT_DIR: path.join(scope.writableRoot, '.pi'), PI_OFFLINE: '1', PYTHONDONTWRITEBYTECODE: '1', _PYTHON_SUBPROCESS_USE_POSIX_SPAWN: '0', XDG_CACHE_HOME: path.join(scope.writableRoot, '.cache'), OPENSSL_CONF: '/dev/null' };
}

function assertGroupPolicy(profile: string, scope: ProtectedExecutionScope, env: NodeJS.ProcessEnv) {
  // No child persists: successful escapes exit immediately and fail admission.
  // This detects unsupported Seatbelt filters and missing fork/exec fallback
  // before any model request can enter this execution profile.
  const python = `import errno,os,sys\npid=os.fork()\nif pid==0:\n for op in [os.setsid,lambda:os.setpgid(0,0)]:\n  try:op();os._exit(91)\n  except OSError as e:\n   if e.errno!=errno.EPERM:os._exit(92)\n os._exit(0)\n_,status=os.waitpid(pid,0)\nif status:sys.exit(93)\nfor attrs in [{},{'setsid':True},{'setpgroup':0}]:\n try:\n  pid=os.posix_spawn(sys.executable,[sys.executable,'-c','pass'],os.environ,**attrs);os.waitpid(pid,0);sys.exit(94)\n except OSError as e:\n  if e.errno!=errno.ENOSYS:sys.exit(95)\nprint('owned-group-policy')`;
  const probe = `const {spawnSync}=require('node:child_process');const r=spawnSync('/bin/bash',['-c',${JSON.stringify("python3 - <<'PY'\n" + python + "\nPY")}],{encoding:'utf8'});if(r.status!==0||r.stdout.trim()!=='owned-group-policy')process.exit(96);console.log('protected-policy-ready');`;
  const result = spawnSync('/usr/bin/sandbox-exec', ['-p', profile, process.execPath, '-e', probe], { cwd: scope.cwd, env, encoding: 'utf8', timeout: 10_000 });
  if (result.status !== 0 || result.stdout.trim() !== 'protected-policy-ready') fail('unsupported_protection');
}

function ownedGroupExists(pid: number): boolean {
  try { process.kill(-pid, 0); return true; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ESRCH') return false; throw new Error('protected_cleanup_unknown'); }
}

type PendingTool = {
  completion: Promise<any>;
  settle(error?: Error, value?: unknown): void;
  progress(value: unknown): void;
};
type ToolGroup = {
  id: string; child: ChildProcess; group?: number; closed: boolean; exited: Promise<void>;
  ready: Promise<void>; terminal: Promise<void>; pending: Map<string, PendingTool>;
  cleanup?: Promise<void>; cleanupError?: Error;
  send(kind: string, value?: Record<string, unknown>): void;
  cancel(): void; requestClose(): Promise<void>; requestDrain(): Promise<void>;
};

export async function createProtectedTools(input: { scope: ProtectedExecutionScope; codeRoot: string; forbiddenRoots: readonly string[] }) {
  const scope = await createProtectedExecutionScope(input.scope), codeRoot = await realpath(input.codeRoot);
  const forbidden = input.forbiddenRoots.map(entry => existsSync(entry) ? realpathSync(entry) : path.resolve(entry));
  for (const entry of [...scope.readRoots, scope.writableRoot, ...(scope.writeRoots ?? []), ...(scope.skillRoot ? [scope.skillRoot] : [])]) {
    if (forbidden.some(privateRoot => within(entry, privateRoot) || within(privateRoot, entry))) fail('protected_forbidden_read');
  }
  const immutableCode = ['src', 'scripts', 'node_modules', 'package.json'].map(entry => path.join(codeRoot, entry));
  for (const entry of [scope.writableRoot, ...(scope.writeRoots ?? [])]) {
    if (immutableCode.some(code => within(entry, code) || within(code, entry))) fail('protected_forbidden_write');
  }
  if (process.platform !== 'darwin' || !existsSync('/usr/bin/sandbox-exec')) fail('unsupported_protection');
  await mkdir(path.join(scope.writableRoot, '.tmp'), { recursive: true, mode: 0o700 });
  const unavailableTools = !programPath('fd') && !programPath('fdfind') ? [{ name: 'find', reason: 'fd/fdfind is not installed; protected execution does not download tools' }] : [];
  const definitions = protectedToolDefinitions(scope.cwd).filter(tool => !unavailableTools.some(item => item.name === tool.name));
  const toolNames = definitions.map(tool => tool.name);
  const executable = await executionBin(scope), executableRoot = executable.directory;
  const profile = profileFor(scope, codeRoot, forbidden, executableRoot, executable.interpreters.map(item => item.executable)), env = executionEnvironment(scope, executableRoot);
  assertGroupPolicy(profile, scope, env);
  const python = executable.interpreters.find(item => item.command === 'python3')?.executable ?? fail('protected_python_runtime_unavailable');
  const guardianProbe = spawnSync(python, ['-I', '-S', path.join(codeRoot, 'scripts', 'protected-tool-supervisor.py'), '--probe'], {
    cwd: scope.cwd, env: { ...env, PYTHONEXECUTABLE: python }, encoding: 'utf8', timeout: 5000,
  });
  if (guardianProbe.status !== 0 || guardianProbe.stdout.trim() !== 'protected-guardian-ready') fail('unsupported_protection');
  const active = new Map<string, ToolGroup>(), reserved = new Map<string, string | undefined>();
  const executing = new Set<Promise<any>>(), fileNames = new Set(['read', 'write', 'edit', 'ls']);
  let closed = false, draining = false, cleanupFailure: Error | undefined, files: ToolGroup | undefined;
  const unknown = () => new Error('protected_cleanup_unknown');
  const remove = (group: ToolGroup) => { for (const [id, value] of active) if (value === group) active.delete(id); };
  const cleanup = (group: ToolGroup, retry: boolean): Promise<void> => {
    if (retry && group.cleanupError) { group.cleanup = undefined; group.cleanupError = undefined; }
    return group.cleanup ??= group.requestClose().then(() => remove(group)).catch(error => {
      group.cleanupError = error instanceof Error ? error : unknown();
      cleanupFailure = group.cleanupError; throw group.cleanupError;
    });
  };
  const makeGroup = (id: string, shared: boolean, initial?: { name: string; params: unknown; pending: PendingTool }): ToolGroup => {
    const identity = { version: 2, scopeId: scope.id, nonce: randomUUID(), toolCallId: id };
    const child = spawn(python, ['-I', '-S', path.join(codeRoot, 'scripts', 'protected-tool-supervisor.py'), process.execPath,
      path.join(codeRoot, 'scripts', shared ? 'protected-file-entry.mjs' : 'protected-tool-entry.mjs'), profile, scope.cwd], {
      cwd: scope.cwd, detached: true, env: { ...env, PYTHONEXECUTABLE: python }, stdio: ['pipe', 'pipe', 'pipe'],
    });
    let readyAccept!: () => void, readyReject!: (error: Error) => void;
    let terminalAccept!: () => void, terminalReject!: (error: Error) => void;
    let closeAccept: (() => void) | undefined, closeReject: ((error: Error) => void) | undefined;
    let guardianReady = false, workerReady = !shared, releaseSent = false;
    let didExit = false, buffered = ''; const decoder = new StringDecoder('utf8');
    const ready = new Promise<void>((resolve, reject) => { readyAccept = resolve; readyReject = reject; });
    const terminal = new Promise<void>((resolve, reject) => { terminalAccept = resolve; terminalReject = reject; });
    void ready.catch(() => {}); void terminal.catch(() => {});
    const exited = new Promise<void>(resolve => { child.once('close', () => { didExit = true; resolve(); }); child.once('error', () => { didExit = true; resolve(); }); });
    const pending = new Map<string, PendingTool>();
    if (initial) pending.set(id, initial.pending);
    let group!: ToolGroup;
    const fault = (error: Error, retirementFailed = false) => {
      cleanupFailure = error; readyReject(error); terminalReject(error); closeReject?.(error);
      for (const call of pending.values()) call.settle(error);
      if (retirementFailed && !group.cleanupError) {
        group.cleanupError = error;
        // A natural retirement failure is already a failed cleanup attempt.
        // Automatic finally must observe it, not turn its first close into a retry.
        group.cleanup ??= Promise.reject(error); void group.cleanup.catch(() => {});
      }
    };
    const send = (kind: string, value: Record<string, unknown> = {}) => {
      if (group.closed) return;
      child.stdin!.write(JSON.stringify({ ...value, kind, ...identity }) + '\n', error => { if (error && !group.closed) fault(unknown()); });
    };
    group = { id, child, closed: false, exited, ready, terminal, pending, send,
      cancel: () => { readyReject(new Error('protected_executor_closed')); for (const call of [...pending.values()]) call.settle(new Error('aborted')); },
      requestClose: async () => {
        group.cancel();
        if (group.closed) { await exited; return; }
        if (didExit || child.exitCode !== null || child.signalCode !== null) {
          // Never signal a numeric PGID after losing its pinned guardian.
          if (group.group && !ownedGroupExists(group.group)) { group.closed = true; return; }
          throw unknown();
        }
        let timer: ReturnType<typeof setTimeout> | undefined;
        const acknowledged = new Promise<void>((resolve, reject) => {
          closeAccept = resolve; closeReject = reject;
          timer = setTimeout(() => reject(unknown()), 2500);
          send('protected.close');
        });
        try { await acknowledged; await exited; }
        finally { if (timer) clearTimeout(timer); closeAccept = undefined; closeReject = undefined; }
      },
      requestDrain: async () => {
        if (group.cleanupError) throw group.cleanupError;
        if (group.closed) { await exited; return; }
        if (!releaseSent) { releaseSent = true; send('protected.drain'); }
        await terminal;
      },
    };
    active.set(id, group);
    child.stdout!.on('data', data => {
      buffered += decoder.write(data);
      for (;;) {
        const end = buffered.indexOf('\n'); if (end < 0) break;
        const line = buffered.slice(0, end); buffered = buffered.slice(end + 1);
        if (line.length > 32 * 1024 * 1024) { fault(new Error('protected_invalid_tool_result')); continue; }
        let raw: any; try { raw = JSON.parse(line); } catch { fault(new Error('protected_invalid_tool_result')); continue; }
        if (!raw || raw.scopeId !== scope.id || raw.nonce !== identity.nonce || raw.toolCallId !== id) continue;
        if (raw.version !== 2) { fault(new Error('protected_protocol_version')); continue; }
        if (raw.kind === 'protected.ready' && Number.isSafeInteger(raw.processGroup) && raw.processGroup > 1) {
          if (group.group && group.group !== raw.processGroup) { fault(unknown()); continue; }
          group.group = raw.processGroup; guardianReady = true;
        }
        if (raw.kind === 'protected.worker-ready' && shared) workerReady = true;
        if (guardianReady && workerReady) readyAccept();
        if (raw.kind === 'protected.progress' || raw.kind === 'protected.result') {
          const callId = shared ? raw.callId : id;
          if (typeof callId !== 'string' || reserved.get(callId) !== id) { fault(new Error('protected_unowned_tool_result')); continue; }
          const call = pending.get(callId);
          // Lightweight admission tombstones reject replay without retaining
          // completed callbacks or result buffers. Cancelled/late data is not success.
          if (!call) continue;
          if (raw.kind === 'protected.progress') call.progress(raw.result);
          else if (raw.error) {
            const error = new Error(String(raw.error));
            // Only the trusted guardian may attach this fact. Arbitrary SDK
            // error text must remain an ordinary tool error for Agent handling.
            if (raw.executionUnknown === true) cleanupFailure ??= error;
            call.settle(error);
          }
          else if (!raw.result || !Array.isArray(raw.result.content)) {
            const error = new Error('protected_invalid_tool_result'); cleanupFailure ??= error;
            call.settle(error);
          }
          else call.settle(undefined, raw.result);
        }
        if (raw.kind === 'protected.closed' && raw.proof === 'group-esrch' && raw.processGroup === group.group) {
          group.closed = true; closeAccept?.(); readyReject(new Error('protected_executor_closed'));
          if (pending.size) {
            const error = new Error('protected_executor_result_unknown'); cleanupFailure ??= error;
            for (const call of [...pending.values()]) call.settle(error);
          }
          void exited.then(() => { terminalAccept(); remove(group); });
        }
        if (raw.kind === 'protected.cleanup-unknown') fault(new Error('protected_cleanup_unknown group=' + raw.processGroup + ' reason=' + String(raw.reason ?? 'unknown')), true);
      }
      if (buffered.length > 32 * 1024 * 1024) fault(new Error('protected_invalid_tool_result'));
    });
    child.stderr?.resume();
    child.stdin?.on('error', () => { if (!group.closed) fault(unknown()); });
    child.once('error', () => fault(new Error('protected_executor_start_failed'), true));
    child.once('close', () => { if (!group.closed) fault(unknown(), true); });
    // Always enqueue open/execute first, before a concurrent stop can enqueue close.
    send(shared ? 'protected.open' : 'protected.execute', shared ? { cwd: scope.cwd } : {
      tool: initial!.name, params: initial!.params, toolNames, cwd: scope.cwd, writableRoot: scope.writableRoot,
    });
    return group;
  };
  const pendingTool = (id: string, signal?: AbortSignal, onUpdate?: (value: any) => void) => {
    let resolve!: (value: any) => void, reject!: (error: Error) => void, settled = false;
    let group: ToolGroup | undefined;
    const completion = new Promise<any>((accept, refuse) => { resolve = accept; reject = refuse; });
    void completion.catch(() => {});
    const abort = () => {
      if (!group || settled) return;
      if (group === files) { group.send('protected.cancel', { callId: id }); call.settle(new Error('aborted')); }
      else void cleanup(group, false).then(() => call.settle(new Error('aborted')), error => call.settle(error));
    };
    const call: PendingTool = { completion,
      settle(error, value) {
        if (settled) return; settled = true;
        signal?.removeEventListener('abort', abort); group?.pending.delete(id);
        if (error) reject(error); else if (signal?.aborted) reject(new Error('aborted')); else resolve(value);
      }, progress(value) { if (!settled && !signal?.aborted) onUpdate?.(value); },
    };
    return { call, attach(value: ToolGroup) {
      group = value; value.pending.set(id, call); signal?.addEventListener('abort', abort, { once: true });
      if (signal?.aborted) abort();
    } };
  };
  const dispatch = async (name: string, id: string, params: unknown, signal?: AbortSignal, onUpdate?: (value: any) => void) => {
    if (cleanupFailure) throw cleanupFailure;
    if (closed) fail('protected_executor_closed');
    if (draining) fail('protected_executor_draining');
    if (!id || reserved.has(id)) fail('protected_duplicate_tool_call');
    if (signal?.aborted) throw new Error('aborted');
    reserved.set(id, undefined);
    // A failed admission is still reserved: the same SDK call ID cannot later
    // acquire execution by retrying under a different filesystem observation.
    for (const root of [scope.writableRoot, ...(scope.writeRoots ?? [])]) await plainTree(root);
    if (closed) fail('protected_executor_closed');
    if (draining) fail('protected_executor_draining');
    if (cleanupFailure) throw cleanupFailure;
    if (signal?.aborted) throw new Error('aborted');
    const ticket = pendingTool(id, signal, onUpdate);
    if (fileNames.has(name)) {
      files ??= makeGroup('files-' + randomUUID(), true);
      if (files.closed) throw cleanupFailure ?? new Error('protected_executor_closed');
      reserved.set(id, files.id); ticket.attach(files);
      try {
        await files.ready;
        if (closed || files.closed) throw new Error('protected_executor_closed');
        if (cleanupFailure) throw cleanupFailure;
        // A single-call cancellation may precede readiness; do not start it late.
        if (!signal?.aborted) files.send('protected.execute', { callId: id, tool: name, params });
      } catch (error) { ticket.call.settle(error instanceof Error ? error : unknown()); }
    } else {
      reserved.set(id, id);
      const group = makeGroup(id, false, { name, params, pending: ticket.call }); ticket.attach(group);
    }
    return ticket.call.completion;
  };
  const execute = (name: string, id: string, params: unknown, signal?: AbortSignal, onUpdate?: (value: any) => void) => {
    const task = dispatch(name, id, params, signal, onUpdate); executing.add(task);
    void task.finally(() => executing.delete(task)).catch(() => {}); return task;
  };
  const tools: ToolDefinition<any, any>[] = definitions.map(definition => ({ ...definition, execute: (id: string, params: unknown, signal: AbortSignal | undefined, onUpdate: ((value: any) => void) | undefined, _context?: unknown) => execute(definition.name, id, params, signal, onUpdate) }));
  return { scope, tools, unavailableTools, pythonRuntimes: executable.interpreters,
    // This is a technical execution receipt check, never an analysis/content
    // verdict. The SDK must not journal completed after losing a tool result.
    assertHealthy: () => { if (cleanupFailure) throw cleanupFailure; }, drain: async () => {
    if (closed) fail('protected_executor_closed');
    draining = true;
    await Promise.allSettled([...executing]);
    if (cleanupFailure) throw cleanupFailure;
    await Promise.all([...active.values()].map(group => group.requestDrain()));
    if (closed) fail('protected_executor_closed');
  }, close: async (options: { retryFailed?: boolean } = {}) => {
    closed = true;
    const results = await Promise.allSettled([...active.values()].map(group => cleanup(group, options.retryFailed !== false)));
    await Promise.allSettled([...executing]);
    if (results.some(result => result.status === 'rejected')) throw cleanupFailure ?? unknown();
    cleanupFailure = undefined;
  } };
}
