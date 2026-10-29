import fs from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import net from 'node:net';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';

const exec = promisify(execFile);
const rootDefault = fileURLToPath(new URL('../', import.meta.url));
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const messages = {
  port_in_use: 'OptraCall 端口被其它服务占用，请先确认该服务；没有停止其它进程。',
  operation_busy: 'OptraCall 正在启动、停止或更新，请稍后重试。',
  unsafe_control_file: 'OptraCall 本机启动记录无法安全读取，请保留记录并反馈。',
  instance_identity_mismatch: '启动记录与当前进程身份不一致；没有发送停止信号，请反馈检查。',
  another_installation: '已有其它 OptraCall 副本的启动记录，请先从原副本停止。',
  app_running: 'OptraCall 尚在运行，请先双击停止入口再更新。',
  build_required: '尚无有效的已构建前端，请先完成产品部署或更新。',
  build_checkout_mismatch: '当前源码与已构建产品版本不匹配，已停止启动。请使用更新入口完成安装与构建；旧构建和数据均已保留。',
  startup_failed: 'OptraCall 未能正常启动，请查看启动日志并反馈。',
  stop_timeout: 'OptraCall 未在正常退出时限内结束，启动记录和日志已保留。',
  runtime_required: 'OptraCall 需要 Node.js 25 或更新版本。',
  trial_checkout_required: '更新入口需要独立的产品 clone，请反馈部署问题。',
  trial_branch_not_main: '产品副本不在 main 分支，已停止更新；请反馈检查。',
  trial_checkout_dirty: '产品副本中有本地改动，已停止操作并保留现场；请反馈检查。',
  trial_origin_mismatch: '产品副本的远端地址不符合发布来源，已停止更新。',
  trial_git_operation_in_progress: '产品副本存在未完成的 Git 操作，已停止更新并保留现场。',
  trial_local_ahead_or_diverged: '产品副本与远端 main 无法安全快进，已停止更新并保留现场。',
  trial_ci_not_passed: '最新 main 的发布检查尚未通过，请稍后重试更新。',
  trial_ci_unavailable: '暂时无法核对 GitHub 发布检查，请稍后重试更新。',
  trial_fetch_failed: '无法读取 GitHub 最新 main，请检查网络后重试。',
  trial_install_failed: '运行依赖安装未完成，现场已保留；请重试更新或反馈。',
  trial_build_failed: '产品构建未完成，现场已保留；请重试更新或反馈。',
  trial_checkout_changed: '更新期间产品副本发生变化，已停止操作并保留现场。',
  trial_fast_forward_failed: '产品副本无法安全快进，已停止更新并保留现场。',
};
export class TrialLauncherError extends Error {
  constructor(code) { super(messages[code] ?? code); this.code = code; }
}
const fail = code => { throw new TrialLauncherError(code); };

