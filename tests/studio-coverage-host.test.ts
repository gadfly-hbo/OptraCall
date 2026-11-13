import test from 'node:test';
import assert from 'node:assert/strict';
import { coverageHostFixture } from './fixtures/studio-coverage.ts';
import { coverageReport } from './fixtures/studio-coverage.ts';

test('embedded coverage refs pass original authorization even when omitted from outer sources', async t => {
  const f = await coverageHostFixture(t), foreign = f.studio.enterpriseScopes.create({ name: 'Foreign synthetic enterprise' });
  const created = await f.enterpriseMaterials.create({ title: 'Private foreign policy', body: 'FOREIGN_COVERAGE_SENTINEL' });
  await f.enterpriseMaterials.enable(created.material.id, created.material.version); f.studio.enterpriseScopes.associateAsset('enterprise', created.material.id, foreign.id);
  const index = await f.enterpriseMaterials.referenceIndex({ readOnly: true }), material = index.materials.find(item => item.materialId === created.material.id)!;
  const ref = { authority: 'enterprise', id: created.material.id, version: material.revisions[0].revisionId, sha256: material.revisions[0].bodySha256, locator: index.storeId };
  for (const key of ['methodRefs', 'basisRefs']) await assert.rejects(f.save({ ...f.report, [key]: [ref] }), /studio_source_scope_forbidden/);
  assert.equal(f.studio.store.get(f.system.id).assets.length, 0);
});

test('coverage source selections verify item, metric and fragment existence through original exact reads', async t => {
  const f = await coverageHostFixture(t);
  for (const selection of [{ sourceRef: f.ref, itemId: 'missing-item' }, { sourceRef: f.ref, metricName: 'missing-metric' }, { sourceRef: f.ref, fragmentLocator: 'MISSING_FRAGMENT_SENTINEL' }]) {
    const report = { ...f.report, observations: [{ ...f.report.observations[0], sourceSelection: selection }] };
    await assert.rejects(f.save(report), /studio_foundation_item_not_found|invalid_studio_foundation_selection|studio_coverage_fragment_not_found/);
  }
  const report = { ...f.report, observations: [{ ...f.report.observations[0], sourceSelection: { sourceRef: f.ref, fragmentLocator: 'Membership policy section 2' } }] };
  const saved = await f.save(report);
  assert.equal(saved.revision.sources[0].sha256, f.ref.sha256);
  assert.equal(saved.revision.dependencies.length, 1);
});

test('coverage GET qualifies its exact candidate and drops all evidence after its source is disabled', async t => {
  const f = await coverageHostFixture(t), saved = await f.save();
  const route = `/api/studio/systems/${f.system.id}/coverage?assetId=${saved.asset.id}&revision=1`;
  const ready = await f.http(route);
  assert.equal(ready.status, 200); assert.equal(ready.body.status, 'ready');
  assert.equal(ready.body.ref.sha256, saved.ref.sha256); assert.deepEqual(ready.body.report, f.report);
  await f.enterpriseMaterials.disable(f.created.material.id, f.created.material.version + 1);
  const unavailable = await f.http(route);
  assert.equal(unavailable.body.status, 'unavailable'); assert.equal(unavailable.body.report, undefined); assert.equal(unavailable.body.text, undefined); assert.equal(unavailable.body.references, undefined);
});

test('references with an unavailable input hash retain their exact tuple without duplicate strengthened identities', async t => {
  const f = await coverageHostFixture(t), { sha256: _providedHash, ...unknownHash } = f.ref;
  const report = { ...f.report, basisRefs: [unknownHash], observations: [{ ...f.report.observations[0], evidenceRefs: [unknownHash] }] };
  const saved = await f.save(report);
  assert.equal(saved.revision.sources.length, 1); assert.equal(saved.revision.dependencies.length, 1);
  assert.deepEqual(saved.revision.sources[0], unknownHash);
  const current = await f.http(`/api/studio/systems/${f.system.id}/coverage?assetId=${saved.asset.id}&revision=1`);
  assert.equal(current.body.status, 'ready'); assert.equal(current.body.references.length, 1); assert.equal(current.body.references[0].ref.sha256, undefined);
});

