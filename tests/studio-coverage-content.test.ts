import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { StudioStore } from '../extensions/business-plugins/studio/store.ts';
import { coverageReport, coveragePolicyRef } from './fixtures/studio-coverage.ts';
import { parseCoverageContent, coverageReferences, coverageRefIdentity, coverageColumns } from '../extensions/business-plugins/studio/coverage.ts';

function fixture() {
  const base = path.resolve('.local/studio-business-coverage-implementation/tdd-backend/content'); mkdirSync(base, { recursive: true });
  const store = new StudioStore(mkdtempSync(path.join(base, 'store-')));
  const system = store.create({ name: 'Synthetic coverage', projectId: randomUUID(), taskId: randomUUID(), enterpriseId: randomUUID(), goal: 'Coverage', topicTitle: 'Synthetic topic' });
  const report = coverageReport({ enterpriseId: system.enterpriseId!, systemId: system.id, topicId: system.currentTopicId });
  const save = (body: unknown, extra: Record<string, unknown> = {}) => store.saveAsset(system.id, { kind: 'business', title: 'Coverage report', scope: 'Synthetic scope', body: typeof body === 'string' ? body : JSON.stringify(body), sources: [coveragePolicyRef], checks: [], ...extra });
  return { store, system, report, save };
}

test('coverage declared malformed reports fail instead of taking the legacy body path', () => {
  const f = fixture();
  for (const body of ['{"reportProfile":"studio-coverage/1",', '{"reportProfile":23}', { ...f.report, inventedAuthority: true }]) assert.throws(() => f.save(body), /invalid_studio_coverage/);
  assert.equal(f.store.get(f.system.id).assets.length, 0);
});

test('coverage scope belongs to its original enterprise/system/topic and only business body can carry it', () => {
  const f = fixture();
  for (const key of ['enterpriseId', 'systemId', 'topicId']) assert.throws(() => f.save({ ...f.report, scope: { ...f.report.scope, [key]: randomUUID() } }), /studio_coverage_scope_mismatch/);
  assert.throws(() => f.save(f.report, { kind: 'concept' }), /studio_coverage_asset_kind/);
});

test('unknown coverage profiles preserve drafts but cannot declare readiness or publish', () => {
  const f = fixture(), unknown = { reportProfile: 'studio-coverage/99', future: true };
  const asset = f.save(unknown);
  assert.equal(asset.revisions[0].body, JSON.stringify(unknown));
  assert.throws(() => f.save(unknown, { readyForPublication: true }), /unsupported_studio_coverage/);
  assert.throws(() => f.store.preparePublication(f.system.id, { assetIds: [asset.id], summary: 'Synthetic', scope: 'Synthetic' }), /studio_source_not_ready/);
});

test('all 36 coordinates, multiple annotations and no annotations remain independent from a zero focus set', () => {
  const f = fixture();
  const cells = Array.from({ length: 6 }, (_, index) => coverageColumns.map(column => ({ row: index + 1, column }))).flat();
  const report = { ...f.report, focusCells: [], observations: [{ ...f.report.observations[0], annotations: cells.map(cell => ({ cell, reason: 'Synthetic explicit evidence' })) }, { ...f.report.observations[0], id: 'unannotated', annotations: [] }] };
  const asset = f.save(report, { readyForPublication: true });
  assert.equal(parseCoverageContent(asset.revisions[0].body).kind, 'supported');
  assert.equal(JSON.parse(asset.revisions[0].body).observations[0].annotations.length, 36);
  assert.equal(f.store.preparePublication(f.system.id, { assetIds: [asset.id], summary: 'No focus requirement', scope: 'Synthetic' }).items.length, 1);
});

