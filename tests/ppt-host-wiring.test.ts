import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { startTestHost } from './fixtures/host-process.ts';
import { startToolProvider } from './fixtures/tool-provider.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fixture = path.join(root, 'tests/fixtures/ppt-report/deck-good.pptx');
type Host = Awaited<ReturnType<typeof startTestHost>>;
async function json(response: Response, status = 200): Promise<any> { assert.equal(response.status, status, await response.clone().text()); return response.json(); }
async function prepare(host: Host, baseUrl: string) {
  const { configuration } = await json(await host.request('/api/configuration', 'PUT', { name: 'PPT项目模型A', provider: 'openai-compatible', baseUrl, model: 'synthetic-ppt-a', apiKey: 'synthetic-ppt-a-key' }));
  const { project } = await json(await host.request('/api/projects', 'POST', { name: 'PPT合成项目', configurationId: configuration.id }), 201);
  await fs.copyFile(fixture, path.join(project.rootPath, '060_reports/candidate.pptx'));
  await fs.writeFile(path.join(project.rootPath, '060_reports/report.md'), '# Synthetic report\nRevenue 100.\n');
  const body = { id: `deck-${randomUUID()}`, projectId: project.id, sourcePptx: '060_reports/candidate.pptx', reportPath: '060_reports/report.md', title: '项目候选版' };
  return { configuration, project, body };
}

test('PW01: real Host binds report refinement to its project model, not global selection', { timeout: 60_000 }, async t => {
  const provider = await startToolProvider(); t.after(() => provider.close());
  const host = await startTestHost(); t.after(() => host.close());
  const { project, configuration, body } = await prepare(host, provider.baseUrl);
  await json(await host.request('/api/configuration', 'PUT', { name: '全局当前模型B', provider: 'openai-compatible', baseUrl: provider.baseUrl, model: 'synthetic-ppt-b', apiKey: 'synthetic-ppt-b-key' }));
  const created = await json(await host.request('/api/ppt-refiner/decks', 'POST', body), 201);
  assert.deepEqual(created.meta.configuration, { id: configuration.id, revision: configuration.revision });
  const read = await json(await host.request(`/api/ppt-refiner/decks/${body.id}`));
  assert.equal(read.projectId, project.id);
  assert.equal(read.readOnly, false);
  assert.equal(read.imageInputSupported, false, 'the locked SDK treats an unknown custom model as text-only');
  await json(await host.request(`/api/ppt-refiner/decks/${body.id}/turns`, 'POST', { text: '只说明当前任务，不修改文件。', requestId: randomUUID() }));
  assert.equal(provider.requests.at(-1)?.body.model, 'synthetic-ppt-a');
  const listed = await json(await host.request('/api/ppt-refiner/decks'));
  assert.equal(listed.decks.find((deck: any) => deck.meta.id === body.id).projectId, project.id);
});

test('PW08: ordinary report generation uses the actual Host skill loader and an independent project task', { timeout: 60_000 }, async t => {
  const provider = await startToolProvider(); t.after(() => provider.close());
  const host = await startTestHost(); t.after(() => host.close());
  const { project } = await prepare(host, provider.baseUrl);
  const { task } = await json(await host.request(`/api/projects/${project.id}/tasks`, 'POST', { name: 'PPT生成合成任务' }), 201);
  assert.equal(provider.requests.length, 0, 'creating the task never calls a model');
  await json(await host.request(`/api/projects/${project.id}/tasks/${task.id}/messages`, 'POST', { text: '合成检查：只回复已收到，不执行工具。', requestId: randomUUID() }), 202);
  await provider.waitForRequests(1);
  const input = JSON.stringify(provider.requests[0]!.body.messages);
  assert.match(input, /ppt-report/);
  assert.match(input, /PPT/);
  assert.equal(provider.requests[0]!.body.model, 'synthetic-ppt-a');
  const read = await json(await host.request(`/api/projects/${project.id}/tasks/${task.id}`));
  assert.equal(read.task.id, task.id);
});

test('PW01/PW06: real Host rejects absolute, cross-project and original-directory refinement paths without changing originals', async t => {
  const host = await startTestHost(); t.after(() => host.close());
  const { project, body } = await prepare(host, 'http://127.0.0.1:1/v1');
  const raw = path.join(project.rootPath, '010_draw/original.pptx'); await fs.copyFile(fixture, raw);
  const before = await fs.readFile(raw);
  assert.equal((await host.request('/api/ppt-refiner/decks', 'POST', { ...body, sourcePptx: raw })).status, 400);
  assert.equal((await host.request('/api/ppt-refiner/decks', 'POST', { ...body, sourcePptx: '010_draw/original.pptx' })).status, 400);
  await json(await host.request('/api/ppt-refiner/decks', 'POST', body), 201);
  assert.equal((await host.request(`/api/ppt-refiner/decks/${body.id}/export`, 'POST', { outDir: path.dirname(raw), fileName: 'original.pptx' })).status, 400);
  assert.deepEqual(await fs.readFile(raw), before);
  const exported = await json(await host.request(`/api/ppt-refiner/decks/${body.id}/export`, 'POST', { fileName: 'final.pptx' }));
  assert(exported.pptx.startsWith(path.join(project.rootPath, '060_reports') + path.sep));
  const exportedBefore = await fs.readFile(exported.pptx);
  assert.equal((await host.request(`/api/ppt-refiner/decks/${body.id}/export`, 'POST', { fileName: 'final.pptx' })).status, 409);
  assert.deepEqual(await fs.readFile(exported.pptx), exportedBefore);
  const { project: other } = await json(await host.request('/api/projects', 'POST', { name: '另一个合成项目' }), 201);
  assert.equal((await host.request('/api/ppt-refiner/decks', 'POST', { ...body, id: `deck-${randomUUID()}`, projectId: other.id })).status, 400);
});

