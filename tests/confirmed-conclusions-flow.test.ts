import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { startTestHost } from './fixtures/host-process.ts';
import { providerMessageText, startToolProvider } from './fixtures/tool-provider.ts';

const REPORT_PATH = '060_reports/report.md';
const REPORT = '# 合成报告 v1\nC类在本款中最大。\n本结论只适用于已列期间。\nA/B相对大盘更集中。\nB店四月退款下降。\n先在单店试用尺码提示。\n全面扩展能够提高收入。\n把单店试用结果交回本期复盘。\n建议先保留当前范围。\n';
const BASIS = '对象,类别,值\n本款,C,50%\n本款,A,30%\n本款,B,20%\n期间,当前,已列期间\nB店,三月,7.1万元\nB店,四月,7.6万元\n';
const sha = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex');

async function until<T>(read: () => Promise<T>, done: (value: T) => boolean, label: string): Promise<T> {
  const deadline = Date.now() + 20_000;
  for (;;) {
    const value = await read();
    if (done(value)) return value;
    if (Date.now() > deadline) assert.fail(label + ': ' + JSON.stringify(value));
    await new Promise(resolve => setTimeout(resolve, 20));
  }
}

function reviewOutput(packet: any) {
  const basis = packet.content.find((item: any) => item.id !== 'report' && item.text.includes('本款,C,50%'));
  assert.ok(basis, 'the real review request must contain the explicitly selected synthetic basis');
  const privateSource = packet.content.some((item: any) => item.text.includes('WITHDRAWN_REVIEW_SOURCE_MARKER'));
  const claims = [
    { id: 'C1', quote: 'C类在本款中最大。', verdict: 'supported', conditions: ['仅限本款及已列期间。'] },
    { id: 'C2', kind: 'conclusion', quote: '本结论只适用于已列期间。', verdict: 'conditional', conditions: ['期间与统计口径均保持一致。'] },
    { id: 'C_BAD', kind: 'conclusion', quote: 'A/B相对大盘更集中。', verdict: 'insufficient', conditions: [] },
    { id: 'C_CONFLICT', kind: 'conclusion', quote: 'B店四月退款下降。', verdict: 'conflicting', conditions: [] },
    { id: 'R1', kind: 'recommendation', relatedClaimIds: ['C1'], quote: '先在单店试用尺码提示。', verdict: 'conditional', conditions: ['先取得单店试点授权，效果待观察。'] },
    { id: 'R_BAD', kind: 'recommendation', relatedClaimIds: ['C1'], quote: '全面扩展能够提高收入。', verdict: 'insufficient', conditions: [] },
    { id: 'R_TWO', kind: 'recommendation', relatedClaimIds: ['C1', 'C2'], quote: '把单店试用结果交回本期复盘。', verdict: 'supported', conditions: ['两条结论均适用时。'] },
    // Old records without kind remain conclusions, even if their wording looks like advice.
    { id: 'C_LEGACY', quote: '建议先保留当前范围。', verdict: 'supported', conditions: ['没有明确行动授权。'] },
  ].map((claim, index) => ({ ...claim, location: `第${index + 2}行`, reportVersion: packet.report.sha256,
    evidence: [{ materialId: basis.id, locator: '本款份额记录', quote: '本款,C,50%' }],
    evidenceGaps: ['insufficient', 'conflicting'].includes(claim.verdict) ? ['缺少支持本主张的同口径证据。'] : [],
    reason: (privateSource ? 'WITHDRAWN_REVIEW_REASON_MARKER ' : '') + '按实际提供的合成资料保留范围和证据限制。', impact: '本次审查不授权经营行动。' }));
  return { schemaVersion: 1, reportVersion: packet.report.sha256, claims,
    scope: { reviewed: '合成报告中的八条主张。', unreviewed: ['真实经营效果。'], limitations: ['没有调用真实Provider或真实业务材料。'] } };
}

