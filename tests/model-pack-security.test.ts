import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test, { type TestContext } from 'node:test';
import { ModelPackStore, ModelPackError } from '../src/host/model-pack-store.ts';
import { modelManifest, writeModelPack } from './model-pack-fixtures.ts';

const evidenceRoot = path.resolve('.local/model-pack-delivery/security-author');

async function unlockDirectories(directory: string): Promise<void> {
  const stat = await fs.lstat(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink()) return;
  await fs.chmod(directory, 0o700);
  for (const entry of await fs.readdir(directory)) {
    await unlockDirectories(path.join(directory, entry));
  }
}

async function fixture(t: TestContext) {
  await fs.mkdir(evidenceRoot, { recursive: true });
  const root = await fs.realpath(await fs.mkdtemp(path.join(evidenceRoot, 'run-')));
  const modelsRoot = path.join(root, 'data', 'models');
  const store = new ModelPackStore(modelsRoot);
  t.after(async () => {
    store.close();
    await unlockDirectories(root);
    await fs.rm(root, { recursive: true });
  });
  return { root, modelsRoot, store };
}

async function predictionFixture(t: TestContext, source?: string) {
  const context = await fixture(t);
  await context.store.importPack(await writeModelPack(context.root, 1, source));
  const projectRoot = path.join(context.root, 'project');
  for (const directory of ['010_draw', '020_clean', '060_reports']) {
    await fs.mkdir(path.join(projectRoot, directory), { recursive: true });
  }
  await fs.writeFile(path.join(projectRoot, '020_clean', 'input.json'), '[{"x":2},{"x":5}]');
  return { ...context, projectRoot, request: { name: 'synthetic-model', version: 1,
    inputPath: '020_clean/input.json', outputPath: '060_reports/output.json', projectRoot } };
}

function structuredError(error: unknown, code?: string): boolean {
  assert.ok(error instanceof ModelPackError, 'rejection is a structured model-pack error');
  if (code) assert.equal(error.code, code);
  assert.ok(error.detail.stage);
  assert.ok(error.detail.reason);
  return true;
}

async function inventory(root: string): Promise<Record<string, unknown>> {
  const result: Record<string, unknown> = {};
  async function visit(file: string) {
    const stat = await fs.lstat(file);
    const relative = path.relative(root, file) || '.';
    result[relative] = { mode: stat.mode & 0o777, size: stat.size, mtimeMs: stat.mtimeMs,
      ...(stat.isFile() ? { bytes: (await fs.readFile(file)).toString('base64') } : {}),
      ...(stat.isSymbolicLink() ? { link: await fs.readlink(file) } : {}) };
    if (stat.isDirectory() && !stat.isSymbolicLink()) {
      for (const name of (await fs.readdir(file)).sort()) await visit(path.join(file, name));
    }
  }
  await visit(root);
  return result;
}

test('MP01 rejects computed Math random at the import boundary without installing a snapshot', async t => {
  const { root, modelsRoot, store } = await fixture(t);
  const source = await writeModelPack(root, 1,
    "export function predict(rows) { return rows.map(row => ({prediction: Number(row.x) + Math['random']()})); }");

  await assert.rejects(store.importPack(source), error => structuredError(error, 'PURITY_REJECTED'));
  assert.deepEqual(store.list(), []);
  assert.equal(await fs.stat(modelsRoot).then(() => true, () => false), false,
    'rejected code must not create the model store or registry');
});

test('MP01 rejects incomplete or invalid packages before creating the model store', async t => {
  for (const kind of ['missing-readme', 'format-version', 'invalid-name'] as const) {
    await t.test(kind, async child => {
      const { root, modelsRoot, store } = await fixture(child);
      const source = await writeModelPack(root);
      if (kind === 'missing-readme') await fs.unlink(path.join(source, 'README.md'));
      else {
        const manifest = modelManifest();
        if (kind === 'format-version') manifest.formatVersion = 2;
        else manifest.model.name = '../outside';
        await fs.writeFile(path.join(source, 'manifest.json'), JSON.stringify(manifest));
      }

      await assert.rejects(store.importPack(source), error => structuredError(error));
      assert.deepEqual(store.list(), []);
      assert.equal(await fs.stat(modelsRoot).then(() => true, () => false), false);
    });
  }
});

