import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import './fixtures/register-ui.ts';
import { startTestHost } from './fixtures/host-process.ts';
import { startToolProvider, providerMessageText } from './fixtures/tool-provider.ts';
import { readStrategyDiscussion, watchStrategyDiscussion } from '../src/host/ui/strategy-discussion-client.ts';
import type { ProjectEvent } from '../src/agent/project-runtime.ts';

test('Issue #108 SD01 & SD03: first screen prioritizes direct chat input with single Prompt Examples entry and single collapsed Discussion Settings', async () => {
  const { StrategyDiscussionPanel } = await import('../src/host/ui/StrategyDiscussionPanel.tsx');
  const html = renderToStaticMarkup(createElement(StrategyDiscussionPanel, {
    active: false,
    projects: [],
    configurations: [],
    onReviewCandidate() {},
    async onGoalsChanged() {},
    onSettings() {},
  }));

  // SD01: Lead instruction & placeholder
  assert.match(html, /说说你正在考虑的战略问题。可以从比较两个方向开始。/);
  assert.doesNotMatch(html, /直接说明问题，已有战略与 GSA 可以沿用/);
  assert.doesNotMatch(html, /本次：未设置，仍可工作/);
  assert.match(html, /placeholder="下季度该优先拓新客，还是提高复购？"/);
  assert.match(html, /＋ 添加资料/);
  assert.match(html, /发送讨论/);

  // SD01: Single visible Prompt Examples entry on first screen with business-language labels
  const wbMethodsMatches = html.match(/<details class="wb-methods"/g) ?? [];
  assert.equal(wbMethodsMatches.length, 1, 'First screen should have only one .wb-methods details block');
  assert.match(html, /<details class="wb-methods"><summary>提问示例<\/summary>/);
  assert.doesNotMatch(html, /复盘、调研与诊断|SWOT 分析|五力分析/);
  for (const label of ['复盘上期', '看看行业变化', '找机会与风险', '看看竞争压力']) {
    assert.match(html, new RegExp(`>${label}</button>`));
  }

  // SD01 & SD03: composer appears BEFORE the single collapsed Discussion Settings block
  const composerIndex = html.indexOf('class="strategy-discussion-composer"');
  const optionsMatches = [...html.matchAll(/<details class="strategy-discussion-options"/g)];
  assert.equal(optionsMatches.length, 1, 'Below composer there must be only one .strategy-discussion-options details block');
  assert.ok(composerIndex > 0 && optionsMatches[0]!.index! > composerIndex, 'Discussion Settings must be placed below the composer');

  // SD03: Unified Discussion Settings contents
  assert.match(html, /<details class="strategy-discussion-options"><summary>讨论设置（选填）<\/summary>/);
  assert.match(html, /讨论用途（选填）/);
  assert.match(html, /说明组织、部门／业务模块、个人和可选背景，供当前讨论的后续回复参考，可直接留空/);
  assert.match(html, /地图输出格式（选填）/);
  assert.match(html, /<option value=""[^>]*>自动（沿用当前地图或由 Agent 整理）<\/option>/);
  assert.match(html, /<option value="table">条目表<\/option>/);
  assert.match(html, /<option value="tree">目标与策略树<\/option>/);
  assert.match(html, /<option value="bsc">平衡计分卡（BSC）<\/option>/);
  assert.match(html, /格式是后续发送时的地图整理偏好。可以在对话中请 Agent 整理，完成后到「战略地图」查看。/);
  assert.match(html, /指定参考方法（选填）/);
  assert.match(html, /优先参考战略选择框架/);
});

