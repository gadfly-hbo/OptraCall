import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { StudioStore } from '../extensions/business-plugins/studio/store.ts';
import * as studioContracts from '../extensions/business-plugins/studio/contracts.ts';

function fixture(t: any) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'optracall-studio2-store-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}
const createInput = { name: '企业基础资产', projectId: 'construction-project', taskId: 'construction-task', goal: '建设可复用门店分析依据', topicTitle: '销售与退款' };
const contributionInput = {
  sourceProjectId: 'analysis-project', sourceTaskId: 'analysis-task', scope: 'enterprise' as const,
  report: { authority: 'task' as const, id: 'analysis-task', projectId: 'analysis-project', taskId: 'analysis-task', locator: '060_reports/refund-check.md', version: 'a'.repeat(64), sha256: 'a'.repeat(64) },
  sourceRefs: [{ authority: 'enterprise' as const, id: 'refund-policy', version: '2' }],
  candidate: { kind: 'binding' as const, title: '退款后的购买资格', body: '建议核定全额退款后的购买资格', scope: '企业门店', reason: '普通任务核到共享口径缺漏' },
};

test('an explicitly enterprise-owned foundation reopens with its enterprise while old foundations remain unassigned without a read migration', t => {
  const root = fixture(t), store = new StudioStore(root);
  const old = store.create(createInput);
  const indexFile = path.join(root, 'studio', 'index.json'), original = fs.readFileSync(indexFile);
  assert.equal(new StudioStore(root).get(old.id).enterpriseId, undefined);
  assert.deepEqual(fs.readFileSync(indexFile), original, 'Reading must not assign or rewrite a legacy foundation.');
  const owned = store.create({ ...createInput, enterpriseId: 'enterprise-a' });
  assert.equal(owned.enterpriseId, 'enterprise-a');
  assert.equal(new StudioStore(root).get(owned.id).enterpriseId, 'enterprise-a');
});

test('an unassigned foundation can be explicitly associated under CAS but cannot silently move to another enterprise', t => {
  const store = new StudioStore(fixture(t)), old = store.create(createInput);
  const associated = store.associateEnterprise(old.id, { enterpriseId: 'enterprise-a', expectedRevision: old.revision });
  assert.equal(associated.enterpriseId, 'enterprise-a');
  assert.equal(associated.projectId, old.projectId);
  assert.throws(() => store.associateEnterprise(old.id, { enterpriseId: 'enterprise-a', expectedRevision: old.revision }), /studio_conflict/);
  assert.throws(() => store.associateEnterprise(old.id, { enterpriseId: 'enterprise-b', expectedRevision: associated.revision }), /studio_enterprise_conflict/);
  assert.equal(store.get(old.id).enterpriseId, 'enterprise-a');
});

test('an authorized maintenance task continues an archived foundation without rewriting its original owner or published evidence', t => {
  const archived = new Set<string>(), root = fixture(t), store = new StudioStore(root, { isReadOnly: id => archived.has(id) });
  const system = store.create({ ...createInput, enterpriseId: 'enterprise-a' });
  const source = { authority: 'enterprise' as const, id: 'refund-policy', version: '2' };
  const asset = store.saveAsset(system.id, { kind: 'binding', title: '退款映射', body: '按退款事件去重', scope: '企业门店', sources: [source], readyForPublication: true });
  const preview = store.preparePublication(system.id, { assetIds: [asset.id], summary: '正式映射', scope: '企业门店' });
  store.confirmPublication(system.id, preview.id, preview.fingerprint);
  const original = store.get(system.id);
  archived.add(system.projectId);
  assert.throws(() => store.saveAsset(system.id, { kind: 'concept', title: '不允许', body: '原任务归档', scope: '门店', sources: [source] }), /studio_project_read_only/);
  const resumed = store.resumeMaintenance(system.id, { projectId: 'maintenance-project', taskId: 'maintenance-task', expectedRevision: original.revision });
  assert.deepEqual(studioContracts.studioExecutionOwner(resumed), { projectId: 'maintenance-project', taskId: 'maintenance-task' });
  assert.equal(resumed.projectId, original.projectId); assert.equal(resumed.taskId, original.taskId);
  assert.deepEqual(resumed.assets, original.assets); assert.deepEqual(resumed.publications, original.publications);
  assert.deepEqual(resumed.maintenanceHistory?.[0].previousOwner, { projectId: original.projectId, taskId: original.taskId });
  assert.equal(new StudioStore(root).get(system.id).maintenanceOwner?.taskId, 'maintenance-task');
  const updated = store.saveAsset(system.id, { assetId: asset.id, expectedRevision: 1, kind: 'binding', title: '退款映射', body: '补充退款归属', scope: '企业门店', sources: [source] });
  assert.equal(updated.formalRevision, 1); assert.equal(updated.candidateRevision, 2); assert.deepEqual(updated.revisions[0], original.assets[0].revisions[0]);
  assert.throws(() => store.resumeMaintenance(system.id, { projectId: 'other-project', taskId: 'other-task', expectedRevision: original.revision }), /studio_conflict/);
  archived.add('maintenance-project');
  assert.throws(() => store.addTopic(system.id, { title: '不能写', goal: '当前维护归档', scope: '企业' }), /studio_project_read_only/);
  assert.throws(() => store.resumeMaintenance(system.id, { projectId: system.projectId, taskId: system.taskId, expectedRevision: store.get(system.id).revision }), /studio_project_read_only/);
});

