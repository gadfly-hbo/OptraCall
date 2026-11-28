import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { runInNewContext } from 'node:vm';

type Element = { type: string | ((props: any) => any); props: Record<string, any> };
const nodes = (node: any): Element[] => !node || typeof node !== 'object' ? [] : Array.isArray(node) ? node.flatMap(nodes) : [node, ...nodes(node.props?.children)];
const text = (node: any): string => node == null || node === false ? '' : typeof node === 'string' || typeof node === 'number' ? String(node) : Array.isArray(node) ? node.map(text).join('') : text(node.props?.children);
let bundle: string | undefined;
async function harness(fetcher: typeof fetch) {
  bundle ??= (await build({ stdin: { contents: `export {DailyCaseCard} from './src/host/ui/DailyCaseCard.tsx';export {CaseIssueTreeSidebar} from './src/host/ui/CaseIssueTreeSidebar.tsx';`, resolveDir: process.cwd(), loader: 'tsx' }, bundle: true, write: false, platform: 'browser', format: 'iife', loader: { '.css': 'empty' }, globalName: 'DailyCurrentUiTest', plugins: [{ name: 'daily-current-fixture', setup(plugin) {
    plugin.onResolve({ filter: /^react(?:\/jsx-runtime)?$/ }, args => ({ path: args.path, namespace: 'daily-hooks' }));
    plugin.onLoad({ filter: /.*/, namespace: 'daily-hooks' }, args => ({ contents: args.path.endsWith('jsx-runtime') ? 'export const jsx=(type,props)=>({type,props});export const jsxs=jsx;export const Fragment="fragment";' : 'export const useState=v=>globalThis.__dailyHooks.state(v);export const useRef=v=>globalThis.__dailyHooks.ref(v);export const useEffect=(f,d)=>globalThis.__dailyHooks.effect(f,d);export const useId=()=>globalThis.__dailyHooks.id();export const useMemo=(f,d)=>f();' }));
    plugin.onResolve({ filter: /CaseDialogs\.tsx$/ }, args => ({ path: args.path, namespace: 'daily-components' }));
    plugin.onLoad({ filter: /.*/, namespace: 'daily-components' }, () => ({ contents: 'export const caseError=e=>e.message;export const caseStatusLabel={analyzing:"分析中"};export function CaseFormError(){return null;}' }));
  } }] })).outputFiles[0].text;
  const data = new Map<string, string>();
  const sandbox: Record<string, any> = { fetch: fetcher, structuredClone, crypto, Response, Request, Headers, URL, URLSearchParams, setTimeout, clearTimeout, sessionStorage: { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => data.set(key, value) } };
  runInNewContext(bundle, sandbox);
  function mount(Component: (props: any) => Element, props: Record<string, any>) {
    const values: any[] = [], dependencies: any[][] = [], cleanup: (() => void)[] = [], effects: (() => void)[] = [];
    let cursor = 0, tree: Element;
    const hooks = {
      state(initial: any) { const i = cursor++; if (!(i in values)) values[i] = typeof initial === 'function' ? initial() : initial; return [values[i], (v: any) => { values[i] = typeof v === 'function' ? v(values[i]) : v; }]; },
      ref(initial: any) { const i = cursor++; return values[i] ??= { current: initial }; },
      id() { return `daily-${cursor++}`; },
      effect(fn: () => any, deps: any[]) { const i = cursor++; if (!dependencies[i] || deps.some((v, n) => v !== dependencies[i][n])) { dependencies[i] = deps; effects.push(() => { cleanup[i]?.(); cleanup[i] = fn(); }); } },
    };
    const render = () => { cursor = 0; sandbox.__dailyHooks = hooks; tree = Component(props); while (effects.length) effects.shift()!(); };
    const settle = async () => { for (let i = 0; i < 8; i++) { await new Promise(resolve => setImmediate(resolve)); render(); } };
    render();
    return { render, settle, nodes: () => nodes(tree), text: () => text(tree), close: () => { for (const fn of cleanup) fn?.(); } };
  }
  return { ...sandbox.DailyCurrentUiTest, mount };
}
const record = { id: 'case-A', title: '复购改善', status: 'analyzing', revision: 1 };
function timeline(issueId: string, caseId = record.id) { return { issue: { id: issueId, caseId, title: issueId === 'issue-21' ? '第21件准确事项' : '扩大试点范围' }, rounds: [{ choice: { choiceId: 'choice-1', strategyRef: { caseId, caseStoreId: 'store-A' } }, actions: [] }] }; }
function request(change: Record<string, any> = {}) { return { requestId: 'request-1', revision: 1, caseId: record.id, issueId: 'issue-1', status: 'open', lifecycle: 'open', text: '明确请求扩围取舍', source: { kind: 'user-declaration', ref: 'synthetic' }, assignee: { label: '负责人' }, target: { kind: 'choose', strategyRef: { caseId: record.id, caseStoreId: 'store-A' }, expectedPreviousChoiceId: 'choice-1' }, ...change }; }
function server(requests = [request()]) {
  const reads: string[] = [];
  const fetcher: typeof fetch = async (input, init) => {
    const url = String(input); reads.push(url); assert.ok(!init?.method || init.method === 'GET', 'read-only UI must not create or advance work');
    if (url.includes('/workspace/case-directory')) return Response.json({ items: [{ caseId: record.id, title: record.title, goalBinding: null, issues: Array.from({length:20},(_,n)=>({issueId:`issue-${n+1}`,title:n?'其他事项 '+(n+1):'扩大试点范围'})), totalIssues: 21 }], continuation: null });
    if (url.endsWith('/decisions/requests')) return Response.json({ requests });
    if (url.endsWith('/decisions/issue-edges')) return Response.json({ edges: [] });
    const match = url.match(/\/issues\/(issue-\d+)$/); if(match) return Response.json(timeline(match[1]!));
    return Response.json({ message: '原事项不可读' }, {status:404});
  };
  return { fetcher, reads };
}

