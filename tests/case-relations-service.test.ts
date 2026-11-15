import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { CaseStore } from '../src/host/case-store.ts';
import { ProjectStore } from '../src/host/project-store.ts';
import { createCaseRelationsService } from '../src/host/case-relations-service.ts';

test('CASE-REL-SERVICE-01: project enterprise conflict blocks new writes and redacts all successful-receipt display paths without rewriting receipt', async t => {
  const scratch = await fs.mkdtemp(path.join(await fs.realpath(os.tmpdir()), 'case-relation-scope-'));
  const cases = new CaseStore({ dataRoot: path.join(scratch, 'private') });
  await cases.initialize(); t.after(() => cases.close());
  const projects = new ProjectStore({ dataRoot: cases.dataRoot, projectsRoot: path.join(scratch, 'projects') }); await projects.init();
  const a = cases.createCase({ operationId: randomUUID(), title: '来源事项' });
  const b = cases.createCase({ operationId: randomUUID(), title: '目标事项' });
  const sourceProject = randomUUID(), targetProject = randomUUID(), enterpriseA = randomUUID(), enterpriseB = randomUUID();
  cases.linkProject({ operationId: randomUUID(), caseId: a.id, expectedRevision: a.revision, projectId: sourceProject });
  cases.linkProject({ operationId: randomUUID(), caseId: b.id, expectedRevision: b.revision, projectId: targetProject });
  const scope = new Map<string, string>([[sourceProject, enterpriseA], [targetProject, enterpriseA]]);
  const service = createCaseRelationsService({ cases, projects, mutate: async fn => fn(), assertActive: () => {},
    enterpriseScope: { caseEnterpriseId: () => undefined, projectEnterpriseId: id => scope.get(id) } });
  const input = { operationId: randomUUID(), caseStoreId: cases.getStatus().storeId!, fromCaseId: a.id, kind: 'follows_up',
    expectedRelationRevision: 0, explanation: '不应在失权后泄露的原说明。', changeReason: '修订理由同样包含来源细节。' };
  const saved = await service.saveUser(b.id, input), receipt = cases.getOperation(input.operationId);
  scope.set(targetProject, enterpriseB);
  assert.equal(service.list().items[0]!.restricted, true);
  const detail = await service.read(b.id, saved.relationId);
  assert.equal(detail.revision.restricted, true);
  assert.equal(JSON.stringify(detail).includes(input.explanation), false);
  assert.equal(JSON.stringify(detail).includes(input.changeReason), false);
  assert.equal(JSON.stringify(service.operation(b.id, input.operationId)).includes(input.explanation), false);
  const replay = await service.saveUser(b.id, input);
  assert.equal(replay.relationId, saved.relationId); assert.equal(replay.restricted, true);
  assert.equal(JSON.stringify(replay).includes(input.explanation), false);
  assert.deepEqual(cases.getOperation(input.operationId), receipt);
  await assert.rejects(service.saveUser(b.id, { ...input, operationId: randomUUID() }), /case_enterprise_conflict/);
  assert.equal(cases.listRelations().items.length, 1);
});

