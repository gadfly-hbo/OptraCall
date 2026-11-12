import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { randomUUID, createHash } from 'node:crypto';
import { ProjectStore } from '../src/host/project-store.ts';
import { createReportCalculationMaterials } from '../src/host/report-calculation-materials.ts';
import { EnterpriseMaterialsStore } from '../src/host/enterprise-materials-store.ts';
import type { EnterpriseContextProvision } from '../src/host/enterprise-materials-types.ts';

const sha = (content: string | Buffer) => createHash('sha256').update(content).digest('hex');
const configuration = { id: 'synthetic', revision: 1, name: 'Synthetic', provider: 'synthetic', model: 'synthetic', baseUrl: 'http://127.0.0.1' };
async function fixture(t: { after(fn: () => Promise<void>): void }) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'optracall-report-materials-'));
  const dataRoot = path.join(root, 'data'), projects = new ProjectStore({ dataRoot, projectsRoot: path.join(root, 'projects') });
  await projects.init();
  const project = await projects.create({ name: 'Synthetic review project', configuration });
  const task = await projects.createTask(project.id, { name: 'Parent task', configuration });
  const owner = { projectId: project.id, taskId: task.id, requestId: randomUUID(), sessionId: randomUUID() };
  const context = { signal: new AbortController().signal, assertCurrent() {} };
  const materials = createReportCalculationMaterials({ dataRoot, projects });
  t.after(async () => { await projects.close(); await fs.rm(root, { recursive: true, force: true }); });
  return { root, dataRoot, projects, project, task, owner, context, materials };
}

test('RCR04: only an Agent-selected main report in 060_reports can be fixed for review', async t => {
  const f = await fixture(t);
  await f.projects.upload({ projectId: f.project.id, name: 'process.md', bytes: Buffer.from('# A process file'), directory: '020_clean' });
  await assert.rejects(f.materials.prepare(f.owner, { report: { path: '020_clean/process.md' } }, f.context), { code: 'report_calculation_invalid_report_path' });
});

test('RCR04/RCR08: selected report and source bytes are version-bound and preserved before a child sees them', async t => {
  const f = await fixture(t), report = '# Synthetic initial report\nTotal 22', input = 'amount\n10\n12\n';
  await fs.writeFile(path.join(f.project.rootPath, '060_reports', 'main.md'), report);
  await f.projects.upload({ projectId: f.project.id, name: 'amount.csv', bytes: Buffer.from(input), directory: '020_clean' });
  const bound = await f.materials.prepare(f.owner, { report: { path: '060_reports/main.md', sha256: sha(report) }, materials: [{ path: '020_clean/amount.csv', sha256: sha(input) }] }, f.context);
  assert.equal(bound.receipt.type, 'optracall.report-calculation-materials');
  assert.deepEqual(bound.receipt.owner, f.owner);
  assert.match(bound.receipt.reviewId, /^[a-f0-9-]{36}$/);
  assert.equal(bound.receipt.materials.length, 2);
  const [main, source] = bound.receipt.materials;
  assert.equal(main!.sha256, sha(report));
  assert.equal(source!.sha256, sha(input));
  assert.deepEqual(main!.rangeUtf16, { start: 0, end: report.length, total: report.length });
  assert.deepEqual(source!.rangeUtf16, { start: 0, end: input.length, total: input.length });
  assert.match(bound.prompt, /Synthetic initial report/);
  assert.match(bound.prompt, /amount\\n10\\n12/);
  assert.ok(bound.prompt.length <= 20_000);
  await bound.assertFeedbackCurrent();
  const snapshotRoot = path.join(f.dataRoot, 'report-calculation-review', f.owner.projectId, f.owner.taskId, f.owner.requestId, bound.receipt.reviewId);
  assert.equal(await fs.readFile(path.join(snapshotRoot, main!.id + '.bin'), 'utf8'), report);
  assert.equal(await fs.readFile(path.join(snapshotRoot, source!.id + '.bin'), 'utf8'), input);
  await fs.writeFile(path.join(f.project.rootPath, '060_reports', 'main.md'), '# A newer report');
  await assert.rejects(bound.assertFeedbackCurrent(), { code: 'report_calculation_report_changed' });
  assert.equal(await fs.readFile(path.join(snapshotRoot, main!.id + '.bin'), 'utf8'), report);
});

test('RCR04/RCR09: a changed fixed receipt prevents an opinion being returned under the original material identity', async t => {
  const f = await fixture(t);
  await fs.writeFile(path.join(f.project.rootPath, '060_reports', 'main.md'), '# Original report');
  const bound = await f.materials.prepare(f.owner, { report: { path: '060_reports/main.md' } }, f.context);
  const root = path.join(f.dataRoot, 'report-calculation-review', f.owner.projectId, f.owner.taskId, f.owner.requestId, bound.receipt.reviewId);
  await fs.writeFile(path.join(root, 'receipt.json'), JSON.stringify({ replaced: true }));
  await assert.rejects(bound.assertFeedbackCurrent(), { code: 'report_calculation_snapshot_changed' });
});

