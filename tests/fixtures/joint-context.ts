import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { sampleWithoutSnapshotExport } from './requirement-sample.ts';
import type { startTestHost } from './host-process.ts';

type Host = Pick<Awaited<ReturnType<typeof startTestHost>>, 'baseUrl' | 'request'>;
export async function readJson(response: Response, status = 200): Promise<any> {
  assert.equal(response.status, status, await response.clone().text());
  return response.json();
}

/** Only synthetic fixtures: real Host APIs, with drafts written as an Agent would. */
export async function prepareJointContext(host: Host, providerUrl: string) {
  const url = new URL(host.baseUrl);
  assert.equal(url.hostname, '127.0.0.1');
  assert.ok(url.port && !['4173', '4174'].includes(url.port), 'Never prepare this fixture in a user Host');
  await readJson(await host.request('/api/configuration', 'PUT', {
    name: 'RAP SAP Case synthetic', provider: 'openai-compatible', baseUrl: providerUrl,
    model: 'synthetic-joint-context', apiKey: 'synthetic-only-joint-key',
  }));
  const { project } = await readJson(await host.request('/api/projects', 'POST', { name: '三类背景原项目' }), 201);
  assert.ok(project.rootPath.includes('optracall-host-test-'), 'Fixture files must stay in the test root');
  const input = 'id,value\nsynthetic-a,1\n';
  await readJson(await host.request(`/api/projects/${project.id}/files/upload`, 'POST', {
    name: 'joint-input.csv', directory: '020_clean', content: Buffer.from(input).toString('base64'),
  }), 201);

  const rawSap = await readFile(new URL('../../extensions/business-plugins/metric-factory/fixtures/membership-repurchase@1.0.0.draft.yaml', import.meta.url), 'utf8');
  const reviewedSap = rawSap.replaceAll('reviewed_by: huangbo', 'reviewed_by: synthetic-reviewer');
  const draftPath = '020_clean/joint.sap.yaml';
  await writeFile(path.join(project.rootPath, draftPath), reviewedSap);
  const sap = await readJson(await host.request('/api/metric-factory/publish', 'POST', {
    projectId: project.id, path: draftPath, publishedBy: 'synthetic-reviewer',
  }), 201);
  const newerSap = reviewedSap.replace('version: 1.0.0', 'version: 1.1.0').replace('指定时间窗口内', 'RR07_NEWER_SAP_ONLY 指定时间窗口内');
  await writeFile(path.join(project.rootPath, '020_clean/joint-newer.sap.yaml'), newerSap);
  await readJson(await host.request('/api/metric-factory/publish', 'POST', {
    projectId: project.id, path: '020_clean/joint-newer.sap.yaml', publishedBy: 'synthetic-reviewer',
  }), 201);
  await readJson(await host.request(`/api/metric-factory/projects/${project.id}/enable`, 'POST', {
    packageId: sap.entry.id, version: '1.0.0',
  }));
  const { task } = await readJson(await host.request(`/api/projects/${project.id}/tasks`, 'POST', { name: '三类背景原任务' }), 201);

  await readJson(await host.request('/api/cases/storage/initialize', 'POST', {}));
  let record = (await readJson(await host.request('/api/cases', 'POST', {
    operationId: randomUUID(), title: 'RR07_CASE_销售与毛利', description: 'RR07_CASE_SOURCE_合成事项背景',
  }), 201)).case;
  record = (await readJson(await host.request(`/api/cases/${record.id}/projects`, 'POST', {
    operationId: randomUUID(), expectedRevision: record.revision, projectId: project.id,
  }))).case;
  const work = (await readJson(await host.request(`/api/projects/${project.id}/work`, 'PATCH', {
    operationId: randomUUID(), expectedRevision: 0, workStatus: 'in_progress',
    workScope: 'RR07_PROJECT_SCOPE_只分析合成资料', assignee: 'synthetic-analyst',
    nextStep: '核对三类背景，不执行业务动作', statusReason: null,
  }))).work;
  const staleCaseContext = { caseId: record.id, caseRevision: record.revision, projectWorkRevision: work.revision, selectedReferenceIds: [] };
  record = (await readJson(await host.request(`/api/cases/${record.id}`, 'PATCH', {
    operationId: randomUUID(), expectedRevision: record.revision, title: record.title,
    description: record.description, judgement: 'RR07_CASE_CURRENT_JUDGEMENT_未确定原因', nextStep: '核对口径与反证',
  }))).case;
  const caseContext = { ...staleCaseContext, caseRevision: record.revision };

  const created = await readJson(await host.request('/api/requirement-instances', 'POST', { title: 'RR07_RAP_独立需求', scene: 'topic' }), 201);
  const id = created.instance.id;
  const detail = await readJson(await host.request(`/api/requirement-instances/${id}`));
  const sample = sampleWithoutSnapshotExport();
  const instance = {
    ...sample, instance: detail.instance.instance,
    context: { ...sample.context, goal: 'RR07_RAP_1_9_GOAL_保持历史版本' },
    framework: { ...sample.framework!, metrics: sample.framework!.metrics.map((metric, index) =>
      index === 0 ? { ...metric, definition: 'RR07_RAP_1_9_DEFINITION' } : metric) },
  };
  await readJson(await host.request(`/api/requirement-instances/${id}`, 'PATCH', { instance }));
  await readJson(await host.request(`/api/requirement-instances/${id}/confirm`, 'POST', { confirmedBy: 'synthetic-reviewer' }));
  await readJson(await host.request(`/api/requirement-instances/${id}/publish`, 'POST', { version: '1.9.0', releasedBy: 'synthetic-reviewer' }), 201);
  const next = await readJson(await host.request(`/api/requirement-instances/${id}`));
  next.instance.framework.metrics[0].definition = 'RR07_RAP_1_10_DEFINITION_NOT_SELECTED';
  await readJson(await host.request(`/api/requirement-instances/${id}`, 'PATCH', { instance: next.instance }));
  await readJson(await host.request(`/api/requirement-instances/${id}/publish`, 'POST', { version: '1.10.0', releasedBy: 'synthetic-reviewer' }), 201);
  const edited = await readJson(await host.request(`/api/requirement-instances/${id}`));
  edited.instance.context.goal = 'RR07_LATER_DRAFT_NOT_SELECTED';
  await readJson(await host.request(`/api/requirement-instances/${id}`, 'PATCH', { instance: edited.instance }));
  return { project, task, case: record, caseContext, staleCaseContext,
    requirementContext: { instanceId: id, version: '1.9.0' }, sap: sap.entry, input };
}
