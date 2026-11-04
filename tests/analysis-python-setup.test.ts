import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdir, mkdtemp, copyFile, writeFile, readFile, readdir, realpath, access, symlink, lstat } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { extractPortablePython } from '../scripts/analysis-python-portable.mjs';

const repository = fileURLToPath(new URL('../', import.meta.url));
async function fixture() {
  const evidence = path.join(repository, '.local/private-python-setup');
  await mkdir(evidence, { recursive: true });
  const root = await realpath(await mkdtemp(path.join(evidence, 'fixture-')));
  await mkdir(path.join(root, 'scripts'));
  for (const name of ['setup-analysis-python.mjs', 'analysis-python-lock.json', 'analysis-python-portable-lock.json', 'analysis-python-portable.mjs', 'extract-analysis-python.py']) {
    try { await copyFile(path.join(repository, 'scripts', name), path.join(root, 'scripts', name)); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  }
  return root;
}
const run = (root: string, ...args: string[]) => spawnSync(process.execPath, [path.join(root, 'scripts/setup-analysis-python.mjs'), ...args], { cwd: root, encoding: 'utf8', timeout: 15_000 });

test('private Python setup refuses an existing environment before touching dependencies or its bytes', async () => {
  const root = await fixture(), environment = path.join(root, '.local/analysis-python/preserve-me');
  await mkdir(environment, { recursive: true });
  await writeFile(path.join(environment, 'original'), 'ORIGINAL_ENVIRONMENT');
  const lockFile = path.join(root, 'scripts/analysis-python-lock.json');
  const lock = JSON.parse(await readFile(lockFile, 'utf8'));
  lock.interpreter = path.join(root, 'never-installed-python');
  await writeFile(lockFile, JSON.stringify(lock));
  const result = run(root, '--candidate', 'preserve-me');
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /analysis_python_environment_exists/);
  assert.equal(await readFile(path.join(environment, 'original'), 'utf8'), 'ORIGINAL_ENVIRONMENT');
  assert.deepEqual(await readdir(environment), ['original']);
});

test('portable setup rejects a corrupt cached distribution before creating an environment or needing global Python', { skip: process.platform !== 'darwin' || process.arch !== 'arm64' }, async () => {
  const root = await fixture(), downloads = path.join(root, '.local/analysis-python/downloads');
  await mkdir(downloads, { recursive: true });
  const lockFile = path.join(root, 'scripts/analysis-python-lock.json');
  const lock = JSON.parse(await readFile(lockFile, 'utf8'));
  lock.interpreter = path.join(root, 'NO_GLOBAL_PYTHON');
  await writeFile(lockFile, JSON.stringify(lock));
  const portable = JSON.parse(await readFile(path.join(root, 'scripts/analysis-python-portable-lock.json'), 'utf8'));
  const archive = path.join(downloads, decodeURIComponent(new URL(portable.url).pathname.split('/').at(-1)!));
  await writeFile(archive, 'CORRUPT_DISTRIBUTION');
  const result = run(root, '--candidate', 'reject-corrupt');
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /analysis_python_distribution_drift/);
  await assert.rejects(access(path.join(root, '.local/analysis-python/reject-corrupt')));
  assert.equal(await readFile(archive, 'utf8'), 'CORRUPT_DISTRIBUTION');
});

test('portable setup rejects an aliased private parent without writing into its target', { skip: process.platform !== 'darwin' || process.arch !== 'arm64' }, async () => {
  const root = await fixture(), elsewhere = path.join(root, 'keep-external');
  await mkdir(elsewhere); await writeFile(path.join(elsewhere, 'original'), 'KEEP');
  await mkdir(path.join(root, '.local'));
  await symlink(elsewhere, path.join(root, '.local/analysis-python'));
  const result = run(root);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /analysis_python_unsafe/);
  assert.equal(await readFile(path.join(elsewhere, 'original'), 'utf8'), 'KEEP');
  assert.deepEqual(await readdir(elsewhere), ['original']);
});

