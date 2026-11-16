import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { startTestHost } from './fixtures/host-process.ts';
import { startToolProvider, providerMessageText } from './fixtures/tool-provider.ts';
import { readTaskAnalysisDelivery } from '../src/host/task-analysis-delivery.ts';
import { canonicalDataContextValue } from '../src/host/project-data-context-request.ts';
import type { ProjectRecord, TaskRecord } from '../src/host/project-store.ts';

const evidence = path.resolve('.local/overall-architecture-upgrade/development/delivery-native-repair');
const declaration = { completion: 'organize-partial', format: 'chat-summary', summary: '合成明确结束整理；专业结果未知。', limitations: ['只做工程接缝验证。'], selfCheck: { performed: true, findings: [] }, methodChecks: [], reports: [] };
async function environment(t: TestContext, name: string, nodes: { ir?: boolean; save?: boolean }) {
  await mkdir(evidence, { recursive: true }); const root = await mkdtemp(path.join(evidence, name + '-'));
  await mkdir(path.join(root, 'host/pi'), { recursive: true }); await writeFile(path.join(root, 'host/pi/settings.json'), JSON.stringify({ retry: { enabled: false } }));
  const provider = await startToolProvider(); t.after(() => provider.close()); const host = await startTestHost({ dataRoot: path.join(root, 'host'), projectsRoot: path.join(root, 'projects') }); t.after(() => host.close()); t.diagnostic(root);
  t.after(() => writeFile(path.join(root, 'provider-observations.json'), JSON.stringify({ errors: provider.errors, requests: provider.requests.map(request => ({ body: request.body, closedEarly: request.closedEarly })), host: host.output() }, null, 2)));
  const request = async (route: string, method = 'GET', body?: unknown, status = 200): Promise<any> => { const response = await host.request(route, method, body); assert.equal(response.status, status, await response.clone().text()); return response.json(); };
  await request('/api/configuration', 'PUT', { name: '原生交付合成配置', provider: 'openai-compatible', baseUrl: provider.baseUrl, model: 'synthetic-delivery-native', apiKey: 'synthetic-delivery-native-only' });
  const { project } = await request('/api/projects', 'POST', { name: '准确原生交付' }, 201), { task } = await request(`/api/projects/${project.id}/tasks`, 'POST', { name: '原生交付任务' }, 201);
  const settings = await request('/api/automatic-actions/settings'); await request('/api/automatic-actions/settings', 'POST', { operationId: randomUUID(), expectedRevision: settings.revision, nodes: { ...settings.nodes, ...nodes } });
  const route = `/api/projects/${project.id}/tasks/${task.id}`, requestId = randomUUID();
  const readState = async (state: any) => { const native = state.task.sessionFile ? (await readFile(state.task.sessionFile, 'utf8')).trim().split('\n').map(line => JSON.parse(line)) : []; return { state, native }; };
  const read = async () => readState(await request(route));
  let unavailableSnapshotReads = 0;
  const pollRead = async () => {
    const response = await host.request(route), state = await response.json();
    // A fail-closed native snapshot can be unavailable while the owned run is
    // still appending. This is an observation, never a successful source read.
    if (response.status === 409 && state.code === 'session_history_unavailable') { unavailableSnapshotReads++; return undefined; }
    assert.equal(response.status, 200, JSON.stringify(state));
    return readState(state);
  };
  return { root, provider, host, request, project, task, route, requestId, read, pollRead, unavailableSnapshotReads: () => unavailableSnapshotReads };
}
for (const { nested, long } of [{ nested: false, long: false }, { nested: true, long: false }, { nested: false, long: true }, { nested: true, long: true }]) test(`actual Pi ${nested ? 'nested' : 'direct'} ${long ? '11KB' : 'short'} declaration retains the exact original receipt and dispatches one original IR follow-up`, { timeout: 25_000 }, async t => {
  const f = await environment(t, `${nested ? 'nested' : 'direct'}-${long ? 'long' : 'short'}`, { ir: true }); let irCalls = 0;
  const payload = long ? { ...declaration, limitations: Array.from({ length: 6 }, (_, index) => `${index}: ` + 'x'.repeat(1900)) } : declaration;
  f.provider.setResponder(context => { if (context.availableTools.includes('read_sap_method_source')) { irCalls++; return { text: JSON.stringify({ kind: 'none', reason: '合成任务没有可迁移方法，不制造资产。' }) }; } return context.recentToolResults.length ? { text: '合成结束整理已明确，原状态分别保留。' } : { calls: [{ name: nested ? 'codemode' : 'declare_analysis_delivery', arguments: nested ? { code: `text(await tools.declare_analysis_delivery(${JSON.stringify(payload)}));` } : payload }] }; });
  await f.request(f.route + '/messages', 'POST', { requestId: f.requestId, text: '明确结束并整理此合成任务。' }, 202);
  let saved: Awaited<ReturnType<typeof f.read>> | undefined; const deadline = Date.now() + 6000;
  do { const current = await f.pollRead(); if (current) saved = current; if (saved?.state.snapshot.status === 'idle' && saved.state.task.lastRun?.status === 'completed' && saved.native.some(entry => entry.customType === 'optracall.automatic-action' && entry.data.node === 'assets' && entry.data.phase === 'decision')) break; await delay(20); } while (Date.now() < deadline);
  assert.equal(saved?.state.snapshot.status, 'idle', 'the original owner must finish within the unchanged observation deadline');
  assert.equal(saved!.state.task.lastRun?.status, 'completed'); assert.equal(irCalls, 1); assert.deepEqual(f.provider.errors, []);
  const exact = await readTaskAnalysisDelivery(saved!.state.project as ProjectRecord, saved!.state.task as TaskRecord, f.requestId); assert.ok(exact); assert.equal(exact.requestId, f.requestId); assert.equal(exact.projectId, f.project.id); assert.equal(exact.taskId, f.task.id);
  const custom = saved!.native.filter(entry => entry.customType === 'optracall.analysis-delivery'); assert.equal(custom.length, 1); assert.deepEqual(exact, custom[0].data);
  const confirmations = saved!.native.filter(entry => entry.customType === 'optracall.analysis-delivery-receipt'); assert.equal(confirmations.length, 1); assert.equal(confirmations[0].data.delivery.entryId, custom[0].id); assert.equal(confirmations[0].data.delivery.requestId, f.requestId);
  if (nested) {
    const parent = saved!.native.find(entry => entry.message?.role === 'toolResult' && entry.message.nestedCalls?.calls.some((call: any) => call.id === exact.toolCallId)); assert.ok(parent); assert.equal(parent.message.nestedCalls.complete, !long); assert.equal(parent.message.isError, false);
    if (long) { assert.equal(parent.message.nestedCalls.calls[0].arguments, undefined); assert.ok(parent.message.nestedCalls.calls[0].argumentsBytes > 8192); }
    if (!long) {
    // These are corrupted copies of the actual SDK transcript, never edits to
    // the original or a new execution/receipt authority.
    const variants: [string, (entries: any[]) => void][] = [
      ['missing-target-record', entries => { entries.find(entry => entry.id === parent.id).message.nestedCalls.calls = []; entries.find(entry => entry.id === parent.id).message.nestedCalls.complete = false; }],
      ['failed-parent', entries => { entries.find(entry => entry.id === parent.id).message.isError = true; }],
      ['failed-child', entries => { entries.find(entry => entry.id === parent.id).message.nestedCalls.calls[0].status = 'error'; }],
      ['forged-child-id', entries => { entries.find(entry => entry.id === parent.id).message.nestedCalls.calls[0].id = 'unrelated/1'; }],
      ['different-arguments', entries => { entries.find(entry => entry.id === parent.id).message.nestedCalls.calls[0].arguments.summary = '伪造另一声明'; }],
      ['missing-original-call', entries => { for (const entry of entries) if (entry.message?.role === 'assistant' && Array.isArray(entry.message.content)) for (const call of entry.message.content) if (call.type === 'toolCall' && call.id === parent.message.toolCallId) call.name = 'unrelated-tool'; }],
      ['different-completed-branch', entries => { const started = entries.find(entry => entry.customType === 'optracall.run' && entry.data.requestId === f.requestId && entry.data.phase === 'started'); entries.find(entry => entry.customType === 'optracall.run' && entry.data.requestId === f.requestId && entry.data.phase === 'settled').parentId = started.id; }],
      ['changed-source-hash', entries => { entries.find(entry => entry.customType === 'optracall.analysis-delivery').data.source.sha256 = '0'.repeat(64); }],
      ['changed-report-sources', entries => { entries.find(entry => entry.customType === 'optracall.analysis-delivery').data.reportSources = [{ type: 'report', ref: 'unrelated-report', label: '不存在的报告', version: '0'.repeat(64), sha256: '0'.repeat(64) }]; }],
      ['saved-without-report', entries => { const data = entries.find(entry => entry.customType === 'optracall.analysis-delivery').data; entries.find(entry => entry.id === parent.id).message.nestedCalls.calls[0].arguments.save = { filename: 'never-saved.md', content: '不存在的保存' }; data.save = { status: 'saved', settingsRevision: 1 }; const { source: _source, reportSources: _reports, ...basis } = data; data.source.sha256 = createHash('sha256').update(canonicalDataContextValue(basis)).digest('hex'); }],
    ];
    const rejected: string[] = [];
    for (const [name, mutate] of variants) { const entries = structuredClone(saved!.native); mutate(entries); const file = path.join(saved!.state.task.sessionDirectory, `forged-${name}.jsonl`); await writeFile(file, entries.map(entry => JSON.stringify(entry)).join('\n') + '\n'); try { await readTaskAnalysisDelivery(saved!.state.project as ProjectRecord, { ...saved!.state.task, sessionFile: file } as TaskRecord, f.requestId); } catch (error) { assert.match(String(error), /analysis_delivery_receipt_unavailable/, name); rejected.push(name); } }
    assert.deepEqual(rejected, variants.map(([name]) => name), 'each corrupted original must be rejected');
    } else {
      const variants: [string, (entries: any[]) => void][] = [
        ['missing-confirmation', entries => { entries.find(entry => entry.id === confirmations[0].id).customType = 'optracall.unrelated'; }],
        ['wrong-confirmation-hash', entries => { entries.find(entry => entry.id === confirmations[0].id).data.delivery.sha256 = '0'.repeat(64); }],
        ['wrong-confirmation-entry', entries => { entries.find(entry => entry.id === confirmations[0].id).data.delivery.entryId = parent.id; }],
        ['wrong-confirmation-request', entries => { entries.find(entry => entry.id === confirmations[0].id).data.delivery.requestId = 'another-request'; }],
        ['failed-recorded-child', entries => { entries.find(entry => entry.id === parent.id).message.nestedCalls.calls[0].status = 'error'; }],
        ['missing-recorded-child', entries => { entries.find(entry => entry.id === parent.id).message.nestedCalls.calls = []; }],
      ];
      for (const [name, mutate] of variants) { const entries = structuredClone(saved!.native); mutate(entries); const file = path.join(saved!.state.task.sessionDirectory, `omitted-${name}.jsonl`); await writeFile(file, entries.map(entry => JSON.stringify(entry)).join('\n') + '\n'); await assert.rejects(readTaskAnalysisDelivery(saved!.state.project as ProjectRecord, { ...saved!.state.task, sessionFile: file } as TaskRecord, f.requestId), /analysis_delivery_receipt_unavailable/, name); }
    }
  }
  await f.request(f.route + '/messages', 'POST', { requestId: f.requestId, text: '明确结束并整理此合成任务。' }, 202); assert.equal(irCalls, 1, 'original request replay must not rerun the nested declaration or its follow-up');
  await writeFile(path.join(f.root, 'receipt.json'), JSON.stringify({ nested, long, native: saved!.state.task.sessionFile, projectId: exact.projectId, taskId: exact.taskId, requestId: exact.requestId, sessionId: exact.sessionId, toolCallId: exact.toolCallId, irCalls, sourceRetainedExactly: true, originalSavedConfirmation: confirmations[0].id, sdkArgumentsOmitted: nested && long, forgedCopiesRejected: nested ? long ? 6 : 10 : 0, unavailableSnapshotReads: f.unavailableSnapshotReads(), professionalCorrectness: 'NOT_RUN' }, null, 2));
});

