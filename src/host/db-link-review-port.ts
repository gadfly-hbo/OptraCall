import type { ProjectStore } from './project-store.ts';
import type { RuntimeModelConfiguration } from './config-store.ts';
import type { DbLinkResults } from './db-link-results.ts';
import type { FixedReviewBundleContext, FixedReviewBundlePort } from './report-calculation-materials.ts';
import type { DbReviewBundleOwner } from './db-link-review-bundles.ts';
import { createDbLinkReviewBundles } from './db-link-review-bundles.ts';
import { dbLinkModelOutlet } from './db-link-host.ts';

export type DbLinkReviewPortOptions = {
  privateRoot: string; projects: ProjectStore;
  configurationSnapshot(id: string, revision: number): Readonly<RuntimeModelConfiguration> | undefined;
  materialSource(projectId: string, taskId: string, resultId: string, configuration: RuntimeModelConfiguration, context: { signal?: AbortSignal; assertCurrent?(): void }): Promise<Awaited<ReturnType<DbLinkResults['materialFiles']>>>;
  isClosing(): boolean;
};
export function createDbLinkReviewPort(options: DbLinkReviewPortOptions): FixedReviewBundlePort {
  const fail = (code: string): never => { throw Object.assign(new Error(code), { code }); };
  function scope(owner: DbReviewBundleOwner, context: FixedReviewBundleContext) {
    const configuration = options.configurationSnapshot(context.configuration.id, context.configuration.revision);
    if (!configuration || configuration.id !== context.configuration.id || configuration.revision !== context.configuration.revision) return fail('configuration_changed');
    const check = () => { context.signal.throwIfAborted(); context.assertCurrent(); if (options.isClosing()) fail('host_closing'); };
    const materialSource = (resultId: string) => { check(); return options.materialSource(owner.projectId, owner.taskId, resultId, configuration, context); };
    const bundles = createDbLinkReviewBundles({ privateRoot: options.privateRoot, projects: options.projects,
      results: { materialFiles: async (sourceOwner, resultId) => {
        if (sourceOwner.projectId !== owner.projectId || sourceOwner.taskId !== owner.taskId) fail('db_review_foreign_source');
        return materialSource(resultId);
      } },
      assertOwner: async (requested, mode) => {
        check();
        if (['projectId', 'taskId', 'requestId', 'reviewId'].some(key => requested[key as keyof DbReviewBundleOwner] !== owner[key as keyof DbReviewBundleOwner])) fail('db_review_foreign_reference');
        const project = await options.projects.get(owner.projectId); check();
        await options.projects.getTask(owner.projectId, owner.taskId); check();
        if (mode === 'freeze' && project.archivedAt !== null) fail('project_archived');
      },
    });
    const authorize = async (ref: Parameters<typeof bundles.verify>[1]) => {
      const source = await bundles.authorizationSource(owner, ref, context); check();
      const current = options.configurationSnapshot(context.configuration.id, context.configuration.revision) ?? fail('configuration_changed');
      if (current.id !== configuration.id || current.revision !== configuration.revision) fail('configuration_changed');
      if (!source.modelExport.results || !source.modelExport.targets.includes(dbLinkModelOutlet(current))) fail('db_material_export_not_authorized');
      check();
    };
    return { bundles, authorize, materialSource, check };
  }
  const port: FixedReviewBundlePort = {
    async freeze(owner, input, context) {
      const current = scope(owner, context);
      const fixed = await current.bundles.freeze(owner, input, { ...context, sourceOwner: async () => (await current.materialSource(input.selector.slice('db-result:'.length))).receipt.owner });
      await current.authorize(fixed.ref); current.check();
      return { ref: fixed.ref, neutralReceipt: fixed.neutralReceipt, logicalItems: fixed.logicalItems, assertUnchanged: () => port.verify(owner, fixed.ref, context) };
    },
    async read(owner, ref, input, context) {
      const current = scope(owner, context); await current.authorize(ref);
      const result = await current.bundles.read(owner, ref, { ...input, maxBytes: Math.min(input.maxBytes ?? 20_000, 20_000), stage: 'cold', section: 'data' }, context);
      await current.authorize(ref); current.check(); return result;
    },
    async verify(owner, ref, context) { await scope(owner, context).authorize(ref); },
  };
  return port;
}