async function archiveFixture(kind: string) {
  const root = await fixture(), archive = path.join(root, 'fixture.tar.gz');
  const result = spawnSync('/usr/bin/python3', ['-I', '-B', '-c', `
import io,tarfile,sys
archive,kind=sys.argv[1:]
with tarfile.open(archive,'w:gz') as bundle:
    item=tarfile.TarInfo('python/bin/python3.14');data=b'FIXTURE_INTERPRETER';item.size=len(data);item.mode=0o755;bundle.addfile(item,io.BytesIO(data))
    if kind=='traversal':
        item=tarfile.TarInfo('python/../../escaped');data=b'BAD';item.size=len(data);bundle.addfile(item,io.BytesIO(data))
    elif kind=='special':
        item=tarfile.TarInfo('python/fifo');item.type=tarfile.FIFOTYPE;bundle.addfile(item)
    else:
        item=tarfile.TarInfo('python/bin/python3');item.type=tarfile.SYMTYPE
        item.linkname='python3.14' if kind=='valid' else '/tmp/OUTSIDE_PRIVATE_PYTHON'
        bundle.addfile(item)
`, archive, kind], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  const contents = await readFile(archive);
  return { root, archive, destination: path.join(root, 'extract'), sha256: createHash('sha256').update(contents).digest('hex'), bytes: contents.length };
}

test('locked portable archive extraction materializes contained interpreter aliases as regular files', async () => {
  const f = await archiveFixture('valid');
  const result = await extractPortablePython({ archive: f.archive, root: f.destination, sha256: f.sha256, bytes: f.bytes });
  assert.equal(result.files, 2);
  assert.equal(await readFile(path.join(f.destination, 'bin/python3'), 'utf8'), 'FIXTURE_INTERPRETER');
  assert.equal((await lstat(path.join(f.destination, 'bin/python3'))).isSymbolicLink(), false);
});

test('portable archive extraction rejects checksum drift before it creates a root', async () => {
  const f = await archiveFixture('valid');
  await assert.rejects(extractPortablePython({ archive: f.archive, root: f.destination, sha256: '0'.repeat(64), bytes: f.bytes }), /analysis_python_distribution_drift/);
  await assert.rejects(access(f.destination));
});

test('portable archive extraction refuses unsafe members before writing any environment', async t => {
  for (const kind of ['traversal', 'special', 'outside-link']) await t.test(kind, async () => {
    const f = await archiveFixture(kind);
    await assert.rejects(extractPortablePython({ archive: f.archive, root: f.destination, sha256: f.sha256, bytes: f.bytes }), /analysis_python_unsafe_archive/);
    await assert.rejects(access(f.destination));
    await assert.rejects(access(path.join(f.root, 'escaped')));
  });
});

test('portable extraction never replaces a preexisting destination', async () => {
  const f = await archiveFixture('valid');
  await mkdir(f.destination); await writeFile(path.join(f.destination, 'original'), 'PRESERVE');
  await assert.rejects(extractPortablePython({ archive: f.archive, root: f.destination, sha256: f.sha256, bytes: f.bytes }), /analysis_python_environment_exists/);
  assert.deepEqual(await readdir(f.destination), ['original']);
});

const downloadCache = path.join(repository, '.local/analysis-python/downloads');
const portableFixtureAvailable = process.platform === 'darwin' && process.arch === 'arm64'
  && existsSync(path.join(downloadCache, 'cpython-3.14.4+20260414-aarch64-apple-darwin-install_only_stripped.tar.gz'))
  && ['duckdb-2.0.0-cp312-abi3-macosx_11_0_arm64.whl', 'openpyxl-3.1.5-py2.py3-none-any.whl', 'et_xmlfile-2.0.0-py3-none-any.whl'].every(name => existsSync(path.join(downloadCache, name)));

test('real private installation ignores an isolated pip.conf target and never writes outside its environment', { skip: !portableFixtureAvailable && 'macOS arm64 locked distribution cache not provisioned', timeout: 120_000 }, async () => {
  const root = await fixture(), outside = path.join(root, 'unrelated-files');
  await mkdir(outside); await writeFile(path.join(outside, 'original'), 'PRESERVE_UNRELATED');
  await writeFile(path.join(root, 'package.json'), '{"type":"module"}\n');
  const cache = path.join(root, '.local/analysis-python/downloads'); await mkdir(cache, { recursive: true });
  const lockFile = path.join(root, 'scripts/analysis-python-lock.json'), lock = JSON.parse(await readFile(lockFile, 'utf8'));
  const portableFile = path.join(root, 'scripts/analysis-python-portable-lock.json'), portable = JSON.parse(await readFile(portableFile, 'utf8'));
  const filename = decodeURIComponent(new URL(portable.url).pathname.split('/').at(-1)!);
  const archive = path.join(cache, filename);
  // Only the fixture distribution gains a SITE pip.conf. The official archive,
  // production lock and real user's GLOBAL/USER configurations stay untouched.
  const packaged = spawnSync('/usr/bin/python3', ['-I', '-B', '-c', `
import io,tarfile,sys
source,destination,outside=sys.argv[1:]
with tarfile.open(source,'r:gz') as original,tarfile.open(destination,'w:gz') as modified:
    for member in original:
        modified.addfile(member,original.extractfile(member) if member.isfile() else None)
    config=('[global]\\ntarget = '+outside+'\\n').encode()
    member=tarfile.TarInfo('python/pip.conf');member.size=len(config);member.mode=0o644
    modified.addfile(member,io.BytesIO(config))
`, path.join(downloadCache, filename), archive, outside], { encoding: 'utf8', timeout: 30_000 });
  assert.equal(packaged.status, 0, packaged.stderr);
  const bytes = await readFile(archive); portable.sha256 = createHash('sha256').update(bytes).digest('hex'); portable.bytes = bytes.length;
  await writeFile(portableFile, JSON.stringify(portable));
  for (const pkg of lock.packages) await copyFile(path.join(downloadCache, pkg.filename), path.join(cache, pkg.filename));
  const account = spawnSync('/usr/bin/python3', ['-I', '-B', '-c', 'import os,pwd;print(pwd.getpwuid(os.getuid()).pw_dir)'], { encoding: 'utf8' });
  assert.equal(account.status, 0, account.stderr);
  const userHome = account.stdout.trim();
  const blocked = ['/Library/Application Support/pip', path.join(userHome, '.pip'), path.join(userHome, '.config/pip'), path.join(userHome, 'Library/Application Support/pip')];
  const profile = path.join(root, 'pip-config-isolation.sbpl');
  await writeFile(profile, '(version 1)\n(allow default)\n' + blocked.map(directory => `(deny file-read* (subpath ${JSON.stringify(directory)}))`).join('\n'));
  const result = spawnSync('/usr/bin/sandbox-exec', ['-f', profile, process.execPath, path.join(root, 'scripts/setup-analysis-python.mjs')], { cwd: root, encoding: 'utf8', timeout: 90_000 });
  const outsideFiles = await readdir(outside);
  await writeFile(path.join(root, 'pip-target-observation.json'), JSON.stringify({ status: result.status, outsideFiles, stdout: result.stdout, stderr: result.stderr }, null, 2));
  assert.deepEqual(outsideFiles, ['original'], 'pip must not obey an inherited target outside the private prefix');
  assert.equal(result.status, 0, result.stderr);
  assert.equal(await readFile(path.join(outside, 'original'), 'utf8'), 'PRESERVE_UNRELATED');
  const identity = JSON.parse(result.stdout);
  const environment = path.join(root, '.local/analysis-python', lock.id);
  assert.equal(identity.prefix, environment);
  assert.deepEqual(identity.versions, ['2.0.0', '3.1.5', '2.0.0']);
  assert.ok(identity.imports.every((file: string) => file.startsWith(environment + path.sep)));
  const probe = spawnSync(path.join(environment, 'bin/python3'), ['-B', '-c', 'import duckdb,openpyxl,site;print(duckdb.sql("select 20+22").fetchall()[0][0]);print(site.ENABLE_USER_SITE)'], { encoding: 'utf8' });
  assert.equal(probe.status, 0, probe.stderr);
  assert.equal(probe.stdout.trim(), '42\nFalse');
});
