import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { startTestHost } from './fixtures/host-process.ts';
import { readJson } from './fixtures/joint-context.ts';
import { withCaseGoal } from './fixtures/case-goal.ts';
import { CaseStore } from '../src/host/case-store.ts';

async function launchChrome(url) {
  const userDataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'optracall-chrome-'));
  const port = 19222 + Math.floor(Math.random() * 10000);
  const proc = spawn(process.env.CHROME_BIN ?? '/usr/bin/chromium', [
    '--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
    `--remote-debugging-port=${port}`, `--user-data-dir=${userDataDir}`, url,
  ], { stdio: 'ignore' });
  let wsUrl = '';
  for (let i = 0; i < 60; i++) {
    await new Promise(r => setTimeout(r, 150));
    try {
      const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
      const page = targets.find(t => t.type === 'page' && t.webSocketDebuggerUrl);
      if (page) { wsUrl = page.webSocketDebuggerUrl; break; }
    } catch {}
  }
  if (!wsUrl) { proc.kill(); throw new Error('chrome_cdp_unavailable'); }
  const ws = new WebSocket(wsUrl);
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
  let seq = 1;
  const pending = new Map();
  ws.onmessage = ev => {
    const msg = JSON.parse(String(ev.data));
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(msg.error.message));
      else resolve(msg.result);
    }
  };
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = seq++;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });
  const evalJs = async expression => {
    const res = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (res.exceptionDetails) throw new Error(res.exceptionDetails.text || 'js_eval_error');
    return res.result?.value;
  };
  return {
    send, evalJs,
    close: async () => { ws.close(); proc.kill('SIGKILL'); await fs.rm(userDataDir, { recursive: true, force: true }).catch(() => {}); },
  };
}

