import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { closeSync, constants, fstatSync, fsyncSync, openSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { Type } from 'typebox';
import { createAgentSession, createExtensionRuntime, ModelRuntime, SessionManager, SettingsManager, VERSION, type AgentSession, type CustomEntry, type ResourceLoader, type ToolDefinition } from '../src/agent/sdk.ts';
import { readNativeSessionSnapshot } from '../src/host/native-session-snapshot.ts';
import { startToolProvider, type SyntheticToolCall } from './fixtures/tool-provider.ts';

// A public-SDK compatibility probe, deliberately independent of the production
// candidate tool. Product admission/lifecycle and legacy reading have other tests.
const CUSTOM = 'optracall.candidate-sdk-proof', SAVE = 'proof_save_candidate', BRIDGE = 'proof_candidate_bridge';
const parameters = Type.Object({ body: Type.String(), depth: Type.Optional(Type.Integer({ minimum: 0, maximum: 3 })), copies: Type.Optional(Type.Integer({ minimum: 1, maximum: 260 })) }, { additionalProperties: false });
type Saved = { version: 1; body: string; sessionId: string; toolCallId: string };
const candidates = (entries: { type: string }[]) => entries.filter((entry): entry is CustomEntry<Saved> => entry.type === 'custom' && (entry as CustomEntry).customType === CUSTOM);

async function fixture(t: TestContext) {
  assert.equal(VERSION, '1.4.0');
  const root = path.resolve('.local/memory-candidate-nested/sdk-proof', randomUUID()), cwd = path.join(root, 'project'), native = path.join(root, 'native');
  await mkdir(cwd, { recursive: true }); await mkdir(native, { recursive: true });
  const provider = await startToolProvider(), sessions: AgentSession[] = [];
  t.after(async () => { for (const session of sessions) session.dispose(); await provider.close(); });
  const modelRuntime = await ModelRuntime.create({ modelsPath: null, refreshOnCreate: false, allowModelNetwork: false,
    credentials: { read: async () => undefined, list: async () => [], modify: async () => { throw new Error('Persistent credentials disabled.'); }, delete: async () => {} } });
  modelRuntime.registerProvider('candidate-sdk-proof', { api: 'openai-completions', baseUrl: provider.baseUrl,
    models: [{ id: 'synthetic-candidate-proof', name: 'Synthetic candidate proof', reasoning: false, input: ['text'],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 32_000, maxTokens: 1024 }] });
  await modelRuntime.setRuntimeApiKey('candidate-sdk-proof', 'synthetic-candidate-sdk-proof');
  const model = modelRuntime.getModel('candidate-sdk-proof', 'synthetic-candidate-proof'); assert.ok(model);
  const resources = (): ResourceLoader => ({
    getExtensions: () => ({ extensions: [], errors: [], runtime: createExtensionRuntime() }),
    getSkills: () => ({ skills: [], diagnostics: [] }), getPrompts: () => ({ prompts: [], diagnostics: [] }), getThemes: () => ({ themes: [], diagnostics: [] }),
    getAgentsFiles: () => ({ agentsFiles: [] }), getSystemPrompt: () => 'Execute only the synthetic tool plan.', getSystemPromptSource: () => undefined,
    getAppendSystemPrompt: () => [], getAppendSystemPromptSources: () => [], extendResources() {}, reload: async () => {},
  });
  const create = async (manager = SessionManager.create(cwd, native)) => {
    const tools: ToolDefinition[] = [{ name: SAVE, label: 'Synthetic candidate', description: 'Save the synthetic candidate through the public SDK.', parameters,
      executionMode: 'parallel', execute: async (toolCallId, input: { body: string }, signal) => {
        signal?.throwIfAborted();
        const entryId = manager.appendCustomEntry(CUSTOM, { version: 1, body: input.body, sessionId: manager.getSessionId(), toolCallId } satisfies Saved);
        // Append's return value alone is not a persistence claim. Synchronize this
        // fixture's actual regular native file; each test independently reads it.
        const file = manager.getSessionFile(); assert.ok(file);
        const fd = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW);
        try { const info = fstatSync(fd); assert.ok(info.isFile() && info.nlink === 1); fsyncSync(fd); } finally { closeSync(fd); }
        const receipt = { status: 'appended', entryId };
        return { content: [{ type: 'text', text: JSON.stringify(receipt) }], details: receipt };
      } }, { name: BRIDGE, label: 'Synthetic nested bridge', description: 'Call the synthetic candidate tool through actual SDK nesting.', parameters,
      executionMode: 'parallel', execute: async (_id, input: { body: string; depth?: number; copies?: number }, _signal, _update, ctx) => {
        const depth = input.depth ?? 0;
        if (input.copies) {
          const outcomes = await Promise.all(Array.from({ length: input.copies }, () => ctx.executeTool(depth ? BRIDGE : SAVE, depth ? { body: input.body, depth: depth - 1 } : { body: input.body })));
          return { content: [{ type: 'text', text: JSON.stringify(outcomes.map(outcome => outcome.result.details)) }], details: {}, ...(outcomes.some(outcome => outcome.isError) ? { isError: true } : {}) };
        }
        const outcome = await ctx.executeTool(depth ? BRIDGE : SAVE, depth ? { body: input.body, depth: depth - 1 } : { body: input.body });
        return { ...outcome.result, ...(outcome.isError ? { isError: true } : {}) };
      } }];
    const { session, modelFallbackMessage } = await createAgentSession({ cwd, agentDir: path.join(root, 'pi'), modelRuntime, model,
      thinkingLevel: 'off', tools: [SAVE, BRIDGE], customTools: tools, resourceLoader: resources(), sessionManager: manager,
      settingsManager: SettingsManager.inMemory({ compaction: { enabled: false, keepRecentTokens: 1, reserveTokens: 32 }, retry: { enabled: false, maxRetries: 0, provider: { maxRetries: 0 } }, cacheWarming: 'off' }) });
    assert.equal(modelFallbackMessage, undefined); sessions.push(session); return session;
  };
  const snapshot = async (manager: SessionManager) => {
    const file = manager.getSessionFile(); assert.ok(file);
    return readNativeSessionSnapshot(file, native, cwd);
  };
  const turn = async (session: AgentSession, calls: SyntheticToolCall[]) => {
    provider.setResponder(({ recentToolResults }) => recentToolResults.length ? { text: 'Synthetic tool plan complete.' } : { calls });
    await session.prompt('Execute this synthetic plan.'); assert.deepEqual(provider.errors, []);
  };
  const receipt = async (name: string, data: unknown) => { await writeFile(path.join(root, name + '.json'), JSON.stringify(data, null, 2) + '\n'); t.diagnostic('sdk-proof evidence: ' + root); };
  return { root, cwd, native, provider, create, snapshot, turn, receipt };
}

