import test from 'node:test';
import assert from 'node:assert/strict';
import { createPreparationDraftSession, emptyPreparePayload, type PreparationDraftPayload } from '../src/host/ui/case-preparation-model.ts';
import type { WorkspaceDraftRecord } from '../src/host/workspace-draft-store.ts';

const record = (id: string, revision: number, payload: PreparationDraftPayload): WorkspaceDraftRecord<PreparationDraftPayload> => ({ kind: 'prepare', id, revision, payload: structuredClone(payload), createdAt: '2026-11-27T00:00:00Z', updatedAt: '2026-11-27T00:00:00Z' });
const deferred = () => { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done; }); return { promise, resolve }; };

test('DW13: saves serialize, drain edits made during pending acknowledgement, and retain operation identities', async () => {
  const first = deferred();
  const writes: WorkspaceDraftRecord<PreparationDraftPayload>[] = [];
  const session = createPreparationDraftSession({ id: 'prepare-serial', save: async (id, revision, payload) => {
    const saved = record(id, revision + 1, payload); writes.push(saved);
    if (writes.length === 1) await first.promise;
    return saved;
  } });
  const ids = [session.getSnapshot().payload.adoptOperationId, session.getSnapshot().payload.createOperationId];
  session.update({ rawInput: '原始问题', title: '原名称' });
  const flush = session.flush();
  await Promise.resolve();
  session.update({ title: '保存时继续编辑', description: '', selectedGoal: { goalId: 'g', version: 2, strategy: 'S' } });
  assert.equal(session.flush(), flush);
  await Promise.resolve();
  first.resolve();
  assert.equal(await flush, true);
  assert.deepEqual(writes.map(item => item.revision), [1, 2]);
  assert.equal(writes[1].payload.title, '保存时继续编辑');
  assert.equal(writes[1].payload.description, '');
  assert.deepEqual(writes[1].payload.selectedGoal, { goalId: 'g', version: 2, strategy: 'S' });
  assert.deepEqual([writes[1].payload.adoptOperationId, writes[1].payload.createOperationId], ids);
  assert.equal(session.getSnapshot().dirty, false);
});

test('DW13: failed flush blocks navigation without clearing input and exact retry remains possible', async () => {
  let fail = true;
  const errors: unknown[] = [];
  const session = createPreparationDraftSession({ id: 'prepare-failure', onError: failure => errors.push(failure), save: async (id, revision, payload) => {
    if (fail) throw new Error('offline');
    return record(id, revision + 1, payload);
  } });
  session.update({ rawInput: '不能因失败导航丢失', description: '背景' });
  assert.equal(await session.flush(), false);
  assert.equal(session.getSnapshot().dirty, true);
  assert.equal(session.getSnapshot().payload.rawInput, '不能因失败导航丢失');
  assert.equal(errors.length, 1);
  fail = false;
  assert.equal(await session.flush(), true);
  assert.equal(session.getSnapshot().revision, 1);
});

test('DW13/DW14: lost response reads original write before retry and never writes it twice', async () => {
  let saved: WorkspaceDraftRecord<PreparationDraftPayload> | null = null;
  let writes = 0;
  const session = createPreparationDraftSession({ id: 'prepare-lost', save: async (id, revision, payload) => {
    saved = record(id, revision + 1, payload); writes++;
    throw new Error('response_dropped');
  }, read: async () => saved });
  session.update({ rawInput: '原输入' });
  assert.equal(await session.flush(), true);
  assert.equal(writes, 1);
  assert.equal(session.getSnapshot().revision, 1);
  assert.equal(session.getSnapshot().dirty, false);
});

test('DW13: newer readback rebases receipt state while retaining all local dirty fields', async () => {
  const base = emptyPreparePayload();
  let server = record('prepare-conflict', 2, { ...base, adoptionReceipt: { goalId: 'g', version: 1, strategy: 'S', operationId: 'adopt', adoptedAt: 'now' } });
  let writes = 0;
  const session = createPreparationDraftSession({ id: server.id, payload: base, revision: 1, read: async () => server, save: async (id, revision, payload) => {
    writes++;
    if (revision !== server.revision) throw Object.assign(new Error('draft_revision_conflict'), { status: 409 });
    server = record(id, revision + 1, payload); return server;
  } });
  session.update({ rawInput: '我正在输入', title: '明确标题', description: '明确背景' });
  assert.equal(await session.flush(), true);
  assert.equal(writes, 2);
  assert.equal(server.payload.rawInput, '我正在输入');
  assert.equal(server.payload.title, '明确标题');
  assert.equal(server.payload.description, '明确背景');
  assert.equal(server.payload.adoptionReceipt?.operationId, 'adopt');
});

