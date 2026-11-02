import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fixture = path.join(root, 'tests/fixtures/ppt-report/deck-good.pptx');
const guard = path.join(root, 'extensions/business-plugins/ppt-refiner/scripts/slide_guard.py');
const python = process.env.PPT_REPORT_PYTHON ?? 'python3';

test('PPT guard: a locked slide protects referenced media even when slide XML and rels are unchanged', () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'ppt-guard-'));
  try {
    const before = path.join(directory, 'before.pptx'), after = path.join(directory, 'after.pptx');
    const made = spawnSync(python, ['-c', `
import zipfile,xml.etree.ElementTree as E
with zipfile.ZipFile(${JSON.stringify(fixture)}) as z: entries={n:z.read(n) for n in z.namelist()}
key='ppt/slides/_rels/slide2.xml.rels'
tree=E.fromstring(entries[key])
E.SubElement(tree,'{http://schemas.openxmlformats.org/package/2006/relationships}Relationship',{'Id':'rGuard','Type':'http://schemas.openxmlformats.org/officeDocument/2006/relationships/image','Target':'../media/guard-fixture.png'})
entries[key]=E.tostring(tree)
for out,value in [(${JSON.stringify(before)},b'BEFORE'),(${JSON.stringify(after)},b'AFTER')]:
 entries['ppt/media/guard-fixture.png']=value
 with zipfile.ZipFile(out,'w',zipfile.ZIP_DEFLATED) as z:
  for n,data in entries.items():z.writestr(n,data)
`], { encoding: 'utf8' });
    assert.equal(made.status, 0, made.stderr);
    const checked = spawnSync(python, [guard, 'check', '--before', before, '--after', after, '--slides', '2'], { encoding: 'utf8' });
    assert.equal(checked.status, 0, checked.stderr);
    const result = JSON.parse(checked.stdout);
    assert.deepEqual(result.changedParts, ['ppt/media/guard-fixture.png']);
    assert.deepEqual(result.lockedPagesChanged, [2]);
    const unlocked = spawnSync(python, [guard, 'check', '--before', before, '--after', after, '--slides', '1'], { encoding: 'utf8' });
    assert.equal(unlocked.status, 0, unlocked.stderr); assert.deepEqual(JSON.parse(unlocked.stdout).lockedPagesChanged, []);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('PPT guard: malformed XML or duplicate zip parts cannot be accepted as verified unchanged', () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'ppt-guard-invalid-'));
  try {
    for (const kind of ['xml', 'duplicate']) {
      const after = path.join(directory, `${kind}.pptx`);
      const made = spawnSync(python, ['-c', `
import zipfile
with zipfile.ZipFile(${JSON.stringify(fixture)}) as z: entries={n:z.read(n) for n in z.namelist()}
with zipfile.ZipFile(${JSON.stringify(after)},'w',zipfile.ZIP_DEFLATED) as z:
 for n,data in entries.items():z.writestr(n,b'<broken' if ${JSON.stringify(kind)}=='xml' and n=='ppt/slides/slide2.xml' else data)
 if ${JSON.stringify(kind)}=='duplicate':z.writestr('ppt/slides/slide2.xml',entries['ppt/slides/slide2.xml'])
`], { encoding: 'utf8' });
      assert.equal(made.status, 0, made.stderr);
      const checked = spawnSync(python, [guard, 'check', '--before', fixture, '--after', after], { encoding: 'utf8' });
      assert.notEqual(checked.status, 0, kind);
    }
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
