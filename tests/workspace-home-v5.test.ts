import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildWorkspaceHomeModel,
  filterWorkspaceSearchItems,
  resolveInitialWorkspaceView,
  summarizeProjectTaskTypes,
} from '../src/host/ui/workspace-home-model.ts';
import type { CaseDetail, CaseRecord } from '../src/host/case-types.ts';
import type { ClientProject } from '../src/host/ui/project-types.ts';
import type { StrategyGoalsIndex } from '../src/host/strategy-goals-types.ts';

function sampleProject(overrides: Partial<ClientProject> = {}): ClientProject {
  return {
    schemaVersion: 2,
    id: 'proj-1',
    name: '华东门店经营诊断',
    configuration: { id: 'cfg-1', name: 'Test', provider: 'openai-compatible', api: 'openai-completions', model: 'synthetic', baseUrl: 'http://127.0.0.1', revision: 1 },
    rootPath: '/tmp/proj-1',
    createdAt: '2026-11-25T08:00:00Z',
    updatedAt: '2026-11-25T10:26:00Z',
    archivedAt: null,
    tasks: [
      {
        id: 'task-1',
        name: '华东会员复购下滑分析',
        draft: '',
        configuration: { id: 'cfg-1', name: 'Test', provider: 'openai-compatible', api: 'openai-completions', model: 'synthetic', baseUrl: 'http://127.0.0.1', revision: 1 },
        createdAt: '2026-11-25T09:00:00Z',
        updatedAt: '2026-11-25T10:26:00Z',
        sessionStorage: 'task',
        assignment: { type: 'analysis', skill: null },
      },
    ],
    work: {
      projectId: 'proj-1',
      workStatus: 'in_progress',
      workScope: '核查重点门店缺货与首购结构',
      assignee: '区域运营',
      nextStep: '回收三家门店货架核查表',
      statusReason: null,
      statusChangedAt: '2026-11-25T10:00:00Z',
      revision: 1,
      createdAt: '2026-11-25T08:30:00Z',
      updatedAt: '2026-11-25T10:00:00Z',
    },
    ...overrides,
  };
}

function sampleCase(overrides: Partial<CaseRecord> = {}): CaseRecord {
  return {
    id: 'case-1',
    title: '华东低复购门店干预',
    description: '首购后 60 天复购率下降',
    judgement: '优先核查缺货和首购商品结构',
    nextStep: '确认首批核查门店及责任人',
    status: 'awaiting_confirmation',
    closeReason: null,
    closedAt: null,
    revision: 2,
    createdAt: '2026-11-25T08:00:00Z',
    updatedAt: '2026-11-25T10:20:00Z',
    ...overrides,
  };
}

test('W01: resolveInitialWorkspaceView defaults plain launch to home while preserving deep links', () => {
  assert.equal(resolveInitialWorkspaceView('http://127.0.0.1:4173/'), 'home');
  assert.equal(resolveInitialWorkspaceView('http://127.0.0.1:4173/?foo=bar'), 'home');
  assert.equal(resolveInitialWorkspaceView('http://127.0.0.1:4173/?management=gsa'), 'goals');
  assert.equal(resolveInitialWorkspaceView('http://127.0.0.1:4173/?management=strategy'), 'goals');
  assert.equal(resolveInitialWorkspaceView('http://127.0.0.1:4173/?studio=sys-1'), 'studio');
  assert.equal(resolveInitialWorkspaceView('http://127.0.0.1:4173/?studio='), 'studio');
  assert.equal(resolveInitialWorkspaceView('http://127.0.0.1:4173/?project=proj-1'), 'chat');
  assert.equal(resolveInitialWorkspaceView('http://127.0.0.1:4173/?project=proj-1&task=task-1'), 'chat');
  assert.equal(resolveInitialWorkspaceView('http://127.0.0.1:4173/?task=task-1'), 'chat');
  assert.equal(resolveInitialWorkspaceView('http://127.0.0.1:4173/?returnCase=case-1'), 'cases');
});

