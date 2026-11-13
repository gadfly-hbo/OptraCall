import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import type { startTestHost } from './host-process.ts';
import { providerMessageText, type startToolProvider, type SyntheticToolCall, type ToolProviderContext } from './tool-provider.ts';
import type { StudioSourceRef } from '../../extensions/business-plugins/studio/contracts.ts';

type Host = Awaited<ReturnType<typeof startTestHost>>;
type Provider = Awaited<ReturnType<typeof startToolProvider>>;
type Step = SyntheticToolCall | ((context: ToolProviderContext) => SyntheticToolCall);
export const studioRuleJson = async (response: Response, status = 200): Promise<any> => { assert.equal(response.status, status, await response.clone().text()); return response.json(); };
export const studioRuleCall = (action: string, payload: Record<string, unknown> = {}, systemId?: string): SyntheticToolCall => ({ name: 'studio_assets', arguments: { action, ...(systemId ? { systemId } : {}), payload } });
export const studioRuleToolValues = (context: ToolProviderContext) => context.recentToolResults.map(message => {
  const text = providerMessageText(message.content);
  try { return JSON.parse(text); } catch { return { toolError: text }; }
});
export function studioRuleAssetRef(asset: any, projectId: string, systemId: string): StudioSourceRef {
  const revision = asset.revisions.at(-1);
  return { authority: 'studio-source', id: asset.id, version: String(revision.revision), sha256: revision.sha256, projectId, locator: systemId };
}
async function upload(host: Host, projectId: string, name: string, body: string): Promise<StudioSourceRef> {
  const { file } = await studioRuleJson(await host.request(`/api/projects/${projectId}/files/upload`, 'POST', { directory: '020_clean', name, content: Buffer.from(body).toString('base64') }), 201);
  return { authority: 'data', id: createHash('sha256').update(file.path).digest('hex'), version: file.sha256, sha256: file.sha256, projectId, locator: file.path };
}
export async function runSyntheticRuleSteps(host: Host, provider: Provider, projectId: string, taskId: string, steps: Step[], marker: string, options: { construction?: string; errors?: Record<number, RegExp> } = {}) {
  provider.setResponder(context => {
    const step = steps[context.recentToolResults.length];
    return step ? { calls: [typeof step === 'function' ? step(context) : step] } : { text: marker };
  });
  const route = `/api/projects/${projectId}/tasks/${taskId}`, requestId = randomUUID();
  await studioRuleJson(await host.request(`${route}/messages`, 'POST', { requestId, text: '在当前企业获准范围按准确来源执行合成规则工具检查。结论只说明合成协议事实，不构成专业或实际模型验收。', ...(options.construction ? { studioContext: { systemId: options.construction, purpose: 'construction' } } : {}) }), 202);
  let state: any; const deadline = Date.now() + 45_000;
  do {
    state = await studioRuleJson(await host.request(route));
    if (state.task.lastRun?.id === requestId && state.snapshot.status === 'idle') break;
    await new Promise(resolve => setTimeout(resolve, 25));
  } while (Date.now() < deadline);
  assert.equal(state.task.lastRun?.status, 'completed', JSON.stringify({ lastRun: state.task.lastRun, errors: provider.errors, tail: state.snapshot.messages.slice(-3), host: host.output().stderr }));
  assert.deepEqual(provider.errors, []);
  assert.match(JSON.stringify(state.snapshot.messages), new RegExp(marker));
  const lastUser = state.snapshot.messages.findLastIndex((message: any) => message.role === 'user');
  const results = state.snapshot.messages.slice(lastUser + 1).filter((message: any) => message.role === 'toolResult');
  assert.equal(results.length, steps.length, JSON.stringify(results));
  results.forEach((message: any, index: number) => {
    const expected = options.errors?.[index];
    if (expected) { assert.equal(message.isError, true, JSON.stringify(message)); assert.match(JSON.stringify(message), expected); }
    else assert.ok(!message.isError, JSON.stringify(message));
  });
  return { state, results };
}
export function syntheticRuleProfile(policy: StudioSourceRef, binding: StudioSourceRef, revision = 1) {
  const predicates = ['Member', 'Normal', 'Expired', 'Eligible', 'Ineligible'];
  return { contentProfile: 'studio-foundation/2', items: [
    ...predicates.map(itemId => ({ itemId, kind: 'concept', definition: `Synthetic ${itemId}`, sourceRef: policy })),
    { itemId: 'member', kind: 'entity', definition: 'A plan-specific membership relationship', sourceRef: policy },
    { itemId: 'eligibility', kind: 'rule', definition: revision === 1 ? 'Normal members qualify; expired members explicitly do not qualify.' : 'Revised synthetic policy explicitly excludes normal and expired members.', sourceRef: policy },
  ], readiness: Object.fromEntries(['definition', 'mapping', 'computation'].map(key => [key, { status: 'pass', detail: 'Finite synthetic protocol scope only', evidenceRefs: [policy] }])), ruleExecution: {
    contractVersion: 'studio-rule-execution/1', engine: { name: 'semantica', version: '0.7.0' },
    rules: [
      { ruleId: 'normal', ruleItemId: 'eligibility', conditions: ['Member(?m)', 'Normal(?m)'], conclusion: `${revision === 1 ? 'Eligible' : 'Ineligible'}(?m)` },
      { ruleId: 'expired', ruleItemId: 'eligibility', conditions: ['Member(?m)', 'Expired(?m)'], conclusion: 'Ineligible(?m)' },
    ],
    predicates: predicates.map(predicate => ({ predicate, namespace: 'https://example.invalid/rule-protocol/', itemId: predicate, arguments: [{ name: 'member', itemId: 'member', valueType: 'code' }] })),
    factRequirements: ['Member', 'Normal', 'Expired'].map(predicate => ({ requirementId: predicate, predicate, sourceRef: policy, bindingRef: binding, fields: ['member', 'state'], grain: 'one plan membership', unit: 'relationship', timeBasis: 'fixed synthetic period', coverage: 'finite synthetic records', kind: 'observed' })),
  } };
}
export async function uploadSyntheticRuleFacts(host: Host, projectId: string, policy: StudioSourceRef, binding: StudioSourceRef, missing = false) {
  const observation = await upload(host, projectId, missing ? 'missing-observation.csv' : 'observations.csv', 'member,state\nmember_1,normal\nmember_2,expired\n');
  const statements = missing ? ['Member(member_1)'] : ['Member(member_1)', 'Normal(member_1)', 'Member(member_2)', 'Expired(member_2)'];
  return upload(host, projectId, missing ? 'missing-facts.json' : 'facts.json', JSON.stringify({ contractVersion: 'studio-rule-facts/1', purpose: 'membership-eligibility',
    facts: statements.map((statement, i) => ({ factId: `f${i}`, statement, requirementId: statement.split('(')[0], sourceRefs: [policy, observation], locator: `records/${i < 2 ? 1 : 2}`, kind: 'observed', bindingRef: binding })),
    targets: ['member_1', 'member_2', 'member_unknown'].map(targetId => ({ targetId, positive: `Eligible(${targetId})`, negative: `Ineligible(${targetId})` })),
    coverage: { complete: !missing, detail: missing ? 'Required state observations are absent' : 'Two synthetic observations; unknown member has no observation', cutoffAt: '2026-11-13T00:00:00Z', businessTime: 'synthetic-period', missingRequirementIds: missing ? ['Normal', 'Expired'] : [] },
  }));
}
export const studioRuleReasonPayload = (ref: StudioSourceRef, factsRef: StudioSourceRef) => ({ ref, itemId: 'eligibility', purpose: 'membership-eligibility', factsRef });
