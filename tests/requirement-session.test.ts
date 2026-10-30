import test from 'node:test';
import assert from 'node:assert/strict';
import { buildGenerationPrompt, parseModelJson, normalizeElicit, normalizeHypotheses, normalizeFramework } from '../extensions/business-plugins/requirements-elaboration/session/prompts.ts';
import { RequirementFault } from '../extensions/business-plugins/requirements-elaboration/contract/validate.ts';
import { requirementWorkspace, requirementSystemPrompt } from '../extensions/business-plugins/requirements-elaboration/session/workspace.ts';
import { sampleInstance } from './fixtures/requirement-sample.ts';

test('RE-03: three call points embed their full input context', () => {
  const instance = sampleInstance();
  const elicit = buildGenerationPrompt('elicit', instance);
  assert.match(elicit, /双11复购下滑归因/);
  assert.match(elicit, /must_confirm/);
  assert.doesNotMatch(elicit, /已有假设/, 'elicit does not require existing hypotheses');
  const hypotheses = buildGenerationPrompt('hypotheses', instance);
  assert.match(hypotheses, /hyp-1（confirmed）/);
  assert.match(hypotheses, /不要重复/);
  const framework = buildGenerationPrompt('framework', instance);
  assert.match(framework, /澄清问答/);
  assert.match(framework, /hyp-2（deferred）/);
  assert.match(framework, /zeroHallucinationCheck/);
});

test('RE-03: workspace carries the no-data soft boundary and an empty tool selection', () => {
  const workspace = requirementWorkspace('/tmp/req-x');
  assert.equal(workspace.defaultTools.length, 0);
  assert.ok(workspace.cwd.endsWith('workspace'));
  assert.deepEqual(requirementSystemPrompt, workspace.systemPrompt);
  assert.ok(workspace.systemPrompt.some(item => item.includes('没有数据访问工具')));
  assert.ok(workspace.systemPrompt.some(item => item.includes('```json')));
});

test('RE-03: parseModelJson accepts fenced, bare, and prose-wrapped JSON, rejects garbage', () => {
  const payload = { clarifications: [], facts: ['x'], hypotheses: [] };
  assert.deepEqual(parseModelJson('```json\n' + JSON.stringify(payload) + '\n```'), payload);
  assert.deepEqual(parseModelJson(JSON.stringify(payload)), payload);
  assert.deepEqual(parseModelJson('好的，以下是结果：\n```json\n' + JSON.stringify(payload) + '\n```\n以上供参考。'), payload);
  assert.deepEqual(parseModelJson('前文 {"a":1} 干扰\n结果 ' + JSON.stringify({ ...payload, marker: 'last' })), { ...payload, marker: 'last' });
  assert.throws(() => parseModelJson('抱歉，我无法完成。'), error => { assert.ok(error instanceof RequirementFault); return true; });
});

test('RE-03: elicit proposals continue the id sequence and drop invalid entries', () => {
  const instance = { ...sampleInstance(), clarifications: [], hypotheses: [] };
  const proposal = normalizeElicit({
    clarifications: [
      { category: '指标口径', priority: 'must_confirm', question: '复购是否剔除退款单？', rationale: '影响分子' },
      { category: '不存在的维度', priority: 'must_confirm', question: '无效维度', rationale: '' },
      { priority: 'should_confirm', question: '缺维度', rationale: '' },
    ],
    facts: ['双11复购率下滑', 42, ''],
    hypotheses: [{ statement: '高额满减券吸引羊毛党', evidence: '券核销上升', validationCondition: '券核销用户复购率更低' }, { statement: '' }],
  }, instance);
  assert.deepEqual(proposal.clarifications.map(item => item.id), ['clr-1']);
  assert.equal(proposal.clarifications[0]!.status, 'pending');
  assert.deepEqual(proposal.facts, ['双11复购率下滑']);
  assert.deepEqual(proposal.hypotheses.map(item => item.id), ['hyp-1']);
  assert.equal(proposal.hypotheses[0]!.status, 'proposed');
  assert.equal(proposal.dropped, 5, 'invalid category, missing category, two invalid facts, empty hypothesis');
  const continued = normalizeElicit({ clarifications: [{ category: '风险', priority: 'can_defer', question: 'Q', rationale: 'R' }], facts: [], hypotheses: [] }, sampleInstance());
  assert.equal(continued.clarifications[0]!.id, 'clr-4');
});

test('RE-03: hypothesis proposals skip duplicates of existing statements', () => {
  const instance = sampleInstance();
  const proposal = normalizeHypotheses({ hypotheses: [
    { statement: '品类结构变化解释整体下滑', evidence: 'dup', validationCondition: 'dup' },
    { statement: '美妆类新客折扣更深', evidence: '首单折扣分布', validationCondition: '按折扣深度分群复购率梯度单调' },
  ] }, instance);
  assert.equal(proposal.hypotheses.length, 1);
  assert.equal(proposal.hypotheses[0]!.id, 'hyp-3');
  assert.equal(proposal.dropped, 1);
  assert.throws(() => normalizeHypotheses({ hypotheses: [{ statement: '品类结构变化解释整体下滑' }] }, instance), /REQ_MODEL_OUTPUT_INVALID/);
});

test('RE-03: framework proposals keep only self-consistent analysis paths', () => {
  const ok = normalizeFramework({
    metrics: [{ name: '30日会员复购率', definition: '分子/分母', dimensions: ['渠道'], source: '新增口径' }],
    dataNeeds: [{ table: 'dwd_trade_order_di', fields: ['user_id'], priority: 'P0', purpose: '明细' }, { table: 'bad-table', fields: [], priority: 'P9', purpose: '优先级非法' }],
    analysisPaths: [
      { question: '渠道差异？', hypothesis: 'hyp-1', method: '卡方', requiredData: ['dwd_trade_order_di'], expectedOutput: '对比图' },
      { question: '引用未知表', hypothesis: 'hyp-1', method: '', requiredData: ['dwd_missing'], expectedOutput: '' },
    ],
    reportFramework: [{ section: '01 总览', purpose: '', keyQuestions: [], evidence: [], zeroHallucinationCheck: '相关性不表述为因果' }, { section: '缺检查点', purpose: '', keyQuestions: [], evidence: [], zeroHallucinationCheck: '' }],
    openQuestions: ['退款单口径'],
    risks: [],
  });
  assert.equal(ok.framework.metrics.length, 1);
  assert.equal(ok.framework.dataNeeds.length, 1);
  assert.equal(ok.framework.analysisPaths.length, 1);
  assert.equal(ok.framework.reportFramework.length, 1);
  assert.equal(ok.dropped, 3);
  assert.deepEqual(ok.framework.openQuestions, ['退款单口径']);
  assert.throws(() => normalizeFramework({ metrics: [], dataNeeds: [], analysisPaths: [], reportFramework: [] }), /REQ_MODEL_OUTPUT_INVALID/);
});
