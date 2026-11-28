import type { CaseDecisionIssue, CaseIssueEdge } from '../case-decision-types.ts';

export type IssueTreeNode = {
  issue: CaseDecisionIssue; edge: CaseIssueEdge | null; children: IssueTreeNode[];
  /** True when the issue is only a repeated reference (several predecessors, or a loop back); never expanded again. */
  reference: boolean; predecessors: CaseDecisionIssue[];
};
export type IssueTree = { roots: IssueTreeNode[]; isolated: CaseDecisionIssue[]; dangling: CaseIssueEdge[] };

/**
 * Pure projection of explicit edges. No order or title inference: issues without an active edge stay isolated.
 * Multi-predecessor issues are expanded once and shown as references elsewhere; loops are safe and not interpreted.
 */
export function buildIssueTree(issues: readonly CaseDecisionIssue[], edges: readonly CaseIssueEdge[]): IssueTree {
  const byId = new Map(issues.map(issue => [issue.id, issue]));
  const active = edges.filter(edge => edge.lifecycle === 'active' && byId.has(edge.fromIssueId) && byId.has(edge.toIssueId));
  const dangling = edges.filter(edge => edge.lifecycle === 'active' && !(byId.has(edge.fromIssueId) && byId.has(edge.toIssueId)));
  const outgoing = new Map<string, CaseIssueEdge[]>(), incoming = new Map<string, CaseIssueEdge[]>();
  for (const edge of active) {
    outgoing.set(edge.fromIssueId, [...(outgoing.get(edge.fromIssueId) ?? []), edge]);
    incoming.set(edge.toIssueId, [...(incoming.get(edge.toIssueId) ?? []), edge]);
  }
  const connected = issues.filter(issue => outgoing.has(issue.id) || incoming.has(issue.id));
  const isolated = issues.filter(issue => !outgoing.has(issue.id) && !incoming.has(issue.id));
  const expanded = new Set<string>();
  const predecessorsOf = (id: string) => (incoming.get(id) ?? []).map(edge => byId.get(edge.fromIssueId)!);
  const build = (issue: CaseDecisionIssue, edge: CaseIssueEdge | null): IssueTreeNode => {
    const predecessors = predecessorsOf(issue.id);
    if (expanded.has(issue.id)) return { issue, edge, children: [], reference: true, predecessors };
    expanded.add(issue.id);
    return { issue, edge, reference: false, predecessors, children: (outgoing.get(issue.id) ?? []).map(next => build(byId.get(next.toIssueId)!, next)) };
  };
  const roots: IssueTreeNode[] = [];
  for (const issue of connected.filter(value => !incoming.has(value.id))) roots.push(build(issue, null));
  // A pure loop has no natural root; start at its earliest issue without hiding the loop.
  for (const issue of connected) if (!expanded.has(issue.id)) roots.push(build(issue, null));
  return { roots, isolated, dangling };
}
