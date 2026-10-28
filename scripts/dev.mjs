import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { workspaceRoot } from './runtime-process.ts';

const children = new Set();
let ending = false, uiStarted = false, output = '';
function stop() { if (ending) return; ending = true; for (const child of children) child.kill('SIGTERM'); }
function track(child) {
  children.add(child);
  child.on('error', () => { process.stderr.write('OptraCall development process could not start.\n'); process.exitCode = 1; stop(); });
  child.on('exit', code => { children.delete(child); if (!ending) { process.exitCode = code || 1; stop(); } });
  return child;
}
const host = track(spawn(process.execPath, [fileURLToPath(new URL('./start-host.mjs', import.meta.url))], { cwd: workspaceRoot, stdio: ['ignore', 'pipe', 'inherit'] }));
host.stdout.on('data', chunk => {
  process.stdout.write(chunk); output += chunk.toString();
  if (!uiStarted && output.split('\n').some(line => { try { return JSON.parse(line).kind === 'host-ready'; } catch { return false; } })) {
    uiStarted = true;
    track(spawn(process.execPath, [fileURLToPath(new URL('../node_modules/vite/bin/vite.js', import.meta.url)), '--host', '127.0.0.1', '--port', '4173', '--strictPort'], { cwd: workspaceRoot, env: { ...process.env, OPTRACALL_HOST_PORT: '4175' }, stdio: 'inherit' }));
  }
});
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, stop);
