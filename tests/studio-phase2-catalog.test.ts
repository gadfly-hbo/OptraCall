import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { randomUUID, createHash } from 'node:crypto';
import { EnterpriseScopeStore } from '../src/host/enterprise-scope-store.ts';
import { EnterpriseMaterialsStore } from '../src/host/enterprise-materials-store.ts';
import { StudioStore } from '../extensions/business-plugins/studio/store.ts';
import { createStudioEnterpriseCatalog } from '../src/host/studio-enterprise-catalog.ts';
import { createProjectEnablement } from '../extensions/business-plugins/metric-factory/project/enablement.ts';
import { createMetricLibrary } from '../extensions/business-plugins/metric-factory/library/store.ts';
import { preparePublication } from '../extensions/business-plugins/metric-factory/sap/validate.ts';
import { createSapMethodStore } from '../extensions/business-plugins/metric-factory/methods/store.ts';

function fixture(t: any) {
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'optracall-studio2-catalog-'));
  t.after(() => fs.rmSync(dataRoot, { recursive: true, force: true }));
  const scopes = new EnterpriseScopeStore(dataRoot), studio = new StudioStore(dataRoot), enterpriseMaterials = new EnterpriseMaterialsStore(dataRoot);
  return { dataRoot, scopes, studio, enterpriseMaterials, catalog: createStudioEnterpriseCatalog({ dataRoot, scopes, studio, enterpriseMaterials }) };
}
function snapshot(root: string): Record<string, string> {
  const entries: Record<string, string> = {};
  const walk = (directory: string) => { for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name), relative = path.relative(root, full);
    if (entry.isDirectory()) { entries[relative] = 'directory'; walk(full); }
    else entries[relative] = createHash('sha256').update(fs.readFileSync(full)).digest('hex');
  } }; walk(root); return entries;
}

test('the enterprise catalog separates foreign and unassigned materials and reads the actual enabled revision without writing directories or source bytes', async t => {
  const f = fixture(t), a = f.scopes.create({ name: 'A企业' }), b = f.scopes.create({ name: 'B企业' });
  let own = await f.enterpriseMaterials.create({ title: 'A制度初版', body: '原始制度' });
  own = await f.enterpriseMaterials.enable(own.material.id, own.material.version); const firstRevision = own.material.activeRevisionId!;
  own = await f.enterpriseMaterials.update(own.material.id, own.material.version, { title: 'A制度工作稿', body: '新工作稿制度' });
  own = await f.enterpriseMaterials.enable(own.material.id, own.material.version); const secondRevision = own.material.activeRevisionId!;
  own = await f.enterpriseMaterials.enable(own.material.id, own.material.version, firstRevision);
  let foreign = await f.enterpriseMaterials.create({ title: 'B专有制度', body: 'B企业依据' }); foreign = await f.enterpriseMaterials.enable(foreign.material.id, foreign.material.version);
  const unassigned = await f.enterpriseMaterials.create({ title: '待核归属的草稿', body: '尚未获准为企业标准' });
  f.scopes.associateAsset('enterprise', own.material.id, a.id); f.scopes.associateAsset('enterprise', foreign.material.id, b.id);
  const before = snapshot(f.dataRoot), result = await f.catalog.catalog(a.id);
  const active = result.items.find(item => item.id === own.material.id && item.status === 'formal-current');
  assert.equal(active?.ref?.version, firstRevision); assert.equal(active?.title, 'A制度初版');
  assert.equal(result.items.find(item => item.id === own.material.id && item.version === secondRevision)?.status, 'formal-history');
  assert.equal(result.items.find(item => item.id === own.material.id && item.version === 'draft')?.title, 'A制度工作稿');
  assert.equal(result.unassigned.find(item => item.id === unassigned.material.id)?.title, '待核归属的草稿');
  assert.ok(![...result.items, ...result.unassigned].some(item => item.id === foreign.material.id));
  assert.deepEqual(snapshot(f.dataRoot), before); assert.equal(result.enterprise.id, a.id);
});

