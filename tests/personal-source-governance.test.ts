import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { ProjectStore } from '../src/host/project-store.ts';
import { EnterpriseMaterialsStore, enterpriseDraftSha256 } from '../src/host/enterprise-materials-store.ts';
import { PersonalRetentionStore } from '../src/host/personal-retention-store.ts';
import { AgentCandidateControls, type ExactCandidateRef } from '../src/host/agent-candidate-controls.ts';
import { createPersonalContextReader } from '../src/host/personal-context-reader.ts';
import { createNativeSnapshotReadBudget } from '../src/host/native-session-snapshot.ts';
import type { LearningSourceRef } from '../src/host/learning-source-types.ts';
import type { PersonalContextTarget } from '../src/host/personal-context-types.ts';

// These callbacks are the external source boundary. After retention they become
// unavailable: reminders must use governance, never fetch source bodies again.
async function fixture(t: TestContext) {
  const evidence = path.resolve('.local/memory-source-governance/reader');
  await fs.mkdir(evidence, { recursive: true });
  const root = await fs.mkdtemp(path.join(evidence, 'root-'));
  const projects = new ProjectStore({ dataRoot: path.join(root, 'data'), projectsRoot: path.join(root, 'projects') });
  await projects.init(); t.after(() => projects.close());
  const materials = new EnterpriseMaterialsStore(projects.dataRoot);
  let available = true, sourceReads = 0;
  const retention = new PersonalRetentionStore({ dataRoot: projects.dataRoot, materials, readSource: async ref => {
    sourceReads++; if (!available) throw new Error('SOURCE_BODY_MUST_NOT_BE_READ');
    return { ref, title: 'SOURCE_TITLE_CANARY', text: 'SOURCE_BODY_CANARY'.repeat(512), sha256: 'a'.repeat(64), status: 'available' };
  } });
  const controls = new AgentCandidateControls({ dataRoot: projects.dataRoot, readTarget: async () => {
    if (!available) throw new Error('NATIVE_MUST_NOT_BE_READ');
  } });
  const reader = createPersonalContextReader({ projects, retention, controls });
  const ref = (n = 0): ExactCandidateRef => ({ projectId: 'synthetic-project', taskId: 'synthetic-task', originSessionId: 'synthetic-session', entryId: `entry-${n}`, toolCallId: `call-${n}`, expectedDetailsSha256: createHash('sha256').update(String(n)).digest('hex') });
  async function retain(sourceRefs: LearningSourceRef[], body = 'INDEPENDENT_HUMAN_EXPERIENCE', kind: 'experience' | 'knowledge' = 'experience', caution: string | null = null) {
    const created = await materials.create({ title: '人工经验', body }), operationId = randomUUID();
    const saved = await retention.retain(created.material.id, { operationId, expectedRevision: 0, target: { type: 'draft', expectedMaterialVersion: created.material.version, expectedDraftSha256: enterpriseDraftSha256(created.material.draft) }, metadata: { kind, aliases: [], caution, sourceRefs }, personalLabel: null });
    const target: PersonalContextTarget = { type: 'retained', storeId: created.storeId, materialId: created.material.id, decisionId: operationId, revisionId: saved.decision!.contentRef!.revisionId, expectedBodySha256: saved.decision!.bodySha256! };
    return { target, saved, body };
  }
  return { root, projects, materials, retention, controls, reader, ref, retain, unavailable() { available = false; sourceReads = 0; }, sourceReads: () => sourceReads };
}

test('R3-02/03: exact experience includes its current direct-source correction without reading source content or changing its own governance', async t => {
  const f = await fixture(t), ref = f.ref(), retained = await f.retain([{ type: 'agent-candidate', candidate: ref }]);
  const note = await f.controls.apply({ operationId: randomUUID(), target: ref, action: 'correct', note: '仅适用于试点门店' });
  const before = await f.retention.readItem(retained.target.materialId, retained.target.decisionId);
  f.unavailable(); const budget = createNativeSnapshotReadBudget(); budget.files = 0; budget.bytes = 0;
  const result = await f.reader.read({ target: retained.target }, { budget });
  assert.match(result.text, /INDEPENDENT_HUMAN_EXPERIENCE/);
  assert.match(result.text, /来源治理提醒/);
  assert.match(result.text, /仅适用于试点门店/);
  assert.doesNotMatch(JSON.stringify(result), /SOURCE_BODY_CANARY|SOURCE_TITLE_CANARY/);
  assert.equal(f.sourceReads(), 0);
  assert.equal(result.details.items[0]?.governance.latestCorrectionOperationId, null);
  assert.deepEqual(await f.retention.readItem(retained.target.materialId, retained.target.decisionId), before);
  assert.ok(JSON.stringify(result.details).includes(note.event.operationId));
});

