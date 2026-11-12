import path from 'node:path';
import { createHash } from 'node:crypto';
import { readProjectFileText, writeProjectFileText, type ProjectFilesPort } from '../agent/project-files.ts';
import type { ProjectStore } from './project-store.ts';
import type { EnterpriseMaterialsStore } from './enterprise-materials-store.ts';
import { PROJECT_UPLOAD_MAX_BYTES } from './project-upload.ts';

function filename(value: unknown): value is string {
  return typeof value === 'string' && Boolean(value.trim()) && value !== '.' && value !== '..' &&
    !/[\\/\u0000-\u001f\u007f]/u.test(value) && Buffer.byteLength(value, 'utf8') <= 255;
}
function fault(code: string): never { throw Object.assign(new Error(code), { code }); }

export function createProjectFilesPort(options: {
  projects: ProjectStore; enterpriseMaterials: EnterpriseMaterialsStore; projectId: string; taskId: string; assertOwner(): Promise<void>;
}): ProjectFilesPort {
  return async (action, input, context) => {
    const check = () => { context.signal.throwIfAborted(); context.assertCurrent(); };
    const owner = async () => {
      check(); await options.assertOwner();
      const project = await options.projects.get(options.projectId);
      if (project.archivedAt !== null) fault('project_archived');
      if (!project.tasks.some(task => task.id === options.taskId)) fault('task_not_found');
      check(); return project;
    };
    const project = await owner();
    const identity = { projectId: project.id, taskId: options.taskId, requestId: context.requestId, sessionId: context.sessionId, toolCallId: context.toolCallId };
    if (!input || typeof input !== 'object' || Array.isArray(input)) fault('invalid_project_file_arguments');
    if (action === 'write-report') {
      if (Object.keys(input).length !== 2 || !filename(input.filename) || typeof input.content !== 'string') fault('invalid_report_arguments');
      const { filename: name, content } = input;
      const receipt = await writeProjectFileText({ content,
        signal: context.signal, toolCallId: context.toolCallId,
        write: () => options.projects.writeBoundReport(project.id, options.taskId, name, content, context) });
      check();
      return { content: [{ type: 'text', text: `报告已保存到 ${receipt.path}` }], details: { schemaVersion: 1, type: 'optracall.project-report-write', ...receipt } };
    }
    if (action === 'read-catalog') {
      if (Object.keys(input).length !== 0) fault('invalid_catalog_arguments');
      const catalog = options.enterpriseMaterials.readEnabledCatalog();
      const result = await readProjectFileText({ bytes: catalog.bytes, signal: context.signal, toolCallId: context.toolCallId });
      await owner();
      const current = options.enterpriseMaterials.readEnabledCatalog();
      if (current.storeId !== catalog.storeId || !current.bytes.equals(catalog.bytes)) fault('enterprise_storage_changed');
      const content = result.details.truncation ? result.content.map(part => ({ ...part,
        text: part.text.replace(/Use offset=(\d+) to continue\./u, 'Use the ordinary authorized read tool with offset=$1 to continue.'),
      })) : result.content;
      return { content, details: { ...result.details, type: 'optracall.project-catalog-read', ...identity,
        storeId: catalog.storeId, path: catalog.path, sha256: createHash('sha256').update(catalog.bytes).digest('hex'), bytes: catalog.bytes.length } };
    }
    if (action !== 'read-input') fault('invalid_project_file_action');
    if (Object.keys(input).some(key => !['filename', 'offset', 'limit'].includes(key)) || !filename(input.filename)) fault('invalid_input_filename');
    for (const key of ['offset', 'limit']) if (input[key] !== undefined && (!Number.isSafeInteger(input[key]) || Number(input[key]) < 1)) fault('invalid_input_pagination');
    const relativePath = '020_clean/' + input.filename;
    const captured = await options.projects.captureFeedbackFile(options.projectId, relativePath, PROJECT_UPLOAD_MAX_BYTES);
    try { new TextDecoder('utf-8', { fatal: true }).decode(captured.bytes); } catch { fault('project_file_requires_text'); }
    if (captured.bytes.includes(0)) fault('project_file_requires_text');
    check();
    const target = path.join(project.rootPath, relativePath);
    const result = await readProjectFileText({ bytes: captured.bytes, signal: context.signal,
      toolCallId: context.toolCallId, offset: input.offset as number | undefined, limit: input.limit as number | undefined });
    await owner();
    return { content: result.content, details: { ...result.details, type: 'optracall.project-file-read', ...identity,
      path: target, relativePath, sha256: captured.sha256, bytes: captured.bytes.length, observedAt: captured.observedAt } };
  };
}
