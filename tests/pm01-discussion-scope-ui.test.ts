import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createElement, isValidElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import './fixtures/register-ui.ts';
import { createStrategyDiscussion, readStrategyDiscussion, updateStrategyDiscussion, discussionJournal, StrategyDiscussionRequestError } from '../src/host/ui/strategy-discussion-client.ts';
import type { StrategyDiscussionBackgroundSelection } from '../src/host/ui/StrategyDiscussionPanel.tsx';
import type { StrategyDiscussionSource } from '../src/host/strategy-discussion-types.ts';

// Public seams: the actual discussion Panel/controlled background controls, and
// the existing HTTP client + exact pending journal. No Host, SDK or model starts.
const evidence = await (async () => {
  const parent = path.resolve('.local/v12-pm01-fix/ui-implementation');
  await mkdir(parent, { recursive: true });
  return mkdtemp(path.join(parent, 'scope-ui-'));
})();

function native(tree: unknown, type: string, id: string): any {
  if (Array.isArray(tree)) return tree.map(item => native(item, type, id)).find(Boolean);
  if (!isValidElement(tree)) return;
  const props = tree.props as { id?: string; children?: unknown };
  return tree.type === type && props.id === id ? tree : native(props.children, type, id);
}

test('PM-V12-01: the real discussion Panel distinguishes an absent project from an explicitly selected background range', async t => {
  const { StrategyDiscussionPanel } = await import('../src/host/ui/StrategyDiscussionPanel.tsx');
  const html = renderToStaticMarkup(createElement(StrategyDiscussionPanel, {
    active: false, projects: [], configurations: [], onReviewCandidate() {}, async onGoalsChanged() {}, onSettings() {},
  }));
  await writeFile(path.join(evidence, 'panel-no-project.html'), html);
  t.diagnostic(evidence);
  assert.match(html, /本次背景使用范围/);
  assert.match(html, /尚未明确资料项目：不开放项目背景/);
  assert.match(html, /<select[^>]*disabled=""[^>]*>[\s\S]*?仅使用我手选的资料/);
});

test('PM-V12-01: choosing an explicit project for a new discussion sends and reopens project-background with no hand-picked sources', async t => {
  const { StrategyDiscussionBackground } = await import('../src/host/ui/StrategyDiscussionPanel.tsx');
  let selection: StrategyDiscussionBackgroundSelection = { projectId: '', sources: [] };
  const tree = StrategyDiscussionBackground({ id: 'background', selection, projects: [], locked: false, isExistingDiscussion: false, onChange(value: StrategyDiscussionBackgroundSelection) { selection = value; }, onList() {} });
  native(tree, 'select', 'background-project').props.onChange({ target: { value: 'project-member-repeat' } });
  assert.deepEqual(selection, { projectId: 'project-member-repeat', sources: [], sourceScope: { mode: 'project-background' } });
  const calls: { method: string; input?: any }[] = [];
  let saved: any;
  t.mock.method(globalThis, 'fetch', async (_resource: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ method: init?.method || 'GET', ...(init?.body ? { input: JSON.parse(String(init.body)) } : {}) });
    if (init?.method === 'POST') { const input = JSON.parse(String(init.body)); saved = { ...input, id: input.operationId, revision: 1 }; return Response.json({ discussion: saved }, { status: 201 }); }
    return Response.json({ discussion: saved });
  });
  await createStrategyDiscussion({ operationId: 'scope-discussion', ...selection });
  const reopened = await readStrategyDiscussion('scope-discussion');
  assert.equal(reopened.discussion.sourceScope?.mode, 'project-background');
  assert.deepEqual(reopened.discussion.sources, []);
  assert.deepEqual(calls, [{ method: 'POST', input: { operationId: 'scope-discussion', projectId: 'project-member-repeat', sources: [], sourceScope: { mode: 'project-background' } } }, { method: 'GET' }]);
  await writeFile(path.join(evidence, 'new-project-client-reopen.json'), JSON.stringify({ calls, reopened }, null, 2));
});

