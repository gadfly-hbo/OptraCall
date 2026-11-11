import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { existsSync, readFileSync, readdirSync, renameSync, statSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { ProjectStore } from '../src/host/project-store.ts';
import { EnterpriseMaterialsStore } from '../src/host/enterprise-materials-store.ts';
import { createProjectFilesPort } from '../src/host/project-files.ts';

const configuration = { id: 'synthetic', revision: 1, provider: 'synthetic', model: 'synthetic', name: 'Synthetic', baseUrl: 'https://example.invalid' };

async function fixture(t: { after(fn: () => Promise<void>): void }) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'optracall-project-files-'));
  const projects = new ProjectStore({ dataRoot: path.join(root, 'private'), projectsRoot: path.join(root, 'projects') });
  await projects.init();
  t.after(async () => { await projects.close(); await fs.rm(root, { recursive: true, force: true }); });
  const project = await projects.create({ name: '合成文件能力', configuration });
  const task = await projects.createTask(project.id, { name: '普通分析' });
  const context = { signal: new AbortController().signal, requestId: randomUUID(), sessionId: randomUUID(), toolCallId: 'codemode-call/2', assertCurrent() {} };
  const enterpriseMaterials = new EnterpriseMaterialsStore(path.join(root, 'private'));
  const port = createProjectFilesPort({ projects, enterpriseMaterials, projectId: project.id, taskId: task.id, assertOwner: async () => { await projects.getTask(project.id, task.id); } });
  return { root, projects, project, task, context, enterpriseMaterials, port };
}

test('bound reports keep the exact Agent filename and current request identity', async t => {
  const { projects, project, task, context } = await fixture(t);
  const filename = '中文人群报告.v2.csv', content = '类别,占比\nA,26.6640%\n';
  const receipt = await projects.writeBoundReport(project.id, task.id, filename, content, context);
  assert.equal(receipt.filename, filename);
  assert.equal(receipt.relativePath, '060_reports/' + filename);
  assert.equal(receipt.path, path.join(project.rootPath, '060_reports', filename));
  assert.equal(receipt.sha256, createHash('sha256').update(content).digest('hex'));
  assert.equal(receipt.bytes, Buffer.byteLength(content));
  assert.equal(receipt.projectId, project.id);
  assert.equal(receipt.taskId, task.id);
  assert.equal(receipt.requestId, context.requestId);
  assert.equal(receipt.sessionId, context.sessionId);
  assert.equal(receipt.toolCallId, 'codemode-call/2');
  assert.equal((await projects.readFile(project.id, receipt.relativePath)).bytes.toString(), content);
  assert.deepEqual(await fs.readdir(path.join(project.rootPath, '020_clean')), []);
});

test('read_input uses the bound project and Pi native line pagination', async t => {
  const { projects, project, context, port } = await fixture(t);
  await projects.upload({ projectId: project.id, name: '销量.csv', directory: '020_clean', bytes: Buffer.from('日期,销量\n周一,44\n周二,49\n') });
  const result = await port('read-input', { filename: '销量.csv', offset: 2, limit: 1 }, context);
  assert.equal(result.content[0].text, '周一,44\n\n[2 more lines in file. Use offset=3 to continue.]');
  assert.equal(result.details.projectId, project.id);
  assert.equal(result.details.toolCallId, context.toolCallId);
  assert.equal(result.details.path, path.join(project.rootPath, '020_clean', '销量.csv'));
});

