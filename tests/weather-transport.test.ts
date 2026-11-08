import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

function runFixture(name: string): void {
  const repoRoot = process.cwd();
  const evidence = mkdtempSync(path.join(os.tmpdir(), 'optracall-weather-transport-'));
  const fixture = fileURLToPath(new URL('./fixtures/' + name, import.meta.url));
  const args = [fixture, repoRoot, evidence];
  const env = { ...process.env }; delete env.NODE_TEST_CONTEXT;
  try {
    const output = execFileSync(process.execPath, args, { cwd: repoRoot, env, timeout: 30_000, encoding: 'utf8', stdio: 'pipe' });
    writeFileSync(path.join(evidence, 'fixture.log'), output);
    assert.match(output, /fail 0/);
  } catch (error) {
    const result = error as Error & { stdout?: string; stderr?: string };
    writeFileSync(path.join(evidence, 'fixture.log'), String(result.stdout ?? '') + '\n' + String(result.stderr ?? result.message));
    throw new Error('Weather transport fixture failed; evidence: ' + evidence);
  }
}

test('WX05: fd FetchLike rejects malformed frames, cancellation, late results and resource overflow', () => {
  runFixture('weather-broker-client-probe.mjs');
});

test('WX05/06: Host stdio transport enforces network/process limits and preserves MCP cache/cancel/close', () => {
  runFixture('weather-transport-host-probe.mjs');
});
