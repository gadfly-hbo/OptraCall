import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { startTestHost } from './fixtures/host-process.ts';
import { startSyntheticProvider } from './fixtures/synthetic-provider.ts';
import { startToolProvider } from './fixtures/tool-provider.ts';
import { sessionEvents } from './fixtures/session-events.ts';
import { sampleWithoutSnapshotExport } from './fixtures/requirement-sample.ts';

async function read(response: Response, expected = 200): Promise<any> {
  assert.equal(response.status, expected, await response.clone().text());
  return response.json();
}

test('RAF-A1/A2/A4: actual Host and Pi preserve fixed RAP, three decision scopes, and exact initial delivery', { timeout: 45_000 }, async t => {
  const provider = await startSyntheticProvider(); t.after(() => provider.close());
  const host = await startTestHost(); t.after(() => host.close());
  const config = { name: '需求研判', provider: 'openai-compatible', baseUrl: provider.baseUrl, model: 'synthetic-raf', apiKey: 'synthetic-key' };
  await read(await host.request('/api/configuration', 'PUT', config));

  const { instance: { id } } = await read(await host.request('/api/requirement-instances', 'POST', { title: '退款工作稿', scene: 'topic' }), 201);
  const requirement = '/api/requirement-instances/' + id;
  const { instance: created } = await read(await host.request(requirement));
  const draft = { ...sampleWithoutSnapshotExport(), instance: created.instance, context: { background: '原 RAP 采用支付成功口径 OLD_RAP_SCOPE', goal: '核对旧退款范围', decisionScenario: '评估是否追查' } };
  const extended = { ...draft.framework!, metrics: draft.framework!.metrics.map(metric => ({ ...metric, definition: metric.definition + 'x'.repeat(23_200) + 'RAP_TAIL_NOT_IN_PREVIEW' })) };
  await read(await host.request(requirement, 'PATCH', { instance: { ...draft, framework: extended } }));
  await read(await host.request(requirement + '/confirm', 'POST', { confirmedBy: 'QA' }));
  await read(await host.request(requirement + '/publish', 'POST', { releasedBy: 'QA', version: '1.0.0' }), 201);
  const { instance: updated } = await read(await host.request(requirement));
  updated.context = { background: '本轮需要排除未发货退款 NEW_DRAFT_SCOPE', goal: '核对试点退款', decisionScenario: '决定是否扩大试点' };
  updated.hypotheses = updated.hypotheses.map((hypothesis: any) => hypothesis.id === 'hyp-1' ? { ...hypothesis, id: 'hyp-3' } : hypothesis);
  updated.framework.analysisPaths = updated.framework.analysisPaths.map((item: any) => item.hypothesis === 'hyp-1' ? { ...item, hypothesis: 'hyp-3' } : item);
  await read(await host.request(requirement, 'PATCH', { instance: updated }));

  const cases = [
    { value: '影响扩店决策，价值高', feasibility: '还不能判断因果', scope: '仅登记试点', gaps: ['缺同口径订单，影响扩店前的因果核对'] },
    { value: '全量订单充足，但改变不了行动，建议暂缓', feasibility: '可对全量订单做描述统计', scope: '保留取证建议', gaps: [] },
    { value: '值得核对是否调整店铺规则', feasibility: '只能核对现象，措施效果未知', scope: '只做已发货退款拆解 ACCEPTED_FRAMEWORK_SCOPE', gaps: ['支付口径和已发货口径冲突，须核对可比覆盖'] },
  ];
  let current;
  for (const [index, assessment] of cases.entries()) {
    provider.setChunks([JSON.stringify({ ...draft.framework, analysisPaths: index === 1 ? updated.framework.analysisPaths : draft.framework!.analysisPaths, assessment })]);
    if (index === 1) await read(await host.request(requirement + '/framework-input', 'PUT', {}));
    const generated = await read(await host.request(requirement + '/generate', 'POST', { call: 'framework', frameworkReview: true, ...(index !== 1 ? { rapVersion: '1.0.0' } : {}) }));
    current = generated.frameworkProposal;
    assert.deepEqual(current.assessment, assessment);
    assert.equal(current.publicSearch.status, 'not_searched');
    assert.equal(current.selectedRap?.version, index === 1 ? undefined : '1.0.0');
    const dispatched = JSON.stringify(provider.requests[index]!.body.messages);
    assert.match(dispatched, /NEW_DRAFT_SCOPE/);
    if (index === 1) assert.doesNotMatch(dispatched, /OLD_RAP_SCOPE/);
    else {
      assert.match(dispatched, /OLD_RAP_SCOPE/);
      assert.doesNotMatch(dispatched, /RAP_TAIL_NOT_IN_PREVIEW/);
      assert.equal(current.selectedRap.extent, 'fragment');
      assert.equal(current.framework.analysisPaths[0].hypothesis, '');
      assert.match(current.framework.openQuestions.join('\n'), /原 RAP 1\.0\.0 的假设 hyp-1/);
    }
  }

  const version = current.version, beforeConfirm = provider.requests.length;
  const confirmed = await read(await host.request(requirement + '/confirm-framework', 'POST', { version, confirmedBy: 'QA' }));
  assert.equal(confirmed.confirmedFramework.version, version);
  assert.equal(confirmed.confirmedFramework.sendable, false, 'a stale formal requirement still gates the original send path');
  assert.equal(confirmed.releases.length, 1);
  assert.equal(provider.requests.length, beforeConfirm);

  const { project } = await read(await host.request('/api/projects', 'POST', { name: 'RAF 确认交付' }), 201);
  const { task: blocked } = await read(await host.request(`/api/projects/${project.id}/tasks`, 'POST', { name: '正式需求门禁' }), 201);
  await read(await host.request(`/api/projects/${project.id}/tasks/${blocked.id}/messages`, 'POST', { text: '不应送入', requestId: randomUUID(), requirementContext: { instanceId: id, frameworkVersion: version } }), 409);
  assert.equal(provider.requests.length, beforeConfirm);
  const ready = await read(await host.request(requirement + '/confirm', 'POST', { confirmedBy: 'QA' }));
  assert.equal(ready.confirmedFramework.version, version);
  assert.equal(ready.confirmedFramework.sendable, true);
  const send = async (selection: object, name: string) => {
    const { task } = await read(await host.request(`/api/projects/${project.id}/tasks`, 'POST', { name }), 201);
    const route = `/api/projects/${project.id}/tasks/${task.id}`;
    const events = await sessionEvents(host, project.id, task.id);
    t.after(() => events.close());
    const requestId = randomUUID(), count = provider.requests.length;
    await read(await host.request(route + '/messages', 'POST', { text: '按本次范围开始', requestId, requirementContext: { instanceId: id, ...selection } }), 202);
    await provider.waitForRequests(count + 1);
    await events.terminal;
    const { receipts } = await read(await host.request(route + '/context-receipts'));
    return { request: JSON.stringify(provider.requests[count]!.body.messages), receipt: receipts.find((entry: any) => entry.requestId === requestId).providedContext.rap };
  };

  provider.setChunks(['已收到明确范围。']);
  const delivered = await send({ frameworkVersion: version }, '本轮框架');
  assert.match(delivered.request, /ACCEPTED_FRAMEWORK_SCOPE/);
  assert.ok(delivered.request.includes(version));
  assert.equal(delivered.receipt.frameworkVersion, version);
  assert.equal(delivered.receipt.basisSha256, createHash('sha256').update(delivered.receipt.text).digest('hex'));

  const old = await send({ version: '1.0.0' }, '旧 RAP');
  assert.equal(old.receipt.version, '1.0.0');
  assert.match(old.request, /OLD_RAP_SCOPE/);
  assert.match(old.request, /RAP_TAIL_NOT_IN_PREVIEW/);
  assert.doesNotMatch(old.request, /ACCEPTED_FRAMEWORK_SCOPE|NEW_DRAFT_SCOPE/);
});

