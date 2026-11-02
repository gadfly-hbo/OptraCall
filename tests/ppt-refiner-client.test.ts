import test from 'node:test';
import assert from 'node:assert/strict';
import * as client from '../extensions/business-plugins/ppt-refiner/ui/refiner-client.ts';

test('refiner client retains failed/cancelled turn replies and saved snapshots', async t => {
  const original = globalThis.fetch;
  t.after(() => { globalThis.fetch = original; });
  for (const [outcome, status] of [['failed', 422], ['cancelled', 409]] as const) {
    const result = { outcome, reply: '未完成，部分修改已保存。', snapshot: { version: 2, pages: [1], diffs: [], summary: 'partial', at: '2026-11-02T00:00:00Z' }, elapsedMs: 2, violations: [] };
    globalThis.fetch = async () => new Response(JSON.stringify(result), { status });
    await assert.rejects(() => client.runTurn('deck-test', '改标题', 'request-1', 1), error => {
      assert.ok(error instanceof client.RefinerRequestError);
      assert.equal(error.status, status);
      assert.deepEqual(error.turn, result, 'the UI must receive the actual outcome, reply and saved version even for non-2xx');
      return true;
    });
  }
});

test('refiner client does not invent a turn receipt or replay an unknown request', async t => {
  const original = globalThis.fetch;
  t.after(() => { globalThis.fetch = original; });
  let calls = 0;
  globalThis.fetch = async () => { calls++; throw new TypeError('synthetic connection lost'); };
  await assert.rejects(() => client.runTurn('deck-test', '改标题', 'unknown-request', 1), /synthetic connection lost/);
  assert.equal(calls, 1, 'an unknown result must be read back, never automatically replayed');
  globalThis.fetch = async () => new Response(JSON.stringify({ code: 'session_busy', message: '仍在运行。' }), { status: 409 });
  await assert.rejects(() => client.runTurn('deck-test', '改标题', 'busy-request', 1), error => {
    assert.ok(error instanceof client.RefinerRequestError);
    assert.equal(error.code, 'session_busy'); assert.equal(error.turn, undefined);
    return true;
  });
});

test('refiner client preserves an unreadable successful response as unknown', async t => {
  const original = globalThis.fetch;
  t.after(() => { globalThis.fetch = original; });
  let calls = 0;
  globalThis.fetch = async () => { calls++; return new Response('{"reply":'); };
  await assert.rejects(() => client.runTurn('deck-test', '改标题', 'body-lost-request', 1), SyntaxError);
  assert.equal(calls, 1, 'a lost response body must not turn into a completed empty receipt or an automatic replay');
});

test('refiner client carries project-relative sources and explicit read-only intent', async t => {
  const original = globalThis.fetch;
  t.after(() => { globalThis.fetch = original; });
  const calls: { route: string; method: string; input: unknown }[] = [];
  globalThis.fetch = async (input, init) => {
    calls.push({ route: String(input), method: init?.method ?? 'GET', input: init?.body ? JSON.parse(String(init.body)) : undefined });
    return new Response(JSON.stringify({ meta: { id: 'deck-test' }, decks: [], reply: '只读检查完成。', outcome: 'completed', snapshot: null, elapsedMs: 0 }));
  };
  const source = { projectId: 'project-a', sourcePptx: '060_reports/example_候选版.pptx', reportPath: '060_reports/example.md', title: '示例' };
  await client.createDeck(source);
  await client.listDecks();
  await client.runTurn('deck-test', '检查本页', 'inspect-request', 2, 'inspect');
  await client.runTurn('deck-test', '检查视觉', 'visual-request', 2, 'inspect', true);
  await client.exportDeck('deck-test', { fileName: '示例_终版.pptx' });
  assert.deepEqual(calls, [
    { route: '/api/ppt-refiner/decks', method: 'POST', input: source },
    { route: '/api/ppt-refiner/decks', method: 'GET', input: undefined },
    { route: '/api/ppt-refiner/decks/deck-test/turns', method: 'POST', input: { text: '检查本页', requestId: 'inspect-request', page: 2, mode: 'inspect' } },
    { route: '/api/ppt-refiner/decks/deck-test/turns', method: 'POST', input: { text: '检查视觉', requestId: 'visual-request', page: 2, mode: 'inspect', visual: true } },
    { route: '/api/ppt-refiner/decks/deck-test/export', method: 'POST', input: { fileName: '示例_终版.pptx' } },
  ]);
});

