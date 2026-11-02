import { Type } from 'typebox';
import { defineTool } from '../../../../src/agent/sdk.ts';
import { SimLabService } from '../service/simlab-service.ts';
import { EngineFault } from '../kernel/engine.ts';
import { StoreFault } from '../storage/store.ts';

// 5 个正交推演工具：只声明能力与业务契约，不规定 Agent 的分析步骤。
// 固化（freeze）刻意不设为工具：正式记录由用户在页面确认（C7）。
const parametersSchema = Type.Record(Type.String(), Type.Any(), { description: '草稿参数（仅传入需修改的字段；字段与取值范围见 simulation_inspect）' });
const variantsSchema = Type.Array(Type.Object({
  id: Type.String({ description: '小写字母数字连字符，如 baseline' }),
  name: Type.String(),
  openingExtraStock: Type.Optional(Type.Number({ description: 'D0 额外现货（整数件），按进价即刻扣款' })),
  acceptanceCap: Type.Optional(Type.Union([Type.Number(), Type.Null()], { description: '日承接上限（整数件），null 为不限' })),
  promoWindow: Type.Optional(Type.Object({ start: Type.Number(), end: Type.Number() })),
  promoLiftScale: Type.Optional(Type.Number({ description: '活动力度系数 0–1，如 0.5 表示减半' })),
}), { description: '方案变体全量列表（1–8 个，id 不重复）' });
const perturbationSchema = Type.Object({
  demandMultiplier: Type.Optional(Type.Number({ description: '需求乘数 (0,10]，如 1.25' })),
  capacityMultiplier: Type.Optional(Type.Number({ description: '产能乘数 (0,10]，如 0.85' })),
  leadTimeDelta: Type.Optional(Type.Number({ description: '提前期增减天数（整数，−30–30）' })),
  priceMultiplier: Type.Optional(Type.Number({ description: '单价乘数 (0,10]' })),
}, { description: '自定义扰动：维度与幅度由你指定，不预置固定清单' });

type Envelope = { status: 'succeeded'; data: unknown } | { status: 'rejected'; code: string; message: string };
const textResult = (envelope: Envelope) => ({
  content: [{ type: 'text' as const, text: JSON.stringify(envelope) }],
  details: envelope as Record<string, unknown>,
  ...(envelope.status === 'rejected' ? { isError: true } : {}),
});
const rejected = (error: unknown) => textResult(error instanceof EngineFault || error instanceof StoreFault
  ? { status: 'rejected', code: error.code, message: error.message }
  : { status: 'rejected', code: 'simulation_failed', message: '推演操作未完成，请检查本地存储状态后重试。' });
const succeeded = (data: unknown) => textResult({ status: 'succeeded', data });

const summaryOf = (run: { results: Record<string, { summary: unknown; conservation: boolean; validDays: number }> }, draftRevision: number, id: string) => ({
  runId: id, draftRevision,
  results: Object.fromEntries(Object.entries(run.results).map(([variantId, r]) => [variantId, { summary: r.summary, conservation: r.conservation, validDays: r.validDays }])),
});

