import { useEffect, useId, useState } from 'react';
import type { HomePendingProjection } from '../home-pending.ts';
import type { CaseDirectoryEntry } from '../case-directory.ts';
import type { PrepareDraftPayload, WorkspaceDraftRecord } from '../workspace-draft-store.ts';
import {
  discardWorkspaceDraft,
  listWorkspaceDrafts,
  readCaseDirectory,
  readHomePending,
  saveWorkspaceDraft,
} from './workspace-daily-client.ts';
import { caseError } from './CaseDialogs.tsx';

type Props = {
  refreshToken?: number;
  onOpenCase: (caseId: string, issueId?: string) => void;
  onCreateCase: () => void;
  onOpenAllProjects: () => void;
};

/**
 * Daily workspace home panel (DW08–DW14):
 * - Explicit requests ("待处理事项", never "待你确认"), separate from continueWork, externalWaiting, and pendingOperations ("原操作待核").
 * - Persistent light input / prepare draft with optional user-triggered directory lookup, carry-over fragment creation, and scoped discard.
 * - Manual path works without any LLM configured.
 */
export function HomeDailyQuickPanel({ refreshToken = 0, onOpenCase, onCreateCase, onOpenAllProjects }: Props) {
  const [projection, setProjection] = useState<HomePendingProjection | null>(null);
  const [loadError, setLoadError] = useState('');
  const [draftId, setDraftId] = useState('home-prepare-default');
  const [draftRev, setDraftRev] = useState(0);
  const [rawInput, setRawInput] = useState('');
  const [savedDrafts, setSavedDrafts] = useState<WorkspaceDraftRecord<PrepareDraftPayload>[]>([]);
  const [matches, setMatches] = useState<CaseDirectoryEntry[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const inputId = useId();

  useEffect(() => {
    let alive = true;
    setLoadError('');
    void readHomePending().then(
      data => { if (alive) setProjection(data); },
      err => { if (alive) setLoadError(caseError(err)); },
    );
    void listWorkspaceDrafts<PrepareDraftPayload>('prepare').then(
      ({ drafts }) => {
        if (!alive) return;
        setSavedDrafts(drafts);
        const latest = drafts.find(d => d.id === 'home-prepare-default') ?? drafts[0];
        if (latest) {
          setDraftId(latest.id);
          setDraftRev(latest.revision);
          setRawInput(latest.payload.rawInput ?? '');
        }
      },
      () => {},
    );
    return () => { alive = false; };
  }, [refreshToken]);

  async function persistPrepareDraft(nextText: string) {
    try {
      const prev = savedDrafts.find(d => d.id === draftId)?.payload;
      const res = await saveWorkspaceDraft<PrepareDraftPayload>('prepare', draftId, draftRev, {
        rawInput: nextText,
        title: prev?.title || nextText.slice(0, 60),
        description: nextText,
        selectedGoal: prev?.selectedGoal ?? null,
        adoptOperationId: prev?.adoptOperationId ?? crypto.randomUUID(),
        createOperationId: prev?.createOperationId ?? crypto.randomUUID(),
        adoptionReceipt: prev?.adoptionReceipt ?? null,
        creationReceipt: prev?.creationReceipt ?? null,
        creationState: prev?.creationState ?? 'idle',
        targetLocation: prev?.targetLocation ?? null,
      });
      setDraftRev(res.draft.revision);
      setSavedDrafts(old => [res.draft, ...old.filter(d => d.id !== res.draft.id)]);
      setNotice('输入已持久保存，切换页面或重开后可恢复。');
      setError('');
    } catch (e) {
      setError(caseError(e));
    }
  }

  async function organizeAndFind() {
    if (!rawInput.trim()) { setError('先写下一句话或背景，再整理与查找。'); return; }
    setSearching(true); setError(''); setNotice('');
    try {
      await persistPrepareDraft(rawInput);
      const dir = await readCaseDirectory(rawInput.trim().slice(0, 80), 10);
      setMatches(dir.items);
      if (!dir.items.length) setNotice('当前获准 Case 中暂无匹配项，可直接人工准备新 Case 或手动选择已有 Case。');
    } catch (e) {
      setError(caseError(e));
    } finally {
      setSearching(false);
    }
  }

  async function carryToCase(entry: CaseDirectoryEntry) {
    const issueId = entry.issues[0]?.issueId ?? null;
    try {
      const fragId = `frag-${crypto.randomUUID()}`;
      await saveWorkspaceDraft('carry-over', fragId, 0, {
        originalText: rawInput.trim(),
        origin: { kind: 'home-input', label: '工作台首页轻输入', ref: draftId },
        targetCaseId: entry.caseId,
        targetIssueId: issueId,
        appendedAt: null,
      });
      setNotice(`已保留待带入片段，正在打开「${entry.title}」（不会自动覆盖既有草稿或发送）。`);
      onOpenCase(entry.caseId, issueId ?? undefined);
    } catch (e) {
      setError(caseError(e));
    }
  }

  async function discardCurrentDraft() {
    try {
      await discardWorkspaceDraft('prepare', draftId);
      setRawInput('');
      setDraftRev(0);
      setMatches(null);
      setNotice('已放弃此准备草稿；已保存的目标与 Case 均保留。');
    } catch (e) {
      setError(caseError(e));
    }
  }

  return <section className="home-daily-panel" aria-label="Decision Case 日常工作台">
    <div className="home-daily-quick-input" role="region" aria-label="轻输入与准备">
      <div className="home-daily-row">
        <label htmlFor={inputId}><strong>先记下一句话、找归属或准备新 Case</strong></label>
        <div className="home-daily-actions">
          <button type="button" className="text-button" onClick={onOpenAllProjects}>全部项目</button>
          <button type="button" className="secondary-button" onClick={onCreateCase}>人工准备新 Case</button>
        </div>
      </div>
      <textarea
        id={inputId}
        rows={2}
        value={rawInput}
        onChange={e => setRawInput(e.target.value)}
        placeholder="例如：华东三家门店首周复购波动，想核对是否继续扩围…"
      />
      <div className="home-daily-actions">
        <button type="button" className="primary-button" disabled={searching || !rawInput.trim()} onClick={() => { void organizeAndFind(); }}>{searching ? '正在查找获准 Case…' : '整理与查找'}</button>
        <button type="button" className="secondary-button" disabled={!rawInput.trim()} onClick={() => { void persistPrepareDraft(rawInput); }}>保存草稿</button>
        {(rawInput || draftRev > 0) && <button type="button" className="text-button" onClick={() => { void discardCurrentDraft(); }}>放弃草稿</button>}
      </div>
      {notice && <p className="case-notice" role="status">{notice}</p>}
      {error && <p className="case-error" role="alert">{error}</p>}
      {matches && <div className="home-daily-matches" aria-label="获准 Case 候选">
        {matches.length === 0 ? <p className="case-help">无匹配 Case，可点击“人工准备新 Case”继续。</p> : matches.map(entry => (
          <div key={entry.caseId} className="home-daily-match-row">
            <div>
              <strong>{entry.title}</strong>
              <p className="case-help">{entry.issues.length ? `事项：${entry.issues.map(i => i.title).join('、')}` : '暂无独立事项'}</p>
            </div>
            <div className="home-daily-actions">
              <button type="button" className="secondary-button" onClick={() => { void carryToCase(entry); }}>带入此 Case</button>
              <button type="button" className="text-button" onClick={() => onOpenCase(entry.caseId, entry.issues[0]?.issueId)}>直接继续</button>
            </div>
          </div>
        ))}
      </div>}
      {savedDrafts.some(d => d.payload.creationState === 'partial_failed' || d.payload.creationState === 'partial_unknown') && (
        <div className="case-pending-operations" role="status">
          <strong>有未完成的 Case 创建草稿（已采纳目标保留）</strong>
          <p className="case-help">请核对原操作后继续创建，不会重复采纳目标。</p>
        </div>
      )}
    </div>

    {loadError && <p className="case-error" role="alert">待处理事项读取失败：{loadError}</p>}

    {projection && <div className="home-daily-grid">
      <div className="home-daily-card" role="region" aria-label={projection.pendingHeading}>
        <h3>{projection.pendingHeading}（{projection.pending.length}）</h3>
        {projection.pending.length === 0 ? (
          <p className="case-help">暂无明确待回应的取舍或观察请求；查看或普通报告不会自动生成待办。</p>
        ) : (
          <ul className="home-daily-list">
            {projection.pending.map(item => (
              <li key={`${item.requestId}@${item.revision}`} className="home-daily-item">
                <div>
                  <span className="case-issue-badge case-issue-badge-req">{item.actionLabel}</span>
                  <strong>{item.caseTitle} · {item.issueTitle}</strong>
                  <p>{item.text}</p>
                  <p className="case-help">承担人：{item.assignee.label}（来源：{item.assignee.source}）{item.dueDate ? ` · 期限 ${item.dueDate}` : ''}</p>
                </div>
                <button type="button" className="secondary-button" onClick={() => onOpenCase(item.caseId, item.issueId)}>前往原事项回应</button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {projection.externalWaiting.length > 0 && (
        <div className="home-daily-card" role="region" aria-label="外部等待">
          <h3>外部等待（{projection.externalWaiting.length}）</h3>
          <ul className="home-daily-list">
            {projection.externalWaiting.map(w => (
              <li key={w.caseId} className="home-daily-item">
                <div><strong>{w.caseTitle}</strong><p className="case-help">{w.reason}</p></div>
                <button type="button" className="text-button" onClick={() => onOpenCase(w.caseId, w.issueId ?? undefined)}>查看</button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {projection.pendingOperations.length > 0 && (
        <div className="home-daily-card" role="region" aria-label="原操作待核">
          <h3>原操作待核（{projection.pendingOperations.length}）</h3>
          <p className="case-help">以下为未确认完成的技术操作，与经营取舍请求分开显示。</p>
          <ul className="home-daily-list">
            {projection.pendingOperations.map(op => (
              <li key={op.operationId} className="home-daily-item">
                <span>{op.kind} · {op.phase}</span>
                {op.caseId && <button type="button" className="text-button" onClick={() => onOpenCase(op.caseId!)}>核对</button>}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>}
  </section>;
}
