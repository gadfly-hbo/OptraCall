import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync, copyFileSync, mkdirSync, symlinkSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { createPptRefinerRoutes, RefinerApiFault, type PptRefinerRoutesOptions, type RefinerSessionLease } from '../extensions/business-plugins/ppt-refiner/api/routes.ts';
import { spawnSync } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fixtures = path.join(root, 'tests/fixtures/ppt-report');
const fixtureDeck = path.join(fixtures, 'deck-good.pptx');
const fixtureReport = path.join(fixtures, 'report.md');
const tempDir = () => mkdtempSync(path.join(os.tmpdir(), 'ppt-refiner-api-'));

type Run = (deckDir: string, turn: { text: string; requestId: string }) => ReturnType<RefinerSessionLease['run']>;
function setup(dir: string, runImpl: Run = async () => ({ text: '未修改' }), overrides: Partial<PptRefinerRoutesOptions> = {}) {
  const occupied = new Set<string>();
  const busy = () => Object.assign(new Error('busy'), { code: 'session_busy' });
  return createPptRefinerRoutes({ deckRoot: dir, readBody: async () => ({}), codeRoot: root, pythonPath: process.env.PPT_REPORT_PYTHON ?? 'python3',
    registerDeck: async (input, use) => {
      if (input.sourcePptx !== fixtureDeck || input.reportPath !== fixtureReport) throw new RefinerApiFault(400, 'path_not_allowed', 'Fixture source not allowed');
      return use({ sourcePptx: fixtureDeck, reportPath: fixtureReport, configuration: { id: 'a', revision: 1 } });
    },
    resolveAccess: async () => ({ projectId: 'project-a', projectName: 'Fixture project', readOnly: false, imageInputSupported: true, exportDirectory: path.join(dir, 'out') }),
    sessions: {
      async withSession(deckDir, use) {
        if (occupied.has(deckDir)) throw busy(); occupied.add(deckDir); let active = true;
        try { return await use({ run: turn => runImpl(deckDir, turn), isCurrent: () => active, commit: async operation => { if (!active) throw Object.assign(new Error('expired'), { code: 'generation_cancelled' }); return operation(); } }); }
        finally { active = false; occupied.delete(deckDir); }
      },
      async mutate(deckDir, use) { if (occupied.has(deckDir)) throw busy(); return use(); },
      busy: deckDir => occupied.has(deckDir), stop: async () => {},
    }, ...overrides,
  });
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
    await assert.rejects(routes.revert('deck-demo', { version: 1 }), { code: 'PAGE_LOCKED' });
    await routes.setLock('deck-demo', { page: 2, locked: false });
    await routes.revert('deck-demo', { version: 1 });
    assert.equal((await routes.get('deck-demo')).value.versions.length, 2);
    const out = await routes.exportDeck('deck-demo', { fileName: 'final.pptx' });
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
    const exported = await routes.exportDeck('deck-turn', {});
    const diff = readFileSync(exported.value.diff, 'utf-8');
    assert.match(diff, /标题改写/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('api: render produces page images and image endpoint returns data url', { skip: spawnSync(process.env.PPT_REPORT_PYTHON ?? 'python3', ['-c', 'import pypdfium2'], { encoding: 'utf-8' }).status !== 0 }, async () => {
  const dir = tempDir();
  try {
    const routes = setup(dir, undefined, {
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
    let mode: 'failed' | 'cancelled' = 'failed';
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
    const routes = setup(dir, async (deckDir) => {
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
      }, {
      skillScriptsDir: path.join(root, 'extensions/analysis-assets/ppt-report/scripts'),
      pythonPath: process.env.PPT_REPORT_PYTHON ?? 'python3',
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
    const routes = setup(dir);
    await assert.rejects(() => routes.create({ id: 'deck-badpath', sourcePptx: '/etc/passwd', title: 'x', reportPath: fixtureReport }), (e: unknown) => e instanceof RefinerApiFault && e.code === 'path_not_allowed');
    await routes.create({ id: 'deck-goodpath', sourcePptx: fixtureDeck, title: 'x', reportPath: fixtureReport });
    await assert.rejects(() => routes.exportDeck('deck-goodpath', { outDir: '/etc' }), (e: unknown) => e instanceof RefinerApiFault && e.code === 'path_not_allowed');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('api: slide guard also restores modified slide rels of locked page', async () => {
  const dir = tempDir();
  try {
    const routes = setup(dir, async (deckDir) => {
        const { execFileSync } = await import('node:child_process');
        execFileSync(process.env.PPT_REPORT_PYTHON ?? 'python3', ['-c', `
import zipfile
p = ${JSON.stringify(path.join(deckDir, 'deck.pptx'))}
z = zipfile.ZipFile(p)
entries = {n: z.read(n) for n in z.namelist()}
rels = 'ppt/slides/_rels/slide2.xml.rels'
entries[rels] = entries[rels].replace(b'rId1', b'rHacked')
with zipfile.ZipFile(p, 'w', zipfile.ZIP_DEFLATED) as out:
    for n, d in entries.items():
        out.writestr(n, d)
`]);
        return { text: '改了 rels', outcome: 'completed' };
      }, {
      pythonPath: process.env.PPT_REPORT_PYTHON ?? 'python3',
      codeRoot: root,
    });
    await routes.create({ id: 'deck-rels', sourcePptx: fixtureDeck, title: 'rels', reportPath: fixtureReport });
    await routes.setLock('deck-rels', { page: 2, locked: true });
    const result = await routes.turn('deck-rels', { text: '改点东西', requestId: 'r-rels' });
    assert.deepEqual(result.value.violations, [{ page: 2, restored: true }]);
    const after = JSON.parse(spawnSync(process.env.PPT_REPORT_PYTHON ?? 'python3', ['-c', `import zipfile,json;z=zipfile.ZipFile(${JSON.stringify(path.join(dir, 'deck-rels', 'deck.pptx'))});print(json.dumps('rHacked' in z.read('ppt/slides/_rels/slide2.xml.rels').decode('utf-8')))`], { encoding: 'utf-8' }).stdout);
    assert.equal(after, false);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('api: thrown session failure still snapshots modified deck and cleans before-copy', async () => {
  const dir = tempDir();
  try {
    const routes = setup(dir, async (deckDir) => {
      writeFileSync(path.join(deckDir, 'deck.pptx'), Buffer.concat([readFileSync(path.join(deckDir, 'deck.pptx')), Buffer.from('x')]));
      throw new Error('session exploded');
    });
    await routes.create({ id: 'deck-thrown', sourcePptx: fixtureDeck, title: 'thrown', reportPath: fixtureReport });
    const result = await routes.turn('deck-thrown', { text: '改一下', requestId: 'r-thrown' });
    assert.equal(result.status, 500);
    assert.ok(result.value.snapshot, 'modified deck must snapshot even when session throws');
    assert.equal(existsSync(path.join(dir, 'deck-thrown', '.before-r-thrown.pptx')), false, 'before-copy must be removed');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('api: export outDir symlink escape is rejected', async () => {
  const dir = tempDir();
  try {
    const routes = setup(dir);
    await routes.create({ id: 'deck-symlink', sourcePptx: fixtureDeck, title: 'x', reportPath: fixtureReport });
    const { symlinkSync } = await import('node:fs');
    symlinkSync('/tmp', path.join(dir, 'escape'));
    await assert.rejects(() => routes.exportDeck('deck-symlink', { outDir: path.join(dir, 'escape') }), (e: unknown) => e instanceof RefinerApiFault && e.code === 'path_not_allowed');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('api: repeated revert restores undone version diff into export', async () => {
  const dir = tempDir();
  try {
    const { createDeckStore } = await import('../extensions/business-plugins/ppt-refiner/storage/deck-store.ts');
    const store = createDeckStore(path.join(dir, 'deck-revert2'));
    store.register({ sourcePptx: fixtureDeck, title: 'revert2', reportPath: fixtureReport });
    store.snapshot({ pages: [2], summary: 'v2 diff', diffs: [{ page: 2, kind: 'wording', summary: 'v2 改动', anchor: 'none' }] });
    store.revert(1);
    store.revert(2);
    const out = store.exportFinal({ outDir: path.join(dir, 'out') });
    assert.match(readFileSync(out.diff, 'utf-8'), /v2 改动/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('api: mapFault maps session_busy to 409', () => {
  const dir = tempDir();
  try {
    const routes = setup(dir);
    const mapped = routes.mapFault(Object.assign(new Error('busy'), { code: 'session_busy' }));
    assert.equal(mapped.status, 409);
    assert.equal(mapped.code, 'session_busy');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('api: a busy competing turn cannot delete the active turn difference record', async () => {
  const dir = tempDir(); let release!: () => void, entered!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  const started = new Promise<void>(resolve => { entered = resolve; });
  let busy = false;
  try {
    const routes = setup(dir, async deckDir => {
      if (busy) throw Object.assign(new Error('busy'), { code: 'session_busy' });
      busy = true;
      const deck = path.join(deckDir, 'deck.pptx');
      writeFileSync(deck, Buffer.concat([readFileSync(deck), Buffer.from('changed')]));
      writeFileSync(path.join(deckDir, 'last-turn.json'), JSON.stringify({ pages: [2], diffs: [{ page: 2, kind: 'wording', summary: 'ACTIVE_DIFFERENCE', anchor: 'none' }] }));
      entered(); await held; busy = false; return { text: 'done' };
    });
    await routes.create({ id: 'deck-busy', sourcePptx: fixtureDeck, title: 'busy', reportPath: fixtureReport });
    const first = routes.turn('deck-busy', { text: 'first', requestId: 'first' }); await started;
    const inFlight = await routes.get('deck-busy');
    assert.equal(inFlight.value.busy, true); assert.equal(inFlight.value.protectionFailed, false, 'a live operation before-copy is not a failed protection');
    const second = routes.turn('deck-busy', { text: 'second', requestId: 'second' });
    await assert.rejects(second, (error: unknown) => error instanceof Error && 'code' in error && error.code === 'session_busy');
    release(); const result = await first;
    assert.equal(result.value.snapshot?.diffs[0]?.summary, 'ACTIVE_DIFFERENCE');
  } finally { release?.(); rmSync(dir, { recursive: true, force: true }); }
});

test('api: malformed model output fails protection and preserves the before deck', async () => {
  const dir = tempDir();
  try {
    const routes = setup(dir, async deckDir => { writeFileSync(path.join(deckDir, 'deck.pptx'), 'invalid zip'); return { text: 'done' }; });
    await routes.create({ id: 'deck-invalid', sourcePptx: fixtureDeck, title: 'invalid', reportPath: fixtureReport });
    const result = await routes.turn('deck-invalid', { text: 'change', requestId: 'invalid' });
    assert.equal(result.status, 422); assert.equal(result.value.outcome, 'failed'); assert.equal(result.value.snapshot, null);
    assert.ok(readdirSync(path.join(dir, 'deck-invalid')).some(name => name.startsWith('.before-')));
    assert.equal((await routes.get('deck-invalid')).value.protectionFailed, true);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('api: inspect can read a locked page while rejecting any model edits', async () => {
  const dir = tempDir(); let calls = 0;
  try {
    const routes = setup(dir, async () => { calls++; return { text: '只读检查完成' }; });
    await routes.create({ id: 'deck-inspect', sourcePptx: fixtureDeck, title: 'inspect', reportPath: fixtureReport });
    await routes.setLock('deck-inspect', { page: 2, locked: true });
    const result = await routes.turn('deck-inspect', { text: '只检查', requestId: 'inspect', page: 2, mode: 'inspect' });
    assert.equal(result.status, 200); assert.equal(calls, 1); assert.equal(result.value.snapshot, null);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('api: unavailable guard fails before dispatch, quarantines writes and explicit valid revert preserves the failure evidence', async () => {
  const dir = tempDir(); let calls = 0;
  try {
    const routes = setup(dir, async () => { calls++; return { text: 'must not run' }; }, { pythonPath: path.join(dir, 'missing-python') });
    await routes.create({ id: 'deck-no-guard', sourcePptx: fixtureDeck, title: 'guard unavailable', reportPath: fixtureReport });
    const result = await routes.turn('deck-no-guard', { text: 'change', requestId: '../../unsafe-request-name' });
    assert.equal(result.status, 422); assert.equal(calls, 0); assert.ok('protection' in result.value); assert.equal(result.value.protection.status, 'unknown');
    assert.equal((await routes.get('deck-no-guard')).value.protectionFailed, true);
    await assert.rejects(routes.turn('deck-no-guard', { text: 'retry', requestId: 'later' }), { code: 'protection_failed' });
    await assert.rejects(routes.exportDeck('deck-no-guard', {}), { code: 'protection_failed' });
    const recovered = setup(dir); await recovered.revert('deck-no-guard', { version: 1 });
    assert.equal((await recovered.get('deck-no-guard')).value.protectionFailed, false);
    const names = readdirSync(path.join(dir, 'deck-no-guard'));
    assert.ok(names.some(name => name.startsWith('.recovered-before-'))); assert.ok(names.some(name => name.startsWith('.protection-resolved-')));
    assert.equal(calls, 0, 'revert performs no model request');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('api: inspect writes are rolled back as a whole and retained as rejected evidence', async () => {
  const dir = tempDir();
  try {
    const routes = setup(dir, async deckDir => { writeFileSync(path.join(deckDir, 'deck.pptx'), Buffer.concat([readFileSync(path.join(deckDir, 'deck.pptx')), Buffer.from('unwanted write')])); return { text: 'modified during inspection' }; });
    await routes.create({ id: 'deck-inspect-write', sourcePptx: fixtureDeck, title: 'inspect', reportPath: fixtureReport });
    const result = await routes.turn('deck-inspect-write', { text: 'inspect only', requestId: 'inspect', mode: 'inspect', page: 1 });
    assert.equal(result.status, 409); assert.equal(result.value.outcome, 'failed'); assert.ok('protection' in result.value); assert.equal(result.value.protection.status, 'restored');
    assert.deepEqual(readFileSync(path.join(dir, 'deck-inspect-write/deck.pptx')), readFileSync(fixtureDeck));
    assert.ok(readdirSync(path.join(dir, 'deck-inspect-write')).some(name => name.startsWith('.rejected-')));
    assert.equal((await routes.get('deck-inspect-write')).value.versions.length, 1);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('api: an unsupported image model declines visual inspection without opening a model or creating protection files', async () => {
  const dir = tempDir(); let calls = 0;
  try {
    const routes = setup(dir, async () => { calls++; return { text: 'must not run' }; }, { resolveAccess: async () => ({ readOnly: false, imageInputSupported: false, exportDirectory: path.join(dir, 'out') }) });
    await routes.create({ id: 'deck-text-model', sourcePptx: fixtureDeck, title: 'text', reportPath: fixtureReport });
    await assert.rejects(routes.turn('deck-text-model', { text: 'inspect', requestId: 'inspect', mode: 'inspect', visual: true }), { code: 'image_input_unsupported' });
    assert.equal(calls, 0); assert.equal(readdirSync(path.join(dir, 'deck-text-model')).filter(name => name.startsWith('.before-')).length, 0);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('api: a text-only project model can inspect locked page text without changing or unlocking it', async () => {
  const dir = tempDir(); let calls = 0;
  try {
    const routes = setup(dir, async () => { calls++; return { text: '只读文本检查完成' }; }, { resolveAccess: async () => ({ readOnly: false, imageInputSupported: false, exportDirectory: path.join(dir, 'out') }) });
    await routes.create({ id: 'deck-text-check', sourcePptx: fixtureDeck, title: 'text inspect', reportPath: fixtureReport });
    await routes.setLock('deck-text-check', { page: 2, locked: true });
    const before = readFileSync(path.join(dir, 'deck-text-check/deck.pptx'));
    const result = await routes.turn('deck-text-check', { text: '只读核对本页文字', requestId: 'text-check', page: 2, mode: 'inspect' });
    assert.equal(result.status, 200); assert.equal(calls, 1);
    assert.deepEqual(readFileSync(path.join(dir, 'deck-text-check/deck.pptx')), before);
    assert.deepEqual((await routes.get('deck-text-check')).value.meta.lockedPages, [2]);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('api: page-image reads reject a symlinked cache directory', async () => {
  const dir = tempDir();
  try {
    const routes = setup(dir); await routes.create({ id: 'deck-images', sourcePptx: fixtureDeck, title: 'images', reportPath: fixtureReport });
    const outside = path.join(dir, 'outside'); mkdirSync(outside); writeFileSync(path.join(outside, 'slide-01.png'), 'synthetic secret');
    symlinkSync(outside, path.join(dir, 'deck-images/pages'));
    await assert.rejects(routes.image('deck-images', 'slide-01.png'), { code: 'unsafe_file_path' });
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('api: changed content without valid machine differences stays explicitly unknown and preserves the invalid record', async () => {
  const dir = tempDir();
  try {
    const routes = setup(dir, async deckDir => {
      const result = spawnSync(process.env.PPT_REPORT_PYTHON ?? 'python3', ['-c', `
import zipfile
p = ${JSON.stringify(path.join(dir, 'deck-unknown-diff/deck.pptx'))}
with zipfile.ZipFile(p) as z:
    entries = {name:z.read(name) for name in z.namelist()}
entries['ppt/slides/slide2.xml'] = entries['ppt/slides/slide2.xml'].replace('长尾门店同比'.encode(), '已改内容但机器记录损坏'.encode())
with zipfile.ZipFile(p, 'w', zipfile.ZIP_DEFLATED) as z:
    for name,data in entries.items(): z.writestr(name,data)
`], { encoding: 'utf8' });
      assert.equal(result.status, 0, result.stderr);
      writeFileSync(path.join(deckDir, 'last-turn.json'), '{invalid');
      return { text: '已修改' };
    });
    await routes.create({ id: 'deck-unknown-diff', sourcePptx: fixtureDeck, title: 'unknown', reportPath: fixtureReport });
    const result = await routes.turn('deck-unknown-diff', { text: '改标题', requestId: 'unknown' });
    assert.equal(result.status, 200); assert.equal(result.value.snapshot?.diffsKnown, false);
    const exported = await routes.exportDeck('deck-unknown-diff', {});
    assert.equal(exported.value.diffHistoryKnown, false);
    assert.ok(readdirSync(path.join(dir, 'deck-unknown-diff')).some(name => name.startsWith('.invalid-turn-')));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('api: asynchronous rendering does not block edits and refuses to publish stale images', async () => {
  const dir = tempDir(), renderer = path.join(dir, 'renderer'), started = path.join(dir, 'render-started'), release = path.join(dir, 'render-release');
  mkdirSync(renderer);
  writeFileSync(path.join(renderer, 'page_images.py'), `import argparse,pathlib,time,sys
ap=argparse.ArgumentParser(); ap.add_argument('--deck'); ap.add_argument('--out'); a=ap.parse_args()
pathlib.Path(${JSON.stringify(started)}).write_text('started')
deadline=time.monotonic()+5
while not pathlib.Path(${JSON.stringify(release)}).exists():
    if time.monotonic()>deadline: sys.exit(2)
    time.sleep(.01)
p=pathlib.Path(a.out); p.mkdir(parents=True); (p/'slide-01.png').write_bytes(b'synthetic-image')
`);
  try {
    const routes = setup(dir, async deckDir => { writeFileSync(path.join(deckDir, 'deck.pptx'), Buffer.concat([readFileSync(path.join(deckDir, 'deck.pptx')), Buffer.from('edit-during-render')])); return { text: 'edited' }; }, { skillScriptsDir: renderer });
    await routes.create({ id: 'deck-stale-render', sourcePptx: fixtureDeck, title: 'render', reportPath: fixtureReport });
    const rendering = routes.render('deck-stale-render'), rejected = assert.rejects(rendering, { code: 'deck_changed' });
    for (let n = 0; n < 200 && !existsSync(started); n++) await delay(10);
    assert.ok(existsSync(started));
    const changed = await routes.turn('deck-stale-render', { text: 'edit', requestId: 'edit' }); assert.equal(changed.status, 200);
    writeFileSync(release, 'continue'); await rejected;
    assert.equal(existsSync(path.join(dir, 'deck-stale-render/pages')), false, 'old-render images must not replace current content');
  } finally { if (!existsSync(release)) writeFileSync(release, 'continue'); rmSync(dir, { recursive: true, force: true }); }
});
