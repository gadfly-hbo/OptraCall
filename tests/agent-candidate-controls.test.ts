import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { AgentCandidateControls, CandidateControlError, type ExactCandidateRef } from '../src/host/agent-candidate-controls.ts';

const target = (): ExactCandidateRef => ({ projectId: randomUUID(), taskId: randomUUID(), originSessionId: randomUUID(), entryId: 'a1b2c3d4', toolCallId: 'tool-1', expectedDetailsSha256: '1'.repeat(64) });

test('an explicit bookmark verifies the exact native target and survives reopening without a body copy', async t => {
  const dataRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'optracall-agent-controls-'));
  t.after(() => fs.rm(dataRoot, { recursive: true, force: true }));
  const ref = target(), reads: ExactCandidateRef[] = [], operationId = randomUUID();
  const controls = new AgentCandidateControls({ dataRoot, readTarget: async value => { reads.push(value); } });
  assert.equal(await controls.getRecords(), null);
  assert.deepEqual(await fs.readdir(dataRoot), [], 'GET must not initialize storage');
  const receipt = await controls.apply({ operationId, target: ref, action: 'bookmark', note: null, expectedTargetRevision: 0 });
  assert.deepEqual(reads, [ref]);
  assert.equal(receipt.state.bookmarked, true);
  assert.equal(receipt.state.targetRevision, 1);
  const reopened = new AgentCandidateControls({ dataRoot, readTarget: async () => { throw new Error('not used for reading controls'); } });
  assert.deepEqual(await reopened.readState(ref), receipt.state);
  const records = await reopened.getRecords();
  assert.equal(records?.events.length, 1);
  assert.deepEqual(Object.keys(records!.events[0]!).sort(), ['action', 'createdAt', 'note', 'operationId', 'target', 'targetRevision']);
  assert.equal(await fs.readFile(path.join(dataRoot, 'personal-agent-controls/records.json'), 'utf8').then(text => text.includes('bodyMd')), false);
});

test('an old ACK replay returns its original event before native checks and preserves the latest state', async t => {
  const dataRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'optracall-agent-controls-'));
  t.after(() => fs.rm(dataRoot, { recursive: true, force: true }));
  let readable = true, reads = 0;
  const controls = new AgentCandidateControls({ dataRoot, readTarget: async () => { reads++; if (!readable) throw new Error('native unavailable'); } });
  const ref = target(), input = { operationId: randomUUID(), target: ref, action: 'bookmark' as const, note: null, expectedTargetRevision: 0 };
  const first = await controls.apply(input);
  await controls.apply({ operationId: randomUUID(), target: ref, action: 'unbookmark', note: null, expectedTargetRevision: 1 });
  readable = false;
  const count = reads, replay = await controls.apply(input);
  assert.equal(reads, count, 'successful old intents require no native reread');
  assert.deepEqual(replay.event, first.event);
  assert.equal(replay.replayed, true);
  assert.equal(replay.state.targetRevision, 2);
  assert.equal(replay.state.bookmarked, false, 'old receipt must not roll back current state');
  assert.deepEqual((await controls.operation(input.operationId))?.event, first.event);
  await assert.rejects(controls.apply({ ...input, expectedTargetRevision: 1 }), { code: 'candidate_control_operation_conflict', status: 409 });
  await assert.rejects(controls.apply({ ...input, target: target() }), { code: 'candidate_control_operation_conflict', status: 409 });
});

test('exact known targets can be unbookmarked, excluded and restored while unreadable, but new bookmarks and notes cannot', async t => {
  const dataRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'optracall-agent-controls-'));
  t.after(() => fs.rm(dataRoot, { recursive: true, force: true }));
  let readable = true;
  const controls = new AgentCandidateControls({ dataRoot, readTarget: async () => { if (!readable) throw new Error('native unavailable'); } }), ref = target();
  await controls.apply({ operationId: randomUUID(), target: ref, action: 'bookmark', note: null, expectedTargetRevision: 0 });
  await controls.apply({ operationId: randomUUID(), target: ref, action: 'correct', note: '仅适用于合成资料' });
  readable = false;
  let current = (await controls.apply({ operationId: randomUUID(), target: ref, action: 'unbookmark', note: null, expectedTargetRevision: 2 })).state;
  current = (await controls.apply({ operationId: randomUUID(), target: ref, action: 'exclude', note: null, expectedTargetRevision: current.targetRevision })).state;
  assert.equal(current.excluded, true);
  current = (await controls.apply({ operationId: randomUUID(), target: ref, action: 'restore', note: null, expectedTargetRevision: current.targetRevision })).state;
  assert.equal(current.excluded, false);
  assert.equal(current.bookmarked, false);
  assert.equal(current.notes[0]?.note, '仅适用于合成资料');
  await assert.rejects(controls.apply({ operationId: randomUUID(), target: ref, action: 'bookmark', note: null, expectedTargetRevision: current.targetRevision }), /native unavailable/);
  await assert.rejects(controls.apply({ operationId: randomUUID(), target: ref, action: 'correct', note: '不能使用缓存' }), /native unavailable/);
  await assert.rejects(controls.apply({ operationId: randomUUID(), target: target(), action: 'exclude', note: null, expectedTargetRevision: 0 }), /native unavailable/);
  await assert.rejects(controls.apply({ operationId: randomUUID(), target: { ...ref, expectedDetailsSha256: '2'.repeat(64) }, action: 'restore', note: null, expectedTargetRevision: current.targetRevision }), { code: 'candidate_control_target_changed', status: 409 });
});

