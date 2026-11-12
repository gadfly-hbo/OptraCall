import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile, unlink, symlink } from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { createVerificationStore, type CreateVerificationInput } from '../src/host/verification-store.ts';
import { createVerificationSessions } from '../src/host/verification-sessions.ts';
import type { ConclusionReviewMetadata, ConclusionReviewOutput } from '../src/host/conclusion-review-contract.ts';
import { providerMessageText, startToolProvider } from './fixtures/tool-provider.ts';

async function fixture(t: TestContext) {
  const evidence = path.resolve('.local/conclusion-recommendation-review/backend'); await mkdir(evidence, { recursive: true });
  const root = await mkdtemp(path.join(evidence, 'sessions-')), resourceRoot = path.join(root, 'pi'); await mkdir(resourceRoot);
  await writeFile(path.join(resourceRoot, 'settings.json'), JSON.stringify({ retry: { enabled: false } }));
  const provider = await startToolProvider(), store = createVerificationStore({ dataRoot: root });
  const reportText = 'C类在本款中最大。A/B相对大盘更集中。建议立即撤掉A类。';
  const report = { relativePath: '060_reports/report.md', sha256: createHash('sha256').update(reportText).digest('hex'), bytes: Buffer.byteLength(reportText) };
  const review: ConclusionReviewMetadata = { schemaVersion: 1, report, materials: [{ id: 'report', kind: 'report', locator: report.relativePath, sha256: report.sha256, bytes: report.bytes, state: 'provided' }, { id: 'basis', kind: 'file', locator: '020_clean/base.csv', state: 'provided' }], providedText: JSON.stringify({ report, content: [{ id: 'report', text: reportText }, { id: 'basis', text: '本款 C 50%; A 30%; B20%。没有大盘基准。' }] }) };
  review.materials[0].rangeUtf16 = { start: 0, end: reportText.length, total: reportText.length };
  const basisText = '本款 C 50%; A 30%; B20%。没有大盘基准。';
  review.materials[1].rangeUtf16 = { start: 0, end: basisText.length, total: basisText.length + 10 };
  review.materials[1].state = 'truncated';
  review.providedText = JSON.stringify({ schemaVersion: 1, report, materials: review.materials, content: [{ id: 'report', text: reportText }, { id: 'basis', text: basisText }] });
  const model = { id: 'synthetic-review', revision: 1, name: '合成结论审查', provider: 'synthetic', api: 'openai-completions' as const, baseUrl: provider.baseUrl, model: 'synthetic-review', apiKey: 'synthetic-review-key' };
  const selection = { verificationId: randomUUID(), report: { relativePath: report.relativePath, sha256: report.sha256 } };
  const input = { projectId: randomUUID(), taskId: randomUUID(), verificationId: selection.verificationId, mode: 'conclusion-review', question: '审查结论与建议', selection, configuration: model, dataFiles: [], authorFiles: [{ relativePath: report.relativePath, bytes: Buffer.from(reportText) }], review } as CreateVerificationInput;
  let authorized = true, mutations = Promise.resolve<unknown>(undefined), prepared = 0;
  const mutate = <T>(fn: () => T | Promise<T>): Promise<T> => { const next = mutations.then(fn); mutations = next.catch(() => {}); return next; };
  const unavailable = async (): Promise<never> => { throw new Error('legacy path was not authorized'); };
  const feature = createVerificationSessions({ store, codeRoot: process.cwd(), resourceRoot, managementPorts: () => [], configuration: () => model, mutate, isClosing: () => false,
    admit: async () => {}, admitRevision: unavailable, admitRecheck: unavailable, assertInputs: unavailable, stopAuthor: unavailable, prepareRevision: unavailable, projectIds: async () => [input.projectId], prepare: unavailable, revise: unavailable, export: unavailable,
    conclusionReview: { admit: async () => {}, assertAuthorized: async () => { if (!authorized) throw Object.assign(new Error('conclusion_review_authorization_changed'), { code: 'conclusion_review_authorization_changed' }); }, prepare: async () => { prepared++; return input; } },
  });
  const output: ConclusionReviewOutput = { schemaVersion: 1, reportVersion: report.sha256, claims: [{ id: 'claim-1', quote: 'C类在本款中最大。', location: '第1句', reportVersion: report.sha256, verdict: 'supported', evidence: [{ materialId: 'basis', locator: '本款份额' }], evidenceGaps: [], conditions: ['仅本款'], reason: '在本款中C占比最高。', impact: '可支持本款结构描述。' }, { id: 'claim-2', quote: 'A/B相对大盘更集中。', location: '第2句', reportVersion: report.sha256, verdict: 'insufficient', evidence: [], evidenceGaps: ['缺同口径大盘基准。'], conditions: [], reason: '本款占比不能推出相对大盘。', impact: '据此采取经营动作缺乏依据。' }], scope: { reviewed: '三句中的重要结论；未复算数字。', unreviewed: ['撤类行动需补业务前提。'], limitations: ['缺大盘基准。'] } };
  provider.setResponder(() => ({ text: JSON.stringify(output) }));
  t.after(async () => { try { await feature.closeAll(); } finally { await provider.close(); await writeFile(path.join(root, 'requests.json'), JSON.stringify(provider.requests, null, 2)); } });
  const terminal = async () => { const end = Date.now() + 15_000; while (Date.now() < end) { const record = await store.read(input); if (!['preparing','ready','running'].includes(record.state)) return record; await new Promise(resolve => setTimeout(resolve, 20)); } throw new Error('review did not terminate'); };
  return { root, store, provider, feature, input, selection, review, output, terminal, revoke: () => { authorized = false; }, prepared: () => prepared };
}

