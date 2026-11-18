import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { createSapMethodStore } from '../extensions/business-plugins/metric-factory/methods/store.ts';
import { startTestHost } from './fixtures/host-process.ts';
import { providerMessageText, startToolProvider, type ToolProviderContext } from './fixtures/tool-provider.ts';
import { withCaseGoal } from './fixtures/case-goal.ts';

function deferred() { let resolve!: () => void; const promise = new Promise<void>(yes => { resolve = yes; }); return { promise, resolve }; }
const userText = (context: ToolProviderContext) => providerMessageText([...context.messages].reverse().find(message => message.role === 'user')?.content);
const lastTool = (context: ToolProviderContext) => {
  const text = providerMessageText(context.recentToolResults[context.recentToolResults.length - 1]?.content);
  try { return JSON.parse(text); } catch { return { toolError: text }; }
};
const declaration = {
  completion: 'organize-partial', format: 'chat-summary', summary: '仅整理本轮合成材料中已发现的问题，保留专业与业务效果未知。',
  limitations: ['合成协议验证，不是专业正确或经营效果验收。'], selfCheck: { performed: true, findings: ['已核对本轮声明的范围及明确限制。'] }, methodChecks: [], reports: [],
};

async function fixture(t: import('node:test').TestContext) {
  const evidence = path.resolve('.local/overall-architecture-upgrade/development/automatic-business-feedback'); await mkdir(evidence, { recursive: true });
  const root = await mkdtemp(path.join(evidence, 'sdk-')), dataRoot = path.join(root, 'host'); await mkdir(dataRoot, { mode: 0o700 });
  // Seed through the original public authority before the isolated Host owns it.
  const methods = createSapMethodStore(path.join(dataRoot, 'metric-assets'));
  const saved = methods.save({ requestId: randomUUID(), origin: 'other', title: '合成已发布窗口方法', content: { conditions: '合成观察窗口一致时', logic: '比较前先核窗口。', judgment: '', limits: '没有真实业务验收。' }, sources: [] });
  methods.publish(saved.method.id, { requestId: randomUUID(), version: 1, expectedSha256: saved.version.contentSha256 });
  const provider = await startToolProvider(), host = await startTestHost({ dataRoot, projectsRoot: path.join(root, 'projects') });
  t.after(async () => { try { await host.close(); } finally { await provider.close(); await writeFile(path.join(root, 'provider-requests.json'), JSON.stringify(provider.requests, null, 2)); await writeFile(path.join(root, 'provider-errors.json'), JSON.stringify(provider.errors, null, 2)); await writeFile(path.join(root, 'host-output.json'), JSON.stringify(host.output(), null, 2)); } });
  await mkdir(path.join(dataRoot, 'pi'), { recursive: true }); await writeFile(path.join(dataRoot, 'pi/settings.json'), JSON.stringify({ retry: { enabled: false } }));
  const request = async (route: string, method = 'GET', input?: unknown, status = 200): Promise<any> => {
    const response = await host.request(route, method, input); assert.equal(response.status, status, await response.clone().text()); return response.json();
  };
  await request('/api/configuration', 'PUT', { name: '合成业务接续', provider: 'openai-compatible', baseUrl: provider.baseUrl, model: 'synthetic-business-feedback', apiKey: 'synthetic-business-feedback-only' });
  const { project } = await request('/api/projects', 'POST', { name: '同原任务的业务反馈' }, 201);
  const { task } = await request(`/api/projects/${project.id}/tasks`, 'POST', { name: '原分析任务' }, 201), route = `/api/projects/${project.id}/tasks/${task.id}`;
  const settings = async (patch: Record<string, boolean>) => {
    const current = await request('/api/automatic-actions/settings');
    return request('/api/automatic-actions/settings', 'POST', { operationId: randomUUID(), expectedRevision: current.revision, nodes: { ...current.nodes, ...patch } });
  };
  const start = async (text: string, extra: Record<string, unknown> = {}) => {
    const requestId = randomUUID(); await request(route + '/messages', 'POST', { requestId, text, ...extra }, 202); return requestId;
  };
  const idle = async () => {
    const deadline = Date.now() + 20_000; let state: any;
    do {
      state = await request(route);
      if (state.task.lastRun?.status && state.task.lastRun.status !== 'running' && state.snapshot.status === 'idle') {
        const entries = (await readFile(state.task.sessionFile, 'utf8')).trim().split('\n').map(line => JSON.parse(line));
        await writeFile(path.join(root, 'native-entries.json'), JSON.stringify(entries, null, 2));
        return { state, entries };
      }
      await delay(20);
    } while (Date.now() < deadline);
    assert.fail(`Original Task did not become idle: ${JSON.stringify({ task: state?.task, snapshotStatus: state?.snapshot?.status })}`);
  };
  t.diagnostic(root);
  return { root, host, provider, request, project, task, route, methods, saved, settings, start, idle };
}

