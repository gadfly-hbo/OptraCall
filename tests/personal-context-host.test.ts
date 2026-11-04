import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { startTestHost } from './fixtures/host-process.ts';
import { readJson } from './fixtures/joint-context.ts';
import { sessionEvents } from './fixtures/session-events.ts';
import { startToolProvider, providerMessageText } from './fixtures/tool-provider.ts';
import type { PersonalContextDelivery } from '../src/agent/personal-context.ts';
import type { PersonalContextTarget } from '../src/host/personal-context-types.ts';

const digest = (text: string) => createHash('sha256').update(text).digest('hex');
async function fixture(t: { after(fn: () => Promise<void>): void }, providerUrl = 'http://127.0.0.1:1') {
  const host = await startTestHost(); t.after(() => host.close());
  await readJson(await host.request('/api/configuration', 'PUT', { name: 'M4合成', provider: 'openai-compatible', baseUrl: providerUrl, model: 'synthetic', apiKey: 'synthetic-only' }));
  const { project } = await readJson(await host.request('/api/projects', 'POST', { name: 'M4历史合成' }), 201);
  const { task } = await readJson(await host.request(`/api/projects/${project.id}/tasks`, 'POST', { name: '本次工作' }), 201);
  return { host, project, task, route: `/api/projects/${project.id}/tasks/${task.id}` };
}

test('RU09/10 public history returns exact persisted tool text without starting a model or substituting a now-missing source', { timeout: 30_000 }, async t => {
  const { host, project, task, route } = await fixture(t);
  const thenText = 'M4_THEN：当时原文和旧纠正，不能用今日缓存替代。';
  const target: PersonalContextTarget = { type: 'retained', storeId: randomUUID(), materialId: randomUUID(), decisionId: randomUUID(), revisionId: randomUUID(), expectedBodySha256: digest(thenText) };
  const details: PersonalContextDelivery = { schemaVersion: 1, type: 'optracall.personal-context-delivery', action: 'read', items: [{ target, part: 'content', extent: 'full', range: { start: 0, end: thenText.length }, title: '当时参考', scope: '合成', effectiveTime: null, caution: '未验证效果', governance: { archived: false, enterpriseEnabled: false, sourceProjectArchived: null, targetRevision: null, latestCorrectionOperationId: null }, limitations: [] }], partial: false, continuation: null, issues: [] };
  const timestamp = '2026-11-03T09:00:00.000Z', sessionId = randomUUID(), file = path.join(task.sessionDirectory, 'm4-history.jsonl');
  const lines = [
    { type: 'session', version: 3, id: sessionId, timestamp, cwd: path.join(project.rootPath, '020_clean') },
    { type: 'message', id: 'assistant-call', parentId: null, timestamp, message: { role: 'assistant', content: [{ type: 'toolCall', id: 'read-one', name: 'read_personal_context', arguments: { target } }], timestamp: Date.parse(timestamp) } },
    { type: 'message', id: 'actual-result', parentId: 'assistant-call', timestamp, message: { role: 'toolResult', toolCallId: 'read-one', toolName: 'read_personal_context', content: [{ type: 'text', text: thenText }], details, isError: false, timestamp: Date.parse(timestamp) } },
  ];
  const bytes = Buffer.from(lines.map(v => JSON.stringify(v)).join('\n') + '\n');
  await fs.writeFile(file, bytes); const before = await fs.stat(file);
  const history = await readJson(await host.request(route + '/personal-context'));
  assert.equal(history.entries.length, 1);
  assert.equal(history.entries[0].text, thenText);
  assert.equal(history.entries[0].sessionId, sessionId);
  assert.equal(history.entries[0].entryId, 'actual-result');
  assert.equal(history.entries[0].evidence, 'recorded');
  assert.equal(history.entries[0].current[0].state, 'unknown');
  assert.deepEqual(await fs.readFile(file), bytes);
  assert.equal((await fs.stat(file)).mtimeMs, before.mtimeMs);
  assert.equal((await readJson(await host.request(route))).task.sessionFile, undefined, 'history must not initialize or choose a runtime');
});

