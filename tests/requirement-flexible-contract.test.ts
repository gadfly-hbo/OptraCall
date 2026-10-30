import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { buildGenerationPrompt, parseModelJson, normalizeElicit, normalizeHypotheses, normalizeFramework } from '../extensions/business-plugins/requirements-elaboration/session/prompts.ts';
import { createRequirementStore } from '../extensions/business-plugins/requirements-elaboration/storage/store.ts';
import { composeRequirementContext } from '../extensions/business-plugins/requirements-elaboration/api/context.ts';
import { canonicalYaml, canonicalInstanceYaml, buildRapPublication, parseInstance, RequirementFault } from '../extensions/business-plugins/requirements-elaboration/contract/validate.ts';
import { sampleInstance } from './fixtures/requirement-sample.ts';
import { computeGateReport } from '../extensions/business-plugins/requirements-elaboration/gates/checks.ts';

test('RF-02: an explicit no-addition result succeeds without inventing clarifications or hypotheses', () => {
  const instance = sampleInstance();
  const reason = '目标、时间范围和口径已经明确，无需新增澄清或假设。';
  const elicit = normalizeElicit({ clarifications: [], facts: ['已提供每日销售日报口径'], hypotheses: [], noChangeReason: reason }, instance);
  assert.deepEqual(elicit, { clarifications: [], facts: ['已提供每日销售日报口径'], hypotheses: [], dropped: 0, noChangeReason: reason });
  assert.deepEqual(normalizeHypotheses({ hypotheses: [], noChangeReason: reason }, instance), { hypotheses: [], dropped: 0, noChangeReason: reason });
});

test('RF-02: absent arrays, unexplained empty output and dropped invalid entries are not no-addition results', () => {
  const instance = sampleInstance();
  for (const invalid of [
    {}, [], null,
    { clarifications: [], facts: [], hypotheses: [] },
    { clarifications: [], facts: [], hypotheses: [], noChangeReason: '   ' },
    { facts: [], hypotheses: [], noChangeReason: '无需新增' },
    { clarifications: 'not-an-array', facts: [], hypotheses: [], noChangeReason: '无需新增' },
    { clarifications: [{ question: '缺分类' }], facts: [], hypotheses: [], noChangeReason: '无需新增' },
  ]) assert.throws(() => normalizeElicit(invalid, instance), /REQ_MODEL_OUTPUT_INVALID/);
  for (const invalid of [
    {}, [], null, { hypotheses: [] }, { hypotheses: [], noChangeReason: '' },
    { hypotheses: 'not-an-array', noChangeReason: '无需新增' },
    { hypotheses: [{ statement: '品类结构变化解释整体下滑' }], noChangeReason: '无需新增' },
  ]) assert.throws(() => normalizeHypotheses(invalid, instance), /REQ_MODEL_OUTPUT_INVALID/);
});

test('RF-02: first-round generation can see existing answers instead of asking for them again', () => {
  const prompt = buildGenerationPrompt('elicit', sampleInstance());
  assert.match(prompt, /排除，名单由数据组维护/);
  assert.match(prompt, /clr-2/);
  assert.match(prompt, /answered/);
  assert.match(prompt, /双11大促首购会员30天复购率从28%下滑至19%/);
});

test('RF-03: a descriptive framework proposal retains a deliberate empty hypothesis reference', () => {
  const instance = sampleInstance();
  const framework = { ...instance.framework!, analysisPaths: [{ question: '昨日各门店销售额是多少？', hypothesis: '', method: '描述统计', requiredData: ['dwd_trade_order_di'], expectedOutput: '销售额表' }] };
  const proposal = normalizeFramework(framework, instance);
  assert.deepEqual(proposal.framework.analysisPaths, framework.analysisPaths);
  assert.equal(proposal.dropped, 0);
});

