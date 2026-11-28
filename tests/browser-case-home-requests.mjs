// Actual App + running Host browser regression. Use only an explicitly isolated synthetic fixture.
// Usage: CASE_UI_FIXTURE=/absolute/fixture-ids.json CASE_HOME_REQUEST_RUN=name node tests/browser-case-home-requests.mjs
// This opens and cancels; it never saves a business choice/feedback or calls a model.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from '/opt/codex/runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs';
assert.ok(process.env.CASE_UI_FIXTURE, 'An explicit synthetic fixture manifest is required');
const fixture = JSON.parse(await fs.readFile(process.env.CASE_UI_FIXTURE, 'utf8'));
assert.match(fixture.scope, /synthetic-only/);
const base = new URL(fixture.base); assert.ok(['127.0.0.1', 'localhost'].includes(base.hostname));
const out = path.resolve('.local/ui-conformance/home-request-navigation', process.env.CASE_HOME_REQUEST_RUN ?? `run-${Date.now()}`); await fs.mkdir(out, {recursive:true});
const get = async route => { const response = await fetch(base.origin + route, {headers:{'x-optracall-client':'1'}}); assert.equal(response.status, 200); return response.json(); };
const health = await get('/api/health'), before = await get('/api/workspace/home-pending');
const requests = ['choose','observe'].map(kind => { const request = before.pending.find(item => item.kind === kind); assert.ok(request, `Fixture needs a real explicit ${kind} request`); return request; });
const browser = await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
const checks=[],errors=[],businessWrites=[];
for (const request of requests) {
 const page=await browser.newPage({viewport:{width:1440,height:1000}}); page.setDefaultTimeout(12000);
 page.on('pageerror',e=>errors.push(e.message));
 page.on('request',r=>{const url=new URL(r.url());if(url.origin===base.origin&&!['GET','HEAD'].includes(r.method())&&!url.pathname.startsWith('/api/workspace/drafts/'))businessWrites.push({path:url.pathname,method:r.method()});});
 try {
  await page.goto(base.origin);
  for(let pass=1;pass<=3;pass++){
   const row=page.locator('.home-daily-request').filter({hasText:request.text});await row.getByRole('button',{name:request.kind==='choose'?'去记录取舍':'去回录观察',exact:true}).click();
   const detail=page.getByRole('region',{name:'Case 详情',exact:true});await detail.getByRole('heading',{name:request.caseTitle,exact:true}).waitFor();
   await detail.locator('.case-current-title').getByRole('heading',{name:request.issueTitle,exact:true}).waitFor();
   const dialog=page.getByRole('dialog',{name:request.kind==='choose'?'记录本轮取舍':'回录实际反馈',exact:true});await dialog.waitFor();
   if(request.kind==='observe'){
    await dialog.getByLabel('实际观察到什么',{exact:true}).waitFor();
    const requestSelect=dialog.locator('#feedback-request');await requestSelect.waitFor({state:'attached'});
    await page.waitForFunction(expected=>document.querySelector('#feedback-request')?.value===expected,`${request.requestId}:${request.revision}`);
   } else {
    await dialog.getByLabel('这次怎么选').waitFor();
    await page.waitForFunction(text=>document.querySelector('.case-round-choice')?.textContent.includes(text),request.text);
   }
   if(request.kind==='observe'){
    const source=dialog.locator('details').filter({hasText:/原请求与来源/}).first();
    await source.locator(':scope > summary').click();await source.locator(':scope > summary').click();
    for(const width of [1024,390,1440])await page.setViewportSize({width,height:1000});
   }
   await page.screenshot({path:path.join(out,`${request.kind}-${pass}.png`),fullPage:true});
   await page.keyboard.press('Escape');await dialog.waitFor({state:'hidden'});
   const focus=await page.evaluate(()=>document.activeElement?.textContent?.trim());assert.equal(focus,request.kind==='choose'?'记录取舍':'回录反馈');
   checks.push({name:`${request.kind} exact Case/issue/request dialog, cancel focus and SPA reopen ${pass}`,ok:true});
   if(pass<3)await page.locator('nav.primary-nav').getByRole('button',{name:'工作台首页',exact:true}).click();
  }
 } catch(error){checks.push({name:`${request.kind} home request navigation`,ok:false,error:error.stack});await page.screenshot({path:path.join(out,`${request.kind}-failure.png`),fullPage:true});}
 finally{await page.close();}
}
await browser.close();
const after=await get('/api/workspace/home-pending'),lastHealth=await get('/api/health');
assert.equal(lastHealth.runtime.builtAt,health.runtime.builtAt,'Candidate changed during browser checks');
assert.deepEqual(after.pending,before.pending,'Opening/cancelling must not consume a pending request');assert.deepEqual(businessWrites,[],'No business save or model call');assert.deepEqual(errors,[]);
await fs.writeFile(path.join(out,'receipt.json'),JSON.stringify({boundary:'Actual App/Host, synthetic fixture, read/cancel only; draft persistence allowed, business/model writes forbidden',runtime:health.runtime,requests,checks,errors,businessWrites},null,2));
console.log(JSON.stringify({out,checks,errors,businessWrites},null,2));assert.equal(checks.filter(check=>!check.ok).length,0);
