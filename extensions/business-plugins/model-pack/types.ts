// 模型包消费端共享合同：MPS 导出包 manifest（formatVersion=1）、注册表货架记录与纯校验。
// 训练侧（Model Pack Studio）是 manifest 的权威作者；本文件只消费 v1，不重算指标、不演进包格式。
// 纯校验无 I/O：验货门的结构/字段分支在此，纯度重扫与沙箱冒烟属 Host 存储侧（需读文件/起子进程）。

export const MODEL_PACK_FORMAT_VERSION = 1;

/** 包名口径：小写字母开头，仅小写字母/数字/连字符，2–41 字符。防任意路径与命名冲突。 */
export const MODEL_NAME_PATTERN = /^[a-z][a-z0-9-]{1,40}$/;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;

export const MODEL_TASKS = ['regression', 'binary_classification', 'multilabel_share'] as const;
export type ModelTask = typeof MODEL_TASKS[number];

/** OptraCall 侧生命周期：导入即 Staging，用户点击升 Production，同名旧版自动 Archived。 */
export const MODEL_STAGES = ['Production', 'Staging', 'Archived'] as const;
export type ModelStage = typeof MODEL_STAGES[number];

export const TASK_LABELS: Record<ModelTask, string> = {
  regression: '回归', binary_classification: '二分类', multilabel_share: '占比型',
};

export type ModelFingerprint = { sha256: string; rows: number; columns: string[] };
export type ModelTraining = {
  splitSeed: number;
  task: ModelTask;
  targets: string[];
  trainedAt: string;
  sessionRef: string;
  groups?: Record<string, string[]>;
};
export type ModelUsage = { inputs: string[]; outputs: string[]; form: string };

/** MPS `manifest.json`（formatVersion=1）：两产品间契约。 */
export type ModelPackManifest = {
  formatVersion: 1;
  model: { name: string; version: number; stage: string };
  goal: string;
  data: { fingerprint: ModelFingerprint };
  metrics: Record<string, number>;
  training: ModelTraining;
  usage: ModelUsage;
};

/** 注册表货架记录＝manifest 事实 + 导入时本机事实（Host 存储侧持久化）。 */
export type ModelRegistryEntry = {
  schemaVersion: 1;
  name: string;
  version: number;
  stage: ModelStage;
  task: ModelTask;
  goal: string;
  metrics: Record<string, number>;
  fingerprint: ModelFingerprint;
  training: ModelTraining;
  usage: ModelUsage;
  installedAt: string;
  sourcePath: string;
  snapshotSha256: string;
  /** Host 读取时发现快照哈希与注册记录不符（人为破坏 dataRoot）＝true；页面如实标记，不静默修复。 */
  corrupted?: boolean;
};

/** 导入时由 Host 验货门产出的本机事实，与 manifest 折叠成货架记录。 */
export type ModelImportFacts = {
  stage: ModelStage;
  installedAt: string;
  sourcePath: string;
  snapshotSha256: string;
};

/** 验货门拒绝时的结构化原因（随 HTTP 错误体回传，供页面与 Agent 如实呈现）。 */
export type ModelPackImportFailure = { stage?: string; reason?: string; hint?: string };

export class ModelPackValidationError extends Error {
  readonly code: string;
  readonly status: number;
  constructor(code: string, status = 400, message?: string) {
    super(message ?? code);
    this.name = 'ModelPackValidationError';
    this.code = code;
    this.status = status;
  }
}

const object = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const nonEmptyString = (value: unknown): string =>
  typeof value === 'string' && value.trim() ? value : '';

const stringArray = (value: unknown): string[] | null =>
  Array.isArray(value) && value.length > 0 && value.every(item => typeof item === 'string' && item.trim())
    ? (value as string[])
    : null;