async function fixture(t: TestContext) {
  const evidence = path.resolve('.local/confirmed-conclusions-board-handoff/http');
  await mkdir(evidence, { recursive: true });
  const root = await mkdtemp(path.join(evidence, 'run-'));
  const dataRoot = path.join(root, 'host'), projectsRoot = path.join(root, 'projects');
  await mkdir(path.join(dataRoot, 'pi'), { recursive: true });
  await writeFile(path.join(dataRoot, 'pi/settings.json'), JSON.stringify({ retry: { enabled: false } }));
  const provider = await startToolProvider();
  let host: Awaited<ReturnType<typeof startTestHost>>;
  try { host = await startTestHost({ dataRoot, projectsRoot }); }
  catch (error) {
    await provider.close();
    await writeFile(path.join(root, 'startup-error.txt'), String(error));
    throw error;
  }
  const http: object[] = [], facts: Record<string, unknown> = {};
  t.after(async () => {
    const shutdown = await Promise.allSettled([host.close(), provider.close()]);
    await writeFile(path.join(root, 'receipt.json'), JSON.stringify({ scope: 'SYNTHETIC_REAL_HTTP_HOST_PI_ONLY',
      test: t.name, savedAt: new Date().toISOString(), root, facts, http, providerRequestCount: provider.requests.length,
      providerErrors: provider.errors, shutdown: shutdown.map(value => value.status), hostOutput: host.output(),
      requests: provider.requests.map(({ authorization: _credential, ...request }) => request),
    }, null, 2));
    const failed = shutdown.find(value => value.status === 'rejected');
    if (failed?.status === 'rejected') throw failed.reason;
  });
  t.diagnostic(root);
  async function request(route: string, method = 'GET', input?: unknown, expected: number | readonly number[] = 200, headers?: Record<string, string>): Promise<any> {
    const response = await fetch(host.baseUrl + route, { method, headers: { ...host.headers, ...headers },
      ...(input === undefined ? {} : { body: JSON.stringify(input) }) });
    const value = await response.json();
    http.push({ route, method, status: response.status, value });
    if (typeof expected === 'number') assert.equal(response.status, expected, JSON.stringify(value));
    else assert.ok(expected.includes(response.status), JSON.stringify({ status: response.status, value }));
    return value;
  }
  await request('/api/configuration', 'PUT', { name: '确认交接合成', provider: 'openai-compatible', baseUrl: provider.baseUrl,
    model: 'synthetic-confirmed-conclusions', apiKey: 'synthetic-board-handoff-key' });
  const { project } = await request('/api/projects', 'POST', { name: '确认交接隔离项目' }, 201);
  const { task } = await request(`/api/projects/${project.id}/tasks`, 'POST', { name: '原分析任务' }, 201);
  const taskRoute = `/api/projects/${project.id}/tasks/${task.id}`, reviews = taskRoute + '/conclusion-reviews';
  await request(`/api/projects/${project.id}/files/save-report`, 'POST', { name: 'report.md', text: REPORT }, 201);
  await request(`/api/projects/${project.id}/files/upload`, 'POST', { directory: '020_clean', name: 'basis.csv', content: Buffer.from(BASIS).toString('base64') }, 201);
  async function review(options: { extra?: object; text?: string; mode?: 'hold' | 'invalid' } = {}) {
    const selection = { verificationId: randomUUID(), report: { relativePath: REPORT_PATH, sha256: sha(options.text ?? REPORT) },
      basisFiles: ['020_clean/basis.csv'], ...options.extra };
    const preview = (await request(reviews + '/preview', 'POST', selection)).preview;
    provider.setResponder(({ messages, availableTools }) => {
      assert.deepEqual(availableTools, [], 'the real independent review remains source-only');
      assert.doesNotMatch(JSON.stringify(messages), /PARENT_NATIVE_PRIVATE_MARKER/);
      const packet = JSON.parse(providerMessageText(messages.filter(value => value.role === 'user').at(-1)!.content));
      return { text: options.mode === 'invalid' ? 'invalid review output' : JSON.stringify(reviewOutput(packet)), hold: options.mode === 'hold' };
    });
    const beforeRequests = provider.requests.length;
    await request(reviews, 'POST', selection, 202, { 'if-match': preview.etag });
    const reviewRoute = reviews + '/' + selection.verificationId;
    if (options.mode === 'hold') await provider.waitForRequests(beforeRequests + 1);
    else await until(() => request(reviewRoute), value => !['preparing', 'ready', 'running'].includes(value.review.state), 'review settlement');
    const result = (await request(reviewRoute)).review;
    if (!options.mode) assert.equal(result.state, 'completed', JSON.stringify(result));
    const handoff = reviewRoute + '/board-handoff';
    return { selection, result, reviewRoute, handoff,
      submit: (input: object, expected: number | readonly number[] = 201) => request(handoff, 'POST', input, expected),
      input: (claimIds = ['C1'], recommendationIds: string[] = []) => ({ operationId: randomUUID(), reportSha256: selection.report.sha256, claimIds, recommendationIds }) };
  }
  return { root, facts, provider, project, task, taskRoute, reviews, request, review,
    get host() { return host; }, board: () => request('/api/decision-board'),
    reopen: async () => { await host.close(); host = await startTestHost({ dataRoot, projectsRoot }); } };
}

