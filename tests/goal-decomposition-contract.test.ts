import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { startTestHost } from './fixtures/host-process.ts';
import { startToolProvider, providerMessageText } from './fixtures/tool-provider.ts';
import { Check } from 'typebox/value';
import { goalDecompositionTool, goalEstimateTool } from '../src/agent/strategy-discussion.ts';
import { parseDecompositionDraftInput, parseReachabilityEstimate, GoalDecompositionError } from '../src/host/strategy-goal-decomposition-validation.ts';
import { makeNormalDraftPayload } from './fixtures/goal-decomposition-draft.ts';
import { createMetricLibrary } from '../extensions/business-plugins/metric-factory/library/store.ts';
import { preparePublication } from '../extensions/business-plugins/metric-factory/sap/validate.ts';

async function json(response: Response, status = 200): Promise<any> {
  const body = await response.text();
  assert.equal(response.status, status, body);
  return JSON.parse(body);
}

async function setup(t: test.TestContext, bindSap = false) {
  const provider = await startToolProvider();
  t.after(() => provider.close());
  const host = await startTestHost();
  t.after(() => host.close());
  await json(await host.request('/api/configuration', 'PUT', {
    name: '拆解契约合成', provider: 'openai-compatible', baseUrl: provider.baseUrl,
    model: 'synthetic-contract', apiKey: 'synthetic-contract-key',
  }));
  const sap = bindSap ? createMetricLibrary(path.join(host.dataRoot, 'metric-assets')).publish(preparePublication(
    readFileSync(new URL('../extensions/business-plugins/metric-factory/fixtures/membership-repurchase@1.0.0.draft.yaml', import.meta.url)),
  ), 'synthetic-user') : undefined;
  const metric = sap ? { authority: 'sap-metric', id: sap.id, version: sap.version, metricName: sap.metricNames[0]! } : undefined;
  const { goal } = await json(await host.request('/api/strategy/goals', 'POST', {
    operationId: randomUUID(), title: '合成比率目标', outcome: '测试队列当期复购率达到 15%',
    perspective: 'profit', scope: { kind: 'department', id: 'synthetic-retail', name: '测试门店组' },
    measurement: metric ? { kind: 'quantitative', sapMetric: metric, target: '15 %' } : { kind: 'deliverable', criterion: '同一成熟队列的复购人数除以总人数' },
    baseline: { state: 'pending', description: '基线待核' }, responsible: '测试负责人',
    dueAt: '2027-03-31', strategies: ['改善到店服务'],
    formalOrigin: { kind: 'manual-exception', reason: '测试尚无战略正式版', period: '2027-03', targetValue: 15, unit: '%', metricKind: 'ratio' },
  }), 201);
  await json(await host.request(`/api/strategy/goals/${goal.goalId}/gsa-plan/confirm`, 'POST', {
    operationId: randomUUID(), expectedGoalVersion: 1, expectedAdoptedVersion: null, expectedPlanVersion: 0,
    plannedActions: [{ id: 'A-1', summary: '改善到店服务', checkpoint: '月末', observationBasis: '成熟队列明细' }],
    decision: '确认测试 GSA',
  }), 201);
  const url = '/api/business-role?owner=' + encodeURIComponent(JSON.stringify({
    role: 'goal', goalId: goal.goalId, version: 1, analysisVariant: 'goal-decomposition',
  }));
  async function turn() {
    const before = await json(await host.request(url));
    await json(await host.request(url + '&action=messages', 'POST', {
      requestId: randomUUID(), text: '按当前契约保存拆解草稿，保留假设和待核项。', expectedRevision: before.discussion?.revision ?? 0,
    }), 202);
    for (let i = 0; i < 800; i++) {
      const detail = await json(await host.request(url));
      if (!detail.busy && detail.discussion?.lastRun?.status === 'completed') return;
      if (!detail.busy && detail.discussion?.lastRun?.status === 'failed') assert.fail(JSON.stringify(detail.discussion.lastRun));
      await delay(25);
    }
    assert.fail('native tool turn did not complete');
  }
  return { host, provider, goal, metric, turn, workspace: () => host.request(`/api/strategy/goals/${goal.goalId}/workspace`).then(r => json(r)) };
}

