import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { ProjectStore, type ProjectConfiguration } from '../src/host/project-store.ts';
import { createPptRefinerAccess, RefinerAccessFault } from '../src/host/ppt-refiner-access.ts';
import { createDeckStore } from '../extensions/business-plugins/ppt-refiner/storage/deck-store.ts';

const fixtureDeck = fileURLToPath(new URL('./fixtures/ppt-report/deck-good.pptx', import.meta.url));
const configuration: ProjectConfiguration = { id: 'synthetic-project-model-a', revision: 7, name: 'Synthetic model A', provider: 'synthetic-provider', model: 'synthetic-text-only-a', baseUrl: 'http://127.0.0.1:1/v1', api: 'openai-completions' };
const otherConfiguration: ProjectConfiguration = { ...configuration, id: 'synthetic-project-model-b', revision: 9, name: 'Synthetic model B', model: 'synthetic-text-only-b' };

async function setup(t: TestContext) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ppt-refiner-access-'));
  const projects = new ProjectStore({ dataRoot: path.join(root, 'private'), projectsRoot: path.join(root, 'projects') });
  await projects.init();
  t.after(async () => { await projects.close(); await fs.rm(root, { recursive: true, force: true }); });
  const project = await projects.create({ name: 'Synthetic project A', configuration });
  const other = await projects.create({ name: 'Synthetic project B', configuration: otherConfiguration });
  const deckRoot = path.join(root, 'decks');
  const source = path.join(project.rootPath, '060_reports/candidate.pptx'), report = path.join(project.rootPath, '060_reports/report.md');
  await fs.copyFile(fixtureDeck, source); await fs.writeFile(report, '# Synthetic report\n\nThe reported value is 42.\n');
  await fs.copyFile(fixtureDeck, path.join(other.rootPath, '060_reports/other-only.pptx'));
  await fs.writeFile(path.join(other.rootPath, '060_reports/other-only.md'), '# Other synthetic report\n');
  const access = createPptRefinerAccess({ projects, deckRoot, assertActive(value) { if (value.archivedAt !== null) throw new RefinerAccessFault('project_archived', 409, 'Synthetic archived project.'); } });
  const input = { projectId: project.id, sourcePptx: '060_reports/candidate.pptx', reportPath: '060_reports/report.md', title: 'Synthetic deck' };
  const seed = (id: string, anchor = report, bound?: { id: string; revision?: number }) => {
    const store = createDeckStore(path.join(deckRoot, id));
    store.register({ sourcePptx: source, title: 'Synthetic deck', reportPath: anchor, ...(bound ? { configuration: bound } : {}) });
    return store;
  };
  return { root, projects, project, other, deckRoot, source, report, access, input, seed };
}

async function deckBytes(directory: string): Promise<Map<string, Buffer>> {
  const files = new Map<string, Buffer>();
  async function visit(current: string, prefix = ''): Promise<void> {
    for (const entry of await fs.readdir(current, { withFileTypes: true })) {
      const relative = prefix + entry.name;
      if (entry.isDirectory()) await visit(path.join(current, entry.name), relative + '/');
      else files.set(relative, await fs.readFile(path.join(current, entry.name)));
    }
  }
  await visit(directory);
  return files;
}

test('refiner access binds real project-relative reports and the fixed project configuration', async t => {
  const { access, input, project, other, source, report, seed } = await setup(t);
  const sourceBytes = await fs.readFile(source), reportBytes = await fs.readFile(report);
  const trusted = await access.create(input);
  assert.equal(trusted.sourcePptx, source); assert.equal(trusted.reportPath, report);
  assert.deepEqual(trusted.configuration, { id: configuration.id, revision: configuration.revision });
  assert.notDeepEqual(trusted.configuration, { id: other.configuration.id, revision: other.configuration.revision }, 'another/global selection cannot replace the report project snapshot');
  seed('deck-bound', trusted.reportPath, trusted.configuration);
  const read = await access.read('deck-bound');
  assert.equal(read.projectId, project.id); assert.equal(read.projectName, project.name); assert.equal(read.readOnly, false);
  assert.equal(read.exportDirectory, path.join(project.rootPath, '060_reports'));
  assert.equal(read.imageInputSupported, false, 'an unknown synthetic text model must not be promoted to an image model');
  assert.deepEqual(await access.resolveOwner('deck-bound'), { projectId: project.id, configuration: trusted.configuration });
  assert.equal(await access.belongsToProject('deck-bound', project.id), true);
  assert.equal(await access.belongsToProject('deck-bound', other.id), false);
  assert.deepEqual(await fs.readFile(source), sourceBytes); assert.deepEqual(await fs.readFile(report), reportBytes);
});

