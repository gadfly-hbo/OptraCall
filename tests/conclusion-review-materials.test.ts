import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHash, randomUUID } from 'node:crypto';
import { ProjectStore } from '../src/host/project-store.ts';
import { EnterpriseMaterialsStore } from '../src/host/enterprise-materials-store.ts';
import { CaseStore } from '../src/host/case-store.ts';
import { createConclusionReviewMaterials } from '../src/host/conclusion-review-materials.ts';
import type { ConclusionReviewSelection } from '../src/host/conclusion-review-contract.ts';
import { createMetricLibrary } from '../extensions/business-plugins/metric-factory/library/store.ts';
import { createProjectEnablement } from '../extensions/business-plugins/metric-factory/project/enablement.ts';
import { preparePublication } from '../extensions/business-plugins/metric-factory/sap/validate.ts';

const sha = (text: string | Uint8Array) => createHash('sha256').update(text).digest('hex');
const configuration = { id: 'synthetic-review', revision: 1, name: 'Synthetic', provider: 'synthetic', model: 'synthetic', baseUrl: 'http://127.0.0.1' };
async function fixture(t: { after(fn: () => Promise<void>): void }) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'optracall-conclusion-materials-'));
  const dataRoot = path.join(root, 'data'), projects = new ProjectStore({ dataRoot, projectsRoot: path.join(root, 'projects') });
  await projects.init();
  const project = await projects.create({ name: 'Synthetic evidence project', configuration });
  const task = await projects.createTask(project.id, { name: 'Original task', configuration });
  let authorized = true, configured = true;
  const options = {
    dataRoot, projects,
    pair: async (projectId: string, taskId: string, writable = false) => {
      const project = await projects.get(projectId), task = await projects.getTask(projectId, taskId);
      if (writable && project.archivedAt !== null) throw Object.assign(new Error('project_archived'), { code: 'project_archived' });
      return { project, task };
    },
    availableConfiguration: (_id?: string, revision?: number) => configured && (revision === undefined || revision === configuration.revision) ? configuration : undefined,
    assertFileAuthorized: async () => { if (!authorized) throw Object.assign(new Error('synthetic_permission_withdrawn'), { code: 'synthetic_permission_withdrawn' }); },
  };
  const selection = (relativePath = '060_reports/report.md'): ConclusionReviewSelection => ({ verificationId: randomUUID(), report: { relativePath } });
  const materials = createConclusionReviewMaterials(options);
  t.after(async () => { await projects.close(); await fs.rm(root, { recursive: true, force: true }); });
  return { root, dataRoot, projects, project, task, options, selection, materials,
    revoke: () => { authorized = false; }, invalidateConfiguration: () => { configured = false; },
    write: (relativePath: string, text: string | Uint8Array) => fs.writeFile(path.join(project.rootPath, relativePath), text),
  };
}

test('CNR-A1: a unique safely captured authorized report is preselected without inventing current delivery', async t => {
  const f = await fixture(t), report = '# Report\nA claim with evidence.';
  await f.write('060_reports/report.md', report);
  const result = await f.materials.candidates(f.project.id, f.task.id);
  assert.deepEqual(result.preselected, { relativePath: '060_reports/report.md', sha256: sha(report) });
  assert.equal(result.reports[0].current, false);
  assert.equal(result.reports[0].reviewable, true);
  assert.equal(result.reports[0].sha256, sha(report));
});

test('CNR-A1: names and modification order cannot choose a current report among multiple candidates', async t => {
  const f = await fixture(t);
  await f.write('060_reports/report.md', '# First');
  await f.write('060_reports/latest-final.md', '# Second');
  const list = await f.materials.candidates(f.project.id, f.task.id);
  assert.equal(list.reports.length, 2);
  assert.equal(list.preselected, undefined);
  assert.ok(list.reports.every((value: { current: boolean }) => !value.current));
  const bound = createConclusionReviewMaterials({ ...f.options, currentReportBinding: async () => ({ relativePath: '060_reports/report.md', sha256: sha('# First'), requestId: randomUUID(), sessionId: randomUUID() }) });
  const current = await bound.candidates(f.project.id, f.task.id);
  assert.deepEqual(current.preselected, { relativePath: '060_reports/report.md', sha256: sha('# First') });
  assert.equal(current.reports.find((value: { relativePath: string }) => value.relativePath === '060_reports/report.md')!.current, true);
  await f.write('060_reports/report.md', '# Different bytes');
  assert.equal((await bound.candidates(f.project.id, f.task.id)).preselected, undefined);
});

