import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { access, lstat, open, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import type { SemanticGraphBinding } from './semantic-graph-service.ts';

export type SemanticGraphConfigurationSummary = {
  enabled: boolean;
  configurationSha256: string;
  assets: ReadonlyArray<{ projectId: string; snapshotId: string }>;
};
export type SemanticGraphConfiguration = {
  configuration: SemanticGraphConfigurationSummary;
  bindingFor: (projectId: string, taskId: string) => SemanticGraphBinding | undefined;
  /** Host-only accepted interpreter; never part of the public health summary. */
  readonly python?: string;
};
export class SemanticGraphConfigurationError extends Error {
  readonly code: string;
  constructor(code: string) { super(code); this.code = code; }
}
function fail(code = 'semantic_configuration_invalid'): never { throw new SemanticGraphConfigurationError(code); }
const object = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === 'object' && !Array.isArray(value));
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const absolute = (value: unknown): value is string => typeof value === 'string' && path.isAbsolute(value) && !value.includes('\0');
const contains = (parent: string, child: string) => { const relative = path.relative(parent, child); return !relative || (relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative)); };
async function directory(value: unknown): Promise<string> {
  if (!absolute(value)) fail('semantic_configuration_unsafe_path');
  try {
    const info = await lstat(value);
    if (!info.isDirectory() || info.isSymbolicLink()) fail('semantic_configuration_unsafe_path');
    return await realpath(value);
  } catch (error) {
    if (error instanceof SemanticGraphConfigurationError) throw error;
    fail('semantic_configuration_unavailable');
  }
}

/** Trusted Host startup input only; no worker, model, or source Store is opened. */
export async function loadSemanticGraphConfiguration(options: {
  file?: string; codeRoot: string; dataRoot: string; projectsRoot: string;
}): Promise<SemanticGraphConfiguration | undefined> {
  if (options.file === undefined) return undefined;
  if (!path.isAbsolute(options.file) || options.file.includes('\0')) fail('semantic_configuration_unsafe_path');
  let bytes: Buffer;
  let handle;
  try {
    handle = await open(options.file, constants.O_RDONLY | constants.O_NOFOLLOW);
    const stat = await handle.stat();
    if (!stat.isFile() || stat.nlink !== 1 || stat.size > 65_536) fail('semantic_configuration_unsafe_path');
    bytes = await handle.readFile();
    if (bytes.length !== stat.size || bytes.length > 65_536) fail('semantic_configuration_invalid');
  } catch (error) {
    if (error instanceof SemanticGraphConfigurationError) throw error;
    fail('semantic_configuration_unavailable');
  } finally { await handle?.close(); }
  let value: unknown;
  try { value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
  catch { fail(); }
  if (!object(value) || Object.keys(value).some(key => !['schemaVersion', 'enabled', 'python', 'projects'].includes(key)) || value.schemaVersion !== 1 || typeof value.enabled !== 'boolean') fail();
  if (value.python !== undefined && typeof value.python !== 'string') fail();
  const inputProjects = value.projects;
  if (inputProjects !== undefined && !Array.isArray(inputProjects)) fail();
  const projects: { projectId: string; runRoot: string; snapshotId: string }[] = [], seen = new Set<string>();
  for (const project of inputProjects ?? []) {
    if (!object(project) || Object.keys(project).some(key => !['projectId', 'runRoot', 'snapshotId'].includes(key)) || typeof project.projectId !== 'string' || !uuid.test(project.projectId) || typeof project.snapshotId !== 'string' || !uuid.test(project.snapshotId) || typeof project.runRoot !== 'string' || seen.has(project.projectId)) fail();
    seen.add(project.projectId); projects.push({ projectId: project.projectId, runRoot: project.runRoot, snapshotId: project.snapshotId });
  }
  const configurationSha256 = createHash('sha256').update(bytes).digest('hex');
  if (!value.enabled) {
    const configuration = Object.freeze({ enabled: false, configurationSha256, assets: Object.freeze([]) });
    return Object.freeze({ configuration, bindingFor: () => undefined });
  }
  if (typeof value.python !== 'string' || !projects.length) fail();
  const roots = await Promise.all([options.codeRoot, options.dataRoot, options.projectsRoot].map(directory));
  if (roots.some((root, index) => roots.some((other, otherIndex) => index !== otherIndex && contains(root, other)))) fail('semantic_configuration_unsafe_path');
  if (!absolute(value.python)) fail('semantic_configuration_unsafe_path');
  try {
    const resolved = await realpath(value.python), info = await stat(resolved);
    if (!info.isFile() || roots.some(root => contains(root, resolved))) fail('semantic_configuration_unsafe_path');
    await access(value.python, constants.X_OK);
  } catch (error) {
    if (error instanceof SemanticGraphConfigurationError) throw error;
    fail('semantic_configuration_unavailable');
  }
  const bindings = new Map<string, SemanticGraphBinding>();
  const assets: { projectId: string; snapshotId: string }[] = [];
  for (const project of projects) {
    const runRoot = await directory(project.runRoot);
    if (roots.some(root => contains(root, runRoot) || contains(runRoot, root))) fail('semantic_configuration_unsafe_path');
    const snapshots = await directory(path.join(project.runRoot, 'snapshots'));
    const snapshot = await directory(path.join(project.runRoot, 'snapshots', project.snapshotId));
    if (!contains(runRoot, snapshots) || !contains(snapshots, snapshot)) fail('semantic_configuration_unsafe_path');
    bindings.set(project.projectId, Object.freeze({ runRoot: project.runRoot, snapshotId: project.snapshotId, python: value.python, codeRoot: options.codeRoot }));
    assets.push(Object.freeze({ projectId: project.projectId, snapshotId: project.snapshotId }));
  }
  const configuration = Object.freeze({ enabled: true, configurationSha256, assets: Object.freeze(assets) });
  return Object.freeze({ configuration, python: value.python, bindingFor: (projectId: string, taskId: string) => uuid.test(taskId) ? bindings.get(projectId) : undefined });
}