test('DW13: accepting late creation receipt preserves newer input and rejects another draft owner', () => {
  const base = emptyPreparePayload();
  const session = createPreparationDraftSession({ id: 'prepare-receipt', payload: base, save: async (id, revision, payload) => record(id, revision + 1, payload) });
  session.update({ title: '编辑后的标题', rawInput: '编辑后的原文' });
  session.accept(record(session.id, 4, { ...base, title: '提交时标题', rawInput: '提交时原文', creationState: 'completed', creationReceipt: { caseId: 'case', operationId: base.createOperationId, createdAt: 'now' } }));
  assert.equal(session.getSnapshot().payload.title, '编辑后的标题');
  assert.equal(session.getSnapshot().payload.rawInput, '编辑后的原文');
  assert.equal(session.getSnapshot().payload.creationState, 'completed');
  assert.equal(session.getSnapshot().dirty, true);
  assert.throws(() => session.accept(record('another-owner', 5, base)), /owner_mismatch/);
  session.accept(record(session.id, 2, base));
  assert.equal(session.getSnapshot().revision, 4);
});

test('DW13: a late conflicting recovery read retains both writers and blocks navigation', async () => {
  const readStarted = deferred(), releaseRead = deferred();
  const base = emptyPreparePayload();
  let server = record('prepare-late-read', 2, { ...base, title: '先前服务器标题', description: '先前服务器背景' });
  const session = createPreparationDraftSession({ id: server.id, payload: base, revision: 1,
    read: async () => { readStarted.resolve(); await releaseRead.promise; return server; },
    save: async (id, revision, payload) => {
      if (revision !== server.revision) throw Object.assign(new Error('draft_revision_conflict'), { status: 409 });
      server = record(id, revision + 1, payload); return server;
    },
  });
  session.update({ title: '第一段编辑' });
  const flushing = session.flush();
  await readStarted.promise;
  session.update({ title: '读取期间新标题', description: '读取期间新背景' });
  releaseRead.resolve();
  assert.equal(await flushing, false);
  assert.equal(server.payload.title, '先前服务器标题');
  assert.equal(server.payload.description, '先前服务器背景');
  assert.equal(session.getSnapshot().payload.title, '读取期间新标题');
  assert.equal(session.getSnapshot().payload.description, '读取期间新背景');
  assert.equal(session.getSnapshot().dirty, true);
});

test('DW10: every new preparation has fresh operation identities; exact draft reopen retains identities and source metadata', () => {
  const first = emptyPreparePayload(), second = emptyPreparePayload();
  assert.notEqual(first.createOperationId, second.createOperationId);
  assert.notEqual(first.adoptOperationId, second.adoptOperationId);
  const scope = { kind: 'personal' as const, id: 'personal:真实用户', name: '真实用户' };
  const source = { owner: { role: 'goal-draft' as const, draftId: 'prepare-reopen', scope }, discussionId: 'discussion', sessionId: 'session', entryId: 'entry', sha256: 'a'.repeat(64) };
  const goalDraft = { title: 'G', outcome: '结果', perspective: 'personal' as const, scope, measurement: { kind: 'deliverable' as const, criterion: '可核成果' }, baseline: { state: 'pending' as const, description: '待补' }, responsible: '本人', strategies: ['S'], roleSuggestion: source };
  const session = createPreparationDraftSession<PreparationDraftPayload>({ id: 'prepare-reopen', payload: { ...first, scope, goalDraft }, revision: 3, save: async (id, revision, payload) => record(id, revision + 1, payload) });
  assert.equal(session.id, source.owner.draftId);
  assert.deepEqual(session.getSnapshot().payload.goalDraft?.roleSuggestion, source);
  assert.equal(session.getSnapshot().payload.createOperationId, first.createOperationId);
});

test('DW13: another window editing the same field is an explicit conflict, never silently overwritten', async () => {
  const base = emptyPreparePayload();
  let server = record('prepare-tab-conflict', 2, { ...base, rawInput: '另一窗口的新原文' });
  let writes = 0;
  const session = createPreparationDraftSession({ id: server.id, payload: base, revision: 1, read: async () => server, save: async (id, revision, payload) => {
    writes++;
    if (revision !== server.revision) throw Object.assign(new Error('draft_revision_conflict'), { status: 409 });
    server = record(id, revision + 1, payload); return server;
  } });
  session.update({ rawInput: '当前窗口的新原文' });
  assert.equal(await session.flush(), false);
  assert.equal(writes, 1);
  assert.equal(server.payload.rawInput, '另一窗口的新原文');
  assert.equal(session.getSnapshot().payload.rawInput, '当前窗口的新原文');
  assert.equal(session.getSnapshot().dirty, true);
});
