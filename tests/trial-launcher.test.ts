import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink, cp } from 'node:fs/promises';
import path from 'node:path';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash, randomUUID } from 'node:crypto';

const launcher = await import(new URL('../scripts/trial-launcher.mjs', import.meta.url).href);
const evidence = path.resolve('.local/macbook-trial-delivery/launcher/tests');
const execute = promisify(execFile);
async function git(root: string, args: string[]) { return (await execute('git',['-c','core.hooksPath=/dev/null','-c','core.fsmonitor=false','-c','commit.gpgsign=false','-c','user.name=OptraCall synthetic test','-c','user.email=synthetic@example.invalid',...args],{cwd:root})).stdout.trim(); }
async function commitFixture(root: string) { await git(root,['add','.']);await git(root,['commit','--quiet','-m','Synthetic launcher fixture']); }
async function stampFixture(root: string) {
 const build={schema:1,version:'0.1.0-synthetic',commit:await git(root,['rev-parse','HEAD']),tree:await git(root,['rev-parse','HEAD^{tree}']),dirty:false,builtAt:'2026-10-29T00:00:00.000Z'};
 await writeFile(path.join(root,'dist/optracall-build.json'),JSON.stringify(build));return build;
}
async function fixture() {
  await mkdir(evidence, { recursive: true }); const root = await mkdtemp(path.join(evidence, 'launch space#-'));
  await mkdir(path.join(root, 'scripts')); await mkdir(path.join(root, 'dist'));
  await writeFile(path.join(root, 'dist', 'index.html'), '<h1>Synthetic trial UI</h1>');
  await writeFile(path.join(root, 'package.json'), JSON.stringify({type:'module',version:'0.1.0-synthetic',scripts:{build:'node -e "process.exit(88)"'}}));
  await writeFile(path.join(root,'.gitignore'),'dist/\nstate/\nhost/\nprojects/\nfinder-home/\nnode_modules/\nstopped.json\n');
  await writeFile(path.join(root, 'scripts', 'start-host.mjs'), `import { createServer } from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
const args=new Map(process.argv.slice(2).map(v=>v.split('='))); const build=JSON.parse(fs.readFileSync(path.join(process.cwd(),'dist/optracall-build.json'),'utf8'));const instanceId=args.get('--instance-id');
const server=createServer((request,response)=>{response.setHeader('content-type','application/json');if(request.url==='/api/health')response.end(JSON.stringify({status:'ready',runtime:{instanceId,pid:process.pid,codeRoot:process.cwd(),...build}}));else response.end(JSON.stringify({ui:'Synthetic trial UI'}));});
server.listen(Number(args.get('--port')),'127.0.0.1',()=>console.log(JSON.stringify({kind:'host-ready',port:server.address().port})));
process.on('SIGTERM',()=>{fs.writeFileSync(path.join(process.cwd(),'stopped.json'),JSON.stringify({instanceId,signal:'SIGTERM'}));server.close(()=>process.exit(0));});
`);
  await git(root,['init','--quiet','-b','main']);await commitFixture(root);const build=await stampFixture(root);
  const options = { root, stateRoot: path.join(root, 'state'), dataRoot: path.join(root, 'host'), projectsRoot: path.join(root, 'projects'), port: 0, openBrowser: false, startupTimeoutMs: 5000 };
  return { root, options, build, cleanup: () => rm(root, { recursive: true, force: true }) };
}
async function actualHostFixture() {
 const f=await fixture();
 await cp(path.resolve('scripts'),path.join(f.root,'scripts'),{recursive:true});await cp(path.resolve('src'),path.join(f.root,'src'),{recursive:true});await symlink(path.resolve('node_modules'),path.join(f.root,'node_modules'));
 await commitFixture(f.root);f.build=await stampFixture(f.root);
 const html=await readFile(path.join(f.root,'dist/index.html'));
 await writeFile(path.join(f.root,'dist/optracall-build.json'),JSON.stringify({...f.build,files:[{path:'index.html',bytes:html.length,sha256:createHash('sha256').update(html).digest('hex')}]}));
 return f;
}

