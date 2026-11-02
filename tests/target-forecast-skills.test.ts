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

test('TF11: an agent task runs the forecast skill scripts end-to-end and files the report with engine identity', { timeout: 120_000 }, async t => {
  const provider = await startToolProvider(); t.after(() => provider.close());
  const host = await startTestHost({ timeoutMs: 15_000 }); t.after(() => host.close());
  await json(await host.request('/api/configuration', 'PUT', { name: '测算合成', provider: 'openai-compatible', baseUrl: provider.baseUrl, model: 'synthetic-tf-model', apiKey: 'synthetic-tf-key' }));
  const { project } = await json(await host.request('/api/projects', 'POST', { name: '测算skill合成项目' }), 201);
  const { task } = await json(await host.request(`/api/projects/${project.id}/tasks`, 'POST', { name: '测算任务' }), 201);

  const script = (skill: string, name: string) => `python3 ${path.join(ANALYSIS_ASSETS, skill, 'scripts', name)}`;
  provider.setResponder(context => {
    if (context.requestNumber === 1) {
      const selftests = [
        `${script('roi-forecast', 'roi.py')} selftest`,
        `${script('coupon-forecast', 'coupon.py')} selftest`,
        `${script('coupon-forecast', 'bucket.py')} selftest`,
        `${script('coupon-forecast', 'template.py')} selftest`,
        `${script('target-forecast', 'ingest.py')} selftest`,
        `${script('target-forecast', 'forecast.py')} selftest`,
        `${script('target-forecast', 'template.py')} selftest`,
      ].join(' && ');
      return { calls: [{ name: 'bash', arguments: { command: `${script('roi-forecast', 'roi.py')} template -o roi-plans.json && (${selftests})` } }] };
    }
    if (context.requestNumber === 2) {
      return { calls: [{ name: 'bash', arguments: { command: `${script('roi-forecast', 'roi.py')} run --input roi-plans.json -o roi-out.json && python3 -c "import json; d=json.load(open('roi-out.json')); print('IDENT', d['engine_version'], d['input_digest'])"` } }] };
    }
    if (context.requestNumber === 3) {
      const outputs = context.recentToolResults.map(message => providerMessageText(message.content)).filter(Boolean).join('\n');
      const match = /IDENT (optracall-roi-1) ([0-9a-f]{16})/.exec(outputs);
      assert.ok(match, `engine identity must round-trip through the bash tool result: ${outputs.slice(0, 400)}`);
      const report = [
        '# 投放 ROI 测算报告（合成验证）', '',
        `- 引擎：${match[1]}`, `- 输入摘要：${match[2]}`, '- 情景推演 · 非预测承诺', '',
        '计划与情景参数见 020_clean/roi-plans.json，逐档结果见 020_clean/roi-out.json。',
      ].join('\n');
      return { calls: [{ name: 'bash', arguments: { command: `cat > ../060_reports/投放ROI测算报告-合成.md <<'OPTRACALL_EOF'\n${report}\nOPTRACALL_EOF` } }] };
    }
    return { text: '合成结论：三类测算 skill 自检全绿，ROI 报告已带引擎身份与输入摘要落 060_reports。' };
  });

  const requestId = randomUUID();
  await json(await host.request(`/api/projects/${project.id}/tasks/${task.id}/messages`, 'POST', { text: '请用测算 skill 完成自检与一次 ROI 测算，并按 020/060 目录约定产出报告', requestId }), 202);
  await provider.waitForRequests(4, 60_000);
  await settled(host, `/api/projects/${project.id}/tasks/${task.id}`, requestId);

  const executed = provider.requests.at(-1)!.body.messages!.filter(message => message.role === 'tool');
  assert.equal(executed.length, 3, 'the synthetic flow must actually execute three bash steps through the unified SDK runtime');
  const outputs = executed.map(message => providerMessageText(message.content)).join('\n');
  assert.match(outputs, /SELFTEST PASS/, `all skill selftests must pass inside the task; got: ${outputs.slice(0, 600)}`);

  const toolNames = new Set(provider.requests.flatMap(record => (record.body.tools ?? []).map(tool => tool.function?.name ?? '')));
  for (const name of ['read', 'bash', 'edit', 'write']) assert.ok(toolNames.has(name), `the ordinary task must retain the ${name} tool`);

  const report = await readFile(path.join(project.rootPath, '060_reports', '投放ROI测算报告-合成.md'), 'utf8');
  assert.match(report, /引擎：optracall-roi-1/, 'report must carry the engine identity');
  assert.match(report, /输入摘要：[0-9a-f]{16}/, 'report must carry the input digest');
  assert.match(report, /非预测承诺/, 'report must carry the honest-boundary statement');
});
