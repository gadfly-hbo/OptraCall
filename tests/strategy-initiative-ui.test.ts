import test from 'node:test';
import assert from 'node:assert/strict';
import './fixtures/register-ui.ts';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { CandidateVersion, KickoffReportVersion, VerificationBatch, VerificationGate } from '../src/host/strategy-initiative-types.ts';
import type { InitiativePublication, InitiativeRecord } from '../src/host/ui/strategy-initiative-client.ts';
import type { GoalScope } from '../src/host/strategy-goals-types.ts';

const scope: GoalScope = { kind: 'department', id: 'stores', name: '华东零售事业部', enterpriseId: 'ent-1' };
const scopeKey = 'department:ent-1:stores';
const initiative: InitiativeRecord = { id: '11111111-1111-4111-8111-111111111111', title: '华东门店增长战略', revision: 1, scopes: [scope], createdAt: '2026-11-20T00:00:00Z', updatedAt: '2026-11-20T00:00:00Z' };
const candidateId = '22222222-2222-4222-8222-222222222222';
const report: KickoffReportVersion = {
  no: 1,
  fields: {
    horizon: '2027–2029', diagnosis: '华东门店客流已企稳，增长缺口集中在二次到店。',
    propositions: [
      { id: 'P1', question: '复购提升能否驱动存量门店增长？', whyItMatters: '决定投入方向', evidence: '上期经营复盘', gaps: '自然复购对照' },
      { id: 'P2', question: '导购触达能否规模化？', whyItMatters: '决定工时预算' },
      { id: 'P3', question: '会员与效率投入如何分配？', whyItMatters: '决定资源取舍' },
    ],
    assumptions: '试点门店口径一致。', evidenceGaps: '缺自然复购对照。', followUp: '形成两个可比较候选。',
  },
  sources: [{ kind: 'file', ref: '010_draw/上期经营复盘.pdf', title: '上期经营复盘.pdf' }],
  contentSha256: 'a'.repeat(64),
  generation: { operationId: '33333333-3333-4333-8333-333333333333', kind: 'agent', at: '2026-11-20T01:00:00Z' },
  lock: { operationId: '44444444-4444-4444-8444-444444444444', operator: '决策者', at: '2026-11-20T02:00:00Z', fingerprint: 'a'.repeat(64) },
};
const candidate: CandidateVersion = {
  initiativeId: initiative.id, candidateId, no: 1, scopeKey, title: '会员复购优先',
  anchor: { reportNo: 1, contentSha256: report.contentSha256 },
  blocks: [
    { id: 'positioning', label: '战略定位与增长路径', text: '深耕现有门店，以首购后分层回访带动二次到店。' },
    { id: 'milestones', label: '三年目标与里程碑', text: '2027 三店试点。2029 二购率从 9% 提至 12%。' },
    { id: 'resources', label: '资源分配与明确不做', text: '试点优先配置会员运营工时，暂缓大规模开店。' },
  ],
  goals: ['90 天二购率达到 12%', '试点门店触达率达到 80%'],
  contentSha256: 'b'.repeat(64), configurationId: 'config-1', configurationRevision: 1, revision: 2,
  createOperationId: '55555555-5555-4555-8555-555555555555', instruction: '形成会员复购优先的完整备选方案。',
  lock: { operationId: '66666666-6666-4666-8666-666666666666', operator: '决策者', at: '2026-11-21T00:00:00Z', fingerprint: 'b'.repeat(64) },
  createdAt: '2026-11-20T03:00:00Z', updatedAt: '2026-11-21T00:00:00Z',
};
const gate = (turn: 0 | 1): VerificationGate => ({
  turn, operationId: '77777777-7777-4777-8777-777777777777', ref: `检验 ${candidateId.slice(0, 8)}-${turn + 1}`,
  status: 'completed', verdict: 'pass', evidence: turn ? '关键假设可用同店同期对照检验。' : '「触达→再到店→二购」的关键前提和反例已记录。',
  sources: [{ kind: 'file', ref: '010_draw/上期经营复盘.pdf' }], configurationId: 'config-1', configurationRevision: 1,
  startedAt: '2026-11-21T01:00:00Z', finishedAt: '2026-11-21T02:00:00Z',
});
const batch: VerificationBatch = {
  batchId: '88888888-8888-4888-8888-888888888888', initiativeId: initiative.id, candidateId, no: 1,
  contentSha256: candidate.contentSha256, lockOperationId: candidate.lock!.operationId,
  gates: [gate(0), gate(1)], state: 'passed', createdAt: '2026-11-21T01:00:00Z', updatedAt: '2026-11-21T02:00:00Z',
};
const publication: InitiativePublication = {
  publicationId: '99999999-9999-4999-8999-999999999999', initiativeId: initiative.id, scopeKey, candidateId, no: 1,
  contentSha256: candidate.contentSha256, lockOperationId: candidate.lock!.operationId, batchId: batch.batchId,
  gateRefs: [batch.gates[0].ref, batch.gates[1].ref], operationId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  state: 'active', template: '树形地图', publishedAt: '2026-11-22T00:00:00Z',
  handoffs: [{ operationId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', scope, goals: [{ goalId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', version: 1 }], at: '2026-11-22T01:00:00Z' }],
};
const access = {
  active: false,
  scopes: [scope], projects: [], configurations: [], selectedConfigurationId: null,
  onSettings() {}, onStage() {}, async onGoalsChanged() {}, onReviewCandidate() {},
};

