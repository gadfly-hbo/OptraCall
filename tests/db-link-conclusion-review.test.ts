import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { ProjectStore } from '../src/host/project-store.ts';
import { createConclusionReviewMaterials, parseConclusionReviewSelection } from '../src/host/conclusion-review-materials.ts';
import type { FixedReviewBundlePort } from '../src/host/report-calculation-materials.ts';
import { DbLinkResults } from '../src/host/db-link-results.ts';
import { createDbLinkReviewPort } from '../src/host/db-link-review-port.ts';
import { dbLinkModelOutlet } from '../src/host/db-link-host.ts';

test('DB11: conclusion review fixes one database result as one logical basis and keeps text-only coverage honest', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'optracall-db-conclusion-'));
  const dataRoot = path.join(root, 'data'), projects = new ProjectStore({ dataRoot, projectsRoot: path.join(root, 'projects') });
  await projects.init(); t.after(async () => { await projects.close(); await rm(root, { recursive: true, force: true }); });
  const configuration = { id: 'synthetic-review', revision: 1, name: 'Synthetic', provider: 'synthetic', model: 'synthetic', baseUrl: 'http://127.0.0.1' };
  const project = await projects.create({ name: 'DB review', configuration }), task = await projects.createTask(project.id, { name: 'Original task', configuration });
  const report = '# Report\nThe sampled order amount is 9.00.';
  await writeFile(path.join(project.rootPath, '060_reports/report.md'), report);
  const selector = `db-result:${randomUUID()}`, verificationId = randomUUID();
  let withdrawn = false, bytes = 30 * 1024 * 1024, frozen = 0, verified = 0;
  const neutralReceipt = { resultId: selector.slice(10), connectionId: randomUUID(), connectionRevision: 1, sourceIdentity: 'synthetic-instance', columns: [], startedAt: '2026-11-14T00:00:00Z', finishedAt: '2026-11-14T00:00:01Z', receivedRows: 3, persistedRows: 3, serverRowCount: '3', chunkCount: 30, bytes, consistency: { isolation: 'repeatable-read', snapshot: null, timezone: 'UTC', encoding: 'UTF8' }, dataNature: 'author-query-result' as const, extractionCoverage: 'unverified' as const, limitations: ['取数范围未独立验证。'] };
  const dbBundles: FixedReviewBundlePort = {
    async freeze(owner, input, context) {
      frozen++; context.assertCurrent(); assert.equal(input.purpose, 'cnr'); assert.equal(input.selector, selector);
      assert.equal(context.maxTotalBytes, 50 * 1024 * 1024); assert.equal(context.existingBytes, Buffer.byteLength(report)); assert.deepEqual(context.configuration, { id: configuration.id, revision: 1 });
      return { ref: { kind: 'db-result-bundle', selector, owner, sha256: 'a'.repeat(64) }, neutralReceipt: { ...neutralReceipt, bytes }, logicalItems: 1, assertUnchanged: async () => {} };
    },
    async read(_owner, _ref, _input, context) {
      context.assertCurrent(); if (withdrawn) throw Object.assign(new Error('db_material_export_not_authorized'), { code: 'db_material_export_not_authorized' });
      return { neutralReceipt, rows: [['9.00']], coverage: { startRow: 0, providedRows: 1, resultRows: 3, providedBytes: 10, complete: false, verifiedChunks: 1, totalChunks: 30 }, continuationStartRow: 1 };
    },
    async verify(_owner, _ref, context) { verified++; context.assertCurrent(); if (withdrawn) throw Object.assign(new Error('db_material_export_not_authorized'), { code: 'db_material_export_not_authorized' }); },
  };
  const materials = createConclusionReviewMaterials({ dataRoot, projects, dbBundles,
    pair: async (p, q) => ({ project: await projects.get(p), task: await projects.getTask(p, q) }),
    availableConfiguration: () => configuration,
  });
  const selection = { verificationId, report: { relativePath: '060_reports/report.md' }, basisFiles: [selector] };
  const prepared = await materials.prepare(project.id, task.id, selection);
  const basis = prepared.review!.materials.find(item => item.id === 'basis-1')!;
  assert.equal(basis.kind, 'db-result'); assert.equal(basis.bytes, bytes); assert.equal(basis.sha256, 'a'.repeat(64));
  assert.match(basis.limitations!.join(' '), /固定|读取|计算/);
  assert.equal(prepared.dataFiles.length, 0, 'the private bundle is an exact external source, not a pretend single manifest data file');
  const packet = JSON.parse(prepared.review!.providedText);
  assert.equal(packet.content.find((item: {id: string}) => item.id === 'report').text, report);
  assert.match(packet.content.find((item: {id: string}) => item.id === 'basis-1').text, /"complete":false/);
  assert.ok(prepared.review!.providedText.length <= 65_536);
  await materials.assertAuthorized(prepared); assert.ok(verified > 0); assert.equal(frozen, 1);
  withdrawn = true; await assert.rejects(materials.assertAuthorized(prepared), { code: 'db_material_export_not_authorized' });
  withdrawn = false; bytes = 50 * 1024 * 1024;
  await assert.rejects(materials.prepare(project.id, task.id, { ...selection, verificationId: randomUUID() }), { code: 'conclusion_review_db_bundle_bytes_limit' });
});

