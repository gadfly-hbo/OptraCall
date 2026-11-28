import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import './fixtures/register-ui.ts';
import type { CaseRecord } from '../src/host/case-types.ts';

const panel = import('../src/host/ui/CaseIssuePanel.tsx');

test('a Case detail exposes its collaboration entry before any independent issue has been selected', async () => {
  const { CaseIssuePanel } = await panel;
  const record: CaseRecord = {
    id: 'case-one', title: '历史经营问题', description: '', judgement: '', nextStep: '', status: 'analyzing',
    closeReason: null, closedAt: null, revision: 1, createdAt: '', updatedAt: '',
  };
  const html = renderToStaticMarkup(createElement(CaseIssuePanel, {
    record, projects: [], onChange() {}, onCreate() {},
  }));
  assert.match(html, /<h3[^>]*>Case Agent<\/h3>/);
  assert.match(html, /先选择一件事项/);
  assert.match(html, /aria-label="事项关系与视图切换"/);
  assert.doesNotMatch(html, /<textarea/);
});