test('CASE-REL-SERVICE-02: Agent metadata pages fit transport without dropping relationships with maximum prose', async t => {
  const scratch = await fs.mkdtemp(path.join(await fs.realpath(os.tmpdir()), 'case-relation-agent-pages-'));
  const cases = new CaseStore({ dataRoot: path.join(scratch, 'private') }); await cases.initialize(); t.after(() => cases.close());
  const projects = new ProjectStore({ dataRoot: cases.dataRoot, projectsRoot: path.join(scratch, 'projects') }); await projects.init();
  const project = await projects.create({ name: '页读取项目', configuration: { id: randomUUID(), name: '合成配置', revision: 1, provider: 'synthetic', model: 'synthetic', baseUrl: 'http://127.0.0.1:1', api: 'openai-completions' } }), task = await projects.createTask(project.id, { name: '分页测试' });
  const target = cases.createCase({ operationId: randomUUID(), title: '共同目标' });
  cases.linkProject({ operationId: randomUUID(), caseId: target.id, expectedRevision: target.revision, projectId: project.id });
  const service = createCaseRelationsService({ cases, projects, mutate: async fn => fn(), assertActive: () => {} });
  for (let i = 0; i < 8; i++) {
    const source = cases.createCase({ operationId: randomUUID(), title: `独立来源${i}` });
    await service.saveUser(target.id, { operationId: randomUUID(), caseStoreId: cases.getStatus().storeId!, fromCaseId: source.id,
      expectedRelationRevision: 0, kind: 'follows_up', explanation: '大'.repeat(4000), targetScope: '范'.repeat(4000) });
  }
  const context = { caseStoreId: cases.getStatus().storeId!, caseId: target.id, projectId: project.id, taskId: task.id,
    requestId: randomUUID(), sessionId: 'synthetic-native', toolCallId: 'synthetic-read', operationId: randomUUID(), signal: new AbortController().signal, assertCurrent: () => {} };
  let continuation: string | null = null; const ids: string[] = [];
  do {
    const page = await service.readForAgent({ pageSize: 5, continuation }, context);
    assert.ok(page.text.length <= 30000);
    const body = JSON.parse(page.text); ids.push(...body.items.map((item: { relationId: string }) => item.relationId)); continuation = body.continuation;
  } while (continuation);
  assert.equal(ids.length, 8); assert.equal(new Set(ids).size, 8);
});

test('CASE-REL-SERVICE-03: a historical artifact project keeps its own enterprise boundary after its current Case link is removed', async t => {
  const scratch = await fs.mkdtemp(path.join(await fs.realpath(os.tmpdir()), 'case-relation-artifact-scope-'));
  const cases = new CaseStore({ dataRoot: path.join(scratch, 'private') }); await cases.initialize(); t.after(() => cases.close());
  const projects = new ProjectStore({ dataRoot: cases.dataRoot, projectsRoot: path.join(scratch, 'projects') }); await projects.init();
  const project = await projects.create({ name: '历史来源项目', configuration: { id: randomUUID(), name: '合成配置', revision: 1, provider: 'synthetic', model: 'synthetic', baseUrl: 'http://127.0.0.1:1' } });
  const a = cases.createCase({ operationId: randomUUID(), title: '来源事项' }), b = cases.createCase({ operationId: randomUUID(), title: '目标事项' });
  cases.linkProject({ operationId: randomUUID(), caseId: a.id, expectedRevision: a.revision, projectId: project.id });
  const artifact = cases.saveArtifact({ operationId: randomUUID(), caseId: a.id, expectedRevision: cases.getCase(a.id).revision,
    projectId: project.id, relativePath: '060_reports/source.txt', observedSha256: 'a'.repeat(64), observedBytes: 6, observedAt: new Date().toISOString() }).artifact;
  const enterpriseA = randomUUID(); let sourceEnterprise = enterpriseA, reads = 0;
  const service = createCaseRelationsService({ cases, projects, mutate: async fn => fn(), assertActive: () => {},
    enterpriseScope: { caseEnterpriseId: () => enterpriseA, projectEnterpriseId: () => sourceEnterprise },
    readArtifact: async () => { reads++; return { text: '失权后的来源正文', sha256: artifact.observedSha256 }; } });
  const input = { operationId: randomUUID(), caseStoreId: cases.getStatus().storeId!, fromCaseId: a.id, kind: 'supports', expectedRelationRevision: 0,
    explanation: '保存时允许的原支持。', targetScope: '原待核问题', sources: [{ type: 'case-artifact', caseStoreId: cases.getStatus().storeId!, caseId: a.id,
      artifactId: artifact.id, observedSha256: artifact.observedSha256 }] };
  const saved = await service.saveUser(b.id, input);
  cases.unlinkProject({ operationId: randomUUID(), caseId: a.id, expectedRevision: cases.getCase(a.id).revision, projectId: project.id });
  sourceEnterprise = randomUUID();
  assert.equal(service.list().items[0]!.restricted, true);
  const detail = await service.read(b.id, saved.relationId);
  assert.equal(detail.revision.restricted, true); assert.equal(reads, 0);
  assert.equal(JSON.stringify(detail).includes('失权后的来源正文'), false);
  await assert.rejects(service.saveUser(b.id, { ...input, operationId: randomUUID(), expectedRelationRevision: 1 }, saved.relationId), /case_enterprise_conflict/);
});

