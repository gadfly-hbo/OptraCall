import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { startTestHost } from './host-process.ts';
import { startSyntheticProvider } from './synthetic-provider.ts';
import { workspaceRoot } from '../../scripts/runtime-process.ts';

const provider = await startSyntheticProvider();
const host = await startTestHost({ uiPort: 4183, timeoutMs: 2000 });
const vite = spawn(process.execPath, [fileURLToPath(new URL('../../node_modules/vite/bin/vite.js', import.meta.url)), '--host', '127.0.0.1', '--port', '4183', '--strictPort'], { cwd: workspaceRoot, env: { ...process.env, OPTRACALL_HOST_PORT: String(host.port) }, stdio: ['ignore', 'pipe', 'pipe'] });
let output = '', stopping = false, announced = false;
const close = async () => { if (stopping) return; stopping = true; vite.kill('SIGTERM'); await host.close(); await provider.close(); process.exit(0); };
vite.stdout.on('data', chunk => { output += chunk.toString(); if (!announced && output.includes('http://127.0.0.1:4183/')) { announced = true; process.stdout.write(`${JSON.stringify({ kind: 'qa-ready', uiUrl: 'http://127.0.0.1:4183/', providerUrl: provider.baseUrl, hostPort: host.port })}\n`); } });
vite.stderr.on('data', chunk => process.stderr.write(chunk));
vite.on('error', () => { process.exitCode = 1; void close(); });
vite.on('exit', () => { if (!stopping) { process.stderr.write('Isolated QA UI stopped.\n'); void close(); } });
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => { void close(); });
