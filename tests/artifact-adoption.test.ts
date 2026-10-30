import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { randomUUID, createHash } from 'node:crypto';
import { ProjectStore } from '../src/host/project-store.ts';
import { CaseStore } from '../src/host/case-store.ts';
import { startTestHost } from './fixtures/host-process.ts';

const configuration = { id: 'synthetic', revision: 1, provider: 'synthetic', model: 'fixture', name: 'fixture', baseUrl: 'http://127.0.0.1:1' };
const digest = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
async function json(response: Response, expected = 200): Promise<any> { assert.equal(response.status, expected, await response.clone().text()); return response.json(); }
async function fixture(t: any) {
  const host = await startTestHost(); t.after(() => host.close());
  await json(await host.request('/api/configuration', 'PUT', { name: '采用版本合成配置', provider: 'openai-compatible', baseUrl: 'http://127.0.0.1:1/v1', model: 'synthetic-adoption', apiKey: 'synthetic-adoption-key' }));
  const { project } = await json(await host.request('/api/projects', 'POST', { name: '原产物项目' }), 201);
  const { task } = await json(await host.request(`/api/projects/${project.id}/tasks`, 'POST', { name: '人工关联任务' }), 201);
  const { file } = await json(await host.request(`/api/projects/${project.id}/files/upload`, 'POST', { name: 'analysis.md', directory: '020_clean', content: Buffer.from('原报告 v1').toString('base64') }), 201);
  await json(await host.request('/api/cases/storage/initialize', 'POST', {}));
  const { case: record } = await json(await host.request('/api/cases', 'POST', { operationId: randomUUID(), title: '采用版本合成Case' }), 201);
  const linked = await json(await host.request(`/api/cases/${record.id}/projects`, 'POST', { operationId: randomUUID(), expectedRevision: 1, projectId: project.id }));
  return { host, project, task, file, record: linked.case };
}

test('ADOPT-FILE: explicit version save copies current stable bytes to a new ordinary report and keeps the source independent', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'optracall-adoption-')), store = new ProjectStore({ dataRoot: path.join(root, 'data'), projectsRoot: path.join(root, 'projects') });
  await store.init(); t.after(async () => { await store.close(); await fs.rm(root, { recursive: true, force: true }); });
  const project = await store.create({ name: '合成版本', configuration });
  const original = await store.upload({ projectId: project.id, directory: '020_clean', name: 'report.md', bytes: Buffer.from('draft') });
  await fs.writeFile(path.join(project.rootPath, original.path), 'current adopted bytes');
  const operationId = randomUUID(), saved = await store.saveArtifactVersion(project.id, original.path, operationId);
  assert.equal(saved.file.path, `060_reports/adopted-${operationId}.md`);
  assert.deepEqual(saved.file.source, { kind: 'copy', from: original.path });
  assert.equal(saved.file.sha256, digest('current adopted bytes'));
  assert.equal(saved.source.sha256, saved.file.sha256); assert.equal(saved.source.bytes, 21); assert.ok(saved.source.observedAt);
  assert.equal(await fs.readFile(path.join(project.rootPath, saved.file.path), 'utf8'), 'current adopted bytes');
  await fs.writeFile(path.join(project.rootPath, original.path), 'later draft');
  assert.equal(await fs.readFile(path.join(project.rootPath, saved.file.path), 'utf8'), 'current adopted bytes');
  assert.equal(await fs.readFile(path.join(project.rootPath, original.path), 'utf8'), 'later draft');
  await assert.rejects(() => store.saveArtifactVersion(project.id, original.path, operationId), /upload_name_conflict/);
  assert.equal((await store.get(project.id)).uploads.length, 2, 'A colliding name must not create another version or replace a file.');
});