test('DW02: overview current round includes only the exact open choice request that follows the latest saved choice', async () => {
  const api = server(), h = await harness(api.fetcher), ui = h.mount(h.DailyCaseCard,{record,projectCount:1,onOpen(){}});
  try { await ui.settle(); assert.match(ui.text(), /第 2 轮 · 等待本轮取舍/); } finally { ui.close(); }
});

test('DW04: a restored selected issue beyond the directory first 20 is read by exact ID, never replaced by the first issue', async () => {
  const api = server(), h = await harness(api.fetcher), ui = h.mount(h.DailyCaseCard,{record,selectedIssueId:'issue-21',projectCount:1,onOpen(){}});
  try { await ui.settle(); assert.match(ui.text(), /上次选择的事项第21件准确事项/); assert.ok(api.reads.some(url=>url.endsWith('/issues/issue-21'))); assert.ok(!api.reads.some(url=>url.endsWith('/issues/issue-1'))); } finally { ui.close(); }
});

test('DW16: an unreadable restored issue is not silently replaced by the first readable issue', async () => {
  const api = server(), h = await harness(api.fetcher), ui = h.mount(h.DailyCaseCard,{record,selectedIssueId:'missing-issue',projectCount:1,onOpen(){}});
  try { await ui.settle(); assert.doesNotMatch(ui.text(), /扩大试点范围/); assert.match(ui.text(), /原事项暂不可读/); } finally { ui.close(); }
});

test('DW03: tree mode survives tab unmount/remount and remains isolated by Case identity', async () => {
  const api = server(), h = await harness(api.fetcher);
  const props = { record, issues:[{id:'issue-1',caseId:record.id,title:'扩围'}],selectedIssueId:'issue-1',onSelectIssue(){},onChanged(){} };
  const first = h.mount(h.CaseIssueTreeSidebar,props); await first.settle();
  const tree = first.nodes().find((n:Element)=>n.type==='button'&&text(n)==='树状图'); assert.ok(tree); tree.props.onClick(); first.render(); first.close();
  const remount = h.mount(h.CaseIssueTreeSidebar,props); await remount.settle();
  try { assert.equal(remount.nodes().find((n:Element)=>n.type==='button'&&text(n)==='树状图')?.props['aria-pressed'],true); } finally { remount.close(); }
  const other = h.mount(h.CaseIssueTreeSidebar,{...props,record:{...record,id:'case-B'}}); await other.settle();
  try { assert.equal(other.nodes().find((n:Element)=>n.type==='button'&&text(n)==='列表')?.props['aria-pressed'],true); } finally { other.close(); }
});

test('DW02: other owners, answered requests and nonmatching previous choices never create a pending round on the overview', async () => {
  const target = request().target;
  for (const wrong of [request({caseId:'case-B'}),request({issueId:'issue-2'}),request({status:'answered'}),request({lifecycle:'withdrawn'}),request({target:{...target,expectedPreviousChoiceId:'older-choice'}}),request({target:{...target,strategyRef:{...target.strategyRef,caseId:'case-B'}}}),request({target:{...target,strategyRef:{...target.strategyRef,caseStoreId:'other-store'}}})]) {
    const api = server([wrong]), h = await harness(api.fetcher), ui = h.mount(h.DailyCaseCard,{record,projectCount:1,onOpen(){}});
    try { await ui.settle(); assert.match(ui.text(), /第 1 轮 · 已记录取舍/); assert.doesNotMatch(ui.text(), /等待本轮取舍/); } finally { ui.close(); }
  }
});

test('DW16: unreadable request projection remains unknown instead of claiming the latest saved round is the current round', async () => {
  const api = server(), h = await harness(async (input,init) => String(input).endsWith('/decisions/requests') ? Response.json({message:'暂不可用'},{status:503}) : api.fetcher(input,init));
  const ui = h.mount(h.DailyCaseCard,{record,projectCount:1,onOpen(){}});
  try { await ui.settle(); assert.match(ui.text(), /轮次待核 · 进展待核/); assert.doesNotMatch(ui.text(), /第 1 轮|第 2 轮/); } finally { ui.close(); }
});
