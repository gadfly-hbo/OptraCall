import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { runInNewContext } from 'node:vm';

type Element = { type: string | ((props: any) => any); props: Record<string, any> };
const nodes = (node: any): Element[] => !node || typeof node !== 'object' ? [] : Array.isArray(node) ? node.flatMap(nodes) : [node, ...nodes(node.props?.children)];
const text = (node: any): string => node == null || node === false ? '' : typeof node === 'string' || typeof node === 'number' ? String(node) : Array.isArray(node) ? node.map(text).join('') : text(node.props?.children);
let bundle: string | undefined;
async function harness(fetcher: typeof fetch, props: Record<string, any>) {
  bundle ??= (await build({ entryPoints: ['src/host/ui/DailyCaseHistory.tsx'], bundle: true, write: false, platform: 'browser', format: 'iife', globalName: 'HistoryUiTest', plugins: [{ name: 'history-ui-fixture', setup(plugin) {
    plugin.onResolve({ filter: /^react(?:\/jsx-runtime)?$/ }, args => ({ path: args.path, namespace: 'history-hooks' }));
    plugin.onLoad({ filter: /.*/, namespace: 'history-hooks' }, args => ({ contents: args.path.endsWith('jsx-runtime') ? 'export const jsx=(type,props)=>({type,props}); export const jsxs=jsx; export const Fragment="fragment";' : 'export const useState=v=>globalThis.__hooks.state(v); export const useEffect=(f,d)=>globalThis.__hooks.effect(f,d);' }));
    plugin.onResolve({ filter: /CaseDialogs\.tsx$/ }, args => ({ path: args.path, namespace: 'history-dialog' }));
    plugin.onLoad({ filter: /.*/, namespace: 'history-dialog' }, () => ({ contents: 'export const caseError=e=>e.message; export const caseDate=value=>value; export function CaseDialog(){return null;}' }));
    plugin.onLoad({ filter: /\.css$/ }, () => ({ contents: '', loader: 'js' }));
  } }] })).outputFiles[0].text;
  const sandbox: Record<string, any> = { fetch: fetcher, Response, URL, URLSearchParams };
  runInNewContext(bundle, sandbox);
  const values: any[] = [], dependencies: any[][] = [], cleanup: (() => void)[] = [], effects: (() => void)[] = [];
  let cursor = 0, tree: Element;
  sandbox.__hooks = {
    state(initial: any) { const i = cursor++; if (!(i in values)) values[i] = typeof initial === 'function' ? initial() : initial; return [values[i], (v: any) => { values[i] = typeof v === 'function' ? v(values[i]) : v; }]; },
    effect(fn: () => any, deps: any[]) { const i = cursor++; if (!dependencies[i] || deps.some((value, n) => value !== dependencies[i][n])) { dependencies[i] = deps; effects.push(() => { cleanup[i]?.(); cleanup[i] = fn(); }); } },
  };
  const render = () => { cursor = 0; tree = sandbox.HistoryUiTest.DailyCaseHistory(props); while (effects.length) effects.shift()!(); };
  const settle = async () => { for (let i = 0; i < 5; i++) { await new Promise(resolve => setImmediate(resolve)); render(); } };
  render();
  return { props, render, settle, text: () => text(tree), nodes: () => nodes(tree), find: (type: string, label: string) => nodes(tree).find(node => node.type === type && text(node).includes(label)), close() { cleanup.forEach(fn => fn?.()); } };
}

const caseId = 'case-A';
const issues = [{ id: 'issue-A', caseId, title: '扩大试点' }, { id: 'issue-B', caseId, title: '口径校准' }];
const strategyRef = { type: 'case-decision', caseId, caseStoreId: 'store-A', recordId: 'plan-A', revision: 7 };
const round = (issueId: string, id: string, previousChoiceId: string | null, reason: string) => ({
  choice: { choiceId: id, caseId, issueId, previousChoiceId, choice: 'trial', reason, strategyRef, occurredAt: '2026-11-20', operationId: `operation-${id}` },
  strategy: { payload: { title: `方案 ${id}` } }, actions: [], review: null, reviewSaved: false, historyLimited: false, reviewObservationLimited: false,
});
const original = round('issue-A', 'choice-A1', null, '原取舍：保持三店范围');
const current = round('issue-A', 'choice-A2', 'choice-A1', '第二轮取舍：继续观察');
const timelineA = { issue: issues[0], rounds: [original, current] };
const timelineB = { issue: issues[1], rounds: [round('issue-B', 'choice-B1', null, '按首购会员计算')] };
const request = { caseId, issueId: 'issue-A', status: 'open', lifecycle: 'open', target: { kind: 'choose', strategyRef, expectedPreviousChoiceId: 'choice-A2' }, text: '第三轮需要取舍', assignee: { label: '负责人' } };
function server() {
  let denied = false, delayA: ((value: Response) => void) | undefined;
  const calls: { url: string; method: string }[] = [];
  const fetcher: typeof fetch = async (input, init) => {
    const url = String(input); calls.push({ url, method: init?.method ?? 'GET' });
    if (url.endsWith('/requests')) return Response.json({ requests: [request] });
    if (url.endsWith('/issue-A')) return delayA ? new Promise(resolve => { delayA = resolve; }) : Response.json(timelineA);
    if (url.endsWith('/issue-B')) return denied ? Response.json({ code: 'forbidden' }, { status: 403 }) : Response.json(timelineB);
    return Response.json({ code: 'not_found' }, { status: 404 });
  };
  return { fetcher, calls, deny() { denied = true; }, delay() { delayA = () => {}; }, release() { delayA?.(Response.json(timelineA)); } };
}
const props = () => ({ caseId, revision: 1, issues, selectedIssueId: 'issue-A', onSelectIssue() {}, onReturnCurrent() {} });

