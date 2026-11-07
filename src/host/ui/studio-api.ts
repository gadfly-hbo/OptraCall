import { HostRequestError } from './runtime-client.ts';

export class StudioRequestError extends HostRequestError {
  readonly uncertain: boolean;
  constructor(message: string, code = 'studio_request_failed', status = 0, uncertain = false) {
    super(message, {}, code, undefined, undefined, status); this.uncertain = uncertain;
  }
}
const object = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const failureMessages: Record<string, string> = {
  studio_project_read_only: '建设归属项目已归档，原记录保留；恢复原项目后继续维护。',
  studio_asset_conflict: '这份资产已有新修订。请先核对准确版本，当前编辑保持。',
  studio_publication_changed: '预览中的内容、来源或版本已有变化。请核对后重新准备受影响预览。',
  studio_source_not_ready: '相关成果尚未具备本轮发布资格，请核对来源、检查事实和适用范围。',
  empty_studio_publication: '本轮尚无具备发布资格的成果；候选与缺口继续保留。',
  studio_source_changed: '准确来源已发生变化，请核对新旧版本；原引用保持，不以最新版本替代。',
  studio_source_unavailable: '这份准确来源当前不可用；原引用保持，不以其他来源替代。',
  studio_source_restricted: '这份源资产的相关用途当前受限，请先核对已确认问题和影响。',
  studio_operation_not_found: '尚未找到原请求的确定回执，结果仍待核；不自动重发。',
  studio_question_changed: '问题内容或原答复已有变化，本次回答未保存。草稿和原题保持，请核对当前问题后再回答。',
  studio_question_context_required: '当前回答缺少打开时的问题依据，本次未保存。请保留草稿并重新核对该问题。',
};