test('R1 SDK proof: direct and nested custom candidates survive safe read and actual SDK close/reopen', { timeout: 30_000 }, async t => {
  for (const nested of [false, true]) await t.test(nested ? 'nested' : 'direct', async t => {
    const f = await fixture(t), session = await f.create(), body = nested ? 'NESTED_SDK_CANDIDATE' : 'DIRECT_SDK_CANDIDATE';
    await f.turn(session, [{ name: nested ? BRIDGE : SAVE, arguments: { body } }]);
    const before = await f.snapshot(session.sessionManager), records = candidates(before.entries);
    assert.equal(records.length, 1); assert.equal(records[0]!.data!.body, body);
    const results = before.entries.filter(entry => entry.type === 'message' && entry.message.role === 'toolResult');
    assert.equal(results.length, 1, 'nested save has no independent transcript result');
    assert.ok(results.every(entry => entry.type === 'message' && entry.message.role === 'toolResult' && !JSON.stringify({ content: entry.message.content, details: entry.message.details }).includes(body)), 'tool receipt is minimal; SDK arguments/nested metadata may naturally include the body');
    const file = session.sessionManager.getSessionFile()!; session.dispose();
    const reopened = await f.create(SessionManager.open(file, f.native, f.cwd));
    const after = await f.snapshot(reopened.sessionManager);
    assert.deepEqual(candidates(after.entries), records); assert.equal(after.sha256, before.sha256);
    assert.equal(f.provider.requests.length, 2, 'only the original native turn and continuation use the local provider');
    await f.receipt('direct-nested-reopen', { sdk: VERSION, nested, native: file, sha256: after.sha256, records, requests: f.provider.requests.length });
  });
});

test('R1 SDK proof: multilevel and parallel candidates retain distinct native occurrences when nested arguments are omitted', { timeout: 30_000 }, async t => {
  const f = await fixture(t), session = await f.create(), body = 'NESTED_LARGE_CANDIDATE_' + 'x'.repeat(9000);
  await f.turn(session, [
    { name: SAVE, arguments: { body: 'DIRECT_MULTIPLE_FIRST' } },
    { name: SAVE, arguments: { body: 'DIRECT_MULTIPLE_SECOND' } },
    { name: BRIDGE, arguments: { body, depth: 2, copies: 2 } },
  ]);
  const saved = await f.snapshot(session.sessionManager), records = candidates(saved.entries);
  assert.equal(records.length, 4); assert.equal(new Set(records.map(record => record.id)).size, 4);
  assert.deepEqual(records.map(record => record.data!.body).sort(), ['DIRECT_MULTIPLE_FIRST', 'DIRECT_MULTIPLE_SECOND', body, body].sort());
  const parent = saved.entries.find(entry => entry.type === 'message' && entry.message.role === 'toolResult' && entry.message.toolName === BRIDGE);
  assert.ok(parent?.type === 'message' && parent.message.role === 'toolResult');
  assert.equal(parent.message.isError, false); assert.equal(parent.message.nestedCalls?.complete, false);
  assert.ok(parent.message.nestedCalls?.calls.some(call => call.name === SAVE && call.arguments === undefined));
  assert.ok(records.filter(record => record.data!.body === body).every(record => record.data!.sessionId === saved.manager.getSessionId()));
  const reopened = await f.create(SessionManager.open(session.sessionManager.getSessionFile()!, f.native, f.cwd));
  assert.deepEqual(candidates((await f.snapshot(reopened.sessionManager)).entries), records);
  await f.receipt('parallel-multilevel-large', { sdk: VERSION, native: session.sessionManager.getSessionFile(), sha256: saved.sha256, records, nestedCalls: parent.message.nestedCalls, requests: f.provider.requests.length });
});

