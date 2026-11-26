// Run after npm run build with Node 25 and Playwright available.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";
import { createHost } from "../src/host/server.ts";
import { makeNormalDraftPayload } from "./fixtures/goal-decomposition-draft.ts";
import {
  startToolProvider,
  providerMessageText,
} from "./fixtures/tool-provider.ts";

const evidence = path.resolve(".local/ui-rework/four-stage-browser");
await mkdir(evidence, { recursive: true });
const root = path.join(evidence, randomUUID());
const host = createHost({
  cwd: process.cwd(),
  staticUiRoot: path.resolve("dist"),
  uiPorts: [4173],
  transportVersion: "issue138-test",
  dataRoot: path.join(root, "data"),
  projectsRoot: path.join(root, "projects"),
});
await host.ready;
await new Promise((resolve) => host.server.listen(0, "127.0.0.1", resolve));
const base = "http://127.0.0.1:" + host.server.address().port;
async function api(route, method = "GET", body) {
  const res = await fetch(base + route, {
    method,
    headers: {
      origin: base,
      "content-type": "application/json",
      "x-optracall-client": "1",
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const value = await res.json();
  assert.ok(res.ok, JSON.stringify(value));
  return value;
}
async function waitFor(read, predicate, label) {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    const value = await read();
    if (predicate(value)) return value;
    await new Promise((resolve) => setTimeout(resolve, 80));
  }
  assert.fail(label);
}
async function seed(title, confirmed = true) {
  const { goal } = await api("/api/strategy/goals", "POST", {
    operationId: randomUUID(),
    title,
    outcome: "净销售额达到 120 万元",
    perspective: "profit",
    scope: { kind: "department", id: "retail-dept", name: "零售事业部" },
    measurement: { kind: "deliverable", criterion: "净销售额" },
    baseline: { state: "known", description: "108 万" },
    responsible: "林负责人",
    strategies: ["新品陈列与会员回访"],
    dueAt: "2027-01-31",
    formalOrigin: {
      kind: "manual-exception",
      reason: "暂无适用战略发布",
      period: "2027-01",
      targetValue: 120,
      unit: "万元",
      metricKind: "amount",
    },
  });
  const route = "/api/strategy/goals/" + goal.goalId;
  if (confirmed) {
    const { gsaPlan } = await api(route + "/gsa-plan/confirm", "POST", {
      operationId: randomUUID(),
      expectedGoalVersion: 1,
      expectedAdoptedVersion: null,
      expectedPlanVersion: 0,
      plannedActions: [
        {
          id: "A1",
          summary: "新品陈列",
          checkpoint: "2027-01-31",
          observationBasis: "POS 日报",
        },
      ],
      decision: "确认",
    });
    await api(
      route + "/decomposition/draft",
      "POST",
      makeNormalDraftPayload(gsaPlan),
    );
  }
  return { goal, route };
}
const provider = await startToolProvider();
await api("/api/configuration", "PUT", {
  name: "浏览器合成模型",
  provider: "openai-compatible",
  baseUrl: provider.baseUrl,
  model: "synthetic-trial",
  apiKey: "synthetic-key",
});
let planDelay = 0;
const capturedPrompts = [];
provider.setResponder(async (ctx) => {
  const text = providerMessageText(
    ctx.messages.filter((m) => m.role === "user").at(-1)?.content,
  );
  let context;
  try {
    context = JSON.parse(text.split("\n\n用户本轮原话：")[0]);
  } catch {
    return { text: "合成连接可用" };
  }
  if (!ctx.recentToolResults.length) capturedPrompts.push({ context, text });
  const action = context.owner?.analysisVariant;
  if (ctx.recentToolResults.length)
    return { text: "本次草稿已准备，请负责人核对。" };
  if (action === "goal-plan") {
    if (planDelay)
      await new Promise((resolve) => setTimeout(resolve, planDelay));
    const raw = context.planRequest.row;
    return {
      calls: [
        {
          name: "strategy_goals",
          arguments: {
            action: "goal-propose-plan",
            summary: raw.summary || "基于新品陈列与会员回访推进当期净销售额",
            checkpoint: raw.summary
              ? "周五前完成华东 3 家门店新品陈列，不追加预算"
              : "月底核对门店计划完成情况",
            observationBasis: "仅用 POS 日报，不用照片",
          },
        },
      ],
    };
  }
  if (action === "goal-decomposition" && context.owner.actualId) {
    const actual = context.roleContext.actual.input;
    return {
      calls: [
        {
          name: "strategy_goals",
          arguments: {
            action: "goal-assess-actual",
            comparability: "comparable",
            assessmentNote: "按原报表核对第 1 周可比净销售额。",
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
                periodId: actual.actualPeriods[0].periodId,
                coverage: "complete",
                maturity: "closed",
              },
            },
          },
        },
      ],
    };
  }
  if (action === "goal-decomposition") {
    const { activeGsaPlan: plan } = context.roleContext.decompositionContext;
    const existing =
      context.roleContext.decompositionContext.activeDecompositionDraft;
    const draft = makeNormalDraftPayload(plan, {
      expectedDraftRevision: existing?.revision ?? 0,
    });
    const marker = "\n人工改动\n";
    if (text.includes(marker)) {
      const edits = JSON.parse(
        text.slice(text.indexOf(marker) + marker.length),
      );
      for (const key of [
        "estimate",
        "rows",
        "reserves",
        "gapStrategies",
        "views",
        "timePlan",
        "notes",
      ])
        if (existing[key] !== undefined)
          draft[key] = structuredClone(existing[key]);
      for (const change of edits.changes) {
        const keys = change.path
          .split("/")
          .slice(1)
          .map((key) => key.replace(/~1/g, "/").replace(/~0/g, "~"));
        let target = draft;
        for (const key of keys.slice(0, -1)) target = target[key];
        if (change.after === undefined) delete target[keys.at(-1)];
        else target[keys.at(-1)] = change.after;
      }
    }
    const { operationId, ...payload } = draft;
    return {
      calls: [
        {
          name: "strategy_goals",
          arguments: { action: "goal-save-decomposition-draft", ...payload },
        },
      ],
    };
  }
  if (action === "goal-review") {
    const checks = context.roleContext.reviewContext.checks;
    return {
      calls: [
        {
          name: "strategy_goals",
          arguments: {
            action: "goal-propose-review",
            conclusions: checks.map((check) => ({
              sourceRef: check.checkId,
              title: "阶段检查 " + check.checkId,
              summary: "根据已保存的阶段检查整理，策略因果仍需验证。",
              originalScope: check.actualSource.basis.scope,
              applicableScope: check.actualSource.basis.scope,
              evidenceMature: true,
              causalVerified: false,
              targetScopeSameAsOriginal: true,
            })),
          },
        },
      ],
    };
  }
  if (context.owner?.role === "goal-draft" && context.roleContext.nextCycle) {
    return {
      calls: [
        {
          name: "strategy_goals",
          arguments: {
            action: "propose-goal",
            draft: {
              title: "下一期零售目标草案",
              outcome: "核对下一期零售目标",
              perspective: "profit",
              scope: context.owner.scope,
              measurement: { kind: "deliverable", criterion: "核对净销售额" },
              baseline: { state: "pending", description: "待核对下一期基线" },
              responsible: "林负责人",
              strategies: ["按选定复盘结论优化新品计划"],
            },
          },
        },
      ],
    };
  }
  return { text: "合成回复" };
});
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.OPTRACALL_CHROMIUM ?? "/usr/bin/chromium",
});
const errors = [],
  results = [];
