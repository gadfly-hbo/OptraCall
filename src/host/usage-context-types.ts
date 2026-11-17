export const usageContextKinds = ['organization', 'department', 'personal'] as const;
export type UsageContextKind = typeof usageContextKinds[number];
export type UsageContextOrigin = 'explicit' | 'goal' | 'default';
export function parseUsageContextOrigin(value: unknown): UsageContextOrigin {
  if (value !== 'explicit' && value !== 'goal' && value !== 'default') throw new UsageContextFault('invalid_usage_context_origin', 400);
  return value;
}

/** Business background only. It never represents identity or resource permission. */
export interface UsageContext { kind: UsageContextKind; background: string }
export interface UsageContextSettings { formatVersion: 1; revision: number; context: UsageContext | null; updatedAt?: string }
export interface UsageContextUpdate { operationId: string; expectedRevision: number; context: UsageContext | null }
export interface UsageContextOperation { operationId: string; fingerprint: string; revision: number; context: UsageContext | null }
export interface UsageContextSettingsResult { settings: UsageContextSettings; replayed: boolean; operationRevision: number }

export class UsageContextFault extends Error {
  code: string; status: number;
  constructor(code: string, status = 409) { super(code); this.code = code; this.status = status; }
}
export function parseUsageContext(value: unknown): UsageContext {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !['kind', 'background'].includes(key))) throw new UsageContextFault('invalid_usage_context', 400);
  const context = value as Record<string, unknown>;
  if (!usageContextKinds.includes(context.kind as UsageContextKind) || typeof context.background !== 'string' || context.background.length > 4000 || context.background.includes('\0')) throw new UsageContextFault('invalid_usage_context', 400);
  return { kind: context.kind as UsageContextKind, background: context.background };
}

export type UsageGoal = { version: number; scope: { kind: 'enterprise' | 'department' | 'personal'; name: string }; usageContext?: UsageContext };
/** Use only when starting new work. Existing work must reuse its own frozen context. */
export function resolveNewUsageContext(input: { explicit?: UsageContext; goal?: UsageGoal; defaultContext?: UsageContext | null }): UsageContext | undefined {
  if (input.explicit !== undefined) return parseUsageContext(input.explicit);
  if (input.goal) {
    if (input.goal.usageContext !== undefined) return parseUsageContext(input.goal.usageContext);
    return { kind: input.goal.scope.kind === 'enterprise' ? 'organization' : input.goal.scope.kind, background: `${input.goal.scope.name}；沿目标 v${input.goal.version} 的准确范围。` };
  }
  return input.defaultContext ? parseUsageContext(input.defaultContext) : undefined;
}
