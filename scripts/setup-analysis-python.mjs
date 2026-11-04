import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdir, writeFile, readFile, readdir, lstat, copyFile, chmod } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
const codeRoot = fileURLToPath(new URL('../', import.meta.url));
const lockBytes = await readFile(new URL('./analysis-python-lock.json', import.meta.url)), lock = JSON.parse(lockBytes);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const candidateIndex = process.argv.indexOf('--candidate');
const candidateName = candidateIndex < 0 ? lock.id : process.argv[candidateIndex + 1];
if (!candidateName || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,180}$/.test(candidateName)) throw new Error('analysis_python_candidate_invalid');
const root = path.join(codeRoot, '.local', 'analysis-python', candidateName);
if (process.platform !== 'darwin' || process.arch !== lock.machine) throw new Error('analysis_python_platform_unsupported');
if (hash(await readFile(lock.interpreter)) !== lock.interpreterSha256) throw new Error('analysis_python_interpreter_drift');
if (existsSync(root)) throw new Error('analysis_python_environment_exists: preserve this directory; prepare a new candidate explicitly rather than overwrite it');
const temporary = path.join(codeRoot, '.local', 'fourbase-modules', 'm7-duckdb', 'implementation', 'runtime', 'setup-tmp');
await mkdir(temporary, { recursive: true, mode: 0o700 });
const run = (executable, args) => { const result = spawnSync(executable, ['-B', ...args], { encoding: 'utf8', env: { PATH: process.env.PATH, TMPDIR: temporary, PYTHONDONTWRITEBYTECODE: '1' } }); if (result.status !== 0) throw new Error(result.stderr || 'analysis_python_setup_failed'); return result.stdout; };
const actual = JSON.parse(run(lock.interpreter, ['-I', '-S', '-c', "import json,platform,sys;print(json.dumps({'python':platform.python_version(),'machine':platform.machine(),'basePrefix':sys.base_prefix}))"]));
if (actual.python !== lock.python || actual.machine !== lock.machine) throw new Error('analysis_python_interpreter_drift');
const downloads = path.join(codeRoot, '.local', 'analysis-python', 'downloads'); await mkdir(downloads, { recursive: true, mode: 0o700 });
const wheels = [];
for (const pkg of lock.packages) {
  const target = path.join(downloads, pkg.filename);
  if (!existsSync(target)) {
    const metadataResponse = await fetch(`https://pypi.org/pypi/${pkg.name}/${pkg.version}/json`); if (!metadataResponse.ok) throw new Error('analysis_python_download_failed');
    const metadata = await metadataResponse.json(), wheel = metadata.urls.find(item => item.filename === pkg.filename && item.digests.sha256 === pkg.sha256 && !item.yanked);
    if (!wheel) throw new Error('analysis_python_distribution_drift');
    const response = await fetch(wheel.url); if (!response.ok) throw new Error('analysis_python_download_failed');
    const bytes = Buffer.from(await response.arrayBuffer()); if (hash(bytes) !== pkg.sha256) throw new Error('analysis_python_distribution_drift');
    await writeFile(target, bytes, { flag: 'wx', mode: 0o600 });
  }
  if (hash(await readFile(target)) !== pkg.sha256) throw new Error('analysis_python_distribution_drift'); wheels.push(target);
}
run(lock.interpreter, ['-I', '-m', 'venv', '--copies', root]);
const executable = path.join(root, 'bin', 'python3');
run(executable, ['-I', '-m', 'pip', 'install', '--no-index', '--no-deps', '--no-cache-dir', '--no-compile', ...wheels]);
// Use the exact same-version direct Mach-O interpreter in the native venv.
// The Homebrew launcher requires posix_spawn, denied by managed execution.
for (const name of ['python', 'python3', 'python3.14']) { await copyFile(lock.interpreter, path.join(root, 'bin', name)); await chmod(path.join(root, 'bin', name), 0o755); }
const identity = JSON.parse(run(executable, ['-I', '-c', "import json,sys,platform,duckdb,openpyxl,et_xmlfile,_duckdb;from importlib.metadata import version;print(json.dumps({'python':platform.python_version(),'machine':platform.machine(),'basePrefix':sys.base_prefix,'prefix':sys.prefix,'versions':[duckdb.__version__,openpyxl.__version__,version('et-xmlfile')],'imports':[duckdb.__file__,openpyxl.__file__,et_xmlfile.__file__,_duckdb.__file__]}))"]));
if (identity.prefix !== root || identity.python !== lock.python || identity.machine !== lock.machine || identity.versions.some((version,i)=>version !== lock.packages[i].version) || identity.imports.some(file=>!file.startsWith(root+path.sep))) throw new Error('analysis_python_install_incompatible');
const files = [];
async function record(target) { const info = await lstat(target); if (info.isSymbolicLink()) throw new Error('analysis_python_unexpected_alias'); if (info.isDirectory()) { for (const name of await readdir(target)) await record(path.join(target,name)); } else if(info.isFile()) files.push({path:path.relative(root,target),sha256:hash(await readFile(target))}); }
for (const name of ['python','python3','python3.14']) await record(path.join(root,'bin',name));
await record(path.join(root,'pyvenv.cfg'));
const site = path.join(root,'lib','python3.14','site-packages');
for (const name of await readdir(site)) if (/^(duckdb|_duckdb|openpyxl|et_xmlfile)/.test(name)) await record(path.join(site,name));
await writeFile(path.join(root,'ready.json'), JSON.stringify({id:lock.id,lockSha256:hash(lockBytes),...identity,files},null,2)+'\n',{flag:'wx',mode:0o600});
async function seal(target) { const info = await lstat(target); if (info.isSymbolicLink()) throw new Error('analysis_python_unexpected_alias'); if (info.isDirectory()) { for (const name of await readdir(target)) await seal(path.join(target,name)); await chmod(target,0o555); } else await chmod(target,info.mode & 0o111 ? 0o555 : 0o444); }
await seal(root);
console.log(JSON.stringify({root,...identity}));
