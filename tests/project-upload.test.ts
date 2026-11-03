import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { ProjectStore, type ProjectConfiguration } from '../src/host/project-store.ts';
import { startTestHost } from './fixtures/host-process.ts';
import { startSyntheticProvider } from './fixtures/synthetic-provider.ts';

const configuration: ProjectConfiguration = { id: 'synthetic-upload', revision: 1, name: '上传合成模型', provider: 'openai-compatible', model: 'synthetic-upload', baseUrl: 'http://127.0.0.1:1/v1' };
const limit = 50 * 1024 * 1024;
async function fixture(t: { after: (fn: () => Promise<void>) => void }) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'optracall-upload-'));
  const options = { dataRoot: path.join(root, 'private'), projectsRoot: path.join(root, 'projects') };
  const store = new ProjectStore(options); await store.init();
  t.after(async () => { await store.close(); await fs.rm(root, { recursive: true, force: true }); });
  return { store, options };
}
async function json(response: Response, status = 200): Promise<any> { assert.equal(response.status, status, await response.clone().text()); return response.json(); }

test('TR01: project document, webpage and Office uploads preserve binary bytes through raw-to-clean and restart', async t => {
  const { store, options } = await fixture(t), project = await store.create({ name: '合成多格式资料', configuration });
  const bytes = Buffer.from([0x25, 0x50, 0x44, 0x46, 0x00, 0xff, 0xfe, 0x80]);
  for (const extension of ['PDF', 'doc', 'docx', 'rtf', 'html', 'htm', 'mhtml', 'mht', 'ppt', 'pptx', 'xls', 'xlsx', 'xlsm', 'odt', 'ods', 'odp']) {
    const file = await store.upload({ projectId: project.id, name: `合成资料.${extension}`, bytes });
    assert.equal(file.path, `010_draw/合成资料.${extension}`);
    assert.equal(file.bytes, bytes.length); assert.equal(file.sha256, createHash('sha256').update(bytes).digest('hex'));
    const duplicate = await store.upload({ projectId: project.id, name: `合成资料.${extension}`, bytes: Buffer.from([0x00, 0xff]) });
    assert.notEqual(duplicate.path, file.path, 'A repeated original filename must not overwrite an existing file.');
    const copy = await store.copyToClean(project.id, file.path);
    assert.equal(copy.path, `020_clean/合成资料.${extension}`); assert.deepEqual(copy.source, { kind: 'copy', from: file.path });
    assert.deepEqual((await store.readFile(project.id, file.path)).bytes, bytes);
    assert.deepEqual((await store.readFile(project.id, copy.path)).bytes, bytes);
  }
  await store.close(); const reopened = new ProjectStore(options); await reopened.init();
  try { assert.equal((await reopened.get(project.id)).uploads.length, 48); assert.deepEqual((await reopened.readFile(project.id, '020_clean/合成资料.PDF')).bytes, bytes); }
  finally { await reopened.close(); }
});

test('TR01: project uploads accept the inclusive 50 MiB boundary and reject excess without attachments', async t => {
  const { store } = await fixture(t), project = await store.create({ name: '合成大小边界', configuration });
  const bytes = Buffer.alloc(limit, 0x61);
  const upload = await store.upload({ projectId: project.id, name: '边界.csv', bytes });
  assert.equal(upload.bytes, limit);
  const copy = await store.copyToClean(project.id, upload.path); assert.equal(copy.bytes, limit);
  assert.equal((await store.readFile(project.id, copy.path)).bytes.length, limit);
  await assert.rejects(async () => store.upload({ projectId: project.id, name: '过大.pdf', bytes: Buffer.alloc(limit + 1) }), /upload_too_large/);
  assert.equal((await store.get(project.id)).uploads.length, 2);
  await assert.rejects(store.saveReport(project.id, '保留报告上限.md', 'a'.repeat(10 * 1024 * 1024 + 1)), /upload_too_large/);
});

test('TR01: text UTF-8, executable, path and archive boundaries survive broader upload formats', async t => {
  const { store } = await fixture(t), project = await store.create({ name: '合成上传保护', configuration });
  for (const extension of ['csv', 'tsv', 'json', 'md', 'markdown', 'txt']) {
    await assert.rejects(async () => store.upload({ projectId: project.id, name: `错误编码.${extension}`, bytes: Buffer.from([0xff]) }), /upload_requires_utf8/);
    const file = await store.upload({ projectId: project.id, name: `正常文本.${extension}`, directory: '020_clean', bytes: Buffer.from('合成文本\n') });
    assert.equal((await store.readFile(project.id, file.path)).bytes.toString(), '合成文本\n');
  }
  for (const name of ['../越界.pdf', '/绝对路径.docx', 'a\\b.xlsx', '隐藏\u0000.pptx', '.pdf', '.csv', 'run.exe', 'run.sh', 'bundle.zip']) {
    await assert.rejects(async () => store.upload({ projectId: project.id, name, bytes: Buffer.from('blocked') }), /invalid_upload_name/);
  }
  await store.archive(project.id);
  await assert.rejects(store.upload({ projectId: project.id, name: '归档.pdf', bytes: Buffer.from([0xff]) }), /project_archived/);
  assert.equal((await store.get(project.id)).uploads.length, 6);
});

test('TR01: HTTP upload/download carries a full 50 MiB document without model calls and rejects malformed base64', { timeout: 60_000 }, async t => {
  const provider = await startSyntheticProvider(); t.after(() => provider.close());
  const host = await startTestHost(); t.after(() => host.close());
  await json(await host.request('/api/configuration', 'PUT', { name: '上传合成模型', provider: 'openai-compatible', baseUrl: provider.baseUrl, model: 'synthetic-upload', apiKey: 'synthetic-upload-key' }));
  const { project } = await json(await host.request('/api/projects', 'POST', { name: 'HTTP合成上传' }), 201);
  const route = `/api/projects/${project.id}/files/upload`, bytes = Buffer.alloc(limit, 0xa5);
  const { file } = await json(await host.request(route, 'POST', { name: '大资料.pdf', directory: '020_clean', content: bytes.toString('base64') }), 201);
  const download = await host.request(`/api/projects/${project.id}/files/content?path=${encodeURIComponent(file.path)}`);
  assert.equal(download.status, 200); assert.equal(download.headers.get('content-type'), 'application/octet-stream');
  assert.deepEqual(Buffer.from(await download.arrayBuffer()), bytes);
  const tooLarge = await json(await host.request(route, 'POST', { name: '过大.pdf', content: Buffer.alloc(limit + 1).toString('base64') }), 400);
  assert.equal(tooLarge.code, 'upload_too_large');
  for (const content of ['%%%%', 'AAAA=', 'AA=A', 'A===', 'A', 'AA==\n', '=AAA']) {
    const rejected = await json(await host.request(route, 'POST', { name: '坏编码.pdf', content }), 400);
    assert.equal(rejected.code, 'invalid_file_encoding');
  }
  assert.equal((await json(await host.request(`/api/projects/${project.id}`))).project.uploads.length, 1);
  assert.equal(provider.requests.length, 0, 'Uploading or downloading documents must not dispatch a model.');
});