test('TRIAL-01: occupied port is reported without touching another local service', async t => {
  const f = await fixture(); const server = createServer((_request, response) => response.end('unrelated service'));
  server.listen(0, '127.0.0.1'); await once(server, 'listening'); const address = server.address(); assert.ok(address && typeof address === 'object'); f.options.port = address.port;
  t.after(() => new Promise<void>(resolve => server.close(() => resolve())));
  await assert.rejects(launcher.startTrial(f.options), (error: any) => error.code === 'port_in_use');
  assert.equal((await launcher.stopTrial(f.options)).status,'not-running');
  assert.equal(await (await fetch(`http://127.0.0.1:${address.port}/`)).text(), 'unrelated service');
  await f.cleanup();
});

async function availablePort() { const server=createServer(); server.listen(0,'127.0.0.1');await once(server,'listening');const address=server.address();assert.ok(address&&typeof address==='object');await new Promise<void>(resolve=>server.close(()=>resolve()));return address.port; }

test('TRIAL-02: start reuses the live instance, reports its actual build, and stops it gracefully', async t => {
 const f=await fixture();f.options.port=await availablePort();t.after(async()=>{await launcher.stopTrial(f.options).catch(()=>{});await f.cleanup();});
 const first=await launcher.startTrial(f.options);assert.equal(first.status,'started');assert.equal(first.runtime.commit,f.build.commit);
 assert.equal((await(await fetch(first.url)).json()).ui,'Synthetic trial UI');
 const newer={schema:1,version:'disk-newer',commit:'c'.repeat(40),tree:'d'.repeat(40),dirty:false,builtAt:'2026-10-29T00:01:00.000Z'};await writeFile(path.join(f.root,'dist/optracall-build.json'),JSON.stringify(newer));
 const second=await launcher.startTrial(f.options);assert.equal(second.status,'already-running');assert.equal(second.pid,first.pid);assert.equal(second.runtime.commit,f.build.commit,'running identity comes from the live Host, not changed disk metadata');
 const stopped=await launcher.stopTrial(f.options);assert.equal(stopped.status,'stopped');const marker=JSON.parse(await readFile(path.join(f.root,'stopped.json'),'utf8'));assert.equal(marker.instanceId,first.instanceId);assert.equal(marker.signal,'SIGTERM');await assert.rejects(fetch(first.url));
});

test('TRIAL-03: simultaneous starts create one process and share the instance identity', async t => {
 const f=await fixture();f.options.port=await availablePort();t.after(async()=>{await launcher.stopTrial(f.options).catch(()=>{});await f.cleanup();});
 const attempts=await Promise.all([launcher.startTrial(f.options),launcher.startTrial(f.options),launcher.startTrial(f.options)]);
 assert.equal(attempts.filter(result=>result.status==='started').length,1);assert.equal(new Set(attempts.map(result=>result.instanceId)).size,1);assert.equal(new Set(attempts.map(result=>result.pid)).size,1);
});

test('TRIAL-04: a concurrent lock initializer is allowed to finish publishing its owner record', async t => {
 const f=await fixture();f.options.port=await availablePort();await mkdir(f.options.stateRoot,{recursive:true});
 const lock=path.join(f.options.stateRoot,'operation.lock');await writeFile(lock,'',{mode:0o600});
 const publish=setTimeout(()=>{void writeFile(lock,JSON.stringify({pid:process.pid,token:'synthetic-active-owner'}));},80);
 const release=setTimeout(()=>{void rm(lock);},160);
 t.after(async()=>{clearTimeout(publish);clearTimeout(release);await launcher.stopTrial(f.options).catch(()=>{});await f.cleanup();});
 const started=await launcher.startTrial(f.options);assert.equal(started.status,'started');
});

