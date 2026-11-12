import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile } from 'node:fs/promises';
import path from 'node:path';
import { ProjectStore } from '../src/host/project-store.ts';
import { EnterpriseMaterialsStore } from '../src/host/enterprise-materials-store.ts';
import { createStudioFeature } from '../src/host/studio-host.ts';
import { createMetricLibrary } from '../extensions/business-plugins/metric-factory/library/store.ts';
import { preparePublication as prepareSapPublication } from '../extensions/business-plugins/metric-factory/sap/validate.ts';
import type { StudioSourceRef } from '../extensions/business-plugins/studio/contracts.ts';

async function fixture(t: { after(fn: () => Promise<void>): void }) {
  const base = path.resolve('.local/studio-foundation-implementation/host/fixtures');
  await mkdir(base, { recursive: true });
  const root = await mkdtemp(path.join(base, 'port-')), dataRoot = path.join(root, 'data');
  const projects = new ProjectStore({ dataRoot, projectsRoot: path.join(root, 'projects') });
  await projects.init();
  const configuration = { id: 'synthetic', revision: 1, name: 'Synthetic', provider: 'synthetic', model: 'synthetic', baseUrl: 'http://127.0.0.1:1' };
  const project = await projects.create({ name: 'Synthetic foundation construction', configuration });
  const task = await projects.createTask(project.id, { name: 'Build approved foundation candidates' });
  const enterpriseMaterials = new EnterpriseMaterialsStore(dataRoot);
  const studio = createStudioFeature({
    dataRoot, projects, enterpriseMaterials, readBody: async () => ({}),
    mutate: async operation => operation(), running: () => false, closing: () => false,
    readTaskReply: async () => ({ text: 'SYNTHETIC_NATIVE_REPORT' }),
  });
  const enterprise = studio.enterpriseScopes.create({ name: 'Synthetic enterprise A' });
  studio.enterpriseScopes.associateProject(project.id, enterprise.id);
  const context = { requestId: randomUUID(), sessionId: randomUUID(), toolCallId: randomUUID(), signal: new AbortController().signal, assertCurrent() {} };
  const created = await enterpriseMaterials.create({ title: 'Approved synthetic membership policy', body: 'One membership is a program-specific relationship. A member can own several memberships.' });
  await enterpriseMaterials.enable(created.material.id, created.material.version);
  studio.enterpriseScopes.associateAsset('enterprise', created.material.id, enterprise.id);
  const port = studio.port(project.id, task.id);
  const catalog = (await port('catalog', {}, context)).details.result as any;
  const sourceRef = catalog.items.find((item: any) => item.id === created.material.id)?.ref;
  assert.ok(sourceRef, 'fixture must obtain its original qualified source ref from the existing catalog');
  const system = studio.store.create({ name: 'Enterprise membership foundation', projectId: project.id, taskId: task.id, enterpriseId: enterprise.id, goal: 'Build three related asset classes', topicTitle: 'Membership foundation' });
  t.after(async () => { await projects.close(); });
  return { projects, enterpriseMaterials, studio, project, task, enterprise, context, port, system, sourceRef };
}

async function metricFixture(f: Awaited<ReturnType<typeof fixture>>) {
  const original = await readFile('extensions/business-plugins/metric-factory/fixtures/membership-repurchase@1.0.0.draft.yaml', 'utf8');
  const library = createMetricLibrary(path.join(f.projects.dataRoot, 'metric-assets'));
  const published = library.publish(prepareSapPublication(Buffer.from(original.replaceAll('membership-repurchase', 'foundation-synthetic'))), 'Synthetic fixture only');
  f.studio.enterpriseScopes.associateAsset('sap-metric', published.id, f.enterprise.id);
  return { library, published, ref: { authority: 'sap-metric' as const, id: published.id, version: published.version, sha256: published.bytesSha256 } };
}

async function saveProfile(f: Awaited<ReturnType<typeof fixture>>, title: string, body: unknown, extra: Record<string, unknown> = {}) {
  const saved = (await f.port('save-asset', { systemId: f.system.id, payload: { kind: 'concept', title, body: JSON.stringify(body), scope: 'Synthetic enterprise A definition reference', sources: [f.sourceRef], checks: [{ name: 'Synthetic author definition review', status: 'pass', detail: 'Reviewed against the exact synthetic policy; not independent validation.' }], readyForPublication: true, ...extra } }, f.context)).details.result as any;
  const asset = f.studio.store.get(f.system.id).assets.find(item => item.id === saved.asset.id)!;
  const revision = asset.revisions.find(item => item.revision === (asset.candidateRevision ?? asset.formalRevision))!;
  const ref: StudioSourceRef = { authority: 'studio-source', id: asset.id, version: String(revision.revision), sha256: revision.sha256, projectId: f.project.id, locator: f.system.id };
  return { asset, revision, ref };
}

