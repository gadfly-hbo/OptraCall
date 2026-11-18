import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline';
import { workspaceRoot } from './runtime-process.ts';

const uiPort = process.env.OPTRACALL_UI_PORT ?? '4173';
const hostPort = process.env.OPTRACALL_HOST_PORT ?? '4175';
const children = new Set();
let ending = false;
function stop() { if (ending) return; ending = true; for (const child of children) child.kill('SIGTERM'); }
function track(child) {
  children.add(child);
  child.on('error', () => { process.stderr.write('OptraCall development process could not start.\n'); process.exitCode = 1; stop(); });
  child.on('exit', code => { children.delete(child); if (!ending) { process.exitCode = code || 1; stop(); } });
  return child;
}
const host = track(spawn(process.execPath, [fileURLToPath(new URL('./start-host.mjs', import.meta.url)), `--port=${hostPort}`, `--ui-port=${uiPort}`], { cwd: workspaceRoot, stdio: ['ignore', 'pipe', 'inherit'] }));
host.stdout.pipe(process.stdout, { end: false });
const readiness = createInterface({ input: host.stdout });
readiness.on('line', function onReady(line) {
  let event;
  try { event = JSON.parse(line); } catch { return; }
  if (ending || event?.kind !== 'host-ready') return;
  readiness.off('line', onReady);
  track(spawn(process.execPath, [fileURLToPath(new URL('./frontend.mjs', import.meta.url)), 'dev', '--port', uiPort], {
    cwd: workspaceRoot, stdio: 'inherit', env: { ...process.env, OPTRACALL_HOST_PORT: String(event.port) },
  }));
});
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, stop);
