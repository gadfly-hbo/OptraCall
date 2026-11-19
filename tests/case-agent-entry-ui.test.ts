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
  assert.match(html, /<h3[^>]*>Decision Case Agent<\/h3>/);
  assert.match(html, /<button[^>]*aria-expanded="false"[^>]*>与决策 Agent 协作<\/button>/);
  assert.doesNotMatch(html, /<textarea/);
});
