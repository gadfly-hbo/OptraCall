import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { parseSapDraft } from '../extensions/business-plugins/metric-factory/sap/validate.ts';
import { createMetricLibrary } from '../extensions/business-plugins/metric-factory/library/store.ts';
import { createProjectEnablement } from '../extensions/business-plugins/metric-factory/project/enablement.ts';
import { createSapMethodStore } from '../extensions/business-plugins/metric-factory/methods/store.ts';
import { EnterpriseMaterialsStore } from '../src/host/enterprise-materials-store.ts';
import { ProjectStore } from '../src/host/project-store.ts';
import { ProjectDataContextStore } from '../src/host/project-data-context-store.ts';
import { prepareSemanticTrialAssets, type TrialAssetOptions, type TrialSemantics } from '../src/host/semantic-trial-assets.ts';
import { startSemanticTrialHost } from '../src/host/semantic-trial-host.ts';

const runtimeRoot = process.env.OPTRACALL_S5_TEST_ROOT;
const skip = !runtimeRoot ? 'NOT_RUN: explicit isolated S5 test root required' : false;
const digest = (value: Buffer | string) => createHash('sha256').update(value).digest('hex');
const originalDirectory = path.resolve('openspec/changes/fourbase-l2-rollout/data');
// The fixture resets the publication fingerprint below. The reviewed public
// draft has identical remaining fields and does not depend on an old .local run.
const openSap = path.resolve('openspec/changes/fourbase-l2-rollout/assets/sc01s-core.sap.json');
async function fixture() {
  assert.ok(runtimeRoot && path.isAbsolute(runtimeRoot));
  const root = await fs.mkdtemp(path.join(runtimeRoot, 'asset-chain-'));
  const sourceRoot = path.join(root, 'sources'); await fs.mkdir(sourceRoot);
  const originalBytes = await fs.readFile(path.join(originalDirectory, 'sc01-synthetic-v0.1/input.json'));
  const input = JSON.parse(originalBytes.toString('utf8'));
  input.extra_conditions = { amount_tax_basis: 'unknown', refund_observation_maturity: 'unknown', 'literal/slash~key': null };
  // Engineering-only applicability version: no fixed old sample conditions are
  // inserted by the helper. The original business meanings remain explicit.
  const oldSap = parseSapDraft(await fs.readFile(openSap));
  const definitions = {
    terminal_sales_amount: '范围内店铺退款前销售额，按订单支付时间统计。具体范围、币种、单位、税及可加总粒度须从本次输入核对，未知则保留未知。',
    retail_refund_amount: '零售退款金额为正，范围包含未发货仅退款、退货退款、已发货仅退款、拒收退款和额外退款。关联原订单并按原订单支付时间归属；退款事件时间用于截止和观察核查，适用条件未知不推定满足。',
    net_retail_sales: '同一可比口径下，终端成交额减零售退款额。零售金额／净销额只用于发现，不跨口径自动合并；金额恒等分解不证明经营原因。',
  };
  const sap = { ...oldSap, package: { ...oldSap.package, version: '0.2.0', fingerprint: '' }, metrics: oldSap.metrics.map(metric => ({ ...metric, definition: definitions[metric.name as keyof typeof definitions], provenance: { origin: 'manual', note: '获准去标识定义；本版不内嵌开放样本已满足条件。' } })), scenarios: oldSap.scenarios.map(scenario => ({ ...scenario, version: '0.2.0', evidence_requirements: '范围、币种、单位、税、归属、关联、截止与观察条件沿本次固定输入核对；未知保持未知。', decision_purpose: '同口径金额变化及证据核查，方法与工具由Agent自主选择。' })) };
  const method = { origin: 'other', title: '同口径零售额变动拆解与核查', content: { conditions: '按本次输入核对可比范围、金额口径、归属、退款关联及观察条件；未知不能视为已满足。', logic: '自主选工具核对同口径成交与退款，净额由成交减退款；变化可按两项金额差解释。', judgment: '区分金额构成、推断、未知与待核证据，不由恒等式推断经营根因。', limits: '仅合成工程材料，未说明的币种税和退款条件保持未知。' } };
  const semantics: TrialSemantics = { enterprise: { title: '获准去标识语义摘录与合成边界', category: '工程合成', body: '仅本次显式输入条件适用。未给出的币种、税及退款观察条件保持未知，不代表任何真实企业政策。', source: '获准去标识指标摘录；本项目固定合成输入', owner: '工程准备', scope: '隔离合成工程场景', effectiveTime: '由本次显式输入声明，未知不补' }, fieldRules: [
    { pointerPattern: '/orders/*/gross_amount_yuan', meaning: '订单退款前金额；仅在本次已核可加总口径下作为终端成交额输入。', metricNames: ['terminal_sales_amount'], unit: '元（依本次输入声明）' },
    { pointerPattern: '/orders/*/payment_time', meaning: '原订单支付时间，为成交与关联退款的统计归属依据。', metricNames: ['terminal_sales_amount', 'retail_refund_amount'], unit: null },
    { pointerPattern: '/refunds/*/order_id', meaning: '关联原订单的键；是否唯一与缺失须据输入核查，不补默认事实。', metricNames: ['retail_refund_amount'], unit: null },
    { pointerPattern: '/refunds/*/refund_amount_yuan', meaning: '正值退款事件金额；五类范围、截止和重复沿本次材料核对。', metricNames: ['retail_refund_amount'], unit: null },
  ], statements: [{ scope: 'business-time', text: '成交和关联退款按原订单支付时间归属；refund_time用于事件及截止核查。' }, { scope: 'source-and-limitations', text: '工程整理不是业务确认；新增未知条件未与旧样本条件合并。' }] };
  const supplied = { analysisInput: Buffer.from(JSON.stringify(input, null, 2) + '\n'), sapPackage: Buffer.from(JSON.stringify(sap)), method: Buffer.from(JSON.stringify(method)), metricExcerpt: await fs.readFile(path.join(originalDirectory, 'metric-candidates.v0.1.json')), semantics: Buffer.from(JSON.stringify(semantics)) };
  const sources = {} as TrialAssetOptions['sources'];
  for (const key of Object.keys(supplied) as (keyof typeof supplied)[]) { const file = path.join(sourceRoot, key + '.json'); await fs.writeFile(file, supplied[key], { flag: 'wx' }); sources[key] = { path: file, sha256: digest(supplied[key]) }; }
  const options: TrialAssetOptions = { dataRoot: path.join(root, 'data'), projectsRoot: path.join(root, 'projects'), projectName: 'S5 neutral engineering project', configuration: { id: randomUUID(), revision: 1, provider: 'openai-compatible', model: 'synthetic-no-provider', name: 'Synthetic public configuration only', baseUrl: 'http://127.0.0.1:9/v1' }, publishedBy: 'S5 engineering preparation', sources };
  return { root, options, input, supplied, originalBytes, semantics };
}
function leafPointers(value: unknown, prefix = ''): string[] {
  if (Array.isArray(value)) return value.flatMap((child, index) => leafPointers(child, prefix + '/' + index));
  if (value && typeof value === 'object') return Object.entries(value).flatMap(([key, child]) => leafPointers(child, prefix + '/' + key.replaceAll('~', '~0').replaceAll('/', '~1')));
  return [prefix];
}

