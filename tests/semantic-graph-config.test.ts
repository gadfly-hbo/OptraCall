import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { chmod, link, mkdir, mkdtemp, readFile, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { startTestHost } from './fixtures/host-process.ts';
import { loadSemanticGraphConfiguration } from '../src/host/semantic-graph-config.ts';

test('D17 explicit disabled semantic config survives actual Host startup without an interpreter or graph', { timeout: 20_000 }, async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'optracall-d17-config-'));
  const dataRoot = path.join(root, 'host'), projectsRoot = path.join(root, 'projects');
  await mkdir(dataRoot);
  const semanticConfig = path.join(dataRoot, 'semantic=graph.json');
  const content = JSON.stringify({ schemaVersion: 1, enabled: false, python: path.join(root, 'not-installed-python'), projects: [] });
  await writeFile(semanticConfig, content);
  const host = await startTestHost({ dataRoot, projectsRoot, semanticConfig }); t.after(() => host.close());
  const health = await (await host.request('/api/health')).json();
  assert.deepEqual(health.semanticGraph, { enabled: false, configurationSha256: createHash('sha256').update(content).digest('hex'), assets: [] });
  assert.equal((await host.request('/api/projects')).status, 200);
  assert.equal(health.studio?.semanticEngineConfigured, false, 'disabled legacy config must not enable a Studio interpreter');
  t.diagnostic(`retained disabled-config root: ${root}`);
});

test('D17 startup rejects ambiguous bindings and unsafe active paths instead of advertising them as configured', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'optracall-d17-invalid-'));
  const codeRoot = path.join(root, 'code'), dataRoot = path.join(root, 'host'), projectsRoot = path.join(root, 'projects');
  const runRoot = path.join(root, 'semantic'), python = path.join(root, 'runtime', 'python');
  const projectId = '11111111-1111-4111-8111-111111111111', snapshotId = '33333333-3333-4333-8333-333333333333';
  await Promise.all([codeRoot, dataRoot, projectsRoot, path.dirname(python), path.join(runRoot, 'snapshots', snapshotId)].map(directory => mkdir(directory, { recursive: true })));
  await writeFile(python, '#!/bin/sh\nexit 88\n'); await chmod(python, 0o700);
  const runAlias = path.join(root, 'semantic-link'); await symlink(runRoot, runAlias, 'dir');
  const file = path.join(dataRoot, 'semantic-graph.json');
  const project = { projectId, runRoot, snapshotId }, valid = { schemaVersion: 1, enabled: true, python, projects: [project] };
  const cases: [string, unknown, string][] = [
    ['duplicate project', { ...valid, projects: [project, project] }, 'semantic_configuration_invalid'],
    ['unknown binding field', { ...valid, projects: [{ ...project, taskIds: [] }] }, 'semantic_configuration_invalid'],
    ['missing snapshot', { ...valid, projects: [{ ...project, snapshotId: '44444444-4444-4444-8444-444444444444' }] }, 'semantic_configuration_unavailable'],
    ['project data as graph root', { ...valid, projects: [{ ...project, runRoot: projectsRoot }] }, 'semantic_configuration_unsafe_path'],
    ['symlinked graph root', { ...valid, projects: [{ ...project, runRoot: runAlias }] }, 'semantic_configuration_unsafe_path'],
    ['relative interpreter', { ...valid, python: './python' }, 'semantic_configuration_unsafe_path'],
    ['missing interpreter', { ...valid, python: path.join(root, 'missing-python') }, 'semantic_configuration_unavailable'],
  ];
  for (const [label, value, code] of cases) await t.test(label, async () => {
    await writeFile(file, JSON.stringify(value));
    await assert.rejects(loadSemanticGraphConfiguration({ file, codeRoot, dataRoot, projectsRoot }), (error: any) => error.code === code);
  });
  await writeFile(file, JSON.stringify(valid));
  const linkedConfig = path.join(root, 'linked-config.json'); await link(file, linkedConfig);
  await assert.rejects(loadSemanticGraphConfiguration({ file: linkedConfig, codeRoot, dataRoot, projectsRoot }), (error: any) => error.code === 'semantic_configuration_unsafe_path');
});

