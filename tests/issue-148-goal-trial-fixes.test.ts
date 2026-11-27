import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import type { DecompositionDraftInput } from '../src/host/strategy-goal-decomposition-types.ts';
import { startTestHost } from './fixtures/host-process.ts';
import { makeNormalDraftPayload } from './fixtures/goal-decomposition-draft.ts';
import { startToolProvider } from './fixtures/tool-provider.ts';

async function json(res: Response, expected = 200): Promise<any> {
  const data = await res.json();
  assert.equal(res.status, expected, `expected ${expected}, got ${res.status}: ${JSON.stringify(data)}`);
  return data;
}

async function createAdoptedGoalWithGsa(
  host: Awaited<ReturnType<typeof startTestHost>>,
  opts: { title?: string; targetValue?: number; criterion?: string; strategy?: string } = {},
) {
  const targetValue = opts.targetValue ?? 120;
  const criterion = opts.criterion ?? '净销售额';
  const strategy = opts.strategy ?? '新品陈列与会员回访';
  const { goal } = await json(
    await host.request('/api/strategy/goals', 'POST', {
      operationId: randomUUID(),
      title: opts.title ?? '2027-01 净销售额目标',
      outcome: `净销售额达到 ${targetValue} 万元`,
      perspective: 'profit',
      scope: { kind: 'department', id: 'retail-dept', name: '零售事业部' },
      measurement: { kind: 'deliverable', criterion },
      baseline: { state: 'known', description: '上月 108 万元' },
      responsible: '林负责人',
      strategies: [strategy],
      dueAt: '2027-01-31',
      formalOrigin: {
        kind: 'manual-exception',
        reason: '测试手工正式目标',
        period: '2027-01',
        targetValue,
        unit: '万元',
        metricKind: 'amount',
      },
    }),
    201,
  );
  const route = `/api/strategy/goals/${goal.goalId}`;
  const { gsaPlan } = await json(
    await host.request(`${route}/gsa-plan/confirm`, 'POST', {
      operationId: randomUUID(),
      expectedGoalVersion: 1,
      expectedAdoptedVersion: null,
      expectedPlanVersion: 0,
      plannedActions: [
        {
          id: 'A1',
          summary: '重点门店新品陈列与会员回访',
          checkpoint: '2027-01-31',
          observationBasis: 'POS 销售结账报表',
        },
      ],
      decision: '确认初始总 GSA',
    }),
    201,
  );
  return { goal, gsaPlan, route };
}

