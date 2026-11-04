import path from 'node:path';
import { readFileSync, existsSync, realpathSync, lstatSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';

/** Host-only construction input; never parsed from HTTP, tools or materials. */
export type AnalysisPythonEnvironment = { root: string };
export type AnalysisPythonAvailability = { state: 'ready'; root: string; executable: string; version: string; basePrefix: string } | { state: 'unavailable'; reason: string };
const id = 'cpython-3.14.4-arm64-duckdb-2.0.0-openpyxl-3.1.5';
export const analysisPythonFor = (codeRoot: string): AnalysisPythonEnvironment => ({ root: path.join(codeRoot, '.local', 'analysis-python', id) });
const sha = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');

/** Validate immutable engineering material without importing the calculation library. */
export function inspectAnalysisPython(input: AnalysisPythonEnvironment, codeRoot: string): AnalysisPythonAvailability {
  try {
    const root = path.resolve(input.root), expectedRoot = path.resolve(codeRoot, '.local', 'analysis-python');
    if (!root.startsWith(expectedRoot + path.sep) || lstatSync(root).isSymbolicLink() || realpathSync(root) !== root) throw new Error('analysis_python_unsafe');
    const readyFile = path.join(root, 'ready.json');
    if (!existsSync(readyFile)) return { state: 'unavailable', reason: 'analysis_python_missing' };
    const lock = JSON.parse(readFileSync(path.join(codeRoot, 'scripts', 'analysis-python-lock.json'), 'utf8'));
    const ready = JSON.parse(readFileSync(readyFile, 'utf8'));
    if (ready.lockSha256 !== sha(readFileSync(path.join(codeRoot, 'scripts', 'analysis-python-lock.json'))) || ready.id !== lock.id || ready.python !== lock.python || ready.machine !== lock.machine || typeof ready.basePrefix !== 'string' || !path.isAbsolute(ready.basePrefix)) throw new Error('analysis_python_drift');
    if (!Array.isArray(ready.files) || !ready.files.length) throw new Error('analysis_python_drift');
    for (const file of ready.files) {
      if (typeof file.path !== 'string' || path.isAbsolute(file.path) || file.path.split(path.sep).includes('..')) throw new Error('analysis_python_drift');
      const target = path.join(root, file.path), info = lstatSync(target);
      if (!info.isFile() || info.isSymbolicLink() || realpathSync(target) !== target || sha(readFileSync(target)) !== file.sha256) throw new Error('analysis_python_drift');
    }
    const executable = path.join(root, 'bin', 'python3');
    if (sha(readFileSync(executable)) !== lock.interpreterSha256) throw new Error('analysis_python_drift');
    const probe = spawnSync(executable, ['-I', '-S', '-c', "import json,sys,platform;print(json.dumps({'prefix':sys.prefix,'basePrefix':sys.base_prefix,'python':platform.python_version(),'machine':platform.machine()}))"], { encoding: 'utf8', timeout: 5000, env: { PYTHONDONTWRITEBYTECODE: '1' } });
    if (probe.status !== 0) throw new Error('analysis_python_incompatible');
    const actual = JSON.parse(probe.stdout);
    if (actual.prefix !== root || realpathSync(actual.basePrefix) !== realpathSync(ready.basePrefix) || actual.python !== lock.python || actual.machine !== lock.machine) throw new Error('analysis_python_incompatible');
    return { state: 'ready', root, executable, version: lock.python, basePrefix: realpathSync(ready.basePrefix) };
  } catch (error) { return { state: 'unavailable', reason: error instanceof Error && /^analysis_python_/.test(error.message) ? error.message : 'analysis_python_missing' }; }
}

export function analysisPythonGuidance(availability: AnalysisPythonAvailability, defaultEntrypoint: 'private' | 'existing' = 'existing'): string {
  if (availability.state === 'unavailable') return `The optional application-private calculation libraries are unavailable (${availability.reason}). Do not claim to have used them or install/download packages. Existing permitted methods remain available; choose them explicitly or report the limitation.`;
  const entrypoint = defaultEntrypoint === 'existing' ? 'Unmanaged python/python3 defaults, including ordinary tasks and cold workspaces, and their existing package visibility remain unchanged. To use these optional locked libraries, choose this absolute interpreter path in the existing bash tool; no user configuration step is required.' : 'The managed/protected tool python/python3 entrypoints use this private environment.';
  return `Optional application-private CPython 3.14.4 arm64 with duckdb 2.0.0, openpyxl 3.1.5 and et-xmlfile 2.0.0 is available at ${availability.executable}. ${entrypoint} Decide whether to use Python, DuckDB, both, or no DuckDB; installation does not prove actual use. Record actual imports/versions, SQL/parameters and result files when useful. For DuckDB use a private connection, for example duckdb.connect(':memory:', config={'autoinstall_known_extensions': False, 'autoload_known_extensions': False, 'threads': 2, 'memory_limit': '256MB'}); explicitly set temp_directory to a unique execution directory inside the current authorized writable workspace and close the connection. These recommended connection settings are not global native API defaults or an OS sandbox. Do not download extra extensions or use additional network/credentials. XLSX sheet/range selection and any conversion are your decision; openpyxl does not recalculate formulas, missing/stale formula caches are not current values. Preserve original bytes. Markdown remains original text unless you choose to extract and check a table.`;
}
