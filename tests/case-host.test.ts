import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { startTestHost } from './fixtures/host-process.ts';
import { startToolProvider } from './fixtures/tool-provider.ts';
import { CaseStore } from '../src/host/case-store.ts';
import { ProjectStore } from '../src/host/project-store.ts';
import { ConfigurationStore } from '../src/host/config-store.ts';

async function json(response: Response, expected = 200): Promise<any> {
  assert.equal(response.status, expected, await response.clone().text());
  return response.json();
}

test('CASE-HTTP: ordinary startup reports uninitialized storage without creating an empty Case database', async t => {
  const host = await startTestHost(); t.after(() => host.close());
  assert.deepEqual(await json(await host.request('/api/cases/storage')), { state: 'uninitialized' });
  assert.equal((await fs.readdir(host.dataRoot)).includes('decision-cases.sqlite3'), false);
  assert.equal((await fs.readdir(host.dataRoot)).includes('decision-cases-store.json'), false);
  assert.deepEqual((await json(await host.request('/api/projects'))).projects, []);
});

test('CASE-HTTP: two Cases share original projects, global work revisions and original tasks without model calls', async t => {
  const provider = await startToolProvider(); t.after(() => provider.close());
  const host = await startTestHost(); t.after(() => host.close());
  const saved = await json(await host.request('/api/configuration', 'PUT', { name: 'Case合成配置', provider: 'openai-compatible', baseUrl: provider.baseUrl, model: 'synthetic-case-model', apiKey: 'synthetic-case-key' }));
  const { project: p } = await json(await host.request('/api/projects', 'POST', { name: '原人群项目', configurationId: saved.configuration.id }), 201);
  const { task } = await json(await host.request(`/api/projects/${p.id}/tasks`, 'POST', { name: '原任务' }), 201);
  const originalMetadata = await fs.readFile(path.join(host.dataRoot, 'projects', p.id, 'project.json'));
  assert.equal((await json(await host.request('/api/cases/storage/initialize', 'POST', {}))).state, 'ready');
  const { case: a } = await json(await host.request('/api/cases', 'POST', { operationId: randomUUID(), title: '会员复购下降' }), 201);
  const { case: b } = await json(await host.request('/api/cases', 'POST', { operationId: randomUUID(), title: '会员召回' }), 201);
  const linkedA = await json(await host.request(`/api/cases/${a.id}/projects`, 'POST', { operationId: randomUUID(), expectedRevision: 1, projectId: p.id }));
  await json(await host.request(`/api/cases/${b.id}/projects`, 'POST', { operationId: randomUUID(), expectedRevision: 1, projectId: p.id }));
  const empty = (await json(await host.request(`/api/projects/${p.id}/work`))).work;
  assert.equal(empty.revision, 0); assert.equal(empty.workStatus, null);
  const command = { operationId: randomUUID(), expectedRevision: 0, workStatus: 'in_progress', workScope: '研究会员人群', assignee: 'A分析师', nextStep: '核对分群', statusReason: null, originCaseId: a.id };
  const first = await json(await host.request(`/api/projects/${p.id}/work`, 'PATCH', command));
  assert.equal(first.work.revision, 1);
  assert.deepEqual(await json(await host.request(`/api/projects/${p.id}/work`, 'PATCH', command)), first, 'Same operation is replayed without another global event.');
  const stale = await json(await host.request(`/api/projects/${p.id}/work`, 'PATCH', { ...command, operationId: randomUUID(), assignee: 'B分析师', originCaseId: b.id }), 409);
  assert.equal(stale.code, 'project_work_revision_conflict');
  for (const caseId of [a.id, b.id]) {
    const detail = await json(await host.request(`/api/cases/${caseId}`));
    assert.equal(detail.projectLinks[0].projectId, p.id);
    assert.equal(detail.projectEvents.length, 1); assert.equal(detail.projectEvents[0].subjectId, p.id);
  }
  const original = (await json(await host.request(`/api/projects/${p.id}`))).project;
  assert.equal(original.work.workStatus, 'in_progress'); assert.equal(original.tasks[0].id, task.id);
  assert.deepEqual(await fs.readFile(path.join(host.dataRoot, 'projects', p.id, 'project.json')), originalMetadata);
  const closed = await json(await host.request(`/api/cases/${a.id}/close`, 'POST', { operationId: randomUUID(), expectedRevision: linkedA.case.revision, reason: '保留观察，不采取行动' }));
  assert.equal(closed.case.status, 'closed');
  assert.equal((await json(await host.request(`/api/cases/${a.id}/notes`, 'POST', { operationId: randomUUID(), expectedRevision: closed.case.revision, note: '不可写' }), 409)).code, 'case_closed');
  assert.equal((await json(await host.request(`/api/projects/${p.id}/work`, 'PATCH', { ...command, operationId: randomUUID(), expectedRevision: 1, originCaseId: undefined, nextStep: '独立继续' }))).work.revision, 2);
  assert.equal(provider.requests.length, 0, 'Case reads and saves never initialize or call a model.');
});

