import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { startTestHost } from './fixtures/host-process.ts';
import { startToolProvider, providerMessageText } from './fixtures/tool-provider.ts';

const ANALYSIS_ASSETS = path.resolve(process.cwd(), 'extensions/analysis-assets');

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

// Synthetic routing proves discovery, skill reads and real tool execution; it does
// not measure a real model's ability to select the right skill.
const flows = [
  { skill: 'roi-forecast', title: '投放 ROI 测算', engine: 'optracall-roi-2',
    input: 'roi-input.json', output: 'roi-out.json',
    commands: (script: (name: string) => string) => [
      script('roi.py') + ' template -o roi-input.json',
      script('roi.py') + ' run --input roi-input.json -o roi-out.json',
    ], metric: "d['result']['scenarios']['基准']['totals']['net']" },
  { skill: 'coupon-forecast', title: '优惠券测算', engine: 'optracall-coupon-2',
    input: 'coupon-input.json', output: 'coupon-out.json',
    commands: (script: (name: string) => string) => [
      script('coupon.py') + ' template -o coupon-input.json',
      script('coupon.py') + ' compare --input coupon-input.json -o coupon-out.json',
    ], metric: "d['result']['rows'][0]['metrics']['incremental_contribution_cents']" },
  { skill: 'target-forecast', title: '经营目标测算', engine: 'optracall-forecast-2',
    input: 'forecast-input.json', output: 'forecast-out.json',
    commands: (script: (name: string) => string) => [
      // Node CI uses standard-library calculation only. Xlsx import/template
      // acceptance runs separately with the declared openpyxl environment.
      'python3 -c ' + shellQuote("import json; p=json.load(open(" + JSON.stringify(path.join(ANALYSIS_ASSETS, 'target-forecast/scripts/golden/engine-expected.json')) + "))['input']; json.dump(p,open('forecast-input.json','w'))"),
      script('forecast.py') + ' run --input forecast-input.json -o forecast-out.json',
    ], metric: "d['result']['consolidated'][0]['GMV_主口径']" },
];

function shellQuote(value: string) { return "'" + value.replaceAll("'", "'\\''") + "'"; }

for (const flow of flows) test('TF11: SDK task reads ' + flow.skill + ', calculates and saves its report', { timeout: 120_000 }, async t => {
  const provider = await startToolProvider(); t.after(() => provider.close());
  const host = await startTestHost({ timeoutMs: 15_000 }); t.after(() => host.close());
  await json(await host.request('/api/configuration', 'PUT', { name: '测算合成', provider: 'openai-compatible', baseUrl: provider.baseUrl, model: 'synthetic-tf-model', apiKey: 'synthetic-tf-key' }));
  const { project } = await json(await host.request('/api/projects', 'POST', { name: flow.title + '合成项目' }), 201);
  const { task } = await json(await host.request('/api/projects/' + project.id + '/tasks', 'POST', { name: flow.title }), 201);
  const reportName = flow.skill + '-合成报告.md';
  const script = (name: string) => 'python3 ' + shellQuote(path.join(ANALYSIS_ASSETS, flow.skill, 'scripts', name));
  let observed: { engine: string; digest: string; value: number } | undefined;
  provider.setResponder(context => {
    if (context.requestNumber === 1) return { calls: [{ name: 'read', arguments: { path: path.join(ANALYSIS_ASSETS, flow.skill, 'SKILL.md') } }] };
    if (context.requestNumber === 2) {
      const skillText = context.recentToolResults.map(message => providerMessageText(message.content)).join('\n');
      assert.match(skillText, new RegExp('name: ' + flow.skill));
      const identity = "import json; d=json.load(open('" + flow.output + "')); print('RESULT '+json.dumps({'engine':d['engine_version'],'digest':d['input_digest'],'value':" + flow.metric + "}))";
      return { calls: [{ name: 'bash', arguments: { command: [...flow.commands(script), 'python3 -c ' + shellQuote(identity)].join(' && ') } }] };
    }
    if (context.requestNumber === 3) {
      const output = context.recentToolResults.map(message => providerMessageText(message.content)).join('\n');
      const match = /^RESULT (.+)$/m.exec(output);
      assert.ok(match, 'calculation must return its actual identity and number: ' + output.slice(-1000));
      observed = JSON.parse(match[1]);
      assert.equal(observed!.engine, flow.engine);
      assert.match(observed!.digest, /^[0-9a-f]{16}$/);
      assert.ok(Number.isFinite(observed!.value));
      const report = ['# ' + flow.title + '报告（合成验证）', '',
        '- 引擎：' + observed!.engine, '- 输入摘要：' + observed!.digest,
        '- 脚本结果示例值：' + observed!.value, '- 情景推演 · 非预测承诺', '',
        '固定合成输入见 020_clean/' + flow.input + '，完整脚本结果见 020_clean/' + flow.output + '。'].join('\n');
      return { calls: [{ name: 'write', arguments: { path: '../060_reports/' + reportName, content: report } }] };
    }
    return { text: flow.title + '合成报告已保存。' };
  });
  const requestId = randomUUID();
  const route = '/api/projects/' + project.id + '/tasks/' + task.id;
  await json(await host.request(route + '/messages', 'POST', { text: '请使用' + flow.title + 'skill，以合成模板计算并保存报告', requestId }), 202);
  await provider.waitForRequests(4, 60_000);
  await settled(host, route, requestId);
  const messages = provider.requests.at(-1)!.body.messages!;
  const calls = messages.filter(message => message.role === 'assistant').flatMap(message => message.tool_calls ?? []) as { function: { name: string; arguments: string } }[];
  const reads = calls.filter(call => call.function.name === 'read');
  assert.equal(reads.length, 1);
  assert.equal(JSON.parse(reads[0].function.arguments).path, path.join(ANALYSIS_ASSETS, flow.skill, 'SKILL.md'));
  assert.deepEqual(calls.map(call => call.function.name), ['read', 'bash', 'write']);
  const tools = new Set(provider.requests.flatMap(record => (record.body.tools ?? []).map(tool => tool.function?.name ?? '')));
  for (const name of ['read', 'bash', 'edit', 'write']) assert.ok(tools.has(name));
  const firstRequest = JSON.stringify(provider.requests[0].body.messages);
  for (const skill of flows) assert.match(firstRequest, new RegExp(skill.skill), 'all skills must be discoverable');
  const report = await readFile(path.join(project.rootPath, '060_reports', reportName), 'utf8');
  const output = JSON.parse(await readFile(path.join(project.rootPath, '020_clean', flow.output), 'utf8'));
  assert.equal(output.engine_version, observed!.engine);
  assert.equal(output.input_digest, observed!.digest);
  assert.ok(report.includes('脚本结果示例值：' + observed!.value));
  assert.ok(report.includes('引擎：' + output.engine_version));
  assert.ok(report.includes('输入摘要：' + output.input_digest));
  assert.match(report, /非预测承诺/);
});

