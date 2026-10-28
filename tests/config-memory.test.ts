import test from 'node:test';
import assert from 'node:assert/strict';
import { ConfigurationError, MemoryConfiguration } from '../src/host/config-memory.ts';

test('CFG-01: save/read returns a masked Host-memory configuration and never serializes the key', () => {
  const store = new MemoryConfiguration();
  assert.equal(store.read(), null);
  const input = { name: '测试配置', provider: 'openai-compatible', baseUrl: 'https://api.example.invalid/v1', model: 'model-a', apiKey: '!literal-test-key' };
  const saved = store.save(input);
  assert.deepEqual(saved, { name: '测试配置', provider: 'openai-compatible', baseUrl: 'https://api.example.invalid/v1', model: 'model-a', revision: 1, hasApiKey: true });
  assert.deepEqual(store.read(), saved);
  assert.ok(!JSON.stringify(store.read()).includes(input.apiKey));
  assert.equal(new MemoryConfiguration().read(), null);
});

test('CFG-02: snapshots stay fixed, endpoint changes require a new key, and clear/new Host lose keys', () => {
  const store = new MemoryConfiguration();
  const input = { name: 'A', provider: 'openai-compatible', baseUrl: 'https://one.example.invalid/v1', model: 'model-a', apiKey: 'synthetic-key-A' };
  store.save(input);
  const previous = store.snapshot();
  store.save({ ...input, name: 'B', model: 'model-b', apiKey: '' });
  assert.equal(store.read()?.revision, 2);
  assert.equal(previous?.model, 'model-a');
  assert.ok(Object.isFrozen(previous));
  assert.throws(() => store.save({ ...input, baseUrl: 'https://other.example.invalid', apiKey: '' }), ConfigurationError);
  assert.equal(store.read()?.baseUrl, input.baseUrl);
  store.clear();
  assert.equal(store.read(), null);
  assert.equal(store.snapshot(), null);
  assert.throws(() => store.save({ ...input, apiKey: '' }), ConfigurationError);
});

test('CFG-02: malformed endpoints and fields fail without returning submitted secrets', () => {
  const store = new MemoryConfiguration();
  for (const baseUrl of ['javascript:alert(1)', 'https://user:password@api.example.invalid', 'https://api.example.invalid?key=private', 'https://api.example.invalid/#secret']) {
    assert.throws(() => store.save({ name: 'A', provider: 'openai-compatible', baseUrl, model: 'model-a', apiKey: 'synthetic-secret' }), error => error instanceof ConfigurationError && Boolean(error.fields.baseUrl) && !JSON.stringify(error.fields).includes('synthetic-secret'));
  }
  assert.equal(store.read(), null);
});
