import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';
import { startTestHost } from './fixtures/host-process.ts';
import { startToolProvider, providerMessageText, type SyntheticToolCall, type ToolProviderContext } from './fixtures/tool-provider.ts';
import { createMetricLibrary } from '../extensions/business-plugins/metric-factory/library/store.ts';
import { preparePublication as prepareSapPublication } from '../extensions/business-plugins/metric-factory/sap/validate.ts';
import type { StudioSourceRef } from '../extensions/business-plugins/studio/contracts.ts';

type Host = Awaited<ReturnType<typeof startTestHost>>;
type Provider = Awaited<ReturnType<typeof startToolProvider>>;
type Step = SyntheticToolCall | ((context: ToolProviderContext) => SyntheticToolCall);
const json = async (response: Response, status = 200): Promise<any> => { assert.equal(response.status, status, await response.clone().text()); return response.json(); };
const studioCall = (action: string, payload: Record<string, unknown> = {}, systemId?: string): SyntheticToolCall => ({ name: 'studio_assets', arguments: { action, ...(systemId ? { systemId } : {}), payload } });
const toolValues = (context: ToolProviderContext) => context.recentToolResults.map(message => JSON.parse(providerMessageText(message.content)));
function assetRef(asset: any, projectId: string, systemId: string): StudioSourceRef {
  const revision = asset.revisions.at(-1);
  return { authority: 'studio-source', id: asset.id, version: String(revision.revision), sha256: revision.sha256, projectId, locator: systemId };
}
async function run(host: Host, provider: Provider, projectId: string, taskId: string, steps: Step[], marker: string) {
  provider.setResponder(context => {
    const step = steps[context.recentToolResults.length];
    return step ? { calls: [typeof step === 'function' ? step(context) : step] } : { text: marker };
  });
  const route = `/api/projects/${projectId}/tasks/${taskId}`, requestId = randomUUID();
  await json(await host.request(`${route}/messages`, 'POST', { requestId, text: '请按当前企业获准范围自主查读适用语义与分析资产。本轮仅验证工具协议和准确来源，业务质量另验。' }), 202);
  let state: any; const deadline = Date.now() + 35_000;
  do {
    state = await json(await host.request(route));
    if (state.task.lastRun?.id === requestId && state.snapshot.status === 'idle') break;
    await new Promise(resolve => setTimeout(resolve, 20));
  } while (Date.now() < deadline);
  assert.equal(state.task.lastRun?.status, 'completed', JSON.stringify(state));
  assert.deepEqual(provider.errors, []);
  const lastUser = state.snapshot.messages.findLastIndex((message: any) => message.role === 'user');
  const results = state.snapshot.messages.slice(lastUser + 1).filter((message: any) => message.role === 'toolResult');
  assert.equal(results.length, steps.length);
  assert.equal(results.some((message: any) => message.isError), false, JSON.stringify(results));
  assert.match(JSON.stringify(state.snapshot.messages), new RegExp(marker));
  return { state, results };
}

/** Actual Host and official Pi SDK execution with a deterministic local protocol Provider.
 * This is not real-model reasoning, target-enterprise evidence, or business acceptance. */
