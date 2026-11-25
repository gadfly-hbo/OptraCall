import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { makeNormalDraftPayload } from './fixtures/goal-decomposition-draft.ts';
import { startTestHost } from './fixtures/host-process.ts';
import { startToolProvider, providerMessageText } from './fixtures/tool-provider.ts';

const retailScope = { kind: 'department' as const, id: 'retail-dept', name: '零售事业部' };

async function json(response: Response, expected = 200): Promise<any> {
  const text = await response.clone().text();
  assert.equal(response.status, expected, `expected ${expected}, got ${response.status}: ${text}`);
  return JSON.parse(text);
}

test('GM01/GM02: 总 GSA 一次确认、缺 A 阻断、仅改上层 A 形成新计划版、目录不泄漏内部拆解状态', { timeout: 60_000 }, async t => {
  const host = await startTestHost();
  t.after(() => host.close());

  const { goal } = await json(await host.request('/api/strategy/goals', 'POST', {
    operationId: randomUUID(),
    title: '1 月净销售额达到 120 万元',
    outcome: '2027 年 1 月零售事业部净销售额达到 120 万元',
    perspective: 'profit',
    scope: retailScope,
    measurement: { kind: 'deliverable', criterion: '2027.01.01-01.31 净销售额（已支付商品金额 - 同归属期退款）达到 120 万元' },
    baseline: { state: 'known', description: '可比期 108 万元' },
    responsible: '林负责人',
    dueAt: '2027-01-31',
    strategies: ['新品增长与平台活动共同补足增量'],
    formalOrigin: { kind: 'manual-exception', reason: '尚无适用正式战略地图', period: '2027-01', targetValue: 120, unit: '万元', metricKind: 'amount' },
  }), 201);

  // Missing planned A cannot confirm GSA plan
  const badConfirm = await host.request(`/api/strategy/goals/${goal.goalId}/gsa-plan/confirm`, 'POST', {
    operationId: randomUUID(),
    expectedGoalVersion: 1,
    expectedAdoptedVersion: null,
    expectedPlanVersion: 0,
    plannedActions: [],
    decision: '尝试缺 A 确认',
  });
  assert.equal(badConfirm.status, 400);

  const incompleteAction = { id: 'PA-1', summary: '推进会员首购回访' };
  const gsaDraft = await json(await host.request(`/api/strategy/goals/${goal.goalId}/gsa-plan/draft`, 'POST', {
    goalVersion: 1, plannedActions: [incompleteAction], stageCheckpoints: [],
  }));
  assert.equal(gsaDraft.gsaDraft.plannedActions[0].summary, incompleteAction.summary);
  for (const plannedActions of [[incompleteAction], [{...incompleteAction, checkpoint: '试点首周'}]]) {
    const incomplete = await json(await host.request(`/api/strategy/goals/${goal.goalId}/gsa-plan/confirm`, 'POST', {
      operationId: randomUUID(), expectedGoalVersion: 1, expectedAdoptedVersion: null, expectedPlanVersion: 0,
      plannedActions, decision: '确认前核对',
    }), 400);
    assert.equal(incomplete.code, 'gsa_stage_checkpoint_required');
  }
  assert.equal((await json(await host.request(`/api/strategy/goals/${goal.goalId}/workspace`))).activeGsaPlan, null);

  // Confirm GSA atomically adopts candidate goal v1 + creates GSA plan v1 (planned-not-authorized)
  const confirmed1 = await json(await host.request(`/api/strategy/goals/${goal.goalId}/gsa-plan/confirm`, 'POST', {
    operationId: randomUUID(),
    expectedGoalVersion: 1,
    expectedAdoptedVersion: null,
    expectedPlanVersion: 0,
    plannedActions: [
      { id: 'PA-1', summary: '月初重点门店完成新品试点，观察可售货品与转化', checkpoint: '2027-01-07' },
      { id: 'PA-2', summary: '第 2 周核对活动期可比净销售额与增量依据', checkpoint: '2027-01-14' },
    ],
    stageCheckpoints: [{ id: 'CP-202701-W2-TOTAL', label: '第 2 周汇总检查点', targetDate: '2027-01-14', observationBasis: '全渠道可比净销售额' }],
    decision: '确认总目标 G、S 及上层计划 A，不授权实际经营执行',
  }), 201);
  assert.equal(confirmed1.goal.status, 'adopted');
  assert.equal(confirmed1.gsaPlan.planVersion, 1);
  assert.equal(confirmed1.gsaPlan.planKind, 'planned-not-authorized');
  assert.deepEqual(confirmed1.gsaPlan.goal, { goalId: goal.goalId, version: 1 });
  const originalAdoptedAt = confirmed1.goal.adoptedAt;

  // Updating ONLY upper-level planned A creates GSA plan v2 on the same GoalRef without rewriting historical adoption
  const confirmed2 = await json(await host.request(`/api/strategy/goals/${goal.goalId}/gsa-plan/confirm`, 'POST', {
    operationId: randomUUID(),
    expectedGoalVersion: 1,
    expectedAdoptedVersion: 1,
    expectedPlanVersion: 1,
    plannedActions: [
      { id: 'PA-1', summary: '月初重点门店完成新品试点，增加备货复核', checkpoint: '2027-01-07', observationBasis: '门店可售库存清单' },
      { id: 'PA-2', summary: '第 2 周核对活动期可比净销售额与增量依据', checkpoint: '2027-01-14' },
    ],
    decision: '仅调整上层计划 A，重确认新 GSA 计划版',
    supersedesReason: '增加备货复核检查点',
  }), 201);
  assert.equal(confirmed2.gsaPlan.planVersion, 2);
  assert.notEqual(confirmed2.gsaPlan.contentSha256, confirmed1.gsaPlan.contentSha256);
  assert.deepEqual(confirmed2.gsaPlan.goal, { goalId: goal.goalId, version: 1 });
  assert.equal(confirmed2.goal.adoptedAt, originalAdoptedAt);

  // Generic /api/strategy/goals index MUST NOT leak gsaPlans or decomposition internal fields
  const genericIndex = await json(await host.request('/api/strategy/goals'));
  assert.equal('gsaPlans' in genericIndex, false);
  assert.equal('decompositionDrafts' in genericIndex, false);
  assert.equal('decompositionPublications' in genericIndex, false);
  assert.equal('decompositionOperations' in genericIndex, false);

  // Zero Cases / Projects / Board authorizations created
  const casesRes = await host.request('/api/cases');
  if (casesRes.status === 200) {
    const casesList = await casesRes.json() as { cases: unknown[] };
    assert.equal(casesList.cases.length, 0);
  } else {
    assert.equal(casesRes.status, 503);
    const err = await casesRes.json() as { code: string };
    assert.equal(err.code, 'case_store_unavailable');
  }
  const projectsList = await json(await host.request('/api/projects'));
  assert.equal(projectsList.projects.length, 0);
});

