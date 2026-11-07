import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { StudioStore } from '../extensions/business-plugins/studio/store.ts';
import { studioQuestionContext } from '../extensions/business-plugins/studio/contracts.ts';

function fixture(t: any) { const root = fs.mkdtempSync(path.join(os.tmpdir(), 'optracall-studio-')); t.after(() => fs.rmSync(root, { recursive: true, force: true })); return root; }
const createInput = { name: '合成服饰经营体系', projectId: 'project-one', taskId: 'construction-task', goal: '门店销售与退款金额及期间变化', topicTitle: '销售与退款' };

test('Studio associates one existing construction project/task and can reopen its saved scope without creating on read', t => {
  const root = fixture(t); const store = new StudioStore(root);
  assert.deepEqual(store.list(), []);
  assert.equal(fs.readdirSync(root).length, 0);
  const system = store.create(createInput);
  assert.equal(system.projectId, 'project-one'); assert.equal(system.taskId, 'construction-task');
  assert.equal(system.topics[0].goal, createInput.goal);
  const reopened = new StudioStore(root).get(system.id);
  assert.deepEqual(reopened, system); assert.equal(store.list().length, 1);
});

const source = { authority: 'enterprise' as const, id: 'policy', version: '2', title: '合成退款制度' };
const mapping = { kind: 'binding' as const, title: '退款事件映射', body: 'refund_event_id区分多次退款；同步副本只计一次', scope: '本期成功退款 / 原销售门店', sources: [source], readyForPublication: true, checks: [{ name: '事件身份', status: 'pass' as const, detail: 'R1与R2是不同退款事件' }] };

test('semantic source edits append a candidate under CAS and never create SAP authority', t => {
  const store = new StudioStore(fixture(t)); const system = store.create(createInput);
  const first = store.saveAsset(system.id, mapping);
  assert.equal(first.candidateRevision, 1); assert.equal(first.formalRevision, null);
  const second = store.saveAsset(system.id, { ...mapping, assetId: first.id, expectedRevision: 1, body: '按退款事件去重，支付与退款分别汇总', reason: '补关联放大限制' });
  assert.equal(second.candidateRevision, 2); assert.equal(second.revisions[0].body, mapping.body);
  assert.notEqual(second.revisions[1].sha256, second.revisions[0].sha256);
  assert.throws(() => store.saveAsset(system.id, { ...mapping, assetId: first.id, expectedRevision: 1 }), /studio_asset_conflict/);
  assert.throws(() => store.saveAsset(system.id, { ...mapping, kind: 'sap-metric' as any }), /invalid_studio_asset_kind/);
  assert.equal(store.get(system.id).assets[0].revisions.length, 2);
});

const previewInput = { assetIds: [] as string[], summary: '门店金额与期间变化的确定范围', scope: '本期发生口径', checks: [{ name: '联合核对', status: 'pass' as const, detail: '原文、事件、金额与解释分别核' }], limitations: ['合成材料只证明当前范围'] };

test('publication confirms only the exact prepared source version and leaves adoption, graph and use untouched', t => {
  const store = new StudioStore(fixture(t)); const system = store.create(createInput); const asset = store.saveAsset(system.id, mapping);
  const preview = store.preparePublication(system.id, { ...previewInput, assetIds: [asset.id] });
  store.saveAsset(system.id, { ...mapping, assetId: asset.id, expectedRevision: 1, body: '修订：退款先按事件汇总' });
  assert.throws(() => store.confirmPublication(system.id, preview.id, preview.fingerprint), /studio_publication_changed/);
  const current = store.preparePublication(system.id, { ...previewInput, assetIds: [asset.id] });
  assert.equal(current.items[0].revision, 2);
  const published = store.confirmPublication(system.id, current.id, current.fingerprint);
  assert.equal(published.results[0].module, 'studio-source'); assert.equal(published.results[0].status, 'succeeded');
  const after = store.get(system.id); assert.equal(after.assets[0].formalRevision, 2); assert.equal(after.assets[0].candidateRevision, null);
  assert.deepEqual([after.adoptions, after.graphs, after.uses], [[], [], []]);
  assert.deepEqual(store.confirmPublication(system.id, current.id, current.fingerprint), published);
  assert.equal(store.get(system.id).revision, after.revision);
  assert.equal(store.getPublishedAsset(system.id, asset.id, 2).body, '修订：退款先按事件汇总');
  assert.throws(() => store.getPublishedAsset(system.id, asset.id, 1), /studio_asset_not_published/);
});

