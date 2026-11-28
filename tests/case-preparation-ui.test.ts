import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { runInNewContext } from 'node:vm';
import { emptyPreparePayload } from '../src/host/ui/case-preparation-model.ts';
import type { GoalDraftInput, GoalRoleSuggestionRef } from '../src/host/strategy-goals-types.ts';

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
    const source: GoalRoleSuggestionRef = { owner: JSON.parse(JSON.stringify(conversation.props.owner)), discussionId: 'discussion', sessionId: 'session', entryId: 'entry', sha256: 'a'.repeat(64) };
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

test('DW10 directory: all Case and issue pages remain reachable without losing the selected issue or preparation input', async () => {
  const api = server();
  const calls: string[] = [];
  let failPage = false, denyPage = false;
  const entry = (caseId: string, issues: string[], totalIssues: number, nextIssueOffset: number | null) => ({ caseId, title: caseId, status: 'pending', updatedAt: 'now', goalBinding: null, issues: issues.map(issueId => ({ issueId, title: issueId })), totalIssues, issuesTruncated: nextIssueOffset !== null, nextIssueOffset });
  const fetcher: typeof fetch = async (input, init) => {
    const url = String(input);
    if (!url.includes('/workspace/case-directory')) return api.fetcher(input, init);
    calls.push(url);
    if (denyPage) return Response.json({ code: 'forbidden' }, { status: 403 });
    if (failPage) return Response.json({ code: 'unavailable' }, { status: 503 });
    const query = new URL(url, 'http://test').searchParams;
    if (query.get('caseId') === 'Case A') return Response.json({ items: [entry('Case A', ['issue-5', 'issue-6'], 132, 7)], nextOffset: null, truncated: true, totalVisible: 1 });
    if (query.get('offset') === '1') return Response.json({ items: [entry('Case A', ['issue-1'], 132, 5), entry('Case B', [], 0, null)], nextOffset: null, truncated: true, totalVisible: 2 });
    return Response.json({ items: [entry('Case A', ['issue-1', 'issue-2', 'issue-3', 'issue-4', 'issue-5'], 132, 5)], nextOffset: 1, truncated: true, totalVisible: 2 });
  };
  const ui = await harness(fetcher);
  try {
    ui.nodes().find(n => n.type === 'textarea')!.props.onChange({ target: { value: '分页期间必须保留的问题' } }); await ui.settle();
    ui.find('button', '整理与查找').props.onClick(); await ui.settle();
    assert.ok(ui.find('button', '读取更多事项'), 'A Case with 132 issues must expose the unread issue pages');
    const select = ui.nodes().find(n => n.type === 'select' && n.props['aria-label'] === '选择 Case A 的目标事项')!;
    select.props.onChange({ target: { value: 'issue-3' } }); ui.render();
    ui.find('button', '读取更多事项').props.onClick(); await ui.settle();
    const expanded = ui.nodes().find(n => n.type === 'select' && n.props['aria-label'] === '选择 Case A 的目标事项')!;
    assert.equal(expanded.props.value, 'issue-3');
    assert.equal(descendants(expanded).filter(n => n.type === 'option' && n.props.value === 'issue-5').length, 1);
    assert.ok(descendants(expanded).some(n => n.type === 'option' && n.props.value === 'issue-6'));
    assert.ok(calls.some(url => { const q = new URL(url, 'http://test').searchParams; return q.get('caseId') === 'Case A' && q.get('issueOffset') === '5'; }));
    ui.find('button', '读取更多 Case').props.onClick(); await ui.settle();
    assert.equal(ui.nodes().filter(n => n.type === 'strong' && label(n) === 'Case A').length, 1);
    assert.ok(ui.nodes().some(n => n.type === 'strong' && label(n) === 'Case B'));
    const merged = ui.nodes().find(n => n.type === 'select' && n.props['aria-label'] === '选择 Case A 的目标事项')!;
    assert.equal(merged.props.value, 'issue-3'); assert.ok(descendants(merged).some(n => n.props.value === 'issue-6'));
    failPage = true; ui.find('button', '读取更多事项').props.onClick(); await ui.settle();
    assert.ok(ui.nodes().some(n => n.type === 'strong' && label(n) === 'Case A'));
    assert.equal(ui.nodes().find(n => n.type === 'textarea')!.props.value, '分页期间必须保留的问题');
    failPage = false; denyPage = true; ui.find('button', '读取更多事项').props.onClick(); await ui.settle();
    assert.ok(!ui.nodes().some(n => n.props['aria-label'] === '获准 Case 候选'));
    assert.equal(ui.nodes().find(n => n.type === 'textarea')!.props.value, '分页期间必须保留的问题');
  } finally { ui.close(); }
});

