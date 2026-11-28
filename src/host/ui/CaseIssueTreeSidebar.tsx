import { useEffect, useId, useMemo, useState } from 'react';
import type { CaseDecisionIssue, CaseIssueEdge } from '../case-decision-types.ts';
import type { CaseRecord } from '../case-types.ts';
import { CompactCaseIssueGraph } from './CompactCaseIssueGraph.tsx';
import { readDecisionRequests, readIssueEdges, saveIssueEdge, type CaseDecisionRequestView } from './workspace-daily-client.ts';
import { CaseFormError, caseError } from './CaseDialogs.tsx';
import type { CaseIssueTimeline } from './case-board-navigation-model.ts';
import { projectCaseIssueProgress, readCaseIssueViewMode, saveCaseIssueViewMode, type CaseIssueViewMode } from './case-issue-progress.ts';

type Props = {
  record: CaseRecord;
  issues: CaseDecisionIssue[];
  selectedIssueId: string;
  onSelectIssue: (issueId: string) => void;
  onChanged: () => void;
  onAddIssue?: () => void;
  timelines?: Record<string, CaseIssueTimeline>;
  timelineErrors?: Record<string, string>;
};

/**
 * Issue sidebar supporting list / tree-graph toggle (DW03), explicit directed edges with multi-predecessor convergence,
 * isolated legacy issues (no inferred edges), and explicit decision requests for the selected issue.
 */
