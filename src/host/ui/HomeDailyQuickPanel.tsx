import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { HomePendingItem, HomePendingProjection } from '../home-pending.ts';
import type { ClientProject } from './project-types.ts';
import { readHomePending } from './workspace-daily-client.ts';
import { CasePreparation } from './CasePreparation.tsx';
import { CaseRequestError } from './case-client.ts';
import { caseError } from './CaseDialogs.tsx';

type Props = {
  refreshToken?: number;
  onOpenCase: (caseId: string, issueId?: string) => void;
  onCreateCase: () => void;
  onOpenAllProjects: () => void;
  onOpenAllCases?: () => void;
  onOpenProject?: (projectId: string) => void;
  independentProjects?: ClientProject[];
  projects?: ClientProject[];
  foundationContent?: ReactNode;
  onOpenRequest?: (item: HomePendingItem) => void;
  hidePreparation?: boolean;
  onRegisterFlush?: (flush: (() => Promise<boolean>) | null) => void;
};

export function HomeDailyQuickPanel({ refreshToken = 0, onOpenCase, onCreateCase, onOpenAllProjects, onOpenAllCases, onOpenProject, independentProjects = [], projects = [], foundationContent, onOpenRequest, hidePreparation = false, onRegisterFlush }: Props) {
  const [projection, setProjection] = useState<HomePendingProjection | null>(null);
  const [loadError, setLoadError] = useState('');
  const [staleSnapshot, setStaleSnapshot] = useState(false);
  const preparationFlush = useRef<(() => Promise<boolean>) | null>(null);
  const registerFlush = (flush: (() => Promise<boolean>) | null) => { preparationFlush.current = flush; onRegisterFlush?.(flush); };
  const navigate = async (action: () => void) => { if (!preparationFlush.current || await preparationFlush.current()) action(); };
  const openRequest = (item: HomePendingItem) => { void navigate(() => onOpenRequest ? onOpenRequest(item) : onOpenCase(item.caseId, item.issueId)); };
  useEffect(() => {
    let alive = true;
    void readHomePending().then(data => { if (alive) { setProjection(data); setLoadError(''); setStaleSnapshot(false); } }, err => { if (alive) { if (err instanceof CaseRequestError && err.status === 403) { setProjection(null); setStaleSnapshot(false); } else setStaleSnapshot(true); setLoadError(caseError(err)); } });
    return () => { alive = false; };
  }, [refreshToken]);
  return <section className="home-daily-panel" aria-label="Decision Case 日常工作台">
    {!hidePreparation && <CasePreparation refreshToken={refreshToken} onOpenCase={onOpenCase} onCreateCase={onCreateCase} onOpenAllProjects={onOpenAllProjects} onRegisterFlush={registerFlush} />}
    {loadError && <p className="case-error" role="alert">待处理事项读取失败：{loadError}</p>}
    {projection && staleSnapshot && <p className="case-help" role="status">当前为上次成功读取的快照，最新状态未核实；打开原记录后请重新核对。</p>}
    <div className="home-daily-grid">
      <div className="home-daily-main-column">
        <section className="home-daily-card home-daily-pending" aria-label="待处理事项">
          <div className="home-daily-section-head"><h2>待处理事项 <span className="home-daily-count">{projection?.pending.length ?? '—'}</span></h2><small>有明确来源的回应请求</small></div>
          {!projection ? <p className="home-daily-empty">{loadError ? '待处理记录尚未读到，请恢复读取后核对。' : '正在读取明确请求…'}</p> : projection.pending.length === 0 ? <p className="home-daily-empty">当前没有明确待回应的取舍或观察请求。已保存的回应仍保留在原事项中。</p> : <ul className="home-daily-list">
            {projection.pending.map(item => <li key={`${item.requestId}@${item.revision}`} className="home-daily-item home-daily-request">
              <div>
                <button type="button" className="home-request-title" onClick={() => openRequest(item)}>{item.actionLabel} · {item.issueTitle}</button>
                <div className="home-request-owner">{item.caseTitle} / {item.issueTitle}{typeof item.roundNumber === 'number' && Number.isSafeInteger(item.roundNumber) && item.roundNumber > 0 ? ` · 第 ${item.roundNumber} 轮` : ' · 轮次待核'}{item.target.kind === 'choose' ? ` · 策略 v${item.target.strategyRef.revision}` : ''}</div>
                <p>{item.text}</p>
                <button type="button" className="home-request-source" onClick={() => openRequest(item)}>原请求 · {item.requestedAt.slice(0, 10)} · 承担人 {item.assignee.label || '尚未明确'}{item.dueDate ? ` · 期限 ${item.dueDate}` : ''}</button>
              </div>
              <button type="button" className="secondary-button" onClick={() => openRequest(item)}>{item.kind === 'choose' ? '去记录取舍' : '去回录观察'}</button>
            </li>)}
          </ul>}
        </section>
        <section className="home-daily-card home-daily-continue" aria-label="继续工作">
          <div className="home-daily-section-head"><h2>继续工作</h2><button type="button" className="text-button" onClick={() => { void navigate(onOpenAllCases ?? onOpenAllProjects); }}>全部 Case</button></div>
          {projection?.continueWork.map(item => <article key={item.caseId} className="home-continue-row"><span className="home-continue-icon" aria-hidden="true">▱</span><div><button type="button" onClick={() => { void navigate(() => onOpenCase(item.caseId, item.issueId ?? undefined)); }}>{item.caseTitle}</button><p>{item.issueTitle ? `事项：${item.issueTitle}` : item.issueCount ? `${item.issueCount} 件事项 · 打开 Case 选择继续` : item.issueCount === 0 ? '尚无事项，可先继续项目工作' : '打开 Case 查看原事项与项目'}{item.nextStep ? ` · ${item.nextStep}` : ''}</p></div></article>)}
          {independentProjects.slice(0, 3).map(project => <article key={project.id} className="home-continue-row"><span className="home-continue-icon" aria-hidden="true">▰</span><div><button type="button" onClick={() => { void navigate(() => onOpenProject ? onOpenProject(project.id) : onOpenAllProjects()); }}>{project.name}</button><p>独立项目 · 无关联 Case · 可以直接继续原任务</p></div></article>)}
          {!projection?.continueWork.length && !independentProjects.length && <div className="home-daily-empty">从上方写下想推进的工作，或直接打开已有项目。<button type="button" className="text-button" onClick={() => { void navigate(onOpenAllProjects); }}>查看全部项目</button></div>}
        </section>
      </div>
      <aside className="home-daily-side">
        <section className="home-daily-card home-daily-progress" aria-label="外部等待">
          <div className="home-daily-section-head"><h2>进展关注</h2><small>外部等待</small></div>
          {projection?.externalWaitingLimited && <p className="case-help" role="status">部分项目进展暂不可读取，以下仅展示已核实的等待记录。</p>}
          {projection?.externalWaiting.length ? projection.externalWaiting.map(item => {
            const projectId = item.source?.projectId;
            const project = projectId ? projects.find(p => p.id === projectId) : null;
            return <article key={projectId ?? item.caseId} className="home-progress-follow"><h3>{project?.name ?? (projectId ? '项目等待反馈' : item.caseTitle)}</h3><p>{item.reason}</p><span className="home-progress-meta">{item.relatedCases?.length ? item.relatedCases.map(c => c.caseTitle).join(' / ') : item.caseTitle}{item.assignee ? ` · 承担人 ${item.assignee}` : ''}</span><span className="home-progress-meta">原记录保存于 {item.updatedAt.slice(0, 16).replace('T', ' ')}</span><button type="button" className="text-button" onClick={() => { void navigate(() => projectId && onOpenProject ? onOpenProject(projectId) : onOpenCase(item.caseId)); }}>{projectId ? '查看原项目记录' : '查看原 Case 记录'}</button></article>;
          }) : <p className="home-daily-empty">{projection?.externalWaitingLimited ? '目前读到的项目没有明确等待记录，其余进展仍待核对。' : projection ? '当前没有已记录的外部等待。' : '等待记录读取后展示进展。'}</p>}
        </section>
        {foundationContent}
      </aside>
    </div>
    {projection && (projection.unresolvedRequests.length > 0 || projection.pendingOperations.length > 0) && <details className="home-daily-recovery">
      <summary>待核原记录（{projection.unresolvedRequests.length + projection.pendingOperations.length}）</summary>
      {projection.unresolvedRequests.length > 0 && <section aria-label="已替代或待核请求"><h3>已替代 / 待核请求</h3><p className="case-help">以下请求因换轮被替代或来源待核，未视为已回应。</p>{projection.unresolvedRequests.map(item => <article key={`${item.requestId}@${item.revision}`} className="home-daily-item"><div><strong>{item.caseTitle} · {item.issueTitle}</strong><p>{item.text}</p><span className="case-help">{item.status === 'superseded' ? '已替代' : '待核'}</span></div><button type="button" className="text-button" onClick={() => openRequest(item)}>核对原事项</button></article>)}</section>}
      {projection.pendingOperations.length > 0 && <section aria-label="原操作待核"><h3>原操作待核</h3><p className="case-help">以下保存操作尚未确认完成，请先核对原结果。</p>{projection.pendingOperations.map(op => <article key={op.operationId} className="home-daily-item"><span>{op.kind} · {op.phase}</span>{op.caseId && <button type="button" className="text-button" onClick={() => { void navigate(() => onOpenCase(op.caseId!)); }}>核对</button>}</article>)}</section>}
    </details>}
    <p className="home-daily-identity-note">待处理依据原请求的承担人与回应记录汇总。普通建议、未知承担人和外部等待，不自动成为“你的待办”。</p>
  </section>;
}