async function prepare(f: Awaited<ReturnType<typeof fixture>>, assetIds: string[]) {
  return ((await f.port('prepare-publication', { systemId: f.system.id, payload: { assetIds, summary: 'Synthetic exact-version definition reference', scope: 'Definition reference only; no business calculation or independent verification' } }, f.context)).details.result as any).preview;
}

test('I01/I04: read-source locates one structured item while retaining its exact original Studio source ref', async t => {
  const f = await fixture(t);
  const selectedItem = { itemId: 'md.membership', kind: 'entity', definition: 'A program-specific qualification relationship.', sourceRef: f.sourceRef };
  const profile = { contentProfile: 'studio-foundation/1', items: [selectedItem, { itemId: 'md.member', kind: 'entity', definition: 'UNSELECTED_PERSON_SENTINEL', sourceRef: f.sourceRef }] };
  const saved = (await f.port('save-asset', { systemId: f.system.id, payload: { kind: 'concept', title: 'Membership master model', body: JSON.stringify(profile), scope: 'Synthetic enterprise A', sources: [f.sourceRef], checks: [], readyForPublication: false } }, f.context)).details.result as any;
  const asset = f.studio.store.get(f.system.id).assets.find(item => item.id === saved.asset.id)!;
  const exact = asset.revisions.find(item => item.revision === asset.candidateRevision)!;
  const ref = { authority: 'studio-source', id: asset.id, version: String(exact.revision), sha256: exact.sha256, projectId: f.project.id, locator: f.system.id };
  const result = (await f.port('read-source', { systemId: f.system.id, payload: { ref, itemId: selectedItem.itemId } }, f.context)).details.result as any;
  assert.equal(JSON.parse(result.text).itemId, selectedItem.itemId, 'itemId selects the requested profile item rather than returning the whole asset body');
  assert.deepEqual(JSON.parse(result.text), selectedItem);
  assert.doesNotMatch(result.text, /UNSELECTED_PERSON_SENTINEL/);
  assert.equal(result.complete, true);
  assert.equal(result.ref.locator, f.system.id, 'a structured item path must not replace the source-level locator');
  assert.equal(result.ref.id, asset.id);
  assert.equal(result.ref.version, ref.version);
  assert.equal(result.ref.sha256, ref.sha256);
});

test('I03/I04: body references cannot hide an undeclared foreign enterprise source from original source qualification', async t => {
  const f = await fixture(t);
  const foreignEnterprise = f.studio.enterpriseScopes.create({ name: 'Synthetic enterprise B' });
  const created = await f.enterpriseMaterials.create({ title: 'Foreign policy', body: 'FOREIGN_PRIVATE_POLICY' });
  await f.enterpriseMaterials.enable(created.material.id, created.material.version);
  f.studio.enterpriseScopes.associateAsset('enterprise', created.material.id, foreignEnterprise.id);
  const foreignCatalog = await f.studio.enterpriseCatalog.catalog(foreignEnterprise.id);
  const foreignRef = foreignCatalog.items.find(item => item.id === created.material.id)!.ref!;
  const before = f.studio.store.get(f.system.id);
  const body = JSON.stringify({ contentProfile: 'studio-foundation/1', items: [{ itemId: 'md.foreign_membership', kind: 'entity', definition: 'This item cites another enterprise body.', sourceRef: foreignRef }] });
  await assert.rejects(() => f.port('save-asset', { systemId: f.system.id, payload: { kind: 'concept', title: 'Hidden foreign reference', body, scope: 'Synthetic enterprise A', sources: [f.sourceRef], checks: [], readyForPublication: true } }, f.context), 'a body-only reference must not bypass the original source authority or dependency declaration');
  assert.deepEqual(f.studio.store.get(f.system.id), before, 'rejected content must not leave a saved candidate or change a formal pointer');
});