async function retained(host: Awaited<ReturnType<typeof startTestHost>>, text = 'M4_FIXED_OLD_BODY：不随以后新稿改变。') {
  const created = await readJson(await host.request('/api/enterprise-materials', 'POST', { title: 'M4旧口径知识', body: text, scope: '原范围' }), 201);
  const item = `/api/personal-retention/items/${created.material.id}`;
  const editor = await readJson(await host.request(item + '/editor'));
  const saved = await readJson(await host.request(item + '/retain', 'POST', { operationId: randomUUID(), expectedRevision: 0, target: editor.draftTarget, metadata: { kind: 'knowledge', aliases: ['合成口径'], caution: '旧范围，仅供参考。', sourceRefs: [] }, personalLabel: null }), 201);
  const target: PersonalContextTarget = { type: 'retained', storeId: saved.decision.contentRef.storeId, materialId: created.material.id, decisionId: saved.decision.operationId, revisionId: saved.decision.contentRef.revisionId, expectedBodySha256: saved.decision.bodySha256 };
  return { created, saved, target, text };
}
async function turn(f: Awaited<ReturnType<typeof fixture>>, input: Record<string, unknown>) {
  const stream = await sessionEvents(f.host, f.project.id, f.task.id);
  try {
    await readJson(await f.host.request(f.route + '/messages', 'POST', input), 202);
    const terminal = await stream.terminal;
    assert.equal(terminal.type, 'run.settled');
    if (terminal.type === 'run.settled') assert.equal(terminal.outcome, 'completed', JSON.stringify(terminal));
  } finally { await stream.close(); }
}

test('RU01/03 real Host→Pi→Provider: normal question needs no selections; find gives metadata and read gives exact old body', { timeout: 60_000 }, async t => {
  const provider = await startToolProvider(); t.after(() => provider.close());
  const f = await fixture(t, provider.baseUrl), r = await retained(f.host);
  provider.setResponder(({ requestNumber }) => requestNumber === 1 ? { calls: [{ name: 'find_personal_context', arguments: { query: '旧口径' } }] } : requestNumber === 2 ? { calls: [{ name: 'read_personal_context', arguments: { target: r.target } }] } : { text: '合成回答：参考旧口径，也保留适用范围未知。' });
  await turn(f, { requestId: randomUUID(), text: '按需要找旧资料，允许拒用；没有人工选材。' });
  assert.equal(provider.requests.length, 3);
  const catalog = provider.requests[1]!.body.messages!.filter(m => m.role === 'tool').map(m => providerMessageText(m.content)).join('');
  assert.ok(catalog.includes('M4旧口径知识'));
  assert.ok(!catalog.includes(r.text), 'find must not provide source body');
  const content = provider.requests[2]!.body.messages!.filter(m => m.role === 'tool').map(m => providerMessageText(m.content)).join('');
  assert.ok(content.includes(r.text)); assert.ok(content.includes('旧范围，仅供参考。'));
  const history = await readJson(await f.host.request(f.route + '/personal-context'));
  assert.deepEqual(history.entries.map((entry: any) => entry.action), ['find', 'read']);
  assert.ok(history.entries[1].text.includes(r.text));
  const before = provider.requests.length;
  await readJson(await f.host.request(f.route + '/personal-context'));
  assert.equal(provider.requests.length, before, 'history view must not start any provider request');
});

test('RU04/05/10 human exact selection reaches native once, survives a newer draft and accepted same-ID retry never rereads damaged source', { timeout: 60_000 }, async t => {
  const provider = await startToolProvider(); t.after(() => provider.close());
  const f = await fixture(t, provider.baseUrl), r = await retained(f.host);
  const updated = await readJson(await f.host.request(`/api/enterprise-materials/${r.created.material.id}`, 'PUT', { expectedVersion: r.saved.item ? (await readJson(await f.host.request(`/api/enterprise-materials/${r.created.material.id}`))).material.version : 1, body: 'M4_NEW_DRAFT_NOT_SELECTED' }));
  assert.ok(updated.material.version > r.created.material.version);
  const request = { requestId: randomUUID(), text: '问题本身保持，只把我指定的旧稿作为参考。', personalContext: [{ target: r.target }] };
  await turn(f, request);
  const sent = provider.requests[0]!.body.messages!.filter(m => m.role === 'user').map(m => providerMessageText(m.content)).join('');
  assert.ok(sent.includes(r.text)); assert.ok(!sent.includes('M4_NEW_DRAFT_NOT_SELECTED'));
  const receipt = (await readJson(await f.host.request(f.route + '/context-receipts'))).receipts[0].providedContext.personal;
  assert.equal(receipt.schemaVersion, 1); assert.deepEqual(receipt.items[0].target, r.target);
  const history = await readJson(await f.host.request(f.route + '/personal-context'));
  assert.equal(history.entries[0].action, 'provided'); assert.ok(history.entries[0].text.includes(r.text));
  const index = JSON.parse(await fs.readFile(path.join(f.host.dataRoot, 'enterprise-business-materials/index.json'), 'utf8'));
  const revision = index.materials.find((m: any) => m.id === r.target.materialId).revisions.find((r0: any) => r0.revisionId === r.target.revisionId);
  await fs.writeFile(path.join(f.host.dataRoot, 'enterprise-business-materials/bodies', revision.bodyFileId + '.txt'), 'M4_DAMAGE_AFTER_ACCEPTED');
  const before = provider.requests.length;
  const retry = await readJson(await f.host.request(f.route + '/messages', 'POST', request), 202);
  assert.equal(retry.deduplicated, true); assert.equal(provider.requests.length, before);
  const conflict = await f.host.request(f.route + '/messages', 'POST', { ...request, personalContext: [{ target: { ...r.target, decisionId: randomUUID() } }] });
  assert.equal(conflict.status, 409); assert.equal(provider.requests.length, before);
  const still = await readJson(await f.host.request(f.route + '/personal-context'));
  assert.ok(still.entries[0].text.includes(r.text)); assert.equal(still.entries[0].current[0].state, 'unknown');
});

