import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { StudioStore } from '../extensions/business-plugins/studio/store.ts';
import { parseFoundationContent, foundationReferences, invalidateFoundationReadiness } from '../extensions/business-plugins/studio/foundation.ts';

const source = { authority: 'enterprise' as const, id: 'membership-policy', version: '1' };
function fixture(t: any) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'optracall-foundation-content-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const store = new StudioStore(root);
  const system = store.create({ name: '三类基础资产', projectId: 'project-a', taskId: 'task-a', goal: '企业共享三类定义', topicTitle: '基础定义' });
  return { store, system };
}
function asset(body: unknown, readyForPublication = false) {
  return { kind: 'ontology' as const, title: '会员关系与资格', scope: '企业A定义参考', body: typeof body === 'string' ? body : JSON.stringify(body), sources: [source], checks: [], readyForPublication };
}

test('explicit foundation content rejects duplicate item identities without creating an asset', t => {
  const { store, system } = fixture(t);
  const item = { itemId: 'md.membership', kind: 'entity', definition: '一条计划内资格关系', sourceRef: source };
  assert.throws(() => store.saveAsset(system.id, asset({ contentProfile: 'studio-foundation/1', items: [item, item] })), /invalid_studio_foundation/);
  assert.equal(store.get(system.id).assets.length, 0);
});

test('known profiles reject missing identity, hidden fields, and dangling or mistyped local references through the original save seam', t => {
  const { store, system } = fixture(t);
  const item = { itemId: 'md.membership', kind: 'entity', definition: '一条计划内资格关系', sourceRef: source };
  const profiles = [
    { items: [{ ...item, definition: '' }] },
    { items: [{ ...item, sourceRef: { ...source, version: '' } }] },
    { items: [{ ...item, fieldSource: { authority: 'enterprise', id: 'hidden', version: '2' } }] },
    { items: [{ ...item, parentItemId: 'missing' }] },
    { items: [item], metricLinks: [{ metricRef: { sourceRef: { authority: 'sap-metric', id: 'package', version: '1.0.0' }, metricName: 'active_memberships' }, ruleItemIds: ['md.membership'] }] },
    { items: [item], relations: [{ relationId: 'r1', type: 'causal-proof', from: { kind: 'item', itemId: item.itemId }, to: { kind: 'item', itemId: item.itemId }, evidenceRefs: [] }] },
    { items: [item], relations: [{ relationId: 'r1', type: 'domain', from: { kind: 'item', itemId: item.itemId }, to: { kind: 'item', itemId: 'missing' }, evidenceRefs: [] }] },
    { items: [item], metricLinks: [{ metricRef: { sourceRef: { authority: 'sap-metric', id: 'package', version: '1.0.0' }, metricName: 'active_memberships', formula: 'SUM(1)' } }] },
  ];
  for (const profile of profiles) {
    assert.throws(() => store.saveAsset(system.id, asset({ contentProfile: 'studio-foundation/1', ...profile })), /invalid_studio_foundation/, JSON.stringify(profile));
  }
  assert.equal(store.get(system.id).assets.length, 0);
});