test('coverage reference identity counts exact versions once across method/basis/evidence/selection and ignores titles', () => {
  const f = fixture(), ref2 = { ...coveragePolicyRef, version: 'r2', title: 'Same policy' };
  const report = { ...f.report, methodRefs: [{ ...coveragePolicyRef, title: 'Renamed title' }], basisRefs: [coveragePolicyRef, ref2], observations: [{ ...f.report.observations[0], sourceSelection: { sourceRef: coveragePolicyRef, fragmentLocator: 'policy' } }] };
  const parsed = parseCoverageContent(JSON.stringify(report)); assert.equal(parsed.kind, 'supported');
  assert.equal(coverageReferences(parsed.report!).length, 2);
  assert.equal(coverageRefIdentity(coveragePolicyRef), coverageRefIdentity({ ...coveragePolicyRef, title: 'Another title' }));
  const saved = f.save(report);
  assert.equal(saved.revisions[0].sources.length, 2); assert.equal(saved.revisions[0].dependencies.length, 2);
});

test('F1 duplicate coordinates are rejected regardless of JSON property order in focus and annotations', async t => {
  const f = fixture(), rowFirst = { row: 1, column: 'What' }, columnFirst = { column: 'What', row: 1 };
  const reports = [
    { ...f.report, focusCells: [rowFirst, columnFirst] },
    { ...f.report, observations: [{ ...f.report.observations[0], annotations: [{ cell: rowFirst, reason: 'First explicit annotation' }, { cell: columnFirst, reason: 'Same coordinate with reordered fields' }] }] },
  ];
  for (const [index, report] of reports.entries()) await t.test(index === 0 ? 'focus coordinates' : 'observation annotations', () => {
    const body = JSON.stringify(report), parsed = parseCoverageContent(body);
    assert.equal(parsed.kind, 'invalid', index === 0 ? 'focus coordinate identity ignores property order' : 'annotation coordinate identity ignores property order');
    assert.ok(parsed.issues.some(issue => issue.code === 'duplicate_coordinate' && issue.path === (index === 0 ? '$.focusCells[1]' : '$.observations[0].annotations[1]')), 'return the duplicate coordinate issue at its original location');
    assert.throws(() => f.save(body), /invalid_studio_coverage/);
    assert.equal(JSON.stringify(report), body, 'validation never rewrites the submitted report');
  });
  assert.equal(f.store.get(f.system.id).assets.length, 0);
});

test('bounded report content rejects excessive work and bad local/coordinate/status structure', () => {
  const f = fixture();
  const invalid = [
    { ...f.report, observations: Array.from({ length: 257 }, (_, i) => ({ ...f.report.observations[0], id: `o${i}` })) },
    { ...f.report, basisRefs: Array.from({ length: 129 }, (_, i) => ({ ...coveragePolicyRef, id: `s${i}` })) },
    { ...f.report, questions: Array.from({ length: 129 }, (_, i) => ({ id: `q${i}`, observationIds: [], kind: 'missing', detail: 'Missing', impact: 'Unknown', evidenceRefs: [] })) },
    { ...f.report, observations: [{ ...f.report.observations[0], evidenceStatus: 'not-applicable' }] },
    { ...f.report, questions: [{ id: 'q1', observationIds: ['nonexistent'], kind: 'possible-conflict', detail: 'Pending', impact: 'Unknown', evidenceRefs: [] }] },
    { ...f.report, focusCells: [{ row: 7, column: 'What' }] },
    { ...f.report, focusCells: [{ row: 1, column: 'What' }, { row: 1, column: 'What' }] },
    { ...f.report, scope: { ...f.report.scope, validFrom: '2027-01-01', validTo: '2026-01-01' } },
    { ...f.report, limitations: ['界'.repeat(90_000)] },
  ];
  for (const report of invalid) assert.equal(parseCoverageContent(JSON.stringify(report)).kind, 'invalid');
});

test('original text, foundation /1 /2 and nested report examples remain on their original paths', () => {
  const f = fixture();
  for (const body of ['Original legacy text', '{"nested":{"reportProfile":"studio-coverage/1"}}', '{"nested":{"reportProfile":"studio-coverage/1",', JSON.stringify({ contentProfile: 'studio-foundation/1', items: [] }), JSON.stringify({ contentProfile: 'studio-foundation/2', items: [] })]) {
    assert.equal(parseCoverageContent(body).kind, 'legacy'); assert.equal(f.save(body).revisions[0].body, body);
  }
});
