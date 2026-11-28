import test from 'node:test';
import assert from 'node:assert/strict';
import { createCaseActionDraft, type CaseActionDraftPayload } from '../src/host/ui/case-action-draft.ts';
import type { WorkspaceDraftRecord } from '../src/host/workspace-draft-store.ts';
import { build } from 'esbuild';
import { runInNewContext } from 'node:vm';

type Fields = { reason: string; operationId: string; responseKey: string };
const owner = { id: 'choice:case:issue', caseId: 'case', issueId: 'issue', kind: 'choice' as const };
const initial: Fields = { reason: '', operationId: 'op-1', responseKey: '' };
type Draft = WorkspaceDraftRecord<CaseActionDraftPayload<Fields>>;
function store() {
  let record: Draft | null = null;
  const calls: CaseActionDraftPayload<Fields>[] = [];
  return {
    get record() { return record; }, set record(next: Draft | null) { record = next; }, calls,
    read: async () => record,
    save: async (revision: number, payload: CaseActionDraftPayload<Fields>) => {
      if (revision !== (record?.revision ?? 0)) throw Object.assign(Error('draft_revision_conflict'), { status: 409 });
      calls.push(structuredClone(payload));
      return record = { kind: 'issue-draft', id: owner.id, revision: revision + 1, payload: structuredClone(payload), createdAt: '', updatedAt: '' };
    },
  };
}

test('DW13: action input and exact operation/request survive reopening without writing a business record', async () => {
  const api = store();
  const first = createCaseActionDraft({ ...owner, initial, read: api.read, save: api.save });
  await first.load();
  assert.equal(await first.flush(), true); assert.equal(api.calls.length, 0, 'Viewing an empty editor does not create input or a business record');
  first.update(value => ({ ...value, reason: '保留理由 <script>text</script>' }));
  first.update(value => ({ ...value, responseKey: 'original-request@3' }));
  assert.equal(await first.flush(), true);
  const reopened = createCaseActionDraft({ ...owner, initial: { ...initial, operationId: 'new-session' }, read: api.read, save: api.save });
  await reopened.load();
  assert.deepEqual(reopened.getSnapshot().value, { reason: '保留理由 <script>text</script>', operationId: 'op-1', responseKey: 'original-request@3' });
  assert.equal(api.record!.payload.text, ''); assert.deepEqual(api.record!.payload.appendedFragmentIds, []);
  assert.equal(api.record!.payload.actionForm.kind, 'choice');
});

test('DW13: one flush drains edits arriving during a save before navigation can proceed', async () => {
  const api = store(); let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; }); let firstSave = true;
  const draft = createCaseActionDraft({ ...owner, initial, read: api.read, save: async (revision, payload) => {
    if (firstSave) { firstSave = false; await gate; }
    return api.save(revision, payload);
  } });
  await draft.load(); draft.update(value => ({ ...value, reason: '第一段' }));
  const saving = draft.flush(); assert.equal(draft.flush(), saving, 'Concurrent close/navigation share a single save');
  draft.update(value => ({ ...value, reason: '第一段及后来的编辑' })); release();
  assert.equal(await saving, true, 'Navigation may proceed only after the latest input is saved');
  assert.equal(api.record!.payload.actionForm.fields.reason, '第一段及后来的编辑');
  assert.equal(api.calls.length, 2);
});

test('DW13: CAS conflict retains this input and never overwrites another editor', async () => {
  const api = store(); const draft = createCaseActionDraft({ ...owner, initial, read: api.read, save: api.save });
  await draft.load(); draft.update({ ...initial, reason: '本页草稿' });
  await api.save(0, { caseId: 'case', issueId: 'issue', text: '', appendedFragmentIds: [], actionForm: { kind: 'choice', fields: { ...initial, reason: '别页草稿' } } });
  await assert.rejects(draft.flush(), /draft_revision_conflict/);
  await assert.rejects(draft.flush(), /draft_revision_conflict/);
  assert.equal(draft.getSnapshot().value.reason, '本页草稿');
  assert.equal(api.record!.payload.actionForm.fields.reason, '别页草稿'); assert.equal(api.calls.length, 1);
});