test('RU07 precise unavailable selections are rejected before acceptance, with exact indices and no model call', { timeout: 30_000 }, async t => {
  const provider = await startToolProvider(); t.after(() => provider.close());
  const f = await fixture(t, provider.baseUrl), r = await retained(f.host);
  await readJson(await f.host.request(f.route + '/draft', 'PATCH', { text: '保留的原问题' }));
  const response = await f.host.request(f.route + '/messages', 'POST', { requestId: randomUUID(), text: '保留的原问题', personalContext: [{ target: { ...r.target, expectedBodySha256: 'f'.repeat(64) } }] });
  const rejected = await readJson(response, 409);
  assert.equal(rejected.code, 'PERSONAL_CONTEXT_UNAVAILABLE'); assert.equal(rejected.accepted, false); assert.deepEqual(rejected.unavailablePersonalContext, [0]);
  const state = await readJson(await f.host.request(f.route));
  assert.equal(state.task.draft, '保留的原问题'); assert.equal(state.task.lastRun, undefined); assert.equal(provider.requests.length, 0);
  await readJson(await f.host.request(`/api/projects/${f.project.id}/archive`, 'POST', {}));
  const archived = await readJson(await f.host.request(f.route + '/messages', 'POST', { requestId: randomUUID(), text: '不许绕过归档', personalContext: [{ target: r.target }] }), 409);
  assert.equal(archived.code, 'project_archived'); assert.equal(archived.unavailablePersonalContext, undefined);
});

test('RU02/09 real nested SDK read leaves parent metadata and honest child-body UNKNOWN in public history', { timeout: 60_000 }, async t => {
  const provider = await startToolProvider(); t.after(() => provider.close());
  const f = await fixture(t, provider.baseUrl), r = await retained(f.host);
  provider.setResponder(({ requestNumber }) => requestNumber === 1 ? { calls: [{ name: 'codemode', arguments: { code: `const r = await tools.read_personal_context(${JSON.stringify({ target: r.target })});text(r);` } }] } : { text: '自主组合调用合成回答' });
  await turn(f, { requestId: randomUUID(), text: '可以在当前授权内组合读取。' });
  assert.equal(provider.requests.length, 2);
  assert.ok(JSON.stringify(provider.requests[1]!.body.messages).includes(r.text));
  const history = await readJson(await f.host.request(f.route + '/personal-context'));
  assert.equal(history.entries.length, 1);
  assert.equal(history.entries[0].evidence, 'nested-unknown'); assert.equal(history.entries[0].text, null); assert.equal(history.entries[0].details, null);
});

