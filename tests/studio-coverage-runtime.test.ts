import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { startTestHost } from './fixtures/host-process.ts';
import { startToolProvider, type ToolProviderContext } from './fixtures/tool-provider.ts';
import { studioRuleJson as json, studioRuleCall as call, studioRuleToolValues as values, studioRuleAssetRef as assetRef, runSyntheticRuleSteps as run } from './fixtures/studio-rule.ts';
import type { StudioSourceRef } from '../extensions/business-plugins/studio/contracts.ts';

/** Real product HTTP + official Pi SDK + deterministic local protocol transport.
 * No real model, business asset construction, source authority or engine is faked. */
test('BC07–09/C05/C07: official Host/Pi discovers only qualified formal coverage, keeps candidates separate and preserves native history', { timeout: 180_000 }, async t => {
  const evidence = path.resolve('.local/studio-business-coverage-implementation/runtime');
  await mkdir(evidence, { recursive: true });
  const root = await mkdtemp(path.join(evidence, 'protocol-'));
  const provider = await startToolProvider(); t.after(() => provider.close());
  const host = await startTestHost({ dataRoot: path.join(root, 'host'), projectsRoot: path.join(root, 'projects'), timeoutMs: 15_000 }); t.after(() => host.close());
  await json(await host.request('/api/configuration', 'PUT', { name: 'Coverage protocol only', provider: 'openai-compatible', baseUrl: provider.baseUrl, model: 'synthetic-coverage', apiKey: 'synthetic-coverage-only' }));
  const enterprise = await json(await host.request('/api/studio/enterprises', 'POST', { name: 'Synthetic coverage enterprise' }), 201);
  const policyText = 'Synthetic scope: product, store and membership identities are separate. An account is not a plan membership.';
  const draft = await json(await host.request('/api/enterprise-materials', 'POST', { title: 'Synthetic coverage policy', body: policyText }), 201);
  const enabled = await json(await host.request(`/api/enterprise-materials/${draft.material.id}/enable`, 'POST', { expectedVersion: draft.material.version }));
  await json(await host.request('/api/studio/enterprise-associations', 'POST', { kind: 'asset', authority: 'enterprise', entityId: enabled.material.id, enterpriseId: enterprise.id }));
  const policy: StudioSourceRef = { authority: 'enterprise', id: enabled.material.id, version: enabled.material.activeRevisionId, locator: enabled.storeId, sha256: createHash('sha256').update(policyText).digest('hex') };
  const { project } = await json(await host.request('/api/projects', 'POST', { name: 'Synthetic coverage construction' }), 201);
  const { system } = await json(await host.request('/api/studio/systems', 'POST', { requestId: randomUUID(), enterpriseId: enterprise.id, projectId: project.id, name: 'Synthetic source coverage', goal: 'Verify source-qualified scope evidence without a business analysis question', topicTitle: 'Shared semantics' }), 201);
  const body = {
    reportProfile: 'studio-coverage/1',
    scope: { enterpriseId: enterprise.id, systemId: system.id, topicId: system.currentTopicId, purpose: 'Synthetic definition reference only', included: ['Shared object identities'], excluded: ['Actual enterprise construction'] },
    methodRefs: [], basisRefs: [policy], focusCells: [{ row: 2, column: 'What' }],
    observations: [{ id: 'identity', subjectLabel: 'Membership identity', description: 'The approved synthetic source separates an account from a plan membership.', annotations: [{ cell: { row: 2, column: 'What' }, reason: 'Business object identity in the exact source' }], evidenceRefs: [policy], evidenceStatus: 'located' }],
    questions: [], limitations: ['No method was selected; synthetic protocol input only, no real enterprise or professional validation.'],
  };
  const base = { kind: 'business', title: 'Synthetic scope evidence', scope: 'Source-qualified synthetic reference', sources: [], checks: [], readyForPublication: true };
  const built = await run(host, provider, project.id, system.taskId, [call('save-asset', { ...base, body: JSON.stringify(body) }, system.id)], 'COVERAGE_CANDIDATE_SAVED', { construction: system.id });
  assert.equal(built.state.snapshot.sdkVersion, '1.4.0');
  const asset = built.results[0].details.result.asset, v1 = assetRef(asset, project.id, system.id);
  const current = await json(await host.request(`/api/studio/systems/${system.id}/coverage?assetId=${asset.id}&revision=1`));
  assert.equal(current.status, 'ready'); assert.equal(current.report.observations[0].id, 'identity');
  assert.deepEqual(current.ref, v1);
  const { project: ordinary } = await json(await host.request('/api/projects', 'POST', { name: 'Ordinary source reader' }), 201);
  await json(await host.request('/api/studio/enterprise-associations', 'POST', { kind: 'project', entityId: ordinary.id, enterpriseId: enterprise.id }));
  const { task } = await json(await host.request(`/api/projects/${ordinary.id}/tasks`, 'POST', { name: 'No cell selection required' }), 201);
  const before = await run(host, provider, ordinary.id, task.id, [call('catalog')], 'CANDIDATE_NOT_FORMAL');
  assert.ok(!before.results[0].details.result.items.some((item: any) => item.id === asset.id));
  const publish = async () => {
    const prepared = await run(host, provider, project.id, system.taskId, [call('prepare-publication', { assetIds: [asset.id], summary: 'Synthetic scope reference', scope: base.scope, purposes: ['definition-reference'] }, system.id)], 'COVERAGE_PREVIEW', { construction: system.id });
    const preview = prepared.results[0].details.result.preview;
    await json(await host.request(`/api/studio/systems/${system.id}/publications`, 'POST', { requestId: randomUUID(), previewId: preview.id, fingerprint: preview.fingerprint }));
  };
  await publish();
  const discovered = (context: ToolProviderContext) => {
    const entry = values(context)[0].items.find((item: any) => item.id === asset.id);
    assert.ok(entry?.ref, 'the original ordinary catalog discovers the formal report'); return entry.ref;
  };
  const consumed = await run(host, provider, ordinary.id, task.id, [call('catalog'), context => call('read-source', { ref: discovered(context) }, system.id)], 'FORMAL_COVERAGE_READ');
  assert.equal(JSON.parse(consumed.results[1].details.result.text).reportProfile, 'studio-coverage/1');
  const oldNativePath = consumed.state.task.sessionFile, oldNative = await readFile(oldNativePath);
  const revisedBody = { ...body, focusCells: [...body.focusCells, { row: 3, column: 'What' }], observations: [...body.observations, { ...body.observations[0], id: 'logical', description: 'A new explicit logical identity observation is separate from the business definition.', annotations: [{ cell: { row: 3, column: 'What' }, reason: 'Logical representation rather than a repeated column fallback' }] }] };
  const revised = await run(host, provider, project.id, system.taskId, [call('save-asset', { ...base, assetId: asset.id, expectedRevision: 1, body: JSON.stringify(revisedBody), reason: 'Synthetic scope revision' }, system.id)], 'COVERAGE_NEW_CANDIDATE', { construction: system.id });
  const v2 = assetRef(revised.results[0].details.result.asset, project.id, system.id);
  const { task: fresh } = await json(await host.request(`/api/projects/${ordinary.id}/tasks`, 'POST', { name: 'Version-bound reader' }), 201);
  const candidateOnly = await run(host, provider, ordinary.id, fresh.id, [call('catalog'), context => call('read-source', { ref: discovered(context) }, system.id)], 'OLD_FORMAL_STILL_CURRENT');
  assert.equal(candidateOnly.results[1].details.result.ref.version, '1');
  await publish();
  const updated = await run(host, provider, ordinary.id, fresh.id, [call('catalog'), context => call('read-source', { ref: discovered(context) }, system.id)], 'NEW_FORMAL_COVERAGE_READ');
  assert.deepEqual(updated.results[1].details.result.ref, v2);
  assert.equal(JSON.parse(updated.results[1].details.result.text).observations.length, 2);
  assert.deepEqual(await readFile(oldNativePath), oldNative, 'publication must preserve the original native task bytes');
  await host.close();
  const reopened = await startTestHost({ dataRoot: host.dataRoot, projectsRoot: host.projectsRoot, timeoutMs: 15_000 }); t.after(() => reopened.close());
  const restored = await json(await reopened.request(`/api/projects/${ordinary.id}/tasks/${task.id}`));
  assert.deepEqual(restored.snapshot.messages, consumed.state.snapshot.messages);
  assert.deepEqual(await readFile(oldNativePath), oldNative);
  await writeFile(path.join(root, 'receipt.json'), JSON.stringify({ status: 'PASS', officialPi: '1.4.0', protocol: 'local synthetic transport; no real model', v1, v2, oldNativeSha256: createHash('sha256').update(oldNative).digest('hex'), modelQuality: 'NOT_RUN', assetConstruction: 'NOT_STARTED' }, null, 2));
});
