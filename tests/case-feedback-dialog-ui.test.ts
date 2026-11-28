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
    const component = (name: string) => nodes(tree).find((node: Element) => typeof node.type === 'function' && node.type.name === name);
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

test('D14: writable actions are the exact issue/Board/active-project intersection, with no first request match', async () => {
  const api = fixture(), h = await harness(api.fetcher);
  try {
    const original = request();
    const view = h.caseFeedbackCandidates(record.id, 'issue-A', timeline(), board(), [project()], [original]);
    assert.equal(view.length, 1); assert.equal(view[0].request.requestId, original.requestId);
    for (const args of [
      [record.id, 'other-issue', timeline(), board(), [project()], [original]],
      ['other-case', 'issue-A', timeline(), board(), [project()], [original]],
      [record.id, 'issue-A', timeline([action('action-A', { currentAuthorizationId: null })]), board(), [project()], [original]],
      [record.id, 'issue-A', timeline(), board(), [project('project-A', 'archived')], [original]],
      [record.id, 'issue-A', timeline(), { ...board(), projects: [project('project-A', 'archived')] }, [project()], [original]],
      [record.id, 'issue-A', timeline(), board(['other-action']), [project()], [original]],
    ]) assert.equal(h.caseFeedbackCandidates(...args).length, 0, 'Unrelated or no-longer-writable actions are excluded');
    for (const wrong of [{ caseId: 'other-case' }, { issueId: 'other-issue' }, { status: 'responded' }, { lifecycle: 'withdrawn' }, { target: { ...original.target, authorizationId: 'old-auth' } }, { target: { ...original.target, feedbackBaseRevisionId: 'old-feedback' } }]) {
      assert.equal(h.caseFeedbackCandidates(record.id, 'issue-A', timeline(), board(), [project()], [request('action-A', wrong)])[0].request, undefined, 'Wrong scope or revision never automatically responds to a request');
    }
    assert.equal(h.caseFeedbackCandidates(record.id, 'issue-A', timeline(), board(), [project()], [original, request('action-A', { requestId: 'second-request' })])[0].request, undefined, 'Multiple accurate requests require selection');
    assert.equal(api.businessPosts.length, 0);
  } finally { h.close(); }
});

test('D14: an explicitly opened request chooses its exact action and request rather than the first available action', async () => {
  const api = fixture(); api.state.timeline = timeline([action(), action('action-B')]); api.state.board = board(['action-A', 'action-B']);
  const h = await harness(api.fetcher);
  try {
    const exact = request('action-B', { revision: 7 });
    const ui = h.mount(h.CaseFeedbackDialog, { ...props(), requests: [request(), exact], requested: exact }); await ui.settle();
    const form = ui.component('CaseFeedbackForm'); assert.ok(form);
    assert.equal(form.props.candidate.task.id, 'action-B');
    assert.deepEqual(plain(form.props.request), exact); assert.equal(api.businessPosts.length, 0);
    const editing = h.mount(h.__CaseFeedbackFormForTest, form.props); await editing.settle();
    assert.deepEqual(plain(editing.component('FeedbackDialog')!.props.draft.requestContext), { caseId: record.id, issueId: 'issue-A', requestId: exact.requestId, revision: 7, target: exact.target });
  } finally { h.close(); }
});

test('D14: no writable action or a closed Case offers the original source without inventing observations', async () => {
  const api = fixture(); api.state.timeline = timeline([]); const opened: any[] = [];
  const h = await harness(api.fetcher);
  try {
    const original = request(); const ui = h.mount(h.CaseFeedbackDialog, { ...props(), requested: original, onBoard: (value: any) => opened.push(value) }); await ui.settle();
    assert.match(ui.text(), /没有可写的原行动观察/); assert.equal(ui.component('CaseFeedbackForm'), undefined);
    ui.button('查看原行动来源')!.props.onClick();
    assert.equal(opened[0].openOriginal, true); assert.equal(opened[0].boardTaskId, original.target.taskId); assert.equal(opened[0].feedbackRevisionId, null);
    api.state.timeline = timeline();
    const closed = h.mount(h.CaseFeedbackDialog, { ...props(), record: { ...record, status: 'closed' } }); await closed.settle();
    assert.match(closed.text(), /Case 已关闭/); assert.equal(closed.component('CaseFeedbackForm'), undefined);
    assert.equal(api.businessPosts.length, 0); assert.equal(api.drafts.size, 0);
  } finally { h.close(); }
});

