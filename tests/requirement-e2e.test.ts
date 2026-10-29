import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { startTestHost } from './fixtures/host-process.ts';
import { startSyntheticProvider } from './fixtures/synthetic-provider.ts';
import { sessionEvents } from './fixtures/session-events.ts';

async function json(response: Response, expected = 200): Promise<any> { assert.equal(response.status, expected, await response.clone().text()); return response.json(); }
async function until(ready: () => boolean, message: string) { const deadline = Date.now() + 20_000; while (!ready()) { if (Date.now() > deadline) throw new Error(message); await new Promise(resolve => setTimeout(resolve, 20)); } }

const elicitReply = '```json\n' + JSON.stringify({
  clarifications: [
    { category: '指标口径', priority: 'must_confirm', question: '复购口径是否剔除退款单？', rationale: '影响分子' },
    { category: '对象/人群', priority: 'must_confirm', question: '分母只算大促首购会员吗？', rationale: '人群口径' },
    { category: '时间窗口', priority: 'should_confirm', question: '窗口固定30天？', rationale: '口径漂移' },
  ],
  facts: ['双11大促首购会员30天复购率从28%下滑至19%'],
  hypotheses: [{ statement: '高额满减券吸引低客单羊毛党', evidence: '券核销占比上升', validationCondition: '券核销用户复购率显著更低' }],
}) + '\n```';
const frameworkReply = '```json\n' + JSON.stringify({
  metrics: [{ name: '30日会员复购率', definition: '首购后30天内二次有效支付会员数/首购会员总数', dimensions: ['首购渠道'], source: '实例新增口径' }],
  dataNeeds: [{ table: 'dwd_trade_order_di', fields: ['user_id', 'order_time'], priority: 'P0', purpose: '订单明细' }],
  analysisPaths: [{ question: '渠道复购率差异？', hypothesis: 'hyp-1', method: '渠道分层+卡方', requiredData: ['dwd_trade_order_di'], expectedOutput: '对比结论' }],
  reportFramework: [{ section: '01 归因总览', purpose: '主因排序', keyQuestions: ['主因?'], evidence: ['分解树'], zeroHallucinationCheck: '相关性不得写成因果' }],
  openQuestions: ['退款单口径未定'],
  risks: ['渠道投放混杂'],
}) + '\n```';

test('RE-06: synthetic closed loop from one-line request to an injected task context', { timeout: 90_000 }, async t => {
  const provider = await startSyntheticProvider(); t.after(() => provider.close());
  const host = await startTestHost(); t.after(() => host.close());
  await json(await host.request('/api/configuration', 'PUT', { name: '需求闭环合成配置', provider: 'openai-compatible', baseUrl: provider.baseUrl, model: 'synthetic-requirement-loop', apiKey: 'synthetic-requirement-key' }));

  // 一句话诉求创建实例并补齐四要素。
  const created = await json(await host.request('/api/requirement-instances', 'POST', { title: '双11复购下滑归因', scene: 'topic' }), 201);
  const id = created.instance.id as string;
  const detail = await json(await host.request(`/api/requirement-instances/${id}`));
  const instance = detail.instance;
  instance.context = { background: '双11后大盘复购走低', goal: '定位30天复购率下滑主驱动因素', decisionScenario: '指导下季度预算分配' };
  await json(await host.request(`/api/requirement-instances/${id}`, 'PATCH', { instance }));

  // Stage 01：AI 首轮推断（真实插件会话 + 合成 provider）→ 提案 → 采纳。
  provider.setChunks([elicitReply]);
  const generated = await json(await host.request(`/api/requirement-instances/${id}/generate`, 'POST', { call: 'elicit' }));
  assert.equal(generated.call, 'elicit');
  assert.equal(generated.proposal.clarifications.length, 3);
  const adopted = await json(await host.request(`/api/requirement-instances/${id}`));
  adopted.instance.clarifications.push(...generated.proposal.clarifications);
  adopted.instance.facts.push(...generated.proposal.facts);
  adopted.instance.hypotheses.push(...generated.proposal.hypotheses);
  await json(await host.request(`/api/requirement-instances/${id}`, 'PATCH', { instance: adopted.instance }));

  // Stage 02：确认快照。
  const confirmed = await json(await host.request(`/api/requirement-instances/${id}/confirm`, 'POST', { confirmedBy: 'huangbo' }));
  assert.match(confirmed.instance.snapshot.fingerprint, /^sha256:[a-f0-9]{64}$/);
  assert.equal(confirmed.gates.publishBlocked, true, '框架缺失仍阻断发布');

  // Stage 03：框架生成 → 采纳。
  provider.setChunks([frameworkReply]);
  const framework = await json(await host.request(`/api/requirement-instances/${id}/generate`, 'POST', { call: 'framework' }));
  assert.equal(framework.proposal.framework.metrics.length, 1);
  const withFramework = await json(await host.request(`/api/requirement-instances/${id}`));
  withFramework.instance.framework = framework.proposal.framework;
  const ready = await json(await host.request(`/api/requirement-instances/${id}`, 'PATCH', { instance: withFramework.instance }));
  assert.equal(ready.gates.publishBlocked, false);

  // Stage 04：发布 RAP。
  const published = await json(await host.request(`/api/requirement-instances/${id}/publish`, 'POST', { version: '1.0.0', releasedBy: 'huangbo' }), 201);
  assert.equal(published.entry.version, '1.0.0');

  // 送入：普通任务消息携带 requirementContext，摘要进入模型请求。
  const { project } = await json(await host.request('/api/projects', 'POST', { name: '需求送入项目' }), 201);
  const { task } = await json(await host.request(`/api/projects/${project.id}/tasks`, 'POST', { name: '复购归因分析' }), 201);
  const stream = await sessionEvents(host, project.id, task.id); t.after(() => stream.close());
  await json(await host.request(`/api/projects/${project.id}/tasks/${task.id}/messages`, 'POST', { text: '请按需求契约开展分析。', requestId: randomUUID(), requirementContext: { instanceId: id, version: '1.0.0' } }), 202);
  await until(() => stream.events.some((event: any) => event.type === 'run.settled'), 'Synthetic run never settled.');
  await provider.waitForRequests(3);
  const userPayload = JSON.stringify(provider.requests[2]!.body.messages?.filter((message: any) => message.role !== 'system') ?? []);
  assert.match(userPayload, /关联需求契约/);
  assert.match(userPayload, /30日会员复购率/);
  assert.match(userPayload, /dwd_trade_order_di\(P0\)/);
  assert.match(userPayload, /不是执行指令/);
  assert.doesNotMatch(userPayload, /open_questions ×0/, 'open questions ride along as unresolved, not as facts');

  // 未知实例与无效选择拒绝且不产生模型请求。
  const before = provider.requests.length;
  await json(await host.request(`/api/projects/${project.id}/tasks/${task.id}/messages`, 'POST', { text: '不应发送', requestId: randomUUID(), requirementContext: { instanceId: 'req-missing' } }), 404);
  assert.equal(provider.requests.length, before, 'A rejected requirement context must not reach the model');
});
