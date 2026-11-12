import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EnterpriseMaterialsStore } from '../src/host/enterprise-materials-store.ts';
import { CaseStore } from '../src/host/case-store.ts';
import { prepareEnterpriseContext, enterpriseRequestIdentity } from '../src/host/enterprise-materials-context.ts';

test('SU15: enterprise-scoped ordinary context provides scoped discovery without the global material index path', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'optracall-studio-scope-context-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const materials = new EnterpriseMaterialsStore(root), cases = new CaseStore({ dataRoot: root });
  await cases.init(); t.after(() => cases.close());
  await materials.create({ title: '其他企业未选资料', body: '不属于本任务主动供给' });
  const result = await prepareEnterpriseContext(materials, cases, {}, {
    enterpriseId: 'enterprise-a', summary: '当前企业 A：按 studio_assets 发现获准正式资料，目录不是已读。', sourceAllowed: async () => false,
  });
  assert.match(result.text, /当前企业 A/);
  assert.doesNotMatch(result.text, /目录索引:/);
  assert.ok(!result.text.includes(root));
  assert.equal(result.provision?.directory.indexPath, undefined);
  assert.equal(result.provision?.directory.enterpriseId, 'enterprise-a');
  assert.deepEqual(result.provision?.materials, []);
});

test('SU13/22: explicit foreign material is rejected before identity or body provision while old saved evidence remains unchanged', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'optracall-studio-scope-selection-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const materials = new EnterpriseMaterialsStore(root), cases = new CaseStore({ dataRoot: root });
  await cases.init(); t.after(() => cases.close());
  const create = async (title: string) => {
    const value = await materials.create({ title, body: `${title}准确原文` });
    return materials.enable(value.material.id, value.material.version);
  };
  const first = await create('A 企业制度'), second = await create('B 企业制度');
  const selected = (value: typeof first) => ({ storeId: value.storeId, materialId: value.material.id, revisionId: value.material.activeRevisionId!, mode: 'full' });
  const foreign = { enterpriseMaterials: [selected(second)] };
  const saved = await prepareEnterpriseContext(materials, cases, foreign), oldBytes = JSON.stringify(saved);
  const scope = { enterpriseId: 'enterprise-a', summary: '当前企业 A', sourceAllowed: async (item: { materialId: string }) => item.materialId === first.material.id };
  await assert.rejects(prepareEnterpriseContext(materials, cases, foreign, scope), /enterprise_source_scope_forbidden/);
  await assert.rejects(enterpriseRequestIdentity(materials, foreign, scope.sourceAllowed), /enterprise_source_scope_forbidden/);
  const accepted = await prepareEnterpriseContext(materials, cases, { enterpriseMaterials: [selected(first)] }, scope);
  assert.match(accepted.text, /A 企业制度准确原文/);
  assert.ok(!accepted.text.includes('B 企业制度'));
  assert.equal(accepted.provision?.materials[0]?.revisionId, first.material.activeRevisionId);
  assert.equal(JSON.stringify(saved), oldBytes);
});
