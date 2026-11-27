import type { CaseGoalBindingInput, CaseRecord } from './case-types.ts';
import type { CaseStore } from './case-store.ts';
import type { PrepareDraftPayload, WorkspaceDraftRecord, WorkspaceDraftStore } from './workspace-draft-store.ts';

export type AdoptGoalFn = (input: { operationId: string; goalId: string; expectedVersion: number; strategy: string }) => Promise<{ goalId: string; version: number; strategy: string; adoptedAt: string }>;
export type CreateCaseFn = (input: { operationId: string; title: string; description: string; goalBinding: CaseGoalBindingInput }) => Promise<CaseRecord>;

export type ThreeBranchCreateInput = {
  draftId: string;
  title: string;
  description: string;
  rawInput: string;
  goal: { goalId: string; version: number; strategy: string; alreadyAdopted: boolean };
  adoptOperationId: string;
  createOperationId: string;
};

export type ThreeBranchCreateResult =
  | {
      branch: 'continue';
      existingCase: CaseRecord;
      /** Closed cases are never auto-reopened; caller shows original record with explicit reopen path. */
      isClosed: boolean;
      preservedDraft: WorkspaceDraftRecord<PrepareDraftPayload>;
    }
  | {
      branch: 'created';
      createdCase: CaseRecord;
      adoptionReceipt: PrepareDraftPayload['adoptionReceipt'];
      creationReceipt: NonNullable<PrepareDraftPayload['creationReceipt']>;
      replayedFromOperation: boolean;
      draft: WorkspaceDraftRecord<PrepareDraftPayload>;
    }
  | {
      branch: 'partial';
      createStatus: 'failed' | 'unknown';
      errorCode: string;
      adoptionReceipt: PrepareDraftPayload['adoptionReceipt'];
      createOperationId: string;
      draft: WorkspaceDraftRecord<PrepareDraftPayload>;
    };

/**
 * Implements the three creation branches (DW11 / DW14) without altering goal authority:
 * 1. Exact G/S already has a Case -> 'continue' (never creates a duplicate, never auto-reopens closed Case, keeps input in draft).
 * 2. Adopted G/S without Case -> creates Case with operationId idempotency.
 * 3. New G/S candidate -> explicitly adopts first (separate receipt saved immediately), then creates Case.
 *    On partial failure or dropped/unknown response, keeps exact goal version, input, operationIds, and adoption receipt.
 *    Retry checks the original createOperationId first and only continues the unfinished step.
 */