test('A13/A18/A23 actual SDK Case continuation links the exact report and saves an Agent draft without a human choice', { timeout: 35_000 }, async t => {
  const f = await fixture(t); await f.settings({ save: true, case: true, ir: false, assets: false, review: false });
  await f.request('/api/cases/storage/initialize', 'POST', {});
  const { case: record } = await f.request('/api/cases', 'POST', await withCaseGoal(f.host, { operationId: randomUUID(), title: '合成已发现分歧' }), 201);
  await f.request(`/api/cases/${record.id}/projects`, 'POST', { operationId: randomUUID(), expectedRevision: record.revision, projectId: f.project.id });
  const detail = await f.request(`/api/cases/${record.id}`), project = await f.request(`/api/projects/${f.project.id}`);
  const content = '# 合成阶段报告\n\n已观察到范围差异；未证明经营改善。', relativePath = '060_reports/known-case-finding.md', sha256 = createHash('sha256').update(content).digest('hex');
  let caseTurns = 0, draftAcknowledged = false;
  f.provider.setResponder(context => {
    if (userText(context).includes('自动整理本轮已声明的Case发现')) {
      assert.ok(context.availableTools.includes('save_case_decision_draft'));
      if (context.recentToolResults.length) { draftAcknowledged = lastTool(context).saved === true; return { text: '已将本轮已发现策略保存为原Case草案，保留待人选择。' }; }
      caseTurns++;
      return { calls: [{ name: 'save_case_decision_draft', arguments: { kind: 'strategy', expectedRevision: 0, payload: { title: '已发现的限定试点', proposal: '仅在已有合成范围内继续补证，不代表用户采纳或行动授权。', limitations: `${relativePath} sha256=${sha256}；本轮仅合成协议验证。` } } }] };
    }
    return context.recentToolResults.length ? { text: '已明确整理本轮原报告与发现，局限保持。' } : { calls: [{ name: 'declare_analysis_delivery', arguments: { ...declaration, save: { filename: path.basename(relativePath), content },
      caseFindings: [{ kind: 'strategy', title: '已发现的限定试点', body: '合成材料仅支持分范围补证，尚未作人的选择。', sources: [{ authority: 'project-report', projectId: f.project.id, taskId: f.task.id, relativePath, sha256 }] }] } }] };
  });
  const initialRequest = await f.start('明确结束本轮并整理既有发现，Case策略仍留待人选择。', { caseContext: { caseId: record.id, caseRevision: detail.case.revision, projectWorkRevision: project.project.work.revision, selectedReferenceIds: [] } });
  const result = await f.idle(); assert.equal(result.state.task.lastRun.status, 'completed');
  assert.equal(caseTurns, 1); assert.equal(draftAcknowledged, true);
  const after = await f.request(`/api/cases/${record.id}`), artifact = after.artifacts.find((entry: any) => entry.relativePath === relativePath);
  assert.ok(artifact); assert.equal(artifact.observedSha256, sha256); assert.equal(artifact.taskId, f.task.id);
  assert.equal(await readFile(path.join(f.project.rootPath, relativePath), 'utf8'), content);
  const catalog = await f.request(`/api/cases/${record.id}/decisions`); assert.equal(catalog.items.length, 1); assert.equal(catalog.choices.length, 0);
  const continued = result.entries.find((entry: any) => entry.customType === 'optracall.run' && entry.data.phase === 'started' && entry.data.providedContext?.automaticSource?.kind === 'case-feedback');
  assert.ok(continued); assert.notEqual(continued.data.requestId, initialRequest); assert.ok(continued.data.providedContext.case.operationId);
  assert.equal(catalog.items[0].origin.actorKind, 'agent'); assert.equal(catalog.items[0].origin.taskId, f.task.id); assert.equal(catalog.items[0].origin.requestId, continued.data.requestId);
  assert.equal(result.entries.filter((entry: any) => entry.type === 'session').length, 1);
  assert.equal((await f.request('/api/decision-board')).items.length, 0); assert.deepEqual(f.provider.errors, []);
});