test('RCR04/RCR06: missing, wrong-version and nontext associated files remain explicit gaps', async t => {
  const f = await fixture(t);
  await fs.writeFile(path.join(f.project.rootPath, '060_reports', 'main.md'), '# A main report');
  await f.projects.upload({ projectId: f.project.id, name: 'input.csv', bytes: Buffer.from('n\n3\n'), directory: '020_clean' });
  await fs.writeFile(path.join(f.project.rootPath, '020_clean', 'binary.csv'), Buffer.from([0, 255]));
  await assert.rejects(f.materials.prepare(f.owner, { report: { path: '060_reports/main.md', sha256: 'a'.repeat(64) } }, f.context), { code: 'report_calculation_version_conflict' });
  const bound = await f.materials.prepare(f.owner, { report: { path: '060_reports/main.md' }, materials: [
    { path: '020_clean/missing.csv' }, { path: '020_clean/input.csv', sha256: 'b'.repeat(64) }, { path: '020_clean/binary.csv' },
  ] }, f.context);
  assert.deepEqual(bound.receipt.materials.map(item => item.state), ['provided', 'unavailable', 'version-conflict', 'unavailable']);
  assert.equal(bound.receipt.materials[2]!.sha256, sha('n\n3\n'));
  assert.equal(bound.receipt.materials[3]!.code, 'report_calculation_material_requires_text');
  await bound.assertFeedbackCurrent();
});

test('RCR05: traversal, private paths, another project, symlinks and hardlinks never become review materials', async t => {
  const f = await fixture(t);
  await fs.writeFile(path.join(f.project.rootPath, '060_reports', 'main.md'), '# A main report');
  const report = { path: '060_reports/main.md' };
  for (const file of ['/Users/private/session.jsonl', '../another/020_clean/data.csv', '010_draw/raw.csv', '020_clean/../010_draw/raw.csv', '020_clean/.credentials.json', '020_clean/sub\\secret.csv'])
    await assert.rejects(f.materials.prepare(f.owner, { report, materials: [{ path: file }] }, f.context), { code: 'report_calculation_invalid_material_path' });
  await assert.rejects(f.materials.prepare({ ...f.owner, taskId: randomUUID() }, { report }, f.context), /task_not_found/);
  const outside = path.join(f.root, 'private.txt');
  await fs.writeFile(outside, 'SYNTHETIC_PRIVATE_CREDENTIAL');
  await fs.symlink(outside, path.join(f.project.rootPath, '020_clean', 'linked.csv'));
  await fs.link(outside, path.join(f.project.rootPath, '020_clean', 'hard.csv'));
  const bound = await f.materials.prepare(f.owner, { report, materials: [{ path: '020_clean/linked.csv' }, { path: '020_clean/hard.csv' }] }, f.context);
  assert.deepEqual(bound.receipt.materials.slice(1).map(item => item.state), ['unavailable', 'unavailable']);
  assert.doesNotMatch(bound.prompt, /SYNTHETIC_PRIVATE_CREDENTIAL/);
  assert.equal(await fs.readFile(outside, 'utf8'), 'SYNTHETIC_PRIVATE_CREDENTIAL');
});

test('RCR05/RCR09: authorization revocation, archive and parent cancellation reject subsequent opinion delivery', async t => {
  const f = await fixture(t);
  await fs.writeFile(path.join(f.project.rootPath, '060_reports', 'main.md'), '# A main report');
  let authorized = true;
  const bound = await f.materials.prepare(f.owner, { report: { path: '060_reports/main.md' } }, {
    ...f.context, assertAuthorized: async () => { if (!authorized) throw Object.assign(new Error('synthetic_authorization_revoked'), { code: 'synthetic_authorization_revoked' }); },
  });
  authorized = false;
  await assert.rejects(bound.assertFeedbackCurrent(), { code: 'synthetic_authorization_revoked' });
  const controller = new AbortController();
  const cancellable = await f.materials.prepare(f.owner, { report: { path: '060_reports/main.md' } }, { ...f.context, signal: controller.signal });
  controller.abort();
  await assert.rejects(cancellable.assertFeedbackCurrent(), { name: 'AbortError' });
  const active = await f.materials.prepare(f.owner, { report: { path: '060_reports/main.md' } }, f.context);
  await f.projects.archive(f.project.id);
  await assert.rejects(active.assertFeedbackCurrent(), { code: 'report_calculation_owner_unavailable' });
});

test('RCR04/RCR07: only the actual parent RAP summary is delivered and its original authority is rechecked', async t => {
  const f = await fixture(t);
  await fs.writeFile(path.join(f.project.rootPath, '060_reports', 'main.md'), '# A main report');
  const rap = { instanceId: 'req-synthetic', version: '1.0.0', frameworkVersion: randomUUID(), text: 'SYNTHETIC_ACTUALLY_SUPPLIED_FRAMEWORK' };
  const denied = await f.materials.prepare(f.owner, { report: { path: '060_reports/main.md' } }, { ...f.context, providedContext: { rap } });
  assert.equal(denied.receipt.materials[1]!.code, 'report_calculation_framework_authority_unavailable');
  assert.doesNotMatch(denied.prompt, /SYNTHETIC_ACTUALLY_SUPPLIED_FRAMEWORK/);
  let current = true;
  const scoped = createReportCalculationMaterials({ projects: f.projects, dataRoot: f.dataRoot, assertRapCurrent: async (value, owner) => {
    assert.deepEqual(value, rap); assert.deepEqual(owner, f.owner);
    if (!current) throw Object.assign(new Error('synthetic_framework_withdrawn'), { code: 'synthetic_framework_withdrawn' });
  } });
  const bound = await scoped.prepare(f.owner, { report: { path: '060_reports/main.md' } }, { ...f.context, providedContext: { rap, personal: { text: 'UNDELIVERED_PERSONAL_TEXT' }, studio: { text: 'UNDELIVERED_STUDIO_TEXT' } } });
  assert.match(bound.prompt, /SYNTHETIC_ACTUALLY_SUPPLIED_FRAMEWORK/);
  assert.doesNotMatch(bound.prompt, /UNDELIVERED_PERSONAL_TEXT|UNDELIVERED_STUDIO_TEXT/);
  assert.deepEqual(bound.receipt.materials.slice(2).map(item => [item.kind, item.state]), [['personal', 'unavailable'], ['studio', 'unavailable']]);
  current = false;
  await assert.rejects(bound.assertFeedbackCurrent(), { code: 'synthetic_framework_withdrawn' });
});

