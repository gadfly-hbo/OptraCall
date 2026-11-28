import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { build } from 'esbuild';
import { runInNewContext } from 'node:vm';

type Element = { type: string | ((props: any) => any); props: Record<string, any> };
const nodes = (value: any): Element[] => !value || typeof value !== 'object' ? [] : Array.isArray(value) ? value.flatMap(nodes) : [value, ...nodes(value.props?.children)];
const text = (value: any): string => value == null || value === false ? '' : typeof value === 'string' || typeof value === 'number' ? String(value) : Array.isArray(value) ? value.map(text).join('') : text(value.props?.children);
const plain = <T>(value: T): T => JSON.parse(JSON.stringify(value));
let bundle: string | undefined;
async function harness(fetcher: typeof fetch) {
  bundle ??= (await build({ entryPoints: ['src/host/ui/CaseFeedbackDialog.tsx'], bundle: true, write: false, loader: {'.css':'empty'}, platform: 'browser', format: 'iife', globalName: 'CaseFeedbackUi', plugins: [{ name: 'case-feedback-ui-fixture', setup(plugin) {
    plugin.onResolve({ filter: /^react(?:\/jsx-runtime)?$/ }, args => ({ path: args.path, namespace: 'feedback-hooks' }));
    plugin.onLoad({ filter: /.*/, namespace: 'feedback-hooks' }, args => ({ contents: args.path.endsWith('jsx-runtime') ? 'export const jsx=(type,props)=>({type,props}); export const jsxs=jsx; export const Fragment="fragment";' : 'export const useId=()=>globalThis.hooks.id(); export const useState=v=>globalThis.hooks.state(v); export const useRef=v=>globalThis.hooks.ref(v); export const useEffect=(f,d)=>globalThis.hooks.effect(f,d); export const useMemo=(f,d)=>globalThis.hooks.memo(f,d); export const useCallback=(f,d)=>globalThis.hooks.memo(()=>f,d);' }));
    plugin.onLoad({ filter: /\/CaseFeedbackDialog\.tsx$/ }, async args => ({ contents: `${await readFile(args.path, 'utf8')}\nexport { CaseFeedbackForm as __CaseFeedbackFormForTest };`, loader: 'tsx' }));
    plugin.onResolve({ filter: /(?:CaseDialogs)\.tsx$/ }, args => ({ path: args.path, namespace: 'feedback-ui-components' }));
    plugin.onLoad({ filter: /.*/, namespace: 'feedback-ui-components' }, args => ({ contents: args.path.includes('CaseDialogs') ? 'export function CaseDialog(){return null;} export function CaseFormError(){return null;} export const caseError=e=>e.message;' : `
      export function FeedbackDialog(){return null;}
      export const feedbackDraft=task=>({executed:task.feedback?(task.feedback.adopted?'yes':'no'):'unknown',outcome:task.feedback?.outcome??'',metricDelta:task.feedback?.metricDelta??'',review:task.feedback?.review??'',score:task.feedback?.score==null?'':String(task.feedback.score),effect:task.feedback?.effect??'unknown',expectedLatestRevisionId:task.feedback?.revisionId??null,operationId:crypto.randomUUID()});
    ` }));
  } }] })).outputFiles[0].text;
  const sandbox: Record<string, any> = { fetch: fetcher, structuredClone, crypto, Response, Request, Headers, URL, URLSearchParams, setTimeout, clearTimeout };
  runInNewContext(bundle, sandbox);
  const cleanups = new Set<() => void>();
  function mount(Component: (props: any) => Element, props: Record<string, any>) {
    const values: any[] = [], dependencies: any[][] = [], cleanup: (() => void)[] = [], effects: (() => void)[] = [];
    let cursor = 0, tree: Element, closed = false;
    const changed = (i: number, next: any[]) => !dependencies[i] || next.some((v, n) => v !== dependencies[i][n]);
    const hooks = { id() { return `field-${cursor++}`; },
      state(initial: any) { const i = cursor++; if (!(i in values)) values[i] = typeof initial === 'function' ? initial() : initial; return [values[i], (value: any) => { values[i] = typeof value === 'function' ? value(values[i]) : value; }]; },
      ref(initial: any) { const i = cursor++; return values[i] ??= { current: initial }; },
      memo(fn: () => any, deps: any[]) { const i = cursor++; if (changed(i, deps)) { dependencies[i] = deps; values[i] = fn(); } return values[i]; },
      effect(fn: () => any, deps: any[]) { const i = cursor++; if (changed(i, deps)) { dependencies[i] = deps; effects.push(() => { cleanup[i]?.(); cleanup[i] = fn(); }); } },
    };
    const render = () => { if (closed) return; cursor = 0; sandbox.hooks = hooks; tree = Component(props); while (effects.length) effects.shift()!(); };
    const settle = async () => { for (let i = 0; i < 8; i++) { await new Promise(resolve => setImmediate(resolve)); render(); } };
    const component = (name: string) => nodes(tree).find(node => typeof node.type === 'function' && node.type.name === name);
    const close = () => { if (closed) return; closed = true; for (const fn of cleanup) fn?.(); cleanups.delete(close); };
    cleanups.add(close); render();
    return { props, render, settle, close, component, nodes: () => nodes(tree), text: () => text(tree), button: (label: string) => nodes(tree).find(node => node.type === 'button' && text(node).includes(label)) };
  }
  return { ...sandbox.CaseFeedbackUi, mount, close() { for (const close of [...cleanups]) close(); } };
}

