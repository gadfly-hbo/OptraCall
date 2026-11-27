import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { emptyPreparePayload } from '../src/host/ui/case-preparation-model.ts';
import type { GoalDraftInput, GoalRoleSuggestionRef } from '../src/host/strategy-goals-types.ts';

type Element = { type: string | ((p: Record<string, unknown>) => unknown); props: Record<string, any> };
const descendants = (node: any): Element[] => !node || typeof node !== 'object' ? [] : Array.isArray(node) ? node.flatMap(descendants) : [node, ...descendants(node.props?.children)];
const label = (node: any): string => node == null || node === false ? '' : typeof node === 'string' || typeof node === 'number' ? String(node) : Array.isArray(node) ? node.map(label).join('') : label(node.props?.children);
let bundle: string | undefined;
async function harness(fetcher: typeof fetch, initialProps: Record<string, unknown> = {}) {
  bundle ??= (await build({ entryPoints: ['src/host/ui/CasePreparation.tsx'], bundle: true, write: false, platform: 'browser', format: 'esm', plugins: [{ name: 'isolated-react-hooks', setup(plugin) {
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
  const oldFetch = globalThis.fetch, oldWindow = globalThis.window;
  globalThis.fetch = fetcher;
  (globalThis as any).window = { addEventListener() {}, removeEventListener() {} };
  (globalThis as any).__casePreparationHooks = hooks;
  const { CasePreparation } = await import(`data:text/javascript;base64,${Buffer.from(bundle).toString('base64')}#${Math.random()}`);
  let tree: Element;
  const props: any = { onOpenCase() {}, ...initialProps };
  const render = () => { cursor = 0; tree = CasePreparation(props); while (effects.length) effects.shift()!(); return tree; };
  const settle = async () => { for (let i = 0; i < 15; i++) await new Promise(resolve => setImmediate(resolve)); render(); };
  render(); await settle();
  return { props, render, settle, nodes: () => descendants(tree), find: (type: string, text: string) => descendants(tree).find(n => n.type === type && label(n).includes(text))!, close() { for (const cleanup of cleanups) cleanup?.(); globalThis.fetch = oldFetch; globalThis.window = oldWindow; delete (globalThis as any).__casePreparationHooks; } };
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

test('DW10/DW13: completed prepare is not reused; title/background/exact G/S persist and failed navigation keeps text', async () => {
  const completed = { kind: 'prepare', id: 'home-prepare-default', revision: 8, payload: { ...emptyPreparePayload(), rawInput: '已完成旧输入', creationState: 'completed' }, createdAt: 'old', updatedAt: 'old' };
  const api = server([completed]); const ui = await harness(api.fetcher);
  try {
    let navigations = 0; ui.props.onOpenAllProjects = () => { navigations++; }; ui.render();
    const input = ui.nodes().find(n => n.type === 'textarea')!;
    assert.equal(input.props.value, '');
    input.props.onChange({ target: { value: '当前问题' } }); await ui.settle();
    ui.find('button', '准备新 Case').props.onClick(); await ui.settle();
    const name = ui.nodes().find(n => n.type === 'label' && label(n).includes('这件事的名字'))!;
    descendants(name).find(n => n.type === 'input')!.props.onChange({ target: { value: '人工名称' } });
    const background = ui.nodes().find(n => n.type === 'label' && label(n).includes('问题背景'))!;
    descendants(background).find(n => n.type === 'textarea')!.props.onChange({ target: { value: '' } });
    await ui.settle();
    const saved = api.writes.at(-1);
    assert.notEqual(saved.id, completed.id);
    assert.equal(saved.payload.rawInput, '当前问题'); assert.equal(saved.payload.title, '人工名称'); assert.equal(saved.payload.description, '');
    assert.notEqual(saved.payload.createOperationId, completed.payload.createOperationId);
    api.fail();
    ui.nodes().find(n => n.type === 'textarea')!.props.onChange({ target: { value: '失败时继续输入' } }); await ui.settle();
    ui.find('button', '全部项目').props.onClick(); await ui.settle();
    assert.equal(navigations, 0);
    assert.equal(ui.nodes().find(n => n.type === 'textarea')!.props.value, '失败时继续输入');
  } finally { ui.close(); }
});

test('DW10/FR06: explicit real scope and persisted preparation identity own editable Agent candidate with exact source', async () => {
  const api = server(); const ui = await harness(api.fetcher);
  try {
    ui.find('button', '请 Agent').props.onClick(); ui.render();
    const scope = ui.nodes().find(n => n.type === 'select' && descendants(n).some(x => x.type === 'option' && label(x) === '个人目标'))!;
    scope.props.onChange({ target: { value: 'personal' } }); ui.render();
    const personal = ui.nodes().find(n => n.type === 'label' && label(n).includes('个人归属名称'))!;
    descendants(personal).find(n => n.type === 'input')!.props.onChange({ target: { value: '真实用户' } }); await ui.settle();
    const conversation = ui.nodes().find(n => typeof n.type === 'function' && n.type.name === 'BusinessRoleConversation')!;
    assert.ok(conversation); assert.equal(conversation.props.owner.scope.id, 'personal:真实用户');
    assert.equal(conversation.props.owner.draftId, api.writes.at(-1).id);
    const source: GoalRoleSuggestionRef = { owner: conversation.props.owner, discussionId: 'discussion', sessionId: 'session', entryId: 'entry', sha256: 'a'.repeat(64) };
    const draft: GoalDraftInput = { title: '建议目标', outcome: '预期结果', strategies: ['建议策略'], perspective: 'personal', scope: source.owner.role === 'goal-draft' ? source.owner.scope : conversation.props.owner.scope, measurement: { kind: 'deliverable', criterion: '核对成果' }, baseline: { state: 'pending', description: '待补' }, responsible: '本人' };
    conversation.props.onGoalDraft(draft, source); await ui.settle();
    const goalName = ui.nodes().find(n => n.type === 'label' && label(n).includes('G · 目标名称'))!;
    descendants(goalName).find(n => n.type === 'input')!.props.onChange({ target: { value: '用户修改目标' } }); await ui.settle();
    assert.equal(api.writes.at(-1).payload.goalDraft.title, '用户修改目标');
    assert.deepEqual(api.writes.at(-1).payload.goalDraft.roleSuggestion, source);
    ui.find('button', '收起整理 Agent').props.onClick(); ui.render(); ui.find('button', '请 Agent').props.onClick(); ui.render();
    const reopened = ui.nodes().find(n => typeof n.type === 'function' && n.type.name === 'BusinessRoleConversation')!;
    assert.equal(reopened.props.owner.draftId, source.owner.role === 'goal-draft' ? source.owner.draftId : 'wrong');
    const name = ui.nodes().find(n => n.type === 'label' && label(n).includes('这件事的名字'))!;
    descendants(name).find(n => n.type === 'input')!.props.onChange({ target: { value: '保留的新名称' } }); await ui.settle();
    ui.find('button', '保存候选、明确采纳').props.onClick(); await ui.settle();
    assert.equal(api.goalRequests.length, 1);
    assert.equal(api.goalRequests[0].title, '用户修改目标');
    assert.deepEqual(api.goalRequests[0].roleSuggestion, source);
    assert.equal(api.createRequests.length, 1);
    assert.equal(api.createRequests[0].goal.goalId, 'saved-goal');
    assert.equal(api.createRequests[0].goal.strategy, '建议策略');
    assert.equal(api.writes.at(-1).payload.title, '保留的新名称');

  } finally { ui.close(); }
});


test('DW14: original creation retry keeps later saved title/background/input while reusing frozen operation', async () => {
  const base = emptyPreparePayload();
  const attempt = { draftId: 'recover-create', title: '原提交名称', description: '原提交背景', rawInput: '原提交问题', goal: { goalId: 'g', version: 1, strategy: 'S', alreadyAdopted: true }, adoptOperationId: base.adoptOperationId, createOperationId: base.createOperationId };
  const payload = { ...base, title: '后来编辑名称', description: '后来编辑背景', rawInput: '后来编辑问题', selectedGoal: { goalId: 'g', version: 1, strategy: 'S' }, createAttempt: attempt };
  const api = server([{ kind: 'prepare', id: attempt.draftId, revision: 3, payload, createdAt: 'now', updatedAt: 'now' }]);
  const ui = await harness(api.fetcher, { expanded: true });
  try {
    ui.find('button', '核对原操作并继续').props.onClick(); await ui.settle();
    assert.deepEqual(api.createRequests[0], attempt);
    const saved = api.records.get(attempt.draftId).payload;
    assert.equal(saved.title, '后来编辑名称'); assert.equal(saved.description, '后来编辑背景'); assert.equal(saved.rawInput, '后来编辑问题');
  } finally { ui.close(); }
});

test('DW14: completed Case resumes first issue only, reads lost issue operation and keeps full preparation fragment', async () => {
  const base = emptyPreparePayload();
  const payload = { ...base, title: '准备名称', description: '完整背景', rawInput: '完整原问题', creationState: 'completed', creationReceipt: { caseId: 'created-case', operationId: base.createOperationId, createdAt: 'now' } };
  const api = server([{ kind: 'prepare', id: 'first-issue-prepare', revision: 4, payload, createdAt: 'now', updatedAt: 'now' }]);
  api.dropIssue();
  const ui = await harness(api.fetcher, { expanded: true });
  try {
    ui.find('button', 'Case 已创建，核对并建立第一件事项').props.onClick(); await ui.settle();
    assert.equal(api.createRequests.length, 0); assert.equal(api.issueRequests.length, 1);
    assert.ok(ui.nodes().some(n => n.props?.role === 'alert' && label(n).includes('Case 已创建')));
    ui.find('button', 'Case 已创建，核对并建立第一件事项').props.onClick(); await ui.settle();
    assert.equal(api.issueRequests.length, 1); assert.equal(api.createRequests.length, 0);
    const saved = api.records.get('first-issue-prepare').payload;
    assert.equal(saved.firstIssueReceipt.issueId, 'first-issue');
    const fragment = api.writes.find(w => w.kind === 'carry-over');
    assert.equal(fragment.payload.targetIssueId, 'first-issue');
    assert.match(fragment.payload.originalText, /准备名称/); assert.match(fragment.payload.originalText, /完整背景/); assert.match(fragment.payload.originalText, /完整原问题/);
  } finally { ui.close(); }
});


test('DW10: exact Goal and original Case/Task source initialize a separate recoverable preparation', async () => {
  const original = { kind: 'prepare', id: 'existing-preparation', revision: 2, payload: { ...emptyPreparePayload(), rawInput: '原来未完成的问题' }, createdAt: 'now', updatedAt: 'now' };
  const source = { kind: 'case', caseId: 'origin-case', caseRevision: 7 };
  const initialGoal = { goalId: 'goal-entry', version: 3, strategy: '准确策略', title: '入口名称', description: '入口背景', goalIntent: { goalId: 'goal-entry', intentId: 'intent-entry' } };
  const api = server([original]); const ui = await harness(api.fetcher, { expanded: true, initialGoal, initialSource: source });
  try {
    const entry = api.writes.at(-1);
    assert.notEqual(entry.id, original.id);
    assert.deepEqual(entry.payload.selectedGoal, { goalId: 'goal-entry', version: 3, strategy: '准确策略' });
    assert.deepEqual(entry.payload.creationSource, source); assert.deepEqual(entry.payload.goalIntent, initialGoal.goalIntent);
    assert.equal(api.records.get(original.id).payload.rawInput, '原来未完成的问题');
    ui.find('button', '明确采纳此 G/S 并创建 Case').props.onClick(); await ui.settle();
    assert.deepEqual(api.createRequests[0].creationSource, source); assert.deepEqual(api.createRequests[0].goalIntent, initialGoal.goalIntent);
  } finally { ui.close(); }
});

test('DW13: conflicting current text is separately saved without overwriting the other window', async () => {
  const base = emptyPreparePayload();
  const original = { kind: 'prepare', id: 'shared-preparation', revision: 1, payload: { ...base, rawInput: '共同原文' }, createdAt: 'now', updatedAt: 'now' };
  const api = server([original]); const ui = await harness(api.fetcher);
  try {
    api.records.set(original.id, { ...original, revision: 2, payload: { ...original.payload, rawInput: '另一窗口保存的文字' } });
    ui.nodes().find(n => n.type === 'textarea')!.props.onChange({ target: { value: '当前窗口仍在编辑的文字' } }); await ui.settle();
    assert.equal(api.records.get(original.id).payload.rawInput, '另一窗口保存的文字');
    ui.find('button', '将当前输入另存为独立准备').props.onClick(); await ui.settle();
    assert.equal(api.records.get(original.id).payload.rawInput, '另一窗口保存的文字');
    const copy = api.writes.at(-1); assert.notEqual(copy.id, original.id); assert.equal(copy.payload.rawInput, '当前窗口仍在编辑的文字');
    assert.equal(copy.payload.preservedOriginalIntent.rawInput, '当前窗口仍在编辑的文字');
  } finally { ui.close(); }
});
