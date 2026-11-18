import test from 'node:test';
import assert from 'node:assert/strict';
import { sendStrategyDiscussionMessage, StrategyDiscussionRequestError, discussionJournal, readStrategyDiscussion, watchStrategyDiscussion, canSettleDiscussionMessage } from '../src/host/ui/strategy-discussion-client.ts';
import type { StrategyDiscussionDetail } from '../src/host/strategy-discussion-types.ts';
test('a discussion message cannot accept a response belonging to another request or owner', async t => {
  t.mock.method(globalThis, 'fetch', async () => Response.json({ discussion: { id: 'other-discussion' }, requestId: 'other-request' }, { status: 202 }));
  await assert.rejects(sendStrategyDiscussionMessage('discussion-one', { requestId: 'request-one', text: '沿原范围继续', expectedRevision: 3 }), error => error instanceof StrategyDiscussionRequestError && error.uncertain);
});
test('lost discussion create/message/update keeps exact original payload across reopening without replacing an unresolved intent', () => {
  const values = new Map<string, string>(), storage = { getItem: (key: string) => values.get(key) || null, setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } };
  const input = { kind: 'update' as const, discussionId: 'discussion-one', input: { expectedRevision: 4, usageContext: { kind: 'personal' as const, background: '原本人背景' }, methods: [{ id: 'user-reference', name: '原参考' }] } };
  discussionJournal(storage).remember(input); input.input.methods[0].name = '后来改选'; const reopened = discussionJournal(storage);
  assert.equal(reopened.read()?.kind, 'update'); assert.throws(() => reopened.remember(input), /原讨论请求/);
  reopened.settle(input); assert.ok(reopened.read());
});
test('unknown message never posts another turn and read-only recovery addresses the exact discussion', async t => {
  const calls: { url: string; method: string }[] = [];
  t.mock.method(globalThis, 'fetch', async (url: string, init: RequestInit) => { calls.push({ url, method: init.method || 'GET' }); if (init.method === 'POST') throw new TypeError('response lost'); return Response.json({ discussion: { id: 'original/id' } }); });
  await assert.rejects(sendStrategyDiscussionMessage('original/id', { requestId: 'original-request', text: '原提问', expectedRevision: 2 }), error => error instanceof StrategyDiscussionRequestError && error.uncertain);
  await readStrategyDiscussion('original/id'); assert.deepEqual(calls, [{ url: '/api/strategy/discussions/original%2Fid/messages', method: 'POST' }, { url: '/api/strategy/discussions/original%2Fid', method: 'GET' }]);
});
test('discussion events project real streamed frames including split UTF-8 without dispatching a message', async t => {
  const bytes = new TextEncoder().encode('data: {"type":"text.delta","text":"原生讨论","requestId":"original"}\r\n\r\ndata: {"type":"run.settled","outcome":"completed","requestId":"original"}\n\n');
  const calls: string[] = []; t.mock.method(globalThis, 'fetch', async (_url: string, init: RequestInit) => { calls.push(init.method || 'GET'); return new Response(new ReadableStream({ start(controller) { controller.enqueue(bytes.slice(0, 47)); controller.enqueue(bytes.slice(47)); controller.close(); } })); });
  const events: unknown[] = []; await watchStrategyDiscussion('original', event => events.push(event), new AbortController().signal);
  assert.deepEqual(events, [{ type: 'text.delta', text: '原生讨论', requestId: 'original' }, { type: 'run.settled', outcome: 'completed', requestId: 'original' }]); assert.deepEqual(calls, ['GET']);
});
test('metadata acceptance without native user receipt cannot discard the original message', () => {
  const input = { requestId: 'original-request', expectedRevision: 2, text: '用户唯一原话' };
  const metadataOnly = { discussion: { lastRun: { id: input.requestId, status: 'failed' } } } as StrategyDiscussionDetail;
  assert.equal(canSettleDiscussionMessage(metadataOnly, input), false);
});

test('only a matching native input receipt settles the original request', () => {
  const input = { requestId: 'request-one', expectedRevision: 2, text: '原话' };
  const receipt = { requestId: input.requestId, originalUserText: input.text, nativeEntryId: 'native-entry', sessionId: 'native-session' };
  const detail = { requestReceipt: receipt } as StrategyDiscussionDetail;
  assert.equal(canSettleDiscussionMessage(detail, input), true);
  for (const mismatch of [{ requestId: 'other-request' }, { originalUserText: '其他原话' }, { nativeEntryId: '' }, { sessionId: '' }]) assert.equal(canSettleDiscussionMessage({ ...detail, requestReceipt: { ...receipt, ...mismatch } }, input), false);
});

test('the exact native source reader retains entry identity and rejects a mismatched source receipt', async t => {
  const source = { authority: 'strategy-discussion' as const, id: 'discussion-id', version: 'entry-id', sessionId: 'session-id', sha256: 'a'.repeat(64), entryType: 'message' as const };
  const calls: string[] = [];
  const client = await import('../src/host/ui/strategy-discussion-client.ts');
  t.mock.method(globalThis, 'fetch', async (url: string) => { calls.push(url); return Response.json({ source: { ...source, sha256: 'b'.repeat(64) }, role: 'assistant', body: '[{"type":"toolCall"}]', range: { start: 0, end: 21, total: 21 }, complete: true }); });
  await assert.rejects(client.readStrategyDiscussionSource(source), error => error instanceof StrategyDiscussionRequestError && error.code === 'strategy_discussion_source_mismatch');
  assert.match(calls[0], /\/source\?sessionId=session-id&entryId=entry-id&sha256=a{64}&entryType=message&offset=0&limit=8192$/);
});
