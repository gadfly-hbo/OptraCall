import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { ProjectStore } from '../src/host/project-store.ts';
import { EnterpriseMaterialsStore } from '../src/host/enterprise-materials-store.ts';
import { StudioStore } from '../extensions/business-plugins/studio/store.ts';
import { createStudioSources } from '../src/host/studio-sources.ts';
const configuration = { id: 'synthetic-model', revision: 1, name: '合成配置', provider: 'synthetic', model: 'synthetic', baseUrl: 'http://127.0.0.1:1' };
async function fixture(t: any) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'studio-sources-')); const dataRoot = path.join(root, 'private');
  const projects = new ProjectStore({ dataRoot, projectsRoot: path.join(root, 'projects') }); await projects.init();
  const enterpriseMaterials = new EnterpriseMaterialsStore(dataRoot), studio = new StudioStore(dataRoot);
  const project = await projects.create({ name: '合成建设项目', configuration });
  t.after(async () => { await projects.close(); await fs.rm(root, { recursive: true, force: true }); });
  return { root, dataRoot, project, projects, enterpriseMaterials, studio, sources: createStudioSources({ dataRoot, projects, enterpriseMaterials, studio }) };
}

test('source inventory exposes enabled exact enterprise metadata and only this project 020 materials without marking any read', async t => {
  const f = await fixture(t); const draft = await f.enterpriseMaterials.create({ title: '退款制度', body: '成功退款归原销售门店', scope: '合成企业' });
  const enabled = await f.enterpriseMaterials.enable(draft.material.id, draft.material.version);
  await f.enterpriseMaterials.create({ title: '未启用草稿', body: '尚未正式启用' });
  const upload = await f.projects.upload({ projectId: f.project.id, name: 'refunds.csv', bytes: Buffer.from('event,amount\nR1,30\nR2,20\n') }); await f.projects.copyToClean(f.project.id, upload.path);
  const inventory = await f.sources.inventory(f.project.id);
  assert.equal(inventory.filter(i => i.ref.authority === 'enterprise').length, 1);
  assert.equal(inventory.filter(i => i.ref.authority === 'data').length, 1);
  assert.equal(inventory.some(i => i.ref.locator?.startsWith('010_draw/')), false);
  assert.equal(inventory.some(i => i.readAt || i.processedAt || i.confirmedAt), false);
  const enterprise = inventory.find(i => i.ref.authority === 'enterprise')!;
  assert.equal((await f.sources.read(enterprise.ref, f.project.id)).text, '成功退款归原销售门店');
  await f.enterpriseMaterials.disable(draft.material.id, enabled.material.version);
  await assert.rejects(() => f.sources.read(enterprise.ref, f.project.id), /studio_source_unavailable/);
});

test('exact project file reads reject changed bytes and never grant another project raw data access', async t => {
  const f = await fixture(t); const upload = await f.projects.upload({ projectId: f.project.id, name: 'events.txt', bytes: Buffer.from('R1=30,R2=20') }); const clean = await f.projects.copyToClean(f.project.id, upload.path);
  const ref = (await f.sources.inventory(f.project.id)).find(i => i.ref.authority === 'data')!.ref;
  assert.equal((await f.sources.read(ref, f.project.id)).text, 'R1=30,R2=20');
  const other = await f.projects.create({ name: '其他分析项目', configuration });
  await assert.rejects(() => f.sources.read(ref, other.id), /studio_source_project_mismatch/);
  await fs.writeFile(path.join(f.project.rootPath, clean.path), 'R1=30,R2=999');
  await assert.rejects(() => f.sources.read(ref, f.project.id), /studio_source_changed/);
});

