import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { startTestHost } from "./fixtures/host-process.ts";
import { makeNormalDraftPayload } from "./fixtures/goal-decomposition-draft.ts";
import {
  startToolProvider,
  providerMessageText,
} from "./fixtures/tool-provider.ts";

async function json(response: Response, status = 200): Promise<any> {
  const value = await response.json();
  assert.equal(response.status, status, JSON.stringify(value));
  return value;
}

async function seed(
  host: Awaited<ReturnType<typeof startTestHost>>,
  strategy = "新品陈列与会员回访",
  targetValue = 120,
) {
  const { goal } = await json(
    await host.request("/api/strategy/goals", "POST", {
      operationId: randomUUID(),
      title: "零售当期目标",
      outcome: "净销售额达到 120 万元",
      perspective: "profit",
      scope: { kind: "department", id: "retail-dept", name: "零售事业部" },
      measurement: { kind: "deliverable", criterion: "净销售额" },
      baseline: { state: "known", description: "108 万" },
      responsible: "林负责人",
      strategies: [strategy],
      dueAt: "2027-01-31",
      formalOrigin: {
        kind: "manual-exception",
        reason: "暂无适用战略发布",
        period: "2027-01",
        targetValue,
        unit: "万元",
        metricKind: "amount",
      },
    }),
    201,
  );
  const route = "/api/strategy/goals/" + goal.goalId;
  const confirmation = {
    operationId: randomUUID(),
    expectedGoalVersion: 1,
    expectedAdoptedVersion: null,
    expectedPlanVersion: 0,
    plannedActions: [
      {
        id: "A1",
        summary: "完成新品陈列",
        checkpoint: "2027-01-31",
        observationBasis: "POS 日报",
      },
    ],
    decision: "确认",
  };
  const { gsaPlan } = await json(
    await host.request(route + "/gsa-plan/confirm", "POST", confirmation),
    201,
  );
  return { goal, route, gsaPlan, confirmation };
}

test("F3 unchanged GSA cannot create a new formal plan, changed A requires a reason", async (t) => {
  const host = await startTestHost();
  t.after(() => host.close());
  const { route, confirmation } = await seed(host);
  const revision = {
    ...confirmation,
    operationId: randomUUID(),
    expectedAdoptedVersion: 1,
    expectedPlanVersion: 1,
  };
  assert.equal(
    (
      await json(
        await host.request(route + "/gsa-plan/confirm", "POST", revision),
        409,
      )
    ).code,
    "gsa_plan_unchanged",
  );
  revision.plannedActions = [
    { ...revision.plannedActions[0], summary: "补充新品供货复核" },
  ];
  assert.equal(
    (
      await json(
        await host.request(route + "/gsa-plan/confirm", "POST", {
          ...revision,
          decision: "",
        }),
        400,
      )
    ).code,
    "strategy_goal_decision_required",
  );
  const { gsaPlan } = await json(
    await host.request(route + "/gsa-plan/confirm", "POST", {
      ...revision,
      supersedesReason: "补充到货风险检查",
    }),
    201,
  );
  assert.equal(gsaPlan.planVersion, 2);
  assert.equal(gsaPlan.supersedesReason, "补充到货风险检查");
});