test('refiner client preserves a real stop failure instead of reporting stopped', async t => {
  const original = globalThis.fetch;
  t.after(() => { globalThis.fetch = original; });
  globalThis.fetch = async () => new Response(JSON.stringify({ code: 'session_close_failed', message: '实际收尾尚未完成。' }), { status: 503 });
  await assert.rejects(() => client.stopSession('deck-test'), error => {
    assert.ok(error instanceof client.RefinerRequestError);
    assert.equal(error.status, 503); assert.equal(error.code, 'session_close_failed'); assert.match(error.message, /尚未完成/);
    return true;
  });
});

test('refiner export collision keeps HTTP refusal and explains the filename change', async t => {
  const original = globalThis.fetch;
  t.after(() => { globalThis.fetch = original; });
  let calls = 0;
  globalThis.fetch = async () => { calls++; return new Response(JSON.stringify({ code: 'export_exists', message: 'EXPORT_EXISTS' }), { status: 409 }); };
  await assert.rejects(() => client.exportDeck('deck-test', { fileName: 'existing.pptx' }), error => {
    assert.ok(error instanceof client.RefinerRequestError);
    assert.equal(error.status, 409); assert.equal(error.code, 'export_exists');
    assert.equal(error.message, '同名终版或差异清单已存在，请修改文件名后再导出。');
    return true;
  });
  assert.equal(calls, 1, 'the refusal must not retry or overwrite the existing export');
});

test('refiner early stop waits for real busy ownership before sending stop', async t => {
  const original = globalThis.fetch;
  t.after(() => { globalThis.fetch = original; });
  let resolveTurn!: () => void;
  const turn = new Promise<void>(resolve => { resolveTurn = resolve; });
  const calls: string[] = [];
  let reads = 0, observedBusy = false, stopped = false;
  globalThis.fetch = async (input, init) => {
    if (init?.method === 'POST') {
      assert.equal(observedBusy, true, 'a stop sent before the turn has actual Host ownership may miss it');
      calls.push('stop'); stopped = true; resolveTurn();
      return new Response(JSON.stringify({ stopped: true }));
    }
    reads++; observedBusy = reads > 1 && !stopped; calls.push(observedBusy ? 'busy' : 'idle');
    return new Response(JSON.stringify({ busy: observedBusy }));
  };
  await client.stopPendingTurn('deck-test', turn);
  await turn;
  assert.deepEqual(calls, ['idle', 'busy', 'stop', 'idle']);
});

test('refiner stop observes an already settled request without dispatching another operation', async t => {
  const original = globalThis.fetch;
  t.after(() => { globalThis.fetch = original; });
  globalThis.fetch = async () => { throw new Error('a settled turn must not send stop'); };
  await client.stopPendingTurn('deck-test', Promise.resolve());
});

test('refiner early stop reports readback failures and never silently sends stop', async t => {
  const original = globalThis.fetch;
  t.after(() => { globalThis.fetch = original; });
  const methods: string[] = [];
  globalThis.fetch = async (_input, init) => { methods.push(init?.method ?? 'GET'); return new Response(JSON.stringify({ code: 'deck_not_found', message: '读取失败。' }), { status: 404 }); };
  await assert.rejects(() => client.stopPendingTurn('deck-test', new Promise(() => {})), error => {
    assert.ok(error instanceof client.RefinerRequestError); assert.equal(error.code, 'deck_not_found'); return true;
  });
  assert.deepEqual(methods, ['GET']);
});

