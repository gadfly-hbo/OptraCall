import type { IncomingMessage } from 'node:http';
import path from 'node:path';
import { SimLabService } from '../service/simlab-service.ts';
import { EngineFault } from '../kernel/engine.ts';
import { StoreFault } from '../storage/store.ts';
import { snapshotReport } from '../service/evidence-report.ts';

class ApiFault extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string, message: string) { super(message); this.status = status; this.code = code; }
}

export type SimLabRoutesOptions = {
  dataRoot: string;
  projectExists: (projectId: string) => Promise<boolean>;
  projectArchived: (projectId: string) => Promise<boolean>;
  readBody: (request: IncomingMessage) => Promise<Record<string, unknown>>;
  saveReport?: (projectId: string, name: string, text: string) => Promise<unknown>;
};

const projectIdPattern = /^[a-f0-9-]{36}$/;
const services = new Map<string, SimLabService>();

function serviceFor(options: SimLabRoutesOptions, projectId: string): SimLabService {
  const key = `${options.dataRoot}::${projectId}`;
  let service = services.get(key);
  if (!service) {
    service = new SimLabService(path.join(options.dataRoot, 'sim-lab', 'projects', projectId), projectId);
    services.set(key, service);
  }
  return service;
}

function httpStatus(code: string): number {
  if (code.endsWith('_not_found')) return 404;
  if (['revision_conflict', 'record_conflict', 'stale_run', 'project_archived', 'store_busy'].includes(code)) return 409;
  if (code === 'conservation_failed') return 422;
  return 400;
}

/** Host 拥有传输与项目校验；插件不监听端口。归档项目只读。 */
export function createSimLabRoutes(options: SimLabRoutesOptions) {
  async function writableProject(projectId: string): Promise<SimLabService> {
    if (!projectIdPattern.test(projectId) || !(await options.projectExists(projectId))) throw new ApiFault(404, 'project_not_found', '项目不存在或不可用。');
    if (await options.projectArchived(projectId)) throw new ApiFault(409, 'project_archived', '归档项目为只读，恢复项目后再操作。');
    return serviceFor(options, projectId);
  }
  async function readableProject(projectId: string): Promise<SimLabService> {
    if (!projectIdPattern.test(projectId) || !(await options.projectExists(projectId))) throw new ApiFault(404, 'project_not_found', '项目不存在或不可用。');
    return serviceFor(options, projectId);
  }

  return async function simLabRoutes(request: IncomingMessage, url: URL): Promise<{ status: number; value: unknown } | undefined> {
    if (!url.pathname.startsWith('/api/simlab/')) return undefined;
    const segments = url.pathname.slice('/api/simlab/'.length).split('/');
    try {
      if (request.method === 'GET' && segments[0] === 'inspect' && segments.length === 1) {
        return { status: 200, value: new SimLabService(path.join(options.dataRoot, 'sim-lab', 'inspect'), '').inspect() };
      }
      if (segments[0] !== 'projects' || segments.length < 3) throw new ApiFault(404, 'not_found', '未知推演接口。');
      const projectId = segments[1]!;
      const [, , collection, id, action] = segments;

      if (collection === 'drafts' && !id) {
        if (request.method === 'GET') return { status: 200, value: { drafts: await (await readableProject(projectId)).listDrafts() } };
        if (request.method === 'POST') {
          const input = await options.readBody(request);
          return { status: 201, value: { draft: await (await writableProject(projectId)).createDraft({ name: input.name, parameters: input.parameters, variants: input.variants }) } };
        }
      }
      if (collection === 'drafts' && id && !action) {
        if (request.method === 'GET') return { status: 200, value: { draft: await (await readableProject(projectId)).getDraft(id) } };
        if (request.method === 'PATCH') {
          const input = await options.readBody(request);
          return { status: 200, value: { draft: await (await writableProject(projectId)).updateDraft(id, input, Number(input.expectedRevision)) } };
        }
      }
      if (collection === 'drafts' && id && action === 'runs') {
        if (request.method === 'POST') return { status: 201, value: { run: await (await writableProject(projectId)).runDraft(id) } };
        if (request.method === 'GET') return { status: 200, value: { runs: await (await readableProject(projectId)).listRuns(id) } };
      }
      if (collection === 'drafts' && id && action === 'stress' && request.method === 'POST') {
        const input = await options.readBody(request);
        return { status: 200, value: { rows: await (await writableProject(projectId)).stress(id, { perturbation: (input.perturbation ?? {}) as never, variantIds: input.variantIds }) } };
      }
      if (collection === 'drafts' && id && action === 'freeze' && request.method === 'POST') {
        const input = await options.readBody(request);
        const service = await writableProject(projectId);
        const snapshot = await service.freeze(id, { runId: String(input.runId ?? ''), variantId: String(input.variantId ?? ''), expectedRevision: Number(input.expectedRevision), name: input.name });
        return { status: 201, value: { snapshot } };
      }
      if (collection === 'runs' && id && !action && request.method === 'GET') {
        return { status: 200, value: { run: await (await readableProject(projectId)).getRun(id) } };
      }
      if (collection === 'snapshots' && !id && request.method === 'GET') {
        return { status: 200, value: { snapshots: await (await readableProject(projectId)).listSnapshots() } };
      }
      if (collection === 'snapshots' && id && !action && request.method === 'GET') {
        return { status: 200, value: { snapshot: await (await readableProject(projectId)).getSnapshot(id) } };
      }
      if (collection === 'snapshots' && id && action === 'export' && request.method === 'POST') {
        await options.readBody(request);
        const service = await writableProject(projectId), snapshot = await service.getSnapshot(id);
        if (!options.saveReport) throw new ApiFault(503, 'export_unavailable', '当前Host未提供证据导出。');
        const { model: _readModel, ...frozen } = snapshot;
        const file = await options.saveReport(projectId, `simlab-${snapshot.id}-${snapshot.inputHash.slice(0, 12)}.md`, snapshotReport(frozen));
        return { status: 201, value: { file, snapshotId: snapshot.id } };
      }
      throw new ApiFault(404, 'not_found', '未知推演接口。');
    } catch (error) {
      if (error instanceof ApiFault) return { status: error.status, value: { code: error.code, message: error.message } };
      if (error instanceof EngineFault || error instanceof StoreFault) return { status: httpStatus(error.code), value: { code: error.code, message: error.message } };
      throw error;
    }
  };
}
