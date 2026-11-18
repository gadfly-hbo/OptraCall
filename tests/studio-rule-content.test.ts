import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { StudioStore } from '../extensions/business-plugins/studio/store.ts';
import { parseFoundationContent, foundationReferences, foundationDependencyReferences, invalidateFoundationReadiness } from '../extensions/business-plugins/studio/foundation.ts';

const source = { authority: 'enterprise' as const, id: 'synthetic-policy', version: 'policy-1' };
const item = { itemId: 'member', kind: 'entity', definition: 'A program-specific membership relationship.', sourceRef: source };
function fixture(t: any) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'optracall-rule-content-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const store = new StudioStore(root);
  const system = store.create({ name: 'Synthetic rule content', projectId: 'project-a', taskId: 'task-a', goal: 'Rule content compatibility', topicTitle: 'Synthetic foundation' });
  return { root, store, system };
}
const asset = (body: string, readyForPublication = false) => ({ kind: 'ontology' as const, title: 'Synthetic policy', scope: 'Definition reference only', body, sources: [source], checks: [], readyForPublication });

const binding = { authority: 'studio-source' as const, id: 'synthetic-binding', version: '2', locator: 'synthetic-system', sha256: 'a'.repeat(64) };
const dataSource = { authority: 'data' as const, id: 'synthetic-members', version: 'snapshot-3', locator: '020_clean/members.csv', sha256: 'b'.repeat(64) };
function ruleContent() {
  return {
    contentProfile: 'studio-foundation/2',
    items: [item, { itemId: 'status.normal', kind: 'concept', definition: 'Normal membership status.', sourceRef: source }, { itemId: 'rule.eligibility', kind: 'rule', definition: 'A normal program membership is eligible.', sourceRef: source }],
    ruleExecution: {
      contractVersion: 'studio-rule-execution/1', engine: { name: 'semantica', version: '0.7.0' },
      rules: [{ ruleId: 'eligibility-normal', ruleItemId: 'rule.eligibility', conditions: ['Normal(?member)'], conclusion: 'Eligible(?member)' }],
      predicates: [
        { predicate: 'Normal', namespace: 'synthetic.membership', itemId: 'status.normal', arguments: [{ name: 'member', itemId: 'member', valueType: 'string' }] },
        { predicate: 'Eligible', namespace: 'synthetic.membership', itemId: 'rule.eligibility', arguments: [{ name: 'member', itemId: 'member', valueType: 'string' }] },
      ],
      factRequirements: [{ requirementId: 'normal-status', predicate: 'Normal', sourceRef: dataSource, bindingRef: binding, fields: ['membership_id', 'status'], grain: 'One program membership', unit: 'Membership', timeBasis: 'Policy effective time', coverage: 'All approved membership records; missing status remains unknown', kind: 'observed' }],
    },
  };
}

test('foundation /2 can retain /1 definition fields through the original save and reopen path without creating execution', t => {
  const { root, store, system } = fixture(t);
  const body = JSON.stringify({ contentProfile: 'studio-foundation/2', items: [item], scope: 'Synthetic definition reference' }, null, 2);
  const parsed = parseFoundationContent(body);
  assert.equal(parsed.kind, 'supported', JSON.stringify(parsed.issues));
  assert.equal(parsed.profile!.contentProfile, 'studio-foundation/2');
  assert.equal('ruleExecution' in parsed.profile!, false);
  const saved = store.saveAsset(system.id, asset(body, true));
  assert.equal(new StudioStore(root).get(system.id).assets.find(value => value.id === saved.id)!.revisions[0].body, body);
  assert.deepEqual(foundationReferences(parsed.profile!), [source]);
  assert.deepEqual(foundationDependencyReferences(parsed.profile!), [source]);
});