export function CaseIssueTreeSidebar({ record, issues, selectedIssueId, onSelectIssue, onChanged, onAddIssue, timelines = {}, timelineErrors = {} }: Props) {
  const [mode, setMode] = useState<CaseIssueViewMode>(() => readCaseIssueViewMode(record.id));
  const [edges, setEdges] = useState<CaseIssueEdge[]>([]);
  const [requests, setRequests] = useState<CaseDecisionRequestView[]>([]);
  const [requestsReady, setRequestsReady] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [addingEdge, setAddingEdge] = useState(false);
  const [fromId, setFromId] = useState('');
  const [toId, setToId] = useState('');
  const [explanation, setExplanation] = useState('');
  const id = useId();
  const closed = record.status === 'closed';
  useEffect(() => { setMode(readCaseIssueViewMode(record.id)); }, [record.id]);
  function chooseMode(value: CaseIssueViewMode) { saveCaseIssueViewMode(record.id, value); setMode(value); }

  useEffect(() => {
    let alive = true;
    setError('');
    setRequestsReady(false);
    void Promise.all([readIssueEdges(record.id), readDecisionRequests(record.id)]).then(
      ([edgeRes, reqRes]) => {
        if (!alive) return;
        setEdges(edgeRes.edges);
        setRequests(reqRes.requests);
        setRequestsReady(true);
      },
      err => {
        if (!alive) return;
        setEdges([]);
        setRequests([]);
        setError(caseError(err));
      },
    );
    return () => { alive = false; };
  }, [record.id, record.revision]);

  const selectedRequests = useMemo(() => requests.filter(r => r.issueId === selectedIssueId && r.status === 'open'), [requests, selectedIssueId]);

  function issueProgress(issueId: string) {
    const progress = projectCaseIssueProgress(timelines[issueId], requestsReady ? requests : undefined);
    return timelineErrors[issueId] ? { ...progress, note: '原记录暂不可读取' } : progress;
  }

  function progressLines(issueId: string) {
    const progress = issueProgress(issueId);
    return <><span className="case-issue-round">{progress.roundLabel} · {progress.phase}</span><span className={`case-issue-status ${progress.tone}`}>{progress.note}</span></>;
  }

  async function declareEdge() {
    if (!fromId || !toId || fromId === toId) { setError('请选择两个不同的事项作为起点和承接目标。'); return; }
    setBusy(true); setError('');
    try {
      await saveIssueEdge(record.id, {
        operationId: crypto.randomUUID(),
        expectedRevision: record.revision,
        fromIssueId: fromId,
        toIssueId: toId,
        explanation: explanation.trim() || '明确承接关系',
        expectedEdgeRevision: 0,
        source: { kind: 'user-declaration', ref: `ui-issue-sidebar:${record.id}` },
      });
      setAddingEdge(false); setExplanation('');
      onChanged();
    } catch (e) { setError(caseError(e)); }
    finally { setBusy(false); }
  }

  async function removeEdge(edge: CaseIssueEdge) {
    setBusy(true); setError('');
    try {
      await saveIssueEdge(record.id, {
        operationId: crypto.randomUUID(),
        expectedRevision: record.revision,
        edgeId: edge.edgeId,
        action: 'remove',
        expectedEdgeRevision: edge.revision,
        source: { kind: 'user-declaration', ref: `ui-issue-sidebar:${record.id}` },
      });
      onChanged();
    } catch (e) { setError(caseError(e)); }
    finally { setBusy(false); }
  }

  return <aside className="case-issue-sidebar" aria-label="事项关系与视图切换">
    <div className="case-issue-sidebar-title"><h3>Case 内事项 <span>{issues.length}</span></h3>{!closed && onAddIssue && <button type="button" className="case-issue-add" aria-label="新增 Case 事项" title="新增事项" onClick={onAddIssue}>＋</button>}</div>
    <div className="case-issue-mobile-selection"><label htmlFor={`${id}-mobile-issue`}>当前事项</label><select id={`${id}-mobile-issue`} value={selectedIssueId} onChange={event => onSelectIssue(event.target.value)}>{!selectedIssueId && <option value="">选择事项</option>}{issues.map(issue => <option key={issue.id} value={issue.id}>{issue.title}</option>)}</select>{!closed && onAddIssue && <button type="button" className="case-issue-add" aria-label="新增 Case 事项" title="新增事项" onClick={onAddIssue}>＋</button>}</div>
    <div className="case-issue-sidebar-head">
      <div className="case-view-switch" role="group" aria-label="事项侧栏视图">
        <button type="button" aria-pressed={mode === 'list'} onClick={() => chooseMode('list')}>列表</button>
        <button type="button" aria-pressed={mode === 'tree'} onClick={() => chooseMode('tree')}>树状图</button>
      </div>
    </div>
    <CaseFormError error={error} />
    {addingEdge && <div className="case-issue-edge-form" role="region" aria-label="声明事项承接关系">
      <label htmlFor={`${id}-from`}>前驱事项</label>
      <select id={`${id}-from`} value={fromId} onChange={e => setFromId(e.target.value)}><option value="">请选择</option>{issues.map(i => <option key={i.id} value={i.id}>{i.title}</option>)}</select>
      <label htmlFor={`${id}-to`}>承接事项</label>
      <select id={`${id}-to`} value={toId} onChange={e => setToId(e.target.value)}><option value="">请选择</option>{issues.map(i => <option key={i.id} value={i.id}>{i.title}</option>)}</select>
      <label htmlFor={`${id}-exp`}>关系说明</label>
      <input id={`${id}-exp`} type="text" value={explanation} onChange={e => setExplanation(e.target.value)} placeholder="例如：试点复盘后承接扩围讨论" maxLength={200} />
      <button type="button" className="secondary-button" disabled={busy || !fromId || !toId || fromId === toId} onClick={() => { void declareEdge(); }}>保存明确关系</button>
    </div>}

    {mode === 'list' ? (
      <ul className="case-issue-list" aria-label="事项列表">
        {issues.map(issue => {
          return <li key={issue.id}>
            <button type="button" className={`case-issue-node ${issue.id === selectedIssueId ? 'selected' : ''}`} aria-current={issue.id === selectedIssueId ? 'true' : undefined} onClick={() => onSelectIssue(issue.id)}>
              <span>{issue.title}</span>
              {progressLines(issue.id)}
            </button>
          </li>;
        })}
      </ul>
    ) : (
      <CompactCaseIssueGraph caseId={record.id} issues={issues} edges={edges} selectedIssueId={selectedIssueId} onSelectIssue={onSelectIssue} renderProgress={progressLines} />
    )}

    {!issues.length && <p className="case-help">暂无事项。可以先从已有项目继续工作。</p>}
    {!closed && issues.length >= 2 && <details className="case-issue-relations-management"><summary>管理事项关联</summary><button type="button" className="text-button" onClick={() => setAddingEdge(v => !v)}>{addingEdge ? '收起关系声明' : '＋ 声明承接关系'}</button>{edges.map(edge => <div key={edge.edgeId}><span>{issues.find(issue => issue.id === edge.fromIssueId)?.title ?? '原事项'} → {issues.find(issue => issue.id === edge.toIssueId)?.title ?? '原事项'}</span><button type="button" className="text-button" disabled={busy} aria-label={`解除 ${issues.find(issue => issue.id === edge.toIssueId)?.title ?? '事项'} 的承接关系`} onClick={() => { void removeEdge(edge); }}>解除</button></div>)}</details>}
    {selectedRequests.length > 0 && <details className="case-issue-requests" aria-label="当前事项待回应请求">
      <summary>待回应请求（{selectedRequests.length}）</summary>
      {selectedRequests.map(req => <article key={req.requestId} className="case-issue-request-card">
        <strong>{req.kind === 'choose' ? '作取舍' : '补原始观察'}</strong>
        <p>{req.text}</p>
        <p className="case-help">承担人：{req.assignee.label ?? '未声明'} · 来源：{req.assignee.source ?? req.source.ref ?? '原记录'}{req.dueDate ? ` · 期限 ${req.dueDate}` : ''}</p>
      </article>)}
    </details>}
  </aside>;
}
