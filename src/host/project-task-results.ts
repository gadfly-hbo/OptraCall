import { createHash } from 'node:crypto';
import { PROJECT_UPLOAD_MAX_BYTES } from './project-upload.ts';
import { setTimeout as delay } from 'node:timers/promises';
import { createNativeSnapshotReadBudget } from './native-session-snapshot.ts';
import type { ProjectTaskResultBinding, ProjectTaskResultDescriptor, ProjectTaskResultsContext, ProjectTaskResultsFindResult, ProjectTaskResultsOptions, ProjectTaskResultsPort, ProjectTaskResultsReadResult, ProjectTaskResultsScope, ProjectTaskResultsSourceReadOptions } from './project-task-results-types.ts';

export class ProjectTaskResultsError extends Error {
  readonly code: string;
  readonly status: number;
  constructor(code: string, status = 409) { super(code); this.code = code; this.status = status; }
}
function fail(code: string, status = 409): never { throw new ProjectTaskResultsError(code, status); }
const digest = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex');
const uuid = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value);
const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const identity = (value: unknown): value is string => typeof value === 'string' && Boolean(value.trim()) && value.length <= 300 && !/[\u0000-\u001f\u007f]/u.test(value);
const check = (context: ProjectTaskResultsContext) => { context.signal.throwIfAborted(); context.assertCurrent(); };
const MAX_TOOL_UTF16 = 32_768;
const MAX_READ_UTF16 = 16_000;
function boundary(text: string, end: number): number {
  return end > 0 && end < text.length && /[\uD800-\uDBFF]/u.test(text[end - 1]!) && /[\uDC00-\uDFFF]/u.test(text[end]!) ? end - 1 : end;
}
function binding(value: ProjectTaskResultBinding, projectId: string, taskId: string): ProjectTaskResultBinding {
  if (!object(value) || value.projectId !== projectId || value.taskId !== taskId || !identity(value.requestId) || !identity(value.sessionId) || !identity(value.toolCallId) || typeof value.relativePath !== 'string' || value.relativePath.length > 1000 || !/^[a-f0-9]{64}$/.test(value.sha256) || !Number.isSafeInteger(value.bytes) || value.bytes < 0 || value.bytes > PROJECT_UPLOAD_MAX_BYTES) fail('project_result_binding_unavailable');
  const parts = value.relativePath.split('/');
  if (parts.length < 2 || parts[0] !== '060_reports' || parts.some(x => !x || x.startsWith('.') || /[\\\u0000-\u001f\u007f]/u.test(x))) fail('project_result_binding_unavailable');
  if (value.nativeEntryId !== undefined && !identity(value.nativeEntryId)) fail('project_result_binding_unavailable');
  return { projectId, taskId, requestId: value.requestId, sessionId: value.sessionId, toolCallId: value.toolCallId, relativePath: value.relativePath, sha256: value.sha256, bytes: value.bytes, ...(value.nativeEntryId === undefined ? {} : { nativeEntryId: value.nativeEntryId }) };
}
function resultId(scope: ProjectTaskResultsScope, value: ProjectTaskResultBinding): string {
  const { nativeEntryId: _, ...source } = value;
  return digest(JSON.stringify([scope.projectId, scope.confirmationId, scope.planVersion, source.projectId, source.taskId, source.requestId, source.sessionId, source.toolCallId, source.relativePath, source.sha256, source.bytes]));
}

