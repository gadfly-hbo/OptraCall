import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { startTestHost } from './fixtures/host-process.ts';
import { startToolProvider, providerMessageText } from './fixtures/tool-provider.ts';
async function fixture(t: import('node:test').TestContext) {
  const provider = await startToolProvider(), host = await startTestHost(); t.after(async () => { await host.close(); await provider.close(); });
  await mkdir(path.join(host.dataRoot, 'pi'), { recursive: true }); await writeFile(path.join(host.dataRoot, 'pi/settings.json'), JSON.stringify({ retry: { enabled: false } }));
  const request = async (route: string, method = 'GET', body?: unknown, status = 200) => { const response = await host.request(route, method, body); assert.equal(response.status, status, await response.clone().text()); return response.json(); };
  await request('/api/configuration', 'PUT', { name: '合成交付', provider: 'openai-compatible', baseUrl: provider.baseUrl, model: 'synthetic-delivery', apiKey: 'synthetic-delivery-only' });
  const { project } = await request('/api/projects', 'POST', { name: '正常交付与停止边界' }, 201);
  const { task } = await request(`/api/projects/${project.id}/tasks`, 'POST', { name: '原任务' }, 201);
  const route = `/api/projects/${project.id}/tasks/${task.id}`;
  const run = async (text: string) => { const requestId = randomUUID(); await request(route + '/messages', 'POST', { requestId, text }, 202); let state: any; const deadline = Date.now() + 15_000; do { state = await request(route); if (state.task.lastRun && state.task.lastRun.status !== 'running' && state.snapshot.status === 'idle') break; await delay(20); } while (Date.now() < deadline); return { requestId, state, entries: (await readFile(state.task.sessionFile, 'utf8')).trim().split('\n').map(line => JSON.parse(line)) }; };
  return { provider, host, project, task, route, request, run };
}
const declaration = { completion: 'organize-partial', format: 'chat-summary', summary: '合成资料不足，仅整理已知事实。', limitations: ['未取得可比窗口，不确定根因。'], selfCheck: { performed: true, findings: ['数量与陈述已有限自查，未有经营效果证据。'] }, methodChecks: [], reports: [], save: { filename: 'agent-chosen-summary.md', content: '# 合成阶段整理\n\n原限制保留。' } };

test('A23/A24: an explicit Agent delivery is kept in the same native session; default-off optional saving does not cancel self-checks', { timeout: 25_000 }, async t => {
  const f = await fixture(t);
  f.provider.setResponder(context => context.recentToolResults.length ? { text: '整理了已知事实，资料缺口保留。' } : { calls: [{ name: 'declare_analysis_delivery', arguments: declaration }] });
  const result = await f.run('明确结束并整理当前有依据的部分，不冒充完整诊断。');
  assert.equal(result.state.task.lastRun.status, 'completed');
  const intent = result.entries.find(entry => entry.customType === 'optracall.analysis-delivery');
  assert.ok(intent, 'an ordinary completed response is insufficient; use an explicit native delivery receipt');
  assert.equal(intent.data.requestId, result.requestId);
  assert.equal(intent.data.taskId, f.task.id);
  assert.equal(intent.data.completion, 'organize-partial');
  assert.equal(intent.data.selfCheck.performed, true);
  assert.equal(intent.data.save.status, 'disabled');
  assert.equal((await f.request(`/api/projects/${f.project.id}/files`)).files.find((node: any) => node.path === '060_reports').children.length, 0);
  assert.deepEqual(f.provider.errors, []);
});

test('A13/A21: optional saving reads the current global node and uses the Agent filename and original bound-report receipt', { timeout: 25_000 }, async t => {
  const f = await fixture(t), current = await f.request('/api/automatic-actions/settings');
  await f.request('/api/automatic-actions/settings', 'POST', { operationId: randomUUID(), expectedRevision: current.revision, nodes: { ...current.nodes, save: true } });
  f.provider.setResponder(context => context.recentToolResults.length ? { text: '已按实际回执整理，未验证业务效果。' } : { calls: [{ name: 'declare_analysis_delivery', arguments: declaration }] });
  const result = await f.run('明确整理当前部分，按全局设置处理附带保存。');
  assert.equal(result.state.task.lastRun.status, 'completed');
  const intent = result.entries.find(entry => entry.customType === 'optracall.analysis-delivery');
  assert.equal(intent.data.save.status, 'saved');
  assert.equal(intent.data.reports[0].relativePath, '060_reports/agent-chosen-summary.md');
  assert.equal(intent.data.reports[0].taskId, f.task.id);
  assert.equal(await readFile(path.join(f.project.rootPath, intent.data.reports[0].relativePath), 'utf8'), declaration.save.content);
  assert.ok(result.entries.some(entry => entry.customType === 'optracall.project-report-write' && entry.data.sha256 === intent.data.reports[0].sha256));
  assert.deepEqual(f.provider.errors, []);
});

