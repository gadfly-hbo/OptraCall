import { useEffect, useRef, useState } from 'react';
import type { HomePendingItem, HomePendingProjection } from '../home-pending.ts';
import { readHomePending } from './workspace-daily-client.ts';
import { CasePreparation } from './CasePreparation.tsx';
import { CaseRequestError } from './case-client.ts';
import { caseError } from './CaseDialogs.tsx';

type Props = {
  refreshToken?: number;
  onOpenCase: (caseId: string, issueId?: string) => void;
  onCreateCase: () => void;
  onOpenAllProjects: () => void;
  onOpenRequest?: (item: HomePendingItem) => void;
  hidePreparation?: boolean;
  onRegisterFlush?: (flush: (() => Promise<boolean>) | null) => void;
};

export function HomeDailyQuickPanel({ refreshToken = 0, onOpenCase, onCreateCase, onOpenAllProjects, onOpenRequest, hidePreparation = false, onRegisterFlush }: Props) {
  const [projection, setProjection] = useState<HomePendingProjection | null>(null);
  const [loadError, setLoadError] = useState('');
  const [staleSnapshot, setStaleSnapshot] = useState(false);
  const preparationFlush = useRef<(() => Promise<boolean>) | null>(null);
  const registerFlush = (flush: (() => Promise<boolean>) | null) => { preparationFlush.current = flush; onRegisterFlush?.(flush); };
  const navigate = async (action: () => void) => { if (!preparationFlush.current || await preparationFlush.current()) action(); };
  useEffect(() => {
    let alive = true;
    void readHomePending().then(data => { if (alive) { setProjection(data); setLoadError(''); setStaleSnapshot(false); } }, err => { if (alive) { if (err instanceof CaseRequestError && err.status === 403) { setProjection(null); setStaleSnapshot(false); } else setStaleSnapshot(true); setLoadError(caseError(err)); } });
    return () => { alive = false; };
  }, [refreshToken]);
  return <section className="home-daily-panel" aria-label="Decision Case 日常工作台">
    {!hidePreparation && <CasePreparation refreshToken={refreshToken} onOpenCase={onOpenCase} onCreateCase={onCreateCase} onOpenAllProjects={onOpenAllProjects} onRegisterFlush={registerFlush} />}
    {loadError && <p className="case-error" role="alert">待处理事项读取失败：{loadError}</p>}

    {projection && staleSnapshot && <p className="case-help" role="status">当前为上次成功读取的快照，最新状态未核实；打开原记录后请重新核对。</p>}
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
                  <p className="case-help">承担人：{item.assignee.label}（来源：{item.assignee.source}） · 提出于 {item.requestedAt.slice(0, 16)}{item.dueDate ? ` · 期限 ${item.dueDate}` : ''}</p>
                </div>
                <button type="button" className="secondary-button" onClick={() => { void navigate(() => onOpenRequest ? onOpenRequest(item) : onOpenCase(item.caseId, item.issueId)); }}>前往原事项回应</button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {projection.unresolvedRequests.length > 0 && (
        <div className="home-daily-card" role="region" aria-label="已替代或待核请求">
          <h3>已替代 / 待核请求（{projection.unresolvedRequests.length}）</h3>
          <p className="case-help">以下请求因换轮被替代或来源待核，未视为已回应。</p>
          <ul className="home-daily-list">
            {projection.unresolvedRequests.map(item => (
              <li key={`${item.requestId}@${item.revision}`} className="home-daily-item">
                <div>
                  <span className="case-issue-badge">{item.status === 'superseded' ? '已替代' : '待核'}</span>
                  <strong>{item.caseTitle} · {item.issueTitle}</strong>
                  <p>{item.text}</p>
                </div>
                <button type="button" className="text-button" onClick={() => { void navigate(() => onOpenRequest ? onOpenRequest(item) : onOpenCase(item.caseId, item.issueId)); }}>核对原事项</button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {projection.externalWaiting.length > 0 && (
        <div className="home-daily-card" role="region" aria-label="外部等待">
          <h3>外部等待（{projection.externalWaiting.length}）</h3>
          <ul className="home-daily-list">
            {projection.externalWaiting.map(w => (
              <li key={w.caseId} className="home-daily-item">
                <div><strong>{w.caseTitle}</strong><p className="case-help">{w.reason}</p></div>
                <button type="button" className="text-button" onClick={() => { void navigate(() => onOpenCase(w.caseId, w.issueId ?? undefined)); }}>查看</button>
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
                {op.caseId && <button type="button" className="text-button" onClick={() => { void navigate(() => onOpenCase(op.caseId!)); }}>核对</button>}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>}
  </section>;
}
