import type { CaseRecord } from './case-types.ts';
import type { CaseStore } from './case-store.ts';
import { CaseStoreError } from './case-types.ts';

export type CaseDirectoryOptions = { query?: string; limit?: number; includeClosed?: boolean; caseId?: string; offset?: number; issueLimit?: number; issueOffset?: number };

export type CaseDirectoryEntry = {
  caseId: string;
  title: string;
  status: CaseRecord['status'];
  updatedAt: string;
  goalBinding: { goalId: string; version: number; strategy: string | null } | null;
  issues: { issueId: string; title: string }[];
  totalIssues: number;
  issuesTruncated: boolean;
  nextIssueOffset: number | null;
};

export type CaseDirectoryResult = {
  storeState: 'ready' | 'uninitialized' | 'unavailable';
  items: CaseDirectoryEntry[];
  truncated: boolean;
  totalVisible: number;
  nextOffset: number | null;
};

/**
 * Bounded read-only directory of visible Cases and their issues for pre-creation assistance.
 * Never exposes arbitrary private files or unauthorized scopes; never performs rule-based recommendation.
 */
export function listVisibleCaseDirectory(
  cases: Pick<CaseStore, 'getStatus' | 'listCases' | 'listDecisionIssues' | 'getGoalBinding'>,
  options: CaseDirectoryOptions = {},
): CaseDirectoryResult {
  const status = cases.getStatus();
  if (status.state !== 'ready') {
    return { storeState: status.state, items: [], truncated: false, totalVisible: 0, nextOffset: null };
  }
  const limit = Math.max(1, Math.min(50, options.limit ?? 20));
  const query = (options.query ?? '').trim().toLowerCase();
  const offset = Math.max(0, options.offset ?? 0), issueOffset = Math.max(0, options.issueOffset ?? 0);
  const issueLimit = Math.max(1, Math.min(20, options.issueLimit ?? 5));
  if (![offset, issueOffset, issueLimit, limit].every(Number.isSafeInteger)) throw new CaseStoreError('invalid_case_directory_page', 400);
  if (issueOffset > 0 && !options.caseId) throw new CaseStoreError('case_directory_case_required', 400);
  const all = cases.listCases()
    .filter(record => options.includeClosed || record.status !== 'closed')
    .filter(record => !options.caseId || record.id === options.caseId)
    .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt) || a.id.localeCompare(b.id));

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
      issues: issues.slice(issueOffset, issueOffset + issueLimit),
      totalIssues: issues.length,
      issuesTruncated: issueOffset + issueLimit < issues.length,
      nextIssueOffset: issueOffset + issueLimit < issues.length ? issueOffset + issueLimit : null,
    });
  }
  const items: CaseDirectoryEntry[] = [];
  // Whole rows keep exact identities and source text. A full native tool result
  // remains below its 30k budget; continue by Case or by the exact Case's issues.
  for (const entry of entries.slice(offset, offset + limit)) {
    if (JSON.stringify({ items: [...items, entry] }).length > 28000) {
      if (!items.length) throw new CaseStoreError('case_directory_entry_too_large', 413);
      break;
    }
    items.push(entry);
  }
  const nextOffset = offset + items.length < entries.length ? offset + items.length : null;
  return {
    storeState: 'ready',
    items,
    truncated: nextOffset !== null || items.some(item => item.issuesTruncated),
    totalVisible: entries.length,
    nextOffset,
  };
}
