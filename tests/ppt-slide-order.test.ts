import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fixtures = path.join(root, 'tests/fixtures/ppt-report');
const guard = path.join(root, 'extensions/business-plugins/ppt-refiner/scripts/slide_guard.py');
const edit = path.join(root, 'extensions/business-plugins/ppt-refiner/scripts/edit_slide.py');
const splice = path.join(root, 'extensions/analysis-assets/ppt-report/scripts/splice_slide.py');
const python = process.env.PPT_REPORT_PYTHON ?? 'python3';

function invoke(script: string, args: string[]) {
  return spawnSync(python, [script, ...args], { encoding: 'utf8' });
}

function rewrite(source: string, destination: string, code: string) {
  const result = spawnSync(python, ['-c', `
import sys,zipfile,xml.etree.ElementTree as E
with zipfile.ZipFile(sys.argv[1]) as z: entries={n:z.read(n) for n in z.namelist()}
${code}
with zipfile.ZipFile(sys.argv[2],'w',zipfile.ZIP_DEFLATED) as z:
 for n,data in entries.items():z.writestr(n,data)
`, source, destination], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
}

function reordered(destination: string, fixture = 'deck-good.pptx') {
  rewrite(path.join(fixtures, fixture), destination, `
pres=E.fromstring(entries['ppt/presentation.xml'])
slides=pres.find('{http://schemas.openxmlformats.org/presentationml/2006/main}sldIdLst')
first,second=list(slides)[:2]
slides.remove(first);slides.insert(1,first)
entries['ppt/presentation.xml']=E.tostring(pres)
`);
}

function contents(deck: string): Record<string, string> {
  const result = spawnSync(python, ['-c', `
import sys,zipfile,json,base64
with zipfile.ZipFile(sys.argv[1]) as z: print(json.dumps({n:base64.b64encode(z.read(n)).decode() for n in z.namelist()}))
`, deck], { encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}

test('PPT guard protects the first displayed page after PowerPoint reorders slide parts', () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'ppt-display-order-'));
  try {
    const before = path.join(directory, 'before.pptx'), after = path.join(directory, 'after.pptx');
    reordered(before);
    rewrite(before, after, "entries['ppt/slides/slide2.xml'] += b'\\n'");
    const checked = invoke(guard, ['check', '--before', before, '--after', after, '--slides', '1']);
    assert.equal(checked.status, 0, checked.stderr);
    assert.deepEqual(JSON.parse(checked.stdout).lockedPagesChanged, [1], 'displayed page 1 is physical slide2');
    const other = invoke(guard, ['check', '--before', before, '--after', after, '--slides', '2']);
    assert.equal(other.status, 0, other.stderr);
    assert.deepEqual(JSON.parse(other.stdout).lockedPagesChanged, []);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('PPT text editing addresses the displayed page and respects its metadata lock', () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'ppt-display-edit-'));
  try {
    const deck = path.join(directory, 'deck.pptx'), out = path.join(directory, 'edited.pptx');
    reordered(deck);
    const args = ['--deck', deck, '--slide', '1', '--match', '长尾门店同比', '--replace', '按显示页编辑', '--out', out];
    const edited = invoke(edit, args);
    assert.equal(edited.status, 0, edited.stderr);
    const before = contents(deck), after = contents(out);
    for (const name of Object.keys(before)) {
      if (name === 'ppt/slides/slide2.xml') {
        assert.match(Buffer.from(after[name], 'base64').toString(), /按显示页编辑/);
      } else assert.equal(after[name], before[name], name);
    }
    writeFileSync(path.join(directory, 'meta.json'), JSON.stringify({ lockedPages: [1] }));
    const refused = invoke(edit, [...args.slice(0, -1), path.join(directory, 'locked.pptx')]);
    assert.equal(refused.status, 5, refused.stderr);
    assert.match(refused.stderr, /PAGE_LOCKED/);
    assert.equal(existsSync(path.join(directory, 'locked.pptx')), false);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('PPT splice uses displayed order for both target and replacement and preserves other entries', () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'ppt-display-splice-'));
  try {
    const deck = path.join(directory, 'deck.pptx'), replacement = path.join(directory, 'replacement.pptx');
    const out = path.join(directory, 'spliced.pptx');
    reordered(deck);
    rewrite(deck, replacement, "entries['ppt/slides/slide2.xml']=entries['ppt/slides/slide2.xml'].replace('长尾门店同比'.encode(),'Replacement displayed first'.encode())");
    const args = ['--deck', deck, '--replacement', replacement, '--slide', '1', '--out', out];
    const result = invoke(splice, args);
    assert.equal(result.status, 0, result.stderr);
    const before = contents(deck), after = contents(out), rep = contents(replacement);
    assert.equal(after['ppt/slides/slide2.xml'], rep['ppt/slides/slide2.xml']);
    assert.match(Buffer.from(after['ppt/slides/slide2.xml'], 'base64').toString(), /Replacement displayed first/);
    assert.deepEqual(Object.keys(after).sort(), Object.keys(before).sort());
    for (const name of Object.keys(before)) {
      if (name !== 'ppt/slides/slide2.xml') assert.equal(after[name], before[name], name);
    }
    writeFileSync(path.join(directory, 'meta.json'), JSON.stringify({ lockedPages: [1] }));
    const refused = invoke(splice, [...args.slice(0, -1), path.join(directory, 'locked.pptx')]);
    assert.equal(refused.status, 5, refused.stderr);
    assert.equal(existsSync(path.join(directory, 'locked.pptx')), false);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('PPT splice accepts an ordinary replacement after the target presentation changes namespace prefix', () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'ppt-display-prefix-'));
  try {
    const deck = path.join(directory, 'deck.pptx'), out = path.join(directory, 'out.pptx');
    reordered(deck);
    const result = invoke(splice, ['--deck', deck, '--replacement', path.join(fixtures, 'replacement-single.pptx'), '--slide', '1', '--out', out]);
    assert.equal(result.status, 0, result.stderr);
    const after = contents(out);
    assert.match(Buffer.from(after['ppt/slides/slide2.xml'], 'base64').toString(), /替换页/);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('PPT guard restore restores a displayed page without overwriting another page', () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'ppt-display-restore-'));
  try {
    const before = path.join(directory, 'before.pptx'), after = path.join(directory, 'after.pptx');
    reordered(before);
    rewrite(before, after, "entries['ppt/slides/slide1.xml'] += b'\\n'\nentries['ppt/slides/slide2.xml'] += b'\\n'");
    const modified = contents(after), original = contents(before);
    const restored = invoke(guard, ['restore', '--before', before, '--after', after, '--slides', '1']);
    assert.equal(restored.status, 0, restored.stderr);
    const result = contents(after);
    assert.equal(result['ppt/slides/slide2.xml'], original['ppt/slides/slide2.xml']);
    for (const name of Object.keys(modified)) {
      if (name !== 'ppt/slides/slide2.xml') assert.equal(result[name], modified[name], name);
    }
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('PPT displayed-page locks include the reordered page media and layout relationships', () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'ppt-display-related-'));
  try {
    const reorderedDeck = path.join(directory, 'reordered.pptx'), before = path.join(directory, 'before.pptx'), after = path.join(directory, 'after.pptx');
    reordered(reorderedDeck);
    rewrite(reorderedDeck, before, `
tree=E.fromstring(entries['ppt/slides/_rels/slide2.xml.rels'])
E.SubElement(tree,'{http://schemas.openxmlformats.org/package/2006/relationships}Relationship',{'Id':'rDisplayImage','Type':'http://schemas.openxmlformats.org/officeDocument/2006/relationships/image','Target':'../media/display.png'})
entries['ppt/slides/_rels/slide2.xml.rels']=E.tostring(tree)
entries['ppt/media/display.png']=b'original media'
`);
    rewrite(before, after, "entries['ppt/media/display.png']=b'changed media'");
    const checked = invoke(guard, ['check', '--before', before, '--after', after, '--slides', '1']);
    assert.equal(checked.status, 0, checked.stderr);
    assert.deepEqual(JSON.parse(checked.stdout), { changedParts: ['ppt/media/display.png'], lockedPagesChanged: [1] });
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('PPT page addressing follows normalized presentation targets rather than numbered filenames', () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'ppt-display-target-'));
  try {
    const reorderedDeck = path.join(directory, 'reordered.pptx'), before = path.join(directory, 'before.pptx'), after = path.join(directory, 'after.pptx');
    reordered(reorderedDeck);
    rewrite(reorderedDeck, before, `
entries['ppt/slides/custom.xml']=entries.pop('ppt/slides/slide2.xml')
entries['ppt/slides/_rels/custom.xml.rels']=entries.pop('ppt/slides/_rels/slide2.xml.rels')
tree=E.fromstring(entries['ppt/_rels/presentation.xml.rels'])
for relation in tree:
 if relation.get('Target')=='slides/slide2.xml':relation.set('Target','/ppt/slides/../slides/custom.xml')
entries['ppt/_rels/presentation.xml.rels']=E.tostring(tree)
`);
    const edited = invoke(edit, ['--deck', before, '--slide', '1', '--match', '长尾门店同比', '--replace', 'Custom named page', '--out', after]);
    assert.equal(edited.status, 0, edited.stderr);
    const checked = invoke(guard, ['check', '--before', before, '--after', after, '--slides', '1']);
    assert.equal(checked.status, 0, checked.stderr);
    assert.deepEqual(JSON.parse(checked.stdout), { changedParts: ['ppt/slides/custom.xml'], lockedPagesChanged: [1] });
    const diff = invoke(guard, ['diff', '--before', before, '--after', after]);
    assert.equal(diff.status, 0, diff.stderr);
    assert.deepEqual(JSON.parse(diff.stdout), ['ppt/slides/custom.xml']);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('PPT page addressing fails closed on unresolved, external, missing and escaping presentation relationships', () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'ppt-display-invalid-'));
  try {
    const changes = {
      unresolved: "tree.remove(relation)",
      external: "relation.set('TargetMode','External');relation.set('Target','https://example.invalid/slide2.xml')",
      missing: "relation.set('Target','slides/missing.xml')",
      escaping: "relation.set('Target','../../outside.xml')",
      wrongType: "relation.set('Type','http://schemas.openxmlformats.org/officeDocument/2006/relationships/image')",
      duplicate: "tree.append(E.fromstring(E.tostring(relation)))",
    };
    for (const [kind, change] of Object.entries(changes)) {
      const deck = path.join(directory, `${kind}.pptx`), out = path.join(directory, `${kind}-out.pptx`);
      rewrite(path.join(fixtures, 'deck-good.pptx'), deck, `
tree=E.fromstring(entries['ppt/_rels/presentation.xml.rels'])
relation=next(r for r in tree if r.get('Target')=='slides/slide2.xml')
${change}
entries['ppt/_rels/presentation.xml.rels']=E.tostring(tree)
`);
      const checked = invoke(guard, ['check', '--before', deck, '--after', deck, '--slides', '2']);
      assert.notEqual(checked.status, 0, `${kind} must not become a verified result`);
      const edited = invoke(edit, ['--deck', deck, '--slide', '2', '--match', '长尾门店同比', '--replace', 'x', '--out', out]);
      assert.notEqual(edited.status, 0, kind);
      const spliced = invoke(splice, ['--deck', path.join(fixtures, 'deck-good.pptx'), '--replacement', deck, '--slide', '2', '--out', out]);
      assert.notEqual(spliced.status, 0, `${kind} replacement must be rejected`);
      assert.equal(existsSync(out), false, kind);
    }
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('PPT partial restore refuses ambiguous changed display order without writing the deck', () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'ppt-display-ambiguous-'));
  try {
    const after = path.join(directory, 'after.pptx');
    reordered(after);
    const before = contents(after);
    const result = invoke(guard, ['restore', '--before', path.join(fixtures, 'deck-good.pptx'), '--after', after, '--slides', '1']);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /whole-deck recovery/);
    assert.deepEqual(contents(after), before);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