test('only reviewed formal Studio sources can be shared while withdrawal of original sources remains effective', async t => {
  const f = await fixture(t); const material = await f.enterpriseMaterials.create({ title: '规则来源', body: '退款归原销售门店' }); const enabled = await f.enterpriseMaterials.enable(material.material.id, material.material.version);
  const source = (await f.sources.inventory(f.project.id))[0].ref;
  const task = await f.projects.createTask(f.project.id, { name: '建设任务' });
  const system = f.studio.create({ name: '合成体系', projectId: f.project.id, taskId: task.id, goal: '门店金额', topicTitle: '销售退款' });
  const asset = f.studio.saveAsset(system.id, { kind: 'rule', title: '退款门店归属', body: '成功退款归原销售门店', scope: '合成企业', sources: [source], readyForPublication: true });
  const ref = { authority: 'studio-source' as const, id: asset.id, version: '1', sha256: asset.revisions[0].sha256, projectId: f.project.id };
  await assert.rejects(() => f.sources.read(ref, f.project.id, system.id), /studio_asset_not_published/);
  assert.equal((await f.sources.read(ref, f.project.id, system.id, { construction: true })).text, '成功退款归原销售门店');
  const other = await f.projects.create({ name: '普通分析项目', configuration });
  await assert.rejects(() => f.sources.read(ref, other.id, system.id, { construction: true }), /studio_source_construction_mismatch/);
  const preview = f.studio.preparePublication(system.id, { assetIds: [asset.id], summary: '明确范围', scope: '合成企业' }); f.studio.confirmPublication(system.id, preview.id, preview.fingerprint);
  assert.equal((await f.sources.read(ref, other.id, system.id)).text, '成功退款归原销售门店');
  await f.enterpriseMaterials.disable(material.material.id, enabled.material.version);
  await assert.rejects(() => f.sources.read(ref, other.id, system.id), /studio_source_unavailable/);
});

test('feedback native reply references require a Host reader, current task ownership and exact visible text identity', async t => {
  const f = await fixture(t); const task = await f.projects.createTask(f.project.id, { name: '普通分析任务' }); const body = '合成分析回复：850元';
  const { createHash } = await import('node:crypto'); const hash = createHash('sha256').update(body).digest('hex');
  const ref = { authority: 'task' as const, id: task.id, taskId: task.id, projectId: f.project.id, version: hash, sha256: hash, locator: JSON.stringify({ kind: 'native-reply', sessionId: 'synthetic-session', messageId: 'reply-1' }) };
  await assert.rejects(() => f.sources.read(ref, f.project.id), /studio_source_native_reader_unavailable/);
  const sources = createStudioSources({ ...f, readTaskReply: async () => ({ text: body }) });
  assert.equal((await sources.read(ref, f.project.id)).text, body);
  await assert.rejects(() => sources.read({ ...ref, version: '0'.repeat(64) }, f.project.id), /studio_source_changed/);
  const other = await f.projects.create({ name: '其他项目', configuration });
  await assert.rejects(() => sources.read(ref, other.id), /studio_source_project_mismatch/);
});

