import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { startTestHost } from './fixtures/host-process.ts';
import { startToolProvider, providerMessageText } from './fixtures/tool-provider.ts';

const SKILL_DIR = path.resolve(process.cwd(), 'extensions/analysis-assets/decision-review');

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

// Synthetic routing proves discovery, skill/template reads and brief delivery; it
// does not measure a real model's decision-review quality.
test('DRV04: SDK task reads decision-review with its template and saves a statused brief', { timeout: 120_000 }, async t => {
  const provider = await startToolProvider(); t.after(() => provider.close());
  const host = await startTestHost({ timeoutMs: 15_000 }); t.after(() => host.close());
  await json(await host.request('/api/configuration', 'PUT', { name: '审视合成', provider: 'openai-compatible', baseUrl: provider.baseUrl, model: 'synthetic-drv-model', apiKey: 'synthetic-drv-key' }));
  const { project } = await json(await host.request('/api/projects', 'POST', { name: '决策审视合成项目' }), 201);
  const { task } = await json(await host.request('/api/projects/' + project.id + '/tasks', 'POST', { name: '决策审视' }), 201);
  const briefName = 'decision-review-合成决策说明.md';
  provider.setResponder(context => {
    if (context.requestNumber === 1) return { calls: [{ name: 'read', arguments: { path: path.join(SKILL_DIR, 'SKILL.md') } }] };
    if (context.requestNumber === 2) {
      const skillText = context.recentToolResults.map(message => providerMessageText(message.content)).join('\n');
      assert.match(skillText, /name: decision-review/);
      return { calls: [{ name: 'read', arguments: { path: path.join(SKILL_DIR, 'templates/decision-brief.md') } }] };
    }
    if (context.requestNumber === 3) {
      const template = context.recentToolResults.map(message => providerMessageText(message.content)).join('\n');
      assert.match(template, /状态：/, 'the template must carry the status line convention');
      const brief = ['# 是否对复购下降人群发券（合成验证）', '',
        '状态：ready_for_review', '日期：2026-11-07 · 依据版本：合成路由验证', '',
        '## 一、决策问题', '是否发放满减券；本周五前需结论（决定人：用户）。', '',
        '## 五、假设与未知', '关键假设：下降非季节性【假设】；缺口：cohort 流失原因（可能翻转方案选择）。', '',
        '## 七、取舍与建议', '条件式建议：若试行回本线达成则倾向全量；信息不足时先小范围试行。建议不等于已决定。', '',
        '## 八、验证与调整', '试行第 14 天复查核销率；若核销率低于经验下限一半则重新考虑。'].join('\n');
      return { calls: [{ name: 'write', arguments: { path: '../060_reports/' + briefName, content: brief } }] };
    }
    return { text: '决策审视合成说明已保存。' };
  });
  const requestId = randomUUID();
  const route = '/api/projects/' + project.id + '/tasks/' + task.id;
  await json(await host.request(route + '/messages', 'POST', { text: '请使用决策审视skill，按模板产出决策说明并保存', requestId }), 202);
  await provider.waitForRequests(4, 60_000);
  await settled(host, route, requestId);
  const messages = provider.requests.at(-1)!.body.messages!;
  const calls = messages.filter((message: any) => message.role === 'assistant').flatMap((message: any) => message.tool_calls ?? []) as { function: { name: string; arguments: string } }[];
  assert.deepEqual(calls.map(call => call.function.name), ['read', 'read', 'write']);
  assert.equal(JSON.parse(calls[0].function.arguments).path, path.join(SKILL_DIR, 'SKILL.md'));
  assert.equal(JSON.parse(calls[1].function.arguments).path, path.join(SKILL_DIR, 'templates/decision-brief.md'));
  const firstRequest = JSON.stringify(provider.requests[0].body.messages);
  assert.match(firstRequest, /decision-review/, 'the skill must be discoverable in the first SDK request');
  const brief = await readFile(path.join(project.rootPath, '060_reports', briefName), 'utf8');
  assert.match(brief, /^状态：ready_for_review$/m, 'the brief carries the textual status line');
  assert.match(brief, /建议不等于已决定/);
  assert.match(brief, /重新考虑/);
});
