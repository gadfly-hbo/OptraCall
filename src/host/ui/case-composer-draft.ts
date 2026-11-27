import type { IssueDraftPayload, WorkspaceDraftRecord } from '../workspace-draft-store.ts';

/** A draft is input, not a second conversation history. One controller owns one exact issue. */
export function createCaseComposerDraft(options: {
  caseId: string; issueId: string;
  read(): Promise<WorkspaceDraftRecord<IssueDraftPayload> | null>;
  save(revision: number, payload: IssueDraftPayload): Promise<WorkspaceDraftRecord<IssueDraftPayload>>;
  append(fragmentId: string, revision: number): Promise<{ draft: WorkspaceDraftRecord<IssueDraftPayload>; alreadyAppended: boolean }>;
  onChange?(text: string): void;
}) {
  let revision = 0, ready = false, text = '', savedText = '';
  let appendedFragmentIds: string[] = [];
  let running: Promise<boolean> | null = null;
  let conflict: WorkspaceDraftRecord<IssueDraftPayload> | null = null;
  const check = (record: WorkspaceDraftRecord<IssueDraftPayload>) => {
    if (record.payload.caseId !== options.caseId || record.payload.issueId !== options.issueId) throw Error('issue_draft_owner_mismatch');
  };
  const accept = (record: WorkspaceDraftRecord<IssueDraftPayload>) => {
    check(record); revision = record.revision; appendedFragmentIds = record.payload.appendedFragmentIds;
    savedText = record.payload.text;
  };
  const change = (value: string) => { text = value; options.onChange?.(value); };
  async function load(fallback = '') {
    const record = await options.read();
    if (record) accept(record);
    ready = true; change(record?.payload.text ?? fallback);
    return text;
  }
  async function drain() {
    if (!ready) return false;
    while (text !== savedText) {
      const sent = text;
      const payload = { caseId: options.caseId, issueId: options.issueId, text: sent, appendedFragmentIds };
      try { accept(await options.save(revision, payload)); }
      catch (failure) {
        // Only an exact readback of this save can recover a lost acknowledgement.
        // Another editor's different input is a conflict, never silently merged.
        const original = await options.read().catch(() => null);
        if (!original || original.payload.text !== sent || JSON.stringify(original.payload.appendedFragmentIds) !== JSON.stringify(appendedFragmentIds)) { conflict = original; throw failure; }
        accept(original);
      }
    }
    conflict = null; return true;
  }
  function flush(): Promise<boolean> {
    if (!running) running = drain().finally(() => { running = null; });
    return running;
  }
  async function append(fragmentId: string) {
    if (!await flush()) throw Error('issue_draft_not_ready');
    const before = text;
    const result = await options.append(fragmentId, revision);
    accept(result.draft);
    // UI locks editing during append. Preserve a late edit should a caller not do so.
    if (text !== before) throw Error('issue_draft_changed_during_append');
    change(result.draft.payload.text);
    return result;
  }
  return { load, update: change, flush, append,
    getSnapshot: () => ({ text, ready, revision, dirty: text !== savedText }),
    getConflict: () => conflict,
    keepBoth: async () => { if(!conflict)return false;const local=text;accept(conflict);change([savedText,local].filter(Boolean).join('\n\n'));return flush(); },
    clearSent: async (sent: string) => { if (text === sent) { change(''); await flush(); } },
  };
}
