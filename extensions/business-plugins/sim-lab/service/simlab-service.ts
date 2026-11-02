import { randomUUID } from 'node:crypto';
import { SimLabStore } from '../storage/store.ts';
import { engineRules, snapshotRules } from '../kernel/model-rules.ts';
import {
  simulate, validateParameters, validateVariant, validatePerturbation,
  DEFAULT_PARAMETERS, defaultVariants, EngineFault,
} from '../kernel/engine.ts';
import {
  ENGINE_VERSION, MAX_VARIANTS_PER_DRAFT, UNMODELED_CAPABILITIES,
  type SimParameters, type SimVariant, type SimPerturbation,
  type DraftRecord, type RunRecord, type SnapshotRecord, type StressRow,
} from '../types.ts';

const object = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const NAME_LIMIT = 80;

function draftName(value: unknown): string {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > NAME_LIMIT) throw new EngineFault('invalid_name', '名称必填且不超过 80 字。');
  return value.trim();
}

function mergeParameters(base: SimParameters, input: unknown): SimParameters {
  if (input === undefined) return { ...base };
  if (!object(input)) throw new EngineFault('invalid_parameters', '参数必须是对象。');
  for (const key of Object.keys(input)) if (!(key in base)) throw new EngineFault('invalid_parameters', `未知参数 ${key}。`);
  const merged = { ...base, ...input } as SimParameters;
  validateParameters(merged);
  return merged;
}

function validateVariants(input: unknown, days: number, fallback: SimVariant[]): SimVariant[] {
  if (input === undefined) { for (const variant of fallback) validateVariant(variant, days); return fallback; }
  if (!Array.isArray(input) || !input.length || input.length > MAX_VARIANTS_PER_DRAFT) throw new EngineFault('variant_limit', `方案变体须为 1–${MAX_VARIANTS_PER_DRAFT} 个。`);
  const ids = new Set<string>();
  const variants = input.map(item => {
    if (!object(item)) throw new EngineFault('invalid_variant', '变体必须是对象。');
    for (const key of Object.keys(item)) if (!['id', 'name', 'openingExtraStock', 'acceptanceCap', 'promoWindow', 'promoLiftScale'].includes(key)) throw new EngineFault('invalid_variant', `未知变体字段 ${key}。`);
    if (object(item.promoWindow)) for (const key of Object.keys(item.promoWindow)) if (!['start', 'end'].includes(key)) throw new EngineFault('invalid_variant', `未知活动窗口字段 ${key}。`);
    const variant: SimVariant = {
      id: String(item.id ?? ''), name: String(item.name ?? ''),
      openingExtraStock: item.openingExtraStock === undefined ? 0 : item.openingExtraStock as number,
      acceptanceCap: item.acceptanceCap === undefined || item.acceptanceCap === null ? null : item.acceptanceCap as number,
      ...(item.promoWindow === undefined ? {} : { promoWindow: item.promoWindow as SimVariant['promoWindow'] }),
      ...(item.promoLiftScale === undefined ? {} : { promoLiftScale: item.promoLiftScale as number }),
    };
    validateVariant(variant, days);
    if (ids.has(variant.id)) throw new EngineFault('invalid_variant', `变体 id 重复：${variant.id}。`);
    ids.add(variant.id);
    return variant;
  });
  return variants;
}

/** 业务操作层：引擎计算与存储编排。探索性操作无门禁，固化校验证据纪律。 */
export class SimLabService {
  readonly store: SimLabStore;
  readonly projectId: string;
  constructor(storeRoot: string, projectId: string) { this.store = new SimLabStore(storeRoot); this.projectId = projectId; }

  inspect() {
    return {
      engineVersion: ENGINE_VERSION,
      variantLimit: MAX_VARIANTS_PER_DRAFT,
      windowDays: { min: 7, max: 90 },
      caliber: engineRules(ENGINE_VERSION).caliber!,
      defaults: { parameters: DEFAULT_PARAMETERS, variants: defaultVariants() },
      unmodeled: UNMODELED_CAPABILITIES,
      disclaimer: '确定性假设模型：输出是假设的严谨展开，不是现实预测、概率、优化推荐或因果效果。',
    };
  }

  listDrafts(): Promise<DraftRecord[]> { return this.store.listDrafts(); }
  getDraft(id: string): Promise<DraftRecord> { return this.store.getDraft(id); }

  async createDraft(input: { name: unknown; parameters?: unknown; variants?: unknown }): Promise<DraftRecord> {
    const parameters = mergeParameters(DEFAULT_PARAMETERS, input.parameters);
    const variants = validateVariants(input.variants, parameters.days, defaultVariants(parameters.days));
    return this.store.insertDraft({
      schemaVersion: 1, id: randomUUID(), projectId: this.projectId, name: draftName(input.name), parameters, variants,
    });
  }