test('rule execution remains in its original /2 revision and exact source and Binding references survive save and reopen', t => {
  const { root, store, system } = fixture(t);
  const content = ruleContent(), body = JSON.stringify(content, null, 2);
  const parsed = parseFoundationContent(body);
  assert.equal(parsed.kind, 'supported', JSON.stringify(parsed.issues));
  const saved = store.saveAsset(system.id, asset(body));
  const reopened = new StudioStore(root).get(system.id).assets.find(value => value.id === saved.id)!;
  assert.equal(reopened.revisions[0].body, body);
  assert.deepEqual(parsed.profile!.ruleExecution, content.ruleExecution);
  assert.deepEqual(foundationReferences(parsed.profile!).map(ref => ref.id).sort(), ['synthetic-policy', 'synthetic-members', 'synthetic-binding'].sort());
  assert.deepEqual(foundationDependencyReferences(parsed.profile!).map(ref => ref.id).sort(), ['synthetic-policy', 'synthetic-members', 'synthetic-binding'].sort());
});

test('ambiguous execution identifiers and unattached fact requirements cannot be saved as a known rule projection', t => {
  const { store, system } = fixture(t);
  const cases: ((content: ReturnType<typeof ruleContent>) => void)[] = [
    content => { content.ruleExecution.rules.push({ ...content.ruleExecution.rules[0] }); },
    content => { content.ruleExecution.predicates.push({ ...content.ruleExecution.predicates[0], namespace: 'another.identity' }); },
    content => { content.ruleExecution.predicates[0].arguments.push({ ...content.ruleExecution.predicates[0].arguments[0] }); },
    content => { content.ruleExecution.factRequirements.push({ ...content.ruleExecution.factRequirements[0] }); },
    content => { content.ruleExecution.factRequirements[0].predicate = 'Undeclared'; },
    content => { content.ruleExecution.factRequirements[0].kind = 'external-computation'; },
    content => { content.ruleExecution.rules[0].conditions = []; },
    content => { content.ruleExecution.factRequirements[0].fields = []; },
  ];
  for (const change of cases) {
    const content = ruleContent(); change(content);
    assert.throws(() => store.saveAsset(system.id, asset(JSON.stringify(content))), /invalid_studio_foundation/, JSON.stringify(content));
  }
  assert.deepEqual(store.get(system.id).assets, []);
});

test('unknown execution contracts, component versions and constraint formats preserve draft bytes and cannot gain publication readiness', t => {
  const { root, store, system } = fixture(t);
  const cases: ((content: any) => void)[] = [
    content => { content.ruleExecution.contractVersion = 'studio-rule-execution/99'; },
    content => { content.ruleExecution.engine.version = '99.0.0'; },
    content => { content.ruleExecution.engine.name = 'another-engine'; },
    content => { content.ruleExecution.constraints = { format: 'unknown-constraints', shapes: 'untouched', sourceRefs: [source] }; },
  ];
  for (const change of cases) {
    const content = ruleContent(); change(content); const body = JSON.stringify(content, null, 2);
    assert.equal(parseFoundationContent(body).kind, 'unsupported');
    const saved = store.saveAsset(system.id, asset(body));
    assert.equal(new StudioStore(root).get(system.id).assets.find(value => value.id === saved.id)!.revisions[0].body, body);
    assert.throws(() => store.saveAsset(system.id, asset(body, true)), /unsupported_studio_foundation/);
  }
});

test('external computation and constraint inputs are required dependencies while construction receipts remain evidence only', () => {
  const content: any = ruleContent();
  const calculated = { authority: 'task', id: 'calculation-output', version: 'output-4', projectId: 'approved-project', taskId: 'approved-task', locator: '060_reports/facts.json', sha256: 'c'.repeat(64) };
  const evidence = { authority: 'task', id: 'construction-check', version: 'receipt-1', projectId: 'construction-project', taskId: 'construction-task', locator: '060_reports/check.json' };
  const constraintsSource = { authority: 'enterprise', id: 'synthetic-schema', version: 'schema-2' };
  content.ruleExecution.factRequirements[0].kind = 'external-computation';
  content.ruleExecution.factRequirements[0].calculationRefs = [calculated];
  content.ruleExecution.constraints = { format: 'shacl-turtle', shapes: '@prefix sh: <http://www.w3.org/ns/shacl#> .', sourceRefs: [constraintsSource] };
  content.readiness = { definition: { status: 'pass', detail: 'Author declaration only', evidenceRefs: [evidence] } };
  const parsed = parseFoundationContent(JSON.stringify(content));
  assert.equal(parsed.kind, 'supported', JSON.stringify(parsed.issues));
  assert.deepEqual(foundationReferences(parsed.profile!).map(ref => ref.id).sort(), ['synthetic-policy', 'synthetic-members', 'synthetic-binding', 'calculation-output', 'construction-check', 'synthetic-schema'].sort());
  assert.deepEqual(foundationDependencyReferences(parsed.profile!).map(ref => ref.id).sort(), ['synthetic-policy', 'synthetic-members', 'synthetic-binding', 'calculation-output', 'synthetic-schema'].sort());
  assert.deepEqual(parsed.profile!.ruleExecution!.factRequirements[0].calculationRefs, [calculated]);
});