/** 在项目任务子进程内以声明式配置实例化；扩展不接触会话与 SDK 管理对象。 */
export function createSimulationTools(options: { storeRoot: string; projectId: string }) {
  const service = new SimLabService(options.storeRoot, options.projectId);
  return [
    defineTool({
      name: 'simulation_inspect',
      label: '推演引擎口径',
      description: '读取经营推演引擎的规则口径、参数默认值、扰动维度与未建模边界。首次使用推演能力前先读它，不要假设规则。',
      promptSnippet: '读取经营推演引擎口径与能力边界',
      parameters: Type.Object({}),
      execute: async () => {
        try { return succeeded(service.inspect()); } catch (error) { return rejected(error); }
      },
    }),
    defineTool({
      name: 'simulation_draft',
      label: '推演草稿',
      description: '创建/列出/读取/更新项目内的推演草稿（参数与方案变体）。更新必须带 expectedRevision 做 CAS；草稿可自由修改，属于探索性操作。',
      promptSnippet: '管理经营推演草稿与方案变体',
      parameters: Type.Object({
        action: Type.Union([Type.Literal('create'), Type.Literal('list'), Type.Literal('get'), Type.Literal('update')]),
        draftId: Type.Optional(Type.String()),
        name: Type.Optional(Type.String()),
        parameters: Type.Optional(parametersSchema),
        variants: Type.Optional(variantsSchema),
        expectedRevision: Type.Optional(Type.Number({ description: 'update 必填：读取草稿时的 revision' })),
      }),
      execute: async (_id, params) => {
        try {
          if (params.action === 'list') return succeeded({ drafts: await service.listDrafts() });
          if (params.action === 'create') {
            if (!params.name) return rejected(new EngineFault('invalid_name', 'create 需要 name。'));
            return succeeded({ draft: await service.createDraft({ name: params.name, parameters: params.parameters, variants: params.variants }) });
          }
          if (!params.draftId) return rejected(new EngineFault('draft_not_found', '该操作需要 draftId。'));
          if (params.action === 'get') return succeeded({ draft: await service.getDraft(params.draftId) });
          if (params.expectedRevision === undefined) return rejected(new EngineFault('revision_conflict', 'update 需要 expectedRevision。'));
          return succeeded({ draft: await service.updateDraft(params.draftId, { name: params.name, parameters: params.parameters, variants: params.variants }, params.expectedRevision) });
        } catch (error) { return rejected(error); }
      },
    }),
    defineTool({
      name: 'simulation_run',
      label: '运行推演',
      description: '对当前草稿的全部方案变体各跑一次确定性推演，返回 runId、各变体汇总指标与守恒校验结果。同参数同引擎结果可复现；结果为探索性，固化证据需在页面由用户确认。',
      promptSnippet: '运行经营推演并读取汇总指标',
      parameters: Type.Object({
        draftId: Type.String(),
        includeLedger: Type.Optional(Type.Boolean({ description: '为 true 时附 variantId 指定变体的逐日账本' })),
        variantId: Type.Optional(Type.String()),
        suggestFreeze: Type.Optional(Type.Object({ variantId: Type.String(), reason: Type.String({ minLength: 1, maxLength: 1000 }) }, { description: '仅当你明确建议用户固化某方案时填写；返回对话建议卡，不执行固化。' })),
      }),
      execute: async (_id, params) => {
        try {
          const suggestion = params.suggestFreeze;
          if (suggestion) {
            if (typeof suggestion.reason !== 'string' || !suggestion.reason.trim() || suggestion.reason.length > 1000) return rejected(new EngineFault('invalid_suggestion', '固化建议需提供1–1000字理由。'));
            const draft = await service.getDraft(params.draftId);
            if (!draft.variants.some(variant => variant.id === suggestion.variantId)) return rejected(new EngineFault('invalid_variant', '固化建议的方案不在草稿中。'));
          }
          const run = await service.runDraft(params.draftId);
          const data: Record<string, unknown> = { ...summaryOf(run, run.draftRevision, run.id), engineVersion: run.engineVersion };
          if (suggestion) {
            const result = run.results[suggestion.variantId];
            if (result) data.freezeSuggestion = { projectId: options.projectId, draftId: run.draftId, draftRevision: run.draftRevision, runId: run.id, variantId: suggestion.variantId, reason: suggestion.reason.trim(), engineVersion: run.engineVersion, inputHash: result.inputHash };
            else data.suggestionStatus = 'variant_changed'; // The run remains a successful, saved operation.
          }
          if (params.includeLedger && params.variantId) {
            const result = run.results[params.variantId];
            if (!result) return rejected(new EngineFault('invalid_variant', '运行记录中没有该变体结果。'));
            data.ledger = { variantId: params.variantId, rows: result.rows };
          }
          return succeeded(data);
        } catch (error) { return rejected(error); }
      },
    }),
    defineTool({
      name: 'simulation_stress',
      label: '扰动分析',
      description: '对草稿的指定变体施加自定义扰动（需求/产能/提前期/单价），返回扰动前后指标与阈值翻转信号，检验结论稳健性。',
      promptSnippet: '对推演结论做自定义扰动压力测试',
      parameters: Type.Object({
        draftId: Type.String(),
        perturbation: perturbationSchema,
        variantIds: Type.Optional(Type.Array(Type.String(), { description: '缺省为全部变体' })),
      }),
      execute: async (_id, params) => {
        try { return succeeded({ rows: await service.stress(params.draftId, { perturbation: params.perturbation, variantIds: params.variantIds }) }); }
        catch (error) { return rejected(error); }
      },
    }),
    defineTool({
      name: 'simulation_evidence',
      label: '推演证据',
      description: '读取已固化的推演快照（正式决策证据）。无 snapshotId 时列出本项目全部快照；有 id 时返回口径、参数、结果与引擎身份。快照由用户在页面确认生成，本工具只读。',
      promptSnippet: '读取已固化的推演快照证据',
      parameters: Type.Object({
        snapshotId: Type.Optional(Type.String()),
        includeLedger: Type.Optional(Type.Boolean()),
      }),
      execute: async (_id, params) => {
        try {
          if (!params.snapshotId) {
            const snapshots = await service.listSnapshots();
            return succeeded({ snapshots: snapshots.map(s => ({ id: s.id, name: s.name, frozenAt: s.frozenAt, draftId: s.draftId, variant: s.variant, summary: s.result.summary, engineVersion: s.engineVersion, model: s.model })) });
          }
          const snapshot = await service.getSnapshot(params.snapshotId);
          const { result, ...rest } = snapshot;
          return succeeded({ snapshot: { ...rest, result: params.includeLedger ? result : { ...result, rows: undefined } } });
        } catch (error) { return rejected(error); }
      },
    }),
  ];
}
