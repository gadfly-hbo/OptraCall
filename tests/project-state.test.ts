import test from 'node:test';
import assert from 'node:assert/strict';
import { createState, reduceChat } from '../src/host/ui/chat-state.ts';

test('PROJECT-01: start without a standalone chat; sending cannot create a project', () => {
  const state = createState();
  assert.deepEqual(state, { activeId: null, projects: [] });
  assert.equal(reduceChat(state, { type: 'send', sessionId: 'missing', requestId: 'r1', text: '你好' }), state);
});

test('PROJECT-01: blank names, oversized names and duplicate ids do not create phantom projects', () => {
  const empty = createState();
  for (const name of ['', ' \n ', '项'.repeat(61)]) {
    assert.equal(reduceChat(empty, { type: 'create-project', sessionId: 'a', name, modelLabel: '演示模型' }), empty);
  }
  const state = reduceChat(empty, { type: 'create-project', sessionId: 'a', name: '项目 A', modelLabel: '模型 A' });
  assert.equal(reduceChat(state, { type: 'create-project', sessionId: 'a', name: '覆盖 A', modelLabel: '模型 B' }), state);
  assert.equal(reduceChat(state, { type: 'select', sessionId: 'unknown' }), state);
});

test('PROJECT-03: project name and folders remain stable while background events stay with their project', () => {
  let state = reduceChat(createState(), { type: 'create-project', sessionId: 'a', name: '经营复盘', modelLabel: '模型 A' });
  state = reduceChat(state, { type: 'send', sessionId: 'a', requestId: 'r1', text: '第一句话' });
  state = reduceChat(state, { type: 'draft', sessionId: 'a', text: '独立草稿' });
  state = reduceChat(state, { type: 'create-project', sessionId: 'b', name: '营销评估', modelLabel: '模型 B' });
  state = reduceChat(state, { type: 'event', event: { type: 'text.delta', sessionId: 'a', requestId: 'r1', text: '仅属 A' } });
  assert.equal(state.activeId, 'b');
  assert.equal(state.projects[0]?.name, '经营复盘');
  assert.deepEqual(state.projects[0]?.folders, ['010_draw', '020_clean', '060_reports']);
  assert.equal(state.projects[0]?.draft, '独立草稿');
  assert.equal(state.projects[0]?.messages[1]?.text, '仅属 A');
  assert.deepEqual(state.projects[1]?.messages, []);
  assert.equal(state.projects[1]?.draft, '');
});

test('PROJECT-02: named creation creates one project with exactly the requested default folders', () => {
  const state = reduceChat(createState(), { type: 'create-project', sessionId: 'a', name: '  经营复盘  ', modelLabel: '模型 A' });
  assert.equal(state.activeId, 'a');
  const project = state.projects[0];
  assert.ok(project);
  assert.equal(project.name, '经营复盘');
  assert.deepEqual(project.folders, ['010_draw', '020_clean', '060_reports']);
  assert.equal(project.modelLabel, '模型 A');
});
