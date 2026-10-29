import test from 'node:test';
import assert from 'node:assert/strict';
import { startTestHost } from './fixtures/host-process.ts';
import { startSyntheticProvider } from './fixtures/synthetic-provider.ts';

test('CONN-01: only explicit test uses actual SDK + patched HTTP, with fixed prompt, literal key and no project resources/tools', async t => {
  const provider = await startSyntheticProvider(); t.after(() => provider.close());
  const host = await startTestHost(); t.after(() => host.close());
  const secret = '!literal-$OPENAI_API_KEY';
  const saved = await (await host.request('/api/configuration', 'PUT', { name: '本地合成', provider: 'openai-compatible', baseUrl: provider.baseUrl, model: 'synthetic-model', apiKey: secret })).json();
  await host.request('/api/configuration');
  assert.equal(provider.requests.length, 0, 'Save and read must not contact the provider');
  const response = await host.request('/api/connection-test', 'POST', { revision: saved.configuration.revision });
  assert.equal(response.status, 200, await response.clone().text());
  const result = await response.json(); assert.equal(result.ok, true); assert.equal(result.reply, 'SDK 合成回复');
  assert.equal(provider.requests.length, 1);
  const request = provider.requests[0]!;
  assert.equal(request.path, '/v1/chat/completions'); assert.equal(request.authorization, `Bearer ${secret}`);
  assert.equal(request.body.model, 'synthetic-model'); assert.equal(request.body.tools?.length ?? 0, 0);
  const userContents = request.body.messages?.filter(message => message.role === 'user').map(message => typeof message.content === 'string' ? message.content : Array.isArray(message.content) ? message.content.map(part => part.type === 'text' ? part.text : '[non-text]').join('') : '[invalid]');
  assert.deepEqual(userContents, ['请仅回复 OK。']);
  assert.ok(!JSON.stringify(request.body).includes('DevWorkSpace'));
  assert.ok(!JSON.stringify(request.body).includes('工程入口'));
  assert.ok(!JSON.stringify(result).includes(secret)); assert.ok(!JSON.stringify(host.output()).includes(secret));
});

test('CONN-01: provider failure is honest, has no raw error/key leakage or automatic retry', async t => {
  const provider = await startSyntheticProvider(); provider.setMode('failure'); t.after(() => provider.close());
  const host = await startTestHost(); t.after(() => host.close());
  const secret = 'synthetic-private-key';
  const saved = await (await host.request('/api/configuration', 'PUT', { name: '失败合成', provider: 'openai-compatible', baseUrl: provider.baseUrl, model: 'synthetic-model', apiKey: secret })).json();
  const response = await host.request('/api/connection-test', 'POST', { revision: saved.configuration.revision });
  assert.equal(response.status, 502);
  const text = await response.text(); assert.match(text, /connection_failed/); assert.ok(!text.includes(secret)); assert.ok(!text.includes('synthetic-private-detail'));
  assert.equal(provider.requests.length, 1); assert.ok(!JSON.stringify(host.output()).includes(secret));
});

test('CONN-01: timeout aborts the actual SDK stream and leaves Host usable', async t => {
  const provider = await startSyntheticProvider(); provider.setMode('slow'); t.after(() => provider.close());
  const host = await startTestHost({ timeoutMs: 200 }); t.after(() => host.close());
  const saved = await (await host.request('/api/configuration', 'PUT', { name: '超时合成', provider: 'openai-compatible', baseUrl: provider.baseUrl, model: 'synthetic-model', apiKey: 'synthetic-timeout-key' })).json();
  const response = await host.request('/api/connection-test', 'POST', { revision: saved.configuration.revision });
  assert.equal(response.status, 504, await response.clone().text());
  assert.equal((await host.request('/api/health')).status, 200);
  assert.equal(provider.requests.length, 1);
  provider.setMode('success');
  const again = await host.request('/api/connection-test', 'POST', { revision: saved.configuration.revision });
  assert.equal(again.status, 200);
  assert.equal(provider.requests[0]?.closedEarly, true);
});
