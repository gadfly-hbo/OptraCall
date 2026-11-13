import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { mkdir, mkdtemp } from 'node:fs/promises';
import path from 'node:path';
import { ProjectStore } from '../src/host/project-store.ts';
import { EnterpriseMaterialsStore } from '../src/host/enterprise-materials-store.ts';
import { createStudioFeature } from '../src/host/studio-host.ts';
import { semanticRecordsForAssistant } from '../src/host/ui/semantic-context-history.ts';
import { runStudioRuleInference } from '../src/host/studio-semantic.ts';
import type { StudioSourceRef } from '../extensions/business-plugins/studio/contracts.ts';

async function fixture(t: { after(fn: () => Promise<void>): void }, extra: Record<string, unknown> = {}) {
  const base = path.resolve('.local/studio-rule-reasoning-implementation/host/fixtures');
  await mkdir(base, { recursive: true });
  const root = await mkdtemp(path.join(base, 'port-')), dataRoot = path.join(root, 'data');
  const projects = new ProjectStore({ dataRoot, projectsRoot: path.join(root, 'projects') });
  await projects.init(); t.after(() => projects.close());
  const configuration = { id: 'synthetic', revision: 1, name: 'Synthetic', provider: 'synthetic', model: 'synthetic', baseUrl: 'http://127.0.0.1:1' };
  const project = await projects.create({ name: 'Synthetic rule construction', configuration });
  const task = await projects.createTask(project.id, { name: 'Rule tools' });
  const enterpriseMaterials = new EnterpriseMaterialsStore(dataRoot);
  const studio = createStudioFeature({ dataRoot, projects, enterpriseMaterials, readBody: async () => ({}), mutate: async operation => operation(), running: () => false, closing: () => false, readTaskReply: async () => ({ text: 'SYNTHETIC' }), ...extra });
  const enterprise = studio.enterpriseScopes.create({ name: 'Synthetic enterprise A' });
  studio.enterpriseScopes.associateProject(project.id, enterprise.id);
  const material = await enterpriseMaterials.create({ title: 'Synthetic policy', body: 'A membership is a plan-specific relationship.' });
  const enabled = await enterpriseMaterials.enable(material.material.id, material.material.version);
  studio.enterpriseScopes.associateAsset('enterprise', material.material.id, enterprise.id);
  const context = { requestId: randomUUID(), sessionId: randomUUID(), toolCallId: randomUUID(), signal: new AbortController().signal, assertCurrent() {} };
  const port = studio.port(project.id, task.id);
  const catalog = (await port('catalog', {}, context)).details.result as any;
  const policy = catalog.items.find((v: any) => v.id === material.material.id).ref;
  const system = studio.store.create({ name: 'Synthetic rules', projectId: project.id, taskId: task.id, enterpriseId: enterprise.id, goal: 'Exercise approved rule tools', topicTitle: 'Eligibility' });
  return { studio, projects, enterpriseMaterials, enabled, enterprise, project, task, system, policy, context, port };
}

test('RR01/RR03: a readable legacy rule returns unsupported without claiming an engine execution', async t => {
  const f = await fixture(t);
  const saved = (await f.port('save-asset', { systemId: f.system.id, payload: { kind: 'rule', title: 'Legacy definition', body: 'Legacy prose remains readable.', scope: 'Synthetic definition', sources: [f.policy] } }, f.context)).details.result as any;
  const asset = f.studio.store.get(f.system.id).assets.find(v => v.id === saved.asset.id)!;
  const revision = asset.revisions[0]!;
  const ref = { authority: 'studio-source', id: asset.id, version: '1', sha256: revision.sha256, projectId: f.project.id, locator: f.system.id };
  const result = (await f.port('reason' as any, { systemId: f.system.id, payload: { ref, itemId: 'rule.eligibility', purpose: 'membership-eligibility' } }, f.context)).details.result as any;
  assert.equal(result.completion, 'unsupported');
  assert.equal(result.engineInvoked, false);
  assert.deepEqual(result.conclusions, []);
  assert.equal(f.studio.store.get(f.system.id).assets[0]!.formalRevision, null);
});

