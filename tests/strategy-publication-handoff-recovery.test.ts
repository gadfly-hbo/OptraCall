import test, {type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import {createHash, randomUUID} from 'node:crypto';
import {existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmdirSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {StrategyGoalsStore} from '../src/host/strategy-goals-store.ts';
import {createStrategyInitiativePublications} from '../src/host/strategy-initiative-publications.ts';
import {StrategyInitiativeStore} from '../src/host/strategy-initiative-store.ts';
import {initiativeScopeKey, type CandidateVersion, type VerificationBatch, type VerificationGate} from '../src/host/strategy-initiative-types.ts';
import type {GoalDraftInput, GoalScope} from '../src/host/strategy-goals-types.ts';

const scope = {kind: 'personal', id: 'self', name: '个人工作'} as const;
const otherScope = {kind: 'department', id: 'other', name: '部门 B'} as const;

function fixture(t: TestContext) {
  const dataRoot = mkdtempSync(path.join(tmpdir(), 'optracall-handoff-recovery-'));
  t.after(() => rmSync(dataRoot, {recursive: true, force: true}));
  const initiatives = new StrategyInitiativeStore(dataRoot);
  const initiative = initiatives.create({operationId: randomUUID(), scopes: [scope, otherScope]});
  const publicationFile = path.join(initiatives.directory(initiative.id), 'publications.json');
  const originalFile = publicationFile + '.original';
  const at = new Date().toISOString();
  const lock = {operationId: randomUUID(), operator: '决策者', at, fingerprint: 'a'.repeat(64)};
  const configurationId = randomUUID();
  const candidate: CandidateVersion = {
    initiativeId: initiative.id, candidateId: randomUUID(), no: 1, scopeKey: initiativeScopeKey(scope),
    title: '会员复购优先', anchor: {reportNo: 1, contentSha256: 'b'.repeat(64)}, blocks: [],
    goals: ['二购率提高', '明确试点范围'], contentSha256: lock.fingerprint, configurationId,
    configurationRevision: 1, revision: 1, createOperationId: randomUUID(), instruction: '形成方案',
    lock, createdAt: at, updatedAt: at,
  };
  const gate = (turn: 0 | 1): VerificationGate => ({
    turn, operationId: randomUUID(), ref: String(turn), status: 'completed', verdict: 'pass',
    configurationId, configurationRevision: 1, attempts: [],
  });
  const batch: VerificationBatch = {
    batchId: randomUUID(), initiativeId: initiative.id, candidateId: candidate.candidateId, no: candidate.no,
    contentSha256: candidate.contentSha256, lockOperationId: lock.operationId, gates: [gate(0), gate(1)],
    state: 'passed', createdAt: at, updatedAt: at,
  };
  function blockPublicationRename() {
    // Keep the previous ledger intact and force a portable final rename failure.
    renameSync(publicationFile, originalFile);
    mkdirSync(publicationFile);
  }
  function open(failReceiptWrite?: 'after-create' | 'after-read') {
    const goals = new StrategyGoalsStore(dataRoot);
    const publications = createStrategyInitiativePublications({
      initiatives, candidates: {version: () => candidate}, verifications: {passCredentials: () => batch},
      goals: {
        create(input: GoalDraftInput & {operationId: string}) {
          const created = goals.create(input);
          if (failReceiptWrite === 'after-create') blockPublicationRename();
          return created;
        },
        getOperation: id => goals.getOperation(id),
        operationContext: receipt => goals.operationContext(receipt),
        read(ref) {
          const original = goals.read(ref);
          if (failReceiptWrite === 'after-read') blockPublicationRename();
          return original;
        },
      },
      mutate: async action => action(),
    });
    return {goals, publications};
  }

  const publish = () => open().publications.publish(initiative.id, {
    operationId: randomUUID(), candidateId: candidate.candidateId, no: candidate.no, sha256: candidate.contentSha256,
    batchId: batch.batchId, confirmed: true, expectedActive: null,
  });
  function restorePublicationFile() {
    if (!existsSync(originalFile)) return;
    rmdirSync(publicationFile);
    renameSync(originalFile, publicationFile);
  }
  function leaveLedgerBytes(available: number) {
    const ledger = {...JSON.parse(readFileSync(publicationFile, 'utf8')), fixturePadding: ''};
    const baseBytes = Buffer.byteLength(JSON.stringify(ledger) + '\n');
    ledger.fixturePadding = 'x'.repeat(2 * 1024 * 1024 - baseBytes - available);
    writeFileSync(publicationFile, JSON.stringify(ledger) + '\n');
  }
  return {id: initiative.id, open, publish, restorePublicationFile, leaveLedgerBytes};
}

test('承接回执写入失败后，改范围或选择须冲突，原请求读回准确目标', async t => {
  const {id, open, publish, restorePublicationFile} = fixture(t);
  const initial = open('after-create');
  const publication = await publish();
  const request = {operationId: randomUUID(), scope, selected: [0]};
  try {
    await assert.rejects(initial.publications.handoff(id, publication.publicationId, request), {code: 'strategy_publication_write_failed', status: 503});
  } finally {
    restorePublicationFile();
  }

  const {goals, publications} = open();
  const handoff = (changes: {scope?: GoalScope; selected?: number[]} = {}) =>
    publications.handoff(id, publication.publicationId, {...request, ...changes});
  const [originalGoal] = goals.list().goals;
  assert.ok(originalGoal);
  assert.equal(goals.list().goals.length, 1);
  assert.deepEqual(publications.get(id, publication.publicationId).handoffs, []);
  await assert.rejects(handoff({scope: otherScope}), {code: 'strategy_publication_operation_conflict', status: 409});
  await assert.rejects(handoff({selected: [1]}), {code: 'strategy_publication_operation_conflict', status: 409});
  assert.equal(goals.list().goals.length, 1);
  const receipt = await handoff({scope: {...scope, name: ' 个人工作 '}, selected: [0, 0]});
  assert.deepEqual(receipt.goals, [{goalId: originalGoal.id, version: 1}]);
  assert.deepEqual(receipt.scope, scope);
  const recovered = goals.read(receipt.goals[0]!);
  assert.deepEqual(recovered.scope, scope);
  assert.match(recovered.strategyContext!.summary, new RegExp(publication.publicationId));
  assert.deepEqual(await handoff(), receipt);
  assert.equal(goals.list().goals.length, 1);
});

test('账本剩余空间不足以写入承接回执时，预留拒绝且零目标写入', async t => {
  const {id, open, publish, leaveLedgerBytes} = fixture(t);
  const publication = await publish();
  const {goals, publications} = open();
  leaveLedgerBytes(400);
  const longScope = {...scope, name: '部门'.repeat(120)};
  await assert.rejects(publications.handoff(id, publication.publicationId, {
    operationId: randomUUID(), scope: longScope, selected: [0, 1],
  }), {code: 'strategy_publication_storage_limit', status: 413});
  assert.deepEqual(goals.list().goals, []);
  assert.deepEqual(publications.get(id, publication.publicationId).handoffs, []);
});

test('等待恢复的承接回执空间不能被撤销记录占用', async t => {
  const {id, open, publish, restorePublicationFile, leaveLedgerBytes} = fixture(t);
  const publication = await publish();
  const longScope = {...scope, name: '部门'.repeat(120)};
  const request = {operationId: randomUUID(), scope: longScope, selected: [0]};
  const exampleReceipt = {
    operationId: request.operationId, requestFingerprint: 'a'.repeat(64), scope: longScope,
    goals: [{goalId: randomUUID(), version: 1}], at: new Date().toISOString(),
  };
  // Leave room for the whole receipt and its ledger syntax, but not a withdrawal.
  leaveLedgerBytes(Buffer.byteLength(JSON.stringify(exampleReceipt)) + 40);
  try {
    await assert.rejects(open('after-create').publications.handoff(id, publication.publicationId, request), {code: 'strategy_publication_write_failed', status: 503});
  } finally {
    restorePublicationFile();
  }
  const {goals, publications} = open();
  await assert.rejects(publications.withdraw(id, publication.publicationId, {operationId: randomUUID()}), {code: 'strategy_publication_storage_limit', status: 413});
  assert.equal(publications.get(id, publication.publicationId).state, 'active');
  const receipt = await publications.handoff(id, publication.publicationId, request);
  assert.deepEqual(receipt.goals, [{goalId: goals.list().goals[0]!.id, version: 1}]);
  assert.equal(goals.list().goals.length, 1);
});

test('旧请求范围含空白时，只恢复原准确目标，后续重试沿同一预留回执', async t => {
  const {id, open, publish, restorePublicationFile} = fixture(t);
  const publication = await publish();
  const {goals, publications} = open();
  const suppliedScope = {...scope, name: ' 个人工作 '};
  const request = {operationId: randomUUID(), scope: suppliedScope, selected: [0]};
  const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
  const requestFingerprint = digest({scope: {id: suppliedScope.id, kind: suppliedScope.kind, name: suppliedScope.name}, selected: request.selected});
  const oldGoalIdHash = digest({handoff: request.operationId, index: 0, publicationId: publication.publicationId, requestFingerprint});
  const oldOperationId = `${oldGoalIdHash.slice(0, 8)}-${oldGoalIdHash.slice(8, 12)}-${oldGoalIdHash.slice(12, 16)}-${oldGoalIdHash.slice(16, 20)}-${oldGoalIdHash.slice(20, 32)}`;
  const original = goals.create({
    operationId: oldOperationId, title: '二购率提高', outcome: '二购率提高', perspective: 'personal', scope: suppliedScope,
    measurement: {kind: 'deliverable', criterion: '二购率提高'},
    baseline: {state: 'pending', description: '战略发布承接，基线待核。'}, responsible: '待指定', strategies: ['会员复购优先'],
    strategyContext: {summary: `来源：战略发布 ${publication.publicationId} · 候选 ${publication.candidateId}:${publication.no} · 指纹 ${publication.contentSha256}`},
  });
  try {
    await assert.rejects(open('after-read').publications.handoff(id, publication.publicationId, request), {code: 'strategy_publication_write_failed', status: 503});
  } finally {
    restorePublicationFile();
  }
  const receipt = await publications.handoff(id, publication.publicationId, {...request, scope});
  assert.deepEqual(receipt.goals, [{goalId: original.goalId, version: 1}]);
  assert.deepEqual(receipt.scope, scope);
  assert.equal(goals.list().goals.length, 1);
});