test('RCR04/RCR05: shared enterprise context keeps the parent exact excerpt and stops after revocation', async t => {
  const f = await fixture(t), enterprise = new EnterpriseMaterialsStore(f.dataRoot);
  await fs.writeFile(path.join(f.project.rootPath, '060_reports', 'main.md'), '# A main report');
  const material = await enterprise.create({ title: 'Synthetic unit convention', body: 'UNDELIVERED_PREFIX\nSYNTHETIC_SUPPLIED_CONVENTION\nUNDELIVERED_SUFFIX' });
  const enabled = await enterprise.enable(material.material.id, material.material.version), revision = enabled.material.revisions[0]!;
  const supplied = 'SYNTHETIC_SUPPLIED_CONVENTION', start = revision.body.indexOf(supplied), providedAt = new Date().toISOString();
  const provision: EnterpriseContextProvision = { directory: { storeId: enabled.storeId, indexPath: 'unavailable-directory', providedAt, claim: 'directory-visible-not-read' }, materials: [{
    storeId: enabled.storeId, materialId: material.material.id, revisionId: revision.revisionId, bodySha256: revision.bodySha256,
    title: revision.title, bodyPath: revision.bodyPath, mode: 'excerpt', start, end: start + supplied.length, providedText: supplied, providedAt,
  }] };
  const scoped = createReportCalculationMaterials({ dataRoot: f.dataRoot, projects: f.projects, enterpriseMaterials: enterprise });
  const bound = await scoped.prepare(f.owner, { report: { path: '060_reports/main.md' } }, { ...f.context, providedContext: { enterprise: provision } });
  assert.match(bound.prompt, /SYNTHETIC_SUPPLIED_CONVENTION/);
  assert.doesNotMatch(bound.prompt, /UNDELIVERED_PREFIX|UNDELIVERED_SUFFIX|unavailable-directory/);
  assert.deepEqual(bound.receipt.materials[1]!.locator.parentRangeUtf16, { start, end: start + supplied.length });
  await enterprise.disable(material.material.id, enabled.material.version);
  await assert.rejects(bound.assertFeedbackCurrent(), { code: 'report_calculation_enterprise_withdrawn' });
});

test('RCR04/RCR06: transport truncation records the exact supplied UTF16 ranges while preserving full originals', async t => {
  const f = await fixture(t), report = '# Synthetic long report\n' + '甲😀'.repeat(20_000), data = 'n\n' + '2\n'.repeat(20_000);
  await fs.writeFile(path.join(f.project.rootPath, '060_reports', 'main.md'), report);
  await f.projects.upload({ projectId: f.project.id, name: 'input.csv', bytes: Buffer.from(data), directory: '020_clean' });
  const bound = await f.materials.prepare(f.owner, { report: { path: '060_reports/main.md' }, materials: [{ path: '020_clean/input.csv' }] }, f.context);
  assert.ok(bound.prompt.length <= 20_000);
  assert.deepEqual(bound.receipt.materials.map(item => item.state), ['truncated', 'truncated']);
  const parsed = JSON.parse(bound.prompt);
  for (const [index, original] of [report, data].entries()) {
    const range = bound.receipt.materials[index]!.rangeUtf16!;
    assert.equal(range.total, original.length);
    assert.equal(parsed.content[index].text, original.slice(range.start, range.end));
    assert.ok(!/[\uD800-\uDBFF]$/.test(parsed.content[index].text));
  }
  const root = path.join(f.dataRoot, 'report-calculation-review', f.owner.projectId, f.owner.taskId, f.owner.requestId, bound.receipt.reviewId);
  assert.equal(await fs.readFile(path.join(root, 'report.bin'), 'utf8'), report);
  assert.equal(await fs.readFile(path.join(root, 'data-1.bin'), 'utf8'), data);
  await bound.assertFeedbackCurrent();
});

