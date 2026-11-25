import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID, createHash} from 'node:crypto';
import {mkdtemp, rm, readFile, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {StrategyInitiativeStore} from '../src/host/strategy-initiative-store.ts';
import {StrategyInitiativeReports} from '../src/host/strategy-initiative-reports.ts';
import {StrategyInitiativeFiles} from '../src/host/strategy-initiative-files.ts';
import {createStrategyInitiativeHost} from '../src/host/strategy-initiative-host.ts';
import {createStrategyCandidateHost} from '../src/host/strategy-candidate-host.ts';

const scope = {kind: 'department' as const, id: 'east', name: '东区'};
const scopeKey = 'department::east';
const fields = {
  horizon: '2027–2029', diagnosis: '合成诊断。',
  propositions: [{id: 'P1', question: 'q1', whyItMatters: 'w1'}, {id: 'P2', question: 'q2', whyItMatters: 'w2'}, {id: 'P3', question: 'q3', whyItMatters: 'w3'}],
  assumptions: '', evidenceGaps: '', followUp: '',
};
const blocks = [{id: 'B1', label: '定位', text: '合成候选正文。'}];
const configuration = () => ({id: 'cfg', revision: 1, name: 'synthetic', provider: 'openai-compatible', api: 'openai-completions', baseUrl: 'http://127.0.0.1:1/v1', model: 'synthetic', apiKey: 'synthetic-only'} as any);

function context(requestId: string) {
  const controller = new AbortController();
  return {
    controller,
    value: {
      requestId, sessionId: 'synthetic', toolCallId: 'synthetic', signal: controller.signal,
      assertCurrent() { if (controller.signal.aborted) throw new Error('generation_cancelled'); },
      originalUserText: '合成', userQuoteEligible: false,
    } as any,
  };
}

test('开题保存排队期间取消：提交前重核资格，零写入；提交后取消保留回执', async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'optracall-kickoff-cancel-'));
  t.after(() => rm(root, {recursive: true, force: true}));
  const initiatives = new StrategyInitiativeStore(root);
  const reports = new StrategyInitiativeReports(initiatives);
  const files = new StrategyInitiativeFiles(initiatives);
  const id = randomUUID();
  initiatives.create({operationId: id, title: '取消排队', scopes: [scope]});
  const now = new Date().toISOString();
  await writeFile(path.join(initiatives.directory(id), 'sessions.json'), JSON.stringify({formatVersion: 1, sessions: [{initiativeId: id, scopeKey, scope, configurationId: 'cfg', configurationRevision: 1, revision: 1, createOperationId: randomUUID(), createdAt: now, updatedAt: now}]}) + '\n');
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  let queued = false;
  const mutate = async <T,>(fn: () => T | Promise<T>): Promise<T> => { queued = true; await gate; return fn(); };
  let tool: any;
  createStrategyInitiativeHost({
    initiatives, reports, files,
    candidates: {version: () => { throw new Error('unused'); }, list: () => [], proposal: () => undefined, markProposed: async () => ({}) as any, markTerminal: async () => {}},
    codeRoot: process.cwd(), configuration, mutate, isClosing: () => false, captureTool: value => { tool = value; },
  });
  const owner = {initiativeId: id, scopeKey} as any;
  const reportFile = path.join(initiatives.directory(id), 'reports.json');

  const first = context(randomUUID());
  const operationId = randomUUID();
  const pending = tool(owner, configuration(), 'initiative-save-kickoff', {action: 'initiative-save-kickoff', operationId, kickoffFields: fields}, first.value);
  assert.equal(queued, true);
  first.controller.abort();
  release();
  await assert.rejects(pending);
  await assert.rejects(readFile(reportFile), {code: 'ENOENT'}, 'cancel before mutation commit writes no report');

  const second = context(randomUUID());
  const committed = await tool(owner, configuration(), 'initiative-save-kickoff', {action: 'initiative-save-kickoff', operationId: randomUUID(), kickoffFields: fields}, second.value);
  second.controller.abort();
  const view = reports.view(id);
  assert.equal(view.versions.length, 1);
  assert.equal(view.versions[0].generation.requestId, second.value.requestId);
  assert.equal(committed.details.version.no, 1);
});

