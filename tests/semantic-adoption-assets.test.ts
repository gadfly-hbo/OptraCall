import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import systemFs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import path from 'node:path';
import os from 'node:os';
import { createHash, randomUUID } from 'node:crypto';
import { ProjectStore, type ProjectConfiguration } from '../src/host/project-store.ts';
import { createMetricLibrary } from '../extensions/business-plugins/metric-factory/library/store.ts';
import { preparePublication } from '../extensions/business-plugins/metric-factory/sap/validate.ts';
import { prepareSemanticAdoptionAssets, type SemanticAdoptionAssetOptions } from '../src/host/semantic-adoption-assets.ts';
import { prepareSemanticTrialAssets, type TrialSemantics } from '../src/host/semantic-trial-assets.ts';
import { EnterpriseMaterialsStore } from '../src/host/enterprise-materials-store.ts';
import { createProjectEnablement } from '../extensions/business-plugins/metric-factory/project/enablement.ts';

const digest = (text: string | Buffer) => createHash('sha256').update(text).digest('hex');
async function fixture() {
  // Portable Store checks always use a fresh synthetic directory, including CI.
  const parent = process.env.OPTRACALL_D17_TEST_ROOT ?? await fs.realpath(os.tmpdir());
  assert.ok(path.isAbsolute(parent), 'D17 test root must be absolute');
  await fs.mkdir(parent, { recursive: true });
  const root = await fs.mkdtemp(path.join(parent, 'asset-'));
  const sourceRoot = path.join(root, 'sources'); await fs.mkdir(sourceRoot);
  const configuration: ProjectConfiguration = { id: randomUUID(), revision: 1, provider: 'openai-compatible', model: 'synthetic-no-model', name: 'D17 synthetic public snapshot', baseUrl: 'http://127.0.0.1:9/v1' };
  const semantics: TrialSemantics = { enterprise: { title: 'D17合成语义源', category: '工程合成', body: '仅SC-01S；条件未知不补。', source: '获准去标识摘录', owner: '工程维护', scope: '仅合成工程', effectiveTime: '未知' }, fieldRules: [
    { pointerPattern: '/orders/*/gross_amount_yuan', meaning: '本次合成订单金额，适用性仍待核。', metricNames: ['terminal_sales_amount'], unit: '元' },
  ], statements: [{ scope: 'source-and-limitations', text: 'D17只验证工程采用，不证明经营效果。' }] };
  const bodies = {
    analysisInput: JSON.stringify({ orders: [{ gross_amount_yuan: 37 }], synthetic_net_controls: { ignored: 37 }, conditions: { scope: '仅SC-01S合成' } }),
    sapPackage: await fs.readFile('openspec/changes/fourbase-l2-rollout/assets/sc01s-core.sap.json', 'utf8'),
    method: JSON.stringify({ origin: 'other', title: 'D17合成核对方法', content: { conditions: '只适用已声明的合成范围。', logic: 'Agent自主核对。', judgment: '不推定经营效果。', limits: '未知保持未知。' } }),
    metricExcerpt: JSON.stringify({ note: '只用获准去标识指标定义；无企业身份。' }),
    semantics: JSON.stringify(semantics),
  };
  const sources = {} as SemanticAdoptionAssetOptions['sources'];
  for (const [key, body] of Object.entries(bodies)) {
    const file = path.join(sourceRoot, key + '.json'); await fs.writeFile(file, body); sources[key as keyof typeof sources] = { path: file, sha256: digest(body) };
  }
  const options: SemanticAdoptionAssetOptions = { dataRoot: path.join(root, 'data'), projectsRoot: path.join(root, 'projects'), projectName: 'D17 SC-01S new synthetic project', publishedBy: 'D17工程维护', sources,
    configurationRef: { id: configuration.id, revision: configuration.revision }, configurationSnapshot: ref => ref.id === configuration.id && ref.revision === configuration.revision ? configuration : null };
  const store = new ProjectStore(options); await store.init();
  let original;
  try { original = await store.create({ name: '已存在的合成项目', configuration }); await store.saveReport(original.id, 'keep.md', 'D17_EXISTING_REPORT'); }
  finally { await store.close(); }
  return { root, options, configuration, bodies, original };
}

