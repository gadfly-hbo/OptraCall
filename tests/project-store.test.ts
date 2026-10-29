import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { ProjectStore, type ProjectConfiguration } from '../src/host/project-store.ts';

const configuration: ProjectConfiguration = { id: 'minimax-m3', revision: 1, name: 'MiniMax M3', provider: 'minimax-cn', model: 'MiniMax-M3', baseUrl: 'https://api.minimaxi.com/anthropic', api: 'anthropic-messages' };
async function fixture(t: { after: (fn: () => Promise<void>) => void }) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'optracall-store-'));
  const options = { dataRoot: path.join(root, 'private'), projectsRoot: path.join(root, 'projects') };
  const store = new ProjectStore(options); await store.init();
  t.after(async () => { await store.close(); await fs.rm(root, { recursive: true, force: true }); });
  return { root, options, store };
}

test('TASKS-01: an empty project owns independent task drafts, model snapshots and native histories across restart', async t => {
  const { store, options } = await fixture(t);
  const project = await store.create({ name: '同一项目两个任务', configuration });
  assert.equal(project.schemaVersion, 2); assert.deepEqual(project.tasks, []); assert.equal(project.archivedAt, null);
  assert.equal('draft' in project, false); assert.equal('sessionFile' in project, false); assert.equal('lastRun' in project, false);
  const a = await store.createTask(project.id, { name: '任务A' });
  const b = await store.createTask(project.id, { name: '任务B', configuration: { ...configuration, id: 'deepseek-flash', provider: 'deepseek', model: 'deepseek-flash' } });
  assert.notEqual(a.id, b.id); assert.notEqual(a.sessionDirectory, b.sessionDirectory); assert.equal(a.configuration.model, 'MiniMax-M3'); assert.equal(b.configuration.model, 'deepseek-flash');
  assert.equal(a.sessionStorage, 'task'); assert.deepEqual(await fs.readdir(a.sessionDirectory), []);
  await store.saveDraft(project.id, a.id, '任务A未发送草稿');
  const sessionFile = path.join(a.sessionDirectory, 'native-history.jsonl');
  await store.setSession(project.id, a.id, sessionFile);
  const run = { id: randomUUID(), status: 'completed' as const, startedAt: '2026-10-29T00:00:00.000Z', settledAt: '2026-10-29T00:00:01.000Z' };
  await store.markRun(project.id, a.id, run);
  assert.equal((await store.getTask(project.id, b.id)).draft, ''); assert.equal((await store.getTask(project.id, b.id)).lastRun, undefined);
  await store.close(); const reopened = new ProjectStore(options); await reopened.init();
  try {
    const saved = await reopened.get(project.id); assert.equal(saved.tasks.length, 2);
    const recovered = await reopened.getTask(project.id, a.id); assert.equal(recovered.draft, '任务A未发送草稿'); assert.equal(recovered.sessionFile, sessionFile); assert.deepEqual(recovered.lastRun, run);
    assert.equal((await reopened.getTask(project.id, b.id)).configuration.model, 'deepseek-flash');
  } finally { await reopened.close(); }
});

