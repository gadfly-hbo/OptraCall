import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { startTestHost } from './fixtures/host-process.ts';
import { startToolProvider, providerMessageText } from './fixtures/tool-provider.ts';
import { sessionEvents } from './fixtures/session-events.ts';
import { readJson } from './fixtures/joint-context.ts';

const evidenceRoot = path.resolve('.local/fourbase-modules/m7-duckdb/implementation/runtime/host-integration');
const pythonRoot = path.resolve('.local/analysis-python/cpython-3.14.4-arm64-duckdb-2.0.0-openpyxl-3.1.5');
const executable = path.join(pythonRoot, 'bin', 'python3');
const shellQuote = (value: string) => "'" + value.replaceAll("'", "'\"'\"'") + "'";
const integration = process.platform === 'darwin' && existsSync(executable);
const digest = (bytes: Buffer | string) => createHash('sha256').update(bytes).digest('hex');
const dataContext = (projectId: string) => `/api/projects/${projectId}/data-context`;
async function fileBytes(host: Awaited<ReturnType<typeof startTestHost>>, projectId: string, relative: string) {
  const response = await host.request(`/api/projects/${projectId}/files/content?path=${encodeURIComponent(relative)}`);
  assert.equal(response.status, 200, await response.clone().text()); return Buffer.from(await response.arrayBuffer());
}
async function turn(host: Awaited<ReturnType<typeof startTestHost>>, projectId: string, taskId: string, input: Record<string, unknown>) {
  const stream = await sessionEvents(host, projectId, taskId);
  try {
    await readJson(await host.request(`/api/projects/${projectId}/tasks/${taskId}/messages`, 'POST', input), 202);
    const terminal = await stream.terminal;
    assert.equal(terminal.type, 'run.settled');
    if (terminal.type === 'run.settled') assert.equal(terminal.outcome, 'completed', JSON.stringify(terminal));
    return stream.events;
  } finally { await stream.close(); }
}