test('GM06/GM09: 正常发布闭环（只读预览零写、原子提交正式子目标与关系、微调复用稳定 GoalRef、子目标并发 CAS 防覆盖）', { timeout: 60_000 }, async t => {
  const host = await startTestHost();
  t.after(() => host.close());

  const { goal } = await json(await host.request('/api/strategy/goals', 'POST', {
    operationId: randomUUID(),
    title: '1 月净销售额达到 120 万元',
    outcome: '1 月净销售额达到 120 万元',
    perspective: 'profit',
    scope: retailScope,
    measurement: { kind: 'deliverable', criterion: '1 月净销售额达到 120 万元' },
    baseline: { state: 'known', description: '可比期 108 万元' },
    responsible: '林负责人',
    dueAt: '2027-01-31',
    strategies: ['新品增长与平台活动共同补足增量'],
    formalOrigin: { kind: 'manual-exception', reason: '测试入口', period: '2027-01', targetValue: 120, unit: '万元', metricKind: 'amount' },
  }), 201);
  const { gsaPlan } = await json(await host.request(`/api/strategy/goals/${goal.goalId}/gsa-plan/confirm`, 'POST', {
    operationId: randomUUID(),
    expectedGoalVersion: 1, expectedAdoptedVersion: null, expectedPlanVersion: 0,
    plannedActions: [{ id: 'PA-1', summary: '第 2 周核对净销售额', checkpoint: '2027-01-14', observationBasis: 'POS 净销售报表' }],
    decision: '确认总目标 GSA',
  }), 201);

  // Invalid draft (reserve missing owner + gap only covers 7 of 8) saves as draft, but preview & publish reject
  const badDraft = await json(await host.request(`/api/strategy/goals/${goal.goalId}/decomposition/draft`, 'POST',
    makeNormalDraftPayload(gsaPlan, {
      reserves: [{ id: 'RES-01', amount: 5, unit: '万元', purpose: '新品上市预留', owner: '' }],
      gapStrategies: [{ id: 'GAP-01', name: '仅覆盖7万', strategy: '新品增量', expectedContribution: 7, unit: '万元', nonOverlappingScope: '非活动期', scopeKey: 's1', basis: '测算', kind: 'expected-increment' }],
    })), 201);
  assert.equal(badDraft.validation.ok, false);
  assert.ok(badDraft.validation.issues.some((i: any) => i.code === 'invalid_reserve'));
  assert.ok(badDraft.validation.issues.some((i: any) => i.code === 'gap_not_covered'));

  const rejectedPublish = await host.request(`/api/strategy/goals/${goal.goalId}/decomposition/publish`, 'POST', {
    operationId: randomUUID(),
    gsaPlanId: gsaPlan.planId, gsaPlanVersion: gsaPlan.planVersion, gsaPlanSha256: gsaPlan.contentSha256,
    draftRevision: badDraft.draft.revision, draftSha256: badDraft.draft.contentSha256, expectedActiveVersion: null,
  });
  assert.equal(rejectedPublish.status, 400);

  // Fix draft to valid 115 + 5 = 120 and 5 + 3 = 8
  const validDraft = await json(await host.request(`/api/strategy/goals/${goal.goalId}/decomposition/draft`, 'POST',
    makeNormalDraftPayload(gsaPlan, { expectedDraftRevision: badDraft.draft.revision })), 201);
  assert.equal(validDraft.validation.ok, true);

  // Read-only preview causes ZERO writes
  const preview = await json(await host.request(`/api/strategy/goals/${goal.goalId}/decomposition/publish-preview`, 'POST', {
    gsaPlanId: gsaPlan.planId, gsaPlanVersion: gsaPlan.planVersion, gsaPlanSha256: gsaPlan.contentSha256,
    draftRevision: validDraft.draft.revision, draftSha256: validDraft.draft.contentSha256, expectedActiveVersion: null,
  }));
  assert.equal(preview.ok, true);
  assert.equal(preview.nextPublicationVersion, 1);
  assert.equal(preview.committedGoals.length, 4);
  const wsBeforePublish = await json(await host.request(`/api/strategy/goals/${goal.goalId}/workspace`));
  assert.equal(wsBeforePublish.publications.length, 0);
  assert.equal(wsBeforePublish.activePublicationVersion, null);

  // Formal publish v1 atomically commits publication + 4 adopted child goals + 4 relations + receipt
  const pubOp1 = randomUUID();
  const published1 = await json(await host.request(`/api/strategy/goals/${goal.goalId}/decomposition/publish`, 'POST', {
    operationId: pubOp1, previewSha256: preview.previewSha256,
    gsaPlanId: gsaPlan.planId, gsaPlanVersion: gsaPlan.planVersion, gsaPlanSha256: gsaPlan.contentSha256,
    draftRevision: validDraft.draft.revision, draftSha256: validDraft.draft.contentSha256, expectedActiveVersion: null,
    reason: '首次拆解发布',
  }), 201);
  assert.equal(published1.publication.version, 1);
  assert.equal(published1.publication.committedGoals.length, 4);
  assert.equal(published1.publication.committedRelations.length, 4);
  // Reserve is NOT adopted as a goal! Only 1 parent + 4 committed child goals = 5 total goals
  const indexAfterPub1 = await json(await host.request('/api/strategy/goals'));
  assert.equal(indexAfterPub1.goals.length, 5);
  assert.equal(indexAfterPub1.relations.length, 4);
  for (const ref of published1.publication.committedGoals) {
    const child = indexAfterPub1.goals.find((g: any) => g.id === ref.goalId);
    assert.ok(child);
    assert.equal(child.adoptedVersion, 1);
  }

  // Micro-revision: shift week plan by 2 weeks without changing G/S/A -> v2 reuses exact child GoalIds!
  const wsAfterPub1 = await json(await host.request(`/api/strategy/goals/${goal.goalId}/workspace`));
  // Re-sending stable responsibility rows from the Agent preserves each published child binding.
  const revisedRows = wsAfterPub1.draft.rows.map(({ linkedGoalId, expectedGoalVersion, expectedAdoptedVersion, ...row }: any) => row);
  const draftV2 = await json(await host.request(`/api/strategy/goals/${goal.goalId}/decomposition/draft`, 'POST',
    makeNormalDraftPayload(gsaPlan, {
      expectedDraftRevision: wsAfterPub1.draft.revision,
      rows: revisedRows,
      timePlan: [
        { periodId: 'W1', granularity: 'week', label: '第 1 周', startDate: '2027-01-01', endDate: '2027-01-07', targetValue: 20, unit: '万元', status: 'planned', checkpointId: 'CP-202701-W1-TOTAL', constraintNote: '新品延后两周' },
        { periodId: 'W2', granularity: 'week', label: '第 2 周', startDate: '2027-01-08', endDate: '2027-01-14', targetValue: 25, unit: '万元', status: 'planned', checkpointId: 'CP-202701-W2-TOTAL', constraintNote: '新品延后两周' },
        { periodId: 'W3', granularity: 'week', label: '第 3 周', startDate: '2027-01-15', endDate: '2027-01-21', targetValue: 40, unit: '万元', status: 'planned', checkpointId: 'CP-202701-W3-TOTAL' },
        { periodId: 'W4', granularity: 'week', label: '第 4 周', startDate: '2027-01-22', endDate: '2027-01-31', targetValue: 30, unit: '万元', status: 'planned', checkpointId: 'CP-202701-W4-TOTAL' },
      ],
    })), 201);

  const v2Basis = {
    gsaPlanId: gsaPlan.planId, gsaPlanVersion: gsaPlan.planVersion, gsaPlanSha256: gsaPlan.contentSha256,
    draftRevision: draftV2.draft.revision, draftSha256: draftV2.draft.contentSha256, expectedActiveVersion: 1,
  };
  assert.deepEqual(draftV2.draft.rows.filter((r: any) => r.commitAsGoal).map((r: any) => r.linkedGoalId),
    published1.publication.committedGoals.map((g: any) => g.goalId));
  const noPreview = await host.request(`/api/strategy/goals/${goal.goalId}/decomposition/publish`, 'POST', { ...v2Basis, operationId: randomUUID() });
  assert.equal(noPreview.status, 409);
  const v2Preview = await json(await host.request(`/api/strategy/goals/${goal.goalId}/decomposition/publish-preview`, 'POST', v2Basis));
  const published2 = await json(await host.request(`/api/strategy/goals/${goal.goalId}/decomposition/publish`, 'POST', {
    operationId: randomUUID(),
    ...v2Basis, previewSha256: v2Preview.previewSha256,
    reason: '新品延后两周，仅微调周计划',
  }), 201);
  assert.equal(published2.publication.version, 2);
  assert.deepEqual(
    published2.publication.committedGoals.map((g: any) => g.goalId),
    published1.publication.committedGoals.map((g: any) => g.goalId),
    'micro-revision reuses stable child GoalIds',
  );
  // v1 remains immutable with original week 2 = 30, while v2 has week 2 = 25
  const readV1 = await json(await host.request(`/api/strategy/goals/${goal.goalId}/decomposition/publications/1`));
  const readV2 = await json(await host.request(`/api/strategy/goals/${goal.goalId}/decomposition/publications/2`));
  assert.equal(readV1.publication.snapshot.timePlan[1].targetValue, 30);
  assert.equal(readV2.publication.snapshot.timePlan[1].targetValue, 25);

  // A separate edit to a previously published relation invalidates the exact preview.
  const afterV2 = await json(await host.request(`/api/strategy/goals/${goal.goalId}/workspace`));
  const unpinned = await json(await host.request(`/api/strategy/goals/${goal.goalId}/decomposition/draft`, 'POST',
    makeNormalDraftPayload(gsaPlan, {
      expectedDraftRevision: afterV2.draft.revision,
      rows: afterV2.draft.rows.map(({ expectedGoalVersion, expectedAdoptedVersion, ...row }: any) => row),
    })), 201);
  const previewBasis = {
    gsaPlanId: gsaPlan.planId, gsaPlanVersion: gsaPlan.planVersion, gsaPlanSha256: gsaPlan.contentSha256,
    draftRevision: unpinned.draft.revision, draftSha256: unpinned.draft.contentSha256, expectedActiveVersion: 2,
  };
  const previewBeforeEdit = await json(await host.request(`/api/strategy/goals/${goal.goalId}/decomposition/publish-preview`, 'POST', previewBasis));
  const originalRelation = indexAfterPub1.relations[0];
  await json(await host.request(`/api/strategy/relations/${originalRelation.id}/revisions`, 'POST', {
    ...originalRelation, operationId: randomUUID(), expectedRevision: originalRelation.revision,
    responsibility: '原目标页另行确认的贡献责任',
  }), 201);
  const staleRelationPublish = await host.request(`/api/strategy/goals/${goal.goalId}/decomposition/publish`, 'POST', {
    ...previewBasis, operationId: randomUUID(), previewSha256: previewBeforeEdit.previewSha256,
  });
  assert.equal(staleRelationPublish.status, 409, 'relation changed after preview, publication must be rejected');
  const afterRelationConflict = await json(await host.request(`/api/strategy/goals/${goal.goalId}/workspace`));
  assert.equal(afterRelationConflict.activePublicationVersion, 2);
  const refreshedPreview = await json(await host.request(`/api/strategy/goals/${goal.goalId}/decomposition/publish-preview`, 'POST', previewBasis));
  assert.notEqual(refreshedPreview.previewSha256, previewBeforeEdit.previewSha256);
  assert.equal(refreshedPreview.committedGoals[0].relations[0].revision, originalRelation.revision + 1);

  // Concurrent external modification on a child goal triggers row-level CAS conflict on next publish!
  const firstChildRef = published2.publication.committedGoals[0];
  const firstChildGoal = (await json(await host.request(`/api/strategy/goals/${firstChildRef.goalId}`))).goal;
  await json(await host.request(`/api/strategy/goals/${firstChildRef.goalId}/revisions`, 'POST', {
    operationId: randomUUID(),
    expectedVersion: firstChildGoal.currentVersion,
    ...firstChildGoal.versions.at(-1),
    outcome: '原目标页并发修改了子目标说明',
  }), 201);
  const staleChildPublish = await host.request(`/api/strategy/goals/${goal.goalId}/decomposition/publish`, 'POST', {
    ...previewBasis, operationId: randomUUID(), previewSha256: refreshedPreview.previewSha256,
  });
  assert.equal(staleChildPublish.status, 409, 'exact preview protects linked children even without optional row expectations');
  const draftV3 = await json(await host.request(`/api/strategy/goals/${goal.goalId}/decomposition/draft`, 'POST',
    makeNormalDraftPayload(gsaPlan, {
      expectedDraftRevision: unpinned.draft.revision,
      rows: revisedRows.map((r: any, idx: number) => idx === 0 ? { ...r, expectedGoalVersion: firstChildGoal.currentVersion, outcome: '拆解表尝试覆盖' } : r),
    })), 201);
  const casConflict = await host.request(`/api/strategy/goals/${goal.goalId}/decomposition/publish`, 'POST', {
    operationId: randomUUID(),
    gsaPlanId: gsaPlan.planId, gsaPlanVersion: gsaPlan.planVersion, gsaPlanSha256: gsaPlan.contentSha256,
    draftRevision: draftV3.draft.revision, draftSha256: draftV3.draft.contentSha256, expectedActiveVersion: 2,
  });
  assert.equal(casConflict.status, 409);
});