test('MP01 rejects forbidden capabilities and nondeterminism through actual package imports', async t => {
  const cases = [
    ['filesystem', "import fs from 'node:fs'; export function predict(rows) { return rows.map(() => ({prediction: 1})); }"],
    ['network', "export function predict(rows) { fetch('http://127.0.0.1:1/'); return rows.map(() => ({prediction: 1})); }"],
    ['subprocess', "import cp from 'node:child_process'; export function predict(rows) { return rows.map(() => ({prediction: 1})); }"],
    ['eval', "export function predict(rows) { return rows.map(() => ({prediction: eval('1')})); }"],
    ['random', 'export function predict(rows) { return rows.map(() => ({prediction: Math.random()})); }'],
    ['clock', 'export function predict(rows) { return rows.map(() => ({prediction: Date.now()})); }'],
    ['constructor', "export function predict(rows) { return rows.map(() => ({prediction: ({}).constructor.constructor('return 1')()})); }"],
    ['computed-constructor', "export function predict(rows) { return rows.map(() => ({prediction: (() => {})['constructor']('return 1')()})); }"],
    ['indirect-import', "const load = async specifier => import(specifier); export async function predict(rows) { await load('node:fs'); return rows.map(() => ({prediction: 1})); }"],
    ['sqlite', "import { DatabaseSync } from 'node:sqlite'; export function predict(rows) { return rows.map(() => ({prediction: 1})); }"],
  ];
  for (const [label, program] of cases) {
    await t.test(label, async child => {
      const { root, modelsRoot, store } = await fixture(child);
      const source = await writeModelPack(root, 1, program);
      await assert.rejects(store.importPack(source), error => structuredError(error, 'PURITY_REJECTED'));
      assert.deepEqual(store.list(), []);
      assert.equal(await fs.stat(modelsRoot).then(() => true, () => false), false,
        'purity failure must not leave registry or staging files');
    });
  }
});

test('MP01 rejects symlink and hardlink source files and linked package directories without altering them', async t => {
  for (const kind of ['symlink-file', 'hardlink-file', 'symlink-directory'] as const) {
    await t.test(kind, async child => {
      const { root, modelsRoot, store } = await fixture(child);
      const source = await writeModelPack(root);
      const original = await fs.readFile(path.join(source, 'predict.mjs'));
      let importPath = source;
      if (kind === 'symlink-directory') {
        importPath = path.join(root, 'linked-package');
        await fs.symlink(source, importPath, 'dir');
      } else {
        const external = path.join(root, 'external-predict.mjs');
        await fs.rename(path.join(source, 'predict.mjs'), external);
        if (kind === 'symlink-file') await fs.symlink(external, path.join(source, 'predict.mjs'));
        else await fs.link(external, path.join(source, 'predict.mjs'));
      }

      await assert.rejects(store.importPack(importPath), error => structuredError(error));
      assert.deepEqual(await fs.readFile(path.join(source, 'predict.mjs')), original);
      assert.deepEqual(store.list(), []);
      assert.equal(await fs.stat(modelsRoot).then(() => true, () => false), false);
    });
  }
});

test('MP01 rejects sandbox smoke or declared-output failures without creating registry or snapshot files', async t => {
  for (const program of [
    "export function predict(rows) { throw new Error('Synthetic smoke failure'); }",
    'export function predict(rows) { return rows.map(() => ({wrongColumn:1})); }',
  ]) {
    await t.test(program.includes('throw') ? 'execution-failure' : 'missing-declared-output', async child => {
      const { root, modelsRoot, store } = await fixture(child);
      const source = await writeModelPack(root, 1, program), sourceBefore = await inventory(source);
      await assert.rejects(store.importPack(source), error => structuredError(error));
      assert.deepEqual(store.list(), []);
      assert.equal(await fs.stat(modelsRoot).then(() => true, () => false), false);
      assert.deepEqual(await inventory(source), sourceBefore);
    });
  }
});

