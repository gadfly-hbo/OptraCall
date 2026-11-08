import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { startS4GraphHost } from './fixtures/s4-host-graph.ts';
import { readJson } from './fixtures/joint-context.ts';
import { providerMessageText } from './fixtures/tool-provider.ts';
import type { SemanticGraphResult } from '../extensions/business-plugins/semantic-context/graph.ts';

const fixtureRoot = process.env.OPTRACALL_S4_FIXTURE, python = process.env.OPTRACALL_S4_PYTHON;
const skip = !fixtureRoot || !python ? 'NOT_RUN: explicit isolated S3 fixture and pinned S2 Python required' : false;
function graphTool(messages: { content?: unknown }[]): SemanticGraphResult | undefined {
  for (const message of [...messages].reverse()) { try { const result = JSON.parse(providerMessageText(message.content)); if (result.type === 'optracall.semantic-graph-result') return result; } catch {} }
  return undefined;
}

for (const managed of [false, true]) test(`S4A01/09 HTTP ${managed ? 'managed' : 'unmanaged'} full Host to Pi to Python to native Store authority and passive history`, { skip, timeout: 120_000 }, async t => {
  const f = await startS4GraphHost({ fixtureRoot: fixtureRoot!, python: python!, managed }); t.after(() => f.close()); t.diagnostic(`retained synthetic root: ${f.root}`);
  if (managed) {
    const capability = await readJson(await f.request(f.automaticRoute + '/capabilities'));
    if (!capability.supported) { t.skip(`NOT_RUN: ${capability.reason ?? 'managed execution unavailable'}`); return; }
    await readJson(await f.request(f.automaticRoute + '/settings', 'PUT', { expectedRevision: 0, settings: { enabled: true, question: 'Synthetic optional verification remains enabled.', dataFiles: ['020_clean/input.json'], processFiles: [], reportPath: '060_reports/s4-not-produced.md', maxAuthorTurns: 1 } }));
  }
  f.provider.setResponder(() => ({ text: 'S4_PRIOR_NATIVE_HISTORY_MUST_REMAIN_UNCHANGED' }));
  const priorState = await f.settled(await f.send('Synthetic earlier ordinary task history.'));
  const priorHistory = await readFile(priorState.task.sessionFile, 'utf8'), priorRequests = f.provider.requests.length;
  const delivered: SemanticGraphResult[] = [];
  f.provider.setResponder(({ requestNumber: absoluteRequestNumber, recentToolResults }) => {
    const requestNumber = absoluteRequestNumber - priorRequests;
    if (requestNumber === 1) return { calls: [{ name: 'read_semantic_context', arguments: { action: 'graph', operation: 'definition', nodeId: f.build.keys.C04 } }] };
    const result = graphTool(recentToolResults);
    if (result && !delivered.some(previous => previous.operation === result.operation)) delivered.push(result);
    if (requestNumber === 2) return { calls: [{ name: 'read_semantic_context', arguments: { action: 'graph', operation: 'impact', nodeId: f.build.keys['field-orders.gross_amount_yuan'], depth: 4 } }] };
    if (requestNumber === 3) {
      const sourceHandle = delivered[0]?.nodes[0]?.metadata.sourceRefs[0]?.sourceHandle;
      return sourceHandle ? { calls: [{ name: 'read_semantic_context', arguments: { action: 'graph', operation: 'source', sourceHandle } }] } : { text: 'Synthetic graph unavailable; preserve the tool failure.' };
    }
    if (requestNumber === 4) return { calls: [{ name: 'bash', arguments: { command: "python3 -c 'print(6 * 7)'" } }] };
    return { text: 'Synthetic final: graph definitions and conditions supplied; independent native Python calculation returned 42.' };
  });
  const requestId = await f.send('Synthetic S4 graph query and ordinary Python continuation through the original project task.');
  const state = await f.settled(requestId);
  assert.equal(state.task.lastRun.status, 'completed');
  assert.equal(f.provider.requests.length - priorRequests, 5, 'only three requested graph calls, the original Python tool and final answer create model continuations');
  assert.ok(delivered.length >= 3, 'actual next model requests must receive definition, impact and source graph JSON');
  const definition = delivered.find(result => result.operation === 'definition')!; assert.equal(definition.snapshot!.id, f.build.snapshotId); assert.equal(definition.nodes.length, 1); assert.equal(definition.nodes[0]!.id, f.build.keys.C04); assert.match(definition.nodes[0]!.content, /net_retail_sales/);
  const impact = delivered.find(result => result.operation === 'impact')!; assert.ok(impact.paths.length > 0); assert.ok(impact.nodes.some(node => node.id === f.build.keys.method));
  const source = delivered.find(result => result.operation === 'source')!; assert.ok(source.sources[0]?.body); assert.match(source.sources[0]!.body!, /net_retail_sales/);
  const graphText = JSON.stringify(delivered); assert.match(graphText, /synthetic-assumption|required-not-established|unknown|limitations/); assert.doesNotMatch(graphText, /synthetic_net_controls|"orders":\[|"refunds":\[|originalPath|\/Users\//);
  assert.ok(delivered.every(result => Buffer.byteLength(JSON.stringify(result), 'utf8') <= 24 * 1024)); assert.ok(f.bindings.every(owner => owner.projectId === f.projectId && owner.taskId === f.task.id));
  assert.ok(f.provider.requests.some(request => request.body.messages?.some(message => message.role === 'tool' && /42/.test(providerMessageText(message.content)))));
  const before = await readFile(state.task.sessionFile, 'utf8');
  assert.ok(before.startsWith(priorHistory), 'new actual SDK work only appends; earlier native history bytes remain unchanged');
  const saved = before.trim().split('\n').map(line => JSON.parse(line)); const tools = saved.filter(entry => entry.message?.role === 'toolResult' && entry.message.toolName === 'read_semantic_context');
  assert.equal(tools.length, 3); assert.ok(tools.every(entry => entry.message.details.type === 'optracall.semantic-graph-result')); assert.ok(tools.every(entry => JSON.parse(entry.message.content[0].text).snapshot.id === f.build.snapshotId));
  const requests = f.provider.requests.length, bindings = f.bindings.length;
  for (let i = 0; i < 2; i++) await readJson(await f.request(f.taskRoute));
  assert.equal(f.provider.requests.length, requests); assert.equal(f.bindings.length, bindings, 'passive GET cannot create a graph job or invoke the binding'); assert.equal(await readFile(state.task.sessionFile, 'utf8'), before);
  if (managed) assert.equal((await readJson(await f.request(f.automaticRoute + '/settings'))).settings.enabled, true);
  await f.restart();
  const restored = await readJson(await f.request(f.taskRoute)); assert.match(JSON.stringify(restored.snapshot.messages), /optracall.semantic-graph-result/);
  assert.equal(f.provider.requests.length, requests); assert.equal(f.bindings.length, bindings); assert.equal(await readFile(state.task.sessionFile, 'utf8'), before, 'passive Host restart reads exact original history without model or Python query work');
});

test('S4A04 HTTP current enterprise disable and confirmed method issue revoke captured graph source handles within the actual SDK run', { skip, timeout: 120_000 }, async t => {
  for (const governance of ['enterprise-disable', 'method-confirmed'] as const) await t.test(governance, async t => {
    const f = await startS4GraphHost({ fixtureRoot: fixtureRoot!, python: python! }); t.after(() => f.close()); t.diagnostic(`retained synthetic root: ${f.root}`);
    const nodeId = governance === 'enterprise-disable' ? f.build.keys.enterprise : f.build.keys.method;
    let original: SemanticGraphResult | undefined, rejectedSource = '', after: SemanticGraphResult | undefined;
    f.provider.setResponder(async ({ requestNumber, recentToolResults }) => {
      if (requestNumber === 1) return { calls: [{ name: 'read_semantic_context', arguments: { action: 'graph', operation: 'definition', nodeId } }] };
      if (requestNumber === 2) {
        original = graphTool(recentToolResults);
        const sourceHandle = original?.nodes[0]?.metadata.sourceRefs.find(ref => ref.kind === (governance === 'enterprise-disable' ? 'enterprise' : 'sap-method'))?.sourceHandle;
        if (!sourceHandle) return { text: 'Synthetic graph source unavailable; preserve original failure.' };
        if (governance === 'enterprise-disable') {
          const current = await readJson(await f.request(`/api/enterprise-materials/${f.build.refs.enterprise.materialId}`));
          await readJson(await f.request(`/api/enterprise-materials/${f.build.refs.enterprise.materialId}/disable`, 'POST', { expectedVersion: current.material.version }));
        } else await readJson(await f.request(`/api/sap/methods/${f.build.refs.method.methodId}/issues`, 'POST', { requestId: randomUUID(), version: 1, expectedRevision: 0, status: 'confirmed', note: 'Synthetic S4 governance test; historical method bytes remain.' }));
        return { calls: [{ name: 'read_semantic_context', arguments: { action: 'graph', operation: 'source', sourceHandle } }] };
      }
      if (requestNumber === 3) { rejectedSource = providerMessageText(recentToolResults.at(-1)?.content); return { calls: [{ name: 'read_semantic_context', arguments: { action: 'graph', operation: 'definition', nodeId } }] }; }
      after = graphTool(recentToolResults); return { text: 'Synthetic current source withdrawn; affected judgment remains unknown.' };
    });
    const state = await f.settled(await f.send('Synthetic same-run source withdrawal through actual Host and SDK.'));
    assert.equal(state.task.lastRun.status, 'completed'); assert.equal(original?.nodes.length, 1, 'original currently qualified source must actually reach the model before withdrawal');
    assert.equal(rejectedSource, 'semantic_graph_source_handle_unavailable'); assert.doesNotMatch(rejectedSource, /"logic"|"judgment"|net_retail_sales/);
    assert.ok(after); assert.equal(after.nodes.length, 0); assert.equal(after.edges.length, 0); assert.equal(after.paths.length, 0);
    const persisted = await readFile(state.task.sessionFile, 'utf8'); assert.match(persisted, /optracall.semantic-graph-result/); assert.match(persisted, /semantic_graph_source_handle_unavailable/);
  });
});

test('S4A03 HTTP current-run source metadata stays narrow and old handles cannot be replayed by another task or run', { skip, timeout: 120_000 }, async t => {
  const f = await startS4GraphHost({ fixtureRoot: fixtureRoot!, python: python! }); t.after(() => f.close()); t.diagnostic(`retained synthetic root: ${f.root}`);
  let handle = '', metadata = '', oldReplay = '', forgedPath = '';
  f.provider.setResponder(({ requestNumber, recentToolResults }) => {
    if (requestNumber === 1) return { calls: [{ name: 'read_semantic_context', arguments: { action: 'graph', operation: 'definition', nodeId: f.build.keys.input } }] };
    if (requestNumber === 2) { handle = graphTool(recentToolResults)?.nodes[0]?.metadata.sourceRefs.find(ref => ref.kind === 'data-input')?.sourceHandle ?? ''; return handle ? { calls: [{ name: 'read_semantic_context', arguments: { action: 'graph', operation: 'source', sourceHandle: handle } }] } : { text: 'Synthetic input metadata not available.' }; }
    if (requestNumber === 3) { metadata = providerMessageText(recentToolResults.at(-1)?.content); return { text: 'Synthetic input metadata received without transaction bodies.' }; }
    if (requestNumber === 4 || requestNumber === 6) return { calls: [{ name: 'read_semantic_context', arguments: { action: 'graph', operation: 'source', sourceHandle: handle } }] };
    if (requestNumber === 5) { oldReplay = providerMessageText(recentToolResults.at(-1)?.content); return { text: 'Synthetic old run handle refused.' }; }
    if (requestNumber === 7) { oldReplay += providerMessageText(recentToolResults.at(-1)?.content); return { calls: [{ name: 'read_semantic_context', arguments: { action: 'graph', operation: 'source', sourceHandle: handle, sourceRoot: '/unapproved', projectId: f.projectId } }] }; }
    forgedPath = providerMessageText(recentToolResults.at(-1)?.content); return { text: 'Synthetic other task and forged path refused.' };
  });
  await f.settled(await f.send('Synthetic fixed input source metadata.')); assert.ok(handle); assert.match(metadata, /fixed-input-metadata/); assert.doesNotMatch(metadata, /synthetic_net_controls|"orders"|"refunds"|originalPath|\/Users\//);
  const body = JSON.parse(JSON.parse(metadata).sources[0].body);
  assert.deepEqual(Object.keys(body).sort(), ['kind', 'projectId', 'datasetId', 'inputVersionId', 'sha256', 'bytes'].sort(), 'fixed-input source returns exact metadata fields and no transaction/control body');
  await f.settled(await f.send('Synthetic explicit new run attempts an old source handle.'));
  assert.match(oldReplay, /semantic_graph_invalid_continuation/);
  const { task } = await readJson(await f.request(`/api/projects/${f.projectId}/tasks`, 'POST', { name: 'S4 other task rejects old handles', configurationId: f.task.configuration.id }), 201);
  const otherRoute = `/api/projects/${f.projectId}/tasks/${task.id}`, requestId = randomUUID();
  await readJson(await f.request(otherRoute + '/messages', 'POST', { text: 'Synthetic other owner attempts old source handle and forged source path.', requestId }), 202);
  const deadline = Date.now() + 30_000;
  for (;;) { const state = await readJson(await f.request(otherRoute)); if (state.task.lastRun?.id === requestId && state.snapshot.status === 'idle') { assert.equal(state.task.lastRun.status, 'completed'); break; } assert.ok(Date.now() < deadline); await new Promise(resolve => setTimeout(resolve, 20)); }
  assert.match(oldReplay, /semantic_graph_invalid_continuation/); assert.match(forgedPath, /validation|Invalid|unexpected|additional|match|schema/i); assert.doesNotMatch(oldReplay + forgedPath, /fixed-input-metadata|synthetic_net_controls|"orders"|"refunds"/);
});

test('S4A08/10 HTTP without the graph binding preserves original L1 reads, rejects graph calls and continues native calculation', { skip, timeout: 60_000 }, async t => {
  const f = await startS4GraphHost({ fixtureRoot: fixtureRoot!, python: python!, graph: false }); t.after(() => f.close());
  let legacy = '', rejected = '';
  f.provider.setResponder(({ requestNumber, recentToolResults }) => {
    if (requestNumber === 1) return { calls: [{ name: 'read_semantic_context', arguments: { action: 'find', query: 'net_retail_sales', kinds: ['sap'] } }] };
    if (requestNumber === 2) { legacy = providerMessageText(recentToolResults.at(-1)?.content); return { calls: [{ name: 'read_semantic_context', arguments: { action: 'graph', operation: 'definition', nodeId: f.build.keys.C04 } }] }; }
    if (requestNumber === 3) { rejected = providerMessageText(recentToolResults.at(-1)?.content); return { calls: [{ name: 'bash', arguments: { command: "python3 -c 'print(6 * 7)'" } }] }; }
    return { text: 'Synthetic original L1 and Python analysis completed without graph configuration.' };
  });
  const state = await f.settled(await f.send('Synthetic optional graph is not configured.'));
  assert.equal(state.task.lastRun.status, 'completed'); assert.match(legacy, /optracall.semantic-context-result/); assert.match(legacy, /net_retail_sales/); assert.doesNotMatch(legacy, /optracall.semantic-graph-result/);
  assert.match(rejected, /validation|Invalid|unexpected|additional|match|schema/i); assert.equal(f.bindings.length, 0);
  assert.ok(f.provider.requests.some(request => request.body.messages?.some(message => message.role === 'tool' && /42/.test(providerMessageText(message.content)))));
});
