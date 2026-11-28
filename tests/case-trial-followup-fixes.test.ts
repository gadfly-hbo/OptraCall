import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { runInNewContext } from 'node:vm';
import { observeTask, type TaskObservationState } from '../src/host/ui/runtime-client.ts';
import { watchStrategyDiscussion, StrategyDiscussionRequestError } from '../src/host/ui/strategy-discussion-client.ts';
import { caseDeclarationsTool, explainCaseDeclarationError } from '../src/agent/strategy-discussion.ts';
import { CaseStore } from '../src/host/case-store.ts';
import { createCaseIssueService } from '../src/host/case-issues.ts';
import { emptyPreparePayload } from '../src/host/ui/case-preparation-model.ts';
import { diagnoseCaseDecisionRequestError } from '../src/host/strategy-discussion-host.ts';
import { createDecisionBoardStore } from '../extensions/business-plugins/decision-board/storage/store.ts';
import type { ClientProject } from '../src/host/ui/project-types.ts';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

type Element = { type: string | ((props: any) => any); props: Record<string, any> };
const descendants = (node: any): Element[] => !node || typeof node !== 'object' ? [] : Array.isArray(node) ? node.flatMap(descendants) : [node, ...descendants(node.props?.children)];
const textOf = (node: any): string => node == null || node === false ? '' : typeof node === 'string' || typeof node === 'number' ? String(node) : Array.isArray(node) ? node.map(textOf).join('') : textOf(node.props?.children);

let roleBundle: string | undefined;
async function mountBusinessRole(fetcher: typeof fetch, initialOwner: Record<string, unknown>) {
  roleBundle ??= (await build({
    entryPoints: ['src/host/ui/BusinessRoleConversation.tsx'],
    bundle: true, write: false, platform: 'browser', format: 'iife', loader: { '.css': 'empty' }, globalName: 'RoleUiTest',
    plugins: [{
      name: 'role-test-hooks',
      setup(plugin) {
        plugin.onResolve({ filter: /^react(?:\/jsx-runtime)?$/ }, args => ({ path: args.path, namespace: 'role-hooks' }));
        plugin.onLoad({ filter: /.*/, namespace: 'role-hooks' }, args => ({
          contents: args.path.endsWith('jsx-runtime')
            ? 'export const jsx=(type,props)=>({type,props});export const jsxs=jsx;export const Fragment="fragment";'
            : 'export const useState=v=>globalThis.__roleHooks.state(v);export const useRef=v=>globalThis.__roleHooks.ref(v);export const useEffect=(f,d)=>globalThis.__roleHooks.effect(f,d);export const useLayoutEffect=(f,d)=>globalThis.__roleHooks.effect(f,d);export const useCallback=(f,d)=>globalThis.__roleHooks.memo(()=>f,d);export const useMemo=(f,d)=>globalThis.__roleHooks.memo(f,d);export const useId=()=>globalThis.__roleHooks.id();export const Fragment="fragment";export const memo=c=>c;',
        }));
      },
    }],
  })).outputFiles[0].text;
  const instances = new Map<string, { values: any[]; deps: any[][]; cleanups: (() => void)[]; memos: { v: any; d: any[] }[] }>();
  const effects: (() => void)[] = [];
  let activeInst = { values: [] as any[], deps: [] as any[][], cleanups: [] as (() => void)[], memos: [] as { v: any; d: any[] }[] };
  let cursor = 0;
  let currentOwner = initialOwner;
  const hooks = {
    state(initial: any) { const inst = activeInst, i = cursor++; if (!(i in inst.values)) inst.values[i] = typeof initial === 'function' ? initial() : initial; return [inst.values[i], (v: any) => { inst.values[i] = typeof v === 'function' ? v(inst.values[i]) : v; }]; },
    ref(initial: any) { const inst = activeInst, i = cursor++; return inst.values[i] ??= { current: initial }; },
    memo(fn: () => any, next: any[]) { const inst = activeInst, i = cursor++; if (!inst.memos[i] || !next || next.some((v, n) => v !== inst.memos[i].d[n])) inst.memos[i] = { v: fn(), d: next ?? [] }; return inst.memos[i].v; },
    id() { return `role-${cursor++}`; },
    effect(fn: () => any, next: any[]) { const inst = activeInst, i = cursor++; if (!inst.deps[i] || next.some((v, n) => v !== inst.deps[i][n])) { inst.deps[i] = next; effects.push(() => { inst.cleanups[i]?.(); inst.cleanups[i] = fn(); }); } },
  };
  const sStore = new Map<string, string>(), lStore = new Map<string, string>();
  const storageApi = (m: Map<string, string>) => ({ getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => m.set(k, v), removeItem: (k: string) => m.delete(k) });
  const sandbox: Record<string, any> = {
    __roleHooks: hooks, fetch: fetcher, structuredClone, crypto,
    Response, Request, Headers, URL, URLSearchParams, TextDecoder, TextEncoder, setTimeout, clearTimeout,
    AbortController, AbortSignal, DOMException, ReadableStream,
    sessionStorage: storageApi(sStore), localStorage: storageApi(lStore),
    window: { addEventListener() {}, removeEventListener() {} },
  };
  runInNewContext(roleBundle, sandbox);
  const { BusinessRoleConversation } = sandbox.RoleUiTest;
  const seenKeys = new Set<string>();
  const expand = (node: any, path = 'root'): any => {
    if (!node || typeof node !== 'object') return node;
    if (Array.isArray(node)) return node.map((child, idx) => expand(child, `${path}.${idx}`));
    if (typeof node.type === 'function') {
      const instKey = `${path}:${node.type.name || 'fn'}:${node.props?.key ?? ''}`;
      seenKeys.add(instKey);
      let inst = instances.get(instKey);
      if (!inst) { inst = { values: [], deps: [], cleanups: [], memos: [] }; instances.set(instKey, inst); }
      const prevInst = activeInst, prevCursor = cursor;
      activeInst = inst; cursor = 0;
      const rendered = node.type(node.props);
      activeInst = prevInst; cursor = prevCursor;
      return expand(rendered, instKey);
    }
    if (node.props?.children !== undefined) return { ...node, props: { ...node.props, children: expand(node.props.children, path) } };
    return node;
  };
  let tree: Element;
  const render = () => {
    seenKeys.clear();
    tree = expand({ type: BusinessRoleConversation, props: { owner: currentOwner } });
    for (const [k, inst] of [...instances.entries()]) {
      if (!seenKeys.has(k)) { for (const fn of inst.cleanups) fn?.(); instances.delete(k); }
    }
    while (effects.length) effects.shift()!();
    return tree;
  };
  const settle = async (rounds = 8) => { for (let i = 0; i < rounds; i++) { await new Promise(r => setImmediate(r)); render(); } };
  render(); await settle();
  return {
    setOwner(next: Record<string, unknown>) { currentOwner = next; render(); },
    render, settle,
    nodes: () => descendants(tree),
    text: () => textOf(tree),
    close() { for (const inst of instances.values()) for (const fn of inst.cleanups) fn?.(); },
  };
}