test('RAF-A4: withdrawing a source protects reviewed RAP, Case reads, task receipts and subsequent delivery', { timeout: 45_000 }, async t => {
  const provider = await startToolProvider(); t.after(() => provider.close());
  const host = await startTestHost(); t.after(() => host.close());
  await read(await host.request('/api/configuration', 'PUT', {
    name: '需求撤权验证', provider: 'openai-compatible', baseUrl: provider.baseUrl, model: 'synthetic-raf-withdrawal', apiKey: 'synthetic-raf-key',
  }));
  const marker = 'RAF_WITHDRAWN_MATERIAL_MARKER';
  const material = await read(await host.request('/api/enterprise-materials', 'POST', { title: '合成规则', body: marker }), 201);
  const materialRoute = '/api/enterprise-materials/' + material.material.id;
  const enabled = await read(await host.request(materialRoute + '/enable', 'POST', { expectedVersion: material.material.version }));
  const target = { kind: 'enterprise', storeId: enabled.storeId, materialId: enabled.material.id, revisionId: enabled.material.activeRevisionId };
  const { instance: { id } } = await read(await host.request('/api/requirement-instances', 'POST', { title: '需要重新核对的规则', scene: 'topic' }), 201);
  const requirement = '/api/requirement-instances/' + id;
  const { instance: current } = await read(await host.request(requirement));
  const draft = { ...sampleWithoutSnapshotExport(), instance: current.instance };
  await read(await host.request(requirement, 'PATCH', { instance: draft }));
  await read(await host.request(requirement + '/confirm', 'POST', { confirmedBy: 'QA' }));
  provider.setResponder(({ requestNumber, recentToolResults }) => {
    if (requestNumber === 1) return { calls: [{ name: 'read_semantic_context', arguments: { action: 'read', target } }] };
    if (requestNumber === 2) {
      assert.match(JSON.stringify(recentToolResults), new RegExp(marker));
      return { text: JSON.stringify({ ...draft.framework, openQuestions: [marker], assessment: { value: '决定是否沿用规则', feasibility: '可核对当前记录', scope: '试点', gaps: [] } }) };
    }
    return { text: '已收到明确范围。' };
  });
  const { frameworkProposal } = await read(await host.request(requirement + '/generate', 'POST', { call: 'framework', frameworkReview: true }));
  assert.equal(frameworkProposal.sources[0].version, target.revisionId);
  await read(await host.request(requirement + '/confirm-framework', 'POST', { version: frameworkProposal.version, confirmedBy: 'QA' }));
  await read(await host.request(requirement + '/publish', 'POST', { version: '1.0.0', releasedBy: 'QA' }), 201);
  const { project } = await read(await host.request('/api/projects', 'POST', { name: '需求依据撤销' }), 201);
  const { task } = await read(await host.request(`/api/projects/${project.id}/tasks`, 'POST', { name: '使用原框架' }), 201);
  const taskRoute = `/api/projects/${project.id}/tasks/${task.id}`;
  const events = await sessionEvents(host, project.id, task.id); t.after(() => events.close());
  const requestId = randomUUID(), requirementContext = { instanceId: id, frameworkVersion: frameworkProposal.version };
  await read(await host.request(taskRoute + '/messages', 'POST', { text: '按此范围分析', requestId, requirementContext }), 202);
  await events.terminal;
  assert.match(JSON.stringify(await read(await host.request(taskRoute + '/context-receipts'))), new RegExp(marker));
  await read(await host.request('/api/cases/storage/initialize', 'POST', {}));
  const { case: record } = await read(await host.request('/api/cases', 'POST', { operationId: randomUUID(), title: '历史规则' }), 201);
  const readCase = () => host.request(`/api/cases/${record.id}/decisions/source`, 'POST', { target: { type: 'rap', instanceId: id, version: '1.0.0' } });
  assert.match(JSON.stringify(await read(await readCase())), new RegExp(marker));

  await read(await host.request(materialRoute + '/disable', 'POST', { expectedVersion: enabled.material.version }));
  const revoked = await read(await host.request(requirement));
  assert.equal(revoked.releases[0].readable, false);
  assert.equal(revoked.frameworkProposal.status, 'stale');
  assert.doesNotMatch(JSON.stringify(revoked), new RegExp(marker));
  await read(await host.request(requirement + '/releases/1.0.0'), 409);
  const caseSource = await read(await readCase());
  assert.equal(caseSource.status, 'unknown');
  assert.doesNotMatch(JSON.stringify(caseSource), new RegExp(marker));
  const { receipts } = await read(await host.request(taskRoute + '/context-receipts'));
  assert.equal(receipts.find((entry: any) => entry.requestId === requestId).providedContext.rap.sourceStatus, 'unavailable');
  assert.doesNotMatch(JSON.stringify(receipts), new RegExp(marker));
  assert.doesNotMatch(JSON.stringify(await read(await host.request(taskRoute))), new RegExp(marker));
  const before = provider.requests.length;
  const declined = await read(await host.request(taskRoute + '/messages', 'POST', { text: '继续', requestId: randomUUID() }), 409);
  assert.equal(declined.code, 'requirement_history_source_unavailable');
  assert.equal(declined.accepted, false);
  assert.equal((await read(await host.request(taskRoute))).task.lastRun.id, requestId);
  assert.equal(provider.requests.length, before);
});