test('complete content roundtrips exact source identity and enumerates every body dependency once', t => {
  const { store, system } = fixture(t);
  const ref = (id: string) => ({ authority: 'enterprise' as const, id, version: '1' });
  const metricRef = { sourceRef: { authority: 'sap-metric' as const, id: 'member_package', version: '1.0.0' }, metricName: 'active_memberships', scenario: 'overview' };
  const profile = {
    contentProfile: 'studio-foundation/1', scope: '企业A；仅定义参考',
    items: [{ itemId: 'md.membership', kind: 'entity', name: '计划内资格', definition: '主体与计划之间的一条资格关系', grain: '一条资格关系', sourceRef: source, validFrom: '2026-01-01', evidenceNature: '获准企业制度' }, { itemId: 'rule.eligibility', kind: 'rule', definition: '时点资格规则', sourceRef: source }],
    metricLinks: [{ metricRef, entityItemIds: ['md.membership'], ruleItemIds: ['rule.eligibility'], bindingRef: { authority: 'studio-source', id: 'binding-asset', version: '2', locator: 'binding-system' } }],
    relations: [{ relationId: 'domain-r1', type: 'domain', from: { kind: 'item', itemId: 'md.membership' }, to: { kind: 'external-item', itemRef: { sourceRef: { authority: 'studio-source', id: 'reference', version: '3', locator: 'source-system' }, itemId: 'md.reference' } }, evidenceRefs: [ref('relation-evidence')] }, { relationId: 'metric-r2', type: 'analysis-use', from: { kind: 'item', itemId: 'md.membership' }, to: { kind: 'metric', metricRef }, evidenceRefs: [] }],
    adaptations: [{ referenceRef: { sourceRef: ref('public-reference'), itemId: 'md.reference-membership' }, targetItemId: 'md.membership', action: 'modify', reason: '按企业制度核定', evidenceRefs: [ref('adaptation-evidence')] }],
    bindingLinks: [{ sourceRef: { authority: 'data', id: 'input-table', version: 'snapshot-1', locator: '020_clean/member.csv' }, field: 'membership_id', itemId: 'md.membership', grain: '一行一条计划资格', detail: '是否唯一仍由Agent核查', evidenceRefs: [ref('mapping-evidence')] }],
    readiness: { definition: { status: 'pass', detail: '作者已核定义', evidenceRefs: [ref('definition-evidence')] }, mapping: { status: 'pending', detail: '等待核映射', evidenceRefs: [ref('mapping-state-evidence')] }, computation: { status: 'unknown', detail: '条件未核定', evidenceRefs: [ref('computation-evidence')] }, use: { status: 'fail', detail: '仅作者声明，不是独立使用验证', evidenceRefs: [ref('use-evidence')] } },
  };
  const body = JSON.stringify(profile, null, 2);
  const saved = store.saveAsset(system.id, asset(body));
  assert.equal(new StudioStore(store.dataRoot).get(system.id).assets[0].revisions[0].body, body);
  const parsed = parseFoundationContent(saved.revisions[0].body);
  assert.equal(parsed.kind, 'supported', JSON.stringify(parsed.issues));
  const refs = foundationReferences(parsed.profile!);
  assert.deepEqual(refs.map(ref => ref.id).sort(), ['membership-policy', 'member_package', 'binding-asset', 'reference', 'relation-evidence', 'public-reference', 'adaptation-evidence', 'input-table', 'mapping-evidence', 'definition-evidence', 'mapping-state-evidence', 'computation-evidence', 'use-evidence'].sort());
  assert.equal(refs.find(ref => ref.id === 'reference')?.locator, 'source-system');
  assert.equal(parsed.profile!.relations![0].to.kind, 'external-item');
  assert.equal('formula' in parsed.profile!.metricLinks![0].metricRef, false);
});

test('manual edits invalidate all declared readiness evidence without changing identities or creating independent use proof', () => {
  const body = JSON.stringify({ contentProfile: 'studio-foundation/1', items: [{ itemId: 'md.member', kind: 'entity', definition: '会员资格关系', sourceRef: source }], readiness: Object.fromEntries(['definition', 'mapping', 'computation', 'use'].map(key => [key, { status: 'pass', detail: '旧作者声明', evidenceRefs: [source] }])) });
  const invalidated = parseFoundationContent(invalidateFoundationReadiness(body));
  assert.equal(invalidated.kind, 'supported');
  assert.deepEqual(invalidated.profile!.items, JSON.parse(body).items);
  for (const state of Object.values(invalidated.profile!.readiness!)) { assert.equal(state?.status, 'pending'); assert.deepEqual(state?.evidenceRefs, []); }
  assert.equal(invalidateFoundationReadiness('保留原有文字'), '保留原有文字');
});

test('legacy bodies remain exact while unsupported profiles stay draft-only and malformed explicit profiles cannot fall back', t => {
  const { store, system } = fixture(t);
  for (const body of ['历史文字内容\n版本不变', '{"entities":[{"name":"会员"}]}']) {
    const saved = store.saveAsset(system.id, asset(body, true));
    assert.equal(parseFoundationContent(body).kind, 'legacy');
    assert.equal(store.get(system.id).assets.find(item => item.id === saved.id)?.revisions[0].body, body);
    assert.ok(store.preparePublication(system.id, { assetIds: [saved.id], summary: '原文字定义参考', scope: '定义参考' }));
  }
  const unknown = '{"contentProfile":"studio-foundation/99","futureField":{"sourceRef":{"id":"untouched"}}}';
  const draft = store.saveAsset(system.id, asset(unknown));
  assert.equal(parseFoundationContent(unknown).kind, 'unsupported');
  assert.equal(store.get(system.id).assets.find(item => item.id === draft.id)?.revisions[0].body, unknown);
  assert.throws(() => store.saveAsset(system.id, asset(unknown, true)), /unsupported_studio_foundation/);
  assert.throws(() => store.preparePublication(system.id, { assetIds: [draft.id], summary: '结构未支持', scope: '定义参考' }), /studio_source_not_ready/);
  for (const body of ['{"contentProfile":"studio-foundation/1",', '{"contentProfile":23,"items":[]}']) assert.throws(() => store.saveAsset(system.id, asset(body)), /invalid_studio_foundation/);
});