test('A1: G/S 跨目标版本后可准确承接旧拆解草稿（覆盖五种情形与门禁）', async () => {
  const host = await startTestHost();
  try {
    // --- Case 1: 仅有未发布稿 -> 修订 G/S 到 v2 并确认 GSA v2 ---
    const { goal: g1, gsaPlan: plan1, route: route1 } = await createAdoptedGoalWithGsa(host, {
      title: 'A1-未发布稿承接',
      targetValue: 120,
    });
    const draft1Payload = makeNormalDraftPayload(plan1, { notes: '人改未发布草稿备注-v1' });
    const { draft: draft1 } = await json(
      await host.request(`${route1}/decomposition/draft`, 'POST', draft1Payload),
      201,
    );
    assert.equal(draft1.revision, 1);

    // Revise G/S to goal v2 (targetValue 120 -> 150) and confirm GSA v2
    const { gsaPlan: plan2 } = await json(
      await host.request(`${route1}/gsa-plan/confirm`, 'POST', {
        operationId: randomUUID(),
        expectedGoalVersion: 1,
        expectedAdoptedVersion: 1,
        expectedPlanVersion: 1,
        goalRevision: {
          title: 'A1-未发布稿承接（扩量版）',
          outcome: '净销售额达到 150 万元',
          perspective: 'profit',
          scope: { kind: 'department', id: 'retail-dept', name: '零售事业部' },
          measurement: { kind: 'deliverable', criterion: '净销售额' },
          baseline: { state: 'known', description: '上月 108 万元' },
          responsible: '林负责人',
          strategies: ['新品陈列与会员回访', '大客户团购拓展'],
          dueAt: '2027-01-31',
          formalOrigin: {
            kind: 'manual-exception',
            reason: '季度冲刺上调目标',
            period: '2027-01',
            targetValue: 150,
            unit: '万元',
            metricKind: 'amount',
          },
        },
        plannedActions: [
          {
            id: 'A1',
            summary: '重点门店新品陈列与大客户团购',
            checkpoint: '2027-01-31',
            observationBasis: 'POS 销售结账报表',
          },
        ],
        decision: '确认新版总 GSA v2',
        supersedesReason: '上调目标至 150 万元并新增团购策略',
      }),
      201,
    );
    assert.equal(plan2.goal.version, 2);
    assert.equal(plan2.planVersion, 2);

    const wsAfterGs = await json(await host.request(`${route1}/workspace`));
    assert.equal(wsAfterGs.draft, null, 'current goal version has no draft yet');
    assert.equal(wsAfterGs.latestDraftRevision, 1);
    assert.ok(wsAfterGs.priorDraft, 'workspace must expose priorDraft for cross-version carryover');
    assert.equal(wsAfterGs.priorDraft.revision, 1);
    assert.equal(wsAfterGs.priorDraft.gsaPlanVersion, 1);
    assert.equal(wsAfterGs.priorDraft.notes, '人改未发布草稿备注-v1');

    // Without reviewedPreviousPlanVersion, Host still blocks
    await json(
      await host.request(`${route1}/decomposition/draft`, 'POST', {
        ...draft1Payload,
        gsaPlanId: plan2.planId,
        gsaPlanVersion: plan2.planVersion,
        gsaPlanSha256: plan2.contentSha256,
        expectedDraftRevision: 1,
      }),
      409,
    );

    // Carryover with reviewedPreviousPlanVersion succeeds, preserves edits, re-validates mismatch without auto-balancing
    const carriedPayload: DecompositionDraftInput = {
      gsaPlanId: plan2.planId,
      gsaPlanVersion: plan2.planVersion,
      gsaPlanSha256: plan2.contentSha256,
      expectedDraftRevision: wsAfterGs.priorDraft.revision,
      reviewedPreviousPlanVersion: wsAfterGs.priorDraft.gsaPlanVersion,
      estimate: {
        ...wsAfterGs.priorDraft.estimate,
        formalTargetValue: plan2.formalTarget.value,
        gapValue: plan2.formalTarget.value - wsAfterGs.priorDraft.estimate.estimatedValue,
      },
      rows: wsAfterGs.priorDraft.rows,
      reserves: wsAfterGs.priorDraft.reserves,
      gapStrategies: wsAfterGs.priorDraft.gapStrategies,
      views: wsAfterGs.priorDraft.views,
      timePlan: wsAfterGs.priorDraft.timePlan,
      notes: wsAfterGs.priorDraft.notes,
    };
    const carriedRes = await json(
      await host.request(`${route1}/decomposition/draft`, 'POST', carriedPayload),
      201,
    );
    assert.equal(carriedRes.draft.revision, 2);
    assert.equal(carriedRes.draft.notes, '人改未发布草稿备注-v1');
    assert.equal(carriedRes.draft.reserves.length, draft1Payload.reserves.length);
    assert.equal(carriedRes.draft.gapStrategies.length, draft1Payload.gapStrategies.length);
    assert.equal(carriedRes.draft.timePlan.length, draft1Payload.timePlan.length);
    assert.equal(carriedRes.validation.ok, false, 'changed total 150 must trigger mismatch without auto-balancing');
    assert.ok(
      carriedRes.validation.issues.some((i: { code: string }) => i.code === 'allocation_total_mismatch'),
      'allocation mismatch should be surfaced',
    );
    const wsAfterCarry = await json(await host.request(`${route1}/workspace`));
    assert.equal(wsAfterCarry.publications.length, 0, 'carryover must not auto-publish');
    assert.equal(wsAfterCarry.priorDraft, null, 'priorDraft cleared once current draft matches active GSA');

    // --- Case 2: 已发布后另有未发布修订 -> 必须承接最新未发布稿 rev 2，而不是正式版 v1 快照 ---
    const { gsaPlan: p2v1, route: route2 } = await createAdoptedGoalWithGsa(host, {
      title: 'A1-已发布且有未发布修订',
      targetValue: 120,
    });
    const d2Rev1Payload = makeNormalDraftPayload(p2v1, { notes: '正式版v1草稿备注' });
    const { draft: d2Rev1 } = await json(
      await host.request(`${route2}/decomposition/draft`, 'POST', d2Rev1Payload),
      201,
    );
    const prev2 = await json(
      await host.request(`${route2}/decomposition/publish-preview`, 'POST', {
        gsaPlanId: p2v1.planId,
        gsaPlanVersion: p2v1.planVersion,
        gsaPlanSha256: p2v1.contentSha256,
        draftRevision: d2Rev1.revision,
        draftSha256: d2Rev1.contentSha256,
        expectedActiveVersion: null,
      }),
    );
    await json(
      await host.request(`${route2}/decomposition/publish`, 'POST', {
        operationId: randomUUID(),
        gsaPlanId: p2v1.planId,
        gsaPlanVersion: p2v1.planVersion,
        gsaPlanSha256: p2v1.contentSha256,
        draftRevision: d2Rev1.revision,
        draftSha256: d2Rev1.contentSha256,
        previewSha256: prev2.previewSha256,
        expectedActiveVersion: null,
        reason: '发布 v1',
      }),
      201,
    );
    // Save unpublished edit rev 2 on top of published v1
    const d2Rev2Payload = makeNormalDraftPayload(p2v1, { expectedDraftRevision: 1, notes: '发布后新增未发布编辑-rev2' });
    const { draft: d2Rev2 } = await json(
      await host.request(`${route2}/decomposition/draft`, 'POST', d2Rev2Payload),
      201,
    );
    assert.equal(d2Rev2.revision, 2);

    // Revise G/S to goal v2 and confirm GSA v2
    await json(
      await host.request(`${route2}/gsa-plan/confirm`, 'POST', {
        operationId: randomUUID(),
        expectedGoalVersion: 1,
        expectedAdoptedVersion: 1,
        expectedPlanVersion: 1,
        goalRevision: {
          title: 'A1-已发布且有未发布修订（v2）',
          outcome: '净销售额达到 130 万元',
          perspective: 'profit',
          scope: { kind: 'department', id: 'retail-dept', name: '零售事业部' },
          measurement: { kind: 'deliverable', criterion: '净销售额' },
          baseline: { state: 'known', description: '上月 108 万元' },
          responsible: '林负责人',
          strategies: ['新品陈列与会员回访'],
          dueAt: '2027-01-31',
          formalOrigin: {
            kind: 'manual-exception',
            reason: '调整目标为 130 万元',
            period: '2027-01',
            targetValue: 130,
            unit: '万元',
            metricKind: 'amount',
          },
        },
        plannedActions: [
          { id: 'A1', summary: '新计划 A', checkpoint: '2027-01-31', observationBasis: 'POS' },
        ],
        decision: '确认 v2',
        supersedesReason: '目标调整',
      }),
      201,
    );
    const ws2 = await json(await host.request(`${route2}/workspace`));
    assert.equal(ws2.draft, null);
    assert.ok(ws2.priorDraft, 'must expose latest unpublished draft rev 2');
    assert.equal(ws2.priorDraft.revision, 2);
    assert.equal(ws2.priorDraft.notes, '发布后新增未发布编辑-rev2', 'must not substitute published v1 snapshot');
    // Historical publication v1 stays immutable
    const pub2v1 = await json(await host.request(`${route2}/decomposition/publications/1`));
    assert.equal(pub2v1.publication.snapshot.notes, '正式版v1草稿备注');

    // --- Case 3: 从未有稿 -> 修订 G/S 到 v2，不应出现 priorDraft ---
    const { route: route3 } = await createAdoptedGoalWithGsa(host, { title: 'A1-从未有稿' });
    await json(
      await host.request(`${route3}/gsa-plan/confirm`, 'POST', {
        operationId: randomUUID(),
        expectedGoalVersion: 1,
        expectedAdoptedVersion: 1,
        expectedPlanVersion: 1,
        goalRevision: {
          title: 'A1-从未有稿（v2）',
          outcome: '净销售额达到 125 万元',
          perspective: 'profit',
          scope: { kind: 'department', id: 'retail-dept', name: '零售事业部' },
          measurement: { kind: 'deliverable', criterion: '净销售额' },
          baseline: { state: 'known', description: '上月 108 万元' },
          responsible: '林负责人',
          strategies: ['新品陈列与会员回访'],
          dueAt: '2027-01-31',
          formalOrigin: {
            kind: 'manual-exception',
            reason: '调整',
            period: '2027-01',
            targetValue: 125,
            unit: '万元',
            metricKind: 'amount',
          },
        },
        plannedActions: [
          { id: 'A1', summary: '新计划 A', checkpoint: '2027-01-31', observationBasis: 'POS' },
        ],
        decision: '确认 v2',
        supersedesReason: '调整',
      }),
      201,
    );
    const ws3 = await json(await host.request(`${route3}/workspace`));
    assert.equal(ws3.latestDraftRevision, 0);
    assert.equal(ws3.draft, null);
    assert.equal(ws3.priorDraft, null);

    // --- Case 4: 仅改上层 A（目标仍 v1，GSA 升为 v2）---
    const { gsaPlan: p4v1, route: route4 } = await createAdoptedGoalWithGsa(host, { title: 'A1-仅改上层A' });
    await json(await host.request(`${route4}/decomposition/draft`, 'POST', makeNormalDraftPayload(p4v1, { notes: '仅改A原稿' })), 201);
    const { gsaPlan: p4v2 } = await json(
      await host.request(`${route4}/gsa-plan/confirm`, 'POST', {
        operationId: randomUUID(),
        expectedGoalVersion: 1,
        expectedAdoptedVersion: 1,
        expectedPlanVersion: 1,
        plannedActions: [{ id: 'A1', summary: '优化后的计划 A', checkpoint: '2027-01-31', observationBasis: 'POS' }],
        decision: '仅改上层 A',
        supersedesReason: '细化执行计划',
      }),
      201,
    );
    assert.equal(p4v2.goal.version, 1);
    assert.equal(p4v2.planVersion, 2);
    const ws4 = await json(await host.request(`${route4}/workspace`));
    assert.ok(ws4.draft, 'same goal version keeps draft directly readable');
    assert.equal(ws4.draft.gsaPlanVersion, 1);
    assert.equal(ws4.priorDraft, null);

    // --- Case 5: 已发布后未再编辑 -> 修订 G/S 到 v2，可承接 rev 1 ---
    const { gsaPlan: p5v1, route: route5 } = await createAdoptedGoalWithGsa(host, { title: 'A1-已发布未再编辑' });
    const { draft: d5 } = await json(await host.request(`${route5}/decomposition/draft`, 'POST', makeNormalDraftPayload(p5v1, { notes: '已发布未再编辑稿' })), 201);
    const prev5 = await json(
      await host.request(`${route5}/decomposition/publish-preview`, 'POST', {
        gsaPlanId: p5v1.planId, gsaPlanVersion: p5v1.planVersion, gsaPlanSha256: p5v1.contentSha256,
        draftRevision: d5.revision, draftSha256: d5.contentSha256, expectedActiveVersion: null,
      }),
    );
    await json(
      await host.request(`${route5}/decomposition/publish`, 'POST', {
        operationId: randomUUID(),
        gsaPlanId: p5v1.planId, gsaPlanVersion: p5v1.planVersion, gsaPlanSha256: p5v1.contentSha256,
        draftRevision: d5.revision, draftSha256: d5.contentSha256, previewSha256: prev5.previewSha256, expectedActiveVersion: null,
      }),
      201,
    );
    await json(
      await host.request(`${route5}/gsa-plan/confirm`, 'POST', {
        operationId: randomUUID(),
        expectedGoalVersion: 1, expectedAdoptedVersion: 1, expectedPlanVersion: 1,
        goalRevision: {
          title: 'A1-已发布未再编辑（v2）', outcome: '净销售额达到 140 万元', perspective: 'profit',
          scope: { kind: 'department', id: 'retail-dept', name: '零售事业部' },
          measurement: { kind: 'deliverable', criterion: '净销售额' },
          baseline: { state: 'known', description: '上月 108 万元' },
          responsible: '林负责人', strategies: ['新品陈列与会员回访'], dueAt: '2027-01-31',
          formalOrigin: { kind: 'manual-exception', reason: '上调', period: '2027-01', targetValue: 140, unit: '万元', metricKind: 'amount' },
        },
        plannedActions: [{ id: 'A1', summary: '新计划 A', checkpoint: '2027-01-31', observationBasis: 'POS' }],
        decision: '确认 v2', supersedesReason: '目标调整',
      }),
      201,
    );
    const ws5 = await json(await host.request(`${route5}/workspace`));
    assert.equal(ws5.draft, null);
    assert.ok(ws5.priorDraft);
    assert.equal(ws5.priorDraft.revision, 1);
    assert.equal(ws5.priorDraft.notes, '已发布未再编辑稿');
  } finally {
    await host.close();
  }
});