test(
  "F4/F5/F7 real Host and Pi return a request-bound plan for different G/S without adopting",
  { timeout: 60_000 },
  async (t) => {
    const provider = await startToolProvider();
    t.after(() => provider.close());
    const host = await startTestHost();
    t.after(() => host.close());
    await json(
      await host.request("/api/configuration", "PUT", {
        name: "合成计划",
        provider: "openai-compatible",
        baseUrl: provider.baseUrl,
        model: "synthetic-plan",
        apiKey: "synthetic-key",
      }),
    );
    const first = await seed(host);
    const second = await seed(host, "维护老客，控制库存周转", 150);
    const prompts: any[] = [];
    provider.setResponder((ctx) => {
      if (ctx.recentToolResults.length)
        return { text: "建议已填入草稿，等待负责人核对。" };
      const text = providerMessageText(
        ctx.messages.filter((m) => m.role === "user").at(-1)?.content,
      );
      const context = JSON.parse(text.split("\n\n用户本轮原话：")[0]);
      prompts.push(context);
      return {
        calls: [
          {
            name: "strategy_goals",
            arguments: {
              action: "goal-propose-plan",
              summary:
                context.planRequest.row.summary ||
                context.roleContext.goal.strategies[0],
              checkpoint: "周五前完成 3 家门店的新品陈列，不追加预算",
              observationBasis: "仅用 POS 日报，不用照片",
            },
          },
        ],
      };
    });
    for (const [index, item] of [first, second].entries()) {
      const row = {
        id: "row-" + index,
        summary: index
          ? "华东 3 家门店，周五前完成新品陈列，不追加预算；仅用 POS 日报，不用照片"
          : "",
        checkpoint: "",
        observationBasis: "",
      };
      const owner = {
        role: "goal",
        goalId: item.goal.goalId,
        version: 1,
        analysisVariant: "goal-plan",
      };
      const route =
        "/api/business-role?owner=" + encodeURIComponent(JSON.stringify(owner));
      const requestId = randomUUID();
      await json(
        await host.request(route + "&action=messages", "POST", {
          requestId,
          text: "请补充计划",
          expectedRevision: 0,
          planRequest: { mode: index ? "optimize" : "recommend", row },
        }),
        202,
      );
      let detail: any;
      for (let tries = 0; tries < 150; tries++) {
        detail = await json(await host.request(route));
        if (detail.discussion?.lastRun?.status === "completed") break;
        await new Promise((resolve) => setTimeout(resolve, 40));
      }
      assert.equal(detail.discussion.lastRun.status, "completed");
      assert.equal(detail.snapshot.sdkVersion, "1.4.0");
      const suggestion = detail.planSuggestions.find(
        (s: any) => s.requestId === requestId,
      );
      assert.equal(suggestion.rowId, row.id);
      assert.match(suggestion.plan.observationBasis, /不用照片/);
      assert.equal(
        (await json(await host.request(item.route + "/workspace"))).gsaPlans
          .length,
        1,
      );
      assert.equal(prompts.at(-1).roleContext.goal.goalId, item.goal.goalId);
      assert.equal(prompts.at(-1).planRequest.row.summary, row.summary);
    }
    assert.notDeepEqual(
      prompts[0].roleContext.goal.strategies,
      prompts[1].roleContext.goal.strategies,
    );
    assert.notEqual(
      prompts[0].roleContext.goal.formalOrigin.targetValue,
      prompts[1].roleContext.goal.formalOrigin.targetValue,
    );
    assert.deepEqual(provider.errors, []);
  },
);

test("F11 a report may be submitted before cutoff extraction, unresolved cutoff stays pending", async (t) => {
  const provider = await startToolProvider();
  t.after(() => provider.close());
  const host = await startTestHost();
  t.after(() => host.close());
  await json(
    await host.request("/api/configuration", "PUT", {
      name: "合成实绩",
      provider: "openai-compatible",
      baseUrl: provider.baseUrl,
      model: "synthetic-actual",
      apiKey: "synthetic-key",
    }),
  );
  const { route, gsaPlan } = await seed(host);
  const { draft } = await json(
    await host.request(
      route + "/decomposition/draft",
      "POST",
      makeNormalDraftPayload(gsaPlan),
    ),
    201,
  );
  const preview = await json(
    await host.request(route + "/decomposition/publish-preview", "POST", {
      gsaPlanId: gsaPlan.planId,
      gsaPlanVersion: 1,
      gsaPlanSha256: gsaPlan.contentSha256,
      draftRevision: draft.revision,
      draftSha256: draft.contentSha256,
      expectedActiveVersion: null,
    }),
  );
  const { publication } = await json(
    await host.request(route + "/decomposition/publish", "POST", {
      operationId: randomUUID(),
      gsaPlanId: gsaPlan.planId,
      gsaPlanVersion: 1,
      gsaPlanSha256: gsaPlan.contentSha256,
      draftRevision: draft.revision,
      draftSha256: draft.contentSha256,
      previewSha256: preview.previewSha256,
      expectedActiveVersion: null,
    }),
    201,
  );
  const period = publication.snapshot.timePlan[0];
  const { actual } = await json(
    await host.request(route + "/decomposition/actuals", "POST", {
      operationId: randomUUID(),
      publicationVersion: 1,
      rowId: "G-TOTAL",
      checkpointId: period.checkpointId ?? period.periodId,
      actualSource: {
        ref: "report-1",
        label: "POS 报表",
        cutoffAt: "",
        reportText: "数据截至 2027-01-07。净销售额 25 万元。",
      },
      actualPeriods: [{ periodId: period.periodId, actualValue: null }],
    }),
    201,
  );
  assert.equal(actual.input.actualSource.cutoffAt, "");
  const workspace = await json(await host.request(route + "/workspace"));
  assert.equal(workspace.checks.length, 0);
  assert.equal(workspace.submittedActuals[0].actualId, actual.actualId);
  provider.setResponder((ctx) =>
    ctx.recentToolResults.length
      ? { text: "已核对实际数据及截至原句。" }
      : {
          calls: [
            {
              name: "strategy_goals",
              arguments: {
                action: "goal-assess-actual",
                comparability: "comparable",
                assessmentNote: "原报表数据截至第 1 周末，口径与冻结计划一致。",
                observation: {
                  quote: "净销售额 25 万元。",
                  actualValue: 25,
                  cutoffState: "identified",
                  cutoffAt: "2027-01-07",
                  cutoffQuote: "数据截至 2027-01-07。",
                  basis: {
                    metric: "净销售额",
                    unit: "万元",
                    scope: "零售事业部 · 全渠道与门店",
                    periodId: period.periodId,
                    coverage: "complete",
                    maturity: "closed",
                  },
                },
              },
            },
          ],
        },
  );
  const role =
    "/api/business-role?owner=" +
    encodeURIComponent(
      JSON.stringify({
        role: "goal",
        goalId: actual.input ? workspace.goal.id : "",
        version: 1,
        actualId: actual.actualId,
        analysisVariant: "goal-decomposition",
      }),
    );
  await json(
    await host.request(role + "&action=messages", "POST", {
      requestId: randomUUID(),
      text: "核对这份凭证",
      expectedRevision: 0,
    }),
    202,
  );
  let checked: any;
  for (let tries = 0; tries < 150; tries++) {
    checked = await json(await host.request(route + "/workspace"));
    if (checked.checks.length) break;
    await new Promise((resolve) => setTimeout(resolve, 40));
  }
  assert.equal(checked.checks[0]?.actualSource.cutoffAt, "2027-01-07");
  assert.equal(
    checked.checks[0].actualSource.cutoffQuote,
    "数据截至 2027-01-07。",
  );
  assert.equal(checked.checks[0].overallPending, false);
  assert.equal(checked.checks[0].publicationVersion, 1);
  assert.equal(
    checked.submittedActuals[0].input.actualSource.cutoffAt,
    "",
    "original submission stays unchanged",
  );
});