test('DW02/D18: history uses the exact issue choice chain and pending request, never strategy revision as round number', async () => {
  const api = server(), ui = await harness(api.fetcher, props());
  try {
    await ui.settle();
    assert.match(ui.text(), /第 3 轮 · 当前轮/);
    assert.match(ui.text(), /第三轮需要取舍/);
    assert.match(ui.text(), /第 2 轮.*已保存/);
    assert.match(ui.text(), /第 1 轮.*已保存/);
    assert.doesNotMatch(ui.text(), /第 7 轮|按首购会员计算/);
    const openOriginal = ui.nodes().filter(node => node.type === 'button' && text(node).includes('查看该轮完整记录')).at(-1);
    assert.ok(openOriginal); openOriginal.props.onClick(); ui.render();
    assert.match(ui.text(), /正在查看已保存轮次 · 只读/);
    assert.match(ui.text(), /原取舍：保持三店范围/);
    assert.doesNotMatch(ui.text(), /第二轮取舍：继续观察/);
    ui.find('button', '查看当时保存内容')!.props.onClick(); ui.render();
    assert.match(ui.text(), /choice-A1/);
    assert.match(ui.text(), /plan-A · v7/);
    assert.ok(api.calls.every(call => call.method === 'GET'));
  } finally { ui.close(); }
});

test('DW02/D12: returning from a historical round only navigates; it never accesses composer or draft endpoints', async () => {
  const api = server(); let returned = 0;
  const ui = await harness(api.fetcher, { ...props(), onReturnCurrent() { returned++; } });
  try {
    await ui.settle(); ui.find('button', '查看该轮完整记录')!.props.onClick(); ui.render();
    ui.find('button', '返回当前轮')!.props.onClick(); ui.render();
    assert.equal(returned, 1);
    assert.ok(api.calls.every(call => call.method === 'GET'));
    assert.ok(api.calls.every(call => !/draft|business-role|conversation/.test(call.url)));
  } finally { ui.close(); }
});

test('DW16: switching to denied history clears old issue contents and an open source before another read completes', async () => {
  const api = server(), ui = await harness(api.fetcher, { ...props(), children: '旧Case管理记录' });
  try {
    await ui.settle(); ui.find('button', '查看当时保存内容')!.props.onClick(); ui.render(); assert.match(ui.text(), /choice-A2/);
    api.deny(); ui.props.selectedIssueId = 'issue-B'; ui.render();
    assert.doesNotMatch(ui.text(), /choice-A2|原取舍：保持三店范围|第二轮取舍/);
    await ui.settle(); assert.ok(ui.nodes().some(node => node.props.role === 'alert'));
    assert.doesNotMatch(ui.text(), /choice-A2|原取舍：保持三店范围|旧Case管理记录|按首购会员计算/);
    assert.ok(api.calls.every(call => call.method === 'GET'));
  } finally { ui.close(); }
});

test('DW16: a late response from a previous issue cannot overwrite the selected issue history', async () => {
  const api = server(); api.delay(); const ui = await harness(api.fetcher, props());
  try {
    ui.props.selectedIssueId = 'issue-B'; ui.render(); await ui.settle();
    assert.match(ui.text(), /按首购会员计算/);
    api.release(); await ui.settle();
    assert.match(ui.text(), /按首购会员计算/); assert.doesNotMatch(ui.text(), /原取舍：保持三店范围|第二轮取舍/);
  } finally { ui.close(); }
});

test('D14: historical observation date and source stay distinct from recording time; legacy dates remain unknown', async () => {
  const action = { projectId: 'project-A', itemId: 'item-A', taskId: 'task-A', title: '原核查行动', status: 'doing', authorizations: [], feedback: [
    { revisionId: 'feedback-dated', authorizationId: 'authorization-A', actionTitle: '原核查行动', observedAt: '2026-11-28T01:00:00Z', observationDate: '2026-11-21', sourceScope: '三家门店原记录，第四家尚缺', outcome: '先记观察，执行状态未知', effect: 'unknown', metricDelta: '', review: '' },
    { revisionId: 'feedback-legacy', authorizationId: 'authorization-A', actionTitle: '原核查行动', observedAt: '2026-11-22T01:00:00Z', outcome: '旧反馈没有观察日期', effect: 'unknown', metricDelta: '', review: '' },
  ] };
  const calls: string[] = [];
  const fetcher: typeof fetch = async (input, init) => { calls.push(init?.method ?? 'GET'); return String(input).endsWith('/requests') ? Response.json({requests:[]}) : Response.json({issue:issues[0],rounds:[{...original,actions:[action]}]}); };
  const ui = await harness(fetcher, props());
  try {
    await ui.settle();
    assert.match(ui.text(), /观察日期：2026-11-21/);
    assert.match(ui.text(), /观察日期未记录/);
    assert.match(ui.text(), /回录于 2026-11-28T01:00:00Z/);
    assert.match(ui.text(), /三家门店原记录，第四家尚缺/);
    ui.find('button', '查看反馈原记录')!.props.onClick(); ui.render();
    assert.match(ui.text(), /观察日期2026-11-21/);
    assert.match(ui.text(), /回录时间2026-11-28T01:00:00Z/);
    assert.match(ui.text(), /来源与范围三家门店原记录，第四家尚缺/);
    assert.ok(calls.every(method => method === 'GET'));
  } finally { ui.close(); }
});
