import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { StudioStore } from '../extensions/business-plugins/studio/store.ts';
import type { StudioCheck, StudioPublicationInput } from '../extensions/business-plugins/studio/contracts.ts';
import { digest } from '../extensions/business-plugins/studio/validation.ts';

const policy = { authority: 'enterprise' as const, id: 'synthetic-rule-policy', version: 'policy-2' };
const binding = { authority: 'studio-source' as const, id: 'synthetic-rule-binding', version: 'binding-3', locator: 'synthetic-system', sha256: 'a'.repeat(64) };
const dataSource = { authority: 'data' as const, id: 'synthetic-rule-input', version: 'input-4', locator: '020_clean/facts.json', sha256: 'b'.repeat(64) };
function fixture(t: any) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'optracall-rule-publication-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const store = new StudioStore(root);
  const system = store.create({ name: 'Synthetic publication purposes', projectId: 'project-a', taskId: 'task-a', goal: 'Publish exact synthetic rule projections', topicTitle: 'Synthetic rules' });
  return { root, store, system };
}
function content() {
  return {
    contentProfile: 'studio-foundation/2',
    items: [{ itemId: 'member', kind: 'entity', definition: 'A program membership.', sourceRef: policy }, { itemId: 'eligibility', kind: 'rule', definition: 'A normal membership is eligible.', sourceRef: policy }],
    ruleExecution: {
      contractVersion: 'studio-rule-execution/1', engine: { name: 'semantica', version: '0.7.0' },
      rules: [{ ruleId: 'normal-eligibility', ruleItemId: 'eligibility', conditions: ['Normal(?member)'], conclusion: 'Eligible(?member)' }],
      predicates: [{ predicate: 'Normal', namespace: 'synthetic.membership', itemId: 'member', arguments: [{ name: 'member', itemId: 'member', valueType: 'string' }] }, { predicate: 'Eligible', namespace: 'synthetic.membership', itemId: 'eligibility', arguments: [{ name: 'member', itemId: 'member', valueType: 'string' }] }],
      factRequirements: [{ requirementId: 'normal-records', predicate: 'Normal', sourceRef: dataSource, bindingRef: binding, fields: ['membership_id', 'status'], grain: 'A program membership', unit: 'Membership', timeBasis: 'Policy time', coverage: 'All approved records; missing status stays unknown', kind: 'observed' }],
    },
    readiness: Object.fromEntries(['definition', 'mapping', 'computation'].map(key => [key, { status: 'pass', detail: 'Synthetic author declaration', evidenceRefs: [policy] }])),
  };
}
const executionCheck: StudioCheck = { name: 'rule-execution', status: 'pass', detail: 'Synthetic check only; Host verifies its native execution receipt separately.' };
const asset = (body: string, checks: StudioCheck[] = [executionCheck]) => ({ kind: 'ontology' as const, title: 'Synthetic exact policy', scope: 'Synthetic approved definition', body, sources: [policy], checks, readyForPublication: true });
const previewInput = (assetIds: string[]): StudioPublicationInput => ({ assetIds, summary: 'Synthetic exact publication', scope: 'Synthetic definition scope' });

test('a /2 preview defaults to definition reference and freezes exact execution requirements from the selected source revision', t => {
  const { root, store, system } = fixture(t);
  const body = content(), saved = store.saveAsset(system.id, asset(JSON.stringify(body)));
  const preview = store.preparePublication(system.id, previewInput([saved.id]));
  assert.deepEqual(preview.purposes, ['definition-reference']);
  assert.deepEqual(preview.executionSummaries, [{ assetId: saved.id, revision: 1, sha256: saved.revisions[0].sha256, contractVersion: 'studio-rule-execution/1', engine: body.ruleExecution.engine, ruleItemIds: ['eligibility'], factRequirements: body.ruleExecution.factRequirements }]);
  assert.deepEqual(new StudioStore(root).get(system.id).publications[0].preview, preview);
  const published = store.confirmPublication(system.id, preview.id, preview.fingerprint);
  assert.deepEqual(published.preview.executionSummaries, preview.executionSummaries);
});

