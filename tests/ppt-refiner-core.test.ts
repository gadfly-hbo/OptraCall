import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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