test('RCR08: historical reads keep the fixed initial bytes after source edits and project archive', async t => {
  const f = await fixture(t), initial = '# Exact initial report\nTotal 22', input = 'amount\n10\n12\n';
  await fs.writeFile(path.join(f.project.rootPath, '060_reports', 'main.md'), initial);
  await fs.writeFile(path.join(f.project.rootPath, '020_clean', 'input.csv'), input);
  const bound = await f.materials.prepare(f.owner, { report: { path: '060_reports/main.md' }, materials: [{ path: '020_clean/input.csv' }] }, f.context);
  await fs.writeFile(path.join(f.project.rootPath, '060_reports', 'main.md'), '# A later separate version');
  await fs.writeFile(path.join(f.project.rootPath, '020_clean', 'input.csv'), 'amount\n99\n');
  await f.projects.archive(f.project.id);
  const first = await f.materials.readMaterial(f.owner, bound.receipt.reviewId, 'report', { expectedReceiptSha256: bound.receipt.sha256, length: 7 });
  assert.equal(first.text, initial.slice(0, 7));
  assert.equal(first.continuationStart, 7);
  assert.deepEqual(first.rangeUtf16, { start: 0, end: 7, total: initial.length });
  const rest = await f.materials.readMaterial(f.owner, bound.receipt.reviewId, 'report', { start: 7 });
  assert.equal(rest.text, initial.slice(7));
  assert.equal(rest.continuationStart, null);
  const data = await f.materials.readMaterial(f.owner, bound.receipt.reviewId, 'data-1');
  assert.equal(data.text, input);
  await assert.rejects(f.materials.readMaterial(f.owner, bound.receipt.reviewId, 'report', { expectedReceiptSha256: 'a'.repeat(64) }), { code: 'report_calculation_receipt_corrupt' });
  await assert.rejects(f.materials.readMaterial(f.owner, bound.receipt.reviewId, '../report'), { code: 'report_calculation_material_not_found' });
  const root = path.join(f.dataRoot, 'report-calculation-review', f.owner.projectId, f.owner.taskId, f.owner.requestId, bound.receipt.reviewId);
  await fs.writeFile(path.join(root, 'report.bin'), '# Altered saved draft');
  await assert.rejects(f.materials.readMaterial(f.owner, bound.receipt.reviewId, 'report'), { code: 'report_calculation_snapshot_changed' });
});

test('RCR05/RCR08: historical framework and shared snippets remain governed by their original current authorities', async t => {
  const f = await fixture(t), enterprise = new EnterpriseMaterialsStore(f.dataRoot);
  await fs.writeFile(path.join(f.project.rootPath, '060_reports', 'main.md'), '# Original');
  const created = await enterprise.create({ title: 'Synthetic shared convention', body: 'SHARED_ORIGINAL' });
  const enabled = await enterprise.enable(created.material.id, created.material.version), revision = enabled.material.revisions[0]!;
  const at = new Date().toISOString(), rap = { instanceId: 'req-fixed-history', version: '1.0.0', text: 'ACTUALLY_SUPPLIED_FRAME' };
  const provision: EnterpriseContextProvision = { directory: { storeId: enabled.storeId, indexPath: 'directory', providedAt: at, claim: 'directory-visible-not-read' }, materials: [{
    storeId: enabled.storeId, materialId: created.material.id, revisionId: revision.revisionId, bodySha256: revision.bodySha256,
    title: revision.title, bodyPath: revision.bodyPath, mode: 'full', providedText: revision.body, providedAt: at,
  }] };
  let rapCurrent = true;
  const scoped = createReportCalculationMaterials({ projects: f.projects, dataRoot: f.dataRoot, enterpriseMaterials: enterprise, assertRapCurrent: async value => {
    assert.equal(value.text, rap.text);
    if (!rapCurrent) throw Object.assign(new Error('synthetic_rap_withdrawn'), { code: 'synthetic_rap_withdrawn' });
  } });
  const bound = await scoped.prepare(f.owner, { report: { path: '060_reports/main.md' } }, { ...f.context, providedContext: { rap, enterprise: provision } });
  assert.equal((await scoped.readMaterial(f.owner, bound.receipt.reviewId, 'framework')).text, rap.text);
  assert.equal((await scoped.readMaterial(f.owner, bound.receipt.reviewId, 'enterprise-1')).text, revision.body);
  rapCurrent = false;
  await assert.rejects(scoped.readMaterial(f.owner, bound.receipt.reviewId, 'framework'), { code: 'synthetic_rap_withdrawn' });
  await enterprise.disable(created.material.id, enabled.material.version);
  await assert.rejects(scoped.readMaterial(f.owner, bound.receipt.reviewId, 'enterprise-1'), { code: 'report_calculation_enterprise_withdrawn' });
});


test('FCR02: an unversioned snapshot is a coverage gap even when still readable', async t => {
  const f = await fixture(t);
  await fs.writeFile(path.join(f.project.rootPath, '060_reports', 'main.md'), '# Calculation still available\nTotal 22');
  let authorityCalls = 0;
  const scoped = createReportCalculationMaterials({ projects: f.projects, dataRoot: f.dataRoot, assertRapCurrent: async () => { authorityCalls++; } });
  const bound = await scoped.prepare(f.owner, { report: { path: '060_reports/main.md' } }, { ...f.context, providedContext: {
    rap: { instanceId: 'req-unconfirmed', text: 'UNCONFIRMED_FRAMEWORK_PRIVATE' },
  } });
  assert.doesNotMatch(bound.prompt, /UNCONFIRMED_FRAMEWORK_PRIVATE/);
  assert.equal(bound.receipt.materials.find(item => item.kind === 'framework')?.state, 'unavailable');
  assert.equal(bound.receipt.materials.find(item => item.kind === 'framework')?.code, 'report_calculation_framework_identity_unverified');
  assert.equal(authorityCalls, 0);
  assert.match(bound.prompt, /Calculation still available/);
  await bound.assertFeedbackCurrent();
});

