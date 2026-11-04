import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { chmod, mkdir, mkdtemp, readFile, unlink, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync, realpathSync } from 'node:fs';
import { analysisPythonFor, inspectAnalysisPython } from '../src/agent/analysis-python.ts';

const checksum = (bytes: string | Buffer) => createHash('sha256').update(bytes).digest('hex');
const evidenceRoot = path.resolve('.local/private-python-portable/runtime');
const portableIdentity = {
  schemaVersion: 1, provider: 'astral-python-build-standalone', release: '20260414',
  python: '3.14.4', machine: 'arm64',
  url: 'https://github.com/astral-sh/python-build-standalone/releases/download/20260414/cpython-3.14.4%2B20260414-aarch64-apple-darwin-install_only_stripped.tar.gz',
  sha256: '6f304f4ec30854611f23316578302235fb517cd970519ecdd11a8c4db87fd843', bytes: 18349137,
  interpreter: 'bin/python3.14', interpreterSha256: 'bf4ea26231212e330b8e9b6f24969a30f894fec88665bf42754070d114ac7fc6',
};

/** Deliberately incomplete engineering material: refusal tests never fake a usable Python. */
async function refusalFixture(t: TestContext, portableChanges: Record<string, unknown> = {}) {
  await mkdir(evidenceRoot, { recursive: true, mode: 0o700 });
  const codeRoot = await mkdtemp(path.join(evidenceRoot, 'refusal-'));
  const lockBytes = await readFile('scripts/analysis-python-lock.json');
  const lock = JSON.parse(lockBytes.toString());
  const root = path.join(codeRoot, '.local', 'analysis-python', lock.id);
  await mkdir(path.join(codeRoot, 'scripts'), { recursive: true });
  await mkdir(root, { recursive: true });
  await writeFile(path.join(codeRoot, 'scripts', 'analysis-python-lock.json'), lockBytes);
  const portableBytes = JSON.stringify({ ...portableIdentity, ...portableChanges });
  await writeFile(path.join(codeRoot, 'scripts', 'analysis-python-portable-lock.json'), portableBytes);
  await writeFile(path.join(root, 'guard.txt'), 'deliberately incomplete environment');
  await chmod(path.join(root, 'guard.txt'), 0o444);
  const ready = {
    id: lock.id, lockSha256: checksum(lockBytes), python: lock.python, machine: lock.machine,
    basePrefix: root, portableLockSha256: checksum(portableBytes),
    files: [{ path: 'guard.txt', sha256: checksum('deliberately incomplete environment') }],
  };
  const publish = async (changes: Record<string, unknown> = {}) => {
    const readyFile = path.join(root, 'ready.json');
    if (existsSync(readyFile)) await chmod(readyFile, 0o600);
    await writeFile(path.join(root, 'ready.json'), JSON.stringify({ ...ready, ...changes }));
    await chmod(readyFile, 0o444);
  };
  await publish();
  await chmod(root, 0o555);
  t.diagnostic(`retained refusal fixture: ${codeRoot}`);
  return { codeRoot, root, publish };
}

test('an unrecognized portable lock cannot fall back to legacy identity or continue to an executable', async t => {
  const f = await refusalFixture(t);
  await f.publish({ portableLockSha256: '0'.repeat(64) });
  assert.deepEqual(inspectAnalysisPython({ root: f.root }, f.codeRoot), { state: 'unavailable', reason: 'analysis_python_drift' });
});

test('portable identity must describe the same supported private runtime, not a different interpreter or host', async t => {
  for (const [name, changes] of Object.entries({
    'foreign Python': { python: '3.13.0' },
    'foreign architecture': { machine: 'x86_64' },
    'unrecognized schema': { schemaVersion: 2 },
    'unrecognized provider': { provider: 'arbitrary-python' },
    'escaping interpreter path': { interpreter: '../../external-python' },
    'unlocked interpreter': { interpreterSha256: 'not-a-locked-sha256' },
    'non-string interpreter identity': { interpreterSha256: [portableIdentity.interpreterSha256] },
  })) await t.test(name, async t => {
    const f = await refusalFixture(t, changes);
    assert.deepEqual(inspectAnalysisPython({ root: f.root }, f.codeRoot), { state: 'unavailable', reason: 'analysis_python_drift' });
  });
  await t.test('a standalone distribution cannot borrow a global base prefix', async t => {
    const f = await refusalFixture(t);
    await f.publish({ basePrefix: path.dirname(f.root) });
    assert.deepEqual(inspectAnalysisPython({ root: f.root }, f.codeRoot), { state: 'unavailable', reason: 'analysis_python_drift' });
  });
});