test('DB11: database selectors share the existing 24-basis limit and never accept paths or forged selectors', () => {
  const selection = { verificationId: randomUUID(), report: { relativePath: '060_reports/report.md' } };
  const selector = `db-result:${randomUUID()}`;
  assert.deepEqual(parseConclusionReviewSelection({ ...selection, basisFiles: [selector] }).basisFiles, [selector]);
  for (const basisFiles of [[selector + '/rows-000001.json'], ['db-result:../credentials'], Array.from({ length: 25 }, () => `db-result:${randomUUID()}`)])
    assert.throws(() => parseConclusionReviewSelection({ ...selection, basisFiles }));
});

test('DB11: a complete oversized row remains fixed while conclusion review states the missing row coverage', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'optracall-db-conclusion-large-'));
  const dataRoot = path.join(root, 'data'), projects = new ProjectStore({ dataRoot, projectsRoot: path.join(root, 'projects') });
  await projects.init(); t.after(async () => { await projects.close(); await rm(root, { recursive: true, force: true }); });
  const configuration = { id: 'synthetic', revision: 1, name: 'Synthetic', provider: 'synthetic', api: 'openai-completions' as const, model: 'synthetic', baseUrl: 'http://127.0.0.1/v1', apiKey: 'synthetic-only' };
  const project = await projects.create({ name: 'Owner', configuration }), task = await projects.createTask(project.id, { name: 'Task', configuration });
  const owner = { projectId: project.id, taskId: task.id, requestId: randomUUID(), operationId: randomUUID() };
  const results = new DbLinkResults({ dataRoot, projectDirectory: () => project.rootPath, assertAccess() {} });
  const sink = await results.begin(owner, { connectionId: randomUUID(), connectionRevision: 1, engine: 'postgresql', sourceIdentity: 'synthetic-instance', sql: 'select note from public.orders', parameters: [], observedObjects: ['public.orders'], declaredObjects: [], unknownObjects: [], startedAt: new Date().toISOString(), session: { timezone: 'UTC', encoding: 'UTF8', isolation: 'repeatable read' }, modelExport: { targets: [dbLinkModelOutlet(configuration)], results: true, structure: false, queryText: false, comments: false } }, [{ ordinal: 0, name: 'note', databaseType: 'text', precision: null, scale: null }], { maxRows: 10, maxBytes: 500000, maxCellBytes: 100000, chunkBytes: 50000 });
  await sink.append([['x'.repeat(25000)]]); const receipt = await sink.complete('1');
  const dbBundles = createDbLinkReviewPort({ privateRoot: path.join(dataRoot, 'reviews'), projects, configurationSnapshot: () => configuration, materialSource: async (_p, _t, id) => results.materialFiles(owner, id), isClosing: () => false });
  const materials = createConclusionReviewMaterials({ dataRoot, projects, dbBundles, availableConfiguration: () => configuration, pair: async (p, q) => ({ project: await projects.get(p), task: await projects.getTask(p, q) }) });
  const report = '# Report\nReview the claim with whatever evidence was provided.';
  await writeFile(path.join(project.rootPath, '060_reports/report.md'), report);
  const prepared = await materials.prepare(project.id, task.id, { verificationId: randomUUID(), report: { relativePath: '060_reports/report.md' }, basisFiles: [`db-result:${receipt.id}`] });
  const material = prepared.review!.materials.find(item => item.id === 'basis-1')!;
  assert.equal(material.bytes, receipt.bytes); assert.ok(material.bytes! > 25000);
  assert.match(material.limitations!.join(' '), /未提供行正文/);
  const content = JSON.parse(prepared.review!.providedText).content;
  assert.equal(content.find((item: {id: string}) => item.id === 'report').text, report);
  const preview = JSON.parse(content.find((item: {id: string}) => item.id === 'basis-1').text);
  assert.equal(preview.coverage.providedRows, 0); assert.equal(preview.coverage.complete, false);
  assert.equal(prepared.dataFiles.length, 0); await materials.assertAuthorized(prepared);
  assert.equal((await results.materialFiles(owner, receipt.id)).manifest.status, 'complete');
});