test('DW13: lost acknowledgement accepts only the same saved payload and exact owner', async () => {
  const api = store(); let writes = 0;
  const draft = createCaseActionDraft({ ...owner, initial, read: api.read, save: async (revision, payload) => {
    writes++; await api.save(revision, payload); throw Error('lost response');
  } });
  await draft.load(); draft.update({ ...initial, reason: '原保存意图待确认' });
  assert.equal(await draft.flush(), true); assert.equal(writes, 1);
  assert.equal(await draft.flush(), true); assert.equal(writes, 1, 'Readback success must not blindly repeat the save');
  api.record = { ...api.record!, payload: { ...api.record!.payload, issueId: 'other-issue' } };
  const other = createCaseActionDraft({ ...owner, initial, read: api.read, save: api.save });
  await assert.rejects(other.load(), /owner_mismatch/);
  assert.equal(other.getSnapshot().ready, false);
});

test('DW13: a late initial read cannot silently replace edits or overwrite an unseen saved draft', async () => {
  const api = store();
  await api.save(0, { caseId: 'case', issueId: 'issue', text: '', appendedFragmentIds: [], actionForm: { kind: 'choice', fields: { ...initial, reason: '原草稿' } } });
  let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; });
  const draft = createCaseActionDraft({ ...owner, initial, read: async () => { await gate; return api.record; }, save: api.save });
  const loading = draft.load(); draft.update({ ...initial, reason: '读取期间输入' }); release(); await loading;
  assert.equal(draft.getSnapshot().value.reason, '读取期间输入');
  await assert.rejects(draft.flush(), /changed_before_load/);
  assert.equal(api.record!.payload.actionForm.fields.reason, '原草稿');
});

test('DW13: unavailable or misbound draft never becomes ready or writable', async () => {
  let writes = 0;
  const draft = createCaseActionDraft({ ...owner, initial, read: async () => { throw Object.assign(Error('unavailable'), { status: 503 }); }, save: async () => { writes++; throw Error('must not save'); } });
  await assert.rejects(draft.load(), /unavailable/); assert.equal(await draft.flush(), false); assert.equal(writes, 0);
  for (const patch of [{ id: 'choice:other:issue' }, { payload: { caseId: 'case', issueId: 'issue', text: '原对话', appendedFragmentIds: [], actionForm: { kind: 'choice', fields: initial } } }, { payload: { caseId: 'case', issueId: 'issue', text: '', appendedFragmentIds: [], actionForm: { kind: 'feedback', fields: initial } } }]) {
    const api = store(); await api.save(0, { caseId: 'case', issueId: 'issue', text: '', appendedFragmentIds: [], actionForm: { kind: 'choice', fields: initial } });
    const invalid = createCaseActionDraft({ ...owner, initial, read: async () => ({ ...api.record!, ...patch }) as Draft, save: api.save });
    await assert.rejects(invalid.load(), /owner_mismatch/); assert.equal(await invalid.flush(), false);
  }
});