test('external publication UNKNOWN is preserved and reconciliation does not replay source publication', t => {
  const store = new StudioStore(fixture(t)); const system = store.create(createInput); const asset = store.saveAsset(system.id, mapping);
  const preview = store.preparePublication(system.id, { ...previewInput, assetIds: [asset.id] }); store.confirmPublication(system.id, preview.id, preview.fingerprint);
  store.recordPublicationResult(system.id, preview.id, { module: 'sap-metric', status: 'unknown', detail: '响应中断，须核原请求', refs: [] });
  store.confirmPublication(system.id, preview.id, preview.fingerprint);
  const result = store.recordPublicationResult(system.id, preview.id, { module: 'sap-metric', status: 'succeeded', detail: '核原请求已发布', refs: [{ authority: 'sap-metric', id: 'retail-sales', version: '1.0.0' }] });
  assert.deepEqual(result.results.map(r => r.status), ['succeeded', 'unknown', 'succeeded']);
  assert.equal(store.get(system.id).publications.length, 1);
});

test('business answers, actual material facts and external refs remain separate from source publication', t => {
  const store = new StudioStore(fixture(t)); const system = store.create(createInput);
  const question = store.setWorkItem(system.id, { topicId: system.currentTopicId, kind: 'question', title: '退款期间支持什么用途？', detail: '制度与旧报表用途不同', impact: '仅影响退款期间比较', nextStep: '集中业务回答', sources: [source], status: 'waiting' });
  store.answerWorkItem(system.id, question.id, '本期发生情况', createHash('sha256').update(studioQuestionContext(question)).digest('hex'));
  store.updateMaterial(system.id, { ref: source, saved: true, readable: true, note: '已保存，尚未实际读取' });
  store.addAssetRef(system.id, { authority: 'sap-method', id: 'store-change', version: '2.1.0' });
  const read = store.get(system.id);
  assert.equal(read.workItems[0].answer, '本期发生情况'); assert.equal(read.materials[0].readAt, undefined);
  assert.equal(read.assetRefs[0].version, '2.1.0'); assert.deepEqual(read.publications, []);
  assert.throws(() => store.update(system.id, { expectedRevision: 1, name: 'stale' }), /studio_conflict/);
});

test('feedback is recorded for continuation, acceptance is not repair, and verified needs actual use evidence', t => {
  const store = new StudioStore(fixture(t)); const system = store.create(createInput);
  const feedback = store.addFeedback(system.id, { title: '退款事件可能漏计', problem: '请核同单两次退款', sources: [source], currentHandling: '原任务已留更正稿', impact: '净额' });
  assert.equal(feedback.status, 'recorded');
  const accepted = store.updateFeedback(system.id, feedback.id, { status: 'accepted', response: '主建设Agent已接手，先核原映射' });
  assert.equal(accepted.status, 'accepted'); assert.equal(store.get(system.id).assets.length, 0);
  assert.throws(() => store.updateFeedback(system.id, feedback.id, { status: 'verified', response: '已解决' }), /studio_feedback_use_evidence_required/);
  const report = { authority: 'task' as const, id: 'report-new', version: '1', projectId: 'analysis-project', taskId: 'analysis-task' };
  const use = store.recordUse(system.id, { projectId: 'analysis-project', taskId: 'analysis-task', report, sources: [source], result: '代表性使用核事件与原正确内容', verification: 'not_assessed' });
  const assessment = { ...report, id: 'separate-assessment' }; store.recordUseAssessment(system.id, use.id, { status: 'pass', report: assessment, sources: [source], result: '明确使用评估证据' });
  assert.equal(store.updateFeedback(system.id, feedback.id, { status: 'verified', response: '按新报告核验', verification: { sources: [report, assessment, source], result: '原漏计已处理，原正确内容未受损' } }).status, 'verified');
});

test('archived construction refuses source and continuation writes but preserves feedback association outside project files', t => {
  const root = fixture(t); let archived = false; const store = new StudioStore(root, { isReadOnly: () => archived }); const system = store.create(createInput); archived = true;
  assert.throws(() => store.saveAsset(system.id, mapping), /studio_project_read_only/);
  const feedback = store.addFeedback(system.id, { title: '归档后新问题', problem: '当前获准分析入口关联', sources: [source] });
  assert.equal(store.get(system.id).feedback[0].status, 'recorded');
  assert.throws(() => store.updateFeedback(system.id, feedback.id, { status: 'accepted', response: '立即完善' }), /studio_project_read_only/);
  assert.deepEqual(store.get(system.id).assets, []);
});