test('RR07/RR10: saved ordinary execution evidence survives history projection without reading latest', () => {
  const result = { completion: 'incomplete', engineInvoked: true, conclusions: [], assessments: [], limitations: ['Missing time facts'], identity: { projectId: 'p', taskId: 't', ruleRef: { authority: 'studio-source', id: 'rule', version: '1' } } };
  const messages = [{ role: 'user', content: 'Use the approved rules' }, { role: 'toolResult', toolName: 'studio_assets', entryId: 'entry', toolCallId: 'call', details: { type: 'optracall.studio', action: 'reason', result } }, { role: 'assistant', content: 'The missing facts remain unknown.' }];
  const records = semanticRecordsForAssistant(messages, 2, 'native', { projectId: 'p', taskId: 't' });
  assert.equal(records[0]?.studio?.action, 'reason');
  assert.equal(records[0]?.studio?.result, result);
  assert.equal(semanticRecordsForAssistant(messages, 2, 'native', { projectId: 'another', taskId: 't' })[0]?.studio, undefined);
});

test('RR04/RR09: the ordinary catalog supplies exact own input refs and exact rule refs need no guessed system ID', async t => {
  const f = await fixture(t);
  const saved = (await f.port('save-asset', { systemId: f.system.id, payload: { kind: 'rule', title: 'Readable formal definition', body: 'The exact original formal definition.', scope: 'Synthetic definition only', sources: [f.policy], checks: [], readyForPublication: true } }, f.context)).details.result as any;
  const preview = f.studio.store.preparePublication(f.system.id, { assetIds: [saved.asset.id], summary: 'Synthetic definition', scope: 'Definition only' });
  f.studio.store.confirmPublication(f.system.id, preview.id, preview.fingerprint);
  const project = await f.projects.create({ name: 'Ordinary exact-reference reader', configuration: f.project.configuration });
  f.studio.enterpriseScopes.associateProject(project.id, f.enterprise.id);
  const task = await f.projects.createTask(project.id, { name: 'Ordinary reader' });
  const file = await f.projects.upload({ projectId: project.id, name: 'facts.json', directory: '020_clean', bytes: Buffer.from('{"synthetic":true}') });
  const port = f.studio.port(project.id, task.id, { analysisOnly: true });
  const catalog = (await port('catalog', {}, f.context)).details.result as any;
  assert.deepEqual(catalog.contract.foundation.supportedProfiles, ['studio-foundation/1', 'studio-foundation/2']);
  assert.match(catalog.contract.foundation.ruleExecution, /conditions/);
  assert.match(catalog.contract.foundation.ruleExecution, /factRequirements/);
  assert.match(catalog.contract.publication, /purposes/);
  const input = catalog.inputs.find((item: any) => item.ref.locator === file.path);
  assert.equal(input.ref.id, createHash('sha256').update(file.path).digest('hex'));
  assert.equal(input.ref.sha256, file.sha256); assert.equal(input.ref.projectId, project.id);
  const formal = catalog.items.find((item: any) => item.id === saved.asset.id);
  const read = (await port('read-source', { payload: { ref: formal.ref } }, f.context)).details.result as any;
  assert.equal(read.text, 'The exact original formal definition.');
});

