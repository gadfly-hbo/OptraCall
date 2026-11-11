import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile, mkdir, writeFile, unlink } from 'node:fs/promises';
import path from 'node:path';
import { startLegacyTestHost as startTestHost } from './fixtures/host-process.ts'; // Explicit pre-cutover contract; default Host is tested separately.
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
  assert.match(first, /条件不足、无法计算或保留未知也可以作为本轮回复/);
  assert.ok(!first.includes('实际运行并保存依据'), 'Cold completion is not conditional on executing a prescribed tool');
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
  await readJson(await host.request(`${route}/${input.verificationId}/author-revision`, 'POST', {}), 202);
  await until(async () => readJson(await host.request(`${route}/${input.verificationId}`)), value => value.verification.revision?.status === 'completed');
  await readJson(await host.request(`${route}/${input.verificationId}/recheck`, 'POST', {}), 202);
  const rechecked = await until(async () => readJson(await host.request(`${route}/${input.verificationId}`)), value => value.verification.status === 'completed' && value.verification.phase === 'recheck');
  const lastUser = provider.requests[3]!.body.messages?.filter(message => message.role === 'user').at(-1);
  const recheckPrompt = JSON.stringify(lastUser?.content);
  assert.match(recheckPrompt, /完整固定稿可按需自主读取/); assert.match(recheckPrompt, /新增主张/);
  assert.ok(!recheckPrompt.includes('请仅复查此前差异'));
  assert.equal(rechecked.verification.contextEvidence.revisionAssociation.status, 'recorded');
  assert.equal(rechecked.verification.contextEvidence.revisionAssociation.revisionRequestId, rechecked.verification.authorRevision.requestId);
  assert.equal(rechecked.verification.contextEvidence.revisionAssociation.recheckRequestId, rechecked.verification.recheckResult.requestId);
  assert.equal(provider.requests.length, 4, 'No-tool replies complete without an internal tool-count or professional gate');
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

test('BC context: actual author slices preserve all fixed locations and read back recorded ranges', { timeout: 60_000 }, async t => {
  const provider = await startSyntheticProvider(), host = await startTestHost();
  t.after(async () => { await host.close(); await provider.close(); });
  await readJson(await host.request('/api/configuration', 'PUT', { name: '范围合成模型', provider: 'openai-compatible', baseUrl: provider.baseUrl, model: 'synthetic-model', apiKey: 'synthetic-key' }));
  const { project } = await readJson(await host.request('/api/projects', 'POST', { name: '范围证据项目' }), 201);
  const { task } = await readJson(await host.request(`/api/projects/${project.id}/tasks`, 'POST', { name: '范围核算' }), 201);
  await readJson(await host.request(`/api/projects/${project.id}/files/upload`, 'POST', { directory: '020_clean', name: 'source.csv', content: Buffer.from('amount\n10\n').toString('base64') }), 201);
  const reports = [
    { name: 'range-a.md', text: 'A'.repeat(3999) + '😀TAIL' },
    { name: 'range-b.md', text: 'B'.repeat(4500) },
    { name: 'range-c.md', text: 'C'.repeat(4500) },
    { name: 'range-d.md', text: 'D'.repeat(40) },
    { name: 'range-e.md', text: 'E'.repeat(40) },
  ];
  for (const report of reports) await readJson(await host.request(`/api/projects/${project.id}/files/save-report`, 'POST', report), 201);
  const route = `/api/projects/${project.id}/tasks/${task.id}/verifications`;
  const input = { verificationId: randomUUID(), question: '核对固定资料，缺少前提可以保留未知。', dataFiles: ['020_clean/source.csv'], authorFiles: reports.map(report => `060_reports/${report.name}`) };
  await readJson(await host.request(route, 'POST', input), 202);
  const result = await until(async () => readJson(await host.request(`${route}/${input.verificationId}`)), value => ['completed','failed','cancelled','unknown'].includes(value.verification.status));
  assert.equal(result.verification.status, 'completed', JSON.stringify(result));
  const evidence = result.verification.contextEvidence;
  assert.equal(evidence?.provided.status, 'recorded', 'Actual native request must carry its observed ranges');
  assert.equal(evidence.provided.fragments.length, 5, 'Zero-body files still retain their fixed-copy location');
  assert.deepEqual(evidence.provided.fragments.map((file: any) => file.end), [3999, 4000, 4000, 1, 0]);
  assert.deepEqual(evidence.provided.fragments.map((file: any) => file.totalLength), [4005, 4500, 4500, 40, 40]);
  assert.equal(evidence.provided.fragments[0].text, 'A'.repeat(3999), 'A Unicode surrogate pair is not split');
  assert.equal(evidence.provided.fragments[4].text, '');
  for (const [index, report] of reports.entries()) {
    const fragment = evidence.provided.fragments[index];
    assert.equal(fragment.relativePath, `060_reports/${report.name}`);
    assert.match(fragment.fixedPath, /author[/\\]060_reports[/\\]range-/);
    assert.match(evidence.provided.requestText, new RegExp(report.name.replace('.', '\\.')));
  }
  assert.equal(evidence.reads.status, 'unrecorded');
  assert.deepEqual(evidence.reads.items, [], 'No captured tool call must not become proof of a read');
  assert.equal(provider.requests.length, 2);
  await readJson(await host.request(`${route}/${input.verificationId}`));
  assert.equal(provider.requests.length, 2, 'Evidence GET does not dispatch another turn');
});

