import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { parseSapDraft } from '../extensions/business-plugins/metric-factory/sap/validate.ts';
import { prepareSemanticTrialAssets, type TrialAssetOptions, type TrialSemantics } from '../src/host/semantic-trial-assets.ts';
import { startSemanticTrialHost } from '../src/host/semantic-trial-host.ts';
import { startToolProvider, providerMessageText } from './fixtures/tool-provider.ts';
import { readJson } from './fixtures/joint-context.ts';
import type { SemanticGraphResult } from '../extensions/business-plugins/semantic-context/graph.ts';

const testRoot = process.env.OPTRACALL_S5R_TEST_ROOT;
const publicFixture = process.env.OPTRACALL_S4_FIXTURE;
const python = process.env.OPTRACALL_S4_PYTHON;
const skip = !testRoot || !publicFixture || !python ? 'NOT_RUN: isolated S5R root, public fixture and pinned Python required' : false;
const digest = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const json = (value: unknown) => Buffer.from(JSON.stringify(value, null, 2) + '\n');

async function fixture(t: { after(fn: () => Promise<void>): void; diagnostic(message: string): void }) {
  assert.ok(testRoot && publicFixture && python);
  const root = await fs.mkdtemp(path.join(await fs.realpath(testRoot), 'source-boundary-'));
  t.diagnostic(`retained public synthetic source fixture: ${root}`);
  const sourcesRoot = path.join(root, 'sources'); await fs.mkdir(sourcesRoot);
  const old = JSON.parse(await fs.readFile(path.join(publicFixture, 'evidence/scene-v2-corrected-build.json'), 'utf8'));
  const oldSap = old.refs.metrics[0];
  const originalSap = parseSapDraft(await fs.readFile(path.join(publicFixture, 'asset-root/metric-assets', oldSap.packageId, oldSap.version + '.sap.yaml')));
  const sap = { ...originalSap, package: { ...originalSap.package, id: 's5r-source-boundary', namespace: 'mf.s5r-source-boundary', fingerprint: '' } };
  const input = {
    periods: { previous: '2026-01', current: '2026-02' },
    conditions: { refund_observation_days: 'unknown', currency_and_tax_comparability: 'unknown', source_note: 'S5R_PUBLIC_CONDITIONS_ONLY' },
    orders: [{ order_id: 'S5R_RAW_ORDER_MUST_NOT_LEAK', payment_time: '2026-02-01T12:00:00+08:00', gross_amount_yuan: 137 }],
    refunds: [{ order_id: 'S5R_RAW_ORDER_MUST_NOT_LEAK', refund_time: '2026-02-03T12:00:00+08:00', refund_amount_yuan: 19 }],
  };
  const semantics: TrialSemantics = {
    enterprise: { title: 'S5R public synthetic semantics', category: 'Synthetic engineering', body: 'Input conditions remain source declarations; unknown is not confirmed.', source: 'Approved deidentified metric excerpt and public synthetic data', owner: 'Synthetic engineering', scope: 'S5R public source boundary only', effectiveTime: 'Unknown unless explicitly stated' },
    fieldRules: [{ pointerPattern: '/orders/*/gross_amount_yuan', meaning: 'Gross amount input only after comparability checks.', metricNames: ['terminal_sales_amount'], unit: 'yuan if declared comparable' }, { pointerPattern: '/refunds/*/refund_amount_yuan', meaning: 'Positive refund event amount; observation conditions remain unknown.', metricNames: ['retail_refund_amount'], unit: 'yuan if declared comparable' }],
    statements: [{ scope: 'source-and-limitations', text: 'Synthetic engineering mapping is not business confirmation.' }],
  };
  const values = { analysisInput: json(input), sapPackage: json(sap), method: json({ origin: 'other', title: 'S5R same-basis amount review', content: { conditions: 'Check actual input conditions; unknown stays unknown.', logic: 'Compare gross and refund amounts only under matching basis.', judgment: 'Amount identity does not establish business causes.', limits: 'Public synthetic engineering fixture only.' } }), metricExcerpt: await fs.readFile(path.resolve('openspec/changes/fourbase-l2-rollout/data/metric-candidates.v0.1.json')), semantics: json(semantics) };
  const sources = {} as TrialAssetOptions['sources'];
  for (const key of Object.keys(values) as (keyof typeof values)[]) { const file = path.join(sourcesRoot, key + '.json'); await fs.writeFile(file, values[key], { flag: 'wx' }); sources[key] = { path: file, sha256: digest(values[key]) }; }
  const dataRoot = path.join(root, 'stores'), projectsRoot = path.join(root, 'projects');
  const assets = await prepareSemanticTrialAssets({ dataRoot, projectsRoot, projectName: 'S5R public source boundary', configuration: { id: randomUUID(), revision: 1, provider: 'openai-compatible', model: 'synthetic-s5r-source', name: 'Synthetic source fixture only', baseUrl: 'http://127.0.0.1:9/v1' }, publishedBy: 'S5R public fixture', sources });
  const runRoot = path.join(root, 'derived'); for (const child of ['inputs', 'evidence', 'tmp']) await fs.mkdir(path.join(runRoot, child), { recursive: true });
  const buildInput = { runRoot, codeRoot: process.cwd(), root, dataRoot, projectsRoot, refs: assets.refs, inputPath: assets.analysisInput.path, excerptPath: sources.metricExcerpt.path };
  const script = `import sys,json,hashlib\nfrom pathlib import Path\nsys.path.insert(0,str(Path.cwd()/'scripts'))\nfrom fourbase_l2.build_sc01s import build_scene\na=json.load(sys.stdin)\nraw=Path(a['inputPath']).read_bytes(); excerpt=Path(a['excerptPath']).read_bytes()\nb=build_scene(Path(a['runRoot']),Path(a['codeRoot']),label='s5r-public-source',approved_run_root=Path(a['root']),source_root=Path(a['codeRoot']),data_root=Path(a['dataRoot']),projects_root=Path(a['projectsRoot']),refs=a['refs'],metric_excerpt_bytes=excerpt,metric_excerpt_sha256=hashlib.sha256(excerpt).hexdigest(),analysis_input_bytes=raw,analysis_input_sha256=hashlib.sha256(raw).hexdigest())\nprint(json.dumps(b))`;
  const built = spawnSync(python, ['-c', script], { input: JSON.stringify(buildInput), encoding: 'utf8', timeout: 60_000, maxBuffer: 4 * 1024 * 1024 });
  await fs.writeFile(path.join(root, 'builder-stdout.txt'), built.stdout); await fs.writeFile(path.join(root, 'builder-stderr.txt'), built.stderr);
  assert.equal(built.status, 0, `original builder failed: ${built.error?.message ?? built.stderr}`);
  const build = JSON.parse(built.stdout), provider = await startToolProvider();
  const host = await startSemanticTrialHost({ codeRoot: process.cwd(), dataRoot, projectsRoot, instanceId: randomUUID(), uiPort: 4183, transportVersion: '8.12.2', graphBinding: { runRoot, snapshotId: build.snapshotId, python, codeRoot: process.cwd() } });
  let finalState: unknown;
  t.after(async () => { const shutdown = await Promise.allSettled([host.close(), provider.close()]); await fs.writeFile(path.join(root, 'host-receipt.json'), JSON.stringify({ scope: 'PUBLIC_SYNTHETIC_LOCAL_PROVIDER_ONLY', build, requests: provider.requests, errors: provider.errors, finalState, shutdown: shutdown.map(result => result.status) }, null, 2)); for (const result of shutdown) if (result.status === 'rejected') throw result.reason; });
  const { configuration } = await readJson(await host.request('/api/configuration', 'PUT', { name: 'S5R local synthetic source boundary', provider: 'openai-compatible', baseUrl: provider.baseUrl, model: 'synthetic-s5r-source', apiKey: 'synthetic-s5r-source-only' }));
  const task = await host.createTask(assets.project.id, { name: 'S5R original Host source boundary', configurationId: configuration.id });
  const taskRoute = `/api/projects/${assets.project.id}/tasks/${task.id}`;
  const send = async () => {
    const requestId = randomUUID(); await readJson(await host.request(taskRoute + '/messages', 'POST', { text: 'Public synthetic graph source boundary engineering test.', requestId }), 202);
    const deadline = Date.now() + 60_000;
    for (;;) { const state = await readJson(await host.request(taskRoute)); if (state.task.lastRun?.id === requestId && state.task.lastRun.status !== 'running' && state.snapshot.status === 'idle') { finalState = state; return state; } assert.ok(Date.now() < deadline, `Host task did not settle: ${JSON.stringify(state.task.lastRun)}`); await new Promise(resolve => setTimeout(resolve, 20)); }
  };
  return { root, assets, build, provider, send, input };
}