test('候选保存排队期间取消：提交前重核资格，零写入；提交后取消保留回执', async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'optracall-candidate-cancel-'));
  t.after(() => rm(root, {recursive: true, force: true}));
  const initiatives = new StrategyInitiativeStore(root);
  const reports = new StrategyInitiativeReports(initiatives);
  const files = new StrategyInitiativeFiles(initiatives);
  const id = randomUUID();
  initiatives.create({operationId: id, title: '取消排队', scopes: [scope]});
  const candidateId = randomUUID();
  const now = new Date().toISOString();
  const record = {
    initiativeId: id, candidateId, no: 1, scopeKey, title: '候选', anchor: {reportNo: 1, contentSha256: 'a'.repeat(64)},
    blocks: [], goals: [], contentSha256: 'b'.repeat(64), configurationId: 'cfg', configurationRevision: 1,
    revision: 1, createOperationId: randomUUID(), instruction: '合成', createdAt: now, updatedAt: now,
  };
  const candidateFile = path.join(initiatives.directory(id), 'candidates.json');
  const original = JSON.stringify({formatVersion: 1, candidates: [record], proposals: []}) + '\n';
  await writeFile(candidateFile, original);
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  let queued = false;
  const mutate = async <T,>(fn: () => T | Promise<T>): Promise<T> => { queued = true; await gate; return fn(); };
  let tool: any;
  createStrategyCandidateHost({initiatives, reports, files, codeRoot: process.cwd(), configuration, mutate, isClosing: () => false, captureTool: value => { tool = value; }});

  const first = context(randomUUID());
  const pending = tool(record, 'initiative-save-candidate', {action: 'initiative-save-candidate', operationId: randomUUID(), candidateBlocks: blocks}, first.value);
  assert.equal(queued, true);
  first.controller.abort();
  release();
  await assert.rejects(pending);
  assert.equal(await readFile(candidateFile, 'utf8'), original, 'cancel before mutation commit writes no candidate');

  const second = context(randomUUID());
  const committed = await tool(record, 'initiative-save-candidate', {action: 'initiative-save-candidate', operationId: randomUUID(), candidateBlocks: blocks}, second.value);
  second.controller.abort();
  const saved = JSON.parse(await readFile(candidateFile, 'utf8')).candidates[0];
  assert.equal(saved.saveReceipts.length, 1);
  assert.equal(saved.lastSave.requestId, second.value.requestId);
  assert.equal(committed.details.receipt.requestId, second.value.requestId);
});