test('I02/I04: read-source selects an exact metric from its original SAP package and rejects a missing metric', async t => {
  const f = await fixture(t), metric = await metricFixture(f);
  const result = (await f.port('read-source', { systemId: f.system.id, payload: { ref: metric.ref, metricName: 'repurchase_rate' } }, f.context)).details.result as any;
  assert.doesNotThrow(() => JSON.parse(result.text), 'a metric selector must return the requested metric JSON rather than the whole package YAML');
  assert.equal(JSON.parse(result.text).name, 'repurchase_rate');
  assert.equal(JSON.parse(result.text).type, 'ratio');
  assert.doesNotMatch(result.text, /repurchase_gap_days|member_tier_structure/);
  assert.equal(result.ref.id, metric.ref.id);
  assert.equal(result.ref.version, metric.ref.version);
  assert.equal(result.ref.sha256, metric.ref.sha256);
  await assert.rejects(() => f.port('read-source', { systemId: f.system.id, payload: { ref: metric.ref, metricName: 'not_a_metric' } }, f.context), 'unknown metric names must not fall back to the full package');
  await assert.rejects(() => f.port('read-source', { systemId: f.system.id, payload: { ref: { ...metric.ref, version: '9.9.9' }, metricName: 'repurchase_rate' } }, f.context), 'a selector cannot replace an unavailable exact package version with latest');
});

test('I03/I04: existing item and SAP package identities cannot turn missing nested targets into a publishable profile', async t => {
  const f = await fixture(t), metric = await metricFixture(f);
  const master = await saveProfile(f, 'Master model', { contentProfile: 'studio-foundation/1', items: [{ itemId: 'md.membership', kind: 'entity', definition: 'A program relationship.', sourceRef: f.sourceRef }] });
  for (const [title, profile, dependencies] of [
    ['Missing external item', { contentProfile: 'studio-foundation/1', items: [], adaptations: [{ referenceRef: { sourceRef: master.ref, itemId: 'md.missing' }, action: 'exclude', reason: 'A synthetic missing source item must remain unqualified.', evidenceRefs: [f.sourceRef] }] }, [master.ref]],
    ['Missing SAP metric', { contentProfile: 'studio-foundation/1', items: [], metricLinks: [{ metricRef: { sourceRef: metric.ref, metricName: 'missing_metric' } }] }, [metric.ref]],
    ['Wrong SAP version', { contentProfile: 'studio-foundation/1', items: [], metricLinks: [{ metricRef: { sourceRef: { ...metric.ref, version: '9.9.9' }, metricName: 'repurchase_rate' } }] }, [{ ...metric.ref, version: '9.9.9' }]],
  ] as const) {
    await assert.rejects(async () => {
      const candidate = await saveProfile(f, title, profile, { dependencies });
      await prepare(f, [candidate.asset.id]);
    }, `${title} must be rejected before a publishable preview exists`);
  }
  assert.ok(f.studio.store.get(f.system.id).assets.every(asset => asset.formalRevision === null));
  assert.equal(f.studio.store.get(f.system.id).publications.length, 0);
});

test('I04: item pages carry the exact selector and stay on the requested revision after a new candidate is saved', async t => {
  const f = await fixture(t);
  const item = { itemId: 'md.membership', kind: 'entity', definition: '资格😀关系'.repeat(1100), sourceRef: f.sourceRef };
  const profile = { contentProfile: 'studio-foundation/1', items: [item] };
  const firstRevision = await saveProfile(f, 'Long exact item', profile);
  let page = (await f.port('read-source', { systemId: f.system.id, payload: { ref: firstRevision.ref, itemId: item.itemId, length: 997 } }, f.context)).details.result as any;
  assert.equal(page.complete, false);
  assert.equal(page.continuation.itemId, item.itemId);
  assert.deepEqual(page.continuation.ref, firstRevision.ref);
  const fragments = [page.text];
  const v2 = await saveProfile(f, 'Long exact item v2', { ...profile, items: [{ ...item, definition: 'NEW_CANDIDATE_SENTINEL' }] }, { assetId: firstRevision.asset.id, expectedRevision: 1 });
  assert.equal(v2.revision.revision, 2);
  while (page.continuation) {
    page = (await f.port('read-source', { systemId: f.system.id, payload: page.continuation }, f.context)).details.result as any;
    assert.equal(page.ref.version, firstRevision.ref.version);
    assert.equal(page.ref.sha256, firstRevision.ref.sha256);
    fragments.push(page.text);
  }
  assert.equal(fragments.join(''), JSON.stringify(item), 'pages recover exactly the selected Unicode item body from revision 1');
  assert.doesNotMatch(fragments.join(''), /NEW_CANDIDATE_SENTINEL/);
  await assert.rejects(() => f.port('read-source', { systemId: f.system.id, payload: { ref: firstRevision.ref, itemId: 'md.absent' } }, f.context));
  await assert.rejects(() => f.port('read-source', { systemId: f.system.id, payload: { ref: { ...firstRevision.ref, locator: `${f.system.id}#md.membership` }, itemId: item.itemId } }, f.context), 'item identity must not be smuggled into the original system locator');
});

