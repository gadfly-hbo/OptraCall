import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MODEL_PACK_FORMAT_VERSION,
  MODEL_NAME_PATTERN,
  MODEL_TASKS,
  MODEL_STAGES,
  validateManifest,
  toRegistryEntry,
  metricLabel,
  ModelPackValidationError,
  type ModelPackManifest,
} from '../extensions/business-plugins/model-pack/types.ts';

// 真实 MPS 导出包 order-forecast v1 的 manifest（formatVersion=1，两产品间契约）。
const REAL_MANIFEST = {
  formatVersion: 1,
  model: { name: 'order-forecast', version: 1, stage: 'Staging' },
  goal: '按品类的日订单数据，训练预测订单量的模型，重点看 MAE。',
  data: {
    fingerprint: {
      sha256: '08b0fd9080e35e89557183980c33a33d58ef6454f2eca6e2ab6a5eab66f2df2d',
      rows: 1456,
      columns: ['business_date', 'product_category', 'order_count', 'gross_order_amount', 'discount_amount'],
    },
  },
  metrics: { mae: 3.0446735395189, rmse: 4.031661634195762, 'mae:order_count': 3.0446735395189, 'rmse:order_count': 4.031661634195762 },
  training: { splitSeed: 42, task: 'regression', targets: ['order_count'], trainedAt: '2026-10-31T16:01:50.876Z', sessionRef: 's_623ba63c' },
  usage: { inputs: ['business_date', 'product_category', 'gross_order_amount', 'discount_amount'], outputs: ['order_count'], form: 'predict(rows) -> rows' },
};

// 测试夹具：宽松可变类型，便于逐字段构造各拒绝分支（validateManifest 入参本就是 unknown）。
const clone = (): Record<string, any> => structuredClone(REAL_MANIFEST) as Record<string, any>;
const codeOf = (fn: () => unknown): string => {
  try { fn(); } catch (error) {
    assert.ok(error instanceof ModelPackValidationError, `expected ModelPackValidationError, got ${String(error)}`);
    return error.code;
  }
  throw new assert.AssertionError({ message: 'expected validation to throw' });
};

test('MP-TYPES-01: a real MPS manifest validates and is returned typed', () => {
  const manifest = validateManifest(clone());
  assert.equal(manifest.formatVersion, MODEL_PACK_FORMAT_VERSION);
  assert.equal(manifest.model.name, 'order-forecast');
  assert.equal(manifest.model.version, 1);
  assert.equal(manifest.training.task, 'regression');
  assert.deepEqual(manifest.usage.outputs, ['order_count']);
  assert.equal(manifest.data.fingerprint.rows, 1456);
});

test('MP-TYPES-02: formatVersion other than 1 is rejected (consumer only speaks v1)', () => {
  const v2 = clone(); (v2 as Record<string, unknown>).formatVersion = 2;
  assert.equal(codeOf(() => validateManifest(v2)), 'FORMAT_VERSION_UNSUPPORTED');
  const missing = clone(); delete (missing as Record<string, unknown>).formatVersion;
  assert.equal(codeOf(() => validateManifest(missing)), 'FORMAT_VERSION_UNSUPPORTED');
});

test('MP-TYPES-03: model name must match the pack-name pattern', () => {
  assert.equal(MODEL_NAME_PATTERN.source, '^[a-z][a-z0-9-]{1,40}$');
  for (const bad of ['Promo_Uplift!', 'order forecast', '1leading', 'a', 'x'.repeat(42), '']) {
    const manifest = clone(); manifest.model.name = bad;
    assert.equal(codeOf(() => validateManifest(manifest)), 'MODEL_NAME_INVALID', `name ${JSON.stringify(bad)}`);
  }
  const ok = clone(); ok.model.name = 'promo-uplift';
  assert.equal(validateManifest(ok).model.name, 'promo-uplift');
});

test('MP-TYPES-04: version must be a positive integer', () => {
  for (const bad of [0, -1, 1.5, '1', null]) {
    const manifest = clone(); (manifest.model as Record<string, unknown>).version = bad;
    assert.equal(codeOf(() => validateManifest(manifest)), 'MODEL_VERSION_INVALID', `version ${String(bad)}`);
  }
});

test('MP-TYPES-05: task must be one of the known model tasks', () => {
  assert.deepEqual([...MODEL_TASKS], ['regression', 'binary_classification', 'multilabel_share']);
  const manifest = clone(); (manifest.training as Record<string, unknown>).task = 'forecast';
  assert.equal(codeOf(() => validateManifest(manifest)), 'TASK_INVALID');
});

test('MP-TYPES-06: fingerprint requires 64-hex sha256, positive rows and column list', () => {
  const badSha = clone(); badSha.data.fingerprint.sha256 = '08b0fd90…66f2df2d';
  assert.equal(codeOf(() => validateManifest(badSha)), 'FINGERPRINT_INVALID');
  const badRows = clone(); badRows.data.fingerprint.rows = 0;
  assert.equal(codeOf(() => validateManifest(badRows)), 'FINGERPRINT_INVALID');
  const badCols = clone(); badCols.data.fingerprint.columns = [];
  assert.equal(codeOf(() => validateManifest(badCols)), 'FINGERPRINT_INVALID');
});

