import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { startTestHost } from './fixtures/host-process.ts';
import { startSyntheticProvider } from './fixtures/synthetic-provider.ts';
import { readJson } from './fixtures/joint-context.ts';

test('BC fixed author download preserves the selected bytes, owner and original record', { timeout: 60_000 }, async t => {
  const host = await startTestHost(), provider = await startSyntheticProvider();
  t.after(async () => { await host.close(); await provider.close(); });
  await readJson(await host.request('/api/configuration', 'PUT', { name: '固定全文合成配置', provider: 'openai-compatible', baseUrl: provider.baseUrl, model: 'synthetic-model', apiKey: 'synthetic-key' }));
  const { project } = await readJson(await host.request('/api/projects', 'POST', { name: '固定全文隔离项目' }), 201);
  const { task } = await readJson(await host.request(`/api/projects/${project.id}/tasks`, 'POST', { name: '核算所属任务' }), 201);
  const other = (await readJson(await host.request(`/api/projects/${project.id}/tasks`, 'POST', { name: '其他任务' }), 201)).task;
  await readJson(await host.request(`/api/projects/${project.id}/files/upload`, 'POST', { name: 'source.csv', directory: '020_clean', content: Buffer.from('amount\n10\n').toString('base64') }), 201);
  const original = Buffer.from('\uFEFF原固定作者稿\r\n' + '甲'.repeat(100_008) + '\r\n结尾😀');
  const binary = Buffer.from([0, 255, 128, 65, 66, 0]);
  await readJson(await host.request(`/api/projects/${project.id}/files/save-report`, 'POST', { name: 'author.md', text: original.toString('utf8') }), 201);
  // Local project files may be produced by native tools; the text upload API
  // deliberately keeps its own UTF-8 validation.
  await writeFile(path.join(project.rootPath, '020_clean', 'appendix.csv'), binary);
  const route = `/api/projects/${project.id}/tasks/${task.id}/verifications`, id = randomUUID();
  await readJson(await host.request(route, 'POST', { verificationId: id, question: '核对所选固定材料，不能确认的内容保留未知。', dataFiles: ['020_clean/source.csv'], authorFiles: ['060_reports/author.md', '020_clean/appendix.csv'] }), 202);
  const deadline = Date.now() + 20_000;
  let state: any;
  do {
    state = (await readJson(await host.request(`${route}/${id}`))).verification;
    if (['completed', 'failed', 'cancelled', 'unknown'].includes(state.status)) break;
    await new Promise(resolve => setTimeout(resolve, 20));
  } while (Date.now() < deadline);
  assert.equal(state.status, 'completed', JSON.stringify(state));
  const recordPath = path.join(host.dataRoot, 'analysis-verifications', project.id, task.id, id, 'record.json');
  const beforeRecord = await readFile(recordPath), nativePath = state.native.sessionFile, beforeNative = await readFile(nativePath);
  const fixedRoute = `${route}/${id}/author-file?path=`;
  const first = await host.request(fixedRoute + encodeURIComponent('060_reports/author.md'));
  assert.equal(first.status, 200, await first.clone().text());
  assert.equal(first.headers.get('content-type'), 'application/octet-stream');
  assert.match(first.headers.get('content-disposition') ?? '', /^attachment;/);
  assert.equal(first.headers.get('cache-control'), 'no-store');
  assert.equal(first.headers.get('x-content-type-options'), 'nosniff');
  assert.deepEqual(Buffer.from(await first.arrayBuffer()), original, 'A fixed download includes BOM, line endings and text beyond the UI excerpt');
  await writeFile(path.join(project.rootPath, '060_reports', 'author.md'), '后来同名源稿，不是本次固定稿');
  const again = await host.request(fixedRoute + encodeURIComponent('060_reports/author.md'));
  assert.equal(again.status, 200);
  assert.deepEqual(Buffer.from(await again.arrayBuffer()), original, 'Later source edits cannot replace the fixed author snapshot');
  const raw = await host.request(fixedRoute + encodeURIComponent('020_clean/appendix.csv'));
  assert.equal(raw.status, 200);
  assert.deepEqual(Buffer.from(await raw.arrayBuffer()), binary, 'Non UTF-8 bytes remain downloadable without inventing text');
  for (const invalid of ['020_clean/source.csv', '../record.json', '/etc/passwd']) {
    const response = await host.request(fixedRoute + encodeURIComponent(invalid));
    assert.ok(response.status === 400 || response.status === 404, `Unselected path must be refused: ${invalid} (${response.status})`);
    assert.match(response.headers.get('content-type') ?? '', /application\/json/);
    assert.equal(response.headers.get('content-disposition'), null, 'An error must not masquerade as a downloaded file');
  }
  const wrongOwner = await host.request(`/api/projects/${project.id}/tasks/${other.id}/verifications/${id}/author-file?path=${encodeURIComponent('060_reports/author.md')}`);
  assert.equal(wrongOwner.status, 404);
  assert.deepEqual(await readFile(recordPath), beforeRecord, 'Read-only download never changes the saved record');
  assert.deepEqual(await readFile(nativePath), beforeNative, 'Read-only download never opens or appends native history');
  assert.equal(provider.requests.length, 2, 'Only the original two business turns reached the provider');
});