test('CNR-A1/A5: start binds full report and selected evidence; later live updates preserve that fixed old version', async t => {
  const f = await fixture(t), report = '# Old report\nThe category is largest in this item.', evidence = 'category,count\nA,3\nC,7\n';
  await f.write('060_reports/report.md', report); await f.write('020_clean/evidence.csv', evidence);
  const selection = { ...f.selection(), basisFiles: ['020_clean/evidence.csv'] };
  const preview = await f.materials.preview(f.project.id, f.task.id, selection);
  const prepared = await f.materials.prepare(f.project.id, f.task.id, selection, preview.etag);
  assert.equal(prepared.mode, 'conclusion-review');
  assert.equal(prepared.review!.report.sha256, sha(report));
  const packet = JSON.parse(prepared.review!.providedText);
  assert.equal(packet.content.find((item: { id: string }) => item.id === 'report').text, report);
  assert.equal(packet.content.find((item: { id: string }) => item.id === 'basis-1').text, evidence);
  await f.write('060_reports/report.md', '# New report'); await f.write('020_clean/evidence.csv', 'new bytes');
  await f.materials.assertAuthorized(prepared);
  assert.equal(Buffer.from(prepared.authorFiles[0]!.bytes).toString('utf8'), report);
  assert.equal(Buffer.from(prepared.dataFiles[0]!.bytes).toString('utf8'), evidence);
  assert.equal(await fs.readFile(path.join(f.project.rootPath, '060_reports/report.md'), 'utf8'), '# New report');
});

test('CNR-A1: changed report, selection, or configuration rejects stale preview without rewriting chosen values', async t => {
  const f = await fixture(t); await f.write('060_reports/report.md', '# Original'); await f.write('020_clean/evidence.csv', 'n\n3');
  const selection = f.selection(), original = structuredClone(selection), preview = await f.materials.preview(f.project.id, f.task.id, selection);
  await f.write('060_reports/report.md', '# Newer');
  await assert.rejects(f.materials.prepare(f.project.id, f.task.id, selection, preview.etag), { code: 'conclusion_review_preview_changed' });
  assert.deepEqual(selection, original);
  const current = await f.materials.preview(f.project.id, f.task.id, selection);
  await assert.rejects(f.materials.prepare(f.project.id, f.task.id, { ...selection, basisFiles: ['020_clean/evidence.csv'] }, current.etag), { code: 'conclusion_review_preview_changed' });
  f.invalidateConfiguration();
  await assert.rejects(f.materials.prepare(f.project.id, f.task.id, selection, current.etag), { code: 'configuration_required' });
});

test('CNR-A1: wrong-version report, unreadable, unsupported and over-limit primary reports require reselection, never truncation', async t => {
  const f = await fixture(t); await f.write('060_reports/report.md', '# Valid');
  await assert.rejects(f.materials.prepare(f.project.id, f.task.id, { ...f.selection(), report: { relativePath: '060_reports/report.md', sha256: 'a'.repeat(64) } }), { code: 'conclusion_review_report_changed' });
  await f.write('060_reports/report.md', Buffer.from([0xFF, 0x00]));
  await assert.rejects(f.materials.prepare(f.project.id, f.task.id, f.selection()), { code: 'conclusion_review_report_requires_text' });
  await f.write('060_reports/report.pdf', '%PDF not reliably extracted');
  await assert.rejects(f.materials.prepare(f.project.id, f.task.id, f.selection('060_reports/report.pdf')), { code: 'conclusion_review_report_requires_text' });
  await f.write('060_reports/report.md', '# Long\n' + 'x'.repeat(65_536));
  await assert.rejects(f.materials.prepare(f.project.id, f.task.id, f.selection()), { code: 'conclusion_review_report_too_large' });
  assert.equal((await f.projects.readFile(f.project.id, '060_reports/report.md')).bytes.length, 65_543);
});