test('GM07: 交叉冲突（两视图各含预留均为 120 万，但 50/45、30/35 两格冲突阻断发布，人工确认对齐后重汇总发布）', { timeout: 60_000 }, async t => {
  const host = await startTestHost();
  t.after(() => host.close());

  const { goal } = await json(await host.request('/api/strategy/goals', 'POST', {
    operationId: randomUUID(),
    title: '1 月净销售额达到 120 万元',
    outcome: '1 月净销售额达到 120 万元',
    perspective: 'profit',
    scope: retailScope,
    measurement: { kind: 'deliverable', criterion: '1 月净销售额达到 120 万元' },
    baseline: { state: 'known', description: '可比期 108 万元' },
    responsible: '林负责人',
    dueAt: '2027-01-31',
    strategies: ['新品增长与平台活动共同补足增量'],
    formalOrigin: { kind: 'manual-exception', reason: '交叉冲突测试', period: '2027-01', targetValue: 120, unit: '万元', metricKind: 'amount' },
  }), 201);
  const { gsaPlan } = await json(await host.request(`/api/strategy/goals/${goal.goalId}/gsa-plan/confirm`, 'POST', {
    operationId: randomUUID(),
    expectedGoalVersion: 1, expectedAdoptedVersion: null, expectedPlanVersion: 0,
    plannedActions: [{ id: 'PA-1', summary: '第 2 周核对净销售额', checkpoint: '第 2 周', observationBasis: 'POS 净销售报表' }],
    decision: '确认 GSA',
  }), 201);

  const conflictDraft = await json(await host.request(`/api/strategy/goals/${goal.goalId}/decomposition/draft`, 'POST',
    makeNormalDraftPayload(gsaPlan, {
      views: [
        {
          viewId: 'channel-view', viewName: '渠道计划', metricId: 'net-sales-v2', period: '2027-01', coverageScope: 'retail-all', reserveIncluded: 5,
          cells: [
            { crossCellId: 'offline:down-jacket', label: '线下 × 羽绒服', value: 50, unit: '万元', basis: '门店目标表 r4' },
            { crossCellId: 'online:down-jacket', label: '线上 × 羽绒服', value: 30, unit: '万元', basis: '门店目标表 r4' },
            { crossCellId: 'online:knitwear', label: '线上 × 针织', value: 20, unit: '万元', basis: '门店目标表 r4' },
            { crossCellId: 'offline:knitwear', label: '线下 × 针织', value: 15, unit: '万元', basis: '门店目标表 r4' },
          ],
        },
        {
          viewId: 'category-view', viewName: '商品计划', metricId: 'net-sales-v2', period: '2027-01', coverageScope: 'retail-all', reserveIncluded: 5,
          cells: [
            { crossCellId: 'offline:down-jacket', label: '线下 × 羽绒服', value: 45, unit: '万元', basis: '商品配置表 r3' },
            { crossCellId: 'online:down-jacket', label: '线上 × 羽绒服', value: 35, unit: '万元', basis: '商品配置表 r3' },
            { crossCellId: 'online:knitwear', label: '线上 × 针织', value: 20, unit: '万元', basis: '商品配置表 r3' },
            { crossCellId: 'offline:knitwear', label: '线下 × 针织', value: 15, unit: '万元', basis: '商品配置表 r3' },
          ],
        },
      ],
    })), 201);

  assert.equal(conflictDraft.validation.ok, false);
  const conflicts = conflictDraft.validation.issues.filter((i: any) => i.code === 'cross_view_conflict');
  assert.equal(conflicts.length, 2, 'must report BOTH 50/45 and 30/35 cross conflicts');
  assert.ok(conflicts.some((c: any) => c.crossCellId === 'offline:down-jacket'));
  assert.ok(conflicts.some((c: any) => c.crossCellId === 'online:down-jacket'));

  // Direct Host publish MUST be rejected
  const blocked = await host.request(`/api/strategy/goals/${goal.goalId}/decomposition/publish`, 'POST', {
    operationId: randomUUID(),
    gsaPlanId: gsaPlan.planId, gsaPlanVersion: gsaPlan.planVersion, gsaPlanSha256: gsaPlan.contentSha256,
    draftRevision: conflictDraft.draft.revision, draftSha256: conflictDraft.draft.contentSha256, expectedActiveVersion: null,
  });
  assert.equal(blocked.status, 400);

  // Aligning only ONE cell (leaving online:down-jacket conflicted) still keeps publish blocked!
  const partialAlign = await json(await host.request(`/api/strategy/goals/${goal.goalId}/decomposition/align`, 'POST', {
    operationId: randomUUID(),
    gsaPlanId: gsaPlan.planId, gsaPlanVersion: gsaPlan.planVersion, gsaPlanSha256: gsaPlan.contentSha256,
    expectedDraftRevision: conflictDraft.draft.revision,
    alignedBy: '林负责人',
    basis: '仅修改第一格',
    cellUpdates: [{ crossCellId: 'offline:down-jacket', value: 45 }],
  }), 200);
  assert.equal(partialAlign.validation.ok, false);

  // Full human-confirmed alignment (45 + 35 + 20 + 15 + 5 = 120) resolves both cells cleanly and allows publish
  const fullAlign = await json(await host.request(`/api/strategy/goals/${goal.goalId}/decomposition/align`, 'POST', {
    operationId: randomUUID(),
    gsaPlanId: gsaPlan.planId, gsaPlanVersion: gsaPlan.planVersion, gsaPlanSha256: gsaPlan.contentSha256,
    expectedDraftRevision: partialAlign.draft.revision,
    alignedBy: '林负责人',
    basis: '商品与渠道负责人协商采用 45/35 完整方案（商品配置表 r3）',
    cellUpdates: [
      { crossCellId: 'offline:down-jacket', value: 45 },
      { crossCellId: 'online:down-jacket', value: 35 },
    ],
  }), 200);
  assert.equal(fullAlign.validation.ok, true);
  assert.equal(fullAlign.draft.alignmentRecord.basis, '商品与渠道负责人协商采用 45/35 完整方案（商品配置表 r3）');

  const alignedBasis = {
    gsaPlanId: gsaPlan.planId, gsaPlanVersion: gsaPlan.planVersion, gsaPlanSha256: gsaPlan.contentSha256,
    draftRevision: fullAlign.draft.revision, draftSha256: fullAlign.draft.contentSha256, expectedActiveVersion: null,
  };
  const alignedPreview = await json(await host.request(`/api/strategy/goals/${goal.goalId}/decomposition/publish-preview`, 'POST', alignedBasis));
  const published = await json(await host.request(`/api/strategy/goals/${goal.goalId}/decomposition/publish`, 'POST', {
    operationId: randomUUID(),
    ...alignedBasis, previewSha256: alignedPreview.previewSha256,
  }), 201);
  assert.equal(published.publication.version, 1);
  assert.equal(published.publication.snapshot.rows.find((r: any) => r.crossCellId === 'offline:down-jacket').targetValue, 45);
  assert.equal(published.publication.snapshot.rows.find((r: any) => r.crossCellId === 'online:down-jacket').targetValue, 35);
});

