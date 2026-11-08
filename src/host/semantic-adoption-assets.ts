import { prepareSemanticAssetStores, type TrialAssetOptions, type SemanticAssetContinuation } from './semantic-trial-assets.ts';
import type { ProjectConfiguration } from './project-store.ts';
export { SemanticAssetPreparationError } from './semantic-trial-assets.ts';
export type { SemanticAssetContinuation } from './semantic-trial-assets.ts';

export type SemanticAdoptionAssetOptions = Omit<TrialAssetOptions, 'configuration'> & {
  configurationRef: { id: string; revision: number };
  configurationSnapshot: (ref: { id: string; revision: number }) => ProjectConfiguration | null | Promise<ProjectConfiguration | null>;
  continuation?: SemanticAssetContinuation;
};

/** Explicit offline maintenance only; never a model tool or automatic migration. */
export async function prepareSemanticAdoptionAssets(options: SemanticAdoptionAssetOptions) {
  const configuration = await options.configurationSnapshot(options.configurationRef);
  if (!configuration || configuration.id !== options.configurationRef.id || configuration.revision !== options.configurationRef.revision) throw new Error('semantic_adoption_configuration_unavailable');
  const { id, revision, provider, model, name, baseUrl, api, thinkingLevel } = configuration;
  const publicConfiguration: ProjectConfiguration = { id, revision, provider, model, name, baseUrl, ...(api === undefined ? {} : { api }), ...(thinkingLevel === undefined ? {} : { thinkingLevel }) };
  const result = await prepareSemanticAssetStores({ ...options, configuration: publicConfiguration }, 'adoption', options.continuation);
  if (!result.continuation) throw new Error('semantic_adoption_continuation_missing');
  return { ...result, continuation: result.continuation };
}