test('A14/A22: the global review node reviews the exact saved draft and automatically returns its opinion to the original author session', { timeout: 30_000 }, async t => {
  const f = await fixture(t), current = await f.request('/api/automatic-actions/settings');
  await f.request('/api/automatic-actions/settings', 'POST', { operationId: randomUUID(), expectedRevision: current.revision, nodes: { ...current.nodes, save: true, review: true } });
  let reviewerCalls = 0, authorReturns = 0;
  f.provider.setResponder(context => {
    const user = providerMessageText([...context.messages].reverse().find(message => message.role === 'user')?.content);
    if (!context.availableTools.length) { reviewerCalls++; const packet = JSON.parse(user); return { text: JSON.stringify({ schemaVersion: 1, reportVersion: packet.report.sha256, claims: [], scope: { reviewed: '合成固定稿', unreviewed: ['真实业务证据未取得'], limitations: ['这不是专业验收'] } }) }; }
    if (user.includes('自动接回的准确稿件审查意见')) { authorReturns++; return { text: '原作者已核对本稿意见；无新证据，保留局限，不改为已验证效果。' }; }
    return context.recentToolResults.length ? { text: '已交付有边界的阶段整理。' } : { calls: [{ name: 'declare_analysis_delivery', arguments: declaration }] };
  });
  const result = await f.run('按当前授权明确整理。');
  assert.equal(reviewerCalls, 1);
  assert.equal(authorReturns, 1, 'do not leave automatic review as a button or isolated reviewer session');
  const delivered = result.entries.filter(entry => entry.customType === 'optracall.run' && entry.data.phase === 'started' && entry.data.providedContext?.conclusionReviews);
  assert.equal(delivered.length, 1);
  assert.equal(delivered[0].data.providedContext.conclusionReviews[0].reportSha256, result.entries.find(entry => entry.customType === 'optracall.analysis-delivery').data.reports[0].sha256);
  assert.ok(result.entries.some(entry => entry.customType === 'optracall.automatic-action' && entry.data.node === 'review' && entry.data.phase === 'settled'));
});

test('A17/A24: IR reads the fixed original source only after explicit normal delivery; an ordinary completed turn does not trigger it', { timeout: 30_000 }, async t => {
  const f = await fixture(t), current = await f.request('/api/automatic-actions/settings');
  await f.request('/api/automatic-actions/settings', 'POST', { operationId: randomUUID(), expectedRevision: current.revision, nodes: { ...current.nodes, ir: true } });
  let sourceReads = 0;
  f.provider.setResponder(() => ({ text: '普通澄清，未声明本轮交付。' }));
  await f.run('一个简单的合成澄清。');
  assert.equal(f.provider.requests.length, 1);
  f.provider.setResponder(context => {
    if (context.availableTools.includes('read_sap_method_source')) { if (!context.recentToolResults.length) { sourceReads++; return { calls: [{ name: 'read_sap_method_source', arguments: { action: 'read-session', start: 0, length: 30000 } }] }; } return { text: JSON.stringify({ kind: 'none', reason: '只有当前合成事实整理，无新的可迁移方法价值；不凑候选。' }) }; }
    return context.recentToolResults.length ? { text: '已整理，仍有资料限制。' } : { calls: [{ name: 'declare_analysis_delivery', arguments: { ...declaration, save: undefined } }] };
  });
  const result = await f.run('明确结束本轮并整理已有部分。');
  assert.equal(sourceReads, 1);
  const ir = result.entries.find(entry => entry.customType === 'optracall.automatic-action' && entry.data.node === 'ir' && entry.data.phase === 'settled'); assert.ok(ir);
  const record = await f.request(f.route + '/sap-method-extractions/' + ir.data.actionRequestId);
  assert.equal(record.extraction.status, 'empty'); assert.equal(record.extraction.incomplete, true);
  assert.deepEqual(f.provider.errors, []);
});

