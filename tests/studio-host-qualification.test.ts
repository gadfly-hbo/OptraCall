import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { ProjectStore } from '../src/host/project-store.ts';
import { EnterpriseMaterialsStore } from '../src/host/enterprise-materials-store.ts';
import { StudioStore } from '../extensions/business-plugins/studio/store.ts';
import { createStudioFeature } from '../src/host/studio-host.ts';
import type { SemanticContextCallContext } from '../src/agent/semantic-context.ts';
const configuration = { id: 'synthetic-model', revision: 1, name: '合成配置', provider: 'synthetic', model: 'synthetic', baseUrl: 'http://127.0.0.1:1' };
const context = (): SemanticContextCallContext => ({ signal: new AbortController().signal, requestId: randomUUID(), sessionId: 'synthetic-session', toolCallId: randomUUID(), assertCurrent() {} });
async function fixture(t: any) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'studio-host-qualification-')), dataRoot = path.join(root, 'private');
  const projects = new ProjectStore({ dataRoot, projectsRoot: path.join(root, 'projects') }); await projects.init();
  t.after(async () => { await projects.close(); await fs.rm(root, { recursive: true, force: true }); });
  const enterpriseMaterials = new EnterpriseMaterialsStore(dataRoot), store = new StudioStore(dataRoot);
  const project = await projects.create({ name: '合成建设项目', configuration }), task = await projects.createTask(project.id, { name: '建设任务' });
  const usingProject = await projects.create({ name: '合成使用项目', configuration }), usingTask = await projects.createTask(usingProject.id, { name: '使用任务' });
  const material = await enterpriseMaterials.create({ title: '合成退款制度', body: '成功退款归原销售门店' });
  const enabled = await enterpriseMaterials.enable(material.material.id, material.material.version);
  const index = await enterpriseMaterials.referenceIndex({ readOnly: true }), revision = index.materials.find(m => m.materialId === material.material.id)!.revisions[0];
  const ref = { authority: 'enterprise' as const, id: material.material.id, version: revision.revisionId, sha256: revision.bodySha256, locator: index.storeId };
  const system = store.create({ name: '合成资格体系', projectId: project.id, taskId: task.id, topicTitle: '销售退款', goal: '源资格核验', materials: [{ ref, saved: true, readable: true, note: '目录可见，未实际读' }] });
  store.linkUsageProject(system.id, usingProject.id, usingTask.id);
  const assetInput = { kind: 'rule' as const, title: '退款归属', body: '正式源正文：退款归原销售门店', scope: '合成企业', sources: [ref], readyForPublication: true };
  const asset = store.saveAsset(system.id, assetInput), preview = store.preparePublication(system.id, { assetIds: [asset.id], summary: '正式源', scope: '合成企业' });
  store.confirmPublication(system.id, preview.id, preview.fingerprint);
  const feature = createStudioFeature({ dataRoot, projects, enterpriseMaterials, readBody: async () => ({}), mutate: async operation => operation(), running: () => false, closing: () => false, readTaskReply: async () => { throw new Error('No native session is opened in this boundary test'); } });
  return { projects, feature, project, task, usingProject, usingTask, material, enabled, ref, system, asset, assetInput, store, enterpriseMaterials, construction: feature.port(project.id, task.id), ordinary: feature.port(usingProject.id, usingTask.id) };
}

test('ordinary read(assetId) never returns a withdrawn enterprise-backed formal source or candidate history', async t => {
  const f = await fixture(t);
  f.store.saveAsset(f.system.id, { ...f.assetInput, assetId: f.asset.id, expectedRevision: 1, body: 'UNPUBLISHED-CANDIDATE-SECRET' });
  const read = await f.ordinary('read', { systemId: f.system.id, payload: { assetId: f.asset.id } }, context());
  assert.match(JSON.stringify(read), /正式源正文/); assert.doesNotMatch(JSON.stringify(read), /UNPUBLISHED-CANDIDATE-SECRET/);
  await assert.rejects(() => f.ordinary('read', { systemId: f.system.id, payload: { assetId: f.asset.id, revision: 2 } }, context()), /studio_asset_not_published/);
  await f.enterpriseMaterials.disable(f.material.material.id, f.enabled.material.version);
  await assert.rejects(() => f.ordinary('read', { systemId: f.system.id, payload: { assetId: f.asset.id } }, context()), /studio_source_unavailable/);
});

