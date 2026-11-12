import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { startTestHost } from './fixtures/host-process.ts';
import { providerMessageText, startToolProvider } from './fixtures/tool-provider.ts';
import { sessionEvents } from './fixtures/session-events.ts';
import { sampleWithoutSnapshotExport } from './fixtures/requirement-sample.ts';

async function read(response: Response, expected = 200): Promise<any> {
  assert.equal(response.status, expected, await response.clone().text());
  return response.json();
}
const textOf = (messages: { content?: unknown }[]) => messages.map(message => providerMessageText(message.content)).join('\n');
const reviewer = (messages: { role: string; content?: unknown }[]) => textOf(messages.filter(message => ['system', 'developer'].includes(message.role))).includes('OptraCall report-calculation reviewer');
async function fixture(t: { after(fn: () => Promise<unknown>): void }) {
  const provider = await startToolProvider(); t.after(() => provider.close());
  const host = await startTestHost(); t.after(() => host.close());
  await read(await host.request('/api/configuration', 'PUT', { name: '框架覆盖', provider: 'openai-compatible', baseUrl: provider.baseUrl, model: 'synthetic-coverage', apiKey: 'synthetic-coverage-key' }));
  const { project } = await read(await host.request('/api/projects', 'POST', { name: '框架覆盖合成项目' }), 201);
  const { task } = await read(await host.request(`/api/projects/${project.id}/tasks`, 'POST', { name: '覆盖复核' }), 201);
  const route = `/api/projects/${project.id}/tasks/${task.id}`;
  const { instance: created } = await read(await host.request('/api/requirement-instances', 'POST', { title: '销量框架', scene: 'topic' }), 201);
  const requirement = '/api/requirement-instances/' + created.id;
  const current = (await read(await host.request(requirement))).instance;
  const sample = sampleWithoutSnapshotExport();
  const draft = { ...sample, instance: current.instance, context: { background: 'FRAMEWORK_ORIGINAL_VERSION', goal: '比较两期销量', decisionScenario: '确定后续补证范围' }, framework: { ...sample.framework!,
    analysisPaths: [{ question: '渠道与品类分别怎样变化？', hypothesis: '', method: '可以用等效分组表', requiredData: ['dwd_trade_order_di'], expectedOutput: '渠道与品类销量表' }],
    reportFramework: [{ section: '3.2 渠道与品类', purpose: '回应两项拆解', keyQuestions: ['渠道变化？', '品类变化？'], evidence: ['销量明细'], zeroHallucinationCheck: '缺字段需说明影响' }],
  } };
  await read(await host.request(requirement, 'PATCH', { instance: draft }));
  await read(await host.request(requirement + '/confirm', 'POST', { confirmedBy: '合成检查' }));
  return { host, provider, project, task, route, requirement, draft, instanceId: created.id };
}

test('FCR-A1/A2: same foreground review receives exact confirmed framework and current user scope; author owns disposition', { timeout: 90_000 }, async t => {
  for (const handling of ['omission', 'gap', 'equivalent', 'adjusted'] as const) await t.test(handling, async t => {
    const f = await fixture(t);
    f.provider.setResponder(() => ({ text: JSON.stringify({ ...f.draft.framework, assessment: { value: '确定下一步', feasibility: '可核销量', scope: '渠道与品类', gaps: [] } }) }));
    const { frameworkProposal: proposal } = await read(await f.host.request(f.requirement + '/generate', 'POST', { call: 'framework', frameworkReview: true }));
    await read(await f.host.request(f.requirement + '/confirm-framework', 'POST', { version: proposal.version, confirmedBy: '合成检查' }));
    const original = handling === 'gap' ? '# 初稿\n渠道44→49。品类映射缺失，无法判断品类增减，待补证。'
      : handling === 'equivalent' ? '# 初稿\n渠道×品类交叉表已列出两个维度，合计44→49。'
      : '# 初稿\n渠道44→49，增长11.36%。';
    const revised = '# 修订稿\n渠道：直播18→21，店铺26→28。品类：上衣25→29，裤装19→20。合计44→49。';
    const advice = handling === 'omission' ? '未说明的遗漏：框架3.2要求品类；初稿仅渠道。按本轮明细补齐，否则不能判断品类变化。'
      : handling === 'gap' ? '明确限缩或待补证：初稿说明品类映射缺失及其影响。渠道已回应。'
      : handling === 'equivalent' ? '已回应：初稿交叉表等效覆盖渠道与品类，方法不同无需改稿。'
      : '已回应：当前用户明确将品类移出范围。该调整不同于Agent因证据不足限缩。';
    let childCount = 0, supplied = '';
    f.provider.setResponder(({ messages, recentToolResults }) => {
      if (reviewer(messages)) { childCount++; supplied = textOf(messages); return { text: advice }; }
      if (!recentToolResults.length) return { calls: [{ name: 'write_report', arguments: { filename: 'initial.md', content: original } }] };
      if (recentToolResults.length === 1) return { calls: [{ name: 'review_report_calculations', arguments: { report: { path: '060_reports/initial.md' } } }] };
      if (recentToolResults.length === 2 && handling === 'omission') return { calls: [{ name: 'write_report', arguments: { filename: 'revised.md', content: revised } }] };
      return { text: handling === 'omission' ? '按同一3.2要求复查渠道、品类与合计，已另存revised.md，初稿保留。' : '已核实意见和同一要求，保留有依据的initial.md及已说明范围。' };
    });
    const events = await sessionEvents(f.host, f.project.id, f.task.id); t.after(() => events.close());
    const requestId = randomUUID();
    const userText = handling === 'adjusted' ? '本轮明确只做渠道，品类移出范围。USER_SCOPE_ADJUSTMENT' : '按照已确认框架生成报告。CURRENT_USER_SCOPE';
    await read(await f.host.request(f.route + '/messages', 'POST', { text: userText, requestId, requirementContext: { instanceId: f.instanceId, frameworkVersion: proposal.version } }), 202);
    await events.terminal;
    const state = await read(await f.host.request(f.route));
    assert.equal(state.task.lastRun.status, 'completed');
    assert.equal(childCount, 1);
    assert.ok(supplied.includes(proposal.version));
    assert.match(supplied, /渠道变化|品类变化/);
    assert.ok(supplied.includes(userText), 'reviewer must receive actual current user scope, not infer it from the report');
    const native = (await readFile(state.task.sessionFile, 'utf8')).trim().split('\n').map(line => JSON.parse(line));
    const reviews = native.filter(entry => entry.message?.toolName === 'review_report_calculations');
    assert.equal(reviews.length, 1);
    const detail = reviews[0].message.details;
    assert.equal(detail.requestId, requestId);
    assert.match(providerMessageText(reviews[0].message.content), new RegExp(advice.split('：')[0]!));
    const framework = detail.receipt.materials.find((item: any) => item.kind === 'framework');
    assert.equal(framework.locator.frameworkVersion, proposal.version);
    const historical = await read(await f.host.request(f.route + `/report-calculation-reviews/${requestId}/${detail.receipt.reviewId}/materials/${framework.id}`));
    const context = (await read(await f.host.request(f.route + '/context-receipts'))).receipts.find((entry: any) => entry.requestId === requestId).providedContext.rap;
    assert.equal(historical.text, context.text);
    assert.equal(framework.sha256, createHash('sha256').update(context.text).digest('hex'));
    assert.equal(await readFile(path.join(f.project.rootPath, '060_reports/initial.md'), 'utf8'), original);
    if (handling === 'omission') assert.equal(await readFile(path.join(f.project.rootPath, '060_reports/revised.md'), 'utf8'), revised);
    assert.deepEqual(f.provider.errors, []);
  });
});