/** 纯结构校验：把未知 JSON 收敛为合法 manifest，任一分支不过抛结构化错误码（不落半成品）。 */
export function validateManifest(input: unknown): ModelPackManifest {
  if (!object(input)) throw new ModelPackValidationError('MANIFEST_INVALID');
  if (input.formatVersion !== MODEL_PACK_FORMAT_VERSION) throw new ModelPackValidationError('FORMAT_VERSION_UNSUPPORTED');

  if (!object(input.model)) throw new ModelPackValidationError('MANIFEST_INVALID');
  const name = input.model.name;
  if (typeof name !== 'string' || !MODEL_NAME_PATTERN.test(name)) throw new ModelPackValidationError('MODEL_NAME_INVALID');
  const version = input.model.version;
  if (!Number.isSafeInteger(version) || (version as number) < 1) throw new ModelPackValidationError('MODEL_VERSION_INVALID');
  const sourceStage = nonEmptyString(input.model.stage);
  if (!sourceStage) throw new ModelPackValidationError('MANIFEST_INVALID');

  const goal = typeof input.goal === 'string' ? input.goal : '';

  if (!object(input.data) || !object(input.data.fingerprint)) throw new ModelPackValidationError('FINGERPRINT_INVALID');
  const fp = input.data.fingerprint;
  if (typeof fp.sha256 !== 'string' || !SHA256_PATTERN.test(fp.sha256)) throw new ModelPackValidationError('FINGERPRINT_INVALID');
  if (!Number.isSafeInteger(fp.rows) || (fp.rows as number) < 1) throw new ModelPackValidationError('FINGERPRINT_INVALID');
  const columns = stringArray(fp.columns);
  if (!columns) throw new ModelPackValidationError('FINGERPRINT_INVALID');
  const fingerprint: ModelFingerprint = { sha256: fp.sha256, rows: fp.rows as number, columns };

  if (!object(input.metrics) || Object.keys(input.metrics).length === 0) throw new ModelPackValidationError('METRICS_INVALID');
  const metrics: Record<string, number> = {};
  for (const [key, value] of Object.entries(input.metrics)) {
    if (typeof value !== 'number' || !Number.isFinite(value)) throw new ModelPackValidationError('METRICS_INVALID');
    metrics[key] = value;
  }

  if (!object(input.training)) throw new ModelPackValidationError('TRAINING_INVALID');
  const tr = input.training;
  if (typeof tr.splitSeed !== 'number' || !Number.isFinite(tr.splitSeed)) throw new ModelPackValidationError('TRAINING_INVALID');
  if (!MODEL_TASKS.includes(tr.task as ModelTask)) throw new ModelPackValidationError('TASK_INVALID');
  const targets = stringArray(tr.targets);
  if (!targets) throw new ModelPackValidationError('TRAINING_INVALID');
  const trainedAt = nonEmptyString(tr.trainedAt);
  const sessionRef = nonEmptyString(tr.sessionRef);
  if (!trainedAt || !sessionRef) throw new ModelPackValidationError('TRAINING_INVALID');
  const training: ModelTraining = { splitSeed: tr.splitSeed, task: tr.task as ModelTask, targets, trainedAt, sessionRef };
  if (tr.groups !== undefined) {
    if (!object(tr.groups)) throw new ModelPackValidationError('TRAINING_INVALID');
    const entries: Array<[string, string[]]> = [];
    for (const [key, value] of Object.entries(tr.groups)) {
      const list = stringArray(value);
      if (!list) throw new ModelPackValidationError('TRAINING_INVALID');
      entries.push([key, list]);
    }
    training.groups = Object.fromEntries(entries);
  }

  if (!object(input.usage)) throw new ModelPackValidationError('USAGE_INVALID');
  const inputs = stringArray(input.usage.inputs);
  const outputs = stringArray(input.usage.outputs);
  const form = nonEmptyString(input.usage.form);
  if (!inputs || !outputs || !form) throw new ModelPackValidationError('USAGE_INVALID');
  const usage: ModelUsage = { inputs, outputs, form };

  return {
    formatVersion: MODEL_PACK_FORMAT_VERSION,
    model: { name, version: version as number, stage: sourceStage },
    goal,
    data: { fingerprint },
    metrics,
    training,
    usage,
  };
}

/** 把已校验 manifest 与导入事实折叠成货架记录（纯映射，Host 存储侧调用）。 */
export function toRegistryEntry(manifest: ModelPackManifest, facts: ModelImportFacts): ModelRegistryEntry {
  if (!MODEL_STAGES.includes(facts.stage)) throw new ModelPackValidationError('STAGE_INVALID');
  if (typeof facts.snapshotSha256 !== 'string' || !SHA256_PATTERN.test(facts.snapshotSha256)) {
    throw new ModelPackValidationError('SNAPSHOT_HASH_INVALID');
  }
  if (!nonEmptyString(facts.installedAt)) throw new ModelPackValidationError('MANIFEST_INVALID');
  return {
    schemaVersion: 1,
    name: manifest.model.name,
    version: manifest.model.version,
    stage: facts.stage,
    task: manifest.training.task,
    goal: manifest.goal,
    metrics: { ...manifest.metrics },
    fingerprint: { ...manifest.data.fingerprint, columns: [...manifest.data.fingerprint.columns] },
    training: { ...manifest.training, targets: [...manifest.training.targets] },
    usage: {
      inputs: [...manifest.usage.inputs],
      outputs: [...manifest.usage.outputs],
      form: manifest.usage.form,
    },
    installedAt: facts.installedAt,
    sourcePath: typeof facts.sourcePath === 'string' ? facts.sourcePath : '',
    snapshotSha256: facts.snapshotSha256,
  };
}

/** 货架/详情的指标展示：去掉 `:target` 重复键，按 3 位有效数字收敛（纯格式化，不改数值口径）。 */
export function metricLabel(metrics: Record<string, number>): string {
  return Object.entries(metrics)
    .filter(([key]) => !key.includes(':'))
    .map(([key, value]) => `${key} ${Number(value.toPrecision(3))}`)
    .join(' · ');
}
