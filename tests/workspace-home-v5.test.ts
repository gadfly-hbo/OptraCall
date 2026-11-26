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

test('W09: filterWorkspaceSearchItems searches across modules, settings, projects, tasks, and cases read-only', () => {
  const items = filterWorkspaceSearchItems({
    query: '连接',
    projects: [sampleProject()],
    cases: [sampleCase()],
  });
  assert.ok(items.some(item => item.id === 'settings:connection-settings'));
  const caseHits = filterWorkspaceSearchItems({ query: '复购', projects: [sampleProject()], cases: [sampleCase()] });
  assert.ok(caseHits.some(item => item.kind === 'case' && item.caseId === 'case-1'));
  assert.ok(caseHits.some(item => item.kind === 'task' && item.taskId === 'task-1'));
  const none = filterWorkspaceSearchItems({ query: '不存在的关键词xyz', projects: [sampleProject()], cases: [sampleCase()] });
  assert.equal(none.length, 0);
});
