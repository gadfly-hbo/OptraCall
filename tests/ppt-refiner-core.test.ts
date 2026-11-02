import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs, { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, copyFileSync, mkdirSync, linkSync, symlinkSync, readdirSync, lstatSync } from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { createHash } from 'node:crypto';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { createDeckStore } from '../extensions/business-plugins/ppt-refiner/storage/deck-store.ts';
import { DeckFault } from '../extensions/business-plugins/ppt-refiner/types.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fixtures = path.join(root, 'tests/fixtures/ppt-report');
const editScript = path.join(root, 'extensions/business-plugins/ppt-refiner/scripts/edit_slide.py');
const python = process.env.PPT_REPORT_PYTHON ?? 'python3';
const tempDir = () => mkdtempSync(path.join(os.tmpdir(), 'ppt-refiner-test-'));
const fixtureDeck = path.join(fixtures, 'deck-good.pptx');
const fixtureReport = path.join(fixtures, 'report.md');

function edit(args: string[]) {
  const res = spawnSync(python, [editScript, ...args], { encoding: 'utf-8' });
  return { code: res.status, out: `${res.stdout}${res.stderr}` };
}

test('deck store: register, snapshot, revert with pre-revert snapshot', () => {
  const dir = tempDir();
  try {
    const store = createDeckStore(dir);
    const meta = store.register({ sourcePptx: fixtureDeck, title: '合成复盘', reportPath: fixtureReport });
    assert.equal(meta.title, '合成复盘');
    assert.ok(existsSync(store.deckPath));
    assert.equal(store.versions().length, 1);
    const original = readFileSync(store.deckPath);
    writeFileSync(store.deckPath, Buffer.concat([original, Buffer.from('x')]));
    store.snapshot({ pages: [2], summary: 'P2 修改', diffs: [{ page: 2, kind: 'wording', summary: '标题改写', anchor: 'none' }] });
    assert.equal(store.versions().length, 2);
    store.revert(1);
    assert.deepEqual(readFileSync(store.deckPath), original);
    assert.equal(store.versions().length, 3, 'revert must snapshot current state first');
    assert.equal(store.versions()[2].summary, '回退 v1 前状态');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('deck store: register refuses occupied partial roots without changing any retained file', () => {
  for (const occupied of ['deck.pptx', 'meta.json', '.before-unresolved.pptx', 'protection-failure.json', 'sessions/native.jsonl', 'versions/v1.pptx']) {
    const dir = tempDir();
    try {
      const file = path.join(dir, occupied); mkdirSync(path.dirname(file), { recursive: true });
      const retained = Buffer.from('UNRESOLVED_SYNTHETIC_ORIGINAL'); writeFileSync(file, retained);
      const source = readFileSync(fixtureDeck);
      const entries = readdirSync(dir).sort();
      const store = createDeckStore(dir);
      assert.throws(() => store.register({ sourcePptx: fixtureDeck, title: 'partial root', reportPath: fixtureReport }), (error: unknown) => error instanceof DeckFault && error.code === 'DECK_EXISTS');
      assert.deepEqual(readFileSync(file), retained, occupied);
      assert.deepEqual(readFileSync(fixtureDeck), source, 'candidate source is retained');
      assert.deepEqual(readdirSync(dir).sort(), entries, 'rejected registration creates no child or cleanup side effect');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  }
});

test('deck store: register never follows pre-existing soft hard or dangling destination links', () => {
  for (const kind of ['symlink', 'hardlink', 'dangling']) {
    const dir = tempDir(); const retainedDir = tempDir();
    try {
      const target = path.join(retainedDir, 'original.pptx'); const bytes = Buffer.from('UNRESOLVED_LINKED_ORIGINAL');
      if (kind !== 'dangling') writeFileSync(target, bytes);
      const deck = path.join(dir, 'deck.pptx');
      if (kind === 'hardlink') linkSync(target, deck); else symlinkSync(target, deck);
      const stat = lstatSync(deck); const store = createDeckStore(dir);
      assert.throws(() => store.register({ sourcePptx: fixtureDeck, title: 'linked root', reportPath: fixtureReport }), (error: unknown) => error instanceof DeckFault && error.code === 'DECK_EXISTS');
      assert.equal(lstatSync(deck).ino, stat.ino, 'existing destination entry remains intact');
      if (kind !== 'dangling') assert.deepEqual(readFileSync(target), bytes);
      else assert.equal(existsSync(target), false);
      assert.deepEqual(readdirSync(dir), ['deck.pptx']);
    } finally { rmSync(dir, { recursive: true, force: true }); rmSync(retainedDir, { recursive: true, force: true }); }
  }
});

test('deck store: register destination races cannot overwrite linked deck or initial version targets', () => {
  const originalCopy = fs.copyFileSync;
  for (const name of ['deck.pptx', 'versions/v1.pptx']) for (const kind of ['symlink', 'hardlink']) {
    const dir = tempDir(); const retainedDir = tempDir();
    try {
      const target = path.join(retainedDir, 'original.pptx'); const bytes = Buffer.from('RACING_SYNTHETIC_ORIGINAL'); writeFileSync(target, bytes);
      const destination = path.join(dir, name); let injected = false;
      fs.copyFileSync = (source, output, flags) => {
        if (output === destination && !injected) { injected = true; if (kind === 'hardlink') linkSync(target, destination); else symlinkSync(target, destination); }
        return originalCopy(source, output, flags);
      };
      syncBuiltinESMExports();
      const store = createDeckStore(dir);
      assert.throws(() => store.register({ sourcePptx: fixtureDeck, title: 'racing root', reportPath: fixtureReport }), (error: unknown) => error instanceof DeckFault && error.code === 'DECK_EXISTS');
      assert.equal(injected, true, 'race reaches the actual copy operation');
      assert.deepEqual(readFileSync(target), bytes);
      assert.equal(existsSync(path.join(dir, 'meta.json')), false, 'partial registration is not published');
    } finally { fs.copyFileSync = originalCopy; syncBuiltinESMExports(); rmSync(dir, { recursive: true, force: true }); rmSync(retainedDir, { recursive: true, force: true }); }
  }
});

test('deck store: register accepts a vacant root or an existing empty versions directory', () => {
  for (const mode of ['missing', 'empty', 'empty-versions']) {
    const parent = tempDir(); const dir = mode === 'missing' ? path.join(parent, 'new-deck') : parent;
    try {
      if (mode === 'empty-versions') mkdirSync(path.join(dir, 'versions'));
      const store = createDeckStore(dir);
      assert.equal(store.register({ sourcePptx: fixtureDeck, title: 'vacant root', reportPath: fixtureReport }).currentVersion, 1);
      assert.equal(store.versions().length, 1);
      assert.deepEqual(readFileSync(store.deckPath), readFileSync(fixtureDeck));
    } finally { rmSync(parent, { recursive: true, force: true }); }
  }
});

test('deck store: register refuses unsafe root and versions links without writing through them', () => {
  for (const component of ['root', 'versions']) {
    const dir = tempDir(); const retainedDir = tempDir();
    try {
      const marker = path.join(retainedDir, 'unresolved.txt'); const bytes = Buffer.from('RETAIN_DIRECTORY_EVIDENCE'); writeFileSync(marker, bytes);
      const deckRoot = component === 'root' ? path.join(dir, 'linked-root') : dir;
      symlinkSync(retainedDir, component === 'root' ? deckRoot : path.join(deckRoot, 'versions'));
      const store = createDeckStore(deckRoot);
      assert.throws(() => store.register({ sourcePptx: fixtureDeck, title: 'unsafe directory', reportPath: fixtureReport }), (error: unknown) => error instanceof DeckFault && error.code === 'DECK_UNSAFE_ROOT');
      assert.deepEqual(readdirSync(retainedDir), ['unresolved.txt']);
      assert.deepEqual(readFileSync(marker), bytes);
    } finally { rmSync(dir, { recursive: true, force: true }); rmSync(retainedDir, { recursive: true, force: true }); }
  }
});

test('deck store: registration metadata publication cannot replace a concurrent retained entry', () => {
  const originalLink = fs.linkSync;
  for (const kind of ['symlink', 'hardlink']) {
    const dir = tempDir(); const retainedDir = tempDir();
    try {
      const target = path.join(retainedDir, 'unresolved-meta'); const bytes = Buffer.from('RETAIN_CONCURRENT_METADATA'); writeFileSync(target, bytes);
      const meta = path.join(dir, 'meta.json'); let injected = false;
      fs.linkSync = (source, output) => {
        if (output === meta && !injected) { injected = true; if (kind === 'hardlink') originalLink(target, meta); else symlinkSync(target, meta); }
        return originalLink(source, output);
      };
      syncBuiltinESMExports();
      const store = createDeckStore(dir);
      assert.throws(() => store.register({ sourcePptx: fixtureDeck, title: 'concurrent metadata', reportPath: fixtureReport }), (error: unknown) => error instanceof DeckFault && error.code === 'DECK_EXISTS');
      assert.equal(injected, true, 'race occurs at the final publication');
      assert.deepEqual(readFileSync(target), bytes);
      assert.deepEqual(readFileSync(meta), bytes);
      assert.deepEqual(readFileSync(store.deckPath), readFileSync(fixtureDeck), 'new partial files remain as failure evidence');
    } finally { fs.linkSync = originalLink; syncBuiltinESMExports(); rmSync(dir, { recursive: true, force: true }); rmSync(retainedDir, { recursive: true, force: true }); }
  }
});

test('deck store: page lock blocks editing and unlock restores', () => {
  const dir = tempDir();
  try {
    const store = createDeckStore(dir);
    store.register({ sourcePptx: fixtureDeck, title: '锁定测试', reportPath: fixtureReport });
    store.setPageLocked(2, true);
    assert.throws(() => store.assertEditable(2), (e) => e instanceof DeckFault && e.code === 'PAGE_LOCKED');
    store.assertEditable(1);
    store.setPageLocked(2, false);
    store.assertEditable(2);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('deck store: exportFinal writes deck and diff list without touching report', () => {
  const dir = tempDir();
  try {
    const store = createDeckStore(dir);
    store.register({ sourcePptx: fixtureDeck, title: '导出测试', reportPath: fixtureReport });
    store.snapshot({ pages: [2], summary: '数字直改', diffs: [{ page: 2, kind: 'number', summary: '+3% → +3.2%（用户确认）', anchor: 'uncovered-confirmed' }] });
    const reportBefore = readFileSync(fixtureReport);
    const out = store.exportFinal({ outDir: path.join(dir, 'exports'), fileName: '终版.pptx' });
    assert.ok(existsSync(out.pptx));
    const diff = readFileSync(out.diff, 'utf-8');
    assert.match(diff, /\+3% → \+3.2%/);
    assert.match(diff, /不回写 md 报告/);
    assert.deepEqual(readFileSync(fixtureReport), reportBefore);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('edit_slide replaces text and keeps other entries byte-identical', () => {
  const dir = tempDir();
  try {
    const out = path.join(dir, 'out.pptx');
    const r = edit(['--deck', fixtureDeck, '--slide', '2', '--match', '长尾门店同比', '--replace', '长尾同比', '--out', out]);
    assert.equal(r.code, 0, r.out);
    const before = JSON.parse(spawnSync(python, ['-c', `import zipfile,hashlib,json;z=zipfile.ZipFile(${JSON.stringify(fixtureDeck)});print(json.dumps({n:hashlib.sha256(z.read(n)).hexdigest() for n in z.namelist()}))`], { encoding: 'utf-8' }).stdout);
    const after = JSON.parse(spawnSync(python, ['-c', `import zipfile,hashlib,json;z=zipfile.ZipFile(${JSON.stringify(out)});print(json.dumps({n:hashlib.sha256(z.read(n)).hexdigest() for n in z.namelist()}))`], { encoding: 'utf-8' }).stdout);
    for (const name of Object.keys(before)) {
      if (name === 'ppt/slides/slide2.xml') assert.notEqual(after[name], before[name]);
      else assert.equal(after[name], before[name], name);
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('edit_slide refuses match not found and does not write output', () => {
  const dir = tempDir();
  try {
    const out = path.join(dir, 'out.pptx');
    const r = edit(['--deck', fixtureDeck, '--slide', '2', '--match', '不存在的文本', '--replace', 'x', '--out', out]);
    assert.equal(r.code, 3, r.out);
    assert.equal(existsSync(out), false);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('edit_slide anchor refuses numbers absent from the report', () => {
  const dir = tempDir();
  try {
    const out = path.join(dir, 'out.pptx');
    const r = edit(['--deck', fixtureDeck, '--slide', '2', '--match', '+3%', '--replace', '+3.2%', '--out', out, '--report', fixtureReport]);
    assert.equal(r.code, 4, r.out);
    assert.match(r.out, /ANCHOR_REFUSED/);
    assert.equal(existsSync(out), false);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('edit_slide allows covered numbers and user-confirmed uncovered edits', () => {
  const dir = tempDir();
  try {
    const covered = path.join(dir, 'covered.pptx');
    const r1 = edit(['--deck', fixtureDeck, '--slide', '2', '--match', '+3%', '--replace', '+3%（转化率 2.4%）', '--out', covered, '--report', fixtureReport]);
    assert.equal(r1.code, 0, r1.out);
    const direct = path.join(dir, 'direct.pptx');
    const r2 = edit(['--deck', fixtureDeck, '--slide', '2', '--match', '+3%', '--replace', '+3.2%', '--out', direct, '--report', fixtureReport, '--allow-uncovered']);
    assert.equal(r2.code, 0, r2.out);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('edit_slide hard lock gate refuses locked pages from meta.json', () => {
  const dir = tempDir();
  try {
    writeFileSync(path.join(dir, 'meta.json'), JSON.stringify({ lockedPages: [2] }));
    copyFileSync(fixtureDeck, path.join(dir, 'deck.pptx'));
    const lockedOut = path.join(dir, 'locked.pptx');
    const r2 = edit(['--deck', path.join(dir, 'deck.pptx'), '--slide', '2', '--match', '长尾', '--replace', 'x', '--out', lockedOut]);
    assert.equal(r2.code, 5, r2.out);
    assert.match(r2.out, /PAGE_LOCKED/);
    assert.equal(existsSync(lockedOut), false);
    const ok = edit(['--deck', path.join(dir, 'deck.pptx'), '--slide', '1', '--match', '重点门店', '--replace', '重点', '--out', path.join(dir, 'ok.pptx')]);
    assert.equal(ok.code, 0, ok.out);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('edit_slide escapes XML special characters in replacement text', () => {
  const dir = tempDir();
  try {
    const out = path.join(dir, 'out.pptx');
    const r = edit(['--deck', fixtureDeck, '--slide', '2', '--match', '长尾门店同比', '--replace', '长尾&A<B>同比', '--out', out]);
    assert.equal(r.code, 0, r.out);
    const xml = JSON.parse(spawnSync(python, ['-c', `import zipfile,json,xml.etree.ElementTree as ET;z=zipfile.ZipFile(${JSON.stringify(out)});x=z.read('ppt/slides/slide2.xml').decode('utf-8');ET.fromstring(x);print(json.dumps('valid'))`], { encoding: 'utf-8' }).stdout);
    assert.equal(xml, 'valid');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('deck store: revert marks undone versions and export excludes them', () => {
  const dir = tempDir();
  try {
    const store = createDeckStore(dir);
    store.register({ sourcePptx: fixtureDeck, title: 'revert-diff', reportPath: fixtureReport });
    store.snapshot({ pages: [2], summary: '后续被回退的改动', diffs: [{ page: 2, kind: 'number', summary: '42.5% → 43.9%', anchor: 'uncovered-confirmed' }] });
    store.revert(1);
    const out = store.exportFinal({ outDir: path.join(dir, 'exports') });
    const diff = readFileSync(out.diff, 'utf-8');
    assert.ok(!diff.includes('43.9%'), diff);
    assert.match(diff, /无内容级改动差异/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('deck store: register persists deck-bound configuration', () => {
  const dir = tempDir();
  try {
    const store = createDeckStore(dir);
    store.register({ sourcePptx: fixtureDeck, title: 'bound', reportPath: fixtureReport, configuration: { id: 'minimax-m3', revision: 1 } });
    assert.deepEqual(store.meta().configuration, { id: 'minimax-m3', revision: 1 });
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('deck store: restoring a descendant restores all of its inherited differences', () => {
  const dir = tempDir();
  try {
    const store = createDeckStore(dir);
    store.register({ sourcePptx: fixtureDeck, title: 'ancestor differences', reportPath: fixtureReport });
    writeFileSync(store.deckPath, Buffer.concat([readFileSync(store.deckPath), Buffer.from('A')]));
    store.snapshot({ pages: [1], summary: 'A', diffs: [{ page: 1, kind: 'number', summary: 'DIFF_A', anchor: 'uncovered-confirmed' }] });
    writeFileSync(store.deckPath, Buffer.concat([readFileSync(store.deckPath), Buffer.from('B')]));
    store.snapshot({ pages: [2], summary: 'B', diffs: [{ page: 2, kind: 'number', summary: 'DIFF_B', anchor: 'uncovered-confirmed' }] });
    const third = readFileSync(store.deckPath);
    store.revert(1);
    store.revert(3);
    assert.deepEqual(readFileSync(store.deckPath), third);
    const exported = store.exportFinal({ outDir: path.join(dir, 'exports') });
    const diff = readFileSync(exported.diff, 'utf8');
    assert.match(diff, /DIFF_A/, 'v3 still contains its v2 change');
    assert.match(diff, /DIFF_B/);
    assert.equal(exported.diffHistoryKnown, true);
    assert.equal(store.versions().length, 5, 'both pre-revert snapshots remain available');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('deck store: branch edits export only the current branch differences', () => {
  const dir = tempDir();
  try {
    const store = createDeckStore(dir);
    store.register({ sourcePptx: fixtureDeck, title: 'branch', reportPath: fixtureReport });
    store.snapshot({ pages: [1], summary: 'discarded', diffs: [{ page: 1, kind: 'wording', summary: 'OLD_BRANCH', anchor: 'none' }] });
    store.revert(1);
    store.snapshot({ pages: [2], summary: 'new branch', diffs: [{ page: 2, kind: 'wording', summary: 'NEW_BRANCH', anchor: 'none' }] });
    const exported = store.exportFinal({ outDir: path.join(dir, 'exports') });
    const diff = readFileSync(exported.diff, 'utf8');
    assert.match(diff, /NEW_BRANCH/);
    assert.doesNotMatch(diff, /OLD_BRANCH/);
    assert.equal(exported.diffHistoryKnown, true);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('deck store: export refuses either existing output before publishing the pair', () => {
  for (const collision of ['final.pptx', 'final.diff.md']) {
    const dir = tempDir();
    try {
      const store = createDeckStore(dir);
      store.register({ sourcePptx: fixtureDeck, title: 'collision', reportPath: fixtureReport });
      const outDir = path.join(dir, 'exports'); mkdirSync(outDir);
      const occupied = path.join(outDir, collision); const bytes = Buffer.from('existing retained output');
      writeFileSync(occupied, bytes);
      assert.throws(() => store.exportFinal({ outDir }), (error: unknown) => error instanceof DeckFault && error.code === 'EXPORT_EXISTS');
      assert.deepEqual(readFileSync(occupied), bytes);
      assert.equal(existsSync(path.join(outDir, collision === 'final.pptx' ? 'final.diff.md' : 'final.pptx')), false);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  }
});

test('deck store: export refuses linked and dangling output names without changing their targets', () => {
  for (const collision of ['final.pptx', 'final.diff.md']) for (const kind of ['symlink', 'hardlink', 'dangling']) {
    const dir = tempDir();
    try {
      const store = createDeckStore(dir);
      store.register({ sourcePptx: fixtureDeck, title: 'linked collision', reportPath: fixtureReport });
      const outDir = path.join(dir, 'exports'); mkdirSync(outDir);
      const target = path.join(dir, 'retained'); const bytes = Buffer.from('linked retained bytes');
      if (kind !== 'dangling') writeFileSync(target, bytes);
      const occupied = path.join(outDir, collision);
      if (kind === 'hardlink') linkSync(target, occupied); else symlinkSync(target, occupied);
      assert.throws(() => store.exportFinal({ outDir }), (error: unknown) => error instanceof DeckFault && error.code === 'EXPORT_EXISTS');
      if (kind !== 'dangling') assert.deepEqual(readFileSync(target), bytes);
      else assert.equal(existsSync(target), false);
      assert.equal(existsSync(path.join(outDir, collision === 'final.pptx' ? 'final.diff.md' : 'final.pptx')), false);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  }
});

test('deck store: legacy lineage remains readable and explicitly unknown without rewriting history', () => {
  const dir = tempDir();
  try {
    const store = createDeckStore(dir);
    store.register({ sourcePptx: fixtureDeck, title: 'legacy', reportPath: fixtureReport });
    store.snapshot({ pages: [1], summary: 'legacy edit', diffs: [{ page: 1, kind: 'wording', summary: 'LEGACY_CHANGE', anchor: 'none' }] });
    const metaFile = path.join(dir, 'meta.json'); const meta = JSON.parse(readFileSync(metaFile, 'utf8')); delete meta.currentVersion;
    writeFileSync(metaFile, JSON.stringify(meta));
    const records = [1, 2].map(n => path.join(dir, 'versions', `v${n}.json`));
    for (const record of records) { const entry = JSON.parse(readFileSync(record, 'utf8')); delete entry.parentVersion; writeFileSync(record, JSON.stringify(entry)); }
    const retained = [metaFile, ...records].map(file => readFileSync(file));
    const exported = store.exportFinal({ outDir: path.join(dir, 'exports') });
    assert.equal(exported.diffHistoryKnown, false);
    const diff = readFileSync(exported.diff, 'utf8');
    assert.match(diff, /历史.*未核定|谱系.*未知/);
    assert.match(diff, /LEGACY_CHANGE/, 'historical evidence remains visible but cannot be claimed adopted');
    assert.doesNotMatch(diff, /无内容级改动差异/);
    [metaFile, ...records].forEach((file, i) => assert.deepEqual(readFileSync(file), retained[i]));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('deck store: unrecorded external edits are disclosed and cannot create a falsely complete lineage', () => {
  const dir = tempDir();
  try {
    const store = createDeckStore(dir);
    store.register({ sourcePptx: fixtureDeck, title: 'external edit', reportPath: fixtureReport });
    writeFileSync(store.deckPath, Buffer.concat([readFileSync(store.deckPath), Buffer.from('manual')]));
    const first = store.exportFinal({ outDir: path.join(dir, 'manual-export') });
    assert.equal(first.diffHistoryKnown, false);
    const beforeSha256 = createHash('sha256').update(readFileSync(store.deckPath)).digest('hex');
    writeFileSync(store.deckPath, Buffer.concat([readFileSync(store.deckPath), Buffer.from('agent')]));
    store.snapshot({ pages: [2], summary: 'after manual change', diffs: [], beforeSha256 });
    const second = store.exportFinal({ outDir: path.join(dir, 'edited-export') });
    assert.equal(second.diffHistoryKnown, false);
    assert.match(readFileSync(second.diff, 'utf8'), /历史.*未核定|谱系.*未知/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('deck store: version file identity must match its record before history can be used', () => {
  const dir = tempDir();
  try {
    const store = createDeckStore(dir);
    store.register({ sourcePptx: fixtureDeck, title: 'version identity', reportPath: fixtureReport });
    const record = path.join(dir, 'versions/v1.json');
    const entry = JSON.parse(readFileSync(record, 'utf8'));
    writeFileSync(record, JSON.stringify({ ...entry, version: 2 }));
    assert.throws(() => store.versions(), (error: unknown) => error instanceof DeckFault && error.code === 'DECK_CORRUPT');
    assert.equal(existsSync(path.join(dir, 'exports')), false);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('deck store: a pre-revert checkpoint retains unknown external edits when restored', () => {
  const dir = tempDir();
  try {
    const store = createDeckStore(dir);
    store.register({ sourcePptx: fixtureDeck, title: 'external checkpoint', reportPath: fixtureReport });
    writeFileSync(store.deckPath, Buffer.concat([readFileSync(store.deckPath), Buffer.from('manual-change')]));
    const manuallyChanged = readFileSync(store.deckPath);
    store.revert(1);
    store.revert(2);
    assert.deepEqual(readFileSync(store.deckPath), manuallyChanged);
    const exported = store.exportFinal({ outDir: path.join(dir, 'exports') });
    assert.equal(exported.diffHistoryKnown, false);
    assert.match(readFileSync(exported.diff, 'utf8'), /历史.*未核定|谱系.*未知/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('deck store: a missing content difference record stays unknown through descendants and restore', () => {
  const dir = tempDir();
  try {
    const store = createDeckStore(dir);
    store.register({ sourcePptx: fixtureDeck, title: 'missing difference record', reportPath: fixtureReport });
    const beforeSha256 = createHash('sha256').update(readFileSync(store.deckPath)).digest('hex');
    writeFileSync(store.deckPath, Buffer.concat([readFileSync(store.deckPath), Buffer.from('unrecorded-content-change')]));
    store.snapshot({ pages: [], summary: 'content changed without a valid machine record', diffs: [], beforeSha256, diffsKnown: false });
    const first = store.exportFinal({ outDir: path.join(dir, 'unknown-export') });
    assert.equal(first.diffHistoryKnown, false);
    assert.doesNotMatch(readFileSync(first.diff, 'utf8'), /无内容级改动差异/);
    assert.match(readFileSync(first.diff, 'utf8'), /本轮.*未核定|内容差异.*未核定/);
    assert.equal(createDeckStore(dir).versions().find(entry => entry.version === 2)?.diffsKnown, false);
    store.snapshot({ pages: [2], summary: 'later known record', diffs: [{ page: 2, kind: 'wording', summary: 'LATER_KNOWN', anchor: 'none' }], diffsKnown: true });
    assert.equal(store.exportFinal({ outDir: path.join(dir, 'descendant-export') }).diffHistoryKnown, false);
    store.revert(1);
    assert.equal(store.exportFinal({ outDir: path.join(dir, 'root-export') }).diffHistoryKnown, true, 'discarding the unknown branch restores the known root');
    store.revert(3);
    assert.equal(store.exportFinal({ outDir: path.join(dir, 'restored-export') }).diffHistoryKnown, false, 'restoring its descendant must retain the unknown content change');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('deck store: difference record confidence is a strict optional boolean', () => {
  const dir = tempDir();
  try {
    const store = createDeckStore(dir);
    store.register({ sourcePptx: fixtureDeck, title: 'record confidence', reportPath: fixtureReport });
    assert.equal(store.exportFinal({ outDir: path.join(dir, 'omitted-flag') }).diffHistoryKnown, true, 'omitted legacy confidence alone is not an unknown marker');
    const record = path.join(dir, 'versions/v1.json');
    const entry = JSON.parse(readFileSync(record, 'utf8'));
    writeFileSync(record, JSON.stringify({ ...entry, diffsKnown: 'false' }));
    assert.throws(() => store.versions(), (error: unknown) => error instanceof DeckFault && error.code === 'DECK_CORRUPT');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('refinerConfiguration: deck-bound or explicit project configuration only, never global fallback', async () => {
  const { refinerConfiguration } = await import('../src/host/ppt-refiner-sessions.ts');
  const calls: (string | number | undefined)[][] = [];
  const snapshot = (id?: string, revision?: number) => { calls.push([id, revision]); return { model: id ?? 'current' } as never; };
  const project = { id: 'project-a', revision: 2 };
  assert.deepEqual(refinerConfiguration({ configuration: { id: 'minimax-m3', revision: 1 } }, snapshot, project), { model: 'minimax-m3' });
  assert.deepEqual(refinerConfiguration({}, snapshot, project), { model: 'project-a' });
  assert.equal(refinerConfiguration({}, snapshot), undefined);
  assert.equal(refinerConfiguration({ configuration: { id: 'missing', revision: 3 } }, (id, revision) => { calls.push([id, revision]); return undefined; }, project), undefined);
  assert.deepEqual(calls, [['minimax-m3', 1], ['project-a', 2], ['missing', 3]]);
});
