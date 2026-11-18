import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { coverageHostFixture } from './fixtures/studio-coverage.ts';

async function publish(f: Awaited<ReturnType<typeof coverageHostFixture>>, assetIds: string[]) {
  const preview = await f.prepare(assetIds);
  const result = await f.http(`/api/studio/systems/${f.system.id}/publications`, { requestId: randomUUID(), previewId: preview.id, fingerprint: preview.fingerprint });
  assert.equal(result.status, 200, JSON.stringify(result.body)); return preview;
}

test('coverage candidate is absent from ordinary supply; publishing and later candidates retain exact formal r1', async t => {
  const f = await coverageHostFixture(t), saved = await f.save(), task = await f.projects.createTask(f.project.id, { name: 'Ordinary analysis' }), ordinary = f.studio.port(f.project.id, task.id, { analysisOnly: true });
  let catalog = (await ordinary('catalog', {}, f.context)).details.result as any;
  assert.equal(catalog.items.some((item: any) => item.id === saved.asset.id), false);
  await assert.rejects(ordinary('read-source', { systemId: f.system.id, payload: { ref: saved.ref } }, f.context), /studio_source_scope_forbidden|studio_source_unavailable|studio_asset_not_published/);
  await publish(f, [saved.asset.id]);
  const first = (await ordinary('read-source', { systemId: f.system.id, payload: { ref: saved.ref } }, f.context)).details.result as any, oldBytes = JSON.stringify(first);
  const r2 = await f.save({ ...f.report, limitations: ['A new candidate has not been published'] }, { assetId: saved.asset.id, expectedRevision: 1 });
  assert.equal(f.studio.store.get(f.system.id).assets[0].formalRevision, 1); assert.equal(r2.asset.candidateRevision, 2);
  catalog = (await ordinary('catalog', {}, f.context)).details.result as any;
  assert.equal(catalog.items.find((item: any) => item.id === saved.asset.id).version, '1');
  await assert.rejects(ordinary('read-source', { systemId: f.system.id, payload: { ref: r2.ref } }, f.context));
  assert.equal(((await ordinary('read-source', { systemId: f.system.id, payload: { ref: saved.ref } }, f.context)).details.result as any).text, JSON.stringify(f.report));
  assert.equal(JSON.stringify(first), oldBytes);
});

test('required candidate assets cannot hide in coverage body or be omitted from the exact publication combination', async t => {
  const f = await coverageHostFixture(t);
  const target = await f.save({ contentProfile: 'studio-foundation/1', items: [{ itemId: 'member', kind: 'entity', definition: 'Synthetic member', sourceRef: f.ref }] }, { kind: 'concept', sources: [f.ref] });
  const report = { ...f.report, observations: [{ ...f.report.observations[0], evidenceRefs: [target.ref], sourceSelection: { sourceRef: target.ref, itemId: 'member' } }] };
  const saved = await f.save(report);
  assert.equal(saved.revision.dependencies.some(ref => ref.id === target.asset.id), true);
  await assert.rejects(f.prepare([saved.asset.id]));
  assert.equal(f.studio.store.get(f.system.id).publications.length, 0);
  await publish(f, [saved.asset.id, target.asset.id]);
  const ready = await f.http(`/api/studio/systems/${f.system.id}/coverage?assetId=${saved.asset.id}&revision=1`);
  assert.equal(ready.body.status, 'ready'); assert.deepEqual(ready.body.references.find((source: any) => source.ref.id === target.asset.id).foundationKinds, ['master-data']);
});

test('publication confirm rechecks disabled required evidence and cannot create formal pointers from an old preview', async t => {
  const f = await coverageHostFixture(t), saved = await f.save(), preview = await f.prepare([saved.asset.id]);
  await f.enterpriseMaterials.disable(f.ref.id, (await f.enterpriseMaterials.get(f.ref.id)).material.version);
  const result = await f.http(`/api/studio/systems/${f.system.id}/publications`, { requestId: randomUUID(), previewId: preview.id, fingerprint: preview.fingerprint });
  assert.equal(result.status, 409); assert.equal(f.studio.store.get(f.system.id).assets[0].formalRevision, null);
  const view = await f.http(`/api/studio/systems/${f.system.id}/coverage?assetId=${saved.asset.id}&revision=1`);
  assert.equal(view.body.status, 'unavailable'); assert.equal(view.body.report, undefined);
});

