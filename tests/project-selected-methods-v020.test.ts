import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { appendFile, cp, mkdir, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { createSapMethodStore } from '../extensions/business-plugins/metric-factory/methods/store.ts';
import { startTestHost } from './fixtures/host-process.ts';
import { startToolProvider, providerMessageText } from './fixtures/tool-provider.ts';
import type { ProjectPlanContent } from '../src/host/project-plan-types.ts';

const evidenceRoot = path.resolve('.local/overall-architecture-upgrade/development/selected-methods');
const hash = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
async function environment(t: TestContext, name: string, options: { fixtureSkill?: boolean; seedMethod?: boolean; newerMethod?: boolean } = {}) {
  await mkdir(evidenceRoot, { recursive: true });
  const root = await mkdtemp(path.join(evidenceRoot, `${name}-`)), dataRoot = path.join(root, 'host'), projectsRoot = path.join(root, 'projects');
  let codeRoot = process.cwd();
  if (options.fixtureSkill) {
    codeRoot = path.join(root, 'metadata-only-code');
    const destination = path.join(codeRoot, 'extensions/analysis-assets/target-forecast');
    await mkdir(path.dirname(destination), { recursive: true });
    await cp(path.resolve('extensions/analysis-assets/target-forecast'), destination, { recursive: true });
  }
  const methods = createSapMethodStore(path.join(dataRoot, 'metric-assets'));
  const method = options.seedMethod ? methods.save({ requestId: randomUUID(), origin: 'other', title: '合成准确窗口约定', content: { conditions: '仅用于合成固定输入的观察窗口核对', logic: 'FIXED_PUBLISHED_SELECTED_METHOD_V1', judgment: '区分证据、声明和专业判断', limits: '不据读取或声明推断专业正确' }, sources: [] }) : undefined;
  if (method) methods.publish(method.method.id, { requestId: randomUUID(), version: 1, expectedSha256: method.version.contentSha256 });
  if (method && options.newerMethod) {
    const newer = methods.save({ requestId: randomUUID(), methodId: method.method.id, baseVersion: 1, origin: 'other', title: '合成新版窗口约定', content: { ...method.version.content, logic: 'NEWER_PUBLISHED_METHOD_V2_MUST_NOT_SUBSTITUTE' }, sources: [] });
    methods.publish(method.method.id, { requestId: randomUUID(), version: 2, expectedSha256: newer.version.contentSha256 });
  }
  // Methods are seeded through their public Store before this isolated Host owns it.
  const provider = await startToolProvider(); t.after(() => provider.close());
  const host = await startTestHost({ dataRoot, projectsRoot, cwd: codeRoot }); t.after(() => host.close());
  t.diagnostic(root);
  const request = async (route: string, verb = 'GET', body?: unknown, status = 200): Promise<any> => { const response = await host.request(route, verb, body); assert.equal(response.status, status, await response.clone().text()); return response.json(); };
  await request('/api/configuration', 'PUT', { name: '所选方法合成模型', provider: 'openai-compatible', baseUrl: provider.baseUrl, model: 'synthetic-selected-methods', apiKey: 'synthetic-selected-methods-only' });
  const catalog = await request('/api/capabilities/skills'), skill = catalog.skills.find((item: { id: string; source: string }) => item.id === 'target-forecast' && item.source === path.join(codeRoot, 'extensions/analysis-assets/target-forecast/SKILL.md'));
  assert.ok(skill, 'select an actual valid bundled Skill from the current Host/Pi resource catalog, never a candidate');
  const { project } = await request('/api/projects', 'POST', { name: '所选方法真实读取合成项目' }, 201);
  const plan: ProjectPlanContent = { request: '核对合成前提并读取所选准确方法，资料不足保留未知；只需聊天摘要', premises: ['没有真实业务明细，不做根因或业绩判断'], materials: [], coverage: [], tasks: [{ key: 'selected-methods', name: '准确方法读取与声明', selected: true, scope: '按需使用所选方法，方法顺序由 Agent 决定', capabilities: [{ kind: 'skill', id: skill.id, version: skill.version, sha256: skill.sha256 }, ...(method ? [{ kind: 'sap-method' as const, id: method.method.id, version: '1' }] : [])] }], taskMode: 'single', summaryTaskKey: 'selected-methods', dependencies: [], caseContext: null };
  const base = `/api/projects/${project.id}/plan`, saved = await request(base + '/draft', 'POST', { operationId: randomUUID(), expectedRevision: 0, plan });
  return { root, codeRoot, host, provider, request, project, skill, method, plan, base, saved };
}
async function completed(f: Awaited<ReturnType<typeof environment>>, taskId: string, requestId: string) {
  const deadline = Date.now() + 20_000; let state: any;
  do { state = await f.request(`/api/projects/${f.project.id}/tasks/${taskId}`); if (state.task.lastRun?.id === requestId && state.task.lastRun.status !== 'running' && state.snapshot.status === 'idle') break; await delay(20); } while (Date.now() < deadline);
  assert.equal(state.task.lastRun?.status, 'completed', JSON.stringify(state.task.lastRun));
  const bytes = await readFile(state.task.sessionFile), native: any[] = bytes.toString('utf8').trim().split('\n').map(line => JSON.parse(line));
  return { state, native, sha256: hash(bytes) };
}

test('A07/A09: one confirmation carries exact selected versions through Host/Pi; actual Skill and SAP reads remain distinct from the Agent use declaration', { timeout: 50_000 }, async t => {
  const f = await environment(t, 'actual-pi', { seedMethod: true });
  const skillBytes = await readFile(f.skill.source), checks = [{ kind: 'skill', id: f.skill.id, version: f.skill.version, status: 'used', basis: '合成 Provider 已读取准确 SKILL.md，按其核对前提与局限；采用仅为脚本声明。' }, { kind: 'sap-method', id: f.method!.method.id, version: '1', status: 'used', basis: '已通过原语义工具读取确定发布版 v1；专业正确性未运行。' }];
  let skillObserved = false, methodObserved = false;
  f.provider.setResponder(context => {
    assert.ok(context.availableTools.includes('read')); assert.ok(context.availableTools.includes('read_semantic_context')); assert.ok(context.availableTools.includes('declare_analysis_delivery'));
    if (context.recentToolResults.length === 0) return { calls: [{ name: 'read', arguments: { path: f.skill.source } }] };
    if (context.recentToolResults.length === 1) { assert.match(providerMessageText(context.recentToolResults[0].content), /name: target-forecast/); skillObserved = true; return { calls: [{ name: 'read_semantic_context', arguments: { action: 'read', target: { kind: 'sap-method', methodId: f.method!.method.id, version: 1, publishedHash: f.method!.version.contentSha256 } } }] }; }
    if (context.recentToolResults.length === 2) { const read = JSON.parse(providerMessageText(context.recentToolResults[1].content)); assert.equal(read.items[0].target.methodId, f.method!.method.id); assert.equal(read.items[0].target.version, 1); assert.match(read.items[0].body, /FIXED_PUBLISHED_SELECTED_METHOD_V1/); methodObserved = true; return { calls: [{ name: 'declare_analysis_delivery', arguments: { completion: 'complete', format: 'chat-summary', summary: '合成 SDK 已读取所选准确 Skill 与 SAP 方法，资料不足保留，专业正确未验收。', limitations: ['只验证工具读取、准确版本与脚本采用声明；没有真实 LLM 或业务正确性评分'], selfCheck: { performed: true, findings: ['输入范围和方法版本已核对；不推断根因或效果'] }, methodChecks: checks, reports: [] } }] }; }
    const receipt = JSON.parse(providerMessageText(context.recentToolResults[2].content)); assert.deepEqual(receipt.methodChecks, checks); return { text: '合成固定输入核对完成；所选方法的读取、采用声明与专业验收分别记录。' };
  });
  const confirmationInput = { operationId: randomUUID(), expectedRevision: f.saved.state.revision, mode: 'start' }, result = await f.request(f.base + '/confirm', 'POST', confirmationInput), receipt = result.confirmation.tasks[0];
  assert.equal(receipt.startStatus, 'accepted'); assert.equal(result.confirmation.tasks.length, 1);
  const settled = await completed(f, receipt.taskId, receipt.startRequestId), started = settled.native.filter(entry => entry.customType === 'optracall.run' && entry.data.phase === 'started' && entry.data.requestId === receipt.startRequestId);
  assert.equal(started.length, 1); assert.deepEqual(started[0].data.providedContext.projectPlan.methods, f.plan.tasks[0].capabilities);
  const calls = settled.native.flatMap(entry => entry.message?.role === 'assistant' && Array.isArray(entry.message.content) ? entry.message.content.filter((part: any) => part.type === 'toolCall').map((part: any) => ({ ...part, nativeEntryId: entry.id })) : []), skillCall = calls.find(call => call.name === 'read' && call.arguments.path === f.skill.source), methodCall = calls.find(call => call.name === 'read_semantic_context');
  assert.ok(skillCall); assert.ok(methodCall); assert.equal(methodCall.arguments.target.version, 1); assert.equal(methodCall.arguments.target.publishedHash, f.method!.version.contentSha256);
  const skillRead = settled.native.find(entry => entry.message?.role === 'toolResult' && entry.message.toolCallId === skillCall.id), methodRead = settled.native.find(entry => entry.message?.role === 'toolResult' && entry.message.toolCallId === methodCall.id);
  assert.equal(skillRead.message.isError, false); assert.equal(providerMessageText(skillRead.message.content), skillBytes.toString('utf8')); assert.equal(methodRead.message.isError, false); assert.match(JSON.stringify(methodRead.message.details), /FIXED_PUBLISHED_SELECTED_METHOD_V1/); assert.equal(methodRead.message.details.items[0].target.publishedHash, f.method!.version.contentSha256);
  const declaration = settled.native.find(entry => entry.customType === 'optracall.analysis-delivery' && entry.data.requestId === receipt.startRequestId);
  assert.ok(declaration); assert.deepEqual(declaration.data.methodChecks, checks); assert.equal(declaration.data.claim, 'declared-not-professionally-verified'); assert.equal(skillObserved && methodObserved, true);
  const declarationTool = settled.native.find(entry => entry.message?.role === 'toolResult' && entry.message.toolName === 'declare_analysis_delivery' && entry.message.toolCallId === declaration.data.toolCallId);
  assert.equal(declarationTool.message.isError, false); assert.deepEqual(declarationTool.message.details, declaration.data);
  const count = f.provider.requests.length; assert.equal(count, 4); assert.equal((await f.request(f.base + '/confirm', 'POST', confirmationInput)).replayed, true); assert.equal(f.provider.requests.length, count); assert.deepEqual(f.provider.errors, []);
  await writeFile(path.join(f.root, 'receipt.json'), JSON.stringify({ test: 'A07/A09 actual Host/Pi selected methods', selected: f.plan.tasks[0].capabilities, skillSource: f.skill.source, skillInstructionsSha256: hash(skillBytes), skillPackageSha256: f.skill.sha256, nativeSessionFile: settled.state.task.sessionFile, nativeSha256: settled.sha256, providedContextEntryId: started[0].id, actualReadEntryIds: [skillRead.id, methodRead.id], declarationEntryId: declaration.id, declaration: 'scripted-provider-declared-used', professionalCorrectness: 'NOT_RUN', actualLLMAdoption: 'NOT_RUN' }, null, 2));
});

test('A09: a selected exact SAP version confirmed erroneous before start is rejected even when another published version exists', { timeout: 30_000 }, async t => {
  const f = await environment(t, 'method-issue', { seedMethod: true, newerMethod: true });
  const created = await f.request(f.base + '/confirm', 'POST', { operationId: randomUUID(), expectedRevision: f.saved.state.revision, mode: 'create' });
  const issue = await f.request(`/api/sap/methods/${f.method!.method.id}/issues`, 'POST', { requestId: randomUUID(), version: 1, expectedRevision: 0, status: 'confirmed', note: '合成治理反例：所选旧版确有问题，不静默采用新版', replacement: { methodId: f.method!.method.id, version: 2 } });
  assert.equal(issue.method.governance.at(-1).status, 'confirmed');
  const blocked = await f.request(f.base + '/confirm', 'POST', { operationId: randomUUID(), expectedRevision: created.state.revision, mode: 'start' }, 409); assert.equal(blocked.code, 'project_plan_capability_changed');
  const state = await f.request(f.base), original = await f.request(`/api/projects/${f.project.id}/tasks/${created.confirmation.tasks[0].taskId}`);
  assert.equal(state.confirmed.mode, 'create'); assert.equal(state.confirmed.plan.tasks[0].capabilities.find((ref: any) => ref.kind === 'sap-method').version, '1'); assert.equal(original.task.lastRun, undefined); assert.equal(original.task.sessionFile, undefined); assert.equal(f.provider.requests.length, 0);
  await writeFile(path.join(f.root, 'receipt.json'), JSON.stringify({ selectedMethod: f.method!.method.id, selectedVersion: 1, availableReplacementVersion: 2, confirmedIssueRevision: issue.method.governanceRevision, rejection: blocked.code, modelRequests: 0, originalConfirmationRetained: true }, null, 2));
});

test('A09: changing only an isolated Skill script invalidates the selected package before start without changing SKILL.md or the official package', { timeout: 30_000 }, async t => {
  const officialFile = path.resolve('extensions/analysis-assets/target-forecast/SKILL.md'), originalInstructions = await readFile(officialFile), f = await environment(t, 'skill-script-change', { fixtureSkill: true });
  const created = await f.request(f.base + '/confirm', 'POST', { operationId: randomUUID(), expectedRevision: f.saved.state.revision, mode: 'create' }), fixtureRoot = path.dirname(f.skill.source), files = await readdir(fixtureRoot, { recursive: true }), script = files.find(file => file.startsWith('scripts' + path.sep) && file.endsWith('.py'));
  assert.ok(script, 'change an existing copied script, not instructions or any official Skill');
  const officialScript = path.join(path.dirname(officialFile), script), officialScriptBytes = await readFile(officialScript);
  await appendFile(path.join(fixtureRoot, script), '\n# Synthetic package-identity metadata check only; never execute this copy.\n');
  const changed = (await f.request('/api/capabilities/skills')).skills.find((skill: any) => skill.id === f.skill.id);
  assert.notEqual(changed.sha256, f.skill.sha256); assert.deepEqual(await readFile(f.skill.source), originalInstructions); assert.deepEqual(await readFile(officialFile), originalInstructions); assert.deepEqual(await readFile(officialScript), officialScriptBytes);
  const blocked = await f.request(f.base + '/confirm', 'POST', { operationId: randomUUID(), expectedRevision: created.state.revision, mode: 'start' }, 409); assert.equal(blocked.code, 'project_plan_capability_changed');
  const state = await f.request(f.base), task = await f.request(`/api/projects/${f.project.id}/tasks/${created.confirmation.tasks[0].taskId}`);
  assert.equal(state.confirmed.plan.tasks[0].capabilities[0].sha256, f.skill.sha256); assert.equal(task.task.lastRun, undefined); assert.equal(task.task.sessionFile, undefined); assert.equal(f.provider.requests.length, 0);
  await writeFile(path.join(f.root, 'receipt.json'), JSON.stringify({ metadataOnlyCodeRoot: f.codeRoot, fixtureScript: script, oldPackageSha256: f.skill.sha256, changedPackageSha256: changed.sha256, instructionBytesUnchanged: true, officialInstructionsUnchanged: true, rejection: blocked.code, modelRequests: 0, copiedScriptsExecuted: false }, null, 2));
});


test('A20 actual SDK: explicit corrected selection gives a new Task the applicable published method and preserves the old Task reference', { timeout: 40_000 }, async t => {
  const f = await environment(t, 'corrected-new-task', { seedMethod: true, newerMethod: true });
  const original = await f.request(f.base + '/confirm', 'POST', { operationId: randomUUID(), expectedRevision: f.saved.state.revision, mode: 'create' });
  const oldId = original.confirmation.tasks[0].taskId;
  await f.request(`/api/sap/methods/${f.method!.method.id}/issues`, 'POST', { requestId: randomUUID(), version: 1, expectedRevision: 0, status: 'confirmed', note: '合成用户治理：旧版已知错误，后续明确选择适用发布版', replacement: { methodId: f.method!.method.id, version: 2 } });
  const next = { ...f.plan, tasks: [{ key: 'corrected-new-task', name: '纠错后的新任务', selected: true, scope: '明确采用已发布v2；保留原任务及v1历史引用', capabilities: [{ kind: 'sap-method' as const, id: f.method!.method.id, version: '2' }] }], summaryTaskKey: 'corrected-new-task' };
  const saved = await f.request(f.base + '/draft', 'POST', { operationId: randomUUID(), expectedRevision: original.state.revision, plan: next });
  const detail = await f.request(`/api/sap/methods/${f.method!.method.id}/versions/2`), published = detail.method.publications.find((value: any) => value.version === 2);
  assert.ok(published);
  let observedHash: string | undefined;
  f.provider.setResponder(context => {
    if (context.recentToolResults.length === 0) return { calls: [{ name: 'read_semantic_context', arguments: { action: 'read', target: { kind: 'sap-method', methodId: f.method!.method.id, version: 2, publishedHash: published.contentSha256 } } }] };
    if (context.recentToolResults.length === 1) {
      const exact = JSON.parse(providerMessageText(context.recentToolResults[0].content));
      assert.equal(exact.items[0].target.version, 2); assert.match(exact.items[0].body, /NEWER_PUBLISHED_METHOD_V2_MUST_NOT_SUBSTITUTE/); observedHash = exact.items[0].target.publishedHash;
      return { calls: [{ name: 'declare_analysis_delivery', arguments: { completion: 'complete', format: 'chat-summary', summary: '新任务已读取明确选择的适用发布版；原任务历史保留', limitations: ['合成Provider采用声明，真实模型专业正确未验收'], selfCheck: { performed: true, findings: [] }, methodChecks: [{ kind: 'sap-method', id: f.method!.method.id, version: '2', status: 'used', basis: '已读取明确采用的准确发布版v2；不把读取当专业正确' }], reports: [] } }] };
    }
    return { text: '合成新任务完成；旧任务、旧引用、原错误记录保留。' };
  });
  const started = await f.request(f.base + '/confirm', 'POST', { operationId: randomUUID(), expectedRevision: saved.state.revision, mode: 'start' }), task = started.confirmation.tasks[0];
  assert.notEqual(task.taskId, oldId);
  const observed = await completed(f, task.taskId, task.startRequestId);
  assert.equal(observedHash, published.contentSha256); assert.deepEqual(f.provider.errors, []);
  const old = await f.request(`/api/projects/${f.project.id}/tasks/${oldId}`), state = await f.request(f.base);
  assert.equal(old.task.sessionFile, undefined); assert.equal(old.task.lastRun, undefined);
  assert.equal(state.history.find((entry: any) => entry.id === original.confirmation.id).plan.tasks[0].capabilities.find((ref: any) => ref.kind === 'sap-method').version, '1');
  assert.equal(observed.native.find(entry => entry.customType === 'optracall.analysis-delivery').data.methodChecks[0].version, '2');
  await writeFile(path.join(f.root, 'receipt.json'), JSON.stringify({ originalTaskId: oldId, originalFixedVersion: 1, newTaskId: task.taskId, explicitlySelectedVersion: 2, actualReadHash: observedHash, nativeSha256: observed.sha256, professionalCorrectness: 'NOT_RUN', oldTaskNotRun: true }, null, 2));
});
