import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import './fixtures/register-ui.ts';

const draftKey = 'optracall.strategy-discussion.draft.v1:new';
const hint = '检测到本地文件路径';

test('Issue 115 composer shows a non-blocking path hint only for local file path text, never for ordinary questions or URLs', async () => {
  const { StrategyDiscussionPanel } = await import('../src/host/ui/StrategyDiscussionPanel.tsx');
  const render = (draft: string): string => {
    const store = new Map<string, string>();
    if (draft) store.set(draftKey, draft);
    const storage = { getItem: (key: string) => store.get(key) ?? null, setItem: (key: string, value: string) => { store.set(key, value); }, removeItem: (key: string) => { store.delete(key); } };
    const prevSession = Object.getOwnPropertyDescriptor(globalThis, 'sessionStorage');
    const prevWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
    Object.defineProperty(globalThis, 'sessionStorage', { configurable: true, value: storage });
    Object.defineProperty(globalThis, 'window', { configurable: true, value: { sessionStorage: storage, location: { href: 'http://127.0.0.1:4173/' }, innerWidth: 1440, matchMedia: () => ({ matches: false }) } });
    try {
      return renderToStaticMarkup(createElement(StrategyDiscussionPanel, { active: false, projects: [], configurations: [], onReviewCandidate() {}, async onGoalsChanged() {}, onSettings() {} }));
    } finally {
      if (prevSession) Object.defineProperty(globalThis, 'sessionStorage', prevSession); else Reflect.deleteProperty(globalThis, 'sessionStorage');
      if (prevWindow) Object.defineProperty(globalThis, 'window', prevWindow); else Reflect.deleteProperty(globalThis, 'window');
    }
  };

  for (const pathText of ['请读取 /Users/synthetic/plan.md 并总结', '看下 C:\\docs\\strategy.pdf 的重点', '参考 ~/notes/roadmap.md']) {
    const html = render(pathText);
    assert.match(html, new RegExp(hint), pathText);
    assert.match(html, /＋ 添加资料/);
    assert.match(html, /发送讨论/, 'the hint must not remove or block the send action');
  }
  assert.doesNotMatch(render('下季度该优先拓新客，还是提高复购？'), new RegExp(hint), 'ordinary strategy question shows no path hint');
  assert.doesNotMatch(render('参考 https://example.com/plan.md 的思路'), new RegExp(hint), 'a web URL is not a local file path');
  assert.doesNotMatch(render(''), new RegExp(hint), 'empty draft shows no path hint');
});