test('CNR-A1/A5: withdrawal, owner loss and invalid configuration stop late delivery even when fixed bytes remain', async t => {
  const f = await fixture(t); await f.write('060_reports/report.md', '# Report');
  const prepared = await f.materials.prepare(f.project.id, f.task.id, f.selection());
  f.revoke();
  await assert.rejects(f.materials.assertAuthorized(prepared), { code: 'synthetic_permission_withdrawn' });
  const configured = await fixture(t); await configured.write('060_reports/report.md', '# Report');
  const next = await configured.materials.prepare(configured.project.id, configured.task.id, configured.selection());
  configured.invalidateConfiguration();
  await assert.rejects(configured.materials.assertAuthorized(next), { code: 'configuration_required' });
  await assert.rejects(configured.materials.candidates(configured.project.id, randomUUID()), { code: 'task_not_found' });
});

test('CNR04: optional missing, nontext and long evidence records actual provided gaps and exact safe UTF16 ranges', async t => {
  const f = await fixture(t), report = '# A short report', source = '甲😀'.repeat(40_000);
  await f.write('060_reports/report.md', report); await f.write('020_clean/long.txt', source); await f.write('020_clean/binary.csv', Buffer.from([0xFF]));
  const prepared = await f.materials.prepare(f.project.id, f.task.id, { ...f.selection(), basisFiles: ['020_clean/long.txt', '020_clean/missing.csv', '020_clean/binary.csv'] });
  const review = prepared.review!, material = review.materials.find(item => item.id === 'basis-1')!, packet = JSON.parse(review.providedText);
  assert.ok(review.providedText.length <= 65_536);
  assert.equal(packet.content.find((item: { id: string }) => item.id === 'report').text, report);
  assert.equal(material.state, 'truncated');
  const text = packet.content.find((item: { id: string }) => item.id === material.id).text;
  assert.equal(text, source.slice(0, material.rangeUtf16!.end));
  assert.deepEqual(material.rangeUtf16, { start: 0, end: text.length, total: source.length });
  assert.ok(!/[\uD800-\uDBFF]$/.test(text));
  assert.deepEqual(review.materials.slice(2).map(item => item.state), ['unavailable', 'unavailable']);
  assert.ok(review.materials.slice(2).every(item => item.limitations?.length));
});

test('CNR04/A5: raw, private paths, other owners, links and credentials cannot become review material', async t => {
  const f = await fixture(t); await f.write('060_reports/report.md', '# Report');
  for (const relativePath of ['010_draw/raw.csv', '../other/060_reports/report.md', '/private/credential', '060_reports/../010_draw/raw.csv', '060_reports/.env'])
    await assert.rejects(f.materials.prepare(f.project.id, f.task.id, f.selection(relativePath)), { code: 'conclusion_review_invalid_report_path' });
  for (const file of ['010_draw/raw.csv', '../other/020_clean/data.csv', '/private/credential', '020_clean/.credentials.json', '020_clean/sub\\secret.csv'])
    await assert.rejects(f.materials.prepare(f.project.id, f.task.id, { ...f.selection(), basisFiles: [file] }), { code: 'conclusion_review_invalid_basis_path' });
  const outside = path.join(f.root, 'private.txt'); await fs.writeFile(outside, 'SYNTHETIC_PRIVATE_SECRET');
  await fs.symlink(outside, path.join(f.project.rootPath, '060_reports', 'link.md'));
  await assert.rejects(f.materials.prepare(f.project.id, f.task.id, f.selection('060_reports/link.md')));
  await fs.link(outside, path.join(f.project.rootPath, '020_clean', 'hard.txt'));
  const prepared = await f.materials.prepare(f.project.id, f.task.id, { ...f.selection(), basisFiles: ['020_clean/hard.txt'] });
  assert.doesNotMatch(prepared.review!.providedText, /SYNTHETIC_PRIVATE_SECRET/);
  assert.equal(await fs.readFile(outside, 'utf8'), 'SYNTHETIC_PRIVATE_SECRET');
});