async function saveRuleAsset(f: Awaited<ReturnType<typeof fixture>>, body: unknown, kind: 'rule' | 'binding' = 'rule') {
  const saved = (await f.port('save-asset', { systemId: f.system.id, payload: { kind, title: kind === 'rule' ? 'Synthetic executable eligibility' : 'Synthetic member mapping', body: typeof body === 'string' ? body : JSON.stringify(body), scope: 'Synthetic finite eligibility', sources: [f.policy], checks: [{ name: 'rule-execution', status: 'pass', detail: 'Synthetic author assertion, actual engine evidence is checked separately' }], readyForPublication: true } }, f.context)).details.result as any;
  const asset = f.studio.store.get(f.system.id).assets.find(v => v.id === saved.asset.id)!;
  const revision = asset.revisions[0]!;
  return { asset, ref: { authority: 'studio-source', id: asset.id, version: '1', sha256: revision.sha256, projectId: f.project.id, locator: f.system.id } as StudioSourceRef };
}
async function executableFixture(f: Awaited<ReturnType<typeof fixture>>) {
  const binding = await saveRuleAsset(f, 'Maps source member/state fields at the fixed synthetic period; no identity merging.', 'binding');
  const bindingPreview = f.studio.store.preparePublication(f.system.id, { assetIds: [binding.asset.id], summary: 'Synthetic definition', scope: 'Definition only' });
  f.studio.store.confirmPublication(f.system.id, bindingPreview.id, bindingPreview.fingerprint);
  const names = ['Member', 'Normal', 'Expired', 'Eligible', 'Ineligible'];
  const profile = { contentProfile: 'studio-foundation/2', items: [
    ...names.map(name => ({ itemId: name, kind: 'concept', definition: `Synthetic ${name}`, sourceRef: f.policy })),
    { itemId: 'member', kind: 'entity', definition: 'A plan membership relationship', sourceRef: f.policy },
    { itemId: 'eligibility', kind: 'rule', definition: 'Member and normal qualifies; member and expired is explicitly ineligible', sourceRef: f.policy },
  ], readiness: Object.fromEntries(['definition', 'mapping', 'computation'].map(key => [key, { status: 'pass', detail: 'Synthetic finite test scope', evidenceRefs: [f.policy] }])), ruleExecution: {
    contractVersion: 'studio-rule-execution/1', engine: { name: 'semantica', version: '0.7.0' },
    rules: [{ ruleId: 'normal', ruleItemId: 'eligibility', conditions: ['Member(?m)', 'Normal(?m)'], conclusion: 'Eligible(?m)' }, { ruleId: 'expired', ruleItemId: 'eligibility', conditions: ['Member(?m)', 'Expired(?m)'], conclusion: 'Ineligible(?m)' }],
    predicates: names.map(predicate => ({ predicate, namespace: 'https://example.invalid/rules/', itemId: predicate, arguments: [{ name: 'member', itemId: 'member', valueType: 'code' }] })),
    factRequirements: ['Member', 'Normal', 'Expired'].map(predicate => ({ requirementId: predicate, predicate, sourceRef: f.policy, bindingRef: binding.ref, fields: ['member', 'state'], grain: 'one membership', unit: 'relationship', timeBasis: 'fixed synthetic period', coverage: 'finite synthetic records', kind: 'observed' })),
  } };
  const rule = await saveRuleAsset(f, profile);
  return { rule, binding, profile };
}
async function factsFixture(f: Awaited<ReturnType<typeof fixture>>, binding: StudioSourceRef, projectId = f.project.id, overrides: Record<string, unknown> = {}) {
  const observed = await f.projects.upload({ projectId, name: 'observations.csv', directory: '020_clean', bytes: Buffer.from('member,state\nmember_1,normal\nmember_2,expired\n') });
  const observedRef: StudioSourceRef = { authority: 'data', id: createHash('sha256').update(observed.path).digest('hex'), version: observed.sha256, sha256: observed.sha256, projectId, locator: observed.path };
  const body = { contractVersion: 'studio-rule-facts/1', purpose: 'membership-eligibility', facts: ['Member(member_1)', 'Normal(member_1)', 'Member(member_2)', 'Expired(member_2)'].map((statement, i) => ({ factId: `f${i}`, statement, requirementId: statement.split('(')[0], sourceRefs: [f.policy, observedRef], locator: `records/${i < 2 ? 1 : 2}`, kind: 'observed', bindingRef: binding })), targets: ['member_1', 'member_2', 'member_unknown'].map(targetId => ({ targetId, positive: `Eligible(${targetId})`, negative: `Ineligible(${targetId})` })), coverage: { complete: true, detail: 'Two synthetic observations; unknown member has no observation', cutoffAt: '2026-11-13T00:00:00Z', businessTime: 'synthetic-period', missingRequirementIds: [] }, ...overrides };
  const file = await f.projects.upload({ projectId, name: 'facts.json', directory: '020_clean', bytes: Buffer.from(JSON.stringify(body)) });
  return { ref: { authority: 'data', id: createHash('sha256').update(file.path).digest('hex'), version: file.sha256, sha256: file.sha256, projectId, locator: file.path } as StudioSourceRef, body, observedRef };
}

const python = process.env.OPTRACALL_STUDIO_TEST_PYTHON;
test('RR04/RR06: every declared fact requirement needs a real Binding even when there are no supplied facts', async t => {
  const f = await fixture(t), built = await executableFixture(f);
  const raw = (await f.port('save-asset', { payload: { kind: 'business', title: 'Not a Binding', body: 'A business note is not a field mapping', scope: 'Synthetic', sources: [f.policy], checks: [], readyForPublication: true } }, f.context)).details.result as any;
  const asset = f.studio.store.get(f.system.id).assets.find(a => a.id === raw.asset.id)!;
  const preview = f.studio.store.preparePublication(f.system.id, { assetIds: [asset.id], summary: 'Synthetic business note', scope: 'Definition only' });
  f.studio.store.confirmPublication(f.system.id, preview.id, preview.fingerprint);
  const wrong = { authority: 'studio-source', id: asset.id, version: '1', sha256: asset.revisions[0]!.sha256, projectId: f.project.id, locator: f.system.id } as StudioSourceRef;
  const profile = structuredClone(built.profile); for (const requirement of profile.ruleExecution.factRequirements) requirement.bindingRef = wrong;
  await assert.rejects(() => saveRuleAsset(f, profile), /studio_foundation_binding_type_mismatch/);
});

