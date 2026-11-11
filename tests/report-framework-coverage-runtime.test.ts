import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { ProjectAgent } from '../src/agent/project-runtime.ts';
import type { ReportCalculationReviewPort } from '../src/agent/report-calculation-review.ts';
import { providerMessageText, startToolProvider } from './fixtures/tool-provider.ts';

const grant = { reportCalculationReview: { contract: 'foreground-report-calculation-v1' as const } };
const report = { path: '060_reports/draft.md', sha256: 'a'.repeat(64) };
const systemText = (messages: { role: string; content?: unknown }[]) => messages
  .filter(message => message.role === 'system' || message.role === 'developer')
  .map(message => providerMessageText(message.content)).join('\n');

async function fixture(t: TestContext, review: ReportCalculationReviewPort) {
  const evidence = path.resolve('.local/report-framework-coverage-review/runtime');
  await mkdir(evidence, { recursive: true });
  const root = await mkdtemp(path.join(evidence, 'case-'));
  const projectDirectory = path.join(root, 'project'), resourceRoot = path.join(root, 'resources');
  for (const directory of ['010_draw', '020_clean', '060_reports']) await mkdir(path.join(projectDirectory, directory), { recursive: true });
  await mkdir(resourceRoot);
  await writeFile(path.join(resourceRoot, 'settings.json'), JSON.stringify({ retry: { enabled: false } }));
  const provider = await startToolProvider();
  const agent = new ProjectAgent({
    projectId: 'coverage-project', taskId: 'coverage-task', projectDirectory, resourceRoot,
    sessionDirectory: path.join(root, 'sessions'), codeRoot: process.cwd(), managementPorts: [],
    configuration: { id: 'coverage-fixture', revision: 1, name: '合成框架覆盖', provider: 'synthetic',
      api: 'openai-completions', baseUrl: provider.baseUrl, model: 'synthetic-coverage', apiKey: 'synthetic-coverage-key' },
    reportCalculationReview: review,
  });
  t.after(async () => {
    await agent.close();
    await provider.close();
    await writeFile(path.join(root, 'requests.json'), JSON.stringify(provider.requests, null, 2));
  });
  return { root, agent, provider };
}