function latestGraph(messages: { content?: unknown }[]): SemanticGraphResult | undefined {
  for (const message of [...messages].reverse()) { try { const value = JSON.parse(providerMessageText(message.content)); if (value.type === 'optracall.semantic-graph-result') return value; } catch {} }
  return undefined;
}

test('S5R original builder and Host source handle return exactly declared /conditions without transaction bodies', { skip, timeout: 120_000 }, async t => {
  const f = await fixture(t); let definition: SemanticGraphResult | undefined, source: SemanticGraphResult | undefined, sourceText = '';
  f.provider.setResponder(({ requestNumber, recentToolResults }) => {
    if (requestNumber === 1) return { calls: [{ name: 'read_semantic_context', arguments: { action: 'graph', operation: 'definition', nodeId: f.build.keys['sample-condition:source_note'] } }] };
    if (requestNumber === 2) { definition = latestGraph(recentToolResults); const sourceHandle = definition?.nodes[0]?.metadata.buildSources.find(value => value.inputKey === 'synthetic-input' && value.locator === '/conditions')?.sourceHandle; return sourceHandle ? { calls: [{ name: 'read_semantic_context', arguments: { action: 'graph', operation: 'source', sourceHandle } }] } : { text: 'Public synthetic conditions source missing; preserve failure.' }; }
    source = latestGraph(recentToolResults); sourceText = providerMessageText(recentToolResults.at(-1)?.content); return { text: 'Public synthetic source probe complete.' };
  });
  const state = await f.send(); assert.equal(state.task.lastRun.status, 'completed');
  assert.equal(definition?.nodes[0]?.metadata.buildSources.find(value => value.locator === '/conditions')?.inputKey, 'synthetic-input', 'the original builder must actually declare this exact semantic fragment');
  assert.ok(source?.sources[0]?.body, `declared conditions must be readable through the original Host source operation: ${sourceText}`);
  assert.deepEqual(JSON.parse(source.sources[0].body), f.input.conditions);
  assert.deepEqual(source.sources[0].gaps, ['semantic-fragment-not-full-original-record']);
  assert.doesNotMatch(sourceText, /S5R_RAW_ORDER_MUST_NOT_LEAK|"orders"\s*:|"refunds"\s*:|\/Users\/|\/private\//);
});

test('S5R original Host source details preserve the actual native qualification warning behind source-validation-gap', { skip, timeout: 120_000 }, async t => {
  const f = await fixture(t), warning = 'binding-grain-keys-units-timezones-not-automatically-verified';
  let original: any, definition: SemanticGraphResult | undefined, source: SemanticGraphResult | undefined;
  f.provider.setResponder(({ requestNumber, recentToolResults }) => {
    if (requestNumber === 1) return { calls: [{ name: 'read_semantic_context', arguments: { action: 'read', target: f.assets.refs.description } }] };
    if (requestNumber === 2) { original = JSON.parse(providerMessageText(recentToolResults.at(-1)?.content)); return { calls: [{ name: 'read_semantic_context', arguments: { action: 'graph', operation: 'definition', nodeId: f.build.keys.description } }] }; }
    if (requestNumber === 3) { definition = latestGraph(recentToolResults); const sourceHandle = definition?.nodes[0]?.metadata.sourceRefs.find(value => value.kind === 'data-description')?.sourceHandle; return sourceHandle ? { calls: [{ name: 'read_semantic_context', arguments: { action: 'graph', operation: 'source', sourceHandle } }] } : { text: 'Public synthetic native source missing; preserve failure.' }; }
    source = latestGraph(recentToolResults); return { text: 'Public synthetic source warning probe complete.' };
  });
  const state = await f.send(); assert.equal(state.task.lastRun.status, 'completed');
  assert.ok(original?.items?.[0]?.gaps.includes(warning), 'the warning must first be observed from the original Store reader');
  assert.ok(definition?.coverage.gaps.includes('source-validation-gap'), 'qualification warning remains in the graph aggregate');
  assert.ok(source?.sources[0]?.body, 'the exact qualified semantic source remains readable');
  assert.ok(source.sources[0].gaps.includes(warning), 'source details must retain the actual original qualification warning');
  assert.ok(source.sources[0].gaps.includes('semantic-fragment-not-full-original-record'));
  assert.ok(source.coverage.gaps.includes('source-validation-gap'), 'source readability must not clear the qualification warning or claim readiness');
  const body = JSON.parse(source.sources[0].body); assert.equal(JSON.parse(original.items[0].body).observation.coverage, 'unobserved'); assert.ok(body.mappings.every((mapping: any) => mapping.confirmed === false));
  assert.doesNotMatch(JSON.stringify(source), /S5R_RAW_ORDER_MUST_NOT_LEAK|\/Users\/|\/private\//);
});
