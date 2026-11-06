import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { startTestHost } from './fixtures/host-process.ts';
import { startToolProvider, providerMessageText } from './fixtures/tool-provider.ts';

const ANALYSIS_ASSETS = path.resolve(process.cwd(), 'extensions/analysis-assets');
const SKILL_DIR = path.join(ANALYSIS_ASSETS, 'data-analysis');

async function json(response: Response, expected = 200): Promise<any> { assert.equal(response.status, expected, await response.clone().text()); return response.json(); }
async function settled(host: Awaited<ReturnType<typeof startTestHost>>, route: string, requestId: string) {
  const deadline = Date.now() + 60_000;
  for (;;) {
    const state = await json(await host.request(route));
    if (state.task.lastRun?.id === requestId && state.task.lastRun.status !== 'running') {
      assert.equal(state.task.lastRun.status, 'completed'); return state;
    }
    if (Date.now() > deadline) assert.fail(`Agent flow did not settle: ${JSON.stringify(state.task.lastRun)}`);
    await new Promise(resolve => setTimeout(resolve, 30));
  }
}

function shellQuote(value: string) { return "'" + value.replaceAll("'", "'\\''") + "'"; }

// Synthetic routing proves discovery, skill reads, real script execution and the
// delivery gate; it does not measure a real model's analysis quality.
test('DA08: SDK task reads data-analysis, runs both selftests, decomposes and saves a gated report', { timeout: 120_000 }, async t => {
  const provider = await startToolProvider(); t.after(() => provider.close());
  const host = await startTestHost({ timeoutMs: 15_000 }); t.after(() => host.close());
  await json(await host.request('/api/configuration', 'PUT', { name: '分析合成', provider: 'openai-compatible', baseUrl: provider.baseUrl, model: 'synthetic-da-model', apiKey: 'synthetic-da-key' }));
  const { project } = await json(await host.request('/api/projects', 'POST', { name: '运营数据分析合成项目' }), 201);
  const { task } = await json(await host.request('/api/projects/' + project.id + '/tasks', 'POST', { name: '运营数据分析' }), 201);
  const reportName = 'data-analysis-合成报告.md';
  const command = [
    'python3 ' + shellQuote(path.join(SKILL_DIR, 'scripts/calc.py')) + ' --selftest',
    'python3 ' + shellQuote(path.join(SKILL_DIR, 'scripts/quality_check.py')) + ' --self-test',
    'python3 ' + shellQuote(path.join(SKILL_DIR, 'scripts/calc.py')) + ' decompose --metric 直营03销售额 --base "成交笔数:1400,客单价:90" --current "成交笔数:1260,客单价:95" > da-decompose.json',
    'python3 -c ' + shellQuote("import json; d=json.load(open('da-decompose.json')); print('RESULT '+json.dumps({'engine':d['engine'],'closure':d['closure']['diff'],'total':d['total_change']}))"),
  ].join(' && ');
  let observed: { engine: string; closure: string; total: string } | undefined;
  provider.setResponder(context => {
    if (context.requestNumber === 1) return { calls: [{ name: 'read', arguments: { path: path.join(SKILL_DIR, 'SKILL.md') } }] };
    if (context.requestNumber === 2) {
      const skillText = context.recentToolResults.map(message => providerMessageText(message.content)).join('\n');
      assert.match(skillText, /name: data-analysis/);
      return { calls: [{ name: 'bash', arguments: { command } }] };
    }
    if (context.requestNumber === 3) {
      const output = context.recentToolResults.map(message => providerMessageText(message.content)).join('\n');
      const match = /^RESULT (.+)$/m.exec(output);
      assert.ok(match, 'the calculation must return its actual identity: ' + output.slice(-1000));
      observed = JSON.parse(match[1]);
      assert.equal(observed!.engine, 'optracall-data-calc-1');
      assert.equal(observed!.closure, '0.00', 'decomposition must close exactly');
      assert.equal(observed!.total, '-6300.00');
      const report = ['# 直营03销售额拆解（合成验证）', '',
        '- 复算引擎：' + observed!.engine, '- 拆解闭合差额：' + observed!.closure + '（≤0.01 达标）', '- 总变动：' + observed!.total + '（笔数效应 −12600.00 ＋ 客单价效应 +6300.00）',
        '- 行动：由直营门店运营负责人在两周内核实客流下滑原因，跟踪指标：日均客流环比回复率。', '',
        '完整脚本输出见 020_clean/da-decompose.json；本报告为合成路由验证，非真实分析结论。'].join('\n');
      return { calls: [{ name: 'write', arguments: { path: '../060_reports/' + reportName, content: report } }] };
    }
    return { text: '运营数据分析合成报告已保存。' };
  });
  const requestId = randomUUID();
  const route = '/api/projects/' + project.id + '/tasks/' + task.id;
  await json(await host.request(route + '/messages', 'POST', { text: '请使用运营数据分析skill，跑脚本自测、做直营03拆解并保存报告', requestId }), 202);
  await provider.waitForRequests(4, 60_000);
  await settled(host, route, requestId);
  const messages = provider.requests.at(-1)!.body.messages!;
  const calls = messages.filter((message: any) => message.role === 'assistant').flatMap((message: any) => message.tool_calls ?? []) as { function: { name: string; arguments: string } }[];
  assert.deepEqual(calls.map(call => call.function.name), ['read', 'bash', 'write']);
  assert.equal(JSON.parse(calls[0].function.arguments).path, path.join(SKILL_DIR, 'SKILL.md'));
  const firstRequest = JSON.stringify(provider.requests[0].body.messages);
  assert.match(firstRequest, /data-analysis/, 'the skill must be discoverable in the first SDK request');
  const decompose = JSON.parse(await readFile(path.join(project.rootPath, '020_clean', 'da-decompose.json'), 'utf8'));
  assert.equal(decompose.engine, observed!.engine);
  assert.equal(decompose.closure.diff, '0.00');
  const effects = Object.fromEntries(decompose.effects.map((e: any) => [e.factor, e.effect]));
  assert.equal(effects['成交笔数'], '-12600.00');
  assert.equal(effects['客单价'], '6300.00');
  const report = await readFile(path.join(project.rootPath, '060_reports', reportName), 'utf8');
  assert.ok(report.includes('复算引擎：' + observed!.engine));
  assert.ok(report.includes('负责人') && report.includes('两周内'), 'the report must carry owner and deadline');
});