test('ARCHIVE-01: rename keeps identity and paths, archive retains readable contents and blocks every write until restore', async t => {
  const { store, options } = await fixture(t); const project = await store.create({ name: '原项目名', configuration });
  const task = await store.createTask(project.id, { name: '保留任务' }); await store.saveDraft(project.id, task.id, '保留草稿');
  const raw = await store.upload({ projectId: project.id, name: '原件.txt', bytes: Buffer.from('synthetic archive content') });
  const renamed = await store.rename(project.id, '  新项目名  ');
  assert.equal(renamed.id, project.id); assert.equal(renamed.rootPath, project.rootPath); assert.equal(renamed.name, '新项目名'); assert.equal(renamed.tasks[0]?.id, task.id);
  const archived = await store.archive(project.id); assert.ok(archived.archivedAt); assert.equal((await store.archive(project.id)).archivedAt, archived.archivedAt);
  assert.equal((await store.list()).length, 1); assert.equal((await store.getTask(project.id, task.id)).draft, '保留草稿');
  assert.equal((await store.readFile(project.id, raw.path)).bytes.toString(), 'synthetic archive content'); assert.equal((await store.tree(project.id))[0]?.children?.length, 1);
  const metadata = path.join(options.dataRoot, 'projects', project.id, 'project.json'), before = await fs.readFile(metadata);
  for (const write of [
    () => store.rename(project.id, '禁止改名'), () => store.createTask(project.id, { name: '禁止新任务' }),
    () => store.saveDraft(project.id, task.id, '禁止草稿'), () => store.setSession(project.id, task.id, path.join(task.sessionDirectory, 'blocked.jsonl')),
    () => store.markRun(project.id, task.id, { id: randomUUID(), status: 'running', startedAt: '2026-10-29T00:00:00.000Z' }),
    () => store.upload({ projectId: project.id, name: '禁止上传.txt', bytes: Buffer.from('blocked') }),
    () => store.copyToClean(project.id, raw.path), () => store.saveReport(project.id, '禁止报告.md', '# blocked'),
  ]) { await assert.rejects(write, /project_archived/); assert.deepEqual(await fs.readFile(metadata), before); }
  assert.deepEqual(await fs.readdir(path.join(project.rootPath, '020_clean')), []); assert.deepEqual(await fs.readdir(path.join(project.rootPath, '060_reports')), []);
  await store.close(); const restarted = new ProjectStore(options); await restarted.init();
  try {
    assert.equal((await restarted.get(project.id)).archivedAt, archived.archivedAt);
    const restored = await restarted.restore(project.id); assert.equal(restored.archivedAt, null); assert.equal(restored.name, '新项目名'); assert.equal(restored.tasks[0]?.id, task.id);
    await restarted.saveDraft(project.id, task.id, '恢复后的草稿'); assert.equal((await restarted.getTask(project.id, task.id)).draft, '恢复后的草稿');
    assert.equal((await restarted.restore(project.id)).archivedAt, null);
  } finally { await restarted.close(); }
});

test('TASKS-02: task ownership and native-history directories cannot be crossed even inside one project', async t => {
  const { store, options, root } = await fixture(t), project = await store.create({ name: '任务归属边界', configuration }), other = await store.create({ name: '其他项目', configuration });
  const a = await store.createTask(project.id, { name: '同名任务' }), b = await store.createTask(project.id, { name: '同名任务' });
  await assert.rejects(store.getTask(other.id, a.id), /task_not_found/); await assert.rejects(store.saveDraft(other.id, a.id, '不能串项目'), /task_not_found/);
  await assert.rejects(store.setSession(project.id, a.id, path.join(b.sessionDirectory, 'other.jsonl')), /invalid_session_file/);
  await assert.rejects(store.setSession(project.id, a.id, path.join(store.sessionDirectory(project.id), 'legacy.jsonl')), /invalid_session_file/);
  await Promise.all([store.saveDraft(project.id, a.id, 'A1'), store.saveDraft(project.id, b.id, 'B1'), store.saveDraft(project.id, a.id, 'A2')]);
  assert.equal((await store.getTask(project.id, a.id)).draft, 'A2'); assert.equal((await store.getTask(project.id, b.id)).draft, 'B1');
  const outside = path.join(root, 'outside-native.jsonl'); await fs.writeFile(outside, 'synthetic retain');
  await fs.symlink(outside, path.join(a.sessionDirectory, 'linked.jsonl')); await assert.rejects(store.setSession(project.id, a.id, path.join(a.sessionDirectory, 'linked.jsonl')), /invalid_session_file/);
  await fs.unlink(path.join(a.sessionDirectory, 'linked.jsonl')); await fs.link(outside, path.join(a.sessionDirectory, 'hard.jsonl'));
  await assert.rejects(store.setSession(project.id, a.id, path.join(a.sessionDirectory, 'hard.jsonl')), /invalid_session_file/);
  assert.equal(await fs.readFile(outside, 'utf8'), 'synthetic retain');
  const metadata = path.join(options.dataRoot, 'projects', project.id, 'project.json'), original = await fs.readFile(metadata), invalid = JSON.parse(original.toString());
  invalid.tasks[1].id = invalid.tasks[0].id; await fs.writeFile(metadata, JSON.stringify(invalid)); await assert.rejects(store.get(project.id), /invalid_project_metadata/);
  await fs.writeFile(metadata, original);
  invalid.tasks = JSON.parse(original.toString()).tasks.map((task: Record<string, unknown>) => ({ ...task, sessionStorage: 'legacy' }));
  await fs.writeFile(metadata, JSON.stringify(invalid)); await assert.rejects(store.get(project.id), /invalid_project_metadata/); await fs.writeFile(metadata, original);
});

