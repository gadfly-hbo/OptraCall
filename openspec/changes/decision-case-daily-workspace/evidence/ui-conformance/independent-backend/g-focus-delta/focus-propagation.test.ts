import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { build } from 'esbuild';
import { runInNewContext } from 'node:vm';

type Element = { type: string | ((props: any) => any); props: Record<string, any> };
const nodes = (value: any): Element[] => !value || typeof value !== 'object' ? [] : Array.isArray(value) ? value.flatMap(nodes) : [value, ...nodes(value.props?.children)];
const text = (value: any): string => value == null || value === false ? '' : typeof value === 'string' || typeof value === 'number' ? String(value) : Array.isArray(value) ? value.map(text).join('') : text(value.props?.children);
const plain = <T>(value: T): T => JSON.parse(JSON.stringify(value));
const bundles = new Map<boolean, string>();
async function harness(fetcher: typeof fetch, realDialog = false) {
  let bundle = bundles.get(realDialog);
  bundle ??= (await build({ entryPoints: ['src/host/ui/CaseFeedbackDialog.tsx'], bundle: true, write: false, loader: { '.css': 'empty' }, platform: 'browser', format: 'iife', globalName: 'CaseFeedbackUi', plugins: [{ name: 'case-feedback-ui-fixture', setup(plugin) {
    plugin.onResolve({ filter: /^react(?:\/jsx-runtime)?$/ }, args => ({ path: args.path, namespace: 'feedback-hooks' }));
    plugin.onLoad({ filter: /.*/, namespace: 'feedback-hooks' }, args => ({ contents: args.path.endsWith('jsx-runtime') ? 'export const jsx=(type,props)=>({type,props}); export const jsxs=jsx; export const Fragment="fragment";' : 'export const useId=()=>"test-id"; export const useState=v=>globalThis.hooks.state(v); export const useRef=v=>globalThis.hooks.ref(v); export const useEffect=(f,d)=>globalThis.hooks.effect(f,d); export const useMemo=(f,d)=>globalThis.hooks.memo(f,d); export const useCallback=(f,d)=>globalThis.hooks.memo(()=>f,d);' }));
    plugin.onLoad({ filter: /\/CaseFeedbackDialog\.tsx$/ }, async args => ({ contents: `${await readFile(args.path, 'utf8')}\nexport { CaseFeedbackForm as __CaseFeedbackFormForTest, FeedbackDialog as __ActualFeedbackDialogForTest };`, loader: 'tsx' }));
    plugin.onResolve({ filter: realDialog ? /CaseDialogs\.tsx$/ : /(?:DecisionBoardPage|CaseDialogs)\.tsx$/ }, args => ({ path: args.path, namespace: 'feedback-ui-components' }));
    plugin.onLoad({ filter: /.*/, namespace: 'feedback-ui-components' }, args => ({ contents: args.path.includes('CaseDialogs') ? 'export function CaseDialog(){return null;} export function CaseFormError(){return null;} export const caseError=e=>e.message;' : `
      export function FeedbackDialog(){return null;}
      export const feedbackDraft=task=>({executed:task.feedback?(task.feedback.adopted?'yes':'no'):'unknown',outcome:task.feedback?.outcome??'',metricDelta:task.feedback?.metricDelta??'',review:task.feedback?.review??'',score:task.feedback?.score==null?'':String(task.feedback.score),effect:task.feedback?.effect??'unknown',expectedLatestRevisionId:task.feedback?.revisionId??null,operationId:crypto.randomUUID()});
    ` }));
  } }] })).outputFiles[0].text;
  bundles.set(realDialog, bundle);
  const sandbox: Record<string, any> = { fetch: fetcher, structuredClone, crypto, Response, Request, Headers, URL, URLSearchParams, setTimeout, clearTimeout };
  runInNewContext(bundle, sandbox);
  const cleanups = new Set<() => void>();
  function mount(Component: (props: any) => Element, props: Record<string, any>) {
    const values: any[] = [], dependencies: any[][] = [], cleanup: (() => void)[] = [], effects: (() => void)[] = [];
    let cursor = 0, tree: Element, closed = false;
    const changed = (i: number, next: any[]) => !dependencies[i] || next.some((v, n) => v !== dependencies[i][n]);
    const hooks = {
      state(initial: any) { const i = cursor++; if (!(i in values)) values[i] = typeof initial === 'function' ? initial() : initial; return [values[i], (value: any) => { values[i] = typeof value === 'function' ? value(values[i]) : value; }]; },
      ref(initial: any) { const i = cursor++; return values[i] ??= { current: initial }; },
      memo(fn: () => any, deps: any[]) { const i = cursor++; if (changed(i, deps)) { dependencies[i] = deps; values[i] = fn(); } return values[i]; },
      effect(fn: () => any, deps: any[]) { const i = cursor++; if (changed(i, deps)) { dependencies[i] = deps; effects.push(() => { cleanup[i]?.(); cleanup[i] = fn(); }); } },
    };
    const render = () => { if (closed) return; cursor = 0; sandbox.hooks = hooks; tree = Component(props); while (effects.length) effects.shift()!(); };
    const settle = async () => { for (let i = 0; i < 8; i++) { await new Promise(resolve => setImmediate(resolve)); render(); } };
    const component = (name: string) => nodes(tree).find((node: Element) => typeof node.type === 'function' && new RegExp('^' + name + '(?:[0-9]+)?$').test(node.type.name));
    const close = () => { if (closed) return; closed = true; for (const fn of cleanup) fn?.(); cleanups.delete(close); };
    cleanups.add(close); render();
    return { props, render, settle, close, component, nodes: () => nodes(tree), text: () => text(tree), button: (label: string) => nodes(tree).find((node: Element) => node.type === 'button' && text(node).includes(label)) };
  }
  return { ...sandbox.CaseFeedbackUi, mount, close() { for (const close of [...cleanups]) close(); } };
}