const originalPlan: StrategyDiscussionSource = { id: 'plan-v1', title: '经营计划', target: { kind: 'project-document', projectId: 'project-member-repeat', path: '020_clean/经营计划.md' }, sha256: 'a'.repeat(64), version: 1 };
const changedPlan: StrategyDiscussionSource = { ...originalPlan, id: 'plan-v2', sha256: 'b'.repeat(64), version: 2 };

test('PM-V12-01: explicit exclusion removes a preferred resource, preserves its full exact ref and still excludes its later version', async () => {
  const { StrategyDiscussionBackground } = await import('../src/host/ui/StrategyDiscussionPanel.tsx');
  let selection: StrategyDiscussionBackgroundSelection = { projectId: 'project-member-repeat', sources: [originalPlan], sourceScope: { mode: 'project-background' } };
  const render = (source: StrategyDiscussionSource) => StrategyDiscussionBackground({ id: 'background', selection, projects: [], availableSources: [source], locked: false, isExistingDiscussion: true, onChange(value: StrategyDiscussionBackgroundSelection) { selection = value; }, onList() {} });
  const before = render(originalPlan);
  const exclusion = native(before, 'input', 'background-exclude-0');
  assert.ok(exclusion, 'the user needs a distinct explicit exclusion control, not an unchecked preference');
  exclusion.props.onChange({ target: { checked: true } });
  assert.deepEqual(selection.sources, []);
  assert.deepEqual(selection.sourceScope, { mode: 'project-background', excludedSources: [originalPlan] });
  const changed = render(changedPlan);
  assert.equal(native(changed, 'input', 'background-exclude-0').props.checked, true);
  assert.equal(native(changed, 'input', 'background-use-0').props.disabled, true);
  assert.equal(native(changed, 'input', 'background-use-0').props.checked, false);
  native(changed, 'input', 'background-exclude-0').props.onChange({ target: { checked: false } });
  assert.deepEqual(selection.sourceScope?.excludedSources, []);
  await writeFile(path.join(evidence, 'exclusion-version-controls.json'), JSON.stringify({ originalPlan, changedPlan, afterExplicitRemoval: selection }, null, 2));
});

test('PM-V12-01: selected-only with an empty list stays empty, while mode changes preserve exact preferences and exclusions', async () => {
  const { StrategyDiscussionBackground } = await import('../src/host/ui/StrategyDiscussionPanel.tsx');
  const excluded: StrategyDiscussionSource = { id: 'excluded-note', title: '排除的访谈', target: { kind: 'project-document', projectId: 'project-member-repeat', path: '020_clean/访谈.md' }, sha256: 'c'.repeat(64), version: 7 };
  let selection: StrategyDiscussionBackgroundSelection = { projectId: 'project-member-repeat', sources: [originalPlan], sourceScope: { mode: 'project-background', excludedSources: [excluded] } };
  let directoryReads = 0;
  const props = () => ({ id: 'background', selection, projects: [], availableSources: [], locked: false, onChange(value: StrategyDiscussionBackgroundSelection) { selection = value; }, onList() { directoryReads++; } });
  native(StrategyDiscussionBackground(props()), 'select', 'background-source-mode').props.onChange({ target: { value: 'selected-only' } });
  assert.deepEqual(selection, { projectId: 'project-member-repeat', sources: [originalPlan], sourceScope: { mode: 'selected-only', excludedSources: [excluded] } });
  selection = { ...selection, sources: [], sourceScope: { mode: 'selected-only' } };
  const html = renderToStaticMarkup(createElement(StrategyDiscussionBackground, props()));
  assert.match(html, /本次仅限 0 份手选背景/);
  assert.match(html, /空清单表示本次不使用项目背景，不自动转为项目范围/);
  assert.match(html, /当前项目没有可用的背景目录项/);
  assert.match(html, /<option value="selected-only" selected="">/);
  assert.equal(directoryReads, 0, 'rendering or empty sources cannot initiate discovery or read a body');
  await writeFile(path.join(evidence, 'selected-only-empty.html'), html);
});

