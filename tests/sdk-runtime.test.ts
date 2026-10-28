import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { runtimeArguments, runtimeEnvironment, workspaceRoot } from '../scripts/runtime-process.ts';
import { startSyntheticProvider } from './fixtures/synthetic-provider.ts';

async function probe(name: string, baseUrl: string): Promise<Record<string, unknown>> {
  const entry = fileURLToPath(new URL('./fixtures/runtime-cases.mjs', import.meta.url));
  const fixtureDirectory = fileURLToPath(new URL('./fixtures/', import.meta.url));
  const child = spawn(process.execPath, [...runtimeArguments(entry, [fixtureDirectory]), name, baseUrl], { cwd: workspaceRoot, env: runtimeEnvironment(), stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '', stderr = '';
  child.stdout.on('data', chunk => { stdout += chunk.toString(); }); child.stderr.on('data', chunk => { stderr += chunk.toString(); });
  return new Promise((resolve, reject) => { const timer = setTimeout(() => { child.kill('SIGTERM'); reject(new Error('Synthetic SDK probe timed out.')); }, 10_000); child.on('error', reject); child.on('exit', code => { clearTimeout(timer); if (code !== 0) { reject(new Error(`Synthetic SDK probe failed (${code}): ${stderr}`)); return; } resolve(JSON.parse(stdout.trim().split('\n').at(-1)!)); }); });
}

test('RUN-01: stop immediately after start cancels before sending any provider request', async t => {
  const provider = await startSyntheticProvider(); t.after(() => provider.close());
  const result = await probe('immediate-stop', provider.baseUrl);
  assert.equal(result.outcome, 'cancelled'); assert.deepEqual(result.terminal, ['cancelled']); assert.equal(provider.requests.length, 0);
});

test('RUN-01: clear invalidates in-flight creation, disposes it and permits the same project again', async t => {
  const provider = await startSyntheticProvider(); t.after(() => provider.close());
  const result = await probe('create-clear', provider.baseUrl);
  assert.equal(result.pendingResult, 'configuration_changed'); assert.equal(result.recreated, true); assert.equal(provider.requests.length, 0);
});
