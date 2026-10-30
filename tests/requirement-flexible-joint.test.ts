import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { startTestHost } from './fixtures/host-process.ts';
import { startSyntheticProvider } from './fixtures/synthetic-provider.ts';
import { prepareJointContext, readJson } from './fixtures/joint-context.ts';
import { sessionEvents } from './fixtures/session-events.ts';

const framework = {
  metrics: [{ name: 'RF_DAILY_销售额', definition: '日有效订单金额合计', dimensions: ['门店'], source: '合成需求' }],
  dataNeeds: [{ table: 'daily_orders', fields: ['amount'], priority: 'P0', purpose: '描述经营表现' }],
  analysisPaths: [{ question: 'RF_DAILY_各门店销售额是多少', hypothesis: '', method: '分组汇总', requiredData: ['daily_orders'], expectedOutput: '日报表' }],
  reportFramework: [{ section: 'RF_DAILY_经营日报', purpose: '呈现事实', keyQuestions: ['当日销售额'], evidence: ['订单汇总'], zeroHallucinationCheck: '未获取数据不得编数' }],
  openQuestions: ['RF_DAILY_数据尚未提供'], risks: ['RF_DAILY_描述不等于归因'],
};

async function waitSettled(events: any[], requestId: string) {
  const deadline = Date.now() + 15_000;
  while (!events.some(e => e.type === 'run.settled' && e.requestId === requestId)) {
    assert.ok(Date.now() < deadline, 'Explicit joint-context run must settle');
    await new Promise(resolve => setTimeout(resolve, 15));
  }
}

test('RF-JOINT: descriptive draft becomes an exact RAP with SAP and Case, while stale drafts and restart preserve prior inputs', { timeout: 90_000 }, async t => {
  const provider = await startSyntheticProvider(); t.after(() => provider.close());
  let host = await startTestHost(); t.after(() => host.close());
  const joint = await prepareJointContext(host, provider.baseUrl);
  const oldRelease = await readJson(await host.request(`/api/requirement-instances/${joint.requirementContext.instanceId}/releases/1.9.0`));
  const created = await readJson(await host.request('/api/requirement-instances', 'POST', { title: 'RF_DAILY_描述性需求', scene: 'daily' }), 201);
  const id = created.instance.id;
  const detail = await readJson(await host.request(`/api/requirement-instances/${id}`));
  detail.instance.context = { background: 'RF_DAILY_仅描述不归因', goal: 'RF_DAILY_PUBLISHED_GOAL', decisionScenario: '晨会查看' };
  await readJson(await host.request(`/api/requirement-instances/${id}`, 'PATCH', { instance: detail.instance }));
  provider.setChunks(['```json\n' + JSON.stringify(framework) + '\n```']);
  const generated = await readJson(await host.request(`/api/requirement-instances/${id}/generate`, 'POST', { call: 'framework' }));
  assert.equal(generated.source.confirmation, 'unconfirmed');
  assert.equal(generated.proposal.framework.analysisPaths[0].hypothesis, '');
  const adopt = await readJson(await host.request(`/api/requirement-instances/${id}`));
  adopt.instance.framework = generated.proposal.framework;
  await readJson(await host.request(`/api/requirement-instances/${id}`, 'PATCH', { instance: adopt.instance, proposalSourceFingerprint: generated.source.fingerprint }));
  const beforeRejected = provider.requests.length;
  const rejected = await readJson(await host.request(`/api/projects/${joint.project.id}/tasks/${joint.task.id}/messages`, 'POST', {
    text: 'Unconfirmed draft is not a formal context', requestId: randomUUID(), requirementContext: { instanceId: id },
  }), 409);
  assert.equal(rejected.code, 'requirement_unavailable', 'The project Host reports unavailable requirement context through its public error contract');
  assert.equal(provider.requests.length, beforeRejected);
  await readJson(await host.request(`/api/requirement-instances/${id}/confirm`, 'POST', { confirmedBy: 'synthetic-reviewer' }));
  await readJson(await host.request(`/api/requirement-instances/${id}/publish`, 'POST', { version: '1.0.0', releasedBy: 'synthetic-reviewer' }), 201);
  const release = await readJson(await host.request(`/api/requirement-instances/${id}/releases/1.0.0`));
  const releaseFile = path.join(host.dataRoot, 'requirement-instances', 'releases', id, '1.0.0.rap.yaml');
  const releaseBytes = await readFile(releaseFile);
  provider.setChunks(['合成联合背景接收完成']);
  const stream = await sessionEvents(host, joint.project.id, joint.task.id); t.after(() => stream.close());
  const requestId = randomUUID();
  await readJson(await host.request(`/api/projects/${joint.project.id}/tasks/${joint.task.id}/messages`, 'POST', {
    text: 'RF_DAILY_RUN_按所选资料描述经营', requestId, caseContext: joint.caseContext, requirementContext: { instanceId: id, version: '1.0.0' },
  }), 202);
  await waitSettled(stream.events, requestId);
  const payload = JSON.stringify(provider.requests.at(-1)!.body);
  assert.match(payload, /RR07_CASE_CURRENT_JUDGEMENT/);
  assert.match(payload, /RF_DAILY_PUBLISHED_GOAL/);
  assert.match(payload, /RF_DAILY_经营日报/);
  assert.match(payload, /membership-repurchase@1\.0\.0/);
  assert.doesNotMatch(payload, /RR07_NEWER_SAP_ONLY|RF_DAILY_LATER_DRAFT/);
  const taskBefore = await readJson(await host.request(`/api/projects/${joint.project.id}/tasks/${joint.task.id}`));
  const nativeBefore = await readFile(taskBefore.task.sessionFile);
  const edited = await readJson(await host.request(`/api/requirement-instances/${id}`));
  edited.instance.context.goal = 'RF_DAILY_LATER_DRAFT';
  await readJson(await host.request(`/api/requirement-instances/${id}`, 'PATCH', { instance: edited.instance }));
  provider.setChunks(['```json\n' + JSON.stringify(framework) + '\n```']);
  const stale = await readJson(await host.request(`/api/requirement-instances/${id}/generate`, 'POST', { call: 'framework' }));
  assert.equal(stale.source.confirmation, 'stale');
  await readJson(await host.request(`/api/requirement-instances/${id}/publish`, 'POST', { version: '1.1.0', releasedBy: 'synthetic-reviewer' }), 409);
  assert.deepEqual(await readJson(await host.request(`/api/requirement-instances/${id}/releases/1.0.0`)), release);
  assert.deepEqual(await readFile(releaseFile), releaseBytes);
  assert.deepEqual(await readJson(await host.request(`/api/requirement-instances/${joint.requirementContext.instanceId}/releases/1.9.0`)), oldRelease);
  const { dataRoot, projectsRoot } = host; stream.close(); await host.close();
  const beforeReopenRequests = provider.requests.length;
  host = await startTestHost({ dataRoot, projectsRoot });
  const reopened = await readJson(await host.request(`/api/projects/${joint.project.id}/tasks/${joint.task.id}`));
  assert.equal(reopened.task.sessionFile, taskBefore.task.sessionFile);
  assert.deepEqual(await readFile(reopened.task.sessionFile), nativeBefore);
  assert.deepEqual(reopened.snapshot.messages, taskBefore.snapshot.messages);
  assert.deepEqual(await readJson(await host.request(`/api/requirement-instances/${id}/releases/1.0.0`)), release);
  assert.equal(provider.requests.length, beforeReopenRequests, 'Readback must not replay generation or analysis');
});
