import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { startTestHost } from './fixtures/host-process.ts';
import { startSyntheticProvider } from './fixtures/synthetic-provider.ts';
import { prepareSessionCompatibility, readSessionCompatibility, compatibilityFiles, compatibilityDatabase, compatibilityRun } from './fixtures/session-compatibility.ts';

test('SM11: a restarted Host preserves stopped joint artifacts and native lineage, then appends only an explicit continuation', { timeout: 90_000 }, async t => {
  const provider = await startSyntheticProvider();
  let host = await startTestHost();
  t.after(async () => { await host.close(); await provider.close(); });
  const expected = await prepareSessionCompatibility(host, provider);
  const { dataRoot, projectsRoot } = host;
  await host.close();
  const roots = [dataRoot, projectsRoot];
  const files = await compatibilityFiles(roots), database = compatibilityDatabase(dataRoot);
  const before = provider.requests.length;

  host = await startTestHost({ dataRoot, projectsRoot });
  await readSessionCompatibility(host, expected, () => provider.requests.length);
  await host.close();
  assert.deepEqual(await compatibilityFiles(roots), files, 'passive reconstruction must preserve every existing fixture file and path');
  assert.deepEqual(compatibilityDatabase(dataRoot), database, 'Case SQLite schema and logical rows survive reconstruction');

  host = await startTestHost({ dataRoot, projectsRoot });
  const continued = await compatibilityRun(host, provider, expected.projectId, expected.taskId, { text: 'SM11_EXPLICIT_CONTINUATION', requestId: randomUUID() }, 'SM11_NEW_NATIVE_ANSWER');
  assert.equal(provider.requests.length, before + 1);
  const payload = JSON.stringify(provider.requests.at(-1)!.body.messages);
  assert.match(payload, /SM11_FIRST_SELECTED_CONTEXT/);
  assert.match(payload, /SM11_BRANCH_LATEST_CONTEXT/);
  assert.match(payload, /SM11_EXPLICIT_CONTINUATION/);
  assert.doesNotMatch(payload, /SM11_SECOND_UNFORKED_CONTEXT/);
  assert.equal(continued.task.sessionFile, expected.nativeFile);
  const current = await readFile(expected.nativeFile);
  assert.deepEqual(current.subarray(0, Buffer.from(expected.nativeBytes, 'base64').length), Buffer.from(expected.nativeBytes, 'base64'), 'normal continuation preserves the complete old native prefix');
  assert.ok(current.length > Buffer.from(expected.nativeBytes, 'base64').length, 'the explicit new run appends native records');
  assert.deepEqual(await readFile(expected.parentFile), Buffer.from(expected.parentBytes, 'base64'));
  assert.equal(JSON.parse(current.toString().split('\n')[0]!).parentSession, expected.parentFile);
  await host.close();
  assert.deepEqual(compatibilityDatabase(dataRoot), database, 'chat continuation does not mutate Case records');
  const after = await compatibilityFiles(roots);
  const mutable = new Set([expected.nativeFile, path.join(dataRoot, 'projects', expected.projectId, 'project.json')]);
  for (const [file, bytes] of Object.entries(files)) if (!mutable.has(file) && file !== expected.startupFile) assert.equal(after[file], bytes, `normal continuation retains immutable artifact ${file}`);
  t.diagnostic(`Synthetic compatibility root: ${dataRoot}; model requests ${before} -> ${provider.requests.length}; native parent ${expected.parentFile}`);
});