test('write_report keeps one complete file on a same-name race and publishes nothing for a revoked request', async t => {
  const { projects, project, context, port } = await fixture(t);
  const args = { filename: '阶段结论.markdown', content: '# 原始报告\n待补齐上游数据。' };
  const results = await Promise.allSettled([
    port('write-report', args, context),
    port('write-report', { ...args, content: '不可覆盖首份' }, { ...context, toolCallId: 'codemode-call/3' }),
  ]);
  const saved = results.filter(result => result.status === 'fulfilled');
  const refused = results.filter(result => result.status === 'rejected');
  assert.equal(saved.length, 1);
  assert.equal(refused.length, 1);
  assert.match(String(refused[0].reason), /report_name_conflict/);
  assert.equal(saved[0].value.details.path, path.join(project.rootPath, '060_reports', args.filename));
  const expected = saved[0].value.details.toolCallId === 'codemode-call/2' ? args.content : '不可覆盖首份';
  assert.equal((await projects.readFile(project.id, '060_reports/' + args.filename)).bytes.toString(), expected);

  const controller = new AbortController(); controller.abort();
  await assert.rejects(port('write-report', { filename: '取消报告.md', content: '不会发布' }, { ...context, signal: controller.signal }), /abort/i);
  assert.deepEqual(await fs.readdir(path.join(project.rootPath, '060_reports')), [args.filename]);
});

test('read_catalog uses the current enabled catalogue without creating or refreshing the store', async t => {
  const { enterpriseMaterials, context, port } = await fixture(t);
  await assert.rejects(port('read-catalog', {}, context), /enterprise_source_missing/);
  await assert.rejects(fs.stat(enterpriseMaterials.root), { code: 'ENOENT' });

  const draft = await enterpriseMaterials.create({ title: '已启用候选', body: '只提供目录的可定位来源' });
  const enabled = await enterpriseMaterials.enable(draft.material.id, draft.material.version);
  await enterpriseMaterials.create({ title: '未启用草稿', body: '不可交给目录调用' });
  const original = await fs.stat(enterpriseMaterials.directoryPath, { bigint: true });
  const receipt = await port('read-catalog', {}, context);
  const catalog = JSON.parse(receipt.content[0].text);
  assert.deepEqual(catalog.materials.map((entry: { materialId: string }) => entry.materialId), [enabled.material.id]);
  assert.equal(receipt.details.storeId, enabled.storeId);
  assert.equal(receipt.details.path, enterpriseMaterials.directoryPath);
  const unchanged = await fs.stat(enterpriseMaterials.directoryPath, { bigint: true });
  assert.equal(unchanged.ino, original.ino);
  assert.equal(unchanged.mtimeNs, original.mtimeNs);
  await assert.rejects(port('read-catalog', { path: enterpriseMaterials.directoryPath }, context), /invalid_catalog_arguments/);
  await enterpriseMaterials.disable(enabled.material.id, enabled.material.version);
  assert.deepEqual(JSON.parse((await port('read-catalog', {}, context)).content[0].text).materials, []);
});

test('a replaced report staging name cannot publish bytes from a different inode', async t => {
  const { projects, project, task, context } = await fixture(t);
  const directory = path.join(project.rootPath, '060_reports');
  let replaced: string | undefined;
  await assert.rejects(projects.writeBoundReport(project.id, task.id, '最终报告.md', 'original synthetic bytes', { ...context, assertCurrent() {
    if (replaced) return;
    const [name] = readdirSync(directory);
    if (!name) return;
    const staged = path.join(directory, name);
    if (statSync(staged).size === 0) return;
    renameSync(staged, path.join(directory, 'original-staged-copy.tmp'));
    writeFileSync(staged, 'unrelated synthetic bytes');
    replaced = staged;
  } }), /report_staging_unverified/);
  assert.ok(replaced);
  assert.equal(readFileSync(replaced, 'utf8'), 'unrelated synthetic bytes');
  await assert.rejects(fs.stat(path.join(directory, '最终报告.md')), { code: 'ENOENT' });
});