test('FCR02/FCR03: exact delivered framework and current user words retain separate provenance', async t => {
  const f = await fixture(t);
  await fs.writeFile(path.join(f.project.rootPath, '060_reports', 'main.md'), '# Calculation\nTotal 22');
  const text = 'Only the delivered excerpt: compare channel and category.';
  const rap = { instanceId: 'req-exact', version: '1.2.0', basisSha256: sha(text), text };
  const originalUserText = '本轮只核对渠道，品类移到下一轮；这是本轮人的范围文字。';
  const scoped = createReportCalculationMaterials({ projects: f.projects, dataRoot: f.dataRoot, assertRapCurrent: async () => {} });
  const bound = await scoped.prepare(f.owner, { report: { path: '060_reports/main.md' } }, { ...f.context, providedContext: { rap, originalUserText } });
  const packet = JSON.parse(bound.prompt);
  assert.equal(packet.content.find((item: { id: string }) => item.id === 'user-request')?.text, originalUserText);
  const frame = bound.receipt.materials.find(item => item.kind === 'framework')!;
  assert.equal(frame.locator.origin, 'current-parent-request');
  assert.equal(frame.locator.deliveryRequestId, f.owner.requestId);
  assert.equal(frame.sha256, sha(text));
  const user = bound.receipt.materials.find(item => item.kind === 'user-request')!;
  assert.equal(user.locator.source, 'current-user-request');
  assert.equal(user.sha256, sha(originalUserText));
  assert.match(user.limitations!.join(' '), /Agent/);
  assert.equal((await scoped.readMaterial(f.owner, bound.receipt.reviewId, 'user-request')).text, originalUserText);
});

test('FCR02: previously delivered published RAPs keep exact historical request and text identities', async t => {
  const f = await fixture(t);
  await fs.writeFile(path.join(f.project.rootPath, '060_reports', 'main.md'), '# Calculation\nTotal 22');
  const requestId = randomUUID(), sessionId = randomUUID(), providedAt = new Date().toISOString();
  const historical = [
    { rap: { instanceId: 'req-old', version: '1.0.0', text: 'OLD_ACTUALLY_DELIVERED_PARTIAL' }, requestId, sessionId, providedAt, entryId: 'entry-old' },
    { rap: { instanceId: 'req-old', version: '2.0.0', text: 'SECOND_ACTUALLY_DELIVERED_TITLE_ONLY' }, requestId: randomUUID(), sessionId, providedAt },
  ];
  const seen: string[] = [];
  const scoped = createReportCalculationMaterials({ projects: f.projects, dataRoot: f.dataRoot, assertRapCurrent: async rap => { seen.push(rap.text); } });
  const bound = await scoped.prepare(f.owner, { report: { path: '060_reports/main.md' } }, { ...f.context, historicalFrameworks: historical });
  assert.match(bound.prompt, /OLD_ACTUALLY_DELIVERED_PARTIAL/);
  assert.match(bound.prompt, /SECOND_ACTUALLY_DELIVERED_TITLE_ONLY/);
  const frames = bound.receipt.materials.filter(item => item.kind === 'framework');
  assert.equal(frames.length, 2);
  assert.equal(frames[0]!.locator.origin, 'native-parent-history');
  assert.equal(frames[0]!.locator.deliveryRequestId, requestId);
  assert.equal(frames[0]!.locator.deliverySessionId, sessionId);
  assert.equal(frames[0]!.locator.entryId, 'entry-old');
  assert.match(frames[0]!.limitations!.join(' '), /历史/);
  assert.equal((await scoped.readMaterial(f.owner, bound.receipt.reviewId, frames[0]!.id)).text, historical[0]!.rap.text);
  assert.ok(seen.includes(historical[0]!.rap.text));
  const currentRap = { instanceId: 'req-current', version: '3.0.0', text: 'EXPLICIT_CURRENT_FRAMEWORK' };
  const current = await scoped.prepare({ ...f.owner, requestId: randomUUID() }, { report: { path: '060_reports/main.md' } }, {
    ...f.context, providedContext: { rap: currentRap }, historicalFrameworks: historical,
  });
  assert.match(current.prompt, /EXPLICIT_CURRENT_FRAMEWORK/);
  assert.doesNotMatch(current.prompt, /OLD_ACTUALLY_DELIVERED_PARTIAL|SECOND_ACTUALLY_DELIVERED_TITLE_ONLY/);
});

test('FCR02: bad digest and withdrawn historical sources withhold their text while calculations continue', async t => {
  const f = await fixture(t);
  await fs.writeFile(path.join(f.project.rootPath, '060_reports', 'main.md'), '# Calculation\nTotal 22');
  const scoped = createReportCalculationMaterials({ projects: f.projects, dataRoot: f.dataRoot, assertRapCurrent: async rap => {
    if (rap.instanceId === 'req-withdrawn') throw Object.assign(new Error('withdrawn'), { code: 'report_calculation_framework_withdrawn' });
  } });
  const historicalFrameworks = [
    { rap: { instanceId: 'req-bad-digest', version: '1.0.0', basisSha256: 'a'.repeat(64), text: 'BAD_DIGEST_PRIVATE_FRAMEWORK' }, requestId: randomUUID(), sessionId: randomUUID() },
    { rap: { instanceId: 'req-withdrawn', version: '1.0.0', text: 'WITHDRAWN_PRIVATE_FRAMEWORK' }, requestId: randomUUID(), sessionId: randomUUID() },
  ];
  const bound = await scoped.prepare(f.owner, { report: { path: '060_reports/main.md' } }, { ...f.context, historicalFrameworks });
  assert.doesNotMatch(bound.prompt, /BAD_DIGEST_PRIVATE_FRAMEWORK|WITHDRAWN_PRIVATE_FRAMEWORK/);
  assert.deepEqual(bound.receipt.materials.filter(item => item.kind === 'framework').map(item => item.state), ['version-conflict', 'unavailable']);
  assert.match(bound.prompt, /Calculation/);
  await bound.assertFeedbackCurrent();
});


