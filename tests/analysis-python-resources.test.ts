import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, writeFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createProtectedExecutionScope, createProtectedTools } from '../src/agent/protected-tools.ts';

const evidenceRoot = path.resolve('.local/fourbase-modules/m7-duckdb/implementation/runtime/resources');
const environmentRoot = path.resolve('.local/analysis-python/cpython-3.14.4-arm64-duckdb-2.0.0-openpyxl-3.1.5');
const integration = process.platform === 'darwin' && existsSync(path.join(environmentRoot, 'bin/python3'));
const hash = (value: Buffer) => createHash('sha256').update(value).digest('hex');
async function fixture(t: import('node:test').TestContext) {
  await mkdir(evidenceRoot, { recursive: true });
  const root = await mkdtemp(path.join(evidenceRoot, 'scope-'));
  const work = path.join(root, 'work'), inputs = path.join(root, 'inputs'), sibling = path.join(root, 'other-owner');
  for (const directory of [work, inputs, sibling]) await mkdir(directory, { mode: 0o700 });
  const input = path.join(inputs, 'original.csv'), other = path.join(sibling, 'result.md');
  await writeFile(input, 'id,value\n1,42\n'); await writeFile(other, 'OTHER OWNER PRESERVED\n');
  const before = [hash(await readFile(input)), hash(await readFile(other))];
  const scope = await createProtectedExecutionScope({ id: path.basename(root), cwd: work, writableRoot: work, readRoots: [inputs] });
  const runtime = await createProtectedTools({ scope, codeRoot: process.cwd(), forbiddenRoots: [sibling], analysisPython: { root: environmentRoot } });
  t.after(() => runtime.close());
  const execute = async (id: string, script: string) => {
    const result = await runtime.tools.find(tool => tool.name === 'bash')!.execute(id, { command: `python3 - <<'PY'\n${script}\nPY` }, undefined, undefined, {} as never);
    const output = result.content.filter(part => part.type === 'text').map(part => part.text).join('\n');
    await writeFile(path.join(root, `${id}-tool-result.json`), JSON.stringify(result, null, 2) + '\n');
    return output;
  };
  return { root, work, runtime, execute, async assertPreserved() { assert.deepEqual([hash(await readFile(input)), hash(await readFile(other))], before); } };
}

const setup = `import json,duckdb,tempfile,os
from pathlib import Path
temp=tempfile.mkdtemp(prefix='duckdb-resource-',dir=os.environ['TMPDIR'])`;

test('a bounded managed calculation actually spills inside its unique owner temp and finishes correctly', { skip: !integration && 'macOS private integration environment not provisioned', timeout: 30_000 }, async t => {
  const f = await fixture(t);
  const script = `${setup}
c=duckdb.connect(':memory:',config={'memory_limit':'12MB','threads':1,'preserve_insertion_order':False,'temp_directory':temp,'max_temp_directory_size':'128MB','autoinstall_known_extensions':False,'autoload_known_extensions':False})
c.execute("CREATE TABLE source AS SELECT i, repeat(md5(i::VARCHAR), 8) AS payload FROM range(200000) t(i)")
files=[dict(zip(['path','size'],row)) for row in c.execute('SELECT path,size FROM duckdb_temporary_files()').fetchall()]
actual=[{'path':str(p),'bytes':p.stat().st_size,'allocatedBytes':p.stat().st_blocks*512} for p in Path(temp).iterdir() if p.is_file()]
result=c.execute('SELECT count(*), sum(i), min(length(payload)), max(length(payload)) FROM source').fetchone()
record={'rows':200000,'memoryLimit':c.execute("SELECT current_setting('memory_limit')").fetchone()[0],'tempLimit':c.execute("SELECT current_setting('max_temp_directory_size')").fetchone()[0],'temp':temp,'engineTemporaryFiles':files,'observedFiles':actual,'result':result}
Path('spill-before-close.json').write_text(json.dumps(record)); print(json.dumps(record)); c.close(); Path('spill-after-close.json').write_text(json.dumps({'remaining':list(map(str,Path(temp).iterdir()))}))`;
  const output = await f.execute('actual-spill', script);
  assert.doesNotMatch(output, /Traceback|Command exited with code/);
  const record = JSON.parse(await readFile(path.join(f.work, 'spill-before-close.json'), 'utf8'));
  assert.deepEqual(record.result, [200000, 19999900000, 256, 256]);
  assert.ok(record.temp.startsWith(path.join(f.work, '.tmp') + path.sep));
  assert.ok(record.engineTemporaryFiles.some((file: {path:string;size:number}) => file.path.startsWith(record.temp + path.sep) && file.size > 0), output);
  assert.ok(record.observedFiles.some((file: {path:string;bytes:number}) => file.path.startsWith(record.temp + path.sep) && file.bytes > 0), output);
  assert.deepEqual(JSON.parse(await readFile(path.join(f.work, 'spill-after-close.json'), 'utf8')).remaining, []);
  await f.runtime.drain(); await f.runtime.close(); await f.assertPreserved();
});

