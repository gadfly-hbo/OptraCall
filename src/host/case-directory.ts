import type { CaseRecord } from './case-types.ts';
import type { CaseStore } from './case-store.ts';

export type CaseDirectoryEntry = {
  caseId: string;
  title: string;
  status: CaseRecord['status'];
  updatedAt: string;
  goalBinding: { goalId: string; version: number; strategy: string | null } | null;
  issues: { issueId: string; title: string }[];
};

export type CaseDirectoryResult = {
  storeState: 'ready' | 'uninitialized' | 'unavailable';
  items: CaseDirectoryEntry[];
  truncated: boolean;
  totalVisible: number;
};

/**
 * Bounded read-only directory of visible Cases and their issues for pre-creation assistance.
 * Never exposes arbitrary private files or unauthorized scopes; never performs rule-based recommendation.
 */
export function listVisibleCaseDirectory(
  cases: Pick<CaseStore, 'getStatus' | 'listCases' | 'listDecisionIssues' | 'getGoalBinding'>,
  options: { query?: string; limit?: number; includeClosed?: boolean } = {},
): CaseDirectoryResult {
  const status = cases.getStatus();
  if (status.state !== 'ready') {
    return { storeState: status.state, items: [], truncated: false, totalVisible: 0 };
  }
  const limit = Math.max(1, Math.min(50, options.limit ?? 20));
  const query = (options.query ?? '').trim().toLowerCase();
  const all = cases.listCases()
    .filter(record => options.includeClosed || record.status !== 'closed')
    .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));

  const entries: CaseDirectoryEntry[] = [];
  for (const record of all) {
    const issues = cases.listDecisionIssues(record.id).map(issue => ({ issueId: issue.id, title: issue.title }));
    const binding = cases.getGoalBinding(record.id);
    if (query) {
      const haystack = [record.title, binding?.strategy ?? '', ...issues.map(i => i.title)].join(' ').toLowerCase();
      if (!haystack.includes(query)) continue;
    }
    entries.push({
      caseId: record.id,
      title: record.title,
      status: record.status,
      updatedAt: record.updatedAt,
      goalBinding: binding ? { goalId: binding.primary.goalId, version: binding.primary.version, strategy: binding.strategy ?? null } : null,
      issues,
    });
  }
  return {
    storeState: 'ready',
    items: entries.slice(0, limit),
    truncated: entries.length > limit,
    totalVisible: entries.length,
  };
}