test('W01: buildWorkspaceHomeModel distinguishes empty, forbidden, and unavailable states cleanly', () => {
  const empty = buildWorkspaceHomeModel({
    caseAccessState: 'empty',
    cases: [],
    projectLinks: [],
    projects: [],
    goals: { goals: [], relations: [], feedback: [] },
    foundations: {
      strategy: { state: 'ready', status: '未开始', detail: '尚未建立战略事项' },
      goals: { state: 'ready', status: '未开始', detail: '尚未采用目标' },
      semantic: { state: 'ready', status: '未开始', detail: '尚未发布语义资产' },
      analysis: { state: 'ready', status: '未开始', detail: '尚未发布分析资产' },
    },
  });
  assert.equal(empty.caseAccessState, 'empty');
  assert.equal(empty.headline, '从第一个 Case 开始');
  assert.equal(empty.focusCase, null);
  assert.equal(empty.queue.length, 0);
  assert.equal(empty.activities.length, 0);
  assert.equal(empty.proof.kind, 'readiness');
  assert.equal(empty.proof.completedCount, 0);
  assert.equal(empty.foundations.every(item => item.status === '未开始'), true);

  const forbidden = buildWorkspaceHomeModel({
    caseAccessState: 'forbidden',
    caseAccessMessage: '当前身份暂无权读取 Case 记录。',
    cases: [],
    projectLinks: [],
    projects: [sampleProject()],
  });
  assert.equal(forbidden.caseAccessState, 'forbidden');
  assert.match(forbidden.caseAccessMessage ?? '', /无权/);
  assert.equal(forbidden.counts.activeProjects, 1);

  const unavailable = buildWorkspaceHomeModel({
    caseAccessState: 'unavailable',
    caseAccessMessage: 'Case 存储暂时不可用，现有项目仍保留。',
    cases: [],
    projectLinks: [],
    projects: [sampleProject()],
  });
  assert.equal(unavailable.caseAccessState, 'unavailable');
  assert.match(unavailable.caseAccessMessage ?? '', /暂时不可用/);
  assert.equal(unavailable.counts.activeProjects, 1);
});