test('SAP reads keep exact project package adoption and published-method qualification in their original authorities', async t => {
  const f = await fixture(t); const { createMetricLibrary } = await import('../extensions/business-plugins/metric-factory/library/store.ts');
  const { preparePublication } = await import('../extensions/business-plugins/metric-factory/sap/validate.ts');
  const { createProjectEnablement } = await import('../extensions/business-plugins/metric-factory/project/enablement.ts');
  const { createSapMethodStore } = await import('../extensions/business-plugins/metric-factory/methods/store.ts'); const { randomUUID } = await import('node:crypto');
  const bytes = await fs.readFile(new URL('../extensions/business-plugins/metric-factory/fixtures/membership-repurchase@1.0.0.draft.yaml', import.meta.url));
  const entry = createMetricLibrary(path.join(f.dataRoot, 'metric-assets')).publish(preparePublication(bytes), 'synthetic');
  const metric = { authority: 'sap-metric' as const, id: entry.id, version: entry.version, sha256: entry.bytesSha256 };
  await assert.rejects(() => f.sources.read(metric, f.project.id), /studio_source_not_adopted/);
  createProjectEnablement(path.join(f.dataRoot, 'projects', f.project.id)).enable(entry.id, entry.version);
  assert.match((await f.sources.read(metric, f.project.id)).text, /sap: '0.2'|sap: 0.2|sap: "0.2"/);
  const methods = createSapMethodStore(path.join(f.dataRoot, 'metric-assets')); const saved = methods.save({ requestId: randomUUID(), origin: 'other', title: '门店期间比较', content: { conditions: '同口径与等长期间', logic: '分别核各店及整体变化', judgment: '不将变化当因果', limits: '不推广样例口径' }, sources: [] });
  const method = { authority: 'sap-method' as const, id: saved.method.id, version: '1', sha256: saved.version.contentSha256 };
  await assert.rejects(() => f.sources.read(method, f.project.id), /METHOD_NOT_PUBLISHED/);
  const task = await f.projects.createTask(f.project.id, { name: '建设任务' }); const system = f.studio.create({ name: '合成体系', projectId: f.project.id, taskId: task.id, goal: '门店变化', topicTitle: '销售退款' });
  await assert.rejects(() => f.sources.read(method, f.project.id, system.id, { construction: true }), /studio_source_not_associated/);
  f.studio.addAssetRef(system.id, method);
  assert.match((await f.sources.read(method, f.project.id, system.id, { construction: true })).text, /门店期间比较/);
  methods.publish(saved.method.id, { requestId: randomUUID(), version: 1, expectedSha256: saved.version.contentSha256 });
  assert.match((await f.sources.read(method, f.project.id)).text, /同口径与等长期间/);
  methods.markIssue(saved.method.id, { requestId: randomUUID(), version: 1, expectedRevision: 0, status: 'confirmed', note: '合成已确认错误' });
  await assert.rejects(() => f.sources.read(method, f.project.id), /studio_source_restricted/);
  assert.match(JSON.stringify((await f.sources.read(method, f.project.id, undefined, { historical: true })).governance), /confirmed/);
});

test('RAP reads resolve an exact original release and reject unknown authorities rather than accepting visible labels', async t => {
  const f = await fixture(t); const { createRequirementStore } = await import('../extensions/business-plugins/requirements-elaboration/storage/store.ts'); const { sampleInstance } = await import('./fixtures/requirement-sample.ts');
  const store = createRequirementStore(path.join(f.dataRoot, 'requirement-instances')); const created = store.create({ title: '合成需求', scene: 'topic' }); const base = sampleInstance();
  store.save({ ...base, instance: { ...base.instance, id: created.instance.id, createdAt: created.instance.createdAt } }); store.confirm(store.read(created.instance.id), 'synthetic'); const entry = store.publish(created.instance.id, '1.0.0', 'synthetic');
  assert.match((await f.sources.read({ authority: 'rap', id: created.instance.id, version: '1.0.0', sha256: entry.packageFingerprint.slice(7) }, f.project.id)).text, /0.2/);
  await assert.rejects(() => f.sources.read({ authority: 'rap', id: created.instance.id, version: '9.9.9' }, f.project.id), /REQ_STORE_NOT_FOUND/);
  await assert.rejects(() => f.sources.read({ authority: 'case', id: 'visible-label', version: '1' }, f.project.id), /studio_source_unsupported/);
});

test('inventory metadata does not scan unrelated enterprise bodies', async t => {
  const f = await fixture(t); const good = await f.enterpriseMaterials.create({ title: '本轮制度', body: '当前准确正文' }); await f.enterpriseMaterials.enable(good.material.id, good.material.version);
  const unrelated = await f.enterpriseMaterials.create({ title: '无关资料', body: '原无关正文' }); const enabled = await f.enterpriseMaterials.enable(unrelated.material.id, unrelated.material.version);
  await fs.writeFile(enabled.material.revisions[0].bodyPath, '损坏的无关正文');
  const inventory = await f.sources.inventory(f.project.id); const selected = inventory.find(i => i.ref.id === good.material.id)!;
  assert.equal(inventory.length, 2); assert.equal((await f.sources.read(selected.ref, f.project.id)).text, '当前准确正文');
});