test("F12 review edits, discards and selections survive reopen and stale saves are rejected", async (t) => {
  const host = await startTestHost();
  t.after(() => host.close());
  const { route } = await seed(host);
  const url = route + "/review-draft?period=2027-01";
  const initial = await json(await host.request(url));
  assert.equal(initial.draft.revision, 0);
  const input = {
    ...initial.draft,
    expectedRevision: 0,
    evidenceKeys: ["check-1"],
    conclusions: [
      {
        id: "c1",
        sourceRef: "check-1",
        title: "新品需复核",
        summary: "保留人工修改",
        originalScope: "零售事业部",
        applicableScope: "零售事业部",
        evidenceMature: true,
        causalVerified: false,
        targetScopeSameAsOriginal: true,
        discarded: true,
        selected: false,
      },
    ],
  };
  const saved = await json(
    await host.request(route + "/review-draft", "POST", input),
  );
  assert.equal(saved.draft.revision, 1);
  assert.deepEqual(
    (await json(await host.request(url))).draft.conclusions,
    saved.draft.conclusions,
  );
  await json(await host.request(route + "/review-draft", "POST", input), 409);
  const expanded = {
    ...saved.draft,
    expectedRevision: 1,
    conclusions: saved.draft.conclusions.map((c: any) => ({
      ...c,
      discarded: false,
      selected: true,
      applicableScope: "全国门店",
    })),
  };
  const newer = await json(
    await host.request(route + "/review-draft", "POST", expanded),
  );
  assert.equal(newer.draft.conclusions[0].targetScopeSameAsOriginal, false);
  assert.equal(newer.draft.conclusions[0].originalScope, "零售事业部");
  assert.equal(
    newer.draft.conclusions[0].classification,
    "hypothesis-unverified",
  );
});

test("F3 a new GSA cannot silently replace a decomposition based on the old plan", async (t) => {
  const host = await startTestHost();
  t.after(() => host.close());
  const { route, gsaPlan, confirmation } = await seed(host);
  await json(
    await host.request(
      route + "/decomposition/draft",
      "POST",
      makeNormalDraftPayload(gsaPlan),
    ),
    201,
  );
  const { gsaPlan: next } = await json(
    await host.request(route + "/gsa-plan/confirm", "POST", {
      ...confirmation,
      operationId: randomUUID(),
      expectedPlanVersion: 1,
      expectedAdoptedVersion: 1,
      plannedActions: [
        { ...confirmation.plannedActions[0], summary: "调整到货检查" },
      ],
      supersedesReason: "到货延误",
    }),
    201,
  );
  const replacement = makeNormalDraftPayload(next, {
    expectedDraftRevision: 1,
  });
  assert.equal(
    (
      await json(
        await host.request(route + "/decomposition/draft", "POST", replacement),
        409,
      )
    ).code,
    "gsa_upstream_review_required",
  );
  const adopted = await json(
    await host.request(route + "/decomposition/draft", "POST", {
      ...replacement,
      reviewedPreviousPlanVersion: 1,
    }),
    201,
  );
  assert.equal(adopted.draft.gsaPlanVersion, 2);
});