const record = { id: 'case-A', revision: 1, status: 'pending' };
const project = (id = 'project-A', archivedAt: string | null = null) => ({ id, name: id, archivedAt });
const action = (id = 'action-A', overrides: Record<string, any> = {}) => ({ projectId: 'project-A', itemId: `item-${id}`, taskId: id, currentAuthorizationId: `auth-${id}`, title: id, ...overrides });
const task = (id = 'action-A') => ({ id, itemId: `item-${id}`, title: id, feedback: null });
const request = (id = 'action-A', overrides: Record<string, any> = {}) => ({ kind: 'observe', caseId: record.id, issueId: 'issue-A', requestId: `request-${id}`, revision: 3, status: 'open', lifecycle: 'open', text: `补充 ${id} 观察`, assignee: { label: '原承担人' }, source: { ref: '原观察来源' }, target: { kind: 'observe', projectId: 'project-A', itemId: `item-${id}`, taskId: id, authorizationId: `auth-${id}`, feedbackBaseRevisionId: null }, ...overrides });
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
    if (url.includes('/action-authorizations/history')) return Response.json({authorizations:[{authorizationId:'auth-action-A',decision:'authorize',projectId:'project-A',itemId:'item-action-A',taskId:'action-A',source:{caseId:'case-A',caseStoreId:'store-A',strategyRef:{caseId:'case-A',caseStoreId:'store-A'}},caseConfirmation:{issueId:'issue-A'}}]});
    if (url.includes('/feedback/history')) return Response.json({revisions:[]});
    if (url.endsWith('/decisions/requests')) return Response.json({requests:[request()]});
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


