import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { runInNewContext } from 'node:vm';
import { emptyPreparePayload } from '/workspace/OptraCall-issue149-ui-conformance/src/host/ui/case-preparation-model.ts';
import type { GoalDraftInput, GoalRoleSuggestionRef } from '/workspace/OptraCall-issue149-ui-conformance/src/host/strategy-goals-types.ts';

type Element = { type: string | ((p: Record<string, unknown>) => unknown); props: Record<string, any> };
const descendants = (node: any): Element[] => !node || typeof node !== 'object' ? [] : Array.isArray(node) ? node.flatMap(descendants) : [node, ...descendants(node.props?.children)];
const label = (node: any): string => node == null || node === false ? '' : typeof node === 'string' || typeof node === 'number' ? String(node) : Array.isArray(node) ? node.map(label).join('') : label(node.props?.children);
let bundle: string | undefined;
async function harness(fetcher: typeof fetch, initialProps: Record<string, unknown> = {}) {
  bundle ??= (await build({ entryPoints: ['src/host/ui/CasePreparation.tsx'], bundle: true, write: false, platform: 'browser', format: 'iife', globalName: 'PreparationUiTest', plugins: [{ name: 'isolated-react-hooks', setup(plugin) {
    plugin.onResolve({ filter: /^react(?:\/jsx-runtime)?$/ }, args => ({ path: args.path, namespace: 'test-hooks' }));
    plugin.onLoad({ filter: /.*/, namespace: 'test-hooks' }, args => ({ contents: args.path.endsWith('jsx-runtime') ? 'export const jsx=(type,props)=>({type,props}); export const jsxs=jsx; export const Fragment="fragment";' : 'export const useState=(v)=>globalThis.__casePreparationHooks.state(v); export const useRef=(v)=>globalThis.__casePreparationHooks.ref(v); export const useEffect=(f,d)=>globalThis.__casePreparationHooks.effect(f,d); export const useId=()=>globalThis.__casePreparationHooks.id();' }));
    plugin.onResolve({ filter: /BusinessRoleConversation\.tsx$/ }, () => ({ path: 'role-conversation', namespace: 'test-component' }));
    plugin.onResolve({ filter: /CaseDialogs\.tsx$/ }, () => ({ path: 'case-error', namespace: 'test-component' }));
    plugin.onLoad({ filter: /.*/, namespace: 'test-component' }, args => ({ contents: args.path === 'case-error' ? 'export const caseError=e=>e.message;' : 'export function BusinessRoleConversation() {return null;}' }));
  } }] })).outputFiles[0].text;
  const values: any[] = [], deps: any[][] = [], cleanups: (() => void)[] = [], effects: (() => void)[] = [];
  let cursor = 0;
  const hooks = {
    state(initial: any) { const i = cursor++; if (!(i in values)) values[i] = typeof initial === 'function' ? initial() : initial; return [values[i], (value: any) => { values[i] = typeof value === 'function' ? value(values[i]) : value; }]; },
    ref(initial: any) { const i = cursor++; return values[i] ??= { current: initial }; },
    id() { return `preparation-${cursor++}`; },
    effect(fn: () => any, next: any[]) { const i = cursor++; if (!deps[i] || next.some((v, n) => v !== deps[i][n])) { deps[i] = next; effects.push(() => { cleanups[i]?.(); cleanups[i] = fn(); }); } },
  };
  // Execute only the fixed bundled UI entry inside a browser-like test sandbox.
  // No module loader, process, filesystem or product Agent capability is exposed.
  const sandbox: Record<string, any> = {
    __casePreparationHooks: hooks, fetch: fetcher, structuredClone, crypto,
    Response, Request, Headers, URL, URLSearchParams,
    setTimeout, clearTimeout,
    window: { addEventListener() {}, removeEventListener() {} },
  };
  runInNewContext(bundle, sandbox, { filename: 'case-preparation-ui-test.iife.js' });
  const { CasePreparation } = sandbox.PreparationUiTest;
  let tree: Element;
  const props: any = { onOpenCase() {}, ...initialProps };
  const render = () => { cursor = 0; tree = CasePreparation(props); while (effects.length) effects.shift()!(); return tree; };
  const settle = async () => { for (let i = 0; i < 15; i++) await new Promise(resolve => setImmediate(resolve)); render(); };
  render(); await settle();
  return { props, render, settle, nodes: () => descendants(tree), find: (type: string, text: string) => descendants(tree).find(n => n.type === type && label(n).includes(text))!, close() { for (const cleanup of cleanups) cleanup?.();  } };
}
function server(initial: any[] = []) {
  const records = new Map(initial.map(d => [d.id, d]));
  let fail = false;
  const writes: any[] = [], goalRequests: any[] = [], createRequests: any[] = [], issueRequests: any[] = [];
  let issueReceipt: any = null, dropIssueReply = false;
  const fetcher: typeof fetch = async (input, init) => {
    const url = String(input);
    if (url.endsWith('/strategy/goals')) {
      if (init?.method === 'POST') { const fields = JSON.parse(String(init.body)); goalRequests.push(fields); return Response.json({ goal: { ...fields, goalId: 'saved-goal', version: 1, status: 'candidate', createdAt: 'now' } }); }
      return Response.json({ goals: [] });
    }
    if (url.endsWith('/workspace/create-case')) {
      const input = JSON.parse(String(init?.body)); createRequests.push(input);
      const previous = records.get(input.draftId);
      const preservedDraft = { ...previous, revision: previous.revision + 1, payload: { ...previous.payload, title: input.title, description: input.description, rawInput: input.rawInput, targetLocation: { caseId: 'original-case' } } };
      records.set(input.draftId, preservedDraft);
      return Response.json({ branch: 'continue', existingCase: { id: 'original-case', title: '原 Case', status: 'discussing' }, isClosed: false, preservedDraft });
    }
    if (url.includes('/cases/operations/')) return Response.json({ operation: issueReceipt });
    if (url.endsWith('/cases/created-case')) return Response.json({ case: { id: 'created-case', revision: 1, title: '已建 Case', status: 'pending', updatedAt: 'now' } });
    if (url.endsWith('/cases/created-case/decisions/issues')) {
      if (init?.method === 'POST') {
        const value = JSON.parse(String(init.body)); issueRequests.push(value);
        const issue = { id: 'first-issue', caseId: 'created-case', title: value.title, createdAt: 'now' };
        issueReceipt = { kind: 'case_update', phase: 'completed', caseId: 'created-case', result: issue };
        if (dropIssueReply) { dropIssueReply = false; return Response.json({ code: 'response_dropped' }, { status: 503 }); }
        return Response.json({ issue });
      }
      return Response.json({ issues: [] });
    }
    if (url.includes('/workspace/case-directory')) return Response.json({ items: [], truncated: false });
    if (url.endsWith('/studio/enterprises')) return Response.json({ enterprises: [] });
    if (url.endsWith('/drafts/prepare')) return Response.json({ drafts: [...records.values()] });
    if (init?.method === 'PUT') {
      if (fail) return Response.json({ code: 'store_unavailable' }, { status: 503 });
      const id = decodeURIComponent(url.split('/').at(-1)!); const body = JSON.parse(String(init.body));
      if (records.has(id) && records.get(id).revision !== body.expectedRevision) return Response.json({ code: 'draft_revision_conflict' }, { status: 409 });
      const draft = { kind: url.includes('/carry-over/') ? 'carry-over' : 'prepare', id, revision: body.expectedRevision + 1, payload: body.payload, createdAt: 'now', updatedAt: 'now' };
      records.set(id, draft); writes.push(draft); return Response.json({ draft });
    }
    const found = records.get(decodeURIComponent(url.split('/').at(-1)!));
    if (found) return Response.json({ draft: found });
    return Response.json({ code: 'not_found' }, { status: 404 });
  };
  return { records, writes, goalRequests, createRequests, issueRequests, fetcher, dropIssue: () => { dropIssueReply = true; }, fail: () => { fail = true; } };
}