test('known erroneous exact history remains inspectable with governance while default supply and withdrawn dependencies stay blocked', async t => {
  const f = await fixture(t), material = await f.enterpriseMaterials.create({ title: '合成准确制度', body: '退款归原门店' });
  const enabled = await f.enterpriseMaterials.enable(material.material.id, material.material.version), ref = (await f.sources.inventory(f.project.id))[0].ref;
  const task = await f.projects.createTask(f.project.id, { name: '建设任务' }), system = f.studio.create({ name: '准确历史体系', projectId: f.project.id, taskId: task.id, topicTitle: '销售退款', goal: '保留准确旧版' });
  const input = { kind: 'rule' as const, title: '退款归属', body: '旧版正式源正文', scope: '合成企业', sources: [ref], readyForPublication: true };
  const asset = f.studio.saveAsset(system.id, input), preview = f.studio.preparePublication(system.id, { assetIds: [asset.id], summary: '准确版本', scope: '合成企业' });
  f.studio.confirmPublication(system.id, preview.id, preview.fingerprint); f.studio.markAssetIssue(system.id, asset.id, '合成已确认错误；待关联修订');
  const sourceRef = { authority: 'studio-source' as const, id: asset.id, version: '1', sha256: asset.revisions[0].sha256, projectId: f.project.id };
  await assert.rejects(() => f.sources.read(sourceRef, f.project.id, system.id), /studio_source_restricted/);
  const historical = await f.sources.read(sourceRef, f.project.id, system.id, { historical: true });
  assert.equal(historical.text, '旧版正式源正文'); assert.match(JSON.stringify(historical.governance), /合成已确认错误/);
  const candidate = f.studio.saveAsset(system.id, { ...input, assetId: asset.id, expectedRevision: 1, body: '未发布修订候选' });
  await assert.rejects(() => f.sources.read({ ...sourceRef, version: '2', sha256: candidate.revisions[1].sha256 }, f.project.id, system.id, { historical: true }), /studio_asset_not_published/);
  await f.enterpriseMaterials.disable(material.material.id, enabled.material.version);
  await assert.rejects(() => f.sources.read(sourceRef, f.project.id, system.id, { historical: true }), /studio_source_unavailable/);
});

test('a Studio source dependency cannot bypass the using project exact SAP package adoption', async t => {
  const f = await fixture(t), { createMetricLibrary } = await import('../extensions/business-plugins/metric-factory/library/store.ts'), { preparePublication } = await import('../extensions/business-plugins/metric-factory/sap/validate.ts'), { createProjectEnablement } = await import('../extensions/business-plugins/metric-factory/project/enablement.ts');
  const sapBytes = await fs.readFile(new URL('../extensions/business-plugins/metric-factory/fixtures/membership-repurchase@1.0.0.draft.yaml', import.meta.url));
  const entry = createMetricLibrary(path.join(f.dataRoot, 'metric-assets')).publish(preparePublication(sapBytes), 'synthetic');
  const metricRef = { authority: 'sap-metric' as const, id: entry.id, version: entry.version, sha256: entry.bytesSha256 };
  const material = await f.enterpriseMaterials.create({ title: '合成准确制度', body: '本期净额按原准确指标计算' }); await f.enterpriseMaterials.enable(material.material.id, material.material.version);
  const ref = (await f.sources.inventory(f.project.id))[0].ref, task = await f.projects.createTask(f.project.id, { name: '建设任务' });
  const system = f.studio.create({ name: 'SAP依赖体系', projectId: f.project.id, taskId: task.id, topicTitle: '销售退款', goal: '原SAP依赖资格' });
  const asset = f.studio.saveAsset(system.id, { kind: 'rule', title: '引用准确指标的规则', body: '只按原准确SAP版本解释本期净额', scope: '合成企业', sources: [ref], dependencies: [metricRef], readyForPublication: true });
  const preview = f.studio.preparePublication(system.id, { assetIds: [asset.id], summary: '精确原指标依赖', scope: '合成企业' }); f.studio.confirmPublication(system.id, preview.id, preview.fingerprint);
  const sourceRef = { authority: 'studio-source' as const, id: asset.id, version: '1', sha256: asset.revisions[0].sha256, projectId: f.project.id };
  assert.match((await f.sources.read(sourceRef, f.project.id, system.id, { construction: true })).text, /原准确SAP/);
  const other = await f.projects.create({ name: '普通使用项目', configuration });
  await assert.rejects(() => f.sources.read(sourceRef, other.id, system.id), /studio_source_not_adopted/);
  const enablement = createProjectEnablement(path.join(f.dataRoot, 'projects', other.id)); enablement.enable(entry.id, '9.9.9');
  await assert.rejects(() => f.sources.read(sourceRef, other.id, system.id), /studio_source_not_adopted/);
  enablement.enable(entry.id, entry.version); assert.match((await f.sources.read(sourceRef, other.id, system.id)).text, /原准确SAP/);
});

