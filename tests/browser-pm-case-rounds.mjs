// Run explicitly with node --test tests/browser-pm-case-rounds.mjs.
import test from 'node:test';
import { verifyConfirmedRounds } from './fixtures/pm-case-rounds.ts';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';
import { providerMessageText } from './fixtures/tool-provider.ts';

export async function verifyCaseRounds({host,provider,root,receipt,link,uiPort}) {
  const ui=spawn(process.execPath,['scripts/frontend.mjs','dev','--port',String(uiPort),'--strictPort'],{stdio:['ignore','pipe','pipe'],env:{...process.env,OPTRACALL_HOST_PORT:String(host.port)}});
  let browser,page;
  try {
    await new Promise((resolve,reject)=>{ui.stdout.on('data',chunk=>{if(chunk.toString().includes(':'+uiPort+'/'))resolve()});ui.once('exit',code=>reject(Error('UI exit '+code)))});
    browser=await chromium.launch({channel:'chrome',headless:true});page=await browser.newPage({viewport:{width:1500,height:990}});page.setDefaultTimeout(12000);
    const errors=[], observations=[];page.on('pageerror',error=>errors.push(error.message));
    const nav=page.getByRole('navigation',{name:'主导航',exact:true}),board=page.locator('.case-board'),work=page.locator('.case-issue-work');
    const round=work.locator('article').filter({hasText:'南店回访观察'});
    async function openCase() {
      await page.goto('http://127.0.0.1:'+uiPort);await nav.getByRole('button',{name:'决策星图',exact:true}).click();
      await board.getByRole('button',{name:'常规',exact:true}).click();await board.getByRole('button',{name:'两店复购',exact:true}).click();
      await work.getByText('历次取舍与实际反馈',{exact:true}).waitFor();
    }
    await openCase();
    await work.getByText('记录本次取舍',{exact:true}).click();await work.locator('details').filter({has:page.getByText('记录本次取舍',{exact:true})}).getByRole('combobox').first().selectOption(receipt.firstPlanRecord);
    const reason=work.getByLabel('依据与理由');await reason.fill('暂保留这个待决定输入');
    await link(receipt.source,false);await work.getByRole('button',{name:'确认取舍'}).click();
    await work.getByText('此项目已不再关联当前 Case，请刷新核对。',{exact:true}).waitFor();
    assert.equal(await reason.inputValue(),'暂保留这个待决定输入');await link(receipt.source,true);
    const previous=work.locator('article').filter({hasText:'原北店行动'});
    await previous.getByText('待反馈',{exact:false}).waitFor();
    assert.equal(await previous.getByRole('button',{name:'交接已授权的 Do Task'}).count(),0);
    await round.getByRole('button',{name:'交接已授权的 Do Task'}).click();
    const form=page.getByRole('dialog',{name:'新建任务'});
    assert.equal(await form.getByLabel('Task 类型').inputValue(),'do');await form.getByText(new RegExp(receipt.authorization.authorizationId)).waitFor();
    provider.setResponder(()=>({text:'UI-DO-RECEIVED'}));
    const count=provider.requests.length;
    const created=page.waitForResponse(r=>r.request().method()==='POST'&&new URL(r.url()).pathname==='/api/projects/'+receipt.work+'/tasks');
    await form.getByLabel('任务名称').fill('南店本轮执行');await form.getByRole('button',{name:'创建任务',exact:true}).click();
    const createdTask=(await (await created).json()).task;
    assert.equal(createdTask.assignment.issue.authorizationId,receipt.authorization.authorizationId);
    const composer=page.getByRole('form',{name:'发送消息'});
    await composer.getByLabel('消息',{exact:true}).fill('核对本轮授权');assert.equal(count,provider.requests.length);
    const sent=page.waitForRequest(r=>r.method()==='POST'&&new URL(r.url()).pathname==='/api/projects/'+receipt.work+'/tasks/'+createdTask.id+'/messages');
    await composer.getByRole('button',{name:'发送消息'}).click(); await page.getByText('UI-DO-RECEIVED',{exact:true}).first().waitFor();
    function received(kind,ids,markers){
      const prompt=provider.requests.at(-1).body.messages.filter(m=>m.role==='user').map(m=>providerMessageText(m.content)).join(' ');
      for(const marker of [...ids,...markers])assert.ok(prompt.includes(marker),kind+' 缺少 '+marker);
      assert.ok(!prompt.includes('A案：仅北店试行三天'));observations.push({kind,ids,markers});
    }
    received('do',[receipt.second,receipt.authorization.authorizationId,receipt.plan.messageId],['B案：仅南店试行两天','仅在南店回访两天']);
    Object.assign(observations.at(-1),{projectId:receipt.work,taskId:createdTask.id,requestId:(await sent).postDataJSON().requestId});
    await openCase();
    for(const [role,button,title] of [['goal','提交策略复核','目标管理 · 策略复核'],['strategy','提交战略假设复核','战略选择 · 战略假设复核']]){
      await round.getByRole('button',{name:button}).click();await page.getByRole('heading',{name:title,exact:true}).waitFor();
      await page.getByText('准确 Teach 原回复',{exact:true}).click();await page.getByText('南店两天后复购持平，先回目标复核。',{exact:true}).waitFor();
      const panel=page.locator('.strategy-discussion-panel');const answer='UI-UPSTREAM-'+role;
      provider.setResponder(()=>({text:answer}));
      await panel.getByRole('textbox').fill('仅核对本次提交的复盘');await panel.getByRole('button',{name:'发送',exact:true}).click();
      await panel.getByText(answer,{exact:true}).first().waitFor();
      const response=await host.request('/api/business-role?owner='+encodeURIComponent(JSON.stringify({role,...receipt.goal.primary,teachReview:{caseId:receipt.caseId,issueId:receipt.issueId,choiceId:receipt.second,reviewId:receipt.review}})));
      const state=await response.json();assert.equal(response.status,200);assert.equal(state.discussion.lastRun.status,'completed');
      assert.ok(state.snapshot.sessionId);assert.ok(state.requestReceipt.requestId);assert.ok(state.discussion.id);
      received(role,[receipt.second,receipt.feedbackId,receipt.teach.messageId,receipt.goal.primary.goalId],['南店两天后复购持平','复购没有改善','仅在南店回访两天']);
      Object.assign(observations.at(-1),{requestId:state.requestReceipt.requestId,sessionId:state.snapshot.sessionId,discussionId:state.discussion.id});
      await page.getByRole('button',{name:'返回原事项'}).click();await round.getByText('复盘判断 · 原假设仍待核',{exact:true}).waitFor();
    }
    await page.screenshot({path:path.join(root,'browser-round-restored.png')});
    await link(receipt.work,false);await work.getByRole('button',{name:'刷新原记录'}).click();
    await work.getByText('历史记录有限，当前无法读取原行动或观察。请核对项目关联与原资料权限。',{exact:true}).first().waitFor();
    assert.ok(!(await work.innerText()).includes('复购没有改善'));assert.ok(!(await work.innerText()).includes('待反馈'));
    await page.screenshot({path:path.join(root,'browser-limited.png')});
    await link(receipt.work,true);await work.getByRole('button',{name:'刷新原记录'}).click();await round.getByText(/复购没有改善/).waitFor();
    assert.deepEqual(errors,[]);await writeFile(path.join(root,'browser-receipt.json'),JSON.stringify({observations,errors},null,2));
  } catch(error) {
    if(page)await writeFile(path.join(root,'browser-failure.txt'),(await page.locator('body').innerText()).slice(0,30000));
    throw error;
  } finally {await browser?.close();ui.kill('SIGTERM');}
}

test('Browser hands the selected authorization to Do and submits its Teach to the two upstream roles', {timeout:90000}, t=>verifyConfirmedRounds(t,verifyCaseRounds));
