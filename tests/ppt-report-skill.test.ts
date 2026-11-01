import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const scripts = path.join(root, 'extensions/analysis-assets/ppt-report/scripts');
const fixtures = path.join(root, 'tests/fixtures/ppt-report');
const python = process.env.PPT_REPORT_PYTHON ?? 'python3';

function run(script: string, args: string[]) {
  const res = spawnSync(python, [path.join(scripts, script), ...args], { encoding: 'utf-8' });
  return { code: res.status, out: `${res.stdout}${res.stderr}` };
}
function tempDir() {
  return mkdtempSync(path.join(os.tmpdir(), 'ppt-report-test-'));
}
function sha(file: string) {
  return createHash('sha256').update(readFileSync(file)).digest('hex');
}
function zipEntries(file: string) {
  const out = runInlinePython(`
import zipfile,hashlib,json
z=zipfile.ZipFile(${JSON.stringify(file)})
print(json.dumps({n:hashlib.sha256(z.read(n)).hexdigest() for n in z.namelist()}))
`);
  return JSON.parse(out);
}
function runInlinePython(code: string) {
  return execFileSync(python, ['-c', code], { encoding: 'utf-8' }).trim();
}

test('digit_check passes when every number is covered by the report', () => {
  const r = run('digit_check.py', ['--deck', path.join(fixtures, 'deck-good.pptx'), '--report', path.join(fixtures, 'report.md')]);
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /OK/);
});

test('digit_check flags uncovered slide and chart-cache numbers with part names', () => {
  const r = run('digit_check.py', ['--deck', path.join(fixtures, 'deck-bad.pptx'), '--report', path.join(fixtures, 'report.md'), '--json']);
  assert.equal(r.code, 1, r.out);
  const result = JSON.parse(r.out);
  assert.equal(result.ok, false);
  const parts = Object.fromEntries(result.findings.map((f: { part: string; uncovered: string[] }) => [f.part, f.uncovered]));
  assert.ok(parts['ppt/slides/slide2.xml']?.includes('9.9%'), JSON.stringify(parts));
  assert.ok(parts['ppt/charts/chart1.xml']?.includes('999'), JSON.stringify(parts));
});

test('splice replaces only the target slide and keeps other entries byte-identical', () => {
  const dir = tempDir();
  try {
    const out = path.join(dir, 'out.pptx');
    const r = run('splice_slide.py', ['--deck', path.join(fixtures, 'deck-good.pptx'), '--replacement', path.join(fixtures, 'replacement-single.pptx'), '--slide', '2', '--out', out]);
    assert.equal(r.code, 0, r.out);
    const before = zipEntries(path.join(fixtures, 'deck-good.pptx'));
    const after = zipEntries(out);
    assert.deepEqual(Object.keys(after).sort(), Object.keys(before).sort());
    for (const name of Object.keys(before)) {
      if (name === 'ppt/slides/slide2.xml') {
        assert.notEqual(after[name], before[name], 'target slide must change');
      } else {
        assert.equal(after[name], before[name], `${name} must stay byte-identical`);
      }
    }
    const text = runInlinePython(`
import zipfile,re
z=zipfile.ZipFile(${JSON.stringify(out)})
print(''.join(re.findall(r'<a:t>([^<]*)</a:t>', z.read('ppt/slides/slide2.xml').decode('utf-8'))))
`);
    assert.match(text, /替换页/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('splice copies referenced media with new rIds and updates content types', () => {
  const dir = tempDir();
  try {
    const out = path.join(dir, 'out.pptx');
    const r = run('splice_slide.py', ['--deck', path.join(fixtures, 'deck-good.pptx'), '--replacement', path.join(fixtures, 'replacement-media.pptx'), '--slide', '3', '--out', out]);
    assert.equal(r.code, 0, r.out);
    const before = zipEntries(path.join(fixtures, 'deck-good.pptx'));
    const after = zipEntries(out);
    const media = Object.keys(after).filter(n => n.startsWith('ppt/media/spliced-3-'));
    assert.equal(media.length, 1, JSON.stringify(Object.keys(after)));
    for (const name of Object.keys(before)) {
      if (name === 'ppt/slides/slide3.xml' || name === '[Content_Types].xml' || name === 'ppt/slides/_rels/slide3.xml.rels') continue;
      assert.equal(after[name], before[name], `${name} must stay byte-identical`);
    }
    const rels = runInlinePython(`
import zipfile
z=zipfile.ZipFile(${JSON.stringify(out)})
print(z.read('ppt/slides/_rels/slide3.xml.rels').decode('utf-8'))
print(z.read('ppt/slides/slide3.xml').decode('utf-8').count('rSpliced3x'))
`);
    assert.match(rels, /rSpliced3x/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('splice rejects out-of-range slide index', () => {
  const dir = tempDir();
  try {
    const out = path.join(dir, 'out.pptx');
    const r = run('splice_slide.py', ['--deck', path.join(fixtures, 'deck-good.pptx'), '--replacement', path.join(fixtures, 'replacement-single.pptx'), '--slide', '9', '--out', out]);
    assert.equal(r.code, 2, r.out);
    assert.equal(existsSync(out), false);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('page_images rejects a non-zip deck before invoking soffice', () => {
  const dir = tempDir();
  try {
    const broken = path.join(dir, 'broken.pptx');
    writeFileSync(broken, 'this is not a zip file');
    const r = run('page_images.py', ['--deck', broken, '--out', path.join(dir, 'pages')]);
    assert.equal(r.code, 2, r.out);
    assert.match(r.out, /GATE_FAIL/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

const sofficePresent = [process.env.SOFFICE, '/Applications/LibreOffice.app/Contents/MacOS/soffice', '/usr/bin/soffice'].some(p => p && existsSync(p));

test('page_images renders every page with matching count (real soffice)', { skip: !sofficePresent }, () => {
  const dir = tempDir();
  try {
    const out = path.join(dir, 'pages');
    const r = run('page_images.py', ['--deck', path.join(fixtures, 'deck-good.pptx'), '--out', out]);
    assert.equal(r.code, 0, r.out);
    const files = runInlinePython(`import os;print('\\n'.join(sorted(os.listdir(${JSON.stringify(out)}))))`);
    for (const name of ['slide-01.png', 'slide-02.png', 'slide-03.png', 'thumb-01.png', 'thumb-03.png']) {
      assert.ok(files.includes(name), files);
    }
    const bad = run('page_images.py', ['--deck', path.join(fixtures, 'deck-bad.pptx'), '--out', path.join(dir, 'pages2')]);
    assert.equal(bad.code, 0, bad.out);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
