import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, copyFileSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { createPptRefinerRoutes, RefinerApiFault, type RefinerSessionFacade } from '../extensions/business-plugins/ppt-refiner/api/routes.ts';
import { spawnSync } from 'node:child_process';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fixtures = path.join(root, 'tests/fixtures/ppt-report');
const fixtureDeck = path.join(fixtures, 'deck-good.pptx');
const fixtureReport = path.join(fixtures, 'report.md');
const tempDir = () => mkdtempSync(path.join(os.tmpdir(), 'ppt-refiner-api-'));

function setup(dir: string, runImpl?: RefinerSessionFacade['run']) {
  const sessions: RefinerSessionFacade = {
    run: runImpl ?? (async () => ({ text: '未修改' })),
    stop: async () => {},
  };
  const routes = createPptRefinerRoutes({ deckRoot: dir, sessions, readBody: async () => ({}) });
  return routes;
}

test('api: create/get/lock/revert/export lifecycle with mapped faults', async () => {
  const dir = tempDir();
  try {
    const routes = setup(dir);
    const created = await routes.create({ id: 'deck-demo', sourcePptx: fixtureDeck, title: '演示', reportPath: fixtureReport });
    assert.equal(created.status, 201);
    const got = await routes.get('deck-demo');
    assert.equal(got.value.meta.title, '演示');
    await routes.setLock('deck-demo', { page: 2, locked: true });
    assert.deepEqual((await routes.get('deck-demo')).value.meta.lockedPages, [2]);
    await routes.revert('deck-demo', { version: 1 });
    assert.equal((await routes.get('deck-demo')).value.versions.length, 2);
    const out = await routes.exportDeck('deck-demo', { outDir: path.join(dir, 'out'), fileName: 'final.pptx' });
    assert.ok(existsSync(out.value.pptx));
    await assert.rejects(() => routes.setLock('bad id', { page: 1 }), (e: unknown) => e instanceof RefinerApiFault && e.status === 400);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('api: turn snapshots only on byte change and captures last-turn.json diffs', async () => {
  const dir = tempDir();
  try {
    let call = 0;
    const routes = setup(dir, async (deckDir, turn) => {
      call += 1;
      if (turn.text.includes('改')) {
        const deck = path.join(deckDir, 'deck.pptx');
        copyFileSync(deck, deck);
        writeFileSync(deck, readFileSync(deck));
        // simulate agent edit: append one byte to change hash
        writeFileSync(deck, Buffer.concat([readFileSync(deck), Buffer.from('x')]));
        writeFileSync(path.join(deckDir, 'last-turn.json'), JSON.stringify({ pages: [2], diffs: [{ page: 2, kind: 'wording', summary: '标题改写', anchor: 'none' }] }));
      }
      return { text: '完成' };
    });
    await routes.create({ id: 'deck-turn', sourcePptx: fixtureDeck, title: 'turn', reportPath: fixtureReport });
    const first = await routes.turn('deck-turn', { text: '改标题', requestId: 'r1' });
    assert.ok(first.value.snapshot, 'byte change must snapshot');
    assert.deepEqual(first.value.snapshot.pages, [2]);
    assert.equal(first.value.snapshot.diffs[0].summary, '标题改写');
    assert.equal(existsSync(path.join(dir, 'deck-turn', 'last-turn.json')), false, 'turn record consumed');
    const second = await routes.turn('deck-turn', { text: '只是问问', requestId: 'r2' });
    assert.equal(second.value.snapshot, null, 'no byte change no snapshot');
    assert.equal(call, 2);
    const exported = await routes.exportDeck('deck-turn', { outDir: path.join(dir, 'out2') });
    const diff = readFileSync(exported.value.diff, 'utf-8');
    assert.match(diff, /标题改写/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('api: render produces page images and image endpoint returns data url', { skip: spawnSync(process.env.PPT_REPORT_PYTHON ?? 'python3', ['-c', 'import pypdfium2'], { encoding: 'utf-8' }).status !== 0 }, async () => {
  const dir = tempDir();
  try {
    const routes = createPptRefinerRoutes({
      deckRoot: dir,
      sessions: { run: async () => ({ text: '' }), stop: async () => {} },
      readBody: async () => ({}),
      skillScriptsDir: path.join(root, 'extensions/analysis-assets/ppt-report/scripts'),
      pythonPath: process.env.PPT_REPORT_PYTHON ?? 'python3',
    });
    await routes.create({ id: 'deck-render', sourcePptx: fixtureDeck, title: 'render', reportPath: fixtureReport });
    const rendered = await routes.render('deck-render');
    assert.ok(rendered.value.files.includes('slide-01.png'), JSON.stringify(rendered.value.files));
    const image = await routes.image('deck-render', 'thumb-01.png');
    assert.match(image.value.dataUrl, /^data:image\/png;base64,/);
    await assert.rejects(() => routes.image('deck-render', '../secret'), (e: unknown) => e instanceof RefinerApiFault && e.status === 400);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