test('refiner stop reads actual Host occupancy after a transport failure and confirms idle after stopping', async t => {
  const original = globalThis.fetch;
  t.after(() => { globalThis.fetch = original; });
  const calls: string[] = [];
  let busy = true;
  globalThis.fetch = async (_input, init) => {
    if (init?.method === 'POST') { calls.push('stop'); busy = false; return new Response(JSON.stringify({ stopped: true })); }
    calls.push(busy ? 'busy' : 'idle');
    return new Response(JSON.stringify({ busy }));
  };
  await client.stopPendingTurn('deck-test', Promise.reject(new TypeError('synthetic turn connection lost')));
  assert.deepEqual(calls, ['busy', 'stop', 'idle'], 'a rejected transport promise is not evidence that its Host operation ended');
});

test('refiner stop preserves an unknown result even when the Host has become idle', async t => {
  const original = globalThis.fetch;
  t.after(() => { globalThis.fetch = original; });
  const calls: string[] = [];
  globalThis.fetch = async (_input, init) => { calls.push(init?.method ?? 'GET'); return new Response(JSON.stringify({ busy: false })); };
  const view = await client.stopPendingTurn('deck-test', Promise.reject(new TypeError('synthetic turn connection lost')));
  assert.equal(view?.busy, false, 'the caller needs a real idle readback, without inventing a successful turn receipt');
  assert.deepEqual(calls, ['GET']);
});

test('refiner stop never claims another operation after a typed busy refusal', async t => {
  const original = globalThis.fetch;
  t.after(() => { globalThis.fetch = original; });
  const calls: string[] = [];
  globalThis.fetch = async (_input, init) => { calls.push(init?.method ?? 'GET'); throw new Error('must not control another operation'); };
  await client.stopPendingTurn('deck-test', Promise.reject(new client.RefinerRequestError('session_busy', 409)));
  assert.deepEqual(calls, []);
});

test('refiner unknown stop reports failed occupancy readback instead of releasing control', async t => {
  const original = globalThis.fetch;
  t.after(() => { globalThis.fetch = original; });
  let calls = 0;
  globalThis.fetch = async () => { calls++; throw new TypeError('synthetic readback unavailable'); };
  await assert.rejects(() => client.stopPendingTurn('deck-test', Promise.reject(new TypeError('synthetic turn connection lost'))), /synthetic readback unavailable/);
  assert.equal(calls, 1, 'a failed readback must be visible without retrying the turn or silently declaring it stopped');
});

test('refiner stop waits for actual idle instead of treating a stop acknowledgement as terminal', async t => {
  const original = globalThis.fetch;
  t.after(() => { globalThis.fetch = original; });
  let reads = 0;
  const calls: string[] = [];
  globalThis.fetch = async (_input, init) => {
    if (init?.method === 'POST') { calls.push('stop'); return new Response(JSON.stringify({ stopped: true })); }
    const busy = ++reads < 3; calls.push(busy ? 'busy' : 'idle');
    return new Response(JSON.stringify({ busy }));
  };
  const view = await client.stopPendingTurn('deck-test', Promise.reject(new TypeError('synthetic turn connection lost')));
  assert.equal(view?.busy, false);
  assert.deepEqual(calls, ['busy', 'stop', 'busy', 'idle']);
});

test('refiner stop preserves a failed post-stop readback instead of reporting idle', async t => {
  const original = globalThis.fetch;
  t.after(() => { globalThis.fetch = original; });
  const calls: string[] = [];
  globalThis.fetch = async (_input, init) => {
    if (init?.method === 'POST') { calls.push('stop'); return new Response(JSON.stringify({ stopped: true })); }
    calls.push('GET');
    if (calls.length > 2) throw new TypeError('synthetic post-stop readback lost');
    return new Response(JSON.stringify({ busy: true }));
  };
  await assert.rejects(() => client.stopPendingTurn('deck-test', Promise.reject(new TypeError('synthetic turn connection lost'))), /synthetic post-stop readback lost/);
  assert.deepEqual(calls, ['GET', 'stop', 'GET']);
});
