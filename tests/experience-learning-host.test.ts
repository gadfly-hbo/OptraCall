import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { startTestHost } from './fixtures/host-process.ts';
import { startToolProvider, providerMessageText } from './fixtures/tool-provider.ts';
import { readJson } from './fixtures/joint-context.ts';
import { sessionEvents } from './fixtures/session-events.ts';

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
