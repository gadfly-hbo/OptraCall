import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import './fixtures/register-ui.ts';

const { groupConversation, messageIdentity, foldStore, Foldable, ProcessGroup } = await import('../src/host/ui/conversation-collapse.tsx');
const { StrategyDiscussionTranscript } = await import('../src/host/ui/StrategyDiscussionReply.tsx');
type NativeMessage = import('../src/host/ui/project-types.ts').NativeMessage;

const text = (value: string): NativeMessage => ({ role: 'assistant', content: value });
const call = (id: string, name: string): NativeMessage => ({ role: 'assistant', content: [{ type: 'toolCall', id, name }] });
const result = (id: string, name: string, output: string, isError = false): NativeMessage => ({ role: 'toolResult', toolCallId: id, toolName: name, content: output, isError });
const bash = (command: string, output: string): NativeMessage => ({ role: 'bashExecution', command, output });

test('groupConversation keeps a mixed turn as user → single process group → body reply', () => {
  const items = groupConversation([
    { role: 'user', content: '看一下上个月复购。' },
    call('c1', 'read_input'),
    result('c1', 'read_input', '12,480 行'),
    call('c2', 'semantic_graph'),
    result('c2', 'semantic_graph', '命中 3 条'),
    { ...text('结论：回落主要来自家清。'), nativeEntryId: 'e-9' },
  ], { includeToolDetails: true });
  assert.deepEqual(items.map(item => item.kind), ['user', 'process', 'body']);
  const group = items[1]!;
  assert.equal(group.kind, 'process');
  assert.equal(group.steps.length, 2, 'call + paired result counts as one step each');
  assert.deepEqual(group.steps.map(step => step.toolName), ['read_input', 'semantic_graph']);
  assert.equal(group.steps[1]!.isError, false);
  assert.equal(group.steps[1]!.output, '命中 3 条');
  const body = items[2]!;
  assert.equal(body.kind, 'body');
  assert.equal(body.identity, 'native:e-9');
});

test('tool-only turn renders as process only: no empty body, no blank agent block source', () => {
  const items = groupConversation([
    { role: 'user', content: '继续核对。' },
    call('c1', 'strategy_goals'),
    result('c1', 'strategy_goals', '读取目标准确版 v3'),
  ]);
  assert.deepEqual(items.map(item => item.kind), ['user', 'process']);
  assert.equal(items.some(item => item.kind === 'body' || item.kind === 'custom'), false);
});

test('each turn groups separately and bodies split process segments inside one turn', () => {
  const items = groupConversation([
    { role: 'user', content: '第一轮。' },
    call('a', 'read_input'),
    result('a', 'read_input', 'ok'),
    text('中间阶段正文：口径已核对。'),
    call('b', 'semantic_graph'),
    result('b', 'semantic_graph', 'ok'),
    text('最终正文。'),
    { role: 'user', content: '第二轮。' },
    bash('python3 x.py', 'done'),
  ], { includeToolDetails: true });
  assert.deepEqual(items.map(item => item.kind), ['user', 'process', 'body', 'process', 'body', 'user', 'process']);
  const first = items[1]!, second = items[3]!, third = items[6]!;
  assert.equal(first.kind === 'process' && first.steps.length, 1);
  assert.equal(second.kind === 'process' && second.steps.length, 1);
  assert.equal(third.kind === 'process' && third.steps[0]!.command, 'python3 x.py');
  assert.notEqual(first.identity, second.identity);
});

test('step counting: unpaired call, standalone result and note entries each count one step', () => {
  const items = groupConversation([
    { role: 'user', content: '问' },
    call('c1', 'never_answered'),
    { role: 'toolResult', toolName: 'legacy_bash', content: '旧 bash 结果' },
    { role: 'assistant', content: [{ type: 'thinking', text: '先核对口径再计算。' }] },
  ]);
  const group = items.find(item => item.kind === 'process')!;
  assert.equal(group.kind === 'process' && group.steps.length, 3);
  const [unpaired, standalone, note] = group.kind === 'process' ? group.steps : [];
  assert.equal(unpaired!.toolName, 'never_answered');
  assert.equal(unpaired!.pending, true);
  assert.equal(standalone!.toolName, 'legacy_bash');
  assert.equal(note!.kind, 'note');
  assert.equal('text' in note!, false, 'internal reasoning does not become UI content');
});

