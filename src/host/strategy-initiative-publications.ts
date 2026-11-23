import path from 'node:path';
import {existsSync, lstatSync, openSync, readFileSync, writeFileSync, fsyncSync, closeSync, renameSync, unlinkSync, constants} from 'node:fs';
import {createHash, randomUUID} from 'node:crypto';
import {StrategyDiscussionFault} from './strategy-discussion-fault.ts';
import {parseGoalDraft} from './strategy-goals-store.ts';
import {StrategyInitiativeStore} from './strategy-initiative-store.ts';
import type {CandidateVersion, VerificationBatch} from './strategy-initiative-types.ts';
import type {GoalDraftInput, GoalOperationReceipt, GoalRef, GoalScope, GoalVersion} from './strategy-goals-types.ts';

const canonical = (x: unknown): unknown => Array.isArray(x) ? x.map(canonical) : x && typeof x === 'object' ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, canonical(v)])) : x;
const hash = (x: unknown): string => createHash('sha256').update(JSON.stringify(canonical(x))).digest('hex');
const uuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const publicationFileLimit = 2 * 1024 * 1024;
function fail(code: string, status = 409): never { throw new StrategyDiscussionFault(code, status); }
const stableId = (value: unknown) => { const h = hash(value); return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`; };

export interface InitiativePublication {
  publicationId: string;
  initiativeId: string;
  scopeKey: string;
  candidateId: string;
  no: number;
  contentSha256: string;
  lockOperationId: string;
  batchId: string;
  gateRefs: [string, string];
  operationId: string;
  requestFingerprint: string;
  state: 'active' | 'replaced' | 'withdrawn';
  template: string;
  publishedAt: string;
  replacedAt?: string;
  replacedBy?: string;
  withdrawnAt?: string;
  withdrawOperationId?: string;
  handoffs: { operationId: string; requestFingerprint: string; scope: GoalScope; goals: { goalId: string; version: number }[]; at: string }[];
}
type HandoffReservation = {publicationId: string; operationId: string; requestFingerprint: string; receiptBytes: number; legacyFingerprint?: string};
type PublicationFile = {formatVersion: 1; publications: InitiativePublication[]; pendingHandoffs?: HandoffReservation[]};

function projectedPublicationBytes(file: PublicationFile, serializedBytes: number): number {
  // Each completion removes its marker and adds a receipt with at most one
  // comma. Account for any order of completion without relying on removed commas.
  return (file.pendingHandoffs ?? []).reduce((bytes, reservation) => {
    const markerBytes = Buffer.byteLength(JSON.stringify(reservation));
    return bytes + Math.max(0, reservation.receiptBytes + 1 - markerBytes);
  }, serializedBytes);
}

export function createStrategyInitiativePublications(options: {
  initiatives: StrategyInitiativeStore;
  candidates: { version(id: string, cid: string, no: number): CandidateVersion };
  verifications: { passCredentials(id: string, cid: string, no: number): VerificationBatch | undefined };
  goals: {
    create(input: GoalDraftInput & {operationId: string}): GoalRef;
    getOperation(id: string): GoalOperationReceipt | null;
    operationContext(receipt: GoalOperationReceipt): {goals: GoalRef[]}[];
    read(ref: GoalRef): GoalVersion;
  };
  validateGoal?(input: GoalDraftInput, target?: 'create'): void | Promise<void>;
  mutate<T>(fn: () => T | Promise<T>): Promise<T>;
}) {
  const {initiatives, candidates, verifications, goals} = options;
  const fileOf = (id: string) => path.join(initiatives.directory(id), 'publications.json');
  function readFile(id: string): PublicationFile {
    const file = fileOf(id);
    if (!existsSync(file)) return {formatVersion: 1, publications: []};
    const s = lstatSync(file);
    if (!s.isFile() || s.isSymbolicLink() || s.nlink !== 1 || s.size > publicationFileLimit) throw new StrategyDiscussionFault('strategy_publication_unsafe_file');
    const fd = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW);
    let x: any;
    try { x = JSON.parse(readFileSync(fd, 'utf8')); } finally { closeSync(fd); }
    if (x.formatVersion !== 1 || !Array.isArray(x.publications) || (x.pendingHandoffs !== undefined &&
      (!Array.isArray(x.pendingHandoffs) || x.pendingHandoffs.some((item: HandoffReservation | null) =>
        !item || !Number.isSafeInteger(item.receiptBytes) || item.receiptBytes <= 0)))) {
      throw new StrategyDiscussionFault('strategy_publication_corrupt');
    }
    return x;
  }
  function writeFile(id: string, value: PublicationFile): void {
    const dir = initiatives.directory(id);
    const file = fileOf(id), temp = path.join(dir, '.' + randomUUID() + '.tmp');
    let renamed = false;
    const contents = JSON.stringify(value) + '\n';
    const bytes = Buffer.byteLength(contents);
    if (Math.max(bytes, projectedPublicationBytes(value, bytes)) > publicationFileLimit) fail('strategy_publication_storage_limit', 413);
    try {
      const fd = openSync(temp, 'wx', 0o600);
      try { writeFileSync(fd, contents); fsyncSync(fd); } finally { closeSync(fd); }
      renameSync(temp, file); renamed = true;
      const d = openSync(dir, 'r'); try { fsyncSync(d); } finally { closeSync(d); }
    } catch {
      if (!renamed) try { unlinkSync(temp); } catch {}
      throw new StrategyDiscussionFault(renamed ? 'strategy_publication_write_unknown' : 'strategy_publication_write_failed', 503);
    }
  }
  function get(id: string, publicationId: string): InitiativePublication {
    initiatives.get(id);
    const found = readFile(id).publications.find(p => p.publicationId === publicationId);
    if (!found) throw new StrategyDiscussionFault('strategy_publication_not_found', 404);
    return found;
  }
  function active(id: string, scopeKey: string): InitiativePublication | undefined {
    return readFile(id).publications.find(p => p.scopeKey === scopeKey && p.state === 'active');
  }

  async function publish(id: string, input: Record<string, unknown>) {
    initiatives.get(id);
    if (!input || typeof input !== 'object' || Object.keys(input).some(key => !['operationId', 'candidateId', 'no', 'sha256', 'batchId', 'template', 'confirmed', 'expectedActive'].includes(key))) fail('strategy_publication_fields_invalid', 400);
    if (typeof input.operationId !== 'string' || !uuid.test(input.operationId)) fail('strategy_publication_operation_invalid', 400);
    if (input.confirmed !== true) fail('strategy_publication_confirmation_required', 400);
    if (input.expectedActive !== null && typeof input.expectedActive !== 'string') fail('strategy_publication_fields_invalid', 400);
    if (typeof input.candidateId !== 'string' || !uuid.test(input.candidateId) || !Number.isSafeInteger(input.no)) fail('strategy_publication_fields_invalid', 400);
    const candidate = candidates.version(id, input.candidateId, Number(input.no));
    if (!candidate.lock) fail('strategy_candidate_not_locked');
    if (typeof input.sha256 !== 'string' || input.sha256 !== candidate.lock.fingerprint) fail('strategy_candidate_version_conflict');
    const batch = verifications.passCredentials(id, candidate.candidateId, candidate.no);
    if (!batch || typeof input.batchId !== 'string' || input.batchId !== batch.batchId) fail('strategy_verification_credentials_required');
    const template = input.template === undefined ? '树形地图' : input.template;
    if (typeof template !== 'string' || !template.trim() || template.length > 100) fail('strategy_publication_fields_invalid', 400);
    const fingerprint = hash(input);
    return options.mutate(() => {
      const file = readFile(id);
      const prior = file.publications.find(p => p.operationId === input.operationId);
      if (prior) {
        if (prior.requestFingerprint !== fingerprint) fail('strategy_publication_operation_conflict');
        return structuredClone(prior);
      }
      const current = candidates.version(id, candidate.candidateId, candidate.no);
      if (!current.lock || current.lock.fingerprint !== input.sha256 || current.lock.operationId !== batch.lockOperationId) fail('strategy_candidate_version_conflict');
      const credentials = verifications.passCredentials(id, candidate.candidateId, candidate.no);
      if (!credentials || credentials.batchId !== input.batchId) fail('strategy_verification_credentials_required');
      const currentActive = file.publications.find(p => p.scopeKey === candidate.scopeKey && p.state === 'active');
      if ((input.expectedActive ?? null) !== (currentActive?.publicationId ?? null)) fail('strategy_publication_context_changed');
      if (file.publications.some(p => p.candidateId === candidate.candidateId && p.no === candidate.no && p.state === 'withdrawn')) fail('strategy_publication_withdrawn_locked');
      if (file.publications.some(p => p.candidateId === candidate.candidateId && p.no === candidate.no && p.state === 'replaced')) fail('strategy_publication_replaced_locked');
      if (file.publications.some(p => p.candidateId === candidate.candidateId && p.no === candidate.no && p.state === 'active')) fail('strategy_publication_already_active');
      const now = new Date().toISOString();
      const publicationId = randomUUID();
      const previous = file.publications.find(p => p.scopeKey === candidate.scopeKey && p.state === 'active');
      if (previous) {
        previous.state = 'replaced';
        previous.replacedAt = now;
        previous.replacedBy = publicationId;
      }
      const publication: InitiativePublication = {
        publicationId, initiativeId: id, scopeKey: candidate.scopeKey, candidateId: candidate.candidateId, no: candidate.no,
        contentSha256: current.lock.fingerprint, lockOperationId: current.lock.operationId,
        batchId: credentials.batchId, gateRefs: [credentials.gates[0].ref, credentials.gates[1].ref],
        operationId: input.operationId as string, requestFingerprint: fingerprint,
        state: 'active', template: template as string, publishedAt: now, handoffs: [],
      };
      file.publications.push(publication);
      writeFile(id, file);
      return structuredClone(publication);
    });
  }

  async function withdraw(id: string, publicationId: string, input: Record<string, unknown>) {
    if (!input || typeof input !== 'object' || Object.keys(input).some(key => !['operationId'].includes(key))) fail('strategy_publication_fields_invalid', 400);
    if (typeof input.operationId !== 'string' || !uuid.test(input.operationId)) fail('strategy_publication_operation_invalid', 400);
    get(id, publicationId);
    return options.mutate(() => {
      const file = readFile(id);
      const publication = file.publications.find(p => p.publicationId === publicationId);
      if (!publication) fail('strategy_publication_not_found', 404);
      if (publication.state === 'withdrawn') {
        if (publication.withdrawOperationId === input.operationId) return structuredClone(publication);
        fail('strategy_publication_not_active');
      }
      if (publication.state !== 'active') fail('strategy_publication_not_active');
      publication.state = 'withdrawn';
      publication.withdrawnAt = new Date().toISOString();
      publication.withdrawOperationId = input.operationId as string;
      writeFile(id, file);
      return structuredClone(publication);
    });
  }

  async function handoff(id: string, publicationId: string, input: Record<string, unknown>) {
    if (!input || typeof input !== 'object' || Object.keys(input).some(key => !['operationId', 'scope', 'selected'].includes(key))) fail('strategy_publication_fields_invalid', 400);
    const operationId = input.operationId;
    if (typeof operationId !== 'string' || !uuid.test(operationId)) fail('strategy_publication_operation_invalid', 400);
    const publication = get(id, publicationId);
    const suppliedScope = input.scope as GoalScope;
    if (!suppliedScope || typeof suppliedScope !== 'object' || !['enterprise', 'department', 'personal'].includes(suppliedScope.kind) || typeof suppliedScope.id !== 'string' || typeof suppliedScope.name !== 'string') fail('strategy_publication_fields_invalid', 400);
    if (!Array.isArray(input.selected) || !input.selected.length || input.selected.length > 20 || input.selected.some(i => !Number.isSafeInteger(i))) fail('strategy_publication_fields_invalid', 400);
    const candidate = candidates.version(id, publication.candidateId, publication.no);
    const selected = [...new Set(input.selected as number[])].sort((a, b) => a - b);
    if (selected.some(i => i < 0 || i >= candidate.goals.length)) fail('strategy_publication_goal_invalid', 400);
    const drafts = selected.map(index => {
      const text = candidate.goals[index]!;
      return parseGoalDraft({
        title: text, outcome: text,
        perspective: suppliedScope.kind === 'personal' ? 'personal' : 'profit',
        scope: suppliedScope,
        measurement: {kind: 'deliverable', criterion: text},
        baseline: {state: 'pending', description: '战略发布承接，基线待核。'},
        responsible: '待指定',
        strategies: [candidate.title],
        strategyContext: {summary: `来源：战略发布 ${publicationId} · 候选 ${publication.candidateId}:${publication.no} · 指纹 ${publication.contentSha256}`},
      });
    });
    const scope = drafts[0]!.scope;
    const requestFingerprint = hash({scope, selected});
    const suppliedFingerprint = hash({scope: suppliedScope, selected});
    const receiptIdentity = {operationId, requestFingerprint, scope};
    return options.mutate(async () => {
      const file = readFile(id);
      const current = file.publications.find(p => p.publicationId === publicationId);
      if (!current) fail('strategy_publication_not_found', 404);
      const prior = current.handoffs.find(h => h.operationId === operationId);
      if (prior) {
        // Older receipts used the submitted scope before GoalStore normalization.
        if (prior.requestFingerprint !== requestFingerprint && prior.requestFingerprint !== suppliedFingerprint) fail('strategy_publication_operation_conflict');
        return structuredClone(prior);
      }
      const pending = file.pendingHandoffs ?? [];
      const reservation = pending.find(item => item.publicationId === publicationId && item.operationId === operationId);
      if (reservation && reservation.requestFingerprint !== requestFingerprint) fail('strategy_publication_operation_conflict');
      // Older unfinished writes may have used the exact supplied scope instead
      // of its normalized form. Preserve that lookup while the request is pending.
      const legacyFingerprint = reservation
        ? reservation.legacyFingerprint
        : suppliedFingerprint === requestFingerprint ? undefined : suppliedFingerprint;
      if (!reservation && current.state !== 'active') fail('strategy_publication_not_active');
      if (current.state === 'active') {
        for (const draft of drafts) await options.validateGoal?.(draft, 'create');
      }
      if (!reservation) {
        // Reserve the request and final space before saving goals. GoalStore creates
        // UUIDs at version 1, and an extended-year ISO date has the longest timestamp.
        const receiptBytes = Buffer.byteLength(JSON.stringify({
          ...receiptIdentity,
          goals: selected.map(() => ({goalId: '00000000-0000-0000-0000-000000000000', version: 1})),
          at: '+275760-09-13T00:00:00.000Z',
        }));
        pending.push({publicationId, operationId, requestFingerprint, receiptBytes, ...(legacyFingerprint && {legacyFingerprint})});
        file.pendingHandoffs = pending;
        writeFile(id, file);
      }
      const created = drafts.map((draft, position) => {
        const idFor = (fingerprint: string) => stableId({handoff: operationId, publicationId, index: selected[position], requestFingerprint: fingerprint});
        const goalOperationId = idFor(requestFingerprint);
        const legacyOperationId = legacyFingerprint ? idFor(legacyFingerprint) : undefined;
        const currentReceipt = goals.getOperation(goalOperationId);
        const legacyReceipt = legacyOperationId ? goals.getOperation(legacyOperationId) : null;
        if (currentReceipt && legacyReceipt) fail('strategy_publication_recovery_unknown', 503);
        const receipt = currentReceipt ?? legacyReceipt;
        if (receipt) {
          if (receipt.kind !== 'create' || receipt.operationId !== (legacyReceipt ? legacyOperationId : goalOperationId)) fail('strategy_publication_recovery_unknown', 503);
          const [context] = goals.operationContext(receipt);
          const ref = context?.goals.length === 1 ? context.goals[0] : undefined;
          if (!ref || ref.version !== 1) fail('strategy_publication_recovery_unknown', 503);
          const existing = goals.read(ref);
          if (existing.goalId !== ref.goalId || existing.version !== ref.version || hash(parseGoalDraft(existing)) !== hash(draft)) fail('strategy_publication_recovery_unknown', 503);
          return {goalId: ref.goalId, version: ref.version};
        }
        // A withdrawn or replaced release can only reconcile goals saved while it was active.
        if (current.state !== 'active') fail('strategy_publication_not_active');
        const {goalId, version} = goals.create({...draft, operationId: goalOperationId});
        return {goalId, version};
      });
      const receipt = {...receiptIdentity, goals: created, at: new Date().toISOString()};
      current.handoffs.push(receipt);
      file.pendingHandoffs = pending.filter(item => item.publicationId !== publicationId || item.operationId !== operationId);
      writeFile(id, file);
      return structuredClone(receipt);
    });
  }

  return {
    publish, withdraw, handoff, get, active,
    list(id: string, scopeKey?: string) {
      initiatives.get(id);
      const all = readFile(id).publications;
      return structuredClone(scopeKey === undefined ? all : all.filter(p => p.scopeKey === scopeKey));
    },
  };
}