test('I04/I06: a separate ordinary task reads published master, metric and ontology bodies while candidates and author claims retain their identities', async t => {
  const f = await fixture(t), metric = await metricFixture(f);
  const masterProfile = { contentProfile: 'studio-foundation/1', items: [{ itemId: 'md.membership', kind: 'entity', definition: 'ORIGINAL_PROGRAM_RELATIONSHIP', sourceRef: f.sourceRef }] };
  const master = await saveProfile(f, 'Master data model', masterProfile);
  const ontology = await saveProfile(f, 'Ontology qualification', { contentProfile: 'studio-foundation/1', items: [{ itemId: 'ont.eligible', kind: 'rule', definition: 'Eligibility is determined at an explicit time under an exact policy.', sourceRef: f.sourceRef }], relations: [{ relationId: 'membership-eligibility', type: 'domain', from: { kind: 'item', itemId: 'ont.eligible' }, to: { kind: 'external-item', itemRef: { sourceRef: master.ref, itemId: 'md.membership' } }, evidenceRefs: [f.sourceRef] }] }, { kind: 'ontology', dependencies: [master.ref] });
  const metrics = await saveProfile(f, 'Metric system links', { contentProfile: 'studio-foundation/1', items: [], metricLinks: [{ metricRef: { sourceRef: metric.ref, metricName: 'repurchase_rate' } }], relations: [{ relationId: 'metric-object', type: 'analysis-use', from: { kind: 'metric', metricRef: { sourceRef: metric.ref, metricName: 'repurchase_rate' } }, to: { kind: 'external-item', itemRef: { sourceRef: master.ref, itemId: 'md.membership' } }, evidenceRefs: [f.sourceRef], detail: 'Synthetic test relationship only; not a target-enterprise decision.' }], readiness: { use: { status: 'pass', detail: 'Author claim retained as content, not an independent assessment.', evidenceRefs: [f.sourceRef] } } }, { kind: 'business', dependencies: [master.ref, metric.ref] });
  const ordinaryTask = await f.projects.createTask(f.project.id, { name: 'Independent ordinary analysis task' });
  const ordinary = f.studio.port(f.project.id, ordinaryTask.id, { analysisOnly: true });
  await assert.rejects(() => ordinary('read-source', { systemId: f.system.id, payload: { ref: master.ref, itemId: 'md.membership' } }, f.context), 'a construction candidate cannot become ordinary formal evidence');
  const preview = await prepare(f, [master.asset.id, ontology.asset.id, metrics.asset.id]);
  f.studio.store.confirmPublication(f.system.id, preview.id, preview.fingerprint);
  const masterRead = (await ordinary('read-source', { systemId: f.system.id, payload: { ref: master.ref, itemId: 'md.membership' } }, f.context)).details.result as any;
  const ontologyRead = (await ordinary('read-source', { systemId: f.system.id, payload: { ref: ontology.ref, itemId: 'ont.eligible' } }, f.context)).details.result as any;
  const metricsRead = (await ordinary('read-source', { systemId: f.system.id, payload: { ref: metrics.ref } }, f.context)).details.result as any;
  const metricRead = (await ordinary('read-source', { systemId: f.system.id, payload: { ref: metric.ref, metricName: JSON.parse(metricsRead.text).metricLinks[0].metricRef.metricName } }, f.context)).details.result as any;
  assert.equal(JSON.parse(masterRead.text).definition, 'ORIGINAL_PROGRAM_RELATIONSHIP');
  assert.equal(JSON.parse(ontologyRead.text).itemId, 'ont.eligible');
  assert.equal(JSON.parse(metricRead.text).name, 'repurchase_rate');
  assert.equal(JSON.parse(metricsRead.text).readiness.use.status, 'pass');
  assert.deepEqual(f.studio.store.get(f.system.id).uses, [], 'reading an authored pass does not manufacture a use declaration or independent verification');
  const oldEvidence = JSON.stringify({ masterRead, ontologyRead, metricsRead, metricRead });
  const v2 = await saveProfile(f, 'Master data candidate v2', { ...masterProfile, items: [{ ...masterProfile.items[0], definition: 'NEW_PROGRAM_DEFINITION' }] }, { assetId: master.asset.id, expectedRevision: 1 });
  await assert.rejects(() => ordinary('read-source', { systemId: f.system.id, payload: { ref: v2.ref, itemId: 'md.membership' } }, f.context));
  assert.equal(((await ordinary('read-source', { systemId: f.system.id, payload: { ref: master.ref, itemId: 'md.membership' } }, f.context)).details.result as any).text, masterRead.text);
  const nextPreview = await prepare(f, [v2.asset.id]);
  f.studio.store.confirmPublication(f.system.id, nextPreview.id, nextPreview.fingerprint);
  const newRead = (await ordinary('read-source', { systemId: f.system.id, payload: { ref: v2.ref, itemId: 'md.membership' } }, f.context)).details.result as any;
  assert.equal(JSON.parse(newRead.text).definition, 'NEW_PROGRAM_DEFINITION');
  const history = (await ordinary('read', { systemId: f.system.id, payload: { assetId: master.asset.id, revision: 1 } }, f.context)).details.result as any;
  assert.equal(history.body, JSON.stringify(masterProfile));
  assert.equal(JSON.stringify({ masterRead, ontologyRead, metricsRead, metricRead }), oldEvidence);
  await assert.rejects(() => ordinary('save-asset', { systemId: f.system.id, payload: {} }, f.context), /studio_read_only/);
  await f.enterpriseMaterials.disable(f.sourceRef.id, (await f.enterpriseMaterials.get(f.sourceRef.id)).material.version);
  await assert.rejects(() => ordinary('read-source', { systemId: f.system.id, payload: { ref: v2.ref, itemId: 'md.membership' } }, f.context), 'a structured selector cannot restore a disabled original source through its body or old graph');
  assert.equal(JSON.stringify({ masterRead, ontologyRead, metricsRead, metricRead }), oldEvidence);
});