test('BC context: preview If-Match rejects changed source bytes and a duplicate intent only reads back', { timeout: 60_000 }, async t => {
  const provider = await startSyntheticProvider(), host = await startTestHost();
  t.after(async () => { await host.close(); await provider.close(); });
  await readJson(await host.request('/api/configuration', 'PUT', { name: '条件提交模型', provider: 'openai-compatible', baseUrl: provider.baseUrl, model: 'synthetic-model', apiKey: 'synthetic-key' }));
  const { project } = await readJson(await host.request('/api/projects', 'POST', { name: '预览条件项目' }), 201);
  const { task } = await readJson(await host.request(`/api/projects/${project.id}/tasks`, 'POST', { name: '预览条件核算' }), 201);
  await readJson(await host.request(`/api/projects/${project.id}/files/upload`, 'POST', { directory: '020_clean', name: 'source.csv', content: Buffer.from('amount\n10\n').toString('base64') }), 201);
  await readJson(await host.request(`/api/projects/${project.id}/files/save-report`, 'POST', { name: 'author.md', text: '原固定报告。' }), 201);
  const route = `/api/projects/${project.id}/tasks/${task.id}/verifications`;
  const input = { verificationId: randomUUID(), question: '核对本次预览选材。', dataFiles: ['020_clean/source.csv'], authorFiles: ['060_reports/author.md'] };
  const first = await readJson(await host.request(`${route}/preview`, 'POST', input));
  assert.match(first.etag, /^"[a-f0-9]{64}"$/);
  assert.equal(first.selectedMaterials.authorFiles[0].textStatus, 'utf8');
  assert.equal(provider.requests.length, 0);
  await writeFile(path.join(project.rootPath, '060_reports/author.md'), '预览后同路径的新字节。');
  const send = (etag: string) => fetch(host.baseUrl + route, { method: 'POST', headers: { ...host.headers, 'if-match': etag }, body: JSON.stringify(input) });
  const mismatch = await readJson(await send(first.etag), 409);
  assert.equal(mismatch.code, 'verification_preview_changed');
  assert.equal(provider.requests.length, 0, 'A failed precondition cannot register or dispatch');
  await readJson(await host.request(`${route}/${input.verificationId}`), 404);
  const second = await readJson(await host.request(`${route}/preview`, 'POST', { ...input, verificationId: randomUUID() }));
  assert.notEqual(second.etag, first.etag);
  await readJson(await send(second.etag), 202);
  const settled = await until(async () => readJson(await host.request(`${route}/${input.verificationId}`)), value => ['completed','failed','cancelled','unknown'].includes(value.verification.status));
  assert.equal(settled.verification.status, 'completed');
  const before = await readFile(path.join(host.dataRoot, 'analysis-verifications', project.id, task.id, input.verificationId, 'record.json'));
  await writeFile(path.join(project.rootPath, '060_reports/author.md'), '既有意图之后又变化，不应重读或重跑。');
  await readJson(await send(second.etag), 200);
  assert.equal(provider.requests.length, 2);
  assert.deepEqual(await readFile(path.join(host.dataRoot, 'analysis-verifications', project.id, task.id, input.verificationId, 'record.json')), before);
});