test('A3: 实绩说明与结构判定一致、指出具体待核项、支持有证据口径映射且不覆盖人填排除条件', async () => {
  const host = await startTestHost();
  const provider = await startToolProvider();
  try {
    await json(
      await host.request('/api/configuration', 'PUT', {
        name: '合成核对模型',
        provider: 'openai-compatible',
        baseUrl: provider.baseUrl,
        apiKey: 'synthetic-key',
        model: 'synthetic-model',
      }),
    );
    const { goal, gsaPlan, route } = await createAdoptedGoalWithGsa(host, {
      title: 'A3-实绩核对一致性',
      targetValue: 120,
      criterion: '2027年1月全渠道净销售额',
    });
    const draftPayload = makeNormalDraftPayload(gsaPlan);
    const { draft } = await json(await host.request(`${route}/decomposition/draft`, 'POST', draftPayload), 201);
    const preview = await json(
      await host.request(`${route}/decomposition/publish-preview`, 'POST', {
        gsaPlanId: gsaPlan.planId,
        gsaPlanVersion: gsaPlan.planVersion,
        gsaPlanSha256: gsaPlan.contentSha256,
        draftRevision: draft.revision,
        draftSha256: draft.contentSha256,
        expectedActiveVersion: null,
      }),
    );
    const { publication } = await json(
      await host.request(`${route}/decomposition/publish`, 'POST', {
        operationId: randomUUID(),
        gsaPlanId: gsaPlan.planId,
        gsaPlanVersion: gsaPlan.planVersion,
        gsaPlanSha256: gsaPlan.contentSha256,
        draftRevision: draft.revision,
        draftSha256: draft.contentSha256,
        previewSha256: preview.previewSha256,
        expectedActiveVersion: null,
        reason: '发布 v1',
      }),
      201,
    );
    const period = publication.snapshot.timePlan[1]; // W2: planned 30 万元
    const runAgentAssess = async (actualId: string, args: Record<string, unknown>) => {
      provider.setResponder((ctx) =>
        ctx.recentToolResults.length
          ? { text: '已完成实绩核对。' }
          : { calls: [{ name: 'strategy_goals', arguments: { action: 'goal-assess-actual', ...args } }] },
      );
      const roleRoute =
        '/api/business-role?owner=' +
        encodeURIComponent(
          JSON.stringify({
            role: 'goal',
            goalId: goal.goalId,
            version: 1,
            actualId,
            analysisVariant: 'goal-decomposition',
          }),
        );
      await json(
        await host.request(`${roleRoute}&action=messages`, 'POST', {
          requestId: randomUUID(),
          text: '核对这份实绩',
          expectedRevision: 0,
        }),
        202,
      );
      for (let i = 0; i < 250; i++) {
        const ws = await json(await host.request(`${route}/workspace`));
        const found = ws.checks.find((c: { operationId: string }) => c.operationId === actualId);
        if (found) return found;
        await new Promise(r => setTimeout(r, 50));
      }
      const conv = await json(await host.request(roleRoute));
      assert.fail(`timed out waiting for check ${actualId}; providerReqs=${provider.requests.length}; lastRun=${JSON.stringify(conv.discussion?.lastRun)}; entries=${JSON.stringify(conv.snapshot?.entries?.slice(-3))}`);
    };

    // --- 3a: Agent passes summary metric without mapping -> downgraded to incomparable, note reconciled, issues explicit ---
    const report3a = '数据截至 2027-01-14。已结账净销售额 27 万元，全渠道与门店均已结账。';
    const { actual: act3a } = await json(
      await host.request(`${route}/decomposition/actuals`, 'POST', {
        operationId: randomUUID(),
        publicationVersion: 1,
        rowId: 'G-TOTAL',
        checkpointId: period.checkpointId ?? period.periodId,
        actualSource: { ref: 'pos-3a.txt', label: '第2周实绩-3a', cutoffAt: '2027-01-14', reportText: report3a },
        actualPeriods: [{ periodId: period.periodId, actualValue: 27 }],
      }),
      201,
    );
    const chk3a = await runAgentAssess(act3a.actualId, {
      comparability: 'comparable',
      assessmentNote: '口径一致，判定 comparable，达成90%，偏差-10%。',
      observation: {
        quote: '已结账净销售额 27 万元',
        actualValue: 27,
        basis: {
          metric: '已结账净销售额',
          unit: '万元',
          scope: '零售事业部 · 全渠道与门店',
          periodId: period.periodId,
          coverage: 'complete',
          maturity: 'closed',
        },
      },
    });
    assert.equal(chk3a.comparability, 'incomparable');
    assert.equal(chk3a.overallPending, true);
    assert.equal(chk3a.overallVariancePct, null);
    assert.ok(Array.isArray(chk3a.comparabilityIssues) && chk3a.comparabilityIssues.length > 0, 'must report concrete comparabilityIssues');
    assert.ok(
      chk3a.comparabilityIssues.some((i: { field: string; kind: string }) => i.field === 'metric' && i.kind === 'mismatch'),
      'must pinpoint metric mismatch',
    );
    assert.ok(
      !chk3a.assessmentNote.includes('判定 comparable'),
      `reconciled assessmentNote must not contradict incomparable status: ${chk3a.assessmentNote}`,
    );
    assert.equal(chk3a.requestedComparability, 'comparable');
    assert.ok(chk3a.agentAssessmentNote?.includes('判定 comparable'));

    // --- 3b: Partial manual basis (natural wording + unknown coverage/maturity) + Agent evidence-backed mapping/supplement -> comparable! ---
    const report3b = '数据截至 2027-01-14。零售事业部全渠道与门店2027年1月第2周已结账净销售额 27 万元，全范围门店已完整出数并已结账。';
    const { actual: act3b } = await json(
      await host.request(`${route}/decomposition/actuals`, 'POST', {
        operationId: randomUUID(),
        publicationVersion: 1,
        rowId: 'G-TOTAL',
        checkpointId: period.checkpointId ?? period.periodId,
        actualSource: {
          ref: 'pos-3b.txt',
          label: '第2周实绩-3b',
          cutoffAt: '2027-01-14',
          reportText: report3b,
          basis: {
            metric: '已结账净销售额',
            unit: '',
            scope: '',
            periodId: '',
            coverage: 'unknown',
            maturity: 'unknown',
          },
        },
        actualPeriods: [{ periodId: period.periodId, actualValue: 27 }],
      }),
      201,
    );
    const chk3b = await runAgentAssess(act3b.actualId, {
      comparability: 'comparable',
      assessmentNote: '依据原文完成口径映射并补齐未知覆盖与成熟度，与冻结计划可比。',
      observation: {
        quote: '已结账净销售额 27 万元，全范围门店已完整出数并已结账',
        actualValue: 27,
        basis: {
          metric: '2027年1月全渠道净销售额',
          unit: '万元',
          scope: '零售事业部 · 全渠道与门店',
          periodId: period.periodId,
          coverage: 'complete',
          maturity: 'closed',
        },
        basisMappings: [
          {
            field: 'metric',
            sourceValue: '已结账净销售额',
            mappedValue: '2027年1月全渠道净销售额',
            evidenceQuote: '零售事业部全渠道与门店2027年1月第2周已结账净销售额 27 万元',
            rationale: '报表为全渠道与门店已结账净销售额，对应计划指标 2027年1月全渠道净销售额',
          },
        ],
      },
    });
    assert.equal(chk3b.comparability, 'comparable', `expected comparable, got ${chk3b.comparability}: ${JSON.stringify(chk3b.comparabilityIssues)}`);
    assert.equal(chk3b.overallPending, false);
    assert.equal(chk3b.overallAbsoluteDiff, -3);
    assert.equal(chk3b.overallVariancePct, -10);
    assert.ok(Array.isArray(chk3b.basisResolution) && chk3b.basisResolution.length >= 2, 'must preserve mapping and supplement basisResolution');
    assert.equal(chk3b.submittedBasis?.metric, '已结账净销售额', 'must preserve original submitted basis');

    // --- 3c: Explicit human exclusion (coverage: partial) MUST NOT be overridden by Agent optimistic complete ---
    const { actual: act3c } = await json(
      await host.request(`${route}/decomposition/actuals`, 'POST', {
        operationId: randomUUID(),
        publicationVersion: 1,
        rowId: 'G-TOTAL',
        checkpointId: period.checkpointId ?? period.periodId,
        actualSource: {
          ref: 'pos-3c.txt',
          label: '第2周实绩-3c',
          cutoffAt: '2027-01-14',
          reportText: report3b,
          basis: {
            metric: '2027年1月全渠道净销售额',
            unit: '万元',
            scope: '零售事业部 · 全渠道与门店',
            periodId: period.periodId,
            coverage: 'partial',
            maturity: 'closed',
          },
        },
        missingCoverageNote: '手工排除：华南2家门店未入账',
        actualPeriods: [{ periodId: period.periodId, actualValue: 27 }],
      }),
      201,
    );
    const chk3c = await runAgentAssess(act3c.actualId, {
      comparability: 'comparable',
      assessmentNote: '原文显示全范围已出数，判定 comparable。',
      observation: {
        quote: '已结账净销售额 27 万元，全范围门店已完整出数并已结账',
        actualValue: 27,
        basis: {
          metric: '2027年1月全渠道净销售额',
          unit: '万元',
          scope: '零售事业部 · 全渠道与门店',
          periodId: period.periodId,
          coverage: 'complete',
          maturity: 'closed',
        },
      },
    });
    assert.equal(chk3c.comparability, 'partial-missing', 'human partial exclusion must not be overridden by Agent complete');
    assert.equal(chk3c.actualSource.basis.coverage, 'partial');
    assert.equal(chk3c.overallPending, true);
    assert.ok(chk3c.comparabilityIssues.some((i: { field: string }) => i.field === 'coverage'));

    // --- 3d: Explicit human exclusion in scope wording ("不包含华南门店" / "仅华东门店") MUST NOT be overridden even with basisMappings ---
    const { actual: act3d } = await json(
      await host.request(`${route}/decomposition/actuals`, 'POST', {
        operationId: randomUUID(),
        publicationVersion: 1,
        rowId: 'G-TOTAL',
        checkpointId: period.checkpointId ?? period.periodId,
        actualSource: {
          ref: 'pos-3d.txt',
          label: '第2周实绩-3d',
          cutoffAt: '2027-01-14',
          reportText: report3b,
          basis: {
            metric: '2027年1月全渠道净销售额',
            unit: '万元',
            scope: '不包含华南门店',
            periodId: period.periodId,
            coverage: 'complete',
            maturity: 'open',
          },
        },
        actualPeriods: [{ periodId: period.periodId, actualValue: 27 }],
      }),
      201,
    );
    const chk3d = await runAgentAssess(act3d.actualId, {
      comparability: 'comparable',
      assessmentNote: '尝试乐观映射范围并标记已结账。',
      observation: {
        quote: '已结账净销售额 27 万元，全范围门店已完整出数并已结账',
        actualValue: 27,
        basis: {
          metric: '2027年1月全渠道净销售额',
          unit: '万元',
          scope: '零售事业部 · 全渠道与门店',
          periodId: period.periodId,
          coverage: 'complete',
          maturity: 'closed',
        },
        basisMappings: [
          {
            field: 'scope',
            sourceValue: '不包含华南门店',
            mappedValue: '零售事业部 · 全渠道与门店',
            evidenceQuote: '零售事业部全渠道与门店2027年1月第2周已结账净销售额 27 万元',
            rationale: '试图覆盖手工排除范围',
          },
        ],
      },
    });
    assert.equal(chk3d.comparability, 'incomparable', 'human exclusion wording in scope must not be mapped away');
    assert.equal(chk3d.actualSource.basis.scope, '不包含华南门店');
    assert.equal(chk3d.actualSource.basis.maturity, 'open', 'human open maturity must not be overridden');
    assert.ok(chk3d.comparabilityIssues.some((i: { field: string }) => i.field === 'scope'));
    assert.ok(chk3d.comparabilityIssues.some((i: { field: string }) => i.field === 'maturity'));
  } finally {
    await provider.close();
    await host.close();
  }
});