test('CNR-A2: actual independent-verification review sees only the fixed report and bounded basis with no execution tools', { timeout: 30_000 }, async t => {
  const f = await fixture(t);
  const started = await f.feature.startReview(f.input.projectId, f.input.taskId, f.selection, '"preview"');
  assert.equal(started.created, true);
  const record = await f.terminal(); assert.equal(record.state, 'completed');
  assert.deepEqual(record.reviewResult?.output, f.output); assert.equal(record.phase, 'review');
  assert.equal(record.coldResult, undefined); assert.equal(record.comparisonResult, undefined); assert.equal(record.authorRevision, undefined);
  assert.equal(f.provider.requests.length, 1);
  const request = f.provider.requests[0].body;
  assert.deepEqual(request.tools ?? [], []);
  assert.deepEqual(request.messages?.filter(message => message.role === 'user').map(message => providerMessageText(message.content)), [f.review.providedText]);
  const system = request.messages?.filter(message => ['system','developer'].includes(message.role)).map(message => providerMessageText(message.content)).join('\n') ?? '';
  assert.match(system, /no execution, calculation, file, extension, history/i); assert.match(system, /causality/);
  const before = await readFile(path.join(f.store.recordDirectory(f.input), 'record.json'));
  await f.feature.readReview(f.input); await f.feature.readReview(f.input);
  assert.deepEqual(await readFile(path.join(f.store.recordDirectory(f.input), 'record.json')), before);
  const replay = await f.feature.startReview(f.input.projectId, f.input.taskId, f.selection, '"stale-preview"');
  assert.equal(replay.created, false); assert.equal(f.prepared(), 1); assert.equal(f.provider.requests.length, 1);
  const native = await readFile(record.reviewResult!.sessionFile!, 'utf8'); assert.doesNotMatch(native, /PARENT_PRIVATE_HISTORY/);
  t.diagnostic(f.root);
});

test('CNR-A5: stop revokes only this review and late result cannot revive it or dispatch on read/replay', { timeout: 30_000 }, async t => {
  const f = await fixture(t); f.provider.setResponder(() => ({ text: JSON.stringify(f.output), hold: true }));
  await f.feature.startReview(f.input.projectId, f.input.taskId, f.selection); await f.provider.waitForRequests(1);
  await f.feature.stopReview(f.input); const record = await f.terminal(); assert.equal(record.state, 'cancelled'); assert.equal(record.reviewResult, undefined);
  await f.feature.readReview(f.input); await f.feature.startReview(f.input.projectId, f.input.taskId, f.selection);
  assert.equal(f.provider.requests.length, 1); assert.equal(f.prepared(), 1);
});

test('CNR-A1: revoked authorization blocks result delivery and future historical reads', { timeout: 30_000 }, async t => {
  const f = await fixture(t); f.provider.setResponder(() => { f.revoke(); return { text: JSON.stringify(f.output) }; });
  await f.feature.startReview(f.input.projectId, f.input.taskId, f.selection); const record = await f.terminal();
  assert.notEqual(record.state, 'completed'); assert.equal(record.reviewResult, undefined);
  await assert.rejects(f.feature.readReview(f.input), { code: 'conclusion_review_authorization_changed' });
  assert.equal(f.provider.requests.length, 1);
});