test('only the real construction owner can reread exact task report/native references already retained in feedback, without extending raw data access', async t => {
  const f = await fixture(t), { createHash } = await import('node:crypto');
  const task = await f.projects.createTask(f.project.id, { name: '建设任务' }), system = f.studio.create({ name: '反馈接手体系', projectId: f.project.id, taskId: task.id, topicTitle: '销售退款', goal: '准确原任务接手' });
  const other = await f.projects.create({ name: '普通使用项目', configuration }), usingTask = await f.projects.createTask(other.id, { name: '普通任务' });
  const body = '合成原生分析回复：待原体系核映射', bodySha = createHash('sha256').update(body).digest('hex');
  const native = { authority: 'task' as const, id: usingTask.id, taskId: usingTask.id, projectId: other.id, version: bodySha, sha256: bodySha, locator: JSON.stringify({ kind: 'native-reply', sessionId: 'native-synthetic', messageId: 'reply-one' }) };
  const reportBody = '合成报告原文，保留准确来源', reportSha = createHash('sha256').update(reportBody).digest('hex');
  await fs.writeFile(path.join(other.rootPath, '060_reports', 'feedback.txt'), reportBody);
  const report = { authority: 'task' as const, id: usingTask.id, taskId: usingTask.id, projectId: other.id, version: reportSha, sha256: reportSha, locator: '060_reports/feedback.txt' };
  const upload = await f.projects.upload({ projectId: other.id, name: 'private-events.txt', bytes: Buffer.from('foreign raw rows remain private') }); await f.projects.copyToClean(other.id, upload.path);
  const raw = (await f.sources.inventory(other.id)).find(m => m.ref.authority === 'data')!.ref;
  let nativeReads = 0;
  const sources = createStudioSources({ ...f, readTaskReply: async (projectId, taskId, selection) => { assert.equal(projectId, other.id); assert.equal(taskId, usingTask.id); assert.equal(selection.messageId, 'reply-one'); nativeReads++; return { text: body }; } });
  await assert.rejects(() => sources.read(native, f.project.id, system.id, { construction: true }), /studio_source_project_mismatch/);
  f.studio.addFeedback(system.id, { title: '准确原反馈', problem: '请原体系接手核来源', sources: [native, report, raw] });
  assert.equal((await sources.read(native, f.project.id, system.id, { construction: true })).text, body);
  assert.equal((await sources.read(report, f.project.id, system.id, { construction: true })).text, reportBody); assert.equal(nativeReads, 1);
  await assert.rejects(() => sources.read(raw, f.project.id, system.id, { construction: true }), /studio_source_project_mismatch/);
  await assert.rejects(() => sources.read(native, f.project.id, system.id), /studio_source_project_mismatch/);
  await assert.rejects(() => sources.read({ ...native, locator: JSON.stringify({ kind: 'native-reply', sessionId: 'native-synthetic', messageId: 'unrelated-reply' }) }, f.project.id, system.id, { construction: true }), /studio_source_project_mismatch/);
  await fs.writeFile(path.join(other.rootPath, '060_reports', 'feedback.txt'), 'changed report');
  await assert.rejects(() => sources.read(report, f.project.id, system.id, { construction: true }), /studio_source_changed/);
});