test('SS01 four strategy tabs and the two co-create phases render with the in-place file panel', async () => {
  const { StrategyGoalsPage } = await import('../src/host/ui/StrategyGoalsPage.tsx');
  const page = renderToStaticMarkup(createElement(StrategyGoalsPage, { active: false, management: { area: 'strategy', stage: 'co-create' }, onStage() {}, onOpenCase() {}, onStartProject() {}, onManageMetrics() {} }));
  assert.match(page, /aria-current="page"[^>]*>战略共创/);
  for (const label of ['战略检验', '战略发布', '版本管理']) assert.match(page, new RegExp(`>${label}<`));
  assert.doesNotMatch(page, />战略地图</); assert.doesNotMatch(page, />战略模拟</);
  const { InitiativeScopeWorkspace } = await import('../src/host/ui/StrategyInitiativeWorkbench.tsx');
  const workspace = renderToStaticMarkup(createElement(InitiativeScopeWorkspace, { initiative, scope, stage: 'co-create', active: false, onStage() {}, access, configurations: [], selectedConfigurationId: null, onSettings() {}, onInitiativeChanged: async () => {} }));
  assert.match(workspace, /启动 · 开题报告/); assert.match(workspace, /方案成型 · 战略候选/);
  assert.match(workspace, /010_draw/); assert.match(workspace, /020_clean/); assert.match(workspace, /060_reports/);
});

test('SS01 lifecycle placeholders only expose an explanation', async () => {
  const { LifecyclePlaceholderDialog } = await import('../src/host/ui/strategy-initiative-view.tsx');
  const review = renderToStaticMarkup(createElement(LifecyclePlaceholderDialog, { module: '战略复盘', onClose() {} }));
  assert.match(review, /战略迭代期/); assert.match(review, /不创建记录、不调用模型/);
  const rebuild = renderToStaticMarkup(createElement(LifecyclePlaceholderDialog, { module: '战略重构', onClose() {} }));
  assert.match(rebuild, /退场与新生/);
  const { StrategyInitiativeWorkbench } = await import('../src/host/ui/StrategyInitiativeWorkbench.tsx');
  const shell = renderToStaticMarkup(createElement(StrategyInitiativeWorkbench, { stage: 'co-create', onStage() {}, active: false, access, configurations: [], selectedConfigurationId: null, onSettings() {} }));
  assert.match(shell, /战略复盘 · 占位/); assert.match(shell, /战略重构 · 占位/);
});