test('refiner access rejects client model overrides and absolute/raw/cross-project paths', async t => {
  const { access, input, project, other, source, report } = await setup(t);
  for (const invalid of [
    { ...input, configuration: { id: otherConfiguration.id, revision: otherConfiguration.revision } },
    { ...input, projectId: undefined },
    { ...input, sourcePptx: source },
    { ...input, reportPath: report },
    { ...input, sourcePptx: '010_draw/candidate.pptx' },
    { ...input, reportPath: '010_draw/report.md' },
    { ...input, sourcePptx: '060_reports/sub/../candidate.pptx' },
    { ...input, reportPath: '060_reports/../010_draw/report.md' },
    { ...input, sourcePptx: '060_reports\\candidate.pptx' },
    { ...input, reportPath: '060_reports/report.md\0' },
    { ...input, sourcePptx: '060_reports/report.md' },
    { ...input, reportPath: '060_reports/candidate.pptx' },
    { ...input, sourcePptx: path.join(other.rootPath, '060_reports/other-only.pptx') },
    { ...input, sourcePptx: '060_reports/other-only.pptx' },
    { ...input, reportPath: '060_reports/other-only.md' },
  ]) await assert.rejects(() => access.create(invalid), error => error instanceof RefinerAccessFault && error.status === 400);
  assert.equal((await access.create(input)).sourcePptx, path.join(project.rootPath, input.sourcePptx));
});

test('refiner access refuses symbolic/hard-linked sources and report anchors', async t => {
  const { root, access, input, project, other } = await setup(t);
  const outsideDeck = path.join(root, 'outside.pptx'), outsideReport = path.join(root, 'outside.md');
  await fs.copyFile(fixtureDeck, outsideDeck); await fs.writeFile(outsideReport, '# Synthetic outside anchor');
  const beforeDeck = await fs.readFile(outsideDeck), beforeReport = await fs.readFile(outsideReport);
  for (const kind of ['symbolic', 'hard'] as const) {
    const linkedDeck = '060_reports/' + kind + '.pptx', linkedReport = '060_reports/' + kind + '.md';
    if (kind === 'symbolic') {
      await fs.symlink(outsideDeck, path.join(project.rootPath, linkedDeck));
      await fs.symlink(outsideReport, path.join(project.rootPath, linkedReport));
    } else {
      await fs.link(outsideDeck, path.join(project.rootPath, linkedDeck));
      await fs.link(outsideReport, path.join(project.rootPath, linkedReport));
    }
    await assert.rejects(() => access.create({ ...input, sourcePptx: linkedDeck }), error => error instanceof RefinerAccessFault && error.code === 'path_not_allowed');
    await assert.rejects(() => access.create({ ...input, reportPath: linkedReport }), error => error instanceof RefinerAccessFault && error.code === 'path_not_allowed');
  }
  await fs.symlink(path.join(other.rootPath, '060_reports'), path.join(project.rootPath, '060_reports/other-project'));
  await assert.rejects(() => access.create({ ...input, sourcePptx: '060_reports/other-project/other-only.pptx', reportPath: '060_reports/other-project/other-only.md' }), error => error instanceof RefinerAccessFault && error.code === 'path_not_allowed');
  assert.deepEqual(await fs.readFile(outsideDeck), beforeDeck); assert.deepEqual(await fs.readFile(outsideReport), beforeReport);
});

test('refiner access resolves legacy unbound metadata without rewriting its bytes', async t => {
  const { access, project, deckRoot, seed } = await setup(t);
  seed('deck-legacy');
  const directory = path.join(deckRoot, 'deck-legacy'), before = await deckBytes(directory);
  const read = await access.read('deck-legacy');
  assert.equal(read.projectId, project.id); assert.equal(read.readOnly, false);
  assert.deepEqual(read.configuration, { id: configuration.id, revision: configuration.revision });
  assert.deepEqual(await access.resolveOwner('deck-legacy'), { projectId: project.id, configuration: read.configuration });
  assert.deepEqual(await deckBytes(directory), before, 'reading/qualifying old metadata must not silently migrate or bind it on disk');
});

