import test from 'node:test';
import assert from 'node:assert/strict';
import { createCaseComposerDraft } from '../src/host/ui/case-composer-draft.ts';
import type { IssueDraftPayload, WorkspaceDraftRecord } from '../src/host/workspace-draft-store.ts';

test('DW12/13: real composer serializes edits, survives reopen and appends only through its original draft', async () => {
  let record: WorkspaceDraftRecord<IssueDraftPayload> | null = null;
  let release!: () => void;
  let gated = true;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const opts = { caseId: 'case', issueId: 'issue', read: async () => record,
    save: async (rev: number, payload: IssueDraftPayload) => {
      if (gated) { gated = false; await gate; }
      assert.equal(rev, record?.revision ?? 0);
      return record = { kind: 'issue-draft' as const, id: 'issue:case:issue', revision: rev + 1, payload, createdAt: '', updatedAt: '' };
    }, append: async (_id: string, rev: number) => {
      assert.equal(rev, record!.revision);
      if (!record!.payload.appendedFragmentIds.includes('fragment')) record = { ...record!, revision: rev + 1, payload: { ...record!.payload, text: record!.payload.text + '\n\n新片段', appendedFragmentIds: ['fragment'] } };
      return { draft: record!, alreadyAppended: false };
    } };
  const draft = createCaseComposerDraft(opts);
  await draft.load(); draft.update('已有草稿');
  const saving = draft.flush(); draft.update('已有草稿及较晚编辑'); release(); await saving;
  assert.equal(record!.payload.text, '已有草稿及较晚编辑');
  await draft.append('fragment'); await draft.append('fragment');
  assert.equal(draft.getSnapshot().text, '已有草稿及较晚编辑\n\n新片段');
  const reopened = createCaseComposerDraft(opts); await reopened.load();
  assert.equal(reopened.getSnapshot().text, draft.getSnapshot().text);
  await reopened.clearSent('旧发送文本');
  assert.equal(reopened.getSnapshot().text, draft.getSnapshot().text, 'late settlement cannot clear newer text');
});

test('DW13: another editor conflict preserves both drafts and blocks navigation', async () => {
  const saved = { kind: 'issue-draft' as const, id: 'issue:case:issue', revision: 1,
    payload: { caseId: 'case', issueId: 'issue', text: '别处草稿', appendedFragmentIds: [] }, createdAt: '', updatedAt: '' };
  const draft = createCaseComposerDraft({ caseId: 'case', issueId: 'issue', read: async () => saved,
    save: async () => { throw Object.assign(Error('draft_revision_conflict'), { status: 409 }); },
    append: async () => { throw Error('must not append'); } });
  await draft.load(); draft.update('本页未保存输入');
  await assert.rejects(draft.flush(), /draft_revision_conflict/);
  assert.equal(draft.getSnapshot().text, '本页未保存输入');
  assert.equal(saved.payload.text, '别处草稿');
});