test('D17 finite adoption adds a taskless SC-01S project in nonempty Stores and preserves the existing project', async t => {
  const f = await fixture(); t.diagnostic(`retained D17 assets: ${f.root}`);
  const result = await prepareSemanticAdoptionAssets(f.options);
  const store = new ProjectStore(f.options); await store.init();
  try {
    assert.deepEqual((await store.list()).map(project => project.id).sort(), [f.original.id, result.project.id].sort());
    assert.equal((await store.readFile(f.original.id, '060_reports/keep.md')).bytes.toString(), 'D17_EXISTING_REPORT');
    assert.deepEqual((await store.get(result.project.id)).tasks, []);
    assert.equal((await store.get(result.project.id)).configuration.id, f.configuration.id);
  } finally { await store.close(); }
  assert.deepEqual(result.refs.metrics.map((ref: any) => ref.metricName), ['terminal_sales_amount', 'retail_refund_amount', 'net_retail_sales']);
  assert.equal(result.refs.method.version, 1); assert.ok(result.refs.enterprise.revisionId);
  assert.equal(result.frozen.record.sha256, result.analysisInput.sha256);
  assert.equal(JSON.parse(await fs.readFile(result.analysisInput.path, 'utf8')).synthetic_net_controls, undefined);
  const view = JSON.parse(await fs.readFile(result.semanticView.path, 'utf8'));
  assert.deepEqual(view.refs, result.refs); assert.equal(result.metricPublication.version, '0.1.0');
  await assert.rejects(prepareSemanticTrialAssets({ ...f.options, configuration: f.configuration }), /empty business Stores/);
});

test('D17 exact SAP version is reused; a conflicting same-version source stops before adding a project or changing published bytes', async t => {
  const f = await fixture(); t.diagnostic(`retained D17 version checks: ${f.root}`);
  const library = createMetricLibrary(path.join(f.options.dataRoot, 'metric-assets'));
  const publication = preparePublication(Buffer.from(f.bodies.sapPackage));
  const original = library.publish(publication, 'existing synthetic publisher');
  const result = await prepareSemanticAdoptionAssets(f.options);
  assert.deepEqual(result.metricPublication, original);
  const conflicting = JSON.parse(f.bodies.sapPackage); conflicting.metrics[0].definition += ' D17_CONFLICT'; conflicting.package.fingerprint = '';
  const body = JSON.stringify(conflicting); await fs.writeFile(f.options.sources.sapPackage.path, body);
  await assert.rejects(prepareSemanticAdoptionAssets({ ...f.options, projectName: 'D17 conflict must not create this project', sources: { ...f.options.sources, sapPackage: { ...f.options.sources.sapPackage, sha256: digest(body) } } }), /LIBRARY_VERSION_CONFLICT/);
  const projects = new ProjectStore(f.options); await projects.init();
  try { assert.equal((await projects.list()).length, 2); }
  finally { await projects.close(); }
  assert.deepEqual(library.read(original.id, original.version).entry, original);
  assert.equal(library.list().length, 1);
});

test('D17 partial adoption retains generated identities; explicit continuation finishes the same project without blind duplication', async t => {
  const f = await fixture(); t.diagnostic(`retained D17 partial adoption: ${f.root}`);
  const blocker = path.join(f.options.dataRoot, 'metric-assets', 'methods');
  await fs.mkdir(path.dirname(blocker), { recursive: true }); await fs.writeFile(blocker, 'D17_ISOLATED_FILESYSTEM_BLOCKER');
  let interrupted: any;
  try { await prepareSemanticAdoptionAssets(f.options); } catch (error) { interrupted = error; }
  assert.ok(interrupted?.continuation?.projectId, 'the failed public operation must expose its already-created project identity');
  await fs.unlink(blocker);
  await assert.rejects(prepareSemanticAdoptionAssets(f.options), /resume_required/, 'the same adoption intent must not silently create another project');
  const result = await prepareSemanticAdoptionAssets({ ...f.options, continuation: interrupted.continuation });
  assert.equal(result.project.id, interrupted.continuation.projectId);
  const store = new ProjectStore(f.options); await store.init();
  try { assert.equal((await store.list()).length, 2); assert.equal(result.project.uploads.length, 5); }
  finally { await store.close(); }
  const repeated = await prepareSemanticAdoptionAssets({ ...f.options, continuation: result.continuation });
  assert.equal(repeated.project.id, result.project.id); assert.deepEqual(repeated.refs, result.refs);
  assert.equal(repeated.project.uploads.length, 5);
  assert.deepEqual(repeated.metricEnablement, result.metricEnablement, 'continuing a completed preparation does not refresh its enablement timestamp');
});

test('D17 unavailable public configuration stops before asset writes; private snapshot fields are never persisted', async t => {
  const f = await fixture(); t.diagnostic(`retained D17 configuration checks: ${f.root}`);
  await assert.rejects(prepareSemanticAdoptionAssets({ ...f.options, configurationSnapshot: () => null }), /configuration_unavailable/);
  await assert.rejects(fs.access(path.join(f.options.dataRoot, 'metric-assets')));
  const result = await prepareSemanticAdoptionAssets({ ...f.options, configurationSnapshot: () => ({ ...f.configuration, apiKey: 'D17_SYNTHETIC_SECRET_MUST_NOT_PERSIST' }) });
  assert.equal(result.project.configuration.id, f.configuration.id); assert.equal(result.project.configuration.revision, 1);
  assert.ok(!JSON.stringify(result).includes('D17_SYNTHETIC_SECRET_MUST_NOT_PERSIST'));
});