test('DC01/DC02/DC04: model-visible nested contract + context template saves manual ratio on first native tool attempt', { timeout: 90_000 }, async t => {
  const { provider, turn, workspace } = await setup(t);
  let contract: any, context: any, receipt: any;
  let saves = 0;
  provider.setResponder(ctx => {
    contract = (ctx.request.body.tools?.find(tool => tool.function?.name === 'strategy_goals')?.function?.parameters as any)?.properties;
    const step = ctx.recentToolResults.length;
    if (step === 0) return { calls: [{ name: 'strategy_goals', arguments: { action: 'goal-read-context' } }] };
    if (step === 1) {
      context = JSON.parse(providerMessageText(ctx.recentToolResults[0].content));
      // Intentionally do not import the complete Host fixture. The Provider must be given the contract.
      if (!contract?.estimate?.properties?.formalTargetValue || !context.draftInputTemplate) return { text: '缺少可用保存契约，不能猜字段。' };
      const input = structuredClone(context.draftInputTemplate);
      input.estimate = { ...input.estimate, estimatedValue: 12, gapValue: 3, numerator: 120, denominator: 1000,
        denominatorAssumed: true, basis: '合成假设：120 / 1000 = 12%，待核', limitations: ['基线与分母均待核'],
        methodNote: '假设情景推演，非独立预测承诺' };
      input.rows = [{ rowId: 'R-1', title: '测试门店组', outcome: '成熟队列复购率达到 15%',
        scope: context.goal.scope, scopeLabel: context.goal.scope.name, responsible: '测试负责人', strategy: '改善到店服务',
        contributionNature: 'allocation', commitAsGoal: false, metricKind: 'ratio', targetValue: 15, unit: '%',
        ratio: { numerator: 150, denominator: 1000, denominatorAssumed: true, definition: '成熟队列复购人数 / 总人数' },
        basis: '分母为合成假设，待核', checkpoints: [], tracked: true }];
      input.notes = '人工原文保留：仅试点，不提前扩展。';
      saves++;
      return { calls: [{ name: 'strategy_goals', arguments: { action: 'goal-save-decomposition-draft', ...input } }] };
    }
    receipt = JSON.parse(providerMessageText(ctx.recentToolResults[1].content));
    return { text: '按实际保存回执汇报，发布条件另核。' };
  });
  await turn();
  const ws = await workspace();
  assert.ok(ws.draft, 'Agent must receive enough contract to persist a ratio draft, without guessing private Host fields');
  assert.equal(saves, 1);
  assert.equal(receipt.saved, true);
  assert.equal(receipt.claim, 'decomposition-draft-not-published');
  for (const name of ['metricKind', 'unit', 'period', 'scopeDescription', 'formalTargetValue', 'estimatedValue', 'gapValue', 'basis', 'evidence']) {
    assert.ok(contract.estimate.properties[name], `estimate.${name} advertised`);
  }
  for (const name of ['rows', 'reserves', 'gapStrategies', 'views', 'timePlan']) assert.ok(contract[name].items.properties, `${name} nested contract advertised`);
  assert.equal(context.draftInputTemplate.estimate.estimatedValue, null, 'Host must not invent estimate');
  assert.equal(context.draftInputTemplate.estimate.gapValue, null);
  assert.deepEqual([ws.draft.estimate.formalTargetValue, ws.draft.estimate.estimatedValue, ws.draft.estimate.gapValue], [15, 12, 3]);
  assert.equal(ws.draft.estimate.sapMetric, undefined);
  assert.equal(ws.draft.estimate.scriptReceipts, undefined);
  assert.deepEqual(ws.draft.estimate.limitations, ['基线与分母均待核']);
  assert.equal(ws.validation.ok, false, 'saved draft must not erase uncovered gap or assumed denominator');
  assert.equal(ws.publications.length, 0);
  const calls = provider.requests.flatMap(r => r.body.messages ?? []).flatMap(m => m.tool_calls ?? []) as any[];
  assert.ok(!calls.some(call => JSON.parse(call.function.arguments).action === 'goal-run-script'), 'no GMV script required');

  let resumed: any;
  provider.setResponder(ctx => {
    if (!ctx.recentToolResults.length) return { calls: [{ name: 'strategy_goals', arguments: { action: 'goal-read-context' } }] };
    resumed = JSON.parse(providerMessageText(ctx.recentToolResults[0].content));
    return { text: '原草稿仍在，保留人工内容。' };
  });
  await turn();
  assert.equal(resumed.draft.notes, ws.draft.notes);
  assert.equal(resumed.expectedDraftRevision, 1);
  assert.equal(resumed.draftInputTemplate, undefined, 'existing draft is not replaced/duplicated by an empty template');
  assert.deepEqual(provider.errors, []);
});

