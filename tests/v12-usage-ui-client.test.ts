import test from 'node:test';
import assert from 'node:assert/strict';
import { saveUsageContextSettings, UsageContextRequestError, usageContextJournal, readUsageContextOperation } from '../src/host/ui/usage-context-client.ts';
test('a lost usage save remains UNKNOWN with the unchanged original intent and no automatic replay', async t => {
  const calls: RequestInit[] = [], input = { operationId: '10000000-0000-4000-8000-000000000001', expectedRevision: 2, context: { kind: 'personal' as const, background: '家庭与事业' } };
  t.mock.method(globalThis, 'fetch', async (_url: string, init: RequestInit) => { calls.push(init); throw new TypeError('response lost'); });
  await assert.rejects(saveUsageContextSettings(input), error => error instanceof UsageContextRequestError && error.uncertain);
  assert.equal(calls.length, 1); assert.deepEqual(JSON.parse(String(calls[0].body)), input);
});
test('usage operation survives reopening with exact context and is settled only by its own identity', async t => {
  const values = new Map<string, string>(), storage = { getItem: (key: string) => values.get(key) || null, setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } };
  const input = { operationId: '10000000-0000-4000-8000-000000000002', expectedRevision: 2, context: { kind: 'department' as const, background: '上层未知，不增加权限' } };
  usageContextJournal(storage).remember(input); input.context.background = '后来编辑';
  const reopened = usageContextJournal(storage); assert.equal(reopened.read()?.context?.background, '上层未知，不增加权限');
  assert.throws(() => reopened.remember(input), /原用途设置/); reopened.settle('other-operation'); assert.ok(reopened.read());
  const methods: string[] = []; t.mock.method(globalThis, 'fetch', async (_url: string, init: RequestInit) => { methods.push(init.method || 'GET'); return Response.json({ operation: null }); });
  await readUsageContextOperation('10000000-0000-4000-8000-000000000002'); assert.deepEqual(methods, ['GET']);
  reopened.settle('10000000-0000-4000-8000-000000000002'); assert.equal(reopened.read(), undefined);
});
