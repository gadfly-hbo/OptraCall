import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { build } from 'esbuild';
import { runInNewContext } from 'node:vm';

type Element = { type: string | ((props: any) => any); props: Record<string, any> };
const nodes = (node: any): Element[] => !node || typeof node !== 'object' ? [] : Array.isArray(node) ? node.flatMap(nodes) : [node, ...nodes(node.props?.children)];
const text = (node: any): string => node == null || node === false ? '' : typeof node === 'string' || typeof node === 'number' ? String(node) : Array.isArray(node) ? node.map(text).join('') : text(node.props?.children);
let bundle: string | undefined;
async function harness(fetcher: typeof fetch) {
  bundle ??= (await build({ entryPoints: ['src/host/ui/CaseIssuePanel.tsx'], bundle: true, write: false, platform: 'browser', format: 'iife', globalName: 'RequestResponseUiTest', plugins: [{ name: 'request-response-ui-fixture', setup(plugin) {
    plugin.onResolve({ filter: /^react(?:\/jsx-runtime)?$/ }, args => ({ path: args.path, namespace: 'request-hooks' }));
    plugin.onLoad({ filter: /.*/, namespace: 'request-hooks' }, args => ({ contents: args.path.endsWith('jsx-runtime') ? 'export const jsx=(type,props)=>({type,props}); export const jsxs=jsx; export const Fragment="fragment";' : 'export const useState=v=>globalThis.__requestResponseHooks.state(v); export const useRef=v=>globalThis.__requestResponseHooks.ref(v); export const useEffect=(f,d)=>globalThis.__requestResponseHooks.effect(f,d); export const useId=()=>globalThis.__requestResponseHooks.id(); export const useMemo=(f,d)=>globalThis.__requestResponseHooks.memo(f,d); export const useCallback=(f,d)=>globalThis.__requestResponseHooks.memo(()=>f,d);' }));
    // Export the original private component for an isolated renderer; its body is unchanged.
    plugin.onLoad({ filter: /\/CaseIssuePanel\.tsx$/ }, async args => ({ contents: `${await readFile(args.path, 'utf8')}\nexport { IssueWork as __IssueWorkForTest };`, loader: 'tsx' }));
    plugin.onResolve({ filter: /(?:BusinessRoleConversation|CaseIssueTreeSidebar|CaseDialogs|CaseFeedbackDialog)\.tsx$/ }, args => ({ path: args.path, namespace: 'request-ui-components' }));
    plugin.onLoad({ filter: /.*/, namespace: 'request-ui-components' }, args => ({ contents: args.path.includes('CaseDialogs') ? 'export const caseError=e=>e.message; export const useOperationId=()=>()=>"ui-operation"; export function CaseFormError(){return null;} export function CaseDialog(){return null;}' : args.path.includes('CaseFeedbackDialog') ? 'export function CaseFeedbackDialog(){return null;}' : args.path.includes('CaseIssueTreeSidebar') ? 'export function CaseIssueTreeSidebar(){return null;}' : 'export function BusinessRoleConversation(){return null;}' }));
  } }] })).outputFiles[0].text;
  const sandbox: Record<string, any> = { fetch: fetcher, structuredClone, crypto, Response, Request, Headers, URL, URLSearchParams, setTimeout, clearTimeout };
  runInNewContext(bundle, sandbox, { filename: 'case-request-response-ui-test.iife.js' });
  const cleanups: (() => void)[] = [];
  function mount(Component: (props: any) => Element, props: Record<string, any>) {
    const values: any[] = [], dependencies: any[][] = [], cleanup: (() => void)[] = [], effects: (() => void)[] = [];
    let cursor = 0, tree: Element;
    const hooks = {
      state(initial: any) { const i = cursor++; if (!(i in values)) values[i] = typeof initial === 'function' ? initial() : initial; return [values[i], (v: any) => { values[i] = typeof v === 'function' ? v(values[i]) : v; }]; },
      ref(initial: any) { const i = cursor++; return values[i] ??= { current: initial }; },
      memo(fn: () => any, deps: any[]) { const i = cursor++; if (!dependencies[i] || deps.some((v, n) => v !== dependencies[i][n])) { dependencies[i] = deps; values[i] = fn(); } return values[i]; },
      id() { return `request-ui-${cursor++}`; },
      effect(fn: () => any, deps: any[]) { const i = cursor++; if (!dependencies[i] || deps.some((v, n) => v !== dependencies[i][n])) { dependencies[i] = deps; effects.push(() => { cleanup[i]?.(); cleanup[i] = fn(); }); } },
    };
    const render = () => { cursor = 0; sandbox.__requestResponseHooks = hooks; tree = Component(props); while (effects.length) effects.shift()!(); };
    const settle = async () => { for (let i = 0; i < 5; i++) { await new Promise(resolve => setImmediate(resolve)); render(); } };
    const find = (type: string, label: string) => nodes(tree).find(n => n.type === type && text(n).includes(label));
    cleanups.push(() => { for (const fn of cleanup) fn?.(); });
    render();
    return { props, render, settle, nodes: () => nodes(tree), find };
  }
  return { ...sandbox.RequestResponseUiTest, mount, close() { for (const fn of cleanups) fn(); } };
}