test('D17 enabled startup configuration binds only its project and stays fixed until another startup', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'optracall-d17-bindings-'));
  const codeRoot = path.join(root, 'code'), dataRoot = path.join(root, 'host'), projectsRoot = path.join(root, 'projects');
  const runRoot = path.join(root, 'semantic'), python = path.join(root, 'runtime', 'python'), marker = path.join(root, 'interpreter-was-run');
  const projectId = '11111111-1111-4111-8111-111111111111', taskId = '22222222-2222-4222-8222-222222222222', snapshotId = '33333333-3333-4333-8333-333333333333';
  await Promise.all([codeRoot, dataRoot, projectsRoot, path.dirname(python), path.join(runRoot, 'snapshots', snapshotId)].map(directory => mkdir(directory, { recursive: true })));
  await writeFile(python, `#!/bin/sh\nprintf executed > '${marker}'\nexit 88\n`); await chmod(python, 0o700);
  const file = path.join(dataRoot, 'semantic-graph.json'), content = JSON.stringify({ schemaVersion: 1, enabled: true, python, projects: [{ projectId, runRoot, snapshotId }] });
  await writeFile(file, content);
  const loaded = await loadSemanticGraphConfiguration({ file, codeRoot, dataRoot, projectsRoot }); assert.ok(loaded);
  assert.deepEqual(loaded.bindingFor(projectId, taskId), { runRoot, snapshotId, python, codeRoot });
  assert.equal(loaded.python, python, 'the accepted Host-only interpreter can be reused without another environment configuration');
  assert.equal(loaded.bindingFor('44444444-4444-4444-8444-444444444444', taskId), undefined);
  assert.equal(loaded.bindingFor(projectId, ''), undefined);
  assert.deepEqual(loaded.configuration, { enabled: true, configurationSha256: createHash('sha256').update(content).digest('hex'), assets: [{ projectId, snapshotId }] });
  await writeFile(file, JSON.stringify({ schemaVersion: 1, enabled: false }));
  assert.deepEqual(loaded.bindingFor(projectId, '55555555-5555-4555-8555-555555555555'), { runRoot, snapshotId, python, codeRoot }, 'an existing loaded configuration covers later real tasks without hot replacement');
  assert.equal(loaded.configuration.enabled, true);
  const next = await loadSemanticGraphConfiguration({ file, codeRoot, dataRoot, projectsRoot }); assert.ok(next); assert.equal(next.configuration.enabled, false); assert.equal(next.bindingFor(projectId, taskId), undefined);
  await assert.rejects(readFile(marker), (error: any) => error.code === 'ENOENT', 'configuration loading cannot execute the interpreter');
});

test('D17 actual Host reports only the accepted configuration identity, not graph readiness or private paths', { timeout: 20_000 }, async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'optracall-d17-accepted-'));
  const dataRoot = path.join(root, 'host'), projectsRoot = path.join(root, 'projects'), runRoot = path.join(root, 'semantic');
  const projectId = '11111111-1111-4111-8111-111111111111', snapshotId = '33333333-3333-4333-8333-333333333333';
  const python = path.join(root, 'runtime', 'python'), marker = path.join(root, 'unexpected-worker');
  await Promise.all([dataRoot, projectsRoot, path.dirname(python), path.join(runRoot, 'snapshots', snapshotId)].map(directory => mkdir(directory, { recursive: true })));
  await writeFile(python, `#!/bin/sh\nprintf executed > '${marker}'\nexit 88\n`); await chmod(python, 0o700);
  const semanticConfig = path.join(dataRoot, 'semantic-graph.json'), content = JSON.stringify({ schemaVersion: 1, enabled: true, python, projects: [{ projectId, runRoot, snapshotId }] });
  await writeFile(semanticConfig, content);
  const host = await startTestHost({ dataRoot, projectsRoot, semanticConfig }); t.after(() => host.close());
  const health = await (await host.request('/api/health')).json();
  assert.deepEqual(health.semanticGraph, { enabled: true, configurationSha256: createHash('sha256').update(content).digest('hex'), assets: [{ projectId, snapshotId }] });
  assert.doesNotMatch(JSON.stringify(health.semanticGraph), /ready|python|runRoot|\/Users\//);
  assert.equal(health.studio?.semanticEngineConfigured, true, 'the original normal launcher config enables the same interpreter for Studio');
  assert.doesNotMatch(JSON.stringify(health.studio), /python|runRoot|\/Users\//);
  await assert.rejects(readFile(marker), (error: any) => error.code === 'ENOENT', 'startup health does not run a graph query');
});

test('D17 malformed explicit configuration fails the real startup with a bounded code', { timeout: 20_000 }, async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'optracall-d17-malformed-'));
  const semanticConfig = path.join(root, 'bad.json'); await writeFile(semanticConfig, '{broken');
  await assert.rejects(startTestHost({ dataRoot: path.join(root, 'host'), projectsRoot: path.join(root, 'projects'), semanticConfig }), /semantic_configuration_invalid/);
});

test('D17 disabled configuration still rejects malformed JSON fields without inspecting inactive paths', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'optracall-d17-disabled-shape-')), file = path.join(root, 'disabled.json');
  const project = { projectId: '11111111-1111-4111-8111-111111111111', snapshotId: '33333333-3333-4333-8333-333333333333', runRoot: path.join(root, 'not-created') };
  for (const fields of [{ python: 42 }, { projects: 'not-an-array' }, { projects: [project, project] }]) await t.test(JSON.stringify(fields), async () => {
    await writeFile(file, JSON.stringify({ schemaVersion: 1, enabled: false, ...fields }));
    await assert.rejects(loadSemanticGraphConfiguration({ file, codeRoot: path.join(root, 'no-code'), dataRoot: path.join(root, 'no-data'), projectsRoot: path.join(root, 'no-projects') }), (error: any) => error.code === 'semantic_configuration_invalid');
  });
});