test('A18/A19/J09 actual SDK assets with IR off report only a suspected issue on the original published method', { timeout: 35_000 }, async t => {
  const f = await fixture(t); await f.settings({ save: false, review: false, ir: false, case: false, assets: true });
  const note = '本轮已发现的合成问题：原方法对观察窗口的适用条件尚不完整。'; let initialSource: any, assetSource: any, assetTurns = 0, issueAcknowledged = false, issueReply: any;
  f.provider.setResponder(context => {
    const text = userText(context);
    if (text.includes('自动整理本轮分析中已经发现的资产问题')) {
      assert.ok(context.availableTools.includes('report_method_issue')); assert.ok(!context.availableTools.includes('read_sap_method_source'));
      if (context.recentToolResults.length) { issueReply = lastTool(context); issueAcknowledged = issueReply.status === 'saved'; return { text: issueAcknowledged ? '仅把该已发现问题反馈为疑似线索，原方法和发布保持。' : '反馈未保存，保留原工具错误与原来源，待核原回执，不另造方法或发布。' }; }
      assetTurns++;
      const marker = '本轮交付声明准确来源：'; assetSource = JSON.parse(text.slice(text.indexOf(marker) + marker.length).split('\n')[0]); assert.deepEqual(assetSource, initialSource);
      return { calls: [{ name: 'report_method_issue', arguments: { methodId: f.saved.method.id, version: 1, expectedRevision: 0, note, sources: [assetSource] } }] };
    }
    if (context.recentToolResults.length) { initialSource = lastTool(context).source; return { text: '已声明本轮已有问题及局限，方法治理待原路径处理。' }; }
    return { calls: [{ name: 'declare_analysis_delivery', arguments: { ...declaration, assetFindings: [{ kind: 'method-issue', title: '本轮已发现方法条件问题', body: note, sources: [{ authority: 'sap-method', id: f.saved.method.id, version: '1', sha256: f.saved.version.contentSha256 }] }] } }] };
  });
  const initialRequest = await f.start('结束本轮并整理已发现方法问题；IR保持关闭，不提炼或发布方法。'), result = await f.idle();
  assert.deepEqual(f.provider.errors, [], 'the synthetic protocol responder must succeed before assessing product behavior');
  assert.equal(result.state.task.lastRun.status, 'completed'); assert.equal(assetTurns, 1); assert.equal(issueAcknowledged, true, JSON.stringify(issueReply));
  const method = f.methods.read(f.saved.method.id, 1); assert.equal(f.methods.list().length, 1); assert.equal(method.versions.length, 1); assert.equal(method.publications.length, 1);
  assert.deepEqual(method.versions[0], f.saved.version); assert.equal(method.governance.length, 1); assert.equal(method.governance[0].status, 'suspected'); assert.equal(method.governance[0].note, note); assert.deepEqual(method.governance[0].sources, [assetSource]);
  const continued = result.entries.find((entry: any) => entry.customType === 'optracall.run' && entry.data.phase === 'started' && entry.data.providedContext?.automaticSource?.kind === 'asset-findings');
  assert.ok(continued); assert.equal(method.governance[0].origin!.projectId, f.project.id); assert.equal(method.governance[0].origin!.taskId, f.task.id); assert.equal(method.governance[0].origin!.requestId, continued.data.requestId);
  assert.equal(assetSource.version, initialRequest); assert.equal(method.governance[0].origin!.sessionId, result.state.snapshot.sessionId);
  assert.equal(result.entries.filter((entry: any) => entry.customType === 'optracall.method-issue').length, 1);
  assert.deepEqual((await f.request(f.route + '/sap-method-extractions')).extractions, []);
  assert.equal(f.provider.requests.some(request => request.body.tools?.some(tool => tool.function?.name === 'read_sap_method_source')), false);
  assert.equal((await f.request('/api/decision-board')).items.length, 0); assert.deepEqual(f.provider.errors, []);
});