let issuePanelBundle: string | undefined;
async function mountCaseIssuePanel(fetcher: typeof fetch, extraProps: Record<string, unknown> = {}) {
  issuePanelBundle ??= (await build({
    entryPoints: ['src/host/ui/CaseIssuePanel.tsx'],
    bundle: true, write: false, platform: 'browser', format: 'iife', loader: { '.css': 'empty' }, globalName: 'IssuePanelUiTest',
    plugins: [{
      name: 'issue-panel-test-hooks',
      setup(plugin) {
        plugin.onResolve({ filter: /^react(?:\/jsx-runtime)?$/ }, args => ({ path: args.path, namespace: 'issue-hooks' }));
        plugin.onLoad({ filter: /.*/, namespace: 'issue-hooks' }, args => ({
          contents: args.path.endsWith('jsx-runtime')
            ? 'export const jsx=(type,props)=>({type,props});export const jsxs=jsx;export const Fragment="fragment";'
            : 'export const useState=v=>globalThis.__issueHooks.state(v);export const useRef=v=>globalThis.__issueHooks.ref(v);export const useEffect=(f,d)=>globalThis.__issueHooks.effect(f,d);export const useCallback=(f,d)=>globalThis.__issueHooks.memo(()=>f,d);export const useMemo=(f,d)=>globalThis.__issueHooks.memo(f,d);export const useId=()=>globalThis.__issueHooks.id();',
        }));
        plugin.onResolve({ filter: /BusinessRoleConversation\.tsx$/ }, () => ({ path: 'role-conv', namespace: 'issue-stubs' }));
        plugin.onResolve({ filter: /CaseFeedbackDialog\.tsx$/ }, () => ({ path: 'fb-dlg', namespace: 'issue-stubs' }));
        plugin.onLoad({ filter: /.*/, namespace: 'issue-stubs' }, args => ({
          contents: args.path === 'role-conv' ? 'export function BusinessRoleConversation(){return null;}' : 'export function CaseFeedbackDialog(){return null;}',
        }));
      },
    }],
  })).outputFiles[0].text;
  const instances = new Map<string, { values: any[]; deps: any[][]; cleanups: (() => void)[]; memos: { v: any; d: any[] }[] }>();
  const effects: (() => void)[] = [];
  let activeInst = { values: [] as any[], deps: [] as any[][], cleanups: [] as (() => void)[], memos: [] as { v: any; d: any[] }[] };
  let cursor = 0;
  const hooks = {
    state(initial: any) { const inst = activeInst, i = cursor++; if (!(i in inst.values)) inst.values[i] = typeof initial === 'function' ? initial() : initial; return [inst.values[i], (v: any) => { inst.values[i] = typeof v === 'function' ? v(inst.values[i]) : v; }]; },
    ref(initial: any) { const inst = activeInst, i = cursor++; return inst.values[i] ??= { current: initial }; },
    memo(fn: () => any, next: any[]) { const inst = activeInst, i = cursor++; if (!inst.memos[i] || !next || next.some((v, n) => v !== inst.memos[i].d[n])) inst.memos[i] = { v: fn(), d: next ?? [] }; return inst.memos[i].v; },
    id() { return `issue-ui-${cursor++}`; },
    effect(fn: () => any, next: any[]) { const inst = activeInst, i = cursor++; if (!inst.deps[i] || next.some((v, n) => v !== inst.deps[i][n])) { inst.deps[i] = next; effects.push(() => { inst.cleanups[i]?.(); inst.cleanups[i] = fn(); }); } },
  };
  const sStore = new Map<string, string>(), lStore = new Map<string, string>();
  const storageApi = (m: Map<string, string>) => ({ getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => m.set(k, v), removeItem: (k: string) => m.delete(k) });
  const sandbox: Record<string, any> = {
    __issueHooks: hooks, fetch: fetcher, structuredClone, crypto,
    Response, Request, Headers, URL, URLSearchParams, setTimeout, clearTimeout,
    AbortController, AbortSignal, DOMException, HTMLElement: class HTMLElement {},
    sessionStorage: storageApi(sStore), localStorage: storageApi(lStore),
    window: { addEventListener() {}, removeEventListener() {} },
    document: { activeElement: null, getElementById: () => null },
    requestAnimationFrame: (cb: () => void) => { cb(); return 1; },
  };
  runInNewContext(issuePanelBundle, sandbox);
  const { CaseIssuePanel } = sandbox.IssuePanelUiTest;
  const props: any = {
    record: { id: 'case-1', title: '测试 Case', status: 'analyzing', revision: 1, description: '', judgement: '', nextStep: '', updatedAt: '2026-11-28T00:00:00Z', createdAt: '2026-11-28T00:00:00Z' },
    projects: [],
    onChange() {},
    onCreate() {},
    ...extraProps,
  };
  const expand = (node: any, path = 'root'): any => {
    if (!node || typeof node !== 'object') return node;
    if (Array.isArray(node)) return node.map((child, idx) => expand(child, `${path}.${idx}`));
    if (typeof node.type === 'function') {
      const instKey = `${path}:${node.type.name || 'fn'}:${node.props?.key ?? ''}`;
      let inst = instances.get(instKey);
      if (!inst) { inst = { values: [], deps: [], cleanups: [], memos: [] }; instances.set(instKey, inst); }
      const prevInst = activeInst, prevCursor = cursor;
      activeInst = inst; cursor = 0;
      const rendered = node.type(node.props);
      activeInst = prevInst; cursor = prevCursor;
      return expand(rendered, instKey);
    }
    if (node.props?.children !== undefined) return { ...node, props: { ...node.props, children: expand(node.props.children, path) } };
    return node;
  };
  let tree: Element;
  const render = () => { tree = expand({ type: CaseIssuePanel, props }); while (effects.length) effects.shift()!(); return tree; };
  const settle = async (rounds = 12) => { for (let i = 0; i < rounds; i++) { await new Promise(r => setImmediate(r)); render(); } };
  render(); await settle();
  return { props, render, settle, nodes: () => descendants(tree), text: () => textOf(tree), close() { for (const inst of instances.values()) for (const fn of inst.cleanups) fn?.(); } };
}

let prepBundle: string | undefined;
async function mountCasePrep(fetcher: typeof fetch, initialProps: Record<string, unknown> = {}) {
  prepBundle ??= (await build({
    entryPoints: ['src/host/ui/CasePreparation.tsx'],
    bundle: true, write: false, platform: 'browser', format: 'iife', globalName: 'PrepFollowupTest',
    plugins: [{
      name: 'prep-followup-hooks',
      setup(plugin) {
        plugin.onResolve({ filter: /^react(?:\/jsx-runtime)?$/ }, args => ({ path: args.path, namespace: 'prep-hooks' }));
        plugin.onLoad({ filter: /.*/, namespace: 'prep-hooks' }, args => ({
          contents: args.path.endsWith('jsx-runtime')
            ? 'export const jsx=(type,props)=>({type,props});export const jsxs=jsx;export const Fragment="fragment";'
            : 'export const useState=v=>globalThis.__prepHooks.state(v);export const useRef=v=>globalThis.__prepHooks.ref(v);export const useEffect=(f,d)=>globalThis.__prepHooks.effect(f,d);export const useId=()=>globalThis.__prepHooks.id();',
        }));
        plugin.onResolve({ filter: /BusinessRoleConversation\.tsx$/ }, () => ({ path: 'role-conv', namespace: 'prep-stubs' }));
        plugin.onLoad({ filter: /role-conv/, namespace: 'prep-stubs' }, () => ({ contents: 'export function BusinessRoleConversation(){return null;}' }));
      },
    }],
  })).outputFiles[0].text;
  const values: any[] = [], deps: any[][] = [], cleanups: (() => void)[] = [], effects: (() => void)[] = [];
  let cursor = 0;
  const hooks = {
    state(initial: any) { const i = cursor++; if (!(i in values)) values[i] = typeof initial === 'function' ? initial() : initial; return [values[i], (v: any) => { values[i] = typeof v === 'function' ? v(values[i]) : v; }]; },
    ref(initial: any) { const i = cursor++; return values[i] ??= { current: initial }; },
    id() { return `prep-${cursor++}`; },
    effect(fn: () => any, next: any[]) { const i = cursor++; if (!deps[i] || next.some((v, n) => v !== deps[i][n])) { deps[i] = next; effects.push(() => { cleanups[i]?.(); cleanups[i] = fn(); }); } },
  };
  const sandbox: Record<string, any> = {
    __prepHooks: hooks, fetch: fetcher, structuredClone, crypto,
    Response, Request, Headers, URL, URLSearchParams, setTimeout, clearTimeout,
    window: { addEventListener() {}, removeEventListener() {} },
  };
  runInNewContext(prepBundle, sandbox);
  const { CasePreparation } = sandbox.PrepFollowupTest;
  let tree: Element;
  const props: any = { onOpenCase() {}, ...initialProps };
  const render = () => { cursor = 0; tree = CasePreparation(props); while (effects.length) effects.shift()!(); return tree; };
  const settle = async (rounds = 10) => { for (let i = 0; i < rounds; i++) { await new Promise(r => setImmediate(r)); render(); } };
  render(); await settle();
  return { props, render, settle, nodes: () => descendants(tree), text: () => textOf(tree), close() { for (const fn of cleanups) fn?.(); } };
}