export function trialOptions(input = {}) {
  const home = input.home ?? os.homedir();
  const dataRoot = path.resolve(input.dataRoot ?? path.join(home, '.optracall'));
  const options = { root: path.resolve(input.root ?? rootDefault), dataRoot, projectsRoot: path.resolve(input.projectsRoot ?? path.join(home, 'OptraCallProjects')), stateRoot: path.resolve(input.stateRoot ?? path.join(dataRoot, 'trial')), uiRoot: input.uiRoot, port: input.port ?? 4173, nodePath: input.nodePath ?? process.execPath, openBrowser: input.openBrowser ?? true, startupTimeoutMs: input.startupTimeoutMs ?? 30_000, stopTimeoutMs: input.stopTimeoutMs ?? 12_000, lockTimeoutMs: input.lockTimeoutMs ?? 35_000 };
  options.uiRoot = path.resolve(options.uiRoot ?? path.join(options.root, 'dist'));
  if (!Number.isInteger(options.port) || options.port < 1 || options.port > 65535) throw new TypeError('Invalid OptraCall trial port.');
  return options;
}
async function directory(value) {
  await fs.mkdir(value, { recursive: true, mode: 0o700 });
  const stat = await fs.lstat(value); if (!stat.isDirectory() || stat.isSymbolicLink()) fail('unsafe_control_file');
  await fs.chmod(value, 0o700);
}
async function readControl(file) {
  for (let attempt = 0; attempt < 8; attempt++) {
    let handle;
    try {
      handle = await fs.open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
      const stat = await handle.stat(); if (!stat.isFile() || stat.nlink > 1 || stat.size > 65_536) fail('unsafe_control_file');
      if (stat.nlink === 0) continue;
      return { value: JSON.parse(await handle.readFile('utf8')), stat };
    } catch (error) { if (error.code === 'ENOENT') return null; if (error instanceof TrialLauncherError) throw error; fail('unsafe_control_file'); }
    finally { await handle?.close(); }
  }
  fail('unsafe_control_file');
}
async function writeControl(file, value) {
  const temp = path.join(path.dirname(file), `.${path.basename(file)}-${randomUUID()}`);
  const handle = await fs.open(temp, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600);
  try { await handle.writeFile(JSON.stringify(value) + '\n'); await handle.sync(); } finally { await handle.close(); }
  try { const old = await readControl(file); if (old && (!old.stat.isFile() || old.stat.nlink !== 1)) fail('unsafe_control_file'); await fs.rename(temp, file); }
  catch (error) { await fs.unlink(temp).catch(() => {}); throw error; }
}
function alive(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; } catch (error) { if (error.code === 'ESRCH') return false; throw error; }
}
async function recoverDeadLock(file) {
  // Serialize stale-owner recovery separately. A second reclaimer must never
  // unlink a fresh owner's lock after checking the old inode.
  const recovery = file + '.recovery';
  try { await fs.mkdir(recovery, { mode: 0o700 }); }
  catch (error) { if (error.code === 'EEXIST') return; throw error; }
  try {
    let current;
    try { current = await readControl(file); }
    catch (error) { if (error.code === 'unsafe_control_file') return; throw error; }
    if (current && Number.isSafeInteger(current.value.pid) && typeof current.value.token === 'string' && !alive(current.value.pid)) await fs.unlink(file);
  } finally { await fs.rmdir(recovery); }
}
export async function withTrialOperationLock(input, operation) {
  const options = trialOptions(input); await directory(options.stateRoot);
  const file = path.join(options.stateRoot, 'operation.lock'), token = randomUUID(), deadline = Date.now() + options.lockTimeoutMs;
  for (;;) {
    try {
      const handle = await fs.open(file, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600);
      try { await handle.writeFile(JSON.stringify({ pid: process.pid, token })); await handle.sync(); } finally { await handle.close(); }
      break;
    } catch (error) { if (error.code !== 'EEXIST') throw error; }
    let old;
    try { old = await readControl(file); }
    catch (error) {
      const stat = await fs.lstat(file).catch(() => null);
      // Another opener can observe the short interval between O_EXCL and the
      // first owner write. Wait briefly; never remove a live/unknown owner.
      if (error.code === 'unsafe_control_file' && stat?.isFile() && !stat.isSymbolicLink() && stat.nlink === 1 && stat.size <= 4096 && Date.now() - stat.mtimeMs < 1000 && Date.now() < deadline) { await sleep(30); continue; }
      throw error;
    }
    if (!old) continue;
    if (!Number.isSafeInteger(old.value.pid) || typeof old.value.token !== 'string') fail('unsafe_control_file');
    if (!alive(old.value.pid)) {
      await recoverDeadLock(file);
      if (Date.now() > deadline) fail('operation_busy');
      await sleep(30);
      continue;
    }
    if (Date.now() > deadline) fail('operation_busy'); await sleep(30);
  }
  try { return await operation(options); }
  finally { const current = await readControl(file); if (current?.value.pid === process.pid && current?.value.token === token) await fs.unlink(file); }
}
async function assertPortAvailable(port) {
  const probe = net.createServer();
  await new Promise((resolve, reject) => { probe.once('error', error => reject(error.code === 'EADDRINUSE' ? new TrialLauncherError('port_in_use') : error)); probe.listen(port, '127.0.0.1', resolve); });
  await new Promise(resolve => probe.close(resolve));
}
async function health(port) {
  try { const response = await fetch(`http://127.0.0.1:${port}/api/health`, { signal: AbortSignal.timeout(700), cache: 'no-store' }); return response.ok ? await response.json() : null; }
  catch { return null; }
}
async function commandMatches(pid, options, instanceId, kind) {
  if (!alive(pid)) return false;
  try {
    const { stdout } = await exec('ps', ['-p', String(pid), '-o', 'command=']);
    return stdout.includes(path.join(options.root, 'scripts', kind)) && stdout.includes(`--instance-id=${instanceId}`);
  } catch { return false; }
}
async function currentInstance(options) {
  const saved = await readControl(path.join(options.stateRoot, 'instance.json')); if (!saved) return null;
  const value = saved.value;
  if (value.schema !== 1 || typeof value.instanceId !== 'string' || !Number.isSafeInteger(value.pid) || !Number.isSafeInteger(value.hostPid) || value.port !== options.port) fail('unsafe_control_file');
  if (value.root !== options.root) fail('another_installation');
  const wrapperAlive = alive(value.pid), hostAlive = alive(value.hostPid);
  if (!wrapperAlive && !hostAlive) return { saved, active: false };
  const wrapperOwned = wrapperAlive && await commandMatches(value.pid, options, value.instanceId, 'start-host.mjs');
  const hostOwned = hostAlive && (value.hostPid === value.pid ? wrapperOwned : await commandMatches(value.hostPid, options, value.instanceId, 'host-entry.mjs'));
  if ((wrapperAlive && !wrapperOwned) || (hostAlive && !hostOwned)) fail('instance_identity_mismatch');
  const status = await health(value.port);
  if (status && (status.runtime?.instanceId !== value.instanceId || status.runtime?.codeRoot !== options.root || status.runtime?.pid !== value.hostPid)) fail('instance_identity_mismatch');
  return { saved, active: true, wrapperOwned, hostOwned, health: status };
}
async function removeInstance(options, instanceId) {
  const file = path.join(options.stateRoot, 'instance.json'), current = await readControl(file);
  if (current?.value.instanceId === instanceId) await fs.unlink(file);
}
function resultFor(record, runtime, status) { return { status, pid: record.pid, hostPid: record.hostPid, instanceId: record.instanceId, url: record.url, logFile: record.logFile, runtime }; }
async function showBrowser(options, url) {
  if (!options.openBrowser) return;
  if (process.platform !== 'darwin') return;
  await exec('/usr/bin/open', [url]).catch(() => {});
}
async function assertBuildCheckout(options, build) {
  // Trial entrypoints run a committed product, not an unbuilt development tree.
  // In particular, a failed post-fast-forward build must not reuse an old dist.
  const dotGit = await fs.lstat(path.join(options.root, '.git')).catch(() => null);
  if (!dotGit?.isDirectory() || dotGit.isSymbolicLink()) fail('trial_checkout_required');
  const env = {};
  for (const key of ['PATH', 'HOME', 'USER', 'LOGNAME', 'TMPDIR', 'LANG', 'LC_ALL', 'LC_CTYPE', 'TZ', 'SYSTEMROOT']) if (process.env[key]) env[key] = process.env[key];
  async function git(args) {
    try { return (await exec('git', ['-c', 'core.hooksPath=/dev/null', '-c', 'core.fsmonitor=false', ...args], { cwd: options.root, env, timeout: 10_000, maxBuffer: 4 * 1024 * 1024 })).stdout.trim(); }
    catch { fail('trial_checkout_required'); }
  }
  const [top, realRoot] = await Promise.all([git(['rev-parse', '--show-toplevel']), fs.realpath(options.root)]);
  if (top !== realRoot) fail('trial_checkout_required');
  const [commit, tree, status, pkg] = await Promise.all([git(['rev-parse', 'HEAD']), git(['rev-parse', 'HEAD^{tree}']), git(['status', '--porcelain=v1', '--untracked-files=all']), fs.readFile(path.join(options.root, 'package.json'), 'utf8').then(JSON.parse).catch(() => null)]);
  if (status) fail('trial_checkout_dirty');
  if (build.dirty !== false || commit !== build.commit || tree !== build.tree || pkg?.version !== build.version) fail('build_checkout_mismatch');
}
async function startUnlocked(options) {
  if (Number(process.versions.node.split('.')[0]) < 25) fail('runtime_required');
  const previous = await currentInstance(options);
  if (previous?.active) {
    if (!previous.health?.runtime) fail('startup_failed');
    await showBrowser(options, previous.saved.value.url); return resultFor(previous.saved.value, previous.health.runtime, 'already-running');
  }
  await assertPortAvailable(options.port);
  if (previous) await removeInstance(options, previous.saved.value.instanceId);
  let build;
  try { build = JSON.parse(await fs.readFile(path.join(options.uiRoot, 'optracall-build.json'), 'utf8')); } catch { fail('build_required'); }
  if (build.schema !== 1 || typeof build.version !== 'string' || !/^[a-f0-9]{40}$/.test(build.commit) || typeof build.builtAt !== 'string') fail('build_required');
  await assertBuildCheckout(options, build);
  await directory(path.join(options.stateRoot, 'logs'));
  const instanceId = randomUUID(), url = `http://127.0.0.1:${options.port}/`, logFile = path.join(options.stateRoot, 'logs', `${new Date().toISOString().replace(/[:.]/g, '-')}-${instanceId}.log`);
  const log = await fs.open(logFile, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, 0o600);
  let child;
  try { child = spawn(options.nodePath, [path.join(options.root, 'scripts/start-host.mjs'), `--port=${options.port}`, `--ui-port=${options.port}`, `--data-root=${options.dataRoot}`, `--projects-root=${options.projectsRoot}`, `--ui-root=${options.uiRoot}`, `--instance-id=${instanceId}`], { cwd: options.root, detached: true, stdio: ['ignore', log.fd, log.fd], env: process.env }); }
  finally { await log.close(); }
  let spawnError; child.once('error', error => { spawnError = error; }); child.unref();
  const deadline = Date.now() + options.startupTimeoutMs; let status;
  while (Date.now() < deadline) {
    if (spawnError || child.exitCode !== null || child.signalCode !== null) break;
    status = await health(options.port);
    if (status?.runtime?.instanceId === instanceId && status.runtime.codeRoot === options.root) break;
    await sleep(50);
  }
  if (status?.runtime?.instanceId !== instanceId || status.runtime.codeRoot !== options.root || !Number.isSafeInteger(status.runtime.pid)) {
    if (child.pid && await commandMatches(child.pid, options, instanceId, 'start-host.mjs')) child.kill('SIGTERM');
    fail('startup_failed');
  }
  const record = { schema: 1, pid: child.pid, hostPid: status.runtime.pid, instanceId, root: options.root, port: options.port, url, logFile, startedAt: new Date().toISOString(), runtime: status.runtime };
  await writeControl(path.join(options.stateRoot, 'instance.json'), record);
  await showBrowser(options, url); return resultFor(record, status.runtime, 'started');
}
export async function startTrial(input = {}) { return withTrialOperationLock(input, startUnlocked); }
export async function stopTrial(input = {}) {
  return withTrialOperationLock(input, async options => {
    const current = await currentInstance(options);
    if (!current) return { status: 'not-running' };
    const record = current.saved.value;
    if (!current.active) { await removeInstance(options, record.instanceId); return { status: 'not-running' }; }
    process.kill(current.wrapperOwned ? record.pid : record.hostPid, 'SIGTERM');
    const deadline = Date.now() + options.stopTimeoutMs;
    while (Date.now() < deadline) {
      const wrapper = await commandMatches(record.pid, options, record.instanceId, 'start-host.mjs');
      const host = record.hostPid === record.pid ? wrapper : await commandMatches(record.hostPid, options, record.instanceId, 'host-entry.mjs');
      const status = await health(record.port);
      if (!wrapper && !host && status?.runtime?.instanceId !== record.instanceId) { await removeInstance(options, record.instanceId); return { status: 'stopped', instanceId: record.instanceId }; }
      await sleep(50);
    }
    fail('stop_timeout');
  });
}
export async function assertTrialStopped(input = {}) {
  const options = trialOptions(input), current = await currentInstance(options); if (current?.active) fail('app_running');
  await assertPortAvailable(options.port);
}
export async function updateAndStartTrial(input = {}) {
  const update = await withTrialOperationLock(input, async options => {
    const { updateTrialCheckout } = await import(pathToFileURL(path.join(options.root, 'scripts/trial-update.mjs')).href);
    return updateTrialCheckout({ root: options.root, assertStopped: () => assertTrialStopped(options) });
  });
  // Read the newly installed launcher only after releasing the update lock.
  const options = trialOptions(input), args = cliArguments('start', options); const { stdout } = await exec(options.nodePath, args, { cwd: options.root, env: process.env, maxBuffer: 1_048_576 });
  const started = JSON.parse(stdout.trim()); return { ...started, update };
}
function cliArguments(command, options) {
  return [path.join(options.root, 'scripts/trial-launcher.mjs'), command, '--json', `--root=${options.root}`, `--state-root=${options.stateRoot}`, `--data-root=${options.dataRoot}`, `--projects-root=${options.projectsRoot}`, `--ui-root=${options.uiRoot}`, `--port=${options.port}`, ...(options.openBrowser ? [] : ['--no-open'])];
}
async function main() {
  const [command, ...args] = process.argv.slice(2), values = new Map();
  for (const arg of args) { const index = arg.indexOf('='); const name = index < 0 ? arg : arg.slice(0, index); if (!['--root', '--state-root', '--data-root', '--projects-root', '--ui-root', '--port', '--no-open', '--json'].includes(name)) throw new Error('Unknown trial argument.'); values.set(name, index < 0 ? true : arg.slice(index + 1)); }
  const options = { root: values.get('--root'), stateRoot: values.get('--state-root'), dataRoot: values.get('--data-root'), projectsRoot: values.get('--projects-root'), uiRoot: values.get('--ui-root'), port: values.has('--port') ? Number(values.get('--port')) : undefined, openBrowser: !values.has('--no-open') };
  const action = { start: startTrial, stop: stopTrial, update: updateAndStartTrial }[command]; if (!action) throw new Error('Use start, stop or update.');
  const result = await action(options);
  if (values.has('--json')) console.log(JSON.stringify(result));
  else if (result.status === 'stopped' || result.status === 'not-running') console.log('OptraCall 已停止。');
  else console.log(`OptraCall ${result.runtime.version} · ${result.runtime.commit.slice(0, 12)}${result.runtime.dirty ? '（本地构建）' : ''}\n${result.url}\n日志：${result.logFile}`);
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => { console.error(messages[error?.code] ?? 'OptraCall 操作未完成，请保留日志并反馈。'); process.exitCode = 1; });