test('D14/DW13: cancel and full component recreation retain the original feedback input and save intention', async () => {
  const api = fixture(); let closes = 0; const h = await harness(api.fetcher);
  const first = h.mount(h.__CaseFeedbackFormForTest, { ...props(), candidate: candidate(), request: request(), onClose: () => { closes++; } });
  await first.settle(); editForm(first, { executed: 'yes', outcome: '原观察 <script>文字</script>', review: '判断仍待核对', metricDelta: '2%', observationDate: '2026-11-18', sourceScope: '原访谈 2 人、样本未齐' });
  const intention = first.component('FeedbackDialog')!.props.draft.operationId;
  first.component('FeedbackDialog')!.props.onClose(); await first.settle(); assert.equal(closes, 1); assert.equal(api.businessPosts.length, 0);
  h.close();
  const freshPage = await harness(api.fetcher);
  try {
    const reopened = freshPage.mount(freshPage.__CaseFeedbackFormForTest, { ...props(), candidate: candidate(), request: request() }); await reopened.settle();
    const draft = reopened.component('FeedbackDialog')!.props.draft;
    assert.equal(draft.observationDate, '2026-11-18'); assert.equal(draft.sourceScope, '原访谈 2 人、样本未齐'); assert.equal(draft.outcome, '原观察 <script>文字</script>'); assert.equal(draft.review, '判断仍待核对'); assert.equal(draft.metricDelta, '2%'); assert.equal(draft.operationId, intention);
    assert.equal(draft.requestContext.requestId, 'request-action-A'); assert.equal(draft.requestContext.revision, 3);
    assert.equal(api.businessPosts.length, 0);
  } finally { freshPage.close(); }
});

test('D14/DW09: uncertain feedback saves query the exact original operation and preserve its ID across reopen and explicit retry', async () => {
  const api = fixture(), h = await harness(api.fetcher);
  const first = h.mount(h.__CaseFeedbackFormForTest, { ...props(), candidate: candidate(), request: request() });
  await first.settle(); editForm(first, { executed: 'yes', outcome: '原始反馈' }); const input = inputFor(first);
  await first.component('FeedbackDialog')!.props.onSubmit(input); await first.settle();
  assert.equal(first.component('FeedbackDialog')!.props.unknownOperation, input.operationId); assert.equal(api.businessPosts.length, 1);
  assert.deepEqual(api.businessPosts[0].body.respondsToRequest, input.respondsToRequest);
  h.close();
  const reopenedPage = await harness(api.fetcher);
  try {
    const reopened = reopenedPage.mount(reopenedPage.__CaseFeedbackFormForTest, { ...props(), candidate: candidate(), request: request() }); await reopened.settle();
    assert.equal(reopened.component('FeedbackDialog')!.props.unknownOperation, input.operationId);
    assert.equal(reopened.component('FeedbackDialog')!.props.draft.operationId, input.operationId);
    await reopened.component('FeedbackDialog')!.props.onQuery(); await reopened.settle();
    assert.deepEqual(api.queries, [input.operationId]); assert.equal(api.businessPosts.length, 1, 'A query must never replay a write');
    assert.equal(reopened.component('FeedbackDialog')!.props.unknownOperation, null);
    assert.equal(reopened.component('FeedbackDialog')!.props.draft.operationId, input.operationId);
    await reopened.component('FeedbackDialog')!.props.onSubmit(inputFor(reopened)); await reopened.settle();
    assert.equal(api.businessPosts.length, 2); assert.equal(api.businessPosts[1].body.operationId, input.operationId, 'Explicit retry reuses the same intention');
  } finally { reopenedPage.close(); }
});

test('D14: querying an already-saved feedback acknowledges that revision without posting another one', async () => {
  const api = fixture(); let saved = 0; const h = await harness(api.fetcher);
  try {
    const ui = h.mount(h.__CaseFeedbackFormForTest, { ...props(), candidate: candidate(), request: request(), onSaved: () => { saved++; } });
    await ui.settle(); editForm(ui, { executed: 'yes', outcome: '真实观察' }); const input = inputFor(ui);
    await ui.component('FeedbackDialog')!.props.onSubmit(input); await ui.settle();
    api.state.operationFeedback = savedFeedback(input.operationId);
    await ui.component('FeedbackDialog')!.props.onQuery(); await ui.settle();
    assert.equal(saved, 1); assert.equal(api.businessPosts.length, 1); assert.deepEqual(api.queries, [input.operationId]);
    const stored = api.drafts.get('feedback:action-A:request-action-A:3').payload.actionForm.fields;
    assert.equal(stored.unknownOperation, null); assert.equal(stored.form.expectedLatestRevisionId, 'feedback-v1');
  } finally { h.close(); }
});

