import { useEffect, useState } from 'react';
import type { ExternalTaskSummary } from '../external-work-types.ts';
import { chooseInternalCompletion, externalDispatchErrorText, readTaskExternalDispatch } from './external-dispatch-client.ts';
import { externalWorkStatusView } from './ExternalWorkPanel.tsx';
import './external-dispatch.css';

/**
 * 右栏「工作方式」卡（冻结 Demo collabCard 的生产实现）：
 * 未授权零外部注记；[在 OptraCall 内完成] 主 / [通过 GitHub 外派] 次；
 * 已外派时改为真实台账状态摘要 + 查看协作进展。内部选择仅记录意图，零出站动作。
 */

export type TaskWorkModeCardProps = {
  projectId: string;
  taskId: string;
  suggestion: string;
  busy?: boolean;
  archived?: boolean;
  refreshToken?: number;
  onSummary(summary: ExternalTaskSummary): void;
  onAuthorize(): void;
  onOpenWork(): void;
};

export function TaskWorkModeCard({ projectId, taskId, suggestion, busy, archived, refreshToken, onSummary, onAuthorize, onOpenWork }: TaskWorkModeCardProps) {
  const [view, setView] = useState<ExternalTaskSummary>();
  const [error, setError] = useState('');
  const [actionError, setActionError] = useState('');
  const [working, setWorking] = useState(false);
  const [nonce, setNonce] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    readTaskExternalDispatch(projectId, taskId, controller.signal)
      .then(value => { if (!controller.signal.aborted) { setView(value.summary); setError(''); onSummary(value.summary); } })
      .catch(fault => { if (!controller.signal.aborted && (fault as Error).name !== 'AbortError') setError(externalDispatchErrorText(fault)); });
    return () => controller.abort();
    // onSummary is a state setter from the parent; it stays stable across renders.
  }, [projectId, taskId, nonce, refreshToken]);
  const activeWorks = view?.works.filter(work => work.status !== 'cancelled') ?? [];
  const latest = activeWorks[activeWorks.length - 1];
  const status = latest ? externalWorkStatusView(latest) : undefined;
  const chooseInternal = async () => {
    setWorking(true); setActionError('');
    try { await chooseInternalCompletion(projectId, taskId); setNonce(value => value + 1); }
    catch (fault) { setActionError(externalDispatchErrorText(fault)); }
    finally { setWorking(false); }
  };
  return <section className="ed-card task-work-mode-card" aria-label="工作方式">
    <div className="ed-card-head">
      <h2>工作方式</h2>
      {status ? <span className="ed-pill" data-tone={status.tone}>{status.label}</span> : view?.internalChoice ? <span className="ed-pill" data-tone="gray">内部继续</span> : <span className="ed-pill" data-tone="gray">可自主选择</span>}
    </div>
    <div className="ed-card-body">
      {error && <div className="ed-notice" data-tone="error" role="alert">{error}<button type="button" className="text-button" onClick={() => setNonce(value => value + 1)}>重新读取</button></div>}
      {status && latest ? <>
        <h3>{latest.summary}</h3>
        <dl className="ed-meta section-space">
          <div><dt>外派渠道</dt><dd>GitHub Issue{latest.publications.some(item => item.action === 'issue-create' && item.issueId) ? ` · Issue #${latest.publications.find(item => item.action === 'issue-create')!.issueId!}` : ''}</dd></div>
          <div><dt>执行方式</dt><dd>{latest.claim ? `已领取 · ${latest.claim.principal}` : '已批准通用 Agent 集合 · 首个认证有效领取'}</dd></div>
          <div><dt>状态</dt><dd>{status.label} · 交付 {latest.deliveryCount} · 核验 {latest.reviewCount}</dd></div>
        </dl>
        <button type="button" className="primary-button section-space" onClick={onOpenWork}>查看协作进展 →</button>
      </> : <>
        <div className="eyebrow">Agent 的建议</div>
        <h3>{suggestion}</h3>
        <p>这段工作可借助外部能力。你也可以选择在 OptraCall 内完成；若现有能力不足，我会说明并由你决定。</p>
        <div className="ed-actions section-space">
          <button type="button" className="primary-button" disabled={Boolean(busy) || Boolean(archived) || working} onClick={() => void chooseInternal()}>在 OptraCall 内完成</button>
          <button type="button" className="secondary-button" disabled={Boolean(busy) || Boolean(archived) || working} onClick={onAuthorize}>通过 GitHub 外派</button>
        </div>
        {view?.internalChoice && <p className="ed-muted section-space">已记录按内部方式继续；这条选择不触发任何外部动作。</p>}
        {actionError && <p className="ed-notice" data-tone="error" role="alert">{actionError}</p>}
        <p className="ed-muted section-space">未授权不发单、不触发外部执行者、不开放外部资产。内部工作沿原权限继续，无需配置任何外派连接。</p>
      </>}
    </div>
  </section>;
}