test('CNR-A1: explicit governance revalidation cancels a held review through its existing public domain', { timeout: 30_000 }, async t => {
  const f = await fixture(t); f.provider.setResponder(() => ({ text: JSON.stringify(f.output), hold: true }));
  await f.feature.startReview(f.input.projectId, f.input.taskId, f.selection); await f.provider.waitForRequests(1);
  f.revoke(); await f.feature.revalidateReviews();
  const record = await f.terminal(); assert.equal(record.state, 'cancelled'); assert.equal(record.reviewResult, undefined);
  const settledBy = Date.now() + 5_000;
  while (await f.feature.busy(f.input.projectId) && Date.now() < settledBy) await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(await f.feature.busy(f.input.projectId), false, 'the common domain releases occupancy only after the admitted callback safely finishes');
  await assert.rejects(f.feature.readFixedReviewReport(f.input), { code: 'conclusion_review_authorization_changed' });
  assert.equal(f.provider.requests.length, 1);
});

test('CNR-A5: provider close interrupts the bound review without replaying and original fixed report remains readable', { timeout: 30_000 }, async t => {
  const f = await fixture(t); f.provider.setResponder(() => ({ text: JSON.stringify(f.output), hold: true }));
  await f.feature.startReview(f.input.projectId, f.input.taskId, f.selection); await f.provider.waitForRequests(1);
  await f.feature.closeAll({ provider: 'synthetic' });
  const record = await f.terminal(); assert.ok(['cancelled','interrupted','unknown'].includes(record.state)); assert.equal(record.reviewResult, undefined);
  const before = await readFile(path.join(f.store.recordDirectory(f.input), 'record.json'));
  assert.equal((await f.feature.readFixedReviewReport(f.input)).sha256, f.review.report.sha256);
  await f.feature.startReview(f.input.projectId, f.input.taskId, f.selection);
  assert.deepEqual(await readFile(path.join(f.store.recordDirectory(f.input), 'record.json')), before);
  assert.equal(f.provider.requests.length, 1);
});

test('CNR-A2: structurally invalid report identity is failed, with no Host repair or extra model turn', { timeout: 30_000 }, async t => {
  const f = await fixture(t); f.provider.setResponder(() => ({ text: JSON.stringify({ ...f.output, reportVersion: 'f'.repeat(64) }) }));
  await f.feature.startReview(f.input.projectId, f.input.taskId, f.selection);
  const record = await f.terminal(); assert.equal(record.state, 'failed'); assert.equal(record.error, 'conclusion_review_result_invalid');
  assert.equal(record.reviewResult, undefined); assert.equal(f.provider.requests.length, 1);
  assert.ok(record.native?.sessionFile); assert.match(await readFile(record.native.sessionFile, 'utf8'), /ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff/);
  await assert.rejects(f.feature.startReview(f.input.projectId, f.input.taskId, { ...f.selection, basisFiles: ['020_clean/new.csv'] }), { code: 'verification_selection_conflict' });
  assert.equal(f.provider.requests.length, 1);
});

test('CNR-A2: Host retains all four Agent verdicts without ranking their business truth', { timeout: 30_000 }, async t => {
  const f = await fixture(t);
  const output = { ...f.output, claims: ['supported','conditional','insufficient','conflicting'].map((verdict, index) => ({ ...f.output.claims[0], id: `claim-${index}`, verdict, conditions: index === 1 ? ['条件仍待确认。'] : [] })) };
  f.provider.setResponder(() => ({ text: JSON.stringify(output) }));
  await f.feature.startReview(f.input.projectId, f.input.taskId, f.selection);
  const record = await f.terminal(); assert.equal(record.state, 'completed'); assert.deepEqual(record.reviewResult?.output, output);
  assert.equal(f.provider.requests.length, 1);
});

test('CNR namespace isolation: old public methods cannot expose or act on a new review after source revocation', { timeout: 30_000 }, async t => {
  const f = await fixture(t); await f.feature.startReview(f.input.projectId, f.input.taskId, f.selection); await f.terminal(); f.revoke();
  for (const operation of [
    () => f.feature.read(f.input), () => f.feature.stop(f.input), () => f.feature.revise(f.input),
    () => f.feature.recheck(f.input), () => f.feature.exportReport(f.input),
    () => f.feature.respondUI(f.input, { id: 'old-ui' }),
    () => f.feature.readFixedAuthor(f.input, f.review.report.relativePath),
  ]) await assert.rejects(operation, { code: 'verification_mode_mismatch' });
  assert.deepEqual(await f.feature.list(f.input.projectId, f.input.taskId), []);
  assert.equal(f.provider.requests.length, 1);
});

