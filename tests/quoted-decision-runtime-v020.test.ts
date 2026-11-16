import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { startTestHost } from './fixtures/host-process.ts';
import { startToolProvider, providerMessageText } from './fixtures/tool-provider.ts';
import { withCaseGoal } from './fixtures/case-goal.ts';

test('A15/A16: the actual Pi tool records one exact user choice with native quote provenance and cannot turn it into action authorization', { timeout: 30_000 }, async t => {
  const host = await startTestHost(), provider = await startToolProvider(); t.after(async () => { await host.close(); await provider.close(); });
  await mkdir(path.join(host.dataRoot, 'pi'), { recursive: true }); await writeFile(path.join(host.dataRoot, 'pi/settings.json'), JSON.stringify({ retry: { enabled: false } }));
  const request = async (route: string, method = 'GET', body?: unknown) => { const response = await host.request(route, method, body); assert.ok(response.ok, await response.clone().text()); return response.json(); };
  await request('/api/configuration', 'PUT', { name: '合成原话', provider: 'openai-compatible', baseUrl: provider.baseUrl, model: 'synthetic-quoted-choice', apiKey: 'synthetic-quote-only' });
  const { project } = await request('/api/projects', 'POST', { name: '原话事实各自记录' }), { task } = await request(`/api/projects/${project.id}/tasks`, 'POST', { name: '原Case任务' });
  await request('/api/cases/storage/initialize', 'POST', {});
  const { case: record } = await request('/api/cases', 'POST', await withCaseGoal(host, { operationId: randomUUID(), title: '合成持续问题' }));
  await request(`/api/cases/${record.id}/projects`, 'POST', { operationId: randomUUID(), expectedRevision: record.revision, projectId: project.id });
  const route = `/api/projects/${project.id}/tasks/${task.id}`;
  const run = async (text: string) => {
    const detail = await request(`/api/cases/${record.id}`), p = await request(`/api/projects/${project.id}`), requestId = randomUUID();
    await request(route + '/messages', 'POST', { requestId, text, caseContext: { caseId: record.id, caseRevision: detail.case.revision, projectWorkRevision: p.project.work.revision, selectedReferenceIds: [] } });
    const deadline = Date.now() + 15_000; let state: any;
    do { state = await request(route); if (state.task.lastRun?.id === requestId && state.task.lastRun.status !== 'running' && state.snapshot.status === 'idle') break; await delay(20); } while (Date.now() < deadline);
    assert.equal(state.task.lastRun.status, 'completed'); return { requestId, entries: (await readFile(state.task.sessionFile, 'utf8')).trim().split('\n').map(line => JSON.parse(line)) };
  };
  provider.setResponder(context => context.recentToolResults.length ? { text: '已形成待选择的合成方案。' } : { calls: [{ name: 'save_case_decision_draft', arguments: { kind: 'strategy', expectedRevision: 0, payload: { title: '合成试点方案', proposal: '先在限定范围检验证据，不预设经营效果。' } } }] });
  await run('先给一个可比较的方案，不作经营取舍。');
  const catalog = await request(`/api/cases/${record.id}/decisions`), strategy = catalog.items[0]; assert.equal(strategy.kind, 'strategy');
  const strategyRef = { type: 'case-decision', caseStoreId: catalog.caseStoreId, caseId: record.id, recordId: strategy.recordId, revision: strategy.revision };
  const text = '我选择先做这个限定试点；这里只记录方案取舍，具体行动另行授权。';
  let writeReplies: any[] = [];
  provider.setResponder(context => {
    if (context.recentToolResults.length < 2) { if (context.recentToolResults.length) writeReplies.push(JSON.parse(providerMessageText(context.recentToolResults.at(-1)!.content))); return { calls: [{ name: 'record_user_decision', arguments: { action: 'choose-strategy', quote: { start: 0, end: text.length, text }, strategyRef, choice: 'trial', expectedPreviousChoiceId: null } }] }; }
    writeReplies.push(JSON.parse(providerMessageText(context.recentToolResults.at(-1)!.content))); return { text: '已按原话记录准确方案选择；行动授权与效果均未据此推定。' };
  });
  const result = await run(text);
  const after = await request(`/api/cases/${record.id}/decisions`); assert.equal(after.choices.length, 1);
  const choice = after.choices[0]; assert.equal(choice.choice, 'trial'); assert.deepEqual(choice.strategyRef, strategyRef);
  assert.equal(choice.quoteProvenance.quote.text, text); assert.equal(choice.quoteProvenance.requestId, result.requestId);
  assert.equal(writeReplies.length, 2); assert.equal(writeReplies[0].authority.id, writeReplies[1].authority.id);
  assert.equal((await request('/api/decision-board')).items.length, 0);
  assert.equal(result.entries.filter(entry => entry.customType === 'optracall.quoted-decision').length, 2);
  assert.deepEqual(provider.errors, []);
});