test('a schema-valid over-budget declaration is rejected before saving; repeated rejection and a corrected same-request save leave one bound reusable original', { timeout: 25_000 }, async t => {
  const f = await environment(t, 'payload-budget', { save: true }), filename = 'synthetic-budget-report.md', content = '# 合成预算检查\n';
  const large = { ...declaration, limitations: Array.from({ length: 20 }, (_, index) => `${index}: ` + 'x'.repeat(1900)), save: { filename, content } }, small = { ...declaration, save: { filename, content } };
  let filesAfterRejected: string[] | undefined; const replies: string[] = [];
  f.provider.setResponder(async context => {
    const count = context.recentToolResults.length;
    if (count) replies.push(providerMessageText(context.recentToolResults.at(-1)!.content));
    if (count === 2) filesAfterRejected = await readdir(path.join(f.project.rootPath, '060_reports'));
    return count >= 4 ? { text: '合成预算反例结束；原错误与准确报告分别记录。' } : { calls: [{ name: 'declare_analysis_delivery', arguments: count < 2 ? large : small }] };
  });
  await f.request(f.route + '/messages', 'POST', { requestId: f.requestId, text: '明确结束整理；预算失败不得先写报告。' }, 202);
  let saved: Awaited<ReturnType<typeof f.read>> | undefined; const deadline = Date.now() + 15_000;
  do { saved = await f.read(); if (saved.state.task.lastRun?.status !== 'running' && saved.state.snapshot.status === 'idle') break; await delay(20); } while (Date.now() < deadline);
  assert.equal(saved!.state.task.lastRun?.status, 'completed'); assert.deepEqual(filesAfterRejected, [], 'no report may be created before both rejected oversized callbacks');
  assert.equal(replies.length, 4); for (const reply of replies.slice(0, 2)) assert.match(reply, /analysis_delivery_payload_limit/);
  const declarations = saved!.native.filter(entry => entry.customType === 'optracall.analysis-delivery'), reports = saved!.native.filter(entry => entry.customType === 'optracall.project-report-write');
  assert.equal(declarations.length, 2); assert.equal(reports.length, 1); assert.equal(declarations[0].data.save.status, 'saved'); assert.equal(declarations[1].data.save.status, 'reused'); assert.equal(reports[0].data.requestId, f.requestId); assert.equal(declarations[1].data.reports[0].toolCallId, reports[0].data.toolCallId);
  assert.deepEqual(await readdir(path.join(f.project.rootPath, '060_reports')), [filename]); assert.equal(await readFile(path.join(f.project.rootPath, '060_reports', filename), 'utf8'), content); assert.deepEqual(f.provider.errors, []);
  await writeFile(path.join(f.root, 'receipt.json'), JSON.stringify({ native: saved!.state.task.sessionFile, requestId: f.requestId, rejectedBeforeSave: 2, filesAfterRejected, boundReports: reports.length, exactDeclarations: declarations.length, saveStatuses: declarations.map(entry => entry.data.save.status), originalReportCallId: reports[0].data.toolCallId, reusedReportCallId: declarations[1].data.reports[0].toolCallId, workerBudgetExpanded: false }, null, 2));
});