test('SS01 file panel shows three directories, scope-exclusive marks and system reports', async () => {
  const { InitiativeFilePanel } = await import('../src/host/ui/strategy-initiative-view.tsx');
  const html = renderToStaticMarkup(createElement(InitiativeFilePanel, {
    files: [
      { fileId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', operationId: 'e1', name: '上期经营复盘.pdf', directory: '010_draw', size: 2048, sha256: 'c'.repeat(64), uploadedAt: '2026-11-20T00:00:00Z' },
      { fileId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', operationId: 'e2', name: '高管访谈纪要.md', directory: '020_clean', scopeKey, size: 512, sha256: 'd'.repeat(64), uploadedAt: '2026-11-20T00:00:00Z' },
    ],
    reports: [report], candidates: [candidate], batches: [batch], scopeKey,
    onUpload() {}, onOpenFile() {}, onOpenReport() {},
  }));
  assert.match(html, /010_draw/); assert.match(html, /020_clean/); assert.match(html, /060_reports/);
  assert.match(html, /事项共用/); assert.match(html, /范围专属 · 当前范围/);
  assert.match(html, /开题报告 · v1\.md/); assert.match(html, /会员复购优先 · v1\.md/);
  assert.match(html, /因果检验\.md/); assert.match(html, /仅当前范围专属/);
});

test('SS10 publish confirmation requires the explicit checkbox and warns about replacement', async () => {
  const { PublishConfirmDialog, StrategyReleaseReview } = await import('../src/host/ui/StrategyInitiativeGovernance.tsx');
  const html = renderToStaticMarkup(createElement(PublishConfirmDialog, { initiativeId: initiative.id, candidate, batch, prior: publication, template: '树形地图', onPublished: async () => {}, onClose() {} }));
  assert.match(html, /type="checkbox"[^>]*required/);
  assert.match(html, /我已核对准确版方案及两份带依据的检验结论/);
  assert.match(html, /确认后将替代当前发布/);
  assert.match(html, /因果检验 · TOC\/TP · 通过/); assert.match(html, /逻辑检验 · 战略假设 · 通过/);
  const review = renderToStaticMarkup(createElement(StrategyReleaseReview, { initiativeId: initiative.id, scope, scopes: [scope], candidates: [candidate], batches: [batch], publications: [], selected: null, onSelect() {}, onStage() {}, onRefresh: async () => {}, onGoalsChanged: async () => {} }));
  assert.match(review, /展示模板/); assert.match(review, /树形地图/); assert.match(review, /条目表/);
  assert.match(review, /核对并正式发布/); assert.match(review, /仅调整呈现，沿用同一锁定版及检验报告/);
});

test('SS08 check panel binds both gates to the locked version and offers revision after return', async () => {
  const { StrategyCheckPanel } = await import('../src/host/ui/StrategyInitiativeGovernance.tsx');
  const passed = renderToStaticMarkup(createElement(StrategyCheckPanel, { initiativeId: initiative.id, candidates: [candidate], batches: [batch], selected: null, onSelect() {}, onStage() {}, onRevise() {}, onRefresh: async () => {} }));
  assert.match(passed, /因果检验 · TOC\/TP/); assert.match(passed, /逻辑检验 · 战略假设/);
  assert.match(passed, /两份结论已绑定同一锁定版/); assert.match(passed, /前往战略发布/);
  const returnedCandidate = { ...candidate, returned: { batchId: batch.batchId, at: '2026-11-21T03:00:00Z' } };
  const returnedBatch: VerificationBatch = { ...batch, state: 'returned', gates: [{ ...gate(0), verdict: 'fail' }, { ...gate(1), status: 'waiting', verdict: undefined }] };
  const returned = renderToStaticMarkup(createElement(StrategyCheckPanel, { initiativeId: initiative.id, candidates: [returnedCandidate], batches: [returnedBatch], selected: null, onSelect() {}, onStage() {}, onRevise() {}, onRefresh: async () => {} }));
  assert.match(returned, /按检验意见修订/); assert.match(returned, /不通过/);
});

test('SS13 exact-version dialog keeps every receipt inside a scrollable body', async () => {
  const { VersionReceiptDialog } = await import('../src/host/ui/StrategyInitiativeGovernance.tsx');
  const html = renderToStaticMarkup(createElement(VersionReceiptDialog, { candidate, anchorReport: report, batch, publication, onClose() {}, onViewReport() {} }));
  assert.match(html, /si-version-dialog/); assert.match(html, /si-dialog-scroll/);
  assert.match(html, /战略定位与增长路径/); assert.match(html, /三年目标与里程碑/); assert.match(html, /资源分配与明确不做/);
  assert.match(html, /检验回执/); assert.match(html, /「触达→再到店→二购」的关键前提和反例已记录/);
  assert.match(html, /发布记录/); assert.match(html, /承接/); assert.match(html, /华东零售事业部/);
  assert.match(html, /cccccccc v1/); assert.match(html, /查看原开题报告/);
  assert.match(html, /锚定开题报告 v1/);
});