test('A04/A15 changing the accepted Case goal during author completion preserves the report and prevents automatic feedback into the new goal', { timeout: 35_000 }, async t => {
  const f = await fixture(t), entered = deferred(), release = deferred(); await f.settings({ save: true, case: true, ir: false, assets: false, review: false });
  await f.request('/api/cases/storage/initialize', 'POST', {});
  const initialInput = await withCaseGoal(f.host, { operationId: randomUUID(), title: '原管理目标下的合成分析' });
  const { case: record } = await f.request('/api/cases', 'POST', initialInput, 201);
  await f.request(`/api/cases/${record.id}/projects`, 'POST', { operationId: randomUUID(), expectedRevision: record.revision, projectId: f.project.id });
  const initial = await f.request(`/api/cases/${record.id}`), project = await f.request(`/api/projects/${f.project.id}`);
  const content = '# 旧目标下的有边界报告\n\n仅适用于原管理目标，不应自动挪到新目标。', relativePath = '060_reports/original-goal-report.md'; let caseTurns = 0;
  f.provider.setResponder(async context => {
    if (userText(context).includes('自动整理本轮已声明的Case发现')) {
      if (context.recentToolResults.length) return { text: '旧目标分析不应写到新目标。' };
      caseTurns++; return { calls: [{ name: 'save_case_decision_draft', arguments: { kind: 'strategy', expectedRevision: 0, payload: { title: '旧目标发现', proposal: '仅承接原目标的合成分析，不是新目标方案。' } } }] };
    }
    if (context.recentToolResults.length) { entered.resolve(); await release.promise; return { text: '原目标下的报告已保存，等待本轮正常结束。' }; }
    return { calls: [{ name: 'declare_analysis_delivery', arguments: { ...declaration, save: { filename: path.basename(relativePath), content }, caseFindings: [{ kind: 'strategy', title: '旧目标发现', body: '原目标的有限观察，不能自动解释为新目标的策略。', sources: [] }] } }] };
  });
  await f.start('仅在当前Case原目标下整理本轮已有发现。', { caseContext: { caseId: record.id, caseRevision: initial.case.revision, projectWorkRevision: project.project.work.revision, selectedReferenceIds: [] } });
  await entered.promise; let adopted: any;
  try {
    const { goal } = await f.request('/api/strategy/goals', 'POST', { operationId: randomUUID(), title: '用户明确改选的新目标', outcome: '新范围待另行分析', perspective: 'personal', scope: { kind: 'personal', id: 'synthetic-new-goal-scope', name: '合成用户' }, measurement: { kind: 'deliverable', criterion: '新目标有单独依据及限制' }, baseline: { state: 'pending', description: '新范围未核' }, responsible: '合成用户', strategies:['按新目标核对'] }, 201);
    adopted = (await f.request(`/api/strategy/goals/${goal.goalId}/adopt`, 'POST', { operationId: randomUUID(), version: goal.version, expectedVersion: goal.version, decision: '用户明确采纳新目标，旧报告不得自动转作新依据。' })).goal;
    const current = await f.request(`/api/cases/${record.id}`);
    await f.request(`/api/cases/${record.id}/goals`, 'POST', { operationId: randomUUID(), expectedRevision: current.case.revision, goalBinding: { primary: { goalId: adopted.goalId, version: adopted.version }, related: [], strategy:"按新目标核对" } });
  } finally { release.resolve(); }
  const result = await f.idle(), after = await f.request(`/api/cases/${record.id}`), catalog = await f.request(`/api/cases/${record.id}/decisions`);
  assert.equal(await readFile(path.join(f.project.rootPath, relativePath), 'utf8'), content);
  assert.deepEqual(after.goalBinding.primary, { goalId: adopted.goalId, version: adopted.version });
  assert.notEqual(after.goalBinding.primary.goalId, initialInput.goalBinding.primary.goalId);
  assert.equal(after.artifacts.length, 0, 'old analysis must not attach as new-goal Case evidence'); assert.equal(catalog.items.length, 0); assert.equal(catalog.choices.length, 0); assert.equal(caseTurns, 0);
  const observation = result.entries.find((entry: any) => entry.customType === 'optracall.automatic-action' && entry.data.node === 'case' && entry.data.phase === 'settled');
  assert.ok(observation); assert.equal(observation.data.outcome, 'unknown'); assert.match(observation.data.code, /goal|scope/);
  assert.deepEqual(f.provider.errors, []);
});