test('S5A02 original APIs publish and enable new assets, freeze exact control-free bytes and actual leaf mappings, then release the Store lock', { skip, timeout: 60_000 }, async t => {
  const f = await fixture(); t.diagnostic(`retained S5 assets: ${f.root}`);
  const result = await prepareSemanticTrialAssets(f.options);
  await fs.writeFile(path.join(f.root, 'assets-receipt.json'), JSON.stringify(result, null, 2) + '\n', { flag: 'wx' });
  const frozenBytes = await fs.readFile(result.analysisInput.path), actual = JSON.parse(frozenBytes.toString('utf8'));
  assert.equal(Object.hasOwn(actual, 'synthetic_net_controls'), false, 'control values must never reach any project file or frozen M2 input');
  assert.deepEqual(result.removedControlPointers, ['/synthetic_net_controls']);
  const { synthetic_net_controls: _controls, ...expected } = f.input;
  assert.deepEqual(actual, expected, 'all legitimate explicit input, including new unknown fields, is preserved');
  assert.equal(result.analysisInput.sha256, digest(frozenBytes)); assert.equal(result.frozen.record.sha256, digest(frozenBytes)); assert.equal(result.frozen.record.bytes, frozenBytes.length);
  assert.notEqual(result.analysisInput.sha256, f.options.sources.analysisInput.sha256);
  assert.equal(result.sourceBytes.analysisInput.sha256, f.options.sources.analysisInput.sha256);
  assert.equal(digest(await fs.readFile(f.options.sources.analysisInput.path)), f.options.sources.analysisInput.sha256, 'source bytes are not rewritten');
  assert.deepEqual(await fs.readFile(path.join(originalDirectory, 'sc01-synthetic-v0.1/input.json')), f.originalBytes);
  assert.deepEqual(result.project.tasks, []); assert.equal(result.methodSaved.method.publishedVersion, null); assert.equal(result.methodPublished.method.publishedVersion, 1);
  assert.equal(result.described.record.statements.find(statement => statement.scope === 'field' && statement.location?.kind === 'json-pointer' && statement.location.pointer === '/orders/0/gross_amount_yuan')?.unit, f.semantics.fieldRules[0]!.unit, 'explicit field units and meaning must survive the original M2 statement API');
  assert.equal(result.methodSaved.version.version, 1); assert.equal(result.methodPublished.version.contentSha256, result.refs.method.publishedHash);
  assert.equal(result.methodPublished.method.governanceRevision, 0); assert.notEqual(result.refs.method.methodId, '9e8cc37d-46ba-4e63-b14f-d617f82af3cf');
  assert.notEqual(result.project.id, 'ef6a2fe1-3366-411f-85c3-de5da3099bf8');
  assert.equal(result.metricPublication.version, '0.2.0'); assert.equal(result.metricEnablement.version, '0.2.0');
  assert.deepEqual(result.refs.metrics.map(ref => ref.kind), ['sap', 'sap', 'sap']);
  assert.equal(result.refs.enterprise.revisionId, result.enterpriseRevision.revisionId); assert.equal(result.enterpriseRevision.number, 1);
  assert.ok(result.enterpriseRevision.body.includes(f.supplied.metricExcerpt.toString('utf8').trim()), 'legitimate excerpt bytes retain exact source membership');
  const pointers = leafPointers(actual).sort();
  assert.equal(result.mappingCount, pointers.length); assert.notEqual(result.mappingCount, 337);
  assert.deepEqual(result.described.record.mappings.map(mapping => mapping.location.kind === 'json-pointer' ? mapping.location.pointer : '').sort(), pointers);
  for (const mapping of result.described.record.mappings) { assert.equal(mapping.confirmed, false); assert.equal(mapping.provenance, 'agent-inference'); assert.equal(mapping.conceptRefs[0]!.revisionId, result.refs.enterprise.revisionId); }
  const amountMapping = result.described.record.mappings.find(mapping => mapping.location.kind === 'json-pointer' && mapping.location.pointer === '/orders/0/gross_amount_yuan')!;
  assert.equal(amountMapping.sapRefs[0]!.metricName, 'terminal_sales_amount'); assert.equal(amountMapping.sapRefs[0]!.publishedHash, result.metricPublication.bytesSha256);
  const unknownMapping = result.described.record.mappings.find(mapping => mapping.location.kind === 'json-pointer' && mapping.location.pointer === '/extra_conditions/amount_tax_basis')!;
  assert.deepEqual(unknownMapping.sapRefs, []); assert.match(unknownMapping.dispute, /unknown/);
  const flatBytes = await fs.readFile(result.semanticView.path), flat = JSON.parse(flatBytes.toString('utf8'));
  assert.equal(digest(flatBytes), result.semanticView.sha256); assert.deepEqual(flat.refs, result.refs);
  assert.equal(flat.fieldRoles.length, result.mappingCount); assert.equal(flat.method.content.conditions, JSON.parse(f.supplied.method.toString('utf8')).content.conditions);
  assert.doesNotMatch(flatBytes.toString('utf8'), /"(?:synthetic_net_controls|target_totals|reference_answer|readiness)"\s*:|9e8cc37d-46ba-4e63-b14f-d617f82af3cf/);
  assert.ok(!flatBytes.toString('utf8').includes(f.root), 'the model-readable view has no engineering source root pointers');
  const projects = new ProjectStore(f.options); await projects.init();
  try {
    const data = new ProjectDataContextStore({ dataRoot: f.options.dataRoot, projects });
    const reopened = await data.readInputEvidence(result.project.id, result.frozen.record.datasetId, result.frozen.record.inputVersionId);
    assert.deepEqual(reopened.bytes, frozenBytes); assert.deepEqual((await projects.get(result.project.id)).tasks, []);
    const files = await projects.tree(result.project.id); assert.equal(files.find(file => file.path === '010_draw')!.children!.length, 0);
    for (const file of files.find(file => file.path === '020_clean')!.children!) assert.doesNotMatch((await projects.readFile(result.project.id, file.path)).bytes.toString('utf8'), /"synthetic_net_controls"\s*:/, 'a harmless disclaimer mentioning controls is not a control field or its values');
  } finally { await projects.close(); }
  assert.equal(createProjectEnablement(path.join(f.options.dataRoot, 'projects', result.project.id)).enabled(result.metricPublication.id)!.version, '0.2.0');
  assert.equal(createMetricLibrary(path.join(f.options.dataRoot, 'metric-assets')).read(result.metricPublication.id, '0.2.0').entry.bytesSha256, result.metricPublication.bytesSha256);
  const methods = createSapMethodStore(path.join(f.options.dataRoot, 'metric-assets'));
  assert.equal(methods.getPublished(result.refs.method.methodId, 1).issue, null);
  methods.markIssue(result.refs.method.methodId, { requestId: randomUUID(), version: 1, expectedRevision: 0, status: 'confirmed', note: 'Synthetic engineering governance probe retained.' });
  assert.deepEqual(methods.listPublished(), [], 'the original governance path remains effective');
  assert.equal((await new EnterpriseMaterialsStore(f.options.dataRoot).get(result.refs.enterprise.materialId)).material.enabled, true);
  const host = await startSemanticTrialHost({ codeRoot: process.cwd(), dataRoot: f.options.dataRoot, projectsRoot: f.options.projectsRoot, instanceId: randomUUID(), uiPort: 4183, transportVersion: '8.12.2' });
  try { const response = await host.request(`/api/projects/${result.project.id}`); assert.equal(response.status, 200); assert.deepEqual((await response.json()).project.tasks, []); } finally { await host.close(); }
});

