// Run against an isolated, configured Host serving the stamped product UI.
import {chromium} from 'playwright';
import assert from 'node:assert/strict';
const base=process.argv[2], uid=()=>crypto.randomUUID();
if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(base) || [4173,4174,4175].includes(Number(new URL(base).port))) throw Error('Use an isolated Host');
async function api(path,method='GET',body){const r=await fetch(base+path,{method,headers:{origin:base,'x-optracall-client':'1','content-type':'application/json'},body:body&&JSON.stringify(body)});if(!r.ok)throw Error(path+' '+r.status+' '+await r.text());return r.json();}
(async()=>{
 const id=uid(),route='/api/strategy/discussions/'+id;
 await api('/api/strategy/discussions','POST',{title:'会员运营产品点验',operationId:id,usageContext:{kind:'personal',background:'合成复盘'}});
 const common={population:'首购会员',metric:'二购',period:'满90天',baselineRate:9,unit:'人',basis:'合成假设'};
 const nodes=[{id:'G3',kind:'goal',title:'有效覆盖',baseline:'待核'},{id:'G1',kind:'goal',title:'首购后二购率',metric:'90天二购',baseline:'9%',target:'待定'},{id:'S1',kind:'strategy',title:'回访'}];
 const review={summary:'覆盖可能影响二购',mechanism:'再到店理由',condition:'可回访',alternative:'原意愿偏高',risk:'工时',scope:'促销周',test:'同店同期试验'};
 for (const [title,adjust,lift] of [['普发券 A',false,2],['导购回访 B',true,5]]) await api(route+'/maps','POST',{mapId:uid(),operationId:uid(),expectedVersion:0,reason:'候选比较',draft:{title,template:'bsc',choice:title,nodes,edges:[{id:'e1',from:'G3',to:'G1',kind:'hypothesis',review},{id:'e2',from:'S1',to:'G3',kind:'supports'}],scenarioModel:{...common,liftPoints:lift,coverage:adjust?80:100,coverageAdjustable:adjust}}});
 const browser=await chromium.launch({channel:'chrome'});try{
 const page=await browser.newPage({viewport:{width:1250,height:900}}),errors=[];
 page.on('pageerror',e=>errors.push(e.message));page.setDefaultTimeout(7000);
 await page.goto(base);const button=(name)=>page.getByRole('button',{name,exact:true});
 await button('战略选择').click();await page.locator('label').filter({hasText:/^原讨论/}).locator('select').selectOption(id);
 await button('战略地图').click();await page.getByText('因果链审查',{exact:true}).click();await button('带入战略模拟').click();
 await page.getByRole('button',{name:'战略假设',pressed:true}).waitFor();
 await button('经营情景').click();await page.getByLabel('人群规模').fill('1000');await page.getByLabel('可变方案的有效覆盖率').fill('80');await page.getByRole('cell',{name:'40 人',exact:true}).waitFor();
 await page.getByLabel('可变方案的有效覆盖率').fill('30');await page.getByRole('cell',{name:'15 人',exact:true}).waitFor();await page.getByRole('cell',{name:'20 人',exact:true}).waitFor();
 await page.getByLabel('本次比较名称').fill('人手受限');await button('保存本次比较').click();await page.getByText('已保存本次比较',{exact:true}).waitFor();
 await button('返回原地图连线').click();await page.waitForFunction(()=>document.activeElement?.textContent?.includes('有效覆盖')&&document.activeElement?.textContent?.includes('首购后二购率'));
 console.log('PASS map → hypothesis → common scenario 40/15 vs 20 → save → exact edge focus');
 await button('版本与来源').click();const dl=page.waitForEvent('download');await button('导出此版').click();console.log('PASS export', (await dl).suggestedFilename());
 await page.emulateMedia({colorScheme:'dark'});await page.reload();await button('战略选择').click();await page.locator('label').filter({hasText:/^原讨论/}).locator('select').selectOption(id);
 assert.equal(await page.locator('.app').getAttribute('data-theme'),'dark');
 await page.setViewportSize({width:390,height:844});await button('战略共创').click();await page.getByLabel('战略讨论问题').fill('未发送的业务问题');await button('放大对话').click();await page.keyboard.press('Escape');assert.equal(await page.evaluate(()=>document.activeElement?.textContent),'放大对话');
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>window.innerWidth),false);
 await page.reload();await page.setViewportSize({width:1250,height:900});await button('战略选择').click();await page.locator('label').filter({hasText:/^原讨论/}).locator('select').selectOption(id);assert.equal(await page.getByLabel('战略讨论问题').inputValue(),'未发送的业务问题');
 await button('战略模拟').click();await page.getByText('已保存的比较（1）',{exact:true}).click();await page.getByRole('button',{name:/人手受限/}).click();assert.equal(await page.getByLabel('人群规模').inputValue(),'1000');assert.equal(await page.getByLabel('可变方案的有效覆盖率').inputValue(),'30');
 console.log('PASS mobile width, Esc focus, draft reopen, frozen comparison reload',errors);assert.deepEqual(errors,[]);
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
