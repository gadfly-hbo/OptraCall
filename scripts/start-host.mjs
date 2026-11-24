import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { runtimeEnvironment, workspaceRoot } from './runtime-process.ts';

const entry = fileURLToPath(new URL('./host-entry.mjs', import.meta.url));
const instanceArg = process.argv.slice(2).find(arg => arg.startsWith('--instance-id='))?.slice('--instance-id='.length);
const instanceId = instanceArg && /^[a-f0-9]{8}-[a-f0-9-]{27}$/.test(instanceArg) ? instanceArg : undefined;
const emit = (kind, fields = {}) => {
  try {
    process.stderr.write(`${JSON.stringify({ kind, at: new Date().toISOString(), wrapperPid: process.pid, ...(instanceId ? { instanceId } : {}), ...fields })}\n`);
  } catch {}
};
const child = spawn(process.execPath, [entry, ...process.argv.slice(2)], { cwd: workspaceRoot, env: runtimeEnvironment(), stdio: 'inherit' });
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => {
  emit('host-wrapper-signal', { signal, ...(child.pid ? { hostPid: child.pid } : {}) });
  child.kill(signal);
});
child.on('error', error => {
  const errorCode = error && typeof error === 'object' && 'code' in error ? String(error.code).replace(/[^A-Z0-9_]/gi, '').slice(0, 80) : undefined;
  emit('host-wrapper-error', { ...(errorCode ? { errorCode } : {}) });
  process.stderr.write('OptraCall Host process could not start.\n');
  process.exitCode = 1;
});
child.on('exit', (code, signal) => {
  emit('host-wrapper-exit', { ...(child.pid ? { hostPid: child.pid } : {}), exitCode: code, signal });
  process.exitCode = code ?? (signal ? 1 : 0);
});