test('CASE-HTTP: artifact references record observed original sources and expose changes, missing files and historical unlinking', async t => {
  const host = await startTestHost(); t.after(() => host.close());
  await json(await host.request('/api/configuration', 'PUT', { name: '引用合成配置', provider: 'openai-compatible', baseUrl: 'http://127.0.0.1:1/v1', model: 'synthetic-reference', apiKey: 'synthetic-reference-key' }));
  const { project } = await json(await host.request('/api/projects', 'POST', { name: '原产物项目' }), 201);
  const { task } = await json(await host.request(`/api/projects/${project.id}/tasks`, 'POST', { name: '相关任务' }), 201);
  const { file } = await json(await host.request(`/api/projects/${project.id}/files/upload`, 'POST', { name: 'report.txt', directory: '020_clean', content: Buffer.from('合成报告 v1').toString('base64') }), 201);
  await json(await host.request('/api/cases/storage/initialize', 'POST', {}));
  const { case: c } = await json(await host.request('/api/cases', 'POST', { operationId: randomUUID(), title: '合成产物观察' }), 201);
  const linked = await json(await host.request(`/api/cases/${c.id}/projects`, 'POST', { operationId: randomUUID(), expectedRevision: 1, projectId: project.id }));
  const request = { operationId: randomUUID(), expectedRevision: linked.case.revision, projectId: project.id, relativePath: file.path, taskId: task.id, role: 'report' };
  const saved = await json(await host.request(`/api/cases/${c.id}/artifacts`, 'POST', request));
  let detail = await json(await host.request(`/api/cases/${c.id}`));
  assert.equal(detail.artifacts.length, 1);
  const artifact = detail.artifacts[0];
  assert.equal(artifact.uploadId, file.id); assert.equal(artifact.taskId, task.id);
  assert.equal(artifact.projectId, project.id); assert.equal(artifact.availability, 'available');
  assert.equal(artifact.observedSha256, file.sha256); assert.equal(artifact.observedBytes, file.bytes);
  assert.equal(artifact.taskName, '相关任务'); assert.equal(artifact.projectName, '原产物项目');
  assert.deepEqual((await json(await host.request(`/api/cases/${c.id}/artifacts`, 'POST', request))).case, saved.case);
  await fs.writeFile(path.join(project.rootPath, file.path), '合成报告 v2');
  detail = await json(await host.request(`/api/cases/${c.id}`));
  assert.equal(detail.artifacts[0].availability, 'changed');
  assert.equal(detail.artifacts[0].observedSha256, file.sha256, 'Read-time observation never overwrites a previously observed version.');
  await fs.unlink(path.join(project.rootPath, file.path));
  assert.equal((await json(await host.request(`/api/cases/${c.id}`))).artifacts[0].availability, 'missing');
  const unlinked = await json(await host.request(`/api/cases/${c.id}/projects/${project.id}`, 'DELETE', { operationId: randomUUID(), expectedRevision: saved.case.revision }));
  assert.equal((await json(await host.request(`/api/cases/${c.id}`))).artifacts[0].availability, 'project_unlinked');
  await json(await host.request(`/api/cases/${c.id}/artifacts/${artifact.id}`, 'DELETE', { operationId: randomUUID(), expectedRevision: unlinked.case.revision }));
  assert.equal((await json(await host.request(`/api/cases/${c.id}`))).artifacts[0].availability, 'unlinked');
  assert.equal((await json(await host.request(`/api/projects/${project.id}`))).project.tasks[0].id, task.id);
});

