import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { runtimeEnvironment, workspaceRoot } from '../../scripts/runtime-process.ts';

export async function startTestHost(options: { timeoutMs?: number; uiPort?: number; dataRoot?: string; projectsRoot?: string } = {}) {
  const entry = fileURLToPath(new URL('../../scripts/host-entry.mjs', import.meta.url));
  const uiPort = options.uiPort ?? 4183;
  const scratch = await mkdtemp(path.join(os.tmpdir(), 'optracall-host-test-'));
  const dataRoot = options.dataRoot ?? path.join(scratch, 'host'), projectsRoot = options.projectsRoot ?? path.join(scratch, 'projects');
  const child = spawn(process.execPath, [entry, '--port=0', `--ui-port=${uiPort}`, `--connection-timeout-ms=${options.timeoutMs ?? 2000}`, `--data-root=${dataRoot}`, `--projects-root=${projectsRoot}`], { cwd: workspaceRoot, env: runtimeEnvironment(), stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '', stderr = '';
  child.stdout.on('data', chunk => { stdout += chunk.toString(); });
  child.stderr.on('data', chunk => { stderr += chunk.toString(); });
  const port = await new Promise<number>((resolve, reject) => {
    const timer = setTimeout(() => { child.kill('SIGTERM'); reject(new Error('Test Host startup timed out.')); }, 10_000);
    child.stdout.on('data', () => { for (const line of stdout.split('\n')) { try { const data = JSON.parse(line); if (data.kind === 'host-ready') { clearTimeout(timer); resolve(data.port); } } catch {} } });
    child.once('exit', code => { clearTimeout(timer); reject(new Error(`Test Host exited during startup (${code}): ${stderr}`)); });
  });
  const baseUrl = `http://127.0.0.1:${port}`;
  const headers = { 'content-type': 'application/json', 'x-optracall-client': '1', origin: `http://127.0.0.1:${uiPort}` };
  return {
    baseUrl, port, headers, scratch, dataRoot, projectsRoot,
    request: (route: string, method = 'GET', body?: unknown, signal?: AbortSignal) => fetch(baseUrl + route, { method, headers, ...(body !== undefined ? { body: JSON.stringify(body) } : {}), ...(signal ? { signal } : {}) }),
    output: () => ({ stdout, stderr }),
    close: async () => { if (child.exitCode !== null) return; child.kill('SIGTERM'); const [code] = await once(child, 'exit'); if (code !== 0) throw new Error(`Test Host shutdown failed (${code}): ${stderr}`); },
  };
}
