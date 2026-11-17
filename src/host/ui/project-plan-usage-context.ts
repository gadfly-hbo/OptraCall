import type { UsageContext, UsageContextOrigin } from '../usage-context-types.ts';
import type { ProjectPlanContent } from '../project-plan-types.ts';

/** Derived suggestions may follow an exact Goal; explicit and legacy contexts keep their meaning. */
export function suggestProjectPlanUsage(plan: ProjectPlanContent, context: UsageContext | null | undefined, origin: Exclude<UsageContextOrigin, 'explicit'>): ProjectPlanContent {
  if (plan.usageContextOrigin === 'explicit' || plan.usageContext && plan.usageContextOrigin === undefined) return plan;
  const next = { ...plan };
  if (context) { next.usageContext = structuredClone(context); next.usageContextOrigin = origin; }
  else { delete next.usageContext; delete next.usageContextOrigin; }
  return next;
}