test('A4: 阈值按指标与周期粒度隔离，未配置当前粒度时明确提示已有其他粒度规则不适用', async () => {
  const host = await startTestHost();
  try {
    const { gsaPlan, route } = await createAdoptedGoalWithGsa(host, {
      title: 'A4-阈值粒度提示',
      targetValue: 120,
    });
    const draftPayload = makeNormalDraftPayload(gsaPlan);
    // Add a day period alongside week periods
    draftPayload.timePlan.push({
      periodId: '2027-01-03',
      granularity: 'day',
      label: '2027-01-03 日检查',
      startDate: '2027-01-03',
      endDate: '2027-01-03',
      targetValue: 10,
      unit: '万元',
      status: 'planned',
      checkpointId: '2027-01-03',
    });
    const { draft } = await json(await host.request(`${route}/decomposition/draft`, 'POST', draftPayload), 201);
    const preview = await json(
      await host.request(`${route}/decomposition/publish-preview`, 'POST', {
        gsaPlanId: gsaPlan.planId,
        gsaPlanVersion: gsaPlan.planVersion,
        gsaPlanSha256: gsaPlan.contentSha256,
        draftRevision: draft.revision,
        draftSha256: draft.contentSha256,
        expectedActiveVersion: null,
      }),
    );
    await json(
      await host.request(`${route}/decomposition/publish`, 'POST', {
        operationId: randomUUID(),
        gsaPlanId: gsaPlan.planId,
        gsaPlanVersion: gsaPlan.planVersion,
        gsaPlanSha256: gsaPlan.contentSha256,
        draftRevision: draft.revision,
        draftSha256: draft.contentSha256,
        previewSha256: preview.previewSha256,
        expectedActiveVersion: null,
        reason: '发布 v1',
      }),
      201,
    );

    // Configure ONLY week threshold
    await json(
      await host.request(`${route}/decomposition/threshold`, 'POST', {
        expectedGoalVersion: 1,
        configured: true,
        magnitudePct: 10,
        consecutivePeriods: 2,
        adverseDirection: 'below',
        unit: 'percent',
        metricId: '净销售额',
        periodGranularity: 'week',
      }),
    );

    // Record a DAY check (-20%)
    const { check: dayCheck1 } = await json(
      await host.request(`${route}/decomposition/checks`, 'POST', {
        operationId: randomUUID(),
        publicationVersion: 1,
        rowId: 'G-TOTAL',
        checkpointId: '2027-01-03',
        comparability: 'comparable',
        actualSource: {
          ref: 'day-1.csv',
          label: '日结单',
          cutoffAt: '2027-01-03T23:59:59Z',
          basis: {
            metric: '净销售额',
            unit: '万元',
            scope: '零售事业部 · 全渠道与门店',
            periodId: '2027-01-03',
            coverage: 'complete',
            maturity: 'closed',
          },
        },
        actualPeriods: [{ periodId: '2027-01-03', actualValue: 8 }],
      }),
      201,
    );
    assert.equal(dayCheck1.trigger.type, 'unconfigured');
    assert.equal(dayCheck1.thresholdSnapshot.configured, false);
    assert.ok(
      dayCheck1.trigger.reason.includes('日') && dayCheck1.trigger.reason.includes('周'),
      `expected reason to explain day is unconfigured and week rule does not apply, got: ${dayCheck1.trigger.reason}`,
    );

    // Now configure DAY threshold; both streams coexist and historical dayCheck1 stays immutable
    await json(
      await host.request(`${route}/decomposition/threshold`, 'POST', {
        expectedGoalVersion: 1,
        configured: true,
        magnitudePct: 10,
        adverseDirection: 'below',
        unit: 'percent',
        metricId: '净销售额',
        periodGranularity: 'day',
      }),
    );
    const { check: dayCheck2 } = await json(
      await host.request(`${route}/decomposition/checks`, 'POST', {
        operationId: randomUUID(),
        publicationVersion: 1,
        rowId: 'G-TOTAL',
        checkpointId: '2027-01-03',
        comparability: 'comparable',
        actualSource: {
          ref: 'day-2.csv',
          label: '日结单复核',
          cutoffAt: '2027-01-03T23:59:59Z',
          basis: {
            metric: '净销售额',
            unit: '万元',
            scope: '零售事业部 · 全渠道与门店',
            periodId: '2027-01-03',
            coverage: 'complete',
            maturity: 'closed',
          },
        },
        actualPeriods: [{ periodId: '2027-01-03', actualValue: 8 }],
      }),
      201,
    );
    assert.equal(dayCheck2.trigger.type, 'magnitude');
    assert.equal(dayCheck2.trigger.triggered, true);
    const ws = await json(await host.request(`${route}/workspace`));
    assert.equal(ws.thresholdStreams.length, 2);
    assert.equal(ws.checks[0].thresholdSnapshot.configured, false, 'historical check snapshot must remain immutable');
  } finally {
    await host.close();
  }
});