test('unknown report formats expose authorized original raw text without derived evidence or false coverage', async t => {
  const f = await coverageHostFixture(t), body = '{"reportProfile":"studio-coverage/99","unrecognized":"SYNTHETIC_RAW_BODY"}';
  const saved = await f.save(body, { readyForPublication: false });
  const view = await f.http(`/api/studio/systems/${f.system.id}/coverage?assetId=${saved.asset.id}&revision=1`);
  assert.equal(view.body.status, 'unsupported'); assert.equal(view.body.text, body); assert.equal(view.body.report, undefined); assert.equal(view.body.references, undefined);
  const raw = (await f.port('read-source', { systemId: f.system.id, payload: { ref: saved.ref } }, f.context)).details.result as any;
  assert.equal(raw.text, body);
});

test('bad exact hashes and observation/question/selection hidden foreign refs fail through the same original readers', async t => {
  const f = await coverageHostFixture(t), badHash = { ...f.ref, sha256: '0'.repeat(64) };
  const foreignEnterprise = f.studio.enterpriseScopes.create({ name: 'Other enterprise' }), other = await f.enterpriseMaterials.create({ title: 'Other private policy', body: 'PRIVATE_POLICY_SENTINEL' });
  await f.enterpriseMaterials.enable(other.material.id, other.material.version); f.studio.enterpriseScopes.associateAsset('enterprise', other.material.id, foreignEnterprise.id);
  const index = await f.enterpriseMaterials.referenceIndex({ readOnly: true }), revision = index.materials.find(material => material.materialId === other.material.id)!.revisions[0], foreign = { authority: 'enterprise' as const, id: other.material.id, version: revision.revisionId, sha256: revision.bodySha256, locator: index.storeId };
  for (const ref of [badHash, foreign]) {
    for (const report of [
      { ...f.report, observations: [{ ...f.report.observations[0], evidenceRefs: [ref] }] },
      { ...f.report, observations: [{ ...f.report.observations[0], sourceSelection: { sourceRef: ref, fragmentLocator: 'policy' } }] },
      { ...f.report, questions: [{ id: 'question-1', observationIds: ['observation-1'], kind: 'possible-conflict', detail: 'Not a confirmed issue', impact: 'Unknown', evidenceRefs: [ref] }] },
    ]) await assert.rejects(f.save(report), /studio_source_changed|studio_source_scope_forbidden/);
  }
  assert.equal(f.studio.store.get(f.system.id).assets.length, 0); assert.equal(f.studio.store.get(f.system.id).workItems.length, 0);
});

test('report cycles fail through the original bounded dependency walk rather than recursively expanding source projections', async t => {
  const f = await coverageHostFixture(t);
  const first = await f.save('Original placeholder', { sources: [f.ref], readyForPublication: false });
  const future = { ...first.ref, version: '2' }; delete (future as { sha256?: string }).sha256;
  const second = f.studio.store.saveAsset(f.system.id, { kind: 'business', title: 'Synthetic second report', body: JSON.stringify(coverageReport(f.report.scope, future)), scope: 'Synthetic', sources: [f.ref], readyForPublication: true });
  const secondRef = { authority: 'studio-source' as const, id: second.id, version: '1', projectId: f.project.id, locator: f.system.id };
  f.studio.store.saveAsset(f.system.id, { assetId: first.asset.id, expectedRevision: 1, kind: 'business', title: 'Synthetic first report', body: JSON.stringify(coverageReport(f.report.scope, secondRef)), scope: 'Synthetic', sources: [f.ref], readyForPublication: true });
  // The low-level Store can retain a pre-existing formal cycle; the Host must still fail closed on reread.
  const preview = f.studio.store.preparePublication(f.system.id, { assetIds: [first.asset.id, second.id], summary: 'Synthetic original formal cycle', scope: 'Synthetic only' });
  f.studio.store.confirmPublication(f.system.id, preview.id, preview.fingerprint);
  const current = await f.http(`/api/studio/systems/${f.system.id}/coverage?assetId=${first.asset.id}&revision=2`);
  assert.equal(current.body.status, 'unavailable'); assert.equal(current.body.error, 'studio_source_dependency_cycle'); assert.equal(current.body.report, undefined);
});