test('topics remain in one system and exact project adoption, graph snapshots, and usage are independent facts', t => {
  const store = new StudioStore(fixture(t)); const system = store.create(createInput);
  const topic = store.addTopic(system.id, { title: '库存（后续）', goal: '后续梳理库存时点', scope: '本轮之外' });
  assert.equal(store.get(system.id).topics.length, 2); assert.equal(store.get(system.id).currentTopicId, system.currentTopicId);
  store.recordAdoption(system.id, { projectId: 'analysis-project', refs: [{ authority: 'sap-metric', id: 'retail-sales', version: '1.0.0' }], status: 'succeeded', detail: '原准确指标包采用回执' });
  assert.deepEqual(store.get(system.id).graphs, []); assert.deepEqual(store.get(system.id).uses, []);
  store.recordGraph(system.id, { snapshotId: 'g-01', sourceRefs: [source], status: 'unknown', detail: '等待实际刷新结果' });
  store.recordGraph(system.id, { snapshotId: 'g-01', sourceRefs: [source], status: 'succeeded', detail: '原请求核对就绪' });
  assert.throws(() => store.recordGraph(system.id, { snapshotId: 'g-01', sourceRefs: [{ ...source, version: '3' }], status: 'succeeded', detail: '改同快照' }), /studio_graph_identity_conflict/);
  const read = store.get(system.id); assert.equal(read.projectId, 'project-one'); assert.equal(read.adoptions.length, 1); assert.deepEqual(read.graphs.map(g => g.status), ['unknown', 'succeeded']);
  assert.equal(topic.status, 'planned');
});

test('a known erroneous formal source stops default supply but can be corrected under its original identity', t => {
  const store = new StudioStore(fixture(t)); const system = store.create(createInput); const asset = store.saveAsset(system.id, mapping);
  const old = store.preparePublication(system.id, { ...previewInput, assetIds: [asset.id] }); store.confirmPublication(system.id, old.id, old.fingerprint);
  store.markAssetIssue(system.id, asset.id, '原映射按订单去重漏掉第二个事件');
  assert.throws(() => store.getPublishedAsset(system.id, asset.id), /studio_asset_restricted/);
  assert.equal(store.getPublishedAsset(system.id, asset.id, 1).revision, 1);
  store.saveAsset(system.id, { ...mapping, assetId: asset.id, expectedRevision: 1, body: '退款按真实事件去重，原支付只计一次' });
  const revision = store.preparePublication(system.id, { ...previewInput, assetIds: [asset.id] }); store.confirmPublication(system.id, revision.id, revision.fingerprint);
  assert.equal(store.getPublishedAsset(system.id, asset.id).revision, 2); assert.equal(store.get(system.id).assets[0].issue?.affectedRevision, 1);
});

test('corrupt and unsafe storage is rejected without repair or overwriting historical files', t => {
  const root = fixture(t); const store = new StudioStore(root); store.create(createInput); const file = path.join(store.root, 'index.json');
  fs.writeFileSync(file, '{"schemaVersion":99,"systems":[]}'); const before = fs.readFileSync(file);
  assert.throws(() => store.list(), /unsupported_studio_storage/); assert.deepEqual(fs.readFileSync(file), before);
  fs.unlinkSync(file); const outside = path.join(root, 'outside.json'); fs.writeFileSync(outside, '{"schemaVersion":1,"systems":[]}'); fs.linkSync(outside, file);
  assert.throws(() => store.list(), /unsafe_studio_storage/); assert.equal(fs.readFileSync(outside, 'utf8'), '{"schemaVersion":1,"systems":[]}');
});

test('reopen rejects changed semantic bytes and forged formal pointers rather than silently repairing sources', t => {
  const root = fixture(t); const store = new StudioStore(root); const system = store.create(createInput); store.saveAsset(system.id, mapping);
  const file = path.join(store.root, 'index.json'); const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  raw.systems[0].assets[0].revisions[0].body = '未经正式保存的改写'; fs.writeFileSync(file, JSON.stringify(raw));
  const modified = fs.readFileSync(file);
  assert.throws(() => new StudioStore(root).get(system.id), /invalid_studio_storage/);
  assert.deepEqual(fs.readFileSync(file), modified);
  raw.systems[0].assets[0].revisions[0].body = mapping.body;
  raw.systems[0].assets[0].formalRevision = 1;
  fs.writeFileSync(file, JSON.stringify(raw));
  assert.throws(() => new StudioStore(root).get(system.id), /invalid_studio_storage/);
});