test('process group identity follows the first native entry across changes in prior messages', () => {
  const target = { ...call('target', 'read_input'), nativeEntryId: 'tool-entry' };
  const initial = groupConversation([{ role: 'user', content: '问题' }, target]);
  const moved = groupConversation([{ role: 'user', content: '更早的提问' }, text('更早的回答'), { role: 'user', content: '问题' }, target]);
  assert.equal(initial.find(item => item.kind === 'process')?.identity, moved.find(item => item.kind === 'process')?.identity);
});

test('a tool result paired across a body boundary remains available to external result controls', () => {
  const items = groupConversation([
    { role: 'assistant', content: [{ type: 'text', text: '阶段正文' }, { type: 'toolCall', id: 'c1', name: 'simlab' }] },
    result('c1', 'simlab', '固化建议'),
    text('最终正文'),
  ], { includeToolDetails: true });
  assert.deepEqual(items.map(item => item.kind), ['process', 'body', 'body']);
  const process = items[0]!;
  assert.equal(process.kind, 'process');
  assert.deepEqual(process.entries.map(entry => entry.index), [0, 1]);
  assert.equal(process.steps[0]?.output, '固化建议');
});

test('failed tool result keeps error flag for status visibility', () => {
  const items = groupConversation([
    { role: 'user', content: '问' },
    call('c1', 'semantic_graph'),
    result('c1', 'semantic_graph', 'timeout', true),
  ]);
  const group = items.find(item => item.kind === 'process')!;
  assert.equal(group.kind === 'process' && group.steps[0]!.isError, true);
});

test('custom display messages stay outside process groups', () => {
  const items = groupConversation([
    { role: 'user', content: '问' },
    { role: 'custom', customType: 'optracall.run', display: true, content: '扩展消息' },
    call('c1', 'read_input'),
    result('c1', 'read_input', 'ok'),
  ]);
  assert.deepEqual(items.map(item => item.kind), ['user', 'custom', 'process']);
});

