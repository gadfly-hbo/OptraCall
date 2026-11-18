import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { startTestHost } from './fixtures/host-process.ts';
import { startToolProvider, type ToolProviderContext } from './fixtures/tool-provider.ts';
import { studioRuleJson as json, studioRuleCall as call, studioRuleToolValues as values, studioRuleAssetRef as assetRef, runSyntheticRuleSteps as run, syntheticRuleProfile as profile, uploadSyntheticRuleFacts as facts, studioRuleReasonPayload as requestReason } from './fixtures/studio-rule.ts';
import type { StudioSourceRef } from '../extensions/business-plugins/studio/contracts.ts';

const python = process.env.OPTRACALL_STUDIO_TEST_PYTHON;

/** Real Host, official Pi SDK and official Semantica with a local deterministic
 * protocol Provider. This proves wiring and source preservation, not model quality. */
test('RR07/RR08/RR10/RR11: official Host/Pi rule publication, ordinary autonomous discovery, exact revision reuse and native preservation', { skip: !python, timeout: 180_000 }, async t => {
  const evidence = path.resolve('.local/studio-rule-reasoning-implementation/runtime');
  await mkdir(evidence, { recursive: true });
  const root = await mkdtemp(path.join(evidence, 'protocol-'));
  const provider = await startToolProvider(); t.after(() => provider.close());
  const host = await startTestHost({ dataRoot: path.join(root, 'host'), projectsRoot: path.join(root, 'projects'), studioPython: python!, timeoutMs: 15_000 }); t.after(() => host.close());
  await writeFile(path.join(root, 'identity.json'), JSON.stringify({ kind: 'synthetic-protocol-not-real-model', python, hostPid: host.pid, hostPort: host.port, createdAt: new Date().toISOString() }, null, 2));
  await json(await host.request('/api/configuration', 'PUT', { name: 'Rule synthetic protocol', provider: 'openai-compatible', baseUrl: provider.baseUrl, model: 'synthetic-rule', apiKey: 'synthetic-rule-only' }));
  const enterprise = await json(await host.request('/api/studio/enterprises', 'POST', { name: 'Synthetic rule enterprise' }), 201);
  const policyBody = 'Synthetic policy v1: normal plan memberships qualify; expired memberships are explicitly ineligible. v2 test policy excludes both. Missing evidence remains unknown.';
  const draft = await json(await host.request('/api/enterprise-materials', 'POST', { title: 'Synthetic rule policy', body: policyBody }), 201);
  const enabled = await json(await host.request(`/api/enterprise-materials/${draft.material.id}/enable`, 'POST', { expectedVersion: draft.material.version }));
  await json(await host.request('/api/studio/enterprise-associations', 'POST', { kind: 'asset', authority: 'enterprise', entityId: enabled.material.id, enterpriseId: enterprise.id }));
  const policy: StudioSourceRef = { authority: 'enterprise', id: enabled.material.id, version: enabled.material.activeRevisionId, locator: enabled.storeId, sha256: createHash('sha256').update(policyBody).digest('hex') };
  const { project } = await json(await host.request('/api/projects', 'POST', { name: 'Synthetic rule construction' }), 201);
  const { system } = await json(await host.request('/api/studio/systems', 'POST', { requestId: randomUUID(), enterpriseId: enterprise.id, projectId: project.id, name: 'Synthetic membership rules', goal: 'Test the approved finite rule execution contract', topicTitle: 'Membership eligibility' }), 201);
  const base = { scope: 'Finite synthetic memberships only', sources: [policy], checks: [{ name: 'rule-execution', status: 'pass', detail: 'Author fixture check; actual native execution is separately required' }], readyForPublication: true };
  const bindingBuilt = await run(host, provider, project.id, system.taskId, [
    call('save-asset', { ...base, kind: 'binding', title: 'Synthetic member binding', body: 'member identifies one plan membership; state is observed at the fixed synthetic period; no identity merging.' }, system.id),
    context => call('prepare-publication', { assetIds: [values(context)[0].asset.id], summary: 'Synthetic binding definition', scope: base.scope, purposes: ['definition-reference'] }, system.id),
  ], 'RULE_BINDING_SAVED', { construction: system.id });
  const binding = assetRef(bindingBuilt.results[0].details.result.asset, project.id, system.id);
  const confirm = async (preview: any) => json(await host.request(`/api/studio/systems/${system.id}/publications`, 'POST', { requestId: randomUUID(), previewId: preview.id, fingerprint: preview.fingerprint }));
  await confirm(bindingBuilt.results[1].details.result.preview);
  const built = await run(host, provider, project.id, system.taskId, [call('save-asset', { ...base, kind: 'rule', title: 'Synthetic membership eligibility', body: JSON.stringify(profile(policy, binding)) }, system.id)], 'RULE_CANDIDATE_SAVED', { construction: system.id });
  const ruleAsset = built.results[0].details.result.asset, v1 = assetRef(ruleAsset, project.id, system.id);
  const constructionFacts = await facts(host, project.id, policy, binding);
  const execution = await run(host, provider, project.id, system.taskId, [
    call('prepare-publication', { assetIds: [v1.id], summary: 'No native proof yet', scope: base.scope, purposes: ['rule-execution'] }, system.id),
    call('reason', requestReason(v1, constructionFacts), system.id),
    call('prepare-publication', { assetIds: [v1.id], summary: 'Actual official finite execution', scope: base.scope, purposes: ['rule-execution'] }, system.id),
  ], 'RULE_NATIVE_EXECUTION_PUBLISHED', { construction: system.id, errors: { 0: /studio_rule_execution_evidence_required/ } });
  const receipt = execution.results[1].details.result;
  assert.equal(execution.state.snapshot.sdkVersion, '1.4.0');
  assert.deepEqual(receipt.component, { name: 'semantica', version: '0.7.0' });
  assert.equal(receipt.engineInvoked, true); assert.equal(receipt.completion, 'complete');
  assert.deepEqual(receipt.conclusions.map((v: any) => v.statement).sort(), ['Eligible(member_1)', 'Ineligible(member_2)']);
  assert.deepEqual(receipt.assessments.map((v: any) => v.state), ['derived', 'explicit-negative', 'not-derived']);
  assert.deepEqual(receipt.identity.ruleRef, v1); assert.deepEqual(receipt.identity.factsRef, constructionFacts);
  assert.equal(receipt.factVerification, 'agent-projection-not-independent-verification');
  const published = await confirm(execution.results[2].details.result.preview);
  assert.equal(published.system.assets.find((v: any) => v.id === v1.id).formalRevision, 1);
  const { project: ordinary } = await json(await host.request('/api/projects', 'POST', { name: 'Ordinary same-enterprise analysis' }), 201);
  await json(await host.request('/api/studio/enterprise-associations', 'POST', { kind: 'project', entityId: ordinary.id, enterpriseId: enterprise.id }));
  const { task } = await json(await host.request(`/api/projects/${ordinary.id}/tasks`, 'POST', { name: 'No manual Studio selection' }), 201);
  const ordinaryFacts = await facts(host, ordinary.id, policy, binding), missingFacts = await facts(host, ordinary.id, policy, binding, true);
  const discovered = (context: ToolProviderContext) => {
    const item = values(context)[0].items.find((value: any) => value.id === v1.id);
    assert.ok(item?.ref, 'the ordinary catalog discovers the formal rule without user selection');
    return item.ref;
  };
  const consumer = await run(host, provider, ordinary.id, task.id, [
    call('catalog'),
    context => call('read-source', { ref: discovered(context), itemId: 'eligibility' }, discovered(context).locator),
    context => call('reason', requestReason(discovered(context), ordinaryFacts), discovered(context).locator),
    context => call('reason', requestReason(discovered(context), missingFacts), discovered(context).locator),
    call('save-asset', { ...base, kind: 'rule', title: 'Forbidden ordinary write', body: 'No construction rights' }, system.id),
    context => call('reason', requestReason(discovered(context), constructionFacts), discovered(context).locator),
  ], 'ORDINARY_RULE_PROTOCOL_DONE', { errors: { 4: /studio_construction_only/, 5: /studio_rule_fact_scope_forbidden/ } });
  assert.equal(JSON.parse(consumer.results[1].details.result.text).itemId, 'eligibility');
  assert.deepEqual(consumer.results[2].details.result.identity.ruleRef, v1);
  assert.deepEqual(consumer.results[2].details.result.assessments.map((v: any) => v.state), ['derived', 'explicit-negative', 'not-derived']);
  const incomplete = consumer.results[3].details.result;
  assert.equal(incomplete.completion, 'incomplete');
  assert.ok(incomplete.assessments.every((v: any) => v.state === 'insufficient-facts'));
  assert.deepEqual(incomplete.conclusions, []);
  const oldNativePath = consumer.state.task.sessionFile, oldNative = await readFile(oldNativePath);
  const revised = await run(host, provider, project.id, system.taskId, [
    call('save-asset', { ...base, assetId: v1.id, expectedRevision: 1, kind: 'rule', title: 'Synthetic membership eligibility', body: JSON.stringify(profile(policy, binding, 2)), reason: 'Synthetic approved version evolution' }, system.id),
    call('prepare-publication', { assetIds: [v1.id], summary: 'Old native proof must not qualify new bytes', scope: base.scope, purposes: ['rule-execution'] }, system.id),
  ], 'RULE_REVISION_REQUIRES_FRESH_PROOF', { construction: system.id, errors: { 1: /studio_rule_execution_evidence_required/ } });
  const v2 = assetRef(revised.results[0].details.result.asset, project.id, system.id);
  assert.equal(v2.version, '2'); assert.notEqual(v2.sha256, v1.sha256);
  const revisedExecution = await run(host, provider, project.id, system.taskId, [
    call('reason', requestReason(v2, constructionFacts), system.id),
    call('prepare-publication', { assetIds: [v2.id], summary: 'Revised bytes have their own actual execution', scope: base.scope, purposes: ['rule-execution'] }, system.id),
  ], 'RULE_REVISION_EXECUTED', { construction: system.id });
  await confirm(revisedExecution.results[1].details.result.preview);
  const { task: fresh } = await json(await host.request(`/api/projects/${ordinary.id}/tasks`, 'POST', { name: 'Fresh analysis discovers revised rules' }), 201);
  const newConsumer = await run(host, provider, ordinary.id, fresh.id, [
    call('catalog'), context => call('reason', requestReason(discovered(context), ordinaryFacts), discovered(context).locator),
  ], 'ORDINARY_RULE_REVISION_DONE');
  assert.deepEqual(newConsumer.results[1].details.result.identity.ruleRef, v2);
  assert.notEqual(newConsumer.results[1].details.result.identity.inputFingerprint, consumer.results[2].details.result.identity.inputFingerprint);
  assert.deepEqual(newConsumer.results[1].details.result.conclusions.map((v: any) => v.statement).sort(), ['Ineligible(member_1)', 'Ineligible(member_2)']);
  assert.deepEqual(newConsumer.results[1].details.result.assessments.map((v: any) => v.state), ['explicit-negative', 'explicit-negative', 'not-derived']);
  assert.deepEqual(await readFile(oldNativePath), oldNative, 'new formal revisions and fresh tasks preserve the old task native bytes');
  assert.deepEqual((await json(await host.request(`/api/projects/${ordinary.id}/tasks/${task.id}`))).snapshot.messages, consumer.state.snapshot.messages);
  await host.close();
  const reopened = await startTestHost({ dataRoot: host.dataRoot, projectsRoot: host.projectsRoot, studioPython: python!, timeoutMs: 15_000 }); t.after(() => reopened.close());
  const restored = await json(await reopened.request(`/api/projects/${ordinary.id}/tasks/${task.id}`));
  assert.deepEqual(restored.snapshot.messages, consumer.state.snapshot.messages);
  assert.deepEqual(await readFile(oldNativePath), oldNative, 'restart/readback must not regenerate historical rule evidence');
  assert.equal(restored.task.lastRun.id, consumer.state.task.lastRun.id);
  assert.equal((await json(await reopened.request(`/api/studio/systems/${system.id}`))).system.assets.find((v: any) => v.id === v1.id).formalRevision, 2);
  await writeFile(path.join(root, 'receipt.json'), JSON.stringify({ status: 'PASS', officialPi: '1.4.0', semantica: receipt.component, ordinaryProjectId: ordinary.id, originalTaskId: task.id, freshTaskId: fresh.id, v1, v2, first: consumer.results[2].details.result, incomplete, revised: newConsumer.results[1].details.result, modelQuality: 'NOT_RUN', enterpriseAcceptance: 'NOT_RUN' }, null, 2));
});
