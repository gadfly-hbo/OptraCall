import { useEffect, useState } from 'react';
import type { ExternalWorkSummaryEntry } from '../external-work-types.ts';
import { cancelExternalWork, externalDispatchErrorText, pauseExternalResume, readTaskExternalDispatch, resumeExternalResume, type ExternalDispatchView } from './external-dispatch-client.ts';
import './external-dispatch.css';

/**
 * 外部协作页（冻结 Demo `#work` 的生产实现）：一段工作，始终回到原任务。
 * 所有状态来自真实 Host 台账摘要（发布/领取/交付/核验分开的事实），
 * 不伪造"成功"字段；交付/资产/设置分区属于后续切片。
 */

export type WorkStatusTone = 'green' | 'amber' | 'red' | 'gray';
/** Composed strictly from ledger facts; never a merged success flag. */
export function externalWorkStatusView(entry: ExternalWorkSummaryEntry): { label: string; tone: WorkStatusTone } {
  if (entry.status === 'cancelled') return { label: '取消待核', tone: 'red' };
  const created = entry.publications.find(item => item.action === 'issue-create');
  if (created && (created.status === 'unknown' || created.status === 'prepared' || created.status === 'submitted')) return { label: '发布待核 · UNKNOWN', tone: 'amber' };
  if (created && created.status === 'rejected') return { label: '发布被拒', tone: 'red' };
  if (!created || created.status !== 'succeeded') return { label: '准备发布', tone: 'gray' };
  if (entry.latestReview?.decision === 'accepted') return { label: '已接受', tone: 'green' };
  if (entry.latestReview?.decision === 'needs-supplement') return { label: '需补充', tone: 'amber' };
  if (entry.latestReview?.decision === 'rejected') return { label: '需重派', tone: 'red' };
  if (entry.deliveryCount > entry.reviewCount) return { label: '待验收', tone: 'amber' };
  if (entry.claim && entry.claim.status === 'active') return { label: '执行中', tone: 'green' };
  return { label: '待领取', tone: 'gray' };
}

const statusDescription = (entry: ExternalWorkSummaryEntry, status: { label: string }): string => {
  if (entry.status === 'cancelled') return '外派已取消：新的领取与资产访问资格已撤回；外部动作的实际停止状态以台账核定为准，不假称已停止。原任务不受影响。';
  switch (status.label) {
    case '准备发布': return '我正把已确认的目标和准确资产引用整理为外派工作。';
    case '发布待核 · UNKNOWN': return '正在核对 GitHub 发布回执。发布结果确认前不会重复发单，也不会盲重发。';
    case '发布被拒': return '发布被连接或仓库权限拒绝；原授权不变，可在授权内修正后重新发布。';
    case '待领取': return '工单已确认发布。等待指定执行者按可信身份领取；GitHub 留言不授予身份或资产权限。';
    case '执行中': return '指定执行者已取得 Host 台账中的唯一有效领取。我会在授权内跟进并核对交付。';
    case '待验收': return '交付已按原领取回交并保全。我正核验引用与交付内容；接受与验收只由原任务作出。';
    case '已接受': return '我已在授权内核验并接受这一工作片段。原任务可继续；资料仍未成为正式资产。';
    case '需补充': return '发现差异或定位不足。我已要求补充：同一工作继续，旧交付保留可查，不自动扩大范围。';
    default: return '工作状态待核定；已保留全部台账事实，不自动重派。';
  }
};

const githubState = (entry: ExternalWorkSummaryEntry): string => {
  const created = entry.publications.find(item => item.action === 'issue-create');
  if (!created) return '准备发布';
  if (created.status === 'unknown' || created.status === 'prepared' || created.status === 'submitted') return '发布结果待核';
  if (created.status === 'rejected') return 'Open · 发布被拒';
  return entry.latestReview?.decision === 'accepted' ? 'Closed · 已回传' : 'Open · 已关联';
};
const hostState = (entry: ExternalWorkSummaryEntry, status: { label: string }): string => {
  if (entry.status === 'cancelled') return '已取消 · 外部停止待核';
  if (status.label === '已接受') return '已接受这一片段';
  if (status.label === '待验收') return 'Agent 正在核验';
  return '尚未接受';
};

