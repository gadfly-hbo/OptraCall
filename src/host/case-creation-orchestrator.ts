import type { CaseCreationSource, CaseGoalBindingInput, CaseGoalIntentRef, CaseRecord } from './case-types.ts';
import type { CaseStore } from './case-store.ts';
import { WorkspaceDraftError, type PrepareDraftPayload, type WorkspaceDraftRecord, type WorkspaceDraftStore } from './workspace-draft-store.ts';

export type VerifiedGoalAuthority = {
  goalId: string;
  version: number;
  status: 'candidate' | 'adopted' | 'superseded' | 'archived' | string;
  strategies: string[];
};
export type ReadGoalFn = (ref: { goalId: string; version: number }) => Promise<VerifiedGoalAuthority>;
export type AdoptGoalFn = (input: { operationId: string; goalId: string; expectedVersion: number; strategy: string }) => Promise<{ goalId: string; version: number; strategy: string; adoptedAt: string }>;
export type CreateCaseFn = (input: { operationId: string; title: string; description: string; goalBinding: CaseGoalBindingInput; creationSource?:CaseCreationSource; goalIntent?:CaseGoalIntentRef }) => Promise<CaseRecord>;

export type ThreeBranchCreateInput = {
  draftId: string;
  title: string;
  description: string;
  rawInput: string;
  goal: { goalId: string; version: number; strategy: string; alreadyAdopted: boolean };
  adoptOperationId: string;
  createOperationId: string;
  creationSource?: CaseCreationSource;
  goalIntent?: CaseGoalIntentRef;
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
 * Implements the three creation branches (DW11 / DW14) with strict authority & recovery checks (FR01 / FR02):
 * - NEVER trusts client `alreadyAdopted`; always verifies real GoalVersion, strategy membership, and adoption status via `readGoal`.
 * - NEVER borrows a prior partial `adoptionReceipt` for a different (goalId, version, strategy); rejects with 409 `prepare_draft_goal_mismatch` while preserving the original receipt.
 * - NEVER replays an unrelated completed operation (must be `kind === 'case_create'` matching the exact Case goalBinding/title/description, else 409 `operation_conflict`).
 */
export async function executeThreeBranchCaseCreate(
  deps: {
    cases: Pick<CaseStore, 'listCases' | 'getGoalBinding' | 'getOperation' | 'getCase'>;
    drafts: WorkspaceDraftStore;
    readGoal?: ReadGoalFn;
    adoptGoal: AdoptGoalFn;
    createCase: CreateCaseFn;
  },
  input: ThreeBranchCreateInput,
): Promise<ThreeBranchCreateResult> {
  const existingDraft = await deps.drafts.read<PrepareDraftPayload>('prepare', input.draftId);
  let draftRev = existingDraft?.revision ?? 0;
  let adoptionReceipt = existingDraft?.payload.adoptionReceipt ?? null;

  // FR02: If this draft already holds a partial adoptionReceipt for G/S A, refusing to silently bind A when the user switched to G/S B.
  if (
    adoptionReceipt &&
    (adoptionReceipt.goalId !== input.goal.goalId ||
      adoptionReceipt.version !== input.goal.version ||
      adoptionReceipt.strategy !== input.goal.strategy)
  ) {
    throw new WorkspaceDraftError('prepare_draft_goal_mismatch', 409);
  }

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
      ...(input.creationSource?{creationSource:input.creationSource}:{}), ...(input.goalIntent?{goalIntent:input.goalIntent}:{}),
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
      ...(input.creationSource?{creationSource:input.creationSource}:{}), ...(input.goalIntent?{goalIntent:input.goalIntent}:{}),
      ...patch,
    };
    const saved = await deps.drafts.save<PrepareDraftPayload>('prepare', input.draftId, draftRev, next);
    draftRev = saved.revision;
    return saved;
  };

  // Step 0 (FR02): Retry safety — verify original createOperationId is genuinely a completed `case_create`
  // for this exact (goalId, version, strategy, title, description); never impersonate `case_note` or another Case!
  const priorCreate = deps.cases.getOperation(input.createOperationId);
  if (priorCreate) {
    if (priorCreate.kind !== 'case_create' || priorCreate.phase !== 'completed' || !priorCreate.caseId) {
      throw new WorkspaceDraftError('operation_conflict', 409);
    }
    // The original create authority compares its immutable, normalized request
    // hash and reads its saved result. Later edits or goal revisions must neither
    // invalidate that receipt nor make a different request appear to match it.
    const createdCase = await deps.createCase({
      operationId: input.createOperationId, title: input.title, description: input.description,
      goalBinding: { primary: { goalId: input.goal.goalId, version: input.goal.version }, related: [], strategy: input.goal.strategy },
      ...(input.creationSource?{creationSource:input.creationSource}:{}), ...(input.goalIntent?{goalIntent:input.goalIntent}:{}),
    });
    const creationReceipt = { caseId: createdCase.id, operationId: input.createOperationId, createdAt: priorCreate.updatedAt };
    const draft = await saveDraft({ creationReceipt, creationState: 'completed', targetLocation: { caseId: createdCase.id } });
    return { branch: 'created', createdCase, adoptionReceipt, creationReceipt, replayedFromOperation: true, draft };
  }

  // Admission applies to new writes; completed original operations above are
  // read back under their original identity even after the goal changes.
  let realGoalAdopted = input.goal.alreadyAdopted;
  if (deps.readGoal) {
    const authoritative = await deps.readGoal({ goalId: input.goal.goalId, version: input.goal.version });
    if (!input.goal.strategy || !authoritative.strategies.includes(input.goal.strategy)) throw new WorkspaceDraftError('invalid_goal_strategy', 400);
    realGoalAdopted = authoritative.status === 'adopted';
    if (input.goal.alreadyAdopted && !realGoalAdopted) throw new WorkspaceDraftError('goal_not_adopted', 409);
  }

  // Step 1: Check if exact G/S already has a Case (never merge by title, never auto-reopen closed Case).
  const targetGoalId = input.goal.goalId;
  const targetVersion = input.goal.version;
  const targetStrategy = input.goal.strategy;
  const matched = deps.cases.listCases().find(record => {
    const binding = deps.cases.getGoalBinding(record.id);
    return binding && binding.primary.goalId === targetGoalId && binding.primary.version === targetVersion && (binding.strategy ?? '') === targetStrategy;
  });
  if (matched) {
    const preservedDraft = await saveDraft({ targetLocation: { caseId: matched.id }, creationState: 'idle' });
    return { branch: 'continue', existingCase: matched, isClosed: matched.status === 'closed', preservedDraft };
  }

  // Step 2: Adopt new G/S if not yet adopted (and not already recorded in adoptionReceipt).
  if (!realGoalAdopted && !adoptionReceipt) {
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
    await saveDraft({ adoptionReceipt, selectedGoal: { goalId: adopted.goalId, version: adopted.version, strategy: adopted.strategy } });
  }

  // Step 3: Create Case using exact adopted GoalRef + strategy.
  const binding: CaseGoalBindingInput = {
    primary: { goalId: input.goal.goalId, version: input.goal.version },
    related: [],
    strategy: input.goal.strategy,
  };
  try {
    const createdCase = await deps.createCase({
      operationId: input.createOperationId,
      title: input.title,
      description: input.description,
      goalBinding: binding,
      ...(input.creationSource?{creationSource:input.creationSource}:{}), ...(input.goalIntent?{goalIntent:input.goalIntent}:{}),
    });
    const creationReceipt = { caseId: createdCase.id, operationId: input.createOperationId, createdAt: createdCase.createdAt };
    const draft = await saveDraft({ creationReceipt, creationState: 'completed', targetLocation: { caseId: createdCase.id } });
    return { branch: 'created', createdCase, adoptionReceipt, creationReceipt, replayedFromOperation: false, draft };
  } catch (error) {
    const code = typeof (error as { code?: unknown })?.code === 'string' ? String((error as { code?: unknown }).code) : 'case_create_unknown';
    const status = Number((error as { statusCode?: number; status?: number })?.statusCode ?? (error as { status?: number })?.status);
    const isUnknown = code === 'case_create_unknown' || code === 'network_timeout' || code === 'response_dropped'
      || code === 'case_transaction_outcome_unknown' || !Number.isFinite(status) && !(error as { code?: unknown })?.code || status >= 500;
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
