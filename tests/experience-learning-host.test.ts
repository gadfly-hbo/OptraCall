import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { startTestHost } from './fixtures/host-process.ts';
import { startToolProvider, providerMessageText } from './fixtures/tool-provider.ts';
import { readJson } from './fixtures/joint-context.ts';
import { sessionEvents } from './fixtures/session-events.ts';
import { startS4GraphHost } from './fixtures/s4-host-graph.ts';
import type { SemanticGraphResult } from '../extensions/business-plugins/semantic-context/graph.ts';

type Host = Awaited<ReturnType<typeof startTestHost>>;
async function turn(host: Host, projectId: string, taskId: string, text: string, extra = {}) {
  const stream = await sessionEvents(host, projectId, taskId);
  try {
    await readJson(await host.request(`/api/projects/${projectId}/tasks/${taskId}/messages`, 'POST', { requestId: randomUUID(), text, ...extra }), 202);
    const terminal = await stream.terminal; assert.equal(terminal.type, 'run.settled'); if (terminal.type === 'run.settled') assert.equal(terminal.outcome, 'completed', JSON.stringify(terminal));
  } finally { await stream.close(); }
}

test('M6 actual Host/Pi/native/business stores: closed historical sources, optional v2 candidate, independent retained body, exclusion, and stop-new/read-old', { timeout: 60_000 }, async t => {
  const provider = await startToolProvider(); t.after(() => provider.close());
  let host = await startTestHost(); t.after(() => host.close());
  await readJson(await host.request('/api/configuration', 'PUT', { name: 'M6工程合成', provider: 'openai-compatible', baseUrl: provider.baseUrl, model: 'synthetic', apiKey: 'synthetic-m6-only' }));
  await readJson(await host.request('/api/cases/storage/initialize', 'POST', {}));
  const { project: oldProject } = await readJson(await host.request('/api/projects', 'POST', { name: '原历史合成项目' }), 201);
  const { task: oldTask } = await readJson(await host.request(`/api/projects/${oldProject.id}/tasks`, 'POST', { name: '原任务' }), 201);
  let { case: oldCase } = await readJson(await host.request('/api/cases', 'POST', { operationId: randomUUID(), title: 'M6合成历史事项' }), 201);
  await readJson(await host.request(`/api/cases/${oldCase.id}/projects`, 'POST', { operationId: randomUUID(), expectedRevision: oldCase.revision, projectId: oldProject.id }));
  oldCase = (await readJson(await host.request(`/api/cases/${oldCase.id}`))).case;
  provider.setResponder(({ recentToolResults }) => recentToolResults.length ? { text: '有限策略并非已执行。' } : { calls: [{ name: 'save_case_decision_draft', arguments: { kind: 'strategy', expectedRevision: 0, payload: { title: '先核时点', proposal: 'M6_EXACT_HISTORICAL_STRATEGY，效果未验证。' } } }] });
  await turn(host, oldProject.id, oldTask.id, '历史任务合成出稿', { caseContext: { caseId: oldCase.id, caseRevision: oldCase.revision, projectWorkRevision: 0, selectedReferenceIds: [] } });
  const listing = await readJson(await host.request(`/api/cases/${oldCase.id}/decisions`)), card = listing.items[0]; assert.ok(card);
  const cardRef = { type: 'case-decision', caseStoreId: listing.caseStoreId, caseId: oldCase.id, recordId: card.recordId, revision: 1 };
  const { choice } = await readJson(await host.request(`/api/cases/${oldCase.id}/decisions/${card.recordId}/choice`, 'POST', { operationId: randomUUID(), caseStoreId: listing.caseStoreId, strategyRef: cardRef, choice: 'gather_evidence', reason: '仍需证据', expectedPreviousChoiceId: null }));
  const choiceRef = { type: 'case-choice', caseStoreId: listing.caseStoreId, caseId: oldCase.id, choiceId: choice.choiceId };
  oldCase = (await readJson(await host.request(`/api/cases/${oldCase.id}`))).case;
  await readJson(await host.request(`/api/cases/${oldCase.id}/close`, 'POST', { operationId: randomUUID(), expectedRevision: oldCase.revision, reason: '合成结案，历史保持' }));
  const historicalNative = await readFile((await readJson(await host.request(`/api/projects/${oldProject.id}/tasks/${oldTask.id}`))).task.sessionFile);
  const { project } = await readJson(await host.request('/api/projects', 'POST', { name: '无Case当前合成项目' }), 201);
  const { task } = await readJson(await host.request(`/api/projects/${project.id}/tasks`, 'POST', { name: '当前普通任务' }), 201);
  const candidate = { content: { kind: 'experience', title: 'M6候选经验', bodyMd: 'M6_CANDIDATE_PRIVATE_BODY；结合反例核范围，不推定收益。', aliases: [], scope: 'M6_CANDIDATE_PRIVATE_SCOPE', caution: '仅合成工程资料' }, sourceRefs: [cardRef, choiceRef] };
  const plan = [{ name: 'read_case_sources', arguments: { action: 'find', query: '先核时点' } }, { name: 'read_case_sources', arguments: { action: 'read', target: cardRef } }, { name: 'read_case_sources', arguments: { action: 'read', target: choiceRef } }, { name: 'record_agent_candidate', arguments: candidate }];
  provider.setResponder(({ recentToolResults }) => recentToolResults.length < plan.length ? { calls: [plan[recentToolResults.length]!] } : { text: '保留失败与未知，不判断因果。' });
  await turn(host, project.id, task.id, '普通任务按需回看关闭事项，可以自主留候选。');
  const lookup = await readJson(await host.request('/api/personal-retention/candidates/lookup?view=all&includeBody=true'));
  assert.equal(lookup.experienceLearningAvailable, true); const found = lookup.rows.find((r: any) => r.ref.projectId === project.id); assert.ok(found); assert.equal(found.details.schemaVersion, 2); assert.deepEqual(found.details.sourceRefs, [cardRef, choiceRef]);
  const source = { type: 'agent-candidate', candidate: found.ref };
  const humanSource = await readJson(await host.request('/api/personal-retention/sources/read', 'POST', { ref: source })); assert.match(humanSource.text, /M6_CANDIDATE_PRIVATE_BODY/);
  const { material } = await readJson(await host.request('/api/enterprise-materials', 'POST', { title: '人整理的独立经验', body: 'M6_FORMAL_INDEPENDENT_BODY', scope: '独立范围' }), 201);
  const itemRoute = `/api/personal-retention/items/${material.id}`, metadata = { kind: 'experience', aliases: [], caution: '待验证', sourceRefs: [source] };
  await readJson(await host.request(itemRoute + '/draft', 'POST', { expectedRevision: 0, metadata }));
  const editor = await readJson(await host.request(itemRoute + '/editor'));
  const { decision } = await readJson(await host.request(itemRoute + '/retain', 'POST', { operationId: randomUUID(), expectedRevision: 1, target: editor.draftTarget, metadata, personalLabel: null }), 201);
  const retainedTarget = { type: 'retained', ...decision.contentRef, decisionId: decision.operationId, expectedBodySha256: decision.bodySha256 };
  await readJson(await host.request('/api/personal-retention/candidates/controls', 'POST', { operationId: randomUUID(), target: found.ref, expectedTargetRevision: 0, note: null, action: 'exclude' }), 201);
  let before = provider.requests.length;
  provider.setResponder(({ recentToolResults }) => recentToolResults.length ? { text: '排除候选不供给；独立正文仍可参考。' } : { calls: [{ name: 'read_personal_context', arguments: { target: retainedTarget, part: 'source', sourceIndex: 0 } }] });
  await turn(host, project.id, task.id, '间接来源应尊重排除。');
  const calls = provider.requests.slice(before), toolPayload = calls.flatMap(r => r.body.messages ?? []).filter(m => m.role === 'tool').map(m => providerMessageText(m.content)).join('\n');
  // Prior native transcript remains preserved; the newly delivered source must not return excluded text.
  const latestTool = [...calls.at(-1)!.body.messages!].reverse().find(m => m.role === 'tool');
  assert.ok(!providerMessageText(latestTool?.content).includes('M6_CANDIDATE_PRIVATE_BODY')); assert.ok(!providerMessageText(latestTool?.content).includes('M6_CANDIDATE_PRIVATE_SCOPE')); assert.ok(toolPayload);
  provider.setResponder(({ recentToolResults }) => recentToolResults.length ? { text: '独立正式正文仍是原稿。' } : { calls: [{ name: 'read_personal_context', arguments: { target: retainedTarget } }] });
  await turn(host, project.id, task.id, '读取独立保留正文。'); assert.ok(JSON.stringify(provider.requests.at(-1)?.body.messages).includes('M6_FORMAL_INDEPENDENT_BODY'));
  const savedBefore = await readJson(await host.request(itemRoute)); const v2 = await readFile((await readJson(await host.request(`/api/projects/${project.id}/tasks/${task.id}`))).task.sessionFile);
  await host.close(); host = await startTestHost({ dataRoot: host.dataRoot, projectsRoot: host.projectsRoot, disableExperienceLearning: true });
  assert.equal((await readJson(await host.request('/api/personal-retention/candidates/lookup?view=all'))).experienceLearningAvailable, false);
  assert.deepEqual(await readJson(await host.request(itemRoute)), savedBefore);
  await readJson(await host.request(itemRoute + '/draft', 'POST', { expectedRevision: savedBefore.item.revision, metadata: { ...metadata, caution: '关闭新增写入后仍维护已存引用' } }));
  const { material: newMaterial } = await readJson(await host.request('/api/enterprise-materials', 'POST', { title: '仅测试停止新来源', body: '合成', scope: '' }), 201);
  assert.equal((await host.request(`/api/personal-retention/items/${newMaterial.id}/draft`, 'POST', { expectedRevision: 0, metadata })).status, 409);
  assert.deepEqual(await readFile((await readJson(await host.request(`/api/projects/${project.id}/tasks/${task.id}`))).task.sessionFile), v2);
  assert.deepEqual(await readFile((await readJson(await host.request(`/api/projects/${oldProject.id}/tasks/${oldTask.id}`))).task.sessionFile), historicalNative);
});