test('INDEPENDENT B1: new expanded draft drops prior scope and operation identity while prior adoption/creation remain intact', async () => {
  const base = emptyPreparePayload();
  const scope = { kind: 'enterprise', id: 'old-enterprise', name: 'Original enterprise' };
  const oldGoal = { goalId: 'old-goal', version: 3, strategy: 'Exact strategy' };
  const payload = { ...base, title: 'Completed original', rawInput: 'Original input', description: 'Original background', scope, selectedGoal: oldGoal,
    adoptionReceipt: { ...oldGoal, operationId: base.adoptOperationId, adoptedAt: 'old-adoption-time' },
    creationState: 'completed', creationReceipt: { caseId: 'created-case', operationId: base.createOperationId, createdAt: 'old-create-time' } };
  const api = server([{ kind: 'prepare', id: 'completed-with-adoption', revision: 4, payload, createdAt: 'old-created', updatedAt: 'old-updated' }]);
  const ui = await harness(api.fetcher, { expanded: true });
  try {
    ui.find('button', 'Case 已创建，核对并建立第一件事项').props.onClick(); await ui.settle();
    const preserved = structuredClone(api.records.get('completed-with-adoption'));
    assert.equal(preserved.payload.firstIssueReceipt.issueId, 'first-issue');
    assert.deepEqual(preserved.payload.adoptionReceipt, payload.adoptionReceipt);
    ui.find('button', '准备另一件 Case').props.onClick(); await ui.settle();
    const labelFor = (text: string) => ui.nodes().find(n => n.type === 'label' && label(n).includes(text))!;
    assert.equal(descendants(labelFor('已有企业或个人')).find(n => n.type === 'select')!.props.value, '');
    assert.equal(descendants(labelFor('G · 目标名称')).find(n => n.type === 'input')!.props.value, '');
    descendants(labelFor('G · 目标名称')).find(n => n.type === 'input')!.props.onChange({ target: { value: 'New unowned goal' } }); await ui.settle();
    const next = api.writes.at(-1);
    assert.notEqual(next.id, preserved.id);
    assert.notEqual(next.payload.adoptOperationId, base.adoptOperationId);
    assert.notEqual(next.payload.createOperationId, base.createOperationId);
    assert.equal(next.payload.scope, null);
    assert.equal(next.payload.goalDraft.scope.id, '');
    assert.equal(next.payload.goalDraft.scope.name, '');
    assert.equal(next.payload.selectedGoal, null);
    assert.equal(next.payload.adoptionReceipt, null);
    assert.equal(next.payload.creationReceipt, null);
    assert.equal(next.payload.firstIssueReceipt ?? null, null);
    assert.equal(next.payload.rawInput, '');
    assert.equal(next.payload.title, '');
    assert.equal(next.payload.description, '');
    assert.deepEqual(api.records.get('completed-with-adoption'), preserved);
    assert.equal(api.goalRequests.length, 0); assert.equal(api.createRequests.length, 0); assert.equal(api.issueRequests.length, 1);
  } finally { ui.close(); }
});
