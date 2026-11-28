import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { build } from 'esbuild';
import { runInNewContext } from 'node:vm';

type Element = { type: string | ((props: any) => any); props: Record<string, any> };
const nodes = (node: any): Element[] => !node || typeof node !== 'object' ? [] : Array.isArray(node) ? node.flatMap(nodes) : [node, ...nodes(node.props?.children)];
const text = (node: any): string => node == null || node === false ? '' : typeof node === 'string' || typeof node === 'number' ? String(node) : Array.isArray(node) ? node.map(text).join('') : text(node.props?.children);
let bundle: string | undefined;
async function harness(fetcher: typeof fetch, documentFixture?: { getElementById(id:string): { focus(options?:unknown):void } | null }) {
  bundle ??= (await build({ entryPoints: ['src/host/ui/CaseIssuePanel.tsx'], bundle: true, write: false, platform: 'browser', format: 'iife', globalName: 'RequestResponseUiTest', plugins: [{ name: 'request-response-ui-fixture', setup(plugin) {
    plugin.onResolve({ filter: /^react(?:\/jsx-runtime)?$/ }, args => ({ path: args.path, namespace: 'request-hooks' }));
    plugin.onLoad({ filter: /.*/, namespace: 'request-hooks' }, args => ({ contents: args.path.endsWith('jsx-runtime') ? 'export const jsx=(type,props)=>({type,props}); export const jsxs=jsx; export const Fragment="fragment";' : 'export const useState=v=>globalThis.__requestResponseHooks.state(v); export const useRef=v=>globalThis.__requestResponseHooks.ref(v); export const useEffect=(f,d)=>globalThis.__requestResponseHooks.effect(f,d); export const useId=()=>globalThis.__requestResponseHooks.id(); export const useMemo=(f,d)=>globalThis.__requestResponseHooks.memo(f,d); export const useCallback=(f,d)=>globalThis.__requestResponseHooks.memo(()=>f,d);' }));
    // Export the original private component for an isolated renderer; its body is unchanged.
    plugin.onLoad({ filter: /\/CaseIssuePanel\.tsx$/ }, async args => ({ contents: `${await readFile(args.path, 'utf8')}\nexport { IssueWork as __IssueWorkForTest };`, loader: 'tsx' }));
    plugin.onResolve({ filter: /(?:BusinessRoleConversation|CaseIssueTreeSidebar|CaseDialogs|CaseFeedbackDialog)\.tsx$/ }, args => ({ path: args.path, namespace: 'request-ui-components' }));
    plugin.onLoad({ filter: /.*/, namespace: 'request-ui-components' }, args => ({ contents: args.path.includes('CaseDialogs') ? 'export const caseError=e=>e.message; export const useOperationId=()=>()=>"ui-operation"; export function CaseFormError(){return null;} export function CaseDialog(){return null;}' : args.path.includes('CaseFeedbackDialog') ? 'export function CaseFeedbackDialog(){return null;}' : args.path.includes('CaseIssueTreeSidebar') ? 'export function CaseIssueTreeSidebar(){return null;}' : 'export function BusinessRoleConversation(){return null;}' }));
  } }] })).outputFiles[0].text;
  const sandbox: Record<string, any> = { ...(documentFixture ? {document:documentFixture} : {}), fetch: fetcher, structuredClone, crypto, Response, Request, Headers, URL, URLSearchParams, setTimeout, clearTimeout };
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

test('DW09/FUI-02: a selected open historical request loads its exact strategy revision and requires explicit historical confirmation', async () => {
  const api = server(); const h = await harness(api.fetcher);
  try {
    const ui = h.mount(h.__IssueWorkForTest, { ...baseProps(), issueId: 'issue-A', initialIssueId: 'issue-A', initialRequest: { requestId: requestA.requestId, revision: 1, issueId: 'issue-A' } });
    await ui.settle();
    assert.ok(api.exactReads.length > 0, 'The open request must read its exact original revision independently of the current heads');
    const options = ui.nodes().filter((n: Element) => n.type === 'option');
    assert.ok(options.some((n: Element) => n.props.value === 'plan-A@1' && text(n).includes('v1')), 'Historical v1 is selectable with an exact identity');
    assert.ok(options.some((n: Element) => n.props.value === 'plan-A@2' && text(n).includes('v2')), 'Current v2 remains a separate option');
    selectIn(ui, '准确方案', 'plan-A@1'); reasonIn(ui, '明确回应原历史方案');
    assert.equal(ui.find('button', '保存取舍')?.props.disabled, true, 'A historical version requires explicit confirmation');
    assert.equal(api.choices.length, 0);
    const confirmation = ui.nodes().find((n: Element) => n.type === 'input' && n.props.type === 'checkbox');
    assert.ok(confirmation, 'The original historical selection has an explicit confirmation');
    confirmation.props.onChange({ target: { checked: true } }); ui.render();
    assert.equal(ui.find('button', '保存取舍')?.props.disabled, false);
    selectIn(ui, '准确方案', 'plan-A@2');
    assert.equal(ui.find('button', '保存取舍')?.props.disabled, false, 'The current version keeps the normal path');
    selectIn(ui, '准确方案', 'plan-A@1');
    assert.equal(ui.find('button', '保存取舍')?.props.disabled, true, 'Changing the selected revision resets historical confirmation');
    const recheck = ui.nodes().find((n: Element) => n.type === 'input' && n.props.type === 'checkbox'); assert.ok(recheck);
    recheck.props.onChange({ target: { checked: true } }); ui.render();
    ui.find('button', '保存取舍')!.props.onClick(); await ui.settle();
    assert.equal(api.choices.length, 1);
    assert.equal(api.choices[0].allowHistorical, true);
    assert.deepEqual(api.choices[0].strategyRef, reference('plan-A', 1));
    assert.deepEqual(api.choices[0].respondsToRequest, { requestId: requestA.requestId, revision: 1 });
  } finally { h.close(); }
});

test('DW09/FUI-03: explicitly switching from request A to issue B restores B single-request matching', async () => {
  const api = server(); const h = await harness(api.fetcher);
  try {
    const panel = h.mount(h.CaseIssuePanel, { ...baseProps(), initialIssueId: 'issue-A', initialRequest: { requestId: requestA.requestId, revision: 1, issueId: 'issue-A' } });
    await panel.settle();
    const sidebar = panel.nodes().find((n: Element) => typeof n.type === 'function' && n.type.name === 'CaseIssueTreeSidebar');
    assert.ok(sidebar, 'The confirmed issue sidebar is the current-issue navigation');
    sidebar.props.onSelectIssue('issue-B'); await panel.settle();
    const work = panel.nodes().find((n: Element) => typeof n.type === 'function' && n.type.name === 'IssueWork'); assert.ok(work);
    assert.equal(work.props.issueId, 'issue-B');
    const ui = h.mount(h.__IssueWorkForTest, work.props); await ui.settle();
    const target = ui.nodes().find((n: Element) => n.type === 'option' && text(n) === '准确方案B v1'); assert.ok(target);
    selectIn(ui, '准确方案', target.props.value); reasonIn(ui, '明确回应 B 的唯一原请求');
    assert.equal(ui.find('button', '保存取舍')?.props.disabled, false);
    ui.find('button', '保存取舍')!.props.onClick(); await ui.settle();
    assert.equal(api.choices.length, 1);
    assert.deepEqual(api.choices[0].strategyRef, reference('plan-B', 1));
    assert.deepEqual(api.choices[0].respondsToRequest, { requestId: requestB.requestId, revision: 1 });
    assert.ok(api.choices[0].respondsToRequest.requestId !== requestA.requestId);
  } finally { h.close(); }
});

test('DW09/FUI-02: denied exact historical read never silently substitutes the latest version for the original request', async () => {
  const api = server({ denyHistorical: 403 }); const h = await harness(api.fetcher);
  try {
    const ui = h.mount(h.__IssueWorkForTest, { ...baseProps(), issueId: 'issue-A', initialIssueId: 'issue-A', initialRequest: { requestId: requestA.requestId, revision: 1, issueId: 'issue-A' } });
    await ui.settle();
    assert.ok(api.exactReads.length > 0, 'The original historical reference must be checked before it can be selected');
    assert.ok(!ui.nodes().some((n: Element) => n.type === 'option' && n.props.value === 'plan-A@1'));
    reasonIn(ui, '保留理由但不替换来源');
    assert.equal(ui.find('button', '保存取舍')?.props.disabled, true);
    assert.equal(api.choices.length, 0);
  } finally { h.close(); }
});

test('DW09: current-version choices retain the normal one-request path without historical opt-in', async () => {
  const api = server(); const h = await harness(api.fetcher);
  try {
    const ui = h.mount(h.__IssueWorkForTest, { ...baseProps(), issueId: 'issue-B' }); await ui.settle();
    const target = ui.nodes().find((n: Element) => n.type === 'option' && text(n) === '准确方案B v1'); assert.ok(target);
    selectIn(ui, '准确方案', target.props.value); reasonIn(ui, '当前方案直接回应');
    assert.equal(ui.find('button', '保存取舍')?.props.disabled, false);
    ui.find('button', '保存取舍')!.props.onClick(); await ui.settle();
    assert.equal(api.choices.length, 1); assert.ok(api.choices[0].allowHistorical !== true);
    assert.deepEqual(api.choices[0].strategyRef, reference('plan-B', 1));
    assert.deepEqual(api.choices[0].respondsToRequest, { requestId: requestB.requestId, revision: 1 });
  } finally { h.close(); }
});


test('DW09/FUI-02: unauthorized, archived or owner-mismatched original revisions cannot be used for a new choice', async () => {
  const cases = [{ denyHistorical: 401 as const }, { historicalArchived: true }, { misboundHistorical: true }];
  for (const invalid of cases) {
    const api = server(invalid); const h = await harness(api.fetcher);
    try {
      const ui = h.mount(h.__IssueWorkForTest, { ...baseProps(), issueId: 'issue-A', initialIssueId: 'issue-A', initialRequest: { requestId: requestA.requestId, revision: 1, issueId: 'issue-A' } });
      await ui.settle();
      assert.ok(api.exactReads.length > 0);
      assert.ok(!ui.nodes().some((n: Element) => n.type === 'option' && n.props.value === 'plan-A@1'), `Invalid exact revision remains unavailable: ${JSON.stringify(invalid)}`);
      reasonIn(ui, '来源待核时保留用户理由');
      assert.equal(ui.find('button', '保存取舍')?.props.disabled, true);
      assert.equal(api.choices.length, 0);
      assert.equal(nodes(ui.find('label', '依据与理由')).find(n => n.type === 'textarea')?.props.value, '来源待核时保留用户理由');
    } finally { h.close(); }
  }
});


test('D13: recording a choice opens a same-page dialog; cancellation preserves its unsaved reason', async () => {
  const api = server(); const h = await harness(api.fetcher);
  try {
    const ui = h.mount(h.__IssueWorkForTest, { ...baseProps(), issueId: 'issue-B', actionFocus: { kind: 'choice', seq: 1 } });
    await ui.settle();
    const dialog = () => ui.nodes().find((n: Element) => typeof n.type === 'function' && n.type.name === 'CaseDialog' && n.props.title === '记录本轮取舍');
    assert.ok(dialog(), 'The current-work action must open the shared modal, not scroll to inline details');
    selectIn(ui, '准确方案', 'plan-B@1'); reasonIn(ui, '取消后仍保留的原理由');
    const cancel = ui.find('button', '取消 · 保留输入'); assert.ok(cancel);
    await cancel.props.onClick(); ui.render();
    assert.equal(dialog(), undefined, 'Cancel returns to current work');
    assert.equal(api.choices.length, 0, 'Cancel never adopts a choice');
    ui.props.actionFocus = { kind: 'choice', seq: 2 }; await ui.settle();
    assert.ok(dialog());
    assert.equal(nodes(ui.find('label', '依据与理由')).find(n => n.type === 'textarea')?.props.value, '取消后仍保留的原理由');
  } finally { h.close(); }
});


test('D13/DW13: an untouched editor can cancel after draft GET 503 while business save stays disabled', async () => {
  const api=server({draftReadUnavailable:true}), h=await harness(api.fetcher);
  try {
    const ui=h.mount(h.__IssueWorkForTest,{...baseProps(),issueId:'issue-B'}); await ui.settle();
    assert.ok(ui.nodes().some((n:Element)=>typeof n.type==='function'&&n.type.name==='CaseDialog'));
    assert.equal(ui.find('button','保存取舍')?.props.disabled,true);
    await ui.find('button','取消 · 保留输入')!.props.onClick(); ui.render();
    assert.ok(!ui.nodes().some((n:Element)=>typeof n.type==='function'&&n.type.name==='CaseDialog'));
    assert.equal(api.choices.length,0);
  } finally { h.close(); }
});

test('D13/DW09: a cancelled choice reopens for a fresh entry sequence without replacing the original draft', async () => {
  const api=server(),h=await harness(api.fetcher);
  try {
    const ui=h.mount(h.__IssueWorkForTest,{...baseProps(),actionFocus:undefined,issueId:'issue-B',initialRequest:{requestId:requestB.requestId,revision:1,issueId:'issue-B'},entrySeq:1}); await ui.settle();
    reasonIn(ui,'保留取消前的理由'); await ui.find('button','取消 · 保留输入')!.props.onClick(); ui.render();
    assert.ok(!ui.nodes().some((n:Element)=>typeof n.type==='function'&&n.type.name==='CaseDialog'));
    ui.props.entrySeq=2; await ui.settle();
    assert.ok(ui.nodes().some((n:Element)=>typeof n.type==='function'&&n.type.name==='CaseDialog'));
    assert.equal(nodes(ui.find('label','依据与理由')).find(n=>n.type==='textarea')?.props.value,'保留取消前的理由');
    assert.equal(api.choices.length,0);
  } finally { h.close(); }
});

test('D13: an unknown choice keeps its exact operation and resolves through the original timeline without a second write', async () => {
  const api=server({choiceLostAck:true}),h=await harness(api.fetcher);
  try {
    const ui=h.mount(h.__IssueWorkForTest,{...baseProps(),issueId:'issue-B'}); await ui.settle();
    selectIn(ui,'准确方案','plan-B@1'); reasonIn(ui,'保留原意图');
    const next=nodes(ui.find('label','接下来（可选）')).find(n=>n.type==='input'); assert.ok(next); next.props.onChange({target:{value:'等待完整窗口'}}); ui.render();
    ui.find('button','保存取舍')!.props.onClick(); await ui.settle();
    assert.equal(api.choices.length,1); assert.equal(api.choices[0].nextStep,'等待完整窗口');
    assert.ok(ui.find('button','查询原保存结果'));
    ui.find('button','查询原保存结果')!.props.onClick(); await ui.settle();
    assert.equal(api.choices.length,1);
    assert.ok(!ui.nodes().some((n:Element)=>typeof n.type==='function'&&n.type.name==='CaseDialog'));
  } finally { h.close(); }
});

test('DW13/B2: full remount preserves an explicitly changed or cleared plan instead of reapplying the historical-request default', async () => {
  for (const selection of ['plan-A@2', '']) {
    const api = server();
    const entry = { ...baseProps(), issueId: 'issue-A', initialRequest: { requestId: requestA.requestId, revision: 1, issueId: 'issue-A' } };
    const firstPage = await harness(api.fetcher);
    try {
      const first = firstPage.mount(firstPage.__IssueWorkForTest, entry); await first.settle();
      selectIn(first, '准确方案', selection); reasonIn(first, '我已明确修改方案选择');
      await first.find('button', '取消 · 保留输入')!.props.onClick(); first.render();
    } finally { firstPage.close(); }
    const reopenedPage = await harness(api.fetcher);
    try {
      const reopened = reopenedPage.mount(reopenedPage.__IssueWorkForTest, { ...entry, entrySeq: 2 }); await reopened.settle();
      assert.equal(nodes(reopened.find('label', '准确方案')).find(n => n.type === 'select')?.props.value, selection, 'Restored user selection, including an intentional empty selection, takes precedence over the request default');
      assert.equal(nodes(reopened.find('label', '依据与理由')).find(n => n.type === 'textarea')?.props.value, '我已明确修改方案选择');
      assert.equal(api.choices.length, 0);
      if (selection) {
        reopened.find('button', '保存取舍')!.props.onClick(); await reopened.settle();
        assert.equal(api.choices[0].strategyRef.revision, 2);
        assert.equal(api.choices[0].respondsToRequest, undefined, 'Reopening cannot silently associate the old v1 request');
      } else assert.equal(reopened.find('button', '保存取舍')!.props.disabled, true);
    } finally { reopenedPage.close(); }
  }
});

test('DW13/B2: an explicitly unlinked request association stays unlinked after full remount', async () => {
  const api = server();
  const secondRequest = { ...requestA, requestId: 'another-original-request', text: '另一个明确请求' };
  const entry = { ...baseProps(), openRequests: [requestA, secondRequest], issueId: 'issue-A', initialRequest: { requestId: requestA.requestId, revision: 1, issueId: 'issue-A' } };
  const firstPage = await harness(api.fetcher);
  try {
    const first = firstPage.mount(firstPage.__IssueWorkForTest, entry); await first.settle();
    reasonIn(first, '只保存普通取舍，不回应任一请求'); selectIn(first, '回应哪一条原请求', '');
    await first.find('button', '取消 · 保留输入')!.props.onClick();
  } finally { firstPage.close(); }
  const reopenedPage = await harness(api.fetcher);
  try {
    const reopened = reopenedPage.mount(reopenedPage.__IssueWorkForTest, { ...entry, entrySeq: 2 }); await reopened.settle();
    assert.equal(nodes(reopened.find('label', '回应哪一条原请求')).find(n => n.type === 'select')?.props.value, '');
    assert.equal(nodes(reopened.find('label', '准确方案')).find(n => n.type === 'select')?.props.value, 'plan-A@1');
    const confirmation = reopened.nodes().find((node: Element) => node.type === 'input' && node.props.type === 'checkbox'); assert.ok(confirmation);
    confirmation.props.onChange({target:{checked:true}}); reopened.render();
    reopened.find('button', '保存取舍')!.props.onClick(); await reopened.settle();
    assert.equal(api.choices.length, 1); assert.equal(api.choices[0].respondsToRequest, undefined);
  } finally { reopenedPage.close(); }
});

test('DW13/B3: viewing a closed Case original request cannot initialize or autosave a new choice draft', async () => {
  const api=server(), writes:string[]=[];
  const h=await harness(async(input,init)=>{if(init?.method==='PUT'||init?.method==='POST')writes.push(String(input));return api.fetcher(input,init);});
  try {
    const ui=h.mount(h.__IssueWorkForTest,{...baseProps(),record:{...record,status:'closed'},issueId:'issue-A',initialRequest:{requestId:requestA.requestId,revision:1,issueId:'issue-A'}});
    await ui.settle();await new Promise(resolve=>setTimeout(resolve,350));await ui.settle();
    assert.deepEqual(writes,[]);assert.equal(api.choices.length,0);
  } finally {h.close();}
});

test('DW13/B3: a closed Case can restore its existing uncertain choice input without changing that draft or replaying its operation',async()=>{
  const api=server({choiceLostAck:true}),writes:string[]=[];
  const fetcher:typeof fetch=async(input,init)=>{if(init?.method==='PUT'||init?.method==='POST')writes.push(String(input));return api.fetcher(input,init);};
  const firstPage=await harness(fetcher);
  const entry={...baseProps(),issueId:'issue-B',initialRequest:{requestId:requestB.requestId,revision:1,issueId:'issue-B'}};
  try {
    const ui=firstPage.mount(firstPage.__IssueWorkForTest,entry);await ui.settle();
    reasonIn(ui,'等待核实原保存结果的输入');ui.find('button','保存取舍')!.props.onClick();await ui.settle();
    assert.ok(ui.find('button','查询原保存结果'));
  }finally{firstPage.close();}
  const count=writes.length, reopened=await harness(fetcher);
  try{
    const ui=reopened.mount(reopened.__IssueWorkForTest,{...entry,record:{...record,status:'closed'},entrySeq:2});await ui.settle();
    assert.equal(nodes(ui.find('label','依据与理由')).find(n=>n.type==='textarea')?.props.value,'等待核实原保存结果的输入');
    assert.ok(ui.find('button','查询原保存结果'));assert.equal(ui.find('button','保存取舍')?.props.disabled,true);
    await new Promise(resolve=>setTimeout(resolve,350));await ui.settle();assert.equal(writes.length,count);
  }finally{reopened.close();}
});


test('D13/D14: automatic request entry captures the current-work action as the shared dialog return focus',async()=>{
  for(const kind of ['choose','observe'] as const){
    const api=server(),focused:string[]=[];const h=await harness(api.fetcher,{getElementById:id=>({focus:()=>focused.push(id)})});
    try{
      const original=kind==='choose'?requestB:{...requestB,kind:'observe',target:{kind:'observe',projectId:'p',itemId:'i',taskId:'t',authorizationId:'a',feedbackBaseRevisionId:null}};
      const ui=h.mount(h.__IssueWorkForTest,{...baseProps(),actionFocus:undefined,actionFocusIds:{choice:'current-choice',feedback:'current-feedback'},issueId:'issue-B',initialRequest:{requestId:requestB.requestId,revision:1,issueId:'issue-B'},openRequests:[original]});
      await ui.settle();assert.deepEqual(focused,[kind==='choose'?'current-choice':'current-feedback']);
      if(kind==='observe'){const dialog=ui.nodes().find((node: Element)=>typeof node.type==='function'&&node.type.name==='CaseFeedbackDialog');assert.ok(dialog,'Home observe entry opens the Case feedback dialog');assert.deepEqual(JSON.parse(JSON.stringify(dialog.props.requested)),original);assert.equal(dialog.props.record.id,record.id);assert.equal(dialog.props.issueId,'issue-B');assert.deepEqual(dialog.props.requested.target,{kind:'observe',projectId:'p',itemId:'i',taskId:'t',authorizationId:'a',feedbackBaseRevisionId:null});assert.equal(api.choices.length,0,'Opening an observation request cannot write a choice');}
      ui.render();await ui.settle();assert.equal(focused.length,1,'Ordinary rerenders cannot steal focus from the dialog');
    }finally{h.close();}
  }
});