test('R3-02: exclusion hides source notes and restore changes only the reminder', async t => {
  const f = await fixture(t), ref = f.ref(), retained = await f.retain([{ type: 'agent-candidate', candidate: ref }]);
  const correction = await f.controls.apply({ operationId: randomUUID(), target: ref, action: 'correct', note: 'EXCLUDED_NOTE_CANARY' });
  await f.controls.apply({ operationId: randomUUID(), target: ref, action: 'exclude', note: null, expectedTargetRevision: 1 });
  const before = await f.retention.readItem(retained.target.materialId), excluded = await f.reader.read({ target: retained.target });
  assert.match(excluded.text, /INDEPENDENT_HUMAN_EXPERIENCE/);
  assert.match(excluded.text, /已排除/);
  assert.ok(excluded.text.includes(correction.event.operationId), 'the model can identify the correction even when its free text is excluded');
  assert.doesNotMatch(JSON.stringify(excluded), /EXCLUDED_NOTE_CANARY|SOURCE_BODY_CANARY|SOURCE_TITLE_CANARY/);
  assert.equal(excluded.details.items[0]?.sourceGovernance?.items[0]?.excluded, true);
  assert.equal(excluded.details.items[0]?.sourceGovernance?.items[0]?.correction, null);
  assert.equal(excluded.details.items[0]?.governance.archived, false);
  await f.controls.apply({ operationId: randomUUID(), target: ref, action: 'restore', note: null, expectedTargetRevision: 2 });
  const restored = await f.reader.read({ target: retained.target });
  assert.match(restored.text, /EXCLUDED_NOTE_CANARY/);
  assert.deepEqual(restored.details.items[0]?.governance, excluded.details.items[0]?.governance);
  assert.deepEqual(await f.retention.readItem(retained.target.materialId), before);
});

test('R3-03: absent controls, corrupt ledger and a conflicting exact hash remain distinct from source-body availability', async t => {
  const f = await fixture(t), ref = f.ref(), retained = await f.retain([{ type: 'agent-candidate', candidate: ref }]);
  const absent = await f.reader.read({ target: retained.target });
  assert.equal(absent.details.items[0]?.sourceGovernance?.items[0]?.state, 'no-controls');
  assert.equal(absent.details.items[0]?.sourceGovernance?.items[0]?.excluded, null);
  assert.match(absent.text, /无控制记录不证明来源存在或可靠/);
  await f.controls.apply({ operationId: randomUUID(), target: ref, action: 'correct', note: 'REAL_KNOWN_NOTE' });
  const conflict = await f.retain([{ type: 'agent-candidate', candidate: { ...ref, expectedDetailsSha256: 'f'.repeat(64) } }]);
  const wrong = await f.reader.read({ target: conflict.target });
  assert.equal(wrong.details.items[0]?.sourceGovernance?.items[0]?.state, 'unknown');
  assert.match(wrong.text, /准确引用冲突/);
  assert.doesNotMatch(wrong.text, /REAL_KNOWN_NOTE/);
  f.unavailable();
  const missingNative = await f.reader.read({ target: retained.target });
  assert.match(missingNative.text, /REAL_KNOWN_NOTE/);
  assert.equal(missingNative.details.items[0]?.sourceGovernance?.sourceBodyAvailability, 'not-checked');
  await fs.writeFile(path.join(f.projects.dataRoot, 'personal-agent-controls', 'records.json'), '{broken}');
  const corrupt = await f.reader.read({ target: retained.target });
  assert.match(corrupt.text, /INDEPENDENT_HUMAN_EXPERIENCE/);
  assert.equal(corrupt.details.items[0]?.sourceGovernance?.items[0]?.state, 'unknown');
  assert.match(corrupt.text, /治理账不可用/);
  assert.doesNotMatch(corrupt.text, /REAL_KNOWN_NOTE/);
  assert.equal(f.sourceReads(), 0);
});