test('CNR stop: source withdrawal cannot prevent the original owner from cancelling its bound review', { timeout: 30_000 }, async t => {
  const f = await fixture(t); f.provider.setResponder(() => ({ text: JSON.stringify(f.output), hold: true }));
  await f.feature.startReview(f.input.projectId, f.input.taskId, f.selection); await f.provider.waitForRequests(1); f.revoke();
  const stopped = await f.feature.stopReview(f.input);
  assert.equal(stopped.state, 'cancelled'); assert.deepEqual(Object.keys(stopped).sort(), ['mode','projectId','state','taskId','verificationId']);
  assert.equal((await f.terminal()).reviewResult, undefined); assert.equal(f.provider.requests.length, 1);
});

test('CNR admission: a held review owns the task until safe completion and rejects a second new identity', { timeout: 30_000 }, async t => {
  const f = await fixture(t); f.provider.setResponder(() => ({ text: JSON.stringify(f.output), hold: true }));
  await f.feature.startReview(f.input.projectId, f.input.taskId, f.selection); await f.provider.waitForRequests(1);
  const other = { ...f.selection, verificationId: randomUUID() };
  await assert.rejects(f.feature.startReview(f.input.projectId, f.input.taskId, other), { code: 'session_busy' });
  await assert.rejects(f.store.read({ ...f.input, verificationId: other.verificationId }), { code: 'verification_not_found' });
  assert.equal(f.prepared(), 1); assert.equal(f.provider.requests.length, 1);
  assert.equal((await f.feature.startReview(f.input.projectId, f.input.taskId, f.selection)).created, false);
  await f.feature.stopReview(f.input);
});

test('CNR admission: simultaneous new intents reserve one original owner before native opening', { timeout: 30_000 }, async t => {
  const f = await fixture(t); f.provider.setResponder(() => ({ text: JSON.stringify(f.output), hold: true }));
  const results = await Promise.allSettled([
    f.feature.startReview(f.input.projectId, f.input.taskId, f.selection),
    f.feature.startReview(f.input.projectId, f.input.taskId, { ...f.selection, verificationId: randomUUID() }),
  ]);
  assert.equal(results[0].status, 'fulfilled'); assert.equal(results[1].status, 'rejected');
  assert.equal((results[1] as PromiseRejectedResult).reason.code, 'session_busy');
  await f.provider.waitForRequests(1); assert.equal(f.prepared(), 1); assert.equal(f.provider.requests.length, 1);
  await f.feature.stopReview(f.input);
});

test('CNR namespace isolation retains authorized old history and fixed downloads', { timeout: 30_000 }, async t => {
  const f = await fixture(t);
  const legacy = { ...f.input, verificationId: randomUUID(), mode: undefined, review: undefined, dataFiles: [{ relativePath: '020_clean/legacy.csv', bytes: Buffer.from('old input') }] };
  const { record } = await f.store.create(legacy); await f.store.update(record, { state: 'cancelled' });
  assert.equal((await f.feature.read(record)).verificationId, record.verificationId);
  assert.equal((await f.feature.list(record.projectId, record.taskId))[0].verificationId, record.verificationId);
  assert.equal((await f.feature.readFixedAuthor(record, f.review.report.relativePath)).sha256, f.review.report.sha256);
  assert.equal(f.provider.requests.length, 0);
});

for (const mode of ['foreign-quotation', 'unprovided-source'] as const) test(`CNR evidence location: ${mode} cannot be presented as an actually supplied quotation`, { timeout: 30_000 }, async t => {
  const f = await fixture(t);
  const output = structuredClone(f.output);
  if (mode === 'foreign-quotation') output.claims[0].evidence[0].quote = '大盘C类只有10%。未提供范围中的引文。';
  else { f.review.materials[1].state = 'unavailable'; f.review.providedText = JSON.stringify({ report: f.review.report, content: [{ id: 'report', text: f.input.authorFiles[0].bytes.toString() }] }); }
  f.provider.setResponder(() => ({ text: JSON.stringify(output) }));
  await f.feature.startReview(f.input.projectId, f.input.taskId, f.selection);
  const record = await f.terminal(); assert.equal(record.state, 'failed'); assert.equal(record.error, 'conclusion_review_result_invalid'); assert.equal(record.reviewResult, undefined);
  assert.equal(f.provider.requests.length, 1);
});

