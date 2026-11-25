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
  scopeKeys: [scopeKey],
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
  attempts: [{requestId: '77777777-7777-4777-8777-777777777777', status: 'completed', verdict: 'pass', at: '2026-11-21T02:00:00Z'}],
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
  const passed = renderToStaticMarkup(createElement(StrategyCheckPanel, { initiativeId: initiative.id, candidates: [candidate], batches: [batch], selected: null, onSelect() {}, onStage() {}, onRevise() {}, onRefresh: async () => {}, onOpenSource() {} }));
  assert.match(passed, /因果检验 · TOC\/TP/); assert.match(passed, /逻辑检验 · 战略假设/);
  assert.match(passed, /两份结论已绑定同一锁定版/); assert.match(passed, /前往战略发布/);
  const returnedCandidate = { ...candidate, returned: { batchId: batch.batchId, at: '2026-11-21T03:00:00Z' } };
  const returnedBatch: VerificationBatch = { ...batch, state: 'returned', gates: [{ ...gate(0), verdict: 'fail' }, { ...gate(1), status: 'waiting', verdict: undefined }] };
  const returned = renderToStaticMarkup(createElement(StrategyCheckPanel, { initiativeId: initiative.id, candidates: [returnedCandidate], batches: [returnedBatch], selected: null, onSelect() {}, onStage() {}, onRevise() {}, onRefresh: async () => {}, onOpenSource() {} }));
  assert.match(returned, /按检验意见修订/); assert.match(returned, /不通过/);
});

test('I128-04 main session presentation separates dispatch, progress, terminals, disconnect and recovery', async () => {
  const { mainSessionPresentation } = await import('../src/host/ui/strategy-initiative-view.tsx');
  const pending = { requestId: 'request-1' };
  const accepted = { id: 'request-1', status: 'accepted' as const };
  const base = { dispatching: false, pending, lastRun: accepted, busy: true, live: true, snapshotRunning: true, disconnected: false };
  const running = mainSessionPresentation(base);
  assert.equal(running.kind, 'running');
  assert.equal(running.canRecover, false);
  assert.equal(running.canReplace, false);
  assert.doesNotMatch(running.label, /待核|未知/);
  assert.equal(mainSessionPresentation({ ...base, dispatching: true, busy: false, live: false, snapshotRunning: false }).kind, 'sending');
  assert.equal(mainSessionPresentation({ ...base, pending: null, lastRun: { id: 'request-1', status: 'completed' }, busy: false, live: false, snapshotRunning: false }).kind, 'succeeded');
  const failed = mainSessionPresentation({ ...base, lastRun: { id: 'request-1', status: 'failed' }, busy: false, live: false, snapshotRunning: false });
  assert.equal(failed.kind, 'failed'); assert.equal(failed.canRecover, true); assert.equal(failed.canReplace, true);
  const cancelled = mainSessionPresentation({ ...base, lastRun: { id: 'request-1', status: 'cancelled' }, busy: false, live: false, snapshotRunning: false });
  assert.equal(cancelled.kind, 'cancelled'); assert.equal(cancelled.canReplace, true);
  const disconnected = mainSessionPresentation({ ...base, disconnected: true });
  assert.equal(disconnected.kind, 'running'); assert.equal(disconnected.canRecover, true); assert.match(disconnected.label, /观察连接受损/);
  const unknown = mainSessionPresentation({ ...base, lastRun: { id: 'request-1', status: 'unknown' }, busy: false, live: false, snapshotRunning: false });
  assert.equal(unknown.kind, 'unknown'); assert.equal(unknown.canRecover, true); assert.equal(unknown.canReplace, false);
  const reopened = mainSessionPresentation({ ...base, busy: false, live: false, snapshotRunning: false });
  assert.equal(reopened.kind, 'interrupted'); assert.equal(reopened.canRecover, true); assert.equal(reopened.canReplace, true);
  const unmatched = mainSessionPresentation({ ...base, lastRun: { id: 'another-request', status: 'completed' }, busy: true, live: true, snapshotRunning: true });
  assert.equal(unmatched.kind, 'unknown', 'a terminal or running record for another request must not resolve the pending request'); assert.equal(unmatched.canRecover, true); assert.equal(unmatched.canReplace, false);
  assert.equal(mainSessionPresentation({ ...base, pending: null, lastRun: undefined, busy: false, live: false, snapshotRunning: false }).kind, 'idle');
});