let hookBundle: string | undefined;
async function hookHarness(fetcher: typeof fetch) {
  hookBundle ??= (await build({ stdin: { contents: "export { useCaseActionDraft } from './src/host/ui/useCaseActionDraft.ts'; export { flushWorkspaceInputs } from './src/host/ui/workspace-input-guards.ts';", resolveDir: process.cwd(), loader: 'ts' }, bundle: true, write: false, platform: 'browser', format: 'iife', globalName: 'ActionDraftUi', plugins: [{ name: 'action-draft-hooks', setup(plugin) {
    plugin.onResolve({ filter: /^react$/ }, args => ({ path: args.path, namespace: 'action-draft-react' }));
    plugin.onLoad({ filter: /.*/, namespace: 'action-draft-react' }, () => ({ contents: 'export const useState=v=>globalThis.hooks.state(v); export const useRef=v=>globalThis.hooks.ref(v); export const useEffect=(f,d)=>globalThis.hooks.effect(f,d); export const useMemo=(f,d)=>globalThis.hooks.memo(f,d); export const useCallback=(f,d)=>globalThis.hooks.memo(()=>f,d);' }));
  } }] })).outputFiles[0].text;
  const events = new Map<string, Set<(event: any) => void>>();
  const sandbox: Record<string, any> = { fetch: fetcher, structuredClone, crypto, URL, URLSearchParams, Response, Request, Headers, setTimeout, clearTimeout,
    window: { addEventListener(name: string, fn: (event: any) => void) { if (!events.has(name)) events.set(name, new Set()); events.get(name)!.add(fn); }, removeEventListener(name: string, fn: (event: any) => void) { events.get(name)?.delete(fn); } },
  };
  runInNewContext(hookBundle, sandbox);
  let cursor = 0, result: ReturnType<typeof import('../src/host/ui/useCaseActionDraft.ts').useCaseActionDraft<Fields>>;
  let props: { id:string; caseId:string; issueId:string; kind:'choice'; initial:Fields; readOnly?:boolean } = { ...owner, initial };
  const values: any[] = [], dependencies: any[][] = [], cleanups: any[] = [], effects: (() => void)[] = [];
  const changed = (i: number, next: any[]) => !dependencies[i] || next.some((v, n) => v !== dependencies[i][n]);
  sandbox.hooks = {
    state(value: any) { const i = cursor++; if (!(i in values)) values[i] = typeof value === 'function' ? value() : value; return [values[i], (next: any) => { values[i] = typeof next === 'function' ? next(values[i]) : next; }]; },
    ref(value: any) { const i = cursor++; return values[i] ??= { current: value }; },
    memo(fn: () => any, deps: any[]) { const i = cursor++; if (changed(i, deps)) { dependencies[i] = deps; values[i] = fn(); } return values[i]; },
    effect(fn: () => any, deps: any[]) { const i = cursor++; if (changed(i, deps)) { dependencies[i] = deps; effects.push(() => { cleanups[i]?.(); cleanups[i] = fn(); }); } },
  };
  const render = () => { cursor = 0; result = sandbox.ActionDraftUi.useCaseActionDraft(props); while (effects.length) effects.shift()!(); return result; };
  const settle = async () => { for (let i = 0; i < 6; i++) { await new Promise(resolve => setImmediate(resolve)); render(); } return result; };
  render();
  return { render, settle, get result() { return result; }, changeOwner(next: typeof props) { props = next; render(); }, flush: () => sandbox.ActionDraftUi.flushWorkspaceInputs() as Promise<boolean>,
    unload(event: any) { events.get('beforeunload')?.forEach(fn => fn(event)); }, close() { for (const cleanup of cleanups) cleanup?.(); } };
}

test('DW13: the modal hook registers the real navigation guard and preserves unsaved fields on conflict', async () => {
  const api = store();
  const h = await hookHarness(async (_url, init) => {
    if (init?.method === 'PUT') {
      const input = JSON.parse(String(init.body));
      try { return Response.json({ draft: await api.save(input.expectedRevision, input.payload) }); }
      catch { return Response.json({ code: 'draft_revision_conflict' }, { status: 409 }); }
    }
    return api.record ? Response.json({ draft: api.record }) : Response.json({ code: 'draft_not_found' }, { status: 404 });
  });
  try {
    await h.settle(); assert.equal(h.result.ready, true);
    h.result.change(value => ({ ...value, reason: '弹窗输入' })); h.render();
    let warned = false; h.unload({ preventDefault() { warned = true; } }); assert.equal(warned, true);
    assert.equal(await h.flush(), true); await h.settle(); assert.equal(api.record!.payload.actionForm.fields.reason, '弹窗输入');
    h.result.change(value => ({ ...value, reason: '本页的新输入' })); h.render();
    await api.save(api.record!.revision, { ...api.record!.payload, actionForm: { kind: 'choice', fields: { ...initial, reason: '别页更新' } } });
    assert.equal(await h.flush(), false); await h.settle();
    assert.equal(h.result.value.reason, '本页的新输入'); assert.match(h.result.error, /输入保留/);
    assert.equal(api.record!.payload.actionForm.fields.reason, '别页更新');
  } finally { h.close(); }
});