test('portable marker presence is strict and a missing distribution lock is drift, not legacy fallback', async t => {
  for (const value of [null, '', false, 1, {}]) await t.test(`invalid marker ${JSON.stringify(value)}`, async t => {
    const f = await refusalFixture(t);
    await f.publish({ portableLockSha256: value });
    assert.deepEqual(inspectAnalysisPython({ root: f.root }, f.codeRoot), { state: 'unavailable', reason: 'analysis_python_drift' });
  });
  await t.test('missing portable lock', async t => {
    const f = await refusalFixture(t);
    await unlink(path.join(f.codeRoot, 'scripts', 'analysis-python-portable-lock.json'));
    assert.deepEqual(inspectAnalysisPython({ root: f.root }, f.codeRoot), { state: 'unavailable', reason: 'analysis_python_drift' });
  });
});

test('an incompletely sealed portable installation is unavailable before it can run', async t => {
  for (const name of ['root', 'ready.json']) await t.test(`writable ${name}`, async t => {
    const f = await refusalFixture(t);
    await chmod(name === 'root' ? f.root : path.join(f.root, name), name === 'root' ? 0o755 : 0o644);
    assert.deepEqual(inspectAnalysisPython({ root: f.root }, f.codeRoot), { state: 'unavailable', reason: 'analysis_python_unsealed' });
  });
});

const legacySource = process.env.OPTRACALL_TEST_LEGACY_PYTHON;
test('an existing original locked Homebrew environment remains available without a portable marker', {
  skip: process.platform !== 'darwin' || !legacySource || !existsSync(path.join(legacySource, 'ready.json')) ? 'explicit original legacy integration material not provisioned' : false,
}, async t => {
  const source = legacySource!;
  const originalReadyBytes = await readFile(path.join(source, 'ready.json'));
  const originalReady = JSON.parse(originalReadyBytes.toString());
  assert.equal(Object.hasOwn(originalReady, 'portableLockSha256'), false);
  await mkdir(evidenceRoot, { recursive: true });
  const codeRoot = await mkdtemp(path.join(evidenceRoot, 'legacy-'));
  const lockBytes = await readFile('scripts/analysis-python-lock.json');
  const root = analysisPythonFor(codeRoot).root;
  await mkdir(path.join(codeRoot, 'scripts'), { recursive: true });
  await mkdir(path.dirname(root), { recursive: true });
  await writeFile(path.join(codeRoot, 'scripts', 'analysis-python-lock.json'), lockBytes);
  // A legacy runtime must not read or require the new distribution lock.
  await writeFile(path.join(codeRoot, 'scripts', 'analysis-python-portable-lock.json'), 'not consulted by legacy material');
  const copy = spawnSync('/bin/cp', ['-cR', source, root], { encoding: 'utf8' });
  assert.equal(copy.status, 0, copy.stderr);
  const actual = inspectAnalysisPython({ root }, codeRoot);
  assert.deepEqual(actual, { state: 'ready', root, executable: path.join(root, 'bin', 'python3'), version: '3.14.4', basePrefix: realpathSync(originalReady.basePrefix) });
  assert.deepEqual(await readFile(path.join(root, 'ready.json')), originalReadyBytes);
  assert.deepEqual(await readFile(path.join(source, 'ready.json')), originalReadyBytes, 'original running environment remains byte-for-byte unchanged');
  t.diagnostic(`retained real legacy copy: ${root}`);
});

