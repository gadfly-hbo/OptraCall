import { Type, type Static } from 'typebox';
import type { SemanticContextCallContext } from './semantic-context.ts';

export const STUDIO_ACTIONS = ['catalog', 'read', 'read-source', 'reason', 'contribute', 'save-asset', 'work-item', 'material-status', 'update-topic', 'add-topic', 'attach-ref', 'prepare-publication', 'feedback', 'update-feedback', 'declare-use', 'assess-use', 'mark-issue', 'save-sap-method', 'register-sap-metric', 'extract', 'read-extraction'] as const;
export type StudioAction = typeof STUDIO_ACTIONS[number];
/** A separate Host grant for ordinary consumers; it conveys no construction or declaration writes. */
export const STUDIO_READ_ACTIONS = ['catalog', 'read', 'read-source', 'reason'] as const;
export type StudioReadAction = typeof STUDIO_READ_ACTIONS[number];
export type StudioToolResult = { content: { type: 'text'; text: string }[]; details: Record<string, unknown> };
export type StudioPort = (action: StudioAction, input: Record<string, unknown>, context: SemanticContextCallContext) => Promise<StudioToolResult>;
export type StudioReadPort = (action: StudioReadAction, input: Record<string, unknown>, context: SemanticContextCallContext) => Promise<StudioToolResult>;
export const studioParameters = Type.Object({
  action: Type.Union(STUDIO_ACTIONS.map(action => Type.Literal(action))),
  systemId: Type.Optional(Type.String({ pattern: '^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$' })),
  payload: Type.Optional(Type.Object({
    itemId: Type.Optional(Type.String({ description: 'read-source only: select one stable item in the original studio-foundation/1 body. Keep ref and its source-level locator/version/hash unchanged. Exclusive with metricName.' })),
    metricName: Type.Optional(Type.String({ description: 'read-source only: select one metric from the exact original SAP package. Formula dependencies and scenario definitions remain in that source package. Exclusive with itemId.' })),
    sources: Type.Optional(Type.Union([
      // The Studio Host validates each reference and retains its existing errors.
      Type.Array(Type.Unknown()),
      Type.Null(),
    ], { description: 'For declare-use, pass a plain JSON array of at most 200 exact SourceRef objects actually used, with authority, id and version. Do not wrap the array in an item object. Omit the field when the action allows it.' })),
  }, { additionalProperties: true, description: 'Business payload for this action. Real project/task, tool-call authority, files and model configuration remain Host-bound. read-source uses original ref plus optional itemId OR metricName; follow its exact continuation when partial. Read returns exact candidate/publication identity and save contracts. contribute stores only this task candidate with scope/report/sourceRefs/baseRefs/baseSystemRevision/candidate; sourceProjectId and sourceTaskId are Host-bound, never client authority.' })),
}, { additionalProperties: false });

export const studioReadParameters = Type.Object({
  ...studioParameters.properties,
  action: Type.Union(STUDIO_READ_ACTIONS.map(action => Type.Literal(action))),
}, { additionalProperties: false });

export function prepareStudioArguments(args: unknown): Static<typeof studioParameters> {
  const input = args as Static<typeof studioParameters>;
  const sources: unknown = input?.payload?.sources;
  // Check the supplied shape before Pi's schema conversion can wrap an object.
  if (sources != null && !Array.isArray(sources)) {
    throw new Error(`invalid_studio_sources: payload.sources must be a JSON array of SourceRef objects, received ${typeof sources}. Pass the array directly without an item wrapper.`);
  }
  return input;
}