test('later source issues preserve prior failed-version governance and explicit history reads expose it', t => {
  const store = new StudioStore(fixture(t)); const system = store.create(createInput); const asset = store.saveAsset(system.id, mapping);
  const first = store.preparePublication(system.id, { ...previewInput, assetIds: [asset.id] }); store.confirmPublication(system.id, first.id, first.fingerprint);
  store.markAssetIssue(system.id, asset.id, '首次问题');
  store.saveAsset(system.id, { ...mapping, assetId: asset.id, expectedRevision: 1, body: '第二版映射' });
  const second = store.preparePublication(system.id, { ...previewInput, assetIds: [asset.id] }); store.confirmPublication(system.id, second.id, second.fingerprint);
  store.markAssetIssue(system.id, asset.id, '第二版新问题');
  assert.deepEqual(store.get(system.id).assets[0].issueHistory?.map(i => i.reason), ['首次问题', '第二版新问题']);
  assert.equal(store.getPublishedAsset(system.id, asset.id, 1).issue?.reason, '首次问题');
});

test('an explicit using-project/task association persists without claiming package adoption or actual use', t => {
  const root = fixture(t); const store = new StudioStore(root); const system = store.create(createInput);
  const linked = store.linkUsageProject(system.id, 'analysis-project', 'analysis-task');
  assert.deepEqual(linked.usageProjectIds, ['analysis-project']); assert.deepEqual(linked.usageTasks, [{ projectId: 'analysis-project', taskId: 'analysis-task' }]);
  store.linkUsageProject(system.id, 'analysis-project', 'analysis-task');
  const reopened = new StudioStore(root).get(system.id); assert.equal(reopened.usageTasks?.length, 1); assert.deepEqual(reopened.adoptions, []); assert.deepEqual(reopened.uses, []);
  const file = path.join(store.root, 'index.json'), old = JSON.parse(fs.readFileSync(file, 'utf8')); delete old.systems[0].usageProjectIds; delete old.systems[0].usageTasks; fs.writeFileSync(file, JSON.stringify(old));
  const before = fs.readFileSync(file); assert.deepEqual(new StudioStore(root).get(system.id).usageProjectIds, []); assert.deepEqual(fs.readFileSync(file), before, 'Read compatibility must not migrate or rewrite old records');
});

test('feedback preserves its exact original native owner/use/graph association without rewriting earlier records', t => {
  const root = fixture(t), store = new StudioStore(root), system = store.create(createInput);
  const origin = { projectId: 'usage-project', taskId: 'usage-task', sessionId: 'native-session', messageId: 'native-entry', useId: '11111111-1111-4111-8111-111111111111', graphSnapshotId: 'snapshot-one' };
  const input = { title: '准确使用反馈', problem: '请原体系核这次实际使用的映射边界', sources: [source], origin };
  const recorded = store.addFeedback(system.id, input);
  assert.deepEqual((recorded as any).origin, origin);
  assert.deepEqual((new StudioStore(root).get(system.id).feedback[0] as any).origin, origin);
  const later = store.addFeedback(system.id, { ...input, origin: { ...origin, messageId: 'another-native-entry' } });
  assert.notEqual(later.id, recorded.id, 'Another original native reply must not collapse into an earlier feedback association.');
  assert.deepEqual((store.get(system.id).feedback[0] as any).origin, origin);
  assert.throws(() => store.addFeedback(system.id, { ...input, origin: { ...origin, messageId: '' } }), /invalid_studio_text/);
});