test('ADOPT-FILE: reject links, oversized sources, invalid identity and archived writes without changing originals', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'optracall-adoption-guards-')), store = new ProjectStore({ dataRoot: path.join(root, 'data'), projectsRoot: path.join(root, 'projects') });
  await store.init(); t.after(async () => { await store.close(); await fs.rm(root, { recursive: true, force: true }); });
  const project = await store.create({ name: '合成边界', configuration }), original = await store.upload({ projectId: project.id, directory: '020_clean', name: 'source.md', bytes: Buffer.from('preserve') });
  const originalPath = path.join(project.rootPath, original.path);
  await fs.symlink(originalPath, path.join(project.rootPath, '020_clean/link.md'));
  await assert.rejects(() => store.saveArtifactVersion(project.id, '020_clean/link.md', randomUUID()), /unsafe/);
  await fs.link(originalPath, path.join(project.rootPath, '020_clean/hard.md'));
  await assert.rejects(() => store.saveArtifactVersion(project.id, original.path, randomUUID()), /unsafe/);
  await fs.unlink(path.join(project.rootPath, '020_clean/hard.md'));
  await assert.rejects(() => store.saveArtifactVersion(project.id, '../outside', randomUUID()), /invalid|unsafe/);
  await assert.rejects(() => store.saveArtifactVersion(project.id, original.path, '../not-an-id'), /invalid/);
  await fs.writeFile(path.join(project.rootPath, '020_clean/large.bin'), Buffer.alloc(10 * 1024 * 1024 + 1));
  await assert.rejects(() => store.saveArtifactVersion(project.id, '020_clean/large.bin', randomUUID()), /upload_too_large/);
  await store.archive(project.id);
  await assert.rejects(() => store.saveArtifactVersion(project.id, original.path, randomUUID()), /project_archived/);
  assert.equal(await fs.readFile(originalPath, 'utf8'), 'preserve');
  assert.equal((await store.get(project.id)).uploads.length, 1);
  assert.deepEqual(await fs.readdir(path.join(project.rootPath, '060_reports')), []);
});

test('ADOPT-HTTP: save a selected version with provenance, keep dynamic refs, replay only its immutable receipt and detect changed copies', async t => {
  const { host, project, task, file, record } = await fixture(t);
  const dynamic = await json(await host.request(`/api/cases/${record.id}/artifacts`, 'POST', { operationId: randomUUID(), expectedRevision: record.revision, projectId: project.id, relativePath: file.path, role: 'report' }));
  const command = { operationId: randomUUID(), expectedRevision: dynamic.case.revision, projectId: project.id, relativePath: file.path, taskId: task.id, role: 'report', displayName: '明确采用的版本' };
  const saved = await json(await host.request(`/api/cases/${record.id}/artifacts/adopt`, 'POST', command));
  assert.equal(saved.artifact.taskId, task.id); assert.equal(saved.adoption.sourceRelativePath, file.path);
  assert.equal(saved.artifact.observedSha256, file.sha256); assert.notEqual(saved.artifact.relativePath, file.path);
  assert.equal(saved.adoption.sourceSha256, saved.artifact.observedSha256); assert.ok(saved.adoption.savedAt);
  const copied = path.join(project.rootPath, saved.artifact.relativePath);
  assert.equal(await fs.readFile(copied, 'utf8'), '原报告 v1');
  await fs.writeFile(path.join(project.rootPath, file.path), '原报告 v2');
  let detail = await json(await host.request(`/api/cases/${record.id}`));
  assert.equal(detail.artifacts.find((a: any) => a.id === dynamic.artifact.id).availability, 'changed');
  const adopted = detail.artifacts.find((a: any) => a.id === saved.artifact.id);
  assert.equal(adopted.availability, 'available'); assert.deepEqual(adopted.adoptedVersion, saved.adoption);
  assert.equal(detail.events.filter((e: any) => e.operationId === command.operationId).length, 1);
  await json(await host.request(`/api/projects/${project.id}/archive`, 'POST', {}));
  assert.deepEqual(await json(await host.request(`/api/cases/${record.id}/artifacts/adopt`, 'POST', command)), saved, 'Completed retry is read-only even after archive/source edits.');
  assert.equal((await json(await host.request(`/api/cases/${record.id}/artifacts/adopt`, 'POST', { ...command, displayName: 'changed payload' }), 409)).code, 'operation_conflict');
  await fs.writeFile(copied, 'external edit');
  detail = await json(await host.request(`/api/cases/${record.id}`));
  assert.equal(detail.artifacts.find((a: any) => a.id === saved.artifact.id).availability, 'changed');
  assert.equal(detail.artifacts.find((a: any) => a.id === saved.artifact.id).observedSha256, file.sha256);
  assert.deepEqual(await fs.readdir(path.join(project.rootPath, '060_reports')), [path.basename(copied)]);
});