test('TASKS-03: a task write that exceeds the metadata size cap preserves the complete previously readable project', async t => {
  const { store, options } = await fixture(t), project = await store.create({ name: '元数据边界', configuration });
  const task = await store.createTask(project.id, { name: '保留原草稿' }), metadata = path.join(options.dataRoot, 'projects', project.id, 'project.json');
  const record = JSON.parse(await fs.readFile(metadata, 'utf8')), now = '2026-10-29T00:00:00.000Z';
  // Seed a valid pre-existing large attachment ledger; no file content is read or
  // generated. The public draft write must reject rather than publish an unreadable file.
  const attachments = Array.from({ length: 6000 }, (_, index) => ({ id: randomUUID(), originalName: 'x'.repeat(190) + '.txt', path: `010_draw/file-${index}.txt`, bytes: 0, sha256: '0'.repeat(64), uploadedAt: now, source: { kind: 'upload' } }));
  let low = 0, high = attachments.length;
  while (low < high) { const mid = Math.ceil((low + high) / 2); if (Buffer.byteLength(JSON.stringify({ ...record, uploads: attachments.slice(0, mid) }, null, 2) + '\n') < 2 * 1024 * 1024 - 10000) low = mid; else high = mid - 1; }
  const original = Buffer.from(JSON.stringify({ ...record, uploads: attachments.slice(0, low) }, null, 2) + '\n'); await fs.writeFile(metadata, original);
  assert.ok(original.length > 2 * 1024 * 1024 - 11000); assert.ok((await store.get(project.id)).uploads.length > 0);
  await assert.rejects(store.saveDraft(project.id, task.id, 'a'.repeat(20000)), /project_metadata_too_large/);
  assert.deepEqual(await fs.readFile(metadata), original); assert.equal((await store.getTask(project.id, task.id)).draft, '');
  const almostFull = JSON.parse(original.toString()); almostFull.tasks[0].draft = 'z'.repeat(2 * 1024 * 1024 - 100 - original.length);
  const nearCapacity = Buffer.from(JSON.stringify(almostFull, null, 2) + '\n'); assert.equal(nearCapacity.length, 2 * 1024 * 1024 - 100); await fs.writeFile(metadata, nearCapacity);
  await assert.rejects(store.upload({ projectId: project.id, name: 'x'.repeat(190) + '.txt', bytes: Buffer.from('synthetic') }), /project_metadata_too_large/);
  assert.deepEqual(await fs.readFile(metadata), nearCapacity); assert.deepEqual(await fs.readdir(path.join(project.rootPath, '010_draw')), [], 'A rejected attachment must not leave an unrecorded uploaded file.');
});