test('I04: publication cannot omit an exact candidate dependency required by a structured source', async t => {
  const f = await fixture(t);
  const master = await saveProfile(f, 'Unpublished required model', { contentProfile: 'studio-foundation/1', items: [{ itemId: 'master', kind: 'entity', definition: 'Required model', sourceRef: f.sourceRef }] });
  const ontology = await saveProfile(f, 'Dependent ontology', { contentProfile: 'studio-foundation/1', items: [{ itemId: 'rule', kind: 'rule', definition: 'Applies to the required model', sourceRef: f.sourceRef }], relations: [{ relationId: 'applies', type: 'domain', from: { kind: 'item', itemId: 'rule' }, to: { kind: 'external-item', itemRef: { sourceRef: master.ref, itemId: 'master' } }, evidenceRefs: [f.sourceRef] }] });
  await assert.rejects(() => prepare(f, [ontology.asset.id]), 'construction-readable candidate cannot become an omitted formal dependency');
  assert.equal(f.studio.store.get(f.system.id).publications.length, 0);
  const together = await prepare(f, [master.asset.id, ontology.asset.id]);
  assert.equal(together.items.length, 2, 'the exact same source combination may be reviewed together');
});


test('I04/I06: task use receipts remain exact evidence without granting ordinary tasks cross-project report access', async t => {
  const f = await fixture(t);
  const hash = createHash('sha256').update('SYNTHETIC_NATIVE_REPORT').digest('hex');
  const receipt = { authority: 'task', id: f.task.id, projectId: f.project.id, taskId: f.task.id, version: hash, sha256: hash, locator: JSON.stringify({ kind: 'native-reply', sessionId: 'synthetic-session', messageId: 'synthetic-reply' }) };
  const body = { contentProfile: 'studio-foundation/1', items: [{ itemId: 'definition', kind: 'entity', definition: 'A shared definition reference', sourceRef: f.sourceRef }], readiness: { use: { status: 'pass', detail: 'Author report declaration, not independent verification.', evidenceRefs: [receipt] } } };
  const asset = await saveProfile(f, 'Definition with exact task receipt', body);
  const preview = await prepare(f, [asset.asset.id]);
  f.studio.store.confirmPublication(f.system.id, preview.id, preview.fingerprint);
  const consumer = await f.projects.create({ name: 'Another ordinary project', configuration: { id: 'synthetic', revision: 1, name: 'Synthetic', provider: 'synthetic', model: 'synthetic', baseUrl: 'http://127.0.0.1:1' } });
  f.studio.enterpriseScopes.associateProject(consumer.id, f.enterprise.id);
  const task = await f.projects.createTask(consumer.id, { name: 'Ordinary reference use' });
  const port = f.studio.port(consumer.id, task.id, { analysisOnly: true });
  const read = (await port('read-source', { systemId: f.system.id, payload: { ref: asset.ref } }, f.context)).details.result as any;
  assert.deepEqual(JSON.parse(read.text).readiness.use.evidenceRefs, [receipt], 'the exact receipt remains traceable in the source body');
  assert.equal(JSON.parse(read.text).readiness.use.detail, body.readiness.use.detail);
  assert.deepEqual(f.studio.store.get(f.system.id).uses, [], 'the source declaration cannot manufacture independent use facts');
  await assert.rejects(() => port('read-source', { systemId: f.system.id, payload: { ref: receipt } }, f.context), 'sharing a definition never grants access to another project report');
  const required = await saveProfile(f, 'Task receipt used as a required definition source', { ...body, items: [{ ...body.items[0], sourceRef: receipt }] });
  assert.ok(required.revision.dependencies.some(ref => ref.authority === 'task' && ref.id === receipt.id), 'the same ref in a required role cannot be removed by its evidence role');
  await assert.rejects(() => prepare(f, [required.asset.id]), 'unsupported required task dependency stays blocked rather than silently losing its qualification');
});