const record = { id: 'case-A', revision: 1, status: 'pending' };
const project = (id = 'project-A', archivedAt: string | null = null) => ({ id, name: id, archivedAt });
const action = (id = 'action-A', overrides: Record<string, any> = {}) => ({ projectId: 'project-A', itemId: `item-${id}`, taskId: id, currentAuthorizationId: `auth-${id}`, title: id, ...overrides });
const task = (id = 'action-A') => ({ id, itemId: `item-${id}`, title: id, feedback: null });
const request = (id = 'action-A', overrides: Record<string, any> = {}) => ({ kind: 'observe', caseId: record.id, issueId: 'issue-A', requestId: `request-${id}`, revision: 3, status: 'open', lifecycle: 'open', source: {kind:'user-declaration',ref:'synthetic original request'}, requestedAt: '2026-01-01T00:00:00Z', text: `补充 ${id} 观察`, assignee: { label: '原承担人' }, target: { kind: 'observe', projectId: 'project-A', itemId: `item-${id}`, taskId: id, authorizationId: `auth-${id}`, feedbackBaseRevisionId: null }, ...overrides });
const timeline = (actions: any[] = [action()]) => ({ issue: { id: 'issue-A', caseId: record.id }, rounds: [{ choice: { choiceId: 'choice-A' }, actions }] });
const board = (ids: string[] = ['action-A']) => ({ projects: [project()], items: ids.map(id => ({ id: `item-${id}`, projectId: 'project-A', tasks: [task(id)] })) });
const candidate = (id = 'action-A') => ({ item: board([id]).items[0], task: task(id), authorizationId: `auth-${id}`, roundNumber: 1, request: request(id) });
function fixture() {
  const state: any = { timeline: timeline(), board: board(), feedbackStatus: 503, operationFeedback: null, delayedTimeline: null, draftReadStatus: 0 };
  const drafts = new Map<string, any>(), businessPosts: any[] = [], queries: string[] = [], reads: string[] = [];
  const fetcher: typeof fetch = async (input, init) => {
    const url = String(input); reads.push(url);
    const draftMatch = /\/api\/workspace\/drafts\/issue-draft\/([^/]+)$/.exec(url);
    if (draftMatch) {
      const id = decodeURIComponent(draftMatch[1]!);
      if(state.draftReadStatus && init?.method !== 'PUT') return Response.json({code:'unavailable'},{status:state.draftReadStatus});
      if (init?.method === 'PUT') {
        const incoming = JSON.parse(String(init.body)), current = drafts.get(id);
        if (incoming.expectedRevision !== (current?.revision ?? 0)) return Response.json({ code: 'draft_revision_conflict' }, { status: 409 });
        const saved = { kind: 'issue-draft', id, revision: (current?.revision ?? 0) + 1, payload: incoming.payload, createdAt: '', updatedAt: '' };
        drafts.set(id, saved); return Response.json({ draft: saved });
      }
      return drafts.has(id) ? Response.json({ draft: drafts.get(id) }) : Response.json({ code: 'draft_not_found' }, { status: 404 });
    }
    if (url.endsWith('/issues/issue-A')) { if (state.delayedTimeline) await state.delayedTimeline; return Response.json(state.timeline); }
    if (url === '/api/decision-board') return Response.json(state.board);
    const feedback = /\/api\/decision-board\/tasks\/([^/]+)\/feedback$/.exec(url);
    if (feedback && init?.method === 'POST') {
      const body = JSON.parse(String(init.body)); businessPosts.push({ taskId: decodeURIComponent(feedback[1]!), body });
      return state.feedbackStatus >= 400 ? Response.json({ code: 'board_request_failed' }, { status: state.feedbackStatus }) : Response.json({ feedback: state.operationFeedback });
    }
    const operation = /\/api\/decision-board\/feedback\/operations\/([^/]+)$/.exec(url);
    if (operation) { queries.push(decodeURIComponent(operation[1]!)); return Response.json({ feedback: state.operationFeedback }); }
    return Response.json({ code: 'not_found' }, { status: 404 });
  };
  return { state, drafts, businessPosts, queries, reads, fetcher };
}
const props = () => ({ record, issueId: 'issue-A', projects: [project()], requests: [request()], onClose() {}, onSaved() {}, onBoard() {} });
const savedFeedback = (operationId: string) => ({ taskId: 'action-A', revisionId: 'feedback-v1', revisionNumber: 1, operationId, adopted: true, outcome: '真实观察', metricDelta: '2%', review: '仍待核对', effect: 'unknown', score: null });
function editForm(ui: any, patch: Record<string, unknown>) {
  const form = ui.component('FeedbackDialog'); assert.ok(form, 'Original FeedbackDialog remains the actual editing component');
  form.props.onChange({ ...form.props.draft, ...patch }); ui.render();
}
function inputFor(ui: any) {
  const form = ui.component('FeedbackDialog').props.draft;
  return { operationId: form.operationId, expectedLatestRevisionId: form.expectedLatestRevisionId, adopted: form.executed === 'yes', outcome: form.outcome, metricDelta: form.metricDelta, review: form.review, score: null, effect: form.effect, respondsToRequest: { requestId: 'request-action-A', revision: 3, authorizationId: 'auth-action-A' } };
}