let boardBundle: string | undefined;
async function mountCaseBoard(fetcher: typeof fetch, extraProps: Record<string, unknown> = {}) {
  boardBundle ??= (await build({
    entryPoints: ['src/host/ui/CaseBoard.tsx'],
    bundle: true, write: false, platform: 'browser', format: 'iife', loader: { '.css': 'empty' }, globalName: 'BoardFollowupTest',
    plugins: [{
      name: 'board-followup-hooks',
      setup(plugin) {
        plugin.onResolve({ filter: /^react(?:\/jsx-runtime)?$/ }, args => ({ path: args.path, namespace: 'board-hooks' }));
        plugin.onLoad({ filter: /.*/, namespace: 'board-hooks' }, args => ({
          contents: args.path.endsWith('jsx-runtime')
            ? 'export const jsx=(type,props)=>({type,props});export const jsxs=jsx;export const Fragment="fragment";'
            : 'export const useState=v=>globalThis.__boardHooks.state(v);export const useRef=v=>globalThis.__boardHooks.ref(v);export const useEffect=(f,d)=>globalThis.__boardHooks.effect(f,d);export const useLayoutEffect=(f,d)=>globalThis.__boardHooks.effect(f,d);export const useCallback=(f,d)=>globalThis.__boardHooks.memo(()=>f,d);export const useMemo=(f,d)=>globalThis.__boardHooks.memo(f,d);export const useId=()=>globalThis.__boardHooks.id();export const Fragment="fragment";export const memo=c=>c;',
        }));
        for (const stub of [/BusinessRoleConversation\.tsx$/, /CaseFeedbackDialog\.tsx$/, /CaseIssuePanel\.tsx$/, /CaseEnterpriseMaterials\.tsx$/, /CaseRelationsPanel\.tsx$/, /CaseGoalsPanel\.tsx$/, /CaseDecisionsPanel\.tsx$/]) {
          plugin.onResolve({ filter: stub }, args => ({ path: args.path, namespace: 'board-stubs' }));
        }
        plugin.onLoad({ filter: /.*/, namespace: 'board-stubs' }, () => ({
          contents: 'export function BusinessRoleConversation(){return null;} export function CaseFeedbackDialog(){return null;} export function CaseIssuePanel(){return null;} export function CaseEnterpriseMaterials(){return null;} export function CaseRelationsPanel(){return null;} export function createCaseRelationDraft(){return {};} export const initialCaseRelationUi={selected:null,editorOpen:false,draft:null}; export function caseRelationName(r){return r?.relationId??"";} export function CaseGoalsPanel(){return null;} export function CaseDecisionsPanel(){return null;} export const emptyCaseDecisionUiState = {};',
        }));
      },
    }],
  })).outputFiles[0].text;
  const instances = new Map<string, { values: any[]; deps: any[][]; cleanups: (() => void)[]; memos: { v: any; d: any[] }[] }>();
  const effects: (() => void)[] = [];
  let activeInst = { values: [] as any[], deps: [] as any[][], cleanups: [] as (() => void)[], memos: [] as { v: any; d: any[] }[] };
  let cursor = 0;
  const hooks = {
    state(initial: any) { const inst = activeInst, i = cursor++; if (!(i in inst.values)) inst.values[i] = typeof initial === 'function' ? initial() : initial; return [inst.values[i], (v: any) => { inst.values[i] = typeof v === 'function' ? v(inst.values[i]) : v; }]; },
    ref(initial: any) { const inst = activeInst, i = cursor++; return inst.values[i] ??= { current: initial }; },
    memo(fn: () => any, next: any[]) { const inst = activeInst, i = cursor++; if (!inst.memos[i] || !next || next.some((v, n) => v !== inst.memos[i].d[n])) inst.memos[i] = { v: fn(), d: next ?? [] }; return inst.memos[i].v; },
    id() { return `board-${cursor++}`; },
    effect(fn: () => any, next: any[]) { const inst = activeInst, i = cursor++; if (!inst.deps[i] || next.some((v, n) => v !== inst.deps[i][n])) { inst.deps[i] = next; effects.push(() => { inst.cleanups[i]?.(); inst.cleanups[i] = fn(); }); } },
  };
  const sStore = new Map<string, string>(), lStore = new Map<string, string>();
  const storageApi = (m: Map<string, string>) => ({ getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => m.set(k, v), removeItem: (k: string) => m.delete(k) });
  const sandbox: Record<string, any> = {
    __boardHooks: hooks, fetch: fetcher, structuredClone, crypto,
    Response, Request, Headers, URL, URLSearchParams, setTimeout, clearTimeout,
    AbortController, AbortSignal, DOMException, HTMLElement: class HTMLElement {},
    sessionStorage: storageApi(sStore), localStorage: storageApi(lStore),
    window: { addEventListener() {}, removeEventListener() {}, location: { href: 'http://localhost/' } },
    document: { activeElement: null, getElementById: () => null },
    requestAnimationFrame: (cb: () => void) => { cb(); return 1; },
    cancelAnimationFrame() {},
  };
  runInNewContext(boardBundle, sandbox);
  const { CaseBoard } = sandbox.BoardFollowupTest;
  const props: any = {
    visible: true,
    decisionUi: {},
    onDecisionUiChange() {},
    projects: [],
    configurations: [],
    onOpenTask() {},
    onCreateTask() {},
    onProjectChange: async () => {},
    ...extraProps,
  };
  const expand = (node: any, path = 'root'): any => {
    if (!node || typeof node !== 'object') return node;
    if (Array.isArray(node)) return node.map((child, idx) => expand(child, `${path}.${idx}`));
    if (typeof node.type === 'function') {
      const instKey = `${path}:${node.type.name || 'fn'}:${node.props?.key ?? ''}`;
      let inst = instances.get(instKey);
      if (!inst) { inst = { values: [], deps: [], cleanups: [], memos: [] }; instances.set(instKey, inst); }
      const prevInst = activeInst, prevCursor = cursor;
      activeInst = inst; cursor = 0;
      const rendered = node.type(node.props);
      activeInst = prevInst; cursor = prevCursor;
      return expand(rendered, instKey);
    }
    if (node.props?.children !== undefined) return { ...node, props: { ...node.props, children: expand(node.props.children, path) } };
    return node;
  };
  let tree: Element;
  const render = () => { tree = expand({ type: CaseBoard, props }); while (effects.length) effects.shift()!(); return tree; };
  const settle = async (rounds = 10) => { for (let i = 0; i < rounds; i++) { await new Promise(r => setImmediate(r)); render(); } };
  render(); await settle();
  return { props, render, settle, nodes: () => descendants(tree), text: () => textOf(tree), close() { for (const inst of instances.values()) for (const fn of inst.cleanups) fn?.(); } };
}

let navBundle: string | undefined;
async function mountProjectNav(projects: ClientProject[]) {
  navBundle ??= (await build({
    entryPoints: ['src/host/ui/ProjectNavigation.tsx'],
    bundle: true, write: false, platform: 'browser', format: 'iife', globalName: 'NavFollowupTest',
    plugins: [{
      name: 'nav-followup-hooks',
      setup(plugin) {
        plugin.onResolve({ filter: /^react(?:\/jsx-runtime)?$/ }, args => ({ path: args.path, namespace: 'nav-hooks' }));
        plugin.onLoad({ filter: /.*/, namespace: 'nav-hooks' }, args => ({
          contents: args.path.endsWith('jsx-runtime')
            ? 'export const jsx=(type,props)=>({type,props});export const jsxs=jsx;export const Fragment="fragment";'
            : 'export const useState=v=>globalThis.__navHooks.state(v);export const useEffect=()=>{};',
        }));
      },
    }],
  })).outputFiles[0].text;
  const values: any[] = [];
  let cursor = 0;
  const sandbox: Record<string, any> = {
    __navHooks: { state(initial: any) { const i = cursor++; if (!(i in values)) values[i] = typeof initial === 'function' ? initial() : initial; return [values[i], (v: any) => { values[i] = typeof v === 'function' ? v(values[i]) : v; }]; } },
  };
  runInNewContext(navBundle, sandbox);
  const { ProjectNavigation } = sandbox.NavFollowupTest;
  const tree = ProjectNavigation({
    projects, states: {}, loading: false,
    onProject() {}, onTask() {}, onCreateTask() {}, onRename() {}, onArchive() {}, onRestore() {},
  });
  return descendants(tree);
}