test('RF-03: an absent or invalid hypothesis and dangling table still fail validation', () => {
  const instance = sampleInstance();
  const source = instance.framework!;
  const { hypothesis: _hypothesis, ...descriptivePath } = source.analysisPaths[0]!;
  for (const invalidPath of [
    descriptivePath,
    { ...descriptivePath, hypothesis: null },
    { ...descriptivePath, hypothesis: 42 },
    { ...descriptivePath, hypothesis: ' ' },
    { ...descriptivePath, hypothesis: 'hyp-404' },
    { ...descriptivePath, hypothesis: '', requiredData: ['dwd_missing'] },
  ]) {
    const framework = { ...source, analysisPaths: [invalidPath] };
    assert.throws(() => normalizeFramework(framework, instance), /REQ_MODEL_OUTPUT_INVALID/);
    assert.throws(() => parseInstance(new Uint8Array(Buffer.from(canonicalYaml({ ...instance, framework })))), /REQ_STRUCTURE|REQ_DANGLING_REFERENCE/);
  }
  assert.deepEqual(normalizeFramework(source, instance).framework.analysisPaths, source.analysisPaths, 'existing hypothesis-bearing paths retain their references');
});

test('RF-03: a descriptive analysis without a hypothesis can be saved, confirmed, published and reopened', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'requirement-descriptive-'));
  const store = createRequirementStore(root);
  const created = store.create({ title: '门店每日销售描述', scene: 'daily' });
  const source = sampleInstance();
  const framework = { ...source.framework!, analysisPaths: [{ question: '昨日各门店销售额是多少？', hypothesis: '', method: '按门店汇总销售额', requiredData: ['dwd_trade_order_di'], expectedOutput: '门店销售额表' }] };
  store.save({ ...created, context: { background: '每天汇总各门店销售表现', goal: '查看销售额', decisionScenario: '经营日报' }, facts: ['按有效支付口径'], framework });
  assert.equal(store.read(created.instance.id).framework!.analysisPaths[0]!.hypothesis, '');
  assert.throws(() => composeRequirementContext(store, created.instance.id), /REQ_SNAPSHOT_REQUIRED/, 'draft cannot be sent before explicit confirmation');
  store.confirm(store.read(created.instance.id), '测试用户');
  const release = store.publish(created.instance.id, '1.0.0', '测试用户');
  const file = path.join(root, 'releases', created.instance.id, '1.0.0.rap.yaml');
  const originalBytes = readFileSync(file);
  const reopened = createRequirementStore(root);
  assert.equal(reopened.read(created.instance.id).framework!.analysisPaths[0]!.hypothesis, '');
  assert.equal(reopened.readRelease(created.instance.id, '1.0.0').rap.analysisPaths[0]!.hypothesis, '');
  assert.match(composeRequirementContext(reopened, created.instance.id, '1.0.0'), /昨日各门店销售额是多少？→按门店汇总销售额/);
  assert.deepEqual(reopened.publish(created.instance.id, '1.0.0', '测试用户'), release, 'same publication is idempotent');
  assert.deepEqual(readFileSync(file), originalBytes, 'published bytes are never rewritten');
});

test('RF-compat: existing instance canonical bytes and RAP fingerprints retain their pre-change identities', () => {
  const instance = sampleInstance();
  const canonical = canonicalInstanceYaml(instance);
  assert.equal(createHash('sha256').update(canonical).digest('hex'), 'ed016a3babc5cb1f8a9c339909f3129fb8b0559d401b57b5efafb5cc98db93a2');
  const reloaded = parseInstance(new Uint8Array(Buffer.from(canonical)));
  assert.equal(canonicalInstanceYaml(reloaded), canonical);
  const release = buildRapPublication(reloaded, '1.0.0', 'huangbo');
  assert.equal(release.packageFingerprint, 'sha256:3b7b074261ac629615c1a580bc30731c3cd2ae0aacaff8783041272f157780eb');
  assert.equal(release.contentFingerprint, 'sha256:b1e9f7667a46b8b43cb0b64a46598508e18637c8a2e8e57fd1b4f3a88f3a052a');
});

test('RF-04: bare structured JSON keeps its outer payload instead of extracting a nested item', () => {
  const payload = {
    clarifications: [{ category: '时间窗口', priority: 'should_confirm', question: '日报是否按自然日？', rationale: '避免日期口径混淆' }],
    facts: ['每日生成门店销售日报'],
    hypotheses: [],
  };
  const parsed = parseModelJson(JSON.stringify(payload));
  assert.deepEqual(parsed, payload);
  assert.equal(normalizeElicit(parsed, sampleInstance()).clarifications[0]!.question, '日报是否按自然日？');
});