test('TRIAL-05: a recorded unrelated live PID is never stopped', async t => {
 const f=await fixture();f.options.port=await availablePort();await mkdir(f.options.stateRoot,{recursive:true});
 const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});await once(child,'spawn');assert.ok(child.pid);
 t.after(async()=>{if(child.exitCode===null&&child.signalCode===null){child.kill('SIGTERM');await once(child,'exit');}await f.cleanup();});
 await writeFile(path.join(f.options.stateRoot,'instance.json'),JSON.stringify({schema:1,pid:child.pid,hostPid:child.pid,instanceId:randomUUID(),root:f.root,port:f.options.port}));
 await assert.rejects(launcher.stopTrial(f.options),(error:any)=>error.code==='instance_identity_mismatch');
 assert.equal(child.exitCode,null);assert.equal(child.signalCode,null);process.kill(child.pid,0);
 await assert.rejects(launcher.startTrial(f.options),(error:any)=>error.code==='instance_identity_mismatch');
});

test('TRIAL-06: a running trial refuses update admission and keeps serving', async t => {
 const f=await fixture();f.options.port=await availablePort();t.after(async()=>{await launcher.stopTrial(f.options).catch(()=>{});await f.cleanup();});
 const running=await launcher.startTrial(f.options);
 await assert.rejects(launcher.assertTrialStopped(f.options),(error:any)=>error.code==='app_running');
 assert.equal((await(await fetch(running.url)).json()).ui,'Synthetic trial UI');
});

test('TRIAL-07: the real Host serves an isolated stamped build and stops its wrapper and Host', async t => {
 const f=await actualHostFixture();f.options.port=await availablePort();
 const html=await readFile(path.join(f.root,'dist/index.html'));const manifest=JSON.parse(await readFile(path.join(f.root,'dist/optracall-build.json'),'utf8'));
 manifest.files=[{path:'index.html',bytes:html.length,sha256:createHash('sha256').update(html).digest('hex')}];
 await writeFile(path.join(f.root,'dist/optracall-build.json'),JSON.stringify(manifest));
 const options={...f.options,uiRoot:path.join(f.root,'dist'),startupTimeoutMs:15000};
 t.after(async()=>{await launcher.stopTrial(options).catch(()=>{});await f.cleanup();});
 const running=await launcher.startTrial(options);assert.notEqual(running.pid,running.hostPid);assert.equal(running.runtime.commit,manifest.commit);
 assert.equal(await(await fetch(running.url)).text(),html.toString());
 const health=await(await fetch(new URL('api/health',running.url))).json();assert.equal(health.runtime.instanceId,running.instanceId);assert.equal(health.runtime.pid,running.hostPid);assert.equal(health.runtime.codeRoot,options.root);
 const response=await fetch(new URL('api/projects',running.url),{headers:{'x-optracall-client':'1'}});assert.equal(response.status,200);
 await assert.rejects(launcher.updateAndStartTrial(options),(error:any)=>error.code==='app_running');
 assert.equal((await launcher.stopTrial(options)).status,'stopped');await assert.rejects(fetch(running.url));
 assert.throws(()=>process.kill(running.pid,0));assert.throws(()=>process.kill(running.hostPid,0));
});

test('TRIAL-08: Finder entry locates the clone from another directory and starts without installation', async t => {
 const f=await fixture();f.options.port=await availablePort();t.after(async()=>{await launcher.stopTrial(f.options).catch(()=>{});await f.cleanup();});
 const home=path.join(f.root,'finder-home'),runtime=path.join(home,'Library/Application Support/OptraCall/runtime/node/bin');await mkdir(runtime,{recursive:true});await symlink(process.execPath,path.join(runtime,'node'));
 const args=[`--root=${f.root}`,`--state-root=${f.options.stateRoot}`,`--data-root=${f.options.dataRoot}`,`--projects-root=${f.options.projectsRoot}`,`--port=${f.options.port}`,'--json','--no-open'];
 const finderEnv={...process.env,HOME:home,PATH:'/usr/bin:/bin'};
 const result=await promisify(execFile)('bash',[path.resolve('启动 OptraCall.command'),...args],{cwd:'/',env:finderEnv});
 const running=JSON.parse(result.stdout.trim());assert.equal(running.status,'started');assert.equal(running.runtime.commit,f.build.commit);
 const stopped=await promisify(execFile)('bash',[path.resolve('停止 OptraCall.command'),...args],{cwd:'/',env:finderEnv});assert.equal(JSON.parse(stopped.stdout.trim()).status,'stopped');
});

