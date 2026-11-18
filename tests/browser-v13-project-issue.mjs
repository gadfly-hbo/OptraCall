// Ephemeral synthetic Host. Exercise the normal Case issue -> Project -> original issue controls.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';
import { startTestHost } from './fixtures/host-process.ts';
import { withCaseGoal } from './fixtures/case-goal.ts';

const uiPort=Number(process.env.OPTRACALL_CASE_TEST_PORT || 4387);
const host=await startTestHost({uiPort});
const ui=spawn(process.execPath,['scripts/frontend.mjs','dev','--port',String(uiPort),'--strictPort'],{stdio:['ignore','pipe','pipe'],env:{...process.env,OPTRACALL_HOST_PORT:String(host.port)}});
let browser;
try {
  await new Promise((resolve,reject)=>{ui.stdout.on('data',b=>{if(b.toString().includes(':'+uiPort+'/'))resolve()});ui.on('exit',code=>reject(Error('UI exit '+code)));});
  async function call(path,method='GET',input){const r=await host.request(path,method,input);const value=await r.json();assert.ok(r.ok,JSON.stringify(value));return value;}
  await call('/api/configuration','PUT',{name:'仅用于界面导航',provider:'openai-compatible',model:'synthetic',baseUrl:'http://127.0.0.1:1/v1',apiKey:'synthetic-only'});
  const {project}=await call('/api/projects','POST',{name:'共享协作项目'});
  await call('/api/cases/storage/initialize','POST',{});
  const {case:c}=await call('/api/cases','POST',await withCaseGoal(host,{title:'会员复购范围',operationId:randomUUID()}));
  const linked=await call('/api/cases/'+c.id+'/projects','POST',{operationId:randomUUID(),projectId:project.id,expectedRevision:c.revision});
  const path='/api/cases/'+c.id+'/decisions/issues';
  await call(path,'POST',{title:'第一个议题',operationId:randomUUID(),expectedRevision:linked.case.revision});
  const {case:current}=await call('/api/cases/'+c.id);
  const {issue}=await call(path,'POST',{title:'第二个议题',operationId:randomUUID(),expectedRevision:current.revision});
  browser=await chromium.launch({channel:'chrome',headless:true});const page=await browser.newPage({viewport:{width:1500,height:960}});page.setDefaultTimeout(12000);
  const errors=[];page.on('pageerror',err=>errors.push(err.message));
  const owners=[];page.on('request',request=>{const u=new URL(request.url());if(u.pathname==='/api/business-role'&&u.searchParams.has('owner'))owners.push(JSON.parse(u.searchParams.get('owner')));});
  await page.goto('http://127.0.0.1:'+uiPort);
  await page.getByRole('navigation',{name:'主导航',exact:true}).getByRole('button',{name:'决策星图',exact:true}).click();
  const board=page.locator('.case-board');await board.getByRole('button',{name:'常规',exact:true}).click();
  await board.getByRole('button',{name:c.title,exact:true}).click();
  await board.getByLabel('当前事项').selectOption(issue.id);
  await board.getByRole('button',{name:'回关联项目协作'}).click();
  const work=page.getByRole('region',{name:'项目协作'});
  await work.getByRole('heading',{name:project.name,exact:true}).waitFor();
  const key=c.id+'/'+issue.id;assert.equal(await work.getByLabel('项目工作范围').inputValue(),key);
  const url=new URL(page.url());assert.equal(url.searchParams.get('project'),project.id);assert.equal(url.searchParams.get('projectIssue'),issue.id);
  await page.reload();await work.getByRole('heading',{name:project.name,exact:true}).waitFor();assert.equal(await work.getByLabel('项目工作范围').inputValue(),key);
  await work.getByLabel('项目工作范围').selectOption('');
  await work.getByLabel('项目工作范围').selectOption(key);
  await work.getByRole('button',{name:'返回原 Case 事项'}).waitFor();
  await work.getByRole('button',{name:'返回原 Case 事项'}).click();
  await board.getByRole('heading',{name:c.title,exact:true}).waitFor();assert.equal(await board.getByLabel('当前事项').inputValue(),issue.id);
  await page.reload();await board.getByLabel('当前事项').waitFor();assert.equal(await board.getByLabel('当前事项').inputValue(),issue.id);
  assert.ok(owners.some(o=>o.role==='project'&&o.projectId===project.id&&o.issue?.caseId===c.id&&o.issue?.issueId===issue.id));assert.deepEqual(errors,[]);
  console.log('PASS scoped Project entry with non-default Case issue, Project reload, return to the same Case issue and reload. Case, Project and issue identities read back.');
} finally {await browser?.close();ui.kill();await host.close();}