test('R1 SDK proof: candidates beyond the SDK nestedCalls count budget remain independently saved', { timeout: 30_000 }, async t => {
  const f = await fixture(t), session = await f.create();
  await f.turn(session, [{ name: BRIDGE, arguments: { body: 'SAME_BODY_DISTINCT_INVOCATIONS', copies: 260 } }]);
  const saved = await f.snapshot(session.sessionManager), records = candidates(saved.entries);
  assert.equal(records.length, 260); assert.equal(new Set(records.map(record => record.id)).size, 260);
  assert.equal(new Set(records.map(record => record.data!.toolCallId)).size, 260, 'same body does not merge independent calls');
  const parent = saved.entries.find(entry => entry.type === 'message' && entry.message.role === 'toolResult' && entry.message.toolName === BRIDGE);
  assert.ok(parent?.type === 'message' && parent.message.role === 'toolResult');
  assert.equal(parent.message.isError, false); assert.equal(parent.message.nestedCalls?.complete, false);
  const metadata = new Set(parent.message.nestedCalls?.calls.map(call => call.id));
  assert.ok(records.some(record => !metadata.has(record.data!.toolCallId)), 'accepted candidates need no surviving nested metadata record');
  await f.receipt('nested-count-budget', { sdk: VERSION, native: session.sessionManager.getSessionFile(), sha256: saved.sha256,
    candidateCount: records.length, metadataCount: metadata.size, complete: parent.message.nestedCalls?.complete, requests: f.provider.requests.length });
});

test('R1 SDK proof: actual SDK compaction, reopen and fork preserve custom candidates without merging a new identical call', { timeout: 30_000 }, async t => {
  const f = await fixture(t), session = await f.create(), body = 'CANDIDATE_SURVIVES_COMPACTION_AND_FORK';
  await f.turn(session, [{ name: SAVE, arguments: { body } }]);
  const before = await f.snapshot(session.sessionManager), records = candidates(before.entries), originalFile = session.sessionManager.getSessionFile()!;
  f.provider.setResponder(() => ({ text: 'Synthetic summary retains the original task and its limits.' }));
  await session.prompt('Later synthetic conversation to retain.');
  await session.compact('Summarize only this synthetic conversation.');
  const compacted = await f.snapshot(session.sessionManager);
  assert.ok(compacted.entries.some(entry => entry.type === 'compaction'));
  assert.deepEqual(candidates(compacted.entries), records, 'raw native candidates survive even when context is compacted');
  session.dispose();
  const reopened = await f.create(SessionManager.open(originalFile, f.native, f.cwd));
  assert.deepEqual(candidates((await f.snapshot(reopened.sessionManager)).entries), records);
  const forked = await f.create(SessionManager.forkFrom(originalFile, f.cwd, f.native));
  assert.notEqual(forked.sessionManager.getSessionId(), records[0]!.data!.sessionId);
  assert.deepEqual(candidates((await f.snapshot(forked.sessionManager)).entries), records, 'SDK copies retain exact ids and originating session');
  await f.turn(forked, [{ name: SAVE, arguments: { body } }]);
  const forkSnapshot = await f.snapshot(forked.sessionManager), forkRecords = candidates(forkSnapshot.entries);
  assert.equal(forkRecords.length, 2); assert.deepEqual(forkRecords[0], records[0]);
  assert.equal(forkRecords[1]!.data!.body, body); assert.notEqual(forkRecords[1]!.id, records[0]!.id);
  assert.equal(forkRecords[1]!.data!.sessionId, forked.sessionManager.getSessionId());
  assert.equal((await f.snapshot(reopened.sessionManager)).sha256, compacted.sha256, 'fork and its new write never mutate the source native');
  await f.receipt('compact-reopen-fork', { sdk: VERSION, source: originalFile, sourceSha256: compacted.sha256,
    fork: forked.sessionManager.getSessionFile(), forkSha256: forkSnapshot.sha256, records: forkRecords, requests: f.provider.requests.length });
});