test('I131-B 宿主校验边界：candidateGoals 各类异常、未知敏感键不回显、旧 lastSave 兼容与锁后只读零写入', async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'optracall-candidate-b-edges-'));
  t.after(() => rm(root, {recursive: true, force: true}));
  const initiatives = new StrategyInitiativeStore(root);
  const reports = new StrategyInitiativeReports(initiatives);
  const files = new StrategyInitiativeFiles(initiatives);
  const id = randomUUID();
  initiatives.create({operationId: id, title: '候选边界校验', scopes: [scope]});
  const candidateId = randomUUID();
  const legacyOp = randomUUID();
  const now = new Date().toISOString();
  const legacyBlocks = [{id: 'B1', label: '原定位', text: '旧记录原正文。'}];
  const canonical = (x: unknown): unknown => Array.isArray(x) ? x.map(canonical) : x && typeof x === 'object' ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, canonical(v)])) : x;
  const legacySha = createHash('sha256').update(JSON.stringify(canonical({blocks: legacyBlocks, goals: []}))).digest('hex');
  const legacyRecord = {
    initiativeId: id, candidateId, no: 1, scopeKey, title: '旧格式候选', anchor: {reportNo: 1, contentSha256: 'a'.repeat(64)},
    blocks: legacyBlocks, goals: [], contentSha256: legacySha, configurationId: 'cfg', configurationRevision: 1,
    revision: 1, createOperationId: randomUUID(), instruction: '合成', createdAt: now, updatedAt: now,
    // Legacy schema: only lastSave, no saveReceipts array
    lastSave: {operationId: legacyOp, requestId: randomUUID(), contentSha256: legacySha, at: now},
  };
  const candidateFile = path.join(initiatives.directory(id), 'candidates.json');
  const original = JSON.stringify({formatVersion: 1, candidates: [legacyRecord], proposals: []}) + '\n';
  await writeFile(candidateFile, original);

  let tool: any;
  createStrategyCandidateHost({initiatives, reports, files, codeRoot: process.cwd(), configuration, mutate: fn => Promise.resolve(fn()), isClosing: () => false, captureTool: value => { tool = value; }});

  const expectIssue = async (input: Record<string, unknown>, code: string, expectedPath: string, expectedReason: string) => {
    const ctx = context(randomUUID());
    await assert.rejects(
      () => tool(legacyRecord, 'initiative-save-candidate', {action: 'initiative-save-candidate', ...input}, ctx.value),
      (err: any) => {
        assert.equal(err.code, code);
        assert.ok(Array.isArray(err.details?.issues), `expected details.issues on ${code}`);
        const match = err.details.issues.find((i: any) => i.path === expectedPath && i.reason === expectedReason);
        assert.ok(match, `expected issue ${expectedPath}:${expectedReason}, got ${JSON.stringify(err.details.issues)}`);
        return true;
      },
    );
  };

  // candidateGoals Host-level validation
  await expectIssue({operationId: randomUUID(), candidateBlocks: blocks, candidateGoals: 'not-an-array'}, 'strategy_candidate_schema_invalid', 'candidateGoals', 'invalid_type');
  await expectIssue({operationId: randomUUID(), candidateBlocks: blocks, candidateGoals: Array.from({length: 11}, (_, i) => `目标${i}`)}, 'strategy_candidate_schema_invalid', 'candidateGoals', 'too_many');
  await expectIssue({operationId: randomUUID(), candidateBlocks: blocks, candidateGoals: ['合法目标', '   ']}, 'strategy_candidate_schema_invalid', 'candidateGoals[1]', 'required');
  await expectIssue({operationId: randomUUID(), candidateBlocks: blocks, candidateGoals: ['a'.repeat(501)]}, 'strategy_candidate_schema_invalid', 'candidateGoals[0]', 'too_long');
  await expectIssue({operationId: randomUUID(), candidateBlocks: blocks, candidateGoals: [{title: 'obj'}]}, 'strategy_candidate_schema_invalid', 'candidateGoals[0]', 'invalid_type');

  // Unknown key containing non-ASCII / secret characters must NOT be echoed in issues[].path
  const secretKey = 'sk-secret=123 中文恶意键';
  const ctxSecret = context(randomUUID());
  await assert.rejects(
    () => tool(legacyRecord, 'initiative-save-candidate', {action: 'initiative-save-candidate', operationId: randomUUID(), candidateBlocks: blocks, [secretKey]: 1}, ctxSecret.value),
    (err: any) => {
      assert.equal(err.code, 'strategy_candidate_fields_invalid');
      assert.equal(JSON.stringify(err.details).includes('sk-secret'), false);
      assert.equal(err.details.issues[0].path, 'input');
      assert.equal(err.details.issues[0].reason, 'unknown_field');
      return true;
    },
  );
  assert.equal(await readFile(candidateFile, 'utf8'), original, 'all invalid calls produce zero writes');

  // Legacy lastSave-only compatibility: readback, operation lookup, idempotent replay, conflict
  const readRes = await tool(legacyRecord, 'initiative-read-candidate', {action: 'initiative-read-candidate'}, context(randomUUID()).value);
  assert.equal(readRes.details.saveReceipts.length, 1);
  assert.equal(readRes.details.saveReceipts[0].operationId, legacyOp);
  const opRes = await tool(legacyRecord, 'operation', {action: 'operation', operationId: legacyOp}, context(randomUUID()).value);
  assert.equal(opRes.details.receipt.operationId, legacyOp);
  const replayRes = await tool(legacyRecord, 'initiative-save-candidate', {action: 'initiative-save-candidate', operationId: legacyOp, candidateBlocks: legacyBlocks}, context(randomUUID()).value);
  assert.equal(replayRes.details.receipt.operationId, legacyOp);
  assert.equal(await readFile(candidateFile, 'utf8'), original, 'legacy replay does not rewrite disk');
  await assert.rejects(
    () => tool(legacyRecord, 'initiative-save-candidate', {action: 'initiative-save-candidate', operationId: legacyOp, candidateBlocks: blocks}, context(randomUUID()).value),
    (err: any) => err.code === 'strategy_candidate_operation_conflict',
  );
  assert.equal(await readFile(candidateFile, 'utf8'), original, 'legacy conflict does not rewrite disk');

  // Locked candidate rejects save with zero write
  const lockedRecord = {...legacyRecord, lock: {operationId: randomUUID(), sha256: legacySha, at: now}};
  const lockedDisk = JSON.stringify({formatVersion: 1, candidates: [lockedRecord], proposals: []}) + '\n';
  await writeFile(candidateFile, lockedDisk);
  await assert.rejects(
    () => tool(lockedRecord, 'initiative-save-candidate', {action: 'initiative-save-candidate', operationId: randomUUID(), candidateBlocks: blocks}, context(randomUUID()).value),
    (err: any) => err.code === 'strategy_candidate_locked',
  );
  assert.equal(await readFile(candidateFile, 'utf8'), lockedDisk, 'locked candidate save produces zero write');
});