type TimelineItem = { time: string; label: string; body: string };
const timelineOf = (view: ExternalDispatchView): TimelineItem[] => {
  const items: TimelineItem[] = [];
  for (const work of view.summary.works) {
    items.push({ time: work.createdAt, label: work.status === 'cancelled' ? '外派已取消' : '外派授权已确认', body: work.status === 'cancelled' ? '授权范围内的领取与资产访问已撤回；等待外部停止核定。' : `授权版本 ${work.grantVersion} · 工作片段：${work.summary}` });
    for (const publication of work.publications) {
      items.push({ time: work.createdAt, label: publication.action === 'issue-create' ? 'GitHub 工单发布' : 'GitHub 工单追加', body: `${publication.action} · ${publication.status}${publication.issueId ? ` · Issue #${publication.issueId}` : ''}` });
    }
    if (work.claim) items.push({ time: work.claim.leaseDeadline, label: '有效领取', body: `principal ${work.claim.principal} · epoch ${work.claim.epoch} · 租约至 ${work.claim.leaseDeadline}` });
    if (work.deliveryCount > 0) items.push({ time: work.createdAt, label: '外部交付已保全', body: `${work.deliveryCount} 份交付进入原任务核验` });
    if (work.latestReview) items.push({ time: work.createdAt, label: work.latestReview.decision === 'accepted' ? '核验：已接受' : work.latestReview.decision === 'needs-supplement' ? '核验：需补充' : '核验：已拒绝', body: work.latestReview.reason });
  }
  return items.sort((a, b) => Date.parse(a.time) - Date.parse(b.time));
};

export type ExternalWorkPanelProps = {
  projectId: string;
  taskId: string;
  taskName: string;
  archived?: boolean;
  panel: string;
  externalCount?: number;
  onSwitchPanel(panel: 'chat' | 'report' | 'external'): void;
  onOpenDrawer(): void;
};

export function ExternalWorkPanel({ projectId, taskId, taskName, archived, panel, externalCount, onSwitchPanel, onOpenDrawer }: ExternalWorkPanelProps) {
  const [view, setView] = useState<ExternalDispatchView>();
  const [error, setError] = useState('');
  const [actionError, setActionError] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState<string>();
  const [nonce, setNonce] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setView(undefined); setError('');
    readTaskExternalDispatch(projectId, taskId, controller.signal)
      .then(value => { if (!controller.signal.aborted) { setView(value); setError(''); } })
      .catch(fault => { if (!controller.signal.aborted && (fault as Error).name !== 'AbortError') setError(externalDispatchErrorText(fault)); });
    return () => controller.abort();
  }, [projectId, taskId, nonce]);
  const refresh = () => setNonce(value => value + 1);
  const run = async (operation: () => Promise<unknown>) => {
    setBusy(true); setActionError('');
    try { await operation(); refresh(); }
    catch (fault) { setActionError(externalDispatchErrorText(fault)); }
    finally { setBusy(false); }
  };
  const works = view?.summary.works ?? [];
  const activeWorks = works.filter(work => work.status !== 'cancelled');
  const tabs = [
    { key: 'chat' as const, label: '任务对话', icon: 'pv-chat-icon' },
    { key: 'report' as const, label: '结论报告', icon: 'pv-paper-icon' },
  ];
  return <div className="external-work-page">
    <div className="task-mode-strip" role="region" aria-label="任务视图与来源">
      <div className="task-mode-strip-inner">
        <div className="task-mode-tabs" role="group" aria-label="任务工作视图">
          {tabs.map(tab => <button key={tab.key} type="button" aria-pressed={false} onClick={() => onSwitchPanel(tab.key)}><span className={tab.icon} aria-hidden="true" />{tab.label}</button>)}
          <button type="button" aria-pressed={panel === 'external'} onClick={() => onSwitchPanel('external')}>
            外部协作{externalCount ? <span className="ed-tab-count">{externalCount}</span> : null}
          </button>
        </div>
        <div className="task-mode-source-case"><span>原任务 · <strong>{taskName}</strong></span></div>
      </div>
    </div>
    <div className="external-work-scroll">
      <header className="page-heading external-work-heading">
        <div><p className="eyebrow">EXTERNAL COLLABORATION</p><h1>一段工作，始终回到原任务</h1><p>Host 原子工作台账保存发布、领取、交付和验收状态；GitHub 仅承载通信与证据。</p></div>
        <button type="button" className="text-button" onClick={() => onSwitchPanel('chat')}>← 继续查看原任务</button>
      </header>
      {(error || actionError) && <div className="ed-notice" data-tone="error" role="alert">{actionError || error}<button type="button" className="text-button" onClick={refresh}>刷新台账状态</button></div>}
      {!view && !error && <p className="ed-notice" role="status">正在读取外派台账…</p>}
      {view && !works.length && <section className="ed-card" aria-label="外派建议">
        <div className="ed-card-body">
          <h2>把适合外部能力的片段交出去</h2>
          <p className="ed-lead">{taskName}</p>
          <div className="ed-callout section-space">Agent 会准备、发布、跟进并验收。你只需一次确认业务目标与必要权限；逐条读取、评论和回执由 Agent 在授权范围内处理。未授权不发单、不触发外部执行者。</div>
          <button type="button" className="primary-button" disabled={Boolean(archived) || busy} onClick={onOpenDrawer}>查看外派建议与授权</button>
        </div>
      </section>}
      {view && works.length > 0 && <div className="external-work-grid">
        <div className="ed-stack">
          {works.map(work => {
            const status = externalWorkStatusView(work);
            return <section className="ed-card" key={work.workId} aria-label={`外派工作 ${work.summary}`}>
              <div className="ed-card-body">
                <div className="ed-status-heading">
                  <div className="ed-status-symbol" aria-hidden="true">⇄</div>
                  <div>
                    <div className="ed-row-wrap"><h2>{work.summary}</h2><span className="ed-pill" data-tone={status.tone}>{status.label}</span></div>
                    <p className="ed-muted">GitHub Issue 渠道 · 授权版本 {work.grantVersion} · 修订 r{work.revision}</p>
                  </div>
                </div>
                <p className="ed-status-text">{statusDescription(work, status)}</p>
                <div className="ed-callout ed-resource">通用 GitHub 接单：WorkBuddy 触发 0 次，不申请其额度。1 个工作片段；发布 UNKNOWN 不盲重发。</div>
                <div className="ed-two-stat section-space">
                  <div className="ed-stat-box"><small>GitHub 通信 / 证据</small><strong>{githubState(work)}</strong></div>
                  <div className="ed-stat-box"><small>Host 台账 / 原任务验收</small><strong>{hostState(work, status)}</strong></div>
                </div>
                <div className="ed-actions section-space">
                  <button type="button" className="text-button" onClick={onOpenDrawer}>查看本次授权</button>
                  {work.status === 'authorized' && !archived && (confirmCancel === work.workId
                    ? <span className="ed-cancel-confirm">
                        <span className="ed-callout amber" data-tone="amber">取消外派将撤回新的领取与资产访问资格，并记录外部停止请求；外部动作的实际停止状态以台账核定为准，不假称已停止。原任务不受影响。</span>
                        <button type="button" className="secondary-button" disabled={busy} onClick={() => setConfirmCancel(undefined)}>保留外派</button>
                        <button type="button" className="secondary-button ed-danger" disabled={busy} onClick={() => void run(() => cancelExternalWork(projectId, taskId, work.workId, '从原任务取消外派'))}>确认取消外派</button>
                      </span>
                    : <button type="button" className="text-button ed-danger-text" disabled={busy} onClick={() => setConfirmCancel(work.workId)}>取消外派并撤回访问</button>)}
                  {work.status === 'cancelled' && <span className="ed-muted">外部停止请求已记录；迟到或未核事实保留在台账。</span>}
                </div>
              </div>
            </section>;
          })}
          <section className="ed-card" aria-label="工作交接与回执">
            <div className="ed-card-head"><h2>工作交接与回执</h2></div>
            <div className="ed-card-body">
              <div className="ed-receipt">
                {works.flatMap(work => work.publications.map(publication => <div className="ed-receipt-row" key={publication.operationId}>
                  <strong>{publication.action === 'issue-create' ? 'GitHub 工单' : '工单追加'}{publication.issueId ? ` · Issue #${publication.issueId}` : ''}</strong>
                  <span className="ed-mono">{publication.status}{publication.issueId ? ` · issueId ${publication.issueId}` : ''}</span>
                  <details className="ed-preview"><summary>预览工单记录</summary><dl>
                    <div><dt>操作身份</dt><dd className="ed-mono">{publication.operationId}</dd></div>
                    <div><dt>状态</dt><dd>{publication.status}</dd></div>
                    <div><dt>动作</dt><dd>{publication.action}</dd></div>
                  </dl><p className="ed-muted">工单正文哈希保留在 Host 台账；确切出站内容以授权快照与台账为准，本页不代外部宣称内容。</p></details>
                </div>))}
                {!works.some(work => work.publications.length) && <p className="ed-muted">授权范围已固定，正在准备外派内容；还没有对外发布记录。</p>}
              </div>
            </div>
          </section>
        </div>
        <aside className="ed-stack">
          <section className="ed-card" aria-label="Host 工作台账">
            <div className="ed-card-head"><h2>Host 工作台账 · 自主推进</h2></div>
            <div className="ed-card-body">
              {timelineOf(view).map((item, index) => <div className="ed-event" key={`${item.time}-${index}`}>
                <div className="ed-when">{item.time}<span className="ed-source"> · OptraCall Host 台账</span></div>
                <strong>{item.label}</strong>
                <p>{item.body}</p>
              </div>)}
            </div>
          </section>
          <section className="ed-card" aria-label="三个边界">
            <div className="ed-card-head"><h2>三个边界</h2></div>
            <div className="ed-card-body">
              <div className="ed-list-row"><div><strong>工单 / GitHub</strong><small>传递要求、领取、评论与回传</small></div></div>
              <div className="ed-list-row"><div><strong>远端 MCP / 两组权限</strong><small>资产只读；工作领取、续租与交付</small></div></div>
              <div className="ed-list-row"><div><strong>验收 / 原任务 Agent</strong><small>空闲且授权有效时核验并沿原工具保存</small></div></div>
            </div>
          </section>
          <section className="ed-card" aria-label="本任务自动续接">
            <div className="ed-card-head"><h2>本 Task 自动续接</h2></div>
            <div className="ed-card-body">
              {view.pause
                ? <p className="ed-callout amber" data-tone="amber">本 Task 自动续接已暂停（{view.pause.reason}）；外部工作及其授权继续有效。这不会停止外部执行者。恢复后仅在授权有效、模型空闲时继续处理。</p>
                : <p className="ed-muted">外部交付到达后，原任务在空闲且授权有效时自动核验续接。</p>}
              {!archived && (view.pause
                ? <button type="button" className="secondary-button" disabled={busy} onClick={() => void run(() => resumeExternalResume(projectId, taskId))}>恢复本 Task 续接</button>
                : <button type="button" className="text-button" disabled={busy || !activeWorks.length} onClick={() => void run(() => pauseExternalResume(projectId, taskId, 'manual'))}>暂停本 Task 续接</button>)}
            </div>
          </section>
        </aside>
      </div>}
    </div>
  </div>;
}