test('CBH-A1/A2: a reviewed report without extraction accepts one explicit conclusion with no advice, task, model or native side effect', { timeout: 60_000 }, async t => {
  const f = await fixture(t);
  await f.request(f.taskRoute + '/messages', 'POST', { requestId: randomUUID(), text: 'PARENT_NATIVE_PRIVATE_MARKER 保留原分析会话，只回复合成文本。' }, 202);
  const parent = await until(() => f.request(f.taskRoute), value => value.snapshot.status === 'idle' && value.task.lastRun?.status === 'completed', 'parent native settlement');
  const native = await readFile(parent.task.sessionFile);
  const draft = '  保留原任务草稿。\n';
  await f.request(f.taskRoute + '/draft', 'PATCH', { text: draft });
  const r = await f.review();
  const before = await f.board();
  assert.equal(before.reports[0].extraction, null);
  assert.equal(before.items.length, 0);
  assert.equal(before.stats.suggested, 0);
  const modelCount = f.provider.requests.length;
  const candidate = (await f.request(r.handoff)).candidate;
  assert.equal(candidate.canConfirm, true);
  assert.equal(candidate.report.sha256, sha(REPORT));
  assert.equal(candidate.report.currentSha256, sha(REPORT));
  assert.deepEqual(candidate.claims.map((value: any) => value.id), ['C1', 'C2', 'C_BAD', 'C_CONFLICT', 'C_LEGACY']);
  assert.deepEqual(candidate.recommendations.map((value: any) => value.id), ['R1', 'R_BAD', 'R_TWO']);
  const input = r.input();
  assert.deepEqual(await f.request(r.handoff + '/' + input.operationId), { state: 'not-submitted' });
  const { receipt } = await r.submit(input);
  assert.deepEqual(receipt.claimIds, ['C1']);
  assert.deepEqual(receipt.recommendationClaimIds, []);
  assert.equal(receipt.conclusionIds.length, 1);
  assert.equal(receipt.addedConclusionIds.length, 1);
  assert.deepEqual(receipt.boardItemIds, []);
  assert.ok(receipt.confirmedBy);
  assert.ok(receipt.confirmedAt);
  const after = await f.board(), report = after.reports[0];
  assert.equal(report.reportId, receipt.reportId);
  assert.equal(report.extraction, null, 'handoff does not require or fabricate an extraction');
  assert.equal(report.confirmations.length, 1);
  const confirmed = report.confirmations[0];
  assert.equal(confirmed.text, 'C类在本款中最大。');
  assert.deepEqual(confirmed.conditions, ['仅限本款及已列期间。']);
  assert.equal(confirmed.reviewId, r.selection.verificationId);
  assert.equal(confirmed.taskId, f.task.id);
  assert.equal(confirmed.reportSha256, sha(REPORT));
  const originalEvidence = r.result.reviewResult.output.claims.find((value: any) => value.id === 'C1').evidence[0];
  const originalMaterial = r.result.review.materials.find((value: any) => value.id === originalEvidence.materialId);
  assert.equal(confirmed.evidence[0].sourceLocator, originalMaterial.locator, 'preserve the exact trusted source locator');
  assert.equal(JSON.parse(confirmed.evidence[0].sourceLocator).relativePath, '020_clean/basis.csv');
  assert.equal(confirmed.evidence[0].sourceSha256, sha(BASIS));
  assert.equal(after.items.length, 0);
  assert.equal(after.stats.suggested, before.stats.suggested);
  assert.deepEqual((await f.request(r.handoff + '/' + input.operationId)).receipt, receipt);
  assert.equal(f.provider.requests.length, modelCount);
  assert.deepEqual(await readFile(parent.task.sessionFile), native);
  assert.equal((await f.request(f.taskRoute)).task.draft, draft);
  assert.equal(await readFile(path.join(f.project.rootPath, REPORT_PATH), 'utf8'), REPORT);
  f.facts.pureConclusion = { operationId: input.operationId, modelCount, nativeSha256: sha(native), receipt };
  assert.deepEqual(f.provider.errors, []);
});

