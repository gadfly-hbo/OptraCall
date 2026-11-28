import { projectHomePending, homeRequestRoundNumber } from './home-pending.ts';
import { listVisibleCaseDirectory } from './case-directory.ts';
import { executeThreeBranchCaseCreate, type AdoptGoalFn, type CreateCaseFn, type ReadGoalFn } from './case-creation-orchestrator.ts';
import { chooseRequestStatus, observationRequestStatus, observationAuthorizationMatches } from './case-issues.ts';
import { WorkspaceDraftError, type WorkspaceDraftKind, type WorkspaceDraftStore } from './workspace-draft-store.ts';
import type { CaseStore } from './case-store.ts';
import type { createDecisionBoardStore } from '../../extensions/business-plugins/decision-board/storage/store.ts';

type BoardStore = Pick<ReturnType<typeof createDecisionBoardStore>, 'getTask' | 'getItem' | 'listFeedbackHistory' | 'listActionAuthorizations'>;

export type WorkspaceDailyRoutesDeps = {
  cases: CaseStore;
  drafts: WorkspaceDraftStore;
  board?: BoardStore;
  assertBoardItemReadable?: import('./case-decision-service.ts').CaseDecisionServiceDependencies['assertBoardItemReadable'];
  assertActiveProject?: (projectId: string) => Promise<void>;
  checkPlan?: (reference: import('./case-decision-types.ts').CaseDecisionRef) => Promise<void>;
  initializeCases?: () => Promise<void>;
  readGoal?: ReadGoalFn;
  adoptGoal: AdoptGoalFn;
  createCase: CreateCaseFn;
};

type Request = { pathname: string; method: string; input?: unknown; searchParams?: URLSearchParams };
type Result = { status?: number; body: unknown } | null;