/** HTTP boundary for Studio's own business endpoints; never replays a mutation. */
export async function studioRequest<T>(path: string, method: 'GET' | 'POST' = 'GET', body?: unknown, signal?: AbortSignal): Promise<T> {
  try {
    const response = await fetch(`/api/studio/${path}`, {
      method, mode: 'same-origin', credentials: 'omit', cache: 'no-store',
      headers: { 'x-optracall-client': '1', 'content-type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }), ...(signal ? { signal } : {}),
    });
    const value: unknown = await response.json();
    if (!response.ok) {
      const code = object(value) && typeof value.code === 'string' ? value.code : 'studio_request_failed';
      const message = object(value) && typeof value.message === 'string' && value.message !== code ? value.message : failureMessages[code] || '本次操作未能完成，请核对本轮范围、准确来源及当前资格；原记录保持。';
      throw new StudioRequestError(message, code, response.status, method === 'POST' && response.status >= 500);
    }
    return value as T;
  } catch (error) {
    if (error instanceof StudioRequestError) throw error;
    if (signal?.aborted && method === 'GET') throw error;
    throw new StudioRequestError(method === 'POST' ? '操作结果尚未核定。原输入与请求保留，请先核对，勿重复创建。' : 'Studio 暂时无法读取，请稍后重试。', method === 'POST' ? 'studio_result_unknown' : 'studio_read_unavailable', 0, method === 'POST');
  }
}

import type { StudioSystem, StudioMaterial, StudioSourceRef, StudioPublicationPreview, StudioPublication, StudioCreateInput, StudioSaveAssetInput, StudioPublicationInput, StudioWorkItem } from '../../../extensions/business-plugins/studio/contracts.ts';
import { studioQuestionContext } from '../../../extensions/business-plugins/studio/contracts.ts';
import type { ClientProject, ClientTask, SessionSnapshot } from './project-types.ts';
export type { StudioSystem, StudioMaterial, StudioSourceRef, StudioPublicationPreview, StudioPublication, StudioSaveAssetInput };

export interface StudioWorkspace {
  system: StudioSystem;
  project: ClientProject;
  task: ClientTask;
  snapshot?: SessionSnapshot;
  running: boolean;
  sources?: StudioMaterial[];
  sap?: { metrics?: StudioSourceRef[]; methods?: StudioSourceRef[] };
}
export interface StudioSourceText { text: string; complete: boolean; limitation?: string; governance?: unknown }
export interface StudioOperationResult { requestId: string; status: 'succeeded' | 'failed' | 'unknown'; systemId?: string; error?: string; result?: Record<string, unknown> }
export type StudioCreateRequest = Omit<StudioCreateInput, 'taskId'> & { requestId: string };
const systemPath = (id: string) => `systems/${encodeURIComponent(id)}`;
const mismatch = (uncertain = false) => new StudioRequestError('Studio 回执与请求归属不一致；原输入保持，请核对原记录。', 'studio_response_mismatch', 0, uncertain);
export async function listStudioSystems(signal?: AbortSignal): Promise<StudioSystem[]> {
  const value = await studioRequest<{ systems: StudioSystem[] }>('systems', 'GET', undefined, signal);
  if (!object(value) || !Array.isArray(value.systems)) throw mismatch();
  return value.systems;
}
export async function readStudioWorkspace(id: string, signal?: AbortSignal): Promise<StudioWorkspace> {
  const value = await studioRequest<StudioWorkspace>(systemPath(id), 'GET', undefined, signal);
  if (!object(value) || !object(value.system) || value.system.id !== id || !object(value.project) || value.project.id !== value.system.projectId || !object(value.task) || value.task.id !== value.system.taskId || typeof value.running !== 'boolean') throw mismatch();
  return value;
}
export async function createStudioSystem(input: StudioCreateRequest): Promise<StudioSystem> {
  const value = await studioRequest<{ system: StudioSystem }>('systems', 'POST', input);
  if (!object(value) || !object(value.system) || value.system.projectId !== input.projectId || typeof value.system.id !== 'string') throw mismatch(true);
  return value.system;
}
export async function readStudioMaterials(projectId: string, signal?: AbortSignal): Promise<StudioMaterial[]> {
  const value = await studioRequest<{ materials: StudioMaterial[] }>(`materials?projectId=${encodeURIComponent(projectId)}`, 'GET', undefined, signal);
  if (!object(value) || !Array.isArray(value.materials)) throw mismatch();
  return value.materials;
}
export async function writeStudioSystem(id: string, action: string, input: unknown): Promise<StudioSystem> {
  const value = await studioRequest<{ system: StudioSystem }>(`${systemPath(id)}/${action}`, 'POST', input);
  if (!object(value) || !object(value.system) || value.system.id !== id) throw mismatch(true);
  return value.system;
}
/** Bind to the opened question snapshot, captured before any asynchronous hashing or network work. */
export async function answerStudioQuestion(id: string, requestId: string, openedQuestion: StudioWorkItem, answer: string): Promise<StudioSystem> {
  const context = studioQuestionContext(openedQuestion), workItemId = openedQuestion.id;
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(context));
  const expectedQuestionContextSha256 = Array.from(new Uint8Array(bytes), value => value.toString(16).padStart(2, '0')).join('');
  return writeStudioSystem(id, 'answers', { requestId, workItemId, answer, expectedQuestionContextSha256 });
}
export async function prepareStudioPublication(id: string, input: StudioPublicationInput & { requestId: string }): Promise<{ system: StudioSystem; preview: StudioPublicationPreview }> {
  const value = await studioRequest<{ system: StudioSystem; preview: StudioPublicationPreview }>(`${systemPath(id)}/preview`, 'POST', input);
  if (!object(value) || value.system?.id !== id || !value.preview?.id || !value.preview.fingerprint) throw mismatch(true);
  return value;
}
export async function readStudioPublicationResult(id: string, previewId: string): Promise<{ system: StudioSystem; publication: StudioPublication }> {
  const value = await studioRequest<{ system: StudioSystem; publication: StudioPublication }>(`${systemPath(id)}/publications/${encodeURIComponent(previewId)}/result`);
  if (!object(value) || value.system?.id !== id || value.publication?.preview.id !== previewId) throw mismatch();
  return value;
}
export async function readStudioOperation(requestId: string): Promise<StudioOperationResult> {
  const value = await studioRequest<StudioOperationResult>(`operations/${encodeURIComponent(requestId)}`);
  if (!object(value) || value.requestId !== requestId || !['succeeded', 'failed', 'unknown'].includes(value.status)) throw mismatch();
  return value;
}
export async function readStudioSource(id: string, ref: StudioSourceRef): Promise<StudioSourceText> {
  const value = await studioRequest<StudioSourceText>(`${systemPath(id)}/sources/read`, 'POST', { ref });
  if (!object(value) || typeof value.text !== 'string' || typeof value.complete !== 'boolean') throw mismatch();
  return value;
}

export interface StudioAnalysisTarget { system: StudioSystem; project: ClientProject; task: ClientTask }
export function checkedStudioAnalysisTarget(value: unknown, systemId: string, projectId: string): StudioAnalysisTarget {
  if (!object(value) || !object(value.system) || value.system.id !== systemId || !object(value.project) || value.project.id !== projectId || !object(value.task) || typeof value.task.id !== 'string') throw mismatch(true);
  return value as unknown as StudioAnalysisTarget;
}

/** Keep the current task's view explicit when moving out of a Studio deep link. */
export function studioTaskUrl(current: string, projectId: string, taskId?: string, systemId?: string): URL {
  const url = new URL(current); url.searchParams.set('project', projectId);
  if (taskId) url.searchParams.set('task', taskId); else url.searchParams.delete('task');
  if (systemId) url.searchParams.set('studio', systemId); else url.searchParams.delete('studio');
  return url;
}
