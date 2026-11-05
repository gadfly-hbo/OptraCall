import { Type } from 'typebox';
import { defineTool } from './sdk.ts';
import { MODEL_NAME_PATTERN, type ModelRegistryEntry } from '../../extensions/business-plugins/model-pack/types.ts';

type Envelope = { status: 'succeeded'; data: unknown } | { status: 'rejected'; code: string; message: string; detail?: { stage?: string; reason?: string; hint?: string } };
const result = (envelope: Envelope) => ({ content: [{ type: 'text' as const, text: JSON.stringify(envelope) }], details: envelope as Record<string, unknown>, ...(envelope.status === 'rejected' ? { isError: true } : {}) });
const invalid = (code: string, message: string) => result({ status: 'rejected', code, message });

// Model storage paths and import controls remain Host-owned. The model sees
// shelf facts and name/version references, never a package execution path.
const shelf = (model: ModelRegistryEntry) => ({
  name: model.name, version: model.version, stage: model.stage, task: model.task,
  goal: model.goal, metrics: model.metrics, usage: model.usage,
  ...(model.corrupted ? { corrupted: true } : {}),
});

/** Declarative project capability; no session, model or separate runtime. */
export function createModelPackTools(options: { modelsRoot: string; projectRoot: string }) {
  async function withStore(operation: (store: import('../host/model-pack-store.ts').ModelPackStore) => Promise<unknown> | unknown) {
    const { ModelPackStore, ModelPackError } = await import('../host/model-pack-store.ts');
    let store: InstanceType<typeof ModelPackStore> | undefined;
    try {
      store = new ModelPackStore(options.modelsRoot, { readOnly: true });
      return result({ status: 'succeeded', data: await operation(store) });
    } catch (error) {
      return error instanceof ModelPackError
        ? result({ status: 'rejected', code: error.code, message: error.message, detail: error.detail })
        : invalid('MODEL_PACK_FAILED', '模型操作未完成，请检查注册表或输入文件。');
    } finally { store?.close(); }
  }
  return [
    defineTool({
      name: 'modelpack_list', label: '查看模型货架',
      description: '只读列出已安装模型的 name、version、stage、任务、训练指标和 usage。训练与指标来自 MPS；此工具不训练、不导入、不晋级模型。是否使用及如何组合模型由你决定。',
      promptSnippet: '查看模型货架事实与输入输出合同',
      parameters: Type.Object({}, { additionalProperties: false }),
      execute: async (_id, parameters) => {
        if (Object.keys(parameters).length) return invalid('MODEL_ARGUMENTS_INVALID', '查看货架不接受目录或其他参数。');
        return withStore(store => ({ models: store.list().map(shelf) }));
      },
    }),
    defineTool({
      name: 'modelpack_predict', label: '运行模型预测',
      description: '按已安装模型 name 与可选正整数 version 进行本机确定性预测；不传 version 时选择该名称的 Production，显式版本可用 Staging，Archived 不可执行。不接受模型文件路径。inputPath 为项目 020_clean 中 CSV/JSON，outputPath 为项目 020_clean 或 060_reports 内的新 CSV/JSON 文件；可传项目相对或绝对路径。沙箱不可用或输入/执行失败时返回结构化原因，不自动重试。结果与出处会进入本任务模型上下文；引用预测数须注明返回的模型 name/version/stage、指标和数据指纹。',
      promptSnippet: '用已安装模型预测并返回版本、指标和指纹出处',
      parameters: Type.Object({
        name: Type.String({ pattern: MODEL_NAME_PATTERN.source, description: '货架模型名称，不是文件路径' }),
        version: Type.Optional(Type.Integer({ minimum: 1, description: '不传则选 Production；显式指定版本可选 Staging' })),
        inputPath: Type.String({ minLength: 1, description: '本项目 020_clean 内的输入 CSV/JSON 文件' }),
        outputPath: Type.String({ minLength: 1, description: '本项目 020_clean 或 060_reports 内的新输出 CSV/JSON 文件' }),
      }, { additionalProperties: false }),
      execute: async (_id, parameters, signal) => {
        if (Object.keys(parameters).some(key => !['name', 'version', 'inputPath', 'outputPath'].includes(key))) return invalid('MODEL_ARGUMENTS_INVALID', '预测仅接受 name、version、inputPath、outputPath。');
        if (typeof parameters.name !== 'string' || !MODEL_NAME_PATTERN.test(parameters.name)) return invalid('MODEL_NAME_INVALID', '请使用货架模型名称，不能传入模型路径。');
        if (parameters.version !== undefined && (!Number.isSafeInteger(parameters.version) || parameters.version < 1)) return invalid('MODEL_VERSION_INVALID', '模型版本须为正整数。');
        if (typeof parameters.inputPath !== 'string' || !parameters.inputPath.trim() || typeof parameters.outputPath !== 'string' || !parameters.outputPath.trim()) return invalid('MODEL_ARGUMENTS_INVALID', '请提供项目内输入和新输出路径。');
        return withStore(async store => {
          const prediction = await store.predict({ ...parameters, projectRoot: options.projectRoot, signal });
          return { ...prediction, model: shelf(prediction.model) };
        });
      },
    }),
  ];
}