test('MP02 copies read-only snapshots, preserves identity on reinstall, and refuses changed same-version bytes', async t => {
  const { root, modelsRoot, store } = await fixture(t);
  const source = await writeModelPack(root);
  const first = await store.importPack(source);
  const snapshot = path.join(modelsRoot, 'synthetic-model', 'v1');
  assert.equal((await fs.stat(snapshot)).mode & 0o222, 0);
  for (const name of ['manifest.json', 'predict.mjs', 'README.md']) {
    assert.equal((await fs.stat(path.join(snapshot, name))).mode & 0o222, 0);
    assert.deepEqual(await fs.readFile(path.join(snapshot, name)), await fs.readFile(path.join(source, name)));
  }
  const before = await inventory(snapshot);

  const secondSource = path.join(root, 'identical-package');
  await fs.cp(source, secondSource, { recursive: true });
  assert.deepEqual(await store.importPack(secondSource), first,
    'identical reinstall retains original stage, source, time and digest');
  assert.deepEqual(store.list(), [first]);
  assert.deepEqual(await inventory(snapshot), before);

  await fs.writeFile(path.join(secondSource, 'README.md'), 'A different synthetic package with the same identity.');
  await assert.rejects(store.importPack(secondSource), error => structuredError(error, 'MODEL_VERSION_CONFLICT'));
  assert.deepEqual(store.list(), [first]);
  assert.deepEqual(await inventory(snapshot), before, 'version conflict never alters an installed snapshot');
  assert.deepEqual(await fs.readdir(path.dirname(snapshot)), ['v1'], 'no abandoned staging directory');

  await fs.writeFile(path.join(source, 'predict.mjs'), 'Source is mutable after import.');
  assert.deepEqual(await inventory(snapshot), before, 'the installed model does not depend on source mutations');
});

test('MP02 same-name promotion archives its old Production while preserving all versions and other models', async t => {
  const { root, modelsRoot, store } = await fixture(t);
  await store.importPack(await writeModelPack(root, 1));
  await store.importPack(await writeModelPack(root, 2));
  await store.importPack(await writeModelPack(root, 1, undefined, 'other-synthetic'));
  const before = await inventory(path.join(modelsRoot, 'synthetic-model'));

  assert.equal(store.promote('synthetic-model', 1).archived, null);
  store.promote('other-synthetic', 1);
  const result = store.promote('synthetic-model', 2);
  assert.equal(result.model.stage, 'Production');
  assert.equal(result.model.version, 2);
  assert.equal(result.archived?.version, 1);
  assert.equal(result.archived?.stage, 'Archived');
  assert.equal(store.get('synthetic-model', 1).stage, 'Archived');
  assert.equal(store.get('other-synthetic', 1).stage, 'Production');
  assert.equal(store.list().filter(item => item.name === 'synthetic-model' && item.stage === 'Production').length, 1);
  assert.equal(store.list().length, 3);
  assert.deepEqual(await inventory(path.join(modelsRoot, 'synthetic-model')), before);
  assert.throws(() => store.promote('synthetic-model', 1), error => structuredError(error, 'MODEL_ARCHIVED'));
});

test('MP02/05 read-only listing never creates a registry or writes to an existing one', async t => {
  const { root, modelsRoot, store } = await fixture(t);
  const emptyRoot = path.join(root, 'missing-models');
  const empty = new ModelPackStore(emptyRoot, { readOnly: true });
  try {
    assert.deepEqual(empty.list(), []);
    assert.equal(await fs.stat(emptyRoot).then(() => true, () => false), false);
  } finally { empty.close(); }

  const source = await writeModelPack(root);
  await store.importPack(source);
  store.close();
  const before = await inventory(modelsRoot);
  const readOnly = new ModelPackStore(modelsRoot, { readOnly: true });
  try {
    assert.equal(readOnly.list().length, 1);
    assert.equal(readOnly.get('synthetic-model', 1).stage, 'Staging');
    assert.deepEqual(readOnly.manifest('synthetic-model', 1), modelManifest());
    await assert.rejects(readOnly.importPack(source), error => structuredError(error, 'REGISTRY_READ_ONLY'));
    assert.throws(() => readOnly.promote('synthetic-model', 1), error => structuredError(error, 'REGISTRY_READ_ONLY'));
  } finally { readOnly.close(); }
  assert.deepEqual(await inventory(modelsRoot), before, 'listing and rejected management do not change SQLite or snapshots');
});

test('MP02 reports corrupt hashes without repairing or hiding the damaged snapshot', async t => {
  const { root, modelsRoot, store } = await fixture(t);
  const source = await writeModelPack(root);
  const entry = await store.importPack(source);
  const damaged = path.join(modelsRoot, 'synthetic-model', 'v1', 'predict.mjs');
  await fs.chmod(damaged, 0o644);
  await fs.writeFile(damaged, 'export function predict(rows) { return rows.map(() => ({prediction: 999})); }');
  await fs.chmod(damaged, 0o444);
  const before = await inventory(modelsRoot);

  assert.equal(store.get('synthetic-model', 1).corrupted, true);
  assert.equal(store.get('synthetic-model', 1).snapshotSha256, entry.snapshotSha256);
  assert.throws(() => store.manifest('synthetic-model', 1), error => structuredError(error, 'MODEL_CORRUPTED'));
  assert.throws(() => store.promote('synthetic-model', 1), error => structuredError(error, 'MODEL_CORRUPTED'));
  // Explicit reimport now has a separate recovery test. Read/list/detail/promote
  // must still preserve damaged bytes and never repair implicitly.
  assert.deepEqual(await inventory(modelsRoot), before, 'corruption evidence and metadata are preserved');
});

