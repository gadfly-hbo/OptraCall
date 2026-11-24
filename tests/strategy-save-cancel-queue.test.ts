import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
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