test('A21/A22 closing assets before its action starts blocks the continuation and reopening does not wake the ended Task', { timeout: 35_000 }, async t => {
  const f = await fixture(t), entered = deferred(), release = deferred(); await f.settings({ ir: false, assets: true }); let assetTurns = 0;
  f.provider.setResponder(async context => {
    if (userText(context).includes('自动整理本轮分析中已经发现的资产问题')) { assetTurns++; return { text: '不应启动资产接续。' }; }
    if (context.recentToolResults.length) { entered.resolve(); await release.promise; return { text: '本轮已有声明，正常结束。' }; }
    return { calls: [{ name: 'declare_analysis_delivery', arguments: { ...declaration, assetFindings: [{ kind: 'method-issue', title: '已经发现的合成问题', body: '先保留线索，是否后置处理由当前节点决定。', sources: [] }] } }] };
  });
  await f.start('明确整理当前已发现的合成问题。'); await entered.promise;
  await f.settings({ assets: false }); release.resolve(); const result = await f.idle();
  assert.equal(result.state.task.lastRun.status, 'completed'); assert.equal(assetTurns, 0); assert.equal(f.methods.read(f.saved.method.id).governance.length, 0);
  const decision = result.entries.find((entry: any) => entry.customType === 'optracall.automatic-action' && entry.data.node === 'assets' && entry.data.phase === 'decision');
  assert.ok(decision); assert.equal(decision.data.decision.reason, 'disabled');
  const calls = f.provider.requests.length; await f.settings({ assets: true }); await f.request(f.route);
  assert.equal(f.provider.requests.length, calls); assert.equal(assetTurns, 0); assert.deepEqual(f.provider.errors, []);
});

test('A22 stopping the original Task during its assets turn preserves the initial completion and prevents issue writes', { timeout: 35_000 }, async t => {
  const f = await fixture(t), entered = deferred(); await f.settings({ ir: false, assets: true });
  f.provider.setResponder(context => {
    if (userText(context).includes('自动整理本轮分析中已经发现的资产问题')) { entered.resolve(); return { text: '资产接续合成等待中', hold: true }; }
    return context.recentToolResults.length ? { text: '原分析本轮已正常整理。' } : { calls: [{ name: 'declare_analysis_delivery', arguments: { ...declaration, assetFindings: [{ kind: 'method-issue', title: '本轮明确发现', body: '等待资产反馈，停止后不得另派写入。', sources: [] }] } }] };
  });
  const original = await f.start('明确整理，允许当前全局资产节点按已发现清单处理。'); await entered.promise;
  await f.request(f.route + '/stop', 'POST', {}); const result = await f.idle();
  assert.equal(result.state.task.lastRun.status, 'cancelled');
  const first = result.entries.find((entry: any) => entry.customType === 'optracall.run' && entry.data.requestId === original && entry.data.phase === 'settled');
  assert.equal(first.data.outcome, 'completed');
  assert.equal(f.methods.read(f.saved.method.id).governance.length, 0); assert.equal(f.methods.read(f.saved.method.id).versions.length, 1);
  assert.equal(result.entries.some((entry: any) => entry.customType === 'optracall.method-issue'), false);
  assert.deepEqual((await f.request(f.route + '/sap-method-extractions')).extractions, []); assert.deepEqual(f.provider.errors, []);
});
