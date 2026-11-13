import { HostRequestError } from './runtime-client.ts';
import { parseCoverageContent } from '../../../extensions/business-plugins/studio/coverage.ts';

export class StudioRequestError extends HostRequestError {
  readonly uncertain: boolean;
  constructor(message: string, code = 'studio_request_failed', status = 0, uncertain = false) {
    super(message, {}, code, undefined, undefined, status); this.uncertain = uncertain;
  }
}
const object = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const failureMessages: Record<string, string> = {
  studio_foundation_dependency_not_shareable: '任务报告可作为准确核查证据保留，但尚不能充当这份共享结构的必需定义来源。请核定可正式供给的源资产，原稿与证据保持。',
  studio_foundation_binding_type_mismatch: '指标关联的来源不是原数据映射资产。请核对准确 Binding 版本，不能用主数据或概念资产替代。',
  invalid_studio_foundation: '三类资产结构存在缺失、重复条目或不匹配的关联。请核对当前内容约定，原稿和正式版保持。',
  unsupported_studio_foundation: '当前内容约定尚不支持结构核验，可保留草稿，不能按已核验结构发布。',
  studio_foundation_item_not_found: '准确源版本中没有这条引用项。请核对原引用与条目标识，不能改用最新版本代替。',
  studio_foundation_metric_not_found: '原 SAP 准确包版本中没有这个指标。请回原指标区核对包版本和指标名。',
  studio_foundation_dimension_not_found: '关联维度不在原 SAP 指标中，请回原指标区核对准确版本和维度。',
  studio_foundation_scenario_not_found: '原 SAP 版本中没有对应的指标用途场景，请核对场景 ID、版本和指标关联。',
  studio_foundation_source_incomplete: '当前来源正文未完整返回，尚不能核定该准确项或指标的结构关联。请先恢复原来源读取。',
  studio_project_read_only: '原建设项目已归档，原任务与历史只读保留；可选择新获准任务接续同一资产维护。',
  studio_asset_conflict: '这份资产已有新修订。请先核对准确版本，当前编辑保持。',
  studio_publication_changed: '预览中的内容、来源或版本已有变化。请核对后重新准备受影响预览。',
  invalid_studio_coverage: '盘点报告格式存在问题，请按准确修订核对具体字段；原稿与其他分析保持。',
  unsupported_studio_coverage: '当前报告版本不支持结构视图，可按原资格查看原文；其他分析照常。',
  studio_coverage_source_unavailable: '盘点报告的准确依据当前不可读，未使用缓存证据；可沿其他合格来源分析。',
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
import { studioExecutionOwner, studioQuestionContext } from '../../../extensions/business-plugins/studio/contracts.ts';
import type { StudioAuthority, StudioAssetKind, StudioContribution, StudioLinkContributionInput } from '../../../extensions/business-plugins/studio/contracts.ts';
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
export async function listStudioSystems(signal?: AbortSignal, projectId?: string): Promise<StudioSystem[]> {
  const value = await studioRequest<{ systems: StudioSystem[] }>(`systems${projectId ? `?projectId=${encodeURIComponent(projectId)}` : ''}`, 'GET', undefined, signal);
  if (!object(value) || !Array.isArray(value.systems)) throw mismatch();
  return value.systems;
}
export async function readStudioWorkspace(id: string, signal?: AbortSignal): Promise<StudioWorkspace> {
  const value = await studioRequest<StudioWorkspace>(systemPath(id), 'GET', undefined, signal);
  if (!object(value) || !object(value.system) || value.system.id !== id || !object(value.project) || !object(value.task) || typeof value.running !== 'boolean') throw mismatch();
  const owner = studioExecutionOwner(value.system);
  if (value.project.id !== owner.projectId || value.task.id !== owner.taskId) throw mismatch();
  return value;
}
export async function createStudioSystem(input: StudioCreateRequest): Promise<StudioSystem> {
  const value = await studioRequest<{ system: StudioSystem }>('systems', 'POST', input);
  if (!object(value) || !object(value.system) || value.system.projectId !== input.projectId || typeof value.system.id !== 'string' || input.enterpriseId && value.system.enterpriseId !== input.enterpriseId) throw mismatch(true);
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

export interface StudioEnterprise { id: string; name: string; revision: number; createdAt: string }
export interface StudioEnterpriseAssociation { enterpriseId: string; projectId?: string; caseId?: string; authority?: StudioAuthority; id?: string; entityId?: string }
export interface StudioEnterpriseDirectory {
  enterprises: StudioEnterprise[];
  projectAssignments: StudioEnterpriseAssociation[];
  caseAssignments: StudioEnterpriseAssociation[];
  assetAssignments: StudioEnterpriseAssociation[];
}
export interface StudioFoundationItem {
  authority: StudioAuthority; id: string; version: string; title: string; status: string;
  ref?: StudioSourceRef; enterpriseId?: string; systemId?: string; kind?: StudioAssetKind;
}
export interface StudioFoundation {
  enterprise: StudioEnterprise; systems: StudioSystem[]; items: StudioFoundationItem[]; unassigned: StudioFoundationItem[];
}
export async function listStudioEnterprises(signal?: AbortSignal): Promise<StudioEnterpriseDirectory> {
  const value = await studioRequest<StudioEnterpriseDirectory>('enterprises', 'GET', undefined, signal);
  if (!object(value) || !Array.isArray(value.enterprises) || !Array.isArray(value.projectAssignments) || !Array.isArray(value.caseAssignments) || !Array.isArray(value.assetAssignments)) throw mismatch();
  return value;
}
export async function readStudioFoundation(enterpriseId: string, signal?: AbortSignal): Promise<StudioFoundation> {
  const value = await studioRequest<StudioFoundation>(`foundation?enterpriseId=${encodeURIComponent(enterpriseId)}`, 'GET', undefined, signal);
  if (!object(value) || value.enterprise?.id !== enterpriseId || !Array.isArray(value.systems) || !Array.isArray(value.items) || !Array.isArray(value.unassigned) || value.items.some(item => item.enterpriseId && item.enterpriseId !== enterpriseId) || value.systems.some(system => system.enterpriseId !== enterpriseId)) throw mismatch();
  return value;
}
export async function resolveStudioProfessionalEnterprise(directory: StudioEnterpriseDirectory, target: { authority: 'enterprise' | 'sap-metric' | 'sap-method'; id: string; version?: string | number }, signal?: AbortSignal): Promise<string | undefined> {
  const assignments = directory.assetAssignments.filter(item => item.authority === target.authority && (item.id || item.entityId) === target.id);
  if (assignments.length) {
    const owners = new Set(assignments.map(item => item.enterpriseId));
    const owner = owners.size === 1 ? [...owners][0] : undefined;
    return directory.enterprises.some(enterprise => enterprise.id === owner) ? owner : undefined;
  }
  const catalogs = await Promise.all(directory.enterprises.map(enterprise => readStudioFoundation(enterprise.id, signal)));
  const owners = new Set(catalogs.filter(catalog => catalog.items.some(item => item.authority === target.authority && item.id === target.id
    && (target.version === undefined || String(item.version) === String(target.version)) && item.enterpriseId === catalog.enterprise.id
    && ['formal-current', 'formal-history', 'candidate', 'disabled', 'restricted', 'suspected'].includes(item.status))).map(catalog => catalog.enterprise.id));
  return owners.size === 1 ? [...owners][0] : undefined;
}
export async function createStudioEnterprise(input: { name: string; requestId: string }): Promise<StudioEnterprise> {
  const value = await studioRequest<StudioEnterprise>('enterprises', 'POST', input);
  if (!object(value) || typeof value.id !== 'string' || value.name !== input.name) throw mismatch(true);
  return value;
}
export async function associateStudioEnterprise(input: { requestId: string; kind: 'project' | 'case' | 'asset'; entityId: string; enterpriseId: string; authority?: StudioAuthority }): Promise<void> {
  const value = await studioRequest<Record<string, unknown>>('enterprise-associations', 'POST', input);
  const binding = object(value.binding) ? value.binding : value;
  if (binding.enterpriseId !== input.enterpriseId) throw mismatch(true);
}
export async function readStudioContributions(systemId: string): Promise<StudioContribution[]> {
  const value = await studioRequest<{ contributions: StudioContribution[] }>(`${systemPath(systemId)}/contributions`);
  if (!object(value) || !Array.isArray(value.contributions)) throw mismatch();
  return value.contributions;
}
export async function linkStudioContribution(systemId: string, contributionId: string, input: Omit<StudioLinkContributionInput, 'contributionId'> & { requestId: string }): Promise<StudioSystem> {
  return writeStudioSystem(systemId, `contributions/${encodeURIComponent(contributionId)}/link`, input);
}

import type { CoverageReadResult } from './studio-coverage-view.ts';
export type { CoverageReadResult } from './studio-coverage-view.ts';
/** Read only the requested exact coverage revision through current source qualification. */
export async function readStudioCoverage(id: string, assetId: string, revision: number, signal?: AbortSignal): Promise<CoverageReadResult> {
  if (!Number.isSafeInteger(revision) || revision < 1) throw mismatch();
  const value = await studioRequest<CoverageReadResult>(systemPath(id) + '/coverage?assetId=' + encodeURIComponent(assetId) + '&revision=' + revision, 'GET', undefined, signal);
  if (!object(value) || value.systemId !== id || value.assetId !== assetId || value.revision !== revision
    || !object(value.ref) || value.ref.authority !== 'studio-source' || value.ref.id !== assetId || value.ref.version !== String(revision) || value.ref.locator !== id
    || !['ready', 'invalid', 'unsupported', 'unavailable'].includes(value.status)) throw mismatch();
  if (value.status === 'ready') {
    if (!value.report || parseCoverageContent(JSON.stringify(value.report)).kind !== 'supported' || value.report.scope.systemId !== id) throw mismatch();
    if (value.references && (!Array.isArray(value.references) || value.references.some(entry => !object(entry) || !object(entry.ref) || typeof entry.ref.authority !== 'string' || typeof entry.ref.id !== 'string' || typeof entry.ref.version !== 'string'
      || entry.foundationKinds !== undefined && (!Array.isArray(entry.foundationKinds) || entry.foundationKinds.some(kind => !['master-data', 'metric', 'ontology'].includes(kind)))))) throw mismatch();
  } else if (value.report !== undefined || value.references !== undefined || value.status === 'unavailable' && value.text !== undefined) throw mismatch();
  return value;
}