test('CBH-A2/A4/A5: explicit conditional advice, concurrent intent, incremental selection and receipt recovery preserve later decisions', { timeout: 60_000 }, async t => {
  const f = await fixture(t), r = await f.review();
  const modelCount = f.provider.requests.length;
  for (const input of [
    r.input([], ['R1']), r.input(['C_BAD']), r.input(['C_CONFLICT']), r.input(['forged-claim']),
    r.input(['R1']), r.input(['C1'], ['R_BAD']), r.input(['C1'], ['R_TWO']),
  ]) await r.submit(input, [400, 409]);
  assert.equal((await f.board()).items.length, 0, 'invalid selections cannot partially persist');
  const input = r.input(['C1'], ['R1']);
  const replies = await Promise.all([r.submit(input, [200, 201]), r.submit(input, [200, 201])]);
  assert.deepEqual(replies[0].receipt, replies[1].receipt);
  const receipt = replies[0].receipt;
  assert.equal(receipt.addedBoardItemIds.length, 1);
  let board = await f.board();
  const item = board.items.find((value: any) => value.id === receipt.boardItemIds[0]);
  assert.equal(board.items.length, 1);
  assert.equal(item.sourceKind, 'report-confirmation');
  assert.equal(item.title, '先在单店试用尺码提示。');
  assert.equal(item.status, 'suggested');
  assert.equal(item.confidence, null);
  assert.equal(item.evidenceLevel, null);
  assert.equal(item.evidence, null);
  assert.equal(item.reportConfirmation.verdict, 'conditional');
  assert.deepEqual(item.reportConfirmation.conditions, ['先取得单店试点授权，效果待观察。']);
  assert.deepEqual(item.reportConfirmation.conclusionClaimIds, ['C1']);
  assert.deepEqual(item.reportConfirmation.conclusionIds, receipt.conclusionIds);
  assert.equal(item.reportConfirmation.reportSha256, sha(REPORT));
  assert.deepEqual(item.tasks, []);
  await f.request(`/api/decision-board/items/${item.id}/tasks`, 'POST', { title: '未采纳时不得建任务' }, 409);
  await f.request(`/api/decision-board/items/${item.id}/adopt`, 'POST', {});
  const { task } = await f.request(`/api/decision-board/items/${item.id}/tasks`, 'POST', { title: '明确采纳后的试点', owner: '合成运营' }, 201);
  await f.request(`/api/decision-board/tasks/${task.id}/status`, 'POST', { status: 'doing' });
  const { feedback } = await f.request(`/api/decision-board/tasks/${task.id}/feedback`, 'POST', {
    operationId: randomUUID(), expectedLatestRevisionId: null, adopted: true, outcome: '合成试点已开展',
    metricDelta: '', review: '尚未核定经营效果。', score: null, effect: 'unknown',
  });
  const decided = (await f.board()).items.find((value: any) => value.id === item.id);
  const duplicate = (await r.submit({ ...input, operationId: randomUUID() })).receipt;
  assert.deepEqual(duplicate.conclusionIds, receipt.conclusionIds);
  assert.deepEqual(duplicate.boardItemIds, receipt.boardItemIds);
  assert.deepEqual(duplicate.addedConclusionIds, []);
  assert.deepEqual(duplicate.addedBoardItemIds, []);
  const expandedInput = r.input(['C1', 'C2', 'C_LEGACY'], ['R1', 'R_TWO']);
  const expanded = (await r.submit(expandedInput)).receipt;
  assert.equal(expanded.addedConclusionIds.length, 2);
  assert.equal(expanded.addedBoardItemIds.length, 1);
  board = await f.board();
  assert.equal(board.items.length, 2);
  assert.deepEqual(board.items.find((value: any) => value.id === item.id), decided, 'supplementing a review cannot reset adoption, task or feedback');
  assert.equal(decided.tasks[0].feedback.revisionId, feedback.revisionId);
  assert.equal(board.items.find((value: any) => value.id !== item.id).status, 'suggested');
  assert.equal(board.reports[0].confirmations.length, 3);
  await r.submit({ ...input, claimIds: ['C1', 'C2'] }, 409);
  assert.deepEqual((await f.request(r.handoff + '/' + input.operationId)).receipt, receipt);
  assert.equal(f.provider.requests.length, modelCount, 'confirmation, adoption, task, feedback and recovery never invoke a model');

  const lostInput = r.input(['C2']);
  const lostResponse = await fetch(f.host.baseUrl + r.handoff, { method: 'POST', headers: f.host.headers, body: JSON.stringify(lostInput) });
  assert.equal(lostResponse.status, 201);
  await lostResponse.body?.cancel(); // The client discards the response body and only resolves the original intent with GET.
  const recovered = await f.request(r.handoff + '/' + lostInput.operationId);
  assert.equal(recovered.state, 'committed');
  assert.deepEqual(recovered.receipt.addedConclusionIds, []);
  await f.reopen();
  assert.deepEqual(await f.request(r.handoff + '/' + lostInput.operationId), recovered);
  assert.deepEqual((await f.board()).items.find((value: any) => value.id === item.id), decided);
  assert.equal(f.provider.requests.length, modelCount);

  const manual = await f.request('/api/decision-board/items', 'POST', { projectId: f.project.id, title: '原人工补充路径', rationale: '合成一线反馈' }, 201);
  assert.equal(manual.item.sourceKind, 'manual');
  assert.equal(manual.item.evidenceLevel, '经验假设');
  f.provider.setResponder(() => ({ text: JSON.stringify([{ title: '原模型抽取路径', rationale: '仅作合成兼容验证', priority: 'medium', expectedImpact: '', effort: '',
    evidence: { level: '逻辑推断', reasoning: '从报告描述提出待核建议。', facts: [{ text: '报告描述本款C类份额最高。', quote: 'C类在本款中最大。' }] } }]) }));
  await f.request('/api/decision-board/reports/extract', 'POST', { projectId: f.project.id, path: REPORT_PATH }, 202);
  board = await until(f.board, value => value.reports[0].extraction?.status === 'completed', 'existing extraction');
  assert.deepEqual(new Set(board.items.map((value: any) => value.sourceKind)), new Set(['report-confirmation', 'manual', 'extracted']));
  assert.deepEqual(board.items.find((value: any) => value.id === item.id), decided);
  assert.equal(board.reports[0].confirmations.length, 3);
  assert.equal(f.provider.requests.length, modelCount + 1, 'only the separately explicit legacy extraction calls a model');
  f.facts.intentRecovery = { receipt, expanded, recovered, adoptedItemId: item.id, feedbackRevisionId: feedback.revisionId };
  assert.deepEqual(f.provider.errors, []);
});

