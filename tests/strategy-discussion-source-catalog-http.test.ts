import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { startTestHost } from './fixtures/host-process.ts';
import { startToolProvider } from './fixtures/tool-provider.ts';

test('a real Host can list uploaded strategy background in a normal Project with no enterprise material directory', { timeout: 30000 }, async t => {
  const provider = await startToolProvider(), host = await startTestHost();
  t.after(async () => { await host.close(); await provider.close(); });
  const req = async (path: string, method = 'GET', body?: unknown, status = 200): Promise<any> => {
    const response = await host.request(path, method, body);
    assert.equal(response.status, status, await response.clone().text());
    return response.json();
  };
  await req('/api/configuration', 'PUT', { name: 'catalog-model', provider: 'openai-compatible', baseUrl: provider.baseUrl, model: 'synthetic-catalog', apiKey: 'synthetic-catalog-only' });
  const project = (await req('/api/projects', 'POST', { name: '无企业目录的普通项目' }, 201)).project;
  await req(`/api/projects/${project.id}/files/upload`, 'POST', { name: 'existing-background.md', directory: '020_clean', content: Buffer.from('CATALOG_METADATA_NOT_BODY').toString('base64') }, 201);
  const discussion = (await req('/api/strategy/discussions', 'POST', { operationId: randomUUID(), projectId: project.id }, 201)).discussion;
  const result = await req(`/api/strategy/discussions/${discussion.id}/sources`);
  assert.ok(result.sources.some((source: any) => source.title === 'existing-background.md' && source.target.kind === 'project-document'));
  assert.equal(JSON.stringify(result).includes('CATALOG_METADATA_NOT_BODY'), false);
  assert.equal(provider.requests.length, 0);
  t.diagnostic(host.scratch);
});
