// Environment-only browser regression: actual React/CSS with bounded synthetic HTTP.
// These screenshots are component regression evidence, not final real Host UI acceptance.
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { createServer } from 'node:http';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from '/opt/codex/runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs';

const phase = process.env.CASE_ISSUE_GRAPH_PHASE ?? 'final';
const output = path.resolve('.local/ui-conformance/issue-graph', phase);
await mkdir(output, { recursive: true });
const now = '2026-11-28T12:00:00Z';
const record = { id: 'case-graph', title: '合成事项关系', status: 'pending', revision: 1, description: '', judgement: '', nextStep: '', closedAt: null, closeReason: null, createdAt: now, updatedAt: now };
const issue = (id, title = id) => ({ id, caseId: record.id, title, createdAt: now });
const edge = (id, from, to, change = {}) => ({ edgeId: id, caseId: record.id, fromIssueId: from, toIssueId: to, explanation: `明确关系 ${id}`, lifecycle: 'active', revision: 1, source: { kind: 'user-declaration', ref: 'synthetic' }, operationId: id, createdAt: now, ...change });
const issues = [issue('expand', '扩大试点范围'), issue('stock', '门店缺货原因'), issue('metric', '复购口径校准')];
const scenarios = {
  convergence: { issues, edges: [edge('metric-stock', 'metric', 'stock'), edge('metric-expand', 'metric', 'expand'), edge('stock-expand', 'stock', 'expand')] },
  single: { issues: issues.slice(0, 2), edges: [edge('stock-expand', 'stock', 'expand')] },
  cycle: { issues, edges: [edge('metric-stock', 'metric', 'stock'), edge('stock-expand', 'stock', 'expand'), edge('expand-metric', 'expand', 'metric')] },
  none: { issues, edges: [] },
  dangling: { issues, edges: [edge('missing', 'metric', 'gone'), edge('removed', 'stock', 'expand', { lifecycle: 'removed' }), edge('foreign', 'stock', 'expand', { caseId: 'other-case' })] },
  long: { issues: Array.from({ length: 18 }, (_, i) => issue(`long-${i}`, `第 ${i + 1} 个事项`)), edges: Array.from({ length: 17 }, (_, i) => edge(`chain-${i}`, `long-${i}`, `long-${i + 1}`)) },
};
await build({ stdin: { contents: `import React,{useState} from 'react';import {createRoot} from 'react-dom/client';import {CaseIssueTreeSidebar} from './src/host/ui/CaseIssueTreeSidebar.tsx';import './src/host/ui/styles.css';import './src/host/ui/case-board.css';import './src/host/ui/workspace-visual.css';import './src/host/ui/visual-refresh-settings.css';import './src/host/ui/daily-case-current.css';import './src/host/ui/daily-workspace.css';
const record=${JSON.stringify(record)},scenarios=${JSON.stringify(scenarios)};window.selected=[];function Harness(){const[scenario,setScenario]=useState('convergence'),[revision,setRevision]=useState(1),[selection,setSelection]=useState('expand');window.changeGraphScenario=name=>{setScenario(name);setRevision(v=>v+1)};return <div className="app" data-daily-workspace="true"><main className="main"><div className="case-current-layout"><div className="case-current-navigation"><CaseIssueTreeSidebar record={{...record,revision}} issues={scenarios[scenario].issues} selectedIssueId={selection} onSelectIssue={id=>{window.selected.push(id);setSelection(id)}} onChanged={()=>{}} onAddIssue={()=>{window.added=true}}/></div><div className="case-current-main">合成回归工作区</div></div></main></div>};createRoot(document.getElementById('root')).render(<Harness/>);`, resolveDir: process.cwd(), loader: 'tsx' }, bundle: true, format: 'esm', outdir: output, entryNames: 'harness', logLevel: 'silent' });
const server = createServer(async (req, res) => { const file = req.url === '/harness.js' ? 'harness.js' : req.url === '/harness.css' ? 'harness.css' : null; res.setHeader('Content-Type', file?.endsWith('.js') ? 'text/javascript' : file ? 'text/css' : 'text/html'); res.end(file ? await readFile(path.join(output, file)) : '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/harness.css"></head><body><div id="root"></div><script type="module" src="/harness.js"></script></body></html>'); });
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const browser = await chromium.launch({ executablePath: '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
page.setDefaultTimeout(5000);
let scenario = 'convergence';
const errors = [], writes = [], checks = [];
page.on('pageerror', error => errors.push(error.message));
await page.route('**/api/**', async route => { if (route.request().method() !== 'GET') writes.push(route.request().url()); await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(route.request().url().endsWith('/issue-edges') ? { edges: scenarios[scenario].edges } : { requests: [] }) }); });
const verify = async (name, fn) => { try { await fn(); checks.push({ name, ok: true }); } catch (error) { checks.push({ name, ok: false, error: error.message }); } };
const change = async name => { scenario = name; await Promise.all([page.waitForResponse(response => response.url().endsWith('/issue-edges')), page.evaluate(name => window.changeGraphScenario(name), name)]); await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))); };
await page.goto(`http://127.0.0.1:${server.address().port}`);
await page.getByRole('button', { name: '树状图', exact: true }).click();
const graph = page.locator('.case-issue-tree');
await graph.waitFor();
await verify('D11 three original issues and three explicit edges, convergence does not duplicate expand', async () => { assert.equal(await graph.locator('button').count(), 3); assert.equal(await graph.locator('path[data-issue-edge]').count(), 3); assert.equal(await graph.getByRole('button', { name: /扩大试点范围/ }).count(), 1); });
if (phase !== 'baseline') {
  await verify('arrows retain exact original source/target identity, direction, and source explanation', async () => {
    assert.deepEqual(await graph.locator('path[data-issue-edge]').evaluateAll(nodes => nodes.map(node => [node.dataset.issueEdge, node.dataset.fromIssue, node.dataset.toIssue]).sort()), scenarios.convergence.edges.map(edge => [edge.edgeId, edge.fromIssueId, edge.toIssueId]).sort());
    assert.equal(await graph.locator('path[data-issue-edge][marker-end]').count(), 3);
    assert.match(await graph.innerText(), /明确关系 metric-stock/);
    assert.deepEqual(await graph.locator('button[data-issue-id]').evaluateAll(nodes => nodes.map(node => node.dataset.issueId)), ['metric', 'stock', 'expand']);
  });
  await verify('keyboard selection, list toggle and per-Case preference remain available', async () => { const node = graph.getByRole('button', { name: /门店缺货原因/ }); await node.focus(); await page.keyboard.press('Enter'); assert.equal(await page.evaluate(() => window.selected.at(-1)), 'stock'); assert.equal(await node.getAttribute('aria-current'), 'true'); await page.getByRole('button', { name: '列表', exact: true }).click(); assert.equal(await page.locator('.case-issue-list button').count(), 3); await page.getByRole('button', { name: '树状图', exact: true }).click(); assert.equal(await graph.locator('button').count(), 3); });
  await verify('single predecessor shows two unique nodes and one edge', async () => { await change('single'); assert.equal(await graph.locator('button').count(), 2); assert.equal(await graph.locator('path[data-issue-edge]').count(), 1); });
  await verify('cycle keeps three original nodes and three arrows without recursive expansion', async () => { await change('cycle'); assert.equal(await graph.locator('button').count(), 3); assert.equal(await graph.locator('path[data-issue-edge]').count(), 3); assert.match(await graph.innerText(), /回指|循环/); });
  await verify('no edges remain three isolated issues with no inferred path', async () => { await change('none'); assert.equal(await graph.locator('button').count(), 3); assert.equal(await graph.locator('path[data-issue-edge]').count(), 0); assert.match(await graph.innerText(), /关系尚未标注/); });
  await verify('dangling edges are named unavailable, removed/foreign edges never drawn', async () => { await change('dangling'); assert.equal(await graph.locator('button').count(), 3); assert.equal(await graph.locator('path[data-issue-edge]').count(), 0); assert.match(await graph.innerText(), /端点.*不可读|端点.*不可用|原事项暂不可读取/); });
  await verify('adding and managing original relationships are still reachable', async () => { await change('convergence'); await page.getByRole('button', { name: '新增 Case 事项' }).filter({ visible: true }).click(); assert.equal(await page.evaluate(() => window.added), true); await page.locator('.case-issue-relations-management summary').click(); assert.equal(await page.getByRole('button', { name: /解除 .* 的承接关系/ }).count(), 3); await page.locator('.case-issue-relations-management summary').click(); });
  for (const width of [1440, 1024, 390]) await verify(`real production CSS preserves unique nodes and readable vertical graph at ${width}`, async () => { await page.setViewportSize({ width, height: 1000 }); await change('convergence'); assert.equal(await graph.locator('button').count(), 3); assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true); await graph.screenshot({ path: path.join(output, `graph-${width}.png`) }); });
  await verify('mobile long graph scrolls vertically within its view', async () => { await page.setViewportSize({ width: 390, height: 800 }); await change('long'); assert.equal(await graph.locator('button').count(), 18); assert.equal(await graph.locator('path[data-issue-edge]').count(), 17); assert.equal(await graph.evaluate(element => element.scrollHeight > element.clientHeight && ['auto', 'scroll'].includes(getComputedStyle(element).overflowY)), true); await graph.evaluate(element => { element.scrollTop = element.scrollHeight; }); await graph.getByRole('button', { name: /第 18 个事项/ }).click(); assert.equal(await page.evaluate(() => window.selected.at(-1)), 'long-17'); });
}
await browser.close(); await new Promise(resolve => server.close(resolve));
const receipt = { scope: 'bounded synthetic HTTP/component regression; not real Host product acceptance', phase, checks, errors, writes };
await writeFile(path.join(output, 'receipt.json'), JSON.stringify(receipt, null, 2));
console.log(JSON.stringify(receipt, null, 2));
if (checks.some(check => !check.ok) || errors.length || writes.length) process.exitCode = 1;
