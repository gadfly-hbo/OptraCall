// Local synthetic browser fixture only. It never reads real credentials or contacts real model endpoints.
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { startTestHost } from './host-process.ts';
import { startSyntheticProvider } from './synthetic-provider.ts';
import { workspaceRoot } from '../../scripts/runtime-process.ts';
const codeRoot = workspaceRoot;
const scratch = await mkdtemp(path.join(os.tmpdir(), 'optracall-ui-fixes-'));
const dataRoot = path.join(scratch, 'host'), projectsRoot = path.join(scratch, 'projects');
const extensions = path.join(dataRoot, 'pi', 'extensions');
await mkdir(extensions, { recursive: true });
await writeFile(path.join(extensions, 'browser-questions.ts'), `import fs from 'node:fs'; import path from 'node:path';
export default function(pi) {
 pi.on('session_start',async(_event,ctx)=>{const armed=path.join(process.env.PI_CODING_AGENT_DIR,'qa-startup-once');if(fs.existsSync(armed)){fs.unlinkSync(armed);const value=await ctx.ui.confirm('启动合成确认','初始化也应等待用户明确回应。');pi.sendMessage({customType:'synthetic-browser-answer',content:JSON.stringify({kind:'startup',value,hasUI:ctx.hasUI}),display:true});}});
 const show = (kind,value,ctx) => pi.sendMessage({customType:'synthetic-browser-answer',content:JSON.stringify({kind,value,hasUI:ctx.hasUI}),display:true});
 pi.registerCommand('synthetic-confirm',{description:'Synthetic confirmation',handler:async(_args,ctx)=>show('confirm',await ctx.ui.confirm('合成确认','请确认继续这个合成操作。'),ctx)});
 pi.registerCommand('synthetic-select',{description:'Synthetic selection',handler:async(_args,ctx)=>show('select',await ctx.ui.select('合成选择',['选项 A','选项 B']),ctx)});
 pi.registerCommand('synthetic-input',{description:'Synthetic input',handler:async(_args,ctx)=>show('input',await ctx.ui.input('合成输入','请输入合成文本'),ctx)});
 pi.registerCommand('synthetic-editor',{description:'Synthetic editor',handler:async(_args,ctx)=>show('editor',await ctx.ui.editor('合成编辑','预填内容'),ctx)});
 pi.registerCommand('synthetic-status',{description:'Synthetic status',handler:async(_args,ctx)=>{ctx.ui.setStatus('synthetic','合成扩展状态');ctx.ui.setWorkingMessage('合成工作提示');ctx.ui.notify('合成扩展通知','info');}});
 pi.registerCommand('synthetic-draft',{description:'Synthetic native editor replacement',handler:async(_args,ctx)=>{ctx.ui.setEditorText('原生设置草稿');const set=ctx.ui.getEditorText();ctx.ui.pasteToEditor('原生粘贴替换');show('editor-draft',{set,pasted:ctx.ui.getEditorText()},ctx);}});
}`);
const provider = await startSyntheticProvider();
const control = createServer(async(request,response)=>{const url=new URL(request.url??'/', 'http://127.0.0.1');if(url.pathname==='/arm-startup')await writeFile(path.join(dataRoot,'pi','qa-startup-once'),'synthetic-only');const mode=url.searchParams.get('mode');if(mode&&['success','failure','slow'].includes(mode))provider.setMode(mode as 'success'|'failure'|'slow');response.writeHead(200,{'Content-Type':'application/json'});response.end(JSON.stringify({requests:provider.requests.map(r=>({model:r.body.model,messages:r.body.messages,closedEarly:r.closedEarly})),mode}));});
await new Promise<void>(resolve=>control.listen(0,'127.0.0.1',resolve));const address=control.address();if(!address||typeof address==='string')throw new Error('control');
const host = await startTestHost({ uiPort: 4183, dataRoot, projectsRoot });
const vite = spawn(process.execPath,[path.join(codeRoot,'node_modules/vite/bin/vite.js'),'--host','127.0.0.1','--port','4183','--strictPort'],{cwd:codeRoot,env:{...process.env,OPTRACALL_HOST_PORT:String(host.port)},stdio:['ignore','pipe','pipe']});
let buffer='',ready=false,closing=false;
vite.stdout.on('data',chunk=>{buffer+=chunk.toString();if(!ready&&buffer.includes('http://127.0.0.1:4183/')){ready=true;console.log(JSON.stringify({kind:'qa-ready',uiUrl:'http://127.0.0.1:4183/',providerUrl:provider.baseUrl,controlUrl:'http://127.0.0.1:'+address.port,hostPort:host.port,scratch,pid:process.pid,vitePid:vite.pid}));}});
vite.stderr.on('data',chunk=>process.stderr.write(chunk));
async function close(){if(closing)return;closing=true;vite.kill('SIGTERM');await host.close();await provider.close();await new Promise<void>(resolve=>control.close(()=>resolve()));process.exit(0);}
for(const signal of ['SIGINT','SIGTERM'] as const)process.on(signal,()=>{void close().catch(()=>process.exit(1));});
vite.on('exit',()=>{if(!closing)void close();});
