import assert from 'node:assert/strict';
import { test } from 'node:test';
import { normalizeExtractionOutput } from '../extensions/business-plugins/decision-board/extraction/normalize.ts';
import { enforceVerbatimQuotes } from '../extensions/business-plugins/decision-board/session/workspace.ts';

const validItem = {
  title: ' 复核高价值会员流失预警名单 ',
  rationale: '近两周高价值会员复购下降，报告中给出分层差异。',
  expectedImpact: '预计挽回部分流失订单',
  priority: 'high',
  effort: '2人日',
  confidence: 0.99,
  evidence: { level: '数据支撑', reasoning: '分层明细与复购口径直接来自清洗数据。', facts: [{ text: '高价值会员复购率环比下降', quote: '高价值会员复购率 42%→31%' }] },
};

test('parses a fenced json block and normalizes valid items', () => {
  const result = normalizeExtractionOutput(`前置说明\n\`\`\`json\n[${JSON.stringify(validItem)}]\n\`\`\`\n后置说明`);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.items.length, 1);
  assert.equal(result.dropped, 0);
  const item = result.items[0]!;
  assert.equal(item.title, '复核高价值会员流失预警名单');
  assert.equal(item.priority, 'high');
  assert.equal(item.evidence.level, '数据支撑');
  assert.equal(item.evidence.facts[0]!.quote, '高价值会员复购率 42%→31%');
  // Model self-assessed confidence must never be kept: it is derived from evidence level.
  assert.equal('confidence' in item, false);
});

test('accepts a bare json array without fences', () => {
  const result = normalizeExtractionOutput(JSON.stringify([validItem]));
  assert.equal(result.ok, true);
});

test('missing optional fields fall back; invalid items are dropped and counted', () => {
  const minimal = { title: '补充渠道分布核对', rationale: '渠道维度尚未核对。', evidence: { level: '逻辑推断', reasoning: '按渠道结构推断。', facts: [{ text: '渠道列存在缺失' }] } };
  const result = normalizeExtractionOutput(JSON.stringify([minimal, { title: '无理由项', evidence: minimal.evidence }, { ...minimal, evidence: { ...minimal.evidence, level: '专家直觉' } }]));
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.items.length, 1);
  assert.equal(result.dropped, 2);
  assert.equal(result.items[0]!.priority, 'medium');
  assert.equal(result.items[0]!.expectedImpact, '');
  assert.equal(result.items[0]!.effort, null);
});

test('rejects output without any json payload', () => {
  assert.equal(normalizeExtractionOutput('抱歉，我无法完成抽取。').ok, false);
  assert.equal(normalizeExtractionOutput('```json\n{not json}\n```').ok, false);
});

test('caps facts per item and total items; drops items without any valid fact', () => {
  const facts = Array.from({ length: 12 }, (_, index) => ({ text: `事实${index}` }));
  const manyFacts = { ...validItem, evidence: { ...validItem.evidence, facts } };
  const noFacts = { ...validItem, evidence: { ...validItem.evidence, facts: [{ text: '   ' }] } };
  const flood = Array.from({ length: 25 }, () => validItem);
  const result = normalizeExtractionOutput(JSON.stringify([manyFacts, noFacts, ...flood]));
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.items.length, 20);
  assert.ok(result.dropped >= 5);
  assert.ok(result.items.every(item => item.evidence.facts.length <= 10));
});

test('non-verbatim quotes are stripped instead of posing as report citations', () => {
  const report = '高价值会员复购率 42%→31%，普通会员保持稳定。';
  const parsed = normalizeExtractionOutput(JSON.stringify([{ ...validItem, title: '召回试点', evidence: { ...validItem.evidence, facts: [
    { text: '复购率下降', quote: '高价值会员复购率 42%→31%' },
    { text: '普通会员稳定', quote: '普通会员保持平稳' },
    { text: '无引用事实' },
  ] } }]));
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  const verified = enforceVerbatimQuotes(parsed.items, report);
  assert.equal(verified.stripped, 1);
  assert.deepEqual(verified.items[0]!.evidence.facts, [
    { text: '复购率下降', quote: '高价值会员复购率 42%→31%' },
    { text: '普通会员稳定' },
    { text: '无引用事实' },
  ]);
});
