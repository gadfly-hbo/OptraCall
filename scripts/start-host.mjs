import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { runtimeEnvironment, workspaceRoot } from './runtime-process.ts';

const entry = fileURLToPath(new URL('./host-entry.mjs', import.meta.url));
const child = spawn(process.execPath, [entry, ...process.argv.slice(2)], { cwd: workspaceRoot, env: runtimeEnvironment(), stdio: 'inherit' });
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
child.on('error', () => { process.stderr.write('OptraCall Host process could not start.\n'); process.exitCode = 1; });
child.on('exit', (code, signal) => { process.exitCode = code ?? (signal ? 1 : 0); });