test('DW13: delayed previous-owner reads cannot populate a different Case modal', async () => {
  let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; });
  const recordFor = (issueId: string, reason: string) => ({ kind: 'issue-draft', id: `choice:case:${issueId}`, revision: 1,
    payload: { caseId: 'case', issueId, text: '', appendedFragmentIds: [], actionForm: { kind: 'choice', fields: { ...initial, reason } } } });
  const h = await hookHarness(async url => {
    if (String(url).endsWith(encodeURIComponent('choice:case:issue'))) { await gate; return Response.json({ draft: recordFor('issue', '旧事项草稿') }); }
    return Response.json({ draft: recordFor('issue-2', '第二事项草稿') });
  });
  try {
    h.changeOwner({ ...owner, id: 'choice:case:issue-2', issueId: 'issue-2', initial }); await h.settle();
    assert.equal(h.result.value.reason, '第二事项草稿');
    release(); await h.settle(); assert.equal(h.result.value.reason, '第二事项草稿'); assert.equal(h.result.ready, true);
  } finally { release(); h.close(); }
});

test('DW13: an unopened unedited modal with unavailable draft storage does not block page navigation', async () => {
  let reads = 0;
  const h = await hookHarness(async () => { reads++; return Response.json({ code: 'unavailable' }, { status: 503 }); });
  await h.settle(); assert.equal(h.result.ready, false); const initialReads = reads;
  assert.equal(await h.flush(), true, 'Only actual unsaved input needs a navigation guard');
  assert.equal(reads, initialReads, 'Navigation does not retry an unused editor');
  h.close(); await new Promise(resolve => setImmediate(resolve));
  assert.equal(reads, initialReads, 'Unmount does not retry an unused editor');
});

test('DW13: 403 clears loaded content, retains only this session edits separately and prevents further writes', async () => {
  type Form = { form: { outcome: string; review: string; operationId: string }; unknownOperation: string | null };
  const initial: Form = { form: { outcome: '', review: '', operationId: '' }, unknownOperation: null };
  let reads = 0, writes = 0;
  const remote = { kind: 'issue-draft' as const, id: owner.id, revision: 1, payload: { caseId: owner.caseId, issueId: owner.issueId, text: '', appendedFragmentIds: [], actionForm: { kind: 'choice' as const, fields: { form: { outcome: '旧远端敏感观察', review: '旧判断', operationId: 'original-operation' }, unknownOperation: null } } }, createdAt: '', updatedAt: '' };
  const draft = createCaseActionDraft({ ...owner, initial, empty: initial, read: async () => { reads++; return remote; }, save: async () => { writes++; throw Object.assign(Error('forbidden'), { status: 403 }); } } as any) as any;
  await draft.load(); draft.update((value: Form) => ({ ...value, form: { ...value.form, review: '本轮刚输入的判断' } }));
  await assert.rejects(draft.flush(), /forbidden/);
  assert.equal(draft.getSnapshot().value.form.outcome, '', 'Previously loaded restricted content must disappear');
  assert.equal(draft.getSnapshot().isRestricted, true);
  assert.equal(draft.getSnapshot().retainedInput.form.outcome, '', 'Unedited remote content is not relabelled as new user input');
  assert.equal(draft.getSnapshot().retainedInput.form.review, '本轮刚输入的判断');
  assert.equal(draft.getSnapshot().retainedInput.form.operationId, '');
  await assert.rejects(draft.flush(), /restricted/); await assert.rejects(draft.load(), /restricted/);
  assert.equal(writes, 1); assert.equal(reads, 1, 'No readback or retry is allowed after permission loss');
  draft.discardLocal(); assert.equal(draft.getSnapshot().dirty, false); assert.equal(draft.getSnapshot().retainedInput, null);
});

