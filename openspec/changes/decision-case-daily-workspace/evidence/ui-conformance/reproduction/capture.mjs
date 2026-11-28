import { chromium } from '/opt/codex/runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs';
import fs from 'node:fs/promises';
import path from 'node:path';
const root=path.resolve('.local/ui-conformance');
const fixtureFile=process.env.FIXTURE_IDS??path.join(root,'demo-aligned/fixture-ids.json');
const ids=JSON.parse(await fs.readFile(fixtureFile,'utf8'));
const build=JSON.parse(await fs.readFile(path.join(root,'source-manifest.json'),'utf8'));
const name=process.argv[2]??new Date().toISOString().replaceAll(':','-');
const out=path.join(root,'captures',name);await fs.mkdir(out,{recursive:true});
const browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
const page=await browser.newPage({viewport:{width:1440,height:1000}});
const health=await(await fetch(ids.base+'/api/health',{headers:{'x-optracall-client':'1',origin:ids.base}})).json();if(health.runtime?.builtAt!==build.identity.builtAt)throw Error('Running build differs from local source manifest; capture after rebuild completes.');
const receipt={runtime:health.runtime,capturedAt:new Date().toISOString(),base:ids.base,sourceIdentity:build.identity,sourceManifestHash:build.sourceManifestHash,fixture:ids.scope,shots:[],errors:[]};
page.on('pageerror',e=>receipt.errors.push(e.message));
async function screenshot(label){await page.waitForLoadState('networkidle',{timeout:8000}).catch(()=>{});await page.screenshot({path:path.join(out,label+'.png'),fullPage:true});await fs.writeFile(path.join(out,label+'.txt'),await page.locator('body').innerText());receipt.shots.push({label,url:page.url(),viewport:page.viewportSize(),path:path.join(out,label+'.png')});console.log('CAPTURE',label);}
async function clickText(text,selector='button'){const buttons=page.locator(selector).filter({hasText:text});for(let n=0;n<await buttons.count();n++){const b=buttons.nth(n);if(await b.isVisible()){await b.click();return true;}}return false;}
try{
 await page.goto(ids.base);await page.waitForFunction(()=>document.body.innerText.includes('待处理事项'));await screenshot('01-home-1440');
 await clickText(/^Decision Case$/,'nav.primary-nav button');await page.waitForFunction(()=>document.body.innerText.includes('Case 总览'));await screenshot('02-case-overview-1440');
 await clickText(/^改善华东会员复购$/);await page.waitForFunction(()=>document.querySelector('.case-current-topline')?.textContent.includes('第 2 轮')&&document.querySelector('.case-current-summary')?.textContent.includes('本轮明确请求'));await screenshot('03-case-current-1440');
 await clickText(/^树状图$/);await screenshot('04-case-tree-1440');
 await clickText(/^项目与任务/);await screenshot('05-case-projects-1440');
 await clickText(/^成果与依据$/);await screenshot('06-case-artifacts-1440');
 await clickText(/^历史$/);await screenshot('07-case-history-1440');
 await clickText(/^当前工作$/);await page.setViewportSize({width:390,height:844});await screenshot('08-case-current-390');
 await page.setViewportSize({width:1440,height:1000});await page.reload();await page.waitForFunction(()=>document.body.innerText.includes('待处理事项'));await clickText(/^Decision Case$/,'nav.primary-nav button');await clickText(/^全部项目$/);await page.waitForFunction(()=>document.body.innerText.includes('季度资料整理'));await screenshot('09-all-projects-1440');
 await clickText(/^华东会员增长实验$/,'.daily-project-name button');await page.waitForFunction(()=>Boolean(document.querySelector('.daily-project-detail')));await screenshot('10-project-detail-1440');
 await clickText(/^工作台首页$/,'nav.primary-nav button');await page.waitForFunction(()=>document.body.innerText.includes('待处理事项'));await page.setViewportSize({width:390,height:844});await screenshot('11-home-390');
}catch(e){receipt.errors.push(e.stack);await screenshot('failed-last-state').catch(()=>{});console.error(e.message);}finally{const after=await(await fetch(ids.base+'/api/health',{headers:{'x-optracall-client':'1',origin:ids.base}})).json();if(after.runtime?.builtAt!==health.runtime.builtAt)receipt.errors.push('CANDIDATE_CHANGED_DURING_CAPTURE');await fs.writeFile(path.join(out,'receipt.json'),JSON.stringify(receipt,null,2));await browser.close();}
console.log('RECEIPT',path.join(out,'receipt.json'));
