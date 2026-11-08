import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { ProjectStore } from '../src/host/project-store.ts';
import { readSavedTaskReply } from '../src/host/project-history.ts';
import { readNativeSessionSnapshot } from '../src/host/native-session-snapshot.ts';

async function fixture(t: { after(fn: () => Promise<void>): void }) {
  const roots = path.resolve('.local/fourbase-modules/m31/implementation/native/test-roots');
  await fs.mkdir(roots, { recursive: true });
  const root = await fs.mkdtemp(path.join(roots, 'readonly-'));
  const projects = new ProjectStore({ dataRoot: path.join(root, 'data'), projectsRoot: path.join(root, 'projects') });
  await projects.init(); t.after(() => projects.close());
  const project = await projects.create({ name: '只读合成项目', configuration: { id: 'synthetic', revision: 1, name: '合成', provider: 'synthetic', model: 'synthetic', baseUrl: 'http://127.0.0.1:1' } });
  const task = await projects.createTask(project.id, { name: '只读任务' });
  return { project, task };
}

test('native reply read refuses an old native version without migrating or rewriting its bytes', async t => {
  const { project, task } = await fixture(t), sessionId = randomUUID(), file = path.join(task.sessionDirectory, 'old.jsonl');
  const timestamp = new Date().toISOString();
  const bytes = Buffer.from(JSON.stringify({ type: 'session', version: 2, id: sessionId, timestamp, cwd: project.rootPath }) + '\n' + JSON.stringify({ type: 'message', id: 'reply', parentId: null, timestamp, message: { role: 'assistant', content: [{ type: 'text', text: '旧版本仍应保持' }] } }) + '\n');
  await fs.writeFile(file, bytes);
  await assert.rejects(readSavedTaskReply(project, task, { sessionId, messageId: 'reply' }), /session_history_unavailable/);
  assert.deepEqual(await fs.readFile(file), bytes);
});

test('readonly native adapter refuses duplicate IDs, cycles, missing parents and malformed bytes without altering the source', { timeout: 30_000 }, async t => {
  const { project, task } = await fixture(t), sessionId = randomUUID(), timestamp = '2026-11-03T08:00:00.000Z';
  const header = { type: 'session', version: 3, id: sessionId, timestamp, cwd: path.join(project.rootPath, '020_clean') };
  const message = { type: 'message', id: 'reply', parentId: null as string | null, timestamp, message: { role: 'assistant', content: [{ type: 'text', text: '不可变合成历史' }] } };
  const encode = (values: unknown[]) => Buffer.from(values.map(value => JSON.stringify(value)).join('\n') + '\n');
  const valid = encode([header, message]);
  const cases = [
    { name: 'duplicate IDs', bytes: encode([header, message, { ...message, parentId: 'reply' }]) },
    { name: 'self cycle', bytes: encode([header, { ...message, parentId: 'reply' }]) },
    { name: 'two-entry cycle', bytes: encode([header, { ...message, parentId: 'second' }, { ...message, id: 'second', parentId: 'reply' }]) },
    { name: 'missing parent', bytes: encode([header, { ...message, parentId: 'missing' }]) },
    { name: 'unsupported old version', bytes: encode([{ ...header, version: 2 }, message]) },
    { name: 'unknown version', bytes: encode([{ ...header, version: 4 }, message]) },
    { name: 'missing header', bytes: encode([message]) },
    { name: 'empty file', bytes: Buffer.alloc(0) },
    { name: 'trailing partial line', bytes: valid.subarray(0, valid.length - 1) },
    { name: 'blank line', bytes: Buffer.concat([valid, Buffer.from('\n')]) },
    { name: 'bad JSON', bytes: Buffer.concat([valid, Buffer.from('{broken}\n')]) },
    { name: 'bad UTF8', bytes: Buffer.concat([valid, Buffer.from([0xff, 0x0a])]) },
    { name: 'second header', bytes: encode([header, message, header]) },
  ];
  const file = path.join(task.sessionDirectory, 'guard.jsonl');
  for (const item of cases) {
    await fs.writeFile(file, item.bytes);
    const before = await fs.stat(file), names = await fs.readdir(task.sessionDirectory);
    await assert.rejects(readNativeSessionSnapshot(file, task.sessionDirectory, header.cwd), item.name);
    await assert.rejects(readSavedTaskReply(project, task, { sessionId, messageId: 'reply' }), /session_history_unavailable/, item.name);
    const after = await fs.stat(file);
    assert.deepEqual(await fs.readFile(file), item.bytes, item.name);
    assert.equal(after.mtimeMs, before.mtimeMs, item.name + ' must not migrate/rewrite');
    assert.deepEqual(await fs.readdir(task.sessionDirectory), names, item.name + ' must not initialize another native file');
  }
  await fs.writeFile(file, valid);
  const read = await readNativeSessionSnapshot(file, task.sessionDirectory, header.cwd);
  assert.equal(read.manager.getSessionId(), sessionId); assert.equal(read.entries.length, 1); assert.equal(read.branchIds.has('reply'), true);
  assert.deepEqual(await fs.readFile(file), valid);
});

test('readonly native adapter never follows a native file link, hardlink or session-directory alias', async t => {
  const { project, task } = await fixture(t), sessionId = randomUUID(), timestamp = new Date().toISOString();
  const bytes = Buffer.from(JSON.stringify({ type: 'session', version: 3, id: sessionId, timestamp, cwd: project.rootPath }) + '\n');
  const original = path.join(task.sessionDirectory, 'original.jsonl'), linked = path.join(task.sessionDirectory, 'linked.jsonl');
  await fs.writeFile(original, bytes); await fs.symlink(original, linked);
  await assert.rejects(readNativeSessionSnapshot(linked, task.sessionDirectory, project.rootPath));
  assert.deepEqual(await fs.readFile(original), bytes);
  await fs.unlink(linked); await fs.link(original, linked);
  await assert.rejects(readNativeSessionSnapshot(linked, task.sessionDirectory, project.rootPath));
  assert.deepEqual(await fs.readFile(original), bytes);
  await fs.unlink(linked);
  const alias = task.sessionDirectory + '-alias'; await fs.symlink(task.sessionDirectory, alias);
  await assert.rejects(readNativeSessionSnapshot(path.join(alias, 'original.jsonl'), alias, project.rootPath));
  assert.deepEqual(await fs.readFile(original), bytes);
});