const focusId='daily-case-feedback-action';
function assertFinalForwarding(h:any,component:any,expected:string|undefined){const ui=h.mount(h.__ActualFeedbackDialogForTest,component.props);const boardDialog=ui.component('BoardDialog');assert.ok(boardDialog);assert.equal(boardDialog.props.returnFocusId,expected);const final=boardDialog.type(boardDialog.props);assert.equal(final.type.name,'CaseDialog');assert.equal(final.props.returnFocusId,expected);return ui;}
test('g-focus independent: loading/error/empty/closed/multiple-entry and selected form carry the same caller returnFocusId',async()=>{
 for(const state of ['single','empty','closed','multiple','denied']){const api=fixture();if(state==='empty')api.state.timeline=timeline([]);if(state==='multiple'){api.state.timeline=timeline([action(),action('action-B')]);api.state.board=board(['action-A','action-B']);}const h=await harness(state==='denied'?async(input,init)=>String(input).endsWith('/issues/issue-A')?Response.json({code:'forbidden'},{status:403}):api.fetcher(input,init):api.fetcher,true);try{const view=h.mount(h.CaseFeedbackDialog,{...props(),record:state==='closed'?{...record,status:'closed'}:record,returnFocusId:focusId});assert.equal(view.component('CaseDialog')!.props.returnFocusId,focusId);await view.settle();if(state==='single'){assert.equal(view.component('CaseFeedbackForm')!.props.returnFocusId,focusId);}else{assert.equal(view.component('CaseDialog')!.props.returnFocusId,focusId);}if(state==='multiple'){view.button('action-B')!.props.onClick();view.render();assert.equal(view.component('CaseFeedbackForm')!.props.returnFocusId,focusId);}assert.equal(api.businessPosts.length,0);}finally{h.close();}}
});
test('g-focus independent: compact, read-restricted, legacy and UNKNOWN forms forward through real FeedbackDialog and BoardDialog',async()=>{
 for(const mode of ['compact','restricted','legacy-unknown']){const api=fixture();if(mode==='restricted')api.state.draftReadStatus=403;if(mode==='legacy-unknown'){const id='feedback:case-A:issue-A:action-A';api.drafts.set(id,{kind:'issue-draft',id,revision:1,payload:{caseId:'case-A',issueId:'issue-A',text:'',appendedFragmentIds:[],actionForm:{kind:'feedback',fields:{form:{executed:'yes',outcome:'original-body',metricDelta:'',review:'',score:'',effect:'unknown',expectedLatestRevisionId:null,operationId:'old-operation'},unknownOperation:'old-operation'}}},createdAt:'',updatedAt:''});}const h=await harness(api.fetcher,true);try{const parent=h.mount(h.__CaseFeedbackFormForTest,{...props(),requests:[],candidate:candidate(),returnFocusId:focusId});await parent.settle();const form=parent.component('FeedbackDialog')!;assert.equal(form.props.returnFocusId,focusId);assert.equal(form.props.presentation,mode==='legacy-unknown'?'board':'case');if(mode==='restricted')assert.equal(form.props.readOnly,true);if(mode==='legacy-unknown')assert.equal(form.props.unknownOperation,'old-operation');const child=assertFinalForwarding(h,form,focusId);await child.settle();assert.equal(child.component('BoardDialog')!.props.returnFocusId,focusId);assert.equal(api.businessPosts.length,0);}finally{h.close();}}
});
test('g-focus independent: already-saved receipt branch retains return target without a second business POST',async()=>{
 const api=fixture();const id='feedback:case-A:issue-A:action-A',operation='known-original-operation';api.drafts.set(id,{kind:'issue-draft',id,revision:1,payload:{caseId:'case-A',issueId:'issue-A',text:'',appendedFragmentIds:[],actionForm:{kind:'feedback',fields:{form:{executed:'yes',outcome:'original-body',metricDelta:'',review:'',score:'',effect:'unknown',expectedLatestRevisionId:null,operationId:operation},unknownOperation:operation}}},createdAt:'',updatedAt:''});api.state.operationFeedback=savedFeedback(operation);const h=await harness(api.fetcher,true);try{let saved=0;const parent=h.mount(h.__CaseFeedbackFormForTest,{...props(),requests:[],candidate:candidate(),returnFocusId:focusId,onSaved(){saved++;}});await parent.settle();await parent.component('FeedbackDialog')!.props.onQuery();await parent.settle();const success=parent.component('CaseDialog')!;assert.ok(success);assert.equal(success.props.title,'反馈已保存');assert.equal(success.props.returnFocusId,focusId);assert.equal(saved,1);assert.equal(api.businessPosts.length,0);assert.deepEqual(api.queries,[operation]);}finally{h.close();}
});
test('g-focus independent: ordinary Board without a returnFocusId leaves original CaseDialog captured-trigger behavior selected',async()=>{
 const api=fixture(),h=await harness(api.fetcher,true);try{const onClose=()=>{},form={props:{presentation:'board',task:task(),subject:{projectId:'project-A',itemId:'item-action-A',taskId:'action-A'},draft:{executed:'yes',outcome:'old Board input',metricDelta:'',review:'',score:'',effect:'unknown',expectedLatestRevisionId:null,operationId:'original-operation'},busy:false,unknownOperation:null,onClose,onChange(){},onAsk(){},onSubmit:async()=>{},onQuery:async()=>{}}};const ui=assertFinalForwarding(h,form,undefined);await ui.settle();const boardDialog=ui.component('BoardDialog')!,final=boardDialog.type(boardDialog.props);assert.equal(final.props.onClose,onClose);assert.equal(final.props.busy,false);assert.equal(final.props.returnFocusId,undefined);assert.equal(form.props.draft.operationId,'original-operation');assert.equal(api.businessPosts.length,0);}finally{h.close();}
});