test('S5A02 hashed explicit inputs fail closed; original roots, old business identities and unfinished locks are not adopted', { skip, timeout: 60_000 }, async t => {
  const f = await fixture(); t.diagnostic(`retained S5 negative assets: ${f.root}`);
  await assert.rejects(prepareSemanticTrialAssets({ ...f.options, dataRoot: '' }), /absolute/);
  await assert.rejects(prepareSemanticTrialAssets({ ...f.options, sources: { ...f.options.sources, analysisInput: { ...f.options.sources.analysisInput, sha256: '0'.repeat(64) } } }), /changed/);
  await assert.rejects(fs.access(f.options.dataRoot));
  const held = new ProjectStore(f.options); await held.init();
  try { await assert.rejects(prepareSemanticTrialAssets(f.options), /project_store_locked/); assert.deepEqual(await held.list(), []); }
  finally { await held.close(); }
  const result = await prepareSemanticTrialAssets(f.options);
  await assert.rejects(prepareSemanticTrialAssets(f.options), /empty business Stores/);
  const check = new ProjectStore(f.options); await check.init();
  try { assert.deepEqual((await check.list()).map(project => project.id), [result.project.id]); } finally { await check.close(); }
});

test('S5A02 new explicit conditions and unknown fields stay independent of the old open sample; invalid pointers cannot be published as mappings', { skip, timeout: 60_000 }, async t => {
  const f = await fixture(); t.diagnostic(`retained S5 explicit conditions: ${f.root}`);
  const body = JSON.parse(f.supplied.analysisInput.toString('utf8'));
  body.scope.currency = 'unknown'; body.scope.tax_basis = 'unknown'; body.synthetic_assumptions = ['Refund maturity is unknown; no new default observation policy.'];
  body.extra_conditions.additional_rule = { stated: null, conflict: 'unresolved' };
  await fs.writeFile(f.options.sources.analysisInput.path, JSON.stringify(body));
  f.options.sources.analysisInput.sha256 = digest(await fs.readFile(f.options.sources.analysisInput.path));
  const result = await prepareSemanticTrialAssets(f.options), actual = JSON.parse(await fs.readFile(result.analysisInput.path, 'utf8'));
  assert.equal(actual.scope.currency, 'unknown'); assert.equal(actual.scope.tax_basis, 'unknown'); assert.deepEqual(actual.synthetic_assumptions, body.synthetic_assumptions); assert.deepEqual(actual.extra_conditions, body.extra_conditions);
  const flat = await fs.readFile(result.semanticView.path, 'utf8'); assert.doesNotMatch(flat, /CNY|7日|7.days|已核唯一|不过付/);
  assert.deepEqual(JSON.parse(flat).conditions.values.extra_conditions, body.extra_conditions, 'the flat view includes only this input\'s declared conditions without old defaults');
  const invalid = await fixture(); invalid.semantics.fieldRules[0]!.pointerPattern = '/missing/*/amount';
  await fs.writeFile(invalid.options.sources.semantics.path, JSON.stringify(invalid.semantics)); invalid.options.sources.semantics.sha256 = digest(await fs.readFile(invalid.options.sources.semantics.path));
  await assert.rejects(prepareSemanticTrialAssets(invalid.options), /no actual input location/); await assert.rejects(fs.access(invalid.options.dataRoot));
});

