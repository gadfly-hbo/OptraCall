import path from 'node:path';
import { createDeckStore } from '../../extensions/business-plugins/ppt-refiner/storage/deck-store.ts';
import { modelSupportsImages } from '../agent/runtime.ts';
import type { ProjectStore, ProjectRecord } from './project-store.ts';

export class RefinerAccessFault extends Error {
  readonly code: string;
  readonly status: number;
  constructor(code: string, status: number, message: string) { super(message); this.code = code; this.status = status; }
}

export type RefinerAccess = {
  projectId?: string; projectName?: string; readOnly: boolean; reason?: string;
  configuration?: { id: string; revision: number }; imageInputSupported: boolean; exportDirectory?: string;
};
const fail = (code: string, status: number, message: string): never => { throw new RefinerAccessFault(code, status, message); };
const reportRelative = (value: unknown, extension?: string): string => {
  if (typeof value !== 'string' || !value.startsWith('060_reports/') || value.includes('\\') || path.posix.normalize(value) !== value || value.includes('\0')
    || extension && !value.toLowerCase().endsWith(extension)) return fail('path_not_allowed', 400, '请选择本项目报告目录中的候选版与 Markdown 报告。');
  return value;
};

/** Resolve existing ProjectStore authority; never create a project identity from a client path. */
export function createPptRefinerAccess(options: { projects: ProjectStore; deckRoot: string; assertActive(project: ProjectRecord): void }) {
  const fixedConfiguration = (project: ProjectRecord) => ({ id: project.configuration.id, revision: project.configuration.revision });
  const sourceProject = async (report: string): Promise<ProjectRecord | undefined> => {
    for (const project of await options.projects.list()) {
      const relative = path.relative(project.rootPath, report).split(path.sep).join('/');
      try {
        reportRelative(relative, '.md');
        await options.projects.observeFile(project.id, relative);
        return project;
      } catch {}
    }
    return undefined;
  };
  async function read(deckId: string): Promise<RefinerAccess> {
    const meta = createDeckStore(path.join(options.deckRoot, deckId)).meta();
    const project = await sourceProject(meta.sourceReport);
    if (!project) return { readOnly: true, reason: 'deck_project_unresolved', imageInputSupported: false };
    const configuration = fixedConfiguration(project);
    const common = { projectId: project.id, projectName: project.name, configuration, exportDirectory: path.join(project.rootPath, '060_reports'), imageInputSupported: await modelSupportsImages(project.configuration) };
    if (meta.configuration && (meta.configuration.id !== configuration.id || meta.configuration.revision !== configuration.revision)) return { ...common, readOnly: true, reason: 'deck_configuration_mismatch' };
    if (project.archivedAt !== null) return { ...common, readOnly: true, reason: 'project_archived' };
    return { ...common, readOnly: false };
  }
  return {
    read,
    async resolveOwner(deckId: string) {
      const access = await read(deckId);
      if (access.readOnly || !access.projectId || !access.configuration) return fail(access.reason ?? 'deck_project_unresolved', 409, '此候选版的项目或固定模型归属尚未核定，当前保留只读。');
      const project = await options.projects.get(access.projectId);
      options.assertActive(project);
      return { projectId: access.projectId, configuration: access.configuration };
    },
    async create(input: Record<string, unknown>) {
      if (typeof input.projectId !== 'string' || input.configuration !== undefined) return fail('invalid_project', 400, '请从项目报告中打开候选版，模型由项目配置绑定。');
      const project = await options.projects.get(input.projectId);
      options.assertActive(project);
      const source = reportRelative(input.sourcePptx, '.pptx'), report = reportRelative(input.reportPath, '.md');
      try { await options.projects.observeFile(project.id, source); await options.projects.observeFile(project.id, report); }
      catch { return fail('path_not_allowed', 400, '候选版或 Markdown 报告不存在，或不是本项目的普通报告文件。'); }
      return { sourcePptx: path.join(project.rootPath, source), reportPath: path.join(project.rootPath, report), configuration: fixedConfiguration(project) };
    },
    async belongsToProject(deckId: string, projectId: string) { return (await read(deckId)).projectId === projectId; },
  };
}