test('cancellation after report publication preserves exact bytes without a success receipt or a replay', async t => {
  const { project, context, port } = await fixture(t);
  const directory = path.join(project.rootPath, '060_reports');
  const args = { filename: '已发布报告.md', content: '本次已经提交的合成正文。' };
  const target = path.join(directory, args.filename), controller = new AbortController();
  await assert.rejects(port('write-report', args, { ...context, signal: controller.signal, assertCurrent() {
    if (existsSync(target)) controller.abort();
  } }), /abort|report_publication_unverified/i);
  assert.equal(controller.signal.aborted, true);
  assert.equal(await fs.readFile(target, 'utf8'), args.content);
  assert.deepEqual(await fs.readdir(directory), [args.filename]);
  await assert.rejects(port('write-report', { ...args, content: '不能覆盖已提交文件' }, { ...context, requestId: randomUUID() }), /report_name_conflict/);
  assert.equal(await fs.readFile(target, 'utf8'), args.content);
});

test('bound file tools preserve Unicode spaces in the exact physical filenames', async t => {
  const { project, context, port } = await fixture(t);
  const input = '渠道\u202f数据.csv', report = '月报\u3000复盘.md';
  await fs.writeFile(path.join(project.rootPath, '020_clean', input), '渠道,销量\nA,49');
  const read = await port('read-input', { filename: input }, context);
  assert.equal(read.content[0].text, '渠道,销量\nA,49');
  assert.equal(read.details.relativePath, '020_clean/' + input);
  const written = await port('write-report', { filename: report, content: '合成报告' }, context);
  assert.equal(written.details.relativePath, '060_reports/' + report);
  assert.deepEqual(await fs.readdir(path.join(project.rootPath, '060_reports')), [report]);
});

test('report publication removes only a proven new link if the staging name changes at link time', async t => {
  const { project, context, port } = await fixture(t);
  const directory = path.join(project.rootPath, '060_reports');
  const target = path.join(directory, '报告.md');
  const link = fs.link;
  let replacement: string | undefined;
  t.mock.method(fs, 'link', async (staging: Parameters<typeof link>[0], destination: Parameters<typeof link>[1]) => {
    if (destination === target) {
      replacement = String(staging);
      await fs.rename(staging, path.join(directory, 'moved-staging.tmp'));
      await fs.writeFile(staging, 'unrelated synthetic content');
    }
    return link(staging, destination);
  });
  await assert.rejects(port('write-report', { filename: '报告.md', content: 'requested synthetic content' }, context), /report_publication_unverified/);
  assert.ok(replacement);
  assert.equal(await fs.readFile(replacement, 'utf8'), 'unrelated synthetic content');
  await assert.rejects(fs.lstat(target), { code: 'ENOENT' });
});

test('bound tools reject paths and links and identify the file bytes actually read', async t => {
  const { root, project, context, port } = await fixture(t);
  const outside = path.join(root, 'other.txt');
  const input = path.join(project.rootPath, '020_clean', '资料.txt');
  await fs.writeFile(outside, 'outside fixture');
  await fs.symlink(outside, path.join(project.rootPath, '020_clean', '链接.txt'));
  await fs.symlink(outside, path.join(project.rootPath, '060_reports', '链接.txt'));
  await assert.rejects(port('read-input', { filename: '../other.txt' }, context), /invalid_input_filename/);
  await assert.rejects(port('read-input', { filename: '链接.txt' }, context), /unsafe_file_path/);
  await assert.rejects(port('write-report', { filename: '../other.txt', content: 'blocked' }, context), /invalid_report_arguments/);
  await assert.rejects(port('write-report', { filename: '链接.txt', content: 'blocked' }, context), /unsafe_file_path/);
  assert.equal(await fs.readFile(outside, 'utf8'), 'outside fixture');
  await fs.writeFile(input, 'first version');
  const first = await port('read-input', { filename: '资料.txt' }, context);
  await fs.writeFile(input, 'second version');
  const second = await port('read-input', { filename: '资料.txt' }, context);
  assert.equal(first.content[0].text, 'first version');
  assert.equal(first.details.sha256, createHash('sha256').update('first version').digest('hex'));
  assert.equal(second.content[0].text, 'second version');
  assert.equal(second.details.sha256, createHash('sha256').update('second version').digest('hex'));
});