test('MP-TYPES-07: metrics must be a non-empty map of finite numbers', () => {
  const empty = clone(); empty.metrics = {};
  assert.equal(codeOf(() => validateManifest(empty)), 'METRICS_INVALID');
  const nonNumeric = clone(); (nonNumeric.metrics as Record<string, unknown>).mae = '3.04';
  assert.equal(codeOf(() => validateManifest(nonNumeric)), 'METRICS_INVALID');
});

test('MP-TYPES-08: usage requires non-empty inputs/outputs and a form string', () => {
  const noInputs = clone(); noInputs.usage.inputs = [];
  assert.equal(codeOf(() => validateManifest(noInputs)), 'USAGE_INVALID');
  const noOutputs = clone(); noOutputs.usage.outputs = [];
  assert.equal(codeOf(() => validateManifest(noOutputs)), 'USAGE_INVALID');
});

test('MP-TYPES-09: training requires splitSeed, targets, trainedAt and sessionRef', () => {
  const noTargets = clone(); noTargets.training.targets = [];
  assert.equal(codeOf(() => validateManifest(noTargets)), 'TRAINING_INVALID');
  const noSession = clone(); (noSession.training as Record<string, unknown>).sessionRef = '';
  assert.equal(codeOf(() => validateManifest(noSession)), 'TRAINING_INVALID');
});

test('MP-TYPES-10: optional groups survive validation for multilabel packs', () => {
  const manifest = clone() as unknown as Record<string, unknown>;
  (manifest.training as Record<string, unknown>).groups = { '人群维度': ['age_share', 'gender_share'] };
  (manifest.training as Record<string, unknown>).task = 'multilabel_share';
  const validated = validateManifest(manifest);
  assert.deepEqual(validated.training.groups, { '人群维度': ['age_share', 'gender_share'] });
});

test('MP-TYPES-11: non-object input is rejected without crashing', () => {
  assert.equal(codeOf(() => validateManifest(null)), 'MANIFEST_INVALID');
  assert.equal(codeOf(() => validateManifest('predict.mjs')), 'MANIFEST_INVALID');
  assert.equal(codeOf(() => validateManifest([])), 'MANIFEST_INVALID');
});

test('MP-TYPES-12: toRegistryEntry folds manifest + import facts into a Staging shelf record', () => {
  const manifest = validateManifest(clone());
  const entry = toRegistryEntry(manifest, {
    stage: 'Staging',
    installedAt: '2026-11-05T10:12:00.000Z',
    sourcePath: '/Users/huangbo/Dev/Projects/model-mlflow/workspace/exports/order-forecast/v1',
    snapshotSha256: 'a31c07de5f8b2190a31c07de5f8b2190a31c07de5f8b2190a31c07de5f8b2190',
  });
  assert.equal(entry.schemaVersion, 1);
  assert.equal(entry.name, 'order-forecast');
  assert.equal(entry.version, 1);
  assert.equal(entry.stage, 'Staging');
  assert.equal(entry.task, 'regression');
  assert.deepEqual(entry.fingerprint.columns, manifest.data.fingerprint.columns);
  assert.equal(entry.snapshotSha256.length, 64);
  assert.deepEqual([...MODEL_STAGES], ['Production', 'Staging', 'Archived']);
});

test('MP-TYPES-13: toRegistryEntry rejects a corrupt snapshot hash and unknown stage', () => {
  const manifest = validateManifest(clone());
  assert.throws(
    () => toRegistryEntry(manifest, { stage: 'Staging', installedAt: '2026-11-05T10:12:00.000Z', sourcePath: '/x', snapshotSha256: 'short' }),
    (error: unknown) => error instanceof ModelPackValidationError && error.code === 'SNAPSHOT_HASH_INVALID',
  );
  assert.throws(
    () => toRegistryEntry(manifest, { stage: 'Live' as never, installedAt: '2026-11-05T10:12:00.000Z', sourcePath: '/x', snapshotSha256: 'a'.repeat(64) }),
    (error: unknown) => error instanceof ModelPackValidationError && error.code === 'STAGE_INVALID',
  );
});

test('MP-TYPES-14: metricLabel drops per-target duplicate keys and rounds for display', () => {
  const manifest: ModelPackManifest = validateManifest(clone());
  assert.equal(metricLabel(manifest.metrics), 'mae 3.04 · rmse 4.03');
  assert.equal(metricLabel({ accuracy: 0.871, f1: 0.812 }), 'accuracy 0.871 · f1 0.812');
  assert.equal(metricLabel({ share_mae: 0.061, top1: 0.72, top3: 0.94 }), 'share_mae 0.061 · top1 0.72 · top3 0.94');
  assert.equal(metricLabel({}), '');
});
