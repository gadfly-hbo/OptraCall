import test from 'node:test';
import assert from 'node:assert/strict';
import { request as httpRequest } from 'node:http';
import { runtimeEnvironment } from '../scripts/runtime-process.ts';
import { startTestHost } from './fixtures/host-process.ts';

test('ISO-01: Host environment excludes provider credentials, config overrides and code injection', () => {
  const env = runtimeEnvironment({ PATH: '/synthetic/bin', OPENAI_API_KEY: 'poison', AWS_PROFILE: 'poison', PI_CODING_AGENT_DIR: '/poison', NODE_OPTIONS: '--require=poison', HTTPS_PROXY: 'http://poison', HOME: '/poison' });
  assert.deepEqual(Object.keys(env).sort(), ['NODE_DISABLE_COMPILE_CACHE', 'OPTRACALL_HOST_ISOLATED', 'PATH', 'PI_OFFLINE', 'PI_SKIP_VERSION_CHECK', 'PI_TELEMETRY'].sort());
});

test('CFG-02: split UTF-8 JSON bytes preserve Chinese configuration text', async t => {
  const host = await startTestHost(); t.after(() => host.close());
  const bytes = Buffer.from(JSON.stringify({ name: '测试配置', provider: 'openai-compatible', baseUrl: 'http://127.0.0.1:1/v1', model: 'synthetic-model', apiKey: 'synthetic-key' }));
  const split = bytes.indexOf(Buffer.from('测')) + 1;
  const result = await new Promise<{ status: number; text: string }>((resolve, reject) => {
    const request = httpRequest(host.baseUrl + '/api/configuration', { method: 'PUT', headers: host.headers }, response => {
      const chunks: Buffer[] = []; response.on('data', chunk => chunks.push(Buffer.from(chunk))); response.on('end', () => resolve({ status: response.statusCode ?? 0, text: Buffer.concat(chunks).toString() }));
    });
    request.on('error', reject); request.write(bytes.subarray(0, split)); setTimeout(() => request.end(bytes.subarray(split)), 10);
  });
  assert.equal(result.status, 200);
  assert.equal(JSON.parse(result.text).configuration.name, '测试配置');
});

test('SDK-04 / CFG-04: Host imports pinned SDK, masks persistent config, and creates a complete native project session without a model request', async t => {
  const host = await startTestHost(); t.after(() => host.close());
  const health = await (await host.request('/api/health')).json();
  assert.equal(health.sdkVersion, '1.4.0'); assert.equal(health.transportVersion, '8.12.2'); assert.equal(health.chatMode, 'live');
  assert.deepEqual(await (await host.request('/api/configuration')).json(), { configuration: null });
  const saved = await host.request('/api/configuration', 'PUT', { name: '测试配置', provider: 'openai-compatible', baseUrl: 'http://127.0.0.1:1/v1', model: 'synthetic-model', apiKey: '!literal-test-key' });
  assert.equal(saved.status, 200);
  const publicText = await saved.text(); assert.ok(!publicText.includes('!literal-test-key'));
  const created = await host.request('/api/projects', 'POST', { name: 'synthetic-project' });
  assert.equal(created.status, 201, await created.clone().text());
  const { project } = await created.json();
  assert.deepEqual(project.tasks, []);
  const taskCreated = await host.request(`/api/projects/${project.id}/tasks`, 'POST', { name: 'synthetic-task' }); assert.equal(taskCreated.status, 201);
  const { task } = await taskCreated.json();
  const read = await host.request(`/api/projects/${project.id}/tasks/${task.id}/open`, 'POST', {});
  assert.equal(read.status, 200, await read.clone().text());
  const { snapshot } = await read.json();
  for (const tool of ['read', 'bash', 'write', 'edit', 'ls', 'find', 'grep', 'codemode', 'tool_search']) assert.ok(snapshot.tools.includes(tool));
  assert.equal(project.configuration.model, 'synthetic-model');
  assert.equal((await host.request('/api/configuration', 'DELETE')).status, 200);
  assert.equal((await (await host.request('/api/configuration')).json()).configuration.hasApiKey, false);
  assert.equal((await host.request(`/api/projects/${project.id}/tasks/${task.id}`)).status, 200, 'clearing credentials preserves readable saved history');
  assert.ok(!JSON.stringify(host.output()).includes('!literal-test-key'));
});

test('CFG-02: localhost HTTP rejects cross-origin, missing client headers, wrong content and oversized requests', async t => {
  const host = await startTestHost(); t.after(() => host.close());
  assert.equal((await fetch(host.baseUrl + '/api/configuration', { headers: { ...host.headers, origin: 'https://untrusted.example.invalid' } })).status, 403);
  assert.equal((await fetch(host.baseUrl + '/api/configuration')).status, 403);
  assert.equal((await fetch(host.baseUrl + '/api/configuration', { method: 'PUT', headers: { 'x-optracall-client': '1', 'content-type': 'application/json' }, body: '{}' })).status, 403);
  assert.equal((await fetch(host.baseUrl + '/api/configuration', { method: 'PUT', headers: { ...host.headers, 'content-type': 'text/plain' }, body: '{}' })).status, 415);
  assert.equal((await fetch(host.baseUrl + '/api/configuration', { method: 'PUT', headers: host.headers, body: '{invalid' })).status, 400);
  assert.equal((await host.request('/api/configuration', 'PUT', { value: 'x'.repeat(70_000) })).status, 413);
  assert.equal((await host.request('/api/connection-test', 'POST', { revision: 1, text: 'must not be sent' })).status, 400);
  assert.equal((await host.request('/api/connection-test', 'POST', { revision: 1 })).status, 409);
});

test('CFG-04: restarting Host restores masked configuration from the same independent data root', async t => {
  const first = await startTestHost(); t.after(() => first.close());
  await first.request('/api/configuration', 'PUT', { name: '持久配置', provider: 'openai-compatible', baseUrl: 'http://127.0.0.1:1/v1', model: 'synthetic-model', apiKey: 'synthetic-restart-key' });
  await first.close();
  const second = await startTestHost({ dataRoot: first.dataRoot, projectsRoot: first.projectsRoot }); t.after(() => second.close());
  const restored = await (await second.request('/api/configuration')).json();
  assert.equal(restored.configuration.name, '持久配置'); assert.equal(restored.configuration.hasApiKey, true);
  assert.ok(!JSON.stringify(restored).includes('synthetic-restart-key'));
  assert.ok(!JSON.stringify(first.output()).includes('synthetic-restart-key'));
});