test('construction can inspect exact reports already retained in system uses and appended assessments without arbitrary task access', async t => {
  const f = await fixture(t), { createHash } = await import('node:crypto');
  const task = await f.projects.createTask(f.project.id, { name: '建设任务' }), system = f.studio.create({ name: '准确使用评估体系', projectId: f.project.id, taskId: task.id, topicTitle: '销售退款', goal: '接手真实使用评估证据' });
  const usingProject = await f.projects.create({ name: '使用项目', configuration }), usingTask = await f.projects.createTask(usingProject.id, { name: '实际使用任务' });
  const reportRef = async (name: string, body: string) => { await fs.writeFile(path.join(usingProject.rootPath, '060_reports', name), body); const hash = createHash('sha256').update(body).digest('hex'); return { authority: 'task' as const, id: usingTask.id, taskId: usingTask.id, projectId: usingProject.id, locator: `060_reports/${name}`, version: hash, sha256: hash }; };
  const usedReport = await reportRef('used.txt', '准确实际使用稿'), assessedReport = await reportRef('assessed.txt', '准确评估稿'), unrelated = await reportRef('unrelated.txt', '其他报告不可获得授权');
  await assert.rejects(() => f.sources.read(usedReport, f.project.id, system.id, { construction: true }), /studio_source_project_mismatch/);
  const use = f.studio.recordUse(system.id, { projectId: usingProject.id, taskId: usingTask.id, report: usedReport, sources: [], result: '实际使用声明', verification: 'not_assessed' });
  assert.equal((await f.sources.read(usedReport, f.project.id, system.id, { construction: true })).text, '准确实际使用稿');
  await assert.rejects(() => f.sources.read(assessedReport, f.project.id, system.id, { construction: true }), /studio_source_project_mismatch/);
  f.studio.recordUseAssessment(system.id, use.id, { status: 'unknown', report: assessedReport, sources: [], result: '准确评估证据，不改变初始声明' });
  assert.equal((await f.sources.read(assessedReport, f.project.id, system.id, { construction: true })).text, '准确评估稿');
  await assert.rejects(() => f.sources.read(unrelated, f.project.id, system.id, { construction: true }), /studio_source_project_mismatch/);
  await assert.rejects(() => f.sources.read(assessedReport, f.project.id, system.id), /studio_source_project_mismatch/);
});

test('construction reads only its exactly registered original SAP candidate while ordinary supply still requires formal adoption', async t => {
  const f = await fixture(t), { preparePublication } = await import('../extensions/business-plugins/metric-factory/sap/validate.ts');
  const bytes = await fs.readFile(new URL('../extensions/business-plugins/metric-factory/fixtures/membership-repurchase@1.0.0.draft.yaml', import.meta.url));
  await fs.writeFile(path.join(f.project.rootPath, '020_clean', 'candidate.yaml'), bytes);
  const prepared = preparePublication(bytes), task = await f.projects.createTask(f.project.id, { name: '建设任务' }), system = f.studio.create({ name: '原指标候选体系', projectId: f.project.id, taskId: task.id, topicTitle: '指标', goal: '读取已保存准确候选' });
  const ref = { authority: 'sap-metric' as const, id: prepared.document.package.id, version: prepared.document.package.version, sha256: prepared.bytesSha256, projectId: f.project.id, locator: '020_clean/candidate.yaml' };
  await assert.rejects(() => f.sources.read(ref, f.project.id, system.id, { construction: true }));
  f.studio.addAssetRef(system.id, ref); assert.equal((await f.sources.read(ref, f.project.id, system.id, { construction: true })).text, prepared.canonicalYaml);
  await assert.rejects(() => f.sources.read(ref, f.project.id, system.id), /studio_source_not_adopted/);
  await fs.writeFile(path.join(f.project.rootPath, '020_clean', 'candidate.yaml'), bytes.toString().replace('会员复购', '已变更指标'));
  await assert.rejects(() => f.sources.read(ref, f.project.id, system.id, { construction: true }));
});