test('W01/W02: buildWorkspaceHomeModel pins exact goal version, separates Case vs Project action status, and wires report source', () => {
  const c1 = sampleCase();
  const cClosed = sampleCase({ id: 'case-closed', title: '已完结旧 Case', status: 'closed', closeReason: '完成复盘' });
  const project = sampleProject();
  const goals: StrategyGoalsIndex = {
    goals: [{
      id: 'goal-1',
      currentVersion: 2,
      adoptedVersion: 2,
      versions: [
        {
          goalId: 'goal-1', version: 1, status: 'adopted', title: '改善华东会员复购（旧版）',
          outcome: '60天复购回升', perspective: 'enterprise' as never,
          scope: { kind: 'enterprise', id: 'ent-1', name: '澄光零售' },
          measurement: { kind: 'deliverable', criterion: '复购报告' },
          baseline: { state: 'pending', description: '待核' },
          responsible: '华东负责人', strategies: ['优先验证缺货与首购结构'],
          createdAt: '2026-11-20T00:00:00Z',
        },
        {
          goalId: 'goal-1', version: 2, status: 'adopted', title: '改善华东会员复购（新版）',
          outcome: '60天复购回升至26%', perspective: 'enterprise' as never,
          scope: { kind: 'enterprise', id: 'ent-1', name: '澄光零售' },
          measurement: { kind: 'deliverable', criterion: '复购报告' },
          baseline: { state: 'pending', description: '待核' },
          responsible: '华东负责人', strategies: ['新版策略'],
          createdAt: '2026-11-24T00:00:00Z',
        },
      ],
    }],
    relations: [],
    feedback: [],
  };
  const detail: CaseDetail = {
    case: c1,
    goalBinding: {
      caseId: c1.id,
      caseRevision: c1.revision,
      primary: { goalId: 'goal-1', version: 1 },
      related: [],
      strategy: '优先验证缺货与首购结构',
      confirmedAt: '2026-11-25T08:05:00Z',
      operationId: 'op-1',
    },
    projectLinks: [{ caseId: c1.id, projectId: project.id, linkedAt: '2026-11-25T08:10:00Z' }],
    artifacts: [{
      id: 'art-1', caseId: c1.id, projectId: project.id, taskId: 'task-1', uploadId: null,
      relativePath: '060_reports/华东复购诊断报告.md', role: 'report', displayName: '华东复购诊断报告',
      observedSha256: 'a'.repeat(64), observedBytes: 1024, observedAt: '2026-11-25T10:26:00Z',
      createdAt: '2026-11-25T10:26:00Z', updatedAt: '2026-11-25T10:26:00Z', unlinkedAt: null,
      availability: 'available', projectName: project.name, taskName: '华东会员复购下滑分析',
    }],
    events: [{
      id: 'ev-1', subjectType: 'case', subjectId: c1.id, revision: 2, eventType: 'case_updated',
      operationId: 'op-2', actorKind: 'user', originCaseId: null, changes: {}, note: '更新核查范围',
      feedbackSource: null, occurredAt: '2026-11-25T10:20:00Z',
    }],
    projectEvents: [],
    pendingOperations: [],
  };

  const model = buildWorkspaceHomeModel({
    caseAccessState: 'ready',
    enterpriseName: '澄光零售',
    cases: [c1, cClosed],
    projectLinks: [{ caseId: c1.id, projectId: project.id, linkedAt: '2026-11-25T08:10:00Z' }],
    focusDetail: detail,
    projects: [project],
    goals,
  });

  assert.equal(model.headline, '确认首批核查门店及责任人');
  assert.equal(model.focusCase?.id, c1.id);
  // Exact pinned goal version v1, NEVER silently switched to v2!
  assert.match(model.goalSummary.goalText, /改善华东会员复购（旧版）/);
  assert.match(model.goalSummary.goalText, /v1/);
  assert.equal(model.goalSummary.strategyText, '优先验证缺货与首购结构');
  // Active case count excludes closed; project action status tracked separately!
  assert.equal(model.counts.activeCases, 1);
  assert.equal(model.counts.totalCases, 2);
  assert.equal(model.counts.inProgressActions, 1);
  // Queue has active case + available report review item (excludes closed case)
  assert.equal(model.queue.some(item => item.kind === 'case' && item.caseId === cClosed.id), false);
  const reportQueueItem = model.queue.find(item => item.kind === 'report');
  assert.ok(reportQueueItem && reportQueueItem.kind === 'report');
  assert.equal(reportQueueItem.caseId, c1.id);
  assert.equal(reportQueueItem.projectId, project.id);
  assert.equal(reportQueueItem.taskId, 'task-1');
  assert.equal(reportQueueItem.sha256, 'a'.repeat(64));
  // Proof card points to real report source
  assert.equal(model.proof.source?.kind, 'report');
  assert.ok(model.activities.length >= 1);
});

test('W03: summarizeProjectTaskTypes counts all 6 types plus unassigned without inferring missing types', () => {
  const project = sampleProject({
    tasks: [
      { ...sampleProject().tasks[0], id: 't1', assignment: { type: 'analysis', skill: null } },
      { ...sampleProject().tasks[0], id: 't2', assignment: { type: 'analysis', skill: null } },
      { ...sampleProject().tasks[0], id: 't3', assignment: { type: 'requirement', skill: null } },
      { ...sampleProject().tasks[0], id: 't4', assignment: { type: 'teach', skill: null }, archivedAt: '2026-11-25T11:00:00Z' },
      { ...sampleProject().tasks[0], id: 't5', assignment: undefined },
    ],
  });
  const summary = summarizeProjectTaskTypes(project.tasks);
  assert.equal(summary.byType.analysis, 2);
  assert.equal(summary.byType.requirement, 1);
  assert.equal(summary.byType.plan, 0);
  assert.equal(summary.byType.decision, 0);
  assert.equal(summary.byType.do, 0);
  assert.equal(summary.byType.teach, 1);
  assert.equal(summary.unassigned, 1);
  assert.equal(summary.archived, 1);
  assert.equal(summary.total, 5);

  const empty = summarizeProjectTaskTypes([]);
  assert.equal(empty.total, 0);
  assert.equal(empty.unassigned, 0);
});

