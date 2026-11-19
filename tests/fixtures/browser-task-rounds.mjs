import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {chromium} from 'playwright';
import {startTaskRounds} from './pm-task-rounds.ts';

export async function browserRounds(t, uiPort=Number(process.env.OPTRACALL_PM2_ROUNDS_PORT || 4397), roots, issueTitle) {
  const f = await startTaskRounds(t,uiPort,roots,issueTitle);
  const ui = spawn(process.execPath,['scripts/frontend.mjs','dev','--port',String(uiPort),'--strictPort'],{stdio:['ignore','pipe','pipe'],env:{...process.env,OPTRACALL_HOST_PORT:String(f.host.port)}});
  t.after(()=>ui.kill('SIGTERM'));
  await new Promise((resolve,reject)=>{ui.stdout.on('data',buf=>{if(buf.toString().includes(':'+uiPort+'/'))resolve()});ui.once('exit',c=>reject(Error('UI exit '+c)));});
  const browser=await chromium.launch({channel:'chrome',headless:true}); t.after(()=>browser.close());
  const page=await browser.newPage({viewport:{width:1480,height:1010}});page.setDefaultTimeout(6500);
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  t.after(()=>assert.deepEqual(errors,[]));
  const base='http://127.0.0.1:'+uiPort, taskDialog=page.getByRole('dialog',{name:'新建任务'}), work=page.locator('.case-issue-work');
  async function openCase(){
    await page.goto(base);
    await page.getByRole('navigation',{name:'主导航',exact:true}).getByRole('button',{name:'决策星图',exact:true}).click();
    const board=page.locator('.case-board');
    await board.getByRole('button',{name:'常规',exact:true}).click();await board.getByRole('button',{name:'门店经营观察',exact:true}).click();
    await work.getByText('历次取舍与实际反馈',{exact:true}).waitFor();
  }
  async function createAndSend(name,text,message='接收本次委托') {
    const received=page.waitForResponse(r=>new URL(r.url()).pathname===f.taskPath && r.request().method()==='POST');
    await taskDialog.getByLabel('任务名称').fill(name);await taskDialog.getByRole('button',{name:'创建任务',exact:true}).click();
    const saved=await received;assert.equal(saved.status(),201,await saved.text());const {task}=await saved.json();
    const composer=page.getByRole('form',{name:'发送消息'});
    f.provider.setResponder(()=>({text}));
    await composer.getByRole('textbox',{name:'消息',exact:true}).fill(message);
    const started=page.waitForResponse(r=>new URL(r.url()).pathname===f.taskPath+'/'+task.id+'/messages');
    await composer.getByRole('button',{name:'发送消息'}).click();const accepted=await started;assert.equal(accepted.status(),202);
    await page.getByText(text,{exact:true}).first().waitFor();
    return {task,prompt:f.prompt(),requestId:accepted.request().postDataJSON().requestId};
  }
  return {...f,page,base,work,taskDialog,openCase,createAndSend};
}
