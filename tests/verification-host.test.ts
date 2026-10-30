import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { startTestHost } from './fixtures/host-process.ts';
import { startSyntheticProvider } from './fixtures/synthetic-provider.ts';
import { readJson } from './fixtures/joint-context.ts';

async function until(read: () => Promise<any>, done: (value: any) => boolean) {
  const deadline = Date.now() + 15_000;
  for (;;) { const value = await read(); if (done(value)) return value; if (Date.now() > deadline) assert.fail(`Verification did not settle: ${JSON.stringify(value)}`); await new Promise(resolve => setTimeout(resolve, 20)); }
}
test('SV04–08: explicit task verification uses a fresh two-turn session and preserves the author', { timeout: 60_000 }, async t => {
  const provider = await startSyntheticProvider(), host = await startTestHost();
  t.after(async () => { await host.close(); await provider.close(); });
  await readJson(await host.request('/api/configuration', 'PUT', { name: '核算合成模型', provider: 'openai-compatible', baseUrl: provider.baseUrl, model: 'synthetic-model', apiKey: 'synthetic-key' }));
  const { project } = await readJson(await host.request('/api/projects', 'POST', { name: '合成核算项目' }), 201);
  const { task } = await readJson(await host.request(`/api/projects/${project.id}/tasks`, 'POST', { name: '原分析任务' }), 201);
  await readJson(await host.request(`/api/projects/${project.id}/files/upload`, 'POST', { directory: '020_clean', name: 'source.csv', content: Buffer.from('channel,amount\nA,10\nB,20\n').toString('base64') }), 201);
  await readJson(await host.request(`/api/projects/${project.id}/files/save-report`, 'POST', { name: 'author.md', text: 'AUTHOR_ONLY_MARKER：总额30。' }), 201);
  const route = `/api/projects/${project.id}/tasks/${task.id}/verifications`;
  const input = { verificationId: randomUUID(), question: '核算渠道总额，保留具体依据。', dataFiles: ['020_clean/source.csv'], authorFiles: ['060_reports/author.md'] };
  const original = await readJson(await host.request(`/api/projects/${project.id}/tasks/${task.id}`));
  await readJson(await host.request(route, 'POST', input), 202);
  const result = await until(async () => readJson(await host.request(`${route}/${input.verificationId}`)), x => ['completed','failed','cancelled','unknown'].includes(x.verification.status));
  assert.equal(result.verification.status, 'completed', JSON.stringify(result));
  assert.equal(provider.requests.length, 2);
  const first = JSON.stringify(provider.requests[0]!.body.messages), second = JSON.stringify(provider.requests[1]!.body.messages);
  assert.ok(!first.includes('AUTHOR_ONLY_MARKER') && !first.includes('author.md'), 'Cold prompt must not contain target answer or path');
  assert.match(second, /AUTHOR_ONLY_MARKER/);
  const after = await readJson(await host.request(`/api/projects/${project.id}/tasks/${task.id}`));
  assert.deepEqual(after.task, original.task);
  assert.equal(await readFile(path.join(project.rootPath, '060_reports/author.md'), 'utf8'), 'AUTHOR_ONLY_MARKER：总额30。');
  await readJson(await host.request(route, 'POST', input), 200);
  await readJson(await host.request(route, 'POST', { ...input, question: '不同载荷' }), 409);
  assert.equal(provider.requests.length, 2, 'GET and duplicate intent must not replay models');
  const exports = await Promise.all(Array.from({ length: 5 }, () => host.request(`${route}/${input.verificationId}/export`, 'POST', {})));
  assert.deepEqual(exports.map(response => response.status), [201,201,201,201,201]);
  const tree = await readJson(await host.request(`/api/projects/${project.id}/files`));
  const savedReports = tree.files.find((node: any) => node.path === '060_reports').children.filter((node: any) => node.name.startsWith(`verification-${input.verificationId}`));
  assert.equal(savedReports.length, 1, 'Concurrent exports must share one unchanged snapshot');
});

test('a corrupt verification record reports feature unavailability without blocking preserved projects', { timeout: 30_000 }, async t => {
  const first = await startTestHost(); t.after(() => first.close());
  await readJson(await first.request('/api/configuration', 'PUT', { name: '隔离配置', provider: 'openai-compatible', baseUrl: 'http://127.0.0.1:1/v1', model: 'synthetic-model', apiKey: 'synthetic-key' }));
  const { project } = await readJson(await first.request('/api/projects', 'POST', { name: '需保留的项目' }), 201);
  const { task } = await readJson(await first.request(`/api/projects/${project.id}/tasks`, 'POST', { name: '需保留的任务' }), 201);
  await first.close();
  const badDirectory = path.join(first.dataRoot, 'analysis-verifications', project.id, task.id, randomUUID());
  await mkdir(badDirectory, { recursive: true }); await writeFile(path.join(badDirectory, 'record.json'), '{}');
  const reopened = await startTestHost({ dataRoot: first.dataRoot, projectsRoot: first.projectsRoot }); t.after(() => reopened.close());
  await readJson(await reopened.request('/api/health'));
  assert.equal((await readJson(await reopened.request(`/api/projects/${project.id}`))).project.name, '需保留的项目');
  assert.equal((await readJson(await reopened.request(`/api/projects/${project.id}/tasks/${task.id}`))).task.name, '需保留的任务');
  await readJson(await reopened.request(`/api/projects/${project.id}/tasks/${task.id}/verifications`), 503);
  assert.equal(await readFile(path.join(badDirectory, 'record.json'), 'utf8'), '{}');
});