// This harness renders the actual original FeedbackDialog as a second component.
// Only the shared frame and React scheduling are isolated; original form/business clients remain actual source.
test('independent D14 legacy input: reopened pre-date UNKNOWN and long observation query then retry exact old intent',async()=>{
  const api=fixture();const op='legacy-original-operation';const original=request();
  const form={executed:'yes',outcome:'原'.repeat(1400),metricDelta:'保留2%',review:'保留原判断',score:'4',effect:'negative',expectedLatestRevisionId:null,operationId:op,requestContext:{caseId:record.id,issueId:'issue-A',requestId:original.requestId,revision:original.revision,target:original.target}};
  const id='feedback:action-A:request-action-A:3';api.drafts.set(id,{kind:'issue-draft',id,revision:4,payload:{caseId:record.id,issueId:'issue-A',text:'',appendedFragmentIds:[],actionForm:{kind:'feedback',fields:{form,unknownOperation:op}}},createdAt:'old',updatedAt:'old'});
  const auth={authorizationId:'auth-action-A',decision:'authorize',projectId:'project-A',itemId:'item-action-A',taskId:'action-A',source:{caseId:record.id,caseStoreId:'store-A',choiceId:'choice-A',strategyRef:{caseId:record.id,caseStoreId:'store-A'}},caseConfirmation:{issueId:'issue-A'}};
  const fetcher:typeof fetch=async(input,init)=>{const url=String(input);if(url.includes('action-authorizations/history'))return Response.json({authorizations:[auth]});if(url.includes('feedback/history'))return Response.json({revisions:[]});if(url.endsWith('/decisions/requests'))return Response.json({requests:[original]});return api.fetcher(input,init);};
  const h=await harness(fetcher);
  try{
    const wrapper=h.mount(h.__CaseFeedbackFormForTest,{...props(),candidate:candidate(),request:original});await wrapper.settle();
    const selected=wrapper.component('FeedbackDialog')!;assert.ok(selected);assert.equal(selected.props.draft.outcome,form.outcome);assert.equal(selected.props.draft.operationId,op);assert.equal(Object.hasOwn(selected.props.draft,'observationDate'),false);
    const ui=h.mount(selected.type as any,selected.props);await ui.settle();
    const query=ui.button('查询原保存结果');assert.ok(query);query.props.onClick();await wrapper.settle();Object.assign(ui.props,wrapper.component('FeedbackDialog')!.props);await ui.settle();
    assert.equal(api.businessPosts.length,0);assert.deepEqual(api.queries,[op]);assert.equal(ui.props.unknownOperation,null);assert.equal(ui.props.draft.operationId,op);
    const submit=ui.nodes().find((n:Element)=>n.type==='button'&&n.props.type==='submit');assert.ok(submit);assert.equal(submit.props.disabled,false,'Legacy body can explicitly continue without entering new observationDate or trimming old text');
    ui.nodes().find((n:Element)=>n.type==='form')!.props.onSubmit({preventDefault(){}});await ui.settle();await wrapper.settle();
    assert.equal(api.businessPosts.length,1);const sent=api.businessPosts[0].body;
    assert.equal(sent.operationId,op);assert.equal(sent.adopted,true);assert.equal(sent.outcome,form.outcome);assert.equal(sent.metricDelta,form.metricDelta);assert.equal(sent.review,form.review);assert.equal(sent.score,4);assert.equal(sent.effect,'negative');assert.equal(Object.hasOwn(sent,'observationDate'),false);assert.equal(Object.hasOwn(sent,'sourceScope'),false);assert.deepEqual(sent.respondsToRequest,{requestId:original.requestId,revision:original.revision,authorizationId:'auth-action-A'});
  }finally{h.close();}
});