test('A22: stopping during the original Task automatic review cancels that review and prevents IR without rewriting the completed author run', { timeout: 30_000 }, async t => {
  const f = await fixture(t), current = await f.request('/api/automatic-actions/settings');
  await f.request('/api/automatic-actions/settings', 'POST', { operationId: randomUUID(), expectedRevision: current.revision, nodes: { ...current.nodes, save: true, review: true, ir: true } });
  let irCalls = 0;
  f.provider.setResponder(context => {
    if (!context.availableTools.length) return { text: '合成审查等待中', hold: true };
    if (context.availableTools.includes('read_sap_method_source')) { irCalls++; return { text: JSON.stringify({ kind: 'none', reason: '不应启动' }) }; }
    return context.recentToolResults.length ? { text: '原分析已交付。' } : { calls: [{ name: 'declare_analysis_delivery', arguments: declaration }] };
  });
  const running = f.run('明确整理，随后可审查。');
  await f.provider.waitForRequests(3);
  await f.request(f.route + '/stop', 'POST', {});
  const result = await running;
  assert.equal(irCalls, 0);
  assert.equal(result.state.task.lastRun.status, 'completed', 'the original author completion is separate from stopping subsequent work');
  const reviews = await f.request(f.route + '/conclusion-reviews'); assert.equal(reviews.reviews[0].state, 'cancelled');
  assert.equal(result.entries.some(entry => entry.customType === 'optracall.automatic-action' && entry.data.node === 'ir'), false);
});

test('A13: repeated saving of the same bound filename and content reuses its exact original report without another file or invented authorship', { timeout: 25_000 }, async t => {
  const f = await fixture(t), current = await f.request('/api/automatic-actions/settings');
  await f.request('/api/automatic-actions/settings', 'POST', { operationId: randomUUID(), expectedRevision: current.revision, nodes: { ...current.nodes, save: true } });
  f.provider.setResponder(context => context.recentToolResults.length < 2 ? { calls: [{ name: 'declare_analysis_delivery', arguments: declaration }] } : { text: '同一内容沿原报告引用，不覆盖原稿。' });
  const result = await f.run('明确整理，同一成果重复请求保留原引用。');
  const intents = result.entries.filter(entry => entry.customType === 'optracall.analysis-delivery');
  assert.equal(intents.length, 2);
  assert.equal(intents[1].data.save.status, 'reused');
  assert.equal(intents[0].data.reports[0].toolCallId, intents[1].data.reports[0].toolCallId);
  assert.equal(result.entries.filter(entry => entry.customType === 'optracall.project-report-write').length, 1);
  const files = await f.request(`/api/projects/${f.project.id}/files`); assert.equal(files.files.find((node: any) => node.path === '060_reports').children.length, 1);
});

test('A14: automatic review uses only declared exact basis versions and never silently changes to a newer file', { timeout: 25_000 }, async t => {
  const f = await fixture(t), current = await f.request('/api/automatic-actions/settings'), basis = '合成依据：仅描述当前核对范围，无效果结论。', sha256 = createHash('sha256').update(basis).digest('hex');
  await f.request(`/api/projects/${f.project.id}/files/upload`, 'POST', { directory: '020_clean', name: 'basis.txt', content: Buffer.from(basis).toString('base64') }, 201);
  await f.request('/api/automatic-actions/settings', 'POST', { operationId: randomUUID(), expectedRevision: current.revision, nodes: { ...current.nodes, save: true, review: true } });
  let packet: any;
  f.provider.setResponder(context => {
    const text = providerMessageText([...context.messages].reverse().find(message => message.role === 'user')?.content);
    if (!context.availableTools.length) { packet = JSON.parse(text); return { text: JSON.stringify({ schemaVersion: 1, reportVersion: packet.report.sha256, claims: [], scope: { reviewed: '准确报告与所示依据', unreviewed: [], limitations: ['不等于实际采用或专业正确'] } }) }; }
    if (text.includes('自动接回的准确稿件审查意见')) return { text: '原作者保留准确依据与局限。' };
    return context.recentToolResults.length ? { text: '阶段成果已交付。' } : { calls: [{ name: 'declare_analysis_delivery', arguments: { ...declaration, reviewBasis: [{ relativePath: '020_clean/basis.txt', sha256 }] } }] };
  });
  await f.run('整理本轮并准确审查所声明依据。');
  assert.ok(packet, 'the declaration must reach the existing exact review-material path');
  assert.equal(packet.materials.find((item: any) => item.id === 'basis-1').sha256, sha256);
  assert.equal(packet.content.find((item: any) => item.id === 'basis-1').text, basis);
});