const privateRoot = analysisPythonFor(process.cwd()).root;
test('the installed portable distribution is genuinely private and reports its real prefix', {
  skip: process.platform !== 'darwin' || !existsSync(path.join(privateRoot, 'ready.json')) ? 'portable integration environment not provisioned' : false,
}, async () => {
  const ready = JSON.parse(await readFile(path.join(privateRoot, 'ready.json'), 'utf8'));
  assert.equal(typeof ready.portableLockSha256, 'string', 'this integration target must be a real portable install');
  assert.deepEqual(inspectAnalysisPython({ root: privateRoot }, process.cwd()), { state: 'ready', root: privateRoot, executable: path.join(privateRoot, 'bin', 'python3'), version: '3.14.4', basePrefix: privateRoot });
  const actual = spawnSync(path.join(privateRoot, 'bin', 'python3'), ['-B', '-c', "import sys,site,json,duckdb,openpyxl;from importlib.metadata import version;c=duckdb.connect(':memory:',config={'autoinstall_known_extensions':False,'autoload_known_extensions':False,'threads':1,'memory_limit':'128MB'});result=c.sql('select 20+22').fetchall()[0][0];c.close();print(json.dumps({'prefix':sys.prefix,'basePrefix':sys.base_prefix,'userSite':site.ENABLE_USER_SITE,'versions':[duckdb.__version__,openpyxl.__version__,version('et-xmlfile')],'imports':[duckdb.__file__,openpyxl.__file__],'result':result}))"], { encoding: 'utf8', env: { PYTHONDONTWRITEBYTECODE: '1' }, timeout: 10_000 });
  assert.equal(actual.status, 0, actual.stderr);
  const identity = JSON.parse(actual.stdout);
  assert.equal(identity.prefix, privateRoot); assert.equal(identity.basePrefix, privateRoot);
  assert.equal(identity.userSite, false);
  assert.deepEqual(identity.versions, ['2.0.0', '3.1.5', '2.0.0']);
  assert.ok(identity.imports.every((file: string) => file.startsWith(privateRoot + path.sep)));
  assert.equal(identity.result, 42);
});

test('a real portable copy remains verifiable after relocation, and changed library bytes fail closed', {
  skip: process.platform !== 'darwin' || !existsSync(path.join(privateRoot, 'ready.json')) ? 'portable integration environment not provisioned' : false,
}, async t => {
  const originalReadyBytes = await readFile(path.join(privateRoot, 'ready.json'));
  const originalLibrary = await readFile(path.join(privateRoot, 'lib/python3.14/site-packages/openpyxl/__init__.py'));
  await mkdir(evidenceRoot, { recursive: true });
  const codeRoot = await mkdtemp(path.join(evidenceRoot, 'portable-copy-'));
  const root = analysisPythonFor(codeRoot).root;
  await mkdir(path.join(codeRoot, 'scripts'), { recursive: true });
  await mkdir(path.dirname(root), { recursive: true });
  for (const name of ['analysis-python-lock.json', 'analysis-python-portable-lock.json']) await writeFile(path.join(codeRoot, 'scripts', name), await readFile(path.join('scripts', name)));
  const copy = spawnSync('/bin/cp', ['-cR', privateRoot, root], { encoding: 'utf8' });
  assert.equal(copy.status, 0, copy.stderr);
  await chmod(root, 0o755);
  const configuration = path.join(root, 'pyvenv.cfg');
  await chmod(configuration, 0o600);
  const configBytes = (await readFile(configuration, 'utf8')).replace(`home = ${privateRoot}/bin`, `home = ${root}/bin`);
  assert.ok(configBytes.includes(`home = ${root}/bin`));
  await writeFile(configuration, configBytes);
  await chmod(configuration, 0o444);
  const ready = JSON.parse(originalReadyBytes.toString());
  ready.prefix = root; ready.basePrefix = root;
  const configIdentity = ready.files.find((file: { path: string }) => file.path === 'pyvenv.cfg');
  assert.ok(configIdentity, 'the private site configuration is part of the checked material');
  configIdentity.sha256 = checksum(configBytes);
  await chmod(path.join(root, 'ready.json'), 0o600);
  await writeFile(path.join(root, 'ready.json'), JSON.stringify(ready));
  await chmod(path.join(root, 'ready.json'), 0o444);
  await chmod(root, 0o555);
  assert.equal(inspectAnalysisPython({ root }, codeRoot).state, 'ready');
  const library = path.join(root, 'lib/python3.14/site-packages/openpyxl/__init__.py');
  await chmod(library, 0o600);
  await writeFile(library, Buffer.concat([originalLibrary, Buffer.from('\n# synthetic drift\n')]));
  assert.deepEqual(inspectAnalysisPython({ root }, codeRoot), { state: 'unavailable', reason: 'analysis_python_drift' });
  assert.deepEqual(await readFile(path.join(privateRoot, 'ready.json')), originalReadyBytes);
  assert.deepEqual(await readFile(path.join(privateRoot, 'lib/python3.14/site-packages/openpyxl/__init__.py')), originalLibrary);
  t.diagnostic(`retained real portable drift: ${root}`);
});