test('ADOPT-DOWNLOAD: expected hash verifies actual bytes, changed copies are rejected, legacy downloads still read current files', async t => {
  const { host, project, file, record } = await fixture(t);
  const saved = await json(await host.request(`/api/cases/${record.id}/artifacts/adopt`, 'POST', { operationId: randomUUID(), expectedRevision: record.revision, projectId: project.id, relativePath: file.path, role: 'report' }));
  const route = `/api/projects/${project.id}/files/content?path=${encodeURIComponent(saved.artifact.relativePath)}`;
  const checked = await host.request(route + `&expectedSha256=${saved.artifact.observedSha256}`);
  assert.equal(checked.status, 200); assert.equal(await checked.text(), '原报告 v1');
  assert.equal((await json(await host.request(route + '&expectedSha256=not-a-digest'), 400)).code, 'invalid_expected_sha256');
  await fs.writeFile(path.join(project.rootPath, saved.artifact.relativePath), 'changed copy, not the adopted version');
  const rejected = await json(await host.request(route + `&expectedSha256=${saved.artifact.observedSha256}`), 409);
  assert.equal(rejected.code, 'artifact_version_changed'); assert.equal(JSON.stringify(rejected).includes('changed copy'), false);
  const legacy = await host.request(route); assert.equal(legacy.status, 200); assert.equal(await legacy.text(), 'changed copy, not the adopted version');
  await fs.unlink(path.join(project.rootPath, saved.artifact.relativePath));
  const detail = await json(await host.request(`/api/cases/${record.id}`));
  assert.equal(detail.artifacts.find((a: any) => a.id === saved.artifact.id).availability, 'missing');
  assert.equal(detail.artifacts.find((a: any) => a.id === saved.artifact.id).observedSha256, file.sha256);
});

test('ADOPT-ADMISSION: invalid task, stale/closed Case, unlinked or archived project never creates an adopted copy', async t => {
  const { host, project, file, record } = await fixture(t);
  const command = { operationId: randomUUID(), expectedRevision: record.revision, projectId: project.id, relativePath: file.path, role: 'report' };
  assert.equal((await json(await host.request(`/api/cases/${record.id}/artifacts/adopt`, 'POST', { ...command, taskId: randomUUID() }), 404)).code, 'task_not_found');
  assert.equal((await json(await host.request(`/api/cases/${record.id}/artifacts/adopt`, 'POST', { ...command, expectedRevision: 1 }), 409)).code, 'case_revision_conflict');
  const { case: second } = await json(await host.request('/api/cases', 'POST', { operationId: randomUUID(), title: '未关联Case' }), 201);
  assert.equal((await json(await host.request(`/api/cases/${second.id}/artifacts/adopt`, 'POST', { ...command, expectedRevision: second.revision }), 409)).code, 'project_not_linked');
  await json(await host.request(`/api/cases/${record.id}/close`, 'POST', { operationId: randomUUID(), expectedRevision: record.revision, reason: '合成结束' }));
  assert.equal((await json(await host.request(`/api/cases/${record.id}/artifacts/adopt`, 'POST', { ...command, expectedRevision: record.revision + 1 }), 409)).code, 'case_closed');
  await json(await host.request(`/api/projects/${project.id}/archive`, 'POST', {}));
  assert.equal((await json(await host.request(`/api/cases/${record.id}/artifacts/adopt`, 'POST', command), 409)).code, 'project_archived');
  assert.deepEqual(await fs.readdir(path.join(project.rootPath, '060_reports')), []);
  assert.equal(await fs.readFile(path.join(project.rootPath, file.path), 'utf8'), '原报告 v1');
  assert.equal((await json(await host.request(`/api/projects/${project.id}`))).project.uploads.length, 1);
});

