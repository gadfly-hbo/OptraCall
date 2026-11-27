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
  const proc = spawn('/usr/bin/google-chrome', [
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

    // 1. Desktop 1440px: Home shows "Decision Case" nav, "待处理事项（1）", XSS-safe title (window.__xss undefined)
    await chrome.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
    const homeText = await waitForText('待处理事项（1）');
    assert.ok(homeText.includes('Decision Case'));
    assert.ok(homeText.includes('华东负责人'));
    assert.ok(homeText.includes(xssTitle));
    assert.equal(await chrome.evalJs('Boolean(window.__xss)'), false, 'XSS must never execute');

    // 2. Click "前往原事项回应" -> opens Case detail with issue sidebar, switch to 树状图 -> see multi-predecessor badge
    await chrome.evalJs(`Array.from(document.querySelectorAll('button')).find(b => b.textContent?.includes('前往原事项回应'))?.click()`);
    await waitForText('树状图');
    await chrome.evalJs(`Array.from(document.querySelectorAll('button')).find(b => b.textContent?.trim() === '树状图')?.click()`);
    const treeText = await waitForText('汇入 · 2 个前驱');
    assert.ok(treeText.includes('扩围取舍'));

    // 3. Switch to 关联项目 tab -> verify scope bar (当前事项 / 全部当前 Case)
    await chrome.evalJs(`Array.from(document.querySelectorAll('button')).find(b => b.textContent?.includes('关联项目'))?.click()`);
    await waitForText('浏览范围（不改变 Agent 协作上下文）');

    // 4. Check 1024px and 390px viewports render cleanly with no crash and readable content
    for (const width of [1024, 390]) {
      await chrome.send('Emulation.setDeviceMetricsOverride', { width, height: 844, deviceScaleFactor: 1, mobile: width < 500 });
      await new Promise(r => setTimeout(r, 150));
      const len = await chrome.evalJs('document.body.innerText.trim().length');
      assert.ok(len > 100, `content must remain readable at ${width}px`);
    }

    // 5. Verify Decision Case -> 全部项目 tab switch works
    await chrome.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
    await chrome.evalJs(`Array.from(document.querySelectorAll('button')).find(b => b.getAttribute('aria-label') === '关闭' || b.textContent?.trim() === '关闭')?.click()`);
    await new Promise(r => setTimeout(r, 200));
    await chrome.evalJs(`Array.from(document.querySelectorAll('.decision-case-tabs button')).find(b => b.textContent?.trim() === '全部项目')?.click()`);
    await waitForText('Browser合成项目');

    console.log('BROWSER_DW_ALL_PASS: 1440/1024/390 + home pending + XSS safe + issue tree multi-predecessor + scope bar + Decision Case tabs');
  } finally {
    if (chrome) await chrome.close();
    await host.close().catch(() => {});
  }
}

run().catch(err => { console.error('BROWSER_DW_FAIL:', err); process.exit(1); });