test('DW10 directory: an unread nonempty issue page is never described as having no issues', async () => {
  const api = server();
  const ui = await harness(async (input, init) => String(input).includes('/workspace/case-directory')
    ? Response.json({ items: [{ caseId: 'unread-case', title: '未读事项 Case', status: 'pending', updatedAt: 'now', goalBinding: null, issues: [], totalIssues: 132, issuesTruncated: true, nextIssueOffset: 0 }], nextOffset: null, truncated: true, totalVisible: 1 })
    : api.fetcher(input, init));
  try {
    ui.nodes().find(n => n.type === 'textarea')!.props.onChange({ target: { value: '保留问题' } }); await ui.settle();
    ui.find('button', '整理与查找').props.onClick(); await ui.settle();
    assert.ok(ui.find('button', '读取更多事项'));
    assert.ok(ui.nodes().some(n => n.type === 'p' && label(n).includes('事项尚未读完')));
    assert.ok(!ui.nodes().some(n => n.type === 'p' && label(n).includes('暂无独立事项')));
  } finally { ui.close(); }
});

test('DW10/DW13: G/S can be written and reopened before scope is chosen; explicit scope is still required before any Goal or Case write', async () => {
  const api = server();
  let ui = await harness(api.fetcher, { expanded: true });
  const inputFor = (text: string, kind: 'input' | 'textarea' | 'select') => {
    const parent = ui.nodes().find(n => n.type === 'label' && label(n).includes(text));
    assert.ok(parent, `visible field ${text}`);
    const field = descendants(parent).find(n => n.type === kind);
    assert.ok(field, `editable ${kind} for ${text}`);
    return field;
  };
  const fields = [
    ['G · 目标名称', 'input', '先表达而不预定归属的目标'],
    ['想看到什么结果', 'textarea', '保存未定归属的目标结果'],
    ['S · 这次先怎么推进', 'textarea', '先查看现有事实'],
    ['可核成果', 'input', '一份可回读的观察记录'],
    ['责任角色／承担人', 'input', '用户指定的承担人'],
  ] as const;
  try {
    inputFor('这件事的名字', 'input').props.onChange({ target: { value: '未定归属的准备' } });
    await ui.settle();
    for (const [text, kind, value] of fields) {
      inputFor(text, kind).props.onChange({ target: { value } });
      await ui.settle();
    }
    assert.equal(inputFor('已有企业或个人', 'select').props.value, '', 'editing G/S must not select a personal or enterprise owner');
    const saved = api.writes.at(-1);
    assert.equal(saved.payload.scope, null);
    assert.equal(saved.payload.goalDraft.scope.id, '');
    assert.equal(saved.payload.goalDraft.scope.name, '');
    assert.equal(saved.payload.goalDraft.title, fields[0][2]);
    assert.equal(saved.payload.goalDraft.outcome, fields[1][2]);
    assert.deepEqual(saved.payload.goalDraft.strategies, [fields[2][2]]);
    assert.equal(api.goalRequests.length, 0);
    assert.equal(api.createRequests.length, 0);
    ui.close();
    ui = await harness(api.fetcher, { expanded: true });
    for (const [text, kind, value] of fields) assert.equal(inputFor(text, kind).props.value, value, `${text} survives reopen before scope selection`);
    assert.equal(inputFor('已有企业或个人', 'select').props.value, '');
    ui.find('button', '保存候选、明确采纳 G/S 并创建 Case').props.onClick();
    await ui.settle();
    assert.equal(api.goalRequests.length, 0, 'unselected scope cannot create a Goal candidate');
    assert.equal(api.createRequests.length, 0, 'unselected scope cannot create or continue a Case');
    assert.ok(ui.nodes().some(n => n.props.role === 'alert' && label(n).includes('原输入和原请求保留')));
    inputFor('已有企业或个人', 'select').props.onChange({ target: { value: 'personal' } });
    await ui.settle();
    inputFor('个人归属名称', 'input').props.onChange({ target: { value: '明确选择的归属' } });
    await ui.settle();
    for (const [text, kind, value] of fields) assert.equal(inputFor(text, kind).props.value, value, `${text} survives explicit scope selection`);
    ui.find('button', '保存候选、明确采纳 G/S 并创建 Case').props.onClick();
    await ui.settle();
    assert.equal(api.goalRequests.length, 1);
    assert.equal(api.createRequests.length, 1);
    assert.deepEqual(api.goalRequests[0].scope, { kind: 'personal', id: 'personal:明确选择的归属', name: '明确选择的归属' });
    assert.equal(api.goalRequests[0].title, fields[0][2]);
    assert.equal(api.goalRequests[0].outcome, fields[1][2]);
    assert.deepEqual(api.goalRequests[0].strategies, [fields[2][2]]);
  } finally { ui.close(); }
});