test('MP02 rejects symlink or hardlink registry files when reopening read-only', async t => {
  for (const kind of ['symlink', 'hardlink'] as const) {
    await t.test(kind, async child => {
      const { root, modelsRoot, store } = await fixture(child);
      await store.importPack(await writeModelPack(root));
      store.close();
      const registry = path.join(modelsRoot, 'registry.sqlite');
      const original = path.join(root, 'preserved-registry.sqlite');
      await fs.rename(registry, original);
      if (kind === 'symlink') await fs.symlink(original, registry);
      else await fs.link(original, registry);
      const before = await inventory(modelsRoot), originalBefore = await fs.readFile(original);
      const readOnly = new ModelPackStore(modelsRoot, { readOnly: true });
      try { assert.throws(() => readOnly.list(), error => structuredError(error)); }
      finally { readOnly.close(); }
      assert.deepEqual(await inventory(modelsRoot), before);
      assert.deepEqual(await fs.readFile(original), originalBefore);
    });
  }
});

test('MP02/06 marks replaced snapshot files corrupt and refuses execution without touching linked originals', async t => {
  for (const kind of ['symlink', 'hardlink', 'linked-version-directory'] as const) {
    await t.test(kind, async child => {
      const { root, modelsRoot, store, projectRoot, request } = await predictionFixture(child);
      const version = path.join(modelsRoot, 'synthetic-model', 'v1');
      let preserved: string;
      if (kind === 'linked-version-directory') {
        preserved = path.join(root, 'preserved-snapshot');
        await fs.chmod(version, 0o700);
        await fs.rename(version, preserved);
        await fs.chmod(preserved, 0o555);
        await fs.symlink(preserved, version, 'dir');
      } else {
        await fs.chmod(version, 0o700);
        const script = path.join(version, 'predict.mjs');
        preserved = path.join(root, 'preserved-predict.mjs');
        await fs.rename(script, preserved);
        if (kind === 'symlink') await fs.symlink(preserved, script);
        else await fs.link(preserved, script);
        await fs.chmod(version, 0o555);
      }
      const before = await inventory(modelsRoot), projectBefore = await inventory(projectRoot);
      const originalBefore = await inventory(preserved);
      assert.equal(store.get('synthetic-model', 1).corrupted, true);
      assert.throws(() => store.manifest('synthetic-model', 1), error => structuredError(error, 'MODEL_CORRUPTED'));
      await assert.rejects(store.predict(request), error => structuredError(error, 'MODEL_CORRUPTED'));
      assert.deepEqual(await inventory(modelsRoot), before);
      assert.deepEqual(await inventory(projectRoot), projectBefore);
      assert.deepEqual(await inventory(preserved), originalBefore);
    });
  }
});

test('MP06 predicts deterministic literal values with provenance and preserves input and registry', async t => {
  const { modelsRoot, store, projectRoot, request } = await predictionFixture(t);
  const before = await inventory(modelsRoot);
  const inputBytes = await fs.readFile(path.join(projectRoot, request.inputPath));

  const result = await store.predict(request);
  assert.equal(result.rows, 2);
  assert.equal(result.outputPath, '060_reports/output.json');
  assert.equal(result.provenance.name, 'synthetic-model');
  assert.equal(result.provenance.version, 1);
  assert.equal(result.provenance.stage, 'Staging');
  assert.deepEqual(result.provenance.metrics, { mae: 0.25, 'mae:prediction': 0.25 });
  assert.equal(result.provenance.fingerprint.sha256, 'a'.repeat(64));
  const first = await fs.readFile(path.join(projectRoot, request.outputPath), 'utf8');
  assert.equal(first, '[{"x":2,"prediction":4},{"x":5,"prediction":10}]\n');
  await store.predict({ ...request, outputPath: '020_clean/repeated.json' });
  assert.equal(await fs.readFile(path.join(projectRoot, '020_clean/repeated.json'), 'utf8'), first);
  assert.deepEqual(await fs.readFile(path.join(projectRoot, request.inputPath)), inputBytes);
  assert.deepEqual(await inventory(modelsRoot), before);
});