for (const state of ['ready','failed','unknown'] as const) test(`CNR04 actual delivery: ${state} prepared bytes alone are not an actual request receipt`, { timeout: 30_000 }, async t => {
  const f = await fixture(t); await f.store.create(f.input);
  if (state !== 'ready') await f.store.update(f.input, { state });
  const before = await readFile(path.join(f.store.recordDirectory(f.input), 'record.json'));
  const review = await f.feature.readReview(f.input);
  assert.equal(review.contextEvidence?.prepared.status, 'fixed');
  assert.equal(review.contextEvidence?.provided.status, 'unrecorded');
  assert.deepEqual(review.contextEvidence?.provided.fragments, []);
  assert.equal(review.contextEvidence?.reads.status, 'unproven');
  assert.deepEqual(await readFile(path.join(f.store.recordDirectory(f.input), 'record.json')), before);
  assert.equal(f.provider.requests.length, 0);
});

test('CNR04 actual delivery: completed SDK request yields exact native-bound full and partial fragments without claiming understanding', { timeout: 30_000 }, async t => {
  const f = await fixture(t); await f.feature.startReview(f.input.projectId, f.input.taskId, f.selection); await f.terminal();
  const review = await f.feature.readReview(f.input), provided = review.contextEvidence?.provided;
  assert.equal(provided?.status, 'recorded'); assert.equal(provided?.requestId, f.input.verificationId);
  assert.ok(provided?.sessionId); assert.ok(provided?.messageId);
  assert.equal(provided?.requestTextSha256, createHash('sha256').update(f.review.providedText).digest('hex'));
  const packet = JSON.parse(f.review.providedText);
  assert.deepEqual(provided?.fragments, f.review.materials.map(material => ({ ...material, text: packet.content.find((item: { id: string }) => item.id === material.id).text })));
  assert.equal(provided?.fragments[1].state, 'truncated');
  for (const fragment of provided?.fragments ?? []) assert.equal(fragment.text.length, fragment.rangeUtf16!.end - fragment.rangeUtf16!.start);
  assert.equal(review.contextEvidence?.reads.status, 'unproven');
  assert.equal(f.provider.requests.length, 1);
});

for (const mode of ['missing-native','wrong-request','changed-packet','foreign-header','foreign-pointer','symlink'] as const) test(`CNR04 actual delivery: ${mode} preserves fixed report and reports unknown delivery`, { timeout: 30_000 }, async t => {
  const f = await fixture(t); await f.feature.startReview(f.input.projectId, f.input.taskId, f.selection); const record = await f.terminal();
  const nativeFile = record.reviewResult!.sessionFile!, original = await readFile(nativeFile, 'utf8');
  const entries = original.trim().split('\n').map(line => JSON.parse(line));
  if (mode === 'missing-native') await unlink(nativeFile);
  else if (mode === 'foreign-pointer') {
    const outside = path.join(f.root, 'foreign-private-native.jsonl'); await writeFile(outside, 'PRIVATE_FOREIGN_BODY\n');
    const target = path.join(f.store.recordDirectory(f.input), 'record.json'), value = JSON.parse(await readFile(target, 'utf8'));
    value.native.sessionFile = outside; value.reviewResult.sessionFile = outside; await writeFile(target, JSON.stringify(value));
  }
  else if (mode === 'symlink') { const outside = path.join(f.root, 'foreign-private-native.jsonl'); await writeFile(outside, 'PRIVATE_FOREIGN_BODY\n'); await unlink(nativeFile); await symlink(outside, nativeFile); }
  else {
    if (mode === 'wrong-request') for (const entry of entries) if (entry.customType === 'optracall.run') entry.data.requestId = 'another-request';
    if (mode === 'foreign-header') entries[0].cwd = '/foreign/private/workspace';
    if (mode === 'changed-packet') {
      for (const entry of entries) if (entry.message?.role === 'user') { entry.message.content = [{ type: 'text', text: 'PRIVATE_TAMPERED_PACKET' }]; }
      for (const entry of entries) if (entry.customType === 'optracall.run' && entry.data.phase === 'started') entry.data.providedContext.requestTextSha256 = createHash('sha256').update('PRIVATE_TAMPERED_PACKET').digest('hex');
    }
    await writeFile(nativeFile, entries.map(entry => JSON.stringify(entry)).join('\n') + '\n');
  }
  const review = await f.feature.readReview(f.input);
  assert.notEqual(review.contextEvidence?.provided.status, 'recorded'); assert.deepEqual(review.contextEvidence?.provided.fragments, []);
  assert.doesNotMatch(JSON.stringify(review.contextEvidence), /PRIVATE_FOREIGN_BODY|PRIVATE_TAMPERED_PACKET/);
  assert.equal((await f.feature.readFixedReviewReport(f.input)).sha256, f.review.report.sha256);
  assert.equal(f.provider.requests.length, 1);
  await writeFile(nativeFile + '.original-preserved', original);
});
