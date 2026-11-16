import assert from 'node:assert/strict';
import type { CaseGoalBindingInput } from '../../src/host/case-types.ts';
import type { GoalDraftInput, GoalRef, GoalVersion, StrategyGoalsIndex } from '../../src/host/strategy-goals-types.ts';

type CaseGoalHost = { request: (route: string, method?: string, body?: unknown) => Promise<Response> };
const scopeId = 'synthetic-case-http-regression';
const title = '合成回归目标：保留原Case业务与历史';
const createOperationId = '00000000-0000-4000-8000-00000000c001';
const adoptOperationId = '00000000-0000-4000-8000-00000000c002';
const pending = new WeakMap<CaseGoalHost, Promise<GoalRef>>();

async function json<T>(response: Response, status: number): Promise<T> {
  assert.equal(response.status, status, await response.clone().text());
  return response.json() as Promise<T>;
}
async function prepare(host: CaseGoalHost): Promise<GoalRef> {
  // A restarted host reads the same management authority rather than inventing
  // another test target. The original Case assertions and business fields stay intact.
  const index = await json<StrategyGoalsIndex>(await host.request('/api/strategy/goals'), 200);
  const existing = index.goals.find(record => record.versions.some(version => version.title === title && version.scope.kind === 'personal' && version.scope.id === scopeId));
  let goal: GoalVersion | undefined = existing?.versions.find(version => version.version === 1);
  if (!goal) {
    const input: GoalDraftInput & { operationId: string } = {
      operationId: createOperationId, title, outcome: '核对原测试所要求的业务行为，并保留原Case、项目、任务和历史。',
      perspective: 'personal', scope: { kind: 'personal', id: scopeId, name: '合成回归参与人' },
      measurement: { kind: 'deliverable', criterion: '原测试的公开接口断言及禁止副作用检查。' },
      baseline: { state: 'pending', description: '仅提供合成测试目标前提，不宣称真实经营基线或效果。' }, responsible: '合成测试角色',
    };
    goal = (await json<{ goal: GoalVersion }>(await host.request('/api/strategy/goals', 'POST', input), 201)).goal;
  }
  if (goal.status !== 'adopted') {
    goal = (await json<{ goal: GoalVersion }>(await host.request(`/api/strategy/goals/${goal.goalId}/adopt`, 'POST', {
      operationId: adoptOperationId, version: goal.version, expectedVersion: existing?.currentVersion ?? goal.version,
      decision: '测试夹具明确采纳此合成目标，仅用于原Case HTTP测试前提，不授权经营动作。',
    }), 200)).goal;
  }
  assert.equal(goal.status, 'adopted');
  return { goalId: goal.goalId, version: goal.version };
}

/** New Case HTTP admission needs an explicit adopted primary goal. Do not use
 * this helper for legacy Store fixtures or tests of deliberately absent goals. */
export async function withCaseGoal<T extends object>(host: CaseGoalHost, input: T): Promise<T & { goalBinding: CaseGoalBindingInput }> {
  if ('goalBinding' in input) return input as T & { goalBinding: CaseGoalBindingInput };
  let ref = pending.get(host);
  if (!ref) { ref = prepare(host); pending.set(host, ref); ref.catch(() => { if (pending.get(host) === ref) pending.delete(host); }); }
  return { ...input, goalBinding: { primary: await ref, related: [] } };
}
