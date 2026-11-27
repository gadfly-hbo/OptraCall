import { projectHomePending } from './home-pending.ts';
import { listVisibleCaseDirectory } from './case-directory.ts';
import { executeThreeBranchCaseCreate, type AdoptGoalFn, type CreateCaseFn } from './case-creation-orchestrator.ts';
import { WorkspaceDraftError, type WorkspaceDraftKind, type WorkspaceDraftStore } from './workspace-draft-store.ts';
import type { CaseStore } from './case-store.ts';
import type { CaseFeedbackResponse } from './case-decision-types.ts';
import type { createDecisionBoardStore } from '../../extensions/business-plugins/decision-board/storage/store.ts';

type BoardStore = Pick<ReturnType<typeof createDecisionBoardStore>, 'getTask' | 'getItem' | 'listFeedbackHistory'>;

export type WorkspaceDailyRoutesDeps = {
  cases: CaseStore;
  drafts: WorkspaceDraftStore;
  board?: BoardStore;
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
      const entries = deps.cases.listCases().map(record => {
        const issues = deps.cases.listDecisionIssues(record.id);
        const requests = deps.cases.listDecisionRequests(record.id);
        const choices = deps.cases.getStrategyChoices(record.id);
        const pendingOperations = deps.cases.listPendingProjectOperations(record.id);
        let feedbackResponses: CaseFeedbackResponse[] | undefined;
        if (deps.board && requests.some(r => r.target.kind === 'observe')) {
          const collected: CaseFeedbackResponse[] = [];
          let anyUnreadable = false;
          for (const req of requests) {
            if (req.target.kind !== 'observe') continue;
            try {
              const task = deps.board.getTask(req.target.taskId);
              const item = deps.board.getItem(task.itemId);
              const history = deps.board.listFeedbackHistory(task.id);
              for (let idx = 0; idx < history.length; idx++) {
                const rev = history[idx]!;
                if (!rev.respondsToRequest) continue;
                collected.push({
                  requestId: rev.respondsToRequest.requestId,
                  requestRevision: rev.respondsToRequest.revision,
                  projectId: item.projectId,
                  itemId: item.id,
                  taskId: task.id,
                  authorizationId: rev.respondsToRequest.authorizationId,
                  revisionId: rev.revisionId,
                  baseRevisionId: idx === 0 ? null : history[idx - 1]!.revisionId,
                });
              }
            } catch { anyUnreadable = true; }
          }
          feedbackResponses = anyUnreadable ? undefined : collected;
        }
        return { record, issues, requests, choices, feedbackResponses, pendingOperations };
      });
      return { body: projectHomePending({ storeState: 'ready', cases: entries }) };
    }

    if (pathname === '/api/workspace/case-directory' && method === 'GET') {
      const query = searchParams.get('query') ?? undefined;
      const rawLimit = searchParams.get('limit');
      const limit = rawLimit && /^\d+$/.test(rawLimit) ? Number(rawLimit) : undefined;
      const includeClosed = searchParams.get('includeClosed') === 'true';
      return { body: listVisibleCaseDirectory(deps.cases, { query, limit, includeClosed }) };
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
      const result = await executeThreeBranchCaseCreate(
        { cases: deps.cases, drafts: deps.drafts, adoptGoal: deps.adoptGoal, createCase: deps.createCase },
        {
          draftId: body.draftId,
          title: body.title,
          description: body.description,
          rawInput: body.rawInput,
          adoptOperationId: body.adoptOperationId,
          createOperationId: body.createOperationId,
          goal: { goalId: goal.goalId, version: Number(goal.version), strategy: goal.strategy, alreadyAdopted: goal.alreadyAdopted },
        },
      );
      return { status: result.branch === 'created' ? 201 : 200, body: result };
    }

    return null;
  };
}