test('refiner access preserves unresolved source decks as read-only without a global fallback', async t => {
  const { access, root, deckRoot, seed } = await setup(t);
  const outside = path.join(root, 'unknown-report.md'); await fs.writeFile(outside, '# Synthetic unowned report');
  seed('deck-unresolved', outside);
  const directory = path.join(deckRoot, 'deck-unresolved'), before = await deckBytes(directory);
  const read = await access.read('deck-unresolved');
  assert.equal(read.readOnly, true); assert.equal(read.reason, 'deck_project_unresolved');
  assert.equal(read.projectId, undefined); assert.equal(read.configuration, undefined); assert.equal(read.imageInputSupported, false);
  await assert.rejects(() => access.resolveOwner('deck-unresolved'), error => error instanceof RefinerAccessFault && error.status === 409);
  assert.deepEqual(await deckBytes(directory), before);
});

test('refiner access keeps mismatched model identity/revision metadata read-only and intact', async t => {
  const { access, deckRoot, seed } = await setup(t);
  const bindings = [
    { id: otherConfiguration.id, revision: otherConfiguration.revision },
    { id: configuration.id, revision: configuration.revision + 1 },
    { id: configuration.id },
  ];
  for (const [index, binding] of bindings.entries()) {
    const id = 'deck-mismatch-' + index; seed(id, undefined, binding);
    const directory = path.join(deckRoot, id), before = await deckBytes(directory);
    const read = await access.read(id);
    assert.equal(read.readOnly, true); assert.equal(read.reason, 'deck_configuration_mismatch');
    await assert.rejects(() => access.resolveOwner(id), error => error instanceof RefinerAccessFault && error.code === 'deck_configuration_mismatch');
    assert.deepEqual(await deckBytes(directory), before);
  }
});

test('refiner access rechecks removed or replaced report anchors before granting an owner', async t => {
  const { access, project, report, deckRoot, seed } = await setup(t);
  seed('deck-changing');
  const directory = path.join(deckRoot, 'deck-changing'), before = await deckBytes(directory);
  const originalReport = await fs.readFile(report);
  await fs.unlink(report);
  let read = await access.read('deck-changing');
  assert.equal(read.readOnly, true); assert.equal(read.reason, 'deck_project_unresolved');
  await fs.writeFile(report, originalReport);
  const retained = path.join(project.rootPath, '060_reports/retained-anchor.md');
  await fs.rename(report, retained); await fs.symlink(retained, report);
  read = await access.read('deck-changing');
  assert.equal(read.readOnly, true); assert.equal(read.reason, 'deck_project_unresolved');
  await assert.rejects(() => access.resolveOwner('deck-changing'), error => error instanceof RefinerAccessFault && error.status === 409);
  await fs.unlink(report); await fs.link(retained, report);
  read = await access.read('deck-changing');
  assert.equal(read.readOnly, true); assert.equal(read.reason, 'deck_project_unresolved');
  assert.deepEqual(await deckBytes(directory), before);
  assert.deepEqual(await fs.readFile(retained), originalReport);
});

test('refiner access makes archived projects read-only and refuses new or resumed writes', async t => {
  const { access, input, projects, project, deckRoot, seed } = await setup(t);
  seed('deck-archived');
  const directory = path.join(deckRoot, 'deck-archived'), before = await deckBytes(directory);
  await projects.archive(project.id);
  const read = await access.read('deck-archived');
  assert.equal(read.projectId, project.id); assert.equal(read.readOnly, true); assert.equal(read.reason, 'project_archived');
  assert.equal(await access.belongsToProject('deck-archived', project.id), true, 'read-only ownership remains available for scoped cleanup');
  await assert.rejects(() => access.create(input), error => error instanceof RefinerAccessFault && error.code === 'project_archived');
  await assert.rejects(() => access.resolveOwner('deck-archived'), error => error instanceof RefinerAccessFault && error.code === 'project_archived');
  assert.deepEqual(await deckBytes(directory), before);
});