test('CBH-A3/A4: exact report versions, forged identities, cross-task access and archive gates retain the original receipt', { timeout: 60_000 }, async t => {
  const f = await fixture(t), r = await f.review();
  const input = r.input(), receipt = (await r.submit(input)).receipt;
  const modelCount = f.provider.requests.length;
  const newer = REPORT.replace('v1', 'v2');
  assert.equal(Buffer.byteLength(newer), Buffer.byteLength(REPORT), 'a version change must not depend on file length');
  await writeFile(path.join(f.project.rootPath, REPORT_PATH), newer);
  const stale = (await f.request(r.handoff)).candidate;
  assert.equal(stale.canConfirm, false);
  assert.equal(stale.report.sha256, sha(REPORT));
  assert.equal(stale.report.currentSha256, sha(newer));
  const observed = await f.board();
  assert.equal(observed.reports[0].currentSha256, sha(newer));
  assert.equal(observed.reports[0].confirmations[0].reportSha256, sha(REPORT));
  await r.submit(r.input(['C2']), 409);
  await r.submit({ ...r.input(), reportSha256: sha(newer) }, 409);
  assert.deepEqual((await f.request(r.handoff + '/' + input.operationId)).receipt, receipt);
  assert.deepEqual((await r.submit(input, 200)).receipt, receipt, 'same accepted operation reads its fixed identity after the live report changes');
  assert.equal((await f.request(r.reviewRoute + '/report')).text, REPORT);
  const { task: other } = await f.request(`/api/projects/${f.project.id}/tasks`, 'POST', { name: '另一任务' }, 201);
  const cross = `/api/projects/${f.project.id}/tasks/${other.id}/conclusion-reviews/${r.selection.verificationId}/board-handoff`;
  await f.request(cross, 'GET', undefined, 404);
  await f.request(cross, 'POST', input, 404);
  await f.request(cross + '/' + input.operationId, 'GET', undefined, 404);
  assert.equal(f.provider.requests.length, modelCount);
  const v2 = await f.review({ text: newer });
  const newerReceipt = (await v2.submit(v2.input())).receipt;
  const board = await f.board(), versions = board.reports[0].confirmations;
  assert.equal(board.reports[0].currentSha256, sha(newer));
  assert.equal(versions.length, 2);
  assert.deepEqual(new Set(versions.map((value: any) => value.reportSha256)), new Set([sha(REPORT), sha(newer)]));
  assert.notEqual(newerReceipt.conclusionIds[0], receipt.conclusionIds[0]);
  await f.request(`/api/projects/${f.project.id}/archive`, 'POST', {});
  assert.equal((await f.request(v2.handoff)).candidate.canConfirm, false);
  await v2.submit(v2.input(['C2']), 409);
  assert.deepEqual((await f.request(r.handoff + '/' + input.operationId)).receipt, receipt);
  assert.equal((await f.board()).reports[0].confirmations.length, 2);
  assert.equal(await readFile(path.join(f.project.rootPath, REPORT_PATH), 'utf8'), newer);
  f.facts.versionHistory = { oldSha256: sha(REPORT), currentSha256: sha(newer), receipt, newerReceipt };
  assert.deepEqual(f.provider.errors, []);
});

