import { CaseStoreError } from './case-store.ts';
import type { CaseDecisionService } from './case-decision-service.ts';

type Request = { pathname: string; method: string; input?: unknown; searchParams?: URLSearchParams };
type Result = { status?: number; body: unknown } | null;

export function createCaseDecisionRoutes(service: CaseDecisionService) {
  return async ({ pathname, method, input = {}, searchParams = new URLSearchParams() }: Request): Promise<Result> => {
    const match = /^\/api\/cases\/([a-f0-9-]+)\/decisions(?:\/(.*))?$/.exec(pathname);
    if (!match) return null;
    const caseId = match[1]!, action = match[2];
    if (action === 'issues') {
      if (method === 'GET') return { body: { issues: service.issueList(caseId) } };
      if (method === 'POST') return { status: 201, body: { issue: await service.createIssue(caseId, input as Record<string, unknown>) } };
    }
    if (action === 'issue-edges') {
      if (method === 'GET') return { body: { edges: service.issueEdges(caseId, searchParams.get('includeRemoved') === 'true') } };
      if (method === 'POST') return { status: 201, body: { edge: await service.saveIssueEdge(caseId, input as Record<string, unknown>) } };
    }
    if (action === 'requests') {
      if (method === 'GET') return { body: { requests: service.decisionRequests(caseId) } };
      if (method === 'POST') return { status: 201, body: { request: await service.saveDecisionRequest(caseId, input as Record<string, unknown>) } };
    }
    const issue = /^issues\/([a-f0-9-]+)(?:\/(sources|reply|plans|authorize|review))?$/.exec(action ?? '');
    if (issue) {
      const id = issue[1]!, sub = issue[2];
      if (method === 'GET' && !sub) return { body: await service.issueTimeline(caseId, id) };
      if (method === 'GET' && sub === 'sources') return { body: await service.issueSources(caseId, id) };
      if (method === 'POST' && sub === 'reply') return { body: await service.inspectIssueReply(caseId, id, input) };
      if (method === 'POST' && sub && sub !== 'sources') return { body: await service.issueWrite(caseId, id, sub, input as Record<string, unknown>) };
    }
    const exactChoice = /^choices\/([a-f0-9-]+)$/.exec(action ?? '');
    if (exactChoice && method === 'GET') return { body: { choice: service.readChoice(caseId, exactChoice[1]!) } };
    if (action === 'links' && method === 'GET') return { body: await service.links(caseId) };
    if (action === 'source' && method === 'POST') return { body: await service.source(caseId, input) };
    const choice = /^([a-f0-9-]+)\/choice$/.exec(action ?? '');
    if (choice && method === 'POST') return { body: { choice: await service.choose(caseId, choice[1]!, input) } };
    const governance = /^([a-f0-9-]+)\/governance$/.exec(action ?? '');
    if (governance && method === 'POST') return { body: { revision: await service.govern(caseId, governance[1]!, input) } };
    if (!action && method === 'GET') {
      const rawPage = searchParams.get('pageSize');
      if (rawPage !== null && !/^\d+$/.test(rawPage)) throw new CaseStoreError('invalid_case_decision_page');
      return { body: service.list(caseId, {
        includeArchived: searchParams.get('includeArchived') === 'true', history: searchParams.get('history') === 'true',
        ...(rawPage !== null ? { pageSize: Number(rawPage) } : {}), continuation: searchParams.get('continuation'),
      }) };
    }
    const revision = /^([a-f0-9-]+)\/revisions\/(\d+)$/.exec(action ?? '');
    if (revision && method === 'GET') {
      const exact = service.read(caseId, revision[1]!, Number(revision[2])), head = service.read(caseId, revision[1]!);
      return { body: { revision: exact, current: { revision: head.revision, lifecycle: head.lifecycle } } };
    }
    return null;
  };
}
