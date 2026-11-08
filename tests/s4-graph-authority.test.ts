import test from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, readFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { ProjectStore } from '../src/host/project-store.ts';
import { ProjectDataContextStore } from '../src/host/project-data-context-store.ts';
import { EnterpriseMaterialsStore } from '../src/host/enterprise-materials-store.ts';
import { CaseStore } from '../src/host/case-store.ts';
import { SemanticContextService } from '../src/host/semantic-context-service.ts';
import { createMetricLibrary } from '../extensions/business-plugins/metric-factory/library/store.ts';
import { createSapMethodStore } from '../extensions/business-plugins/metric-factory/methods/store.ts';
import { createProjectEnablement } from '../extensions/business-plugins/metric-factory/project/enablement.ts';
import { createSemanticGraphAuthority } from '../src/host/semantic-graph-authority.ts';

const fixtureRoot = process.env.OPTRACALL_S4_FIXTURE;
async function fixture(t: { after(fn: () => Promise<void>): void }) {
  assert.ok(fixtureRoot);
  const run = process.env.OPTRACALL_S4_RUN!;
  const root = await mkdtemp(path.join(run, 'tmp', 'native-authority-'));
  await cp(path.join(fixtureRoot, 'asset-root'), path.join(root, 'data'), { recursive: true });
  await cp(path.join(fixtureRoot, 'projects-root'), path.join(root, 'projects'), { recursive: true });
  const build = JSON.parse(await readFile(path.join(fixtureRoot, 'evidence/scene-v2-corrected-build.json'), 'utf8'));
  const projectId = build.refs.input.projectId;
  const projects = new ProjectStore({ dataRoot: path.join(root, 'data'), projectsRoot: path.join(root, 'projects') });
  await projects.init(); t.after(() => projects.close());
  const task = await projects.createTask(projectId, { name: 'S4 synthetic native authority', configuration: { id: 'synthetic', revision: 1, name: 'Synthetic', provider: 'synthetic', model: 'synthetic', baseUrl: 'http://127.0.0.1' } });
  const data = new ProjectDataContextStore({ dataRoot: projects.dataRoot, projects });
  const enterprise = new EnterpriseMaterialsStore(projects.dataRoot);
  const methods = createSapMethodStore(path.join(projects.dataRoot, 'metric-assets'));
  const reader = new SemanticContextService({ projects, data, enterprise, cases: new CaseStore({ dataRoot: projects.dataRoot }), metricLibrary: createMetricLibrary(path.join(projects.dataRoot, 'metric-assets')), methodLibrary: methods });
  const enabled = createProjectEnablement(path.join(projects.dataRoot, 'projects', projectId));
  const binding = { runRoot: fixtureRoot, snapshotId: build.snapshotId, python: 'not-invoked', codeRoot: path.resolve('.') };
  const authority = createSemanticGraphAuthority({ projectId, taskId: task.id, projects, data, enterprise, reader, dataRoot: projects.dataRoot, binding });
  const context = { signal: new AbortController().signal, assertCurrent() {} };
  return { authority, context, refs: build.refs, enterprise, methods, enabled, binding };
}

test('S4 native source qualification preserves actual project enablement, governance and exact owner', { skip: !fixtureRoot }, async t => {
  const f = await fixture(t), metric = f.refs.metrics[0];
  assert.equal((await f.authority.checkMany([metric], f.context))[0].state, 'forbidden', 'a published package alone must not grant this project access');
  f.enabled.enable(metric.packageId, metric.version);
  const valid = (await f.authority.checkMany([metric, f.refs.enterprise, f.refs.method, f.refs.description], f.context));
  assert.ok(valid.every(v => v.state === 'available'));
  assert.ok(valid.every(v => typeof v.revision === 'string'));
  const foreign = { ...f.refs.input, projectId: randomUUID() };
  assert.equal((await f.authority.checkMany([foreign], f.context))[0].state, 'forbidden');
  const detail = await f.enterprise.get(f.refs.enterprise.materialId);
  await f.enterprise.disable(detail.material.id, detail.material.version);
  assert.equal((await f.authority.checkMany([f.refs.enterprise], f.context))[0].state, 'disabled');
  assert.equal((await f.authority.checkMany([f.refs.description], f.context))[0].state, 'disabled', 'M2 sources must be requalified');
  f.methods.markIssue(f.refs.method.methodId, { requestId: randomUUID(), version: f.refs.method.version, expectedRevision: 0, status: 'confirmed', note: 'Synthetic S4 governance test only' });
  assert.equal((await f.authority.checkMany([f.refs.method], f.context))[0].state, 'excluded');
});

test('S4 source reads exclude raw transaction/control values and enforce frozen-source identity', { skip: !fixtureRoot }, async t => {
  const f = await fixture(t); f.enabled.enable(f.refs.metrics[0].packageId, f.refs.metrics[0].version);
  const input = await f.authority.readSource({ kind: 'ref', ref: f.refs.input }, f.context);
  assert.equal(input.state, 'available');
  assert.ok(!JSON.stringify(input).includes('synthetic_net_controls'));
  assert.ok(!JSON.stringify(input).includes('orders'));
  const build = JSON.parse(await readFile(path.join(f.binding.runRoot, 'snapshots', f.binding.snapshotId, 'receipt.json'), 'utf8'));
  const src = build.inputs.find((x: any) => x.inputKey === 'synthetic-input');
  for (const locator of ['', '/', '/orders', '/refunds', '/scope/currency', '/conditions/not-declared']) {
    const denied = await f.authority.readSource({ kind: 'build', inputKey: src.inputKey, locator, sha256: src.sha256, nature: src.nature }, f.context);
    assert.equal(denied.state, 'forbidden', `undeclared raw, whole-input or semantic child location must stay refused: ${locator}`); assert.equal(denied.body, null);
  }
  const mismatch = await f.authority.readSource({ kind: 'build', inputKey: 'metric-excerpt', locator: '/candidates/0', sha256: '0'.repeat(64), nature: 'deidentified-source' }, f.context);
  assert.equal(mismatch.state, 'hash-conflict'); assert.equal(mismatch.body, null);
});

test('S4 native authority rejects undeclared exact Refs and build locations before original reads', { skip: !fixtureRoot }, async t => {
  const f = await fixture(t); const metric = f.refs.metrics[0];
  f.enabled.enable(metric.packageId, metric.version);
  const { metricName: _metric, ...wholePackage } = metric;
  const undeclared = [wholePackage, { ...metric, publishedHash: null }];
  for (const ref of undeclared) {
    assert.equal((await f.authority.checkMany([ref], f.context))[0].state, 'forbidden');
    const source = await f.authority.readSource({ kind: 'ref', ref }, f.context);
    assert.equal(source.state, 'forbidden'); assert.equal(source.body, null);
  }
  assert.equal((await f.authority.checkMany([metric, f.refs.description], f.context))[0].state, 'available');
  const receipt = JSON.parse(await readFile(path.join(f.binding.runRoot, 'snapshots', f.binding.snapshotId, 'receipt.json'), 'utf8'));
  const src = receipt.inputs.find((x: any) => x.inputKey === 'metric-publication');
  const whole = await f.authority.readSource({ kind: 'build', inputKey: src.inputKey, locator: '/metrics', sha256: src.sha256, nature: src.nature }, f.context);
  assert.equal(whole.state, 'forbidden'); assert.equal(whole.body, null);
});