test('PM-V12-01: hand picking remains optional preference in project-background and becomes the only list after explicit selected-only', async () => {
  const { StrategyDiscussionBackground } = await import('../src/host/ui/StrategyDiscussionPanel.tsx');
  let selection: StrategyDiscussionBackgroundSelection = { projectId: 'project-member-repeat', sources: [], sourceScope: { mode: 'project-background' } };
  const props = () => ({ id: 'background', selection, projects: [], availableSources: [originalPlan], locked: false, onChange(value: StrategyDiscussionBackgroundSelection) { selection = value; }, onList() {} });
  native(StrategyDiscussionBackground(props()), 'input', 'background-use-0').props.onChange({ target: { checked: true } });
  assert.deepEqual(selection, { projectId: 'project-member-repeat', sources: [originalPlan], sourceScope: { mode: 'project-background' } });
  assert.match(renderToStaticMarkup(createElement(StrategyDiscussionBackground, props())), /经营计划 · v1 · 优先参考/);
  native(StrategyDiscussionBackground(props()), 'select', 'background-source-mode').props.onChange({ target: { value: 'selected-only' } });
  assert.deepEqual(selection, { projectId: 'project-member-repeat', sources: [originalPlan], sourceScope: { mode: 'selected-only' } });
  assert.match(renderToStaticMarkup(createElement(StrategyDiscussionBackground, props())), /经营计划 · v1 · 本次使用/);
  native(StrategyDiscussionBackground(props()), 'input', 'background-use-0').props.onChange({ target: { checked: false } });
  assert.deepEqual(selection, { projectId: 'project-member-repeat', sources: [], sourceScope: { mode: 'selected-only' } });
});

test('PM-V12-01: an old discussion without sourceScope stays selected-only on reopen and project changes do not widen it', async t => {
  const { StrategyDiscussionBackground } = await import('../src/host/ui/StrategyDiscussionPanel.tsx');
  const calls: string[] = [];
  t.mock.method(globalThis, 'fetch', async (_resource: RequestInfo | URL, init?: RequestInit) => { calls.push(init?.method || 'GET'); return Response.json({ discussion: { id: 'legacy-discussion', projectId: 'old-project', sources: [originalPlan] } }); });
  const readback = await readStrategyDiscussion('legacy-discussion');
  assert.equal(readback.discussion.sourceScope, undefined);
  let selection: StrategyDiscussionBackgroundSelection = { projectId: readback.discussion.projectId!, sources: readback.discussion.sources, sourceScope: readback.discussion.sourceScope };
  const props = () => ({ id: 'background', selection, projects: [], locked: false, isExistingDiscussion: true, onChange(value: StrategyDiscussionBackgroundSelection) { selection = value; }, onList() {} });
  const html = renderToStaticMarkup(createElement(StrategyDiscussionBackground, props()));
  assert.match(html, /原讨论保持原手选范围/);
  assert.match(html, /<option value="selected-only" selected="">/);
  assert.equal(native(StrategyDiscussionBackground(props()), 'input', 'background-use-0').props.checked, true, 'the original manual reference remains visible before opening discovery');
  native(StrategyDiscussionBackground(props()), 'select', 'background-project').props.onChange({ target: { value: 'new-project' } });
  assert.deepEqual(selection, { projectId: 'new-project', sources: [], sourceScope: { mode: 'selected-only' } });
  assert.deepEqual(calls, ['GET'], 'rendering, reopening and editing are not an automatic model or update request');
  native(StrategyDiscussionBackground(props()), 'select', 'background-source-mode').props.onChange({ target: { value: 'project-background' } });
  assert.equal(selection.sourceScope?.mode, 'project-background', 'only an explicit mode change widens the old selected-only range');
  await writeFile(path.join(evidence, 'legacy-reopen.json'), JSON.stringify({ readback, html, calls, explicitAdjustment: selection }, null, 2));
});