test('CASE-HTTP: an interrupted project-created operation recovers through a new link and keeps both receipts without duplicating the original project', async t => {
  const scratch = await fs.mkdtemp(path.join(await fs.realpath(os.tmpdir()), 'case-host-recovery-'));
  const dataRoot = path.join(scratch, 'host'), projectsRoot = path.join(scratch, 'projects');
  const projects = new ProjectStore({ dataRoot, projectsRoot }); await projects.init();
  const configuration = new ConfigurationStore({ dataRoot }); await configuration.init();
  const selected = await configuration.save({ name: '恢复合成配置', provider: 'openai-compatible', baseUrl: 'http://127.0.0.1:1/v1', model: 'synthetic-recovery', apiKey: 'synthetic-recovery-key' });
  const cases = new CaseStore({ dataRoot }); await cases.init(); await cases.initialize();
  const c = cases.createCase({ operationId: randomUUID(), title: '创建后关联中断' });
  const operationId = randomUUID(), projectId = randomUUID(), projectInput = { name: '已成功创建的原项目', configurationId: selected.id };
  const reserved = cases.reserveProjectCreation({ operationId, caseId: c.id, expectedRevision: 1, projectId, projectInput });
  await projects.create({ name: projectInput.name, configuration: selected, reservedId: projectId });
  cases.markProjectCreated(operationId);
  cases.updateCase({ operationId: randomUUID(), caseId: c.id, expectedRevision: 1, judgement: '中断期间已更新判断' });
  cases.close(); await projects.close();
  const host = await startTestHost({ dataRoot, projectsRoot }); t.after(() => host.close());
  const originalCommand = { operationId, expectedRevision: 1, ...projectInput };
  const partial = await json(await host.request(`/api/cases/${c.id}/projects/create`, 'POST', originalCommand), 201);
  assert.equal(partial.projectId, projectId); assert.equal(partial.project.id, projectId); assert.equal(partial.linked, false); assert.equal(partial.phase, 'project_created');
  assert.equal((await json(await host.request('/api/projects'))).projects.length, 1);
  const closed = await json(await host.request(`/api/cases/${c.id}/close`, 'POST', { operationId: randomUUID(), expectedRevision: 2, reason: '先结束再恢复' }));
  assert.equal((await json(await host.request(`/api/cases/${c.id}/projects`, 'POST', { operationId: randomUUID(), expectedRevision: closed.case.revision, projectId, recoveryOfOperationId: operationId }), 409)).code, 'case_closed');
  const reopened = await json(await host.request(`/api/cases/${c.id}/reopen`, 'POST', { operationId: randomUUID(), expectedRevision: closed.case.revision, status: 'analyzing' }));
  const recovery = { operationId: randomUUID(), expectedRevision: reopened.case.revision, projectId, recoveryOfOperationId: operationId };
  const linked = await json(await host.request(`/api/cases/${c.id}/projects`, 'POST', recovery));
  assert.equal(linked.link.projectId, projectId);
  assert.deepEqual(await json(await host.request(`/api/cases/${c.id}/projects`, 'POST', recovery)), linked);
  const originalReceipt = (await json(await host.request(`/api/cases/operations/${operationId}`))).operation;
  assert.equal(originalReceipt.phase, 'completed'); assert.equal(originalReceipt.requestSha256, reserved.requestSha256);
  assert.equal(originalReceipt.result.recoveredByOperationId, recovery.operationId);
  assert.equal((await json(await host.request(`/api/cases/operations/${recovery.operationId}`))).operation.phase, 'completed');
  assert.equal((await json(await host.request('/api/projects'))).projects.length, 1);
  const replay = await json(await host.request(`/api/cases/${c.id}/projects/create`, 'POST', originalCommand), 201);
  assert.equal(replay.projectId, projectId); assert.equal(replay.linked, true);
  assert.equal((await json(await host.request(`/api/cases/${c.id}`))).projectLinks.length, 1);
  assert.equal((await json(await host.request(`/api/cases/${c.id}/projects/create`, 'POST', { ...originalCommand, name: 'changed' }), 409)).code, 'operation_conflict');
});