test('editing a /2 definition keeps old revision bytes, invalidates declared readiness and prevents confirming the old preview', t => {
  const { store, system } = fixture(t);
  const content: any = ruleContent();
  content.readiness = Object.fromEntries(['definition', 'mapping', 'computation', 'use'].map(key => [key, { status: 'pass', detail: 'Author declaration only', evidenceRefs: [source] }]));
  const originalBody = JSON.stringify(content, null, 2);
  const saved = store.saveAsset(system.id, asset(originalBody, true));
  const preview = store.preparePublication(system.id, { assetIds: [saved.id], summary: 'Synthetic exact definition reference', scope: 'Definition reference only' });
  content.items[2].definition = 'A changed readable policy definition.';
  const changedBody = invalidateFoundationReadiness(JSON.stringify(content));
  const parsed = parseFoundationContent(changedBody);
  assert.equal(parsed.kind, 'supported');
  assert.deepEqual(parsed.profile!.ruleExecution, content.ruleExecution);
  for (const state of Object.values(parsed.profile!.readiness!)) { assert.equal(state!.status, 'pending'); assert.deepEqual(state!.evidenceRefs, []); }
  store.saveAsset(system.id, { ...asset(changedBody), assetId: saved.id, expectedRevision: 1 });
  assert.throws(() => store.confirmPublication(system.id, preview.id, preview.fingerprint), /studio_publication_changed/);
  const reopened = new StudioStore(store.dataRoot).get(system.id).assets.find(value => value.id === saved.id)!;
  assert.equal(reopened.revisions[0].body, originalBody);
  assert.equal(reopened.revisions[1].body, changedBody);
});

test('/1 remains strict, unknown profiles remain drafts and rule expression strings are retained for the official worker to assess', t => {
  const { store, system } = fixture(t);
  const content = ruleContent();
  assert.equal(parseFoundationContent(JSON.stringify({ ...content, contentProfile: 'studio-foundation/1' })).kind, 'invalid');
  assert.equal(parseFoundationContent(JSON.stringify({ ...content, contentProfile: 'studio-foundation/99' })).kind, 'unsupported');
  content.ruleExecution.rules[0].conditions = ['NOT Normal(?member)'];
  const body = JSON.stringify(content);
  const saved = store.saveAsset(system.id, asset(body));
  assert.equal(saved.revisions[0].body, body);
  assert.deepEqual(parseFoundationContent(body).profile!.ruleExecution!.rules[0].conditions, ['NOT Normal(?member)']);
  for (const change of [
    (value: any) => { value.ruleExecution.rules[0].ruleItemId = 'member'; },
    (value: any) => { value.ruleExecution.predicates[0].arguments[0].itemId = 'missing'; },
    (value: any) => { value.ruleExecution.factRequirements[0].bindingRef = source; },
    (value: any) => { value.ruleExecution.rules[0].callback = 'arbitrary code'; },
    (value: any) => { value.ruleExecution.rules[0].conditions = 'Normal(?member)'; },
  ]) {
    const candidate = ruleContent(); change(candidate);
    assert.throws(() => store.saveAsset(system.id, asset(JSON.stringify(candidate))), /invalid_studio_foundation/);
  }
});