test('S5A05 two fresh arm roots retain identical legitimate content with independent native identities and no configuration secrets in receipts', { skip, timeout: 60_000 }, async t => {
  const first = await fixture(), second = await fixture(); t.diagnostic(`retained same-source arm roots: ${first.root}; ${second.root}`);
  second.options.sources = first.options.sources;
  Object.assign(first.options.configuration, { apiKey: 'S5_SYNTHETIC_DO_NOT_SERIALIZE_CREDENTIAL' });
  const a = await prepareSemanticTrialAssets(first.options), b = await prepareSemanticTrialAssets(second.options);
  assert.notEqual(a.project.id, b.project.id); assert.notEqual(a.refs.method.methodId, b.refs.method.methodId); assert.notEqual(a.refs.enterprise.storeId, b.refs.enterprise.storeId); assert.notEqual(a.refs.input.inputVersionId, b.refs.input.inputVersionId);
  assert.equal(a.analysisInput.sha256, b.analysisInput.sha256); assert.equal(a.metricPublication.bytesSha256, b.metricPublication.bytesSha256);
  assert.deepEqual(await fs.readFile(a.analysisInput.path), await fs.readFile(b.analysisInput.path));
  const businessContent = (view: any) => ({ metrics: view.metrics, scenarios: view.scenarios, method: { title: view.method.title, content: view.method.content }, enterprise: { title: view.enterprise.title, body: view.enterprise.body, scope: view.enterprise.scope, effectiveTime: view.enterprise.effectiveTime }, conditions: view.conditions.values, fieldRoles: view.fieldRoles.map((field: any) => ({ pointer: field.pointer, meaning: field.meaning, provenance: field.provenance, confirmed: field.confirmed, sapRefs: field.sapRefs })), statements: view.statements.map((statement: any) => ({ scope: statement.scope, text: statement.text, location: statement.location, unit: statement.unit, provenance: statement.provenance, confirmed: statement.confirmed })) });
  assert.deepEqual(businessContent(JSON.parse(await fs.readFile(a.semanticView.path, 'utf8'))), businessContent(JSON.parse(await fs.readFile(b.semanticView.path, 'utf8'))), 'strip only newly allocated native identities when comparing the two legitimate representations');
  assert.doesNotMatch(JSON.stringify(a), /S5_SYNTHETIC_DO_NOT_SERIALIZE_CREDENTIAL/);
  assert.doesNotMatch(await fs.readFile(path.join(first.options.dataRoot, 'projects', a.project.id, 'project.json'), 'utf8'), /S5_SYNTHETIC_DO_NOT_SERIALIZE_CREDENTIAL/);
});
