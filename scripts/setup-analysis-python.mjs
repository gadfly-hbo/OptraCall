import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdir, writeFile, readFile, readdir, lstat, copyFile, chmod, realpath } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { extractPortablePython } from './analysis-python-portable.mjs';

const defaultCodeRoot = fileURLToPath(new URL('../', import.meta.url));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const exists = async target => { try { await lstat(target); return true; } catch (error) { if (error.code === 'ENOENT') return false; throw error; } };
async function privateDirectory(directory) {
  await mkdir(directory, { mode: 0o700 }).catch(error => { if (error.code !== 'EEXIST') throw error; });
  const info = await lstat(directory);
  if (!info.isDirectory() || info.isSymbolicLink() || await realpath(directory) !== directory) throw new Error('analysis_python_unsafe');
}
async function verifiedDownload(target, { url, sha256, bytes }) {
  if (!await exists(target)) {
    const response = await fetch(url, { signal: AbortSignal.timeout(120_000) });
    if (!response.ok) throw new Error('analysis_python_download_failed');
    const reader = response.body?.getReader();
    if (!reader) throw new Error('analysis_python_download_failed');
    const chunks = []; let total = 0;
    try {
      while (true) {
        const chunk = await reader.read(); if (chunk.done) break;
        total += chunk.value.length;
        if (total > (bytes ?? 128 * 1024 * 1024)) throw new Error('analysis_python_distribution_drift');
        chunks.push(Buffer.from(chunk.value));
      }
    } finally { await reader.cancel().catch(() => {}); }
    const contents = Buffer.concat(chunks);
    if ((bytes !== undefined && contents.length !== bytes) || hash(contents) !== sha256) throw new Error('analysis_python_distribution_drift');
    await writeFile(target, contents, { flag: 'wx', mode: 0o600 });
  }
  const info = await lstat(target);
  if (!info.isFile() || info.isSymbolicLink() || await realpath(target) !== target) throw new Error('analysis_python_unsafe');
  const contents = await readFile(target);
  if ((bytes !== undefined && contents.length !== bytes) || hash(contents) !== sha256) throw new Error('analysis_python_distribution_drift');
  return target;
}
function portableLock(value, lock) {
  if (value.schemaVersion !== 1 || value.provider !== 'astral-python-build-standalone' || value.release !== '20260414' || value.python !== lock.python || value.machine !== lock.machine || value.interpreter !== 'bin/python3.14' || !/^[a-f0-9]{64}$/.test(value.sha256) || !/^[a-f0-9]{64}$/.test(value.interpreterSha256) || !Number.isSafeInteger(value.bytes) || value.bytes <= 0 || value.bytes > 128 * 1024 * 1024) throw new Error('analysis_python_portable_lock_invalid');
  const url = new URL(value.url);
  if (url.protocol !== 'https:' || url.hostname !== 'github.com' || url.username || url.password || url.search || url.hash || !url.pathname.startsWith('/astral-sh/python-build-standalone/releases/download/' + value.release + '/')) throw new Error('analysis_python_portable_lock_invalid');
  const filename = decodeURIComponent(url.pathname.split('/').at(-1));
  if (!/^[a-zA-Z0-9+._-]+\.tar\.gz$/.test(filename)) throw new Error('analysis_python_portable_lock_invalid');
  return { ...value, filename };
}

