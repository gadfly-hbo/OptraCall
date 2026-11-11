import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { startTestHost } from './fixtures/host-process.ts';
import { providerMessageText, startToolProvider } from './fixtures/tool-provider.ts';
import { sessionEvents } from './fixtures/session-events.ts';

async function read(response: Response, expected = 200): Promise<any> {
  assert.equal(response.status, expected, await response.clone().text());
  return response.json();
}

test('RCR02/07/08: actual main Agent receives one fixed review and owns correction, rejection or evidence limits', { timeout: 60_000 }, async t => {
  for (const handling of ['correct', 'reject', 'insufficient'] as const) await t.test(handling, async t => {
    const provider = await startToolProvider(); t.after(() => provider.close());
    const host = await startTestHost(); t.after(() => host.close());
    await read(await host.request('/api/configuration', 'PUT', {
      name: '前台计算复核', provider: 'openai-compatible', baseUrl: provider.baseUrl, model: 'synthetic-report-review', apiKey: 'synthetic-review-key',
    }));
    const { project } = await read(await host.request('/api/projects', 'POST', { name: '报告固定输入' }), 201);
    const { task } = await read(await host.request(`/api/projects/${project.id}/tasks`, 'POST', { name: handling }), 201);
    const route = `/api/projects/${project.id}/tasks/${task.id}`;
    await read(await host.request(`/api/projects/${project.id}/files/upload`, 'POST', { name: 'input.csv', directory: '020_clean', content: Buffer.from('item,value\na,4\nb,6\n').toString('base64') }), 201);
    await read(await host.request(`/api/projects/${project.id}/files/upload`, 'POST', { name: 'raw.csv', directory: '010_draw', content: Buffer.from('FORBIDDEN_RAW_MARKER').toString('base64') }), 201);
    const original = handling === 'correct' ? '# 初稿\n合计为9。' : '# 初稿\n合计为10。';
    const revised = '# 修订稿\n4 + 6 = 10，合计为10。';
    let childCount = 0;
    provider.setResponder(({ messages, availableTools, recentToolResults }) => {
      const system = messages.filter(message => message.role === 'system' || message.role === 'developer').map(message => providerMessageText(message.content)).join('\n');
      if (system.includes('OptraCall report-calculation reviewer')) {
        childCount++;
        assert.deepEqual(availableTools, []);
        const supplied = messages.map(message => providerMessageText(message.content)).join('\n');
        assert.match(supplied, /初稿/);
        assert.doesNotMatch(supplied, /PARENT_PRIVATE_HISTORY|FORBIDDEN_RAW_MARKER|OTHER_REPORT_UNSELECTED_MARKER/);
        assert.match(supplied, /CURRENT_USER_SCOPE/);
        return { text: handling === 'correct' ? '报告合计9与input.csv的4+6=10不一致，差1。定位「合计为9」。'
          : handling === 'reject' ? '合计应为9，请核对。'
          : '本轮未提供源明细，无法核对合计。' };
      }
      if (recentToolResults.length === 0) return { calls: [
        { name: 'write_report', arguments: { filename: 'draft.md', content: original } },
        { name: 'write_report', arguments: { filename: 'other-report.md', content: 'OTHER_REPORT_UNSELECTED_MARKER' } },
      ] };
      if (recentToolResults.length === 2) return { calls: [{ name: 'review_report_calculations', arguments: {
        report: { path: '060_reports/draft.md' },
        ...(handling === 'insufficient' ? {} : { materials: [{ path: '020_clean/input.csv' }] }),
      } }] };
      if (recentToolResults.length === 3 && handling === 'correct') return { calls: [{ name: 'write_report', arguments: { filename: 'revised.md', content: revised } }] };
      return { text: handling === 'correct' ? '已独立核对并另存revised.md，合计为10。'
        : handling === 'reject' ? '已核对源明细4+6=10，子意见缺少依据，保留draft.md中的10。'
        : '已交付draft.md，本次复核缺少源明细，合计仍待核。' };
    });
    const events = await sessionEvents(host, project.id, task.id); t.after(() => events.close());
    const requestId = randomUUID();
    await read(await host.request(route + '/messages', 'POST', { text: '生成正式报告并按实际材料复核。CURRENT_USER_SCOPE', requestId }), 202);
    await events.terminal;
    const state = await read(await host.request(route));
    assert.equal(state.task.lastRun.status, 'completed');
    assert.equal(childCount, 1);
    const native = (await readFile(state.task.sessionFile, 'utf8')).trim().split('\n').map(line => JSON.parse(line));
    const results = native.filter(entry => entry.message?.role === 'toolResult' && entry.message.toolName === 'review_report_calculations');
    assert.equal(results.length, 1);
    const receipt = results[0].message.details;
    assert.equal(receipt.outcome, 'completed');
    assert.equal(receipt.requestId, requestId);
    assert.equal(receipt.receipt.materials[0].sha256, createHash('sha256').update(original).digest('hex'));
    assert.equal(await readFile(path.join(project.rootPath, '060_reports', 'draft.md'), 'utf8'), original);
    const fixed = receipt.receipt;
    const historyPath = route + '/report-calculation-reviews/' + requestId + '/' + fixed.reviewId + '/materials/' + fixed.materials[0].id;
    const historical = await read(await host.request(historyPath + '?expectedReceiptSha256=' + fixed.sha256));
    assert.equal(historical.text, original);
    await writeFile(path.join(project.rootPath, '060_reports', 'draft.md'), '本地后续改动');
    assert.equal((await read(await host.request(historyPath))).text, original);
    await read(await host.request(historyPath + '?expectedReceiptSha256=' + 'f'.repeat(64)), 409);
    const final = state.snapshot.messages.filter((message: any) => message.role === 'assistant').at(-1);
    assert.match(providerMessageText(final.content), handling === 'insufficient' ? /仍待核/ : /10/);
    if (handling === 'correct') assert.equal(await readFile(path.join(project.rootPath, '060_reports', 'revised.md'), 'utf8'), revised);
  });
});