test('A5: 只读发布预览返回每笔预留用途/负责人与每条补缺策略明细，且绑定当前准确草稿指纹', async () => {
  const host = await startTestHost();
  try {
    const { gsaPlan, route } = await createAdoptedGoalWithGsa(host, {
      title: 'A5-发布预览明细',
      targetValue: 120,
    });
    const draftPayload = makeNormalDraftPayload(gsaPlan);
    // makeNormalDraftPayload already has 120/112/8, allocated 115 (50+30+20+15) + reserve 5, gap strategies 5+3
    draftPayload.reserves = [
      {
        id: 'RES-1',
        amount: 5,
        unit: '万元',
        purpose: '华东新品陈列机动预留',
        owner: '陈总',
        basis: '应对首周重点门店补货波动',
      },
    ];
    draftPayload.gapStrategies = [
      {
        id: 'GAP-1',
        name: '高潜老客定向激活',
        strategy: '针对90天未复购会员定向券包',
        expectedContribution: 5,
        unit: '万元',
        nonOverlappingScope: '仅未在常规周促销覆盖的沉睡会员',
        scopeKey: 'dormant-members',
        basis: '历史沉睡召回转化率 4.2%',
        kind: 'expected-increment',
      },
      {
        id: 'GAP-2',
        name: '企业福利团购增量',
        strategy: '春节前企采专场礼盒',
        expectedContribution: 3,
        unit: '万元',
        nonOverlappingScope: 'B2B 企采客户，不与零售门店客流重叠',
        scopeKey: 'b2b-gifting',
        basis: '已签约意向客户 6 家',
        kind: 'expected-increment',
      },
    ];

    const { draft } = await json(await host.request(`${route}/decomposition/draft`, 'POST', draftPayload), 201);
    const preview = await json(
      await host.request(`${route}/decomposition/publish-preview`, 'POST', {
        gsaPlanId: gsaPlan.planId,
        gsaPlanVersion: gsaPlan.planVersion,
        gsaPlanSha256: gsaPlan.contentSha256,
        draftRevision: draft.revision,
        draftSha256: draft.contentSha256,
        expectedActiveVersion: null,
      }),
    );

    assert.equal(preview.ok, true, JSON.stringify(preview.issues));
    assert.equal(preview.summary.formalTargetValue, 120);
    assert.equal(preview.summary.estimatedValue, 112);
    assert.equal(preview.summary.gapValue, 8);
    assert.equal(preview.summary.allocatedTotal, 115);
    assert.equal(preview.summary.reserveTotal, 5);
    assert.equal(preview.summary.gapCoverageTotal, 8);

    assert.ok(Array.isArray(preview.reserves), 'preview must include reserves array');
    assert.equal(preview.reserves.length, 1);
    assert.equal(preview.reserves[0].purpose, '华东新品陈列机动预留');
    assert.equal(preview.reserves[0].owner, '陈总');
    assert.equal(preview.reserves[0].amount, 5);

    assert.ok(Array.isArray(preview.gapStrategies), 'preview must include gapStrategies array');
    assert.equal(preview.gapStrategies.length, 2);
    assert.equal(preview.gapStrategies[0].name, '高潜老客定向激活');
    assert.equal(preview.gapStrategies[0].expectedContribution, 5);
    assert.equal(preview.gapStrategies[0].nonOverlappingScope, '仅未在常规周促销覆盖的沉睡会员');
    assert.equal(preview.gapStrategies[1].name, '企业福利团购增量');
    assert.equal(preview.gapStrategies[1].expectedContribution, 3);

    // Zero publish side effects
    const ws = await json(await host.request(`${route}/workspace`));
    assert.equal(ws.publications.length, 0);

    // If draft changes, stale preview request fails closed
    const editedPayload = { ...draftPayload, expectedDraftRevision: draft.revision, notes: '预览后修改' };
    await json(await host.request(`${route}/decomposition/draft`, 'POST', editedPayload), 201);
    await json(
      await host.request(`${route}/decomposition/publish-preview`, 'POST', {
        gsaPlanId: gsaPlan.planId,
        gsaPlanVersion: gsaPlan.planVersion,
        gsaPlanSha256: gsaPlan.contentSha256,
        draftRevision: draft.revision,
        draftSha256: draft.contentSha256,
        expectedActiveVersion: null,
      }),
      409,
    );
  } finally {
    await host.close();
  }
});