test('R3-04: zero, eight and nine distinct refs, duplicates and large reference lists remain bounded', async t => {
  const f = await fixture(t);
  const empty = await f.retain([]);
  assert.equal((await f.reader.read({ target: empty.target })).details.items[0]?.sourceGovernance, undefined);
  for (const count of [8, 9]) {
    const retained = await f.retain(Array.from({ length: count }, (_, n) => ({ type: 'agent-candidate', candidate: f.ref(n) })));
    const result = await f.reader.read({ target: retained.target }), summary = result.details.items[0]!.sourceGovernance!;
    assert.equal(summary.items.length, 8); assert.equal(summary.inspectedReferences, 8);
    assert.equal(summary.uncheckedReferences, count === 8 ? 0 : 1);
    assert.match(result.text, count === 8 ? /未查0=UNKNOWN/ : /未查1=UNKNOWN/);
  }
  const repeated = await f.retain(Array.from({ length: 512 }, (_, n) => ({ type: 'agent-candidate', candidate: f.ref(n % 9), excerpt: { start: n, end: n + 1 } })));
  const result = await f.reader.read({ target: repeated.target }), summary = result.details.items[0]!.sourceGovernance!;
  assert.equal(summary.totalReferences, 512); assert.equal(summary.inspectedReferences, 456); assert.equal(summary.uncheckedReferences, 56);
  assert.equal(summary.items.length, 8);
  assert.ok(result.text.length <= 32_768); assert.ok(Buffer.byteLength(JSON.stringify(result)) <= 256 * 1024);
});

test('R3-04: eight selected experiences share a budget while all keep essential statuses and body ranges', async t => {
  const f = await fixture(t), refs = Array.from({ length: 9 }, (_, n) => f.ref(n));
  for (const ref of refs) {
    await f.controls.apply({ operationId: randomUUID(), target: ref, action: 'correct', note: '😀'.repeat(1999) + '尾' });
    await f.controls.apply({ operationId: randomUUID(), target: ref, action: 'exclude', note: null, expectedTargetRevision: 1 });
  }
  const entries = [];
  for (let i = 0; i < 8; i++) entries.push(await f.retain(refs.map(candidate => ({ type: 'agent-candidate', candidate })), `EXPERIENCE_${i}`));
  f.unavailable();
  const selected = await f.reader.prepare(entries.map(entry => ({ target: entry.target })));
  let reminderSize = 0;
  for (const [index, section] of selected.text.split('\n\n有来源的历史参考：').entries()) {
    assert.match(section, new RegExp(`EXPERIENCE_${index}`));
    const reminder = section.slice(section.indexOf('\n\n来源治理提醒：')); reminderSize += reminder.length;
    assert.match(reminder, /已排除/); assert.match(reminder, /未查1=UNKNOWN/);
    assert.doesNotMatch(reminder, /😀|文字.*😀/);
    const item = selected.details.items[index]!;
    assert.equal(item.sourceGovernance?.items.length, 8);
    assert.deepEqual(item.range, { start: 0, end: 12 });
  }
  assert.ok(reminderSize <= 4096);
  assert.equal(f.sourceReads(), 0);
});

