import { useEffect, useId, useMemo, useState } from 'react';
import type { CaseDecisionIssue, CaseIssueEdge } from '../case-decision-types.ts';
import type { CaseRecord } from '../case-types.ts';
import { buildIssueTree, type IssueTreeNode } from './case-issue-map-model.ts';
import { readDecisionRequests, readIssueEdges, saveIssueEdge, type CaseDecisionRequestView } from './workspace-daily-client.ts';
import { CaseFormError, caseError } from './CaseDialogs.tsx';

type Props = {
  record: CaseRecord;
  issues: CaseDecisionIssue[];
  selectedIssueId: string;
  onSelectIssue: (issueId: string) => void;
  onChanged: () => void;
};

/**
 * Issue sidebar supporting list / tree-graph toggle (DW03), explicit directed edges with multi-predecessor convergence,
 * isolated legacy issues (no inferred edges), and explicit decision requests for the selected issue.
 */
export function CaseIssueTreeSidebar({ record, issues, selectedIssueId, onSelectIssue, onChanged }: Props) {
  const [mode, setMode] = useState<'list' | 'tree'>('list');
  const [edges, setEdges] = useState<CaseIssueEdge[]>([]);
  const [requests, setRequests] = useState<CaseDecisionRequestView[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [addingEdge, setAddingEdge] = useState(false);
  const [fromId, setFromId] = useState('');
  const [toId, setToId] = useState('');
  const [explanation, setExplanation] = useState('');
  const id = useId();
  const closed = record.status === 'closed';

  useEffect(() => {
    let alive = true;
    setError('');
    void Promise.all([readIssueEdges(record.id), readDecisionRequests(record.id)]).then(
      ([edgeRes, reqRes]) => {
        if (!alive) return;
        setEdges(edgeRes.edges);
        setRequests(reqRes.requests);
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

  const tree = useMemo(() => buildIssueTree(issues, edges), [issues, edges]);
  const selectedRequests = useMemo(() => requests.filter(r => r.issueId === selectedIssueId && r.status === 'open'), [requests, selectedIssueId]);

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

  function renderNode(node: IssueTreeNode, depth: number) {
    const active = node.issue.id === selectedIssueId;
    const multi = node.predecessors.length > 1;
    return <li key={`${node.issue.id}:${node.edge?.edgeId ?? 'root'}:${depth}`} className="case-issue-tree-item">
      <div className="case-issue-tree-row">
        <button type="button" className={`case-issue-node ${active ? 'selected' : ''}`} aria-current={active ? 'true' : undefined} onClick={() => onSelectIssue(node.issue.id)}>
          <span>{node.issue.title}</span>
          {multi && <span className="case-issue-badge" title={`承接自：${node.predecessors.map(p => p.title).join('、')}`}>汇入 · {node.predecessors.length} 个前驱</span>}
          {node.reference && <span className="case-issue-badge">重复引用</span>}
        </button>
        {node.edge && !closed && <button type="button" className="text-button" disabled={busy} aria-label={`解除 ${node.issue.title} 的承接关系`} onClick={() => { void removeEdge(node.edge!); }}>解除</button>}
      </div>
      {node.edge?.explanation && <p className="case-help case-issue-edge-note">{node.edge.explanation}</p>}
      {node.children.length > 0 && <ul className="case-issue-tree-children">{node.children.map(child => renderNode(child, depth + 1))}</ul>}
    </li>;
  }

  if (!issues.length) return null;

  return <aside className="case-issue-sidebar" aria-label="事项关系与视图切换">
    <div className="case-issue-sidebar-head">
      <div className="case-view-switch" role="group" aria-label="事项侧栏视图">
        <button type="button" aria-pressed={mode === 'list'} onClick={() => setMode('list')}>列表</button>
        <button type="button" aria-pressed={mode === 'tree'} onClick={() => setMode('tree')}>树状图</button>
      </div>
      {!closed && issues.length >= 2 && <button type="button" className="text-button" onClick={() => setAddingEdge(v => !v)}>{addingEdge ? '收起关系声明' : '＋ 声明承接关系'}</button>}
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
          const preds = edges.filter(e => e.toIssueId === issue.id);
          const openReqs = requests.filter(r => r.issueId === issue.id && r.status === 'open').length;
          return <li key={issue.id}>
            <button type="button" className={`case-issue-node ${issue.id === selectedIssueId ? 'selected' : ''}`} aria-current={issue.id === selectedIssueId ? 'true' : undefined} onClick={() => onSelectIssue(issue.id)}>
              <span>{issue.title}</span>
              {preds.length > 0 && <span className="case-issue-badge">{preds.length} 个前驱</span>}
              {openReqs > 0 && <span className="case-issue-badge case-issue-badge-req">{openReqs} 项请求</span>}
            </button>
          </li>;
        })}
      </ul>
    ) : (
      <div className="case-issue-tree" aria-label="事项关系树状图">
        {tree.roots.length > 0 && <ul className="case-issue-tree-root">{tree.roots.map(root => renderNode(root, 0))}</ul>}
        {tree.isolated.length > 0 && <div className="case-issue-isolated">
          <p className="case-help">暂无显式关系的独立事项（不从标题或顺序推断边）</p>
          <ul className="case-issue-list">{tree.isolated.map(issue => <li key={issue.id}>
            <button type="button" className={`case-issue-node ${issue.id === selectedIssueId ? 'selected' : ''}`} aria-current={issue.id === selectedIssueId ? 'true' : undefined} onClick={() => onSelectIssue(issue.id)}>{issue.title}</button>
          </li>)}</ul>
        </div>}
      </div>
    )}

    {selectedRequests.length > 0 && <div className="case-issue-requests" role="region" aria-label="当前事项待回应请求">
      <h4>待回应请求（{selectedRequests.length}）</h4>
      {selectedRequests.map(req => <article key={req.requestId} className="case-issue-request-card">
        <strong>{req.kind === 'choose' ? '作取舍' : '补原始观察'}</strong>
        <p>{req.text}</p>
        <p className="case-help">承担人：{req.assignee.label ?? '未声明'} · 来源：{req.assignee.source ?? req.source.ref ?? '原记录'}{req.dueDate ? ` · 期限 ${req.dueDate}` : ''}</p>
      </article>)}
    </div>}
  </aside>;
}
