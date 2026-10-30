import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequirementStore } from '../extensions/business-plugins/requirements-elaboration/storage/store.ts';
import { composeRequirementContext } from '../extensions/business-plugins/requirements-elaboration/api/context.ts';
import { buildGenerationPrompt } from '../extensions/business-plugins/requirements-elaboration/session/prompts.ts';
import { MODELING_GUIDE } from '../extensions/business-plugins/metric-factory/session/modeling-guide.ts';
import { sampleInstance } from './fixtures/requirement-sample.ts';

function seededStore(root: string) {
  const store = createRequirementStore(root);
  const created = store.create({ title: '合成门店口径核对', scene: 'topic' });
  const sample = sampleInstance();
  store.save({ ...sample, instance: { ...sample.instance, id: created.instance.id, createdAt: created.instance.createdAt } });
  store.confirm(store.read(created.instance.id), 'synthetic-reviewer');
  return { store, id: created.instance.id };
}

test('SV02: published RAP provides the actual unresolved questions and risks without rewriting its release', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'optracall-semantic-'));
  try {
    const { store, id } = seededStore(root);
    store.publish(id, '1.0.0', 'synthetic-reviewer');
    const releasePath = path.join(root, 'releases', id, '1.0.0.rap.yaml');
    const before = readFileSync(releasePath);
    const summary = composeRequirementContext(store, id, '1.0.0');

    assert.ok(summary.includes('退款未发货订单是否剔除，当前暂按支付成功口径'), 'the recipient receives the unresolved business question, not just its count');
    assert.ok(summary.includes('大促期间渠道投放策略同期变化，归因存在混杂'), 'the recipient receives the actual risk');
    assert.ok(summary.includes('会员等级标签以哪个版本为准？'), 'deferred clarification remains visible');
    assert.ok(summary.includes(releasePath), 'the exact published source is discoverable');
    assert.deepEqual(readFileSync(releasePath), before, 'consumption never rewrites the immutable RAP');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('SV02/SV03: confirmed RAP preserves unresolved order and points to its real working source and full snapshot identity', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'optracall-semantic-'));
  try {
    const { store, id } = seededStore(root);
    const instance = store.read(id);
    assert.ok(instance.framework);
    store.save({ ...instance, framework: { ...instance.framework, openQuestions: ['退款归属日尚待财务确认', '会员范围与渠道说明存在冲突'], risks: ['本次数据不含取消单，不能断言取消金额为零'] } });
    const current = store.read(id);
    assert.ok(current.snapshot);
    const instancePath = path.join(root, id, 'instance.yaml');
    const before = readFileSync(instancePath);
    const summary = composeRequirementContext(store, id);

    assert.ok(summary.includes('退款归属日尚待财务确认'));
    assert.ok(summary.indexOf('退款归属日尚待财务确认') < summary.indexOf('会员范围与渠道说明存在冲突'), 'unresolved questions retain the chosen source order');
    assert.ok(summary.includes('本次数据不含取消单，不能断言取消金额为零'));
    assert.ok(summary.includes(instancePath), 'confirmed unpublished context points to instance.yaml, not a fabricated release');
    assert.ok(summary.includes(current.snapshot.fingerprint), 'the full confirmation identity is available for source checks');
    assert.match(summary, /工作稿.*可变化|可变化.*工作稿/);
    assert.deepEqual(readFileSync(instancePath), before);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('SV01/SV02: both RAP consumption paths distinguish business facts, assumptions, and metric sources', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'optracall-semantic-'));
  try {
    const { store, id } = seededStore(root);
    store.publish(id, '1.0.0', 'synthetic-reviewer');
    for (const version of [undefined, '1.0.0']) {
      const summary = composeRequirementContext(store, id, version);
      assert.ok(summary.includes('双11后大盘复购走低'), 'business background is passed with the question');
      assert.ok(summary.includes('双11大促首购会员30天复购率从28%下滑至19%'), 'provided facts do not disappear from the compact context');
      assert.ok(summary.includes('实例新增口径'), 'metric definitions retain the source supplied by the business');
      assert.match(summary, /hyp-2.*deferred.*品类结构变化解释整体下滑/);
      assert.match(summary, /假设.*不等于.*事实/);
      assert.match(summary, /冲突.*澄清/);
    }
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('SV02: requirement drafting keeps missing business meaning and conflicts unresolved without prescribing an analysis route', () => {
  for (const call of ['elicit', 'hypotheses', 'framework'] as const) {
    const prompt = buildGenerationPrompt(call, sampleInstance());
    assert.match(prompt, /来源.*冲突|冲突.*来源/);
    assert.match(prompt, /缺失.*未知|未提供.*未知/);
    assert.match(prompt, /单位.*粒度.*分母.*去重.*退款.*时间/);
    assert.match(prompt, /分析路径.*建议/);
    assert.match(prompt, /已有.*复用/);
  }
});

test('SV02/SV09: SAP modeling uses existing semantic fields for task-relevant business meaning, not a fixed calculation catalog', () => {
  assert.match(MODELING_GUIDE, /单位.*粒度.*分母.*去重.*退款.*时间/);
  assert.match(MODELING_GUIDE, /definition.*caliber_switches.*provenance\.note/);
  assert.match(MODELING_GUIDE, /未知.*不.*已确认|缺失.*不.*已确认/);
  assert.match(MODELING_GUIDE, /冲突.*来源/);
  assert.match(MODELING_GUIDE, /指标名.*版本/);
  assert.match(MODELING_GUIDE, /不.*固定计算步骤/);
  assert.match(MODELING_GUIDE, /未知字段会被拒绝/);
  assert.match(MODELING_GUIDE, /留待用户审核/);
});

test('SV02: confirmed clarification answers and still-open clarification states reach both RAP consumers', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'optracall-semantic-'));
  try {
    const { store, id } = seededStore(root);
    store.publish(id, '1.0.0', 'synthetic-reviewer');
    for (const version of [undefined, '1.0.0']) {
      const summary = composeRequirementContext(store, id, version);
      assert.match(summary, /clr-2.*answered.*是否排除内部测试账号？.*排除，名单由数据组维护/);
      assert.match(summary, /clr-1.*pending.*复购口径是否剔除退款单？/);
      assert.match(summary, /clr-3.*deferred.*会员等级标签以哪个版本为准？/);
    }
  } finally { rmSync(root, { recursive: true, force: true }); }
});