test('Issue #108 SD02 & SD03: refreshing a running or completed discussion and reconnecting stream never dispatches extra Agent requests', { timeout: 65000 }, async t => {
  const host = await startTestHost(), provider = await startToolProvider();
  t.after(async () => { await host.close(); await provider.close(); });
  const originalFetch = globalThis.fetch;
  const req = async (path: string, method = 'GET', body?: unknown) => {
    const response = await originalFetch(host.baseUrl + path, {
      method,
      headers: host.headers,
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    assert.ok(response.ok, `${path}: ${response.status}`);
    return response.json();
  };

  await req('/api/configuration', 'PUT', {
    name: 'Issue 108 synthetic provider',
    provider: 'openai-compatible',
    baseUrl: provider.baseUrl,
    model: 'synthetic-108',
    apiKey: 'synthetic-108-key',
  });

  provider.setResponder(() => ({
    text: '### 两个方向的初步比较\n- **方向一：优先提高首购后 90 天复购**\n- **方向二：季末拉新扩客群**',
  }));

  // Create discussion and only adjust settings (purpose + methods) via PATCH -> 0 model requests
  const id = randomUUID();
  const { discussion } = await req('/api/strategy/discussions', 'POST', {
    operationId: id,
    title: '下季度拓新与复购取舍',
  });
  assert.equal(provider.requests.length, 0, 'Creating discussion without sending message must not trigger Agent');

  const patched = await req(`/api/strategy/discussions/${id}`, 'PATCH', {
    expectedRevision: discussion.revision,
    usageContext: { kind: 'department', background: '会员运营模块' },
    methods: [{ id: 'playing-to-win', name: '战略选择框架 / Playing to Win' }],
  });
  assert.equal(patched.discussion.revision, discussion.revision + 1);
  assert.equal(provider.requests.length, 0, 'Adjusting purpose or reference methods alone must never trigger Agent');

  // Send message with appended prompt example and mapTemplate preference
  const promptText = '下季度该优先拓新客，还是提高复购？\n对照上期战略、实际行动与结果。哪些选择值得延续，哪些仍缺观察？';
  const msgInput = {
    requestId: randomUUID(),
    expectedRevision: patched.discussion.revision,
    text: promptText,
    mapTemplate: 'bsc' as const,
  };
  await req(`/api/strategy/discussions/${id}/messages`, 'POST', msgInput);

  t.mock.method(globalThis, 'fetch', (resource: RequestInfo | URL, init?: RequestInit) => {
    const url = String(resource);
    return originalFetch(url.startsWith('/api/') ? host.baseUrl + url : resource, {
      ...init,
      headers: url.startsWith('/api/') ? { ...init?.headers, ...host.headers } : init?.headers,
    });
  });

  let detail = await readStrategyDiscussion(id);
  for (let attempt = 0; attempt < 400 && (detail.busy || !['completed', 'failed', 'cancelled'].includes(detail.discussion.lastRun?.status || '')); attempt++) {
    await delay(25);
    detail = await readStrategyDiscussion(id);
  }
  assert.equal(detail.discussion.lastRun?.status, 'completed');
  assert.equal(provider.requests.length, 1);

  const userMsg = detail.snapshot.messages.find(m => m.role === 'user');
  assert.ok(userMsg);
  assert.equal(userMsg.originalUserText, promptText);
  const deliveredPrompt = providerMessageText(userMsg.content);
  assert.match(deliveredPrompt, /会员运营模块/);
  assert.match(deliveredPrompt, /Playing to Win/);
  assert.match(deliveredPrompt, /平衡计分卡|bsc/i);

  // Refresh discussion record (GET + reconnect watchStrategyDiscussion SSE) -> 0 extra model requests
  const refreshed = await readStrategyDiscussion(id);
  assert.equal(refreshed.discussion.id, id);
  const controller = new AbortController();
  const events: ProjectEvent[] = [];
  await watchStrategyDiscussion(id, event => {
    events.push(event);
    if (event.type === 'snapshot') controller.abort();
  }, controller.signal).catch(err => {
    if (!controller.signal.aborted) throw err;
  });
  assert.ok(events.some(e => e.type === 'snapshot'), 'Reconnecting live stream should deliver current snapshot');
  assert.equal(provider.requests.length, 1, 'Refreshing discussion record and reconnecting SSE must not trigger extra Agent requests');
});