test('RCR05/09: withdrawing a supplied source hides the saved opinion and refuses history redispatch without changing the ledger', { timeout: 30_000 }, async t => {
  const provider = await startToolProvider(); t.after(() => provider.close());
  const host = await startTestHost(); t.after(() => host.close());
  await read(await host.request('/api/configuration', 'PUT', {
    name: '复核来源撤权', provider: 'openai-compatible', baseUrl: provider.baseUrl, model: 'synthetic-review-history', apiKey: 'synthetic-review-history-key',
  }));
  const created = await read(await host.request('/api/enterprise-materials', 'POST', { title: '计算口径', body: 'RULE_PRIVATE_MARKER 计量单位为元。' }), 201);
  const sourceRoute = '/api/enterprise-materials/' + created.material.id;
  const enabled = await read(await host.request(sourceRoute + '/enable', 'POST', { expectedVersion: created.material.version }));
  const { project } = await read(await host.request('/api/projects', 'POST', { name: '复核历史权限' }), 201);
  const { task } = await read(await host.request(`/api/projects/${project.id}/tasks`, 'POST', { name: '查看原版意见' }), 201);
  const route = `/api/projects/${project.id}/tasks/${task.id}`;
  provider.setResponder(({ messages, recentToolResults }) => {
    const system = messages.filter(message => message.role === 'system' || message.role === 'developer').map(message => providerMessageText(message.content)).join('\n');
    if (system.includes('OptraCall report-calculation reviewer')) {
      assert.match(JSON.stringify(messages), /RULE_PRIVATE_MARKER/);
      return { text: 'OPINION_PRIVATE_MARKER 该版没有提供可回算的源明细。' };
    }
    if (recentToolResults.length === 0) return { calls: [{ name: 'write_report', arguments: { filename: 'report.md', content: '# 版本一\n合计10。' } }] };
    if (recentToolResults.length === 1) return { calls: [{ name: 'codemode', arguments: {
      code: "const review = await tools.review_report_calculations({report:{path:'060_reports/report.md'}}); text(JSON.parse(review).text);",
    } }] };
    return { text: '原稿已保存，源明细待补。' };
  });
  const events = await sessionEvents(host, project.id, task.id); t.after(() => events.close());
  const requestId = randomUUID();
  await read(await host.request(route + '/messages', 'POST', {
    text: '生成并复核。', requestId,
    enterpriseMaterials: [{ storeId: enabled.storeId, materialId: enabled.material.id, revisionId: enabled.material.activeRevisionId, mode: 'full' }],
  }), 202);
  await events.terminal;
  const delivered = await read(await host.request(route));
  assert.match(JSON.stringify(delivered.snapshot.messages), /OPINION_PRIVATE_MARKER/);
  assert.equal(delivered.snapshot.capabilities.reportCalculationReview.outcome, 'completed');
  const lastReply = delivered.snapshot.messages.filter((message: any) => message.role === 'assistant' && message.nativeEntryId).at(-1);
  assert.ok(lastReply);
  const beforeBranchRequests = provider.requests.length;
  await read(await host.request(route + '/commands', 'POST', { text: '/branch ' + lastReply.nativeEntryId, requestId: randomUUID() }));
  assert.equal(provider.requests.length, beforeBranchRequests);
  const before = await read(await host.request(route));
  assert.match(JSON.stringify(before.snapshot.messages), /OPINION_PRIVATE_MARKER/);
  const native = await readFile(before.task.sessionFile);
  await read(await host.request(sourceRoute + '/disable', 'POST', { expectedVersion: enabled.material.version }));
  const hidden = await read(await host.request(route));
  assert.doesNotMatch(JSON.stringify(hidden.snapshot.messages), /OPINION_PRIVATE_MARKER/);
  if (hidden.snapshot.capabilities.reportCalculationReview) {
    assert.equal(hidden.snapshot.capabilities.reportCalculationReview.sourceStatus, 'unavailable');
    assert.equal(hidden.snapshot.capabilities.reportCalculationReview.outcome, 'completed');
  }
  const { receipts } = await read(await host.request(route + '/context-receipts'));
  assert.equal(receipts.find((entry: any) => entry.requestId === requestId).reportCalculationReview.sourceStatus, 'unavailable');
  const count = provider.requests.length;
  const denied = await read(await host.request(route + '/messages', 'POST', { text: '继续', requestId: randomUUID() }), 409);
  assert.equal(denied.code, 'report_calculation_history_source_unavailable');
  assert.equal(denied.accepted, false);
  assert.equal(provider.requests.length, count);
  assert.deepEqual(await readFile(before.task.sessionFile), native);
  assert.deepEqual((await read(await host.request(route))).task.lastRun, before.task.lastRun);
});