test('PW02/PW03/PW04: active refinement blocks project archive and file mutations; stop drains before archive', { timeout: 60_000 }, async t => {
  const provider = await startToolProvider(); t.after(() => provider.close());
  const host = await startTestHost(); t.after(() => host.close());
  const { project, body } = await prepare(host, provider.baseUrl);
  const created = await json(await host.request('/api/ppt-refiner/decks', 'POST', body), 201);
  provider.setResponder(() => ({ text: '合成在途回复', hold: true }));
  const pending = host.request(`/api/ppt-refiner/decks/${body.id}/turns`, 'POST', { text: '等候用户停止，不修改。', requestId: randomUUID() });
  await provider.waitForRequests(1);
  assert.equal((await host.request(`/api/projects/${project.id}/archive`, 'POST', {})).status, 409);
  for (const [action, input] of [['revert', { version: 1 }], ['locks', { page: 2 }], ['export', { fileName: 'busy.pptx' }]] as const) {
    assert.equal((await host.request(`/api/ppt-refiner/decks/${body.id}/${action}`, 'POST', input)).status, 409, action);
  }
  const beforeStop = await fs.readFile(created.deckPath);
  assert.equal((await host.request(`/api/ppt-refiner/decks/${body.id}/turns`, 'POST', { text: '第二轮', requestId: randomUUID() })).status, 409);
  assert.deepEqual(await fs.readFile(created.deckPath), beforeStop);
  await json(await host.request(`/api/ppt-refiner/decks/${body.id}/stop`, 'POST', {}));
  const stopped = await json(await pending, 409); assert.equal(stopped.outcome, 'cancelled');
  const read = await json(await host.request(`/api/ppt-refiner/decks/${body.id}`)); assert.equal(read.versions.length, 1);
  await json(await host.request(`/api/projects/${project.id}/archive`, 'POST', {}));
  assert.equal((await json(await host.request(`/api/ppt-refiner/decks/${body.id}`))).readOnly, true);
  assert.equal((await host.request(`/api/ppt-refiner/decks/${body.id}/turns`, 'POST', { text: '已归档不能派发', requestId: randomUUID() })).status, 409);
  assert.equal((await host.request(`/api/ppt-refiner/decks/${body.id}/export`, 'POST', { fileName: 'archived.pptx' })).status, 409);
  assert.equal(provider.requests.length, 1, 'rejected requests and reads cannot create another model operation');
});

test('PW05: actual SDK corruption fails protection, preserves before state, blocks export and recovers only by explicit revert', { timeout: 60_000 }, async t => {
  const provider = await startToolProvider(); t.after(() => provider.close());
  const host = await startTestHost(); t.after(() => host.close());
  const { body } = await prepare(host, provider.baseUrl);
  const created = await json(await host.request('/api/ppt-refiner/decks', 'POST', body), 201);
  const before = await fs.readFile(created.deckPath);
  provider.setResponder(context => context.recentToolResults.length ? { text: '合成写入完成' } : { calls: [{ name: 'write', arguments: { path: 'deck.pptx', content: 'SYNTHETIC INVALID ZIP' } }] });
  const failed = await json(await host.request(`/api/ppt-refiner/decks/${body.id}/turns`, 'POST', { text: '合成失败注入：用write把deck.pptx写成指定测试串。', requestId: randomUUID() }), 422);
  assert.equal(failed.outcome, 'failed'); assert.equal(failed.code, 'protection_failed'); assert.equal(failed.snapshot, null);
  const deckDir = path.dirname(created.deckPath), files = await fs.readdir(deckDir);
  const backup = files.find(file => file.startsWith('.before-') && file.endsWith('.pptx')); assert(backup);
  assert.deepEqual(await fs.readFile(path.join(deckDir, backup)), before);
  assert.equal((await host.request(`/api/ppt-refiner/decks/${body.id}/export`, 'POST', { fileName: 'must-not-export.pptx' })).status, 409);
  await json(await host.request(`/api/ppt-refiner/decks/${body.id}/revert`, 'POST', { version: 1 }));
  assert.deepEqual(await fs.readFile(created.deckPath), before);
  await json(await host.request(`/api/ppt-refiner/decks/${body.id}/export`, 'POST', { fileName: 'recovered.pptx' }));
  assert((await fs.readdir(deckDir)).some(file => file.startsWith('.recovered-before-')), 'explicit recovery must preserve the failed run evidence');
});