test('FCR01/03/04: one native review carries the joint opinion contract, fixed framework and original parent receipt', { timeout: 30_000 }, async t => {
  const receipt = { owner: { projectId: 'coverage-project', taskId: 'coverage-task', requestId: 'coverage-parent' },
    report, framework: { instanceId: 'confirmed-rap', version: '1.2', frameworkVersion: '4', basisSha256: 'b'.repeat(64), range: '§3.2 only' } };
  const material = 'FIXED_COVERAGE_DRAFT: 合计49，增幅11.36%。渠道18→21、26→28。\n' +
    'CONFIRMED_FRAMEWORK_V4 §3.2: 关键问题为渠道和品类销量变化；范围为两期；交付两项拆解。\n' +
    '本轮用户原始要求：只看国内渠道；USER_CONFIRMED_SCOPE_CHANGE。';
  let prepared = 0, validations = 0;
  const f = await fixture(t, async (selection, context) => {
    prepared++;
    assert.deepEqual(selection, { report });
    assert.equal(context.requestId, 'coverage-parent');
    assert.equal(context.providedContext?.originalUserText, '只看国内渠道；USER_CONFIRMED_SCOPE_CHANGE。');
    return { prompt: material, receipt, assertFeedbackCurrent: async () => { validations++; } };
  });
  const opinion = '计算：49与11.36%在给定材料范围内未见问题。\n框架覆盖：未说明的遗漏。原要求CONFIRMED_FRAMEWORK_V4 §3.2按品类拆解；初稿仅渠道表，无品类段落或缺口说明；影响是无法定位品类贡献。';
  f.provider.setResponder(({ messages, recentToolResults, availableTools }) => {
    if (systemText(messages).includes('OptraCall report-calculation reviewer')) return { text: opinion };
    if (!recentToolResults.length) return { calls: [{ name: 'review_report_calculations', arguments: { report } }] };
    if (recentToolResults.length === 1) return { calls: [{ name: 'review_report_calculations', arguments: { report } }] };
    assert.ok(availableTools.includes('review_report_calculations'));
    return { text: '已收到同一次计算与框架意见，独立核对后补做品类，并用同一要求和材料自查；修订另存，原稿保留。' };
  });
  const result = await f.agent.start('PARENT_PRIVATE_HISTORY', 'coverage-parent', undefined,
    { ...grant, originalUserText: '只看国内渠道；USER_CONFIRMED_SCOPE_CHANGE。' }).completion;
  assert.equal(result.outcome, 'completed');
  const children = f.provider.requests.filter(record => systemText(record.body.messages ?? []).includes('OptraCall report-calculation reviewer'));
  assert.equal(children.length, 1);
  const child = children[0].body;
  assert.deepEqual(child.tools ?? [], []);
  assert.deepEqual(child.messages?.filter(message => message.role === 'user').map(message => providerMessageText(message.content)), [material]);
  assert.doesNotMatch(JSON.stringify(child), /PARENT_PRIVATE_HISTORY/);
  const instructions = systemText(child.messages ?? []);
  for (const category of ['已回应', '未说明的遗漏', '明确限缩或待补证', '覆盖未核实']) assert.ok(instructions.includes(category), `reviewer is instructed to distinguish ${category}`);
  assert.match(instructions, /key business questions, confirmed scope and agreed deliverables/i);
  assert.match(instructions, /user.*scope adjustment[\s\S]*Agent.*limitation/i);
  assert.match(instructions, /equivalent.*method/i);
  assert.match(instructions, /original requirement[\s\S]*draft location[\s\S]*evidence[\s\S]*impact/i);
  const parentInstructions = systemText(f.provider.requests[0].body.messages ?? []);
  assert.match(parentInstructions, /same requirements and supplied materials/i);
  assert.match(parentInstructions, /no second automatic delegation/i);
  assert.match(parentInstructions, /preserve the original draft/i);
  assert.equal(prepared, 1);
  assert.equal(validations, 2);
  assert.equal(f.provider.errors.length, 0);
  const snapshot = await f.agent.snapshot();
  const entries = (await readFile(snapshot.sessionFile!, 'utf8')).trim().split('\n').map(line => JSON.parse(line));
  const actual = entries.filter(entry => entry.message?.role === 'toolResult' && entry.message.toolName === 'review_report_calculations');
  assert.equal(actual.length, 2);
  assert.deepEqual(actual[0].message.details.receipt, receipt);
  assert.equal(actual[0].message.details.text, opinion);
  assert.equal(actual[0].message.details.requestId, 'coverage-parent');
  assert.equal(actual[0].message.details.sessionId, snapshot.sessionId);
  assert.match(JSON.stringify(actual[1]), /report_calculation_already_attempted/);
  const native = entries.filter(entry => entry.type === 'custom' && entry.customType === 'optracall.report-calculation-review');
  assert.equal(native.length, 1);
  assert.deepEqual(native[0].data, actual[0].message.details);
  assert.deepEqual(result.reportCalculationReview.receipt, receipt);
  t.diagnostic(`Actual SDK requests and native receipt: ${f.root}`);
});