test('GM08/GM13: 真实失答与跨重启三态恢复（已落盘回原版、查不到保持未知、可证明未提交才显式同号重试、同号异内容 409）', { timeout: 60_000 }, async t => {
  const host1 = await startTestHost();
  const dataRoot = host1.dataRoot;
  const projectsRoot = host1.projectsRoot;

  const { goal } = await json(await host1.request('/api/strategy/goals', 'POST', {
    operationId: randomUUID(),
    title: '失答恢复测试目标',
    outcome: '1 月净销售额达到 120 万元',
    perspective: 'profit',
    scope: retailScope,
    measurement: { kind: 'deliverable', criterion: '1 月净销售额达到 120 万元' },
    baseline: { state: 'known', description: '可比期 108 万元' },
    responsible: '林负责人',
    dueAt: '2027-01-31',
    strategies: ['新品增长与平台活动'],
    formalOrigin: { kind: 'manual-exception', reason: '失答测试', period: '2027-01', targetValue: 120, unit: '万元', metricKind: 'amount' },
  }), 201);
  const { gsaPlan } = await json(await host1.request(`/api/strategy/goals/${goal.goalId}/gsa-plan/confirm`, 'POST', {
    operationId: randomUUID(),
    expectedGoalVersion: 1, expectedAdoptedVersion: null, expectedPlanVersion: 0,
    plannedActions: [{ id: 'PA-1', summary: '第 2 周核对净销售额', checkpoint: '第 2 周', observationBasis: 'POS 净销售报表' }],
    decision: '确认 GSA',
  }), 201);
  const { draft } = await json(await host1.request(`/api/strategy/goals/${goal.goalId}/decomposition/draft`, 'POST', makeNormalDraftPayload(gsaPlan)), 201);

  // Unknown operationId query MUST return unknown / retryable: false
  const missingOpId = randomUUID();
  const missingLookup = await json(await host1.request(`/api/strategy/goals/${goal.goalId}/decomposition/operations/${missingOpId}`));
  assert.equal(missingLookup.found, false);
  assert.equal(missingLookup.status, 'unknown');
  assert.equal(missingLookup.retryable, false);

  // Commit v1 with op1, then restart Host (simulating response lost + server restart)
  const op1 = randomUUID();
  const publishBasis = {
    gsaPlanId: gsaPlan.planId, gsaPlanVersion: gsaPlan.planVersion, gsaPlanSha256: gsaPlan.contentSha256,
    draftRevision: draft.revision, draftSha256: draft.contentSha256, expectedActiveVersion: null,
  };
  const publishPreview = await json(await host1.request(`/api/strategy/goals/${goal.goalId}/decomposition/publish-preview`, 'POST', publishBasis));
  const pubPayload = {
    operationId: op1,
    ...publishBasis, previewSha256: publishPreview.previewSha256,
    reason: '首次发布',
  };
  await json(await host1.request(`/api/strategy/goals/${goal.goalId}/decomposition/publish`, 'POST', pubPayload), 201);
  await host1.close();

  // Restart Host on the same dataRoot
  const host2 = await startTestHost({ dataRoot, projectsRoot });
  t.after(() => host2.close());

  // Read-only recovery lookup returns committed v1
  const recovered = await json(await host2.request(`/api/strategy/goals/${goal.goalId}/decomposition/operations/${op1}`));
  assert.equal(recovered.found, true);
  assert.equal(recovered.status, 'committed');
  assert.equal(recovered.publication.version, 1);

  // Same operationId + different content -> 409 conflict
  const conflict = await host2.request(`/api/strategy/goals/${goal.goalId}/decomposition/publish`, 'POST', {
    ...pubPayload,
    reason: '篡改的不同内容',
  });
  assert.equal(conflict.status, 409);

  // Same operationId + same content -> returns original v1 without creating v2
  const idempotent = await json(await host2.request(`/api/strategy/goals/${goal.goalId}/decomposition/publish`, 'POST', pubPayload), 200);
  assert.equal(idempotent.publication.version, 1);
  const ws = await json(await host2.request(`/api/strategy/goals/${goal.goalId}/workspace`));
  assert.equal(ws.publications.length, 1);
});