test('D17 continuation rejects changed source identity and never re-enables an originally withdrawn source', async t => {
  const f = await fixture(); t.diagnostic(`retained D17 continuation governance: ${f.root}`);
  const result = await prepareSemanticAdoptionAssets(f.options);
  const changed = JSON.parse(f.bodies.semantics); changed.enterprise.body += ' changed';
  const body = JSON.stringify(changed); await fs.writeFile(f.options.sources.semantics.path, body);
  await assert.rejects(prepareSemanticAdoptionAssets({ ...f.options, continuation: result.continuation, sources: { ...f.options.sources, semantics: { ...f.options.sources.semantics, sha256: digest(body) } } }), /continuation_conflict/);
  await fs.writeFile(f.options.sources.semantics.path, f.bodies.semantics);
  const enterprise = new EnterpriseMaterialsStore(f.options.dataRoot);
  const before = await enterprise.get(result.refs.enterprise.materialId);
  const disabled = await enterprise.disable(before.material.id, before.material.version);
  await assert.rejects(prepareSemanticAdoptionAssets({ ...f.options, continuation: result.continuation }), /enterprise_unavailable/);
  assert.deepEqual(await enterprise.get(before.material.id), disabled);
});

test('D17 a completed continuation cannot restore metric enablement withdrawn through the original project API', async t => {
  const f = await fixture(); t.diagnostic(`retained D17 metric withdrawal: ${f.root}`);
  const result = await prepareSemanticAdoptionAssets(f.options);
  const enablement = createProjectEnablement(path.join(f.options.dataRoot, 'projects', result.project.id));
  enablement.disable(result.metricPublication.id);
  await assert.rejects(prepareSemanticAdoptionAssets({ ...f.options, continuation: result.continuation }), /metric_unavailable/);
  assert.equal(enablement.enabled(result.metricPublication.id), undefined);
});

test('D17 an enablement write with an uncertain reply is read back, never replayed after withdrawal', async t => {
  for (const withdrawn of [false, true]) await t.test(withdrawn ? 'withdrawn after uncertain write' : 'exact state still available', async t => {
    const f = await fixture(); t.diagnostic(`retained D17 uncertain enablement: ${f.root}`);
    const originalRename = systemFs.renameSync, originalOpen = systemFs.openSync;
    let renamedDirectory: string | undefined, faultInjected = false, interrupted: any;
    // Fault only the system I/O boundary after the original Store has renamed
    // its committed enablement file, before the directory durability reply.
    systemFs.renameSync = (from, to) => {
      originalRename(from, to);
      const target = String(to);
      if (target.startsWith(path.join(f.options.dataRoot, 'projects') + path.sep) && path.basename(target) === 'metric-assets.json') renamedDirectory = path.dirname(target);
    };
    systemFs.openSync = ((...args: Parameters<typeof originalOpen>) => {
      if (!faultInjected && String(args[0]) === renamedDirectory && args[1] === 'r') {
        faultInjected = true; throw new Error('D17_DIRECTORY_SYNC_FAILED_AFTER_RENAME');
      }
      return originalOpen(...args);
    }) as typeof originalOpen;
    syncBuiltinESMExports();
    try { await prepareSemanticAdoptionAssets(f.options); } catch (error) { interrupted = error; }
    finally { systemFs.renameSync = originalRename; systemFs.openSync = originalOpen; syncBuiltinESMExports(); }
    assert.equal(faultInjected, true); assert.match(interrupted?.message ?? '', /D17_DIRECTORY_SYNC_FAILED_AFTER_RENAME/);
    assert.ok(interrupted?.continuation?.projectId);
    assert.equal(interrupted.continuation.metricEnabledAt, undefined, 'the caller never received the original enable result');
    const enablement = createProjectEnablement(path.join(f.options.dataRoot, 'projects', interrupted.continuation.projectId));
    const committed = enablement.enabled('optracall-sc01s-retail'); assert.ok(committed, 'the original rename really wrote the enabled state');
    if (withdrawn) {
      enablement.disable(committed.packageId);
      await assert.rejects(prepareSemanticAdoptionAssets({ ...f.options, continuation: interrupted.continuation }), /metric_.*(?:unknown|unavailable)/);
      assert.equal(enablement.enabled(committed.packageId), undefined, 'an uncertain reply cannot restore the withdrawn source');
    } else {
      const result = await prepareSemanticAdoptionAssets({ ...f.options, continuation: interrupted.continuation });
      assert.deepEqual(result.metricEnablement, committed, 'readback preserves the actual original enablement and timestamp');
    }
  });
});