test('FCR-A3: actual historical published RAP is reused while later publication and merely existing RAP do not become inputs', { timeout: 45_000 }, async t => {
  const f = await fixture(t);
  await read(await f.host.request(f.requirement + '/publish', 'POST', { version: '1.0.0', releasedBy: '合成检查' }), 201);
  const firstId = randomUUID();
  let events = await sessionEvents(f.host, f.project.id, f.task.id);
  await read(await f.host.request(f.route + '/messages', 'POST', { text: '先收下已发布框架，不生成报告。', requestId: firstId, requirementContext: { instanceId: f.instanceId, version: '1.0.0' } }), 202);
  await events.terminal; events.close();
  const current = (await read(await f.host.request(f.requirement))).instance;
  current.context.background = 'LATER_UNDELIVERED_VERSION';
  await read(await f.host.request(f.requirement, 'PATCH', { instance: current }));
  await read(await f.host.request(f.requirement + '/confirm', 'POST', { confirmedBy: '合成检查' }));
  await read(await f.host.request(f.requirement + '/publish', 'POST', { version: '2.0.0', releasedBy: '合成检查' }), 201);
  const childInputs: string[] = [];
  f.provider.setResponder(({ messages, recentToolResults }) => {
    if (reviewer(messages)) { childInputs.push(textOf(messages)); return { text: '计算44→49增幅11.36%；仅按实际提供范围核对，未提供部分覆盖未核实。' }; }
    if (!recentToolResults.length) return { calls: [{ name: 'write_report', arguments: { filename: 'sales.md', content: '# 正式初稿\n44→49，11.36%。' } }] };
    if (recentToolResults.length === 1) return { calls: [{ name: 'review_report_calculations', arguments: { report: { path: '060_reports/sales.md' } } }] };
    return { text: '已保存sales.md，按实际覆盖范围交付。' };
  });
  const nextId = randomUUID();
  events = await sessionEvents(f.host, f.project.id, f.task.id);
  await read(await f.host.request(f.route + '/messages', 'POST', { text: '按此前实际送入框架生成报告。', requestId: nextId }), 202);
  await events.terminal; events.close();
  assert.equal(childInputs.length, 1);
  assert.match(childInputs[0]!, /FRAMEWORK_ORIGINAL_VERSION/);
  assert.doesNotMatch(childInputs[0]!, /LATER_UNDELIVERED_VERSION/);
  const state = await read(await f.host.request(f.route));
  const frame = state.snapshot.capabilities.reportCalculationReview.receipt.materials.find((item: any) => item.kind === 'framework');
  assert.equal(frame.locator.version, '1.0.0');
  assert.equal(frame.locator.deliveryRequestId, firstId);
  assert.equal(frame.locator.origin, 'native-parent-history');
  const { task: other } = await read(await f.host.request(`/api/projects/${f.project.id}/tasks`, 'POST', { name: '从未送入框架' }), 201);
  events = await sessionEvents(f.host, f.project.id, other.id);
  await read(await f.host.request(`/api/projects/${f.project.id}/tasks/${other.id}/messages`, 'POST', { text: '生成两期销量报告。', requestId: randomUUID() }), 202);
  await events.terminal; events.close();
  assert.equal(childInputs.length, 2);
  assert.doesNotMatch(childInputs[1]!, /FRAMEWORK_ORIGINAL_VERSION|LATER_UNDELIVERED_VERSION/);
  assert.match(childInputs[1]!, /框架|framework/i);
  assert.deepEqual(f.provider.errors, []);
});