test('concurrent notes append independently, target set conflicts are explicit, and unrelated targets do not conflict', async t => {
  const dataRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'optracall-agent-controls-'));
  t.after(() => fs.rm(dataRoot, { recursive: true, force: true }));
  const controls = new AgentCandidateControls({ dataRoot, readTarget: async () => {} }), other = new AgentCandidateControls({ dataRoot, readTarget: async () => {} }), ref = target(), second = target();
  const [left, right, independent] = await Promise.all([
    controls.apply({ operationId: randomUUID(), target: ref, action: 'correct', note: '第一位的独立意见' }),
    other.apply({ operationId: randomUUID(), target: ref, action: 'correct', note: '第二位的独立意见' }),
    other.apply({ operationId: randomUUID(), target: second, action: 'bookmark', note: null, expectedTargetRevision: 0 }),
  ]);
  assert.deepEqual([left.event.targetRevision, right.event.targetRevision].sort(), [1, 2]);
  assert.equal(independent.state.targetRevision, 1);
  const state = await controls.readState(ref);
  assert.equal(state.notes.length, 2);
  assert.equal(state.notes[0]?.targetRevision, 2);
  await assert.rejects(controls.apply({ operationId: randomUUID(), target: ref, action: 'exclude', note: null, expectedTargetRevision: 1 }), error => error instanceof CandidateControlError && error.code === 'candidate_control_revision_conflict' && error.currentState?.targetRevision === 2);
  const set = await controls.apply({ operationId: randomUUID(), target: ref, action: 'exclude', note: null, expectedTargetRevision: 2 });
  assert.equal(set.state.excluded, true);
  assert.equal((await other.readState(second)).bookmarked, true);
});

test('unknown first targets and invalid requests leave an untouched root unchanged', async t => {
  const dataRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'optracall-agent-controls-'));
  t.after(() => fs.rm(dataRoot, { recursive: true, force: true }));
  let reads = 0;
  const controls = new AgentCandidateControls({ dataRoot, readTarget: async () => { reads++; throw new Error('exact source not readable'); } }), ref = target();
  await assert.rejects(controls.apply({ operationId: randomUUID(), target: ref, action: 'restore', note: null, expectedTargetRevision: 0 }), /exact source not readable/);
  assert.deepEqual(await fs.readdir(dataRoot), []);
  const valid = { operationId: randomUUID(), target: ref, action: 'bookmark', note: null, expectedTargetRevision: 0 };
  for (const invalid of [
    { ...valid, actor: 'human' },
    { ...valid, action: 'correct', note: '意见', expectedTargetRevision: 0 },
    { ...valid, action: 'correct', note: 'a'.repeat(4001) },
    { ...valid, expectedTargetRevision: -1 },
    { ...valid, target: { ...ref, bodyMd: 'must never persist' } },
    { ...valid, target: { ...ref, expectedDetailsSha256: 'latest' } },
    { ...valid, note: 'not allowed on bookmark' },
  ]) await assert.rejects(controls.apply(invalid as never), error => error instanceof CandidateControlError && error.status === 400);
  assert.equal(reads, 1);
  assert.deepEqual(await fs.readdir(dataRoot), []);
});