test('TASKS-04: metadata reads tolerate a legitimate atomic replacement before open or before descriptor validation', async t => {
  const { store, options } = await fixture(t), project = await store.create({ name: '并发读取前', configuration });
  await store.createTask(project.id, { name: '保留独立任务' });
  const metadata = path.join(options.dataRoot, 'projects', project.id, 'project.json');
  const originalLstat = fs.lstat, originalOpen = fs.open;
  for (const phase of ['lstat', 'open'] as const) {
    let armed = true;
    const original = fs[phase];
    const hook = phase === 'lstat'
      ? t.mock.method(fs, 'lstat', async (...args: Parameters<typeof fs.lstat>) => { const entry = await originalLstat(...args); if (armed && String(args[0]) === metadata) { armed = false; await store.rename(project.id, `原子替换后-${phase}`); } return entry; })
      : t.mock.method(fs, 'open', async (...args: Parameters<typeof fs.open>) => { const handle = await originalOpen(...args); if (armed && String(args[0]) === metadata) { armed = false; await store.rename(project.id, `原子替换后-${phase}`); } return handle; });
    try { const saved = await store.get(project.id); assert.equal(saved.name, `原子替换后-${phase}`); assert.equal(saved.tasks.length, 1); }
    finally { hook.mock.restore(); }
    assert.equal(fs[phase], original);
  }
});

test('TASKS-05: metadata symlinks and hardlinks remain rejected without changing their targets', async t => {
  const { store, options, root } = await fixture(t), project = await store.create({ name: '元数据链接边界', configuration });
  const metadata = path.join(options.dataRoot, 'projects', project.id, 'project.json'), outside = path.join(root, 'outside-metadata.json'), original = await fs.readFile(metadata);
  await fs.rename(metadata, outside); await fs.symlink(outside, metadata);
  await assert.rejects(store.get(project.id), /invalid_project_metadata/); assert.deepEqual(await fs.readFile(outside), original); await fs.unlink(metadata);
  await fs.link(outside, metadata); await assert.rejects(store.get(project.id), /invalid_project_metadata/); assert.deepEqual(await fs.readFile(outside), original);
  await fs.unlink(metadata); await fs.rename(outside, metadata); assert.equal((await store.get(project.id)).name, '元数据链接边界');
});

test('TASKS-06: a metadata read retries a real zero-link inode returned by the initial lstat', async t => {
  const { store, options } = await fixture(t), project = await store.create({ name: '替换前', configuration });
  const task = await store.createTask(project.id, { name: '保留任务' });
  const metadata = path.join(options.dataRoot, 'projects', project.id, 'project.json');
  const originalLstat = fs.lstat, originalOpen = fs.open;
  let armed = true, observedZeroLink = false;
  const hook = t.mock.method(fs, 'lstat', async (...args: Parameters<typeof fs.lstat>) => {
    if (armed && String(args[0]) === metadata) {
      armed = false;
      const oldHandle = await originalOpen(metadata, 'r');
      try {
        await store.rename(project.id, '替换后');
        // Use the real old inode after atomic replacement, matching Darwin's
        // lstat completing after the resolved inode loses its last link.
        const unlinked = await oldHandle.stat(); assert.equal(unlinked.nlink, 0); observedZeroLink = true;
        return unlinked;
      } finally { await oldHandle.close(); }
    }
    return originalLstat(...args);
  });
  try {
    const saved = await store.get(project.id);
    assert.equal(observedZeroLink, true); assert.equal(saved.name, '替换后'); assert.equal(saved.tasks[0]?.id, task.id);
  } finally { hook.mock.restore(); }
});

test('new projects create exactly three real folders and survive Host recreation', async t => {
  const { store, options } = await fixture(t);
  const project = await store.create({ name: '销售合成资料', configuration });
  assert.deepEqual((await fs.readdir(project.rootPath)).sort(), ['010_draw', '020_clean', '060_reports']);
  assert.match(project.id, /^[0-9a-f-]{36}$/);
  assert.equal((await fs.stat(project.rootPath)).mode & 0o777, 0o700);
  await store.close();
  const restarted = new ProjectStore(options); await restarted.init();
  try { assert.equal((await restarted.list())[0]?.id, project.id); assert.equal((await restarted.list())[0]?.configuration.model, 'MiniMax-M3'); }
  finally { await restarted.close(); }
});