test('CBH-A1: returned, stopped and failed reviews do not automatically register conclusions or advice', { timeout: 60_000 }, async t => {
  const f = await fixture(t);
  const completed = await f.review();
  const idle = await f.board();
  assert.equal(idle.items.length, 0);
  assert.equal(idle.reports[0].extraction, null);
  assert.deepEqual(idle.reports[0].confirmations, []);
  const held = await f.review({ mode: 'hold' });
  const runningDenied = await f.request(held.handoff, 'GET', undefined, 409);
  assert.equal(runningDenied.code, 'confirmation_review_not_completed');
  assert.doesNotMatch(JSON.stringify(runningDenied), /C类在本款中最大|先在单店试用尺码提示/);
  await f.request(held.reviewRoute + '/stop', 'POST', {});
  const stopped = await until(() => f.request(held.reviewRoute), value => !['preparing', 'ready', 'running'].includes(value.review.state), 'stopped review');
  assert.notEqual(stopped.review.state, 'completed');
  await held.submit(held.input(), 409);
  const failed = await f.review({ mode: 'invalid' });
  assert.equal(failed.result.state, 'failed');
  const failedDenied = await f.request(failed.handoff, 'GET', undefined, 409);
  assert.equal(failedDenied.code, 'confirmation_review_not_completed');
  assert.doesNotMatch(JSON.stringify(failedDenied), /C类在本款中最大|先在单店试用尺码提示/);
  await failed.submit(failed.input(), 409);
  const unchanged = await f.board();
  assert.deepEqual(unchanged.reports[0].confirmations, []);
  assert.equal(unchanged.items.length, 0);
  assert.equal(unchanged.reports[0].extraction, null);
  assert.equal((await f.request(completed.handoff)).candidate.canConfirm, true);
  assert.equal(await readFile(path.join(f.project.rootPath, REPORT_PATH), 'utf8'), REPORT);
  f.facts.noAutomaticHandoff = { states: [completed.result.state, stopped.review.state, failed.result.state], modelRequests: f.provider.requests.length };
  assert.deepEqual(f.provider.errors, []);
});