test('TF01: a managed product task discovers all three skills from protected snapshots', { skip: process.platform !== 'darwin', timeout: 60_000 }, async t => {
  const provider = await startToolProvider(); t.after(() => provider.close());
  const host = await startTestHost({ timeoutMs: 15_000 }); t.after(() => host.close());
  await json(await host.request('/api/configuration', 'PUT', { name: '受管发现合成', provider: 'openai-compatible', baseUrl: provider.baseUrl, model: 'synthetic-tf-model', apiKey: 'synthetic-tf-key' }));
  const { project } = await json(await host.request('/api/projects', 'POST', { name: '受管测算发现' }), 201);
  const { task } = await json(await host.request('/api/projects/' + project.id + '/tasks', 'POST', { name: '只核对skill发现' }), 201);
  await json(await host.request('/api/projects/' + project.id + '/files/upload', 'POST', { directory: '020_clean', name: 'source.csv', content: Buffer.from('amount\n1\n').toString('base64') }), 201);
  const route = '/api/projects/' + project.id + '/tasks/' + task.id;
  assert.equal((await json(await host.request(route + '/automatic-verification/capabilities'))).supported, true);
  await json(await host.request(route + '/automatic-verification/settings', 'PUT', { expectedRevision: 0, settings: { enabled: true, question: '合成发现探针', dataFiles: ['020_clean/source.csv'], reportPath: '060_reports/unused.md' } }));
  provider.setResponder(() => ({ text: '已发现三类skill；本次不做测算或生成报告。' }));
  const requestId = randomUUID();
  await json(await host.request(route + '/messages', 'POST', { text: '只核对可用skill，不写报告', requestId }), 202);
  await provider.waitForRequests(1);
  await settled(host, route, requestId);
  const prompt = provider.requests[0].body.messages!.map(message => providerMessageText(message.content)).join('\n');
  for (const flow of flows) {
    const match = new RegExp('<name>' + flow.skill + '</name>[\\s\\S]*?<location>([^<]+)</location>').exec(prompt);
    assert.ok(match, 'managed prompt must advertise ' + flow.skill);
    assert.ok(!match[1].startsWith(ANALYSIS_ASSETS), 'managed skill must point to its protected snapshot');
    assert.equal(await readFile(match[1], 'utf8'), await readFile(path.join(ANALYSIS_ASSETS, flow.skill, 'SKILL.md'), 'utf8'));
  }
  assert.equal(provider.requests.length, 1, 'discovery must not dispatch verification without a report');
});

test('TF11 control: an unrelated synthetic task leaves calculation skills unused', { timeout: 30_000 }, async t => {
  const provider = await startToolProvider(); t.after(() => provider.close());
  const host = await startTestHost({ timeoutMs: 15_000 }); t.after(() => host.close());
  await json(await host.request('/api/configuration', 'PUT', { name: '对照合成', provider: 'openai-compatible', baseUrl: provider.baseUrl, model: 'synthetic-tf-model', apiKey: 'synthetic-tf-key' }));
  const { project } = await json(await host.request('/api/projects', 'POST', { name: '无测算对照' }), 201);
  const { task } = await json(await host.request('/api/projects/' + project.id + '/tasks', 'POST', { name: '问候' }), 201);
  provider.setResponder(() => ({ text: '你好。' }));
  const route = '/api/projects/' + project.id + '/tasks/' + task.id, requestId = randomUUID();
  await json(await host.request(route + '/messages', 'POST', { text: '你好', requestId }), 202);
  await provider.waitForRequests(1);
  await settled(host, route, requestId);
  assert.equal(provider.requests.length, 1);
  assert.equal(provider.requests[0].body.messages!.filter(message => message.role === 'tool').length, 0);
});