test('CASE-REL-SERVICE-04: escaped source pages fit their final JSON envelope and reconstruct every Unicode character', async t => {
  const scratch = await fs.mkdtemp(path.join(await fs.realpath(os.tmpdir()), 'case-relation-escaped-source-'));
  const cases = new CaseStore({ dataRoot: path.join(scratch, 'private') }); await cases.initialize(); t.after(() => cases.close());
  const projects = new ProjectStore({ dataRoot: cases.dataRoot, projectsRoot: path.join(scratch, 'projects') }); await projects.init();
  const project = await projects.create({ name: '转义来源项目', configuration: { id: randomUUID(), name: '合成配置', revision: 1,
    provider: 'synthetic', model: 'synthetic', baseUrl: 'http://127.0.0.1:1' } });
  const task = await projects.createTask(project.id, { name: '准确来源读取' });
  const a = cases.createCase({ operationId: randomUUID(), title: '来源事项' }), b = cases.createCase({ operationId: randomUUID(), title: '目标事项' });
  for (const record of [a, b]) cases.linkProject({ operationId: randomUUID(), caseId: record.id, expectedRevision: record.revision, projectId: project.id });
  const artifact = cases.saveArtifact({ operationId: randomUUID(), caseId: a.id, expectedRevision: cases.getCase(a.id).revision,
    projectId: project.id, relativePath: '060_reports/escaped-source.json' }).artifact;
  const content = '"\\\n\t\r\u001b🙂'.repeat(6000);
  const service = createCaseRelationsService({ cases, projects, mutate: async fn => fn(), assertActive: () => {},
    readArtifact: async () => ({ text: content, sha256: null }) });
  const ref = { type: 'case-artifact', caseStoreId: cases.getStatus().storeId!, caseId: a.id, artifactId: artifact.id, observedSha256: null };
  const saved = await service.saveUser(b.id, { operationId: randomUUID(), caseStoreId: cases.getStatus().storeId!, fromCaseId: a.id,
    kind: 'supports', expectedRelationRevision: 0, explanation: '准确转义正文', targetScope: '待核问题', sources: [ref] });
  const context = { caseStoreId: cases.getStatus().storeId!, caseId: b.id, projectId: project.id, taskId: task.id, requestId: randomUUID(),
    sessionId: 'synthetic-native', toolCallId: 'synthetic-source-read', operationId: randomUUID(), signal: new AbortController().signal, assertCurrent: () => {} };
  let continuation: string | null = null, reconstructed = '', pages = 0;
  do {
    const result = await service.readForAgent({ relationId: saved.relationId, revision: 1, sourceIndex: 0, continuation }, context);
    assert.ok(result.text.length <= 30000); assert.ok(Buffer.byteLength(result.text) <= 240000);
    assert.ok(Buffer.byteLength(JSON.stringify(result)) < 256 * 1024);
    const body = JSON.parse(result.text);
    assert.deepEqual(body.ref, ref); assert.equal(body.range.start, reconstructed.length); assert.equal(body.range.total, content.length);
    assert.equal(body.range.end, body.range.start + body.text.length); assert.ok(body.text.length > 0);
    assert.equal(/[\uDC00-\uDFFF]/.test(body.text[0] ?? ''), false);
    assert.equal(/[\uD800-\uDBFF]/.test(body.text.at(-1) ?? ''), false);
    reconstructed += body.text; continuation = body.continuation;
    assert.equal(body.partial, Boolean(continuation)); assert.ok(++pages < 100, 'every continuation must make forward progress');
  } while (continuation);
  assert.ok(pages > 1); assert.equal(reconstructed, content);
});