export function createWorkspaceDailyRoutes(deps: WorkspaceDailyRoutesDeps) {
  return async ({ pathname, method, input = {}, searchParams = new URLSearchParams() }: Request): Promise<Result> => {
    if (pathname === '/api/workspace/home-pending' && method === 'GET') {
      const status = deps.cases.getStatus();
      if (status.state !== 'ready') {
        return { body: projectHomePending({ storeState: status.state, cases: [] }) };
      }
      const entries = await Promise.all(deps.cases.listCases().map(async record => {
        const issues = deps.cases.listDecisionIssues(record.id);
        const requests = deps.cases.listDecisionRequests(record.id);
        const choices = deps.cases.getStrategyChoices(record.id);
        const pendingOperations = deps.cases.listPendingProjectOperations(record.id);
        const requestStatuses = Object.fromEntries(await Promise.all(requests
          .map(async request => [request.requestId, request.kind === 'observe' ? await observationRequestStatus(deps.cases, deps.board, request, deps.assertBoardItemReadable, deps.assertActiveProject) : await chooseRequestStatus(deps.cases, request, choices, deps.checkPlan)])));
        const requestRoundNumbers = Object.fromEntries(await Promise.all(requests.map(async request => {
          const unknown = [request.requestId, null] as const;
          if (requestStatuses[request.requestId] === 'unverifiable') return unknown;
          if (request.target.kind === 'choose') return [request.requestId, homeRequestRoundNumber(request, choices, null, status.storeId)] as const;
          try {
            const board = deps.board, target = request.target;
            if (!board || !deps.cases.listProjectLinks(record.id).some(link => link.projectId === target.projectId)) return unknown;
            const task = board.getTask(target.taskId), item = board.getItem(task.itemId);
            if (item.id !== target.itemId || item.projectId !== target.projectId) return unknown;
            if (item.sourceKind === 'report-confirmation') {
              if (!deps.assertBoardItemReadable) return unknown;
              await deps.assertBoardItemReadable(item);
            }
            const exact = board.listActionAuthorizations(task.id).filter(auth => auth.authorizationId === target.authorizationId);
            const authorization = exact.length === 1 ? exact[0] : undefined;
            if (!authorization || authorization.projectId !== target.projectId || authorization.itemId !== target.itemId || authorization.taskId !== target.taskId
              || 'kind' in authorization.source || !observationAuthorizationMatches(deps.cases, request, authorization)) return unknown;
            return [request.requestId, homeRequestRoundNumber(request, choices, authorization.source.choiceId, status.storeId)] as const;
          } catch { return unknown; }
        })));
        return { record, issues, requests, choices, requestStatuses, requestRoundNumbers, pendingOperations };
      }));
      // Waiting is an explicit project-work state, not a guessed consequence of
      // Case status, missing feedback, issue order, or a still-running action.
      const linkedCases = new Map<string, string[]>();
      const readableCases = new Set(entries.map(entry => entry.record.id));
      for (const link of deps.cases.listProjectLinks()) {
        if (!readableCases.has(link.caseId)) continue;
        linkedCases.set(link.projectId, [...(linkedCases.get(link.projectId) ?? []), link.caseId]);
      }
      let externalWaitingLimited = false;
      const projectWaiting = (await Promise.all([...linkedCases].map(async ([projectId, caseIds]) => {
        try {
          if (!deps.assertActiveProject) { externalWaitingLimited = true; return []; }
          await deps.assertActiveProject(projectId);
          const work = deps.cases.getProjectWork(projectId);
          return work.workStatus === 'awaiting_feedback' ? [{ work, caseIds }] : [];
        } catch (error) {
          // An archived project is intentionally absent from current waiting.
          // Other unreadable sources are omitted without hiding readable peers.
          if ((error as { code?: string })?.code !== 'project_archived') externalWaitingLimited = true;
          return [];
        }
      }))).flat();
      return { body: projectHomePending({ storeState: 'ready', cases: entries, projectWaiting, externalWaitingLimited }) };
    }

    if (pathname === '/api/workspace/case-directory' && method === 'GET') {
      const query = searchParams.get('query') ?? undefined;
      const rawLimit = searchParams.get('limit');
      const limit = rawLimit && /^\d+$/.test(rawLimit) ? Number(rawLimit) : undefined;
      const includeClosed = searchParams.get('includeClosed') === 'true';
      const page: {offset?:number;issueLimit?:number;issueOffset?:number}={};
      for(const key of ['offset','issueLimit','issueOffset'] as const){const value=searchParams.get(key);if(value!==null){if(!/^\d+$/.test(value)||!Number.isSafeInteger(Number(value)))throw new WorkspaceDraftError('invalid_case_directory_page',400);page[key]=Number(value);}}
      return { body: listVisibleCaseDirectory(deps.cases, { query, limit, includeClosed, ...page, ...(searchParams.has('caseId')?{caseId:searchParams.get('caseId')!}:{}) }) };
    }

    if (pathname === '/api/workspace/drafts/append-fragment' && method === 'POST') {
      const body = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
      if (typeof body.fragmentId !== 'string' || typeof body.issueDraftId !== 'string' || typeof body.caseId !== 'string' || !Number.isSafeInteger(body.expectedDraftRevision)) {
        throw new WorkspaceDraftError('invalid_append_fragment_input', 400);
      }
      const result = await deps.drafts.appendCarryOverFragment({
        fragmentId: body.fragmentId,
        issueDraftId: body.issueDraftId,
        caseId: body.caseId,
        issueId: typeof body.issueId === 'string' ? body.issueId : null,
        expectedDraftRevision: Number(body.expectedDraftRevision),
      });
      return { body: result };
    }

    const draftKindMatch = /^\/api\/workspace\/drafts\/([a-z-]+)(?:\/([^/]+))?$/.exec(pathname);
    if (draftKindMatch) {
      const kind = draftKindMatch[1]! as WorkspaceDraftKind;
      const rawId = draftKindMatch[2];
      const id = rawId ? decodeURIComponent(rawId) : undefined;
      if (!id && method === 'GET') {
        return { body: { drafts: await deps.drafts.list(kind) } };
      }
      if (id && method === 'GET') {
        const draft = await deps.drafts.read(kind, id);
        return draft ? { body: { draft } } : { status: 404, body: { error: 'draft_not_found' } };
      }
      if (id && method === 'PUT') {
        const body = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
        if (!Number.isSafeInteger(body.expectedRevision) || !body.payload || typeof body.payload !== 'object' || Array.isArray(body.payload)) {
          throw new WorkspaceDraftError('invalid_draft_save_input', 400);
        }
        const draft = await deps.drafts.save(kind, id, Number(body.expectedRevision), body.payload as Record<string, unknown>);
        return { body: { draft } };
      }
      if (id && method === 'DELETE') {
        return { body: await deps.drafts.discard(kind, id) };
      }
    }

    if (pathname === '/api/workspace/create-case' && method === 'POST') {
      const body = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
      const goal = body.goal as Record<string, unknown> | undefined;
      if (
        typeof body.draftId !== 'string' || typeof body.title !== 'string' || typeof body.description !== 'string' ||
        typeof body.rawInput !== 'string' || typeof body.adoptOperationId !== 'string' || typeof body.createOperationId !== 'string' ||
        !goal || typeof goal.goalId !== 'string' || !Number.isSafeInteger(goal.version) || typeof goal.strategy !== 'string' || typeof goal.alreadyAdopted !== 'boolean'
      ) {
        throw new WorkspaceDraftError('invalid_create_case_input', 400);
      }
      // The explicit create action is the opt-in to Case storage. Reads remain
      // side-effect free and unavailable existing stores are never reinitialized.
      if(deps.cases.getStatus().state==='uninitialized')await deps.initializeCases?.();
      const result = await executeThreeBranchCaseCreate(
        { cases: deps.cases, drafts: deps.drafts, readGoal: deps.readGoal, adoptGoal: deps.adoptGoal, createCase: deps.createCase },
        {
          draftId: body.draftId,
          title: body.title,
          description: body.description,
          rawInput: body.rawInput,
          adoptOperationId: body.adoptOperationId,
          createOperationId: body.createOperationId,
          ...(body.creationSource !== undefined ? { creationSource: body.creationSource as import('./case-types.ts').CaseCreationSource } : {}),
          ...(body.goalIntent !== undefined ? { goalIntent: body.goalIntent as import('./case-types.ts').CaseGoalIntentRef } : {}),
          goal: { goalId: goal.goalId, version: Number(goal.version), strategy: goal.strategy, alreadyAdopted: goal.alreadyAdopted },
        },
      );
      return { status: result.branch === 'created' ? 201 : 200, body: result };
    }

    return null;
  };
}