test('W09: filterWorkspaceSearchItems searches across modules, foundation overview, settings, projects, tasks, and cases read-only', () => {
  const items = filterWorkspaceSearchItems({
    query: '连接',
    projects: [sampleProject()],
    cases: [sampleCase()],
  });
  assert.ok(items.some(item => item.id === 'settings:connection-settings'));
  const overviewHits = filterWorkspaceSearchItems({ query: '建设总览', projects: [], cases: [] });
  assert.ok(overviewHits.some(item => item.kind === 'view' && item.view === 'foundation'));
  const caseHits = filterWorkspaceSearchItems({ query: '复购', projects: [sampleProject()], cases: [sampleCase()] });
  assert.ok(caseHits.some(item => item.kind === 'case' && item.caseId === 'case-1'));
  assert.ok(caseHits.some(item => item.kind === 'task' && item.taskId === 'task-1'));
  const revokedCases = filterWorkspaceSearchItems({ query: '复购', projects: [], cases: [] });
  assert.equal(revokedCases.some(item => item.kind === 'case'), false);
  const none = filterWorkspaceSearchItems({ query: '不存在的关键词xyz', projects: [sampleProject()], cases: [sampleCase()] });
  assert.equal(none.length, 0);
});

test('R2 Finding 2: studio foundation aggregation scopes by selected enterprise, counts only formal-current as published, and surfaces 403/500', async () => {
  const mod = await import('../src/host/ui/workspace-home-model.ts') as typeof import('../src/host/ui/workspace-home-model.ts') & {
    resolveActiveStudioEnterprise?: (input: {
      enterprises: readonly { id: string; name: string }[];
      selectedEnterpriseId?: string;
      currentProjectId?: string;
      projectAssignments?: readonly { projectId: string; enterpriseId: string }[];
    }) => { enterprise: { id: string; name: string } | null; unselected: boolean };
    summarizeStudioFoundationSnapshots?: (input: {
      enterprise: { id: string; name: string } | null;
      unselected?: boolean;
      systems: readonly { id: string; enterpriseId?: string | null }[];
      foundationResult:
        | { ok: true; items: readonly { authority: string; status: string }[] }
        | { ok: false; state: 'forbidden' | 'unavailable'; message: string }
        | null;
    }) => { semantic: import('../src/host/ui/workspace-home-model.ts').HomeFoundationSnapshot; analysis: import('../src/host/ui/workspace-home-model.ts').HomeFoundationSnapshot };
    summarizeStrategyFoundationSnapshot?: (input: {
      initiatives: readonly { id: string }[];
      publicationChecks: readonly ({ ok: true; hasActive: boolean } | { ok: false; state: 'forbidden' | 'unavailable'; message: string })[];
    }) => import('../src/host/ui/workspace-home-model.ts').HomeFoundationSnapshot;
  };
  assert.equal(typeof mod.resolveActiveStudioEnterprise, 'function');
  assert.equal(typeof mod.summarizeStudioFoundationSnapshots, 'function');
  assert.equal(typeof mod.summarizeStrategyFoundationSnapshot, 'function');

  const enterprises = [
    { id: 'ent-1', name: '澄光零售' },
    { id: 'ent-2', name: '北辰制造' },
  ];
  // Switching to ent-2 selects ent-2 (never hardcoded enterprises[0])
  const picked = mod.resolveActiveStudioEnterprise!({ enterprises, selectedEnterpriseId: 'ent-2' });
  assert.equal(picked.enterprise?.id, 'ent-2');
  assert.equal(picked.unselected, false);

  // Explicit empty string means user selected "尚未明确企业" in multi-enterprise directory
  const cleared = mod.resolveActiveStudioEnterprise!({ enterprises, selectedEnterpriseId: '' });
  assert.equal(cleared.enterprise, null);
  assert.equal(cleared.unselected, true);

  // Systems from ent-1 MUST NOT count toward ent-2; candidate SAP metric MUST NOT be labeled 已发布 / 正式资产!
  const ent2CandidateOnly = mod.summarizeStudioFoundationSnapshots!({
    enterprise: enterprises[1]!,
    systems: [
      { id: 'sys-ent1-a', enterpriseId: 'ent-1' },
      { id: 'sys-ent1-b', enterpriseId: 'ent-1' },
    ],
    foundationResult: {
      ok: true,
      items: [
        { authority: 'sap-metric', status: 'candidate' },
      ],
    },
  });
  assert.equal(ent2CandidateOnly.semantic.status, '未开始');
  assert.notEqual(ent2CandidateOnly.analysis.status, '已发布');
  assert.doesNotMatch(ent2CandidateOnly.analysis.detail, /\d+\s*项正式/);
  assert.match(ent2CandidateOnly.analysis.detail, /候选/);

  // Only formal-current counts as 已发布
  const ent1Published = mod.summarizeStudioFoundationSnapshots!({
    enterprise: enterprises[0]!,
    systems: [{ id: 'sys-ent1-a', enterpriseId: 'ent-1' }],
    foundationResult: {
      ok: true,
      items: [
        { authority: 'rap', status: 'formal-current' },
        { authority: 'sap-metric', status: 'formal-current' },
        { authority: 'sap-method', status: 'candidate' },
      ],
    },
  });
  assert.equal(ent1Published.semantic.status, '已发布');
  assert.match(ent1Published.semantic.detail, /1 项正式语义资产/);
  assert.equal(ent1Published.analysis.status, '已发布');
  assert.match(ent1Published.analysis.detail, /1 项正式分析资产/);

  // 403 / 500 on readStudioFoundation must NOT be swallowed into 建设中 or 未开始
  const forbiddenFoundation = mod.summarizeStudioFoundationSnapshots!({
    enterprise: enterprises[1]!,
    systems: [{ id: 'sys-ent2', enterpriseId: 'ent-2' }],
    foundationResult: { ok: false, state: 'forbidden', message: '无权读取北辰制造资产目录' },
  });
  assert.equal(forbiddenFoundation.semantic.state, 'forbidden');
  assert.equal(forbiddenFoundation.semantic.status, '无权限');
  assert.equal(forbiddenFoundation.analysis.state, 'forbidden');
  assert.equal(forbiddenFoundation.analysis.status, '无权限');

  // Strategy initiatives > 5: active publication on the 6th initiative MUST be detected!
  const sixInitiatives = Array.from({ length: 6 }, (_, i) => ({ id: `init-${i + 1}` }));
  const strategySnap = mod.summarizeStrategyFoundationSnapshot!({
    initiatives: sixInitiatives,
    publicationChecks: sixInitiatives.map((_, idx) => ({ ok: true as const, hasActive: idx === 5 })),
  });
  assert.equal(strategySnap.status, '已发布');
});

