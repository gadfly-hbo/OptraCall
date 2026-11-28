import { useEffect, useRef, useState } from 'react';
import type { useCaseActionDraft } from './useCaseActionDraft.ts';
import { readWorkspaceDraft } from './workspace-daily-client.ts';
import type { CaseActionDraftPayload } from './case-action-draft.ts';

const labels: Record<string, string> = { planId: '准确方案', choice: '本轮取舍', reason: '选择理由', nextStep: '接下来', outcome: '实际观察', metricDelta: '指标变化', review: '原判断修订／仍未知', executed: '是否按建议执行', effect: '效果判断', score: '主观评分', responseKey: '原请求', observationDate: '观察日期', sourceScope: '来源与范围' };
function InputValues({ value }: { value: Record<string, unknown> }) {
  const fields = value.form && typeof value.form === 'object' ? value.form as Record<string, unknown> : value;
  return <dl>{Object.entries(fields).filter(([key, item]) => labels[key] && typeof item === 'string').map(([key, item]) => <div key={key}><dt>{labels[key]}</dt><dd>{String(item || '未填写')}</dd></div>)}</dl>;
}
/** Only appears when durable input needs the user's explicit conflict or permission decision. */
export function CaseActionDraftRecovery<T extends Record<string, unknown>>({ draft, owner, onDiscard }: { draft: ReturnType<typeof useCaseActionDraft<T>>; owner: { id: string; caseId: string; issueId: string; kind: 'choice'|'feedback' }; onDiscard(): void }) {
  const [busy, setBusy] = useState(false);
  const expectedBackup = draft.preservedDrafts?.find(value => value.id === draft.recoveryDraftId);
  const key = `${owner.id}/${draft.recoveryDraftId ?? ''}/${expectedBackup?.sourceRevision ?? ''}`;
  const [readback, setReadback] = useState<{ key: string; value: Record<string, unknown> | null; error: string }>({ key, value: null, error: '' });
  const serial = useRef(0);
  useEffect(() => { serial.current++; setReadback({ key, value: null, error: '' }); return () => { serial.current++; }; }, [key]);
  const backup = readback.key === key ? readback.value : null, error = readback.key === key ? readback.error : '';
  async function readBackup() {
    const id = draft.recoveryDraftId;
    if (!id) return;
    const generation = ++serial.current;
    setReadback({ key, value: null, error: '' });
    try {
      const value = await readWorkspaceDraft<CaseActionDraftPayload<T>>('issue-draft', id);
      if (generation !== serial.current) return;
      const record = value.draft, payload = record.payload;
      if (record.id !== id || record.kind !== 'issue-draft' || payload.caseId !== owner.caseId || payload.issueId !== owner.issueId || payload.actionForm.kind !== owner.kind
        || payload.recovery?.originalId !== owner.id || !Number.isSafeInteger(payload.recovery.sourceRevision) || payload.recovery.sourceRevision < 1 || expectedBackup && payload.recovery.sourceRevision !== expectedBackup.sourceRevision) throw Error('recovery_owner_mismatch');
      setReadback({ key, value: payload.actionForm.fields, error: '' });
    } catch { if (generation === serial.current) setReadback({ key, value: null, error: '保留副本暂不可读取或准确归属未能核对。' }); }
  }
  if (!draft.conflict && !draft.isRestricted && !draft.error && !draft.recoveryDraftId) return null;
  return <section className="case-action-draft-recovery" aria-label="保护未保存输入">
    {draft.isRestricted && <p role="alert">原草稿已不可读取，旧内容已移除，当前不能编辑或提交。可以复制本次新输入后关闭。</p>}
    {draft.retainedInput && <div><h4>本次新输入（尚未保存）</h4><InputValues value={draft.retainedInput}/></div>}
    {draft.conflict && <><p>另一处已保存了更新的草稿。请对照后再决定，当前输入仍保留。</p><details open><summary>已读取的另一版本 · v{draft.conflict.revision}</summary><InputValues value={draft.conflict.value}/></details><button type="button" className="secondary-button" disabled={busy} onClick={async () => { const revision = draft.conflict?.revision; if (revision === undefined) return; setBusy(true); try { if (await draft.resolveConflict(revision)) await draft.flush(); } finally { setBusy(false); } }}>保留另一版本，并保存我的输入</button></>}
    {draft.recoveryDraftId && <details><summary>已保留另一版本的副本</summary><button type="button" className="text-button" onClick={() => { void readBackup(); }}>回读保留副本</button>{backup && <InputValues value={backup}/>}</details>}
    {draft.error && <p role="alert">{draft.error}</p>}{error && <p role="alert">{error}</p>}
    {!draft.isRestricted && !draft.conflict && draft.error && <button type="button" className="secondary-button" disabled={busy} onClick={async () => { setBusy(true); try { await draft.flush(); } finally { setBusy(false); } }}>重新核对并保存草稿</button>}
    {(draft.dirty || draft.retainedInput) && <button type="button" className="text-button" disabled={busy} onClick={() => { draft.discardLocal(); onDiscard(); }}>放弃本次未保存修改并关闭</button>}
  </section>;
}
