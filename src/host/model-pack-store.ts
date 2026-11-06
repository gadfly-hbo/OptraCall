import fs, { constants } from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { validateManifest, toRegistryEntry, MODEL_NAME_PATTERN, type ModelRegistryEntry } from '../../extensions/business-plugins/model-pack/types.ts';
import { ModelPackError } from './model-pack-error.ts';
import { pureModelSource } from './model-pack-purity.ts';
import { readBytes, safePath, writeExclusive } from './project-data-context-io.ts';
export { ModelPackError } from './model-pack-error.ts';
const FILES=['predict.mjs','manifest.json','README.md'] as const;
const MAX=10*1024*1024;
const SCHEMA="CREATE TABLE IF NOT EXISTS models(name TEXT NOT NULL, version INTEGER NOT NULL, stage TEXT NOT NULL CHECK(stage IN ('Staging','Production','Archived')), entry TEXT NOT NULL, PRIMARY KEY(name,version)); CREATE UNIQUE INDEX IF NOT EXISTS single_production ON models(name) WHERE stage='Production';";
const fail=(code:string,status=400,stage='structure',reason=code):never=>{throw new ModelPackError(code,status,stage,reason);};
const missing=(error:unknown)=>(error as NodeJS.ErrnoException).code==='ENOENT';
function directory(file:string) { const st=fs.lstatSync(file); if(!st.isDirectory()||st.isSymbolicLink()) fail('UNSAFE_PATH'); }
function regular(file:string):Buffer {
 const st=fs.lstatSync(file); if(!st.isFile()||st.isSymbolicLink()||st.nlink!==1||st.size>MAX) fail('UNSAFE_PACKAGE_FILE');
 const fd=fs.openSync(file,constants.O_RDONLY|constants.O_NOFOLLOW);
 try { const own=fs.fstatSync(fd); if(own.ino!==st.ino||own.dev!==st.dev||own.nlink!==1) fail('PACKAGE_CHANGED'); const bytes=fs.readFileSync(fd);const after=fs.fstatSync(fd), current=fs.lstatSync(file);if(after.ctimeMs!==own.ctimeMs||after.mtimeMs!==own.mtimeMs||current.ino!==own.ino||current.dev!==own.dev||current.isSymbolicLink()) fail('PACKAGE_CHANGED');return bytes; } finally {fs.closeSync(fd);}
}
function packageBytes(root:string) { directory(root);return Object.fromEntries(FILES.map(name=>[name,regular(path.join(root,name))])) as Record<typeof FILES[number],Buffer>; }
function hash(files:Record<string,Buffer>) {const h=createHash('sha256');for(const key of FILES)h.update(key+'\0'+files[key].length+'\0').update(files[key]);return h.digest('hex');}
function identity(name:string,version?:number) {if(typeof name!=='string'||!MODEL_NAME_PATTERN.test(name)||version!==undefined&&(!Number.isSafeInteger(version)||version<1))fail('MODEL_IDENTITY_INVALID');}
function parse(bytes:Buffer):unknown {try{return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}catch{return fail('MANIFEST_INVALID');}}
export async function executePureModel(source:string,rows:Record<string,unknown>[],signal?:AbortSignal):Promise<Record<string,unknown>[]> {
 signal?.throwIfAborted();const core=pureModelSource(source), runner=fileURLToPath(new URL('./model-pack-runner.mjs',import.meta.url));
 return new Promise((resolve,reject)=>{
  const child=spawn(process.execPath,['--permission',`--allow-fs-read=${runner}`,'--disallow-code-generation-from-strings','--no-experimental-sqlite','--max-old-space-size=128',runner],{env:{},stdio:['pipe','pipe','pipe'],cwd:path.dirname(runner)});
  let chunks:Buffer[]=[],diagnostic='',size=0,settled=false,pendingError:ModelPackError|undefined;const finish=(error?:unknown,value?:Record<string,unknown>[])=>{if(settled)return;settled=true;clearTimeout(timer);signal?.removeEventListener('abort',abort);if(error)reject(error);else resolve(value!);};
  const stop=(error:ModelPackError)=>{pendingError??=error;child.kill('SIGKILL');};
  const abort=()=>stop(new ModelPackError('PREDICT_CANCELLED',409,'execution','执行已取消；未保存输出'));
  const timer=setTimeout(()=>stop(new ModelPackError('PREDICT_TIMEOUT',422,'execution','模型计算超时；未保存输出')),10000);
  child.stdout.on('data',(chunk:Buffer)=>{size+=chunk.length;if(size>MAX){stop(new ModelPackError('PREDICT_OUTPUT_LIMIT',422,'execution'));}else chunks.push(chunk);});
  child.stderr.on('data',(chunk:Buffer)=>{if(diagnostic.length<2048)diagnostic+=chunk.toString().slice(0,2048-diagnostic.length);});child.stdin.on('error',()=>{});child.on('error',()=>finish(new ModelPackError('SANDBOX_UNAVAILABLE',503,'sandbox_smoke','Node 权限沙箱不可用，拒绝无沙箱运行')));
  child.on('close',code=>{if(pendingError)return finish(pendingError);if(code!==0 && /sandbox_unavailable|bad option|unknown option/.test(diagnostic))return finish(new ModelPackError('SANDBOX_UNAVAILABLE',503,'sandbox_smoke','Node 权限沙箱不可用，拒绝无沙箱运行'));if(code!==0)return finish(new ModelPackError('MODEL_EXECUTION_FAILED',422,'execution','模型失败或权限被拒绝；未保存输出'));try{const value:unknown=JSON.parse(Buffer.concat(chunks).toString('utf8'));if(!Array.isArray(value)||value.length!==rows.length||value.some(row=>!row||typeof row!=='object'||Array.isArray(row)))throw Error();finish(undefined,value);}catch{finish(new ModelPackError('MODEL_OUTPUT_INVALID',422,'execution','predict 必须返回与输入等长的对象数组'));}});
  signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted){abort();child.stdin.end();}else child.stdin.end(JSON.stringify({source:core,rows}));
 });
}
function validateOutput(rows:Record<string,unknown>[],outputs:string[]) {for(const row of rows)for(const key of outputs)if(typeof row[key]!=='number'||!Number.isFinite(row[key]))fail('MODEL_OUTPUT_INVALID',422,'execution',`输出列 ${key} 缺失或不是有限数值`);}
function csvRows(text:string):Record<string,unknown>[] {
 const cells:string[][]=[];let row:string[]=[],value='',quoted=false;
 for(let i=0;i<text.length;i++){const c=text[i];if(quoted){if(c==='"'&&text[i+1]==='"'){value+='"';i++;}else if(c==='"')quoted=false;else value+=c;}else if(c==='"'){if(value)fail('INPUT_INVALID');quoted=true;}else if(c===','){row.push(value);value='';}else if(c==='\n'){row.push(value.replace(/\r$/,''));cells.push(row);row=[];value='';}else value+=c;}
 if(quoted)fail('INPUT_INVALID');if(value||row.length){row.push(value.replace(/\r$/,''));cells.push(row);}const nonempty=cells.filter(r=>r.some(c=>c!==''));const header=nonempty.shift();if(!header||new Set(header).size!==header.length||header.some(h=>!h))fail('INPUT_INVALID');return nonempty.map(r=>{if(r.length!==header!.length)fail('INPUT_INVALID');return Object.fromEntries(header!.map((h,i)=>[h,r[i]]));});
}
function csv(rows:Record<string,unknown>[]):string { const keys=[...new Set(rows.flatMap(Object.keys))];const esc=(v:unknown)=>{const t=String(v??'');return /[",\r\n]/.test(t)?'"'+t.replaceAll('"','""')+'"':t;};return [keys.map(esc).join(','),...rows.map(row=>keys.map(k=>esc(row[k])).join(','))].join('\n')+'\n'; }
export class ModelPackStore {
 readonly modelsRoot:string; readonly readOnly:boolean; private db:DatabaseSync|null=null;
 constructor(modelsRoot:string,options:{readOnly?:boolean}={}) {this.modelsRoot=path.resolve(modelsRoot);this.readOnly=options.readOnly===true;}
 private validateDatabase(db:DatabaseSync):void {
  const unsupported=():never=>{const error=new ModelPackError('REGISTRY_SCHEMA_UNSUPPORTED',503,'registry','注册表结构或版本不受支持');error.detail.hint='请保留注册表并核对兼容应用版本；不自动重建或降级。';throw error;};
  if(db.prepare('PRAGMA user_version').get()?.user_version!==1)unsupported();
  const inventory=(connection:DatabaseSync)=>connection.prepare("SELECT type,name,tbl_name,sql FROM sqlite_master ORDER BY type,name").all().map(row=>({...row,sql:row.sql===null?null:String(row.sql).replace(/\s+/g,' ').trim()}));
  const expected=new DatabaseSync(':memory:',{allowExtension:false});
  try {expected.exec(SCHEMA);if(JSON.stringify(inventory(db))!==JSON.stringify(inventory(expected)))unsupported();}
  finally {expected.close();}
 }
 private database(write=false):DatabaseSync|null {
  if(write&&this.readOnly)fail('REGISTRY_READ_ONLY',403);
  if(this.db){try{this.validateDatabase(this.db);return this.db;}catch(error){this.db.close();this.db=null;throw error;}}
  const file=path.join(this.modelsRoot,'registry.sqlite'),existing=fs.existsSync(file);
  if(!existing){if(!write)return null;fs.mkdirSync(this.modelsRoot,{recursive:true,mode:0o700});directory(this.modelsRoot);}
  else {directory(this.modelsRoot);regular(file);}
  const db=new DatabaseSync(file,{readOnly:this.readOnly,allowExtension:false});
  try {
   db.exec('PRAGMA busy_timeout=3000;');
   // Existing storage is validated before any DDL or version assignment.
   // A failed connection is never cached, including a failed read-only open.
   if(!existing){db.exec('PRAGMA journal_mode=DELETE; PRAGMA synchronous=FULL; BEGIN IMMEDIATE;');try{db.exec(SCHEMA);db.exec('PRAGMA user_version=1; COMMIT;');}catch(error){db.exec('ROLLBACK');throw error;}}
   this.validateDatabase(db);this.db=db;return db;
  }catch(error){db.close();throw error;}
 }
 private entries():ModelRegistryEntry[]{const db=this.database();return db?db.prepare('SELECT entry,stage FROM models ORDER BY name,version DESC').all().map(row=>({...JSON.parse(String(row.entry)),stage:row.stage})):[];}
 list():ModelRegistryEntry[]{return this.entries().map(entry=>{try{const files=this.snapshot(entry);return {...entry,...(hash(files)!==entry.snapshotSha256?{corrupted:true}:{})};}catch{return {...entry,corrupted:true};}});}
 get(name:string,version:number):ModelRegistryEntry {identity(name,version);return this.list().find(m=>m.name===name&&m.version===version)??fail('MODEL_NOT_FOUND',404);}
 private snapshot(model:ModelRegistryEntry){identity(model.name,model.version);directory(this.modelsRoot);directory(path.join(this.modelsRoot,model.name));return packageBytes(path.join(this.modelsRoot,model.name,`v${model.version}`));}
 manifest(name:string,version:number):unknown {const model=this.get(name,version);if(model.corrupted)fail('MODEL_CORRUPTED',409,'integrity','快照已损坏，请核对原包；不静默修复');return parse(this.snapshot(model)['manifest.json']);}
 async importPack(sourcePath:string):Promise<ModelRegistryEntry>{
  if(this.readOnly)fail('REGISTRY_READ_ONLY',403);if(typeof sourcePath!=='string'||!path.isAbsolute(sourcePath)||sourcePath.includes('\0'))fail('SOURCE_PATH_INVALID');
  let files:ReturnType<typeof packageBytes>;try {if(fs.realpathSync(sourcePath)!==path.resolve(sourcePath))fail('UNSAFE_PATH');files=packageBytes(sourcePath);}catch(error){if(error instanceof ModelPackError)throw error;return fail('PACKAGE_INCOMPLETE',400,'structure','包须包含三个普通文件，且路径不可为链接');}
  let manifest;try{manifest=validateManifest(parse(files['manifest.json']));}catch(error){return fail((error as {code?:string}).code??'MANIFEST_INVALID',400,'manifest');}
  const source=files['predict.mjs'].toString('utf8');pureModelSource(source);
  // Format v1 has no input types. Cover CSV string cells and numeric JSON
  // cells during admission; this is not a retry of a user prediction request.
  try {
   for(const value of ['1',1]){
    try {const smoke=await executePureModel(source,[Object.fromEntries(manifest.usage.inputs.map(name=>[name,value]))]);validateOutput(smoke,manifest.usage.outputs);break;}
    catch(error){if(value==='1'&&error instanceof ModelPackError&&['MODEL_EXECUTION_FAILED','MODEL_OUTPUT_INVALID'].includes(error.code))continue;throw error;}
   }
  }catch(error){if(error instanceof ModelPackError){error.detail.stage='sandbox_smoke';throw error;}return fail('SANDBOX_UNAVAILABLE',503,'sandbox_smoke');}
  const digest=hash(files),db=this.database(true)!;db.exec('BEGIN IMMEDIATE');let staged:string|undefined,installed:string|undefined,damaged:string|undefined,restoreTarget:string|undefined;
  try {
   const current=this.entries().find(m=>m.name===manifest.model.name&&m.version===manifest.model.version);
   if(current){if(current.snapshotSha256!==digest)fail('MODEL_VERSION_CONFLICT',409,'install','同名版本字节不同，请在 MPS 导出新版本');const existing=this.get(current.name,current.version);if(existing.corrupted){
     const parent=path.join(this.modelsRoot,current.name);directory(parent);const target=path.join(parent,`v${current.version}`);restoreTarget=target;
     let old;try{old=fs.lstatSync(target);}catch(error){if(!missing(error))throw error;}
     if(old){if(old.isDirectory()&&!old.isSymbolicLink())fs.chmodSync(target,0o700);damaged=path.join(parent,`.corrupted-v${current.version}-${randomUUID()}`);fs.renameSync(target,damaged);if(old.isDirectory()&&!old.isSymbolicLink())fs.chmodSync(damaged,old.mode & 0o777);}
     staged=path.join(parent,'.import-'+randomUUID());fs.mkdirSync(staged,{mode:0o700});for(const name of FILES){const fd=fs.openSync(path.join(staged,name),'wx',0o444);try{fs.writeFileSync(fd,files[name]);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}}
     fs.renameSync(staged,target);staged=undefined;installed=target;fs.chmodSync(target,0o555);db.exec('COMMIT');return {...current};
    }db.exec('COMMIT');return existing;}
   const parent=path.join(this.modelsRoot,manifest.model.name);if(!fs.existsSync(parent))fs.mkdirSync(parent,{mode:0o700});directory(parent);
   const target=path.join(parent,`v${manifest.model.version}`);if(fs.existsSync(target))fail('UNREGISTERED_SNAPSHOT',409,'install','存在未登记快照，保留现场并拒绝覆盖');
   staged=path.join(parent,'.import-'+randomUUID());fs.mkdirSync(staged,{mode:0o700});for(const name of FILES){const fd=fs.openSync(path.join(staged,name),'wx',0o444);try{fs.writeFileSync(fd,files[name]);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}}fs.renameSync(staged,target);staged=undefined;installed=target;fs.chmodSync(target,0o555);
   const entry=toRegistryEntry(manifest,{stage:'Staging',installedAt:new Date().toISOString(),sourcePath:path.resolve(sourcePath),snapshotSha256:digest});db.prepare('INSERT INTO models(name,version,stage,entry) VALUES (?,?,?,?)').run(entry.name,entry.version,entry.stage,JSON.stringify(entry));db.exec('COMMIT');return entry;
  }catch(error){db.exec('ROLLBACK');if(staged){fs.chmodSync(staged,0o700);fs.rmSync(staged,{recursive:true});}if(installed){fs.chmodSync(installed,0o700);fs.rmSync(installed,{recursive:true});}if(damaged&&restoreTarget&&!fs.existsSync(restoreTarget))fs.renameSync(damaged,restoreTarget);throw error;}
 }
 promote(name:string,version:number):{model:ModelRegistryEntry;archived:ModelRegistryEntry|null}{
  identity(name,version);const db=this.database(true)!;db.exec('BEGIN IMMEDIATE');try{const model=this.get(name,version);if(model.corrupted)fail('MODEL_CORRUPTED',409,'integrity');if(model.stage==='Archived')fail('MODEL_ARCHIVED',409);const archived=this.list().find(m=>m.name===name&&m.stage==='Production'&&m.version!==version)??null;if(archived)db.prepare("UPDATE models SET stage='Archived' WHERE name=? AND version=?").run(name,archived.version);db.prepare("UPDATE models SET stage='Production' WHERE name=? AND version=?").run(name,version);db.exec('COMMIT');return {model:{...model,stage:'Production'},archived:archived?{...archived,stage:'Archived'}:null};}catch(error){db.exec('ROLLBACK');throw error;}
 }
 async predict(input:{name:string;version?:number;inputPath:string;outputPath:string;projectRoot:string;signal?:AbortSignal}){
  if(input.signal?.aborted)fail('PREDICT_CANCELLED',409,'execution','执行已取消；未保存输出');identity(input.name,input.version);const model=input.version===undefined?this.list().find(m=>m.name===input.name&&m.stage==='Production')??fail('MODEL_NOT_FOUND',404):this.get(input.name,input.version);
  if(model.corrupted)fail('MODEL_CORRUPTED',409,'integrity');if(model.stage==='Archived')fail('MODEL_ARCHIVED',409);
  const root=await fsp.realpath(input.projectRoot);
  const allowed=async(value:string,output=false)=>{if(typeof value!=='string'||!value||value.includes('\0'))fail('PROJECT_PATH_INVALID');const relative=path.isAbsolute(value)?path.relative(root,value):value;const parts=relative.split('/');if(!['020_clean',...(output?['060_reports']:[])].includes(parts[0])||!['.csv','.json'].includes(path.extname(relative).toLowerCase()))fail('PROJECT_PATH_INVALID',403);try{return await safePath(root,relative);}catch{return fail('PROJECT_PATH_INVALID',403);}};
  const inputFile=await allowed(input.inputPath), outputFile=await allowed(input.outputPath,true);let bytes:Buffer;try{bytes=await readBytes(inputFile,MAX);}catch{return fail('INPUT_UNSAFE',403,'execution');}
  let rows:Record<string,unknown>[];try {rows=path.extname(inputFile).toLowerCase()==='.json'?JSON.parse(bytes.toString('utf8')):csvRows(bytes.toString('utf8'));if(!Array.isArray(rows)||!rows.length||rows.length>100000||rows.some(r=>!r||typeof r!=='object'||Array.isArray(r)))throw Error();}catch{return fail('INPUT_INVALID',400,'execution');}
  for(const key of model.usage.inputs)if(rows.some(row=>!(key in row)))fail('INPUT_COLUMN_MISSING',400,'execution',`输入缺少 usage.inputs 声明列: ${key}`);
  const snapshot=this.snapshot(model);if(hash(snapshot)!==model.snapshotSha256)fail('MODEL_CORRUPTED',409,'integrity');
  const output=await executePureModel(snapshot['predict.mjs'].toString('utf8'),rows,input.signal);validateOutput(output,model.usage.outputs);if(input.signal?.aborted)fail('PREDICT_CANCELLED',409,'execution','执行已取消；未保存输出');
  const merged=output.map((row,i)=>({...rows[i],...row})), rendered=Buffer.from(path.extname(outputFile).toLowerCase()==='.json'?JSON.stringify(merged)+'\n':csv(merged));
  if(rendered.length>MAX)fail('PREDICT_OUTPUT_LIMIT',422,'execution');
  try{await allowed(input.outputPath,true);await writeExclusive(outputFile,rendered);}catch(error){if((error as NodeJS.ErrnoException).code==='EEXIST')fail('OUTPUT_EXISTS',409,'execution','输出已存在，请选择新文件名；不覆盖原件');return fail('OUTPUT_SAVE_FAILED',409,'execution','输出保存失败，未确认结果；请核对目标文件');}
  return {model,rows:output.length,outputPath:path.relative(root,outputFile),provenance:{name:model.name,version:model.version,stage:model.stage,metrics:model.metrics,fingerprint:model.fingerprint,trainedAt:model.training.trainedAt}};
 }
 close(){this.db?.close();this.db=null;}
}