test('a replaced basis version withdraws current report supply while the original historical source remains readable', async t => {
  const f = await coverageHostFixture(t), saved = await f.save(); await publish(f, [saved.asset.id]);
  const task = await f.projects.createTask(f.project.id, { name: 'Ordinary analysis' }), ordinary = f.studio.port(f.project.id, task.id, { analysisOnly: true });
  const first = (await ordinary('read-source', { systemId: f.system.id, payload: { ref: saved.ref } }, f.context)).details.result as any, originalBytes = JSON.stringify(first);
  const draft = await f.enterpriseMaterials.update(f.ref.id, (await f.enterpriseMaterials.get(f.ref.id)).material.version, { body: 'NEW_POLICY_VERSION: a different approved period.' });
  await f.enterpriseMaterials.enable(f.ref.id, draft.material.version);
  const catalog = (await ordinary('catalog', {}, f.context)).details.result as any;
  assert.equal(catalog.items.some((item: any) => item.id === saved.asset.id), false, 'old coverage must not remain current supply after its required basis advances');
  await assert.rejects(ordinary('read-source', { systemId: f.system.id, payload: { ref: saved.ref } }, f.context), /studio_coverage_basis_changed/);
  const view = await f.http(`/api/studio/systems/${f.system.id}/coverage?assetId=${saved.asset.id}&revision=1`);
  assert.equal(view.body.status, 'unavailable'); assert.equal(view.body.report, undefined);
  const history = (await ordinary('read-source', { systemId: f.system.id, payload: { ref: f.ref } }, f.context)).details.result as any;
  assert.match(history.text, /Membership policy section 2/);
  const currentRef = (await f.studio.sources.inventory(f.project.id)).find(material => material.ref.id === f.ref.id && material.ref.version !== f.ref.version)!.ref;
  const nextReport = { ...f.report, basisRefs: [currentRef], observations: [{ ...f.report.observations[0], evidenceRefs: [currentRef] }] };
  const next = await f.save(nextReport, { assetId: saved.asset.id, expectedRevision: 1 });
  assert.equal(f.studio.store.get(f.system.id).assets[0].formalRevision, 1);
  assert.equal(((await ordinary('catalog', {}, f.context)).details.result as any).items.some((item: any) => item.id === saved.asset.id), false, 'a new candidate cannot restore the invalid formal r1');
  await assert.rejects(ordinary('read-source', { systemId: f.system.id, payload: { ref: next.ref } }, f.context));
  assert.equal(f.studio.store.get(f.system.id).assets[0].revisions[0].body, JSON.stringify(f.report)); assert.equal(JSON.stringify(first), originalBytes);
});

test('ordinary enterprise catalog qualifies report evidence in the actual consuming project rather than the builder project', async t => {
  const f = await coverageHostFixture(t);
  await f.projects.upload({ projectId: f.project.id, name: 'private-policy.txt', directory: '020_clean', bytes: Buffer.from('BUILDER_RAW_POLICY_SENTINEL') });
  const raw = (await f.studio.sources.inventory(f.project.id)).find(material => material.ref.authority === 'data')!.ref;
  const saved = await f.save({ ...f.report, basisRefs: [raw], observations: [{ ...f.report.observations[0], evidenceRefs: [raw] }] }); await publish(f, [saved.asset.id]);
  const consumer = await f.projects.create({ name: 'Another synthetic project', configuration: f.project.configuration });
  f.studio.enterpriseScopes.associateProject(consumer.id, f.enterprise.id);
  const task = await f.projects.createTask(consumer.id, { name: 'Ordinary analysis' }), ordinary = f.studio.port(consumer.id, task.id, { analysisOnly: true });
  const catalog = (await ordinary('catalog', {}, f.context)).details.result as any;
  assert.equal(catalog.items.some((item: any) => item.id === saved.asset.id), false, 'the directory must not use the builder grant for another project');
  await assert.rejects(ordinary('read-source', { systemId: f.system.id, payload: { ref: saved.ref } }, f.context), /studio_source_project_mismatch/);
  assert.equal((await f.http(`/api/studio/systems/${f.system.id}/coverage?assetId=${saved.asset.id}&revision=1`)).body.status, 'ready', 'the original builder can still inspect its authorized report');
});