test('ordinary read(assetId) stops known incorrect default supply while exact historical inspection returns governance', async t => {
  const f = await fixture(t); f.store.markAssetIssue(f.system.id, f.asset.id, '合成已确认错误，待原建设任务修订');
  await assert.rejects(() => f.ordinary('read', { systemId: f.system.id, payload: { assetId: f.asset.id } }, context()), /studio_asset_restricted|studio_source_restricted/);
  const historical = await f.ordinary('read', { systemId: f.system.id, payload: { assetId: f.asset.id, revision: 1 } }, context());
  assert.match(JSON.stringify(historical), /合成已确认错误/); assert.match(JSON.stringify(historical), /historical|not-for-default|not-default|non-default/);
  assert.match(JSON.stringify(await f.construction('read', { systemId: f.system.id, payload: { assetId: f.asset.id } }, context())), /正式源正文/);
});

test('material-status records an Agent processing declaration without accepting forged actual reading facts', async t => {
  const f = await fixture(t);
  await assert.rejects(() => f.construction('material-status', { systemId: f.system.id, payload: { ref: f.ref, processed: true, note: '没有实际读，不能写处理完成', readAt: '2026-01-01T00:00:00.000Z' } }, context()), /studio_material_not_read/);
  const reply = await f.construction('material-status', { systemId: f.system.id, payload: { ref: f.ref, processed: false, note: '合成Agent处理声明，非真实读取回执', readAt: '2026-01-01T00:00:00.000Z', confirmedAt: '2026-01-01T00:00:00.000Z' } }, context());
  const material = f.store.get(f.system.id).materials[0];
  assert.equal(material.processedAt, undefined); assert.equal(material.readAt, undefined); assert.equal(material.confirmedAt, undefined); assert.match(JSON.stringify(reply), /agent-processing-declaration/);
});

// Characterization after the parent's independent-review RED and repair; this new test is not claimed as a pre-implementation RED.
test('a revoked real construction run cannot write after asynchronous source validation or final owner admission resumes', async t => {
  for (const action of ['save-asset', 'update-topic'] as const) {
    const f = await fixture(t), controller = new AbortController(); let current = true, enter!: () => void, release!: () => void;
    const entered = new Promise<void>(resolve => { enter = resolve; }), blocked = new Promise<void>(resolve => { release = resolve; });
    if (action === 'save-asset') {
      const validate = f.feature.sources.validate.bind(f.feature.sources);
      f.feature.sources.validate = async (...args) => { await validate(...args); enter(); await blocked; };
    } else {
      const getTask = f.projects.getTask.bind(f.projects); let admissions = 0;
      f.projects.getTask = async (...args) => { const task = await getTask(...args); if (args[0] === f.project.id && args[1] === f.task.id && ++admissions === 2) { enter(); await blocked; } return task; };
    }
    const before = f.store.get(f.system.id), ctx = { ...context(), signal: controller.signal, assertCurrent: () => { if (!current) throw new Error('synthetic-current-revoked'); } };
    const pending = f.construction(action, { systemId: f.system.id, payload: action === 'save-asset' ? f.assetInput : { expectedRevision: before.revision, name: 'CANCELLED-MUST-NOT-SAVE' } }, ctx).then(() => null, error => error as Error);
    await entered; current = false; controller.abort(new Error('synthetic-cancelled')); release();
    assert.match((await pending)?.message ?? 'unexpected-success', /synthetic-current-revoked|synthetic-cancelled/);
    const after = f.store.get(f.system.id); assert.equal(after.revision, before.revision); assert.equal(after.name, before.name); assert.deepEqual(after.assets, before.assets);
  }
});
