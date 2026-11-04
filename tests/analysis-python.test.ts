import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, writeFile, chmod } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { createProtectedExecutionScope, createProtectedTools } from '../src/agent/protected-tools.ts';

const environmentId = 'cpython-3.14.4-arm64-duckdb-2.0.0-openpyxl-3.1.5';
const environmentRoot = path.resolve('.local/analysis-python', environmentId);
const executable = path.join(environmentRoot, 'bin/python3');
const shellQuote = (value: string) => "'" + value.replaceAll("'", "'\"'\"'") + "'";
const evidenceRoot = path.resolve('.local/fourbase-modules/m7-duckdb/implementation/runtime');
const integration = process.platform === 'darwin' && existsSync(executable);
const probe = `import json,sys,platform,duckdb,openpyxl,et_xmlfile
from importlib.metadata import version
with duckdb.connect(':memory:',config={'autoinstall_known_extensions':False,'autoload_known_extensions':False}) as connection:
 result=connection.execute('SELECT 20 + 22').fetchone()[0]
print(json.dumps({'executable':sys.executable,'prefix':sys.prefix,'python':platform.python_version(),'machine':platform.machine(),'duckdb':duckdb.__version__,'duckdbPath':duckdb.__file__,'openpyxl':openpyxl.__version__,'openpyxlPath':openpyxl.__file__,'etXmlfile':version('et-xmlfile'),'result':result}))`;

test('managed Python uses the available application-private locked calculation libraries', { skip: !integration && 'macOS private integration environment not provisioned', timeout: 30_000 }, async t => {
  await mkdir(evidenceRoot, { recursive: true });
  const baseline = spawnSync(executable, ['-I', '-c', probe], { encoding: 'utf8' });
  assert.equal(baseline.status, 0, baseline.stderr);
  const identity = JSON.parse(baseline.stdout);
  assert.equal(identity.result, 42); assert.equal(identity.python, '3.14.4'); assert.equal(identity.machine, 'arm64');
  assert.equal(identity.duckdb, '2.0.0'); assert.equal(identity.openpyxl, '3.1.5'); assert.equal(identity.etXmlfile, '2.0.0');
  assert.ok(identity.duckdbPath.startsWith(environmentRoot + path.sep));
  assert.ok(identity.openpyxlPath.startsWith(environmentRoot + path.sep));
  const root = await mkdtemp(path.join(evidenceRoot, 'private-seam-'));
  const work = path.join(root, 'work'), inputs = path.join(root, 'inputs'), privateRoot = path.join(root, 'private');
  for (const directory of [work, inputs, privateRoot]) await mkdir(directory, { mode: 0o700 });
  const original = path.join(inputs, 'original.csv'), secret = path.join(privateRoot, 'auth.json');
  await writeFile(original, 'value\n42\n'); await writeFile(secret, 'SYNTHETIC-PRIVATE');
  const scope = await createProtectedExecutionScope({ id: 'private-python-seam', cwd: work, writableRoot: work, readRoots: [inputs] });
  const runtime = await createProtectedTools({ scope, codeRoot: process.cwd(), forbiddenRoots: [privateRoot], analysisPython: { root: environmentRoot } });
  t.after(() => runtime.close());
  const bash = runtime.tools.find(tool => tool.name === 'bash')!;
  const result = await bash.execute('private-python', { command: `python3 - <<'PY'\n${probe}\nPY` }, undefined, undefined, {} as never);
  const output = result.content.filter(part => part.type === 'text').map(part => part.text).join('\n');
  assert.ok(output.includes(identity.duckdbPath), output);
  assert.ok(output.includes('"result": 42'), output);
  assert.equal(await readFile(original, 'utf8'), 'value\n42\n');
  assert.equal(await readFile(secret, 'utf8'), 'SYNTHETIC-PRIVATE');
  await runtime.drain(); await runtime.close();
});