test('CNR04: exact authorized framework and RAP sources are fixed independently of later source text', async t => {
  const f = await fixture(t); await f.write('060_reports/report.md', '# Report');
  let text = 'CONFIRMED_OLD_FRAMEWORK', readable = true;
  const frameworkVersion = randomUUID(), requirementContext = { instanceId: 'req-framework', frameworkVersion };
  const materials = createConclusionReviewMaterials({ ...f.options, requirementContext: async (input, projectId) => {
    assert.equal(projectId, f.project.id); assert.deepEqual(input, { requirementContext });
    if (!readable) throw Object.assign(new Error('withdrawn'), { code: 'requirement_unavailable' }); return text;
  } });
  const selection = { ...f.selection(), requirementContext }, preview = await materials.preview(f.project.id, f.task.id, selection);
  const prepared = await materials.prepare(f.project.id, f.task.id, selection, preview.etag);
  const material = prepared.review!.materials.find(item => item.kind === 'requirement')!;
  assert.equal(JSON.parse(material.locator).frameworkVersion, frameworkVersion);
  assert.equal(material.sha256, sha(text));
  assert.match(prepared.semantics!.text, /CONFIRMED_OLD_FRAMEWORK/);
  text = 'NEW_FRAMEWORK_BODY';
  await materials.assertAuthorized(prepared);
  await assert.rejects(materials.prepare(f.project.id, f.task.id, selection, preview.etag), { code: 'conclusion_review_preview_changed' });
  assert.doesNotMatch(prepared.review!.providedText, /NEW_FRAMEWORK_BODY/);
  readable = false;
  await assert.rejects(materials.assertAuthorized(prepared), { code: 'requirement_unavailable' });
});

test('CNR04: enterprise excerpts keep exact source revision/range and old enabled revision survives a newer publication', async t => {
  const f = await fixture(t); await f.write('060_reports/report.md', '# Report');
  const enterprise = new EnterpriseMaterialsStore(f.dataRoot);
  await enterprise.list();
  let detail = await enterprise.create({ title: 'Synthetic published rule', body: 'first😀authorized excerpt:last' });
  detail = await enterprise.enable(detail.material.id, detail.material.version);
  const oldRevision = detail.material.activeRevisionId!, catalog = await enterprise.referenceIndex({ readOnly: true });
  const selection = { ...f.selection(), enterpriseMaterials: [{ storeId: catalog.storeId, materialId: detail.material.id, revisionId: oldRevision, mode: 'excerpt' as const, start: 7, end: 25 }] };
  const materials = createConclusionReviewMaterials({ ...f.options, enterpriseMaterials: enterprise });
  const prepared = await materials.prepare(f.project.id, f.task.id, selection);
  const source = prepared.review!.materials.find(item => item.kind === 'enterprise')!, locator = JSON.parse(source.locator);
  assert.equal(locator.revisionId, oldRevision);
  assert.deepEqual(locator.sourceRangeUtf16, { start: 7, end: 25, total: 'first😀authorized excerpt:last'.length });
  assert.equal(locator.bodySha256, sha('first😀authorized excerpt:last'));
  assert.equal(JSON.parse(prepared.review!.providedText).content.find((item: { id: string }) => item.id === source.id).text, 'first😀authorized excerpt:last'.slice(7, 25));
  detail = await enterprise.update(detail.material.id, detail.material.version, { body: 'NEW_ENTERPRISE_RULE' });
  detail = await enterprise.enable(detail.material.id, detail.material.version);
  await materials.assertAuthorized(prepared);
  assert.doesNotMatch(prepared.review!.providedText, /NEW_ENTERPRISE_RULE/);
  await enterprise.disable(detail.material.id, detail.material.version);
  await assert.rejects(materials.assertAuthorized(prepared), { code: 'enterprise_material_disabled' });
});

test('CNR04: selected Case background is revision bound while a later update differs from withdrawal of its project link', async t => {
  const f = await fixture(t); await f.write('060_reports/report.md', '# Report');
  const cases = new CaseStore({ dataRoot: f.dataRoot }); await cases.initialize(); t.after(async () => { cases.close(); });
  let record = cases.createCase({ operationId: randomUUID(), title: 'Synthetic Case', description: 'OLD_EXPLICIT_BACKGROUND' });
  record = cases.linkProject({ operationId: randomUUID(), caseId: record.id, projectId: f.project.id, expectedRevision: record.revision }).case;
  const materials = createConclusionReviewMaterials({ ...f.options, cases });
  const prepared = await materials.prepare(f.project.id, f.task.id, { ...f.selection(), caseId: record.id, caseRevision: record.revision });
  assert.match(prepared.review!.providedText, /OLD_EXPLICIT_BACKGROUND/);
  record = cases.updateCase({ operationId: randomUUID(), caseId: record.id, expectedRevision: record.revision, description: 'NEW_BACKGROUND' });
  await materials.assertAuthorized(prepared);
  assert.doesNotMatch(prepared.review!.providedText, /NEW_BACKGROUND/);
  cases.unlinkProject({ operationId: randomUUID(), caseId: record.id, projectId: f.project.id, expectedRevision: record.revision });
  await assert.rejects(materials.assertAuthorized(prepared), { code: 'project_not_linked' });
});

