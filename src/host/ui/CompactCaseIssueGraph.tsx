import { useId, useMemo, type ReactNode } from 'react';
import type { CaseDecisionIssue, CaseIssueEdge } from '../case-decision-types.ts';
import './compact-case-issue-graph.css';

type Props = {
  caseId: string;
  issues: readonly CaseDecisionIssue[];
  edges: readonly CaseIssueEdge[];
  selectedIssueId: string;
  onSelectIssue: (issueId: string) => void;
  renderProgress: (issueId: string) => ReactNode;
};

/** Unique nodes, original directed edges. Ordering is layout only, never a new business relationship. */
export function projectCompactIssueGraph(caseId: string, issues: readonly CaseDecisionIssue[], edges: readonly CaseIssueEdge[]) {
  const byId = new Map(issues.filter(issue => issue.caseId === caseId).map(issue => [issue.id, issue]));
  const original = edges.filter(edge => edge.caseId === caseId && edge.lifecycle === 'active');
  const available = original.filter(edge => byId.has(edge.fromIssueId) && byId.has(edge.toIssueId));
  const dangling = original.filter(edge => !byId.has(edge.fromIssueId) || !byId.has(edge.toIssueId));
  const incoming = new Map<string, CaseIssueEdge[]>(), outgoing = new Map<string, CaseIssueEdge[]>();
  for (const edge of available) {
    incoming.set(edge.toIssueId, [...(incoming.get(edge.toIssueId) ?? []), edge]);
    outgoing.set(edge.fromIssueId, [...(outgoing.get(edge.fromIssueId) ?? []), edge]);
  }
  const connected = [...byId.values()].filter(issue => incoming.has(issue.id) || outgoing.has(issue.id));
  const isolated = [...byId.values()].filter(issue => !incoming.has(issue.id) && !outgoing.has(issue.id));
  const remaining = new Map(connected.map(issue => [issue.id, incoming.get(issue.id)?.length ?? 0]));
  const queue = connected.filter(issue => !remaining.get(issue.id));
  const nodes: CaseDecisionIssue[] = [], included = new Set<string>();
  // Kahn traversal is bounded by the input. Cycles are appended once and retain their original arrows.
  for (let index = 0; index < queue.length; index++) {
    const issue = queue[index]!;
    if (included.has(issue.id)) continue;
    included.add(issue.id); nodes.push(issue);
    for (const edge of outgoing.get(issue.id) ?? []) {
      const degree = remaining.get(edge.toIssueId)! - 1;
      remaining.set(edge.toIssueId, degree);
      if (degree === 0) queue.push(byId.get(edge.toIssueId)!);
    }
  }
  for (const issue of connected) if (!included.has(issue.id)) { included.add(issue.id); nodes.push(issue); }
  const index = new Map(nodes.map((issue, position) => [issue.id, position]));
  const hasBackReference = available.some(edge => index.get(edge.toIssueId)! <= index.get(edge.fromIssueId)!);
  return { nodes, isolated, edges: available, dangling, outgoing, incoming, byId, index, hasBackReference };
}

/** Read-only compact graph matching the frozen sidebar: one selectable node per original issue. */
export function CompactCaseIssueGraph({ caseId, issues, edges, selectedIssueId, onSelectIssue, renderProgress }: Props) {
  const graph = useMemo(() => projectCompactIssueGraph(caseId, issues, edges), [caseId, issues, edges]);
  const marker = `issue-direction-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const node = (issue: CaseDecisionIssue) => {
    const predecessors = [...new Set((graph.incoming.get(issue.id) ?? []).map(edge => edge.fromIssueId))];
    return <button type="button" className={`dci-graph-node${selectedIssueId === issue.id ? ' selected' : ''}`} data-issue-id={issue.id} aria-current={selectedIssueId === issue.id ? 'true' : undefined} aria-label={`选择事项：${issue.title}${predecessors.length > 1 ? `，汇入 ${predecessors.length} 个前驱` : ''}`} title={issue.title} onClick={() => onSelectIssue(issue.id)}>
      <span className="dci-graph-name">{issue.title}</span>{renderProgress(issue.id)}
    </button>;
  };
  return <div className="case-issue-tree dci-issue-graph" aria-label="事项关系树状图">
    {graph.nodes.length > 0 && <>
      <p className="dci-graph-intro">沿已标注关系看事项承接。</p>
      <div className="dci-graph-connected" style={{ height: graph.nodes.length * 142 }}>
        <svg viewBox={`0 0 24 ${graph.nodes.length * 142}`} preserveAspectRatio="none" aria-hidden="true">
          <defs><marker id={marker} markerWidth="4" markerHeight="4" refX="3" refY="2" orient="auto"><path d="M0 0 L4 2 L0 4" fill="none" stroke="#a68bc9" strokeWidth="1" /></marker></defs>
          {graph.edges.map((edge, position) => {
            const self = edge.fromIssueId === edge.toIssueId;
            const from = graph.index.get(edge.fromIssueId)! * 142 + 56 - (self ? 12 : 0);
            const to = graph.index.get(edge.toIssueId)! * 142 + 56 + (self ? 12 : 0);
            const rail = 5 + (position % 3) * 6;
            return <path key={edge.edgeId} data-issue-edge={edge.edgeId} data-from-issue={edge.fromIssueId} data-to-issue={edge.toIssueId} d={`M24 ${from} H${rail} V${to} H22`} fill="none" stroke="#b59bd6" strokeWidth="1.5" markerEnd={`url(#${marker})`} />;
          })}
        </svg>
        {graph.nodes.map(issue => {
          const labels = (graph.outgoing.get(issue.id) ?? []).map(edge => edge.explanation).filter(Boolean).join('、');
          return <div className="dci-graph-row" key={issue.id}>{node(issue)}{labels && <span className="dci-graph-link-label" title={labels}>{labels}</span>}</div>;
        })}
      </div>
      <ul className="dci-graph-sr" aria-label="已记录的事项承接关系">{graph.edges.map(edge => <li key={edge.edgeId}>{graph.byId.get(edge.fromIssueId)!.title} → {graph.byId.get(edge.toIssueId)!.title}：{edge.explanation || '已记录承接关系'}</li>)}</ul>
      <p className="dci-graph-note">箭头表示已记录的承接方向，可并行推进。{graph.hasBackReference && <><br />存在循环或回指，保留原关系，不重复创建事项。</>}</p>
    </>}
    {graph.isolated.length > 0 && <div className="dci-graph-isolated"><p className="dci-graph-note">关系尚未标注，可直接继续工作。</p>{graph.isolated.map(issue => <div className="dci-isolated-row" key={issue.id}>{node(issue)}</div>)}</div>}
    {graph.dangling.length > 0 && <details className="dci-graph-dangling"><summary>{graph.dangling.length} 条关系的端点暂不可读取</summary>{graph.dangling.map(edge => <p key={edge.edgeId}>{graph.byId.get(edge.fromIssueId)?.title ?? '原事项暂不可读取'} → {graph.byId.get(edge.toIssueId)?.title ?? '原事项暂不可读取'}：{edge.explanation || '保留原关系记录，未绘制连线'}</p>)}</details>}
  </div>;
}