test('ordinary-task contributions retain exact provenance and CAS history without modifying foundation assets, including when original construction is archived', t => {
  let archived = false;
  const root = fixture(t), store = new StudioStore(root, { isReadOnly: id => archived && id === createInput.projectId });
  const system = store.create({ ...createInput, enterpriseId: 'enterprise-a' }); archived = true;
  const first = store.contribute(system.id, { ...contributionInput, baseSystemRevision: system.revision });
  assert.equal(first.sourceProjectId, contributionInput.sourceProjectId); assert.equal(first.sourceTaskId, contributionInput.sourceTaskId);
  assert.equal(first.scope, 'enterprise'); assert.equal(first.revision, 1); assert.deepEqual(first.revisions[0].report, contributionInput.report);
  assert.deepEqual(store.get(system.id).assets, []); assert.deepEqual(store.get(system.id).publications, []);
  assert.equal(new StudioStore(root).get(system.id).contributions?.[0].id, first.id);
  const next = store.contribute(system.id, { ...contributionInput, contributionId: first.id, expectedRevision: first.revision, candidate: { ...contributionInput.candidate, body: '补充全额退款后首购顺延，并保留观察期限制' } });
  assert.equal(next.revision, 2); assert.equal(next.revisions[0].candidate.body, contributionInput.candidate.body);
  assert.throws(() => store.contribute(system.id, { ...contributionInput, contributionId: first.id, expectedRevision: 1 }), /studio_contribution_conflict/);
  assert.throws(() => store.contribute(system.id, { ...contributionInput, contributionId: first.id, expectedRevision: 2, sourceTaskId: 'another-task' }), /studio_contribution_owner_mismatch/);
  assert.throws(() => store.contribute(system.id, { ...contributionInput, report: { ...contributionInput.report, projectId: 'other-project' } }), /studio_contribution_report_mismatch/);
  assert.throws(() => store.contribute(system.id, { ...contributionInput, baseSystemRevision: 1 }), /studio_contribution_base_conflict/);
  assert.equal(store.get(system.id).contributions?.[0].revisions.length, 2);
});

test('a reviewed contribution links an exact candidate revision and its frozen publication preview rejects later proposal drift', t => {
  const store = new StudioStore(fixture(t)), system = store.create({ ...createInput, enterpriseId: 'enterprise-a' });
  const source = contributionInput.sourceRefs[0];
  const original = store.saveAsset(system.id, { kind: 'binding', title: '购买资格', body: '原规则', scope: '企业门店', sources: [source], readyForPublication: true });
  const firstPreview = store.preparePublication(system.id, { assetIds: [original.id], summary: '原正式规则', scope: '企业' });
  store.confirmPublication(system.id, firstPreview.id, firstPreview.fingerprint);
  const base = { authority: 'studio-source' as const, id: original.id, version: '1', sha256: original.revisions[0].sha256, projectId: system.projectId, locator: system.id };
  const contribution = store.contribute(system.id, { ...contributionInput, baseRefs: [base] });
  const candidate = store.saveAsset(system.id, { assetId: original.id, expectedRevision: 1, kind: 'binding', title: '购买资格', body: '核定退款后的购买资格', scope: '企业门店', sources: [source], readyForPublication: true });
  const linked = store.linkContribution(system.id, { contributionId: contribution.id, expectedContributionRevision: 1, assetId: candidate.id, assetRevision: 2 });
  assert.equal(linked.linked?.assetId, candidate.id); assert.equal(linked.linked?.assetRevision, 2);
  assert.equal(store.getPublishedAsset(system.id, original.id).body, '原规则', 'Linking a proposal must not publish it.');
  const preview = store.preparePublication(system.id, { assetIds: [candidate.id], summary: '核定贡献的准确候选', scope: '企业门店' });
  assert.equal(preview.contributions?.[0].contributionId, contribution.id);
  assert.equal(preview.contributions?.[0].revision, 1); assert.equal(preview.contributions?.[0].sha256, contribution.revisions[0].sha256);
  assert.deepEqual(preview.contributions?.[0].report, contributionInput.report); assert.deepEqual(preview.contributions?.[0].baseRefs, [base]);
  assert.equal(preview.contributions?.[0].sourceTaskId, 'analysis-task');
  store.contribute(system.id, { ...contributionInput, contributionId: contribution.id, expectedRevision: 1, baseRefs: [base], candidate: { ...contributionInput.candidate, body: '新反馈补充观察资格限制' } });
  assert.throws(() => store.confirmPublication(system.id, preview.id, preview.fingerprint), /studio_contribution_changed/);
  assert.equal(store.getPublishedAsset(system.id, original.id).revision, 1);
  assert.deepEqual(store.get(system.id).publications.find(item => item.preview.id === preview.id)?.preview, preview, 'Stale preview is retained exactly, rather than repaired in place.');
});