test('D14: a changed authorization or archived project is rechecked immediately before any feedback write', async () => {
  for (const change of [ (api: ReturnType<typeof fixture>) => { api.state.timeline = timeline([action('action-A', { currentAuthorizationId: 'replacement-auth' })]); }, (api: ReturnType<typeof fixture>) => { api.state.board.projects = [project('project-A', 'archived')]; } ]) {
    const api = fixture(), h = await harness(api.fetcher);
    try {
      const ui = h.mount(h.__CaseFeedbackFormForTest, { ...props(), candidate: candidate(), request: request() }); await ui.settle(); editForm(ui, { executed: 'yes', outcome: '不要丢弃这段观察' });
      change(api); await ui.component('FeedbackDialog')!.props.onSubmit(inputFor(ui)); await ui.settle();
      assert.equal(api.businessPosts.length, 0); assert.match(ui.component('FeedbackDialog')!.props.error, /已变化/);
      assert.equal(ui.component('FeedbackDialog')!.props.draft.outcome, '不要丢弃这段观察'); assert.equal(ui.component('FeedbackDialog')!.props.unknownOperation, null);
    } finally { h.close(); }
  }
});

test('D14: leaving the feedback owner during source recheck prevents a late business write', async () => {
  const api = fixture(), h = await harness(api.fetcher); let release!: () => void;
  try {
    const ui = h.mount(h.__CaseFeedbackFormForTest, { ...props(), candidate: candidate(), request: request() }); await ui.settle(); editForm(ui, { executed: 'yes', outcome: '仍属于原事项' });
    api.state.delayedTimeline = new Promise<void>(resolve => { release = resolve; });
    const saving = ui.component('FeedbackDialog')!.props.onSubmit(inputFor(ui)); ui.close(); release(); await saving;
    assert.equal(api.businessPosts.length, 0, 'An unmounted owner cannot submit a late save');
  } finally { release?.(); h.close(); }
});


test('D14/DW09: two explicitly clicked requests for the same action retain separate inputs and exact request identities', async () => {
  const api=fixture(), h=await harness(api.fetcher);
  try {
    const requestA=request(), requestB=request('action-A',{requestId:'request-B',revision:8});
    const first=h.mount(h.__CaseFeedbackFormForTest,{...props(),candidate:candidate(),request:requestA}); await first.settle();
    editForm(first,{executed:'yes',outcome:'只属于请求 A 的未保存观察'});
    first.component('FeedbackDialog')!.props.onClose(); await first.settle(); first.close();
    const second=h.mount(h.__CaseFeedbackFormForTest,{...props(),candidate:candidate(),request:requestB}); await second.settle();
    const formB=second.component('FeedbackDialog')!;
    assert.equal(formB.props.draft.requestContext.requestId,'request-B');
    assert.equal(formB.props.draft.requestContext.revision,8);
    assert.equal(formB.props.requestScope.requestId,'request-B');
    assert.equal(formB.props.draft.outcome,'','The previous request draft cannot substitute the newly clicked request');
    editForm(second,{outcome:'只属于请求 B 的观察'}); second.component('FeedbackDialog')!.props.onClose(); await second.settle(); second.close();
    const original=h.mount(h.__CaseFeedbackFormForTest,{...props(),candidate:candidate(),request:requestA}); await original.settle();
    assert.equal(original.component('FeedbackDialog')!.props.draft.outcome,'只属于请求 A 的未保存观察');
    assert.equal(original.component('FeedbackDialog')!.props.draft.requestContext.requestId,requestA.requestId);
    assert.equal(api.businessPosts.length,0);
  } finally { h.close(); }
});


test('D14: an untouched unavailable draft remains read-only but can cancel without a save', async () => {
  const api=fixture(); api.state.draftReadStatus=503;let closed=0; const h=await harness(api.fetcher);
  try {
    const ui=h.mount(h.__CaseFeedbackFormForTest,{...props(),candidate:candidate(),request:request(),onClose:()=>{closed++;}});await ui.settle();
    const form=ui.component('FeedbackDialog')!; assert.equal(form.props.busy,false); assert.equal(form.props.readOnly,true);
    form.props.onClose(); await ui.settle(); assert.equal(closed,1); assert.equal(api.businessPosts.length,0);
  } finally {h.close();}
});