test('upload defaults to raw, preserves duplicate originals and records real bytes without contacting a model', async t => {
  const { store } = await fixture(t); const project = await store.create({ name: '上传检查', configuration });
  const content = new TextEncoder().encode('月份,销售额\n一月,10\n二月,15\n');
  const first = await store.upload({ projectId: project.id, name: '销售.csv', bytes: content });
  const second = await store.upload({ projectId: project.id, name: '销售.csv', bytes: content });
  assert.match(first.path, /^010_draw\//); assert.notEqual(first.path, second.path);
  assert.deepEqual(await fs.readFile(path.join(project.rootPath, first.path)), Buffer.from(content));
  assert.equal((await fs.stat(path.join(project.rootPath, first.path))).mode & 0o777, 0o600);
  assert.equal((await store.get(project.id)).uploads.length, 2);
  assert.equal(first.sha256, second.sha256); assert.deepEqual(first.source, { kind: 'upload' });
  assert.deepEqual(await fs.readdir(path.join(project.rootPath, '020_clean')), []);
});

test('only an explicit user copy creates clean input, and user downloads and tree reflect real files', async t => {
  const { store } = await fixture(t); const project = await store.create({ name: '资料准备', configuration });
  const raw = await store.upload({ projectId: project.id, name: '客户合成.txt', bytes: new TextEncoder().encode('虚拟客户，无真实资料。') });
  const clean = await store.copyToClean(project.id, raw.path);
  assert.match(clean.path, /^020_clean\//); assert.deepEqual(clean.source, { kind: 'copy', from: raw.path });
  assert.equal((await store.readFile(project.id, raw.path)).bytes.toString(), '虚拟客户，无真实资料。');
  assert.equal((await store.readFile(project.id, clean.path)).bytes.toString(), '虚拟客户，无真实资料。');
  await fs.writeFile(path.join(project.rootPath, '060_reports', '总结.md'), '# 测试报告\n');
  const tree = await store.tree(project.id);
  assert.deepEqual(tree.map(node => node.name), ['010_draw', '020_clean', '060_reports']);
  assert.equal(tree[0].children?.length, 1); assert.equal(tree[1].children?.length, 1);
  assert.equal(tree[2].children?.[0]?.path, '060_reports/总结.md');
  assert.equal((await store.readFile(project.id, '060_reports/总结.md')).bytes.toString(), '# 测试报告\n');
  const direct = await store.upload({ projectId: project.id, name: '直接分析.json', directory: '020_clean', bytes: new TextEncoder().encode('{"synthetic":true}') });
  assert.equal(direct.path, '020_clean/直接分析.json'); assert.equal((await store.tree(project.id))[1].children?.length, 2);
});

test('drafts, non-secret configuration snapshots, session references and outcomes persist independently', async t => {
  const { store, options } = await fixture(t);
  const project = await store.create({ name: '状态保存', configuration: { ...configuration, apiKey: 'never-store-this-fake-key' } as ProjectConfiguration });
  const other = await store.create({ name: '状态保存', configuration: { ...configuration, id: 'deepseek-flash', provider: 'deepseek', model: 'deepseek-flash' } });
  const task = await store.createTask(project.id, { name: '状态保存任务' }), otherTask = await store.createTask(other.id, { name: '另一项目任务' });
  const sessionFile = path.join(task.sessionDirectory, 'sdk-history.jsonl');
  await Promise.all([store.saveDraft(project.id, task.id, '未发送的草稿'), store.upload({ projectId: project.id, name: '输入.txt', bytes: new TextEncoder().encode('synthetic'), directory: '020_clean' })]);
  await store.setSession(project.id, task.id, sessionFile);
  const run = { id: randomUUID(), status: 'completed' as const, startedAt: '2026-10-28T12:00:00.000Z', settledAt: '2026-10-28T12:00:01.000Z' };
  await store.markRun(project.id, task.id, run);
  await store.close(); const restarted = new ProjectStore(options); await restarted.init();
  try {
    const saved = await restarted.get(project.id);
    const savedTask = await restarted.getTask(project.id, task.id);
    assert.equal(savedTask.draft, '未发送的草稿'); assert.equal(saved.uploads.length, 1); assert.equal(savedTask.sessionFile, sessionFile); assert.deepEqual(savedTask.lastRun, run);
    assert.equal((await restarted.getTask(other.id, otherTask.id)).draft, ''); assert.equal((await restarted.get(other.id)).uploads.length, 0);
    const metadata = await fs.readFile(path.join(options.dataRoot, 'projects', project.id, 'project.json'), 'utf8');
    assert.equal(metadata.includes('never-store-this-fake-key'), false); assert.equal(metadata.includes('rootPath'), false);
    assert.equal((await fs.stat(path.join(options.dataRoot, 'projects', project.id, 'project.json'))).mode & 0o777, 0o600);
  } finally { await restarted.close(); }
});

test('file APIs reject traversal, cross-project paths, symlinks and hard links without reading their targets', async t => {
  const { store, root } = await fixture(t); const a = await store.create({ name: 'A', configuration }), b = await store.create({ name: 'B', configuration });
  const aTask = await store.createTask(a.id, { name: 'A任务' }), bTask = await store.createTask(b.id, { name: 'B任务' });
  const outside = path.join(root, 'private-credential.txt'); await fs.writeFile(outside, 'private fake sentinel');
  const bFile = await store.upload({ projectId: b.id, name: 'B.txt', bytes: new TextEncoder().encode('other project') });
  for (const input of ['../private-credential.txt', '020_clean/../../private-credential.txt', path.join(b.rootPath, bFile.path), `020_clean/../../${b.id}/${bFile.path}`, '020_clean\\..\\private.txt']) {
    await assert.rejects(async () => store.readFile(a.id, input));
  }
  await fs.symlink(outside, path.join(a.rootPath, '020_clean', 'escape.txt'));
  await assert.rejects(store.readFile(a.id, '020_clean/escape.txt'), /unsafe_file_path/);
  await assert.rejects(store.tree(a.id), /unsafe_file_path/);
  await fs.unlink(path.join(a.rootPath, '020_clean', 'escape.txt'));
  await fs.link(outside, path.join(a.rootPath, '020_clean', 'hard.txt'));
  await assert.rejects(store.readFile(a.id, '020_clean/hard.txt'), /unsafe_file_path/);
  await assert.rejects(store.copyToClean(a.id, '020_clean/hard.txt'), /copy_requires_raw_file/);
  await assert.rejects(store.setSession(a.id, aTask.id, path.join(bTask.sessionDirectory, 'session.jsonl')), /invalid_session_file/);
  assert.equal(await fs.readFile(outside, 'utf8'), 'private fake sentinel');
});

test('invalid uploads, names and outcomes do not create successful attachments or overwrite data', async t => {
  const { store } = await fixture(t); const project = await store.create({ name: '限制检查', configuration });
  const task = await store.createTask(project.id, { name: '限制任务' });
  for (const name of ['../escape.csv', '/absolute.txt', 'broken.exe', 'a\\b.json', 'a\u0000.txt']) await assert.rejects(async () => store.upload({ projectId: project.id, name, bytes: new Uint8Array() }));
  await assert.rejects(async () => store.upload({ projectId: project.id, name: 'huge.txt', bytes: new Uint8Array(10 * 1024 * 1024 + 1) }), /upload_too_large/);
  await assert.rejects(async () => store.upload({ projectId: project.id, name: 'binary.txt', bytes: new Uint8Array([0xff, 0xfe, 0xff]) }), /upload_requires_utf8/);
  await assert.rejects(store.create({ name: '  ', configuration }), /invalid_project_name/);
  await assert.rejects(async () => store.markRun(project.id, task.id, { id: randomUUID(), status: 'completed', startedAt: '2026-10-28T12:00:00.000Z' }), /invalid_run/);
  assert.equal((await store.get(project.id)).uploads.length, 0);
  assert.deepEqual((await store.tree(project.id)).map(node => node.children), [[], [], []]);
});

test('active writers and unrecognized or corrupt data fail closed and remain preserved', async t => {
  const { store, options } = await fixture(t); const project = await store.create({ name: '保留现场', configuration });
  const second = new ProjectStore(options); await assert.rejects(second.init(), /project_store_locked/); await second.close();
  assert.equal((await store.get(project.id)).name, '保留现场');
  const metadata = path.join(options.dataRoot, 'projects', project.id, 'project.json');
  await fs.writeFile(metadata, '{broken');
  await assert.rejects(store.get(project.id), /invalid_project_metadata/);
  assert.equal(await fs.readFile(metadata, 'utf8'), '{broken');
  await store.close(); const restarted = new ProjectStore(options); await assert.rejects(restarted.init(), /invalid_project_metadata/); await restarted.close();
  assert.equal(await fs.readFile(metadata, 'utf8'), '{broken');
});

test('a verified dead-process lock can be recovered and a foreign root is never adopted', async t => {
  const { store, options } = await fixture(t); await store.close();
  await fs.writeFile(path.join(options.dataRoot, '.project-store.lock'), JSON.stringify({ pid: 2147483647, token: randomUUID() }));
  const recovered = new ProjectStore(options); await recovered.init(); await recovered.close();
  await fs.writeFile(path.join(options.projectsRoot, 'existing-important.txt'), 'retain');
  await fs.chmod(options.projectsRoot, 0o755);
  const foreign = new ProjectStore(options); await assert.rejects(foreign.init(), /unrecognized_project_root/); await foreign.close();
  assert.equal(await fs.readFile(path.join(options.projectsRoot, 'existing-important.txt'), 'utf8'), 'retain');
  assert.equal((await fs.stat(options.projectsRoot)).mode & 0o777, 0o755);
});

test('explicit user save stores final assistant text in reports without overwriting or reclassifying other files', async t => {
  const { store, options } = await fixture(t), project = await store.create({ name: '用户保存报告', configuration });
  const text = '# 合成数据总结\n仅保存用户选择的助手文本，不执行分析。\n';
  const first = await store.saveReport(project.id, '最终报告.md', text);
  const second = await store.saveReport(project.id, '最终报告.md', '用户另存的版本');
  assert.equal(first.path, '060_reports/最终报告.md'); assert.notEqual(first.path, second.path);
  assert.deepEqual(first.source, { kind: 'user-save-report' });
  assert.equal((await store.readFile(project.id, first.path)).bytes.toString('utf8'), text);
  assert.equal((await fs.stat(path.join(project.rootPath, first.path))).mode & 0o777, 0o600);
  assert.deepEqual(await fs.readdir(path.join(project.rootPath, '010_draw')), []);
  assert.deepEqual(await fs.readdir(path.join(project.rootPath, '020_clean')), []);
  await assert.rejects(store.saveReport(project.id, '../外部.txt', text));
  await assert.rejects(store.saveReport(project.id, '不是文本.pdf', text), /invalid_report_name/);
  await assert.rejects(store.saveReport(project.id, '过大.txt', 'a'.repeat(10 * 1024 * 1024 + 1)), /upload_too_large/);
  await store.close(); const restarted = new ProjectStore(options); await restarted.init();
  try { assert.deepEqual((await restarted.get(project.id)).uploads[0]?.source, { kind: 'user-save-report' }); assert.equal((await restarted.readFile(project.id, first.path)).bytes.toString(), text); }
  finally { await restarted.close(); }
});
