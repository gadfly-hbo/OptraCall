import path from 'node:path';
import {existsSync, lstatSync, openSync, readFileSync, writeFileSync, fsyncSync, closeSync, renameSync, unlinkSync, constants} from 'node:fs';
import {createHash, randomUUID} from 'node:crypto';
import {StrategyDiscussionFault} from './strategy-discussion-fault.ts';
import {parseGoalDraft} from './strategy-goals-store.ts';
import {StrategyInitiativeStore} from './strategy-initiative-store.ts';
import {initiativeScopeKey, type CandidateVersion, type VerificationBatch} from './strategy-initiative-types.ts';
import type {GoalDraftInput, GoalScope} from './strategy-goals-types.ts';

const canonical = (x: unknown): unknown => Array.isArray(x) ? x.map(canonical) : x && typeof x === 'object' ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, canonical(v)])) : x;
const hash = (x: unknown): string => createHash('sha256').update(JSON.stringify(canonical(x))).digest('hex');
const uuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
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
type PublicationFile = { formatVersion: 1; publications: InitiativePublication[] };

export function createStrategyInitiativePublications(options: {
  initiatives: StrategyInitiativeStore;
  candidates: { version(id: string, cid: string, no: number): CandidateVersion };
  verifications: { passCredentials(id: string, cid: string, no: number): VerificationBatch | undefined };
  goals: {
    create(input: GoalDraftInput & { operationId: string }): { goalId: string; version: number };
    getOperation(id: string): unknown | null;
    operationContext(receipt: unknown): { goals: { goalId: string; version: number }[] }[];
    read(ref: { goalId: string; version: number }): { title: string; strategyContext?: { summary?: string } };
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
    if (!s.isFile() || s.isSymbolicLink() || s.nlink !== 1 || s.size > 2 * 1024 * 1024) throw new StrategyDiscussionFault('strategy_publication_unsafe_file');
    const fd = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW);
    let x: any;
    try { x = JSON.parse(readFileSync(fd, 'utf8')); } finally { closeSync(fd); }
    if (x.formatVersion !== 1 || !Array.isArray(x.publications)) throw new StrategyDiscussionFault('strategy_publication_corrupt');
    return x;
  }
  function writeFile(id: string, value: PublicationFile): void {
    const dir = initiatives.directory(id);
    const file = fileOf(id), temp = path.join(dir, '.' + randomUUID() + '.tmp');
    let renamed = false;
    const contents = JSON.stringify(value) + '\n';
    if (Buffer.byteLength(contents) > 2 * 1024 * 1024) throw new StrategyDiscussionFault('strategy_publication_storage_limit', 413);
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
    if (typeof input.operationId !== 'string' || !uuid.test(input.operationId)) fail('strategy_publication_operation_invalid', 400);
    const publication = get(id, publicationId);
    const scope = input.scope as GoalScope;
    if (!scope || typeof scope !== 'object' || !['enterprise', 'department', 'personal'].includes(scope.kind) || typeof scope.id !== 'string' || typeof scope.name !== 'string') fail('strategy_publication_fields_invalid', 400);
    if (!Array.isArray(input.selected) || !input.selected.length || input.selected.length > 20 || input.selected.some(i => !Number.isSafeInteger(i))) fail('strategy_publication_fields_invalid', 400);
    const candidate = candidates.version(id, publication.candidateId, publication.no);
    const selected = [...new Set(input.selected as number[])].sort((a, b) => a - b);
    if (selected.some(i => i < 0 || i >= candidate.goals.length)) fail('strategy_publication_goal_invalid', 400);
    const requestFingerprint = hash({scope, selected});
    const drafts = selected.map(index => {
      const text = candidate.goals[index]!;
      return {
        operationId: stableId({handoff: input.operationId, publicationId, index}),
        title: text, outcome: text,
        perspective: scope.kind === 'personal' ? 'personal' : 'profit',
        scope,
        measurement: {kind: 'deliverable', criterion: text},
        baseline: {state: 'pending', description: '战略发布承接，基线待核。'},
        responsible: '待指定',
        strategies: [candidate.title],
        strategyContext: {summary: `来源：战略发布 ${publicationId} · 候选 ${publication.candidateId}:${publication.no} · 指纹 ${publication.contentSha256}`},
      } as GoalDraftInput & { operationId: string };
    });
    for (const draft of drafts) {
      parseGoalDraft(draft);
      await options.validateGoal?.(draft, 'create');
    }
    return options.mutate(async () => {
      const file = readFile(id);
      const current = file.publications.find(p => p.publicationId === publicationId);
      if (!current) fail('strategy_publication_not_found', 404);
      const prior = current.handoffs.find(h => h.operationId === input.operationId);
      if (prior) {
        if (prior.requestFingerprint !== requestFingerprint) fail('strategy_publication_operation_conflict');
        return structuredClone(prior);
      }
      if (current.state !== 'active') fail('strategy_publication_not_active');
      const created: { goalId: string; version: number }[] = [];
      for (const draft of drafts) {
        const receipt = goals.getOperation(draft.operationId);
        if (receipt) {
          const context = goals.operationContext(receipt)[0];
          const ref = context?.goals[0];
          if (!ref) fail('strategy_publication_recovery_unknown', 503);
          const existing = goals.read(ref);
          if (existing.title !== draft.title || !existing.strategyContext?.summary?.includes(publicationId)) fail('strategy_publication_recovery_unknown', 503);
          created.push(ref);
          continue;
        }
        const record = goals.create(draft);
        created.push({goalId: record.goalId, version: record.version});
      }
      const receipt = {operationId: input.operationId as string, requestFingerprint, scope, goals: created, at: new Date().toISOString()};
      current.handoffs.push(receipt);
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