test('independent D14 actual compact form: unknown execution saves exact observation metadata and request once, without guessing execution',async()=>{
 const api=fixture(),original=request();
 const auth={authorizationId:'auth-action-A',decision:'authorize',projectId:'project-A',itemId:'item-action-A',taskId:'action-A',source:{caseId:record.id,caseStoreId:'store-A',choiceId:'choice-A',strategyRef:{caseId:record.id,caseStoreId:'store-A'}},caseConfirmation:{issueId:'issue-A'}};
 const fetcher:typeof fetch=async(input,init)=>{const url=String(input);if(url.includes('action-authorizations/history'))return Response.json({authorizations:[auth]});if(url.includes('feedback/history'))return Response.json({revisions:[]});if(url.endsWith('/decisions/requests'))return Response.json({requests:[original]});return api.fetcher(input,init);};
 const h=await harness(fetcher);
 try{
  const wrapper=h.mount(h.__CaseFeedbackFormForTest,{...props(),candidate:candidate(),request:original});await wrapper.settle();const selected=wrapper.component('FeedbackDialog')!;
  assert.equal(selected.props.presentation,'case');assert.equal(selected.props.draft.executed,'unknown');assert.equal(selected.props.draft.outcome,'');
  const ui=h.mount(selected.type as any,selected.props);await ui.settle();
  const sync=async()=>{await wrapper.settle();Object.assign(ui.props,wrapper.component('FeedbackDialog')!.props);await ui.settle();};
  for(const [id,value] of [['feedback-observation-date','2024-02-29'],['feedback-outcome','独立记录：出现与预期相反的观察 <script>保留为文字</script>'],['feedback-source-scope','三店现场，因果与执行情况仍未知']]){const control=ui.nodes().find((n:Element)=>n.props?.id===id)!;assert.ok(control);control.props.onChange({target:{value}});await sync();}
  const operation=ui.props.draft.operationId;const save=ui.nodes().find((n:Element)=>n.type==='button'&&n.props.type==='submit')!;assert.equal(save.props.disabled,false);
  const form=ui.nodes().find((n:Element)=>n.type==='form')!;form.props.onSubmit({preventDefault(){}});form.props.onSubmit({preventDefault(){}});await ui.settle();await sync();
  assert.equal(api.businessPosts.length,1);const sent=api.businessPosts[0].body;assert.equal(sent.adopted,null);assert.equal(sent.observationDate,'2024-02-29');assert.equal(sent.sourceScope,'三店现场，因果与执行情况仍未知');assert.equal(sent.operationId,operation);assert.equal(sent.effect,'unknown');assert.equal(sent.score,null);assert.equal(sent.expectedLatestRevisionId,null);assert.deepEqual(sent.respondsToRequest,{requestId:original.requestId,revision:3,authorizationId:'auth-action-A'});
  assert.equal(wrapper.component('FeedbackDialog')!.props.unknownOperation,operation);assert.equal(wrapper.component('FeedbackDialog')!.props.draft.observationDate,'2024-02-29');assert.equal(wrapper.component('FeedbackDialog')!.props.draft.sourceScope,sent.sourceScope);
 }finally{h.close();}
});
