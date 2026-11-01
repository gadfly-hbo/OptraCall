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
  const routes = createPptRefinerRoutes({ deckRoot: dir, sessions, readBody: async () => ({}), allowedRoots: [dir, fixtures] });
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
      allowedRoots: [dir, fixtures],
    });
    await routes.create({ id: 'deck-render', sourcePptx: fixtureDeck, title: 'render', reportPath: fixtureReport });
    const rendered = await routes.render('deck-render');
    assert.ok(rendered.value.files.includes('slide-01.png'), JSON.stringify(rendered.value.files));
    const image = await routes.image('deck-render', 'thumb-01.png');
    assert.match(image.value.dataUrl, /^data:image\/png;base64,/);
    await assert.rejects(() => routes.image('deck-render', '../secret'), (e: unknown) => e instanceof RefinerApiFault && e.status === 400);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('api: dispatcher maps /api/ppt-refiner urls and faults', async () => {
  const dir = tempDir();
  try {
    const routes = setup(dir);
    const post = { method: 'POST' } as never;
    const created = await routes.routes(post, new URL('http://x/api/ppt-refiner/decks'));
    assert.equal(created?.status, 400, 'empty body must map to invalid_deck_id 400');
    const bad = await routes.routes(post, new URL('http://x/api/ppt-refiner/decks/deck-demo/locks'));
    assert.equal(bad?.status, 400, 'empty page must map to invalid_page 400');
    const missing = await routes.routes({ method: 'GET' } as never, new URL('http://x/api/ppt-refiner/decks/deck-missing'));
    assert.equal(missing?.status, 404, JSON.stringify(missing));
    const other = await routes.routes(post, new URL('http://x/api/other'));
    assert.equal(other, null);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('api: turn pre-check rejects locked referenced page without starting session', async () => {
  const dir = tempDir();
  try {
    let calls = 0;
    const routes = setup(dir, async () => { calls += 1; return { text: 'should not run' }; });
    await routes.create({ id: 'deck-lock', sourcePptx: fixtureDeck, title: 'lock', reportPath: fixtureReport });
    await routes.setLock('deck-lock', { page: 2, locked: true });
    await assert.rejects(() => routes.turn('deck-lock', { text: '修改第 2 页标题', requestId: 'r-lock' }), (e: unknown) => e instanceof Error && 'code' in e && e.code === 'PAGE_LOCKED');
    assert.equal(calls, 0, 'session must not start for locked page');
    const ok = await routes.turn('deck-lock', { text: '第 1 页不用改', requestId: 'r-ok' });
    assert.equal(calls, 1);
    assert.equal(ok.value.snapshot, null);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('api: turn outcome failed/cancelled maps status and still snapshots on change', async () => {
  const dir = tempDir();
  try {
    let mode = 'failed';
    const routes = setup(dir, async (deckDir) => {
      writeFileSync(path.join(deckDir, 'deck.pptx'), Buffer.concat([readFileSync(path.join(deckDir, 'deck.pptx')), Buffer.from('x')]));
      return { text: '部分完成', outcome: mode };
    });
    await routes.create({ id: 'deck-outcome', sourcePptx: fixtureDeck, title: 'outcome', reportPath: fixtureReport });
    const failed = await routes.turn('deck-outcome', { text: '改一点', requestId: 'r-failed' });
    assert.equal(failed.status, 422);
    assert.equal(failed.value.outcome, 'failed');
    assert.ok(failed.value.snapshot, 'modified deck must snapshot even on failed outcome');
    mode = 'cancelled';
    const cancelled = await routes.turn('deck-outcome', { text: '再改', requestId: 'r-cancelled' });
    assert.equal(cancelled.status, 409);
    assert.equal(cancelled.value.outcome, 'cancelled');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('api: slide guard restores locked page modified outside scripts and reports violation', async () => {
  const dir = tempDir();
  try {
    const routes = createPptRefinerRoutes({
      deckRoot: dir,
      sessions: { run: async (deckDir) => {
        // agent bypasses scripts: rewrites locked slide 2 directly via zip
        const { execFileSync } = await import('node:child_process');
        execFileSync(process.env.PPT_REPORT_PYTHON ?? 'python3', ['-c', `
import zipfile
p = ${JSON.stringify(path.join(deckDir, 'deck.pptx'))}
z = zipfile.ZipFile(p)
entries = {n: z.read(n) for n in z.namelist()}
entries['ppt/slides/slide2.xml'] = entries['ppt/slides/slide2.xml'].replace('长尾门店同比'.encode(), '违规改写'.encode())
with zipfile.ZipFile(p, 'w', zipfile.ZIP_DEFLATED) as out:
    for n, d in entries.items():
        out.writestr(n, d)
`]);
        return { text: '绕过脚本改了锁定页', outcome: 'completed' };
      }, stop: async () => {} },
      readBody: async () => ({}),
      skillScriptsDir: path.join(root, 'extensions/analysis-assets/ppt-report/scripts'),
      pythonPath: process.env.PPT_REPORT_PYTHON ?? 'python3',
      allowedRoots: [dir, fixtures],
      codeRoot: root,
    });
    await routes.create({ id: 'deck-guard', sourcePptx: fixtureDeck, title: 'guard', reportPath: fixtureReport });
    await routes.setLock('deck-guard', { page: 2, locked: true });
    const result = await routes.turn('deck-guard', { text: '做点什么', requestId: 'r-guard' });
    assert.deepEqual(result.value.violations, [{ page: 2, restored: true }]);
    const text = JSON.parse(spawnSync(process.env.PPT_REPORT_PYTHON ?? 'python3', ['-c', `import zipfile,re,json;z=zipfile.ZipFile(${JSON.stringify(path.join(dir, 'deck-guard', 'deck.pptx'))});x=z.read('ppt/slides/slide2.xml').decode('utf-8');print(json.dumps('违规改写' in x))`], { encoding: 'utf-8' }).stdout);
    assert.equal(text, false, 'locked slide must be restored to before-turn bytes');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('api: turn includes selected page in session text', async () => {
  const dir = tempDir();
  try {
    let seen = '';
    const routes = setup(dir, async (_deckDir, turn) => { seen = turn.text; return { text: 'ok' }; });
    await routes.create({ id: 'deck-page', sourcePptx: fixtureDeck, title: 'page', reportPath: fixtureReport });
    await routes.turn('deck-page', { text: '改标题', requestId: 'r-page', page: 3 });
    assert.match(seen, /当前选中第 3 页/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('api: paths outside allowed roots are rejected', async () => {
  const dir = tempDir();
  try {
    const routes = createPptRefinerRoutes({ deckRoot: dir, sessions: { run: async () => ({ text: '' }), stop: async () => {} }, readBody: async () => ({}), allowedRoots: [dir, fixtures] });
    await assert.rejects(() => routes.create({ id: 'deck-badpath', sourcePptx: '/etc/passwd', title: 'x', reportPath: fixtureReport }), (e: unknown) => e instanceof RefinerApiFault && e.code === 'path_not_allowed');
    await routes.create({ id: 'deck-goodpath', sourcePptx: fixtureDeck, title: 'x', reportPath: fixtureReport });
    await assert.rejects(() => routes.exportDeck('deck-goodpath', { outDir: '/etc' }), (e: unknown) => e instanceof RefinerApiFault && e.code === 'path_not_allowed');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