test('one exact metric cannot acquire two independently editable links by reordering source properties', t => {
  const { store, system } = fixture(t);
  const metricName = 'active_memberships';
  const profile = { contentProfile: 'studio-foundation/1', items: [], metricLinks: [
    { metricRef: { sourceRef: { authority: 'sap-metric', id: 'package', version: '1.0.0' }, metricName } },
    { metricRef: { metricName, sourceRef: { version: '1.0.0', id: 'package', authority: 'sap-metric' } } },
  ] };
  assert.throws(() => store.saveAsset(system.id, asset(profile)), /invalid_studio_foundation/);
});

test('definition reference can publish with missing mapping declarations while original FAIL and UNKNOWN checks still block', t => {
  const { store, system } = fixture(t);
  const profile = { contentProfile: 'studio-foundation/1', items: [{ itemId: 'md.member', kind: 'entity', definition: '资格关系的定义参考', sourceRef: source }] };
  const saved = store.saveAsset(system.id, asset(profile, true));
  const preview = store.preparePublication(system.id, { assetIds: [saved.id], summary: '仅发布定义参考', scope: '定义参考；不可据此认定可计算' });
  store.confirmPublication(system.id, preview.id, preview.fingerprint);
  for (const status of ['fail', 'unknown'] as const) {
    const changed = store.saveAsset(system.id, { ...asset(profile, true), assetId: saved.id, expectedRevision: store.get(system.id).assets[0].revisions.at(-1)!.revision, checks: [{ name: '需保留的原检查', status, detail: '不能改名或以readiness覆盖' }] });
    assert.throws(() => store.preparePublication(system.id, { assetIds: [changed.id], summary: '不合格候选', scope: '定义参考' }), /studio_source_not_ready/);
    assert.equal(store.get(system.id).assets[0].formalRevision, 1);
  }
  assert.equal(store.getPublishedAsset(system.id, saved.id, 1).body, JSON.stringify(profile));
});

test('task contributions enforce the same known content shape while preserving unsupported drafts', t => {
  const { store, system } = fixture(t);
  const input = { sourceProjectId: 'analysis-project', sourceTaskId: 'analysis-task', scope: 'task' as const,
    report: { authority: 'task' as const, id: 'report', version: '1', projectId: 'analysis-project', taskId: 'analysis-task' },
    sourceRefs: [source], candidate: { kind: 'ontology' as const, title: '任务贡献', scope: '本案候选', body: '{"contentProfile":"studio-foundation/1","items":[{"itemId":"incomplete"}]}' } };
  assert.throws(() => store.contribute(system.id, input), /invalid_studio_foundation/);
  assert.deepEqual(store.get(system.id).contributions ?? [], []);
  const body = '{"contentProfile":"studio-foundation/99","unmodifiedDraft":true}';
  const saved = store.contribute(system.id, { ...input, candidate: { ...input.candidate, body } });
  assert.equal(new StudioStore(store.dataRoot).get(system.id).contributions?.[0].revisions[0].candidate.body, body);
  assert.equal(saved.revision, 1);
});

test('ordinary source prose can quote foundation examples and append candidates without changing historical bytes', t => {
  const { store, system } = fixture(t);
  const bodies = [
    '示例：\n```json\n{"contentProfile":"studio-foundation/1","items":[]}\n```',
    '{"example":{"contentProfile":"studio-foundation/1","items":[]}}\n随后补充企业解释',
    '{"note":"示例字段\\\"contentProfile\\\":仅供参考"}\n这是普通说明',
  ];
  for (const body of bodies) {
    const first = store.saveAsset(system.id, asset(body, true));
    const changed = store.saveAsset(system.id, { ...asset(body + '\n新增普通说明', true), assetId: first.id, expectedRevision: 1 });
    assert.equal(parseFoundationContent(body).kind, 'legacy');
    assert.equal(changed.revisions[0].body, body);
    assert.equal(changed.revisions[1].body, body + '\n新增普通说明');
    assert.ok(store.preparePublication(system.id, { assetIds: [first.id], summary: '文字候选', scope: '仅为参考说明' }));
  }
  for (const body of ['{"contentProfile":"studio-foundation/1",', '{"items":[],"contentProfile":"studio-foundation/1",', '{"note":"普通描述","contentProfile":', '{"\\u0063ontentProfile":"studio-foundation/1",']) {
    assert.throws(() => store.saveAsset(system.id, asset(body)), /invalid_studio_foundation/, body);
  }
});
