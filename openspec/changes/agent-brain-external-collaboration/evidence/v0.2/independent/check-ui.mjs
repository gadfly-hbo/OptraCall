import { chromium } from '/opt/codex/cua_node/lib/node_modules/playwright/index.mjs';
import fs from 'node:fs/promises';
import crypto from 'node:crypto';
const out='/workspace/OptraCall/.local/agent-brain-main-update/independent';
const input='/workspace/OptraCall/openspec/changes/agent-brain-external-collaboration/ui-demo.html';
const expected='f2c10eb3c3b8f13a991b0d3c1de244c041916c8b81d645db946738d40a9b8f52';
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
if(sha(await fs.readFile(input))!==expected)throw Error('candidate changed');
await fs.mkdir(out+'/screens',{recursive:true});
const browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
const receipt={htmlSha256:expected,startedAt:new Date().toISOString(),browser:await browser.version(),pages:[],checks:[],errors:[],network:[]};
const page=await browser.newPage({viewport:{width:1440,height:1000}});
page.on('pageerror',e=>receipt.errors.push(String(e)));
page.on('request',r=>{if(!r.url().startsWith('http://127.0.0.1:4317/'))receipt.network.push(r.url())});
const url='http://127.0.0.1:4317/ui-demo.html';
const go=async route=>{await page.goto(url+'#'+route);await page.waitForTimeout(80)};
const capture=async name=>{const filename='screens/'+name+'.png';await page.screenshot({path:out+'/'+filename,fullPage:true});const layout=await page.evaluate(()=>({width:innerWidth,scrollWidth:document.documentElement.scrollWidth,page:document.querySelector('main').dataset.page,heading:document.querySelector('h1')?.innerText,theme:document.documentElement.dataset.theme,active:document.activeElement?.getAttribute('data-testid')}));receipt.pages.push({name,filename,...layout});};
const check=(id,passed,detail)=>{receipt.checks.push({id,passed,detail});if(!passed)console.log('FAILED',id,detail)};
await go('home');
for(const width of [1440,1024,390]){
 await page.setViewportSize({width,height:1000});
 for(const theme of ['light','dark']){
  if(await page.locator('html').getAttribute('data-theme')!==theme)await page.getByTestId('theme-toggle').click();
  for(const route of ['home','cases','case/current','case/projects','case/artifacts','case/history','projects','project','task/analysis','report','draft','work','assets','delivery','setup']){
   await go(route);await capture(`${width}-${theme}-${route.replaceAll('/','-')}`);
  }
 }
}
check('initial-no-page-overflow',receipt.pages.every(x=>x.scrollWidth<=x.width),receipt.pages.filter(x=>x.scrollWidth>x.width));
await page.setViewportSize({width:1440,height:1000});
await page.getByTestId('reset-demo').click();await go('home');
await page.getByTestId('home-intake').fill('独立复核：首页草稿保全');
await page.getByTestId('home-continue-case').click();await page.getByTestId('case-discussion').fill('独立复核：quality事项草稿');
await page.getByTestId('case-tab-projects').click();await page.getByTestId('case-scope').selectOption('all');
await page.getByTestId('task-analysis').click();await page.getByTestId('task-draft').fill('独立复核：原Task草稿');
await page.getByTestId('return-source-case').click();
check('source-case-return',await page.getByTestId('case-scope').inputValue()==='all'&&await page.evaluate(()=>document.activeElement?.dataset.testid)==='task-analysis','all scope and Task link focus');
await page.getByTestId('case-tab-current').click();
check('case-draft',await page.getByTestId('case-discussion').inputValue()==='独立复核：quality事项草稿','Case discussion preserved');
await page.getByTestId('nav-home').click();
check('home-draft',await page.getByTestId('home-intake').inputValue()==='独立复核：首页草稿保全','Home draft preserved');
await go('task/analysis');
check('task-draft',await page.getByTestId('task-draft').inputValue()==='独立复核：原Task草稿','Task draft preserved');
await page.getByTestId('authorize-open').click();await capture('authorize-1440');
const tabTargets=[];for(let i=0;i<25;i++){await page.keyboard.press('Tab');tabTargets.push(await page.evaluate(()=>document.querySelector('dialog').contains(document.activeElement)))}
check('authorization-focus-trap',tabTargets.every(Boolean),tabTargets);
await page.keyboard.press('Escape');
check('authorization-escape-focus',await page.evaluate(()=>!document.querySelector('dialog').open&&document.activeElement?.dataset.testid==='authorize-open'),'Escape returns opener');
await page.getByTestId('authorize-open').click();await page.getByTestId('decline-authorization').click();
check('authorization-cancel-no-work',await page.evaluate(()=>JSON.parse(sessionStorage.getItem('optracall.external-collaboration.demo.v2')).auth===null),'no auth created');
await page.getByTestId('authorize-open').click();await page.getByTestId('auth-asset-mapping').uncheck();
check('authorization-scope-preview',!(await page.getByTestId('authorization-preview').innerText()).includes('四店会员字段映射'),'mapping removed');
await page.getByTestId('grant-autonomy').click();
await page.waitForFunction(()=>JSON.parse(sessionStorage.getItem('optracall.external-collaboration.demo.v2')).status==='accepted',{},{timeout:18000});
await capture('normal-mapping-excluded-accepted');await go('delivery');await capture('normal-delivery-accepted');
check('mapping-exclusion-respected',(await page.locator('main').innerText()).includes('未取用 / 未核验'),'excluded mapping not verified');
await page.getByTestId('submit-candidate').click();await page.getByTestId('confirm-candidate').click();
check('candidate-not-published',(await page.getByTestId('candidate-status').innerText()).includes('待原流程核定'),'candidate pending');
await go('home');check('original-home-unchanged',await page.getByTestId('pending-count').innerText()==='2'&&(await page.getByTestId('original-project-wait').innerText()).includes('等待门店补充'),'two requests/project wait retained');
await go('case/artifacts');check('external-not-case-artifact',await page.getByTestId('case-original-report').count()===1&&!(await page.locator('main').innerText()).includes('member-differences'),'Case only original linked report');
await go('project');await capture('project-after-external-accepted');
check('external-summary-scope',await page.getByTestId('case-external-summary').count()===0,'spec2.1 only original Task and Case project/task row');
await fs.writeFile(out+'/receipt.json',JSON.stringify(receipt,null,2));
await fs.writeFile(out+'/html-after.sha256',sha(await fs.readFile(input))+'\n');
await browser.close();console.log(JSON.stringify({screens:receipt.pages.length,checks:receipt.checks,errors:receipt.errors,network:receipt.network}));