test('CBH-A3: source withdrawal redacts confirmed history and rejects cached advice, task and feedback capabilities', { timeout: 60_000 }, async t => {
  const f = await fixture(t);
  const source = await f.request('/api/enterprise-materials', 'POST', { title: '交接的合成受控来源', body: 'WITHDRAWN_REVIEW_SOURCE_MARKER 当前仅可供本次合成审查。' }, 201);
  const sourceRoute = '/api/enterprise-materials/' + source.material.id;
  const enabled = await f.request(sourceRoute + '/enable', 'POST', { expectedVersion: source.material.version });
  const r = await f.review({ extra: { enterpriseMaterials: [{ storeId: enabled.storeId, materialId: enabled.material.id,
    revisionId: enabled.material.activeRevisionId, mode: 'full' }] } });
  const input = r.input(['C1'], ['R1']), { receipt } = await r.submit(input);
  let board = await f.board();
  assert.match(JSON.stringify(board), /WITHDRAWN_REVIEW_REASON_MARKER/);
  const item = board.items[0];
  await f.request(`/api/decision-board/items/${item.id}/adopt`, 'POST', {});
  const { task } = await f.request(`/api/decision-board/items/${item.id}/tasks`, 'POST', { title: 'WITHDRAWN_BOARD_TASK_MARKER' }, 201);
  const feedbackInput = { operationId: randomUUID(), expectedLatestRevisionId: null, adopted: true,
    outcome: 'WITHDRAWN_BOARD_FEEDBACK_MARKER', metricDelta: '', review: '真实效果未知。', score: null };
  const { feedback } = await f.request(`/api/decision-board/tasks/${task.id}/feedback`, 'POST', feedbackInput);
  await f.request('/api/cases/storage/initialize', 'POST', {});
  const { case: caseRecord } = await f.request('/api/cases', 'POST', { operationId: randomUUID(), title: '合成交接Case', description: '仅测试撤权传播。' }, 201);
  await f.request(`/api/cases/${caseRecord.id}/projects`, 'POST', { operationId: randomUUID(), expectedRevision: caseRecord.revision, projectId: f.project.id });
  const caseRoute = `/api/cases/${caseRecord.id}/decisions`;
  const actionTarget = { type: 'board-task', projectId: f.project.id, itemId: item.id, taskId: task.id };
  const feedbackTarget = { type: 'feedback', sourceProjectId: f.project.id, boardTaskId: task.id, feedbackRevisionId: feedback.revisionId };
  assert.ok((await f.request(caseRoute + '/links')).actions.some((value: any) => value.target.taskId === task.id));
  assert.match((await f.request(caseRoute + '/source', 'POST', { target: actionTarget })).text, /WITHDRAWN_BOARD_TASK_MARKER/);
  assert.match((await f.request(caseRoute + '/source', 'POST', { target: feedbackTarget })).text, /WITHDRAWN_BOARD_FEEDBACK_MARKER/);
  assert.match((await f.request('/api/personal-retention/sources/read', 'POST', { ref: feedbackTarget })).text, /WITHDRAWN_BOARD_FEEDBACK_MARKER/);
  const feedbackPreview = { boardTaskId: task.id, feedbackRevisionId: feedback.revisionId, question: '只读反馈范围？',
    taskName: '合成反馈来源', materials: [{ id: 'feedback', kind: 'feedback', mode: 'full' }] };
  await f.request('/api/decision-feedback/preview', 'POST', feedbackPreview);
  const modelCount = f.provider.requests.length;
  await f.request(sourceRoute + '/disable', 'POST', { expectedVersion: enabled.material.version });
  board = await f.board();
  assert.equal(board.items.some((value: any) => value.id === item.id), false);
  assert.doesNotMatch(JSON.stringify(board), /WITHDRAWN_|C类在本款中最大|先在单店试用尺码提示/);
  const history = board.reports[0].confirmations[0];
  assert.equal(history.readStatus, 'unavailable');
  assert.equal(history.reportSha256, sha(REPORT));
  assert.equal(history.reviewId, r.selection.verificationId);
  for (const key of ['text', 'conditions', 'evidence', 'location', 'reason', 'impact']) assert.equal(Object.hasOwn(history, key), false, key);
  const deniedCandidate = await f.request(r.handoff, 'GET', undefined, 409);
  assert.equal(deniedCandidate.code, 'enterprise_material_disabled');
  assert.doesNotMatch(JSON.stringify(deniedCandidate), /WITHDRAWN_|C类在本款中最大|先在单店试用尺码提示/);
  await r.submit(r.input(), 409);
  await r.submit(input, 409);
  const safeReceipt = await f.request(r.handoff + '/' + input.operationId);
  assert.equal(safeReceipt.state, 'committed');
  assert.deepEqual(safeReceipt.receipt, receipt);
  assert.doesNotMatch(JSON.stringify(safeReceipt), /WITHDRAWN_|本款份额|020_clean|C类在本款中最大/);
  for (const [route, method, body] of [
    [`/api/decision-board/items/${item.id}/adopt`, 'POST', {}],
    [`/api/decision-board/items/${item.id}/dismiss`, 'POST', { reason: '缓存界面不得越过撤权。' }],
    [`/api/decision-board/items/${item.id}/tasks`, 'POST', { title: '撤权后的缓存任务' }],
    [`/api/decision-board/tasks/${task.id}/status`, 'POST', { status: 'done' }],
    [`/api/decision-board/tasks/${task.id}/feedback`, 'POST', { ...feedbackInput, operationId: randomUUID(), expectedLatestRevisionId: feedback.revisionId }],
    [`/api/decision-board/feedback/history?taskId=${task.id}`, 'GET', undefined],
    [`/api/decision-board/feedback/revisions/${feedback.revisionId}`, 'GET', undefined],
    [`/api/decision-board/feedback/operations/${feedbackInput.operationId}`, 'GET', undefined],
  ] as const) {
    const denied = await f.request(route, method, body, 409);
    assert.equal(denied.code, 'confirmation_source_unavailable', 'cached requests must fail for source authority, not an unrelated state transition');
    assert.doesNotMatch(JSON.stringify(denied), /WITHDRAWN_|C类在本款中最大|先在单店试用尺码提示/);
  }
  const links = await f.request(caseRoute + '/links');
  assert.equal(links.actions.some((value: any) => value.target.taskId === task.id), false);
  assert.doesNotMatch(JSON.stringify(links), /WITHDRAWN_/);
  for (const target of [actionTarget, feedbackTarget]) {
    const denied = await f.request(caseRoute + '/source', 'POST', { target });
    assert.equal(denied.status, 'unknown');
    assert.equal(denied.code, 'enterprise_material_disabled');
    assert.equal(denied.text, null);
    assert.doesNotMatch(JSON.stringify(denied), /WITHDRAWN_/);
  }
  const personalDenied = await f.request('/api/personal-retention/sources/read', 'POST', { ref: feedbackTarget }, 409);
  assert.equal(personalDenied.code, 'enterprise_material_disabled');
  assert.doesNotMatch(JSON.stringify(personalDenied), /WITHDRAWN_/);
  const previewDenied = await f.request('/api/decision-feedback/preview', 'POST', feedbackPreview, 400);
  assert.equal(previewDenied.code, 'enterprise_material_disabled');
  assert.doesNotMatch(JSON.stringify(previewDenied), /WITHDRAWN_/);
  await f.reopen();
  assert.deepEqual(await f.request(r.handoff + '/' + input.operationId), safeReceipt);
  assert.doesNotMatch(JSON.stringify(await f.board()), /WITHDRAWN_|C类在本款中最大|先在单店试用尺码提示/);
  assert.equal(f.provider.requests.length, modelCount);
  f.facts.withdrawal = { receipt, safeHistory: history, itemId: item.id, taskId: task.id, feedbackRevisionId: feedback.revisionId };
  assert.deepEqual(f.provider.errors, []);
});