test('I131-C 拟改提交排队期间取消：提交前重核取消态，零写入且原提案保持 pending', async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'optracall-proposal-cancel-'));
  t.after(() => rm(root, {recursive: true, force: true}));
  const initiatives = new StrategyInitiativeStore(root);
  const reports = new StrategyInitiativeReports(initiatives);
  const files = new StrategyInitiativeFiles(initiatives);
  const id = randomUUID();
  initiatives.create({operationId: id, title: '拟改取消排队', scopes: [scope]});
  const now = new Date().toISOString();
  const proposalId = randomUUID();
  const reqId = randomUUID();
  await writeFile(path.join(initiatives.directory(id), 'sessions.json'), JSON.stringify({
    formatVersion: 1,
    sessions: [{
      initiativeId: id, scopeKey, scope, configurationId: 'cfg', configurationRevision: 1, revision: 1,
      createOperationId: randomUUID(), createdAt: now, updatedAt: now,
      lastRun: {id: reqId, fingerprint: 'f'.repeat(64), status: 'accepted'},
      pendingInput: {requestId: reqId, text: '拟改请求', proposalId, expectedRevision: 1},
    }],
  }) + '\n');
  const candidateId = randomUUID();
  const candidateFile = path.join(initiatives.directory(id), 'candidates.json');
  const candidateRecord = {
    initiativeId: id, candidateId, no: 1, scopeKey, title: '拟改候选', anchor: {reportNo: 1, contentSha256: 'a'.repeat(64)},
    blocks, goals: [], contentSha256: 'b'.repeat(64), configurationId: 'cfg', configurationRevision: 1,
    revision: 1, createOperationId: randomUUID(), instruction: '合成', createdAt: now, updatedAt: now,
  };
  const pendingProposal = {
    proposalId, initiativeId: id, target: {kind: 'candidate' as const, candidateId, no: 1},
    blockId: 'B1', request: '改定位', baselineSha256: createHash('sha256').update(blocks[0]!.text).digest('hex'), status: 'pending' as const, at: now, updatedAt: now,
  };
  const originalCandidates = JSON.stringify({formatVersion: 1, candidates: [candidateRecord], proposals: [pendingProposal]}) + '\n';
  await writeFile(candidateFile, originalCandidates);

  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  let queued = false;
  const mutate = async <T,>(fn: () => T | Promise<T>): Promise<T> => { queued = true; await gate; return fn(); };
  const candidateHost = createStrategyCandidateHost({initiatives, reports, files, codeRoot: process.cwd(), configuration, mutate, isClosing: () => false});
  let tool: any;
  createStrategyInitiativeHost({
    initiatives, reports, files,
    candidates: {
      version: (i, c, n) => candidateHost.version(i, c, n),
      list: (i, sk) => candidateHost.list(i, sk),
      proposal: (i, pid) => candidateHost.proposal(i, pid),
      markProposed: (i, pid, txt, rid, guard) => candidateHost.markProposed(i, pid, txt, rid, guard),
      markTerminal: (i, pid, st, fb) => candidateHost.markTerminal(i, pid, st, fb),
    },
    codeRoot: process.cwd(), configuration, mutate, isClosing: () => false, captureTool: value => { tool = value; },
  });

  const ctx = context(reqId);
  const pending = tool({initiativeId: id, scopeKey}, configuration(), 'initiative-propose-revision', {action: 'initiative-propose-revision', proposalId, newText: '新拟改正文。'}, ctx.value);
  assert.equal(queued, true);
  ctx.controller.abort();
  release();
  await assert.rejects(pending);
  assert.equal(await readFile(candidateFile, 'utf8'), originalCandidates, 'cancelled proposal inside mutation queue must write nothing');
});