test('CASE-HTTP: archived original projects stay readable but cannot accept new business writes; completed save retries only read their receipt', async t => {
  const host = await startTestHost(); t.after(() => host.close());
  await json(await host.request('/api/configuration', 'PUT', { name: '归档合成配置', provider: 'openai-compatible', baseUrl: 'http://127.0.0.1:1/v1', model: 'synthetic-archive-case', apiKey: 'synthetic-archive-case-key' }));
  const { project } = await json(await host.request('/api/projects', 'POST', { name: '原归档项目' }), 201);
  await json(await host.request('/api/cases/storage/initialize', 'POST', {}));
  const command = { operationId: randomUUID(), expectedRevision: 0, workStatus: 'completed', workScope: '', assignee: null, nextStep: '', statusReason: '已完成合成核对' };
  const first = await json(await host.request(`/api/projects/${project.id}/work`, 'PATCH', command));
  await json(await host.request(`/api/projects/${project.id}/archive`, 'POST', {}));
  const { case: c } = await json(await host.request('/api/cases', 'POST', { operationId: randomUUID(), title: '查阅归档项目' }), 201);
  await json(await host.request(`/api/cases/${c.id}/projects`, 'POST', { operationId: randomUUID(), expectedRevision: 1, projectId: project.id }));
  assert.equal((await json(await host.request(`/api/projects/${project.id}/work`))).work.workStatus, 'completed');
  assert.equal((await json(await host.request(`/api/projects/${project.id}/work`, 'PATCH', { ...command, operationId: randomUUID(), expectedRevision: 1, nextStep: '不能保存' }), 409)).code, 'project_archived');
  assert.deepEqual(await json(await host.request(`/api/projects/${project.id}/work`, 'PATCH', command)), first);
  assert.equal((await json(await host.request(`/api/projects/${project.id}/work/events`))).events.length, 1);
});

