import { createHash } from 'node:crypto';
import type { RuntimeModelConfiguration } from './config-store.ts';
import type { DbLinkEngine, DbLinkModelExport, DbLinkScope, DbLinkSource } from './db-link-types.ts';
import { canonical } from './project-data-context-io.ts';

/** The same outlet identity used by the original DB tools; no credential is included. */
export const dbLinkModelOutlet = (configuration: Pick<RuntimeModelConfiguration, 'id' | 'provider' | 'api' | 'baseUrl' | 'model'>): string => 'outlet:' + createHash('sha256').update(JSON.stringify([configuration.id, configuration.provider, configuration.api, new URL(configuration.baseUrl).href, configuration.model])).digest('hex');

export type DbLinkPlanningSource = {
  id: string; title: string; engine: DbLinkEngine; version: string; sha256: string; permissionRef: string;
  state: 'available' | 'revoked' | 'configuration-changed' | 'excluded'; enabled: boolean;
  scope?: DbLinkScope; queryQualified: boolean; limitations: string[];
  modelExport: Omit<DbLinkModelExport, 'targets'>; taskId?: string;
};
export type DbLinkPlanningOptions = { taskId?: string; modelOutlet?: string };

/** A reference records source selection, never a new authorization. */
export function dbLinkPlanningPermission(source: DbLinkSource): string {
  const scope = { ...source.scope, objects: [...source.scope.objects].sort() };
  const modelExport = { ...source.modelExport, targets: [...source.modelExport.targets].sort() };
  return `db-grant:${source.grant.id}:${createHash('sha256').update(canonical({ scope, modelExport })).digest('hex')}`;
}

/** Strict metadata projection of already stored authority. Never reads a DB or result. */
export function projectDbLinkPlanningSources(projectSources: readonly DbLinkSource[], taskSources: readonly DbLinkSource[] | undefined, options: DbLinkPlanningOptions): DbLinkPlanningSource[] {
  return projectSources.flatMap(project => {
    const effective = options.taskId ? taskSources?.find(source => source.connection.id === project.connection.id) : project;
    const source = effective ?? project;
    // A source blocked from this model's original outlet is absent, including its name.
    if (options.modelOutlet !== undefined && (project.grant.revokedAt || !source.modelExport.targets.includes(options.modelOutlet))) return [];
    const state: DbLinkPlanningSource['state'] = project.grant.revokedAt ? 'revoked' : project.configurationChanged ? 'configuration-changed' : options.taskId && !effective ? 'excluded' : 'available';
    const { structure, comments, queryText, results } = source.modelExport;
    return [{
      id: `db-link:${source.connection.id}`, title: source.connection.name, engine: source.connection.engine,
      version: String(source.connection.revision), sha256: source.connection.fingerprint, permissionRef: dbLinkPlanningPermission(source),
      state, enabled: state === 'available', ...(options.taskId ? { taskId: options.taskId } : {}),
      ...(state === 'available' && (options.modelOutlet === undefined || structure) ? { scope: structuredClone(source.scope) } : {}),
      queryQualified: source.connection.observation.queryQualified, limitations: [...source.connection.observation.limitations],
      modelExport: { structure, comments, queryText, results },
    }];
  });
}