test('ADOPT-INTERRUPTION: preserved prepared copy is shown for review after restart and the same command never recopies or adopts it', async t => {
  const { host: initial, project, file, task, record } = await fixture(t);
  await initial.close();
  const stores = new ProjectStore({ dataRoot: initial.dataRoot, projectsRoot: initial.projectsRoot }); await stores.init();
  const cases = new CaseStore({ dataRoot: initial.dataRoot }); await cases.init();
  const command = { operationId: randomUUID(), expectedRevision: record.revision, projectId: project.id, relativePath: file.path, role: 'report' as const, taskId: task.id };
  const reserved = cases.reserveArtifactAdoption({ ...command, caseId: record.id });
  assert.equal(reserved.kind, 'artifact_save'); assert.equal(reserved.phase, 'prepared');
  const copy = await stores.saveArtifactVersion(project.id, file.path, command.operationId);
  const metadataPath = path.join(initial.dataRoot, 'projects', project.id, 'project.json');
  const metadataBefore = await fs.readFile(metadataPath), sourceBefore = await fs.readFile(path.join(project.rootPath, file.path)), copyBefore = await fs.readFile(path.join(project.rootPath, copy.file.path));
  cases.close(); await stores.close();
  const host = await startTestHost({ dataRoot: initial.dataRoot, projectsRoot: initial.projectsRoot }); t.after(() => host.close());
  let detail = await json(await host.request(`/api/cases/${record.id}`));
  assert.equal(detail.pendingOperations.length, 1); assert.equal(detail.pendingOperations[0].phase, 'prepared');
  assert.equal(detail.artifacts.length, 0);
  const response = await json(await host.request(`/api/cases/${record.id}/artifacts/adopt`, 'POST', command), 409);
  assert.equal(response.code, 'artifact_adoption_needs_review'); assert.equal(response.details.operationId, command.operationId);
  detail = await json(await host.request(`/api/cases/${record.id}`));
  assert.equal(detail.pendingOperations[0].phase, 'needs_review'); assert.equal(detail.artifacts.length, 0); assert.equal(detail.case.revision, record.revision);
  assert.equal((await json(await host.request(`/api/cases/${record.id}/artifacts/adopt`, 'POST', command), 409)).code, 'artifact_adoption_needs_review');
  assert.equal((await json(await host.request(`/api/cases/${record.id}/artifacts/adopt`, 'POST', { ...command, role: 'file' }), 409)).code, 'operation_conflict');
  assert.deepEqual(await fs.readFile(metadataPath), metadataBefore); assert.deepEqual(await fs.readFile(path.join(project.rootPath, file.path)), sourceBefore); assert.deepEqual(await fs.readFile(path.join(project.rootPath, copy.file.path)), copyBefore);
  assert.deepEqual(await fs.readdir(path.join(project.rootPath, '060_reports')), [path.basename(copy.file.path)]);
});

test('ADOPT-FAILURE: unreadable source retains a safe review reason and never claims adoption or creates a replacement', async t => {
  const { host, project, record } = await fixture(t);
  const command = { operationId: randomUUID(), expectedRevision: record.revision, projectId: project.id, relativePath: '020_clean/missing.md', role: 'report' };
  const rejected = await json(await host.request(`/api/cases/${record.id}/artifacts/adopt`, 'POST', command), 409);
  assert.equal(rejected.code, 'artifact_adoption_needs_review');
  const detail = await json(await host.request(`/api/cases/${record.id}`));
  assert.equal(detail.case.revision, record.revision); assert.equal(detail.artifacts.length, 0); assert.equal(detail.pendingOperations.length, 1);
  assert.equal(detail.pendingOperations[0].result.reviewReason, 'source_unavailable'); assert.equal(detail.pendingOperations[0].phase, 'needs_review');
  assert.deepEqual(await fs.readdir(path.join(project.rootPath, '060_reports')), []);
  assert.equal((await json(await host.request(`/api/cases/${record.id}/artifacts/adopt`, 'POST', command), 409)).code, 'artifact_adoption_needs_review');
});