test('DW10/B1: another Case after completed expanded preparation keeps the manual path open and preserves prior results', async () => {
  const original = emptyPreparePayload();
  const payload = { ...original, title: '已创建的原 Case', rawInput: '原始问题', creationState: 'completed', creationReceipt: { caseId: 'created-case', operationId: original.createOperationId, createdAt: 'now' } };
  const api = server([{ kind: 'prepare', id: 'completed-expanded', revision: 4, payload, createdAt: 'now', updatedAt: 'now' }]);
  const ui = await harness(api.fetcher, { expanded: true });
  try {
    ui.find('button', 'Case 已创建，核对并建立第一件事项').props.onClick();
    await ui.settle();
    const preserved = structuredClone(api.records.get('completed-expanded'));
    assert.equal(preserved.payload.firstIssueReceipt.issueId, 'first-issue');
    assert.equal(api.issueRequests.length, 1);
    ui.find('button', '准备另一件 Case').props.onClick();
    await ui.settle();
    const manualGoal = ui.nodes().find(n => n.type === 'label' && label(n).includes('G · 目标名称'));
    const manualScope = ui.nodes().find(n => n.type === 'label' && label(n).includes('已有企业或个人'));
    assert.ok(manualGoal && manualScope, 'another expanded preparation must show G/S and scope without requiring the optional Agent');
    const goalInput = descendants(manualGoal).find(n => n.type === 'input');
    const scopeSelect = descendants(manualScope).find(n => n.type === 'select');
    assert.ok(goalInput && scopeSelect);
    assert.equal(goalInput.props.value, '');
    assert.equal(scopeSelect.props.value, '', 'new preparation must not inherit or guess the previous scope');
    goalInput.props.onChange({ target: { value: '下一件事的新目标' } });
    await ui.settle();
    const next = api.writes.at(-1);
    assert.notEqual(next.id, 'completed-expanded');
    assert.notEqual(next.payload.createOperationId, original.createOperationId);
    assert.equal(next.payload.goalDraft.title, '下一件事的新目标');
    assert.equal(next.payload.creationReceipt, null);
    assert.equal(next.payload.adoptionReceipt, null);
    assert.deepEqual(api.records.get('completed-expanded'), preserved, 'the completed Case and its first-issue receipt remain intact');
    assert.equal(api.goalRequests.length, 0);
    assert.equal(api.createRequests.length, 0);
    assert.equal(api.issueRequests.length, 1, 'starting a new preparation does not replay the previous issue creation');
  } finally { ui.close(); }
});