/** Supplies original saved material; it does not synthesize, classify causes, or decide whether work is complete. */
export function createProjectTaskResultsReader(options: ProjectTaskResultsOptions): ProjectTaskResultsPort {
  const confirmation = structuredClone(options.confirmation);
  if (!uuid(options.projectId) || !uuid(options.taskId) || !confirmation || confirmation.projectId !== options.projectId || !uuid(confirmation.id) || !Number.isSafeInteger(confirmation.planVersion) || confirmation.planVersion < 1 || !Array.isArray(confirmation.plan?.tasks) || !Array.isArray(confirmation.tasks)) fail('project_result_scope_unavailable');
  if (!['single', 'multi'].includes(confirmation.plan.taskMode) || !confirmation.plan.tasks.some(x => x.key === confirmation.plan.summaryTaskKey) || new Set(confirmation.tasks.map(x => x.taskKey)).size !== confirmation.tasks.length) fail('project_result_scope_unavailable');
  const planned = confirmation.plan.tasks.filter(x => x.selected || x.key === confirmation.plan.summaryTaskKey);
  const members = planned.map(task => {
    const receipt = confirmation.tasks.find(x => x.taskKey === task.key);
    if (receipt && task.taskId !== undefined && receipt.taskId !== task.taskId) fail('project_result_scope_unavailable');
    return receipt && uuid(receipt.taskId) && ['created', 'not-required'].includes(receipt.createStatus) ? { taskKey: task.key, taskId: receipt.taskId } : null;
  }).filter((x): x is { taskKey: string; taskId: string } => Boolean(x));
  if (!members.some(x => x.taskId === options.taskId) || new Set(members.map(x => x.taskId)).size !== members.length || new Set(members.map(x => x.taskKey)).size !== members.length || confirmation.plan.taskMode === 'single' && (members.length !== 1 || members[0]!.taskKey !== confirmation.plan.summaryTaskKey)) fail('project_result_scope_unavailable');
  const scope: ProjectTaskResultsScope = { projectId: options.projectId, taskId: options.taskId, confirmationId: confirmation.id, planVersion: confirmation.planVersion };
  const authorized = async (sourceTaskId: string, context: ProjectTaskResultsContext, relativePath?: string) => {
    check(context);
    try { await options.assertAuthorized?.({ projectId: scope.projectId, taskId: scope.taskId, sourceTaskId, ...(relativePath ? { relativePath } : {}) }, context); }
    catch { check(context); fail('project_result_permission_unavailable', 403); }
    check(context);
  };
  const owner = async (context: ProjectTaskResultsContext) => {
    check(context); const project = await options.projects.get(scope.projectId); check(context);
    const task = project.tasks.find(x => x.id === scope.taskId);
    if (project.archivedAt || !task || task.archivedAt) fail('project_result_owner_unavailable', 403);
    return project;
  };
  const sourceMetadata = (project: Awaited<ReturnType<ProjectTaskResultsOptions['projects']['get']>>, selectedTaskId?: string) => digest(JSON.stringify(members.filter(member => selectedTaskId === undefined || member.taskId === selectedTaskId).map(member => {
    const task = project.tasks.find(task => task.id === member.taskId);
    return [member.taskId, task?.updatedAt ?? null, task?.lastRun ?? null, task?.archivedAt ?? null, task?.sessionFile ?? null];
  })));
  async function catalog(context: ProjectTaskResultsContext, selectedTaskId: string | undefined, readOptions: ProjectTaskResultsSourceReadOptions) {
    const project = await owner(context), results: ProjectTaskResultDescriptor[] = [], limitations: { taskId: string; code: string }[] = [], ids = new Set<string>();
    for (const member of members.filter(x => selectedTaskId === undefined || x.taskId === selectedTaskId)) {
      const start = results.length;
      const task = project.tasks.find(x => x.id === member.taskId);
      if (!task) { limitations.push({ taskId: member.taskId, code: 'source_task_unavailable' }); continue; }
      try {
        await authorized(member.taskId, context);
        const bindings = await options.listBoundReports(scope.projectId, member.taskId, readOptions); check(context);
        if (!Array.isArray(bindings)) fail('project_result_binding_unavailable');
        for (const raw of bindings) {
          const value = binding(raw, scope.projectId, member.taskId); await authorized(member.taskId, context, value.relativePath);
          const id = resultId(scope, value); if (ids.has(id)) continue; ids.add(id);
          const sourceReceipt = confirmation.tasks.find(x => x.taskId === member.taskId);
          const confirmedRequestId = sourceReceipt?.startStatus === 'accepted' ? sourceReceipt.startRequestId : undefined;
          results.push({ ...value, id, confirmationId: scope.confirmationId, planVersion: scope.planVersion, taskKey: member.taskKey, taskName: task.name, taskState: task.archivedAt ? 'archived' : task.lastRun?.status ?? 'unknown', bindingState: 'saved-receipt-only', requestRelation: confirmedRequestId === value.requestId ? 'confirmed-request' : 'other-saved-request', ...(confirmedRequestId ? { confirmedRequestId } : {}), limitations: ['正文尚未提供，读取时核对准确内容与当前权限。', '保存快照不单独证明Task完成、项目综合完成或专业结论成立。'] });
        }
      } catch (error) {
        check(context);
        results.splice(start);
        limitations.push({ taskId: member.taskId, code: error instanceof ProjectTaskResultsError ? error.code : 'source_bindings_unavailable' });
      }
    }
    await owner(context);
    for (const taskId of new Set(results.map(x => x.taskId))) {
      try { for (const result of results.filter(x => x.taskId === taskId)) await authorized(taskId, context, result.relativePath); }
      catch (error) {
        check(context);
        for (let i = results.length - 1; i >= 0; i--) if (results[i]!.taskId === taskId) results.splice(i, 1);
        limitations.push({ taskId, code: error instanceof ProjectTaskResultsError ? error.code : 'source_bindings_unavailable' });
      }
    }
    return { results: results.sort((a, b) => a.id.localeCompare(b.id)), limitations, metadataVersion: sourceMetadata(project, selectedTaskId) };
  }
  return async (action, input, context) => {
    check(context);
    const readOptions: ProjectTaskResultsSourceReadOptions = { signal: context.signal, assertCurrent: () => check(context), budget: createNativeSnapshotReadBudget() };
    if (action === 'read') {
      if (!object(input) || Object.keys(input).some(x => !['id', 'offset', 'limit'].includes(x)) || typeof input.id !== 'string' || !/^[a-f0-9]{64}$/.test(input.id)) fail('invalid_project_result_arguments', 400);
      const offset = input.offset ?? 0, limit = input.limit ?? 8_000;
      if (!Number.isSafeInteger(offset) || Number(offset) < 0 || !Number.isSafeInteger(limit) || Number(limit) < 1 || Number(limit) > MAX_READ_UTF16) fail('invalid_project_result_range', 400);
      const start = Number(offset), requested = Number(limit), id = input.id, found = await catalog(context, undefined, readOptions), result = found.results.find(x => x.id === id);
      if (!result) fail('project_result_reference_unavailable', 404);
      await authorized(result.taskId, context, result.relativePath);
      let captured: Awaited<ReturnType<ProjectTaskResultsOptions['projects']['captureFeedbackFile']>>;
      try { captured = await options.projects.captureFeedbackFile(scope.projectId, result.relativePath, PROJECT_UPLOAD_MAX_BYTES); }
      catch { check(context); await authorized(result.taskId, context, result.relativePath); fail('project_result_unavailable'); }
      check(context); await owner(context); await authorized(result.taskId, context, result.relativePath);
      if (captured.sha256 !== result.sha256 || captured.bytes.length !== result.bytes || digest(captured.bytes) !== result.sha256) fail('project_result_changed');
      let text: string;
      try { text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(captured.bytes); if (text.includes('\0')) fail('project_result_requires_text'); }
      catch { fail('project_result_requires_text'); }
      const currentBindings = await options.listBoundReports(scope.projectId, result.taskId, readOptions); check(context);
      if (!currentBindings.some(x => { try { return resultId(scope, binding(x, scope.projectId, result.taskId)) === result.id; } catch { return false; } })) fail('project_result_reference_unavailable');
      await authorized(result.taskId, context, result.relativePath);
      if (start > text.length || boundary(text, start) !== start) fail('invalid_project_result_range', 400);
      const page = (end: number) => {
        const details: ProjectTaskResultsReadResult = { schemaVersion: 1, type: 'optracall.project-task-results', action: 'read', scope: { ...scope }, result: { ...result, limitations: ['本次仅提供所示范围，未提供部分不能视为已读。', '保存快照不单独证明Task完成、项目综合完成或专业结论成立。'] }, contentState: 'exact-bytes-verified', observedAt: captured.observedAt, rangeUtf16: { start, end, total: text.length }, complete: start === 0 && end === text.length, ...(end < text.length ? { nextOffset: end } : {}) };
        return { details, content: [{ type: 'text' as const, text: JSON.stringify({ ...details, text: text.slice(start, end) }) }] };
      };
      let end = boundary(text, Math.min(text.length, start + requested)), resultPage = page(end);
      if (resultPage.content[0].text.length > MAX_TOOL_UTF16) {
        let low = start, high = end;
        while (low < high) { const middle = Math.ceil((low + high) / 2), candidate = page(boundary(text, middle)); if (candidate.content[0].text.length <= MAX_TOOL_UTF16) low = middle; else high = middle - 1; }
        end = boundary(text, low); resultPage = page(end);
      }
      if (end === start && start < text.length) fail('project_result_range_too_small', 400);
      check(context); return resultPage;
    }
    if (action !== 'find') fail('invalid_project_result_action', 400);
    if (!object(input) || Object.keys(input).some(x => !['taskId', 'limit', 'cursor', 'waitMs'].includes(x))) fail('invalid_project_result_arguments', 400);
    if (input.taskId !== undefined && !members.some(x => x.taskId === input.taskId)) fail('project_result_scope_forbidden', 403);
    const limit = input.limit ?? 20, selectedTaskId = input.taskId as string | undefined;
    if (!Number.isSafeInteger(limit) || Number(limit) < 1 || Number(limit) > 40) fail('invalid_project_result_limit', 400);
    const waitMs = input.waitMs === undefined ? 0 : input.waitMs;
    if (!Number.isSafeInteger(waitMs) || Number(waitMs) < 0 || Number(waitMs) > 30_000) fail('invalid_project_result_wait', 400);
    const cursor = input.cursor;
    if (cursor !== undefined && (typeof cursor !== 'string' || !/^[A-Za-z0-9_-]{1,2048}$/.test(cursor))) fail('invalid_project_result_cursor', 400);
    let found = await catalog(context, selectedTaskId, readOptions), waited: ProjectTaskResultsFindResult['wait'];
    if (Number(waitMs) > 0) {
      const startedAt = performance.now(), deadline = startedAt + Number(waitMs);
      if (!found.results.length && cursor === undefined) {
        while (!found.results.length && performance.now() < deadline) {
          await delay(Math.min(100, Math.max(1, deadline - performance.now())), undefined, { signal: context.signal }); check(context);
          const current = await owner(context);
          if (sourceMetadata(current, selectedTaskId) !== found.metadataVersion) found = await catalog(context, selectedTaskId, readOptions);
        }
        // Saving a report need not update Task metadata. One final accurate
        // catalog check avoids claiming absence from an unchanged timestamp.
        if (!found.results.length) found = await catalog(context, selectedTaskId, readOptions);
        waited = { requestedMs: Number(waitMs), elapsedMs: Math.max(0, Math.ceil(performance.now() - startedAt)), outcome: found.results.length ? 'available' : 'timed-out' };
      } else waited = { requestedMs: Number(waitMs), elapsedMs: 0, outcome: 'not-needed' };
    }
    const inventoryHash = digest(JSON.stringify([selectedTaskId ?? null, found.results.map(x => x.id), found.limitations])), scopeHash = digest(JSON.stringify(scope));
    let offset = 0;
    if (cursor !== undefined) {
      let parsed: unknown;
      try { parsed = JSON.parse(Buffer.from(cursor as string, 'base64url').toString('utf8')); } catch { fail('invalid_project_result_cursor', 400); }
      if (!object(parsed) || Object.keys(parsed).sort().join(',') !== 'inventoryHash,offset,scopeHash' || !Number.isSafeInteger(parsed.offset) || Number(parsed.offset) < 0 || Number(parsed.offset) > found.results.length) fail('invalid_project_result_cursor', 400);
      if (parsed.scopeHash !== scopeHash || parsed.inventoryHash !== inventoryHash) fail('project_result_cursor_stale');
      offset = Number(parsed.offset);
    }
    const limitations: ProjectTaskResultsFindResult['limitations'] = found.limitations.slice(0, 128);
    if (found.limitations.length > limitations.length) limitations.push({ taskId: scope.taskId, code: 'additional_source_limits_not_listed' });
    if (waited?.outcome === 'timed-out') limitations.push({ taskId: selectedTaskId ?? scope.taskId, code: 'bounded_wait_no_result', message: '本次有限等候范围未取得可供读取的准确绑定成果；不据此断言来源Task没有成果、已经结束或专业判断成立。' });
    const results = found.results.slice(offset, offset + Number(limit));
    const page = () => {
      const hasMore = offset + results.length < found.results.length;
      const details: ProjectTaskResultsFindResult = { schemaVersion: 1, type: 'optracall.project-task-results', action: 'find', scope: { ...scope }, results: [...results], limitations, hasMore, ...(waited ? { wait: waited } : {}), ...(hasMore ? { cursor: Buffer.from(JSON.stringify({ scopeHash, inventoryHash, offset: offset + results.length })).toString('base64url') } : {}) };
      return { content: [{ type: 'text' as const, text: JSON.stringify(details) }], details };
    };
    let resultPage = page();
    while (resultPage.content[0].text.length > MAX_TOOL_UTF16 && results.length > 1) { results.pop(); resultPage = page(); }
    if (resultPage.content[0].text.length > MAX_TOOL_UTF16) fail('project_result_payload_limit');
    check(context); return resultPage;
  };
}
