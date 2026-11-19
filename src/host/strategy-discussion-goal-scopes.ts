import type { GoalScope } from './strategy-goals-types.ts';
import { StrategyDiscussionFault } from './strategy-discussion-store.ts';
import type { UsageContext } from './usage-context-types.ts';

interface GoalScopes {
  bound?: GoalScope;
  defaultScope?: GoalScope;
  choices: GoalScope[];
  suggestedKind?: GoalScope['kind'];
}

const personal: GoalScope = { kind: 'personal', id: 'self', name: '个人工作' };

export function discussionGoalScopes(
  usage: UsageContext | null | undefined,
  enterprises: { id: string; name: string }[],
  previous: GoalScope[],
  fixed?: GoalScope,
): GoalScopes {
  if (fixed) return { bound: fixed, choices: [fixed] };
  const organizations = enterprises.map(({ id, name }): GoalScope => ({ kind: 'enterprise', id, name }));
  const choices = [personal, ...organizations];
  for (const scope of previous) {
    if (scope.kind === 'enterprise' || scope.enterpriseId && !enterprises.some(e => e.id === scope.enterpriseId)) continue;
    if (!choices.some(choice => sameIdentity(choice, scope))) choices.push(scope);
  }
  const defaultScope = usage?.kind === 'personal' ? personal : usage?.kind === 'organization' && organizations.length === 1 ? organizations[0] : undefined;
  const suggestedKind = usage?.kind === 'organization' ? 'enterprise' : usage?.kind;
  return { choices, ...(defaultScope ? { defaultScope } : {}), ...(suggestedKind ? { suggestedKind } : {}) };
}

function sameIdentity(a: GoalScope, b: GoalScope): boolean {
  return a.kind === b.kind && a.id === b.id &&
    (a.enterpriseId ?? (a.kind === 'enterprise' ? a.id : undefined)) === (b.enterpriseId ?? (b.kind === 'enterprise' ? b.id : undefined));
}

/** Scope records are environment metadata. Page them without adding business records to the prompt. */
export function pageDiscussionGoalScopes(scopes: GoalScopes, query = '', offset = 0) {
  const matches = query ? scopes.choices.filter(s => s.name.includes(query) || s.id === query) : scopes.choices;
  const choices = matches.slice(offset, offset + 20);
  return { ...scopes, choices, ...(offset + choices.length < matches.length ? { nextOffset: offset + choices.length } : {}) };
}

export function selectDiscussionGoalScope(scopes: GoalScopes, input: unknown, userDeclared: (name: string) => boolean): GoalScope {
  if (input === undefined) {
    const scope = scopes.bound ?? scopes.defaultScope;
    if (scope) return scope;
    throw new StrategyDiscussionFault('strategy_goal_scope_required', 400);
  }
  const fail = (): never => { throw new StrategyDiscussionFault('strategy_goal_scope_mismatch', 409); };
  if (!input || typeof input !== 'object' || Array.isArray(input)) return fail();
  const scope = input as GoalScope;
  if (typeof scope.name !== 'string' || !scope.name.trim() || typeof scope.id !== 'string' || !scope.id.trim()) return fail();
  const known = scopes.choices.find(s => sameIdentity(s, scope));
  if (known) {
    // Older clients called the same personal identity “本人”. Persist Host metadata.
    if (known.name === scope.name || known.kind === 'personal' && known.id === 'self') return known;
    return fail();
  }
  if (scopes.bound || scope.kind !== 'department' || scope.enterpriseId !== undefined && !scopes.choices.some(s => s.kind === 'enterprise' && s.id === scope.enterpriseId)) return fail();
  // A new department can be declared from the user's own words; an upper enterprise is optional.
  if (scopes.choices.some(s => s.kind === 'department' && s.name === scope.name && s.enterpriseId === scope.enterpriseId)) return fail();
  if (scope.id !== scope.name || scope.name !== scope.name.trim() || scope.name.length > 300 || !userDeclared(scope.name)) {
    throw new StrategyDiscussionFault('strategy_goal_department_unconfirmed', 409);
  }
  return { kind: 'department', id: scope.id, name: scope.name, ...(scope.enterpriseId ? { enterpriseId: scope.enterpriseId } : {}) };
}