test('MP06 refuses linked or out-of-scope paths and existing outputs without any file mutation', async t => {
  const cases = ['input-symlink', 'input-hardlink', 'input-parent-symlink',
    'output-symlink', 'output-hardlink', 'output-parent-symlink',
    'input-traversal', 'output-traversal', 'absolute-input-outside', 'absolute-output-outside',
    'raw-input', 'raw-output', 'existing-output', 'input-is-output'] as const;
  for (const kind of cases) {
    await t.test(kind, async child => {
      const { root, store, projectRoot, request } = await predictionFixture(child);
      const external = path.join(root, 'external');
      await fs.mkdir(external);
      await fs.writeFile(path.join(external, 'input.json'), '[{"x":13}]');
      await fs.writeFile(path.join(external, 'original.json'), 'Preserve synthetic original.');
      const inputFile = path.join(projectRoot, request.inputPath);
      const outputFile = path.join(projectRoot, request.outputPath);
      if (kind === 'input-symlink' || kind === 'input-hardlink') {
        await fs.unlink(inputFile);
        if (kind === 'input-symlink') await fs.symlink(path.join(external, 'input.json'), inputFile);
        else await fs.link(path.join(external, 'input.json'), inputFile);
      } else if (kind === 'input-parent-symlink') {
        await fs.symlink(external, path.join(projectRoot, '020_clean', 'linked'), 'dir');
        request.inputPath = '020_clean/linked/input.json';
      } else if (kind === 'output-symlink' || kind === 'output-hardlink') {
        if (kind === 'output-symlink') await fs.symlink(path.join(external, 'original.json'), outputFile);
        else await fs.link(path.join(external, 'original.json'), outputFile);
      } else if (kind === 'output-parent-symlink') {
        await fs.symlink(external, path.join(projectRoot, '060_reports', 'linked'), 'dir');
        request.outputPath = '060_reports/linked/new.json';
      } else if (kind === 'input-traversal') request.inputPath = '020_clean/../../external/input.json';
      else if (kind === 'output-traversal') request.outputPath = '060_reports/../../external/new.json';
      else if (kind === 'absolute-input-outside') request.inputPath = path.join(external, 'input.json');
      else if (kind === 'absolute-output-outside') request.outputPath = path.join(external, 'new.json');
      else if (kind === 'raw-input') {
        request.inputPath = '010_draw/raw.json';
        await fs.writeFile(path.join(projectRoot, request.inputPath), '[{"x":7}]');
      } else if (kind === 'raw-output') request.outputPath = '010_draw/new.json';
      else if (kind === 'existing-output') await fs.writeFile(outputFile, 'Preserve existing result.');
      else request.outputPath = request.inputPath;
      const projectBefore = await inventory(projectRoot), externalBefore = await inventory(external);

      await assert.rejects(store.predict(request), error => structuredError(error));
      assert.deepEqual(await inventory(projectRoot), projectBefore, 'failed prediction preserves all project files and directories');
      assert.deepEqual(await inventory(external), externalBefore, 'external originals are preserved and no output escapes');
    });
  }
});

test('MP06 execution and output validation failures leave no partial result or input changes', async t => {
  const cases = [
    ['throw', "export function predict(rows) { if (rows.some(row => Number(row.x) !== 1)) throw new Error('Synthetic failure'); return rows.map(() => ({prediction:1})); }", 'MODEL_EXECUTION_FAILED'],
    ['missing-output', 'export function predict(rows) { return rows.map(row => Number(row.x) === 1 ? {prediction:1} : {different:7}); }', 'MODEL_OUTPUT_INVALID'],
    ['nonnumeric-output', "export function predict(rows) { return rows.map(row => ({prediction:Number(row.x) === 1 ? 1 : 'bad'})); }", 'MODEL_OUTPUT_INVALID'],
    ['wrong-row-count', 'export function predict(rows) { return rows.length === 1 ? [{prediction:1}] : []; }', 'MODEL_OUTPUT_INVALID'],
  ];
  for (const [label, program, code] of cases) {
    await t.test(label, async child => {
      const { store, projectRoot, request } = await predictionFixture(child, program);
      const before = await inventory(projectRoot);
      await assert.rejects(store.predict(request), error => structuredError(error, code));
      assert.deepEqual(await inventory(projectRoot), before);
      assert.deepEqual(await fs.readdir(path.join(projectRoot, '060_reports')), []);
    });
  }
});