test('messageIdentity separates identical text with different native ids and stays stable otherwise', () => {
  const same = '完全相同的回复文本。';
  const a = messageIdentity({ ...text(same), nativeEntryId: 'entry-1' }, 3);
  const b = messageIdentity({ ...text(same), nativeEntryId: 'entry-2' }, 4);
  assert.notEqual(a, b);
  assert.equal(messageIdentity(text('x'), 5), messageIdentity(text('x'), 5));
  assert.match(messageIdentity(text('y'), 6), /^#6:assistant:/);
});

test('foldStore defaults to memory backing outside browsers and round-trips choices', () => {
  foldStore.set('conv-a', 'm1', 'expanded');
  foldStore.set('conv-b', 'm1', 'collapsed');
  assert.equal(foldStore.get('conv-a', 'm1'), 'expanded');
  assert.equal(foldStore.get('conv-b', 'm1'), 'collapsed');
  assert.equal(foldStore.get('conv-c', 'm1'), undefined, 'different conversations stay independent');
});

test('Foldable keeps content in the server markup before browser overflow measurement', () => {
  const html = renderToStaticMarkup(createElement(Foldable, { conversationKey: 'k', identity: 'i1', lines: 5, children: createElement('p', null, '长内容') }));
  assert.match(html, /class="fold"/);
  assert.match(html, /<p>长内容<\/p>/);
  assert.doesNotMatch(html, /fold-toggle/);
});

test('ProcessGroup renders one collapsed line with step count and hidden steps', () => {
  const steps = [{ key: 's1', kind: 'tool' as const, toolName: 'read_input', output: 'ok' }, { key: 's2', kind: 'tool' as const, toolName: 'bash', command: 'ls', output: 'x' }];
  const html = renderToStaticMarkup(createElement(ProcessGroup, { conversationKey: 'k', identity: 'p1', steps }));
  assert.match(html, /推理过程/);
  assert.match(html, /· 2 步/);
  assert.match(html, /aria-expanded="false"/);
  assert.match(html, /hidden=""/);
  assert.match(html, /read_input/);
  foldStore.set('k', 'p1', 'expanded');
  const expanded = renderToStaticMarkup(createElement(ProcessGroup, { conversationKey: 'k', identity: 'p1', steps }));
  assert.match(expanded, /aria-expanded="true"/);
  assert.doesNotMatch(expanded, /hidden=""/);
});

test('StrategyDiscussionTranscript drops blank agent blocks and shows branded author rows', () => {
  const messages: NativeMessage[] = [
    { role: 'user', content: '战略问题（长）' },
    call('c1', 'strategy_goals'),
    result('c1', 'strategy_goals', '读取目标'),
    { ...text('两条路线的关键前提对照。'), nativeEntryId: 'e-1' },
  ];
  const html = renderToStaticMarkup(createElement(StrategyDiscussionTranscript, { messages, conversationKey: 'discussion:d-1', modelLabel: 'synthetic-demo' }));
  assert.doesNotMatch(html, /<strong>Agent<\/strong>/, 'plain Agent label replaced by branded author row');
  assert.match(html, /brand-mark/);
  assert.match(html, /OptraCall/);
  assert.match(html, /synthetic-demo/);
  assert.match(html, /推理过程/);
  assert.match(html, /· 1 步/);
  assert.match(html, /两条路线的关键前提对照。/);
  assert.match(html, /<strong>你<\/strong>/, 'user label stays');
});

test('the shared discussion transcript shows outcome metadata without projecting raw tool data or reasoning', () => {
  const messages: NativeMessage[] = [
    { role: 'user', content: '问' },
    { role: 'assistant', content: [{ type: 'thinking', text: 'synthetic-hidden-reasoning' }], stopReason: 'aborted' },
    call('c1', 'strategy_goals'),
    result('c1', 'strategy_goals', 'synthetic-hidden-result', true),
    { ...text('部分输出'), stopReason: 'error' },
  ];
  const html = renderToStaticMarkup(createElement(StrategyDiscussionTranscript, { messages }));
  assert.doesNotMatch(html, /synthetic-hidden/);
  assert.match(html, /strategy_goals/);
  assert.match(html, /1 步失败/);
  assert.match(html, /<p class="message-meta">已停止/);
  assert.match(html, /<p class="message-meta failed-meta">此条回复未完成/);
});

test('StrategyDiscussionTranscript keeps streaming replies unfolded and citation rows outside folds', () => {
  const messages: NativeMessage[] = [
    { role: 'user', content: '问' },
    { ...text('正文'), nativeEntryId: 'e-1' },
  ];
  const html = renderToStaticMarkup(createElement(StrategyDiscussionTranscript, {
    messages,
    streaming: '正在输出的流式内容',
    discussionId: 'd-1',
    conversationKey: 'discussion:d-1',
    references: [{ requestId: 'r-1', entryId: 'e-1', citations: [{ source: { id: 's-1', title: '会员经营月报', target: {}, sha256: '0'.repeat(64), version: 1 }, locator: '会员月报 · p.4', token: 't1' }] }],
  }));
  const streaming = html.split('正在输出的流式内容')[0]!;
  assert.doesNotMatch(streaming.slice(-400), /fold collapsed/, 'streaming article is not wrapped in a fold');
  assert.match(html, /正在输出的流式内容/);
  assert.match(html, /aria-label="本回复引用的资料"/);
  assert.match(html, /会员月报 · p\.4/);
  const citationAfter = html.split('正文')[1]!.indexOf('会员月报 · p.4') >= 0;
  assert.equal(citationAfter, true, 'citations render after the reply body');
});