test('DW13: initial and lost-ack readback 403 clear unsafe defaults and mark the owner restricted', async () => {
  const empty = { ...initial, operationId: '' }, sensitive = { ...initial, reason: '外部预填旧内容' };
  const first = createCaseActionDraft({ ...owner, initial: sensitive, empty, read: async () => { throw Object.assign(Error('forbidden'), { status: 403 }); }, save: async () => { throw Error('must not write'); } } as any) as any;
  await assert.rejects(first.load(), /forbidden/); assert.equal(first.getSnapshot().value.reason, ''); assert.equal(first.getSnapshot().retainedInput, null);
  let reads = 0;
  const second = createCaseActionDraft({ ...owner, initial, empty, read: async () => { if (++reads === 1) return null; throw Object.assign(Error('forbidden'), { status: 403 }); }, save: async () => { throw Object.assign(Error('unknown'), { status: 503 }); } } as any) as any;
  await second.load(); second.update({ ...initial, reason: '本轮新输入' }); await assert.rejects(second.flush(), /forbidden/);
  assert.equal(second.getSnapshot().isRestricted, true); assert.equal(second.getSnapshot().value.reason, ''); assert.equal(second.getSnapshot().retainedInput.reason, '本轮新输入');
});

test('DW13: reviewed conflict is backed up before adopting its CAS baseline; explicit save keeps both versions', async () => {
  const api = store(); const backups: any[] = [];
  const draft = createCaseActionDraft({ ...owner, initial, read: api.read, save: api.save,
    backup: async (id: string, payload: any) => { const value = { kind: 'issue-draft', id, revision: 1, payload: structuredClone(payload), createdAt: '', updatedAt: '' }; backups.push(value); return value; },
  } as any) as any;
  await draft.load(); draft.update({ ...initial, reason: '我的新稿' });
  await api.save(0, { caseId: 'case', issueId: 'issue', text: '', appendedFragmentIds: [], actionForm: { kind: 'choice', fields: { ...initial, reason: '对方原稿' } } });
  await assert.rejects(draft.flush(), /draft_revision_conflict/);
  assert.equal(draft.getSnapshot().conflict.value.reason, '对方原稿');
  assert.equal(await draft.resolveConflict(99), false); assert.equal(backups.length, 0);
  assert.equal(await draft.resolveConflict(1), true); assert.equal(api.record!.payload.actionForm.fields.reason, '对方原稿', 'Accepting a baseline is not yet a write of my draft');
  assert.equal(backups.length, 1); assert.equal(backups[0].payload.actionForm.fields.reason, '对方原稿');
  assert.equal(backups[0].payload.recovery.originalId, owner.id); assert.equal(backups[0].payload.recovery.sourceRevision, 1);
  assert.match(draft.getSnapshot().recoveryDraftId, /^action-recovery:/);
  assert.equal(await draft.flush(false), false, 'Autosave cannot commit an explicitly reviewed conflict resolution');
  assert.equal(await draft.flush(), true); assert.equal(api.record!.payload.actionForm.fields.reason, '我的新稿');
  assert.equal(backups[0].payload.actionForm.fields.reason, '对方原稿', 'The other editor version remains recoverable');
});