/** Explicit engineering installation only; the Host never downloads dependencies. */
export async function setupAnalysisPython({ codeRoot = defaultCodeRoot, candidateName, legacy = false } = {}) {
  codeRoot = path.resolve(codeRoot);
  const lockBytes = await readFile(path.join(codeRoot, 'scripts/analysis-python-lock.json')), lock = JSON.parse(lockBytes);
  candidateName ??= lock.id;
  if (!candidateName || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,180}$/.test(candidateName)) throw new Error('analysis_python_candidate_invalid');
  const root = path.join(codeRoot, '.local/analysis-python', candidateName);
  if (await exists(root)) throw new Error('analysis_python_environment_exists: preserve this directory; prepare a new candidate explicitly rather than overwrite it');
  if (process.platform !== 'darwin' || process.arch !== lock.machine) throw new Error('analysis_python_platform_unsupported');
  if (await realpath(codeRoot) !== codeRoot) throw new Error('analysis_python_unsafe');
  await privateDirectory(path.join(codeRoot, '.local'));
  await privateDirectory(path.join(codeRoot, '.local/analysis-python'));
  const downloads = path.join(codeRoot, '.local/analysis-python/downloads'); await privateDirectory(downloads);
  const temporary = path.join(codeRoot, '.local/analysis-python/setup-tmp'); await privateDirectory(temporary);
  const run = (executable, args) => {
    const result = spawnSync(executable, ['-B', ...args], { encoding: 'utf8', timeout: 120_000, env: { PATH: process.env.PATH, TMPDIR: temporary, PYTHONDONTWRITEBYTECODE: '1', PIP_CONFIG_FILE: '/dev/null' } });
    if (result.status !== 0) throw new Error(result.stderr || 'analysis_python_setup_failed');
    return result.stdout;
  };
  let portable, portableBytes, archive;
  if (!legacy) {
    portableBytes = await readFile(path.join(codeRoot, 'scripts/analysis-python-portable-lock.json'));
    portable = portableLock(JSON.parse(portableBytes), lock);
    archive = await verifiedDownload(path.join(downloads, portable.filename), { url: portable.url, sha256: portable.sha256, bytes: portable.bytes });
  } else if (hash(await readFile(lock.interpreter)) !== lock.interpreterSha256) throw new Error('analysis_python_interpreter_drift');
  const wheels = [];
  for (const pkg of lock.packages) {
    const target = path.join(downloads, pkg.filename);
    if (!await exists(target)) {
      const metadataResponse = await fetch(`https://pypi.org/pypi/${pkg.name}/${pkg.version}/json`, { signal: AbortSignal.timeout(30_000) });
      if (!metadataResponse.ok) throw new Error('analysis_python_download_failed');
      const metadata = await metadataResponse.json(), wheel = metadata.urls.find(item => item.filename === pkg.filename && item.digests.sha256 === pkg.sha256 && !item.yanked);
      if (!wheel || new URL(wheel.url).protocol !== 'https:') throw new Error('analysis_python_distribution_drift');
      await verifiedDownload(target, { url: wheel.url, sha256: pkg.sha256 });
    } else await verifiedDownload(target, { sha256: pkg.sha256 });
    wheels.push(target);
  }
  if (portable) {
    await extractPortablePython({ archive, root, sha256: portable.sha256, bytes: portable.bytes });
    if (hash(await readFile(path.join(root, portable.interpreter))) !== portable.interpreterSha256) throw new Error('analysis_python_interpreter_drift');
    // CPython's native prefix configuration keeps user-site packages out while
    // its packaged standard library and shared libraries stay in this root.
    await writeFile(path.join(root, 'pyvenv.cfg'), `home = ${path.join(root, 'bin')}\ninclude-system-site-packages = false\nversion = ${lock.python}\n`, { flag: 'wx', mode: 0o600 });
  } else {
    const actual = JSON.parse(run(lock.interpreter, ['-I', '-S', '-c', "import json,platform;print(json.dumps({'python':platform.python_version(),'machine':platform.machine()}))"]));
    if (actual.python !== lock.python || actual.machine !== lock.machine) throw new Error('analysis_python_interpreter_drift');
    run(lock.interpreter, ['-I', '-m', 'venv', '--copies', root]);
  }
  const executable = path.join(root, 'bin/python3');
  run(executable, ['-I', '-m', 'pip', '--no-input', '--disable-pip-version-check', 'install', '--no-index', '--no-deps', '--no-cache-dir', '--no-compile', ...wheels]);
  // Preserve the original legacy sequence: install with venv's launcher, then
  // use the direct Mach-O that does not need managed posix_spawn.
  if (!portable) for (const name of ['python', 'python3', 'python3.14']) { await copyFile(lock.interpreter, path.join(root, 'bin', name)); await chmod(path.join(root, 'bin', name), 0o755); }
  const identity = JSON.parse(run(executable, ['-I', '-c', "import json,sys,platform,duckdb,openpyxl,et_xmlfile,_duckdb;from importlib.metadata import version;print(json.dumps({'python':platform.python_version(),'machine':platform.machine(),'basePrefix':sys.base_prefix,'prefix':sys.prefix,'versions':[duckdb.__version__,openpyxl.__version__,version('et-xmlfile')],'imports':[duckdb.__file__,openpyxl.__file__,et_xmlfile.__file__,_duckdb.__file__]}))"]));
  if (identity.prefix !== root || identity.python !== lock.python || identity.machine !== lock.machine || (portable && identity.basePrefix !== root) || identity.versions.some((version, i) => version !== lock.packages[i].version) || identity.imports.some(file => !file.startsWith(root + path.sep))) throw new Error('analysis_python_install_incompatible');
  const isolated = JSON.parse(run(executable, ['-c', "import json,site;print(json.dumps({'userSite':site.ENABLE_USER_SITE}))"]));
  if (isolated.userSite !== false) throw new Error('analysis_python_user_site_enabled');
  const files = [];
  async function record(target) {
    const info = await lstat(target);
    if (info.isSymbolicLink()) throw new Error('analysis_python_unexpected_alias');
    if (info.isDirectory()) for (const name of await readdir(target)) await record(path.join(target, name));
    else if (info.isFile()) files.push({ path: path.relative(root, target), sha256: hash(await readFile(target)) });
    else throw new Error('analysis_python_unexpected_file');
  }
  if (portable) await record(root);
  else {
    for (const name of ['python', 'python3', 'python3.14']) await record(path.join(root, 'bin', name));
    await record(path.join(root, 'pyvenv.cfg'));
    const site = path.join(root, 'lib/python3.14/site-packages');
    for (const name of await readdir(site)) if (/^(duckdb|_duckdb|openpyxl|et_xmlfile)/.test(name)) await record(path.join(site, name));
  }
  await writeFile(path.join(root, 'ready.json'), JSON.stringify({ id: lock.id, lockSha256: hash(lockBytes), ...(portable ? { portableLockSha256: hash(portableBytes) } : {}), ...identity, files }, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  async function seal(target) {
    const info = await lstat(target); if (info.isSymbolicLink()) throw new Error('analysis_python_unexpected_alias');
    if (info.isDirectory()) { for (const name of await readdir(target)) await seal(path.join(target, name)); await chmod(target, 0o555); }
    else await chmod(target, info.mode & 0o111 ? 0o555 : 0o444);
  }
  await seal(root);
  return { root, ...identity };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  let candidateName, legacy = false;
  for (let i = 2; i < process.argv.length; i++) {
    const argument = process.argv[i];
    if (argument === '--legacy') legacy = true;
    else if (argument === '--candidate' && process.argv[i + 1]) candidateName = process.argv[++i];
    else throw new Error('analysis_python_argument_invalid');
  }
  console.log(JSON.stringify(await setupAnalysisPython({ candidateName, legacy })));
}