test('R3-04/05: bounded note fragments and exact body continuations preserve UTF16 and respond only to related changes', async t => {
  const f = await fixture(t), ref = f.ref(), retained = await f.retain([{ type: 'agent-candidate', candidate: ref }], '甲'.repeat(32_500) + '😀' + '乙'.repeat(5000));
  await f.controls.apply({ operationId: randomUUID(), target: ref, action: 'correct', note: '😀'.repeat(1999) + '尾' });
  const short = await f.reader.read({ target: retained.target, range: { start: 32_500, end: 32_502 } });
  assert.match(short.text, /😀/);
  const note = short.details.items[0]!.sourceGovernance!.items[0]!;
  assert.ok(note.correction?.length); assert.equal(note.correctionTruncated, true);
  assert.doesNotMatch(note.correction!, /[\uD800-\uDBFF]$/);
  const first = await f.reader.read({ target: retained.target });
  assert.ok(first.details.continuation); assert.ok(first.text.length <= 32_768);
  await f.controls.apply({ operationId: randomUUID(), target: f.ref(99), action: 'correct', note: '无关来源的变动' });
  const second = await f.reader.read({ target: retained.target, continuation: first.details.continuation });
  assert.equal(second.details.items[0]?.range?.start, first.details.items[0]?.range?.end);
  assert.equal(second.details.continuation, null);
  assert.equal(retained.body.slice(0, first.details.items[0]!.range!.end) + retained.body.slice(second.details.items[0]!.range!.start), retained.body);
  await f.controls.apply({ operationId: randomUUID(), target: ref, action: 'correct', note: '相关来源已改变' });
  await assert.rejects(f.reader.read({ target: retained.target, continuation: first.details.continuation }), { code: 'personal_context_continuation_changed' });
});

test('R3-06: knowledge, catalog and corrections do not gain source reminders; archive policy and cancellation stay separate', async t => {
  const f = await fixture(t), ref = f.ref(), refs: LearningSourceRef[] = [{ type: 'agent-candidate', candidate: ref }];
  const knowledge = await f.retain(refs, 'KNOWLEDGE_BODY', 'knowledge'), experience = await f.retain(refs);
  await f.controls.apply({ operationId: randomUUID(), target: ref, action: 'correct', note: 'SOURCE_NOTE' });
  assert.equal((await f.reader.read({ target: knowledge.target })).details.items[0]?.sourceGovernance, undefined);
  assert.equal((await f.reader.read({ target: experience.target, part: 'corrections' })).details.items[0]?.sourceGovernance, undefined);
  assert.doesNotMatch((await f.reader.find({}, { retainedOnly: true })).text, /SOURCE_NOTE|来源治理提醒/);
  await f.retention.archive(experience.target.materialId, { operationId: randomUUID(), expectedRevision: experience.saved.item.revision, personalLabel: null });
  assert.match((await f.reader.read({ target: experience.target })).text, /SOURCE_NOTE/);
  await assert.rejects(f.reader.read({ target: experience.target }, { retainedOnly: true }), { code: 'personal_context_excluded' });
  const controller = new AbortController(); controller.abort();
  await assert.rejects(f.reader.read({ target: knowledge.target }, { signal: controller.signal }), { code: 'personal_context_cancelled' });
});

test('R3-04: allowed long notes share 4096 units across prepare, and full fixed bodies never silently lose bytes', async t => {
  const f = await fixture(t), refs = Array.from({ length: 8 }, (_, n) => f.ref(n));
  for (const ref of refs) await f.controls.apply({ operationId: randomUUID(), target: ref, action: 'correct', note: '😀'.repeat(1999) });
  const entries = [];
  for (let n = 0; n < 8; n++) entries.push(await f.retain(refs.map(candidate => ({ type: 'agent-candidate', candidate })), `BODY_${n}`));
  const selected = await f.reader.prepare(entries.map(entry => ({ target: entry.target })));
  const reminders = selected.text.split('\n\n有来源的历史参考：').map(section => section.slice(section.indexOf('\n\n来源治理提醒：')));
  assert.ok(reminders.reduce((sum, text) => sum + text.length, 0) <= 4096);
  for (const [n, item] of selected.details.items.entries()) {
    assert.equal(item.sourceGovernance?.items.length, 8);
    assert.match(reminders[n]!, /纠正[: ]/);
    for (const row of item.sourceGovernance!.items) assert.ok(reminders[n]!.includes(row.latestCorrectionOperationId!));
    assert.deepEqual(item.range, { start: 0, end: 6 });
    for (const row of item.sourceGovernance!.items) if (row.correction) assert.doesNotMatch(row.correction, /[\uD800-\uDBFF]$/);
  }
  const compactable = await f.retain([{ type: 'agent-candidate', candidate: refs[0]! }], '甲'.repeat(31_900));
  const compact = await f.reader.prepare([{ target: compactable.target }]);
  assert.deepEqual(compact.details.items[0]?.range, { start: 0, end: 31_900 });
  assert.equal(compact.details.items[0]?.sourceGovernance?.items[0]?.correction, null);
  assert.match(compact.text, /纠正:[a-f0-9-]{36}/);
  assert.match(compact.text, /注记未列文字即未提供/);
  const full = await f.retain([{ type: 'agent-candidate', candidate: refs[0]! }], '甲'.repeat(32_600));
  const oldContract = await f.retain([], full.body, 'knowledge');
  assert.equal((await f.reader.prepare([{ target: oldContract.target }])).details.items[0]?.extent, 'full');
  const before = await f.retention.readItem(full.target.materialId);
  await assert.rejects(f.reader.prepare([{ target: full.target }]), error => {
    assert.equal((error as { code: string }).code, 'personal_context_selection_unavailable');
    assert.equal((error as { unavailableTargets: { code: string }[] }).unavailableTargets[0]?.code, 'personal_context_selection_too_large'); return true;
  });
  assert.deepEqual(await f.retention.readItem(full.target.materialId), before);
  const fragmented = await f.reader.read({ target: full.target });
  assert.ok(fragmented.details.continuation); assert.ok(fragmented.text.length <= 32_768);
});