test('DC03/DC05: parser feedback identifies malformed nested fields; compatible amount/milestone/unknown estimates remain accepted', () => {
  // Complete historical fixture is used only for compatibility, never for the discoverability/native-save tests above.
  const input = makeNormalDraftPayload({ planId: randomUUID(), planVersion: 1, contentSha256: 'a'.repeat(64) });
  const { operationId, ...toolInput } = input;
  assert.ok(Check(goalDecompositionTool.parameters, { action: 'goal-save-decomposition-draft', ...toolInput }));
  assert.equal(parseDecompositionDraftInput(input).rows.length, input.rows.length);
  for (const metricKind of ['amount', 'ratio', 'milestone'] as const) {
    const estimate = { ...input.estimate, metricKind, estimatedValue: null, gapValue: null, basis: '', evidence: [] };
    assert.ok(Check(goalEstimateTool.parameters, { action: 'goal-save-estimate', estimate }));
    assert.equal(parseReachabilityEstimate(estimate).estimatedValue, null);
  }
  const malformed = { ...input, estimate: { metricKind: 'ratio', formalValue: 15 }, rows: [{ invalid: 'not business-validated' }] };
  assert.throws(() => parseDecompositionDraftInput(malformed), error => {
    assert.ok(error instanceof GoalDecompositionError);
    assert.equal(error.code, 'invalid_reachability_estimate');
    assert.equal(error.details?.saved, false);
    assert.equal(error.details?.publishValidation, 'not-run');
    assert.ok((error.details?.fields as any[]).some(field => field.path === '/estimate/formalTargetValue'));
    assert.match(error.message, /未点名区块不代表已核/);
    return true;
  });
  assert.throws(() => parseDecompositionDraftInput({ ...input, rows: [{ ...input.rows[0], checkpoints: [{ id: 'only-id' }] }] }), error => {
    assert.ok(error instanceof GoalDecompositionError);
    assert.ok((error.details?.fields as any[]).some(field => field.path === '/rows/0/checkpoints/0/label'));
    return true;
  });
  assert.throws(() => parseDecompositionDraftInput({ ...input, rows: [input.rows[0], input.rows[0]] }), error => {
    assert.ok(error instanceof GoalDecompositionError);
    assert.equal(error.details?.publishValidation, 'not-run');
    assert.equal((error.details?.fields as any[])[0].path, '/rows');
    return true;
  });
  for (const [raw, field] of [
    [{ ...input, estimate: { ...input.estimate, basis: '   ' } }, '/estimate/basis'],
    [{ ...input, notes: '   ' }, '/notes'],
  ] as const) {
    const { operationId: ignored, ...candidate } = raw;
    assert.equal(Check(goalDecompositionTool.parameters, { action: 'goal-save-decomposition-draft', ...candidate }), false);
    assert.throws(() => parseDecompositionDraftInput(raw), error => {
      assert.ok(error instanceof GoalDecompositionError);
      assert.ok((error.details?.fields as any[]).some(issue => issue.path === field));
      assert.equal(error.details?.publishValidation, 'not-run');
      return true;
    });
  }
  assert.throws(() => parseDecompositionDraftInput({ ...input, rows: [{ ...input.rows[0], dimensions: { PRIVATE_DIMENSION_KEY: 123 } }] }), error => {
    assert.ok(error instanceof GoalDecompositionError);
    assert.doesNotMatch(error.message + JSON.stringify(error.details), /PRIVATE_DIMENSION_KEY|123/);
    assert.ok((error.details?.fields as any[]).some(issue => issue.path === '/rows/0/dimensions'));
    return true;
  });
  for (const key of ['x'.repeat(81), '   ']) {
    const raw = { ...input, rows: [{ ...input.rows[0], dimensions: { [key]: 'safe-value' } }] };
    const { operationId: ignored, ...candidate } = raw;
    assert.equal(Check(goalDecompositionTool.parameters, { action: 'goal-save-decomposition-draft', ...candidate }), false);
    assert.throws(() => parseDecompositionDraftInput(raw), error => {
      assert.ok(error instanceof GoalDecompositionError);
      assert.ok((error.details?.fields as any[]).some(issue => issue.path === '/rows/0/dimensions'));
      assert.ok(!error.message.includes(key));
      return true;
    });
  }
  for (const field of ['gsaPlanVersion', 'expectedDraftRevision'] as const) {
    const raw = { ...input, [field]: Number.MAX_SAFE_INTEGER + 1 };
    const { operationId: ignored, ...candidate } = raw;
    assert.equal(Check(goalDecompositionTool.parameters, { action: 'goal-save-decomposition-draft', ...candidate }), false);
    assert.throws(() => parseDecompositionDraftInput(raw), error => {
      assert.ok(error instanceof GoalDecompositionError);
      assert.ok((error.details?.fields as any[]).some(issue => issue.path === `/${field}`));
      return true;
    });
  }
});