test('RCR09: clearing the frozen configuration cancels an in-flight child without a replacement request', { timeout: 30_000 }, async t => {
  const provider = await startToolProvider(); t.after(() => provider.close());
  const host = await startTestHost(); t.after(() => host.close());
  await read(await host.request('/api/configuration', 'PUT', {
    name: '复核配置生命周期', provider: 'openai-compatible', baseUrl: provider.baseUrl, model: 'synthetic-review-cancel', apiKey: 'synthetic-cancel-key',
  }));
  const { project } = await read(await host.request('/api/projects', 'POST', { name: '配置撤销保全' }), 201);
  const { task } = await read(await host.request(`/api/projects/${project.id}/tasks`, 'POST', { name: '取消原请求' }), 201);
  const route = `/api/projects/${project.id}/tasks/${task.id}`;
  let childSeen = false;
  provider.setResponder(({ messages, recentToolResults }) => {
    const system = messages.filter(message => message.role === 'system' || message.role === 'developer').map(message => providerMessageText(message.content)).join('\n');
    if (system.includes('OptraCall report-calculation reviewer')) { childSeen = true; return { text: '尚未完成的合成意见', hold: true }; }
    if (!recentToolResults.length) return { calls: [{ name: 'write_report', arguments: { filename: 'initial.md', content: 'CANCEL_PRESERVED_INITIAL' } }] };
    return { calls: [{ name: 'review_report_calculations', arguments: { report: { path: '060_reports/initial.md' } } }] };
  });
  const requestId = randomUUID();
  await read(await host.request(route + '/messages', 'POST', { text: '生成正式初稿后复核。', requestId }), 202);
  await provider.waitForRequests(3);
  assert.equal(childSeen, true);
  const count = provider.requests.length;
  await read(await host.request('/api/configuration', 'DELETE'));
  const state = await read(await host.request(route));
  assert.equal(provider.requests.length, count);
  assert.equal(provider.requests.at(-1)!.closedEarly, true);
  assert.equal(await readFile(path.join(project.rootPath, '060_reports/initial.md'), 'utf8'), 'CANCEL_PRESERVED_INITIAL');
  const summary = state.snapshot.capabilities.reportCalculationReview;
  assert.ok(summary);
  assert.notEqual(summary.outcome, 'completed');
  assert.equal(summary.requestId, requestId);
});