test('use assessments append exact evidence and feedback closes only on the latest matching revised-source use assessment', t => {
  const root = fixture(t), store = new StudioStore(root), system = store.create(createInput);
  const asset = store.saveAsset(system.id, mapping), preview = store.preparePublication(system.id, { ...previewInput, assetIds: [asset.id] }); store.confirmPublication(system.id, preview.id, preview.fingerprint);
  const ref1 = { authority: 'studio-source' as const, id: asset.id, version: '1', sha256: asset.revisions[0].sha256, projectId: createInput.projectId };
  const feedback = store.addFeedback(system.id, { title: '准确反馈', problem: '维护后需实际使用并核验', sources: [ref1] });
  const report = (id: string) => ({ authority: 'task' as const, id, version: '1', projectId: 'analysis-project', taskId: 'analysis-task' });
  const oldUse = store.recordUse(system.id, { projectId: 'analysis-project', taskId: 'analysis-task', report: report('old-report'), sources: [ref1], result: '原准确版本使用', verification: 'not_assessed' });
  const second = store.saveAsset(system.id, { ...mapping, assetId: asset.id, expectedRevision: 1, body: '修订后准确事件映射' }), preview2 = store.preparePublication(system.id, { ...previewInput, assetIds: [asset.id] }); store.confirmPublication(system.id, preview2.id, preview2.fingerprint);
  const ref2 = { ...ref1, version: '2', sha256: second.revisions[1].sha256 };
  store.recordUseAssessment(system.id, oldUse.id, { status: 'pass', report: report('old-assessment'), sources: [ref1], result: '旧版核查，不是新修订使用' });
  assert.throws(() => store.updateFeedback(system.id, feedback.id, { status: 'verified', response: '不能用旧pass关闭新版反馈', verification: { sources: [report('old-report'), report('old-assessment'), ref1], result: '错误闭环尝试' } }), /studio_feedback_use_evidence_required/);
  const use = store.recordUse(system.id, { projectId: 'analysis-project', taskId: 'analysis-task', report: report('new-report'), sources: [ref2], result: '新准确修订的实际使用', verification: 'not_assessed' });
  store.recordUseAssessment(system.id, use.id, { status: 'unknown', report: report('assessment-unknown'), sources: [ref2], result: '尚未核完' });
  const assessed = store.recordUseAssessment(system.id, use.id, { status: 'pass', report: report('new-assessment'), sources: [ref2], result: '准确范围已核，保留最初unknown' });
  assert.equal(assessed.verification, 'not_assessed'); assert.deepEqual(assessed.assessments!.map(a => a.status), ['unknown', 'pass']);
  assert.throws(() => store.updateFeedback(system.id, feedback.id, { status: 'verified', response: '缺实际核验稿', verification: { sources: [report('new-report'), ref2], result: '缺证据不闭环' } }), /studio_feedback_use_evidence_required/);
  assert.equal(store.updateFeedback(system.id, feedback.id, { status: 'verified', response: '准确使用和评估证据分别保留', verification: { sources: [report('new-report'), report('new-assessment'), ref2], result: '新版按准确范围核验' } }).status, 'verified');
  store.recordUseAssessment(system.id, use.id, { status: 'fail', report: report('later-fail'), sources: [ref2], result: '后续复核失败不得被旧pass掩盖' });
  assert.throws(() => store.updateFeedback(system.id, feedback.id, { status: 'verified', response: '最新为fail', verification: { sources: [report('new-report'), report('new-assessment'), ref2], result: '旧pass不能继续作新核验' } }), /studio_feedback_use_evidence_required/);
  const reopened = new StudioStore(root).get(system.id).uses.find(u => u.id === use.id)!;
  assert.equal(reopened.verification, 'not_assessed'); assert.deepEqual((reopened as any).assessments.map((a: any) => a.status), ['unknown', 'pass', 'fail']);
});

test('an empty UNKNOWN graph intent can append its exact first observed snapshot sources without rewriting the original intent', t => {
  const store = new StudioStore(fixture(t)), system = store.create(createInput);
  store.recordGraph(system.id, { snapshotId: 'snapshot-intent', sourceRefs: [], status: 'unknown', detail: '先保存实际构图意图' });
  store.recordGraph(system.id, { snapshotId: 'snapshot-intent', sourceRefs: [source], status: 'succeeded', detail: '同一次快照实际结果' });
  const graphs = store.get(system.id).graphs; assert.equal(graphs.length, 2); assert.deepEqual(graphs[0].sourceRefs, []); assert.deepEqual(graphs[1].sourceRefs, [source]);
  assert.throws(() => store.recordGraph(system.id, { snapshotId: 'snapshot-intent', sourceRefs: [{ ...source, version: '3' }], status: 'succeeded', detail: '成功后不许换源' }), /studio_graph_identity_conflict/);
});