test('CBH04: missing private fixed report keeps saved confirmed text with an explicit historical limitation', { timeout: 60_000 }, async t => {
  const f = await fixture(t), r = await f.review();
  const input = r.input(), { receipt } = await r.submit(input), modelCount = f.provider.requests.length;
  const newer = '# 新版报告\nNEW_REPORT_MUST_NOT_REPLACE_OLD_FIXED_VIEWER\n';
  await writeFile(path.join(f.project.rootPath, REPORT_PATH), newer);
  // Fault injection is confined to this test's new synthetic private snapshot;
  // preserve its original bytes beside it rather than deleting or editing them.
  const recordPath = path.join(f.host.dataRoot, 'analysis-verifications', f.project.id, f.task.id, r.selection.verificationId, 'record.json');
  const record = JSON.parse(await readFile(recordPath, 'utf8'));
  const snapshot = record.authorFiles[0].snapshotPath;
  const fixedBytes = await readFile(snapshot);
  assert.equal(sha(fixedBytes), sha(REPORT));
  await rename(snapshot, snapshot + '.fixture-withheld');
  const unavailableReport = await f.request(r.reviewRoute + '/report', 'GET', undefined, 409);
  assert.equal(unavailableReport.code, 'conclusion_review_fixed_report_unavailable');
  const board = await f.board(), confirmed = board.reports[0].confirmations[0];
  assert.equal(confirmed.readStatus, 'available');
  assert.equal(confirmed.text, 'C类在本款中最大。');
  assert.equal(confirmed.reportSha256, sha(REPORT));
  assert.equal(confirmed.fixedReportAvailable, false);
  assert.ok(confirmed.limitations.includes('原审查固定稿目前不可回读；以下为确认时实际保存的结论及来源，不代表当前新版。'));
  assert.doesNotMatch(JSON.stringify(confirmed), /NEW_REPORT_MUST_NOT_REPLACE_OLD_FIXED_VIEWER/);
  assert.deepEqual((await f.request(r.handoff + '/' + input.operationId)).receipt, receipt);
  assert.deepEqual((await r.submit(input, 200)).receipt, receipt, 'replaying the committed intent cannot depend on missing private report bytes');
  assert.equal(f.provider.requests.length, modelCount);
  await f.reopen();
  const reopened = (await f.board()).reports[0].confirmations[0];
  assert.deepEqual(reopened, confirmed);
  assert.equal((await f.request(r.reviewRoute + '/report', 'GET', undefined, 409)).code, 'conclusion_review_fixed_report_unavailable');
  assert.deepEqual((await f.request(r.handoff + '/' + input.operationId)).receipt, receipt);
  assert.deepEqual((await r.submit(input, 200)).receipt, receipt, 'the same committed intent remains replayable after restart');
  assert.equal(f.provider.requests.length, modelCount);
  assert.deepEqual(await readFile(snapshot + '.fixture-withheld'), fixedBytes);
  assert.equal(await readFile(path.join(f.project.rootPath, REPORT_PATH), 'utf8'), newer);
  f.facts.missingFixedReport = { oldSha256: sha(REPORT), currentSha256: sha(newer), confirmed, receipt };
});