test('FCR02/FCR03: long report and current user text retain priority over optional history', async t => {
  const f = await fixture(t);
  const report = '# Long calculation\n' + '甲😀'.repeat(12_000);
  await fs.writeFile(path.join(f.project.rootPath, '060_reports', 'main.md'), report);
  const frame = '按渠道和品类复核😀'.repeat(5_000), user = '本轮渠道先行😀'.repeat(5_000);
  const scoped = createReportCalculationMaterials({ projects: f.projects, dataRoot: f.dataRoot, assertRapCurrent: async () => {} });
  const bound = await scoped.prepare(f.owner, { report: { path: '060_reports/main.md' } }, {
    ...f.context, historicalFrameworks: [{ rap: { instanceId: 'req-long', version: '1.0.0', text: frame }, requestId: randomUUID(), sessionId: randomUUID() }],
    providedContext: { originalUserText: user },
  });
  assert.ok(bound.prompt.length <= 20_000);
  const packet = JSON.parse(bound.prompt);
  for (const [id, original] of [['report', report], ['user-request', user]]) {
    const material = bound.receipt.materials.find(item => item.id === id)!, range = material.rangeUtf16!;
    const text = packet.content.find((item: { id: string }) => item.id === id).text;
    assert.equal(material.state, 'truncated');
    assert.deepEqual(range, { start: 0, end: text.length, total: original!.length });
    assert.equal(text, original!.slice(0, range.end));
    assert.ok(!/[\uD800-\uDBFF]$/.test(text));
    assert.ok(text.length > 8_000);
  }
  const gap = bound.receipt.materials.find(item => item.id === 'framework-history')!;
  assert.equal(gap.locator.notProvidedCount, 1);
  assert.equal(gap.locator.includedCount, 0);
  assert.doesNotMatch(bound.prompt, /按渠道和品类复核/);
  const snapshotRoot = path.join(f.dataRoot, 'report-calculation-review', f.owner.projectId, f.owner.taskId, f.owner.requestId, bound.receipt.reviewId);
  assert.equal(await fs.readFile(path.join(snapshotRoot, 'user-request.bin'), 'utf8'), user);
  await assert.rejects(fs.stat(path.join(snapshotRoot, 'framework-1.bin')), { code: 'ENOENT' });
});

test('FCR02: a long historical excerpt uses only the remaining packet budget with exact ranges', async t => {
  const f = await fixture(t), report = '# Short calculation\n4+6=10', user = '本轮先核对渠道。', frame = '按渠道和品类复核😀'.repeat(5_000);
  await fs.writeFile(path.join(f.project.rootPath, '060_reports', 'main.md'), report);
  const scoped = createReportCalculationMaterials({ projects: f.projects, dataRoot: f.dataRoot, assertRapCurrent: async () => {} });
  const bound = await scoped.prepare(f.owner, { report: { path: '060_reports/main.md' } }, {
    ...f.context, historicalFrameworks: [{ rap: { instanceId: 'req-long-frame', version: '1.0.0', text: frame }, requestId: randomUUID(), sessionId: randomUUID() }],
    providedContext: { originalUserText: user },
  });
  const packet = JSON.parse(bound.prompt), material = bound.receipt.materials.find(item => item.id === 'framework-1')!;
  const text = packet.content.find((item: { id: string }) => item.id === 'framework-1').text;
  assert.ok(bound.prompt.length <= 20_000);
  assert.equal(material.state, 'truncated');
  assert.deepEqual(material.rangeUtf16, { start: 0, end: text.length, total: frame.length });
  assert.equal(text, frame.slice(0, text.length));
  assert.ok(!/[\uD800-\uDBFF]$/.test(text));
  assert.equal(packet.content.find((item: { id: string }) => item.id === 'report').text, report);
  assert.equal(packet.content.find((item: { id: string }) => item.id === 'user-request').text, user);
  const snapshotRoot = path.join(f.dataRoot, 'report-calculation-review', f.owner.projectId, f.owner.taskId, f.owner.requestId, bound.receipt.reviewId);
  assert.equal(await fs.readFile(path.join(snapshotRoot, 'framework-1.bin'), 'utf8'), frame);
});

test('FCR02/FCR04: unavailable explicit current framework never falls back to historical scope; late revocation blocks old advice', async t => {
  const f = await fixture(t);
  await fs.writeFile(path.join(f.project.rootPath, '060_reports', 'main.md'), '# Calculation\nTotal 22');
  let current = true;
  const scoped = createReportCalculationMaterials({ projects: f.projects, dataRoot: f.dataRoot, assertRapCurrent: async rap => {
    if (!current || rap.instanceId === 'req-revoked') throw Object.assign(new Error('withdrawn'), { code: 'report_calculation_framework_withdrawn' });
  } });
  const historicalFrameworks = [{ rap: { instanceId: 'req-old', version: '1.0.0', text: 'HISTORICAL_EXACT_SCOPE' }, requestId: randomUUID(), sessionId: randomUUID() }];
  const unavailable = await scoped.prepare(f.owner, { report: { path: '060_reports/main.md' } }, {
    ...f.context, historicalFrameworks, providedContext: { rap: { instanceId: 'req-revoked', frameworkVersion: randomUUID(), text: 'WITHDRAWN_CURRENT_SCOPE' } },
  });
  assert.doesNotMatch(unavailable.prompt, /HISTORICAL_EXACT_SCOPE|WITHDRAWN_CURRENT_SCOPE/);
  assert.equal(unavailable.receipt.materials.filter(item => item.kind === 'framework').length, 1);
  await unavailable.assertFeedbackCurrent();
  const available = await scoped.prepare({ ...f.owner, requestId: randomUUID() }, { report: { path: '060_reports/main.md' } }, { ...f.context, historicalFrameworks });
  current = false;
  await assert.rejects(available.assertFeedbackCurrent(), { code: 'report_calculation_framework_withdrawn' });
  await assert.rejects(scoped.readMaterial(available.receipt.owner, available.receipt.reviewId, 'framework-1'), { code: 'report_calculation_framework_withdrawn' });
});


