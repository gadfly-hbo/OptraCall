import test from 'node:test';
import assert from 'node:assert/strict';
import { createState, isBusy, reduceChat, validateConfig, type ChatState, type PresentationEvent } from '../src/host/ui/chat-state.ts';

function projectState(id: string, modelLabel = '演示模型') {
  return reduceChat(createState(), { type: 'create-project', sessionId: id, name: `项目 ${id}`, modelLabel });
}
function conversation(state: ChatState, id = 'a') {
  const found = state.projects.find(item => item.id === id);
  assert.ok(found);
  return found;
}
function sent() {
  return reduceChat(projectState('a'), { type: 'send', sessionId: 'a', requestId: 'r1', text: '  你好  ' });
}
function event(state: ChatState, value: Omit<PresentationEvent, 'sessionId' | 'requestId'> & { text?: string; outcome?: 'completed' | 'cancelled' | 'failed'; error?: string }) {
  return reduceChat(state, { type: 'event', event: { sessionId: 'a', requestId: 'r1', ...value } as PresentationEvent });
}

test('UI-01: sending trims input, preserves user text and starts one request', () => {
  const initial = projectState('a');
  const state = sent();
  assert.equal(conversation(state).messages[0]?.text, '你好');
  assert.equal(conversation(state).messages[1]?.role, 'assistant');
  assert.equal(conversation(state).status, 'running');
  assert.equal(conversation(initial).messages.length, 0);
  assert.equal(reduceChat(state, { type: 'send', sessionId: 'a', requestId: 'r2', text: '重复' }), state);
});
test('UI-02: late and mismatched events cannot mutate another request or session', () => {
  const state = sent();
  assert.equal(reduceChat(state, { type: 'event', event: { type: 'text.delta', sessionId: 'a', requestId: 'wrong', text: '串流' } }), state);
  const switched = reduceChat(state, { type: 'create-project', sessionId: 'b', name: '项目 B', modelLabel: '模型 B' });
  const updated = event(switched, { type: 'text.delta', text: '只属于 A' });
  assert.equal(updated.activeId, 'b');
  assert.equal(conversation(updated, 'b').messages.length, 0);
  assert.equal(conversation(updated).messages[1]?.text, '只属于 A');
});
test('UI-01: stop is pending until acknowledged and keeps partial output and draft', () => {
  let state = event(sent(), { type: 'text.delta', text: '部分回答' });
  state = reduceChat(state, { type: 'draft', sessionId: 'a', text: '下一句话' });
  state = reduceChat(state, { type: 'stop', sessionId: 'a', requestId: 'r1' });
  assert.equal(conversation(state).status, 'stopping');
  assert.equal(isBusy(conversation(state)), true);
  state = event(state, { type: 'run.settled', outcome: 'cancelled' });
  assert.equal(conversation(state).status, 'cancelled');
  assert.equal(conversation(state).messages[1]?.text, '部分回答');
  assert.equal(conversation(state).draft, '下一句话');
  assert.equal(event(state, { type: 'text.delta', text: '过期内容' }), state);
});
test('SEAM-01: complete message is authoritative and completion needs a final message', () => {
  let state = event(sent(), { type: 'text.delta', text: '暂时文本' });
  state = event(state, { type: 'message.final', text: '权威完整消息' });
  state = event(state, { type: 'run.settled', outcome: 'completed' });
  assert.equal(conversation(state).status, 'completed');
  assert.equal(conversation(state).messages[1]?.text, '权威完整消息');
  const interrupted = event(sent(), { type: 'run.settled', outcome: 'completed' });
  assert.equal(conversation(interrupted).status, 'failed');
  assert.match(conversation(interrupted).error ?? '', /完整消息/);
});
test('SEAM-01: a late text delta cannot amend an authoritative full message', () => {
  let state = event(sent(), { type: 'message.final', text: '权威完整消息' });
  state = event(state, { type: 'text.delta', text: '迟到增量' });
  state = event(state, { type: 'run.settled', outcome: 'completed' });
  assert.equal(conversation(state).status, 'completed');
  assert.equal(conversation(state).messages[1]?.text, '权威完整消息');
});
test('UI-01: failure preserves prompt and partial output for explicit retry', () => {
  let state = event(sent(), { type: 'text.delta', text: '已有内容' });
  state = event(state, { type: 'run.settled', outcome: 'failed', error: '演示失败' });
  assert.equal(conversation(state).status, 'failed');
  assert.equal(conversation(state).failedPrompt, '你好');
  assert.equal(conversation(state).messages[1]?.text, '已有内容');
  assert.equal(conversation(state).error, '演示失败');
  state = reduceChat(state, { type: 'send', sessionId: 'a', requestId: 'retry', text: '你好' });
  assert.equal(conversation(state).status, 'running');
});
test('UI-02: drafts and model snapshots belong to their own conversation', () => {
  let state = reduceChat(projectState('a', '模型 A'), { type: 'draft', sessionId: 'a', text: 'A 草稿' });
  state = reduceChat(state, { type: 'create-project', sessionId: 'b', name: '项目 B', modelLabel: '模型 B' });
  state = reduceChat(state, { type: 'select', sessionId: 'a' });
  assert.equal(state.activeId, 'a');
  assert.equal(conversation(state).draft, 'A 草稿');
  assert.equal(conversation(state).modelLabel, '模型 A');
  assert.equal(conversation(state, 'b').modelLabel, '模型 B');
});
test('UI-01: whitespace does not create messages', () => {
  const state = projectState('a');
  assert.equal(reduceChat(state, { type: 'send', sessionId: 'a', requestId: 'r1', text: ' \n ' }), state);
});
test('LLM-01: validate visible fields and reject malformed addresses', () => {
  const invalid = validateConfig({ name: '', provider: 'custom', baseUrl: 'javascript:alert(1)', model: '' });
  assert.ok(invalid.name);
  assert.ok(invalid.baseUrl);
  assert.ok(invalid.model);
  assert.deepEqual(validateConfig({ name: '演示配置', provider: 'custom', baseUrl: 'https://api.example.invalid/v1', model: 'demo-model' }), {});
});

test('UI-01: explicit retry must preserve a separately written unsent draft', () => {
  let state = event(sent(), { type: 'run.settled', outcome: 'failed', error: '演示失败' });
  state = reduceChat(state, { type: 'draft', sessionId: 'a', text: '下一句尚未发送' });
  state = reduceChat(state, { type: 'send', sessionId: 'a', requestId: 'retry', text: '你好', source: 'retry' });
  assert.equal(conversation(state).draft, '下一句尚未发送');
  assert.equal(conversation(state).messages.at(-2)?.text, '你好');
});
