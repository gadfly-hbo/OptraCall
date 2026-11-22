// Run from the worktree with Playwright and Chrome available in the test environment.
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { startTestHost } from './fixtures/host-process.ts';
import { startToolProvider } from './fixtures/tool-provider.ts';

const port = Number(process.env.OPTRACALL_ROLE_TEST_PORT ?? 4368);
const host = await startTestHost({ uiPort: port });
const provider = await startToolProvider();
const frontend = spawn(process.execPath, ['scripts/frontend.mjs', 'dev', '--port', String(port), '--strictPort'], {
  env: { ...process.env, OPTRACALL_HOST_PORT: String(host.port) }, stdio: ['ignore', 'pipe', 'pipe'],
});
let browser;
try {
  await Promise.race([
    new Promise(resolve => frontend.stdout.on('data', bytes => { if (bytes.toString().includes(':'+port+'/')) resolve(); })),
    once(frontend, 'exit').then(([code]) => { throw Error('Frontend closed during startup: '+code); }),
  ]);
  const model = await host.request('/api/configuration','PUT',{
    name:'恢复点验', provider:'openai-compatible', baseUrl:provider.baseUrl, model:'synthetic', apiKey:'synthetic-local',
  });
  assert.ok(model.ok);
  const longReply = Array.from({length:35},(_,i)=>'第 '+(i+1)+' 条观察').join('\n\n');
  provider.setResponder(() => ({text:longReply}));
  const title = '恢复点验';
  const created = await host.request('/api/projects','POST',{name:title});
  assert.equal(created.status,201);
  const {project} = await created.json();
  browser = await chromium.launch({channel:'chrome',headless:true});
  const page = await browser.newPage();
  page.setDefaultTimeout(12000);
  const region = page.getByRole('region',{name:'Project Agent',exact:true});
  await page.goto('http://127.0.0.1:'+port);
  // A deliberate application theme must also govern native fields when the OS preference differs.
  const themeButton = theme => page.getByRole('button',{name:theme === 'light' ? '切换为浅色' : '切换为深色'});
  async function checkComposer(region, theme, enabled) {
    const text = region.getByRole('textbox'), send = region.getByRole('button',{name:'发送',exact:true});
    await text.fill(enabled ? '界面草稿' : '');
    assert.equal(await send.isEnabled(),enabled);
    const style = await send.evaluate(button=>{
      const css = getComputedStyle(button);
      const luminance = color=>{
        const channels = color.match(/[.\d]+/g).map(Number);
        if (channels.length !== 3) throw Error('Composer colors must be opaque');
        return channels.reduce((sum,c,i)=>{
          const value = c / 255;
          return sum + [0.2126,0.7152,0.0722][i] * (value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
        },0);
      };
      const values = [luminance(css.color),luminance(css.backgroundColor)].sort((a,b)=>b-a);
      const input = button.form.querySelector('textarea');
      return {scheme:css.colorScheme,ratio:(values[0]+.05)/(values[1]+.05),width:input.clientWidth / button.form.clientWidth};
    });
    assert.equal(style.scheme,theme);
    assert.ok(style.ratio>=4.5,'Send contrast '+style.ratio);
    assert.ok(style.width>.8,'Composer should use the panel width');
  }
  await page.getByRole('button',{name:'目标管理',exact:true}).click();
  const entry=page.locator('details').filter({has:page.locator('summary').filter({hasText:'与目标管理 Agent 讨论'})});
  await entry.waitFor();
  assert.equal(await entry.evaluate(details=>details.open),false);
  const goal=entry.getByRole('region',{name:'目标管理 Agent',exact:true});
  await entry.locator('summary').first().click();
  await goal.getByText(/会话模型/).waitFor();
  for (const [system,theme] of [['dark','light'],['light','dark']]) {
    await page.emulateMedia({colorScheme:system});
    if (await page.locator('.app').getAttribute('data-theme')!==theme) await themeButton(theme).click();
    await checkComposer(goal,theme,false);
    await checkComposer(goal,theme,true);
  }
  await entry.getByRole('button',{name:'放大对话'}).click();
  const enlarged=page.getByRole('dialog',{name:'目标管理 Agent',exact:true});
  assert.equal(await enlarged.getByRole('textbox').inputValue(),'界面草稿');
  await page.keyboard.press('Escape');
  await entry.locator('summary').first().click();
  await entry.locator('summary').first().click();
  assert.equal(await goal.getByRole('textbox').inputValue(),'界面草稿');
  await page.getByRole('button',{name:title,exact:true}).click();
  const input = region.getByRole('textbox');
  await region.getByText(/会话模型/).waitFor();
  await checkComposer(region,'dark',false);
  await themeButton('light').click();
  await checkComposer(region,'light',true);
  const requests = [];
  await page.route('**/api/business-role?**',async route => {
    if (new URL(route.request().url()).searchParams.get('action')!=='messages') return route.continue();
    requests.push(route.request().postDataJSON().requestId);
    if(requests.length===1) return route.abort('internetdisconnected');
    if(requests.length===3) {
      const accepted = await route.fetch();
      assert.equal(accepted.status(),202);
      return route.abort('connectionreset');
    }
    return route.continue();
  });
  await input.fill('第一次未送达');
  await region.getByRole('button',{name:'发送',exact:true}).click();
  await region.getByRole('button',{name:'核对原操作'}).waitFor();
  await page.reload();
  await page.getByRole('button',{name:title,exact:true}).click();
  await region.getByRole('button',{name:'按原编号发送'}).click();
  const waitForReceipt = () => page.waitForFunction(() => document.querySelector('[aria-label="向Project Agent提问"]')?.value==='');
  await waitForReceipt();
  assert.equal(requests.length,2);
  assert.equal(requests[0],requests[1]);
  assert.equal(await region.getByText('第一次未送达',{exact:true}).count(),1);
  const drawer=page.getByRole('dialog',{name:'Project Agent',exact:true});
  const conversation=region.locator('xpath=ancestor::*[contains(concat(" ",normalize-space(@class)," ")," workspace-conversation ")][1]');
  const history=region.getByRole('log',{name:'Project Agent 对话记录'});
  await history.getByRole('button',{name:'展开全文'}).click();
  const progress=await history.evaluate(el=>{el.scrollTop=120; return el.scrollTop;});
  assert.ok(progress>0);
  await conversation.getByRole('button',{name:'放大对话'}).click();
  const lastLine=drawer.getByText('第 35 条观察',{exact:true});
  assert.equal(await lastLine.count(),1);
  await lastLine.scrollIntoViewIfNeeded();
  assert.ok(await drawer.locator('.workspace-conversation-expanded').evaluate(el=>el.scrollTop>0));
  await page.keyboard.press('Escape');
  assert.equal(await history.evaluate(el=>el.scrollTop),progress);
  await input.fill('第二次已送达但应答中断');
  await region.getByRole('button',{name:'发送',exact:true}).click();
  await waitForReceipt();
  assert.equal(requests.length,3);
  assert.notEqual(requests[0],requests[2]);
  assert.equal(await region.getByText('第二次已送达但应答中断',{exact:true}).count(),1);
  assert.ok(await input.isEditable());
  const owner = new URLSearchParams({owner:JSON.stringify({role:'project',projectId:project.id}),requestId:requests[0]});
  const original = await (await host.request('/api/business-role?'+owner)).json();
  assert.equal(original.requestReceipt.requestId,requests[0]);
  assert.equal(original.requestReceipt.originalUserText,'第一次未送达');
  assert.equal(provider.requests.length,2);
  provider.setResponder(()=>({text:'等待负责人停止',hold:true}));
  await input.fill('在回复中放大和停止');
  await region.getByRole('button',{name:'发送',exact:true}).click();
  await provider.waitForRequests(3);
  await region.getByText('等待负责人停止',{exact:true}).waitFor();
  await conversation.getByRole('button',{name:'放大对话'}).click();
  await drawer.getByText('等待负责人停止',{exact:true}).waitFor();
  await drawer.getByRole('button',{name:'停止',exact:true}).waitFor();
  await page.keyboard.press('Escape');
  await drawer.waitFor({state:'hidden'});
  await region.getByRole('button',{name:'停止',exact:true}).click();
  const route='/api/business-role?'+new URLSearchParams({owner:JSON.stringify({role:'project',projectId:project.id})});
  let stopped;
  for(let i=0;i<200;i++){
    stopped=await (await host.request(route)).json();
    if(!stopped.busy && stopped.discussion.lastRun.status==='cancelled')break;
    await new Promise(resolve=>setTimeout(resolve,30));
  }
  assert.equal(stopped.discussion.lastRun.status,'cancelled');
  assert.equal(stopped.discussion.lastRun.id,requests[3]);
  assert.equal(provider.requests.length,3);
  // Model the documented pre-dispatch 409 after Host persisted the pending input.
  // The Host counterpart is exercised in strategy-discussion-recovery.test.ts.
  const failedText = '模型配置变化后，仍能保留原话';
  const current = await (await host.request('/api/business-role?'+new URLSearchParams({owner:JSON.stringify({role:'project',projectId:project.id})}))).json();
  let rejected, retry;
  await page.route('**/api/business-role?**',async route => {
    const action = new URL(route.request().url()).searchParams.get('action');
    if(action==='messages'){
      const body=route.request().postDataJSON();
      if(rejected){retry=body;return route.abort('aborted');}
      rejected=body;
      return route.fulfill({status:409,json:{code:'configuration_required',accepted:false}});
    }
    if(!action && rejected) return route.fulfill({json:{
      ...current,busy:false,requestReceipt:undefined,
      discussion:{...current.discussion,revision:current.discussion.revision+1,pendingInput:rejected,lastRun:{id:rejected.requestId,status:'failed'}},
    }});
    return route.fallback();
  });
  await input.fill(failedText);
  await region.getByRole('button',{name:'发送',exact:true}).click();
  const replace = region.getByRole('button',{name:'保留原话另行发送'});
  await replace.waitFor();
  await page.reload();
  await page.getByRole('button',{name:title,exact:true}).click();
  await replace.click();
  assert.equal(await input.inputValue(),failedText);
  const attempted = page.waitForEvent('requestfailed',r => new URL(r.url()).searchParams.get('action')==='messages');
  await region.getByRole('button',{name:'发送',exact:true}).click();
  await attempted;
  assert.equal(retry?.replacePendingRequestId,rejected.requestId);
  assert.notEqual(retry?.requestId,rejected.requestId);
  console.log(JSON.stringify({requests,modelRequests:provider.requests.length,originalNativeEntry:original.requestReceipt.nativeEntryId,cancelledFromOriginalConversation:stopped.discussion.lastRun.id,replacedFailedRequest:retry.replacePendingRequestId}));
} finally {
  await browser?.close();
  frontend.kill();
  await host.close();
  await provider.close();
}