test('DC02/DC05: manual origin with an actual SAP binding keeps its exact metric; mismatched definition still blocks publication', { timeout: 90_000 }, async t => {
  const { provider, host, goal, metric, turn, workspace } = await setup(t, true);
  let template: any;
  provider.setResponder(ctx => {
    const step = ctx.recentToolResults.length;
    if (!step) return { calls: [{ name: 'strategy_goals', arguments: { action: 'goal-read-context' } }] };
    if (step === 1) {
      template = JSON.parse(providerMessageText(ctx.recentToolResults[0].content)).draftInputTemplate;
      return { calls: [{ name: 'strategy_goals', arguments: { action: 'goal-save-decomposition-draft', ...template } }] };
    }
    return { text: '准确指标引用已保留，测算尚待核。' };
  });
  await turn();
  const ws = await workspace();
  assert.deepEqual(ws.draft.estimate.sapMetric, { id: metric!.id, version: metric!.version, metricName: metric!.metricName });
  assert.ok(!ws.validation.issues.some((issue: any) => issue.code === 'incomparable_estimate_caliber'));
  const mismatch = await json(await host.request(`/api/strategy/goals/${goal.goalId}/decomposition/draft`, 'POST', {
    ...template, expectedDraftRevision: 1, estimate: { ...template.estimate, sapMetric: { ...template.estimate.sapMetric, version: 'wrong-version' } },
  }), 201);
  assert.ok(mismatch.validation.issues.some((issue: any) => issue.code === 'incomparable_estimate_caliber'));
  assert.equal((await workspace()).publications.length, 0);
});

