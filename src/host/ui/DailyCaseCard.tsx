import { useEffect, useState } from 'react';
import type { CaseRecord } from '../case-types.ts';
import type { CaseDirectoryEntry } from '../case-directory.ts';
import { readCaseDirectory, readDecisionRequests } from './workspace-daily-client.ts';
import { goalRecord } from './case-client.ts';
import { caseIssueTimeline } from './case-decisions-client.ts';
import { caseStatusLabel } from './CaseDialogs.tsx';
import { projectCaseIssueProgress } from './case-issue-progress.ts';

/** Read the existing Case/goal/issue authorities; a card never creates or advances work. */
export function DailyCaseCard({ record, projectCount, selectedIssueId, onOpen }: {
  record: CaseRecord; projectCount: number; selectedIssueId?: string; onOpen(): void;
}) {
  const [entry, setEntry] = useState<CaseDirectoryEntry | null>(null);
  const [goal, setGoal] = useState('');
  const [round, setRound] = useState('');
  const [issue, setIssue] = useState<{ issueId: string; title: string } | null>(null);
  const [issueFailure, setIssueFailure] = useState('');
  const [failure, setFailure] = useState('');
  useEffect(() => {
    let alive = true;
    setEntry(null); setGoal(''); setRound(''); setIssue(null); setIssueFailure(''); setFailure('');
    void readCaseDirectory(undefined, 1, { caseId: record.id, includeClosed: true, issueLimit: 20 }).then(async result => {
      if (!alive) return;
      const item = result.items.find(item => item.caseId === record.id);
      if (!item) { setFailure('当前详情暂不可读'); return; }
      setEntry(item);
      // Directory rows are capped; a remembered issue outside the first page still has an exact identity.
      const issueId = selectedIssueId || item.issues[0]?.issueId;
      await Promise.all([
        item.goalBinding ? goalRecord(item.goalBinding.goalId).then(result => {
          if (alive) setGoal(result.goal.versions.find(version => version.version === item.goalBinding!.version)?.title ?? '原目标版本暂不可读');
        }, () => { if (alive) setGoal('原目标暂不可读'); }) : Promise.resolve(),
        issueId ? Promise.allSettled([caseIssueTimeline(record.id, issueId), readDecisionRequests(record.id)]).then(([timelineRead, requestsRead]) => {
          if (!alive) return;
          if (timelineRead.status !== 'fulfilled' || timelineRead.value.issue.id !== issueId || timelineRead.value.issue.caseId !== record.id) { setIssueFailure('原事项暂不可读'); setRound('本轮记录暂不可读'); return; }
          const timeline = timelineRead.value;
          setIssue({ issueId: timeline.issue.id, title: timeline.issue.title });
          const progress = projectCaseIssueProgress(timeline, requestsRead.status === 'fulfilled' ? requestsRead.value.requests : undefined);
          setRound(`${progress.roundLabel} · ${progress.phase}`);
        }) : Promise.resolve(),
      ]);
    }, () => { if (alive) setFailure('当前详情暂不可读'); });
    return () => { alive = false; };
  }, [record.id, record.revision, selectedIssueId]);
  return <article className="daily-case-card" data-case-id={record.id}>
    <div className="daily-case-card-top">
      <div className="daily-case-card-kicker"><span>{caseStatusLabel[record.status]}</span><span aria-hidden="true">▣</span></div>
      <h2><button type="button" onClick={onOpen}>{record.title}</button></h2>
      <div className="daily-case-card-gs"><span className="daily-gs-letter">G</span><span>{entry?.goalBinding ? goal || '正在读取原目标' : entry ? '目标待关联' : failure || '正在读取'}</span><span className="daily-gs-letter">S</span><span>{entry?.goalBinding?.strategy || '具体策略待补充'}</span></div>
    </div>
    <div className="daily-case-card-bottom">
      <div className="daily-case-card-counts"><span><strong>{entry?.totalIssues ?? '—'}</strong> 件事项</span><span><strong>{projectCount}</strong> 个关联项目</span></div>
      <small>{issue ? selectedIssueId === issue.issueId ? '上次选择的事项' : '当前事项' : issueFailure ? '上次事项待核' : entry && !entry.totalIssues && !selectedIssueId ? '当前还没有事项' : '事项读取中'}</small>
      <p className="daily-case-card-current">{issue?.title || issueFailure || failure || (entry && !entry.totalIssues && !selectedIssueId ? '可以先继续已有项目工作' : '正在读取原记录')}</p>
      <p className="daily-case-card-round">{round || (entry && !entry.totalIssues && !selectedIssueId ? '浏览不会自动创建事项' : '本轮记录读取中')}</p>
      <button type="button" className="secondary-button" onClick={onOpen}>{issue ? '继续当前事项' : '查看这个 Case'} <span aria-hidden="true">→</span></button>
    </div>
  </article>;
}
