import path from 'node:path';
import { createHost } from './server.ts';
import type { SemanticGraphBinding } from './semantic-graph-service.ts';
import type { TaskRecord } from './project-store.ts';

/** Engineering-only S5 entry. It never changes the normal Host startup path. */
export async function startSemanticTrialHost(options: {
  codeRoot: string; dataRoot: string; projectsRoot: string; instanceId: string;
  uiPort: number; transportVersion: string; port?: number;
  graphBinding?: SemanticGraphBinding;
}) {
  const { codeRoot, dataRoot, projectsRoot } = options;
  const roots = [codeRoot, dataRoot, projectsRoot];
  if (roots.some(root => !root || !path.isAbsolute(root))) throw new Error('S5 requires explicit absolute roots.');
  const contains = (parent: string, child: string) => { const relative = path.relative(path.resolve(parent), path.resolve(child)); return !relative || !relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative); };
  if (roots.some((root, index) => roots.some((other, otherIndex) => index !== otherIndex && contains(root, other)))) throw new Error('S5 code and Store roots must not overlap.');
  if (!Number.isInteger(options.uiPort) || options.uiPort < 1 || options.uiPort > 65535 || !Number.isInteger(options.port ?? 0) || (options.port ?? 0) < 0 || (options.port ?? 0) > 65535) throw new Error('Invalid S5 loopback port.');
  if (!/^[a-f0-9]{8}-[a-f0-9-]{27}$/.test(options.instanceId)) throw new Error('Invalid S5 instance identity.');
  if (options.graphBinding && ([options.graphBinding.runRoot, options.graphBinding.python, options.graphBinding.codeRoot].some(root => !root || !path.isAbsolute(root)) || options.graphBinding.codeRoot !== codeRoot || !/^[a-f0-9-]{36}$/.test(options.graphBinding.snapshotId))) throw new Error('S5 requires an explicit pinned graph binding.');
  const binding = options.graphBinding ? Object.freeze({ ...options.graphBinding }) : undefined;
  // This is only the trial's exact owner selection, never a Resource state map.
  // Old tasks and task POSTs outside createTask receive no graph capability.
  const taskBindings = new Map<string, SemanticGraphBinding>();
  const host = createHost({ cwd: codeRoot, dataRoot, projectsRoot, instanceId: options.instanceId, uiPorts: [options.uiPort], transportVersion: options.transportVersion,
    ...(binding ? { semanticGraph: { bindingFor: (projectId: string, taskId: string) => taskBindings.get(`${projectId}/${taskId}`) } } : {}) });
  let closePromise: Promise<void> | undefined;
  // Do not wrap this in async: every caller receives the original close promise,
  // including its failure. Only the original Host owns resource retirement.
  const close = () => closePromise ??= host.close();
  try {
    await host.ready;
    await new Promise<void>((resolve, reject) => {
      const failed = (error: Error) => reject(error);
      host.server.once('error', failed);
      host.server.listen(options.port ?? 0, '127.0.0.1', () => { host.server.off('error', failed); resolve(); });
    });
  } catch (error) {
    try { await close(); } catch (closeError) { throw new AggregateError([error, closeError], 's5_host_start_and_close_failed'); }
    throw error;
  }
  const address = host.server.address();
  if (!address || typeof address === 'string') { await close(); throw new Error('S5 Host loopback address unavailable.'); }
  const baseUrl = `http://127.0.0.1:${address.port}`;
  const headers = { 'content-type': 'application/json', 'x-optracall-client': '1', origin: `http://127.0.0.1:${options.uiPort}` };
  const request = (route: string, method = 'GET', body?: unknown) => {
    if (!route.startsWith('/') || route.startsWith('//')) throw new Error('S5 request requires an original Host route.');
    return fetch(baseUrl + route, { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  };
  const createTask = async (projectId: string, input: { name: string; configurationId?: string }): Promise<TaskRecord> => {
    if (!/^[a-f0-9-]{36}$/.test(projectId)) throw new Error('Invalid S5 project identity.');
    const projectResponse = await request(`/api/projects/${projectId}`);
    if (projectResponse.status !== 200) throw new Error(`S5 project read failed (${projectResponse.status}).`);
    const { project } = await projectResponse.json();
    if (!Array.isArray(project?.tasks) || project.tasks.length !== 0) throw new Error('S5 requires the first task of a taskless prepared project.');
    const response = await request(`/api/projects/${projectId}/tasks`, 'POST', input);
    if (response.status !== 201) throw new Error(`S5 original task creation failed (${response.status}).`);
    const { task } = await response.json();
    if (!task || typeof task.id !== 'string' || !/^[a-f0-9-]{36}$/.test(task.id)) throw new Error('S5 original task identity unavailable.');
    // The original POST has already called registerFresh. Bind before handing
    // its real identity to the engineering caller, hence before open/messages.
    if (binding) taskBindings.set(`${projectId}/${task.id}`, binding);
    return task as TaskRecord;
  };
  return { baseUrl, port: address.port, instanceId: options.instanceId, request, createTask, close };
}