test('I128-03 handoff keeps the current department, defaults accurately and distinguishes same-name scopes', async () => {
  const { HandoffDialog } = await import('../src/host/ui/StrategyInitiativeGovernance.tsx');
  const current: GoalScope = { kind: 'department', id: 'new-east', name: '青禾便利东区' };
  const enterprise: GoalScope = { kind: 'enterprise', id: 'ent-existing', name: '既有企业' };
  const sameNameElsewhere: GoalScope = { kind: 'department', id: 'east-2', name: '青禾便利东区', enterpriseId: 'ent-other' };
  const personal: GoalScope = { kind: 'personal', id: 'self', name: '个人工作' };
  const html = renderToStaticMarkup(createElement(HandoffDialog, {
    initiativeId: initiative.id, publication, candidate, scope: current,
    scopes: [enterprise, sameNameElsewhere, personal], onDone: async () => {}, onClose() {},
  }));
  assert.match(html, /<option value="department::new-east" selected="">/, 'current scope is present and selected even when the catalog is non-empty');
  const deduplicated = renderToStaticMarkup(createElement(HandoffDialog, {
    initiativeId: initiative.id, publication, candidate, scope: current,
    scopes: [current, enterprise, sameNameElsewhere, personal], onDone: async () => {}, onClose() {},
  }));
  assert.equal((deduplicated.match(/value="department::new-east"/g) ?? []).length, 1, 'stable identity deduplicates the current option');
  assert.match(html, /当前战略范围/);
  assert.match(html, /ent-other/);
  assert.match(html, /east-2/);
  assert.match(html, /保存前归属/);
  assert.match(html, /历史误存个人范围/);
  assert.match(html, /提出目标修订/);
});

test('I128-05 verification sources are actionable and retain exact identities and fingerprints', async () => {
  const { StrategyCheckPanel } = await import('../src/host/ui/StrategyInitiativeGovernance.tsx');
  const fileId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
  const sourcedBatch: VerificationBatch = { ...batch, gates: [{ ...gate(0), sources: [
    { kind: 'kickoff', ref: '1', sha256: 'a'.repeat(64) },
    { kind: 'candidate', ref: `${candidateId}:1`, sha256: 'b'.repeat(64) },
    { kind: 'file', ref: '010_draw/上期经营复盘.pdf', fileId, sha256: 'c'.repeat(64) },
    { kind: 'public', ref: 'https://example.com/synthetic-source', sha256: 'd'.repeat(64) },
  ] }, { ...gate(1), sources: undefined }] };
  const html = renderToStaticMarkup(createElement(StrategyCheckPanel, {
    initiativeId: initiative.id, candidates: [candidate], batches: [sourcedBatch], selected: null,
    onSelect() {}, onStage() {}, onRevise() {}, onRefresh: async () => {}, onOpenSource() {},
  }));
  assert.equal((html.match(/<button[^>]*>核对依据/g) ?? []).length, 4);
  assert.match(html, /<button[^>]*type="button"/);
  assert.match(html, new RegExp(`${candidateId}:1`));
  assert.match(html, new RegExp(fileId));
  assert.match(html, new RegExp('a'.repeat(64)));
  assert.match(html, new RegExp('d'.repeat(64)));
});

test('SS13 exact-version dialog keeps every receipt inside a scrollable body', async () => {
  const { VersionReceiptDialog } = await import('../src/host/ui/StrategyInitiativeGovernance.tsx');
  const html = renderToStaticMarkup(createElement(VersionReceiptDialog, { candidate, anchorReport: report, batch, publication, onClose() {}, onViewReport() {}, onOpenSession() {} }));
  assert.match(html, /si-version-dialog/); assert.match(html, /si-dialog-scroll/);
  assert.match(html, /战略定位与增长路径/); assert.match(html, /三年目标与里程碑/); assert.match(html, /资源分配与明确不做/);
  assert.match(html, /检验回执/); assert.match(html, /「触达→再到店→二购」的关键前提和反例已记录/);
  assert.match(html, /发布记录/); assert.match(html, /承接/); assert.match(html, /华东零售事业部/);
  assert.match(html, /cccccccc v1/); assert.match(html, /查看原开题报告/);
  assert.match(html, /锚定开题报告 v1/);
  assert.match(html, /查看候选会话/, 'exact-version dialog offers the original candidate session entry');
  assert.match(html, /尝试 1 · completed · pass/, 'every gate attempt keeps its true terminal state');
});

