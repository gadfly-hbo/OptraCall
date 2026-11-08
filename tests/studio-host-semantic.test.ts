import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, realpath, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { startTestHost } from './fixtures/host-process.ts';
import { startToolProvider, providerMessageText, type SyntheticToolCall, type ToolProviderContext } from './fixtures/tool-provider.ts';
const python = process.env.OPTRACALL_STUDIO_TEST_PYTHON;
const json = async (response: Response, status = 200): Promise<any> => { assert.equal(response.status, status, await response.clone().text()); return response.json(); };
const tool = (action: string, payload: Record<string, unknown> = {}): SyntheticToolCall => ({ name: 'studio_assets', arguments: { action, payload } });

/** Real official Python + public Pi SDK/Host wiring; local synthetic provider is not a model-quality evaluation. */
test('official Semantica candidates, explicit reviewed source publication and model-free graph are connected through the actual Host and original Pi task', { skip: !python, timeout: 180_000 }, async t => {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), 'studio-host-semantic-'))), provider = await startToolProvider();
  const host = await startTestHost({ dataRoot: path.join(root, 'host'), projectsRoot: path.join(root, 'projects'), studioPython: python!, timeoutMs: 15_000 });
  t.after(async () => { await host.close(); await provider.close(); await rm(root, { recursive: true, force: true }); });
  await json(await host.request('/api/configuration', 'PUT', { name: 'Official Semantica synthetic callback', provider: 'openai-compatible', baseUrl: provider.baseUrl, model: 'synthetic-semantic', apiKey: 'synthetic-semantic-only' }));
  const { project } = await json(await host.request('/api/projects', 'POST', { name: '官方组件合成接线' }), 201);
  await json(await host.request(`/api/projects/${project.id}/files/upload`, 'POST', { directory: '020_clean', name: 'policy.md', content: Buffer.from('成功退款归原销售门店。一个订单可以有多次成功退款。').toString('base64') }), 201);
  const material = (await json(await host.request(`/api/studio/materials?projectId=${project.id}`))).materials[0], ref = material.ref;
  const { system } = await json(await host.request('/api/studio/systems', 'POST', { requestId: randomUUID(), name: '官方语义合成体系', projectId: project.id, goal: '准确来源抽取与派生图接线', topicTitle: '销售退款', materials: [material] }), 201);
  const typedCalls: string[] = [];
  async function run(steps: SyntheticToolCall[], marker: string) {
    provider.setResponder((context: ToolProviderContext) => {
      if (!context.availableTools.includes('studio_assets')) {
        const prompt = providerMessageText([...context.messages].reverse().find(message => message.role === 'user')?.content), match = /Required JSON schema:\n([\s\S]*?)\nReturn exactly one JSON value/.exec(prompt);
        assert.ok(match, 'Official typed extraction must supply its original schema.'); const schema = JSON.parse(match[1]);
        if (schema.properties?.entities) { typedCalls.push('entities:typed'); return { text: JSON.stringify({ entities: [{ text: '退款', label: 'EVENT', confidence: 0.9 }, { text: '门店', label: 'ORG', confidence: 0.9 }] }) }; }
        assert.ok(schema.properties?.relations, JSON.stringify(schema)); typedCalls.push('relations:typed'); return { text: JSON.stringify({ relations: [{ subject: '退款', object: '门店', predicate: '归属', confidence: 0.9 }] }) };
      }
      const index = context.recentToolResults.length; return index < steps.length ? { calls: [steps[index].name === 'studio_assets' ? { ...steps[index], arguments: { ...steps[index].arguments, systemId: system.id } } : steps[index]] } : { text: marker };
    });
    const route = `/api/projects/${project.id}/tasks/${system.taskId}`;
    await json(await host.request(`${route}/messages`, 'POST', { requestId: randomUUID(), text: '按公开工具契约执行本轮合成工程检查，官方组件不替代业务审查。', studioContext: { systemId: system.id, purpose: 'construction' } }), 202);
    let state: any; const started = Date.now();
    do { state = await json(await host.request(route)); if (state.task.lastRun?.status === 'completed' && JSON.stringify(state.snapshot.messages).includes(marker)) break; if (['failed', 'cancelled'].includes(state.task.lastRun?.status)) break; await new Promise(resolve => setTimeout(resolve, 30)); } while (Date.now() - started < 90_000);
    assert.equal(state.task.lastRun?.status, 'completed', JSON.stringify(state)); assert.match(JSON.stringify(state.snapshot.messages), new RegExp(marker));
    const user = state.snapshot.messages.findLastIndex((message: any) => message.role === 'user'), results = state.snapshot.messages.slice(user + 1).filter((message: any) => message.role === 'toolResult');
    assert.equal(results.length, steps.length); assert.equal(results.some((message: any) => message.isError), false, JSON.stringify(results)); assert.deepEqual(provider.errors, []); return results;
  }
  const extractionTools = await run([tool('extract', { ref })], 'OFFICIAL_EXTRACTION_DONE'), extraction = extractionTools[0].details?.result;
  assert.ok(extraction?.candidateNeedsReview, JSON.stringify(extractionTools)); assert.equal(extraction.component.version, '0.7.0'); assert.deepEqual(typedCalls, ['entities:typed', 'relations:typed']);
  assert.deepEqual(extraction.calls.map((call: any) => `${call.kind}:${call.format}`), typedCalls); assert.deepEqual(extraction.failures, []); assert.equal(extraction.relations[0].predicate, '归属');
  assert.equal((await json(await host.request(`/api/studio/systems/${system.id}`))).system.assets.length, 0, 'Extraction candidates are not automatically saved or published as reviewed sources.');
  const structured = { entities: [{ key: 'refund', text: extraction.entities[0].text, label: extraction.entities[0].label }, { key: 'store', text: extraction.entities[1].text, label: extraction.entities[1].label }], relationships: [{ source: 'refund', target: 'store', predicate: extraction.relations[0].predicate }] };
  await run([tool('save-asset', { kind: 'ontology', title: '合成已审语义源', body: JSON.stringify(structured), scope: '合成资料原门店退款关系', sources: [ref], readyForPublication: true, extraction: { method: 'official semantica 0.7.0', sourceRefs: [ref], failures: [], fallbacks: [], reviewed: true }, checks: [{ name: '合成作者限定审查', status: 'pass', detail: '明确合成关系用于工程接线；真实业务和模型质量未验' }] })], 'OFFICIAL_REVIEWED_SOURCE_SAVED');
  const candidate = (await json(await host.request(`/api/studio/systems/${system.id}`))).system.assets[0]; assert.equal(candidate.formalRevision, null);
  const prepared = await json(await host.request(`/api/studio/systems/${system.id}/preview`, 'POST', { requestId: randomUUID(), assetIds: [candidate.id], refs: [], summary: '精确合成源', scope: '合成资料' }));
  await json(await host.request(`/api/studio/systems/${system.id}/publications`, 'POST', { requestId: randomUUID(), previewId: prepared.preview.id, fingerprint: prepared.preview.fingerprint }));
  const beforeGraphModelCalls = provider.requests.length, refreshed = await json(await host.request(`/api/studio/systems/${system.id}/graph-refresh`, 'POST', { requestId: randomUUID() }));
  assert.equal(provider.requests.length, beforeGraphModelCalls, 'Graph build uses structured sources and creates no model turn.');
  const graph = refreshed.system.graphs.findLast((value: any) => value.status === 'succeeded'); assert.ok(graph, JSON.stringify(refreshed));
  const receipt = JSON.parse(await readFile(path.join(host.dataRoot, 'studio-graphs', system.id, 'snapshots', graph.snapshotId, 'receipt.json'), 'utf8')); assert.equal(receipt.formatVersion, 2); assert.equal(receipt.component.version, '0.7.0');
  const graphTools = await run([{ name: 'read_semantic_context', arguments: { action: 'graph', operation: 'find', query: '退款' } }], 'OFFICIAL_GRAPH_SAME_TASK_READ');
  const graphResult = graphTools[0].details; assert.equal(graphResult?.snapshot?.id, graph.snapshotId, JSON.stringify(graphTools)); assert.ok(graphResult.nodes.some((node: any) => node.content === '退款'), JSON.stringify(graphTools)); assert.deepEqual(typedCalls, ['entities:typed', 'relations:typed']);
});