test('PM-V12-01: a lost CAS scope update keeps its original full-ref journal and recovery only reads the same operation', async t => {
  const { StrategyDiscussionBackground } = await import('../src/host/ui/StrategyDiscussionPanel.tsx');
  let selection: StrategyDiscussionBackgroundSelection = { projectId: 'project-member-repeat', sources: [], sourceScope: { mode: 'project-background', excludedSources: [originalPlan] } };
  const tree = StrategyDiscussionBackground({ id: 'background', selection, projects: [], locked: false, onChange(value: StrategyDiscussionBackgroundSelection) { selection = value; }, onList() {} });
  native(tree, 'select', 'background-source-mode').props.onChange({ target: { value: 'selected-only' } });
  const original = { kind: 'update' as const, discussionId: 'exact-owner', input: { expectedRevision: 12, projectId: selection.projectId, sources: selection.sources, sourceScope: selection.sourceScope } };
  const memory = new Map<string, string>();
  const storage = { getItem: (key: string) => memory.get(key) || null, setItem: (key: string, value: string) => { memory.set(key, value); }, removeItem: (key: string) => { memory.delete(key); } };
  const journal = discussionJournal(storage); journal.remember(original);
  const before = [...memory.entries()];
  const calls: { url: string; method: string; input?: unknown }[] = [];
  t.mock.method(globalThis, 'fetch', async (resource: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(resource), method: init?.method || 'GET', ...(init?.body ? { input: JSON.parse(String(init.body)) } : {}) });
    if (init?.method === 'PATCH') throw new TypeError('synthetic response lost after possible persistence');
    return Response.json({ discussion: { id: 'exact-owner', revision: 13, projectId: selection.projectId, sources: [], sourceScope: { mode: 'selected-only', excludedSources: [originalPlan] } } });
  });
  await assert.rejects(updateStrategyDiscussion(original.discussionId, original.input), fault => fault instanceof StrategyDiscussionRequestError && fault.uncertain);
  const resumed = discussionJournal(storage).read();
  assert.deepEqual(resumed, original);
  assert.deepEqual([...memory.entries()], before, 'no unresolved operation is silently replaced, widened or replayed');
  const actual = await readStrategyDiscussion(original.discussionId);
  assert.equal(actual.discussion.revision, 13);
  assert.deepEqual(actual.discussion.sourceScope, { mode: 'selected-only', excludedSources: [originalPlan] });
  assert.deepEqual(calls, [
    { url: '/api/strategy/discussions/exact-owner', method: 'PATCH', input: { expectedRevision: 12, projectId: 'project-member-repeat', sources: [], sourceScope: { mode: 'selected-only', excludedSources: [originalPlan] } } },
    { url: '/api/strategy/discussions/exact-owner', method: 'GET' },
  ]);
  assert.deepEqual([...memory.entries()], before, 'a GET alone cannot settle an unknown write');
  await writeFile(path.join(evidence, 'scope-cas-lost-response.json'), JSON.stringify({ before, resumed, actual, calls }, null, 2));
});

test('PM-V12-01: pending or running controls cannot edit the project, mode or source choices', async () => {
  const { StrategyDiscussionBackground } = await import('../src/host/ui/StrategyDiscussionPanel.tsx');
  const selection: StrategyDiscussionBackgroundSelection = { projectId: 'project-member-repeat', sources: [originalPlan], sourceScope: { mode: 'selected-only' } };
  const tree = StrategyDiscussionBackground({ id: 'background', selection, projects: [], availableSources: [originalPlan], locked: true, onChange() { assert.fail('no control is dispatched by rendering'); }, onList() { assert.fail('no read is dispatched by rendering'); } });
  for (const [type, id] of [['select', 'background-project'], ['select', 'background-source-mode'], ['input', 'background-use-0'], ['input', 'background-exclude-0']]) assert.equal(native(tree, type, id).props.disabled, true);
});
