import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { startTestHost } from './fixtures/host-process.ts';
import { startSyntheticProvider } from './fixtures/synthetic-provider.ts';
import { sessionEvents } from './fixtures/session-events.ts';
import { prepareJointContext, readJson } from './fixtures/joint-context.ts';

test('RR07: one native task pins RAP, SAP and Case together, rejects stale selections, and preserves saved history on restart', { timeout: 90_000 }, async t => {
  const provider = await startSyntheticProvider();
  let host = await startTestHost();
  t.after(async () => { await host.close(); await provider.close(); });
  const f = await prepareJointContext(host, provider.baseUrl);
  const route = `/api/projects/${f.project.id}/tasks/${f.task.id}`;
  const text = 'RR07仅核对本轮背景，不调用工具或执行实际业务动作';
  const input = { text, caseContext: f.caseContext, requirementContext: f.requirementContext };

  await readJson(await host.request(`${route}/messages`, 'POST', { ...input, requestId: randomUUID(), caseContext: f.staleCaseContext }), 409);
  await readJson(await host.request(`${route}/messages`, 'POST', { ...input, requestId: randomUUID(), requirementContext: { instanceId: f.requirementContext.instanceId } }), 409);
  await readJson(await host.request(`${route}/messages`, 'POST', { ...input, requestId: randomUUID(), requirementContext: { ...f.requirementContext, version: '9.9.9' } }), 404);
  assert.equal(provider.requests.length, 0, 'Invalid Case/RAP must be rejected before reaching any model');
  assert.equal((await readJson(await host.request(route))).task.lastRun, undefined);

  const stream = await sessionEvents(host, f.project.id, f.task.id);
  t.after(() => stream.close());
  const requestId = randomUUID();
  await readJson(await host.request(`${route}/messages`, 'POST', { ...input, requestId }), 202);
  const settled = await stream.terminal;
  assert.equal(settled.type, 'run.settled');
  if (settled.type === 'run.settled') assert.equal(settled.outcome, 'completed');
  await provider.waitForRequests(1);
  const sent = provider.requests[0]!.body;
  assert.equal(sent.model, 'synthetic-joint-context');
  const system = JSON.stringify(sent.messages?.filter(message => message.role === 'system'));
  const user = JSON.stringify(sent.messages?.filter(message => message.role === 'user'));
  assert.ok(system.includes('membership-repurchase@1.0.0'), 'Use the enabled exact SAP version');
  assert.ok(system.includes('repurchase_rate 会员复购率'));
  assert.ok(system.includes('1.0.0.sap.yaml'), 'The index must identify the full source asset');
  assert.ok(!system.includes('membership-repurchase@1.1.0'), 'A newer publication must not silently upgrade this project');
  for (const value of [f.case.id, f.case.title, f.project.id, 'RR07_CASE_SOURCE_合成事项背景',
    'RR07_CASE_CURRENT_JUDGEMENT_未确定原因', 'RR07_PROJECT_SCOPE_只分析合成资料',
    `${f.requirementContext.instanceId}@1.9.0`, 'RR07_RAP_1_9_GOAL_保持历史版本',
    'RR07_RAP_1_9_DEFINITION', '1.9.0.rap.yaml', '不是执行指令', text]) {
    assert.ok(user.includes(value), `The actual request must include ${value}`);
  }
  assert.ok(!user.includes('RR07_RAP_1_10_DEFINITION_NOT_SELECTED'));
  assert.ok(!user.includes('RR07_LATER_DRAFT_NOT_SELECTED'));

  await readJson(await host.request(`${route}/messages`, 'POST', { ...input, requestId }), 202);
  await readJson(await host.request(`${route}/messages`, 'POST', {
    ...input, requestId, requirementContext: { ...f.requirementContext, version: '1.10.0' },
  }), 409);
  assert.equal(provider.requests.length, 1, 'Accepted retries must not replay or silently change RAP');

  const saved = await readJson(await host.request(route));
  const nativeFile = saved.task.sessionFile as string;
  const nativeBefore = await readFile(nativeFile);
  const uploadsBefore = saved.project.uploads;
  const dataRoot = host.dataRoot, projectsRoot = host.projectsRoot;
  await stream.close();
  await host.close();
  host = await startTestHost({ dataRoot, projectsRoot });
  const reopened = await readJson(await host.request(`${route}/open`, 'POST', {}));
  assert.equal(reopened.task.id, f.task.id);
  assert.equal(reopened.task.sessionFile, nativeFile);
  assert.deepEqual(reopened.project.uploads, uploadsBefore);
  assert.ok(JSON.stringify(reopened.snapshot.messages).includes('RR07_RAP_1_9_DEFINITION'));
  assert.ok(JSON.stringify(reopened.snapshot.messages).includes(f.case.title));
  assert.deepEqual((await readFile(nativeFile)).subarray(0, nativeBefore.length), nativeBefore);
  assert.equal(await readFile(path.join(f.project.rootPath, '020_clean/joint-input.csv'), 'utf8'), f.input);
  assert.equal(provider.requests.length, 1, 'Reopening must only read prior state');
  const enabled = await readJson(await host.request(`/api/metric-factory/projects/${f.project.id}`));
  assert.equal(enabled.records[0].version, '1.0.0');
  const caseReadback = await readJson(await host.request(`/api/cases/${f.case.id}`));
  assert.equal(caseReadback.case.revision, f.caseContext.caseRevision);

  const { task: independent } = await readJson(await host.request(`/api/projects/${f.project.id}/tasks`, 'POST', { name: '未选择RAP或Case的独立任务' }), 201);
  const independentStream = await sessionEvents(host, f.project.id, independent.id);
  t.after(() => independentStream.close());
  await readJson(await host.request(`/api/projects/${f.project.id}/tasks/${independent.id}/messages`, 'POST', {
    requestId: randomUUID(), text: '只使用本项目指标索引',
  }), 202);
  await independentStream.terminal;
  await provider.waitForRequests(2);
  const direct = provider.requests[1]!.body;
  assert.ok(JSON.stringify(direct.messages?.filter(message => message.role === 'system')).includes('membership-repurchase@1.0.0'));
  const directUser = JSON.stringify(direct.messages?.filter(message => message.role === 'user'));
  assert.ok(!directUser.includes(f.case.title) && !directUser.includes(f.requirementContext.instanceId), 'Unselected per-request backgrounds must not leak into an independent task');
});