test('source scope preserves empty-install legacy behavior but configured enterprises require native ownership or an exact legacy project association', async t => {
  const f = fixture(t), projectA = randomUUID(), projectB = randomUUID(), unassignedProject = randomUUID();
  const source = { authority: 'enterprise' as const, id: randomUUID(), version: randomUUID() };
  assert.equal(await f.catalog.sourceAllowed(projectA, source), true);
  assert.deepEqual(fs.readdirSync(f.dataRoot), [], 'An empty-install scope query must not initialize source or scope stores.');
  const a = f.scopes.create({ name: 'A企业' }), b = f.scopes.create({ name: 'B企业' });
  f.scopes.associateProject(projectA, a.id); f.scopes.associateProject(projectB, b.id); f.scopes.associateAsset('enterprise', source.id, a.id);
  assert.equal(await f.catalog.sourceAllowed(projectB, source), false);
  assert.equal(await f.catalog.sourceAllowed(projectA, source), true); assert.equal(f.catalog.sourceEnterpriseId(source), a.id);
  assert.equal(await f.catalog.sourceAllowed(unassignedProject, source), false);
  const unknown = { ...source, id: randomUUID() };
  assert.equal(await f.catalog.sourceAllowed(projectA, unknown), false); assert.equal(await f.catalog.sourceAllowed(unassignedProject, unknown), false);
  f.studio.create({ name: '旧未归属体系', projectId: unassignedProject, taskId: randomUUID(), goal: '保留旧项目关系', topicTitle: '旧分析', materials: [{ ref: unknown, saved: true, readable: true, note: '原明确选材' }] });
  assert.equal(await f.catalog.sourceAllowed(unassignedProject, unknown), true);
  assert.equal(await f.catalog.sourceAllowed(projectA, unknown), false);
  const enabled = { authority: 'sap-metric' as const, id: 'legacy-metric', version: '1.0.0' };
  createProjectEnablement(path.join(f.dataRoot, 'projects', unassignedProject)).enable(enabled.id, enabled.version);
  assert.equal(await f.catalog.sourceAllowed(unassignedProject, enabled), true);
  assert.equal(await f.catalog.sourceAllowed(unassignedProject, { ...enabled, version: '2.0.0' }), false);
  f.scopes.associateAsset(enabled.authority, enabled.id, b.id);
  assert.equal(await f.catalog.sourceAllowed(unassignedProject, enabled), false, 'Old enablement cannot bypass an explicit foreign enterprise assignment.');
});

test('only published Studio sources grant inferred enterprise scope, conflicting inferences are denied, and native assignment remains authoritative', async t => {
  const f = fixture(t), a = f.scopes.create({ name: 'A企业' }), b = f.scopes.create({ name: 'B企业' });
  const projectA = randomUUID(), projectB = randomUUID(); f.scopes.associateProject(projectA, a.id); f.scopes.associateProject(projectB, b.id);
  const source = { authority: 'enterprise' as const, id: randomUUID(), version: randomUUID(), sha256: 'a'.repeat(64) };
  const systemA = f.studio.create({ name: 'A基础', projectId: projectA, taskId: randomUUID(), enterpriseId: a.id, goal: '复用正式源', topicTitle: '映射', materials: [{ ref: source, saved: true, readable: true, note: '选材不授予分析资格' }] });
  const assetA = f.studio.saveAsset(systemA.id, { kind: 'binding', title: 'A会员映射', body: '按统一身份关联', scope: 'A', sources: [source], readyForPublication: true });
  const refA = { authority: 'studio-source' as const, id: assetA.id, version: '1', sha256: assetA.revisions[0].sha256, projectId: projectA, locator: systemA.id };
  assert.equal(await f.catalog.sourceAllowed(projectA, source), false); assert.equal(await f.catalog.sourceAllowed(projectA, refA), false);
  const publicationA = f.studio.preparePublication(systemA.id, { assetIds: [assetA.id], summary: 'A正式映射', scope: 'A' }); f.studio.confirmPublication(systemA.id, publicationA.id, publicationA.fingerprint);
  assert.equal(await f.catalog.sourceAllowed(projectA, refA), true); assert.equal(await f.catalog.sourceAllowed(projectB, refA), false);
  assert.equal(f.catalog.sourceEnterpriseId(refA), a.id); assert.equal(f.catalog.sourceEnterpriseId(source), a.id);
  assert.equal(await f.catalog.sourceAllowed(projectA, source), true);
  const resultA = await f.catalog.catalog(a.id); assert.equal(resultA.items.find(item => item.id === assetA.id)?.status, 'formal-current');
  const systemB = f.studio.create({ name: 'B基础', projectId: projectB, taskId: randomUUID(), enterpriseId: b.id, goal: '合成冲突反例', topicTitle: '冲突' });
  const assetB = f.studio.saveAsset(systemB.id, { kind: 'rule', title: 'B冲突规则', body: '待核来源归属', scope: 'B', sources: [source], readyForPublication: true });
  const publicationB = f.studio.preparePublication(systemB.id, { assetIds: [assetB.id], summary: '合成元数据冲突', scope: 'B' }); f.studio.confirmPublication(systemB.id, publicationB.id, publicationB.fingerprint);
  assert.equal(f.catalog.sourceEnterpriseId(source), undefined);
  assert.equal(await f.catalog.sourceAllowed(projectA, source), false); assert.equal(await f.catalog.sourceAllowed(projectB, source), false);
  f.scopes.associateAsset('enterprise', source.id, a.id);
  assert.equal(f.catalog.sourceEnterpriseId(source), a.id); assert.equal(await f.catalog.sourceAllowed(projectA, source), true); assert.equal(await f.catalog.sourceAllowed(projectB, source), false);
  const legacy = f.studio.create({ name: '旧未归属体系', projectId: randomUUID(), taskId: randomUUID(), goal: '待核', topicTitle: '旧主题' });
  const catalog = await f.catalog.catalog(a.id);
  assert.ok(!catalog.systems.some(system => system.id === systemB.id || system.id === legacy.id));
  assert.equal(catalog.unassigned.find(item => item.id === legacy.id)?.authority, 'studio-system');
});