test('a SAP contribution links only a registered exact professional candidate and preserves partial publication receipts separately from the proposal', t => {
  const root = fixture(t), store = new StudioStore(root), system = store.create({ ...createInput, enterpriseId: 'enterprise-a' });
  const candidateRef = { authority: 'sap-metric' as const, id: 'member-repurchase', version: '1.3.0', sha256: 'b'.repeat(64), projectId: system.projectId, locator: '020_clean/member-repurchase.yaml' };
  const base = { authority: 'sap-metric' as const, id: candidateRef.id, version: '1.2.0', sha256: 'c'.repeat(64) };
  const contribution = store.contribute(system.id, { ...contributionInput, baseRefs: [base], candidate: { ...contributionInput.candidate, kind: 'sap-metric' } });
  assert.throws(() => store.linkContribution(system.id, { contributionId: contribution.id, expectedContributionRevision: 1, ref: candidateRef }), /studio_contribution_target_changed/);
  store.addAssetRef(system.id, candidateRef);
  const linked = store.linkContribution(system.id, { contributionId: contribution.id, expectedContributionRevision: 1, ref: candidateRef });
  assert.deepEqual(linked.linked?.ref, candidateRef);
  const preview = store.preparePublication(system.id, { assetIds: [], refs: [candidateRef], summary: '准确SAP候选与普通分析贡献', scope: '企业会员' });
  assert.deepEqual(preview.contributions?.[0].ref, candidateRef); assert.deepEqual(preview.contributions?.[0].baseRefs, [base]);
  const published = store.confirmPublication(system.id, preview.id, preview.fingerprint);
  store.recordPublicationResult(system.id, preview.id, { module: 'sap-metric', status: 'unknown', refs: [candidateRef], detail: '原模块待查，不自动重发' });
  const after = store.get(system.id), revision = after.revision;
  const repeated = store.confirmPublication(system.id, preview.id, preview.fingerprint);
  assert.deepEqual(repeated.results.map(item => item.status), ['succeeded', 'unknown']);
  assert.equal(store.get(system.id).revision, revision); assert.deepEqual(after.contributions?.[0].linked?.ref, candidateRef);
  assert.deepEqual(new StudioStore(root).get(system.id).publications[0].preview, published.preview);
  const local = store.contribute(system.id, { ...contributionInput, scope: 'task', candidate: { ...contributionInput.candidate, kind: 'sap-metric' } });
  assert.throws(() => store.linkContribution(system.id, { contributionId: local.id, expectedContributionRevision: 1, ref: candidateRef }), /studio_contribution_task_local/);
  assert.equal(store.get(system.id).contributions?.find(item => item.id === local.id)?.linked, undefined);
});

test('reopening rejects a forged contribution target without repairing the retained bytes', t => {
  const root = fixture(t), store = new StudioStore(root), system = store.create({ ...createInput, enterpriseId: 'enterprise-a' });
  const ref = { authority: 'sap-method' as const, id: 'member-check', version: '2', sha256: 'b'.repeat(64) };
  store.addAssetRef(system.id, ref);
  const contribution = store.contribute(system.id, { ...contributionInput, candidate: { ...contributionInput.candidate, kind: 'sap-method' } });
  store.linkContribution(system.id, { contributionId: contribution.id, expectedContributionRevision: 1, ref });
  const indexFile = path.join(root, 'studio', 'index.json'), altered = JSON.parse(fs.readFileSync(indexFile, 'utf8'));
  altered.systems[0].contributions[0].linked.ref.sha256 = 'd'.repeat(64);
  fs.writeFileSync(indexFile, JSON.stringify(altered, null, 2) + '\n'); const bytes = fs.readFileSync(indexFile);
  assert.throws(() => new StudioStore(root).get(system.id), /invalid_studio_storage/);
  assert.deepEqual(fs.readFileSync(indexFile), bytes);
});
