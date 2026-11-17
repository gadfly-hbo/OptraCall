import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { mkdir, writeFile } from 'node:fs/promises';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';
import { startTestHost } from './fixtures/host-process.ts';
import { startToolProvider, providerMessageText } from './fixtures/tool-provider.ts';
import type { GoalDiscussionSourceRef } from '../src/host/strategy-goals-types.ts';
import { readStrategyDiscussion, closeStrategyDiscussion, canSettleDiscussionMessage } from '../src/host/ui/strategy-discussion-client.ts';

test('Host → real discussion client → transcript shows original user words while native context remains intact', { timeout: 65000 }, async t => {
  const host = await startTestHost(), provider = await startToolProvider();
  const renderer = await createServer({ configFile: false, logLevel: 'silent', server: { middlewareMode: true, hmr: false, watch: null } });
  t.after(async () => { await renderer.close(); await host.close(); await provider.close(); });
  const originalFetch = globalThis.fetch;
  const req = async (path: string, method = 'GET', body?: unknown) => { const response = await originalFetch(host.baseUrl + path, { method, headers: host.headers, ...(body ? { body: JSON.stringify(body) } : {}) }); assert.ok(response.ok, `${path}: ${response.status}`); return response.json(); };
  await req('/api/configuration', 'PUT', { name: 'Projection fixture', provider: 'openai-compatible', baseUrl: provider.baseUrl, model: 'synthetic-projection', apiKey: 'synthetic-user-projection-only' });
  provider.setResponder(() => ({ text: '这是原模型回复；采用目标与效果分别核对。' }));
  const id = randomUUID(), userText = '请比较本人家庭与事业的可行取舍。';
  const { discussion } = await req('/api/strategy/discussions', 'POST', { operationId: id, usageContext: { kind: 'personal', background: '本人家庭与事业范围' }, methods: [{ id: 'playing-to-win', name: 'Playing to Win' }] });
  const input = { requestId: randomUUID(), text: userText, expectedRevision: discussion.revision };
  await req(`/api/strategy/discussions/${id}/messages`, 'POST', input);
  t.mock.method(globalThis, 'fetch', (resource: RequestInfo | URL, init?: RequestInit) => { const url = String(resource); return originalFetch(url.startsWith('/api/') ? host.baseUrl + url : resource, { ...init, headers: url.startsWith('/api/') ? { ...init?.headers, ...host.headers } : init?.headers }); });
  let detail = await readStrategyDiscussion(id);
  for (let attempt = 0; attempt < 400 && (detail.busy || !['completed', 'failed', 'cancelled'].includes(detail.discussion.lastRun?.status || '')); attempt++) { await delay(25); detail = await readStrategyDiscussion(id); }
  assert.equal(detail.discussion.lastRun?.status, 'completed'); assert.equal(canSettleDiscussionMessage(detail, input), true);
  await closeStrategyDiscussion(id); detail = await readStrategyDiscussion(id);
  assert.equal(canSettleDiscussionMessage(detail, input), true, 'closed owner recovers only the exact native receipt');
  const userMessage = detail.snapshot.messages.find(message => message.role === 'user');
  assert.ok(userMessage); assert.equal(userMessage.originalUserText, userText);
  const nativeBody = providerMessageText(userMessage.content); assert.match(nativeBody, /usageContext/); assert.match(nativeBody, /Playing to Win/);
  const { StrategyDiscussionTranscript } = await renderer.ssrLoadModule('/src/host/ui/StrategyDiscussionPanel.tsx');
  const html = renderToStaticMarkup(createElement(StrategyDiscussionTranscript, { messages: detail.snapshot.messages.filter(message => message.role === 'user' || message.role === 'assistant') }));
  const evidence = new URL('../.local/v12-implementation/ui/user-projection/', import.meta.url); await mkdir(evidence, { recursive: true });
  await writeFile(new URL('host-client-ssr.json', evidence), JSON.stringify({ discussionId: id, userText, nativeUiMessage: userMessage, nativeBody, html, providerRequests: provider.requests.length }, null, 2));
  assert.match(html, new RegExp(`<p>${userText}</p>`));
  assert.doesNotMatch(html, /usageContext|goalContext|&quot;methods&quot;|用户本轮原话/);
  assert.match(html, /这是原模型回复/);
  assert.equal(provider.requests.length, 1, 'reading/rendering never dispatches another model request');
});