test('FCR02: unreadable native history is an explicit coverage gap and does not stop calculation preparation', async t => {
  const f = await fixture(t);
  await fs.writeFile(path.join(f.project.rootPath, '060_reports', 'main.md'), '# Calculation can continue\nTotal 22');
  const bound = await f.materials.prepare(f.owner, { report: { path: '060_reports/main.md' } }, {
    ...f.context, historicalFrameworks: [], frameworkHistoryUnavailable: 'native_context_budget',
  });
  const missing = bound.receipt.materials.find(item => item.id === 'framework-history');
  assert.equal(missing?.state, 'unavailable');
  assert.equal(missing?.code, 'native_context_budget');
  assert.equal(missing?.locator.instanceId, undefined);
  assert.equal(missing?.locator.version, undefined);
  assert.equal(missing?.sha256, null);
  assert.match(bound.prompt, /Calculation can continue/);
  assert.match(missing!.limitations!.join(' '), /覆盖.*未知/);
  const read = await f.materials.readMaterial(f.owner, bound.receipt.reviewId, 'framework-history');
  assert.equal(read.text, null);
  await bound.assertFeedbackCurrent();
  const unsafe = await f.materials.prepare({ ...f.owner, requestId: randomUUID() }, { report: { path: '060_reports/main.md' } }, {
    ...f.context, frameworkHistoryUnavailable: '/SYNTHETIC_PRIVATE_PATH/native.jsonl: secret source text',
  });
  assert.doesNotMatch(unsafe.prompt, /SYNTHETIC_PRIVATE_PATH|secret source text/);
  assert.equal(unsafe.receipt.materials.find(item => item.id === 'framework-history')?.code, 'report_calculation_framework_history_unavailable');
});


for (const distinct of [false, true]) test(`FCR-A3: 40 ${distinct ? 'distinct' : 'repeated'} historical deliveries cannot consume the calculation packet`, async t => {
  const f = await fixture(t);
  const report = '# Short calculation\n4 + 6 = 10', data = 'amount\n4\n6\n', user = '本轮仅核对渠道，品类待补证。';
  await fs.writeFile(path.join(f.project.rootPath, '060_reports', 'main.md'), report);
  await fs.writeFile(path.join(f.project.rootPath, '020_clean', 'amount.csv'), data);
  const historicalFrameworks = Array.from({ length: 40 }, (_, index) => ({
    rap: { instanceId: 'req-budget', version: distinct ? `1.${index}.0` : '1.0.0', text: distinct ? `DELIVERED_SCOPE_${index} compare channel and category.` : 'REPEATED_DELIVERED_SCOPE compare channel and category.' },
    requestId: randomUUID(), sessionId: randomUUID(), entryId: `delivered-entry-${index}`, providedAt: new Date().toISOString(),
  }));
  const scoped = createReportCalculationMaterials({ projects: f.projects, dataRoot: f.dataRoot, assertRapCurrent: async () => {} });
  const bound = await scoped.prepare(f.owner, { report: { path: '060_reports/main.md' }, materials: [{ path: '020_clean/amount.csv' }] }, {
    ...f.context, historicalFrameworks, providedContext: { originalUserText: user },
  });
  assert.ok(bound.prompt.length <= 20_000);
  const packet = JSON.parse(bound.prompt);
  for (const [id, expected] of [['report', report], ['data-1', data], ['user-request', user]])
    assert.equal(packet.content.find((item: { id: string }) => item.id === id)?.text, expected);
  const delivered = bound.receipt.materials.filter(item => /^framework-[0-9]+$/.test(item.id));
  assert.ok(delivered.length > 0 && delivered.length < 40);
  const gap = bound.receipt.materials.find(item => item.id === 'framework-history')!;
  assert.equal(gap.state, 'unavailable');
  assert.equal(gap.locator.totalCount, 40);
  assert.equal(gap.locator.includedCount, delivered.length);
  assert.equal(gap.locator.notProvidedCount, 40 - delivered.length);
  assert.deepEqual(gap.locator.notProvidedRange, { start: delivered.length, end: 40 });
  assert.match(gap.limitations!.join(' '), /未知/);
  for (const [index, material] of delivered.entries()) {
    assert.equal(material.locator.deliveryRequestId, historicalFrameworks[index]!.requestId);
    assert.equal(packet.content.find((item: { id: string }) => item.id === material.id)?.text, historicalFrameworks[index]!.rap.text);
  }
  if (distinct) assert.doesNotMatch(bound.prompt, /DELIVERED_SCOPE_39/);
  assert.equal((await scoped.readMaterial(f.owner, bound.receipt.reviewId, 'framework-history')).text, null);
  await bound.assertFeedbackCurrent();
});