test('CNR04/A5: source unavailability is an explicit gap and no full native history is auto-imported', async t => {
  const f = await fixture(t); await f.write('060_reports/report.md', '# Report');
  const materials = createConclusionReviewMaterials({ ...f.options, requirementContext: async () => { throw Object.assign(new Error('/SYNTHETIC_PRIVATE_PATH token=SECRET'), { code: 'requirement_unavailable' }); } });
  const prepared = await materials.prepare(f.project.id, f.task.id, { ...f.selection(), requirementContext: { instanceId: 'req-missing', version: '1.0.0' }, useCurrentSap: true });
  assert.deepEqual(prepared.review!.materials.slice(1).map(item => item.state), ['unavailable', 'unavailable']);
  assert.doesNotMatch(prepared.review!.providedText, /SYNTHETIC_PRIVATE_PATH|token=SECRET/);
  assert.equal(prepared.semantics!.text, '[]');
  await materials.assertAuthorized(prepared);
});

test('CNR04: selected SAP uses an exact published version; a newer project pin differs from disabling its authorization', async t => {
  const f = await fixture(t); await f.write('060_reports/report.md', '# Report');
  const draft = await fs.readFile(path.resolve(import.meta.dirname, '../extensions/business-plugins/metric-factory/fixtures/membership-repurchase@1.0.0.draft.yaml'), 'utf8');
  const library = createMetricLibrary(path.join(f.dataRoot, 'metric-assets'));
  library.publish(preparePublication(Buffer.from(draft)), 'synthetic-test');
  const enablement = createProjectEnablement(path.join(f.dataRoot, 'projects', f.project.id));
  enablement.enable('membership-repurchase', '1.0.0');
  const prepared = await f.materials.prepare(f.project.id, f.task.id, { ...f.selection(), useCurrentSap: true });
  const material = prepared.review!.materials.find(item => item.kind === 'sap')!;
  assert.equal(JSON.parse(material.locator).version, '1.0.0');
  assert.match(prepared.review!.providedText, /repurchase_rate/);
  library.publish(preparePublication(Buffer.from(draft.replace('version: 1.0.0', 'version: 1.1.0').replace('复购会员数', '重复购买会员数'))), 'synthetic-test');
  enablement.enable('membership-repurchase', '1.1.0');
  await f.materials.assertAuthorized(prepared);
  assert.equal(JSON.parse(prepared.review!.materials.find(item => item.kind === 'sap')!.locator).version, '1.0.0');
  enablement.disable('membership-repurchase');
  await assert.rejects(f.materials.assertAuthorized(prepared), { code: 'conclusion_review_sap_withdrawn' });
});

test('CNR-A1/A5: archived readback preserves fixed material access while active review and invalid models stay unavailable', async t => {
  const f = await fixture(t); await f.write('060_reports/report.md', '# Report');
  const prepared = await f.materials.prepare(f.project.id, f.task.id, f.selection());
  await f.projects.archive(f.project.id); f.invalidateConfiguration();
  await f.materials.assertAuthorized(prepared, { active: false });
  await assert.rejects(f.materials.assertAuthorized(prepared), { code: 'project_archived' });
  f.revoke();
  await assert.rejects(f.materials.assertAuthorized(prepared, { active: false }), { code: 'synthetic_permission_withdrawn' });
});

test('CNR-A1: changed report during asynchronous source preparation never becomes an admitted stale selection', async t => {
  const f = await fixture(t); await f.write('060_reports/report.md', '# Before source read');
  let changed = false;
  const materials = createConclusionReviewMaterials({ ...f.options, requirementContext: async () => {
    if (!changed) { changed = true; await f.write('060_reports/report.md', '# Changed while reading source'); }
    return 'fixed source';
  } });
  await assert.rejects(materials.prepare(f.project.id, f.task.id, { ...f.selection(), requirementContext: { instanceId: 'req-read', version: '1.0.0' } }), { code: 'conclusion_review_preview_changed' });
});

