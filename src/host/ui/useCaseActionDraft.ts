import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createCaseActionDraft, type CaseActionDraftKind, type CaseActionDraftPayload } from './case-action-draft.ts';
import { readWorkspaceDraft, saveWorkspaceDraft } from './workspace-daily-client.ts';
import { registerWorkspaceInputGuard } from './workspace-input-guards.ts';

/** Durable modal input, using the original Host draft store and navigation guard. */
export function useCaseActionDraft<T extends Record<string, unknown>>(options: {
  id: string; caseId: string; issueId: string; kind: CaseActionDraftKind; initial: T; empty?: T; readOnly?: boolean;
}) {
  const [, redraw] = useState(0);
  const readOnly = useRef(Boolean(options.readOnly));
  readOnly.current = Boolean(options.readOnly);
  const active = useRef<ReturnType<typeof createCaseActionDraft<T>> | null>(null);
  const failure = useRef<{ owner: unknown; text: string }>({ owner: null, text: '' });
  const controller = useMemo(() => createCaseActionDraft<T>({
    ...options,
    read: () => readWorkspaceDraft<CaseActionDraftPayload<T>>('issue-draft', options.id).then(result => result.draft).catch(error => {
      if (error?.status === 404) return null;
      throw error;
    }),
    save: (revision, payload) => { if (readOnly.current) return Promise.reject(Error('action_draft_read_only')); return saveWorkspaceDraft('issue-draft', options.id, revision, payload).then(result => result.draft); },
    backup: async (id, payload) => {
      if (readOnly.current) throw Error('action_draft_read_only');
      try { return (await saveWorkspaceDraft('issue-draft', id, 0, payload)).draft; }
      catch (failure) {
        if (failure !== null && typeof failure === 'object' && 'status' in failure && [401, 403].includes(Number(failure.status))) throw failure;
        // Preserve a stable backup identity on a lost acknowledgement; never create
        // a second backup merely because its first response was unavailable.
        const original = await readWorkspaceDraft<CaseActionDraftPayload<T>>('issue-draft', id).catch(error => {
          if (error?.status === 401 || error?.status === 403) throw error;
          return null;
        });
        if (!original || JSON.stringify(original.draft.payload) !== JSON.stringify(payload)) throw failure;
        return original.draft;
      }
    },
    onChange: () => { if (active.current === controller) redraw(value => value + 1); },
  }), [options.id, options.caseId, options.issueId, options.kind]);
  active.current = controller;
  const report = useCallback((text: string) => {
    if (active.current !== controller) return;
    failure.current = { owner: controller, text }; redraw(value => value + 1);
  }, [controller]);
  const flush = useCallback(async (explicit = true) => {
    if (readOnly.current) { const unchanged = !controller.getSnapshot().dirty; if (!unchanged) report('Case 已关闭，草稿仅供查看；尚未保存的输入仍保留。'); return unchanged; }
    try {
      if (!controller.getSnapshot().ready) await controller.load();
      const saved = await controller.flush(explicit);
      report(saved ? '' : '草稿尚未就绪，原输入保留；请重新读取后继续。');
      return saved;
    } catch {
      report('草稿尚未确认保存，原输入保留；请核对草稿或恢复连接后重试，当前不会离开或提交。');
      return false;
    }
  }, [controller, report]);
  useEffect(() => {
    let mounted = true;
    active.current = controller;
    void controller.load().then(() => { if (mounted && active.current === controller) redraw(value => value + 1); }).catch(() => {
      if (mounted) report('原草稿暂不可读取，输入保留；恢复读取后才能编辑或提交。');
    });
    const remove = registerWorkspaceInputGuard(() => {
      const current = controller.getSnapshot();
      return !current.dirty ? Promise.resolve(true) : current.needsExplicitSave ? Promise.resolve(false) : flush();
    });
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (controller.getSnapshot().dirty) { event.preventDefault(); event.returnValue = ''; }
    };
    if (typeof window !== 'undefined') window.addEventListener('beforeunload', beforeUnload);
    return () => {
      mounted = false;
      if (active.current === controller) active.current = null;
      remove();
      if (typeof window !== 'undefined') window.removeEventListener('beforeunload', beforeUnload);
      // Normal navigation already flushes the registered guard; retain this fallback
      // for a parent unmount without routing through the workspace navigation.
      if (!readOnly.current && controller.getSnapshot().dirty && !controller.getSnapshot().needsExplicitSave) void flush(false);
    };
  }, [controller, flush, report]);
  const snapshot = controller.getSnapshot();
  useEffect(() => {
    if (options.readOnly || !snapshot.ready || !snapshot.dirty || snapshot.isRestricted || snapshot.conflict || snapshot.needsExplicitSave) return;
    const timer = setTimeout(() => { void flush(false); }, 300);
    return () => clearTimeout(timer);
  }, [controller, snapshot.value, snapshot.ready, snapshot.dirty, snapshot.isRestricted, snapshot.conflict?.revision, snapshot.needsExplicitSave, options.readOnly, flush]);
  return {
    value: snapshot.value,
    change: (value: T | ((previous: T) => T)) => { if (!readOnly.current) controller.update(value); },
    ready: snapshot.ready,
    restored: snapshot.restored,
    error: snapshot.isRestricted ? snapshot.readError : failure.current.owner === controller ? failure.current.text : '',
    dirty: snapshot.dirty,
    isRestricted: snapshot.isRestricted,
    readError: snapshot.readError,
    retainedInput: snapshot.retainedInput,
    conflict: snapshot.conflict,
    recoveryDraftId: snapshot.recoveryDraftId,
    preservedDrafts: snapshot.preservedDrafts,
    needsExplicitSave: snapshot.needsExplicitSave,
    resolveConflict: async (reviewedRevision: number) => {
      if (readOnly.current) { report('Case 已关闭，不能保存草稿；原输入仍保留。'); return false; }
      try {
        const resolved = await controller.resolveConflict(reviewedRevision);
        report(resolved ? '' : '冲突草稿已有变化，请重新核对当前显示的修订。');
        return resolved;
      } catch {
        report('对方草稿尚未确认保全，双方输入均保留；当前不会覆盖原草稿。');
        return false;
      }
    },
    discardLocal: () => { controller.discardLocal(); report(''); },
    flush,
  };
}