test('SAP catalog metadata keeps published methods separate from drafts and governance, excludes foreign candidates, and marks only current formal versions eligible', async t => {
  const f = fixture(t), a = f.scopes.create({ name: 'A企业' }), b = f.scopes.create({ name: 'B企业' });
  const library = createMetricLibrary(path.join(f.dataRoot, 'metric-assets')), methods = createSapMethodStore(path.join(f.dataRoot, 'metric-assets'));
  const yaml = fs.readFileSync(new URL('../extensions/business-plugins/metric-factory/fixtures/membership-repurchase@1.0.0.draft.yaml', import.meta.url), 'utf8');
  library.publish(preparePublication(Buffer.from(yaml)), '合成测试');
  library.publish(preparePublication(Buffer.from(yaml.replace('version: 1.0.0', 'version: 1.1.0').replace('复购会员数', '重复购买会员数'))), '合成测试');
  f.scopes.associateAsset('sap-metric', 'membership-repurchase', a.id);
  const first = methods.save({ requestId: randomUUID(), title: '正式方法原题', origin: 'other', content: { conditions: '完整观察', logic: '核购买资格', judgment: '', limits: '合成' }, sources: [] });
  methods.publish(first.method.id, { requestId: randomUUID(), version: 1, expectedSha256: first.version.contentSha256 });
  methods.save({ requestId: randomUUID(), methodId: first.method.id, baseVersion: 1, title: '尚未发布的方法新稿', origin: 'other', content: { conditions: '完整观察', logic: '补退款核查', judgment: '', limits: '合成' }, sources: [] });
  f.scopes.associateAsset('sap-method', first.method.id, a.id);
  const foreign = methods.save({ requestId: randomUUID(), title: 'B私有候选', origin: 'other', content: { conditions: 'B', logic: 'B规则', judgment: '', limits: '' }, sources: [] });
  const systemB = f.studio.create({ name: 'B候选建设', projectId: randomUUID(), taskId: randomUUID(), enterpriseId: b.id, goal: '准备B独立候选', topicTitle: 'B' });
  f.studio.addAssetRef(systemB.id, { authority: 'sap-method', id: foreign.method.id, version: '1', sha256: foreign.version.contentSha256 });
  const unassigned = methods.save({ requestId: randomUUID(), title: '尚未归属方法', origin: 'other', content: { conditions: '待核', logic: '待核', judgment: '', limits: '' }, sources: [] });
  let before = snapshot(f.dataRoot), result = await f.catalog.catalog(a.id);
  assert.equal(result.items.find(item => item.id === 'membership-repurchase' && item.version === '1.1.0')?.eligible, true);
  assert.equal(result.items.find(item => item.id === 'membership-repurchase' && item.version === '1.0.0')?.eligible, false);
  const published = result.items.find(item => item.id === first.method.id && item.version === '1'), draft = result.items.find(item => item.id === first.method.id && item.version === '2');
  assert.equal(published?.title, '正式方法原题'); assert.equal(published?.eligible, true); assert.equal(published?.status, 'formal-current');
  assert.equal(draft?.title, '尚未发布的方法新稿'); assert.equal(draft?.eligible, false); assert.equal(draft?.status, 'candidate');
  assert.ok(![...result.items, ...result.unassigned].some(item => item.id === foreign.method.id));
  assert.equal(result.unassigned.find(item => item.id === unassigned.method.id)?.eligible, false);
  assert.deepEqual(snapshot(f.dataRoot), before);
  methods.markIssue(first.method.id, { requestId: randomUUID(), version: 1, expectedRevision: 0, status: 'confirmed', note: '原方法当前用途有问题' });
  before = snapshot(f.dataRoot); result = await f.catalog.catalog(a.id);
  assert.equal(result.items.find(item => item.id === first.method.id && item.version === '1')?.status, 'restricted');
  assert.equal(result.items.find(item => item.id === first.method.id && item.version === '1')?.eligible, false);
  assert.deepEqual(snapshot(f.dataRoot), before);
});