test('I07: original Host/Pi tools save and publish three linked asset classes, then an ordinary fresh task discovers and reads exact bodies', { timeout: 90_000 }, async t => {
  const provider = await startToolProvider(); t.after(() => provider.close());
  const host = await startTestHost({ timeoutMs: 10_000 }); t.after(() => host.close());
  await json(await host.request('/api/configuration', 'PUT', { name: 'Foundation synthetic protocol', provider: 'openai-compatible', baseUrl: provider.baseUrl, model: 'synthetic-foundation', apiKey: 'synthetic-foundation-only' }));
  const enterprise = await json(await host.request('/api/studio/enterprises', 'POST', { name: 'Synthetic foundation enterprise' }), 201);
  const policyBody = 'A membership is a program-specific relationship. An eligible relationship is evaluated at a stated policy time.';
  const draft = await json(await host.request('/api/enterprise-materials', 'POST', { title: 'Synthetic approved policy', body: policyBody }), 201);
  const policy = await json(await host.request(`/api/enterprise-materials/${draft.material.id}/enable`, 'POST', { expectedVersion: draft.material.version }));
  await json(await host.request('/api/studio/enterprise-associations', 'POST', { kind: 'asset', authority: 'enterprise', entityId: policy.material.id, enterpriseId: enterprise.id }));
  const policyRef = { authority: 'enterprise', id: policy.material.id, version: policy.material.activeRevisionId, locator: policy.storeId, sha256: createHash('sha256').update(policyBody).digest('hex') };
  const sapBody = JSON.stringify({ sap: '0.2', package: { id: 'foundation-native-sdk', version: '1.0.0', namespace: 'mf.foundation-native-sdk', fingerprint: '' }, dimensions: ['program'], metrics: [{ name: 'eligible_memberships', display_name: 'Synthetic eligible memberships', type: 'simple', definition: 'Count eligible program relationships at the stated policy time; not natural persons.', dimensions: ['program'], time_grains: ['month'], owner_role: 'membership', caliber_switches: { eligible_only: true }, provenance: { origin: 'manual', note: 'Synthetic engineering fixture only.' } }], scenarios: [] });
  const publishedMetric = createMetricLibrary(path.join(host.dataRoot, 'metric-assets')).publish(prepareSapPublication(Buffer.from(sapBody)), 'Synthetic fixture');
  await json(await host.request('/api/studio/enterprise-associations', 'POST', { kind: 'asset', authority: 'sap-metric', entityId: publishedMetric.id, enterpriseId: enterprise.id }));
  const metricRef: StudioSourceRef = { authority: 'sap-metric', id: publishedMetric.id, version: publishedMetric.version, sha256: publishedMetric.bytesSha256 };
  const { project } = await json(await host.request('/api/projects', 'POST', { name: 'Foundation construction owner' }), 201);
  const { system } = await json(await host.request('/api/studio/systems', 'POST', { requestId: randomUUID(), enterpriseId: enterprise.id, projectId: project.id, name: 'Foundation three-asset system', goal: 'Build the approved business scope without a predetermined analysis question.', topicTitle: 'Membership foundation' }), 201);
  const base = { scope: 'Synthetic definition-reference scope only', sources: [policyRef], checks: [{ name: 'Synthetic author policy review', status: 'pass', detail: 'Protocol fixture, not independent verification.' }], readyForPublication: true };
  const savedAssets = (context: ToolProviderContext) => toolValues(context).flatMap(value => value.asset ? [value.asset] : []);
  const masterRef = (context: ToolProviderContext) => assetRef(savedAssets(context)[0], project.id, system.id);
  const built = await run(host, provider, project.id, system.taskId, [
    studioCall('read-source', { ref: policyRef }, system.id),
    studioCall('save-asset', { ...base, kind: 'concept', title: 'Master model', body: JSON.stringify({ contentProfile: 'studio-foundation/1', items: [{ itemId: 'md.membership', kind: 'entity', definition: 'A program-specific membership relationship.', sourceRef: policyRef }] }) }, system.id),
    context => studioCall('read-source', { ref: masterRef(context), itemId: 'md.membership' }, system.id),
    context => studioCall('save-asset', { ...base, kind: 'ontology', title: 'Eligibility ontology', body: JSON.stringify({ contentProfile: 'studio-foundation/1', items: [{ itemId: 'ont.eligible', kind: 'rule', definition: 'A qualification at a stated time.', sourceRef: policyRef }], relations: [{ relationId: 'eligible-relationship', type: 'domain', from: { kind: 'item', itemId: 'ont.eligible' }, to: { kind: 'external-item', itemRef: { sourceRef: masterRef(context), itemId: 'md.membership' } }, evidenceRefs: [policyRef] }] }) }, system.id),
    context => studioCall('save-asset', { ...base, kind: 'business', title: 'Metric system index', body: JSON.stringify({ contentProfile: 'studio-foundation/1', items: [], metricLinks: [{ metricRef: { sourceRef: metricRef, metricName: 'eligible_memberships' } }], relations: [{ relationId: 'metric-object', type: 'analysis-use', from: { kind: 'metric', metricRef: { sourceRef: metricRef, metricName: 'eligible_memberships' } }, to: { kind: 'external-item', itemRef: { sourceRef: masterRef(context), itemId: 'md.membership' } }, evidenceRefs: [policyRef] }] }) }, system.id),
    context => studioCall('prepare-publication', { assetIds: savedAssets(context).map(asset => asset.id), summary: 'Three original linked definition-reference assets', scope: base.scope }, system.id),
  ], 'FOUNDATION_BUILD_PROTOCOL_DONE');
  assert.equal(JSON.parse(built.results[2].details.result.text).itemId, 'md.membership');
  const prepared = built.results.at(-1).details.result.preview;
  const published = await json(await host.request(`/api/studio/systems/${system.id}/publications`, 'POST', { requestId: randomUUID(), previewId: prepared.id, fingerprint: prepared.fingerprint }));
  assert.ok(published.publication.preview.confirmedAt);
  assert.equal(published.system.assets.length, 3);
  assert.ok(published.system.assets.every((asset: any) => asset.formalRevision === 1 && asset.candidateRevision === null));
  assert.deepEqual(published.system.uses, []);
  const identities = new Map(published.system.assets.map((asset: any) => [asset.id, assetRef(asset, project.id, system.id)]));
  const { project: ordinaryProject } = await json(await host.request('/api/projects', 'POST', { name: 'Ordinary enterprise analysis' }), 201);
  await json(await host.request('/api/studio/enterprise-associations', 'POST', { kind: 'project', entityId: ordinaryProject.id, enterpriseId: enterprise.id }));
  const { task } = await json(await host.request(`/api/projects/${ordinaryProject.id}/tasks`, 'POST', { name: 'Ordinary task with no Studio selection' }), 201);
  const directory = (context: ToolProviderContext) => toolValues(context)[0];
  const sourceFromDirectory = (context: ToolProviderContext, title: string): StudioSourceRef => {
    const source = directory(context).items.find((item: any) => item.title === title);
    assert.ok(source?.ref, `the ordinary catalog must supply the formal ${title}`);
    assert.deepEqual(source.ref, identities.get(source.id));
    return source.ref;
  };
  const consumer = await run(host, provider, ordinaryProject.id, task.id, [
    studioCall('catalog'),
    context => studioCall('read-source', { ref: sourceFromDirectory(context, 'Master model'), itemId: 'md.membership' }, directory(context).systems[0].id),
    context => studioCall('read-source', { ref: sourceFromDirectory(context, 'Eligibility ontology'), itemId: 'ont.eligible' }, directory(context).systems[0].id),
    context => studioCall('read-source', { ref: sourceFromDirectory(context, 'Metric system index') }, directory(context).systems[0].id),
    context => { const index = JSON.parse(toolValues(context)[3].text), selected = index.metricLinks[0].metricRef; return studioCall('read-source', { ref: selected.sourceRef, metricName: selected.metricName }); },
  ], 'FOUNDATION_CONSUMPTION_PROTOCOL_DONE');
  assert.equal(JSON.parse(consumer.results[1].details.result.text).itemId, 'md.membership');
  assert.equal(JSON.parse(consumer.results[2].details.result.text).itemId, 'ont.eligible');
  assert.equal(JSON.parse(consumer.results[4].details.result.text).name, 'eligible_memberships');
  assert.equal(consumer.results[4].details.result.ref.sha256, metricRef.sha256);
  const ordinarySnapshot = await json(await host.request(`/api/projects/${ordinaryProject.id}/tasks/${task.id}`));
  assert.deepEqual(ordinarySnapshot.snapshot.messages, consumer.state.snapshot.messages, 'the actual native tool history retains exact bodies, refs and selectors');
  assert.deepEqual((await json(await host.request(`/api/studio/systems/${system.id}`))).system.uses, [], 'actual tool reading still does not assert business use or independent verification');
  await host.close();
  const reopened = await startTestHost({ timeoutMs: 10_000, dataRoot: host.dataRoot, projectsRoot: host.projectsRoot });
  t.after(() => reopened.close());
  const restored = await json(await reopened.request(`/api/projects/${ordinaryProject.id}/tasks/${task.id}`));
  assert.deepEqual(restored.snapshot.messages, consumer.state.snapshot.messages, 'Host restart reloads the original native session instead of regenerating tool evidence');
  assert.equal(restored.task.lastRun.id, consumer.state.task.lastRun.id);
  assert.equal((await json(await reopened.request(`/api/studio/systems/${system.id}`))).system.assets.length, 3);
});