test('missing or invalid existing governance records are never rebuilt as an empty log', async t => {
  const dataRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'optracall-agent-controls-'));
  t.after(() => fs.rm(dataRoot, { recursive: true, force: true }));
  const controls = new AgentCandidateControls({ dataRoot, readTarget: async () => {} }), ref = target();
  await controls.apply({ operationId: randomUUID(), target: ref, action: 'bookmark', note: null, expectedTargetRevision: 0 });
  const file = path.join(dataRoot, 'personal-agent-controls/records.json'), valid = (await controls.getRecords())!;
  await fs.unlink(file);
  await assert.rejects(controls.getRecords(), { code: 'candidate_controls_records_missing', status: 503 });
  await assert.rejects(controls.apply({ operationId: randomUUID(), target: ref, action: 'bookmark', note: null, expectedTargetRevision: 0 }), { code: 'candidate_controls_records_missing', status: 503 });
  await assert.rejects(fs.access(file));
  const changedHash = { ...valid.events[0]!, operationId: randomUUID(), targetRevision: 2, target: { ...ref, expectedDetailsSha256: '2'.repeat(64) } };
  const invalid = [
    '{',
    JSON.stringify({ ...valid, schemaVersion: 7 }),
    JSON.stringify({ ...valid, unknown: true }),
    JSON.stringify({ ...valid, events: [...valid.events, valid.events[0]] }),
    JSON.stringify({ ...valid, events: [{ ...valid.events[0], targetRevision: 2 }] }),
    JSON.stringify({ ...valid, events: [...valid.events, changedHash] }),
    JSON.stringify({ ...valid, events: [{ ...valid.events[0], createdAt: '2026-02-31T00:00:00.000Z' }] }),
    JSON.stringify({ ...valid, events: [{ ...valid.events[0], note: 'invalid for bookmark' }] }),
  ];
  for (const bytes of invalid) {
    await fs.writeFile(file, bytes);
    await assert.rejects(controls.getRecords(), error => error instanceof CandidateControlError && error.status === 503);
    await assert.rejects(controls.apply({ operationId: randomUUID(), target: target(), action: 'correct', note: 'must not rewrite' }));
    assert.equal(await fs.readFile(file, 'utf8'), bytes);
  }
});

test('the 2 MiB UTF-8 budget refuses one new event and preserves all existing readable notes', async t => {
  const dataRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'optracall-agent-controls-'));
  t.after(() => fs.rm(dataRoot, { recursive: true, force: true }));
  const controls = new AgentCandidateControls({ dataRoot, readTarget: async () => {} }), ref = target();
  await controls.apply({ operationId: randomUUID(), target: ref, action: 'bookmark', note: null, expectedTargetRevision: 0 });
  const records = (await controls.getRecords())!, file = path.join(dataRoot, 'personal-agent-controls/records.json');
  for (;;) {
    const event = { operationId: randomUUID(), target: ref, action: 'correct' as const, note: '补'.repeat(4000), createdAt: new Date().toISOString(), targetRevision: records.events.length + 1 };
    const next = { ...records, events: [...records.events, event] };
    if (Buffer.byteLength(JSON.stringify(next) + '\n') > 2 * 1024 * 1024) break;
    records.events.push(event);
  }
  const bytes = JSON.stringify(records) + '\n';
  await fs.writeFile(file, bytes);
  const before = await controls.readState(ref);
  await assert.rejects(controls.apply({ operationId: randomUUID(), target: ref, action: 'correct', note: '补'.repeat(4000) }), { code: 'candidate_controls_capacity_exceeded', status: 413 });
  assert.equal(await fs.readFile(file, 'utf8'), bytes);
  assert.deepEqual(await controls.readState(ref), before);
});

test('file and parent links are refused without following them, and an external writer lock fails explicitly', async t => {
  const dataRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'optracall-agent-controls-'));
  t.after(() => fs.rm(dataRoot, { recursive: true, force: true }));
  const controls = new AgentCandidateControls({ dataRoot, readTarget: async () => {} }), ref = target();
  await controls.apply({ operationId: randomUUID(), target: ref, action: 'bookmark', note: null, expectedTargetRevision: 0 });
  const root = path.join(dataRoot, 'personal-agent-controls'), file = path.join(root, 'records.json'), bytes = await fs.readFile(file);
  await fs.mkdir(path.join(root, '.write-lock'));
  await assert.rejects(controls.apply({ operationId: randomUUID(), target: ref, action: 'unbookmark', note: null, expectedTargetRevision: 1 }), { code: 'candidate_controls_busy', status: 409 });
  assert.deepEqual(await fs.readFile(file), bytes);
  await fs.rmdir(path.join(root, '.write-lock'));
  const original = path.join(dataRoot, 'original-records.json');
  await fs.rename(file, original);
  await fs.symlink(original, file);
  await assert.rejects(controls.getRecords(), error => error instanceof CandidateControlError && error.status === 503);
  await assert.rejects(controls.apply({ operationId: randomUUID(), target: ref, action: 'restore', note: null, expectedTargetRevision: 1 }));
  assert.deepEqual(await fs.readFile(original), bytes);
  await fs.unlink(file);
  await fs.link(original, file);
  await assert.rejects(controls.getRecords(), error => error instanceof CandidateControlError && error.status === 503);
  await fs.unlink(file);
  await fs.rename(root, root + '-original');
  await fs.symlink(root + '-original', root);
  await assert.rejects(controls.getRecords(), error => error instanceof CandidateControlError && error.status === 503);
});