test('CNR04: optional source metadata cannot force truncation of an otherwise complete report', async t => {
  const f = await fixture(t), report = '# Full report\n' + 'x'.repeat(55_000);
  await f.write('060_reports/report.md', report);
  const basisFiles: string[] = [];
  for (let i = 0; i < 24; i++) {
    const relative = '020_clean/' + ['a'.repeat(150), 'b'.repeat(150), 'c'.repeat(150), `evidence-${i}.txt`].join('/');
    await fs.mkdir(path.dirname(path.join(f.project.rootPath, relative)), { recursive: true });
    await f.write(relative, `EXPLICIT_SOURCE_${i}`); basisFiles.push(relative);
  }
  const prepared = await f.materials.prepare(f.project.id, f.task.id, { ...f.selection(), basisFiles });
  const packet = JSON.parse(prepared.review!.providedText);
  assert.equal(packet.content.find((item: { id: string }) => item.id === 'report').text, report);
  assert.ok(prepared.review!.providedText.length <= 65_536);
  const gap = prepared.review!.materials.find(item => item.kind === 'coverage-gap')!;
  assert.ok(gap);
  assert.ok(JSON.parse(gap.locator).notProvidedCount > 0);
  assert.match(gap.limitations!.join(' '), /未知/);
});

test('CNR02/CNR04: candidate lists exclude raw, private and currently unauthorized references', async t => {
  const f = await fixture(t);
  await f.write('060_reports/report.md', '# Authorized'); await f.write('060_reports/.credentials.json', 'PRIVATE_REFERENCE');
  await f.write('020_clean/evidence.csv', 'n\n3'); await f.write('020_clean/.credentials.json', 'PRIVATE_REFERENCE');
  await f.write('010_draw/raw.csv', 'RAW_REFERENCE');
  const list = await f.materials.candidates(f.project.id, f.task.id);
  assert.deepEqual(list.reports.map(report => report.relativePath), ['060_reports/report.md']);
  assert.deepEqual(list.basisFiles.map(file => file.relativePath), ['020_clean/evidence.csv']);
  f.revoke();
  const withdrawn = await f.materials.candidates(f.project.id, f.task.id);
  assert.deepEqual(withdrawn.reports, []); assert.deepEqual(withdrawn.basisFiles, []); assert.equal(withdrawn.preselected, undefined);
});

test('CNR03/CNR04: a newer stale requirement draft does not withdraw an authorized fixed confirmed framework', async t => {
  const f = await fixture(t); await f.write('060_reports/report.md', '# Report');
  const requirementContext = { instanceId: 'req-old-confirmed', frameworkVersion: randomUUID() };
  let stale = false, authorized = true, compositionCount = 0;
  const materials = createConclusionReviewMaterials({ ...f.options,
    requirementContext: async () => { compositionCount++; if (stale) throw Object.assign(new Error('upstream changed'), { code: 'requirement_unavailable' }); return 'OLD_AUTHORIZED_CONFIRMED_FRAMEWORK'; },
    assertRequirementAuthorized: async (selected, projectId) => {
      assert.deepEqual(selected, requirementContext); assert.equal(projectId, f.project.id);
      if (!authorized) throw Object.assign(new Error('withdrawn'), { code: 'requirement_unavailable' });
    },
  });
  const prepared = await materials.prepare(f.project.id, f.task.id, { ...f.selection(), requirementContext });
  const compositionsBeforeUpdate = compositionCount;
  stale = true;
  await materials.assertAuthorized(prepared);
  await materials.assertAuthorized(prepared, { active: false });
  assert.equal(compositionCount, compositionsBeforeUpdate);
  assert.match(prepared.review!.providedText, /OLD_AUTHORIZED_CONFIRMED_FRAMEWORK/);
  authorized = false;
  await assert.rejects(materials.assertAuthorized(prepared), { code: 'requirement_unavailable' });
  await assert.rejects(materials.assertAuthorized(prepared, { active: false }), { code: 'requirement_unavailable' });
});