test('CASE-HTTP: a ready marker with a missing database remains unavailable while original projects and drafts keep working', async t => {
  const initial = await startTestHost();
  await json(await initial.request('/api/configuration', 'PUT', { name: '故障合成配置', provider: 'openai-compatible', baseUrl: 'http://127.0.0.1:1/v1', model: 'synthetic-failure-case', apiKey: 'synthetic-failure-case-key' }));
  const { project } = await json(await initial.request('/api/projects', 'POST', { name: '原项目仍可用' }), 201);
  const { task } = await json(await initial.request(`/api/projects/${project.id}/tasks`, 'POST', { name: '原任务仍可用' }), 201);
  await json(await initial.request('/api/cases/storage/initialize', 'POST', {}));
  await initial.close();
  const databasePath = path.join(initial.dataRoot, 'decision-cases.sqlite3'), heldPath = `${databasePath}.synthetic-held`;
  await fs.rename(databasePath, heldPath);
  const originalMarker = await fs.readFile(path.join(initial.dataRoot, 'decision-cases-store.json'));
  const host = await startTestHost({ dataRoot: initial.dataRoot, projectsRoot: initial.projectsRoot }); t.after(() => host.close());
  assert.deepEqual(await json(await host.request('/api/cases/storage')), { state: 'unavailable', code: 'case_database_missing' });
  const value = (await json(await host.request(`/api/projects/${project.id}`))).project;
  assert.equal(value.workUnavailable, true); assert.equal(value.work, null);
  assert.equal((await json(await host.request('/api/cases'), 503)).code, 'case_store_unavailable');
  await json(await host.request(`/api/projects/${project.id}/tasks/${task.id}/draft`, 'PATCH', { text: '原任务独立草稿' }));
  assert.equal((await json(await host.request(`/api/projects/${project.id}/tasks/${task.id}`))).task.draft, '原任务独立草稿');
  assert.equal((await fs.readdir(initial.dataRoot)).includes('decision-cases.sqlite3'), false);
  assert.deepEqual(await fs.readFile(path.join(initial.dataRoot, 'decision-cases-store.json')), originalMarker);
  assert.equal((await fs.stat(heldPath)).isFile(), true, 'The only database bytes remain preserved for review.');
});

test('CASE-HTTP: new-project linking is replayable and an interrupted prepared identity collision preserves the original project for review', async t => {
  const scratch = await fs.mkdtemp(path.join(await fs.realpath(os.tmpdir()), 'case-host-collision-'));
  const dataRoot = path.join(scratch, 'host'), projectsRoot = path.join(scratch, 'projects');
  const projects = new ProjectStore({ dataRoot, projectsRoot }); await projects.init();
  const configuration = new ConfigurationStore({ dataRoot }); await configuration.init();
  const selected = await configuration.save({ name: '创建合成配置', provider: 'openai-compatible', baseUrl: 'http://127.0.0.1:1/v1', model: 'synthetic-create-case', apiKey: 'synthetic-create-case-key' });
  const cases = new CaseStore({ dataRoot }); await cases.init(); await cases.initialize();
  const c = cases.createCase({ operationId: randomUUID(), title: '创建原项目' });
  const operationId = randomUUID(), projectId = randomUUID(), projectInput = { name: '中断身份项目', configurationId: selected.id };
  cases.reserveProjectCreation({ operationId, caseId: c.id, expectedRevision: 1, projectId, projectInput });
  const original = await projects.create({ name: projectInput.name, configuration: selected, reservedId: projectId });
  const bytes = await fs.readFile(path.join(dataRoot, 'projects', projectId, 'project.json'));
  cases.close(); await projects.close();
  const host = await startTestHost({ dataRoot, projectsRoot }); t.after(() => host.close());
  const uncertain = await json(await host.request(`/api/cases/${c.id}/projects/create`, 'POST', { operationId, expectedRevision: 1, ...projectInput }), 201);
  assert.equal(uncertain.phase, 'needs_review'); assert.equal(uncertain.projectId, projectId); assert.equal(uncertain.linked, false);
  assert.deepEqual(await fs.readFile(path.join(dataRoot, 'projects', projectId, 'project.json')), bytes);
  assert.equal((await json(await host.request('/api/projects'))).projects.length, 1);
  assert.equal((await json(await host.request(`/api/cases/${c.id}`))).projectLinks.length, 0);
  const command = { operationId: randomUUID(), expectedRevision: 1, name: '明确新建项目', configurationId: selected.id };
  const created = await json(await host.request(`/api/cases/${c.id}/projects/create`, 'POST', command), 201);
  assert.equal(created.linked, true); assert.equal(created.phase, 'completed'); assert.equal(created.project.name, command.name);
  assert.notEqual(created.projectId, original.id);
  assert.deepEqual(await json(await host.request(`/api/cases/${c.id}/projects/create`, 'POST', command), 201), created);
  assert.equal((await json(await host.request('/api/projects'))).projects.length, 2);
});