test('I02/I04: a metric Binding reference must resolve to the original Binding asset kind', async t => {
  const f = await fixture(t), metric = await metricFixture(f);
  const concept = await saveProfile(f, 'A concept is not a Binding', { contentProfile: 'studio-foundation/1', items: [{ itemId: 'object', kind: 'entity', definition: 'A model entity', sourceRef: f.sourceRef }] });
  await assert.rejects(() => saveProfile(f, 'Incorrect mapping association', { contentProfile: 'studio-foundation/1', items: [], metricLinks: [{ metricRef: { sourceRef: metric.ref, metricName: 'repurchase_rate' }, bindingRef: concept.ref }] }), 'an existing concept cannot be presented as an original Binding');
});

test('I02/I04: a mapping field cannot use a policy document as its actual data source', async t => {
  const f = await fixture(t);
  await assert.rejects(() => saveProfile(f, 'Policy text is not a data input', { contentProfile: 'studio-foundation/1', items: [{ itemId: 'member', kind: 'entity', definition: 'Member', sourceRef: f.sourceRef }], bindingLinks: [{ sourceRef: f.sourceRef, field: 'member_id', itemId: 'member', grain: 'One member', detail: 'Invalid field mapping to a prose policy', evidenceRefs: [f.sourceRef] }] }), 'evidence documents do not become actual data bindings');
});

test('I04: a selected legacy bridge cannot hide an omitted candidate dependency from a structured publication', async t => {
  const f = await fixture(t);
  const leaf = await saveProfile(f, 'Omitted leaf', { contentProfile: 'studio-foundation/1', items: [{ itemId: 'leaf', kind: 'entity', definition: 'Required leaf', sourceRef: f.sourceRef }] });
  const bridge = await saveProfile(f, 'Legacy bridge', {}, { body: 'Legacy plain-text bridge', dependencies: [leaf.ref] });
  const root = await saveProfile(f, 'Structured root', { contentProfile: 'studio-foundation/1', items: [{ itemId: 'root', kind: 'entity', definition: 'Uses exact bridge', sourceRef: bridge.ref }] });
  await assert.rejects(() => prepare(f, [root.asset.id, bridge.asset.id]));
  assert.equal(f.studio.store.get(f.system.id).publications.length, 0);
  const preview = await prepare(f, [root.asset.id, bridge.asset.id, leaf.asset.id]);
  assert.equal(preview.items.length, 3);
});
