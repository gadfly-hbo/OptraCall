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
  const sessionFile = path.join(project.sessionDirectory, 'sdk-history.jsonl');
  await Promise.all([store.saveDraft(project.id, '未发送的草稿'), store.upload({ projectId: project.id, name: '输入.txt', bytes: new TextEncoder().encode('synthetic'), directory: '020_clean' })]);
  await store.setSession(project.id, sessionFile);
  const run = { id: randomUUID(), status: 'completed' as const, startedAt: '2026-10-28T12:00:00.000Z', settledAt: '2026-10-28T12:00:01.000Z' };
  await store.markRun(project.id, run);
  await store.close(); const restarted = new ProjectStore(options); await restarted.init();
  try {
    const saved = await restarted.get(project.id);
    assert.equal(saved.draft, '未发送的草稿'); assert.equal(saved.uploads.length, 1); assert.equal(saved.sessionFile, sessionFile); assert.deepEqual(saved.lastRun, run);
    assert.equal((await restarted.get(other.id)).draft, ''); assert.equal((await restarted.get(other.id)).uploads.length, 0);
    const metadata = await fs.readFile(path.join(options.dataRoot, 'projects', project.id, 'project.json'), 'utf8');
    assert.equal(metadata.includes('never-store-this-fake-key'), false); assert.equal(metadata.includes('rootPath'), false);
    assert.equal((await fs.stat(path.join(options.dataRoot, 'projects', project.id, 'project.json'))).mode & 0o777, 0o600);
  } finally { await restarted.close(); }
});

test('file APIs reject traversal, cross-project paths, symlinks and hard links without reading their targets', async t => {
  const { store, root } = await fixture(t); const a = await store.create({ name: 'A', configuration }), b = await store.create({ name: 'B', configuration });
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
  await assert.rejects(store.setSession(a.id, path.join(b.sessionDirectory, 'session.jsonl')), /invalid_session_file/);
  assert.equal(await fs.readFile(outside, 'utf8'), 'private fake sentinel');
});

test('invalid uploads, names and outcomes do not create successful attachments or overwrite data', async t => {
  const { store } = await fixture(t); const project = await store.create({ name: '限制检查', configuration });
  for (const name of ['../escape.csv', '/absolute.txt', 'broken.exe', 'a\\b.json', 'a\u0000.txt']) await assert.rejects(async () => store.upload({ projectId: project.id, name, bytes: new Uint8Array() }));
  await assert.rejects(async () => store.upload({ projectId: project.id, name: 'huge.txt', bytes: new Uint8Array(10 * 1024 * 1024 + 1) }), /upload_too_large/);
  await assert.rejects(async () => store.upload({ projectId: project.id, name: 'binary.txt', bytes: new Uint8Array([0xff, 0xfe, 0xff]) }), /upload_requires_utf8/);
  await assert.rejects(store.create({ name: '  ', configuration }), /invalid_project_name/);
  await assert.rejects(async () => store.markRun(project.id, { id: randomUUID(), status: 'completed', startedAt: '2026-10-28T12:00:00.000Z' }), /invalid_run/);
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