test('CF01: Case BusinessRoleConversation recovers completed state after SSE clean EOF, handles non-Case owners, and discards stale owner readbacks', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const ownerA = { role: 'case', caseId: 'case-eof', itemId: 'issue-eof' };
  const ownerB = { role: 'project', projectId: 'proj-b' };
  const discussionA = 'disc-eof-a', discussionB = 'disc-eof-b';
  let backendStatus: 'idle' | 'running' | 'completed' = 'idle';
  let delayNextGet = false;
  let releaseDelayedGet: () => void = () => {};
  let sentRequestId = '';
  const calls: { action: string | null; method: string; ownerKey: string }[] = [];
  const fetcher: typeof fetch = async (input, init) => {
    const url = new URL(String(input), 'http://localhost');
    const method = init?.method ?? 'GET';
    if (url.pathname === '/api/configurations') return Response.json({ configurations: [{ id: 'cfg-1', revision: 1, name: 'Synth', model: 'synth', hasApiKey: true }], selectedId: 'cfg-1' });
    if (url.pathname.startsWith('/api/workspace/drafts/')) {
      if (method === 'GET') return Response.json({ code: 'not_found' }, { status: 404 });
      return Response.json({ draft: { kind: 'issue-draft', id: url.pathname.split('/').pop(), revision: 1, payload: JSON.parse(String(init?.body)).payload } });
    }
    if (url.pathname === '/api/business-role') {
      const action = url.searchParams.get('action');
      const isB = (url.searchParams.get('owner') ?? '').includes('proj-b');
      const ownerKey = isB ? 'project:proj-b' : 'case:case-eof';
      calls.push({ action, method, ownerKey });
      if (action === 'events') {
        const snap = isB
          ? { sessionId: 'sess-b', sdkVersion: '1.4.0', status: 'idle', messages: [{ role: 'assistant', content: 'ProjectB 独立回复' }], tools: [] }
          : { sessionId: 'sess-1', sdkVersion: '1.4.0', status: backendStatus === 'running' ? 'running' : 'idle', messages: backendStatus === 'completed' ? [{ role: 'user', content: '核对EOF' }, { role: 'assistant', content: '已完成完整回复' }] : [], tools: [] };
        return new Response(new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({ type: 'snapshot', snapshot: snap })}\n\n`));
            controller.close();
          },
        }), { headers: { 'content-type': 'text/event-stream' } });
      }
      if (action === 'messages' && method === 'POST') {
        const body = JSON.parse(String(init?.body));
        sentRequestId = body.requestId;
        backendStatus = 'running';
        return Response.json({ discussion: { id: discussionA, revision: 1, configurationId: 'cfg-1', configurationRevision: 1 }, requestId: sentRequestId }, { status: 202 });
      }
      if (action === 'stop') throw new Error('must not auto-stop');
      if (!isB && delayNextGet) {
        delayNextGet = false;
        await new Promise<void>(resolve => { releaseDelayedGet = resolve; });
      }
      if (isB) {
        return Response.json({
          discussion: { id: discussionB, revision: 1, configurationId: 'cfg-1', configurationRevision: 1 },
          busy: false,
          snapshot: { sessionId: 'sess-b', sdkVersion: '1.4.0', status: 'idle', messages: [{ role: 'assistant', content: 'ProjectB 独立回复' }], tools: [] },
        });
      }
      const busy = backendStatus === 'running';
      const messages = backendStatus === 'completed' ? [{ role: 'user', content: '核对EOF' }, { role: 'assistant', content: '已完成完整回复' }] : [];
      return Response.json({
        discussion: {
          id: discussionA, revision: 1, configurationId: 'cfg-1', configurationRevision: 1,
          lastRun: sentRequestId ? { id: sentRequestId, status: backendStatus === 'completed' ? 'completed' : 'accepted' } : undefined,
        },
        busy,
        snapshot: { sessionId: 'sess-1', sdkVersion: '1.4.0', status: busy ? 'running' : 'idle', messages, tools: [] },
        requestReceipt: sentRequestId ? { requestId: sentRequestId, originalUserText: '核对EOF', nativeEntryId: 'entry-1', sessionId: 'sess-1' } : undefined,
      });
    }
    return Response.json({});
  };

  const ui = await mountBusinessRole(fetcher, ownerA);
  try {
    const textarea = ui.nodes().find(n => n.type === 'textarea')!;
    textarea.props.onChange({ target: { value: '核对EOF' } });
    await ui.settle();
    const form = ui.nodes().find(n => n.type === 'form')!;
    form.props.onSubmit({ preventDefault() {} });
    await ui.settle();
    assert.match(ui.text(), /正在回复/);

    backendStatus = 'completed';
    for (const ms of [500, 1500, 3000]) { t.mock.timers.tick(ms); await ui.settle(6); }
    assert.doesNotMatch(ui.text(), /正在回复/, 'UI must recover from clean EOF and stop showing 正在回复…');
    assert.match(ui.text(), /已完成完整回复/, 'UI must display recovered assistant reply');
    assert.equal(calls.filter(c => c.action === 'messages').length, 1, 'must never replay POST messages');
    assert.equal(calls.filter(c => c.action === 'stop').length, 0, 'must never auto-stop');

    delayNextGet = true;
    ui.setOwner(ownerB);
    await ui.settle(12);
    releaseDelayedGet();
    await ui.settle(8);
    assert.match(ui.text(), /ProjectB 独立回复/, 'non-Case role owner renders its own recovered state');
    assert.doesNotMatch(ui.text(), /已完成完整回复/, 'late readback from previous owner must never pollute switched owner');
  } finally { ui.close(); }
});

test('CF02: observeTask enforces first-frame deadline past heartbeats, exposes safe stream.error categories, and preserves draft on reconnect', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  // Case 1: heartbeat-only stream without snapshot triggers firstFrameTimeoutMs
  {
    const controller = new AbortController();
    const states: TaskObservationState[] = [];
    let streamBody: ReadableStreamDefaultController<Uint8Array> | undefined;
    let closed = false;
    t.mock.method(globalThis, 'fetch', async (url: string | URL | Request, init?: RequestInit) => {
      if (String(url).endsWith('/events')) {
        return new Response(new ReadableStream<Uint8Array>({
          start(s) {
            streamBody = s;
            s.enqueue(new TextEncoder().encode(': task connection\n\n'));
            init?.signal?.addEventListener('abort', () => { closed = true; try { s.error(new DOMException('Aborted', 'AbortError')); } catch {} }, { once: true });
          },
        }), { headers: { 'content-type': 'text/event-stream' } });
      }
      return Response.json({
        project: { schemaVersion: 2, id: 'p1', name: 'P', configuration: { id: 'm', revision: 1, name: 'M', api: 'openai-completions', provider: 'custom', baseUrl: 'https://example.invalid', model: 'm' }, rootPath: '/tmp', createdAt: '', updatedAt: '', archivedAt: null, tasks: [] },
        task: { id: 't1', name: 'T', draft: 'kept', configuration: { id: 'm', revision: 1, name: 'M', api: 'openai-completions', provider: 'custom', baseUrl: 'https://example.invalid', model: 'm' }, createdAt: '', updatedAt: '', sessionStorage: 'task' },
        snapshot: { sessionId: '', sdkVersion: '', status: 'idle', messages: [], tools: [] },
      });
    });

    const run = observeTask('p1', 't1', () => {}, controller.signal, {
      idleTimeoutMs: 20,
      firstFrameTimeoutMs: 50,
      onConnection: value => states.push(value),
    });
    await new Promise(r => setImmediate(r));
    for (let i = 0; i < 6 && !closed; i++) {
      t.mock.timers.tick(10);
      if (!closed && streamBody) { try { streamBody.enqueue(new TextEncoder().encode(': heartbeat\n\n')); } catch { closed = true; } }
      await new Promise(r => setImmediate(r));
    }
    assert.ok(states.some(s => (s.state === 'recovering' || s.state === 'disconnected') && /首帧/.test(s.message ?? '')), 'heartbeat-only stream without snapshot must exit connecting at firstFrameTimeoutMs with safe diagnosis');
    assert.ok(!states.some(s => s.state === 'connected'), 'GET idle must not mark connected');
    controller.abort();
    await run;
  }

  // Case 2: safe server stream.error category surfaces explicitly without leaking internal stack or marking connected
  {
    const controller = new AbortController();
    const states: TaskObservationState[] = [];
    t.mock.method(globalThis, 'fetch', async (url: string | URL | Request) => {
      if (String(url).endsWith('/events')) {
        return new Response(new ReadableStream<Uint8Array>({
          start(s) {
            s.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({ type: 'stream.error', code: 'sse_snapshot_read_failed', category: 'snapshot_read' })}\n\n`));
            s.close();
          },
        }), { headers: { 'content-type': 'text/event-stream' } });
      }
      return Response.json({
        project: { schemaVersion: 2, id: 'p1', name: 'P', configuration: { id: 'm', revision: 1, name: 'M', api: 'openai-completions', provider: 'custom', baseUrl: 'https://example.invalid', model: 'm' }, rootPath: '/tmp', createdAt: '', updatedAt: '', archivedAt: null, tasks: [] },
        task: { id: 't1', name: 'T', draft: 'kept', configuration: { id: 'm', revision: 1, name: 'M', api: 'openai-completions', provider: 'custom', baseUrl: 'https://example.invalid', model: 'm' }, createdAt: '', updatedAt: '', sessionStorage: 'task' },
        snapshot: { sessionId: '', sdkVersion: '', status: 'idle', messages: [], tools: [] },
      });
    });
    const run = observeTask('p1', 't1', () => {}, controller.signal, { onConnection: value => states.push(value) });
    for (const ms of [0, 500, 1500, 3000]) { t.mock.timers.tick(ms); await new Promise(r => setImmediate(r)); }
    await run;
    assert.ok(states.some(s => /首帧记录读取失败/.test(s.message ?? '')), 'safe stream.error category must surface');
    assert.ok(!states.some(s => s.state === 'connected'), 'stream.error must never mark connected');
    assert.equal(states.at(-1)?.state, 'disconnected');
  }

  // Case 3: FR02 — after stream failures exhaust into disconnected, explicit reconnect receives legitimate snapshot, marks connected, preserves draft, and issues zero open/messages/stop POSTs
  {
    let allowSnapshot = false;
    const writes: string[] = [];
    const readbacks: string[] = [];
    t.mock.method(globalThis, 'fetch', async (url: string | URL | Request, init?: RequestInit) => {
      const urlStr = String(url);
      const method = init?.method ?? 'GET';
      if (method !== 'GET') writes.push(`${method} ${urlStr}`);
      if (urlStr.endsWith('/events')) {
        if (!allowSnapshot) {
          return new Response(new ReadableStream<Uint8Array>({
            start(s) {
              s.enqueue(new TextEncoder().encode(': heartbeat\n\n'));
              s.close();
            },
          }), { headers: { 'content-type': 'text/event-stream' } });
        }
        return new Response(new ReadableStream<Uint8Array>({
          start(s) {
            s.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({ type: 'snapshot', snapshot: { sessionId: 's-reconn', sdkVersion: '1.4.0', status: 'idle', messages: [], tools: [] } })}\n\n`));
            init?.signal?.addEventListener('abort', () => { try { s.close(); } catch {} }, { once: true });
          },
        }), { headers: { 'content-type': 'text/event-stream' } });
      }
      return Response.json({
        project: { schemaVersion: 2, id: 'p1', name: 'P', configuration: { id: 'm', revision: 1, name: 'M', api: 'openai-completions', provider: 'custom', baseUrl: 'https://example.invalid', model: 'm' }, rootPath: '/tmp', createdAt: '', updatedAt: '', archivedAt: null, tasks: [] },
        task: { id: 't1', name: 'T', draft: '显式重连草稿保留', configuration: { id: 'm', revision: 1, name: 'M', api: 'openai-completions', provider: 'custom', baseUrl: 'https://example.invalid', model: 'm' }, createdAt: '', updatedAt: '', sessionStorage: 'task' },
        snapshot: { sessionId: '', sdkVersion: '', status: 'idle', messages: [], tools: [] },
      });
    });

    const firstController = new AbortController();
    const firstStates: TaskObservationState[] = [];
    const firstRun = observeTask('p1', 't1', () => {}, firstController.signal, { onConnection: v => firstStates.push(v) });
    for (const ms of [0, 500, 1500, 3000]) { t.mock.timers.tick(ms); await new Promise(r => setImmediate(r)); }
    await firstRun;
    assert.equal(firstStates.at(-1)?.state, 'disconnected');
    assert.ok(!firstStates.some(s => s.state === 'connected'), 'GET idle during exhaustion must never unlock connected');

    allowSnapshot = true;
    const secondController = new AbortController();
    const secondStates: TaskObservationState[] = [];
    const secondRun = observeTask('p1', 't1', () => {}, secondController.signal, {
      onConnection: v => secondStates.push(v),
      onReadback: v => readbacks.push(v.task.draft ?? ''),
    });
    await new Promise(r => setImmediate(r));
    assert.ok(secondStates.some(s => s.state === 'connected'), 'explicit reconnect must restore connected on valid snapshot');
    assert.deepEqual(writes, [], 'reconnect must never auto-open/send/stop');
    secondController.abort();
    await secondRun;
  }
});

test('CF03: empty choice modal guides to Link Project or Plan Task / handoff without copying goal strategy, keeping draft', async () => {
  const draftLog: string[] = [];
  const baseFetch = (hasProject: boolean): typeof fetch => async (input, init) => {
    const url = String(input);
    if (url.endsWith('/issues')) return Response.json({ issues: [{ id: 'issue-1', caseId: 'case-1', title: '第一件事项', createdAt: '2026-11-28T00:00:00Z' }] });
    if (url.endsWith('/issues/issue-1')) return Response.json({ issue: { id: 'issue-1', caseId: 'case-1', title: '第一件事项' }, rounds: [] });
    if (url.endsWith('/issues/issue-1/sources')) return Response.json({ replies: [], limitations: [] });
    if (url.endsWith('/decisions/requests')) return Response.json({ requests: [] });
    if (url.includes('/decisions?')) return Response.json({ items: [], continuation: null });
    if (url.includes('/workspace/drafts/')) {
      draftLog.push(`${init?.method ?? 'GET'}:${url}`);
      if (init?.method === 'PUT') {
        const draftId = decodeURIComponent(new URL(url, 'http://localhost').pathname.split('/').pop()!);
        return Response.json({ draft: { kind: 'issue-draft', id: draftId, revision: draftLog.length, payload: JSON.parse(String(init.body)).payload } });
      }
      return Response.json({ code: 'not_found' }, { status: 404 });
    }
    if (hasProject && url.includes('/projects')) return Response.json({});
    return Response.json({});
  };

  // Without linked active project
  const uiNoProject = await mountCaseIssuePanel(baseFetch(false), { projects: [], onLinkProject() {} });
  try {
    uiNoProject.nodes().find(n => n.type === 'button' && textOf(n) === '记录取舍')!.props.onClick();
    await uiNoProject.settle();
    const dialogText = uiNoProject.text();
    assert.match(dialogText, /尚无可供取舍的准确方案版本/);
    assert.doesNotMatch(dialogText, /Case 主目标 G\/S 策略.*<option/);
    assert.ok(uiNoProject.nodes().some(n => n.type === 'button' && /关联或新建项目/.test(textOf(n))), 'must provide Link Project action');
  } finally { uiNoProject.close(); }

  // With linked active project
  let planCalls = 0;
  const linkedProject: ClientProject = {
    schemaVersion: 2, id: 'proj-linked', name: '已关联项目',
    configuration: { id: 'c', revision: 1, name: 'M', api: 'openai-completions', provider: 'custom', baseUrl: 'https://e.invalid', model: 'm' },
    rootPath: '/linked', createdAt: '', updatedAt: '', archivedAt: null, tasks: [],
  };
  const uiWithProject = await mountCaseIssuePanel(baseFetch(true), {
    projects: [linkedProject],
    onCreate() { planCalls++; },
  });
  try {
    uiWithProject.nodes().find(n => n.type === 'button' && textOf(n) === '记录取舍')!.props.onClick();
    await uiWithProject.settle();
    const findReasonTextarea = () => {
      const lbl = uiWithProject.nodes().find(n => n.type === 'label' && textOf(n).includes('为什么这样选'))!;
      return descendants(lbl).find(n => n.type === 'textarea')!;
    };
    findReasonTextarea().props.onChange({ target: { value: '保留未提交理由草稿' } });
    await uiWithProject.settle();
    const planBtn = uiWithProject.nodes().find(n => n.type === 'button' && textOf(n) === '去准备 Plan Task');
    const handoffBtn = uiWithProject.nodes().find(n => n.type === 'button' && /查看交接与依据/.test(textOf(n)));
    assert.ok(planBtn, 'must offer 去准备 Plan Task when linked active project exists');
    assert.ok(handoffBtn, 'must offer 查看交接与依据 when linked active project exists');
    handoffBtn!.props.onClick();
    await uiWithProject.settle();
    uiWithProject.nodes().find(n => n.type === 'button' && textOf(n) === '记录取舍')!.props.onClick();
    await uiWithProject.settle();
    assert.equal(findReasonTextarea().props.value, '保留未提交理由草稿', 'guiding to handoff must retain unsaved choice draft');
    const freshPlanBtn = uiWithProject.nodes().find(n => n.type === 'button' && textOf(n) === '去准备 Plan Task')!;
    freshPlanBtn.props.onClick();
    await uiWithProject.settle();
    assert.equal(planCalls, 1, `去准备 Plan Task must open task creation with plan intent (draftLog=${JSON.stringify(draftLog)})`);
  } finally { uiWithProject.close(); }
});

test('CF04: caseDeclarationsTool schema & safe tool diagnostics pinpoint exact parameter paths while preserving store codes', async () => {
  const targetSchema = caseDeclarationsTool.parameters.properties.target as any;
  assert.ok(targetSchema && (targetSchema.anyOf || targetSchema.oneOf), 'target schema must define explicit choose/observe variants instead of generic Record<string, unknown>');
  assert.match(caseDeclarationsTool.description, /choose.*strategyRef|expectedPreviousChoiceId/);
  assert.match(caseDeclarationsTool.description, /observe.*authorizationId|feedbackBaseRevisionId/);
  assert.match(caseDeclarationsTool.description, /requestId.*省略|新建/);

  const schemaErr = explainCaseDeclarationError(new Error('Validation failed for tool "case_declare_decision_request": must match schema oneOf')) as Error;
  assert.match(schemaErr.message, /target\.strategyRef|authorizationId|feedbackBaseRevisionId/);

  const dir = mkdtempSync(join(tmpdir(), 'optracall-cf04-'));
  const store = new CaseStore({ dataRoot: join(dir, 'cases') });
  const board = createDecisionBoardStore({ root: join(dir, 'board') });
  const projectId = randomUUID();
  try {
    await store.initialize();
    await board.init();
    const created = store.createCase({ operationId: randomUUID(), title: 'CF04 Case' });
    store.linkProject({ operationId: randomUUID(), caseId: created.id, expectedRevision: store.getCase(created.id).revision, projectId });
    const issue = store.createDecisionIssue({ operationId: randomUUID(), caseId: created.id, expectedRevision: store.getCase(created.id).revision, title: 'Issue CF04' });
    const caseStoreId = store.getStatus().storeId!;
    const strategy = store.saveDecisionDraft({
      operationId: randomUUID(), caseStoreId, caseId: created.id, expectedRevision: 0,
      kind: 'strategy', payload: { title: '方案CF04', proposal: '试行方案' },
    }, { actorKind: 'agent', projectId, taskId: randomUUID(), requestId: randomUUID(), sessionId: 's', toolCallId: 'c' });
    const choice = store.chooseStrategy({
      operationId: randomUUID(), caseStoreId, caseId: created.id, issueId: issue.id,
      strategyRef: { type: 'case-decision', caseStoreId, caseId: created.id, recordId: strategy.recordId, revision: strategy.revision },
      choice: 'trial', expectedPreviousChoiceId: null,
    });
    const arranged = board.arrangeActions({
      operationId: randomUUID(), projectId,
      source: { caseStoreId, caseId: created.id, choiceId: choice.choiceId, strategyRef: choice.strategyRef },
      scope: '验证作用域', title: '验证行动', checks: [], actions: [{ kind: 'create', title: '观察任务' }],
    }, { confirmedIssueId: issue.id });
    const realAct = arranged.actions[0]!;
    const issueService = createCaseIssueService({
      projects: { get: async () => ({ id: projectId, archivedAt: null, tasks: [{ id: realAct.taskId }] }) },
      assertActive() {},
      cases: store,
      board,
      mutate: async (fn: () => unknown) => fn(),
    } as never);

    const badChooseInput = {
      kind: 'choose' as const,
      text: '请对方案取舍',
      target: {
        kind: 'choose' as const,
        strategyRef: { type: 'case-decision' as const, caseStoreId, caseId: created.id, recordId: 'not-a-uuid', revision: 1 },
        expectedPreviousChoiceId: null,
      },
    };
    const chooseRawErr = await issueService.saveDecisionRequest(created.id, {
      operationId: randomUUID(),
      issueId: issue.id,
      expectedRevision: store.getCase(created.id).revision,
      expectedRequestRevision: 0,
      source: { kind: 'agent-tool', ref: 'synthetic/cf04' },
      ...badChooseInput,
    }).then(() => null, e => e);
    const diagnosedChoose = diagnoseCaseDecisionRequestError(chooseRawErr, badChooseInput) as any;
    assert.equal(diagnosedChoose.code, 'invalid_case_decision_id');
    assert.equal(diagnosedChoose.exposure, 'safe-tool-error-v1');
    assert.equal(diagnosedChoose.details.issues[0].path, 'target.strategyRef.recordId');

    const badTaskInput = {
      kind: 'observe' as const,
      text: '请补录观察',
      target: {
        kind: 'observe' as const,
        projectId,
        itemId: realAct.itemId,
        taskId: randomUUID(),
        authorizationId: randomUUID(),
        feedbackBaseRevisionId: null,
      },
    };
    const taskRawErr = await issueService.saveDecisionRequest(created.id, {
      operationId: randomUUID(),
      issueId: issue.id,
      expectedRevision: store.getCase(created.id).revision,
      expectedRequestRevision: 0,
      source: { kind: 'agent-tool', ref: 'synthetic/cf04' },
      ...badTaskInput,
    }).then(() => null, e => e);
    const diagnosedTask = diagnoseCaseDecisionRequestError(taskRawErr, badTaskInput) as any;
    assert.equal(diagnosedTask.code, 'task_not_found');
    assert.equal(diagnosedTask.details.issues[0].path, 'target.taskId');

    const badAuthInput = {
      kind: 'observe' as const,
      text: '请补录观察',
      target: {
        kind: 'observe' as const,
        projectId,
        itemId: realAct.itemId,
        taskId: realAct.taskId,
        authorizationId: randomUUID(),
        feedbackBaseRevisionId: null,
      },
    };
    const observeRawErr = await issueService.saveDecisionRequest(created.id, {
      operationId: randomUUID(),
      issueId: issue.id,
      expectedRevision: store.getCase(created.id).revision,
      expectedRequestRevision: 0,
      source: { kind: 'agent-tool', ref: 'synthetic/cf04' },
      ...badAuthInput,
    }).then(() => null, e => e);
    const diagnosedObserve = diagnoseCaseDecisionRequestError(observeRawErr, badAuthInput) as any;
    assert.equal(diagnosedObserve.code, 'case_do_authorization_unavailable');
    assert.equal(diagnosedObserve.exposure, 'safe-tool-error-v1');
    assert.equal(diagnosedObserve.details.issues[0].path, 'target.authorizationId');

    const badReqInput = { requestId: randomUUID(), expectedRequestRevision: 1, text: '修订不存在请求' };
    const reqRawErr = await issueService.saveDecisionRequest(created.id, {
      operationId: randomUUID(),
      issueId: issue.id,
      expectedRevision: store.getCase(created.id).revision,
      source: { kind: 'agent-tool', ref: 'synthetic/cf04' },
      ...badReqInput,
    }).then(() => null, e => e);
    const diagnosedReq = diagnoseCaseDecisionRequestError(reqRawErr, badReqInput) as any;
    assert.equal(diagnosedReq.code, 'case_decision_request_not_found');
    assert.equal(diagnosedReq.exposure, 'safe-tool-error-v1');
    assert.equal(diagnosedReq.details.issues[0].path, 'requestId');
  } finally {
    store.close();
    board.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('CF05: CasePreparation validates unset scope vs empty personal scope name and distinguishes 4xx rejection from pending replayable attempts', async () => {
  const goalPosts: unknown[] = [], createPosts: unknown[] = [];
  let goalPostStatus = 200;
  let initialScope: any = { kind: 'personal', id: '', name: '' };
  const fetcher: typeof fetch = async (input, init) => {
    const url = String(input);
    if (url.endsWith('/strategy/goals')) {
      if (init?.method === 'POST') {
        goalPosts.push(init.body);
        if (goalPostStatus >= 400) return Response.json({ code: 'invalid_goal', message: '目标内容不符合要求' }, { status: goalPostStatus });
      }
      return Response.json({ goals: [] });
    }
    if (url.endsWith('/workspace/create-case')) { createPosts.push(init?.body); return Response.json({}); }
    if (url.endsWith('/studio/enterprises')) return Response.json({ enterprises: [] });
    if (url.endsWith('/drafts/prepare')) return Response.json({ drafts: [{ kind: 'prepare', id: 'p-missing', revision: 1, payload: { ...emptyPreparePayload(), title: '事名', scope: initialScope, goalDraft: { title: 'G', outcome: 'O', strategies: ['S'], perspective: 'personal', scope: initialScope ?? { kind: 'personal', id: '', name: '' }, measurement: { kind: 'deliverable', criterion: 'C' }, baseline: { state: 'pending', description: 'B' }, responsible: 'R' } }, createdAt: 'now', updatedAt: 'now' }] });
    if (init?.method === 'PUT') return Response.json({ draft: { kind: 'prepare', id: 'p-missing', revision: 2, payload: JSON.parse(String(init.body)).payload } });
    return Response.json({ code: 'not_found' }, { status: 404 });
  };

  // Subcase A: Personal selected, personal name empty
  const ui = await mountCasePrep(fetcher, { expanded: true });
  try {
    ui.nodes().find(n => n.type === 'button' && textOf(n).includes('保存候选、明确采纳'))!.props.onClick();
    await ui.settle();
    assert.equal(goalPosts.length, 0);
    assert.equal(createPosts.length, 0);
    const alert = ui.nodes().find(n => n.props?.role === 'alert');
    assert.ok(alert);
    assert.match(textOf(alert), /个人归属名称/);
    assert.doesNotMatch(textOf(alert), /本地服务暂时不可用|核对原操作并继续|重试保存/);
  } finally { ui.close(); }

  // Subcase B: Definite 400 from Goal creation must NOT claim "核对原操作并继续"
  initialScope = { kind: 'personal', id: 'personal:我', name: '我' };
  goalPostStatus = 400;
  const ui400 = await mountCasePrep(fetcher, { expanded: true });
  try {
    ui400.nodes().find(n => n.type === 'button' && textOf(n).includes('保存候选、明确采纳'))!.props.onClick();
    await ui400.settle();
    assert.equal(goalPosts.length, 1);
    const alertText = textOf(ui400.nodes().find(n => n.props?.role === 'alert'));
    assert.match(alertText, /未能提交保存/);
    assert.doesNotMatch(alertText, /核对原操作并继续/);
  } finally { ui400.close(); }
});

test('CF06: CaseBoard refreshSeq reloads case list, preserves filters, and marks listStale when refresh fails', async () => {
  let cases = [
    { id: 'c-1', title: 'Alpha', status: 'analyzing', revision: 1, description: '', judgement: '', nextStep: '', updatedAt: '2026-11-28T00:00:00Z', createdAt: '2026-11-28T00:00:00Z' },
    { id: 'c-2', title: 'Beta', status: 'analyzing', revision: 1, description: '', judgement: '', nextStep: '', updatedAt: '2026-11-28T00:01:00Z', createdAt: '2026-11-28T00:01:00Z' },
  ];
  let failList = false;
  const fetcher: typeof fetch = async (input) => {
    const url = String(input);
    if (url.endsWith('/api/cases/storage')) return Response.json({ state: 'ready', storeId: 'store-1' });
    if (url.endsWith('/api/cases')) {
      if (failList) return Response.json({ code: 'io_error', message: 'read failed' }, { status: 500 });
      return Response.json({ cases, projectLinks: [] });
    }
    if (url.includes('/api/workspace/case-directory')) return Response.json({ items: [], truncated: false, nextOffset: null });
    if (url.includes('/api/case-relations')) return Response.json({ items: [], continuation: null, hasMore: false, writingEnabled: true });
    return Response.json({});
  };

  const board = await mountCaseBoard(fetcher, { refreshSeq: 0 });
  try {
    assert.match(board.text(), /Alpha/);
    assert.match(board.text(), /Beta/);
    const search = board.nodes().find(n => n.type === 'input' && n.props.type === 'search');
    assert.ok(search, 'CaseBoard search input must exist');

    // New Case created externally (e.g. from CasePreparation); parent bumps refreshSeq
    cases = [...cases, { id: 'c-3', title: 'Gamma 新增', status: 'analyzing', revision: 1, description: '', judgement: '', nextStep: '', updatedAt: '2026-11-28T00:02:00Z', createdAt: '2026-11-28T00:02:00Z' }];
    board.props.refreshSeq = 1;
    board.render();
    await board.settle();
    assert.match(board.text(), /Gamma 新增/, 'CaseBoard must automatically display newly created Case on refreshSeq increment');

    // Subsequent refresh failure sets listStale banner without clearing existing view
    failList = true;
    board.props.refreshSeq = 2;
    board.render();
    await board.settle();
    assert.match(board.text(), /旧快照/);
    assert.match(board.text(), /Gamma 新增/);
  } finally { board.close(); }
});

test('CF07: ProjectNavigation archive/restore/rename buttons include distinguishing project name in accessible name', async () => {
  const projects: ClientProject[] = [
    { schemaVersion: 2, id: 'p-a', name: '同名项目', configuration: { id: 'c', revision: 1, name: 'M', api: 'openai-completions', provider: 'custom', baseUrl: 'https://e.invalid', model: 'm' }, rootPath: '/a', createdAt: '', updatedAt: '', archivedAt: null, tasks: [] },
    { schemaVersion: 2, id: 'p-b', name: '归档项目B', configuration: { id: 'c', revision: 1, name: 'M', api: 'openai-completions', provider: 'custom', baseUrl: 'https://e.invalid', model: 'm' }, rootPath: '/b', createdAt: '', updatedAt: '', archivedAt: '2026-11-28T00:00:00Z', tasks: [] },
  ];
  const nodes = await mountProjectNav(projects);
  const archiveBtn = nodes.find(n => n.type === 'button' && textOf(n) === '归档项目');
  const renameBtn = nodes.find(n => n.type === 'button' && textOf(n) === '重命名');
  const restoreBtn = nodes.find(n => n.type === 'button' && textOf(n) === '恢复项目');
  assert.ok(archiveBtn?.props['aria-label']?.includes('同名项目'), 'archive button aria-label must include project name');
  assert.ok(renameBtn?.props['aria-label']?.includes('同名项目'), 'rename button aria-label must include project name');
  assert.ok(restoreBtn?.props['aria-label']?.includes('归档项目B'), 'restore button aria-label must include project name');
});

test('FR01: watchStrategyDiscussion eventIdleTimeoutMs ignores comment heartbeats and BusinessRoleConversation recovers missing terminal events via bounded read-only GET', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });

  // 1. Direct watchStrategyDiscussion eventIdleTimeoutMs test past sustained heartbeats
  {
    let hbController: ReadableStreamDefaultController<Uint8Array> | undefined;
    let aborted = false;
    t.mock.method(globalThis, 'fetch', async (_input: string | URL | Request, init?: RequestInit) => {
      return new Response(new ReadableStream<Uint8Array>({
        start(s) {
          hbController = s;
          s.enqueue(new TextEncoder().encode(': role connection\n\n'));
          init?.signal?.addEventListener('abort', () => { aborted = true; try { s.close(); } catch {} }, { once: true });
        },
      }), { headers: { 'content-type': 'text/event-stream' } });
    });
    const ac = new AbortController();
    const errPromise = assert.rejects(
      () => watchStrategyDiscussion('disc-hb', () => {}, ac.signal, '/api/strategy/discussions/disc-hb/events', {
        idleTimeoutMs: 500,
        eventIdleTimeoutMs: 50,
      }),
      (err: unknown) => err instanceof StrategyDiscussionRequestError && err.code === 'strategy_discussion_events_timeout',
    );
    await new Promise(r => setImmediate(r));
    for (let i = 0; i < 6 && !aborted; i++) {
      t.mock.timers.tick(15);
      if (!aborted && hbController) { try { hbController.enqueue(new TextEncoder().encode(': heartbeat\n\n')); } catch {} }
      await new Promise(r => setImmediate(r));
    }
    await errPromise;
    assert.ok(aborted, 'heartbeat-only stream without data events must trip eventIdleTimeoutMs');
    t.mock.restoreAll();
    t.mock.timers.reset();
    t.mock.timers.enable({ apis: ['setTimeout'] });
  }

  // 2. Sustained open heartbeat stream with missing terminal event: slow busy run stays running, then recovers when backend completes, without closing SSE; bounded GET errors stop and keep 核对原操作
  const ownerCase = { role: 'case', caseId: 'case-hb', itemId: 'issue-hb' };
  const discussionId = 'disc-hb-reconcile';
  let backendStatus: 'idle' | 'running' | 'completed' = 'idle';
  let failGetReads = false;
  let sentRequestId = '';
  let sseReads = 0;
  let getCountAfterSend = 0;
  const writes: string[] = [];

  const fetcher: typeof fetch = async (input, init) => {
    const url = new URL(String(input), 'http://localhost');
    const method = init?.method ?? 'GET';
    if (url.pathname === '/api/configurations') return Response.json({ configurations: [{ id: 'cfg-1', revision: 1, name: 'Synth', model: 'synth', hasApiKey: true }], selectedId: 'cfg-1' });
    if (url.pathname.startsWith('/api/workspace/drafts/')) {
      if (method === 'GET') return Response.json({ code: 'not_found' }, { status: 404 });
      return Response.json({ draft: { kind: 'issue-draft', id: url.pathname.split('/').pop(), revision: 1, payload: JSON.parse(String(init?.body)).payload } });
    }
    if (url.pathname === '/api/business-role') {
      const action = url.searchParams.get('action');
      if (method !== 'GET') writes.push(`${action}`);
      if (action === 'events') {
        sseReads++;
        const initialSnap = { sessionId: 'sess-hb', sdkVersion: '1.4.0', status: 'idle', messages: [], tools: [] };
        return new Response(new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({ type: 'snapshot', snapshot: initialSnap })}\n\n`));
            init?.signal?.addEventListener('abort', () => { try { controller.close(); } catch {} }, { once: true });
          },
        }), { headers: { 'content-type': 'text/event-stream' } });
      }
      if (action === 'messages' && method === 'POST') {
        const body = JSON.parse(String(init?.body));
        sentRequestId = body.requestId;
        backendStatus = 'running';
        return Response.json({ discussion: { id: discussionId, revision: 1, configurationId: 'cfg-1', configurationRevision: 1 }, requestId: sentRequestId }, { status: 202 });
      }
      if (action === 'stop') throw new Error('must never auto-stop');
      if (sentRequestId) getCountAfterSend++;
      if (failGetReads) return Response.json({ message: '角色读取暂不可用' }, { status: 503 });
      const busy = backendStatus === 'running';
      const messages = backendStatus === 'completed' ? [{ role: 'user', content: '心跳漏终态复核' }, { role: 'assistant', content: '心跳转回读恢复全文' }] : [];
      return Response.json({
        discussion: {
          id: discussionId, revision: 1, configurationId: 'cfg-1', configurationRevision: 1,
          lastRun: sentRequestId ? { id: sentRequestId, status: backendStatus === 'completed' ? 'completed' : 'accepted' } : undefined,
        },
        busy,
        snapshot: { sessionId: 'sess-hb', sdkVersion: '1.4.0', status: busy ? 'running' : 'idle', messages, tools: [] },
        requestReceipt: sentRequestId ? { requestId: sentRequestId, originalUserText: '心跳漏终态复核', nativeEntryId: 'entry-hb-1', sessionId: 'sess-hb' } : undefined,
      });
    }
    return Response.json({});
  };

  const ui = await mountBusinessRole(fetcher, ownerCase);
  try {
    const textarea = ui.nodes().find(n => n.type === 'textarea')!;
    textarea.props.onChange({ target: { value: '心跳漏终态复核' } });
    await ui.settle();
    const form = ui.nodes().find(n => n.type === 'form')!;
    form.props.onSubmit({ preventDefault() {} });
    await ui.settle();
    assert.match(ui.text(), /正在回复/);

    // Backend stays genuinely running across 2 reconciliation checks (7s): UI must NOT falsely fail or stop
    for (const ms of [3500, 3500]) { t.mock.timers.tick(ms); await ui.settle(6); }
    assert.match(ui.text(), /正在回复/, 'slow running backend must stay 正在回复… without premature failure');
    assert.doesNotMatch(ui.text(), /暂未恢复|暂不可用/);
    assert.equal(sseReads, 1, 'SSE stream stayed open without churn while slow Agent is running');

    // Now backend finishes while SSE remains open without emitting terminal event
    backendStatus = 'completed';
    t.mock.timers.tick(3500);
    await ui.settle(8);
    assert.doesNotMatch(ui.text(), /正在回复/, 'UI must settle immediately after read-only reconciliation discovers completion');
    assert.match(ui.text(), /心跳转回读恢复全文/, 'UI must render recovered full reply');
    assert.deepEqual(writes, ['messages'], 'must never auto-stop or replay messages');

    // Now test bounded GET failure during a subsequent in-flight run: 4 consecutive GET 503s must stop polling & show safe prompt + 核对原操作
    sentRequestId = '';
    getCountAfterSend = 0;
    const textarea2 = ui.nodes().find(n => n.type === 'textarea')!;
    textarea2.props.onChange({ target: { value: '核对GET有界失败' } });
    await ui.settle();
    ui.nodes().find(n => n.type === 'form')!.props.onSubmit({ preventDefault() {} });
    await ui.settle();
    failGetReads = true;
    const getsBeforeFail = getCountAfterSend;
    for (const ms of [3500, 500, 1500, 3000, 3500, 3500]) { t.mock.timers.tick(ms); await ui.settle(6); }
    const getsDuringFail = getCountAfterSend - getsBeforeFail;
    assert.equal(getsDuringFail, 4, `bounded GET failures must stop after 4 attempts (1 + 3 backoff retries), got ${getsDuringFail}`);
    assert.match(ui.text(), /角色读取暂不可用/);
    assert.ok(ui.nodes().some(n => n.type === 'button' && textOf(n) === '核对原操作'), 'must retain 核对原操作 button after bounded GET failure');
    assert.deepEqual(writes, ['messages', 'messages'], 'failed GET reconciliation must never replay messages or stop');
  } finally { ui.close(); }
});