test('S6 fixed L2 evidence survives working-file changes and reaches Case, human feedback and an experience candidate', {
  skip: !process.env.OPTRACALL_S4_FIXTURE || !process.env.OPTRACALL_S4_PYTHON ? 'NOT_RUN: explicit isolated graph fixture and pinned Python required' : false,
  timeout: 120_000,
}, async t => {
  const f = await startS4GraphHost({ fixtureRoot: process.env.OPTRACALL_S4_FIXTURE!, python: process.env.OPTRACALL_S4_PYTHON! });
  t.after(() => f.close()); t.diagnostic(`S6 retained synthetic root: ${f.root}`);
  // The taskless asset fixture has no installed model profile. Set its copied
  // project default to this fixture's local provider before exercising feedback.
  // This is isolated setup, not a product migration or an authority bypass.
  const metadataPath = path.join(f.dataRoot, 'projects', f.projectId, 'project.json');
  const metadata = JSON.parse(await readFile(metadataPath, 'utf8'));
  metadata.configuration = f.task.configuration;
  await writeFile(metadataPath, JSON.stringify(metadata, null, 2) + '\n');
  await f.restart();
  await readJson(await f.request('/api/cases/storage/initialize', 'POST', {}));
  let { case: decisionCase } = await readJson(await f.request('/api/cases', 'POST', { operationId: randomUUID(), title: 'S6合成口径复核' }), 201);
  await readJson(await f.request(`/api/cases/${decisionCase.id}/projects`, 'POST', { operationId: randomUUID(), expectedRevision: decisionCase.revision, projectId: f.projectId }));
  decisionCase = (await readJson(await f.request(`/api/cases/${decisionCase.id}`))).case;
  const reportPath = '060_reports/s6-fixed.md', attachmentPath = '020_clean/s6-basis.json';
  const report = 'S6_FIXED_REPORT：仅合成工程接缝；适用条件待核，不认定经营效果。';
  const citationId = randomUUID(), source = { type: 'citation', projectId: f.projectId, citationId, target: { type: 'attachment', attachmentIndex: 0 } };
  const basisTarget = { type: 'source', source }, dataContext = await readJson(await f.request(`/api/projects/${f.projectId}/data-context`));
  const digest = (text: string) => createHash('sha256').update(text).digest('hex');
  let attachment = '';
  const definitions = [f.build.keys.C04, f.build.keys.method, f.build.keys.comparability];
  f.provider.setResponder(({ recentToolResults }) => {
    const step = recentToolResults.length;
    if (step < definitions.length) return { calls: [{ name: 'read_semantic_context', arguments: { action: 'graph', operation: 'definition', nodeId: definitions[step] } }] };
    if (step === 3) {
      const results = recentToolResults.slice(0, 3).map(message => JSON.parse(providerMessageText(message.content)) as SemanticGraphResult);
      for (const [index, result] of results.entries()) {
        assert.equal(result.snapshot?.id, f.build.snapshotId); assert.equal(result.nodes[0]?.id, definitions[index]);
        assert.equal(result.coverage.complete, true);
      }
      assert.ok(results[1]!.nodes[0]!.metadata.sourceRefs.some(ref => ref.kind === 'sap-method' && ref.publishedHash === f.build.refs.method.publishedHash));
      attachment = JSON.stringify({ snapshot: results[0]!.snapshot, definitions: results.map(result => ({ state: result.state, coverage: result.coverage, node: result.nodes[0] })), methodRef: f.build.refs.method,
        scope: 'S6_SYNTHETIC_SCOPE_ONLY', limitations: 'S6_EFFECT_UNKNOWN：该记录只声明当时取得的定义和条件，不证明适用、采用或正确。' },
      (key, value) => key === 'sourceHandle' || key === 'continuation' ? undefined : value, 2);
      assert.doesNotMatch(attachment, /sourceHandle|continuation/);
      return { calls: [{ name: 'write', arguments: { path: path.join(f.projectsRoot, f.projectId, reportPath), content: report } }] };
    }
    if (step === 4) return { calls: [{ name: 'write', arguments: { path: path.join(f.projectsRoot, f.projectId, attachmentPath), content: attachment } }] };
    if (step === 5) return { calls: [{ name: 'record_analysis_sources', arguments: { operationId: citationId, citationId, baseIndexRevision: dataContext.index.revision,
      report: { path: reportPath, sha256: digest(report), bytes: Buffer.byteLength(report) }, attachments: [{ path: attachmentPath, sha256: digest(attachment), bytes: Buffer.byteLength(attachment) }],
      selections: [{ datasetId: f.build.refs.input.datasetId, inputVersionId: f.build.refs.input.inputVersionId, descriptionRevisionId: f.build.refs.description.descriptionRevisionId }],
      conceptRefs: [], sapRefs: f.build.refs.metrics.map(({ kind, ...ref }: any) => ref), declaration: 'S6合成Agent声明，保留准确版本与限制；不表示专业核验通过。' } }] };
    if (step === 6) return { calls: [{ name: 'save_case_decision_draft', arguments: { kind: 'strategy', expectedRevision: 0,
      payload: { title: '先核条件再决定', proposal: 'S6_FIXED_STRATEGY', conditions: '引用固定定义和条件，适用性尚待判断。', limitations: '经营效果未知。' },
      references: [{ relation: 'background', target: basisTarget, note: '固定附件保留准确版本，不保存临时查询句柄。' }] } }] };
    return { text: report };
  });
  const requestId = randomUUID();
  await readJson(await f.request(f.taskRoute + '/messages', 'POST', { requestId, text: '按需查定义、方法及条件，自主保留依据并起草Case策略。',
    caseContext: { caseId: decisionCase.id, caseRevision: decisionCase.revision, projectWorkRevision: 0, selectedReferenceIds: [] } }), 202);
  const original = await f.settled(requestId); assert.equal(original.task.lastRun.status, 'completed');
  const native = await readFile(original.task.sessionFile);
  const entries = native.toString().trim().split('\n').map(line => JSON.parse(line));
  const receipts = entries.filter(entry => entry.message?.role === 'toolResult');
  assert.equal(receipts.length, 7); assert.ok(receipts.every(entry => !entry.message.isError), JSON.stringify(receipts));
  const listing = await readJson(await f.request(`/api/cases/${decisionCase.id}/decisions`)), card = listing.items[0]; assert.ok(card);
  assert.deepEqual(card.references[0].target, basisTarget);
  const cardRef = { type: 'case-decision', caseStoreId: listing.caseStoreId, caseId: decisionCase.id, recordId: card.recordId, revision: 1 };
  // A later working-file edit cannot replace the original M2 citation's bytes.
  await writeFile(path.join(f.projectsRoot, f.projectId, attachmentPath), 'S6_LATER_WORKING_FILE');
  const oldBasis = await readJson(await f.request(`/api/cases/${decisionCase.id}/decisions/source`, 'POST', { target: basisTarget }));
  assert.match(oldBasis.text, /S6_SYNTHETIC_SCOPE_ONLY/); assert.doesNotMatch(oldBasis.text, /S6_LATER_WORKING_FILE/);
  assert.ok(oldBasis.text.includes(f.build.refs.method.publishedHash));
  const { choice } = await readJson(await f.request(`/api/cases/${decisionCase.id}/decisions/${card.recordId}/choice`, 'POST', {
    operationId: randomUUID(), caseStoreId: listing.caseStoreId, strategyRef: cardRef, choice: 'gather_evidence', reason: '适用性与效果待核。', expectedPreviousChoiceId: null }));
  const { item } = await readJson(await f.request('/api/decision-board/items', 'POST', { projectId: f.projectId, title: '合成复核行动', rationale: '保留未知' }), 201);
  await readJson(await f.request(`/api/decision-board/items/${item.id}/adopt`, 'POST', {}));
  const { task: action } = await readJson(await f.request(`/api/decision-board/items/${item.id}/tasks`, 'POST', { title: '合成条件核对' }), 201);
  await readJson(await f.request(`/api/cases/${decisionCase.id}/decisions/${card.recordId}/governance`, 'POST', {
    operationId: randomUUID(), caseStoreId: listing.caseStoreId, expectedRevision: 1, action: 'add_reference',
    reference: { relation: 'action', target: { type: 'board-task', projectId: f.projectId, itemId: item.id, taskId: action.id }, note: null } }));
  await readJson(await f.request(`/api/decision-board/tasks/${action.id}/status`, 'POST', { status: 'doing' }));
  await readJson(await f.request(`/api/decision-board/tasks/${action.id}/status`, 'POST', { status: 'done' }));
  const feedbackInput = { operationId: randomUUID(), expectedLatestRevisionId: null, adopted: true, outcome: 'S6_FIXED_FEEDBACK：仅合成行动已登记', metricDelta: '', review: 'S6_EFFECT_UNKNOWN', score: null, effect: 'unknown' };
  const { feedback } = await readJson(await f.request(`/api/decision-board/tasks/${action.id}/feedback`, 'POST', feedbackInput));
  const { preview } = await readJson(await f.request('/api/decision-feedback/preview', 'POST', { boardTaskId: action.id, feedbackRevisionId: feedback.revisionId,
    question: '回看固定定义、人的选择与本次反馈，保留适用性未知。', taskName: 'S6合成复盘', sourceNature: 'synthetic', observationPeriod: '合成观察期',
    applicability: 'S6_SYNTHETIC_SCOPE_ONLY', limitations: 'S6_EFFECT_UNKNOWN', materials: [{ id: 'feedback', kind: 'feedback', mode: 'full' }] }));
  const { handoff, task: reviewTask } = await readJson(await f.request('/api/decision-feedback/handoffs', 'POST', { operationId: randomUUID(), previewId: preview.previewId }), 201);
  await readJson(await f.request(`/api/decision-board/tasks/${action.id}/feedback`, 'POST', { ...feedbackInput, operationId: randomUUID(), expectedLatestRevisionId: feedback.revisionId, outcome: 'S6_LATER_FEEDBACK' }));
  const feedbackRef = { type: 'feedback', sourceProjectId: f.projectId, boardTaskId: action.id, feedbackRevisionId: feedback.revisionId };
  const candidateSources = [cardRef, { type: 'case-choice', caseStoreId: listing.caseStoreId, caseId: decisionCase.id, choiceId: choice.choiceId }, feedbackRef];
  const reviewPlan = [
    { name: 'read_case_sources', arguments: { action: 'read', target: cardRef, part: 'reference', sourceIndex: 0 } },
    { name: 'read_case_sources', arguments: { action: 'read', target: cardRef } },
    { name: 'read_case_sources', arguments: { action: 'read', target: candidateSources[1] } },
    { name: 'record_agent_candidate', arguments: { content: { kind: 'experience', title: 'S6有限经验候选', bodyMd: 'S6_EXPERIENCE：已知条件、未知效果应分别保留。', aliases: [], scope: 'S6_SYNTHETIC_SCOPE_ONLY', caution: 'S6_EFFECT_UNKNOWN，未自动发布。' }, sourceRefs: candidateSources } },
  ];
  const beforeReview = f.provider.requests.length;
  f.provider.setResponder(({ recentToolResults }) => recentToolResults.length < reviewPlan.length ? { calls: [reviewPlan[recentToolResults.length]!] } : { text: '仅保留经验候选；没有证明经营效果。' });
  const reviewRequestId = randomUUID(), reviewRoute = `/api/projects/${f.projectId}/tasks/${reviewTask.id}`;
  await readJson(await f.request(reviewRoute + '/messages', 'POST', { requestId: reviewRequestId, text: '按需复盘并记录有限候选。', feedbackContext: { handoffId: handoff.handoffId, selectedMaterialIds: ['feedback'] } }), 202);
  const deadline = Date.now() + 60_000;
  for (;;) {
    const state = await readJson(await f.request(reviewRoute));
    if (state.task.lastRun?.id === reviewRequestId && state.task.lastRun.status !== 'running' && state.snapshot.status === 'idle') { assert.equal(state.task.lastRun.status, 'completed'); break; }
    assert.ok(Date.now() < deadline, 'S6 synthetic review did not settle'); await new Promise(resolve => setTimeout(resolve, 20));
  }
  const reviewRequests = f.provider.requests.slice(beforeReview);
  const userText = JSON.stringify(reviewRequests[0]!.body.messages?.filter(message => message.role === 'user'));
  assert.match(userText, /S6_FIXED_FEEDBACK/); assert.doesNotMatch(userText, /S6_LATER_FEEDBACK/);
  const tools = reviewRequests.at(-1)!.body.messages!.filter(message => message.role === 'tool').map(message => providerMessageText(message.content)).join('\n');
  assert.match(tools, /S6_SYNTHETIC_SCOPE_ONLY/); assert.doesNotMatch(tools, /S6_LATER_WORKING_FILE/);
  const reviewState = await readJson(await f.request(reviewRoute));
  const reviewEntries = (await readFile(reviewState.task.sessionFile, 'utf8')).trim().split('\n').map(line => JSON.parse(line));
  const reviewReceipts = reviewEntries.filter(entry => entry.message?.role === 'toolResult').map(entry => entry.message);
  assert.equal(reviewReceipts.length, 4); assert.ok(reviewReceipts.every(message => !message.isError), JSON.stringify(reviewReceipts));
  assert.ok(reviewReceipts.slice(0, 3).every(message => message.details.status === 'available'), JSON.stringify(reviewReceipts));
  assert.match(providerMessageText(reviewReceipts[0].content), /S6_SYNTHETIC_SCOPE_ONLY/);
  assert.ok(providerMessageText(reviewReceipts[0].content).includes(f.build.refs.method.publishedHash));
  const lookup = await readJson(await f.request('/api/personal-retention/candidates/lookup?view=all&includeBody=true'));
  const candidate = lookup.rows.find((row: any) => row.ref.taskId === reviewTask.id); assert.ok(candidate); assert.deepEqual(candidate.details.sourceRefs, candidateSources);
  assert.equal(candidate.details.content.caution, 'S6_EFFECT_UNKNOWN，未自动发布。');
  assert.deepEqual(await readFile(original.task.sessionFile), native, 'review in a new ordinary task preserves the original analysis session');
  t.diagnostic('S6 bounded seam: actual Host/Pi, pinned Semantica graph, fixed citation, Case, human action/feedback, new-task review and candidate; synthetic provider only.');
});