export async function executeThreeBranchCaseCreate(
  deps: {
    cases: Pick<CaseStore, 'listCases' | 'getGoalBinding' | 'getOperation' | 'getCase'>;
    drafts: WorkspaceDraftStore;
    adoptGoal: AdoptGoalFn;
    createCase: CreateCaseFn;
  },
  input: ThreeBranchCreateInput,
): Promise<ThreeBranchCreateResult> {
  const existingDraft = await deps.drafts.read<PrepareDraftPayload>('prepare', input.draftId);
  let draftRev = existingDraft?.revision ?? 0;
  let adoptionReceipt = existingDraft?.payload.adoptionReceipt ?? null;

  const saveDraft = async (patch: Partial<PrepareDraftPayload>): Promise<WorkspaceDraftRecord<PrepareDraftPayload>> => {
    const base: PrepareDraftPayload = existingDraft?.payload ?? {
      rawInput: input.rawInput,
      title: input.title,
      description: input.description,
      selectedGoal: { goalId: input.goal.goalId, version: input.goal.version, strategy: input.goal.strategy },
      adoptOperationId: input.adoptOperationId,
      createOperationId: input.createOperationId,
      adoptionReceipt,
      creationReceipt: null,
      creationState: 'idle',
      targetLocation: null,
    };
    const next: PrepareDraftPayload = {
      ...base,
      rawInput: input.rawInput,
      title: input.title,
      description: input.description,
      selectedGoal: { goalId: input.goal.goalId, version: input.goal.version, strategy: input.goal.strategy },
      adoptOperationId: input.adoptOperationId,
      createOperationId: input.createOperationId,
      adoptionReceipt,
      ...patch,
    };
    const saved = await deps.drafts.save<PrepareDraftPayload>('prepare', input.draftId, draftRev, next);
    draftRev = saved.revision;
    return saved;
  };

  // Step 0: Retry safety — check original createOperationId first before any write!
  const priorCreate = deps.cases.getOperation(input.createOperationId);
  if (priorCreate && priorCreate.phase === 'completed' && priorCreate.caseId) {
    const createdCase = deps.cases.getCase(priorCreate.caseId);
    const creationReceipt = { caseId: createdCase.id, operationId: input.createOperationId, createdAt: priorCreate.updatedAt };
    const draft = await saveDraft({ creationReceipt, creationState: 'completed', targetLocation: { caseId: createdCase.id } });
    return { branch: 'created', createdCase, adoptionReceipt, creationReceipt, replayedFromOperation: true, draft };
  }

  // Step 1: Check if exact G/S already has a Case (never merge by title, never auto-reopen closed Case).
  const targetGoalId = adoptionReceipt?.goalId ?? input.goal.goalId;
  const targetVersion = adoptionReceipt?.version ?? input.goal.version;
  const targetStrategy = adoptionReceipt?.strategy ?? input.goal.strategy;
  const matched = deps.cases.listCases().find(record => {
    const binding = deps.cases.getGoalBinding(record.id);
    return binding && binding.primary.goalId === targetGoalId && binding.primary.version === targetVersion && (binding.strategy ?? '') === targetStrategy;
  });
  if (matched) {
    const preservedDraft = await saveDraft({ targetLocation: { caseId: matched.id }, creationState: 'idle' });
    return { branch: 'continue', existingCase: matched, isClosed: matched.status === 'closed', preservedDraft };
  }

  // Step 2: Adopt new G/S if not already adopted (and not already recorded in adoptionReceipt).
  if (!input.goal.alreadyAdopted && !adoptionReceipt) {
    const adopted = await deps.adoptGoal({
      operationId: input.adoptOperationId,
      goalId: input.goal.goalId,
      expectedVersion: input.goal.version,
      strategy: input.goal.strategy,
    });
    adoptionReceipt = {
      goalId: adopted.goalId,
      version: adopted.version,
      strategy: adopted.strategy,
      operationId: input.adoptOperationId,
      adoptedAt: adopted.adoptedAt,
    };
    // Persist adoption receipt immediately BEFORE Case creation so partial failure never loses it.
    await saveDraft({ adoptionReceipt, selectedGoal: { goalId: adopted.goalId, version: adopted.version, strategy: adopted.strategy } });
  }

  // Step 3: Create Case using exact adopted GoalRef + strategy.
  const binding: CaseGoalBindingInput = {
    primary: { goalId: adoptionReceipt?.goalId ?? input.goal.goalId, version: adoptionReceipt?.version ?? input.goal.version },
    related: [],
    strategy: adoptionReceipt?.strategy ?? input.goal.strategy,
  };
  try {
    const createdCase = await deps.createCase({
      operationId: input.createOperationId,
      title: input.title,
      description: input.description,
      goalBinding: binding,
    });
    const creationReceipt = { caseId: createdCase.id, operationId: input.createOperationId, createdAt: createdCase.createdAt };
    const draft = await saveDraft({ creationReceipt, creationState: 'completed', targetLocation: { caseId: createdCase.id } });
    return { branch: 'created', createdCase, adoptionReceipt, creationReceipt, replayedFromOperation: false, draft };
  } catch (error) {
    const code = typeof (error as { code?: unknown })?.code === 'string' ? String((error as { code?: unknown }).code) : 'case_create_unknown';
    const isUnknown = code === 'case_create_unknown' || code === 'network_timeout' || code === 'response_dropped';
    const draft = await saveDraft({ creationState: isUnknown ? 'partial_unknown' : 'partial_failed' });
    return {
      branch: 'partial',
      createStatus: isUnknown ? 'unknown' : 'failed',
      errorCode: code,
      adoptionReceipt,
      createOperationId: input.createOperationId,
      draft,
    };
  }
}