test('a Goal source opens its exact durable tool-call carrier through the real client and source renderer', { timeout: 65000 }, async t => {
  const host = await startTestHost(), provider = await startToolProvider();
  const renderer = await createServer({ configFile: false, logLevel: 'silent', server: { middlewareMode: true, hmr: false, watch: null } });
  t.after(async () => { await renderer.close(); await host.close(); await provider.close(); });
  const originalFetch = globalThis.fetch;
  const req = async (path: string, method = 'GET', body?: unknown) => { const response = await originalFetch(host.baseUrl + path, { method, headers: host.headers, ...(body ? { body: JSON.stringify(body) } : {}) }); assert.ok(response.ok, `${path}: ${response.status}`); return response.json(); };
  await req('/api/configuration', 'PUT', { name: 'Source fixture', provider: 'openai-compatible', baseUrl: provider.baseUrl, model: 'synthetic-source', apiKey: 'synthetic-source-only' });
  const draft = { title: '兼顾事业与家庭', outcome: '比较本人可行安排', perspective: 'personal', scope: { kind: 'personal', id: 'self', name: '本人' }, measurement: { kind: 'deliverable', criterion: '本人核对取舍及可观察条件' }, baseline: { state: 'pending', description: '时间使用尚待核实' }, responsible: '本人', necessaryConditions: ['工作负荷和家庭协同待核'] };
  provider.setResponder(context => context.recentToolResults.length ? { text: '候选已保存，尚未采用。' } : { calls: [{ name: 'strategy_goals', arguments: { action: 'propose-goal', draft } }] });
  const id = randomUUID(), { discussion } = await req('/api/strategy/discussions', 'POST', { operationId: id });
  await req(`/api/strategy/discussions/${id}/messages`, 'POST', { requestId: randomUUID(), text: '请形成可核对候选，负责人本人，暂不采用。', expectedRevision: discussion.revision });
  t.mock.method(globalThis, 'fetch', (resource: RequestInfo | URL, init?: RequestInit) => { const url = String(resource); return originalFetch(url.startsWith('/api/') ? host.baseUrl + url : resource, { ...init, headers: url.startsWith('/api/') ? { ...init?.headers, ...host.headers } : init?.headers }); });
  let detail = await readStrategyDiscussion(id);
  for (let attempt = 0; attempt < 400 && (detail.busy || !['completed', 'failed', 'cancelled'].includes(detail.discussion.lastRun?.status || '')); attempt++) { await delay(25); detail = await readStrategyDiscussion(id); }
  assert.equal(detail.discussion.lastRun?.status, 'completed'); assert.equal(detail.goals.length, 1);
  const source = detail.goals[0].source; assert.equal(source?.authority, 'strategy-discussion');
  if (source?.authority !== 'strategy-discussion') throw new Error('missing exact native source');
  const { readStrategyDiscussionSource } = await import('../src/host/ui/strategy-discussion-client.ts');
  assert.ok(source.sessionId); assert.ok(source.entryType); const nativeSource = source as GoalDiscussionSourceRef;
  const receipt = await readStrategyDiscussionSource(nativeSource);
  const { StrategyDiscussionSourceBody } = await renderer.ssrLoadModule('/src/host/ui/StrategyDiscussionSourceView.tsx');
  const html = renderToStaticMarkup(createElement(StrategyDiscussionSourceBody, { detail: receipt }));
  assert.match(receipt.body, /toolCall/); assert.match(receipt.body, /propose-goal/); assert.match(receipt.body, /兼顾事业与家庭/);
  assert.match(html, /准确原生载体/); assert.match(html, /toolCall/); assert.match(html, /不是补写的 Agent 报告/);
  const calls = provider.requests.length; await assert.rejects(readStrategyDiscussionSource({ ...nativeSource, sha256: 'f'.repeat(64) })); assert.equal(provider.requests.length, calls, 'source reads never dispatch a model');
});