test('B2/B3 (GM03-05/13): 真实 Host→统一 Pi 1.4.0→合成 Provider→真实 forecast.py 工具→草稿与 A 改版迟到写入拦截', { timeout: 150_000 }, async t => {
  const provider = await startToolProvider();
  t.after(() => provider.close());
  const host = await startTestHost();
  t.after(() => host.close());

  await json(await host.request('/api/configuration', 'PUT', {
    name: '目标拆解合成', provider: 'openai-compatible', baseUrl: provider.baseUrl, model: 'synthetic-goal-decomp', apiKey: 'synthetic-key',
  }));

  // 1. Pre-confirmation goal-draft owner with analysisVariant='goal-estimate' runs real target-forecast/forecast.py!
  const goldenInput = JSON.parse(await readFile(path.resolve(process.cwd(), 'extensions/analysis-assets/target-forecast/scripts/golden/engine-expected.json'), 'utf8')).input;
  const draftOwner = { role: 'goal-draft', draftId: randomUUID(), scope: retailScope, analysisVariant: 'goal-estimate' };
  const draftOwnerParam = encodeURIComponent(JSON.stringify(draftOwner));
  let scriptResultText = '';
  provider.setResponder((ctx: any) => {
    const step = ctx.recentToolResults.length;
    if (step === 0) return { calls: [{ name: 'strategy_goals', arguments: { action: 'goal-read-skill', skill: 'target-forecast' } }] };
    if (step === 1) return { calls: [{ name: 'strategy_goals', arguments: { action: 'goal-run-script', skill: 'target-forecast', script: 'forecast.py', command: 'run', scriptInput: goldenInput } }] };
    if (step === 2) {
      scriptResultText = providerMessageText(ctx.recentToolResults[1].content);
      return {
        calls: [{
          name: 'strategy_goals',
          arguments: {
            action: 'goal-save-estimate',
            estimate: {
              metricKind: 'amount', unit: '万元', period: '2027-01', scopeDescription: '零售事业部',
              formalTargetValue: 120, estimatedValue: 112, gapValue: 8,
              basis: '基于 target-forecast 脚本情景测算与经营假设',
              evidence: [{ category: 'internal', summary: 'target-forecast 实算回执' }],
            },
          },
        }],
      };
    }
    return { text: '已完成确认前可达性测算，未提前采用目标。' };
  });
  await json(await host.request(`/api/business-role?owner=${draftOwnerParam}&action=messages`, 'POST', {
    requestId: randomUUID(), text: '请先测算 1 月净销售额可达值。', expectedRevision: 0,
  }), 202);
  let draftDetail: any;
  for (let i = 0; i < 400; i++) {
    draftDetail = await json(await host.request(`/api/business-role?owner=${draftOwnerParam}`));
    if (!draftDetail.busy && draftDetail.discussion?.lastRun?.status === 'completed') break;
    await delay(25);
  }
  assert.equal(draftDetail.discussion.lastRun.status, 'completed');
  assert.match(scriptResultText, /optracall-forecast-2/, 'real target-forecast engine ran inside isolated goal workspace');
  const savedEstimate = await json(await host.request(`/api/strategy/goals/draft-estimates/${draftOwner.draftId}`));
  assert.equal(savedEstimate.estimate.estimatedValue, 112);

  // 2. Post-confirmation goal owner with analysisVariant='goal-decomposition' generates draft via real Pi tool
  const { goal } = await json(await host.request('/api/strategy/goals', 'POST', {
    operationId: randomUUID(),
    title: 'Pi 实测拆解目标', outcome: '1 月净销售额达到 120 万元', perspective: 'profit', scope: retailScope,
    measurement: { kind: 'deliverable', criterion: '1 月净销售额 120 万元' },
    baseline: { state: 'known', description: '可比期 108 万元' },
    responsible: '林负责人', dueAt: '2027-01-31', strategies: ['新品与平台活动'],
    formalOrigin: { kind: 'manual-exception', reason: 'Pi 测试', period: '2027-01', targetValue: 120, unit: '万元', metricKind: 'amount' },
  }), 201);
  // A bound forecast receives the exact candidate, and a later version cannot inherit its estimate.
  const estimateGoalInput = {title:'二月线上目标', outcome:'线上流水达标', perspective:'profit', scope:retailScope,
    measurement:{kind:'deliverable', criterion:'线上流水净额'}, baseline:{state:'known',description:'去年基线'}, responsible:'负责人',
    strategies:['提升复购'], formalOrigin:{kind:'manual-exception',reason:'尚未发布战略',period:'2027-02',targetValue:120,metricKind:'amount',unit:'万元'}};
  const bound = (await json(await host.request('/api/strategy/goals','POST',{operationId:randomUUID(),...estimateGoalInput}),201)).goal;
  const boundOwner = (version: number) => ({role:'goal-draft',draftId:bound.goalId,scope:retailScope,analysisVariant:'goal-estimate',
    goalRef:{goalId:bound.goalId,version}});
  const forecastUrl = (owner: any) => '/api/business-role?owner='+encodeURIComponent(JSON.stringify(owner));
  const forecastApi = '/api/strategy/goals/draft-estimates/'+bound.goalId;
  const forecast = {...savedEstimate.estimate,period:'2027-02'};
  let forecastContext = '';
  provider.setResponder((ctx: any) => {
    if (!ctx.recentToolResults.length) return {calls:[{name:'strategy_goals',arguments:{action:'goal-read-context'}}]};
    if (ctx.recentToolResults.length===1) {
      forecastContext=providerMessageText(ctx.recentToolResults[0].content);
      return {calls:[{name:'strategy_goals',arguments:{action:'goal-save-estimate',estimate:forecast}}]};
    }
    return {text:'测算已留存'};
  });
  const initialOwner=boundOwner(1);
  const firstForecast=forecastUrl(initialOwner);
  await json(await host.request(firstForecast+'&action=messages','POST',{requestId:randomUUID(),text:'按准确 v1 先测算。',expectedRevision:0}),202);
  for(let i=0;i<400;i++){
    const detail=await json(await host.request(firstForecast));
    if(!detail.busy && detail.discussion?.lastRun?.status==='completed') break;
    await delay(25);
  }
  assert.match(forecastContext,/二月线上目标/);
  assert.match(forecastContext,/线上流水净额/);
  assert.match(forecastContext,/2027-02/);
  const firstSaved=await json(await host.request(forecastApi+'?goalVersion=1'));
  assert.deepEqual(firstSaved.estimateRecord.goalRef,initialOwner.goalRef);
  assert.equal(firstSaved.estimate.estimatedValue,112);
  assert.equal((await json(await host.request(forecastApi))).estimate,null);
  const {goal:revisedBound}=await json(await host.request('/api/strategy/goals/'+bound.goalId+'/revisions','POST',{
    operationId:randomUUID(),expectedVersion:1,...estimateGoalInput,formalOrigin:{...estimateGoalInput.formalOrigin,targetValue:110}
  }),201);
  assert.equal(revisedBound.version,2);
  assert.equal((await json(await host.request(forecastApi+'?goalVersion=2'))).estimate,null);
  const staleWrite=await host.request(forecastApi,'POST',{scope:retailScope,goalRef:initialOwner.goalRef,estimate:forecast});
  assert.equal(staleWrite.status,409);
  const wrongScope={...retailScope,id:'other-unit'};
  assert.ok(!(await host.request(forecastUrl({...boundOwner(2),scope:wrongScope}))).ok);
  assert.ok(!(await host.request(forecastApi,'POST',{scope:wrongScope,goalRef:boundOwner(2).goalRef,estimate:forecast})).ok);
  assert.equal((await host.request(forecastApi,'POST',{scope:retailScope,goalRef:boundOwner(2).goalRef,estimate:forecast})).status,409);
  const currentForecast=await json(await host.request(forecastApi,'POST',{scope:retailScope,goalRef:boundOwner(2).goalRef,
    estimate:{...forecast,formalTargetValue:110,gapValue:-2}}),201);
  assert.equal(currentForecast.estimate.formalTargetValue,110);
  assert.equal((await json(await host.request(forecastApi+'?goalVersion=1'))).estimate.formalTargetValue,120);

  const { gsaPlan } = await json(await host.request(`/api/strategy/goals/${goal.goalId}/gsa-plan/confirm`, 'POST', {
    operationId: randomUUID(),
    expectedGoalVersion: 1, expectedAdoptedVersion: null, expectedPlanVersion: 0,
    plannedActions: [{ id: 'PA-1', summary: '第 2 周核对净销售额', checkpoint: '第 2 周', observationBasis: 'POS 净销售报表' }],
    decision: '确认 GSA',
  }), 201);

  const goalOwner = { role: 'goal', goalId: goal.goalId, version: 1, analysisVariant: 'goal-decomposition' };
  const goalOwnerParam = encodeURIComponent(JSON.stringify(goalOwner));
  const draftPayload = makeNormalDraftPayload(gsaPlan);
  provider.setResponder((ctx: any) => {
    const step = ctx.recentToolResults.length;
    if (step === 0) return { calls: [{ name: 'strategy_goals', arguments: { action: 'goal-read-context' } }] };
    if (step === 1) {
      return {
        calls: [{
          name: 'strategy_goals',
          arguments: {
            action: 'goal-save-decomposition-draft',
            expectedDraftRevision: 0,
            gsaPlanId: gsaPlan.planId,
            gsaPlanVersion: gsaPlan.planVersion,
            gsaPlanSha256: gsaPlan.contentSha256,
            estimate: draftPayload.estimate,
            rows: draftPayload.rows,
            reserves: draftPayload.reserves,
            gapStrategies: draftPayload.gapStrategies,
            views: draftPayload.views,
            timePlan: draftPayload.timePlan,
          },
        }],
      };
    }
    return { text: '已生成目标拆解草稿（115 分配 + 5 预留 = 120 万），等待负责人核对发布。' };
  });
  await json(await host.request(`/api/business-role?owner=${goalOwnerParam}&action=messages`, 'POST', {
    requestId: randomUUID(), text: '请按渠道和品类拆解 120 万目标并排周计划。', expectedRevision: 0,
  }), 202);
  let goalDetail: any;
  for (let i = 0; i < 400; i++) {
    goalDetail = await json(await host.request(`/api/business-role?owner=${goalOwnerParam}`));
    if (!goalDetail.busy && goalDetail.discussion?.lastRun?.status === 'completed') break;
    await delay(25);
  }
  assert.equal(goalDetail.discussion.lastRun.status, 'completed');
  const ws = await json(await host.request(`/api/strategy/goals/${goal.goalId}/workspace`));
  assert.equal(ws.draft.revision, 1);
  assert.equal(ws.draft.updatedBy, 'agent');
  assert.equal(ws.validation.ok, true);
  assert.equal(ws.publications.length, 0, 'Agent tool MUST NOT auto-publish');
  const basePath = `/api/strategy/goals/${goal.goalId}/decomposition`;
  const intent = {gsaPlanId: gsaPlan.planId, gsaPlanVersion: gsaPlan.planVersion, gsaPlanSha256: gsaPlan.contentSha256,
    draftRevision: ws.draft.revision, draftSha256: ws.draft.contentSha256, expectedActiveVersion: null};
  const preview = await json(await host.request(basePath + '/publish-preview', 'POST', intent));
  await json(await host.request(basePath + '/publish', 'POST', {...intent, operationId: randomUUID(), previewSha256: preview.previewSha256, reason:'负责人确认发布'}), 201);
  const period = ws.draft.timePlan[0];
  const basis = {metric:goal.measurement.criterion, unit:'万元', scope:ws.draft.estimate.scopeDescription, periodId:period.periodId, coverage:'partial', maturity:'closed'};
  const reportText = `${basis.metric}｜${basis.scope}｜${period.periodId}部门实际27万元；已关账，缺两个门店。`;
  const input = {operationId:randomUUID(), publicationVersion:1, rowId:'G-TOTAL', checkpointId:period.checkpointId ?? period.periodId,
    actualSource:{ref:'pos-frozen-r2',label:'POS 实绩',cutoffAt:period.endDate,reportText},
    actualPeriods:[{periodId:period.periodId,actualValue:null}]};
  const {actual} = await json(await host.request(basePath + '/actuals','POST',input),201);
  const replay = await json(await host.request(basePath + '/actuals','POST',input),201);
  assert.equal(replay.actual.actualId,actual.actualId);
  assert.equal((await host.request(basePath + '/actuals','POST',{...input,actualPeriods:[{periodId:period.periodId,actualValue:31}]})).status,409);
  assert.equal((await json(await host.request(`/api/strategy/goals/${goal.goalId}/workspace`))).checks.length,0);
  assert.equal((await host.request(basePath + '/checks','POST',{...input, comparability:'comparable'})).status,409);
  const assessmentOwner = {...goalOwner, actualId:actual.actualId};
  const assessmentUrl = '/api/business-role?owner='+encodeURIComponent(JSON.stringify(assessmentOwner));
  provider.setResponder((ctx: any) => ctx.recentToolResults.length===0 ? {calls:[{name:'strategy_goals', arguments:{action:'goal-assess-actual',comparability:'partial-missing',assessmentNote:'两个门店尚缺',observation:{actualValue:27,basis,quote:reportText}}}]} : {text:'已核对原资料，整体偏差待补。'});
  await json(await host.request(assessmentUrl+'&action=messages','POST',{requestId:randomUUID(),text:'按已提交的实绩和冻结计划核对。',expectedRevision:0}),202);
  for (let i=0;i<400;i++) {
    const detail=await json(await host.request(assessmentUrl));
    if (!detail.busy && detail.discussion?.lastRun?.status==='completed') break;
    await delay(25);
  }
  const after = await json(await host.request(`/api/strategy/goals/${goal.goalId}/workspace`));
  assert.equal(after.checks.length,1);
  assert.equal(after.checks[0].actualSource.ref,'pos-frozen-r2');
  assert.equal(after.checks[0].overallVariancePct,null);
  assert.equal(after.checks[0].assessmentNote,'两个门店尚缺');
  assert.equal(after.checks[0].periods[0].actualValue,27);
  assert.equal(after.checks[0].evidenceQuote,reportText);

  const goalPath = '/api/strategy/goals/' + goal.goalId;
  const conclusion = {title:'平台复购', summary:'春节活动期间复购提升，贡献需验证', sourceRef:'retail-feb-proof',
    applicableScope:'零售事业部', evidenceMature:true, causalVerified:false};
  const {review} = await json(await host.request(goalPath + '/cycle-reviews','POST',{operationId:randomUUID(), period:'2027-01',
    actualFinalValue:112, actualSourceRef:'final-pos-jan', conclusions:[{...conclusion,id:'keep'},{...conclusion,id:'omit',sourceRef:'exclude-this-reference'}]}),201);
  const {nextCycleDraft} = await json(await host.request(goalPath + '/next-cycle-draft','POST',{
    operationId:randomUUID(), reviewId:review.reviewId, nextPeriod:'2027-02',selectedConclusionIds:['keep']}),201);
  const nextOwner = {role:'goal-draft',draftId:nextCycleDraft.draftId,scope:retailScope,nextCycleSourceGoalId:goal.goalId};
  const nextUrl = '/api/business-role?owner='+encodeURIComponent(JSON.stringify(nextOwner));
  const proposal = {title:'二月复购试点', outcome:'在适用门店核对复购', perspective:'profit',responsible:goal.responsible,
    baseline:{state:'pending',description:'核对新客基线'},measurement:{kind:'deliverable',criterion:'复购证据'},strategies:['验证原策略适用条件']};
  let delivered = '';
  provider.setResponder((ctx:any) => {
    if (ctx.recentToolResults.length) return {text:'已起草供负责人核对。'};
    delivered = JSON.stringify(ctx.messages ?? ctx.body?.messages ?? ctx);
    return {calls:[{name:'strategy_goals',arguments:{action:'propose-goal',draft:proposal}}]};
  });
  await json(await host.request(nextUrl+'&action=messages','POST',{requestId:randomUUID(),text:'按所选原证据起草下一期目标。',expectedRevision:0}),202);
  let nextDetail;
  for (let i=0;i<400;i++) {
    nextDetail = await json(await host.request(nextUrl));
    if (!nextDetail.busy && nextDetail.discussion?.lastRun?.status==='completed') break;
    await delay(25);
  }
  assert.match(delivered,/retail-feb-proof/);
  assert.doesNotMatch(delivered,/exclude-this-reference/);
  assert.equal(nextDetail.goalDrafts[0].draft.title,proposal.title);
  assert.equal(nextDetail.goalDrafts[0].source.owner.draftId,nextCycleDraft.draftId);

  await json(await host.request(goalPath + '/revisions','POST',{...goal, operationId:randomUUID(), expectedVersion:1,
    title:'下一次正式调整',formalOrigin:{...goal.formalOrigin, targetValue:130}}),201);
  await json(await host.request(goalPath + '/gsa-plan/confirm','POST',{operationId:randomUUID(), expectedGoalVersion:2, expectedAdoptedVersion:1,
    expectedPlanVersion:1,plannedActions:[{id:'A2', summary:'已承接修订',checkpoint:'月中',observationBasis:'门店盘点'}], decision:'确认 v2'}),201);
  const current = await json(await host.request(goalPath + '/workspace?goalVersion=2'));
  assert.equal(current.activeGsaPlan.goal.version,2);
  const historical = await json(await host.request(goalPath + '/workspace?goalVersion=1'));
  assert.ok(historical.nextCycleDrafts.some((d: {draftId: string}) => d.draftId === nextCycleDraft.draftId));
  const reopened = await json(await host.request(nextUrl));
  assert.equal(reopened.goalDrafts[0].draft.title,proposal.title);


});