const record = { id: 'case-1', revision: 1, status: 'pending' };
const reference = (recordId: string, revision: number) => ({ type: 'case-decision', caseStoreId: 'store-1', caseId: record.id, recordId, revision });
const plan = (issueId: string, recordId: string, revision: number, title: string) => ({ kind: 'strategy', caseStoreId: 'store-1', caseId: record.id, issueId, recordId, revision, lifecycle: 'active', payload: { title }, references: [], createdAt: 'now' });
const planA1 = plan('issue-A', 'plan-A', 1, '准确方案A原版'), planA2 = plan('issue-A', 'plan-A', 2, '准确方案A新版'), planB1 = plan('issue-B', 'plan-B', 1, '准确方案B');
const request = (issueId: string, requestId: string, recordId: string) => ({ caseId: record.id, issueId, requestId, revision: 1, status: 'open', lifecycle: 'open', text: `请求 ${issueId}`, assignee: { label: '负责人' }, target: { kind: 'choose', strategyRef: reference(recordId, 1), expectedPreviousChoiceId: null } });
const requestA = request('issue-A', 'request-A', 'plan-A'), requestB = request('issue-B', 'request-B', 'plan-B');
function server(options: { denyHistorical?: 401 | 403; historicalArchived?: boolean; misboundHistorical?: boolean; choiceLostAck?: boolean; draftReadUnavailable?: boolean } = {}) {
  const choices: any[] = [], exactReads: string[] = []; const drafts = new Map<string, any>();
  const fetcher: typeof fetch = async (input, init) => {
    const url = String(input);
    if (url.includes('/drafts/issue-draft/')) { if (options.draftReadUnavailable && init?.method !== 'PUT') return Response.json({code:'draft_unavailable'},{status:503}); if (init?.method === 'PUT') { const value=JSON.parse(String(init.body)); const existing=drafts.get(url); if ((existing?.revision??0)!==value.expectedRevision) return Response.json({code:'draft_revision_conflict'},{status:409}); const draft={kind:'issue-draft',id:decodeURIComponent(url.split('/').at(-1)!),revision:value.expectedRevision+1,payload:value.payload}; drafts.set(url,draft);return Response.json({draft}); } return drafts.has(url) ? Response.json({draft:drafts.get(url)}) : Response.json({code:'not_found'},{status:404}); }
    if (url.endsWith('/plan-A/revisions/1')) { exactReads.push(url); return options.denyHistorical ? Response.json({ code: 'forbidden' }, { status: options.denyHistorical }) : Response.json({ revision: options.misboundHistorical ? { ...planA1, caseId: 'other-case' } : planA1, current: { revision: 2, lifecycle: options.historicalArchived ? 'archived' : 'active' } }); }
    if (url.endsWith('/choice') && init?.method === 'POST') { choices.push(JSON.parse(String(init.body))); return options.choiceLostAck ? Response.json({code:'unknown'},{status:503}) : Response.json({ choice: {} }); }
    if (url.endsWith('/decisions/requests')) return Response.json({ requests: [requestA, requestB] });
    if (url.endsWith('/drafts/carry-over')) return Response.json({ drafts: [] });
    if (url.endsWith('/decisions/issues')) return Response.json({ issues: [{ id: 'issue-A', caseId: record.id, title: '事项 A' }, { id: 'issue-B', caseId: record.id, title: '事项 B' }] });
    const timeline = url.match(/\/issues\/(issue-[AB])$/);
    if (timeline) return Response.json({ issue: { id: timeline[1], caseId: record.id, title: timeline[1] }, rounds: choices.filter(value=>value.issueId===timeline[1]).map(value=>({choice:{...value,caseId:record.id,choiceId:'saved-choice',occurredAt:'now',previousChoiceId:value.expectedPreviousChoiceId},strategy:value.issueId==='issue-A'?planA1:planB1,actions:[],review:null})) });
    if (url.endsWith('/sources')) return Response.json({ replies: [], limitations: [] });
    if (url.includes('/decisions?')) return Response.json({ items: [planA2, planB1], continuation: null });
    return Response.json({ code: 'not_found' }, { status: 404 });
  };
  return { fetcher, choices, exactReads };
}
const baseProps = () => ({ actionFocus: {kind:'choice',seq:1}, record, projects: [], onChange() {}, onCreate() {}, openRequests: [requestA, requestB] });
function selectIn(ui: any, label: string, value: string) {
  const field = ui.find('label', label);
  const control = nodes(field).find(n => n.type === 'select') ?? ui.nodes().find((n: Element) => n.type === 'select' && n.props.id === field?.props.htmlFor); assert.ok(control, `${label} select exists`);
  control.props.onChange({ target: { value } }); ui.render();
}
function reasonIn(ui: any, value: string) {
  const control = nodes(ui.find('label', '依据与理由')).find(n => n.type === 'textarea'); assert.ok(control);
  control.props.onChange({ target: { value } }); ui.render();
}


test('independent DW13: reopening explicit historical-request editor preserves consciously selected current plan and original response association',async()=>{
  const api=server(); const firstPage=await harness(api.fetcher);
  const entry={...baseProps(),issueId:'issue-A',initialRequest:{requestId:requestA.requestId,revision:1,issueId:'issue-A'}};
  try{
    const first=firstPage.mount(firstPage.__IssueWorkForTest,entry);await first.settle();selectIn(first,'准确方案','plan-A@2');reasonIn(first,'明确改选当前版，取消后应保留');
    await first.find('button','取消 · 保留输入')!.props.onClick();first.render();assert.equal(api.choices.length,0);
  }finally{firstPage.close();}
  const reopenedPage=await harness(api.fetcher);
  try{
    const reopened=reopenedPage.mount(reopenedPage.__IssueWorkForTest,{...entry,entrySeq:2});await reopened.settle();
    assert.equal(nodes(reopened.find('label','依据与理由')).find(n=>n.type==='textarea')?.props.value,'明确改选当前版，取消后应保留');
    assert.equal(nodes(reopened.find('label','准确方案')).find(n=>n.type==='select')?.props.value,'plan-A@2','Saved explicit plan selection must survive reopen; the old requested default cannot silently replace it');
    assert.equal(api.choices.length,0);
  }finally{reopenedPage.close();}
});