test('I131-A pending upload recovery UI shows operationId, fingerprint, launch guidance and reload reselect path', async () => {
  const view = await import('../src/host/ui/strategy-initiative-view.tsx') as any;
  assert.equal(typeof view.matchPendingUploadFile, 'function', 'matchPendingUploadFile helper must exist');
  const pending = {
    operationId: '12121212-1212-4121-8121-121212121212',
    initiativeId: initiative.id,
    workspaceScopeKey: scopeKey,
    directory: '010_draw' as const,
    name: '门店摘要.txt',
    size: 128,
    sha256: 'e'.repeat(64),
    status: 'unknown' as const,
    unreachable: true,
    createdAt: '2026-11-24T10:00:00Z',
  };
  const unreachableHtml = renderToStaticMarkup(createElement(view.InitiativeFilePanel, {
    files: [], reports: [], candidates: [], batches: [], scopeKey,
    pendingUpload: pending, hasPendingUploadPayload: false,
    onUpload() {}, onOpenFile() {}, onOpenReport() {},
    onCheckPendingUpload() {}, onRetryPendingUpload() {}, onReselectPendingUpload() {}, onDismissPendingUpload() {},
  }));
  assert.match(unreachableHtml, /12121212-1212-4121-8121-121212121212/);
  assert.match(unreachableHtml, /门店摘要\.txt/);
  assert.match(unreachableHtml, /UNKNOWN/);
  assert.match(unreachableHtml, /启动 OptraCall\.command/);
  assert.match(unreachableHtml, /核对原上传结果/);
  assert.match(unreachableHtml, /＋ 上传资料/, 'explicit new upload remains available');

  const reloadedNotFoundHtml = renderToStaticMarkup(createElement(view.InitiativeFilePanel, {
    files: [], reports: [], candidates: [], batches: [], scopeKey,
    pendingUpload: { ...pending, status: 'not-found' as const, unreachable: false, checkedAt: '2026-11-24T10:01:00Z' },
    hasPendingUploadPayload: false,
    onUpload() {}, onOpenFile() {}, onOpenReport() {},
    onCheckPendingUpload() {}, onRetryPendingUpload() {}, onReselectPendingUpload() {}, onDismissPendingUpload() {},
  }));
  assert.match(reloadedNotFoundHtml, /重选原文件并按原编号重试/);
  assert.match(reloadedNotFoundHtml, /SHA-256/);

  const inMemoryNotFoundHtml = renderToStaticMarkup(createElement(view.InitiativeFilePanel, {
    files: [], reports: [], candidates: [], batches: [], scopeKey,
    pendingUpload: { ...pending, status: 'not-found' as const, unreachable: false, checkedAt: '2026-11-24T10:01:00Z' },
    hasPendingUploadPayload: true,
    onUpload() {}, onOpenFile() {}, onOpenReport() {},
    onCheckPendingUpload() {}, onRetryPendingUpload() {}, onReselectPendingUpload() {}, onDismissPendingUpload() {},
  }));
  assert.match(inMemoryNotFoundHtml, /按原操作编号重试/);
});