test('TRIAL-09: concurrent recovery of a dead lock owner still creates one instance', async t => {
 const f=await fixture();f.options.port=await availablePort();await mkdir(f.options.stateRoot,{recursive:true});
 await writeFile(path.join(f.options.stateRoot,'operation.lock'),JSON.stringify({pid:2147483647,token:'dead-synthetic-owner'}));
 t.after(async()=>{await launcher.stopTrial(f.options).catch(()=>{});await f.cleanup();});
 const settled=await Promise.allSettled(Array.from({length:12},()=>launcher.startTrial(f.options)));
 for(const result of settled)assert.equal(result.status,'fulfilled',result.status==='rejected'?String(result.reason):'Startup settled successfully');
 const attempts=settled.map(result=>result.status==='fulfilled'?result.value:undefined);
 assert.equal(attempts.filter(result=>result.status==='started').length,1);assert.equal(new Set(attempts.map(result=>result.instanceId)).size,1);
});

test('TRIAL-10: a new clean Host checkout cannot start with an old retained UI build', async t => {
 const f=await actualHostFixture();f.options.port=await availablePort();t.after(async()=>{await launcher.stopTrial(f.options).catch(()=>{});await f.cleanup();});
 await writeFile(path.join(f.root,'scripts/start-host.mjs'),await readFile(path.join(f.root,'scripts/start-host.mjs'),'utf8')+'\n// synthetic next Host release; UI build failed before replacement\n');
 await commitFixture(f.root);assert.notEqual(await git(f.root,['rev-parse','HEAD']),f.build.commit);assert.equal(await git(f.root,['status','--porcelain=v1']),'');
 await assert.rejects(launcher.startTrial(f.options),(error:any)=>error.code==='build_checkout_mismatch');
 assert.equal(JSON.parse(await readFile(path.join(f.root,'dist/optracall-build.json'),'utf8')).commit,f.build.commit,'the previous build is preserved for diagnosis');
 await assert.rejects(fetch(`http://127.0.0.1:${f.options.port}/`));
});

test('TRIAL-11: uncommitted Host source and dirty build markers are refused', async t => {
 const f=await fixture();f.options.port=await availablePort();t.after(async()=>{await launcher.stopTrial(f.options).catch(()=>{});await f.cleanup();});
 await writeFile(path.join(f.root,'scripts/start-host.mjs'),await readFile(path.join(f.root,'scripts/start-host.mjs'),'utf8')+'\n// uncommitted Host change\n');
 await assert.rejects(launcher.startTrial(f.options),(error:any)=>error.code==='trial_checkout_dirty');
 await commitFixture(f.root);const build=await stampFixture(f.root);await writeFile(path.join(f.root,'dist/optracall-build.json'),JSON.stringify({...build,dirty:true}));
 await assert.rejects(launcher.startTrial(f.options),(error:any)=>error.code==='build_checkout_mismatch');
});

test('TRIAL-12: package version and source tree must match the stamped identity', async t => {
 const f=await fixture();f.options.port=await availablePort();t.after(async()=>{await launcher.stopTrial(f.options).catch(()=>{});await f.cleanup();});
 for(const mismatch of [{version:'different-version'},{tree:'c'.repeat(40)}]){
  await writeFile(path.join(f.root,'dist/optracall-build.json'),JSON.stringify({...f.build,...mismatch}));
  await assert.rejects(launcher.startTrial(f.options),(error:any)=>error.code==='build_checkout_mismatch');
 }
});

test('TRIAL-13: a nested directory cannot mistake its parent repository for its own checkout', async t => {
 const f=await fixture();f.options.port=await availablePort();const nested=path.join(f.root,'nested');await mkdir(nested);await cp(path.join(f.root,'scripts'),path.join(nested,'scripts'),{recursive:true});await cp(path.join(f.root,'dist'),path.join(nested,'dist'),{recursive:true});await cp(path.join(f.root,'package.json'),path.join(nested,'package.json'));
 const options={...f.options,root:nested};t.after(async()=>{await launcher.stopTrial(options).catch(()=>{});await f.cleanup();});
 await assert.rejects(launcher.startTrial(options),(error:any)=>error.code==='trial_checkout_required');
});