test('FCR-A3: unavailable or partial framework leaves the actual calculation review and joint advice usable', { timeout: 30_000 }, async t => {
  for (const scope of ['no-framework', 'partial-framework'] as const) await t.test(scope, async t => {
    const supplied = 'FIXED_DRAFT: 合计9；固定明细4、6。\n' + (scope === 'no-framework'
      ? '本轮没有实际送入框架；当前目录中存在的RAP不构成输入。'
      : '实际只送入并确认 §3.2 标题「渠道与品类拆解」，正文未送入；其余覆盖未知。');
    const receipt = { report, frameworkScope: scope };
    const f = await fixture(t, async () => ({ prompt: supplied, receipt, assertFeedbackCurrent: async () => {} }));
    const opinion = '计算：初稿「合计9」与明细4+6=10不符。框架覆盖：覆盖未核实；' +
      (scope === 'no-framework' ? '没有本轮可证的框架。' : '只能核对实际提供的§3.2标题，未提供正文不补造要求。');
    f.provider.setResponder(({ messages, recentToolResults }) => {
      if (systemText(messages).includes('OptraCall report-calculation reviewer')) return { text: opinion };
      if (!recentToolResults.length) return { calls: [{ name: 'review_report_calculations', arguments: { report } }] };
      return { text: providerMessageText(recentToolResults[0].content) };
    });
    const result = await f.agent.start('仅计算需要核对；无框架不补派', scope, undefined, grant).completion;
    assert.equal(result.outcome, 'completed');
    assert.equal(result.reportCalculationReview.outcome, 'completed');
    assert.deepEqual(result.reportCalculationReview.receipt, receipt);
    assert.match(result.text, /4\+6=10/);
    assert.match(result.text, /覆盖未核实/);
    const children = f.provider.requests.filter(record => systemText(record.body.messages ?? []).includes('OptraCall report-calculation reviewer'));
    assert.equal(children.length, 1);
    assert.deepEqual(children[0].body.messages?.filter(message => message.role === 'user').map(message => providerMessageText(message.content)), [supplied]);
    assert.match(systemText(children[0].body.messages ?? []), /Continue reviewing verifiable parts and calculations even when some or all framework coverage is unverified/);
    assert.deepEqual(children[0].body.tools ?? [], []);
    assert.equal(f.provider.requests.length, 3);
    assert.equal(f.provider.errors.length, 0);
    t.diagnostic(`Unavailable-scope native review: ${f.root}`);
  });
});

for (const mode of ['cancelled', 'revoked'] as const) test(`FCR-A4: ${mode} joint review cannot return late coverage advice or start a replacement`, { timeout: 30_000 }, async t => {
  let validations = 0, childSeen = false;
  const f = await fixture(t, async () => ({
    prompt: 'FIXED_INITIAL_DRAFT\nCONFIRMED_FRAMEWORK_V4: 按渠道和品类拆解。',
    receipt: { report, frameworkVersion: '4' },
    assertFeedbackCurrent: async () => {
      validations++;
      if (mode === 'revoked' && validations > 1) throw new Error('report_calculation_source_unavailable');
    },
  }));
  f.provider.setResponder(({ messages, recentToolResults }) => {
    if (systemText(messages).includes('OptraCall report-calculation reviewer')) {
      childSeen = true;
      return { text: 'LATE_COVERAGE_PRIVATE_OPINION 未说明的遗漏：品类无回应。计算未见问题。', ...(mode === 'cancelled' ? { hold: true } : {}) };
    }
    if (!recentToolResults.length) return { calls: [{ name: 'review_report_calculations', arguments: { report } }] };
    return { text: '复核没有可回交意见；保留初稿与未知，不补派。' };
  });
  const running = f.agent.start('核对本版框架与计算。', `coverage-${mode}`, undefined, grant);
  if (mode === 'cancelled') {
    await f.provider.waitForRequests(2);
    assert.equal(childSeen, true);
    await f.agent.stop();
  }
  const result = await running.completion;
  assert.equal(result.outcome, mode === 'cancelled' ? 'cancelled' : 'completed');
  assert.equal(result.reportCalculationReview.outcome, mode === 'cancelled' ? 'cancelled' : 'failed');
  assert.equal(validations, mode === 'cancelled' ? 1 : 2);
  assert.equal(f.provider.requests.filter(record => systemText(record.body.messages ?? []).includes('OptraCall report-calculation reviewer')).length, 1);
  assert.equal(f.provider.requests.length, mode === 'cancelled' ? 2 : 3);
  const parentRequests = f.provider.requests.filter(record => !systemText(record.body.messages ?? []).includes('OptraCall report-calculation reviewer'));
  assert.doesNotMatch(JSON.stringify(parentRequests), /LATE_COVERAGE_PRIVATE_OPINION/);
  const snapshot = await f.agent.snapshot();
  const native = await readFile(snapshot.sessionFile!, 'utf8');
  assert.doesNotMatch(native, /LATE_COVERAGE_PRIVATE_OPINION/);
  assert.match(native, /coverage-(cancelled|revoked)/);
  assert.equal(f.provider.errors.length, 0);
  t.diagnostic(`Late-opinion preservation: ${f.root}`);
});