test('explicit rule execution requires the exact projection and current definition mapping computation and revision checks', t => {
  const { store, system } = fixture(t);
  const good = store.saveAsset(system.id, asset(JSON.stringify(content())));
  const request = (assetId: string) => ({ ...previewInput([assetId]), purposes: ['rule-execution' as const] });
  assert.deepEqual(store.preparePublication(system.id, request(good.id)).purposes, ['rule-execution']);
  for (const change of [
    (body: any) => { body.readiness.definition.status = 'fail'; },
    (body: any) => { body.readiness.mapping.status = 'pending'; },
    (body: any) => { body.readiness.computation.status = 'unknown'; },
    (body: any) => { delete body.readiness.computation; },
  ]) {
    const body = content(); change(body);
    const saved = store.saveAsset(system.id, asset(JSON.stringify(body)));
    assert.throws(() => store.preparePublication(system.id, request(saved.id)), /studio_rule_execution_not_ready/);
  }
  const missingCheck = store.saveAsset(system.id, asset(JSON.stringify(content()), []));
  assert.throws(() => store.preparePublication(system.id, { ...request(missingCheck.id), checks: [executionCheck] }), /studio_rule_execution_not_ready/);
  const legacy = store.saveAsset(system.id, asset('An independent historical definition.', []));
  assert.throws(() => store.preparePublication(system.id, request(legacy.id)), /studio_rule_execution_required/);
  assert.ok(store.preparePublication(system.id, { ...previewInput([legacy.id]), purposes: ['definition-reference'], excluded: ['Rule execution remains restricted'] }));
});

test('publication accepts only declared distinct purposes and callers cannot inject an execution summary', t => {
  const { store, system } = fixture(t);
  const saved = store.saveAsset(system.id, asset(JSON.stringify(content())));
  for (const purposes of [[], ['business-action'], ['rule-execution', 'rule-execution'], 'rule-execution', null]) {
    assert.throws(() => store.preparePublication(system.id, { ...previewInput([saved.id]), purposes } as any), /invalid_studio_publication_purposes/);
  }
  assert.throws(() => store.preparePublication(system.id, { ...previewInput([saved.id]), executionSummaries: [{ assetId: saved.id, revision: 1, sha256: '0'.repeat(64), ruleItemIds: ['invented'] }] } as any), /invalid_studio_publication_execution_summaries/);
  assert.deepEqual(store.get(system.id).publications, []);
  const preview = store.preparePublication(system.id, { ...previewInput([saved.id]), purposes: ['definition-reference', 'metric-calculation'] });
  assert.deepEqual(preview.purposes, ['definition-reference', 'metric-calculation']);
  assert.equal(preview.executionSummaries![0].sha256, saved.revisions[0].sha256);
});

test('reopening rejects inconsistent execution metadata even when the enclosing preview fingerprint was updated', t => {
  for (const change of [
    (preview: any) => { preview.executionSummaries[0].factRequirements[0].coverage = 'Different unapproved input coverage'; },
    (preview: any) => { preview.purposes = ['invented-purpose']; },
    (preview: any) => { delete preview.executionSummaries; },
  ]) {
    const { root, store, system } = fixture(t);
    const saved = store.saveAsset(system.id, asset(JSON.stringify(content())));
    store.preparePublication(system.id, { ...previewInput([saved.id]), purposes: ['rule-execution'] });
    const file = path.join(store.root, 'index.json'), bytes = JSON.parse(fs.readFileSync(file, 'utf8'));
    const preview = bytes.systems[0].publications[0].preview; change(preview);
    const { fingerprint: _fingerprint, confirmedAt: _confirmedAt, ...prepared } = preview;
    preview.fingerprint = digest(prepared);
    fs.writeFileSync(file, JSON.stringify(bytes, null, 2));
    assert.throws(() => new StudioStore(root).get(system.id), /invalid_studio_storage/);
  }
});