test('RR06/RR07: a source withdrawn at the final delivery boundary cannot escape as a successful execution', async t => {
  let f: Awaited<ReturnType<typeof fixture>>, finished = false, disabled = false;
  f = await fixture(t, {
    reason: async () => { finished = true; return { completion: 'complete', component: { name: 'semantica', version: '0.7.0' }, contractVersion: 'studio-rule-execution/1', engineInvoked: true, conclusions: [], assessments: [], limitations: ['Injected external worker result; source-delivery permission test only'] }; },
    mutate: async (operation: () => Promise<unknown>) => {
      if (finished && !disabled) { disabled = true; await f.enterpriseMaterials.disable(f.policy.id, f.enabled.material.version); }
      return operation();
    },
  });
  const built = await executableFixture(f), input = await factsFixture(f, built.binding.ref);
  await assert.rejects(() => f.port('reason', { payload: { ref: built.rule.ref, itemId: 'eligibility', purpose: 'membership-eligibility', factsRef: input.ref } }, f.context), /studio_source_unavailable/);
  assert.equal(disabled, true);
});

test('RR05/RR06/RR08: real official candidate execution, exact native gate and read-only formal consumption remain separate', { skip: !python, timeout: 30000 }, async t => {
  const messages: any[] = [];
  const f = await fixture(t, { taskSnapshot: async () => ({ messages }), reason: (command: any, context: any) => runStudioRuleInference({ python: python!, codeRoot: process.cwd(), command, ...context }) });
  const built = await executableFixture(f), facts = await factsFixture(f, built.binding.ref);
  await assert.rejects(() => f.port('prepare-publication', { systemId: f.system.id, payload: { assetIds: [built.rule.asset.id], summary: 'Actual execution required', scope: 'Rule execution', purposes: ['rule-execution'] } }, f.context), /studio_rule_execution_evidence_required/);
  const result = (await f.port('reason', { systemId: f.system.id, payload: { ref: built.rule.ref, itemId: 'eligibility', purpose: 'membership-eligibility', factsRef: facts.ref } }, f.context)).details.result as any;
  assert.equal(result.engineInvoked, true); assert.equal(result.completion, 'complete');
  assert.deepEqual(result.assessments.map((v: any) => v.state), ['derived', 'explicit-negative', 'not-derived']);
  assert.equal(result.identity.ruleRef.sha256, built.rule.ref.sha256);
  messages.push({ role: 'toolResult', toolName: 'studio_assets', details: { type: 'optracall.studio', action: 'reason', result } });
  const preview = ((await f.port('prepare-publication', { systemId: f.system.id, payload: { assetIds: [built.rule.asset.id], summary: 'Actual official synthetic execution', scope: 'Finite synthetic membership eligibility', purposes: ['rule-execution'] } }, f.context)).details.result as any).preview;
  f.studio.store.confirmPublication(f.system.id, preview.id, preview.fingerprint);
  const project = await f.projects.create({ name: 'Ordinary same enterprise', configuration: f.project.configuration });
  f.studio.enterpriseScopes.associateProject(project.id, f.enterprise.id);
  const task = await f.projects.createTask(project.id, { name: 'Ordinary autonomous consumer' }), input = await factsFixture(f, built.binding.ref, project.id);
  const port = f.studio.port(project.id, task.id, { analysisOnly: true });
  const used = (await port('reason', { systemId: f.system.id, payload: { ref: built.rule.ref, itemId: 'eligibility', purpose: 'membership-eligibility', factsRef: input.ref } }, { ...f.context, toolCallId: randomUUID() })).details.result as any;
  assert.equal(used.completion, 'complete'); assert.equal(used.identity.projectId, project.id);
  await assert.rejects(() => port('save-asset', { systemId: f.system.id, payload: {} }, f.context), /studio_read_only/);
  await assert.rejects(() => port('reason', { systemId: f.system.id, payload: { ref: built.rule.ref, itemId: 'eligibility', purpose: 'membership-eligibility', factsRef: facts.ref } }, f.context), /studio_rule_fact_scope_forbidden/);
  await f.enterpriseMaterials.disable(f.policy.id, f.enabled.material.version);
  await assert.rejects(() => port('reason', { systemId: f.system.id, payload: { ref: built.rule.ref, itemId: 'eligibility', purpose: 'membership-eligibility', factsRef: input.ref } }, f.context));
});