  async updateDraft(id: string, input: { name?: unknown; parameters?: unknown; variants?: unknown }, expectedRevision: number): Promise<DraftRecord> {
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 1) throw new EngineFault('revision_conflict', '缺少有效的 expectedRevision。');
    const current = await this.store.getDraft(id);
    const parameters = mergeParameters(current.parameters, input.parameters);
    const variants = validateVariants(input.variants, parameters.days, current.variants);
    const name = input.name === undefined ? current.name : draftName(input.name);
    return this.store.updateDraft(id, expectedRevision, () => ({
      schemaVersion: 1, id, projectId: current.projectId, name, parameters, variants,
    }));
  }

  /** 探索性运行：对当前草稿全部变体各跑一次，持久化为运行记录。 */
  async runDraft(draftId: string): Promise<RunRecord> {
    const draft = await this.store.getDraft(draftId);
    const results = Object.fromEntries(draft.variants.map(variant => [variant.id, simulate(draft.parameters, variant)]));
    return this.store.insertRun({
      schemaVersion: 1, projectId: draft.projectId, draftId, draftRevision: draft.revision,
      engineVersion: ENGINE_VERSION, inputHash: Object.values(results).map(r => r.inputHash).join(':'), results,
    });
  }

  listRuns(draftId?: string): Promise<RunRecord[]> {
    return this.store.listRuns().then(runs => draftId ? runs.filter(run => run.draftId === draftId) : runs);
  }
  getRun(id: string): Promise<RunRecord> { return this.store.getRun(id); }

  /** 扰动分析：维度与幅度由调用方指定，引擎能力范围内校验；结果不持久化（可按需复算）。 */
  async stress(draftId: string, input: { variantIds?: unknown; perturbation: SimPerturbation }): Promise<StressRow[]> {
    const draft = await this.store.getDraft(draftId);
    validatePerturbation(input.perturbation);
    const selected = input.variantIds === undefined
      ? draft.variants
      : draft.variants.filter(v => Array.isArray(input.variantIds) && input.variantIds.includes(v.id));
    if (!selected.length) throw new EngineFault('invalid_variant', '扰动范围未匹配任何变体。');
    return selected.map(variant => {
      const base = simulate(draft.parameters, variant).summary;
      const after = simulate(draft.parameters, variant, input.perturbation).summary;
      return {
        variantId: variant.id, variantName: variant.name, perturbation: { ...input.perturbation },
        base, after,
        cashTurnedNegative: base.minCash >= 0 && after.minCash < 0,
        crossedCashThreshold: base.minCash >= draft.parameters.cashThreshold && after.minCash < draft.parameters.cashThreshold,
      };
    });
  }

  async listSnapshots() { return (await this.store.listSnapshots()).map(snapshot => ({ ...snapshot, model: snapshotRules(snapshot) })); }
  async getSnapshot(id: string) { const snapshot = await this.store.getSnapshot(id); return { ...snapshot, model: snapshotRules(snapshot) }; }

  /** 固化：唯一盖章点。要求 CAS 匹配、运行对应当前草稿、守恒通过；快照不可改写。 */
  async freeze(draftId: string, input: { runId: string; variantId: string; expectedRevision: number; name?: unknown }): Promise<SnapshotRecord> {
    const draft = await this.store.getDraft(draftId);
    if (draft.revision !== input.expectedRevision) throw new EngineFault('revision_conflict', `草稿已被修改（当前 revision ${draft.revision}），请刷新后重试。`);
    const run = await this.store.getRun(input.runId);
    if (run.draftId !== draftId) throw new EngineFault('run_not_found', '运行记录不属于该草稿。');
    if (run.draftRevision !== draft.revision) throw new EngineFault('stale_run', '运行结果不对应草稿当前状态，请先重新运行再固化。');
    const variant = draft.variants.find(v => v.id === input.variantId);
    const result = run.results[input.variantId];
    if (!variant || !result) throw new EngineFault('invalid_variant', '运行记录中没有该变体结果。');
    if (!result.conservation) throw new EngineFault('conservation_failed', '该运行未通过守恒校验，不能固化为证据。');
    const name = input.name === undefined ? `${draft.name} · ${variant.name}` : draftName(input.name);
    return this.store.insertSnapshot({
      schemaVersion: 1, projectId: draft.projectId, draftId, draftRevision: draft.revision,
      runId: run.id, name, engineVersion: run.engineVersion, inputHash: result.inputHash,
      parameters: draft.parameters, variant, result,
    });
  }
}