test('a changed candidate invalidates its preview while earlier formal rules and frozen requirements retain their exact history', t => {
  const { root, store, system } = fixture(t);
  const original = content(), originalBody = JSON.stringify(original);
  const saved = store.saveAsset(system.id, asset(originalBody));
  const request = { ...previewInput([saved.id]), purposes: ['rule-execution' as const] };
  const first = store.preparePublication(system.id, request);
  store.confirmPublication(system.id, first.id, first.fingerprint);
  const revised = content(); revised.ruleExecution.factRequirements[0].sourceRef.version = 'input-5'; revised.ruleExecution.factRequirements[0].coverage = 'New frozen approved input coverage';
  store.saveAsset(system.id, { ...asset(JSON.stringify(revised)), assetId: saved.id, expectedRevision: 1 });
  const second = store.preparePublication(system.id, request);
  assert.equal(second.executionSummaries![0].revision, 2);
  assert.equal(second.executionSummaries![0].factRequirements[0].sourceRef.version, 'input-5');
  revised.ruleExecution.rules.push({ ...revised.ruleExecution.rules[0], ruleId: 'second-official-clause' });
  store.saveAsset(system.id, { ...asset(JSON.stringify(revised)), assetId: saved.id, expectedRevision: 2 });
  assert.throws(() => store.confirmPublication(system.id, second.id, second.fingerprint), /studio_publication_changed/);
  const third = store.preparePublication(system.id, request);
  assert.equal(third.executionSummaries![0].revision, 3);
  assert.deepEqual(third.executionSummaries![0].ruleItemIds, ['eligibility']);
  store.confirmPublication(system.id, third.id, third.fingerprint);
  const reopened = new StudioStore(root);
  assert.equal(reopened.getPublishedAsset(system.id, saved.id, 1).body, originalBody);
  assert.deepEqual(reopened.get(system.id).publications[0].preview.executionSummaries, first.executionSummaries);
  assert.equal(reopened.get(system.id).assets.find(value => value.id === saved.id)!.formalRevision, 3);
});

test('historical publications without purpose or execution metadata stay readable without gaining execution qualification', t => {
  const { root, store, system } = fixture(t);
  const legacy = store.saveAsset(system.id, asset('Original historical definition.', []));
  const oldPreview = store.preparePublication(system.id, previewInput([legacy.id]));
  assert.equal(Object.hasOwn(oldPreview, 'purposes'), false);
  assert.equal(Object.hasOwn(oldPreview, 'executionSummaries'), false);
  store.confirmPublication(system.id, oldPreview.id, oldPreview.fingerprint);
  assert.deepEqual(new StudioStore(root).get(system.id).publications[0].preview, store.get(system.id).publications[0].preview);

  const rule = store.saveAsset(system.id, asset(JSON.stringify(content())));
  const preview = store.preparePublication(system.id, previewInput([rule.id]));
  const file = path.join(store.root, 'index.json'), bytes = JSON.parse(fs.readFileSync(file, 'utf8'));
  const historical = bytes.systems[0].publications.find((value: any) => value.preview.id === preview.id).preview;
  delete historical.purposes; delete historical.executionSummaries;
  const { fingerprint: _fingerprint, confirmedAt: _confirmedAt, ...prepared } = historical; historical.fingerprint = digest(prepared);
  fs.writeFileSync(file, JSON.stringify(bytes, null, 2));
  const restored = new StudioStore(root).get(system.id).publications.find(value => value.preview.id === preview.id)!.preview;
  assert.deepEqual(restored, historical);
  assert.equal(restored.purposes?.includes('rule-execution') ?? false, false);
});

test('FAIL and UNKNOWN checks remain blocking and an independent definition can still publish with the restricted rule excluded', t => {
  const { store, system } = fixture(t);
  for (const status of ['fail', 'unknown'] as const) {
    const saved = store.saveAsset(system.id, asset(JSON.stringify(content()), [{ ...executionCheck, status }]));
    assert.throws(() => store.preparePublication(system.id, { ...previewInput([saved.id]), purposes: ['rule-execution'] }), /studio_source_not_ready/);
    assert.throws(() => store.preparePublication(system.id, { ...previewInput([saved.id]), purposes: ['definition-reference'] }), /studio_source_not_ready/);
  }
  const independent = store.saveAsset(system.id, asset(JSON.stringify({ contentProfile: 'studio-foundation/1', items: [{ itemId: 'store', kind: 'entity', definition: 'An independently qualified store definition.', sourceRef: policy }] }), []));
  const preview = store.preparePublication(system.id, { ...previewInput([independent.id]), purposes: ['definition-reference'], excluded: ['Restricted rule assets remain excluded; their FAIL/UNKNOWN is preserved'] });
  assert.equal(preview.executionSummaries, undefined);
  store.confirmPublication(system.id, preview.id, preview.fingerprint);
  assert.equal(store.get(system.id).assets.filter(value => value.formalRevision !== null).length, 1);
});