test('configured scope retains exact source dependencies already published by an explicitly linked legacy system without opening unrelated unassigned sources', async t => {
  const f = fixture(t), project = randomUUID(); f.scopes.create({ name: '已配置企业' });
  const source = { authority: 'enterprise' as const, id: randomUUID(), version: randomUUID() };
  const system = f.studio.create({ name: '旧体系', projectId: project, taskId: randomUUID(), goal: '保留旧正式依据', topicTitle: '旧主题' });
  const asset = f.studio.saveAsset(system.id, { kind: 'rule', title: '旧正式规则', body: '准确来源有原发布关联', scope: '原项目', sources: [source], readyForPublication: true });
  assert.equal(await f.catalog.sourceAllowed(project, source), false);
  const preview = f.studio.preparePublication(system.id, { assetIds: [asset.id], summary: '原明确发布', scope: '原项目' }); f.studio.confirmPublication(system.id, preview.id, preview.fingerprint);
  assert.equal(await f.catalog.sourceAllowed(project, source), true);
  assert.equal(await f.catalog.sourceAllowed(project, { ...source, version: randomUUID() }), false);
  assert.equal(await f.catalog.sourceAllowed(randomUUID(), source), false);
});

test('registering a globally published SAP method as construction input does not qualify enterprise supply until its exact publication result succeeds', async t => {
  const f = fixture(t), a = f.scopes.create({ name: 'A企业' }), project = randomUUID(); f.scopes.associateProject(project, a.id);
  const methods = createSapMethodStore(path.join(f.dataRoot, 'metric-assets'));
  const saved = methods.save({ requestId: randomUUID(), title: '待企业关联方法', origin: 'other', content: { conditions: '合成', logic: '核事实', judgment: '', limits: '' }, sources: [] });
  methods.publish(saved.method.id, { requestId: randomUUID(), version: 1, expectedSha256: saved.version.contentSha256 });
  const ref = { authority: 'sap-method' as const, id: saved.method.id, version: '1', sha256: saved.version.contentSha256 };
  const system = f.studio.create({ name: 'A建设', projectId: project, taskId: randomUUID(), enterpriseId: a.id, goal: '核定方法归属', topicTitle: '方法' }); f.studio.addAssetRef(system.id, ref);
  assert.equal((await f.catalog.catalog(a.id)).items.find(item => item.id === ref.id)?.eligible, false);
  assert.equal(await f.catalog.sourceAllowed(project, ref), false);
  const preview = f.studio.preparePublication(system.id, { assetIds: [], refs: [ref], summary: '准确企业方法关联', scope: 'A' }); f.studio.confirmPublication(system.id, preview.id, preview.fingerprint);
  f.studio.recordPublicationResult(system.id, preview.id, { module: 'sap-method', status: 'unknown', refs: [ref], detail: '尚待核原回执' });
  assert.equal((await f.catalog.catalog(a.id)).items.find(item => item.id === ref.id)?.eligible, false);
  f.studio.recordPublicationResult(system.id, preview.id, { module: 'sap-method', status: 'succeeded', refs: [ref], detail: '准确发布已核' });
  assert.equal((await f.catalog.catalog(a.id)).items.find(item => item.id === ref.id)?.eligible, true);
  assert.equal(await f.catalog.sourceAllowed(project, ref), true); assert.equal(f.catalog.sourceEnterpriseId(ref), a.id);
});