async function syntheticProvider(t: import('node:test').TestContext, command: string) {
  const { createServer } = await import('node:http');
  let calls = 0;
  const server = createServer(async (request, response) => {
    const chunks: Buffer[] = []; for await (const part of request) chunks.push(Buffer.from(part));
    const body = JSON.parse(Buffer.concat(chunks).toString()); calls++;
    response.writeHead(200, { 'Content-Type': 'text/event-stream' });
    const send = (delta: unknown, finish: string | null = null) => response.write('data: ' + JSON.stringify({ id: 'analysis-python-fixture', object: 'chat.completion.chunk', created: 1, model: body.model, choices: [{ index: 0, delta, finish_reason: finish }] }) + '\n\n');
    send({ role: 'assistant', content: '' });
    if (calls === 1) { send({ tool_calls: [{ index: 0, id: 'python-call', type: 'function', function: { name: 'bash', arguments: JSON.stringify({ command }) } }] }); send({}, 'tool_calls'); }
    else { send({ content: 'Synthetic reply; actual calculation evidence is in the tool result.' }); send({}, 'stop'); }
    response.end('data: [DONE]\n\n');
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise<void>(resolve => { server.close(() => resolve()); server.closeAllConnections(); }));
  const address = server.address(); assert.ok(address && typeof address !== 'string');
  return { baseUrl: `http://127.0.0.1:${address.port}/v1`, calls: () => calls };
}

test('an eligible ordinary task can choose its private Python through the real Pi bash tool', { skip: !integration && 'macOS private integration environment not provisioned', timeout: 30_000 }, async t => {
  const { ProjectAgent } = await import('../src/agent/project-runtime.ts');
  const { randomUUID } = await import('node:crypto');
  const root = await mkdtemp(path.join(evidenceRoot, 'sdk-ordinary-'));
  const projectDirectory = path.join(root, 'project'), sessionDirectory = path.join(root, 'native'), resourceRoot = path.join(root, 'resources');
  for (const directory of [path.join(projectDirectory, '020_clean'), path.join(projectDirectory, '060_reports'), sessionDirectory, resourceRoot]) await mkdir(directory, { recursive: true, mode: 0o700 });
  const provider = await syntheticProvider(t, `${shellQuote(executable)} -B - <<'PY'\n${probe}\nPY`);
  const agent = new ProjectAgent({ projectId: randomUUID(), taskId: randomUUID(), projectDirectory, sessionDirectory, resourceRoot, codeRoot: process.cwd(), managementPorts: [], analysisPython: { root: environmentRoot }, configuration: { id: randomUUID(), revision: 1, name: 'private python fixture', provider: 'openai-compatible', api: 'openai-completions', baseUrl: provider.baseUrl, model: 'synthetic', apiKey: 'synthetic-key' } });
  t.after(() => agent.close());
  await agent.open(); const run = agent.start('Use the optional private calculation environment.', randomUUID()); await run.accepted;
  assert.equal((await run.completion).outcome, 'completed');
  const snapshot = await agent.snapshot(); assert.ok(snapshot.sessionFile);
  const records = (await readFile(snapshot.sessionFile, 'utf8')).trim().split('\n').map(line => JSON.parse(line));
  const actual = records.filter(record => record.type === 'message' && record.message.role === 'toolResult').map(record => JSON.stringify(record.message)).join('\n');
  assert.ok(actual.includes(environmentRoot), actual); assert.match(actual, /result\\": 42/);
  assert.equal(provider.calls(), 2, 'the Host did not add a model or tool loop');
  await agent.close();
});

async function sdkFixture(t: import('node:test').TestContext, mode: string, command: string, grant = true, runtimeRoot = environmentRoot) {
  const { ProjectAgent } = await import('../src/agent/project-runtime.ts');
  const { randomUUID } = await import('node:crypto');
  const root = await mkdtemp(path.join(evidenceRoot, `sdk-${mode}-`));
  const projectDirectory = path.join(root, 'project'), sessionDirectory = path.join(root, 'native'), resourceRoot = path.join(root, 'resources'), work = path.join(root, 'work'), inputs = path.join(root, 'inputs');
  const clean = path.join(projectDirectory, '020_clean'), reports = path.join(projectDirectory, '060_reports');
  for (const directory of [clean, reports, sessionDirectory, resourceRoot, work, inputs]) await mkdir(directory, { recursive: true, mode: 0o700 });
  await writeFile(path.join(inputs, 'source.csv'), 'value\n42\n');
  const managed = mode === 'ordinary' || mode === 'protected' || mode === 'managed-cold';
  const sealed = mode === 'fixed-draft' || mode === 'text-only';
  const provider = await syntheticProvider(t, command);
  const agent = new ProjectAgent({ projectId: randomUUID(), taskId: randomUUID(), projectDirectory, sessionDirectory, resourceRoot, codeRoot: process.cwd(), managementPorts: [],
    ...(grant ? { analysisPython: { root: runtimeRoot } } : {}),
    ...(mode !== 'ordinary' && mode !== 'unmanaged' ? { workspace: { cwd: work, systemPrompt: ['Synthetic original profile boundary.'], ...(sealed ? { capabilityPolicy: mode as 'fixed-draft' | 'text-only', defaultTools: [] } : {}) } } : {}),
    ...(managed ? { protectedExecution: await createProtectedExecutionScope({ id: `private-${mode}`, profile: mode === 'ordinary' ? 'ordinary' : 'protected', cwd: mode === 'ordinary' ? clean : work, writableRoot: work, readRoots: [inputs], ...(mode === 'ordinary' ? { writeRoots: [clean, reports] } : {}) }) } : {}),
    configuration: { id: randomUUID(), revision: 1, name: 'private python profile', provider: 'openai-compatible', api: 'openai-completions', baseUrl: provider.baseUrl, model: 'synthetic', apiKey: 'synthetic-key' } });
  t.after(() => agent.close());
  const snapshot = await agent.open();
  return { root, work, inputs, provider, agent, snapshot, async run() { const run = agent.start('Exercise the originally permitted calculation tools.', randomUUID()); await run.accepted; const result = await run.completion; const snapshot = await agent.snapshot(); assert.ok(snapshot.sessionFile); const records = (await readFile(snapshot.sessionFile,'utf8')).trim().split('\n').map(line=>JSON.parse(line)); return { result, snapshot, records, actual: records.filter(record=>record.type==='message' && record.message.role==='toolResult').map(record=>JSON.stringify(record.message)).join('\n') }; } };
}

for (const mode of ['ordinary', 'protected', 'cold', 'managed-cold']) test(`${mode} retains its original permissions while the real Pi uses private libraries`, { skip: !integration && 'macOS private integration environment not provisioned', timeout: 30_000 }, async t => {
  const command = mode === 'cold' ? shellQuote(executable) : 'python3';
  const fixture = await sdkFixture(t, mode, `${command} -B - <<'PY'\n${probe}\nPY`);
  assert.equal((fixture.snapshot.capabilities.analysisPython as {state:string}).state, 'ready');
  const actual = await fixture.run(); assert.equal(actual.result.outcome, 'completed');
  assert.ok(actual.actual.includes(environmentRoot), actual.actual); assert.match(actual.actual, /result\\": 42/);
  assert.ok(!actual.snapshot.tools.some(name => /personal_context|case_decision|case_sources/.test(name)), mode);
  await fixture.agent.drain(); await fixture.agent.close();
  assert.equal(await readFile(path.join(fixture.inputs,'source.csv'),'utf8'),'value\n42\n');
});

for (const mode of ['fixed-draft','text-only']) test(`${mode} cannot acquire calculation execution even when private dependencies exist`, { skip: !integration && 'macOS private integration environment not provisioned', timeout: 30_000 }, async t => {
  const fixture = await sdkFixture(t, mode, "python3 -c 'open(\"SHOULD-NOT-EXIST\",\"w\").write(\"bad\")'");
  assert.deepEqual(fixture.snapshot.tools, []); assert.equal(fixture.snapshot.capabilities.analysisPython, undefined);
  assert.equal(fixture.snapshot.capabilities.skills, false); assert.equal(fixture.snapshot.capabilities.extensions, false);
  await assert.rejects(fixture.agent.command('/bash echo denied'), error => error instanceof Error && /fixed_draft_commands_not_allowed/.test(JSON.stringify(error.cause)));
  await fixture.run(); await fixture.agent.close();
  await assert.rejects(readFile(path.join(fixture.work, 'SHOULD-NOT-EXIST')), /ENOENT/);
});

test('a plugin workspace does not automatically receive private Python', { skip: !integration && 'macOS private integration environment not provisioned', timeout: 30_000 }, async t => {
  const fixture = await sdkFixture(t, 'plugin', "python3 -c 'import sys; print(sys.executable)'", false);
  assert.equal(fixture.snapshot.capabilities.analysisPython, undefined);
  const actual = await fixture.run(); assert.ok(!actual.actual.includes(environmentRoot), actual.actual);
  await fixture.agent.close();
});

test('missing optional dependencies are reported while an ordinary task can explicitly use its original Python', { skip: !integration && 'macOS private integration environment not provisioned', timeout: 30_000 }, async t => {
  const fixture = await sdkFixture(t, 'unmanaged', "python3 -c 'print(6 * 7)'", true, path.join(process.cwd(), '.local/analysis-python/not-installed'));
  assert.deepEqual(fixture.snapshot.capabilities.analysisPython, {state:'unavailable',reason:'analysis_python_missing'});
  const actual = await fixture.run(); assert.equal(actual.result.outcome, 'completed'); assert.match(actual.actual, /42/); await fixture.agent.close();
});

for (const [name,script] of [
  ['pure Python', "import sys,json; print(json.dumps({'result':sum([20,22]),'duckdbImported':'duckdb' in sys.modules}))"],
  ['mixed Python and DuckDB', "import json,duckdb; c=duckdb.connect(':memory:',config={'autoinstall_known_extensions':False,'autoload_known_extensions':False}); values=c.execute('SELECT x FROM (VALUES (20),(22)) t(x)').fetchall(); print(json.dumps({'result':sum(row[0] for row in values),'autoInstall':c.execute(\"SELECT current_setting('autoinstall_known_extensions')\").fetchone()[0],'autoLoad':c.execute(\"SELECT current_setting('autoload_known_extensions')\").fetchone()[0]})); c.close()"],
] as const) test(`the real Pi may choose ${name} without a Host method branch`, { skip: !integration && 'macOS private integration environment not provisioned', timeout: 30_000 }, async t => {
  const command = name === 'mixed Python and DuckDB' ? shellQuote(executable) : 'python3';
  const fixture = await sdkFixture(t, 'unmanaged', `${command} -B - <<'PY'\n${script}\nPY`);
  const actual = await fixture.run(); assert.match(actual.actual,/result\\": 42/);
  if (name === 'pure Python') assert.match(actual.actual,/duckdbImported\\": false/);
  else { assert.match(actual.actual,/autoInstall\\": false/); assert.match(actual.actual,/autoLoad\\": false/); }
  await fixture.agent.close();
});

test('a protected Agent selects an XLSX sheet and retains absent formula cache and original Markdown', { skip: !integration && 'macOS private integration environment not provisioned', timeout: 30_000 }, async t => {
  const { createHash } = await import('node:crypto');
  const script = `import json,hashlib,openpyxl,duckdb
from pathlib import Path
source=Path('../inputs/book.xlsx'); book=openpyxl.load_workbook(source,read_only=True,data_only=True)
sheet=book['目标']; values=[sheet['A2'].value,sheet['A3'].value]; cache=sheet['A4'].value
c=duckdb.connect(':memory:',config={'autoinstall_known_extensions':False,'autoload_known_extensions':False,'threads':2,'memory_limit':'64MB'})
result=c.execute('SELECT SUM(v) FROM (VALUES (?),(?)) t(v)',values).fetchone()[0]
raw=Path('../inputs/meaning.md').read_bytes(); output={'result':result,'sheet':'目标','range':'A2:A4','formulaCache':cache,'markdownExact':raw.decode('utf-8'),'inputSha256':hashlib.sha256(source.read_bytes()).hexdigest()}
Path('result.json').write_text(json.dumps(output,ensure_ascii=False)); print(json.dumps(output,ensure_ascii=False)); c.close(); book.close()`;
  const fixture = await sdkFixture(t,'protected',`python3 - <<'PY'\n${script}\nPY`);
  const bookFile = path.join(fixture.inputs,'book.xlsx');
  const builder = `import openpyxl,sys\nb=openpyxl.Workbook(); b.active.title='无关'; s=b.create_sheet('目标'); s['A1']='值'; s['A2']=20; s['A3']=22; s['A4']='=SUM(A2:A3)'; s.merge_cells('B1:C1'); b.save(sys.argv[1]); b.close()`;
  assert.equal(spawnSync(executable,['-I','-c',builder,bookFile],{encoding:'utf8'}).status,0);
  const original = await readFile(bookFile), meaning='\uFEFF口径说明😀\r\n本表只统计目标工作表。\r\n';
  await writeFile(path.join(fixture.inputs,'meaning.md'),meaning);
  const actual = await fixture.run(); assert.equal(actual.result.outcome,'completed');
  const output = JSON.parse(await readFile(path.join(fixture.work,'result.json'),'utf8'));
  assert.equal(output.result,42); assert.equal(output.sheet,'目标'); assert.equal(output.formulaCache,null); assert.equal(output.markdownExact,meaning);
  assert.equal(output.inputSha256,createHash('sha256').update(original).digest('hex'));
  assert.deepEqual(await readFile(bookFile),original); await fixture.agent.close();
});

test('drifted private engineering material is unavailable rather than silently adopted', { skip: !integration && 'macOS private integration environment not provisioned', timeout: 30_000 }, async t => {
  const { randomUUID } = await import('node:crypto');
  const root = path.resolve('.local/analysis-python',`drift-fixture-${randomUUID()}`); await mkdir(root,{mode:0o700});
  const ready=JSON.parse(await readFile(path.join(environmentRoot,'ready.json'),'utf8'));
  await writeFile(path.join(root,'changed.py'),'changed'); ready.files=[{path:'changed.py',sha256:'0'.repeat(64)}];
  await writeFile(path.join(root,'ready.json'),JSON.stringify(ready));
  const fixture=await sdkFixture(t,'unmanaged',"python3 -c 'print(42)'",true,root);
  assert.deepEqual(fixture.snapshot.capabilities.analysisPython,{state:'unavailable',reason:'analysis_python_drift'});
  const actual=await fixture.run(); assert.match(actual.actual,/42/); await fixture.agent.close();
});

test('private dependencies and fixed data remain read-only through actual protected Python and SQL', { skip: !integration && 'macOS private integration environment not provisioned', timeout: 30_000 }, async t => {
  const script=`import duckdb\nfrom pathlib import Path\nc=duckdb.connect(':memory:',config={'autoinstall_known_extensions':False,'autoload_known_extensions':False})\ntry:\n c.execute(\"COPY (SELECT 9) TO '../inputs/source.csv' (FORMAT CSV)\"); print('SOURCE:UNEXPECTED')\nexcept duckdb.IOException: print('SOURCE:DENIED')\ntry:\n open(duckdb.__file__,'w').write('changed'); print('DEPENDENCY:UNEXPECTED')\nexcept PermissionError: print('DEPENDENCY:DENIED')\nc.close()`;
  const fixture=await sdkFixture(t,'protected',`python3 - <<'PY'\n${script}\nPY`);
  const actual=await fixture.run(); assert.match(actual.actual,/SOURCE:DENIED/); assert.match(actual.actual,/DEPENDENCY:DENIED/); assert.doesNotMatch(actual.actual,/UNEXPECTED/);
  assert.equal(await readFile(path.join(fixture.inputs,'source.csv'),'utf8'),'value\n42\n'); await fixture.agent.close();
});

test('cancelling one real DuckDB execution preserves another owner and partial files', { skip: !integration && 'macOS private integration environment not provisioned', timeout: 30_000 }, async t => {
  const runtimes: Awaited<ReturnType<typeof createProtectedTools>>[]=[]; const workspaces:string[]=[];
  for(const owner of ['first','second']) {
    const root=await mkdtemp(path.join(evidenceRoot,`parallel-${owner}-`)),work=path.join(root,'work'); await mkdir(work,{mode:0o700}); workspaces.push(work);
    const scope=await createProtectedExecutionScope({id:`parallel-${owner}`,cwd:work,writableRoot:work,readRoots:[]});
    const runtime=await createProtectedTools({scope,codeRoot:process.cwd(),forbiddenRoots:[],analysisPython:{root:environmentRoot}}); runtimes.push(runtime); t.after(()=>runtime.close());
  }
  const controller=new AbortController();
  const script=`import duckdb,tempfile,os\nfrom pathlib import Path\ntemp=tempfile.mkdtemp(prefix='duckdb-',dir=os.environ['TMPDIR']); Path('started.txt').write_text(temp)\nc=duckdb.connect(':memory:',config={'autoinstall_known_extensions':False,'autoload_known_extensions':False,'temp_directory':temp,'threads':2,'memory_limit':'64MB'})\nc.execute('SELECT SUM(SQRT(i)) FROM range(1000000000) t(i)').fetchall(); Path('late.txt').write_text('finished'); c.close()`;
  const first=runtimes[0].tools.find(tool=>tool.name==='bash')!.execute('long-query',{command:`python3 - <<'PY'\n${script}\nPY`},controller.signal,undefined,{} as never); void first.catch(()=>{});
  const deadline=Date.now()+5000; while(!existsSync(path.join(workspaces[0],'started.txt'))) { assert.ok(Date.now()<deadline,'real query started'); await new Promise(resolve=>setTimeout(resolve,20)); }
  const second=await runtimes[1].tools.find(tool=>tool.name==='bash')!.execute('other-query',{command:`python3 - <<'PY'\nimport duckdb,tempfile,os\nfrom pathlib import Path\ntemp=tempfile.mkdtemp(prefix='duckdb-',dir=os.environ['TMPDIR']); c=duckdb.connect(':memory:',config={'autoinstall_known_extensions':False,'autoload_known_extensions':False,'temp_directory':temp}); Path('answer.txt').write_text(str(c.execute('SELECT 42').fetchone()[0])); print(temp); c.close()\nPY`},undefined,undefined,{} as never);
  assert.match(JSON.stringify(second.content),/parallel-second-/);
  controller.abort(); await assert.rejects(first,/aborted|cancelled/); await runtimes[0].close(); await runtimes[1].drain(); await runtimes[1].close();
  assert.equal(await readFile(path.join(workspaces[1],'answer.txt'),'utf8'),'42'); assert.ok((await readFile(path.join(workspaces[0],'started.txt'),'utf8')).startsWith(workspaces[0]+path.sep));
  await assert.rejects(readFile(path.join(workspaces[0],'late.txt')),/ENOENT/);
});

test('the documented DuckDB settings reject an absent extra extension without installing it', { skip: !integration && 'macOS private integration environment not provisioned', timeout: 30_000 }, async t => {
  const script=`import duckdb\nfrom pathlib import Path\next=Path('extensions'); ext.mkdir()\nc=duckdb.connect(':memory:',config={'autoinstall_known_extensions':False,'autoload_known_extensions':False,'extension_directory':str(ext.resolve())})\ntry:\n c.execute('LOAD httpfs'); print('EXTENSION:UNEXPECTED')\nexcept duckdb.Error: print('EXTENSION:UNAVAILABLE')\nprint('downloaded:'+str(len(list(ext.iterdir())))); print('autoInstall:'+str(c.execute(\"SELECT current_setting('autoinstall_known_extensions')\").fetchone()[0])); c.close()`;
  const fixture=await sdkFixture(t,'protected',`python3 - <<'PY'\n${script}\nPY`);
  const actual=await fixture.run(); assert.match(actual.actual,/EXTENSION:UNAVAILABLE/); assert.match(actual.actual,/downloaded:0/); assert.match(actual.actual,/autoInstall:False/); assert.doesNotMatch(actual.actual,/UNEXPECTED/); await fixture.agent.close();
});

test('ProjectAgent stop cancels an actual private DuckDB query and preserves its partial evidence', { skip: !integration && 'macOS private integration environment not provisioned', timeout: 30_000 }, async t => {
  const {randomUUID}=await import('node:crypto');
  const script=`import duckdb\nfrom pathlib import Path\nPath('query-started.txt').write_text('partial evidence')\nc=duckdb.connect(':memory:',config={'autoinstall_known_extensions':False,'autoload_known_extensions':False,'threads':2,'memory_limit':'64MB'}); c.execute('SELECT SUM(SQRT(i)) FROM range(1000000000) t(i)').fetchone(); Path('query-late.txt').write_text('finished'); c.close()`;
  const fixture=await sdkFixture(t,'protected',`python3 - <<'PY'\n${script}\nPY`);
  const run=fixture.agent.start('Run the synthetic long query.',randomUUID()); await run.accepted;
  const deadline=Date.now()+5000; while(!existsSync(path.join(fixture.work,'query-started.txt'))) { assert.ok(Date.now()<deadline,'query actually started'); await new Promise(resolve=>setTimeout(resolve,20)); }
  await fixture.agent.stop(); assert.equal((await run.completion).outcome,'cancelled'); await fixture.agent.close();
  assert.equal(await readFile(path.join(fixture.work,'query-started.txt'),'utf8'),'partial evidence');
  await assert.rejects(readFile(path.join(fixture.work,'query-late.txt')),/ENOENT/);
});

test('normal ProjectAgent drain allows a private DuckDB background calculation to finish', { skip: !integration && 'macOS private integration environment not provisioned', timeout: 30_000 }, async t => {
  const script=`import duckdb,time\nfrom pathlib import Path\ntime.sleep(.4)\nc=duckdb.connect(':memory:',config={'autoinstall_known_extensions':False,'autoload_known_extensions':False,'threads':2,'memory_limit':'64MB'}); Path('background-result.txt').write_text(str(c.execute('SELECT SUM(i) FROM range(11) t(i)').fetchone()[0])); c.close()`;
  const fixture=await sdkFixture(t,'protected',`python3 - >background-log.txt 2>&1 <<'PY' &\n${script}\nPY\necho background-started`);
  const actual=await fixture.run(); assert.equal(actual.result.outcome,'completed'); await fixture.agent.drain(); await fixture.agent.close();
  assert.equal(await readFile(path.join(fixture.work,'background-result.txt'),'utf8'),'55');
});

for (const mode of ['unmanaged','cold'] as const) test(`${mode === 'cold' ? 'an unmanaged cold workspace' : 'an ordinary task'} preserves original Python and isolated user-site computation`, { timeout: 30_000 }, async t => {
  const {runtimeEnvironment}=await import('../scripts/runtime-process.ts');
  await mkdir(evidenceRoot,{recursive:true});
  const userBase=await mkdtemp(path.join(evidenceRoot,'isolated-userbase-'));
  const originalEnvironment={...runtimeEnvironment(),PYTHONUSERBASE:userBase};
  const siteProbe=spawnSync('python3',['-B','-c','import site; print(site.getusersitepackages())'],{env:originalEnvironment,encoding:'utf8',timeout:5000});
  assert.equal(siteProbe.status,0,siteProbe.stderr);
  const userSite=siteProbe.stdout.trim(); assert.ok(userSite.startsWith(userBase+path.sep));
  await mkdir(userSite,{recursive:true,mode:0o700});
  const modulePath=path.join(userSite,'optracall_legacy_sample.py');
  await writeFile(modulePath,'def total(values):\n    return sum(values)\n',{mode:0o444}); await chmod(userSite,0o555);
  const program="import json,sys,site,optracall_legacy_sample; print(json.dumps({'executable':sys.executable,'userSiteEnabled':site.ENABLE_USER_SITE,'modulePath':optracall_legacy_sample.__file__,'total':optracall_legacy_sample.total([20,22])}))";
  const baseline=spawnSync('python3',['-B','-c',program],{env:originalEnvironment,encoding:'utf8',timeout:5000});
  assert.equal(baseline.status,0,baseline.stderr); const original=JSON.parse(baseline.stdout); assert.equal(original.total,42); assert.equal(original.modulePath,modulePath);
  const fixture=await sdkFixture(t,mode,`PYTHONUSERBASE=${shellQuote(userBase)} python3 -B - <<'PY'\n${program}\nPY`);
  await writeFile(path.join(fixture.root,'original-python-compute.json'),JSON.stringify({userBase,userSite,modulePath,status:baseline.status,stdout:baseline.stdout,stderr:baseline.stderr,original},null,2)+'\n');
  const actual=await fixture.run();
  const nativeTool=actual.records.find(record=>record.type==='message' && record.message.role==='toolResult' && record.message.toolName==='bash');
  assert.ok(nativeTool); const output=nativeTool.message.content.filter((part:{type:string;text?:string})=>part.type==='text').map((part:{text:string})=>part.text).join('\n');
  await writeFile(path.join(fixture.root,'ordinary-python-compute-tool.json'),JSON.stringify(nativeTool,null,2)+'\n');
  assert.doesNotMatch(output,/ModuleNotFoundError|Command exited with code/,output);
  const result=JSON.parse(output); assert.equal(result.total,42); assert.equal(result.modulePath,modulePath); assert.equal(result.executable,original.executable); assert.equal(result.userSiteEnabled,original.userSiteEnabled);
  await fixture.agent.close();
});