test('DW13: a failed backup cannot authorize overwrite, and another concurrent edit still fails CAS after backup', async () => {
  const api = store(); let backupFails = true; const ids: string[] = [];
  const draft = createCaseActionDraft({ ...owner, initial, read: api.read, save: api.save,
    backup: async (id, payload) => { ids.push(id); if (backupFails) throw Object.assign(Error('backup_unavailable'), { status: 503 }); return { kind: 'issue-draft', id, revision: 1, payload: structuredClone(payload), createdAt: '', updatedAt: '' }; },
  });
  await draft.load(); draft.update({ ...initial, reason: '我的新稿' });
  const other = { caseId: 'case', issueId: 'issue', text: '', appendedFragmentIds: [], actionForm: { kind: 'choice' as const, fields: { ...initial, reason: '对方原稿' } } };
  await api.save(0, other); await assert.rejects(draft.flush(), /draft_revision_conflict/);
  await assert.rejects(draft.resolveConflict(1), /backup_unavailable/); await assert.rejects(draft.flush(), /draft_revision_conflict/);
  assert.equal(api.calls.length, 1); assert.equal(draft.getSnapshot().conflict?.revision, 1);
  backupFails = false; assert.equal(await draft.resolveConflict(1), true); assert.equal(ids[0], ids[1], 'A backup retry has one stable identity');
  await api.save(1, { ...other, actionForm: { kind: 'choice', fields: { ...initial, reason: '对方更晚更新' } } });
  await assert.rejects(draft.flush(), /draft_revision_conflict/);
  assert.equal(api.record!.payload.actionForm.fields.reason, '对方更晚更新'); assert.equal(draft.getSnapshot().value.reason, '我的新稿'); assert.equal(draft.getSnapshot().conflict?.revision, 2);
});

test('DW13: the real hook recovers a lost backup acknowledgement, then permits explicit save and reopening', async () => {
  const records = new Map<string, any>(); const calls: { method: string; id: string }[] = [];
  const fetcher: typeof fetch = async (url, init) => {
    const id = decodeURIComponent(String(url).split('/').at(-1)!); calls.push({ method: init?.method ?? 'GET', id });
    const old = records.get(id);
    if (init?.method === 'PUT') {
      const input = JSON.parse(String(init.body));
      if (input.expectedRevision !== (old?.revision ?? 0)) return Response.json({ code: 'draft_revision_conflict' }, { status: 409 });
      const saved = { kind: 'issue-draft', id, revision: (old?.revision ?? 0) + 1, payload: input.payload, createdAt: '', updatedAt: '' }; records.set(id, saved);
      return id.startsWith('action-recovery:') ? Response.json({ code: 'lost_ack' }, { status: 503 }) : Response.json({ draft: saved });
    }
    return old ? Response.json({ draft: old }) : Response.json({ code: 'draft_not_found' }, { status: 404 });
  };
  const h = await hookHarness(fetcher);
  try {
    await h.settle(); h.result.change({ ...initial, reason: '本页新稿' }); h.render();
    records.set(owner.id, { kind: 'issue-draft', id: owner.id, revision: 1, payload: { caseId: 'case', issueId: 'issue', text: '', appendedFragmentIds: [], actionForm: { kind: 'choice', fields: { ...initial, reason: '远端原稿' } } } });
    assert.equal(await h.result.flush(), false); await h.settle();
    assert.equal(await h.result.resolveConflict(1), true); await h.settle();
    const backup = h.result.recoveryDraftId; assert.ok(backup);
    assert.equal(records.get(backup).payload.actionForm.fields.reason, '远端原稿');
    assert.ok(calls.some(call => call.method === 'GET' && call.id === backup), 'Lost acknowledgement is checked against the exact backup identity');
    assert.equal(await h.flush(), false, 'Navigation cannot silently finish a reviewed conflict resolution');
    assert.equal(await h.result.flush(), true); await h.settle();
    assert.equal(records.get(owner.id).payload.actionForm.fields.reason, '本页新稿'); assert.equal(records.get(backup).payload.actionForm.fields.reason, '远端原稿');
    assert.equal(await h.flush(), true);
  } finally { h.close(); }
  const reopened = await hookHarness(fetcher);
  try {
    await reopened.settle(); assert.equal(reopened.result.value.reason, '本页新稿');
    assert.ok(reopened.result.recoveryDraftId, 'Reopening retains a direct reference to the preserved other version');
    assert.equal(records.get(reopened.result.recoveryDraftId).payload.actionForm.fields.reason, '远端原稿');
    assert.equal(reopened.result.preservedDrafts[0]?.sourceRevision, 1);
  } finally { reopened.close(); }
});

