import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { createHost } from '../src/host/server.ts';
import { createStrategyInitiativePublications } from '../src/host/strategy-initiative-publications.ts';
import { StrategyInitiativeStore } from '../src/host/strategy-initiative-store.ts';
import { initiativeScopeKey } from '../src/host/strategy-initiative-types.ts';
import { StrategyGoalsStore } from '../src/host/strategy-goals-store.ts';
import type { GoalScope } from '../src/host/strategy-goals-types.ts';
import type {
  DecompositionDraftInput,
  GsaPlanConfirmInput,
} from '../src/host/strategy-goal-decomposition-types.ts';

async function json(response: Response, expectedStatus = 200): Promise<any> {
  const text = await response.text();
  assert.equal(response.status, expectedStatus, `expected ${expectedStatus}, got ${response.status}: ${text}`);
  return JSON.parse(text);
}

async function startTestHost(options: {
  dataRoot?: string;
  projectsRoot?: string;
  goalDecompositionEnabled?: boolean;
  goalDecompositionPreCommitFault?: (goalId: string, operationId: string) => void;
} = {}) {
  const ownedRoot = !options.dataRoot;
  const base = ownedRoot ? mkdtempSync(path.join(tmpdir(), 'optracall-gm-full-')) : undefined;
  const root = options.dataRoot ?? path.join(base!, 'data');
  const projectsRoot = options.projectsRoot ?? (base ? path.join(base, 'projects') : `${options.dataRoot}-projects`);
  mkdirSync(root, { recursive: true });
  mkdirSync(projectsRoot, { recursive: true });
  const host = createHost({
    cwd: process.cwd(),
    uiPorts: [4173],
    transportVersion: 'test',
    dataRoot: root,
    projectsRoot,
    goalDecompositionEnabled: options.goalDecompositionEnabled,
    goalDecompositionPreCommitFault: options.goalDecompositionPreCommitFault,
  });
  await host.ready;
  await new Promise<void>(resolve => host.server.listen(0, '127.0.0.1', resolve));
  const address = host.server.address();
  assert.ok(address && typeof address !== 'string');
  const baseUrl = `http://127.0.0.1:${address.port}`;
  const request = (urlPath: string, method = 'GET', body?: unknown) =>
    fetch(`${baseUrl}${urlPath}`, {
      method,
      headers: {
        Origin: 'http://127.0.0.1:4173',
        'X-OptraCall-Client': '1',
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
  return {
    root,
    projectsRoot,
    baseUrl,
    request,
    async close() {
      await host.close();
      if (ownedRoot && base) rmSync(base, { recursive: true, force: true });
    },
  };
}

const deptScope: GoalScope = { kind: 'department', id: 'retail-ops-full', name: '门店运营部' };

function validDraftInput(plan: { planId: string; planVersion: number; contentSha256: string }, expectedDraftRevision: number): DecompositionDraftInput {
  return {
    gsaPlanId: plan.planId,
    gsaPlanVersion: plan.planVersion,
    gsaPlanSha256: plan.contentSha256,
    expectedDraftRevision,
    estimate: {
      metricKind: 'amount',
      period: '2027-01',
      scopeDescription: '门店运营部全渠道',
      formalTargetValue: 120,
      estimatedValue: 112,
      gapValue: 8,
      unit: '万元',
      basis: '近 12 个月同比与门店可达测算',
      evidence: [{ category: 'internal', summary: '近 12 个月同比与门店可达测算' }],
      limitations: ['依赖新品排期'],
    },
    rows: [
      {
        rowId: 'row-online',
        title: '线上平台 1 月净销 70 万',
        outcome: '线上平台 1 月净销售额达到 70 万元',
        scope: { kind: 'department', id: 'channel-online', name: '线上平台' },
        scopeLabel: '线上平台',
        targetValue: 70,
        unit: '万元',
        metricKind: 'amount',
        responsible: '王电商',
        strategy: '平台活动放量',
        contributionNature: 'allocation',
        commitAsGoal: true,
        basis: '线上去年同期 62 万 + 活动增量 8 万',
        checkpoints: [
          { id: 'cp-online-w2', label: '线上第2周检查', date: '2027-01-14', targetValue: 35, unit: '万元', status: 'planned', evidenceSource: '平台订单报表' },
        ],
        tracked: true,
      },
      {
        rowId: 'row-store',
        title: '门店自营 1 月净销 45 万',
        outcome: '门店自营 1 月净销售额达到 45 万元',
        scope: { kind: 'department', id: 'channel-store', name: '门店自营' },
        scopeLabel: '门店自营',
        targetValue: 45,
        unit: '万元',
        metricKind: 'amount',
        responsible: '赵店长',
        strategy: '老客复购与礼盒推销',
        contributionNature: 'allocation',
        commitAsGoal: true,
        basis: '门店去年同期 41 万 + 复购增量 4 万',
        checkpoints: [
          { id: 'cp-store-w2', label: '门店第2周检查', date: '2027-01-14', targetValue: 22.5, unit: '万元', status: 'planned', evidenceSource: '门店POS日结' },
        ],
        tracked: true,
      },
    ],
    reserves: [
      { id: 'res-buffer', purpose: '新店开业爬坡缓冲', amount: 5, unit: '万元', owner: '林负责人', basis: '总部统筹预留，不自动采用为子目标' },
    ],
    gapStrategies: [
      { id: 'gap-1', name: '新品联合首发', strategy: '联合头部主播新品首发', expectedContribution: 8, unit: '万元', nonOverlappingScope: '新品首发增量专场', scopeKey: 'new-launch', basis: '过往首发转化率 4.2%', kind: 'expected-increment' },
    ],
    views: [],
    timePlan: [
      { periodId: 'm1-w1', granularity: 'week', label: '第 1 周', startDate: '2027-01-01', endDate: '2027-01-07', targetValue: 30, unit: '万元', status: 'planned', checkpointId: 'cp-w1' },
      { periodId: 'm1-w2', granularity: 'week', label: '第 2 周', startDate: '2027-01-08', endDate: '2027-01-14', targetValue: 30, unit: '万元', status: 'planned', checkpointId: 'cp-w2' },
      { periodId: 'm1-w3', granularity: 'week', label: '第 3 周', startDate: '2027-01-15', endDate: '2027-01-21', targetValue: 30, unit: '万元', status: 'planned', checkpointId: 'cp-w3' },
      { periodId: 'm1-w4', granularity: 'week', label: '第 4 周', startDate: '2027-01-22', endDate: '2027-01-31', targetValue: 30, unit: '万元', status: 'planned', checkpointId: 'cp-w4' },
    ],
  };
}

async function createAndConfirmGoal(host: Awaited<ReturnType<typeof startTestHost>>, formalValue = 120, period = '2027-01', scope: GoalScope = deptScope) {
  const { goal } = await json(await host.request('/api/strategy/goals', 'POST', {
    operationId: randomUUID(),
    title: `${period} 净销售额达到 ${formalValue} 万元`,
    outcome: `${period} 净销售额达到 ${formalValue} 万元`,
    perspective: 'profit',
    scope,
    measurement: { kind: 'deliverable', criterion: `净销售额达到 ${formalValue} 万元` },
    baseline: { state: 'known', description: '可比期 108 万元' },
    responsible: '林负责人',
    dueAt: '2027-01-31',
    strategies: ['老客复购与新品放量'],
    formalOrigin: { kind: 'manual-exception', reason: '尚未发布战略版本', period, targetValue: formalValue, unit: '万元', metricKind: 'amount' },
  }), 201);
  const confirmPayload: GsaPlanConfirmInput = {
    operationId: randomUUID(),
    expectedGoalVersion: 1,
    expectedPlanVersion: 0,
    decision: '确认总 GSA',
    confirmedBy: '林负责人',
    plannedActions: [{ id: 'act-1', summary: '上线礼盒和复购券', checkpoint: '第2周核对' }],
    stageCheckpoints: [{ id: 'stg-1', label: '月中核对', targetDate: '2027-01-15', observationBasis: 'POS净销' }],
  };
  const confirmed = await json(await host.request(`/api/strategy/goals/${goal.goalId}/gsa-plan/confirm`, 'POST', confirmPayload), 201);
  return { goal: confirmed.goal, gsaPlan: confirmed.gsaPlan };
}

test('GM01: 正式战略目标发布拦截手工绕开，仅记录发布不阻断，后续发布可显式核对补挂且不覆写历史', { timeout: 60_000 }, async t => {
  const base = mkdtempSync(path.join(tmpdir(), 'optracall-gm01-'));
  const root = path.join(base, 'data');
  const projectsRoot = path.join(base, 'projects');
  mkdirSync(root, { recursive: true });
  mkdirSync(projectsRoot, { recursive: true });

  const initiatives = new StrategyInitiativeStore(root);
  const goalsStore = new StrategyGoalsStore(root);
  const init = initiatives.create({ operationId: randomUUID(), title: '2027Q1零售增长战略', scopes: [deptScope] });
  const batchId = randomUUID();
  const fp1 = 'a'.repeat(64);
  const fp2 = 'c'.repeat(64);
  const cid1 = randomUUID();
  const cid2 = randomUUID();
  const lockOp1 = randomUUID();
  const lockOp2 = randomUUID();
  const pubs = createStrategyInitiativePublications({
    initiatives,
    candidates: {
      version: (_id, cid, no) => ({
        candidateId: cid,
        no,
        scopeKey: initiativeScopeKey(deptScope),
        scope: deptScope,
        title: '核心增长候选',
        summary: '聚焦核心门店增长',
        contentSha256: no === 1 ? fp1 : fp2,
        lock: { fingerprint: no === 1 ? fp1 : fp2, operationId: no === 1 ? lockOp1 : lockOp2, lockedAt: '2027-01-01T00:00:00.000Z' },
        goalDrafts: [],
      } as any),
    },
    verifications: {
      passCredentials: (_id, _cid, no) => ({
        batchId,
        lockOperationId: no === 1 ? lockOp1 : lockOp2,
        gates: [{ ref: 'gate-1-pass' }, { ref: 'gate-2-pass' }],
        passedAt: '2027-01-01T00:00:00.000Z',
      } as any),
    },
    goals: {
      create: input => goalsStore.create(input as any),
      getOperation: opId => goalsStore.getOperation(opId),
      operationContext: receipt => goalsStore.operationContext(receipt as any),
      read: ref => goalsStore.read(ref),
    },
    mutate: fn => Promise.resolve(fn()),
  });

  // 1) Record-only publication (no formalGoals -> handoffEligible=false) MUST NOT block manual creation
  const recordOnlyPub = await pubs.publish(init.id, {
    operationId: randomUUID(),
    candidateId: cid1,
    no: 1,
    sha256: fp1,
    batchId,
    confirmed: true,
    expectedActive: null,
  });

  const host = await startTestHost({ dataRoot: root, projectsRoot });
  t.after(async () => {
    await host.close().catch(() => {});
    rmSync(base, { recursive: true, force: true });
  });

  const formalSources1 = await json(await host.request(`/api/strategy/goals/formal-sources?scopeKind=department&scopeId=${deptScope.id}`));
  assert.equal(formalSources1.formalPublications.length, 0);
  assert.equal(formalSources1.recordOnlyPublications.length, 1);

  // Manual creation for 2027-02 succeeds because no handoffEligible formal publication exists yet
  const manualGoal = await json(await host.request('/api/strategy/goals', 'POST', {
    operationId: randomUUID(),
    title: '2 月手动目标 100 万',
    outcome: '2 月净销售额 100 万元',
    perspective: 'profit',
    scope: deptScope,
    measurement: { kind: 'deliverable', criterion: '2 月净销售额 100 万元' },
    baseline: { state: 'known', description: '去年 90 万' },
    responsible: '林负责人',
    dueAt: '2027-02-28',
    strategies: ['手工策略'],
    formalOrigin: { kind: 'manual-exception', reason: '战略尚未发布', period: '2027-02', targetValue: 100, unit: '万元', metricKind: 'amount' },
  }), 201);

  // 2) Publish formal strategy publication with formalGoals (handoffEligible=true) for 2027-02
  const formalPub = await pubs.publish(init.id, {
    operationId: randomUUID(),
    candidateId: cid2,
    no: 2,
    sha256: fp2,
    batchId,
    confirmed: true,
    expectedActive: recordOnlyPub.publicationId,
    formalGoals: [{
      id: 'fg-2027-02',
      title: '2 月正式战略净销目标 115 万',
      outcome: '2 月净销售额达到 115 万元',
      period: '2027-02',
      targetValue: 115,
      unit: '万元',
      metricKind: 'amount',
      strategies: ['战略新品组合'],
    }],
  });

  // Now trying to create ANOTHER manual-exception goal for same scope + 2027-02 MUST be blocked (409)
  const blocked = await json(await host.request('/api/strategy/goals', 'POST', {
    operationId: randomUUID(),
    title: '绕开正式战略手工目标',
    outcome: '绕开正式战略手工目标',
    perspective: 'profit',
    scope: deptScope,
    measurement: { kind: 'deliverable', criterion: '100 万' },
    baseline: { state: 'known', description: '90 万' },
    responsible: '林负责人',
    dueAt: '2027-02-28',
    strategies: ['手工绕开'],
    formalOrigin: { kind: 'manual-exception', reason: '尝试绕开', period: '2027-02', targetValue: 100, unit: '万元', metricKind: 'amount' },
  }), 409);
  assert.equal(blocked.code, 'formal_strategy_goal_exists');
  assert.equal(blocked.details.publicationId, formalPub.publicationId);

  // Workspace on earlier manual goal shows reconciliation prompt without mutating v1
  const ws = await json(await host.request(`/api/strategy/goals/${manualGoal.goal.goalId}/workspace`));
  assert.equal(ws.formalReconciliation.hasApplicableFormalPublication, true);
  assert.equal(ws.formalReconciliation.manualTargetValue, 100);
  assert.equal(ws.formalReconciliation.formalPublication.formalGoal.targetValue, 115);

  // Explicit reconcile creates v2 carrying strategy-publication formalOrigin while keeping v1 manual record intact
  const reconciled = await json(await host.request(`/api/strategy/goals/${manualGoal.goal.goalId}/reconcile-formal`, 'POST', {
    operationId: randomUUID(),
    expectedVersion: 1,
  }), 201);
  assert.equal(reconciled.goal.version, 2);
  assert.equal(reconciled.goal.formalOrigin.kind, 'strategy-publication');
  assert.equal(reconciled.comparison.manualValue, 100);
  assert.equal(reconciled.comparison.publishedValue, 115);
  const fullRec = await json(await host.request(`/api/strategy/goals/${manualGoal.goal.goalId}`));
  assert.equal(fullRec.goal.versions[0].formalOrigin.kind, 'manual-exception');
  assert.equal(fullRec.goal.versions[1].formalOrigin.kind, 'strategy-publication');
});

test('GM04/GM05: 比率/里程碑校验、未定计划与非目标行不误采用、重复交叉格与重叠补缺拦截、负缺口允许零补缺策略', { timeout: 60_000 }, async t => {
  const host = await startTestHost();
  t.after(() => host.close());

  const { goal, gsaPlan } = await createAndConfirmGoal(host, 120);

  // 1) Reserve without purpose/owner saves as draft with blocking invalid_reserve validation issue
  const draftBadRes = await json(await host.request(`/api/strategy/goals/${goal.goalId}/decomposition/draft`, 'POST', {
    ...validDraftInput(gsaPlan, 0),
    reserves: [{ id: 'bad-res', purpose: '', amount: 5, unit: '万元', owner: '' }],
  }), 201);
  assert.equal(draftBadRes.validation.ok, false);
  assert.ok(draftBadRes.validation.issues.some((i: any) => i.code === 'invalid_reserve'));

  // 2) commitAsGoal=true on undecided/aggregation row rejected during publish preview/publish
  const draftBadCommit = await json(await host.request(`/api/strategy/goals/${goal.goalId}/decomposition/draft`, 'POST', {
    ...validDraftInput(gsaPlan, draftBadRes.draft.revision),
    rows: [
      ...validDraftInput(gsaPlan, 0).rows,
      {
        rowId: 'row-agg',
        title: '汇总分析行',
        outcome: '仅作观察汇总，不应正式采用为子目标',
        scope: { kind: 'department', id: 'agg-view', name: '汇总分析行' },
        scopeLabel: '汇总分析行',
        targetValue: null,
        unit: '万元',
        metricKind: 'amount',
        responsible: '林负责人',
        strategy: '观察汇总',
        contributionNature: 'aggregation',
        commitAsGoal: true,
        basis: '汇总参考',
        checkpoints: [],
      },
    ],
  }), 201);
  assert.equal(draftBadCommit.validation.ok, false);
  assert.ok(draftBadCommit.validation.issues.some((i: any) => i.code === 'invalid_commit_target'));

  // 3) Ratio row without numerator/denominator rejected; overlapping gap scopeKey rejected; duplicate crossCellId rejected
  const draftRuleViolations = await json(await host.request(`/api/strategy/goals/${goal.goalId}/decomposition/draft`, 'POST', {
    ...validDraftInput(gsaPlan, draftBadCommit.draft.revision),
    rows: [
      {
        rowId: 'row-ratio-bad',
        title: '毛利率达到 35%',
        outcome: '1 月毛利率达到 35%',
        scope: { kind: 'department', id: 'ratio-dept', name: '毛利组' },
        scopeLabel: '毛利率',
        targetValue: 35,
        unit: '%',
        metricKind: 'ratio',
        responsible: '财务',
        strategy: '结构优化',
        contributionNature: 'allocation',
        commitAsGoal: false,
        basis: '毛利测算',
        checkpoints: [{ id: 'cp-r1', label: '月中', date: '2027-01-15', targetValue: 35, unit: '%', status: 'observing', evidenceSource: '财报' }],
      },
      {
        rowId: 'row-ms-ok',
        title: 'POS 系统升级上线',
        outcome: '完成全门店POS升级并验收通过',
        scope: { kind: 'department', id: 'ms-dept', name: '交付组' },
        scopeLabel: '系统上线',
        targetValue: 1,
        unit: '项',
        metricKind: 'milestone',
        milestoneCriterion: '1月20日前完成全门店POS升级并验收通过',
        responsible: '研发',
        strategy: '分批灰度上线',
        contributionNature: 'milestone',
        commitAsGoal: false,
        basis: '项目里程碑计划',
        checkpoints: [{ id: 'cp-m1', label: '验收', date: '2027-01-20', targetValue: null, unit: '项', status: 'undecided', evidenceSource: '验收单' }],
      },
    ],
    gapStrategies: [
      { id: 'g1', name: '策略1', strategy: '活动A', expectedContribution: 4, unit: '万元', nonOverlappingScope: '同口径', scopeKey: 'dup-scope', basis: '依据', kind: 'expected-increment' },
      { id: 'g2', name: '策略2', strategy: '活动B', expectedContribution: 4, unit: '万元', nonOverlappingScope: '同口径', scopeKey: 'dup-scope', basis: '依据', kind: 'expected-increment' },
    ],
    views: [
      {
        viewId: 'v-a',
        viewName: '视角A',
        metricId: 'net_sales',
        period: '2027-01',
        coverageScope: '全量',
        reserveIncluded: 5,
        cells: [
          { crossCellId: 'dup-cell', label: '格1', value: 50, unit: '万元', basis: 'b1' },
          { crossCellId: 'dup-cell', label: '格1重复', value: 65, unit: '万元', basis: 'b2' },
        ],
      },
    ],
  }), 201);
  assert.equal(draftRuleViolations.validation.ok, false);
  const codes = new Set(draftRuleViolations.validation.issues.map((i: any) => i.code));
  assert.ok(codes.has('invalid_ratio_rule'));
  assert.ok(codes.has('overlapping_gap_scope'));
  assert.ok(codes.has('duplicate_cross_cell'));

  // 4) Negative gap (surplus: estimated 130 > formal 120, gap = -10) allowed with ZERO gap strategies
  const draftSurplus = await json(await host.request(`/api/strategy/goals/${goal.goalId}/decomposition/draft`, 'POST', {
    ...validDraftInput(gsaPlan, draftRuleViolations.draft.revision),
    estimate: {
      metricKind: 'amount',
      period: '2027-01',
      scopeDescription: '门店运营部全渠道',
      formalTargetValue: 120,
      estimatedValue: 130,
      gapValue: -10,
      unit: '万元',
      basis: '旺季自然流量高于正式目标',
      evidence: [{ category: 'internal', summary: '旺季自然流量测算 130 万' }],
    },
    gapStrategies: [],
  }), 201);
  assert.equal(draftSurplus.validation.ok, true);
  assert.equal(draftSurplus.validation.gapValue, -10);
});

test('GM08: 可证明未提交（not-committed-retryable）跨重启持久化、非显式或过期状态拒绝重试、显式同号重试仅提交一版、放弃释放编辑锁', { timeout: 60_000 }, async t => {
  const sharedBase = mkdtempSync(path.join(tmpdir(), 'optracall-gm08-retry-'));
  const sharedRoot = path.join(sharedBase, 'data');
  const projectsRoot = path.join(sharedBase, 'projects');
  const hostsToClose: { close: () => Promise<void> }[] = [];
  t.after(async () => {
    for (const h of hostsToClose) await h.close().catch(() => {});
    rmSync(sharedBase, { recursive: true, force: true });
  });

  let failOnce = true;
  const host1 = await startTestHost({
    dataRoot: sharedRoot,
    projectsRoot,
    goalDecompositionPreCommitFault: () => {
      if (failOnce) {
        failOnce = false;
        throw new Error('simulated_pre_commit_io_fault');
      }
    },
  });
  hostsToClose.push(host1);

  const { goal, gsaPlan } = await createAndConfirmGoal(host1, 120);
  const { draft } = await json(await host1.request(`/api/strategy/goals/${goal.goalId}/decomposition/draft`, 'POST', validDraftInput(gsaPlan, 0)), 201);
  const preview = await json(await host1.request(`/api/strategy/goals/${goal.goalId}/decomposition/publish-preview`, 'POST', {
    gsaPlanId: gsaPlan.planId,
    gsaPlanVersion: gsaPlan.planVersion,
    gsaPlanSha256: gsaPlan.contentSha256,
    draftRevision: draft.revision,
    draftSha256: draft.contentSha256,
    expectedActiveVersion: null,
  }));

  const opId = randomUUID();
  const basePublish = {
    operationId: opId,
    gsaPlanId: gsaPlan.planId,
    gsaPlanVersion: gsaPlan.planVersion,
    gsaPlanSha256: gsaPlan.contentSha256,
    draftRevision: draft.revision,
    draftSha256: draft.contentSha256,
    expectedActiveVersion: null,
    previewSha256: preview.previewSha256,
    reason: '首次发布',
  };

  // Fault happens before commit → 500 error, zero publications created, durable not-committed-retryable saved
  const failedRes = await host1.request(`/api/strategy/goals/${goal.goalId}/decomposition/publish`, 'POST', basePublish);
  assert.ok(failedRes.status >= 500);
  await host1.close();

  // Restart Host on same dataRoot
  const host2 = await startTestHost({ dataRoot: sharedRoot, projectsRoot });
  hostsToClose.push(host2);

  const opStatus = await json(await host2.request(`/api/strategy/goals/${goal.goalId}/decomposition/operations/${opId}`));
  assert.equal(opStatus.found, true);
  assert.equal(opStatus.operation.status, 'not-committed-retryable');
  assert.equal(opStatus.retryable, true);
  const stateRev = opStatus.operation.stateRevision;

  // Non-explicit retry MUST be rejected (409)
  const rejectedImplicit = await json(await host2.request(`/api/strategy/goals/${goal.goalId}/decomposition/publish`, 'POST', basePublish), 409);
  assert.equal(rejectedImplicit.code, 'decomposition_retry_requires_explicit_cas');

  // Wrong expectedOperationStateRevision MUST be rejected (409)
  const rejectedWrongRev = await json(await host2.request(`/api/strategy/goals/${goal.goalId}/decomposition/publish`, 'POST', {
    ...basePublish,
    explicitRetry: true,
    expectedOperationStateRevision: stateRev + 99,
  }), 409);
  assert.equal(rejectedWrongRev.code, 'decomposition_retry_requires_explicit_cas');

  // Explicit retry with matching stateRevision commits EXACTLY ONE v1
  const retried = await json(await host2.request(`/api/strategy/goals/${goal.goalId}/decomposition/publish`, 'POST', {
    ...basePublish,
    explicitRetry: true,
    expectedOperationStateRevision: stateRev,
  }), 201);
  assert.equal(retried.publication.version, 1);
  assert.equal(retried.operation.status, 'committed');

  const pubs = await json(await host2.request(`/api/strategy/goals/${goal.goalId}/decomposition/publications`));
  assert.equal(pubs.total, 1);

  // Abandon flow on a second failed operation
  await host2.close();
  let failSecond = true;
  const host3 = await startTestHost({
    dataRoot: sharedRoot,
    projectsRoot,
    goalDecompositionPreCommitFault: () => {
      if (failSecond) {
        failSecond = false;
        throw new Error('simulated_second_fault');
      }
    },
  });
  hostsToClose.push(host3);

  const draft2 = await json(await host3.request(`/api/strategy/goals/${goal.goalId}/decomposition/draft`, 'POST', {
    ...validDraftInput(gsaPlan, draft.revision),
    notes: '准备发布 v2',
  }), 201);
  const preview2 = await json(await host3.request(`/api/strategy/goals/${goal.goalId}/decomposition/publish-preview`, 'POST', {
    gsaPlanId: gsaPlan.planId,
    gsaPlanVersion: gsaPlan.planVersion,
    gsaPlanSha256: gsaPlan.contentSha256,
    draftRevision: draft2.draft.revision,
    draftSha256: draft2.draft.contentSha256,
    expectedActiveVersion: 1,
  }));
  const op2 = randomUUID();
  const fail2 = await host3.request(`/api/strategy/goals/${goal.goalId}/decomposition/publish`, 'POST', {
    operationId: op2,
    gsaPlanId: gsaPlan.planId,
    gsaPlanVersion: gsaPlan.planVersion,
    gsaPlanSha256: gsaPlan.contentSha256,
    draftRevision: draft2.draft.revision,
    draftSha256: draft2.draft.contentSha256,
    expectedActiveVersion: 1,
    previewSha256: preview2.previewSha256,
    reason: 'v2 故障',
  });
  assert.ok(fail2.status >= 500);
  const op2Status = await json(await host3.request(`/api/strategy/goals/${goal.goalId}/decomposition/operations/${op2}`));
  assert.equal(op2Status.operation.status, 'not-committed-retryable');

  const abandoned = await json(await host3.request(`/api/strategy/goals/${goal.goalId}/decomposition/operations/${op2}/abandon`, 'POST', {
    expectedStateRevision: op2Status.operation.stateRevision,
  }));
  assert.equal(abandoned.operation.status, 'abandoned');

  // Cannot retry an abandoned operationId
  await json(await host3.request(`/api/strategy/goals/${goal.goalId}/decomposition/publish`, 'POST', {
    operationId: op2,
    gsaPlanId: gsaPlan.planId,
    gsaPlanVersion: gsaPlan.planVersion,
    gsaPlanSha256: gsaPlan.contentSha256,
    draftRevision: draft2.draft.revision,
    draftSha256: draft2.draft.contentSha256,
    expectedActiveVersion: 1,
    previewSha256: preview2.previewSha256,
    explicitRetry: true,
    expectedOperationStateRevision: abandoned.operation.stateRevision,
  }), 409);
});

test('GM10/GM11/GM12 & 原型缺口 #1/#2: 阶段跟进（含缺2店不给整体%、零计划安全、连续2期）、多独立Case草稿意图与试点Case、到期复盘120→110→112、下期草案假设标记与回送战略', { timeout: 60_000 }, async t => {
  const host = await startTestHost();
  t.after(() => host.close());

  // Goal A: no decomposition table at all — proactive pilot Case draft from adopted G+S still works (GM11)
  const pilotGoal = await createAndConfirmGoal(host, 80, '2027-03', { kind: 'department', id: 'pilot-dept', name: '试点业务部' });
  const pilotCase = await json(await host.request(`/api/strategy/goals/${pilotGoal.goal.goalId}/case-draft-intents`, 'POST', {
    operationId: randomUUID(),
    intentId: 'pilot-case-1',
    title: '老客复购试点实验 Case',
    strategy: '老客复购与新品放量',
    kind: 'proactive-pilot',
    evidenceSummary: '无拆解表时从已采用 G+S 发起主动试点 Case 草稿',
  }), 201);
  assert.equal(pilotCase.intent.kind, 'proactive-pilot');
  assert.equal(pilotCase.intent.intentId, 'pilot-case-1');

  // Goal B: Full lifecycle
  const { goal, gsaPlan } = await createAndConfirmGoal(host, 120);
  const baseDraft = validDraftInput(gsaPlan, 0);
  const draftWithZero = {
    ...baseDraft,
    timePlan: [
      ...baseDraft.timePlan,
      { periodId: 'm1-w0', granularity: 'week' as const, label: '试运行周', startDate: '2026-12-28', endDate: '2026-12-31', targetValue: 0, unit: '万元', status: 'planned' as const, checkpointId: 'cp-w0' },
    ],
  };
  const { draft } = await json(await host.request(`/api/strategy/goals/${goal.goalId}/decomposition/draft`, 'POST', draftWithZero), 201);
  const preview = await json(await host.request(`/api/strategy/goals/${goal.goalId}/decomposition/publish-preview`, 'POST', {
    gsaPlanId: gsaPlan.planId,
    gsaPlanVersion: gsaPlan.planVersion,
    gsaPlanSha256: gsaPlan.contentSha256,
    draftRevision: draft.revision,
    draftSha256: draft.contentSha256,
    expectedActiveVersion: null,
  }));
  await json(await host.request(`/api/strategy/goals/${goal.goalId}/decomposition/publish`, 'POST', {
    operationId: randomUUID(),
    gsaPlanId: gsaPlan.planId,
    gsaPlanVersion: gsaPlan.planVersion,
    gsaPlanSha256: gsaPlan.contentSha256,
    draftRevision: draft.revision,
    draftSha256: draft.contentSha256,
    expectedActiveVersion: null,
    previewSha256: preview.previewSha256,
    reason: '正式发布 v1',
  }), 201);

  // PROTOTYPE GAP #1 CHECK: Mutate draft AFTER publishing v1 (both timePlan and row checkpoint)
  // Exports, publication reads, and project handoff previews MUST strictly read frozen v1, NEVER draft!
  await json(await host.request(`/api/strategy/goals/${goal.goalId}/decomposition/draft`, 'POST', {
    ...validDraftInput(gsaPlan, draft.revision),
    rows: [
      {
        ...validDraftInput(gsaPlan, draft.revision).rows[0]!,
        targetValue: 99,
        checkpoints: [
          { id: 'cp-online-w2', label: '草稿篡改标签不应泄漏', date: '2027-01-14', targetValue: 99, unit: '万元', status: 'planned', evidenceSource: '草稿假数据' },
        ],
      },
      {
        ...validDraftInput(gsaPlan, draft.revision).rows[1]!,
        targetValue: 16,
      },
    ],
    timePlan: [
      { periodId: 'm1-w1', granularity: 'week', label: '草稿假第1周', startDate: '2027-01-01', endDate: '2027-01-07', targetValue: 99, unit: '万元', status: 'planned', checkpointId: 'cp-w1' },
    ],
  }), 201);

  const exportV1 = await json(await host.request(`/api/strategy/goals/${goal.goalId}/decomposition/publications/1/export`));
  assert.match(exportV1.html, /线上第2周检查/);
  assert.doesNotMatch(exportV1.html, /草稿篡改标签不应泄漏/);
  assert.doesNotMatch(exportV1.html, /草稿假第1周/);

  const handoffPreview = await json(await host.request(`/api/strategy/goals/${goal.goalId}/decomposition/handoffs/preview`, 'POST', {
    publicationVersion: 1,
    rowId: 'row-online',
    checkpointId: 'cp-online-w2',
  }));
  assert.equal(handoffPreview.checkpoint.label, '线上第2周检查');
  assert.equal(handoffPreview.checkpoint.targetValue, 35);
  assert.equal(handoffPreview.ok, true);

  // Reject non-frozen checkpoint on handoff preview/confirm (409)
  const badCheckpoint = await json(await host.request(`/api/strategy/goals/${goal.goalId}/decomposition/handoffs/preview`, 'POST', {
    publicationVersion: 1,
    rowId: 'row-online',
    checkpointId: 'cp-not-frozen',
  }), 409);
  assert.equal(badCheckpoint.code, 'decomposition_frozen_checkpoint_unavailable');

  // Confirm handoff & verify dedup
  const handoffOp = randomUUID();
  const handoff1 = await json(await host.request(`/api/strategy/goals/${goal.goalId}/decomposition/handoffs`, 'POST', {
    operationId: handoffOp,
    publicationVersion: 1,
    rowId: 'row-online',
    checkpointId: 'cp-online-w2',
  }), 201);
  assert.equal(handoff1.handoff.checkpoint.targetValue, 35);
  assert.equal(handoff1.handoff.authorityStatus, 'not-authorized');
  const handoffDup = await json(await host.request(`/api/strategy/goals/${goal.goalId}/decomposition/handoffs`, 'POST', {
    operationId: handoffOp,
    publicationVersion: 1,
    rowId: 'row-online',
    checkpointId: 'cp-online-w2',
  }), 201);
  assert.equal(handoffDup.replayed, true);
  assert.equal(handoffDup.handoff.handoffId, handoff1.handoff.handoffId);

  // GM10: Check BEFORE threshold is configured & with zero planned value → variancePct must be null, absoluteDiff preserved
  const checkNoThresh = await json(await host.request(`/api/strategy/goals/${goal.goalId}/decomposition/checks`, 'POST', {
    operationId: randomUUID(),
    publicationVersion: 1,
    rowId: 'row-online',
    checkpointId: 'cp-online-w2',
    periodGranularity: 'week',
    periodSequenceKey: '2026-W53',
    actualSource: { ref: 'pos-trial-0', label: 'POS 试运行', cutoffAt: '2026-12-31T23:59:59Z' },
    comparability: 'comparable',
    actualPeriods: [{ periodId: 'm1-w0', label: '试运行周', actualValue: 2 }],
  }), 201);
  assert.equal(checkNoThresh.check.periods[0].variancePct, null);
  assert.equal(checkNoThresh.check.periods[0].absoluteDiff, 2);
  assert.equal(checkNoThresh.check.trigger.type, 'unconfigured');
  assert.equal(checkNoThresh.check.trigger.triggered, false);

  // Configure threshold: -10% single period OR 2 consecutive periods
  await json(await host.request(`/api/strategy/goals/${goal.goalId}/decomposition/threshold`, 'POST', {
    configured: true,
    magnitudePct: 10,
    consecutivePeriods: 2,
    adverseDirection: 'below',
    unit: 'percent',
  }));

  // GM10 Partial-missing 2 stores → overallPending=true, overallVariancePct=null (NEVER -10%!), does NOT trigger consecutive
  const checkPartial = await json(await host.request(`/api/strategy/goals/${goal.goalId}/decomposition/checks`, 'POST', {
    operationId: randomUUID(),
    publicationVersion: 1,
    rowId: 'row-online',
    checkpointId: 'cp-online-w2',
    periodGranularity: 'week',
    periodSequenceKey: '2027-W01-partial',
    actualSource: { ref: 'pos-w1-partial', label: 'POS 日结（缺华东2店）', cutoffAt: '2027-01-07T23:59:59Z' },
    comparability: 'partial-missing',
    missingCoverageNote: '华东旗舰店、苏州中心店尚未上传日结',
    actualPeriods: [{ periodId: 'm1-w1', label: '第 1 周', actualValue: 27 }],
  }), 201);
  assert.equal(checkPartial.check.overallPending, true);
  assert.equal(checkPartial.check.overallVariancePct, null);
  assert.equal(checkPartial.check.trigger.triggered, false);

  // GM10 Complete comparable period 1: 30 vs 28 (-6.67%, below 10% magnitude, consecutive=1)
  const checkW1 = await json(await host.request(`/api/strategy/goals/${goal.goalId}/decomposition/checks`, 'POST', {
    operationId: randomUUID(),
    publicationVersion: 1,
    rowId: 'row-online',
    checkpointId: 'cp-online-w2',
    periodGranularity: 'week',
    periodSequenceKey: '2027-W01',
    actualSource: { ref: 'pos-w1-full', label: 'POS 全量 W1', cutoffAt: '2027-01-08T10:00:00Z' },
    comparability: 'comparable',
    actualPeriods: [{ periodId: 'm1-w1', label: '第 1 周', actualValue: 28 }],
  }), 201);
  assert.equal(checkW1.check.trigger.triggered, false);

  // GM10 Complete comparable adjacent period 2: 30 vs 27 (-10% AND consecutive=2 → triggered!)
  const checkW2 = await json(await host.request(`/api/strategy/goals/${goal.goalId}/decomposition/checks`, 'POST', {
    operationId: randomUUID(),
    publicationVersion: 1,
    rowId: 'row-online',
    checkpointId: 'cp-online-w2',
    periodGranularity: 'week',
    periodSequenceKey: '2027-W02',
    actualSource: { ref: 'pos-w2-full', label: 'POS 全量 W2', cutoffAt: '2027-01-15T10:00:00Z' },
    comparability: 'comparable',
    actualPeriods: [{ periodId: 'm1-w2', label: '第 2 周', actualValue: 27 }],
  }), 201);
  assert.equal(checkW2.check.trigger.triggered, true);
  assert.ok(['magnitude', 'consecutive'].includes(checkW2.check.trigger.type));

  // Set user's Case choice on checkW2 (atomically creates intent-w2-choice bound to checkW2)
  const chosen = await json(await host.request(`/api/strategy/goals/${goal.goalId}/decomposition/checks/${encodeURIComponent(checkW2.check.checkId)}/case-choice`, 'POST', {
    operationId: randomUUID(),
    kind: 'create-new-draft',
    intentId: 'intent-w2-choice',
    title: '第2周-10%触发排查 Case',
    note: '另建新 Case 排查线上与门店双下滑',
  }));
  assert.equal(chosen.check.caseChoice.kind, 'create-new-draft');

  // PROTOTYPE GAP #2: Multiple independent Case draft intents each bound to their own checkId/actuals (never hardcoded single C-015)
  const intent1Op = randomUUID();
  const intent1 = await json(await host.request(`/api/strategy/goals/${goal.goalId}/case-draft-intents`, 'POST', {
    operationId: intent1Op,
    intentId: 'intent-w1-store',
    checkId: checkW1.check.checkId,
    title: '第1周门店补货排查 Case',
    strategy: '老客复购与新品放量',
    kind: 'deviation-followup',
    evidenceSummary: '第1周实绩 28万 vs 计划 30万',
  }), 201);
  const intent2 = await json(await host.request(`/api/strategy/goals/${goal.goalId}/case-draft-intents`, 'POST', {
    operationId: randomUUID(),
    intentId: 'intent-w2-overall',
    checkId: checkW2.check.checkId,
    title: '第2周-10%独立复核 Case',
    strategy: '老客复购与新品放量',
    kind: 'deviation-followup',
    evidenceSummary: '第2周实绩 27万 vs 计划 30万（-10%）',
  }), 201);
  assert.notEqual(intent1.intent.intentId, intent2.intent.intentId);
  assert.equal(intent1.intent.checkId, checkW1.check.checkId);
  assert.equal(intent2.intent.checkId, checkW2.check.checkId);

  // Same intentId/operationId retry deduplicates cleanly
  const intent1Retry = await json(await host.request(`/api/strategy/goals/${goal.goalId}/case-draft-intents`, 'POST', {
    operationId: intent1Op,
    intentId: 'intent-w1-store',
    checkId: checkW1.check.checkId,
    title: '第1周门店补货排查 Case',
    strategy: '老客复购与新品放量',
    kind: 'deviation-followup',
    evidenceSummary: '第1周实绩 28万 vs 计划 30万',
  }), 201);
  assert.equal(intent1Retry.replayed, true);
  assert.equal(intent1Retry.intent.intentId, 'intent-w1-store');

  // GM12 Cycle review: Revise formal G from 120 → 110 and adopt v2; actual final = 112 (+2 vs last effective 110; initial 120 memo only!)
  const rev2 = await json(await host.request(`/api/strategy/goals/${goal.goalId}/revisions`, 'POST', {
    operationId: randomUUID(),
    expectedVersion: 1,
    title: '2027-01 净销售额调整为 110 万元',
    outcome: '2027-01 净销售额达到 110 万元',
    perspective: 'profit',
    scope: deptScope,
    measurement: { kind: 'deliverable', criterion: '净销售额达到 110 万元' },
    baseline: { state: 'known', description: '可比期 108 万元' },
    responsible: '林负责人',
    dueAt: '2027-01-31',
    strategies: ['老客复购与新品放量', '冬季会员加购'],
    formalOrigin: { kind: 'manual-exception', reason: '月中正式修订 G 为 110 万', period: '2027-01', targetValue: 110, unit: '万元', metricKind: 'amount' },
  }), 201);
  const v2Num = rev2.goal.version ?? rev2.goal.currentVersion;
  await json(await host.request(`/api/strategy/goals/${goal.goalId}/adopt`, 'POST', {
    operationId: randomUUID(),
    version: v2Num,
    expectedVersion: v2Num,
    decision: '正式修订总目标为 110 万元',
  }));

  const reviewRes = await json(await host.request(`/api/strategy/goals/${goal.goalId}/cycle-reviews`, 'POST', {
    operationId: randomUUID(),
    period: '2027-01',
    actualFinalValue: 112,
    actualSourceRef: 'fin-close-2027-01',
    conclusions: [
      {
        id: 'conc-1',
        title: '老客复购在本范围成立',
        summary: '门店复购贡献 +6 万，证据成熟且因果已核验',
        sourceRef: checkW1.check.checkId,
        applicableScope: '门店运营部',
        evidenceMature: true,
        causalVerified: true,
        targetScopeSameAsOriginal: true,
      },
      {
        id: 'conc-2',
        title: '冬季会员加购跨范围未验证',
        summary: '样本不足且计划推广到跨区新店，需标为待验证假设',
        sourceRef: checkW2.check.checkId,
        applicableScope: '华东核心店',
        evidenceMature: false,
        causalVerified: false,
        targetScopeSameAsOriginal: false,
      },
    ],
  }), 201);
  assert.equal(reviewRes.review.lastEffectiveFormalTarget.value, 110);
  assert.equal(reviewRes.review.initialFormalTarget.value, 120);
  assert.equal(reviewRes.review.initialFormalTarget.memoOnly, true);
  assert.equal(reviewRes.review.actualFinalValue, 112);
  assert.equal(reviewRes.review.varianceValue, 2);
  assert.equal(reviewRes.review.conclusions[0].classification, 'confirmed-evidence');
  assert.equal(reviewRes.review.conclusions[1].classification, 'hypothesis-unverified');

  // Next-cycle draft tags unverified/cross-scope strategies as hypothesis-unverified and does NOT auto-adopt
  const nextDraft = await json(await host.request(`/api/strategy/goals/${goal.goalId}/next-cycle-draft`, 'POST', {
    operationId: randomUUID(),
    reviewId: reviewRes.review.reviewId,
    nextPeriod: '2027-02',
    selectedConclusionIds: ['conc-1', 'conc-2'],
  }), 201);
  assert.equal(nextDraft.nextCycleDraft.status, 'draft-not-adopted');
  assert.equal(nextDraft.nextCycleDraft.selectedConclusions[1].classification, 'hypothesis-unverified');

  // Return to strategy carries original evidence without overwriting any strategy publication
  const returned = await json(await host.request(`/api/strategy/goals/${goal.goalId}/return-to-strategy`, 'POST', {
    operationId: randomUUID(),
    reviewId: reviewRes.review.reviewId,
    reason: '原战略假设需在下一轮战略讨论重审',
    selectedConclusionIds: ['conc-2'],
    evidenceRefs: [reviewRes.review.reviewId, checkW2.check.checkId],
  }), 201);
  assert.equal(returned.strategyReturn.status, 'returned-for-review');
  assert.equal(returned.strategyReturn.evidenceRefs.length, 2);
});

test('E1 & 原型缺口 #3: 存储外置与分页预算、--disable-goal-decomposition 安全回退（schema 4 只读/写拦截）、权限撤回阻断回读与导出', { timeout: 60_000 }, async t => {
  const sharedBase = mkdtempSync(path.join(tmpdir(), 'optracall-gm-e1-'));
  const sharedRoot = path.join(sharedBase, 'data');
  const projectsRoot = path.join(sharedBase, 'projects');
  const hostsToClose: { close: () => Promise<void> }[] = [];
  const dirsToRemove: string[] = [sharedBase];
  t.after(async () => {
    for (const h of hostsToClose) await h.close().catch(() => {});
    for (const d of dirsToRemove) rmSync(d, { recursive: true, force: true });
  });

  const host = await startTestHost({ dataRoot: sharedRoot, projectsRoot });
  hostsToClose.push(host);
  const { goal, gsaPlan } = await createAndConfirmGoal(host, 120);

  // Build representative 52-week timePlan + multiple rows and publish 3 versions
  const weeks52 = Array.from({ length: 52 }, (_, idx) => ({
    periodId: `w-${String(idx + 1).padStart(2, '0')}`,
    granularity: 'week' as const,
    label: `第 ${idx + 1} 周`,
    startDate: '2027-01-01',
    endDate: '2027-01-07',
    targetValue: Number((120 / 52).toFixed(2)),
    unit: '万元',
    status: 'planned' as const,
    checkpointId: `cp-w-${idx + 1}`,
  }));

  let rev = 0;
  let activeVer: number | null = null;
  for (let v = 1; v <= 3; v++) {
    const saved = await json(await host.request(`/api/strategy/goals/${goal.goalId}/decomposition/draft`, 'POST', {
      ...validDraftInput(gsaPlan, rev),
      timePlan: weeks52,
      notes: `第 ${v} 版多维+52周完整计划`,
    }), 201);
    rev = saved.draft.revision;
    const prev = await json(await host.request(`/api/strategy/goals/${goal.goalId}/decomposition/publish-preview`, 'POST', {
      gsaPlanId: gsaPlan.planId,
      gsaPlanVersion: gsaPlan.planVersion,
      gsaPlanSha256: gsaPlan.contentSha256,
      draftRevision: rev,
      draftSha256: saved.draft.contentSha256,
      expectedActiveVersion: activeVer,
    }));
    const pub = await json(await host.request(`/api/strategy/goals/${goal.goalId}/decomposition/publish`, 'POST', {
      operationId: randomUUID(),
      gsaPlanId: gsaPlan.planId,
      gsaPlanVersion: gsaPlan.planVersion,
      gsaPlanSha256: gsaPlan.contentSha256,
      draftRevision: rev,
      draftSha256: saved.draft.contentSha256,
      expectedActiveVersion: activeVer,
      previewSha256: prev.previewSha256,
      reason: `版本 ${v}`,
    }), 201);
    activeVer = pub.publication.version;
  }

  // Verify blobs are externalized and index.json does not inline snapshot bodies
  const indexRaw = readFileSync(path.join(sharedRoot, 'strategy-goals', 'index.json'), 'utf8');
  const indexParsed = JSON.parse(indexRaw);
  assert.equal(indexParsed.schemaVersion, 4);
  const pubSummary0 = indexParsed.decompositionPublications[goal.goalId][0];
  assert.equal('snapshot' in pubSummary0, false, 'index.json MUST NOT inline full publication snapshot');
  const blobFile = path.join(sharedRoot, 'strategy-goals', 'blobs', `${pubSummary0.snapshotSha256}.json`);
  assert.equal(existsSync(blobFile), true, 'content-addressed snapshot blob must exist');
  assert.ok(statSync(path.join(sharedRoot, 'strategy-goals', 'index.json')).size < 128 * 1024);

  // Pagination on /decomposition/publications
  const page1 = await json(await host.request(`/api/strategy/goals/${goal.goalId}/decomposition/publications?offset=0&limit=2`));
  assert.equal(page1.total, 3);
  assert.equal(page1.items.length, 2);
  const page2 = await json(await host.request(`/api/strategy/goals/${goal.goalId}/decomposition/publications?offset=2&limit=2`));
  assert.equal(page2.items.length, 1);

  // GSA Plan export works while authorized
  const gsaExp = await json(await host.request(`/api/strategy/goals/${goal.goalId}/gsa-plans/1/export`));
  assert.match(gsaExp.html, /总目标 GSA 计划表/);

  await host.close();

  // Rollback mode: --disable-goal-decomposition (goalDecompositionEnabled: false)
  // Existing schema 4 workspace & publications remain READABLE; new decomposition writes return 403 goal_decomposition_disabled
  const rollbackHost = await startTestHost({
    dataRoot: sharedRoot,
    projectsRoot,
    goalDecompositionEnabled: false,
  });
  hostsToClose.push(rollbackHost);

  const readWs = await json(await rollbackHost.request(`/api/strategy/goals/${goal.goalId}/workspace`));
  assert.equal(readWs.activePublicationVersion, 3);
  const readPub1 = await json(await rollbackHost.request(`/api/strategy/goals/${goal.goalId}/decomposition/publications/1`));
  assert.equal(readPub1.publication.version, 1);

  const blockedWrite = await json(await rollbackHost.request(`/api/strategy/goals/${goal.goalId}/decomposition/draft`, 'POST', validDraftInput(gsaPlan, rev)), 403);
  assert.equal(blockedWrite.code, 'goal_decomposition_disabled');

  await rollbackHost.close();

  // PROTOTYPE GAP #3: Permission revocation on enterprise-scoped goal blocks read, export, handoff, and checks at operation time
  const authBase = mkdtempSync(path.join(tmpdir(), 'optracall-gm-auth-'));
  const authRoot = path.join(authBase, 'data');
  const authProjects = path.join(authBase, 'projects');
  dirsToRemove.push(authBase);
  const authHost = await startTestHost({ dataRoot: authRoot, projectsRoot: authProjects });
  hostsToClose.push(authHost);

  // Create an enterprise scope in Studio, bind a goal to it, confirm GSA & publish v1, then revoke/archive or remove scope
  const ent = await json(await authHost.request('/api/studio/enterprises', 'POST', { name: '受限试点企业' }), 201);
  const entObj = ent.enterprise ?? ent;
  const entScope: GoalScope = { kind: 'enterprise', id: entObj.id, name: entObj.name };
  const entGoal = await createAndConfirmGoal(authHost, 120, '2027-01', entScope);
  const entDraft = await json(await authHost.request(`/api/strategy/goals/${entGoal.goal.goalId}/decomposition/draft`, 'POST', validDraftInput(entGoal.gsaPlan, 0)), 201);
  const entPrev = await json(await authHost.request(`/api/strategy/goals/${entGoal.goal.goalId}/decomposition/publish-preview`, 'POST', {
    gsaPlanId: entGoal.gsaPlan.planId,
    gsaPlanVersion: entGoal.gsaPlan.planVersion,
    gsaPlanSha256: entGoal.gsaPlan.contentSha256,
    draftRevision: entDraft.draft.revision,
    draftSha256: entDraft.draft.contentSha256,
    expectedActiveVersion: null,
  }));
  await json(await authHost.request(`/api/strategy/goals/${entGoal.goal.goalId}/decomposition/publish`, 'POST', {
    operationId: randomUUID(),
    gsaPlanId: entGoal.gsaPlan.planId,
    gsaPlanVersion: entGoal.gsaPlan.planVersion,
    gsaPlanSha256: entGoal.gsaPlan.contentSha256,
    draftRevision: entDraft.draft.revision,
    draftSha256: entDraft.draft.contentSha256,
    expectedActiveVersion: null,
    previewSha256: entPrev.previewSha256,
    reason: '企业目标发布',
  }), 201);

  // Revoke enterprise scope authorization (remove enterprise from enterprise-scopes/index.json so validateStrategyGoal fails closed)
  const scopesFile = path.join(authRoot, 'enterprise-scopes', 'index.json');
  assert.equal(existsSync(scopesFile), true, 'enterprise-scopes/index.json must exist before revocation');
  const rawScopes = JSON.parse(readFileSync(scopesFile, 'utf8'));
  rawScopes.enterprises = [];
  writeFileSync(scopesFile, JSON.stringify(rawScopes, null, 2));
  await authHost.close();

  const authHost2 = await startTestHost({ dataRoot: authRoot, projectsRoot: authProjects });
  hostsToClose.push(authHost2);

  // Every single operation-time read/export/handoff/check MUST fail closed (403/404/409), NEVER leak or fall back
  const rWs = await authHost2.request(`/api/strategy/goals/${entGoal.goal.goalId}/workspace`);
  assert.ok(rWs.status >= 400, `workspace must fail closed when scope revoked, got ${rWs.status}`);
  const rPub = await authHost2.request(`/api/strategy/goals/${entGoal.goal.goalId}/decomposition/publications/1`);
  assert.ok(rPub.status >= 400, `publication read must fail closed, got ${rPub.status}`);
  const rExp = await authHost2.request(`/api/strategy/goals/${entGoal.goal.goalId}/decomposition/publications/1/export`);
  assert.ok(rExp.status >= 400, `decomposition export must fail closed, got ${rExp.status}`);
  const rGsaExp = await authHost2.request(`/api/strategy/goals/${entGoal.goal.goalId}/gsa-plans/1/export`);
  assert.ok(rGsaExp.status >= 400, `GSA plan export must fail closed, got ${rGsaExp.status}`);
  const rHandoff = await authHost2.request(`/api/strategy/goals/${entGoal.goal.goalId}/decomposition/handoffs/preview`, 'POST', {
    publicationVersion: 1,
    rowId: 'row-online',
    checkpointId: 'cp-online-w2',
  });
  assert.ok(rHandoff.status >= 400, `project handoff preview must fail closed, got ${rHandoff.status}`);
});

test('Review regressions: child enterprise scope auth, scope-checked formal-sources/draft-estimates, percentage-points & non-adjacent consecutive checks, and child targetValue v2 revision', async t => {
  const host = await startTestHost();
  t.after(async () => { await host.close(); });

  // 1) formal-sources & draft-estimates reject unauthorized enterprise scope (P1 #2)
  const badSources = await json(await host.request('/api/strategy/goals/formal-sources?scopeKind=enterprise&scopeId=ent-unauthorized'), 409);
  assert.equal(badSources.code, 'strategy_goal_scope_unavailable');
  const badEstSave = await json(await host.request(`/api/strategy/goals/draft-estimates/${randomUUID()}`, 'POST', {
    scope: { kind: 'enterprise', id: 'ent-unauthorized', name: '未授权企业' },
    estimate: {
      metricKind: 'amount',
      unit: '万元',
      period: '2027-01',
      scopeDescription: '未授权企业',
      formalTargetValue: 100,
      estimatedValue: 90,
      gapValue: 10,
      basis: '测试',
      evidence: [{ category: 'internal', summary: '测试' }],
    },
  }), 409);
  assert.equal(badEstSave.code, 'strategy_goal_scope_unavailable');

  // 2) Child goal row targeting an unauthorized enterprise scope is blocked on preview & publish (P0 #2)
  const { goal, gsaPlan } = await createAndConfirmGoal(host, 120, '2027-01');
  const unauthChildDraft = validDraftInput(gsaPlan, 0);
  unauthChildDraft.rows[0]!.scope = { kind: 'enterprise', id: 'ent-nonexistent', name: '越权企业子目标' };
  const savedUnauth = await json(await host.request(`/api/strategy/goals/${goal.goalId}/decomposition/draft`, 'POST', unauthChildDraft), 201);
  const prevBlocked = await json(await host.request(`/api/strategy/goals/${goal.goalId}/decomposition/publish-preview`, 'POST', {
    gsaPlanId: gsaPlan.planId,
    gsaPlanVersion: gsaPlan.planVersion,
    gsaPlanSha256: gsaPlan.contentSha256,
    draftRevision: savedUnauth.draft.revision,
    draftSha256: savedUnauth.draft.contentSha256,
    expectedActiveVersion: null,
  }), 409);
  assert.equal(prevBlocked.code, 'strategy_goal_scope_unavailable');
  const pubBlocked = await json(await host.request(`/api/strategy/goals/${goal.goalId}/decomposition/publish`, 'POST', {
    operationId: randomUUID(),
    gsaPlanId: gsaPlan.planId,
    gsaPlanVersion: gsaPlan.planVersion,
    gsaPlanSha256: gsaPlan.contentSha256,
    draftRevision: savedUnauth.draft.revision,
    draftSha256: savedUnauth.draft.contentSha256,
    expectedActiveVersion: null,
    reason: '越权子目标发布应被阻断',
  }), 409);
  assert.equal(pubBlocked.code, 'strategy_goal_scope_unavailable');

  // 3) Valid publish v1, then modify linked child row targetValue -> publish v2 MUST revise child goal to v2 (P1 #6)
  const cleanDraft1 = validDraftInput(gsaPlan, savedUnauth.draft.revision);
  const d1 = await json(await host.request(`/api/strategy/goals/${goal.goalId}/decomposition/draft`, 'POST', cleanDraft1), 201);
  const pub1 = await json(await host.request(`/api/strategy/goals/${goal.goalId}/decomposition/publish`, 'POST', {
    operationId: randomUUID(),
    gsaPlanId: gsaPlan.planId,
    gsaPlanVersion: gsaPlan.planVersion,
    gsaPlanSha256: gsaPlan.contentSha256,
    draftRevision: d1.draft.revision,
    draftSha256: d1.draft.contentSha256,
    expectedActiveVersion: null,
    reason: 'v1 正常发布',
  }), 201);
  const onlineCommit1 = pub1.publication.committedGoals.find((c: { rowId: string }) => c.rowId === 'row-online');
  const storeCommit1 = pub1.publication.committedGoals.find((c: { rowId: string }) => c.rowId === 'row-store');
  assert.equal(onlineCommit1.version, 1);

  // Re-fetch workspace to get updated draft with linkedGoalId & changed targetValue (75 + 40 + 5 reserve = 120)
  const wsAfterV1 = await json(await host.request(`/api/strategy/goals/${goal.goalId}/workspace`));
  const rowsForV2 = wsAfterV1.draft.rows.map((r: Record<string, unknown>) =>
    r.rowId === 'row-online'
      ? { ...r, targetValue: 75, expectedGoalVersion: onlineCommit1.version, expectedAdoptedVersion: onlineCommit1.version }
      : r.rowId === 'row-store'
        ? { ...r, targetValue: 40, expectedGoalVersion: storeCommit1.version, expectedAdoptedVersion: storeCommit1.version }
        : r,
  );
  const d2 = await json(await host.request(`/api/strategy/goals/${goal.goalId}/decomposition/draft`, 'POST', {
    ...validDraftInput(gsaPlan, wsAfterV1.draft.revision),
    rows: rowsForV2,
  }), 201);
  const pub2 = await json(await host.request(`/api/strategy/goals/${goal.goalId}/decomposition/publish`, 'POST', {
    operationId: randomUUID(),
    gsaPlanId: gsaPlan.planId,
    gsaPlanVersion: gsaPlan.planVersion,
    gsaPlanSha256: gsaPlan.contentSha256,
    draftRevision: d2.draft.revision,
    draftSha256: d2.draft.contentSha256,
    expectedActiveVersion: 1,
    reason: 'v2 调整子目标 formalTargetValue',
  }), 201);
  const onlineCommit2 = pub2.publication.committedGoals.find((c: { rowId: string }) => c.rowId === 'row-online');
  assert.equal(onlineCommit2.version, 2, 'changing child row targetValue MUST create child goal v2');
  const goalsAfterV2 = await json(await host.request('/api/strategy/goals'));
  const onlineChildRecord = goalsAfterV2.goals.find((g: { id: string }) => g.id === onlineCommit2.goalId);
  assert.equal(onlineChildRecord.versions.length, 2);
  assert.equal(onlineChildRecord.versions[1].formalOrigin.targetValue, 75);

  // 4) percentage-points threshold uses absoluteDiff, and skipping a week (2027-W01 -> 2027-W03) does NOT trigger consecutive (P1 #4)
  await json(await host.request(`/api/strategy/goals/${goal.goalId}/decomposition/threshold`, 'POST', {
    configured: true,
    magnitudePct: 5,
    consecutivePeriods: 2,
    adverseDirection: 'below',
    unit: 'percentage-points',
  }));
  // Planned = 30, actual = 28 -> absoluteDiff = -2 (variancePct = -6.67%!). Under percentage-points threshold=5, -2 MUST NOT trigger magnitude!
  const ppW1 = await json(await host.request(`/api/strategy/goals/${goal.goalId}/decomposition/checks`, 'POST', {
    operationId: randomUUID(),
    publicationVersion: 2,
    rowId: 'row-online',
    checkpointId: 'cp-online-w2',
    periodGranularity: 'week',
    periodSequenceKey: '2027-W01',
    actualSource: { ref: 'pp-w1', label: 'W1 实绩', cutoffAt: '2027-01-07T23:59:59Z' },
    comparability: 'comparable',
    actualPeriods: [{ periodId: 'm1-w1', label: '第 1 周', actualValue: 28 }],
  }), 201);
  assert.equal(ppW1.check.trigger.triggered, false, 'percentage-points threshold=5 must compare absoluteDiff (-2), not variancePct (-6.67%)');

  // Skip W2 and submit W3 (non-adjacent!): absoluteDiff = -2 -> MUST NOT trigger consecutive=2!
  const ppW3 = await json(await host.request(`/api/strategy/goals/${goal.goalId}/decomposition/checks`, 'POST', {
    operationId: randomUUID(),
    publicationVersion: 2,
    rowId: 'row-online',
    checkpointId: 'cp-online-w2',
    periodGranularity: 'week',
    periodSequenceKey: '2027-W03',
    actualSource: { ref: 'pp-w3', label: 'W3 实绩（跳过W2）', cutoffAt: '2027-01-21T23:59:59Z' },
    comparability: 'comparable',
    actualPeriods: [{ periodId: 'm1-w1', label: '第 3 周', actualValue: 28 }],
  }), 201);
  assert.equal(ppW3.check.trigger.triggered, false, 'non-adjacent 2027-W01 -> 2027-W03 must NOT falsely trigger consecutive');

  // Now submit strictly adjacent W4 (2027-W03 -> 2027-W04): consecutive=2 MUST trigger!
  const ppW4 = await json(await host.request(`/api/strategy/goals/${goal.goalId}/decomposition/checks`, 'POST', {
    operationId: randomUUID(),
    publicationVersion: 2,
    rowId: 'row-online',
    checkpointId: 'cp-online-w2',
    periodGranularity: 'week',
    periodSequenceKey: '2027-W04',
    actualSource: { ref: 'pp-w4', label: 'W4 实绩（紧邻W3）', cutoffAt: '2027-01-28T23:59:59Z' },
    comparability: 'comparable',
    actualPeriods: [{ periodId: 'm1-w1', label: '第 4 周', actualValue: 28 }],
  }), 201);
  assert.equal(ppW4.check.trigger.triggered, true);
  assert.equal(ppW4.check.trigger.type, 'consecutive');
  assert.equal(ppW4.check.trigger.consecutiveCount, 2);

  // Now submit magnitude breach (-5 percentage points: 30 -> 25) -> MUST trigger magnitude!
  const ppMag = await json(await host.request(`/api/strategy/goals/${goal.goalId}/decomposition/checks`, 'POST', {
    operationId: randomUUID(),
    publicationVersion: 2,
    rowId: 'row-online',
    checkpointId: 'cp-online-w2',
    periodGranularity: 'week',
    periodSequenceKey: '2027-W05',
    actualSource: { ref: 'pp-w5', label: 'W5 实绩（达5百分点）', cutoffAt: '2027-02-04T23:59:59Z' },
    comparability: 'comparable',
    actualPeriods: [{ periodId: 'm1-w1', label: '第 5 周', actualValue: 25 }],
  }), 201);
  assert.equal(ppMag.check.trigger.triggered, true);
  assert.equal(ppMag.check.trigger.type, 'magnitude');
});