import { candidateToolName, type AgentCandidateDetails } from '../src/agent/agent-candidate.ts';
async function candidateSource(f: Awaited<ReturnType<typeof fixture>>) {
  const { task } = await readJson(await f.host.request(`/api/projects/${f.project.id}/tasks`, 'POST', { name: '旧候选原任务' }), 201);
  const sessionId = randomUUID(), requestId = randomUUID(), timestamp = '2026-11-03T09:10:00.000Z', toolCallId = 'm4-candidate-call';
  const details: AgentCandidateDetails = { schemaVersion: 1, type: 'optracall.agent-candidate', claim: 'agent-generated-unconfirmed', origin: { projectId: f.project.id, taskId: task.id, sessionId, requestId, toolCallId }, createdAt: timestamp, content: { kind: 'experience', title: 'M4候选经验', bodyMd: 'M4_CANDIDATE_BODY：比较口径仍须自行判断。', aliases: [], scope: '旧门店范围', caution: '不能直接证明因果' }, sourceRefs: [] };
  const lines = [
    { type: 'session', version: 3, id: sessionId, timestamp, cwd: path.join(f.project.rootPath, '020_clean') },
    { type: 'custom', id: 'started', parentId: null, timestamp, customType: 'optracall.run', data: { phase: 'started', requestId, sessionId, kind: 'prompt' } },
    { type: 'message', id: 'call', parentId: 'started', timestamp, message: { role: 'assistant', content: [{ type: 'toolCall', id: toolCallId, name: candidateToolName, arguments: { content: details.content, sourceRefs: [] } }] } },
    { type: 'message', id: 'candidate-result', parentId: 'call', timestamp, message: { role: 'toolResult', toolCallId, toolName: candidateToolName, content: [{ type: 'text', text: '候选待保存' }], details, isError: false, timestamp: Date.parse(timestamp) } },
    { type: 'custom', id: 'settled', parentId: 'candidate-result', timestamp, customType: 'optracall.run', data: { phase: 'settled', requestId, sessionId, outcome: 'cancelled' } },
  ];
  await fs.writeFile(path.join(task.sessionDirectory, 'm4-candidate.jsonl'), lines.map(v => JSON.stringify(v)).join('\n') + '\n');
  const lookup = await readJson(await f.host.request('/api/personal-retention/candidates/lookup?query=M4'));
  assert.equal(lookup.rows.length, 1); return { ref: lookup.rows[0].ref, details };
}

test('RU06 Host→SDK automatically supplies latest candidate correction without bookmark; exclusion refuses new use and preserves then-body', { timeout: 60_000 }, async t => {
  const provider = await startToolProvider(); t.after(() => provider.close());
  const f = await fixture(t, provider.baseUrl), source = await candidateSource(f), target = { type: 'agent-candidate', candidate: source.ref };
  const control = (action: string, note: string | null, expectedTargetRevision?: number) => f.host.request('/api/personal-retention/candidates/controls', 'POST', { operationId: randomUUID(), target: source.ref, action, note, ...(expectedTargetRevision === undefined ? {} : { expectedTargetRevision }) });
  await readJson(await control('correct', 'M4_OLDER_NOTE 不应默认重复注入'), 201);
  await readJson(await control('correct', 'M4_LATEST_NOTE 金额以元为单位'), 201);
  provider.setResponder(({ messages }) => {
    let lastUser = messages.length - 1;
    while (lastUser >= 0 && messages[lastUser]!.role !== 'user') lastUser--;
    return messages.slice(lastUser + 1).some(m => m.role === 'tool') ? { text: '本次可参考或拒用，由Agent判断。' } : { calls: [{ name: 'read_personal_context', arguments: { target } }] };
  });
  await turn(f, { requestId: randomUUID(), text: '按需读取，不先收藏。' });
  const supplied = JSON.stringify(provider.requests[1]!.body.messages);
  assert.ok(supplied.includes(source.details.content.bodyMd)); assert.ok(supplied.includes('M4_LATEST_NOTE')); assert.ok(!supplied.includes('M4_OLDER_NOTE'));
  await readJson(await control('exclude', null, 2), 201);
  const history = await readJson(await f.host.request(f.route + '/personal-context'));
  assert.equal(history.entries[0].current[0].state, 'excluded'); assert.ok(history.entries[0].text.includes('M4_LATEST_NOTE'));
  await turn(f, { requestId: randomUUID(), text: '新一轮读取被排除项，由Agent自行处理具体失败。' });
  const lastResult = provider.requests.at(-1)!.body.messages!.filter(m => m.role === 'tool').at(-1)!;
  assert.ok(providerMessageText(lastResult.content).includes('personal_context_excluded'));
  const after = await readJson(await f.host.request(f.route + '/personal-context'));
  assert.equal(after.entries.length, 1); assert.equal(after.entries[0].text, history.entries[0].text);
});