test('DW13: the hook clears restricted remote fields and permits explicit local discard without a remote delete', async () => {
  const api = store(); let forbidden = false; const methods: string[] = [];
  await api.save(0, { caseId: 'case', issueId: 'issue', text: '', appendedFragmentIds: [], actionForm: { kind: 'choice', fields: { ...initial, reason: '旧远端内容', responseKey: '原请求敏感引用' } } });
  const h = await hookHarness(async (_url, init) => {
    methods.push(init?.method ?? 'GET');
    if (forbidden) return Response.json({ code: 'forbidden' }, { status: 403 });
    return Response.json({ draft: api.record });
  });
  try {
    await h.settle(); h.result.change(value => ({ ...value, reason: '本轮新理由' })); h.render(); forbidden = true;
    assert.equal(await h.result.flush(), false); await h.settle();
    assert.equal(h.result.isRestricted, true); assert.equal(h.result.value.reason, ''); assert.equal(h.result.value.responseKey, '');
    assert.equal(h.result.retainedInput?.reason, '本轮新理由'); assert.equal(h.result.retainedInput?.responseKey, '');
    const count = methods.length; assert.equal(await h.flush(), false); assert.equal(methods.length, count, 'Permission loss is sticky for this mounted owner');
    h.result.discardLocal(); h.render(); assert.equal(await h.flush(), true); assert.equal(methods.length, count);
    assert.equal(api.record!.payload.actionForm.fields.reason, '旧远端内容'); assert.ok(!methods.includes('DELETE'));
  } finally { h.close(); }
});

test('DW13: discarding during an in-flight draft save never replays the old input over its accepted receipt', async () => {
  const api = store(); let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; });
  const draft = createCaseActionDraft({ ...owner, initial, read: api.read, save: async (revision, payload) => { await gate; return api.save(revision, payload); } });
  await draft.load(); draft.update({ ...initial, reason: '正在保存的输入' });
  const saving = draft.flush(); draft.discardLocal(); release(); await saving;
  assert.equal(api.calls.length, 1, 'A discard must not create another save restoring the old text');
  assert.equal(api.record!.payload.actionForm.fields.reason, '正在保存的输入');
});


test('DW13/B3: a live draft becoming read-only retains unsaved input and cannot autosave, flush or mutate it until reopened',async()=>{
  const api=store();const h=await hookHarness(async(_url,init)=>{if(init?.method==='PUT'){const input=JSON.parse(String(init.body));return Response.json({draft:await api.save(input.expectedRevision,input.payload)});}return api.record?Response.json({draft:api.record}):Response.json({code:'not_found'},{status:404});});
  try{
    await h.settle();h.result.change(value=>({...value,reason:'关闭前的新输入'}));h.render();
    h.changeOwner({...owner,initial,readOnly:true});await h.settle();await new Promise(resolve=>setTimeout(resolve,350));await h.settle();
    assert.equal(api.calls.length,0);assert.equal(h.result.value.reason,'关闭前的新输入');
    assert.equal(await h.result.flush(),false);assert.equal(api.calls.length,0);
    h.result.change(value=>({...value,reason:'只读期间不应生效'}));h.render();assert.equal(h.result.value.reason,'关闭前的新输入');
    h.changeOwner({...owner,initial,readOnly:false});await h.settle();assert.equal(await h.result.flush(),true);assert.equal(api.record!.payload.actionForm.fields.reason,'关闭前的新输入');
  }finally{h.close();}
});