let page;
try {
  const normal = await seed("北区自动保存");
  const candidate = await seed("南区候选目标", false);
  page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  page.on("pageerror", (e) => errors.push(e.message));
  const button = (name) => page.getByRole("button", { name, exact: true });
  const shot=async name=>{
    await page.evaluate(()=>{window.scrollTo(0,0);document.querySelectorAll('*').forEach(el=>{if(el.scrollTop)el.scrollTop=0;});});
    await page.screenshot({path:path.join(evidence,name+'.png'),fullPage:true});
  };
  const openEstimate=async()=>{if(!await page.getByRole('spinbutton',{name:'同口径可达测算值'}).isVisible())await button('核对测算依据').click();};
  const closeDialog=async()=>{await page.keyboard.press('Escape');};
  const editConclusion=async(text)=>{await button('修改结论').first().click();await page.getByRole('textbox',{name:'结论摘要',exact:true}).fill(text);await button('保存这项修改').click();};
  const conclusions=()=>page.locator('.gj-conclusion[aria-label^="复盘结论"]');

  await page.goto(base);
  await page
    .getByRole("navigation", { name: "主导航", exact: true })
    .getByRole("button", { name: "目标管理", exact: true })
    .click();
  await button("切换目标").click();
  await page
    .getByRole("dialog", { name: "切换目标" })
    .getByRole("listitem")
    .filter({ hasText: normal.goal.title })
    .click();
  await page
    .getByRole("heading", { name: normal.goal.title, exact: true })
    .waitFor();
  const before = await api(normal.route + "/workspace");
  assert.equal(await page.locator('.gm-right-table input:visible,.gm-right-table select:visible').count(),0);
  await openEstimate();
  await page.getByRole("spinbutton", { name: "同口径可达测算值" }).fill("111");
  const saved = await waitFor(
    () => api(normal.route + "/workspace"),
    (ws) => ws.draft.revision > before.draft.revision,
    "F10 editing should automatically save the draft",
  );
  assert.equal(saved.draft.estimate.estimatedValue, 111);
  results.push("F10 human edit automatically saved");
  await page.reload();
  await page
    .getByRole("heading", { name: normal.goal.title, exact: true })
    .waitFor();
  await openEstimate();
  assert.equal(
    await page
      .getByRole("spinbutton", { name: "同口径可达测算值" })
      .inputValue(),
    "111",
  );
  results.push("F2 exact target and saved form restored");
  // A draft save failure must retain the user's exact edit and allow an explicit retry.
  await page.route("**/decomposition/draft", (route) => route.abort());
  await page.getByRole("spinbutton", { name: "同口径可达测算值" }).fill("110");
  await page
    .getByRole("button", { name: "重试保存草稿", exact: true })
    .waitFor();
  assert.equal(
    await page
      .getByRole("spinbutton", { name: "同口径可达测算值" })
      .inputValue(),
    "110",
  );
  await page.unroute("**/decomposition/draft");
  await button("重试保存草稿").click();
  await waitFor(
    () => api(normal.route + "/workspace"),
    (ws) => ws.draft.estimate.estimatedValue === 110,
    "retry should save preserved edit",
  );
  results.push("F10 failed save retained input and retry saved");

  const concurrentBase = await api(normal.route + "/workspace");
  await page.route(
    "**/decomposition/draft",
    async (route) => {
      const remote = makeNormalDraftPayload(concurrentBase.activeGsaPlan, {
        expectedDraftRevision: concurrentBase.draft.revision,
      });
      remote.rows[0].responsible = "并发写入的负责人";
      await api(normal.route + "/decomposition/draft", "POST", remote);
      await route.continue();
    },
    { times: 1 },
  );
  await page.getByRole("spinbutton", { name: "同口径可达测算值" }).fill("111");
  await button("请 Agent 合并保留的改稿").waitFor();
  await closeDialog();
  await page.getByText("草稿操作",{exact:true}).click();
  await button("同步最新草稿").click();
  await openEstimate();
  assert.equal(
    await page
      .getByRole("spinbutton", { name: "同口径可达测算值" })
      .inputValue(),
    "111",
  );
  await button("请 Agent 合并保留的改稿").click();
  const merged = await waitFor(
    () => api(normal.route + "/workspace"),
    (ws) =>
      ws.draft.estimate.estimatedValue === 111 &&
      ws.draft.rows[0].responsible === "并发写入的负责人",
    "reconciliation must preserve both independent edits",
  );
  assert.ok(merged.draft.revision > concurrentBase.draft.revision);
  results.push(
    "F10 stale save rejected, local edits retained and Agent reconciled against latest draft",
  );

  const choose = async (item) => {
    if(await page.locator("dialog[open]").count())await closeDialog();
    await button("切换目标").click();
    await page
      .getByRole("dialog", { name: "切换目标" })
      .getByRole("listitem")
      .filter({ hasText: item.goal.title })
      .click();
    await page
      .getByRole("heading", { name: item.goal.title, exact: true })
      .waitFor();
  };
  await choose(candidate);
  await shot("01-gsa-initial");
  await button("修改 GSA").click();
  await button("保存 GSA 候选").click();
  await page
    .getByText("GSA 候选已保存，正式版继续以已确认版本为准。", { exact: true })
    .waitFor();
  assert.equal((await api(candidate.route + "/workspace")).gsaPlans.length, 0);
  await button("修改 GSA").click();
  await button("＋ 添加计划 A").click();
  await button("＋ 添加计划 A").click();
  await page
    .getByRole("textbox", { name: "计划 A 3 内容", exact: true })
    .fill("第三行人工内容须保留");
  await button("移除").nth(1).click();
  await button("＋ 添加计划 A").click();
  await button("让 Agent 推荐计划 A").last().click();
  await waitFor(
    () =>
      page
        .getByRole("textbox", { name: "计划 A 3 内容", exact: true })
        .inputValue(),
    (value) => value.includes("新品陈列"),
    "new empty row should receive its own suggestion",
  );
  assert.equal(
    await page
      .getByRole("textbox", { name: "计划 A 2 内容", exact: true })
      .inputValue(),
    "第三行人工内容须保留",
  );
  await button("移除").last().click();
  await button("移除").last().click();
  results.push(
    "F3 partial GSA saved and F4 removed/re-added rows cannot overwrite another manual row",
  );
  await button("让 Agent 推荐计划 A").click();
  await waitFor(
    () =>
      page
        .getByRole("textbox", { name: "计划 A 1 内容", exact: true })
        .inputValue(),
    (value) => value.includes("新品陈列"),
    "Agent should fill the original A field",
  );
  assert.equal(
    await page
      .getByRole("textbox", { name: "计划 A 1 观察依据", exact: true })
      .inputValue(),
    "仅用 POS 日报，不用照片",
  );
  const notes =
    "华东 3 家门店，周五前完成新品陈列，不追加预算；仅用 POS 日报，不用照片";
  await page
    .getByRole("textbox", { name: "计划 A 1 内容", exact: true })
    .fill(notes);
  planDelay = 500;
  await button("Agent 一键优化计划").click();
  await page
    .getByRole("textbox", { name: "计划 A 1 观察依据", exact: true })
    .fill("人工新补的可用依据");
  await waitFor(
    () =>
      page
        .getByRole("textbox", { name: "计划 A 1 检查点", exact: true })
        .inputValue(),
    (value) => value.includes("周五前"),
    "optimization should preserve the deadline",
  );
  assert.equal(
    await page
      .getByRole("textbox", { name: "计划 A 1 观察依据", exact: true })
      .inputValue(),
    "人工新补的可用依据",
  );
  await page
    .getByRole("textbox", { name: "计划 A 1 检查点", exact: true })
    .fill("负责人后改的检查点");
  await button("撤销本次建议").click();
  assert.equal(
    await page
      .getByRole("textbox", { name: "计划 A 1 内容", exact: true })
      .inputValue(),
    notes,
  );
  assert.equal(
    await page
      .getByRole("textbox", { name: "计划 A 1 检查点", exact: true })
      .inputValue(),
    "负责人后改的检查点",
  );
  results.push(
    "F4/F7 recommend, optimize, protect concurrent typing and safe undo",
  );
  planDelay = 0;
  await button("保存 GSA 候选").click();
  await page
    .getByText("GSA 候选已保存，正式版继续以已确认版本为准。", { exact: true })
    .waitFor();
  assert.equal((await api(candidate.route + "/workspace")).gsaPlans.length, 0);
  await page.reload();
  await page
    .getByRole("heading", { name: candidate.goal.title, exact: true })
    .waitFor();
  await shot('01-gsa-ready');
  await button('修改 GSA').click();
  assert.equal(await page.getByRole('textbox',{name:'计划 A 1 内容',exact:true}).inputValue(),notes);
  await shot('01-gsa-edit');
  await button("确认 GSA，开始拆解").click();
  await button("按此要求起草").waitFor();
  assert.equal((await api(candidate.route + "/workspace")).draft, null);
  await button("调整总 GSA / 计划 A").click();
  await page
    .getByRole("textbox", { name: "计划 A 1 内容", exact: true })
    .fill(notes + "；补充供货复核");
  await page
    .getByRole("textbox", { name: "GSA 修订原因", exact: true })
    .fill("补充供货风险检查");
  let gsaWrites = 0;
  await page.route(
    "**/gsa-plan/confirm",
    async (route) => {
      gsaWrites++;
      const response = await route.fetch();
      assert.equal(response.status(), 201);
      await route.abort();
    },
    { times: 1 },
  );
  await button("确认更新 GSA 计划 v2").click();
  await page.locator('details[aria-label="原 GSA 确认回执"]').waitFor();
  await button("按此要求起草").waitFor();
  assert.equal(gsaWrites, 1);
  assert.equal((await api(candidate.route + "/workspace")).gsaPlans.length, 2);
  assert.equal(
    await page.evaluate(
      (id) => localStorage.getItem("optracall.goal.pendingGsa.v1:" + id),
      candidate.goal.goalId,
    ),
    null,
  );
  results.push(
    "F3 lost GSA revision response recovered by original confirmation receipt with one write",
  );
  const composer = page.getByRole("textbox", {
    name: "向目标管理 Agent提问",
    exact: true,
  });
  // The label uses a space before 提问 in current UI.
  const input = page
    .getByRole("textbox", {
      name: /向目标管理 Agent提问|向目标管理 Agent 提问/,
    })
    .first();
  await input.fill("这段未发送的要求要保留");
  await button("按此要求起草").click();
  const firstDraft = await waitFor(
    () => api(candidate.route + "/workspace"),
    (ws) => ws.draft?.updatedBy === "agent",
    "one click should create the first decomposition draft",
  );
  await waitFor(
    () => input.inputValue(),
    (value) => value === "这段未发送的要求要保留",
    "shortcut should retain unsent human words",
  );
  assert.equal(firstDraft.draft.revision, 1);
  results.push(
    "F3 candidate persistence, one confirmation and F9 verbatim one-click draft",
  );
  assert.equal(await page.locator('.gm-workspace').count(),1);
  assert.equal(await page.locator('.gm-right-table input:visible,.gm-right-table select:visible').count(),0);
  await page.getByRole('button',{name:'按品类',exact:true}).waitFor();
  await shot('02-decomposition');
  await page.getByRole('button',{name:'按品类',exact:true}).click();
  assert.equal(await page.getByRole('button',{name:'按品类',exact:true}).getAttribute('aria-pressed'),'true');
  await page.setViewportSize({width:390,height:844});
  await button('查看拆解表 ↓').click();
  assert.equal(await page.locator('.gm-right-table').evaluate(el=>el===document.activeElement),true);
  await shot('02-mobile-result');
  await button('↑ 返回对话').click();
  assert.equal(await page.locator('.gm-left-agent').evaluate(el=>el===document.activeElement),true);
  await shot('02-mobile-agent');
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'mobile must not overflow');
  await page.setViewportSize({width:1600,height:1000});
  await button("核对并发布").click();
  const preview = page.getByRole("dialog", { name: "核对并发布目标拆解表 v1" });
  await preview.waitFor();
  await preview.getByRole("button", { name: /确认发布 v1/ }).click();
  await page.getByRole("region", { name: "当前正式拆解版" }).waitFor();
  assert.equal(
    (await api(candidate.route + "/workspace")).activePublication.version,
    1,
  );
  await shot('02-published');
  assert.equal(await page.locator('.gm-right-table:visible').count(),0);
  assert.equal(await page.getByRole('region',{name:'当前正式拆解版'}).locator('input:visible,select:visible,textarea:visible').count(),0);
  await button("开始阶段跟进").click();
  await page.getByText('调整检查版本、责任范围与阶段',{exact:true}).click();
  await page
    .getByRole("combobox", { name: "选择检查责任行" })
    .selectOption("G-TOTAL");
  await page
    .getByRole("textbox", { name: "实绩报表原文" })
    .fill("数据截至 2027-01-07。净销售额 25 万元。");
  await page.getByRole("button", { name: /提交本次实绩|保存实绩/ }).click();
  const assessed = await waitFor(
    () => api(candidate.route + "/workspace"),
    (ws) => ws.checks.length === 1,
    "selected report should be assessed through Pi",
  );
  assert.equal(
    assessed.checks[0].actualSource.cutoffQuote,
    "数据截至 2027-01-07。",
  );
  assert.equal(assessed.checks[0].overallPending, false);
  await page.keyboard.press("Escape");
  await page.getByText(/本次粘贴报表 · 2027-01-07 · 零售事业部/).waitFor();
  await shot('03-followup');
  await button("用这份核对").click();
  await page.getByRole("dialog", { name: "Agent 核对实绩" }).waitFor();
  await page.keyboard.press("Escape");
  assert.equal((await api(candidate.route + "/workspace")).checks.length, 1);
  results.push(
    "F11 report cutoff extracted with quote and receipt selected in one click",
  );
  await page
    .getByRole("navigation", { name: "目标管理三阶段流程" })
    .getByRole("button", { name: /到期复盘/ })
    .click();
  await conclusions().first().waitFor();
  assert.equal(await page.getByRole('textbox',{name:'结论摘要',exact:true}).count(),0,'review starts with readable conclusions');
  await editConclusion('负责人改写后保留的结论');
  await page.getByRole("checkbox", { name: "带入下一期" }).first().check();
  await waitFor(
    () => api(candidate.route + "/review-draft?period=2027-01"),
    (res) =>
      res.draft.conclusions[0]?.summary === "负责人改写后保留的结论" &&
      res.draft.conclusions[0].selected,
    "review edits should save",
  );
  await page.route("**/review-draft", (route) => route.abort(), { times: 1 });
  await editConclusion('负责人保存失败后仍须保留的结论');
  await button("重试保存复盘草稿").waitFor();
  const remoteReview = await api(
    candidate.route + "/review-draft?period=2027-01",
  );
  await api(candidate.route + "/review-draft", "POST", {
    ...remoteReview.draft,
    expectedRevision: remoteReview.draft.revision,
    conclusions: remoteReview.draft.conclusions.map((c, index) =>
      index === 0 ? { ...c, summary: "另一端的修改", selected: false } : c,
    ),
  });
  await page.reload();
  await page.getByRole("region", { name: "复盘保存冲突对照" }).waitFor();
  assert.equal(
    await conclusions().first().locator(':scope > p').first().textContent(),
    "负责人保存失败后仍须保留的结论",
  );
  assert.equal(
    await page
      .getByRole("checkbox", { name: "带入下一期" })
      .first()
      .isChecked(),
    true,
  );
  await button("已核对，保留本地取舍并合入远端新增结论").click();
  await waitFor(
    () => api(candidate.route + "/review-draft?period=2027-01"),
    (res) =>
      res.draft.conclusions[0].summary === "负责人保存失败后仍须保留的结论" &&
      res.draft.conclusions[0].selected,
    "explicit review conflict resolution should preserve final local wording and selection",
  );
  results.push(
    "F12 failed review save and concurrent remote revision keep local edits across reload",
  );
  await page
    .getByRole("navigation", { name: "目标管理三阶段流程" })
    .getByRole("button", { name: /阶段跟进/ })
    .click();
  await api(candidate.route + "/decomposition/checks", "POST", {
    operationId: randomUUID(),
    publicationVersion: 1,
    rowId: "G-TOTAL",
    checkpointId: "CP-202701-W2-TOTAL",
    actualSource: {
      ref: "pos-w2",
      label: "第2周凭证",
      cutoffAt: "2027-01-14",
      basis: {
        metric: "净销售额",
        unit: "万元",
        scope: "零售事业部 · 全渠道与门店",
        periodId: "W2",
        coverage: "complete",
        maturity: "closed",
      },
    },
    comparability: "comparable",
    actualPeriods: [{ periodId: "W2", actualValue: 29 }],
  });
  const reviewOwner={role:'goal',goalId:candidate.goal.goalId,version:candidate.goal.version,analysisVariant:'goal-review'};
  const reviewRoute='/api/business-role?owner='+encodeURIComponent(JSON.stringify(reviewOwner));
  const firstReviewRun=(await api(reviewRoute)).discussion.lastRun.id;
  let delayedReviewRun, delayedReviewReads=0, reviewReleaseAt=0, holdReviewReceipt=true;
  const reviewMessages=[];
  const observeReviewMessage=request=>{
    const url=new URL(request.url());
    if(url.pathname==='/api/business-role'&&url.searchParams.get('action')==='messages'&&
       url.searchParams.get('owner')===JSON.stringify(reviewOwner))reviewMessages.push(request.postDataJSON());
  };
  page.on('request',observeReviewMessage);
  await page.route('**/api/business-role?**',async route=>{
    try {
    const url=new URL(route.request().url());
    if(route.request().method()!=='GET'||url.searchParams.has('action')||url.searchParams.get('owner')!==JSON.stringify(reviewOwner))return route.continue();
    const response=await route.fetch();
    const detail=await response.json();
    if(!detail.busy&&detail.discussion?.lastRun?.id!==firstReviewRun&&detail.discussion?.lastRun?.status==='completed'){
      delayedReviewRun=detail.discussion.lastRun.id;
      reviewReleaseAt||=Date.now()+1200;
      if(holdReviewReceipt||Date.now()<reviewReleaseAt){
        delayedReviewReads++;
        return await route.fulfill({response,json:{...detail,discussion:{...detail.discussion,lastRun:{...detail.discussion.lastRun,status:'unknown'}}}});
      }
    }
    return await route.fulfill({response,json:detail});
    }catch(error){if(!String(error).includes('Route is already handled'))throw error; /* A goal switch cancelled this intercepted read. */}
  });
  await page
    .getByRole("navigation", { name: "目标管理三阶段流程" })
    .getByRole("button", { name: /到期复盘/ })
    .click();
  await waitFor(()=>delayedReviewReads,count=>count>0,'the second review must wait on its original receipt');
  await editConclusion('负责人等待原结果期间修改的结论');
  await waitFor(()=>api(candidate.route+'/review-draft?period=2027-01'),value=>value.draft.conclusions[0].summary==='负责人等待原结果期间修改的结论','editing during receipt recovery should save');
  await choose(normal);
  holdReviewReceipt=false;
  await choose(candidate);
  await waitFor(
    () => conclusions().count(),
    (count) => count === 2,
    "new check should be added automatically on return",
  );
  assert.ok(delayedReviewReads>0,'the completed run must first be observed before its business receipt is projected');
  assert.equal(reviewMessages.length,1,'receipt recovery must not send another model request');
  assert.equal(reviewMessages[0].requestId,delayedReviewRun);
  assert.equal((await api(reviewRoute)).discussion.lastRun.id,delayedReviewRun);
  page.off('request',observeReviewMessage);
  await page.unroute('**/api/business-role?**');
  results.push('F12 delayed terminal receipt and target return recover the original request without another model run');
  assert.equal(
    await conclusions().first().locator(':scope > p').first().textContent(),
    "负责人等待原结果期间修改的结论",
  );
  assert.equal(
    await page
      .getByRole("checkbox", { name: "带入下一期" })
      .first()
      .isChecked(),
    true,
  );
  await button("舍弃此结论").nth(1).click();
  await waitFor(
    () => api(candidate.route + "/review-draft?period=2027-01"),
    (res) => res.draft.conclusions.some((c) => c.discarded),
    "discard should save",
  );
  await page.screenshot({
    path: path.join(evidence, "review-desktop.png"),
    fullPage: true,
  });
  await page.reload();
  await conclusions().first().waitFor();
  assert.equal(
    await conclusions().first().locator(':scope > p').first().textContent(),
    "负责人等待原结果期间修改的结论",
  );
  await page.getByRole('spinbutton',{name:'期末结账实绩',exact:true}).fill('123');
  await page.getByRole('textbox',{name:'结账凭证引用',exact:true}).fill('2027-01 财务结账凭证（合成验收）');
  await page.getByRole('textbox',{name:'结账材料原文',exact:true}).fill('2027年1月零售事业部全渠道与门店净销售额123万元，期间已结账，覆盖完整。');
  await waitFor(()=>api(candidate.route+'/review-draft?period=2027-01'),v=>v.draft.actualFinalValue===123&&v.draft.closingReport?.includes('覆盖完整'),'closing evidence saved');
  const closing=page.locator('details').filter({has:page.getByText('查看或补充期末结账资料',{exact:true})});
  if(await closing.evaluate(el=>el.open))await closing.locator('summary').click();
  await shot('04-review');
  await conclusions().first().scrollIntoViewIfNeeded();
  await page.screenshot({path:path.join(evidence,'04-review-conclusions.png')});
  await button("用选中结论起草下一期（1）").click();
  const next = await waitFor(
    () => api(candidate.route + "/workspace"),
    (ws) => ws.nextCycleDrafts.length === 1,
    "selected final conclusions should reach next cycle",
  );
  assert.equal(next.nextCycleDrafts[0].selectedConclusions.length, 1);
  assert.equal(
    next.nextCycleDrafts[0].selectedConclusions[0].summary,
    "负责人等待原结果期间修改的结论",
  );
  assert.equal(next.publications.length, 1);
  results.push(
    "F12 edits, discard and selection retained, new checks merged, selected final wording handed on",
  );
  const nextOwner={role:'goal-draft',draftId:next.nextCycleDrafts[0].draftId,scope:next.nextCycleDrafts[0].targetScope,nextCycleSourceGoalId:candidate.goal.goalId};
  const nextRoute='/api/business-role?owner='+encodeURIComponent(JSON.stringify(nextOwner));
  const completedNext=await waitFor(()=>api(nextRoute),value=>value.discussion?.lastRun?.status==='completed','explicit next-cycle drafting should settle');
  await page.keyboard.press("Escape");
  await page.getByRole('button',{name:/查看起草对话$/}).click();
  await page.getByRole('dialog',{name:'Agent 起草下一期目标'}).waitFor();
  const inspectedNext=await api(nextRoute);
  assert.equal(inspectedNext.discussion.lastRun.id,completedNext.discussion.lastRun.id);
  assert.equal(inspectedNext.discussion.revision,completedNext.discussion.revision);
  await page.keyboard.press('Escape');
  results.push('F12 reopening the saved drafting conversation is readonly and starts no new run');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: path.join(evidence, "review-mobile.png"),
    fullPage: true,
  });
  assert.deepEqual(provider.errors, []);
  await page.screenshot({
    path: path.join(evidence, "desktop.png"),
    fullPage: true,
  });
  assert.deepEqual(errors, []);
  await writeFile(
    path.join(evidence, "results.json"),
    JSON.stringify({ results, errors }, null, 2),
  );
  console.log(JSON.stringify({ results, errors }));
} catch (error) {
  if (page) {
    await page.screenshot({
      path: path.join(evidence, "failure.png"),
      fullPage: true,
    });
    await writeFile(
      path.join(evidence, "failure.txt"),
      await page.locator("body").innerText(),
    );
  }
  throw error;
} finally {
  await page?.unrouteAll({behavior:"wait"});
  await browser.close();
  await host.close();
  await provider.close();
}