test('corrupt original enterprise body revokes a derived Studio rule even while its metadata remains enabled', async t => {
  const f = await fixture(t), material = await f.enterpriseMaterials.create({ title: '准确制度', body: '原企业制度正文' }), enabled = await f.enterpriseMaterials.enable(material.material.id, material.material.version);
  const ref = (await f.sources.inventory(f.project.id))[0].ref, task = await f.projects.createTask(f.project.id, { name: '建设任务' }), system = f.studio.create({ name: '原文完整性体系', projectId: f.project.id, taskId: task.id, topicTitle: '销售退款', goal: '不以metadata冒充正文完整性' });
  const asset = f.studio.saveAsset(system.id, { kind: 'rule', title: '派生规则', body: '按准确原制度解释', scope: '合成企业', sources: [ref], readyForPublication: true }), preview = f.studio.preparePublication(system.id, { assetIds: [asset.id], summary: '准确来源', scope: '合成企业' }); f.studio.confirmPublication(system.id, preview.id, preview.fingerprint);
  const sourceRef = { authority: 'studio-source' as const, id: asset.id, version: '1', sha256: asset.revisions[0].sha256, projectId: f.project.id };
  assert.match((await f.sources.read(sourceRef, f.project.id, system.id)).text, /准确原制度/);
  await fs.writeFile(enabled.material.revisions[0].bodyPath, 'corrupt body despite unchanged metadata');
  await assert.rejects(() => f.sources.read(sourceRef, f.project.id, system.id), /enterprise|studio_source_changed/);
});

test('construction inherits exact own-system candidate dependencies through multiple source levels and original unpublished methods without changing ordinary supply', async t => {
  const f = await fixture(t), { createSapMethodStore } = await import('../extensions/business-plugins/metric-factory/methods/store.ts'), { randomUUID } = await import('node:crypto');
  const material = await f.enterpriseMaterials.create({ title: '合成制度', body: '退款按准确事件解释' }); await f.enterpriseMaterials.enable(material.material.id, material.material.version);
  const ref = (await f.sources.inventory(f.project.id))[0].ref, task = await f.projects.createTask(f.project.id, { name: '建设任务' }), system = f.studio.create({ name: '集中候选依赖体系', projectId: f.project.id, taskId: task.id, topicTitle: '销售退款', goal: '连续建设后集中预览' });
  const methods = createSapMethodStore(path.join(f.dataRoot, 'metric-assets')), method = methods.save({ requestId: randomUUID(), origin: 'other', title: '原库方法候选', content: { conditions: '准确事件', logic: '按原规则核', judgment: '限定范围', limits: '合成方法' }, sources: [] });
  const methodRef = { authority: 'sap-method' as const, id: method.method.id, version: String(method.version.version), sha256: method.version.contentSha256 }; f.studio.addAssetRef(system.id, methodRef);
  const input = { kind: 'rule' as const, title: '基础候选A', body: 'A准确候选', scope: '合成企业', sources: [ref], readyForPublication: true };
  const a = f.studio.saveAsset(system.id, input), sourceRef = (asset: typeof a) => ({ authority: 'studio-source' as const, id: asset.id, version: '1', sha256: asset.revisions[0].sha256, projectId: f.project.id });
  const b = f.studio.saveAsset(system.id, { ...input, title: '中间候选B', body: 'B依赖A和原方法候选', dependencies: [sourceRef(a), methodRef] });
  const c = f.studio.saveAsset(system.id, { ...input, title: '上层候选C', body: 'C依赖B', dependencies: [sourceRef(b)] });
  assert.equal((await f.sources.read(sourceRef(c), f.project.id, system.id, { construction: true })).text, 'C依赖B');
  await assert.rejects(() => f.sources.read(sourceRef(c), f.project.id, system.id), /studio_asset_not_published/);
  const other = await f.projects.create({ name: '其他项目', configuration });
  await assert.rejects(() => f.sources.read(sourceRef(c), other.id, system.id, { construction: true }), /studio_source_construction_mismatch/);
  // Trusted-store corruption/future-reference defense: exact revision recursion must still stop.
  const loopB = f.studio.saveAsset(system.id, { ...input, title: '循环B', dependencies: [{ authority: 'studio-source', id: a.id, version: '2', projectId: f.project.id }] });
  const loopA = f.studio.saveAsset(system.id, { ...input, assetId: a.id, expectedRevision: 1, dependencies: [sourceRef(loopB)] });
  await assert.rejects(() => f.sources.read({ ...sourceRef(loopA), version: '2', sha256: loopA.revisions[1].sha256 }, f.project.id, system.id, { construction: true }), /studio_source_dependency_cycle/);

});
