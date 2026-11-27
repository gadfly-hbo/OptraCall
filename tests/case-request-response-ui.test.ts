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
    plugin.onLoad({ filter: /.*/, namespace: 'request-hooks' }, args => ({ contents: args.path.endsWith('jsx-runtime') ? 'export const jsx=(type,props)=>({type,props}); export const jsxs=jsx; export const Fragment="fragment";' : 'export const useState=v=>globalThis.__requestResponseHooks.state(v); export const useRef=v=>globalThis.__requestResponseHooks.ref(v); export const useEffect=(f,d)=>globalThis.__requestResponseHooks.effect(f,d); export const useId=()=>globalThis.__requestResponseHooks.id();' }));
    // Export the original private component for an isolated renderer; its body is unchanged.
    plugin.onLoad({ filter: /\/CaseIssuePanel\.tsx$/ }, async args => ({ contents: `${await readFile(args.path, 'utf8')}\nexport { IssueWork as __IssueWorkForTest };`, loader: 'tsx' }));
    plugin.onResolve({ filter: /(?:BusinessRoleConversation|CaseIssueTreeSidebar|CaseDialogs)\.tsx$/ }, args => ({ path: args.path, namespace: 'request-ui-components' }));
    plugin.onLoad({ filter: /.*/, namespace: 'request-ui-components' }, args => ({ contents: args.path.includes('CaseDialogs') ? 'export const caseError=e=>e.message; export const useOperationId=()=>()=>"ui-operation"; export function CaseFormError(){return null;}' : args.path.includes('CaseIssueTreeSidebar') ? 'export function CaseIssueTreeSidebar(){return null;}' : 'export function BusinessRoleConversation(){return null;}' }));
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
function server(options: { denyHistorical?: 401 | 403; historicalArchived?: boolean; misboundHistorical?: boolean } = {}) {
  const choices: any[] = [], exactReads: string[] = [];
  const fetcher: typeof fetch = async (input, init) => {
    const url = String(input);
    if (url.endsWith('/plan-A/revisions/1')) { exactReads.push(url); return options.denyHistorical ? Response.json({ code: 'forbidden' }, { status: options.denyHistorical }) : Response.json({ revision: options.misboundHistorical ? { ...planA1, caseId: 'other-case' } : planA1, current: { revision: 2, lifecycle: options.historicalArchived ? 'archived' : 'active' } }); }
    if (url.endsWith('/choice') && init?.method === 'POST') { choices.push(JSON.parse(String(init.body))); return Response.json({ choice: {} }); }
    if (url.endsWith('/decisions/requests')) return Response.json({ requests: [requestA, requestB] });
    if (url.endsWith('/drafts/carry-over')) return Response.json({ drafts: [] });
    if (url.endsWith('/decisions/issues')) return Response.json({ issues: [{ id: 'issue-A', caseId: record.id, title: '事项 A' }, { id: 'issue-B', caseId: record.id, title: '事项 B' }] });
    const timeline = url.match(/\/issues\/(issue-[AB])$/);
    if (timeline) return Response.json({ issue: { id: timeline[1], title: timeline[1] }, rounds: [] });
    if (url.endsWith('/sources')) return Response.json({ replies: [], limitations: [] });
    if (url.includes('/decisions?')) return Response.json({ items: [planA2, planB1], continuation: null });
    return Response.json({ code: 'not_found' }, { status: 404 });
  };
  return { fetcher, choices, exactReads };
}
const baseProps = () => ({ record, projects: [], onChange() {}, onCreate() {}, openRequests: [requestA, requestB] });
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
    assert.equal(ui.find('button', '确认取舍')?.props.disabled, true, 'A historical version requires explicit confirmation');
    assert.equal(api.choices.length, 0);
    const confirmation = ui.nodes().find((n: Element) => n.type === 'input' && n.props.type === 'checkbox');
    assert.ok(confirmation, 'The original historical selection has an explicit confirmation');
    confirmation.props.onChange({ target: { checked: true } }); ui.render();
    assert.equal(ui.find('button', '确认取舍')?.props.disabled, false);
    selectIn(ui, '准确方案', 'plan-A@2');
    assert.equal(ui.find('button', '确认取舍')?.props.disabled, false, 'The current version keeps the normal path');
    selectIn(ui, '准确方案', 'plan-A@1');
    assert.equal(ui.find('button', '确认取舍')?.props.disabled, true, 'Changing the selected revision resets historical confirmation');
    const recheck = ui.nodes().find((n: Element) => n.type === 'input' && n.props.type === 'checkbox'); assert.ok(recheck);
    recheck.props.onChange({ target: { checked: true } }); ui.render();
    ui.find('button', '确认取舍')!.props.onClick(); await ui.settle();
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
    selectIn(panel, '当前事项', 'issue-B'); await panel.settle();
    const work = panel.nodes().find((n: Element) => typeof n.type === 'function' && n.type.name === 'IssueWork'); assert.ok(work);
    assert.equal(work.props.issueId, 'issue-B');
    const ui = h.mount(h.__IssueWorkForTest, work.props); await ui.settle();
    const target = ui.nodes().find((n: Element) => n.type === 'option' && text(n) === '准确方案B v1'); assert.ok(target);
    selectIn(ui, '准确方案', target.props.value); reasonIn(ui, '明确回应 B 的唯一原请求');
    assert.equal(ui.find('button', '确认取舍')?.props.disabled, false);
    ui.find('button', '确认取舍')!.props.onClick(); await ui.settle();
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
    assert.equal(ui.find('button', '确认取舍')?.props.disabled, true);
    assert.equal(api.choices.length, 0);
  } finally { h.close(); }
});

test('DW09: current-version choices retain the normal one-request path without historical opt-in', async () => {
  const api = server(); const h = await harness(api.fetcher);
  try {
    const ui = h.mount(h.__IssueWorkForTest, { ...baseProps(), issueId: 'issue-B' }); await ui.settle();
    const target = ui.nodes().find((n: Element) => n.type === 'option' && text(n) === '准确方案B v1'); assert.ok(target);
    selectIn(ui, '准确方案', target.props.value); reasonIn(ui, '当前方案直接回应');
    assert.equal(ui.find('button', '确认取舍')?.props.disabled, false);
    ui.find('button', '确认取舍')!.props.onClick(); await ui.settle();
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
      assert.equal(ui.find('button', '确认取舍')?.props.disabled, true);
      assert.equal(api.choices.length, 0);
      assert.equal(nodes(ui.find('label', '依据与理由')).find(n => n.type === 'textarea')?.props.value, '来源待核时保留用户理由');
    } finally { h.close(); }
  }
});