test('I131-C ReviseDialog shows exact target baseline preview, bound clarification, empty-reason and main discussion entry', async () => {
  const { ReviseDialog } = await import('../src/host/ui/StrategyInitiativeWorkbench.tsx') as any;
  const targets = [
    { blockId: 'positioning', label: '定位与增长', text: '聚焦华东成熟门店会员复购。' },
    { blockId: 'budget', label: '预算与资源', text: '2027 试点投入预算 80 万元。' },
  ];
  const baseProps = {
    title: '限定修改战略候选',
    baseLabel: '会员复购优先 · v1',
    baseSha256: 'b'.repeat(64),
    targets,
    maxText: 20000,
    propose: async () => ({ proposal: { proposalId: 'p1' } }),
    readProposal: async () => ({ proposal: { status: 'pending' } }),
    onSubmit: async () => ({}),
    onDone: async () => {},
    onClose() {},
    readMainDiscussion: async () => null,
  };
  const clarifiedHtml = renderToStaticMarkup(createElement(ReviseDialog, {
    ...baseProps,
    initialFeedback: {
      proposalId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      requestId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      blockId: 'positioning',
      blockLabel: '定位与增长',
      status: 'ended',
      feedback: {
        requestId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        outcome: 'completed',
        replyText: '预算在「预算与资源」块，请确认改选后再拟改。',
      },
    },
  }));
  assert.match(clarifiedHtml, /聚焦华东成熟门店会员复购/, 'renders selected target baseline text preview');
  assert.match(clarifiedHtml, /bbbbbbbbbbbb/, 'renders baseline fingerprint prefix');
  assert.match(clarifiedHtml, /预算在「预算与资源」块，请确认改选后再拟改/, 'displays exact Agent clarification');
  assert.match(clarifiedHtml, /查看主会话原讨论/, 'provides main discussion entry');

  const emptyReasonHtml = renderToStaticMarkup(createElement(ReviseDialog, {
    ...baseProps,
    initialFeedback: {
      proposalId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      requestId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
      blockId: 'positioning',
      blockLabel: '定位与增长',
      status: 'ended',
      feedback: { requestId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', outcome: 'completed' },
    },
  }));
  assert.match(emptyReasonHtml, /未返回文字说明/);
  assert.match(emptyReasonHtml, /查看主会话原讨论/);

  const cancelledHtml = renderToStaticMarkup(createElement(ReviseDialog, {
    ...baseProps,
    initialFeedback: {
      proposalId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
      requestId: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
      blockId: 'positioning',
      blockLabel: '定位与增长',
      status: 'failed',
      feedback: { requestId: 'ffffffff-ffff-4fff-8fff-ffffffffffff', outcome: 'cancelled', failureDetail: '本轮拟改已取消；原稿未改动。' },
    },
  }));
  assert.match(cancelledHtml, /本轮拟改已取消/);
});

test('I131-D CandidateBody, StrategyReleaseReview and PublishConfirmDialog explain 0-goal impact upfront and list goals when present', async () => {
  const { CandidateBody } = await import('../src/host/ui/strategy-initiative-view.tsx');
  const { PublishConfirmDialog, StrategyReleaseReview } = await import('../src/host/ui/StrategyInitiativeGovernance.tsx');
  const zeroGoalCandidate: CandidateVersion = { ...candidate, goals: [] };

  const bodyEmpty = renderToStaticMarkup(createElement(CandidateBody, { candidate: zeroGoalCandidate }));
  assert.match(bodyEmpty, /可承接战略目标（0 个）/);
  assert.match(bodyEmpty, /带入目标管理/);

  const bodyWithGoals = renderToStaticMarkup(createElement(CandidateBody, { candidate }));
  assert.match(bodyWithGoals, /可承接战略目标（2 个）/);
  assert.match(bodyWithGoals, /90 天二购率达到 12%/);

  const reviewEmpty = renderToStaticMarkup(createElement(StrategyReleaseReview, {
    initiativeId: initiative.id, scope, scopes: [scope], candidates: [zeroGoalCandidate], batches: [batch],
    publications: [], selected: null, onSelect() {}, onStage() {}, onRefresh: async () => {}, onGoalsChanged: async () => {},
  }));
  assert.match(reviewEmpty, /可承接目标：0 个/);
  assert.match(reviewEmpty, /战略记录/);
  assert.match(reviewEmpty, /核对并正式发布/, '0-goal strategy remains legally publishable');

  const reviewWithGoals = renderToStaticMarkup(createElement(StrategyReleaseReview, {
    initiativeId: initiative.id, scope, scopes: [scope], candidates: [candidate], batches: [batch],
    publications: [], selected: null, onSelect() {}, onStage() {}, onRefresh: async () => {}, onGoalsChanged: async () => {},
  }));
  assert.match(reviewWithGoals, /可承接目标（2 个/);
  assert.match(reviewWithGoals, /试点门店触达率达到 80%/);

  const publishEmpty = renderToStaticMarkup(createElement(PublishConfirmDialog, {
    initiativeId: initiative.id, candidate: zeroGoalCandidate, batch, template: '树形地图',
    onPublished: async () => {}, onClose() {},
  }));
  assert.match(publishEmpty, /可承接目标 0 个/);
  assert.match(publishEmpty, /战略记录/);
  assert.match(publishEmpty, /确认发布/);
});

test('I131-E InitiativeEditorDialog marks title, scope name and scope id as required while keeping enterpriseId optional', async () => {
  const { InitiativeEditorDialog } = await import('../src/host/ui/StrategyInitiativeWorkbench.tsx') as any;
  assert.equal(typeof InitiativeEditorDialog, 'function', 'InitiativeEditorDialog should be exported for UI verification');
  const html = renderToStaticMarkup(createElement(InitiativeEditorDialog, {
    onClose() {},
    onSaved: async () => {},
  }));
  assert.match(html, /事项名称\s*<span[^>]*>必填<\/span>/);
  assert.match(html, /范围名称\s*<span[^>]*>必填<\/span>/);
  assert.match(html, /归属标识\s*<span[^>]*>必填<\/span>/);
  assert.match(html, /id="si-scope-id-0"[^>]*aria-required="true"/);
  assert.match(html, /上层企业标识（可选）/);
});

test('I131-A-Rework-1 multi-entry pending upload ledger preserves prior UNKNOWN across subsequent uploads, refresh and scope isolation', async () => {
  const view = await import('../src/host/ui/strategy-initiative-view.tsx') as any;
  assert.equal(typeof view.upsertPendingUpload, 'function', 'upsertPendingUpload helper must exist');
  assert.equal(typeof view.removePendingUpload, 'function', 'removePendingUpload helper must exist');
  assert.equal(typeof view.parsePendingUploadLedger, 'function', 'parsePendingUploadLedger helper must exist');

  const op1 = {
    operationId: '11111111-1111-4111-8111-111111111111',
    initiativeId: initiative.id,
    workspaceScopeKey: scopeKey,
    directory: '010_draw' as const,
    name: 'first-unknown.txt',
    size: 512,
    sha256: '1'.repeat(64),
    status: 'unknown' as const,
    unreachable: false,
    errorMessage: '503',
    createdAt: '2026-11-24T10:00:00Z',
  };
  const op2 = {
    operationId: '22222222-2222-4222-8222-222222222222',
    initiativeId: initiative.id,
    workspaceScopeKey: scopeKey,
    directory: '020_clean' as const,
    name: 'second-new.txt',
    size: 256,
    sha256: '2'.repeat(64),
    status: 'uploading' as const,
    createdAt: '2026-11-24T10:01:00Z',
  };
  const op3 = {
    operationId: '33333333-3333-4333-8333-333333333333',
    initiativeId: initiative.id,
    workspaceScopeKey: scopeKey,
    scopeKey,
    directory: '010_draw' as const,
    name: 'third-unknown.txt',
    size: 128,
    sha256: '3'.repeat(64),
    status: 'unknown' as const,
    createdAt: '2026-11-24T10:02:00Z',
  };

  let ledger = view.upsertPendingUpload([], op1);
  ledger = view.upsertPendingUpload(ledger, op2);
  assert.equal(ledger.length, 2, 'new upload must not overwrite prior UNKNOWN');
  // Second upload succeeds or is deterministically rejected -> only op2 removed, op1 preserved
  ledger = view.removePendingUpload(ledger, op2.operationId);
  assert.equal(ledger.length, 1);
  assert.equal(ledger[0].operationId, op1.operationId);
  // Third upload also becomes UNKNOWN -> both op1 and op3 preserved
  ledger = view.upsertPendingUpload(ledger, op3);
  assert.equal(ledger.length, 2);

  // Refresh normalization & scope isolation
  const reloaded = view.parsePendingUploadLedger(JSON.stringify([...ledger, op2]), initiative.id, scopeKey);
  assert.equal(reloaded.length, 3);
  assert.equal(reloaded.find((item: any) => item.operationId === op2.operationId)?.status, 'unknown', 'in-flight uploading normalizes to unknown after refresh');
  assert.deepEqual(view.parsePendingUploadLedger(JSON.stringify(ledger), initiative.id, 'department::other'), [], 'other scope must not see current scope pending uploads');
  // Legacy single-object storage upgrades cleanly
  const upgraded = view.parsePendingUploadLedger(JSON.stringify(op1), initiative.id, scopeKey);
  assert.equal(upgraded.length, 1);
  assert.equal(upgraded[0].operationId, op1.operationId);

  // InitiativeFilePanel renders multiple pending uploads simultaneously with per-item payload awareness
  const html = renderToStaticMarkup(createElement(view.InitiativeFilePanel, {
    files: [], reports: [], candidates: [], batches: [], scopeKey,
    pendingUploads: [op1, op3],
    pendingUploadPayloadIds: new Set([op3.operationId]),
    onUpload() {}, onOpenFile() {}, onOpenReport() {},
    onCheckPendingUpload() {}, onRetryPendingUpload() {}, onReselectPendingUpload() {}, onDismissPendingUpload() {},
  }));
  assert.match(html, /first-unknown\.txt/);
  assert.match(html, /third-unknown\.txt/);
  assert.match(html, /11111111-1111-4111-8111-111111111111/);
  assert.match(html, /33333333-3333-4333-8333-333333333333/);
  assert.match(html, /重选原文件并按原编号重试/, 'op1 without memory payload offers verified re-select');
  assert.match(html, /按原操作编号重试/, 'op3 with memory payload offers in-memory retry');
});

test('I131-C-Rework-3 ReviseDialog freezes inputs while submitting and binds diff/waiting strictly to submitted snapshot', async () => {
  const { ReviseDialog } = await import('../src/host/ui/StrategyInitiativeWorkbench.tsx') as any;
  const targets = [
    { blockId: 'positioning', label: '定位与增长', text: '被后台刷新改写的定位正文。' },
    { blockId: 'budget', label: '预算与资源', text: '2027 试点投入预算 80 万元。' },
  ];
  const baseProps = {
    title: '限定修改战略候选',
    baseLabel: '会员复购优先 · v1',
    baseSha256: '9'.repeat(64),
    targets,
    maxText: 20000,
    propose: async () => ({ proposal: { proposalId: 'p1' } }),
    readProposal: async () => ({ proposal: { status: 'pending' } }),
    onSubmit: async () => ({}),
    onDone: async () => {},
    onClose() {},
  };

  // 1. Submitting state disables both block select and intent textarea
  const submittingHtml = renderToStaticMarkup(createElement(ReviseDialog, { ...baseProps, initialBusy: true }));
  assert.match(submittingHtml, /<select[^>]*id="si-revise-block"[^>]*disabled/, 'block select must be disabled while submitting');
  assert.match(submittingHtml, /<textarea[^>]*id="si-revise-request"[^>]*disabled/, 'intent textarea must be disabled while submitting');

  // 2. Diff view strictly renders submitted B1 snapshot, never drifted live props or B2
  const submitted = {
    proposalId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    requestId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    baseLabel: '会员复购优先 · v1',
    baseSha256: '1'.repeat(64),
    blockId: 'positioning',
    blockLabel: '定位与增长',
    baselineText: '聚焦华东成熟门店会员复购（提交时准确原文）。',
    request: '仅在定位块补充会员增长取舍',
  };
  const diffHtml = renderToStaticMarkup(createElement(ReviseDialog, {
    ...baseProps,
    initialStep: 'diff',
    initialSubmitted: submitted,
    initialProposedText: '聚焦华东成熟门店会员复购，先试点 2 家店。',
  }));
  assert.match(diffHtml, /定位与增长/, 'diff title binds to submitted block');
  assert.match(diffHtml, /聚焦华东成熟门店会员复购（提交时准确原文）/, 'diff before-text binds to submitted baselineText, not drifted live prop');
  assert.equal(diffHtml.includes('被后台刷新改写的定位正文'), false, 'drifted live prop must not replace submitted baselineText');
  assert.equal(diffHtml.includes('预算与资源'), false, 'other block must not bleed into submitted diff');
  assert.match(diffHtml, /当前正文已发生变化/, 'warns when live props drifted after submission');
});