test('adoption refreshes the parent authority and the same discussion card without another adoption or model request', { timeout: 65000 }, async t => {
  const host = await startTestHost(), provider = await startToolProvider();
  const renderer = await createServer({ configFile: false, logLevel: 'silent', server: { middlewareMode: true, hmr: false, watch: null } });
  t.after(async () => { await renderer.close(); await host.close(); await provider.close(); });
  const originalFetch = globalThis.fetch;
  const req = async (route: string, method = 'GET', body?: unknown) => { const response = await originalFetch(host.baseUrl + route, { method, headers: host.headers, ...(body ? { body: JSON.stringify(body) } : {}) }); assert.ok(response.ok, `${route}: ${response.status}`); return response.json(); };
  await req('/api/configuration', 'PUT', { name: 'Adoption refresh fixture', provider: 'openai-compatible', baseUrl: provider.baseUrl, model: 'synthetic-adoption-refresh', apiKey: 'synthetic-refresh-only' });
  const draft = { title: '本人的事业家庭取舍', outcome: '形成可核对的安排', perspective: 'personal', scope: { kind: 'personal', id: 'self', name: '本人' }, measurement: { kind: 'deliverable', criterion: '本人核对安排与前提' }, baseline: { state: 'pending', description: '时间使用待核实' }, responsible: '本人' };
  provider.setResponder(context => context.recentToolResults.length ? { text: '候选已保存，等待人的明确采用。' } : { calls: [{ name: 'strategy_goals', arguments: { action: 'propose-goal', draft } }] });
  const id = randomUUID(), { discussion } = await req('/api/strategy/discussions', 'POST', { operationId: id });
  await req(`/api/strategy/discussions/${id}/messages`, 'POST', { requestId: randomUUID(), text: '请形成此候选，责任人为本人，暂不采用。', expectedRevision: discussion.revision });
  const client = await import('../src/host/ui/strategy-discussion-client.ts');
  const calls: { route: string; method: string }[] = [];
  t.mock.method(globalThis, 'fetch', (resource: RequestInfo | URL, init?: RequestInit) => { const route = String(resource); calls.push({ route, method: init?.method || 'GET' }); return originalFetch(route.startsWith('/api/') ? host.baseUrl + route : resource, { ...init, headers: route.startsWith('/api/') ? { ...init?.headers, ...host.headers } : init?.headers }); });
  let detail = await client.readStrategyDiscussion(id);
  for (let attempt = 0; attempt < 400 && (detail.busy || !['completed', 'failed', 'cancelled'].includes(detail.discussion.lastRun?.status || '')); attempt++) { await delay(25); detail = await client.readStrategyDiscussion(id); }
  assert.equal(detail.discussion.lastRun?.status, 'completed'); const candidate = detail.goals[0]; assert.equal(candidate.status, 'candidate');
  const panel = await renderer.ssrLoadModule('/src/host/ui/StrategyDiscussionPanel.tsx');
  const before = renderToStaticMarkup(createElement(panel.StrategyDiscussionCandidates, { goals: detail.goals, discussionId: id, locked: false, onReview() {} }));
  assert.match(before, /原目标候选 · 待采用/); assert.match(before, /核对并采用/);
  await client.adoptDiscussionGoal(id, { operationId: randomUUID(), goalId: candidate.goalId, version: candidate.version, expectedVersion: candidate.version, goalContentSha256: detail.goalContentHashes[`${candidate.goalId}:${candidate.version}`], decision: '明确采用本次集中核对目标，保留前提；不授权经营执行。' });
  calls.length = 0; const modelCalls = provider.requests.length; let parentGoal: { adoptedVersion?: number } | undefined;
  const next = await client.reloadDiscussionAfterGoalChange(id, async () => { parentGoal = (await req(`/api/strategy/goals/${candidate.goalId}`)).goal; });
  const after = renderToStaticMarkup(createElement(panel.StrategyDiscussionCandidates, { goals: next.goals, discussionId: id, locked: false, onReview() {} }));
  assert.ok(parentGoal); assert.equal(parentGoal.adoptedVersion, candidate.version); assert.equal(next.discussion.id, id); assert.equal(next.goals[0].goalId, candidate.goalId); assert.equal(next.goals[0].version, candidate.version);
  assert.match(after, /原目标 · 已采用/); assert.doesNotMatch(after, /待采用|核对并采用/); assert.equal(provider.requests.length, modelCalls); assert.deepEqual(calls, [{ route: `/api/strategy/discussions/${id}`, method: 'GET' }]);
  const evidence = new URL('../.local/v12-implementation/ui/adoption-card-sync/', import.meta.url); await mkdir(evidence, { recursive: true }); await writeFile(new URL('before-after.json', evidence), JSON.stringify({ before, after, goal: next.goals[0], calls, modelCalls }, null, 2));
});
