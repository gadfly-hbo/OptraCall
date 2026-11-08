import type { ModelRegistryEntry, ModelPackImportFailure, ModelPackManifest } from '../types.ts';

export type { ModelRegistryEntry, ModelPackImportFailure };

/** 只投影导入进度；原始失败阶段仍由错误信封保留。 */
export function modelPackImportFailureStep(stage?: string) {
  const step = stage === 'purity_scan' ? 'purity' : stage === 'sandbox_smoke' ? 'smoke' : stage === 'integrity' ? 'install' : stage;
  return (['structure', 'manifest', 'purity', 'smoke', 'install'] as const).find(value => value === step);
}

export class ModelPackRequestError extends Error {
  readonly code: string;
  readonly status: number;
  readonly detail: ModelPackImportFailure | undefined;
  constructor(code: string, status: number, message?: string, detail?: ModelPackImportFailure) {
    super(message ?? `模型包请求未完成（${code}），请检查输入或本地服务后重试。`);
    this.name = 'ModelPackRequestError';
    this.code = code;
    this.status = status;
    this.detail = detail;
  }
}

export function isModelPackImportRejection(error: unknown): error is ModelPackRequestError {
  return error instanceof ModelPackRequestError && (error.status < 500
    || error.status === 503 && error.code === 'SANDBOX_UNAVAILABLE' && error.detail?.stage === 'sandbox_smoke');
}

async function request<T>(route: string, method: 'GET' | 'POST' = 'GET', input?: unknown): Promise<T> {
  const response = await fetch(`/api/model-pack/${route}`, {
    method, credentials: 'omit', mode: 'same-origin', cache: 'no-store',
    headers: { 'content-type': 'application/json', 'x-optracall-client': '1' },
    ...(input === undefined ? {} : { body: JSON.stringify(input) }),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    const value = result as { code?: string; message?: string; detail?: ModelPackImportFailure };
    throw new ModelPackRequestError(value.code ?? 'model_pack_request_failed', response.status, value.message, value.detail);
  }
  return result as T;
}

/** 货架事实（只读）：全部注册表条目，含 stage 与随行训练指标。 */
export const listModels = () => request<{ models: ModelRegistryEntry[] }>('models');

/** 单条货架记录：仅按 name+version 解析，不接受任意路径（IN05）。 */
export const getModel = (name: string, version: number) =>
  request<{ model: ModelRegistryEntry }>(`models/${encodeURIComponent(name)}/${version}`);

/** 原始 manifest 按需查读；旧 Host 缺少此字段时保持未知，不以货架记录重建。 */
export const getModelDetails = (name: string, version: number) =>
  request<{ model: ModelRegistryEntry; manifest?: ModelPackManifest }>(`models/${encodeURIComponent(name)}/${version}`);

/** 导入：把 MPS 导出包目录交 Host 验货门（结构/纯度/沙箱冒烟）后拷入 dataRoot 快照，登记为 Staging。 */
export const importPack = (sourcePath: string) =>
  request<{ model: ModelRegistryEntry }>('imports', 'POST', { sourcePath });

/** 晋级：Staging→Production（最小人审）；同名旧 Production 自动归档，随回执返回。 */
export const promoteModel = (name: string, version: number) =>
  request<{ model: ModelRegistryEntry; archived: ModelRegistryEntry | null }>(`models/${encodeURIComponent(name)}/${version}/promote`, 'POST', {});
