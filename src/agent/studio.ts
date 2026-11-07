import { Type } from 'typebox';
import type { SemanticContextCallContext } from './semantic-context.ts';

export const STUDIO_ACTIONS = ['catalog', 'read', 'read-source', 'save-asset', 'work-item', 'material-status', 'update-topic', 'add-topic', 'attach-ref', 'prepare-publication', 'feedback', 'update-feedback', 'declare-use', 'assess-use', 'mark-issue', 'save-sap-method', 'register-sap-metric', 'extract', 'read-extraction'] as const;
export type StudioAction = typeof STUDIO_ACTIONS[number];
export type StudioToolResult = { content: { type: 'text'; text: string }[]; details: Record<string, unknown> };
export type StudioPort = (action: StudioAction, input: Record<string, unknown>, context: SemanticContextCallContext) => Promise<StudioToolResult>;
export const studioParameters = Type.Object({
  action: Type.Union(STUDIO_ACTIONS.map(action => Type.Literal(action))),
  systemId: Type.Optional(Type.String({ pattern: '^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$' })),
  payload: Type.Optional(Type.Record(Type.String(), Type.Unknown(), { description: 'Business payload for this action. Real project/task, tool-call authority, files and model configuration remain Host-bound. Read returns exact candidate/publication identity and save contracts.' })),
}, { additionalProperties: false });