test('BC context: missing selected data or author files are explicit 409 refusals before registration', { timeout: 60_000 }, async t => {
  const provider = await startSyntheticProvider(), host = await startTestHost();
  t.after(async () => { await host.close(); await provider.close(); });
  await readJson(await host.request('/api/configuration', 'PUT', { name: '缺失材料合成模型', provider: 'openai-compatible', baseUrl: provider.baseUrl, model: 'synthetic-model', apiKey: 'synthetic-key' }));
  for (const missing of ['020_clean/source.csv', '060_reports/author.md']) {
    const { project } = await readJson(await host.request('/api/projects', 'POST', { name: `缺失选材-${missing}` }), 201);
    const { task } = await readJson(await host.request(`/api/projects/${project.id}/tasks`, 'POST', { name: '保留原任务' }), 201);
    await readJson(await host.request(`/api/projects/${project.id}/files/upload`, 'POST', { directory: '020_clean', name: 'source.csv', content: Buffer.from('amount\n10\n').toString('base64') }), 201);
    await readJson(await host.request(`/api/projects/${project.id}/files/save-report`, 'POST', { name: 'author.md', text: '应保留的作者报告。' }), 201);
    await readJson(await host.request(`/api/projects/${project.id}/files/save-report`, 'POST', { name: 'retained.md', text: '不相关的已有文件，保持原位。' }), 201);
    const route = `/api/projects/${project.id}/tasks/${task.id}/verifications`;
    const input = { verificationId: randomUUID(), question: '只核本次明确选择的材料。', dataFiles: ['020_clean/source.csv'], authorFiles: ['060_reports/author.md'] };
    const beforeTask = await readJson(await host.request(`/api/projects/${project.id}/tasks/${task.id}`));
    await readJson(await host.request(`${route}/preview`, 'POST', input));
    await unlink(path.join(project.rootPath, missing));
    for (const endpoint of [`${route}/preview`, route]) {
      const refused = await readJson(await host.request(endpoint, 'POST', input), 409);
      assert.equal(refused.code, 'verification_source_missing');
    }
    assert.deepEqual((await readJson(await host.request(route))).verifications, []);
    await readJson(await host.request(`${route}/${input.verificationId}`), 404);
    assert.equal(provider.requests.length, 0, 'A missing selected file cannot reach the Provider');
    assert.deepEqual((await readJson(await host.request(`/api/projects/${project.id}/tasks/${task.id}`))).task, beforeTask.task);
    assert.equal(await readFile(path.join(project.rootPath, '060_reports/retained.md'), 'utf8'), '不相关的已有文件，保持原位。');
    const survivor = missing.startsWith('020_clean/') ? '060_reports/author.md' : '020_clean/source.csv';
    assert.equal(await readFile(path.join(project.rootPath, survivor), 'utf8'), survivor.startsWith('020_clean/') ? 'amount\n10\n' : '应保留的作者报告。');
    await assert.rejects(readFile(path.join(project.rootPath, missing)), { code: 'ENOENT' }, 'Refusal must not recreate the missing input');
  }
});