async function run() {
  let host = await startTestHost({ staticUiRoot: path.resolve('dist/ui') });
  let chrome;
  try {
    await readJson(await host.request('/api/configuration', 'PUT', {
      name: 'Browser合成', provider: 'openai-compatible', baseUrl: 'http://127.0.0.1:1', model: 'synthetic', apiKey: 'synthetic-only',
    }));
    const { project } = await readJson(await host.request('/api/projects', 'POST', { name: 'Browser合成项目' }), 201);
    const { task } = await readJson(await host.request(`/api/projects/${project.id}/tasks`, 'POST', { name: 'Browser任务' }), 201);
    await readJson(await host.request('/api/cases/storage/initialize', 'POST', {}));
    const xssTitle = '华东扩围 <img src=x onerror="window.__xss=1">';
    const { case: created } = await readJson(await host.request('/api/cases', 'POST', await withCaseGoal(host, {
      operationId: randomUUID(), title: xssTitle, description: '浏览器实测',
    })), 201);
    await readJson(await host.request(`/api/cases/${created.id}/projects`, 'POST', {
      operationId: randomUUID(), expectedRevision: created.revision, projectId: project.id,
    }));
    const getRev = async () => (await readJson(await host.request(`/api/cases/${created.id}`))).case.revision;
    const { issue: a } = await readJson(await host.request(`/api/cases/${created.id}/decisions/issues`, 'POST', { operationId: randomUUID(), expectedRevision: await getRev(), title: '试点范围' }), 201);
    const { issue: b } = await readJson(await host.request(`/api/cases/${created.id}/decisions/issues`, 'POST', { operationId: randomUUID(), expectedRevision: await getRev(), title: '门店访谈' }), 201);
    const { issue: c } = await readJson(await host.request(`/api/cases/${created.id}/decisions/issues`, 'POST', { operationId: randomUUID(), expectedRevision: await getRev(), title: '扩围取舍' }), 201);
    await readJson(await host.request(`/api/cases/${created.id}/decisions/issue-edges`, 'POST', {
      operationId: randomUUID(), expectedRevision: await getRev(), fromIssueId: a.id, toIssueId: c.id, explanation: '试点汇入', expectedEdgeRevision: 0, source: { kind: 'user-declaration', ref: 'b1' },
    }), 201);
    await readJson(await host.request(`/api/cases/${created.id}/decisions/issue-edges`, 'POST', {
      operationId: randomUUID(), expectedRevision: await getRev(), fromIssueId: b.id, toIssueId: c.id, explanation: '访谈汇入', expectedEdgeRevision: 0, source: { kind: 'user-declaration', ref: 'b2' },
    }), 201);

    await host.close();
    const store = new CaseStore({ dataRoot: host.dataRoot });
    await store.init();
    const caseStoreId = store.getStatus().storeId;
    const strategy = store.saveDecisionDraft(
      { operationId: randomUUID(), caseStoreId, caseId: created.id, expectedRevision: 0, kind: 'strategy', payload: { title: '先扩三家', proposal: '两周观察' } },
      { actorKind: 'agent', projectId: project.id, taskId: task.id, requestId: randomUUID(), sessionId: 'b-s1', toolCallId: 'b-t1' },
    );
    store.close();
    host = await startTestHost({ dataRoot: host.dataRoot, projectsRoot: host.projectsRoot });
    const rev = (await readJson(await host.request(`/api/cases/${created.id}`))).case.revision;
    await readJson(await host.request(`/api/cases/${created.id}/decisions/requests`, 'POST', {
      operationId: randomUUID(), expectedRevision: rev, expectedRequestRevision: 0,
      issueId: c.id, kind: 'choose', text: '请华东负责人对三家门店方案作取舍',
      source: { kind: 'user-declaration', ref: 'b-msg' },
      assignee: { label: '华东负责人', source: 'b-msg' },
      target: { kind: 'choose', strategyRef: { type: 'case-decision', caseStoreId, caseId: created.id, recordId: strategy.recordId, revision: strategy.revision }, expectedPreviousChoiceId: null },
    }), 201);
    const { dataRoot, projectsRoot } = host;
    await host.close();

    const { createHost } = await import('../src/host/server.ts');
    const uiHost = createHost({ cwd: process.cwd(), uiPorts: [], transportVersion: '1', dataRoot, projectsRoot, staticUiRoot: path.resolve('dist') });
    await uiHost.ready;
    await new Promise(resolve => uiHost.server.listen(0, '127.0.0.1', resolve));
    const uiPort = uiHost.server.address().port;
    host = { close: () => uiHost.close() };

    chrome = await launchChrome(`http://127.0.0.1:${uiPort}/`);
    const waitForText = async (needle, ms = 12000) => {
      const deadline = Date.now() + ms;
      while (Date.now() < deadline) {
        const txt = await chrome.evalJs('document.body?.innerText || ""');
        if (txt && txt.includes(needle)) return txt;
        await new Promise(r => setTimeout(r, 200));
      }
      const last = await chrome.evalJs('document.body?.innerText || ""').catch(() => '');
      throw new Error(`timeout waiting for text: ${needle} (got: ${String(last).slice(0, 300)})`);
    };

    // 1. Desktop 1440px: Home shows "Decision Case" nav, "待处理事项（1）", NO old "需要你处理", XSS-safe title
    await chrome.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
    const homeText = await waitForText('待处理事项（1）');
    assert.ok(homeText.includes('Decision Case'));
    assert.ok(!homeText.includes('需要你处理'), 'legacy heuristic heading must not appear');
    assert.ok(homeText.includes('华东负责人'));
    assert.ok(homeText.includes(xssTitle));
    assert.equal(await chrome.evalJs('Boolean(window.__xss)'), false, 'XSS must never execute');

    // 2. FR06: Type light input WITHOUT clicking save -> navigate to 全部项目 -> return home -> input preserved!
    await chrome.evalJs(`(() => {
      const ta = document.querySelector('.home-daily-quick-input textarea');
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
      setter.call(ta, '导航前未点保存的轻输入');
      ta.dispatchEvent(new Event('input', { bubbles: true }));
      ta.dispatchEvent(new Event('blur', { bubbles: true }));
    })()`);
    await new Promise(r => setTimeout(r, 600));
    await chrome.evalJs(`Array.from(document.querySelectorAll('.home-daily-quick-input button')).find(b => b.textContent?.trim() === '全部项目')?.click()`);
    await waitForText('Browser合成项目');
    await chrome.evalJs(`Array.from(document.querySelectorAll('nav.primary-nav button')).filter(b=>b.getClientRects().length).find(b => b.textContent?.includes('工作台首页'))?.click()`);
    await waitForText('待处理事项（1）');
    const restoredVal = await chrome.evalJs(`document.querySelector('.home-daily-quick-input textarea')?.value || ''`);
    assert.equal(restoredVal, '导航前未点保存的轻输入', 'light input must survive navigation without manual save click');

    // 3. Click "前往原事项回应" -> verify pinned G/S bar, 3-part summary, tree multi-predecessor, and preserved issue+manual scope across tabs
    await chrome.evalJs(`Array.from(document.querySelectorAll('button')).filter(b => b.getClientRects().length).find(b => b.textContent?.includes('前往原事项回应'))?.click()`);
    const caseText = await waitForText('树状图');
    assert.ok(caseText.includes('目标 / 策略（G/S）'), 'pinned G/S bar must appear');
    assert.ok(caseText.includes('已明确') && caseText.includes('正在推进') && caseText.includes('接下来'), '3-part round summary must appear');
    await chrome.evalJs(`Array.from(document.querySelectorAll('button')).filter(b => b.getClientRects().length).find(b => b.textContent?.trim() === '树状图')?.click()`);
    const treeText = await waitForText('汇入 · 2 个前驱');
    assert.ok(treeText.includes('扩围取舍'));

    // Switch to 项目与任务 tab -> verify pinned G/S still visible + "按事项筛选" + manual scope preserved back & forth
    await chrome.evalJs(`Array.from(document.querySelectorAll('button')).filter(b => b.getClientRects().length).find(b => b.textContent?.includes('项目与任务'))?.click()`);
    const projTabText = await waitForText('浏览范围（不改变 Agent 协作上下文）');
    assert.ok(projTabText.includes('目标 / 策略（G/S）'), 'G/S bar must stay pinned on projects tab');
    assert.ok(projTabText.includes('按事项筛选'), 'other-issue selector must exist');
    await chrome.evalJs(`Array.from(document.querySelectorAll('.case-scope-bar button')).find(b => b.textContent?.trim() === '全部当前 Case')?.click()`);
    await chrome.evalJs(`Array.from(document.querySelectorAll('.case-detail-tabs button')).find(b => b.textContent?.includes('当前工作'))?.click()`);
    await waitForText('树状图');
    // Return to 项目与任务: manual "全部当前 Case" MUST still be aria-pressed="true"
    await chrome.evalJs(`Array.from(document.querySelectorAll('.case-detail-tabs button')).find(b => b.textContent?.includes('项目与任务'))?.click()`);
    await waitForText('浏览范围（不改变 Agent 协作上下文）');
    const stillAll = await chrome.evalJs(`Array.from(document.querySelectorAll('.case-scope-bar button')).find(b => b.textContent?.trim() === '全部当前 Case')?.getAttribute('aria-pressed')`);
    assert.equal(stillAll, 'true', 'manual scope selection must survive tab switches');

    // Draft protection uses the same visible composer and Host draft, even after the panel remounts.
    await chrome.evalJs(`Array.from(document.querySelectorAll('.case-detail-tabs button')).find(b=>b.textContent?.includes('当前工作'))?.click()`);
    await waitForText('树状图');
    await chrome.evalJs(`Array.from(document.querySelectorAll('button')).filter(b=>b.getClientRects().length).find(b=>b.textContent?.trim()==='与决策 Agent 协作')?.click()`);
    const composerSelector = '.case-agent-entry .role-composer textarea';
    for(let i=0;i<60;i++){
      if(await chrome.evalJs(`Boolean(document.querySelector('${composerSelector}')&&!document.querySelector('${composerSelector}').disabled)`))break;
      await new Promise(r=>setTimeout(r,100));
    }
    await chrome.evalJs(`(()=>{const ta=document.querySelector('${composerSelector}');if(!ta||ta.disabled)throw Error('composer unavailable');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(ta,'原对话中尚未发送的输入');ta.dispatchEvent(new Event('input',{bubbles:true}));})()`);
    await new Promise(r=>setTimeout(r,500));
    const draft = await chrome.evalJs(`fetch('/api/workspace/drafts/issue-draft/'+encodeURIComponent('issue:${created.id}:${c.id}'),{headers:{'x-optracall-client':'1'}}).then(r=>r.json())`);
    assert.equal(draft.draft.payload.text,'原对话中尚未发送的输入');
    await chrome.evalJs(`Array.from(document.querySelectorAll('.case-detail-tabs button')).find(b=>b.textContent?.includes('成果与依据'))?.click()`);
    await waitForText('浏览范围（不改变 Agent 协作上下文）');
    await chrome.evalJs(`Array.from(document.querySelectorAll('.case-detail-tabs button')).find(b=>b.textContent?.includes('当前工作'))?.click()`);
    await waitForText('树状图');
    await chrome.evalJs(`Array.from(document.querySelectorAll('button')).filter(b=>b.getClientRects().length).find(b=>b.textContent?.trim()==='与决策 Agent 协作')?.click()`);
    for(let i=0;i<60;i++){
      if(await chrome.evalJs(`document.querySelector('${composerSelector}')?.value==='原对话中尚未发送的输入'`))break;
      await new Promise(r=>setTimeout(r,100));
    }
    assert.equal(await chrome.evalJs(`document.querySelector('${composerSelector}')?.value`),'原对话中尚未发送的输入');
    assert.equal(await chrome.evalJs(`Boolean(document.querySelector('.case-issue-draft-box'))`),false,'one editable composer owns the issue input');
    // A modal must keep keyboard focus in its visible controls.
    await chrome.evalJs(`document.querySelector('dialog[open] button')?.focus()`);
    for(let i=0;i<4;i++)await chrome.send('Input.dispatchKeyEvent',{type:'keyDown',key:'Tab',code:'Tab',windowsVirtualKeyCode:9});
    assert.equal(await chrome.evalJs(`Boolean(document.querySelector('dialog[open]')?.contains(document.activeElement))`),true);

    // 4. Check 1024px and 390px viewports render cleanly with no crash and readable content
    for (const width of [1024, 390]) {
      await chrome.send('Emulation.setDeviceMetricsOverride', { width, height: 844, deviceScaleFactor: 1, mobile: width < 500 });
      await new Promise(r => setTimeout(r, 150));
      const len = await chrome.evalJs('document.body.innerText.trim().length');
      assert.ok(len > 100, `content must remain readable at ${width}px`);
      await fs.mkdir('.local/pm-second/screenshots',{recursive:true});
      const screenshot=await chrome.send('Page.captureScreenshot',{format:'png'});
      await fs.writeFile(`.local/pm-second/screenshots/case-${width}.png`,Buffer.from(screenshot.data,'base64'));
      const overflow = await chrome.evalJs('document.documentElement.scrollWidth > innerWidth + 2');
      assert.equal(overflow, false, `page must not overflow at ${width}px`);
    }

    console.log('BROWSER_DW_ALL_PASS: 1440/1024/390 + FR04 no heuristic queue + FR06 auto-persist across nav + FR07 pinned G/S, 3-part summary, other-issue selector & preserved manual scope + real composer persistence/remount + keyboard focus + XSS safe');
  } finally {
    if (chrome) await chrome.close();
    await host.close().catch(() => {});
  }
}

run().catch(err => { console.error('BROWSER_DW_FAIL:', err); process.exit(1); });