// Acceptance through the existing Host/Pi interfaces; this does not claim pre-implementation TDD.
test('isolated Host ordinary Pi reads XLSX, joins in DuckDB, saves native and fixed artifacts, and reopens without replay', { skip: !integration && 'macOS private integration environment not provisioned', timeout: 90_000 }, async t => {
  await mkdir(evidenceRoot, { recursive: true });
  const root = await mkdtemp(path.join(evidenceRoot, 'case-'));
  const fixtureRoot = path.join(root, 'fixtures'), dataRoot = path.join(root, 'host'), projectsRoot = path.join(root, 'projects');
  await mkdir(fixtureRoot, { mode: 0o700 });
  const workbookPath = path.join(fixtureRoot, 'orders.xlsx');
  const builder = `import openpyxl,sys\nb=openpyxl.Workbook(); b.active.title='不使用'; b.active.append(['amount']); b.active.append([999]); s=b.create_sheet('订单'); s.append(['order_id','product_id','amount']); [s.append(row) for row in [(1,'p1','10.005'),(2,'p2','20.015'),(3,'p1',None),(4,'missing','7.000'),(5,'p3','1.005'),(6,None,'2.005')]]; f=b.create_sheet('公式'); f['A1']='=SUM(订单!C2:C7)'; b.save(sys.argv[1]); b.close()`;
  const built = spawnSync(executable, ['-I', '-B', '-c', builder, workbookPath], { encoding: 'utf8', env: { PATH: process.env.PATH, TMPDIR: fixtureRoot }, timeout: 5000 });
  assert.equal(built.status, 0, built.stderr);
  const workbook = await readFile(workbookPath), csv = Buffer.from('product_id,category\np1,A\np1,A\np2,B\np3,C\n');
  const provider = await startToolProvider(); let host = await startTestHost({ dataRoot, projectsRoot, cwd: process.cwd(), timeoutMs: 10_000 });
  t.after(async () => { await host.close(); await provider.close(); });
  await readJson(await host.request('/api/configuration', 'PUT', { name: 'DuckDB Host integration synthetic', provider: 'openai-compatible', baseUrl: provider.baseUrl, model: 'synthetic-duckdb-host', apiKey: 'synthetic-duckdb-host-only' }));
  const { project } = await readJson(await host.request('/api/projects', 'POST', { name: 'DuckDB隔离合成项目' }), 201);
  const { task } = await readJson(await host.request(`/api/projects/${project.id}/tasks`, 'POST', { name: 'XLSX关联汇总' }), 201);
  const fixed: { selection: {datasetId:string;inputVersionId:string;descriptionRevisionId:null}; copyPath:string; sha256:string; bytes:number }[] = [];
  for (const [name, bytes] of [['products.csv', csv], ['orders.xlsx', workbook]] as const) {
    await readJson(await host.request(`/api/projects/${project.id}/files/upload`, 'POST', { directory: '020_clean', name, content: bytes.toString('base64') }), 201);
    const inputVersionId = randomUUID(), datasetId = randomUUID();
    const saved = await readJson(await host.request(`${dataContext(project.id)}/inputs`, 'POST', { operationId: inputVersionId, inputVersionId, datasetId, baseIndexRevision: fixed.length, name, sourcePath: `020_clean/${name}`, expectedSha256: digest(bytes), expectedBytes: bytes.length }), 201);
    assert.equal(saved.record.sha256, digest(bytes));
    const prepared = await readJson(await host.request(`${dataContext(project.id)}/prepare`, 'POST', { datasetId, inputVersionId }));
    fixed.push({ selection: { datasetId, inputVersionId, descriptionRevisionId: null }, copyPath: prepared.copy.path, sha256: digest(bytes), bytes: bytes.length });
  }
  assert.equal(provider.requests.length, 0, 'configuration/upload/fixed-copy preparation does not execute a model');
  const reportPath = '060_reports/duckdb-host-report.md', sqlPath = '020_clean/duckdb-host-query.sql', parametersPath = '020_clean/duckdb-host-parameters.json', resultPath = '020_clean/duckdb-host-result.json', versionsPath = '020_clean/duckdb-host-versions.json';
  const sql = 'SELECT COALESCE(p.category, ?) AS category, COUNT(*) AS joined_rows, COUNT(o.amount) AS amount_rows, SUM(o.amount)::VARCHAR AS raw_amount, ROUND(SUM(o.amount),2)::VARCHAR AS rounded_amount FROM orders o LEFT JOIN products p ON o.product_id=p.product_id GROUP BY 1 ORDER BY 1';
  const program = `import json,csv,sys,platform,tempfile,hashlib,os,duckdb,openpyxl,et_xmlfile
from pathlib import Path
from importlib.metadata import version
from decimal import Decimal,ROUND_HALF_UP
root=Path(${JSON.stringify(project.rootPath)})
bookFile=root/${JSON.stringify(fixed[1].copyPath)}; productFile=root/${JSON.stringify(fixed[0].copyPath)}
book=openpyxl.load_workbook(bookFile,read_only=True,data_only=True)
sheet=book['订单']; orders=list(sheet.iter_rows(min_row=2,max_row=7,min_col=1,max_col=3,values_only=True)); orders=[(i,p,None if a is None else Decimal(a)) for i,p,a in orders]; formulaCache=book['公式']['A1'].value
with productFile.open(newline='') as handle: products=list(csv.DictReader(handle))
temp=tempfile.mkdtemp(prefix='duckdb-host-',dir=os.environ['TMPDIR'])
config={'autoinstall_known_extensions':False,'autoload_known_extensions':False,'threads':2,'memory_limit':'64MB','temp_directory':temp}
connection=duckdb.connect(':memory:',config=config)
connection.execute('CREATE TABLE orders(order_id INTEGER,product_id VARCHAR,amount DECIMAL(18,3))'); connection.executemany('INSERT INTO orders VALUES (?,?,?)',orders)
connection.execute('CREATE TABLE products(product_id VARCHAR,category VARCHAR)'); connection.executemany('INSERT INTO products VALUES (?,?)',[(p['product_id'],p['category']) for p in products])
sql=${JSON.stringify(sql)}; parameters=['UNMAPPED']; rows=connection.execute(sql,parameters).fetchall()
result={'groups':[{'category':category,'joinedRows':count,'amountRows':amountRows,'rawAmount':rawAmount,'roundedAmount':roundedAmount} for category,count,amountRows,rawAmount,roundedAmount in rows],'source':{'rows':len(orders),'amountRows':sum(a is not None for _,_,a in orders),'rawAmount':str(sum(a for _,_,a in orders if a is not None))},'joinedRows':sum(row[1] for row in rows),'rawJoinedAmount':str(sum(Decimal(row[3]) for row in rows)),'roundedGroupTotal':str(sum(Decimal(row[4]) for row in rows)),'roundedJoinedTotal':str(sum(Decimal(row[3]) for row in rows).quantize(Decimal('0.01'),rounding=ROUND_HALF_UP)),'sheet':'订单','range':'A1:C7','readOnly':book.read_only,'dataOnly':book.data_only,'formulaCache':formulaCache,'formulaCacheFreshness':'unknown','versions':{'python':platform.python_version(),'duckdb':duckdb.__version__,'openpyxl':openpyxl.__version__,'et-xmlfile':version('et-xmlfile')},'imports':{'duckdb':duckdb.__file__,'openpyxl':openpyxl.__file__},'pythonExecutable':sys.executable,'sql':sql,'parameters':parameters,'inputVersions':${JSON.stringify(fixed.map(value=>value.selection.inputVersionId))},'sourceHashes':{'workbook':hashlib.sha256(bookFile.read_bytes()).hexdigest(),'products':hashlib.sha256(productFile.read_bytes()).hexdigest()},'settings':{key:connection.execute('SELECT current_setting(?)',[key]).fetchone()[0] for key in ['autoinstall_known_extensions','autoload_known_extensions','threads','memory_limit','temp_directory']}}
(root/${JSON.stringify(sqlPath)}).write_text(sql+'\\n'); (root/${JSON.stringify(parametersPath)}).write_text(json.dumps(parameters)); (root/${JSON.stringify(resultPath)}).write_text(json.dumps(result,ensure_ascii=False)); (root/${JSON.stringify(versionsPath)}).write_text(json.dumps({'versions':result['versions'],'imports':result['imports'],'pythonExecutable':result['pythonExecutable'],'settings':result['settings']})); (root/${JSON.stringify(reportPath)}).write_text('# 合成关联汇总与限制\\n原表6行，非空金额5行，总额40.030。关联后8行，金额50.035；重复键导致放大，不自动认定去重口径。\\n逐组舍入合计50.05；总额舍入50.04，二者不能混用。\\n公式缓存缺失；新鲜度未知，未重算。\\n计算依据：${sqlPath}、${parametersPath}、${versionsPath}、${resultPath}\\n')
print(json.dumps(result,ensure_ascii=False)); connection.close(); book.close()`;
  // The synthetic Provider chooses this test method. Host production code does not contain it.
  provider.setResponder(context => {
    if (!context.recentToolResults.length) { assert.ok(context.availableTools.includes('bash')); assert.ok(context.messages.some(message=>(message.role==='system' || message.role==='developer') && providerMessageText(message.content).includes(executable)), 'the Agent receives the optional private interpreter path'); return { calls: [{ name: 'bash', arguments: { command: `${shellQuote(executable)} -B - <<'DUCKDB_HOST'\n${program}\nDUCKDB_HOST` } }] }; }
    const output = providerMessageText(context.recentToolResults.at(-1)?.content); assert.match(output, /"rawJoinedAmount": "50.035"/); assert.match(output, /"readOnly": true/); assert.match(output, /"dataOnly": true/);
    return { text: '合成工具实际完成关联汇总并另存报告；该固定回复不证明真实模型专业质量。' };
  });
  const requestId = randomUUID(), route = `/api/projects/${project.id}/tasks/${task.id}`;
  const events = await turn(host, project.id, task.id, { requestId, text: '按当前固定资料分析并保存报告及可回查依据。', projectData: fixed.map(value=>value.selection) });
  assert.ok(events.some(event=>event.type==='native' && event.event.type==='tool_execution_start'));
  const result = JSON.parse((await fileBytes(host, project.id, resultPath)).toString());
  assert.deepEqual(result.groups,[{category:'A',joinedRows:4,amountRows:2,rawAmount:'20.010',roundedAmount:'20.01'},{category:'B',joinedRows:1,amountRows:1,rawAmount:'20.015',roundedAmount:'20.02'},{category:'C',joinedRows:1,amountRows:1,rawAmount:'1.005',roundedAmount:'1.01'},{category:'UNMAPPED',joinedRows:2,amountRows:2,rawAmount:'9.005',roundedAmount:'9.01'}]);
  assert.deepEqual(result.source,{rows:6,amountRows:5,rawAmount:'40.030'}); assert.equal(result.joinedRows,8); assert.equal(result.rawJoinedAmount,'50.035'); assert.equal(result.roundedGroupTotal,'50.05'); assert.equal(result.roundedJoinedTotal,'50.04');
  assert.equal(result.readOnly,true); assert.equal(result.dataOnly,true); assert.equal(result.formulaCache,null); assert.equal(result.formulaCacheFreshness,'unknown');
  assert.deepEqual(result.versions,{python:'3.14.4',duckdb:'2.0.0',openpyxl:'3.1.5','et-xmlfile':'2.0.0'});
  assert.ok(result.imports.duckdb.startsWith(pythonRoot+path.sep)); assert.ok(result.imports.openpyxl.startsWith(pythonRoot+path.sep));
  assert.equal(result.sourceHashes.workbook,digest(workbook)); assert.equal(result.sourceHashes.products,digest(csv));
  assert.deepEqual(await fileBytes(host,project.id,'020_clean/orders.xlsx'),workbook);
  assert.equal(result.settings.autoinstall_known_extensions,false); assert.equal(result.settings.autoload_known_extensions,false);
  assert.equal((await fileBytes(host,project.id,sqlPath)).toString(),sql+'\n'); assert.deepEqual(JSON.parse((await fileBytes(host,project.id,parametersPath)).toString()),['UNMAPPED']);
  const state = await readJson(await host.request(route)); assert.ok(state.task.sessionFile);
  const nativeFile=state.task.sessionFile, nativeBefore=await readFile(nativeFile), entries=nativeBefore.toString().trim().split('\n').map(line=>JSON.parse(line));
  const nativeSessionId=entries[0].id, nativeTool=entries.find(entry=>entry.type==='message' && entry.message.role==='toolResult' && entry.message.toolName==='bash');
  assert.ok(nativeTool?.id); assert.equal(JSON.parse(providerMessageText(nativeTool.message.content)).rawJoinedAmount,'50.035'); assert.ok(JSON.stringify(entries).includes('openpyxl.load_workbook'));
  const citationId=randomUUID(), report=await fileBytes(host,project.id,reportPath);
  const attachments=await Promise.all([sqlPath,parametersPath,versionsPath,resultPath].map(async relative=>{const bytes=await fileBytes(host,project.id,relative);return{path:relative,sha256:digest(bytes),bytes:bytes.length};}));
  const citation=await readJson(await host.request(`${dataContext(project.id)}/citations`,'POST',{operationId:citationId,citationId,baseIndexRevision:2,report:{path:reportPath,sha256:digest(report),bytes:report.length},attachments,selections:fixed.map(value=>value.selection),conceptRefs:[],sapRefs:[],declarer:'user',declaration:'隔离工程合成场景，精确固定实际工具产出的报告、SQL、参数与结果，不认证真实业务正确性。',nativeEvidence:{taskId:task.id,nativeSessionId,entryId:nativeTool.id}}),201);
  assert.equal(citation.record.nativeEvidence.entryId,nativeTool.id); assert.equal(citation.record.attachments.length,4);

  const {task:pureTask}=await readJson(await host.request(`/api/projects/${project.id}/tasks`,'POST',{name:'普通纯Python选择'}),201);
  const purePath='020_clean/pure-python-host.json';
  const pureProgram=`import sys,json\nfrom pathlib import Path\nresult={'total':sum([20,22]),'duckdbImported':'duckdb' in sys.modules,'python':sys.version.split()[0],'executable':sys.executable}\nPath(${JSON.stringify(path.join(project.rootPath,purePath))}).write_text(json.dumps(result)); print(json.dumps(result))`;
  provider.setResponder(context=>!context.recentToolResults.length?{calls:[{name:'bash',arguments:{command:`${shellQuote(executable)} -B - <<'PURE_HOST'\n${pureProgram}\nPURE_HOST`}}]}:{text:'普通纯Python合成工具完成；未导入DuckDB。'});
  const pureEvents=await turn(host,project.id,pureTask.id,{requestId:randomUUID(),text:'使用原有授权方法作简单合成计算并保存。'});
  assert.ok(pureEvents.some(event=>event.type==='native' && event.event.type==='tool_execution_start'));
  const pure=JSON.parse((await fileBytes(host,project.id,purePath)).toString()); assert.equal(pure.total,42); assert.equal(pure.duckdbImported,false); assert.ok(pure.executable.startsWith(pythonRoot+path.sep));
  const pureState=await readJson(await host.request(`/api/projects/${project.id}/tasks/${pureTask.id}`)),pureNative=await readFile(pureState.task.sessionFile);
  const callsBeforeReopen=provider.requests.length; assert.equal(callsBeforeReopen,4); assert.deepEqual(provider.errors,[]);
  await writeFile(path.join(root,'first-host-output.json'),JSON.stringify(host.output(),null,2)+'\n');
  await host.close(); host=await startTestHost({dataRoot,projectsRoot,cwd:process.cwd(),timeoutMs:10_000});
  const reopened=await readJson(await host.request(`${route}/open`,'POST',{}));
  assert.equal(reopened.task.sessionFile,nativeFile); assert.equal(reopened.snapshot.sessionId,nativeSessionId);
  assert.ok((await readFile(nativeFile)).subarray(0,nativeBefore.length).equals(nativeBefore));
  const readback=await readJson(await host.request(route)); assert.ok(readback.snapshot.messages.some((message:any)=>message.role==='toolResult' && providerMessageText(message.content).includes('"rawJoinedAmount": "50.035"')));
  assert.deepEqual(Buffer.from(await(await host.request(`${dataContext(project.id)}/citations/${citationId}/evidence`)).arrayBuffer()),report);
  for(const [index,attachment]of attachments.entries())assert.equal(digest(Buffer.from(await(await host.request(`${dataContext(project.id)}/citations/${citationId}/evidence?attachmentIndex=${index}`)).arrayBuffer())),attachment.sha256);
  assert.deepEqual(Buffer.from(await(await host.request(`${dataContext(project.id)}/datasets/${fixed[1].selection.datasetId}/versions/${fixed[1].selection.inputVersionId}/evidence`)).arrayBuffer()),workbook);
  const reopenedPure=await readJson(await host.request(`/api/projects/${project.id}/tasks/${pureTask.id}/open`,'POST',{}));
  assert.equal(reopenedPure.task.sessionFile,pureState.task.sessionFile); assert.ok((await readFile(pureState.task.sessionFile)).subarray(0,pureNative.length).equals(pureNative));
  assert.deepEqual(JSON.parse((await fileBytes(host,project.id,purePath)).toString()),pure);
  assert.equal(provider.requests.length,callsBeforeReopen,'open/history/fixed-file readback must not replay model or tools');
  const receipt={root,projectId:project.id,taskId:task.id,nativeFile,nativeSessionId,nativeToolEntryId:nativeTool.id,nativeBeforeSha256:digest(nativeBefore),nativeAfterSha256:digest(await readFile(nativeFile)),fixed,citationId,report:{path:reportPath,sha256:digest(report),bytes:report.length},attachments,result,pure,pureTaskId:pureTask.id,pureNativeFile:pureState.task.sessionFile,providerRequests:callsBeforeReopen,reopenProviderRequests:provider.requests.length};
  await writeFile(path.join(root,'receipt.json'),JSON.stringify(receipt,null,2)+'\n');
  await writeFile(path.join(root,'events.json'),JSON.stringify({duckdb:events,pure:pureEvents},null,2)+'\n');
  await writeFile(path.join(root,'synthetic-provider-requests.json'),JSON.stringify(provider.requests,null,2)+'\n');
  await writeFile(path.join(root,'reopened-host-output.json'),JSON.stringify(host.output(),null,2)+'\n');
});