test('DC03: official Pi schema rejects guessed estimate shape before Host; correction can save unknowns without fake numbers', { timeout: 90_000 }, async t => {
  const { provider, turn, workspace } = await setup(t);
  let template: any, fieldError = '', noPartial: any, receipt: any;
  provider.setResponder(async ctx => {
    const step = ctx.recentToolResults.length;
    if (!step) return { calls: [{ name: 'strategy_goals', arguments: { action: 'goal-read-context' } }] };
    if (step === 1) {
      template = JSON.parse(providerMessageText(ctx.recentToolResults[0].content)).draftInputTemplate;
      return { calls: [{ name: 'strategy_goals', arguments: { action: 'goal-save-decomposition-draft', ...template,
        estimate: { metricKind: 'ratio', formalValue: 15, estimateValue: 12, gapValue: 3 } } }] };
    }
    if (step === 2) {
      fieldError = providerMessageText(ctx.recentToolResults[1].content);
      noPartial = await workspace();
      if (!fieldError.includes('formalTargetValue')) return { text: '缺少准确字段反馈。' };
      return { calls: [{ name: 'strategy_goals', arguments: { action: 'goal-save-decomposition-draft', ...template,
        notes: '基线未核实；先存已知内容，测算值未知。' } }] };
    }
    receipt = JSON.parse(providerMessageText(ctx.recentToolResults[2].content));
    return { text: '待完善草稿已存，尚不可发布。' };
  });
  await turn();
  assert.match(fieldError, /formalTargetValue/);
  assert.equal(noPartial.draft, null);
  assert.equal(receipt.saved, true);
  assert.ok(receipt.validation.issues.some((issue: any) => issue.code === 'incomplete_reachability_estimate'));
  const ws = await workspace();
  assert.equal(ws.draft.estimate.estimatedValue, null);
  assert.equal(ws.draft.estimate.gapValue, null);
  assert.equal(ws.draft.revision, 1);
  assert.equal(ws.publications.length, 0);
});

test('DC03: native tool error identifies gap field; same session corrects it without partial writes or publication', { timeout: 90_000 }, async t => {
  const { provider, turn, workspace } = await setup(t);
  let input: any, errorText = '', beforeCorrection: any, receipt: any;
  provider.setResponder(async ctx => {
    const step = ctx.recentToolResults.length;
    if (step === 0) return { calls: [{ name: 'strategy_goals', arguments: { action: 'goal-read-context' } }] };
    if (step === 1) {
      const context = JSON.parse(providerMessageText(ctx.recentToolResults[0].content));
      if (!context.draftInputTemplate) return { text: '没有保存模板。' };
      input = structuredClone(context.draftInputTemplate);
      input.estimate = { ...input.estimate, estimatedValue: 12, gapValue: 0, basis: '有意提交不一致差额的合成反例' };
      return { calls: [{ name: 'strategy_goals', arguments: { action: 'goal-save-decomposition-draft', ...input } }] };
    }
    if (step === 2) {
      errorText = providerMessageText(ctx.recentToolResults[1].content);
      beforeCorrection = await workspace();
      if (!errorText.includes('/estimate/gapValue') || !errorText.includes('not-run')) return { text: '错误缺少具体字段或校验范围。' };
      input.estimate.gapValue = 3;
      return { calls: [{ name: 'strategy_goals', arguments: { action: 'goal-save-decomposition-draft', ...input } }] };
    }
    receipt = JSON.parse(providerMessageText(ctx.recentToolResults[2].content));
    return { text: '差额已纠正并保存，缺项仍待补充，未发布。' };
  });
  await turn();
  assert.match(errorText, /invalid_reachability_estimate_gap/);
  assert.match(errorText, /\/estimate\/gapValue/);
  assert.match(errorText, /not-run/);
  assert.equal(beforeCorrection.draft, null);
  assert.equal(receipt.saved, true);
  assert.equal(receipt.validation.ok, false);
  const ws = await workspace();
  assert.equal(ws.draft.revision, 1, 'failed save did not consume revision');
  assert.equal(ws.draft.estimate.gapValue, 3);
  assert.equal(ws.publications.length, 0);
  assert.deepEqual(provider.errors, []);
});