test('RF-01: exploration can retain only known unanswered questions without inventing framework sections', () => {
  const framework = { metrics: [], dataNeeds: [], analysisPaths: [], reportFramework: [], openQuestions: ['销售额是否按支付时间归属？'], risks: [] };
  const proposal = normalizeFramework(framework, sampleInstance());
  assert.deepEqual(proposal.framework, framework);
  assert.equal(proposal.dropped, 0);
});

test('RF-01: an incomplete exploration draft remains editable but cannot be published or sent as confirmed input', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'requirement-partial-'));
  const store = createRequirementStore(root);
  const created = store.create({ title: '待明确口径的销售日报', scene: 'daily' });
  const framework = { metrics: [], dataNeeds: [], analysisPaths: [], reportFramework: [], openQuestions: ['销售额是否按支付时间归属？'], risks: [] };
  store.save({ ...created, framework });
  store.confirm(store.read(created.instance.id), '测试用户');
  assert.throws(() => store.publish(created.instance.id, '1.0.0', '测试用户'), /REQ_FRAMEWORK_REQUIRED/);
  assert.equal(store.releases(created.instance.id).length, 0, 'failed publication does not leave a release');
  assert.throws(() => composeRequirementContext(store, created.instance.id), /REQ_FRAMEWORK_REQUIRED/);
  assert.deepEqual(createRequirementStore(root).read(created.instance.id).framework, framework, 'partial draft survives reopening');
  const gates = computeGateReport(store.read(created.instance.id));
  assert.equal(gates.publishBlocked, true);
  assert.equal(gates.hard.find(item => item.id === 'framework-present')!.status, 'fail');
});

test('RF-04: rejected model output names the exact missing array or no-addition explanation', () => {
  const instance = sampleInstance();
  const examples: readonly [() => unknown, string][] = [
    [() => normalizeElicit({}, instance), 'clarifications'],
    [() => normalizeElicit({ clarifications: [], hypotheses: [] }, instance), 'facts'],
    [() => normalizeElicit({ clarifications: [], facts: [], hypotheses: [] }, instance), 'noChangeReason'],
    [() => normalizeElicit({ clarifications: [{ question: '缺分类' }], facts: [], hypotheses: [], noChangeReason: '无需新增' }, instance), 'clarifications'],
    [() => normalizeHypotheses({}, instance), 'hypotheses'],
    [() => normalizeHypotheses({ hypotheses: [] }, instance), 'noChangeReason'],
    [() => normalizeFramework({ metrics: [], dataNeeds: [], analysisPaths: [], reportFramework: [], risks: [] }, instance), 'openQuestions'],
  ];
  for (const [run, path] of examples) assert.throws(run, error => error instanceof RequirementFault && error.code === 'REQ_MODEL_OUTPUT_INVALID' && error.path === path);
});

test('RF-01: an empty or malformed framework is not a partial exploration draft', () => {
  const empty = { metrics: [], dataNeeds: [], analysisPaths: [], reportFramework: [], openQuestions: [], risks: [] };
  for (const bad of [
    {}, [], null, empty,
    { ...empty, openQuestions: ['   '] },
    { ...empty, metrics: 'missing-array', openQuestions: ['确认指标口径'] },
    { ...empty, metrics: [{ name: '缺少计算口径' }], openQuestions: ['确认指标口径'] },
  ]) assert.throws(() => normalizeFramework(bad, sampleInstance()), /REQ_MODEL_OUTPUT_INVALID/);
  const onlyRisk = { ...empty, risks: ['尚无可靠数据来源，需用户提供。'] };
  assert.deepEqual(normalizeFramework(onlyRisk).framework, onlyRisk);
});

test('RF-02: invalid facts cannot masquerade as a legitimate no-addition result', () => {
  const instance = sampleInstance();
  for (const facts of [[42], [null, '', '   ']]) {
    assert.throws(() => normalizeElicit({ clarifications: [], facts, hypotheses: [], noChangeReason: '全部已知，无需新增' }, instance), error => error instanceof RequirementFault && error.code === 'REQ_MODEL_OUTPUT_INVALID' && error.path === 'facts');
  }
  const mixed = normalizeElicit({ clarifications: [], facts: ['已提供每日销售日报口径', 42, ''], hypotheses: [], noChangeReason: '无需新增澄清和假设' }, instance);
  assert.deepEqual(mixed.facts, ['已提供每日销售日报口径']);
  assert.equal(mixed.dropped, 2, 'invalid fact entries are counted without inventing replacements');
});