test('ADOPT-VERSIONS: later adoption of the same source keeps distinct versions and unlinking preserves the earlier copy and provenance', async t => {
  const { host, project, file, record } = await fixture(t);
  const first = await json(await host.request(`/api/cases/${record.id}/artifacts/adopt`, 'POST', { operationId: randomUUID(), expectedRevision: record.revision, projectId: project.id, relativePath: file.path, role: 'report' }));
  await fs.writeFile(path.join(project.rootPath, file.path), '第二次明确采用的内容');
  const second = await json(await host.request(`/api/cases/${record.id}/artifacts/adopt`, 'POST', { operationId: randomUUID(), expectedRevision: first.case.revision, projectId: project.id, relativePath: file.path, role: 'report' }));
  assert.notEqual(first.artifact.id, second.artifact.id); assert.notEqual(first.artifact.relativePath, second.artifact.relativePath); assert.notEqual(first.artifact.observedSha256, second.artifact.observedSha256);
  assert.equal(first.adoption.sourceRelativePath, second.adoption.sourceRelativePath); assert.equal(first.artifact.taskId, null); assert.equal(second.artifact.taskId, null);
  assert.equal(await fs.readFile(path.join(project.rootPath, first.artifact.relativePath), 'utf8'), '原报告 v1');
  assert.equal(await fs.readFile(path.join(project.rootPath, second.artifact.relativePath), 'utf8'), '第二次明确采用的内容');
  await json(await host.request(`/api/cases/${record.id}/artifacts/${first.artifact.id}`, 'DELETE', { operationId: randomUUID(), expectedRevision: second.case.revision }));
  const detail = await json(await host.request(`/api/cases/${record.id}`));
  assert.equal(detail.artifacts.length, 2); assert.equal(detail.artifacts.find((a: any) => a.id === first.artifact.id).availability, 'unlinked');
  assert.deepEqual(detail.artifacts.find((a: any) => a.id === first.artifact.id).adoptedVersion, first.adoption);
  assert.equal(await fs.readFile(path.join(project.rootPath, first.artifact.relativePath), 'utf8'), '原报告 v1');
});

test('ADOPT-INTEGRITY: ordinary relinking cannot refresh an adopted version hash or silently replace its chosen provenance', async t => {
  const { host, project, file, task, record } = await fixture(t);
  const saved = await json(await host.request(`/api/cases/${record.id}/artifacts/adopt`, 'POST', { operationId: randomUUID(), expectedRevision: record.revision, projectId: project.id, relativePath: file.path, role: 'report' }));
  await fs.writeFile(path.join(project.rootPath, saved.artifact.relativePath), 'changed after adoption');
  const ordinary = { operationId: randomUUID(), expectedRevision: saved.case.revision, projectId: project.id, relativePath: saved.artifact.relativePath, taskId: task.id, role: 'file' };
  assert.equal((await json(await host.request(`/api/cases/${record.id}/artifacts`, 'POST', ordinary), 409)).code, 'adopted_version_reference');
  let detail = await json(await host.request(`/api/cases/${record.id}`));
  const reference = detail.artifacts.find((a: any) => a.id === saved.artifact.id);
  assert.equal(reference.availability, 'changed'); assert.equal(reference.observedSha256, file.sha256); assert.equal(reference.taskId, null); assert.equal(reference.role, 'report'); assert.equal(detail.case.revision, saved.case.revision);
  const removed = await json(await host.request(`/api/cases/${record.id}/artifacts/${saved.artifact.id}`, 'DELETE', { operationId: randomUUID(), expectedRevision: saved.case.revision }));
  assert.equal((await json(await host.request(`/api/cases/${record.id}/artifacts`, 'POST', { ...ordinary, operationId: randomUUID(), expectedRevision: removed.case.revision }), 409)).code, 'adopted_version_reference');
  detail = await json(await host.request(`/api/cases/${record.id}`)); assert.equal(detail.artifacts[0].availability, 'unlinked'); assert.equal(detail.artifacts[0].observedSha256, file.sha256);
});