test('R2 Finding 2 & 3: forbidden/unavailable Case states avoid empty-Case copy; multi-project completed/cancelled, report owner, and Decision Board actions stay accurate', () => {
  const forbidden = buildWorkspaceHomeModel({
    caseAccessState: 'forbidden',
    caseAccessMessage: '当前身份暂无权读取 Case 记录。',
    cases: [],
    projectLinks: [],
    projects: [sampleProject()],
  });
  assert.notEqual(forbidden.headline, '从第一个 Case 开始');
  assert.match(forbidden.headline, /无权|权限/);
  assert.equal(forbidden.focusStatusLabel, '无权限读取');

  const unavailable = buildWorkspaceHomeModel({
    caseAccessState: 'unavailable',
    caseAccessMessage: 'Case 存储故障',
    cases: [],
    projectLinks: [],
    projects: [sampleProject()],
  });
  assert.notEqual(unavailable.headline, '从第一个 Case 开始');
  assert.equal(unavailable.focusStatusLabel, '暂不可读');

  // Multi-project Case: P1 completed (owner 甲, no report), P2 cancelled (owner unset, has report R2)
  const cMulti = sampleCase({ id: 'case-multi', title: '多项目状态与归属核对' });
  const p1 = sampleProject({
    id: 'p1',
    name: '一号完成项目',
    work: { ...sampleProject().work!, projectId: 'p1', workStatus: 'completed', assignee: '甲负责人' },
  });
  const p2 = sampleProject({
    id: 'p2',
    name: '二号取消项目',
    work: { ...sampleProject().work!, projectId: 'p2', workStatus: 'cancelled', assignee: '' },
  });
  const multiDetail: CaseDetail = {
    case: cMulti,
    projectLinks: [
      { caseId: cMulti.id, projectId: p1.id, linkedAt: '2026-11-25T08:10:00Z' },
      { caseId: cMulti.id, projectId: p2.id, linkedAt: '2026-11-25T08:12:00Z' },
    ],
    artifacts: [{
      id: 'art-p2', caseId: cMulti.id, projectId: p2.id, taskId: 'task-1', uploadId: null,
      relativePath: '060_reports/二号项目报告.md', role: 'report', displayName: '二号项目报告',
      observedSha256: 'b'.repeat(64), observedBytes: 512, observedAt: '2026-11-25T10:30:00Z',
      createdAt: '2026-11-25T10:30:00Z', updatedAt: '2026-11-25T10:30:00Z', unlinkedAt: null,
      availability: 'available', projectName: p2.name, taskName: '华东会员复购下滑分析',
    }],
    events: [],
    projectEvents: [],
    pendingOperations: [],
  };

  const multiModel = buildWorkspaceHomeModel({
    caseAccessState: 'ready',
    cases: [cMulti],
    projectLinks: multiDetail.projectLinks,
    focusDetail: multiDetail,
    projects: [p1, p2],
  });

  // Proof chart for 2 projects must show 已完成 1 and 已取消 1 (never "待推进 / 观察 2"), and source must be projects (never P2's report!)
  assert.equal(multiModel.proof.kind, 'grouped');
  if (multiModel.proof.kind === 'grouped') {
    assert.deepEqual(
      multiModel.proof.groups.map(g => `${g.label}:${g.count}`),
      ['已完成:1', '已取消:1'],
    );
    assert.equal(multiModel.proof.source?.kind, 'projects');
  }
  // Report queue item owner must come from P2 ('待定'), NEVER from P1 ('甲负责人')!
  const r2Queue = multiModel.queue.find(item => item.kind === 'report');
  assert.ok(r2Queue && r2Queue.kind === 'report');
  assert.equal(r2Queue.owner, '待定');

  // Decision Board actions aggregation: owner, dueDate, doing/todo/done counts, and Proof chart source = decision
  const withActions = buildWorkspaceHomeModel({
    caseAccessState: 'ready',
    cases: [cMulti],
    projectLinks: multiDetail.projectLinks,
    focusDetail: multiDetail,
    projects: [p1, p2],
    boardActions: [
      { id: 'act-1', itemId: 'item-1', projectId: p1.id, caseId: cMulti.id, title: '核查三家样板门店货架', owner: '王店长', dueDate: '2026-12-05', status: 'doing', updatedAt: '2026-11-26T09:00:00Z' },
      { id: 'act-2', itemId: 'item-1', projectId: p1.id, caseId: cMulti.id, title: '提交补货调整单', owner: '', dueDate: '', status: 'todo', updatedAt: '2026-11-26T09:05:00Z' },
    ],
  } as Parameters<typeof buildWorkspaceHomeModel>[0]);

  assert.equal(withActions.counts.inProgressActions, 1);
  assert.equal(withActions.proof.kind, 'grouped');
  if (withActions.proof.kind === 'grouped') {
    assert.equal(withActions.proof.caption, '已关联行动进展');
    assert.equal(withActions.proof.source?.kind, 'decision');
  }
  const actionItem = withActions.queue.find(item => item.id === 'action:act-1');
  assert.ok(actionItem);
  assert.equal(actionItem.owner, '王店长');
  assert.equal(actionItem.statusLabel, '执行中');
  assert.match(actionItem.dateLabel, /12\/05|2026-12-05/);
  const pendingOwnerAction = withActions.queue.find(item => item.id === 'action:act-2');
  assert.ok(pendingOwnerAction);
  assert.equal(pendingOwnerAction.owner, '待定');
  assert.match(pendingOwnerAction.dateLabel, /待定/);

  // Closed-only Cases: closed Case must not enter queue or push its old report as pending review
  const closedOnly = sampleCase({ id: 'case-closed-only', title: '已归档结案事项', status: 'closed', closeReason: '目标达成' });
  const closedModel = buildWorkspaceHomeModel({
    caseAccessState: 'ready',
    cases: [closedOnly],
    projectLinks: [{ caseId: closedOnly.id, projectId: p1.id, linkedAt: '2026-11-25T08:10:00Z' }],
    focusDetail: { ...multiDetail, case: closedOnly },
    projects: [p1],
  });
  assert.equal(closedModel.counts.activeCases, 0);
  assert.equal(closedModel.queue.length, 0);
});