test('D14/DW13: a fully reopened legacy UNKNOWN feedback retries its original full body and operation without adding a date', async () => {
  const api = fixture(), legacy = { executed: 'yes', outcome: '旧观察'.repeat(470), metricDelta: '原指标变化', review: '原判断尚待核实', score: '4', effect: 'positive', expectedLatestRevisionId: null, operationId: 'legacy-original-operation' };
  const id = 'feedback:case-A:issue-A:action-A';
  api.drafts.set(id, { kind: 'issue-draft', id, revision: 2, payload: { caseId: 'case-A', issueId: 'issue-A', text: '', appendedFragmentIds: [], actionForm: { kind: 'feedback', fields: { form: legacy, unknownOperation: legacy.operationId } } }, createdAt: '', updatedAt: '' });
  const firstPage = await harness(api.fetcher, true);
  const first = firstPage.mount(firstPage.__CaseFeedbackFormForTest, { ...props(), requests: [], candidate: candidate() }); await first.settle();
  assert.equal(first.component('FeedbackDialog')!.props.unknownOperation, legacy.operationId); firstPage.close();
  const fresh = await harness(api.fetcher, true);
  try {
    const parent = fresh.mount(fresh.__CaseFeedbackFormForTest, { ...props(), requests: [], candidate: candidate() }); await parent.settle();
    const child = fresh.mount(fresh.__ActualFeedbackDialogForTest, { ...parent.component('FeedbackDialog')!.props }); await child.settle();
    const query = child.button('查询原保存结果'); assert.ok(query); await query.props.onClick(); await parent.settle();
    Object.assign(child.props, parent.component('FeedbackDialog')!.props); child.render(); await child.settle();
    assert.deepEqual(api.queries, [legacy.operationId]); assert.equal(api.businessPosts.length, 0);
    const save = child.nodes().find((node: Element) => node.type === 'button' && node.props.type === 'submit')!;
    assert.equal(save.props.disabled, false, 'Legacy no-date 4000-character form must remain retryable without changing the intent');
    child.nodes().find((node: Element) => node.type === 'form')!.props.onSubmit({ preventDefault() {} }); await child.settle(); await parent.settle();
    assert.equal(api.businessPosts.length, 1);
    assert.deepEqual(api.businessPosts[0].body, { operationId: legacy.operationId, expectedLatestRevisionId: null, adopted: true, outcome: legacy.outcome, metricDelta: legacy.metricDelta, review: legacy.review, score: 4, effect: 'positive' });
    assert.equal(parent.component('FeedbackDialog')!.props.unknownOperation, legacy.operationId);
  } finally { fresh.close(); }
});


test('D14: a new Case observation keeps only the real feedback baseline and never copies prior execution or causal judgement', async () => {
 const api=fixture(),h=await harness(api.fetcher);try{const oldTask={...task(),feedback:{...savedFeedback('old-operation'),effect:'positive',score:5,observationDate:'2026-01-01',sourceScope:'旧来源'}};const fresh=h.caseObservationDraft(oldTask);assert.equal(fresh.expectedLatestRevisionId,'feedback-v1');assert.equal(fresh.executed,'unknown');assert.equal(fresh.effect,'unknown');for(const key of ['outcome','metricDelta','review','score','sourceScope'])assert.equal(fresh[key],'');assert.notEqual(fresh.operationId,'old-operation');assert.match(fresh.observationDate,/^\d{4}-\d{2}-\d{2}$/);}finally{h.close();}
});


test('D14/DW09: the real compact form and durable Case wrapper preserve the clicked observation request, metadata and UNKNOWN intent together', async () => {
 const api=fixture(),h=await harness(api.fetcher,true);try{const parent=h.mount(h.__CaseFeedbackFormForTest,{...props(),candidate:candidate(),request:request()});await parent.settle();editForm(parent,{outcome:'当日三店原始观察',observationDate:'2026-11-23',sourceScope:'三店交班记录，未覆盖夜班'});const dialogProps=parent.component('FeedbackDialog')!.props;assert.equal(dialogProps.presentation,'case');const operation=dialogProps.draft.operationId;const child=h.mount(h.__ActualFeedbackDialogForTest,{...dialogProps});await child.settle();assert.equal(child.nodes().find((node: Element)=>node.type==='button'&&node.props.type==='submit')!.props.disabled,false);child.nodes().find((node: Element)=>node.type==='form')!.props.onSubmit({preventDefault(){}});await child.settle();await parent.settle();assert.equal(api.businessPosts.length,1);const body=api.businessPosts[0].body;assert.deepEqual(body.respondsToRequest,{requestId:'request-action-A',revision:3,authorizationId:'auth-action-A'});assert.equal(body.adopted,null);assert.equal(body.effect,'unknown');assert.equal(body.observationDate,'2026-11-23');assert.equal(body.sourceScope,'三店交班记录，未覆盖夜班');assert.equal(body.operationId,operation);assert.equal(parent.component('FeedbackDialog')!.props.unknownOperation,operation);const stored=api.drafts.get('feedback:action-A:request-action-A:3').payload.actionForm.fields;assert.equal(stored.form.observationDate,body.observationDate);assert.equal(stored.form.sourceScope,body.sourceScope);assert.equal(stored.unknownOperation,operation);}finally{h.close();}
});