test('R3-04: long exact reference identities are not copied into reminders', async t => {
  const f = await fixture(t), ref = { ...f.ref(), projectId: 'p'.repeat(1024), taskId: 't'.repeat(1024), originSessionId: 's'.repeat(1024), entryId: 'e'.repeat(1024), toolCallId: 'c'.repeat(1024) };
  const retained = await f.retain([{ type: 'agent-candidate', candidate: ref }]);
  const result = await f.reader.read({ target: retained.target });
  assert.match(result.text, /\[0\]无控制记录/);
  assert.doesNotMatch(JSON.stringify(result), /p{1024}|e{1024}/);
  assert.ok(result.text.slice(result.text.indexOf('\n\n来源治理提醒：')).length <= 4096);
});

test('R3-03: mixed source kinds preserve the original index and label the inspected candidate subset', async t => {
  const f = await fixture(t), retained = await f.retain([
    { type: 'native-reply', projectId: randomUUID(), taskId: randomUUID(), sessionId: 'native-session', messageId: 'native-message', expectedTextSha256: 'c'.repeat(64) },
    { type: 'agent-candidate', candidate: f.ref() },
  ]);
  f.unavailable();
  const result = await f.reader.read({ target: retained.target });
  assert.match(result.text, /已查1\/1条候选引用/);
  assert.match(result.text, /\[1\]无控制记录/);
  assert.equal(result.details.items[0]?.sourceGovernance?.totalReferences, 1);
  assert.equal(result.details.items[0]?.sourceGovernance?.items[0]?.sourceIndex, 1);
  assert.equal(f.sourceReads(), 0);
});

test('R3-04: fixed selections enforce the byte cap independently of the character cap and preserve inputs', async t => {
  const f = await fixture(t), ref = f.ref(), entries = [];
  for (let n = 0; n < 8; n++) entries.push(await f.retain([{ type: 'agent-candidate', candidate: ref }], '\u0001'.repeat(2700), 'experience', '\u0001'.repeat(2000)));
  const individual = await Promise.all(entries.map(entry => f.reader.read({ target: entry.target })));
  const combinedText = individual.map(result => result.text).join('\n\n');
  assert.ok(combinedText.length < 32_768, 'fixture must reach the byte boundary before the text boundary');
  assert.ok(Buffer.byteLength(JSON.stringify({ text: combinedText, details: { ...individual[0]!.details, items: individual.flatMap(result => result.details.items) } })) > 256 * 1024);
  const before = await f.retention.getRecords();
  await assert.rejects(f.reader.prepare(entries.map(entry => ({ target: entry.target }))), error => {
    assert.equal((error as { code: string }).code, 'personal_context_selection_unavailable');
    assert.ok((error as { unavailableTargets: { code: string }[] }).unavailableTargets.some(target => target.code === 'personal_context_selection_too_large')); return true;
  });
  assert.deepEqual(await f.retention.getRecords(), before);
});