test('FCR-A3: optional history metadata cannot reject a primary packet near its existing metadata limit', async t => {
  const f = await fixture(t);
  await fs.writeFile(path.join(f.project.rootPath, '060_reports', 'main.md'), '# Calculation\n4+6=10');
  const scoped = createReportCalculationMaterials({ projects: f.projects, dataRoot: f.dataRoot, assertRapCurrent: async rap => {
    if (rap.instanceId === 'req-withdrawn-budget') throw Object.assign(new Error('withdrawn'), { code: 'report_calculation_framework_withdrawn' });
  } });
  const historicalFrameworks = Array.from({ length: 40 }, (_, index) => ({
    rap: { instanceId: 'req-near-limit', version: `1.${index}.0`, text: `SCOPE_${index}` }, requestId: randomUUID(), sessionId: randomUUID(),
  }));
  let nearLimitChecked = false;
  for (const width of [780, 790, 800, 810, 820, 830]) {
    const materials = [];
    for (let index = 0; index < 18; index++) {
      const relative = '020_clean/' + ['a'.repeat(180), 'b'.repeat(180), 'c'.repeat(180), 'd'.repeat(180), 'e'.repeat(width - 750), `input-${index}.csv`].join('/');
      await fs.mkdir(path.dirname(path.join(f.project.rootPath, relative)), { recursive: true });
      await fs.writeFile(path.join(f.project.rootPath, relative), 'n\n1\n');
      materials.push({ path: relative });
    }
    let control;
    try { control = await scoped.prepare({ ...f.owner, requestId: randomUUID() }, { report: { path: '060_reports/main.md' }, materials }, f.context); }
    catch (error) {
      assert.equal((error as { code: string }).code, 'report_calculation_material_metadata_too_large');
      continue;
    }
    if (control.prompt.length < 19_800) continue;
    nearLimitChecked = true;
    const withHistory = await scoped.prepare({ ...f.owner, requestId: randomUUID() }, { report: { path: '060_reports/main.md' }, materials }, { ...f.context, historicalFrameworks });
    assert.ok(withHistory.prompt.length <= 20_000);
    assert.match(withHistory.prompt, /历史40项全部未提供；其要求范围未知/);
    const packet = JSON.parse(withHistory.prompt), controlPacket = JSON.parse(control.prompt);
    for (const item of controlPacket.content) {
      const current = packet.content.find((value: { id: string }) => value.id === item.id);
      assert.ok(current.text.startsWith(item.text));
    }
    // Real Host catches may know no history count; a denied current framework
    // is also optional coverage evidence rather than primary calculation input.
    const unavailable = [];
    const contexts = [
      { name: 'unreadable-history', context: { historicalFrameworks: [], frameworkHistoryUnavailable: 'native_context_budget' } },
      { name: 'partially-unreadable-history', context: { historicalFrameworks, frameworkHistoryUnavailable: 'native_context_budget' } },
      { name: 'unavailable-current-framework', context: { historicalFrameworks, providedContext: { rap: { instanceId: 'req-withdrawn-budget', version: '1.0.0', text: 'UNDELIVERED_FRAMEWORK_BODY' } } } },
      { name: 'current-framework-budget', context: { historicalFrameworks, providedContext: { rap: { instanceId: 'req-current-budget', version: '1.0.0', text: 'UNDELIVERED_FRAMEWORK_BODY' } } } },
    ];
    for (const scenario of contexts) {
      let prepared;
      try { prepared = await scoped.prepare({ ...f.owner, requestId: randomUUID() }, { report: { path: '060_reports/main.md' }, materials }, { ...f.context, ...scenario.context }); }
      catch (error) { unavailable.push(`${scenario.name}:${(error as { code: string }).code}`); continue; }
      assert.ok(prepared.prompt.length <= 20_000);
      const unknownPacket = JSON.parse(prepared.prompt);
      assert.match(unknownPacket.limitations.join(' '), scenario.name.includes('history') ? /历史.*不可核对.*未知/ : /本轮框架.*未提供.*未知/);
      assert.doesNotMatch(prepared.prompt, /UNDELIVERED_FRAMEWORK_BODY/);
      assert.doesNotMatch(unknownPacket.limitations.join(' '), /全部已提供/);
      assert.equal(prepared.receipt.materials.filter(item => item.kind === 'framework' && item.state === 'provided').length, 0);
      for (const item of controlPacket.content) {
        const current = unknownPacket.content.find((value: { id: string }) => value.id === item.id);
        assert.ok(current.text.startsWith(item.text));
      }
      const savedPacket = path.join(f.dataRoot, 'report-calculation-review', prepared.receipt.owner.projectId,
        prepared.receipt.owner.taskId, prepared.receipt.owner.requestId, prepared.receipt.reviewId, 'provided.json');
      assert.equal(await fs.readFile(savedPacket, 'utf8'), prepared.prompt);
      assert.deepEqual(JSON.parse(await fs.readFile(savedPacket, 'utf8')).limitations, unknownPacket.limitations);
      await prepared.assertFeedbackCurrent();
    }
    assert.deepEqual(unavailable, []);
    // A primary packet that is itself over budget remains a primary error.
    const overBudgetMaterials = [...materials];
    for (let index = 18; index < 24; index++) {
      const relative = path.posix.dirname(materials[0]!.path) + `/input-${index}.csv`;
      await fs.writeFile(path.join(f.project.rootPath, relative), 'n\n1\n');
      overBudgetMaterials.push({ path: relative });
    }
    for (const context of [f.context, { ...f.context, frameworkHistoryUnavailable: 'native_context_budget' }])
      await assert.rejects(scoped.prepare({ ...f.owner, requestId: randomUUID() }, {
        report: { path: '060_reports/main.md' }, materials: overBudgetMaterials,
      }, context), { code: 'report_calculation_material_metadata_too_large' });
    break;
  }
  assert.equal(nearLimitChecked, true);
});