test('a bounded memory-limited sort returns an actual engine failure without replay', { skip: !integration && 'macOS private integration environment not provisioned', timeout: 30_000 }, async t => {
  const f = await fixture(t);
  const script = `${setup}
import sys
c=duckdb.connect(':memory:',config={'memory_limit':'12MB','threads':1,'preserve_insertion_order':False,'temp_directory':temp,'max_temp_directory_size':'1MB','autoinstall_known_extensions':False,'autoload_known_extensions':False})
record={'rows':200000,'memoryLimit':c.execute("SELECT current_setting('memory_limit')").fetchone()[0],'tempLimit':c.execute("SELECT current_setting('max_temp_directory_size')").fetchone()[0],'temp':temp,'queryAttempts':1}
try:
 payload=' || '.join('md5((i+'+str(n*200000)+')::VARCHAR)' for n in range(8))
 c.execute('SELECT i, '+payload+' AS payload FROM range(200000) t(i) ORDER BY payload').fetchone()
 record.update({'outcome':'unexpected-success'})
except duckdb.Error as error:
 record.update({'outcome':'failed','errorType':type(error).__name__,'error':str(error)})
finally:
 record['observedFiles']=[{'path':str(p),'bytes':p.stat().st_size} for p in Path(temp).iterdir() if p.is_file()]
 c.close()
 record['remainingAfterClose']=list(map(str,Path(temp).iterdir()))
 Path('temp-budget-failure.json').write_text(json.dumps(record)); print(json.dumps(record))
sys.exit(17 if record['outcome']=='failed' else 0)`;
  const output = await f.execute('temp-budget-failure', script);
  const record = JSON.parse(await readFile(path.join(f.work, 'temp-budget-failure.json'), 'utf8'));
  assert.equal(record.outcome, 'failed'); assert.equal(record.errorType, 'OutOfMemoryException');
  assert.match(record.error, /could not allocate block|out of memory/i);
  assert.equal(record.queryAttempts, 1); assert.match(output, /Command exited with code 17/);
  assert.ok(record.observedFiles.every((file:{path:string})=>file.path.startsWith(record.temp+path.sep)), output);
  assert.deepEqual(record.remainingAfterClose, []);
  f.runtime.assertHealthy(); await f.runtime.drain(); await f.runtime.close(); await f.assertPreserved();
});

test('an engine spill to original read-only material is a real permission failure with original bytes preserved', { skip: !integration && 'macOS private integration environment not provisioned', timeout: 30_000 }, async t => {
  const f = await fixture(t);
  const readonlyTemp = path.join(f.root, 'inputs', 'readonly-temp'); await mkdir(readonlyTemp, { mode: 0o700 });
  const script = `import duckdb,json,sys
from pathlib import Path
temp=${JSON.stringify(readonlyTemp)}
c=duckdb.connect(':memory:',config={'memory_limit':'12MB','threads':1,'preserve_insertion_order':False,'temp_directory':temp,'max_temp_directory_size':'128MB','autoinstall_known_extensions':False,'autoload_known_extensions':False})
record={'rows':200000,'temp':temp,'queryAttempts':1}
try:
 c.execute("CREATE TABLE source AS SELECT i, repeat(md5(i::VARCHAR), 8) AS payload FROM range(200000) t(i)")
 record['outcome']='unexpected-success'
except duckdb.Error as error:
 record.update({'outcome':'failed','errorType':type(error).__name__,'error':str(error)})
finally:
 c.close(); record['remainingAfterClose']=list(map(str,Path(temp).iterdir()))
 Path('readonly-temp-failure.json').write_text(json.dumps(record)); print(json.dumps(record))
sys.exit(18 if record['outcome']=='failed' else 0)`;
  const output = await f.execute('readonly-temp-failure', script);
  const record = JSON.parse(await readFile(path.join(f.work, 'readonly-temp-failure.json'), 'utf8'));
  assert.equal(record.outcome, 'failed'); assert.equal(record.errorType, 'IOException');
  assert.match(record.error, /permission|not permitted|cannot open/i);
  assert.equal(record.queryAttempts, 1); assert.match(output, /Command exited with code 18/);
  assert.deepEqual(record.remainingAfterClose, []); assert.deepEqual(await readdir(readonlyTemp), []);
  f.runtime.assertHealthy(); await f.runtime.drain(); await f.runtime.close(); await f.assertPreserved();
});
