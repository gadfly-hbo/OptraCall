import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { startTestHost } from './fixtures/host-process.ts';
import { startToolProvider, providerMessageText } from './fixtures/tool-provider.ts';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';

async function json(response: Response, status = 200): Promise<any> {
  assert.equal(response.status, status, await response.clone().text()); return response.json();
}

test('SU03/15/16: an ordinary real Pi task discovers native enterprise assets without Studio selection or global paths', { timeout: 45_000 }, async t => {
  const provider = await startToolProvider(); t.after(() => provider.close());
  const host = await startTestHost(); t.after(() => host.close());
  await json(await host.request('/api/configuration', 'PUT', { name: 'Scoped native SDK', provider: 'openai-compatible', baseUrl: provider.baseUrl, model: 'synthetic-studio-scope', apiKey: 'synthetic-only' }));
  const a = await json(await host.request('/api/studio/enterprises', 'POST', { name: '合成企业 A' }), 201);
  const b = await json(await host.request('/api/studio/enterprises', 'POST', { name: '合成企业 B' }), 201);
  const material = async (enterpriseId: string, body: string) => {
    const draft = await json(await host.request('/api/enterprise-materials', 'POST', { title: body, body }), 201);
    const active = await json(await host.request(`/api/enterprise-materials/${draft.material.id}/enable`, 'POST', { expectedVersion: draft.material.version }));
    await json(await host.request('/api/studio/enterprise-associations', 'POST', { kind: 'asset', authority: 'enterprise', entityId: active.material.id, enterpriseId }));
    return { authority: 'enterprise', id: active.material.id, version: active.material.activeRevisionId, locator: active.storeId, sha256: createHash('sha256').update(body).digest('hex') };
  };
  const aRef = await material(a.id, 'A企业本轮获准原文'), bRef = await material(b.id, 'B企业应被拒绝原文');
  const { project } = await json(await host.request('/api/projects', 'POST', { name: '普通分析项目' }), 201);
  await json(await host.request('/api/studio/enterprise-associations', 'POST', { kind: 'project', entityId: project.id, enterpriseId: a.id }));
  const { task } = await json(await host.request(`/api/projects/${project.id}/tasks`, 'POST', { name: '不手选资产的普通分析' }), 201);
  const calls = [
    { name: 'read_catalog', arguments: {} },
    { name: 'studio_assets', arguments: { action: 'catalog' } },
    { name: 'studio_assets', arguments: { action: 'read-source', payload: { ref: aRef } } },
    { name: 'studio_assets', arguments: { action: 'read-source', payload: { ref: bRef } } },
  ];
  provider.setResponder(context => context.recentToolResults.length < calls.length ? { calls: [calls[context.recentToolResults.length]!] } : { text: 'SCOPED_ORDINARY_TASK_DONE' });
  const route = `/api/projects/${project.id}/tasks/${task.id}`, requestId = randomUUID();
  await json(await host.request(`${route}/messages`, 'POST', { requestId, text: '请自主核对本企业的获准资料并解释依据。' }), 202);
  let value: any; const deadline = Date.now() + 25_000;
  do { value = await json(await host.request(route)); if (value.task.lastRun?.id === requestId && value.snapshot.status === 'idle') break; await new Promise(resolve => setTimeout(resolve, 20)); } while (Date.now() < deadline);
  assert.equal(value.task.lastRun?.status, 'completed');
  assert.deepEqual(provider.errors, []);
  const initialRequest = JSON.stringify(provider.requests[0]?.body);
  assert.ok(!initialRequest.includes('enterprise-business-materials/catalog.json'), 'The scoped Host must not inject the global catalog path.');
  assert.ok(!initialRequest.includes('B企业应被拒绝原文'));
  const fileCatalog = value.snapshot.messages.find((message: any) => message.role === 'toolResult' && message.toolName === 'read_catalog');
  assert.ok(fileCatalog && !fileCatalog.isError);
  assert.ok(!providerMessageText(fileCatalog.content).includes('B企业应被拒绝原文'), 'The existing catalog tool must use the same enterprise scope.');
  assert.ok(!providerMessageText(fileCatalog.content).includes('enterprise-business-materials/catalog.json'));
  const results = value.snapshot.messages.filter((message: any) => message.role === 'toolResult' && message.toolName === 'studio_assets');
  assert.equal(results.length, 3);
  assert.match(providerMessageText(results[0].content), new RegExp(aRef.id));
  assert.ok(!providerMessageText(results[0].content).includes(bRef.id));
  assert.match(providerMessageText(results[1].content), /A企业本轮获准原文/);
  assert.equal(results[1].isError, false);
  assert.equal(results[2].isError, true);
  assert.ok(!providerMessageText(results[2].content).includes('B企业应被拒绝原文'));
});

test('SU22: an unavailable optional enterprise directory limits asset use and preserves ordinary file analysis', { timeout: 45_000 }, async t => {
  const provider = await startToolProvider(); t.after(() => provider.close());
  const host = await startTestHost(); t.after(() => host.close());
  await json(await host.request('/api/configuration', 'PUT', { name: 'Limited scope', provider: 'openai-compatible', baseUrl: provider.baseUrl, model: 'synthetic-limited-scope', apiKey: 'synthetic-only' }));
  const enterprise = await json(await host.request('/api/studio/enterprises', 'POST', { name: 'Limited enterprise' }), 201);
  const { project } = await json(await host.request('/api/projects', 'POST', { name: 'Independent original analysis', enterpriseId: enterprise.id }), 201);
  const { task } = await json(await host.request(`/api/projects/${project.id}/tasks`, 'POST', { name: 'Optional directory unavailable' }), 201);
  await writeFile(path.join(project.rootPath, '020_clean', 'values.csv'), 'amount\n17\n25\n');
  const libraryRoot = path.join(host.dataRoot, 'metric-assets'); await mkdir(libraryRoot, { recursive: true });
  await writeFile(path.join(libraryRoot, 'index.json'), '{unavailable-index');
  const program = `python3 - <<'LIMITED_ANALYSIS'\nimport csv\nfrom pathlib import Path\nroot=Path(${JSON.stringify(project.rootPath)})\nwith (root/'020_clean'/'values.csv').open() as source: total=sum(int(row['amount']) for row in csv.DictReader(source))\n(root/'060_reports'/'limited.txt').write_text(str(total))\nprint(total)\nLIMITED_ANALYSIS`;
  provider.setResponder(context => context.recentToolResults.length ? { text: '原获准数据合计42；企业目录不可用，本次未借用企业标准，仅限临时计算依据。' } : { calls: [{ name: 'bash', arguments: { command: program } }] });
  const route = `/api/projects/${project.id}/tasks/${task.id}`, requestId = randomUUID();
  await json(await host.request(`${route}/messages`, 'POST', { requestId, text: '企业资产若不可用，请限定依据，仅对本项目获准CSV做普通合计。' }), 202);
  let state: any; const deadline = Date.now() + 25_000;
  do { state = await json(await host.request(route)); if (state.task.lastRun?.id === requestId && state.snapshot.status === 'idle') break; await new Promise(resolve => setTimeout(resolve, 20)); } while (Date.now() < deadline);
  assert.equal(state.task.lastRun?.status, 'completed');
  assert.equal(await readFile(path.join(project.rootPath, '060_reports', 'limited.txt'), 'utf8'), '42');
  const prompt = JSON.stringify(provider.requests[0]?.body);
  assert.match(prompt, /目录.*不可用/); assert.ok(!prompt.includes('enterprise-business-materials/catalog.json'));
  assert.deepEqual(provider.errors, []);
});
