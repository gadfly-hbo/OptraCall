import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { ProjectStore, type ProjectConfiguration } from '../src/host/project-store.ts';
import { ProjectDataContextStore } from '../src/host/project-data-context-store.ts';
import { EnterpriseMaterialsStore } from '../src/host/enterprise-materials-store.ts';
import { CaseStore } from '../src/host/case-store.ts';
import { SemanticContextService } from '../src/host/semantic-context-service.ts';
import { createRequirementFrameworkSources } from '../src/host/requirement-framework-sources.ts';
import { createSapMethodStore } from '../extensions/business-plugins/metric-factory/methods/store.ts';
import { AgentCandidateControls } from '../src/host/agent-candidate-controls.ts';
import { createPersonalContextReader } from '../src/host/personal-context-reader.ts';
import { PersonalRetentionStore } from '../src/host/personal-retention-store.ts';
import { createMetricLibrary } from '../extensions/business-plugins/metric-factory/library/store.ts';
import { preparePublication } from '../extensions/business-plugins/metric-factory/sap/validate.ts';

const evidenceRoot = path.resolve('.local/fourbase-modules/m7-l1-semantic-trace/implementation/read-service');
const config: ProjectConfiguration = { id: 'synthetic', revision: 1, name: 'Synthetic', provider: 'synthetic', model: 'synthetic', baseUrl: 'http://127.0.0.1' };
const sha = (bytes: string | Buffer) => createHash('sha256').update(bytes).digest('hex');
const toolContext = () => ({ signal: new AbortController().signal, requestId: 'synthetic-framework-run', sessionId: 'synthetic-framework-session', toolCallId: 'synthetic-tool-call', assertCurrent: () => {} });
async function fixture(t: { after(fn: () => Promise<void>): void }) {
  await fs.mkdir(evidenceRoot, { recursive: true });
  const root = await fs.mkdtemp(path.join(evidenceRoot, 'fixture-'));
  const projects = new ProjectStore({ dataRoot: path.join(root, 'data'), projectsRoot: path.join(root, 'projects') }); await projects.init();
  const project = await projects.create({ name: 'Synthetic L1', configuration: config });
  const task = await projects.createTask(project.id, { name: 'Original task', configuration: config });
  const data = new ProjectDataContextStore({ dataRoot: projects.dataRoot, projects });
  const enterprise = new EnterpriseMaterialsStore(projects.dataRoot), cases = new CaseStore({ dataRoot: projects.dataRoot });
  const service = new SemanticContextService({ projects, data, enterprise, cases });
  t.after(async () => { await projects.close(); });
  return { root, projects, project, taskId: task.id, data, enterprise, cases, service };
}

test('RAF-A1/A4: published SAP and enabled enterprise reads pin exact versions; catalog entries and withdrawn bodies cannot serve as evidence', async t => {
  const f = await fixture(t), metricLibrary = createMetricLibrary(path.join(f.projects.dataRoot, 'metric-assets')), methodLibrary = createSapMethodStore(path.join(f.projects.dataRoot, 'metric-assets'));
  const raw = await fs.readFile('extensions/business-plugins/metric-factory/fixtures/membership-repurchase@1.0.0.draft.yaml', 'utf8');
  const first = metricLibrary.publish(preparePublication(Buffer.from(raw)), 'Synthetic publisher');
  const draft = await methodLibrary.save({ requestId: randomUUID(), origin: 'other', title: 'SYNTHETIC_UNPUBLISHED_METHOD', sources: [],
    content: { conditions: 'Same store', logic: 'Cohort comparison', judgment: 'Needs data', limits: 'Not causation' } });
  const published = await methodLibrary.save({ requestId: randomUUID(), origin: 'other', title: 'Published cohort method', sources: [],
    content: { conditions: 'Stable definition', logic: 'SYNTHETIC_PUBLISHED_METHOD', judgment: 'Check denominator', limits: 'Partial period' } });
  await methodLibrary.publish(published.method.id, { requestId: randomUUID(), version: 1, expectedSha256: published.version.contentSha256 });
  const material = await f.enterprise.create({ title: 'Synthetic currently approved concept', body: 'SYNTHETIC_ENTERPRISE_BODY' });
  const enabled = await f.enterprise.enable(material.material.id, material.material.version);
  const enterprise = { kind: 'enterprise' as const, storeId: enabled.storeId, materialId: material.material.id, revisionId: enabled.material.activeRevisionId! };
  const semantic = new SemanticContextService({ ...f.service.options, metricLibrary, methodLibrary });
  const sources = createRequirementFrameworkSources({ semantic: () => semantic, experienceLearningEnabled: true }), operation = sources.begin();
  const catalog = await operation.read('find', { kinds: ['sap', 'sap-method', 'enterprise'] }, toolContext());
  assert.match(catalog.content[0]!.text, /Published cohort method/);
  assert.doesNotMatch(catalog.content[0]!.text, /SYNTHETIC_UNPUBLISHED_METHOD|SYNTHETIC_ENTERPRISE_BODY|frameworkSourceIds/);
  assert.deepEqual(operation.references(), []);
  const unavailable = await operation.read('read', { target: { kind: 'sap-method', methodId: draft.method.id, version: 1 } }, toolContext());
  assert.doesNotMatch(unavailable.content[0]!.text, /SYNTHETIC_UNPUBLISHED_METHOD|frameworkSourceIds/);
  const sap = { kind: 'sap', packageId: first.id, version: first.version, publishedHash: first.bytesSha256 };
  const read = await operation.read('read', { target: sap }, toolContext());
  assert.match(read.content[0]!.text, /frameworkSourceIds/);
  await operation.read('read', { target: enterprise }, toolContext());
  const [sapRef, conceptRef] = operation.references();
  assert.ok(sapRef && conceptRef);
  assert.deepEqual(sapRef.target, sap);
  assert.equal(sapRef.version, '1.0.0');
  assert.equal(conceptRef.digest, sha('SYNTHETIC_ENTERPRISE_BODY'));
  assert.deepEqual(sources.begin().references([sapRef.id]), [], 'no receipt from a previous operation can be reused as current');
  metricLibrary.publish(preparePublication(Buffer.from(raw.replace('version: 1.0.0', 'version: 1.1.0').replace('复购会员数', '重复购买会员数'))), 'Synthetic publisher');
  assert.deepEqual(await sources.revalidate([sapRef, conceptRef]), [], 'an unrelated newer release preserves the approved old identity');
  await f.enterprise.disable(material.material.id, enabled.material.version);
  assert.deepEqual(await sources.revalidate([sapRef, conceptRef]), [{ id: conceptRef.id, status: 'unavailable' }]);
  const revoked = await sources.begin().read('read', { target: enterprise }, toolContext());
  assert.doesNotMatch(JSON.stringify(revoked), /SYNTHETIC_ENTERPRISE_BODY|Synthetic currently approved concept|frameworkSourceIds/);
});

test('RAF-A1/A4: prior case records are accessible; a project report or input needs a separate exact grant', async t => {
  const f = await fixture(t);
  await f.cases.initialize();
  t.after(async () => f.cases.close());
  const content = Buffer.from('value\nSYNTHETIC_AUTHORIZED_DATA\n');
  const file = await f.projects.upload({ projectId: f.project.id, name: 'records.csv', bytes: content, directory: '020_clean' });
  const inputVersionId = randomUUID(), datasetId = randomUUID();
  await f.data.freezeInput(f.project.id, { operationId: inputVersionId, inputVersionId, datasetId, baseIndexRevision: 0, name: 'Authorized data', sourcePath: file.path, expectedSha256: file.sha256, expectedBytes: file.bytes });
  const inputTarget = { kind: 'data-input' as const, projectId: f.project.id, datasetId, inputVersionId };
  const reportPath = '060_reports/historical.md', report = '# SYNTHETIC_PRIVATE_REPORT';
  await fs.writeFile(path.join(f.project.rootPath, reportPath), report);
  const citationId = randomUUID();
  await f.data.createCitation(f.project.id, { operationId: citationId, citationId, baseIndexRevision: 1, report: { path: reportPath, sha256: sha(report), bytes: Buffer.byteLength(report) }, attachments: [],
    selections: [{ datasetId, inputVersionId, descriptionRevisionId: null }], conceptRefs: [], sapRefs: [], declarer: 'user', declaration: 'Retrospective with no control' });
  const reportTarget = { kind: 'data-evidence' as const, projectId: f.project.id, citationId, attachmentIndex: null };
  const history = f.cases.createCase({ operationId: randomUUID(), title: 'Synthetic cohort case' }), caseStoreId = f.cases.getStatus().storeId!;
  f.cases.linkProject({ operationId: randomUUID(), caseId: history.id, projectId: f.project.id, expectedRevision: 1 });
  const saved = f.cases.saveDecisionDraft({ operationId: randomUUID(), caseStoreId, caseId: history.id, expectedRevision: 0, kind: 'strategy',
    payload: { title: 'Compare comparable cohorts', proposal: 'SYNTHETIC_CASE_PAST_STRATEGY', conditions: 'Equal time windows' },
    references: [{ relation: 'background', note: null, target: { type: 'source', source: { type: 'citation', projectId: f.project.id, citationId, target: { type: 'report' } } } }] },
    { actorKind: 'agent', projectId: f.project.id, taskId: f.taskId, requestId: randomUUID(), sessionId: 'synthetic-history-session', toolCallId: 'synthetic' });
  const sources = createRequirementFrameworkSources({ semantic: () => f.service, experienceLearningEnabled: true });
  const ungranted = sources.begin();
  for (const target of [inputTarget, reportTarget, { kind: 'source', source: { type: 'citation', projectId: f.project.id, citationId, target: { type: 'report' } } }])
    await assert.rejects(() => ungranted.read('read', { target }, toolContext()), /read_not_authorized/);
  const catalog = await ungranted.read('find', { kinds: ['case-decision'], query: 'cohort' }, toolContext());
  assert.match(catalog.content[0]!.text, /Compare comparable cohorts/);
  const historyRead = await ungranted.read('trace', { target: { kind: 'case-decision', caseStoreId, caseId: history.id, recordId: saved.recordId, revision: 1 } }, toolContext());
  assert.match(historyRead.content[0]!.text, /SYNTHETIC_CASE_PAST_STRATEGY/);
  assert.doesNotMatch(historyRead.content[0]!.text, /SYNTHETIC_PRIVATE_REPORT/);
  assert.match(historyRead.content[0]!.text, /forbidden/);

  const approved = sources.begin({ approvedTargets: [inputTarget, reportTarget] });
  const inputRead = await approved.read('read', { target: inputTarget }, toolContext());
  assert.match(inputRead.content[0]!.text, /SYNTHETIC_AUTHORIZED_DATA/);
  const reportRead = await approved.read('read', { target: reportTarget }, toolContext());
  assert.match(reportRead.content[0]!.text, /SYNTHETIC_PRIVATE_REPORT/);
  const refs = approved.references();
  assert.equal(refs.length, 2);
  assert.deepEqual(await sources.revalidate(refs), []);
  assert.deepEqual(await sources.revalidate(refs, { approvedTargets: [inputTarget] }), [{ id: refs[1]!.id, status: 'unavailable' }]);
  await f.projects.archive(f.project.id);
  assert.deepEqual(await sources.revalidate(refs), refs.map(({ id }) => ({ id, status: 'unavailable' })));
});

test('RAF-A1/A4: retained memories use the original M4 authority and stop appearing after archive', async t => {
  const f = await fixture(t);
  const material = await f.enterprise.create({ title: 'Synthetic cohort memory', body: 'SYNTHETIC_RETAINED_MEMORY' });
  const enabled = await f.enterprise.enable(material.material.id, material.material.version), revision = enabled.material.revisions[0]!;
  const retention = new PersonalRetentionStore({ dataRoot: f.projects.dataRoot, materials: f.enterprise, readSource: async () => assert.fail('Memory references must not be read automatically.') });
  const retained = await retention.retain(material.material.id, {
    operationId: randomUUID(), expectedRevision: 0,
    target: { type: 'revision', revisionId: revision.revisionId, expectedBodySha256: revision.bodySha256 },
    metadata: { kind: 'experience', aliases: [], caution: 'Prior scope differs', sourceRefs: [] }, personalLabel: null,
  });
  const controls = new AgentCandidateControls({ dataRoot: f.projects.dataRoot, readTarget: async () => assert.fail('No candidate grant.') });
  const personal = createPersonalContextReader({ projects: { list: async () => assert.fail('Directory must not scan project candidates.') }, retention, controls });
  const semantic = new SemanticContextService({ ...f.service.options, personal });
  const sources = createRequirementFrameworkSources({ semantic: () => semantic, experienceLearningEnabled: true }), operation = sources.begin();
  const catalog = await operation.read('find', { kinds: ['personal'], query: 'cohort' }, toolContext());
  assert.match(catalog.content[0]!.text, /Synthetic cohort memory/);
  assert.doesNotMatch(catalog.content[0]!.text, /SYNTHETIC_RETAINED_MEMORY|frameworkSourceIds/);
  assert.equal('items' in catalog.details ? catalog.details.items.length : 0, 1);
  const target = 'items' in catalog.details ? catalog.details.items[0]!.target : assert.fail('Missing retained locator.');
  const read = await operation.read('read', { target }, toolContext());
  assert.match(read.content[0]!.text, /SYNTHETIC_RETAINED_MEMORY/);
  assert.deepEqual(await sources.revalidate(operation.references()), []);
  await retention.archive(material.material.id, { operationId: randomUUID(), expectedRevision: retained.item.revision, personalLabel: null });
  assert.deepEqual(await sources.revalidate(operation.references()), [{ id: operation.references()[0]!.id, status: 'unavailable' }]);
  const revoked = await sources.begin().read('read', { target }, toolContext());
  assert.doesNotMatch(JSON.stringify(revoked), /SYNTHETIC_RETAINED_MEMORY|Synthetic cohort memory|frameworkSourceIds/);
});

test('L101/L109: exact fixed input remains readable after source edits without any semantic setup', async t => {
  const { projects, project, taskId, data, service } = await fixture(t);
  const source = Buffer.from('rule,amount\nold,100\n'), upload = await projects.upload({ projectId: project.id, name: 'old.csv', bytes: source, directory: '020_clean' });
  const inputVersionId = randomUUID(), datasetId = randomUUID();
  await data.freezeInput(project.id, { operationId: inputVersionId, inputVersionId, datasetId, baseIndexRevision: 0, name: 'Original rules', sourcePath: upload.path, expectedSha256: sha(source), expectedBytes: source.length });
  await fs.writeFile(path.join(project.rootPath, upload.path), 'rule,amount\nnew,999\n');
  const result = await service.query(project.id, taskId, { action: 'read', target: { kind: 'data-input', projectId: project.id, datasetId, inputVersionId } });
  assert.equal(result.items[0]?.state, 'available'); assert.equal(result.items[0]?.body, 'rule,amount\nold,100\n');
  assert.equal(result.items[0]?.sha256, sha(source)); assert.equal(result.indexRevision, 1);
});

test('L102/L103: citation trace preserves the original declaration, exact input and fixed report instead of latest working files', async t => {
  const { projects, project, taskId, data, service } = await fixture(t);
  const source = Buffer.from('a\n1\n'), upload = await projects.upload({ projectId: project.id, name: 'input.csv', bytes: source, directory: '020_clean' });
  const inputVersionId = randomUUID(), datasetId = randomUUID();
  await data.freezeInput(project.id, { operationId: inputVersionId, inputVersionId, datasetId, baseIndexRevision: 0, name: 'Input', sourcePath: upload.path, expectedSha256: sha(source), expectedBytes: source.length });
  const reportPath = '060_reports/old.md', report = '# Original report\n'; await fs.writeFile(path.join(project.rootPath, reportPath), report);
  const citationId = randomUUID();
  await data.createCitation(project.id, { operationId: citationId, citationId, baseIndexRevision: 1, report: { path: reportPath, sha256: sha(report), bytes: Buffer.byteLength(report) }, attachments: [], selections: [{ datasetId, inputVersionId, descriptionRevisionId: null }], conceptRefs: [], sapRefs: [], declarer: 'agent', declaration: 'This report cites the selected input.' });
  await fs.writeFile(path.join(project.rootPath, reportPath), '# Changed draft\n');
  const result = await service.query(project.id, taskId, { action: 'trace', target: { kind: 'data-citation', projectId: project.id, citationId } });
  assert.equal(result.items[0]?.declaration?.claim, 'author-declaration');
  assert.equal(result.items[0]?.declaration?.actor, 'agent');
  assert.ok(result.items[0]?.relations.some(ref => ref.target?.kind === 'data-input' && ref.target.inputVersionId === inputVersionId));
  assert.equal(result.items.length, 1, 'trace returns original root and explicit relation metadata, without prefetching every linked file');
  const reportRef = result.items[0]?.relations.find(ref => ref.target?.kind === 'data-evidence')?.target, inputRef = result.items[0]?.relations.find(ref => ref.target?.kind === 'data-input')?.target;
  assert.ok(reportRef); assert.ok(inputRef);
  assert.equal((await service.query(project.id, taskId, { action: 'read', target: reportRef })).items[0]?.body, report);
  assert.equal((await service.query(project.id, taskId, { action: 'read', target: inputRef })).items[0]?.body, source.toString());
  assert.ok(result.coverage.gaps.includes('author-declaration-does-not-prove-execution'));
});

test('L101/L104/L106: exact old SAP and enterprise revisions survive newer definitions; conflict never substitutes latest', async t => {
  const f = await fixture(t), library = createMetricLibrary(path.join(f.projects.dataRoot, 'metric-assets'));
  const draft = await fs.readFile('extensions/business-plugins/metric-factory/fixtures/membership-repurchase@1.0.0.draft.yaml', 'utf8');
  const old = preparePublication(Buffer.from(draft)), first = library.publish(old, 'Synthetic author');
  library.publish(preparePublication(Buffer.from(draft.replace('version: 1.0.0', 'version: 1.1.0').replace('复购会员数', '重复购买会员数'))), 'Synthetic author');
  const service = new SemanticContextService({ ...f.service.options, metricLibrary: library });
  const result = await service.query(f.project.id, f.taskId, { action: 'read', target: { kind: 'sap', packageId: first.id, version: '1.0.0', metricName: 'repeat_member_count', publishedHash: first.bytesSha256 } });
  assert.equal(result.items[0]?.body, old.canonicalYaml); assert.equal(result.items[0]?.recordedAt?.field, 'publishedAt');
  const metrics = await service.query(f.project.id, f.taskId, { action: 'find', query: 'repeat_member_count', kinds: ['sap'] });
  assert.equal(metrics.items.length, 2); assert.deepEqual(metrics.items.map(item => item.target.kind === 'sap' && item.target.version), ['1.0.0', '1.1.0']);
  const conflict = await service.query(f.project.id, f.taskId, { action: 'read', target: { kind: 'sap', packageId: first.id, version: '1.0.0', publishedHash: 'b'.repeat(64) } });
  assert.equal(conflict.items[0]?.state, 'hash-conflict'); assert.equal(conflict.items[0]?.body, null);
  const created = await f.enterprise.create({ title: '同名规则', body: 'Original authority 100', effectiveTime: '10月1日起适用，时区未声明' });
  const enabled = await f.enterprise.enable(created.material.id, created.material.version), revision = enabled.material.revisions[0]!;
  await f.enterprise.update(created.material.id, enabled.material.version, { body: 'Changed authority 999' });
  const read = await service.query(f.project.id, f.taskId, { action: 'read', target: { kind: 'enterprise', storeId: enabled.storeId, materialId: created.material.id, revisionId: revision.revisionId } });
  assert.equal(read.items[0]?.body, 'Original authority 100');
  assert.deepEqual(read.items[0]?.businessTime, [{ text: '10月1日起适用，时区未声明', source: 'effectiveTime' }]);
  assert.equal(read.items[0]?.recordedAt?.value, revision.createdAt);
  const matches = await service.query(f.project.id, f.taskId, { action: 'find', query: '同名规则', kinds: ['enterprise'] });
  assert.ok(matches.items.some(item => item.target.kind === 'enterprise' && item.target.revisionId === revision.revisionId));
});

test('L106/L110: empty and unavailable sources stay explicit, and governed source refusal never returns a body', async t => {
  const f = await fixture(t);
  const before = await fs.readdir(f.projects.dataRoot);
  const empty = await f.service.query(f.project.id, f.taskId, { action: 'find' });
  assert.deepEqual(empty.items, []); assert.equal(empty.indexRevision, null);
  assert.deepEqual(await fs.readdir(f.projects.dataRoot), before, 'history read must not initialize any Store');
  const missing = await f.service.query(f.project.id, f.taskId, { action: 'read', target: { kind: 'data-input', projectId: f.project.id, datasetId: randomUUID(), inputVersionId: randomUUID() } });
  assert.equal(missing.items[0]?.state, 'missing'); assert.equal(missing.items[0]?.body, null);
  const ref = { type: 'agent-candidate' as const, candidate: { projectId: f.project.id, taskId: f.taskId, originSessionId: 'native-session', entryId: 'entry', toolCallId: 'tool', expectedDetailsSha256: 'a'.repeat(64) } };
  const service = new SemanticContextService({ ...f.service.options, readSource: async () => ({ ref, title: 'Sensitive excluded title', text: 'MUST NOT RETURN THIS BODY', sha256: 'a'.repeat(64), status: 'excluded' }) });
  const excluded = await service.query(f.project.id, f.taskId, { action: 'read', target: { kind: 'source', source: ref } }, { audience: 'agent' });
  assert.equal(excluded.items[0]?.state, 'excluded'); assert.equal(excluded.items[0]?.body, null);
  assert.equal(JSON.stringify(excluded).includes('MUST NOT RETURN'), false);
  const other = await f.projects.create({ name: 'Other owner', configuration: config });
  await assert.rejects(service.query(f.project.id, f.taskId, { action: 'read', target: { kind: 'data-citation', projectId: other.id, citationId: randomUUID() } }), /owner_mismatch/);
  await assert.rejects(service.query(other.id, f.taskId, { action: 'find' }), /task_not_found/);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(service.query(f.project.id, f.taskId, { action: 'find' }, { signal: controller.signal }), { name: 'AbortError' });
});

test('L102/L108: description declarations and original Case relations retain direction and exact revisions', async t => {
  const f = await fixture(t), upload = await f.projects.upload({ projectId: f.project.id, name: 'data.csv', bytes: Buffer.from('x\n1\n'), directory: '020_clean' });
  const datasetId = randomUUID(), inputVersionId = randomUUID(), descriptionRevisionId = randomUUID();
  await f.data.freezeInput(f.project.id, { operationId: inputVersionId, inputVersionId, datasetId, baseIndexRevision: 0, name: 'Binding', sourcePath: upload.path, expectedSha256: upload.sha256, expectedBytes: upload.bytes });
  await f.data.saveDescription(f.project.id, { operationId: descriptionRevisionId, descriptionRevisionId, datasetId, inputVersionId, baseIndexRevision: 1,
    observation: { author: 'unknown', format: 'csv', encoding: null, recordRule: null, coverage: 'unobserved', scannedRows: null, totalRows: null, fields: [], limitations: 'Join grain and duplicate keys were not checked.', generatedAt: null, nativeEvidence: null, artifactEvidence: null },
    statements: [{ statementId: randomUUID(), scope: 'business-time', location: null, text: 'Business month declared as October, timezone unknown.', unit: null, provenance: 'user-statement', confirmed: false, confirmedAt: null, confirmedBy: null }], mappings: [] });
  const description = await f.service.query(f.project.id, f.taskId, { action: 'trace', target: { kind: 'data-description', projectId: f.project.id, datasetId, inputVersionId, descriptionRevisionId } });
  assert.match(description.items[0]?.body ?? '', /Join grain and duplicate keys were not checked/);
  assert.equal(description.items[0]?.businessTime[0]?.source, 'statements.business-time');
  assert.equal(description.items[0]?.relations[0]?.target?.kind, 'data-input');
  await f.cases.initialize(); t.after(async () => f.cases.close());
  const caseRecord = f.cases.createCase({ operationId: randomUUID(), title: 'Original Case' }), caseStoreId = f.cases.getStatus().storeId!;
  f.cases.linkProject({ operationId: randomUUID(), caseId: caseRecord.id, projectId: f.project.id, expectedRevision: 1 });
  const origin = { actorKind: 'agent' as const, projectId: f.project.id, taskId: f.taskId, requestId: randomUUID(), sessionId: 'synthetic', toolCallId: 'call' };
  const first = f.cases.saveDecisionDraft({ operationId: randomUUID(), caseStoreId, caseId: caseRecord.id, expectedRevision: 0, kind: 'hypothesis', payload: { title: 'Old judgement', statement: 'Original hypothesis' } }, origin);
  const second = f.cases.saveDecisionDraft({ operationId: randomUUID(), caseStoreId, caseId: caseRecord.id, expectedRevision: 0, kind: 'strategy', payload: { title: 'Consider evidence', proposal: 'Read old hypothesis' },
    references: [{ relation: 'depends_on', target: { type: 'case-decision', caseStoreId, caseId: caseRecord.id, recordId: first.recordId, revision: 1 }, note: 'Declared dependency, not proof.' }] }, origin);
  f.cases.saveDecisionDraft({ operationId: randomUUID(), caseStoreId, caseId: caseRecord.id, recordId: first.recordId, expectedRevision: 1, kind: 'hypothesis', payload: { title: 'New judgement', statement: 'Changed hypothesis' } }, origin);
  const result = await f.service.query(f.project.id, f.taskId, { action: 'trace', target: { kind: 'case-decision', caseStoreId, caseId: caseRecord.id, recordId: second.recordId, revision: 1 } });
  assert.equal(result.items[0]?.relations[0]?.relation, 'depends_on');
  const priorTarget = result.items[0]?.relations[0]?.target; assert.ok(priorTarget);
  const prior = await f.service.query(f.project.id, f.taskId, { action: 'read', target: priorTarget });
  assert.match(prior.items[0]?.body ?? '', /Original hypothesis/); assert.doesNotMatch(prior.items[0]?.body ?? '', /Changed hypothesis/);
  assert.equal(prior.items[0]?.governance?.currentRevision, 2);
  const found = await f.service.query(f.project.id, f.taskId, { action: 'find', query: 'Consider evidence', kinds: ['case-decision'] });
  assert.equal(found.items[0]?.title, 'Consider evidence');
});

test('L101/L106: matching original input identities are separately discoverable and a changed directory makes continuation stale', async t => {
  const f = await fixture(t), upload = await f.projects.upload({ projectId: f.project.id, name: 'same.csv', bytes: Buffer.from('x\n1\n'), directory: '020_clean' });
  for (let n = 0; n < 2; n++) {
    const inputVersionId = randomUUID();
    await f.data.freezeInput(f.project.id, { operationId: inputVersionId, inputVersionId, datasetId: randomUUID(), baseIndexRevision: n, name: 'Same named rule', sourcePath: upload.path, expectedSha256: upload.sha256, expectedBytes: upload.bytes });
  }
  const query = { action: 'find' as const, query: 'Same named rule', kinds: ['data-input' as const], pageSize: 1 };
  const first = await f.service.query(f.project.id, f.taskId, query);
  assert.equal(first.items.length, 1); assert.equal(first.items[0]?.body, null); assert.ok(first.coverage.continuation);
  const second = await f.service.query(f.project.id, f.taskId, { ...query, continuation: first.coverage.continuation });
  assert.equal(second.items.length, 1); assert.notDeepEqual(second.items[0]?.target, first.items[0]?.target); assert.equal(second.coverage.continuation, null);
  const inputVersionId = randomUUID();
  await f.data.freezeInput(f.project.id, { operationId: inputVersionId, inputVersionId, datasetId: randomUUID(), baseIndexRevision: 2, name: 'Same named rule', sourcePath: upload.path, expectedSha256: upload.sha256, expectedBytes: upload.bytes });
  await assert.rejects(f.service.query(f.project.id, f.taskId, { ...query, continuation: first.coverage.continuation }), /stale/);
});

test('L106/L110: personal discovery delegates one bounded original page and exposes its usable continuation', async t => {
  const f = await fixture(t), target = { type: 'retained' as const, storeId: randomUUID(), materialId: randomUUID(), decisionId: randomUUID(), revisionId: randomUUID(), expectedBodySha256: 'a'.repeat(64) };
  let reads = 0;
  const details = { schemaVersion: 1 as const, type: 'optracall.personal-context-delivery' as const, action: 'find' as const,
    items: [{ target, title: 'Retained original', part: 'catalog' as const, extent: 'metadata' as const, range: null, scope: null, effectiveTime: null, caution: null,
      governance: { archived: false, enterpriseEnabled: true, sourceProjectArchived: null, targetRevision: null, latestCorrectionOperationId: null }, limitations: [] }], partial: true, continuation: 'original-m4-token', issues: [] };
  const service = new SemanticContextService({ ...f.service.options, personal: {
    find: async () => { reads++; return { text: 'Original directory', details }; },
    read: async () => ({ text: 'Original M4 tool payload', details: { ...details, action: 'read', partial: false, continuation: null } })
  } });
  await service.query(f.project.id, f.taskId, { action: 'find', kinds: ['personal'] });
  assert.equal(reads, 0, 'uninitialized enterprise/retention reads must not be initialized indirectly');
  await f.enterprise.create({ title: 'Initialize synthetic original authority' });
  const result = await service.query(f.project.id, f.taskId, { action: 'find', query: 'retained', kinds: ['personal'] });
  assert.equal(reads, 1); assert.equal(result.items[0]?.target.kind, 'personal');
  assert.equal(result.coverage.complete, false);
  assert.deepEqual(result.coverage.sourceContinuations, [{ tool: 'find_personal_context', input: { query: 'retained', kind: 'all', includeArchived: true, pageSize: 50, continuation: 'original-m4-token' } }]);
  const read = await service.query(f.project.id, f.taskId, { action: 'read', target: { kind: 'personal', target } });
  assert.equal(read.items[0]?.body, 'Original M4 tool payload'); assert.ok(read.items[0]?.gaps.includes('original-m4-tool-payload-not-raw-source-body'));
});

test('L101/L110: incomplete exact targets and arbitrary paths are rejected before any latest resolution', async t => {
  const f = await fixture(t);
  for (const input of [
    { action: 'read' }, { action: 'trace', target: { kind: 'case-decision', caseStoreId: randomUUID(), caseId: randomUUID(), recordId: randomUUID() } },
    { action: 'read', target: { kind: 'sap', packageId: 'rule' } },
    { action: 'find', target: { kind: 'data-citation', projectId: f.project.id, citationId: randomUUID() } },
    { action: 'find', pageSize: 101 }, { action: 'find', recordedBefore: '2026-11-04' },
    { action: 'read', target: { kind: 'data-citation', projectId: f.project.id, citationId: randomUUID(), path: '/private/unapproved' } },
  ]) await assert.rejects(f.service.query(f.project.id, f.taskId, input as Parameters<SemanticContextService['query']>[2]), /invalid_semantic_context/);
  const before = await fs.readdir(f.projects.dataRoot);
  await f.service.query(f.project.id, f.taskId, { action: 'read', target: { kind: 'source', source: { type: 'enterprise', storeId: randomUUID(), materialId: randomUUID(), revisionId: randomUUID() } } });
  assert.deepEqual(await fs.readdir(f.projects.dataRoot), before);
});

test('L102/L106: intact immutable citation declarations survive a missing old input and retain remaining report refs', async t => {
  const f = await fixture(t), source = Buffer.from('rule\nold\n'), upload = await f.projects.upload({ projectId: f.project.id, name: 'old.csv', bytes: source, directory: '020_clean' });
  const datasetId = randomUUID(), inputVersionId = randomUUID();
  const fixed = await f.data.freezeInput(f.project.id, { operationId: inputVersionId, inputVersionId, datasetId, baseIndexRevision: 0, name: 'Original', sourcePath: upload.path, expectedSha256: upload.sha256, expectedBytes: upload.bytes });
  const reportPath = '060_reports/result.md', report = '# Intact report'; await fs.writeFile(path.join(f.project.rootPath, reportPath), report);
  const citationId = randomUUID();
  await f.data.createCitation(f.project.id, { operationId: citationId, citationId, baseIndexRevision: 1, report: { path: reportPath, sha256: sha(report), bytes: Buffer.byteLength(report) }, attachments: [], selections: [{ datasetId, inputVersionId, descriptionRevisionId: null }], conceptRefs: [], sapRefs: [], declarer: 'agent', declaration: 'Original declaration remains meaningful even if an old source is lost.' });
  await fs.unlink(path.join(f.projects.dataRoot, 'projects', f.project.id, 'data-context', fixed.record.evidencePath));
  const result = await f.service.query(f.project.id, f.taskId, { action: 'trace', target: { kind: 'data-citation', projectId: f.project.id, citationId } });
  assert.equal(result.items[0]?.state, 'available'); assert.match(result.items[0]?.body ?? '', /Original declaration remains meaningful/);
  assert.ok(result.items[0]?.relations.some(ref => ref.target?.kind === 'data-input' && ref.target.inputVersionId === inputVersionId));
  const evidence = result.items[0]?.relations.find(ref => ref.target?.kind === 'data-evidence'); assert.ok(evidence?.target);
  const readable = await f.service.query(f.project.id, f.taskId, { action: 'read', target: evidence.target });
  assert.equal(readable.items[0]?.body, report);
  const lost = await f.service.query(f.project.id, f.taskId, { action: 'read', target: { kind: 'data-input', projectId: f.project.id, datasetId, inputVersionId } });
  assert.equal(lost.items[0]?.state, 'missing'); assert.equal(lost.items[0]?.body, null);
});

test('L110: cancellation after an original source read preserves bytes and cannot return a late result', async t => {
  const f = await fixture(t), ref = { type: 'native-reply' as const, projectId: f.project.id, taskId: f.taskId, sessionId: 'synthetic-session', messageId: 'synthetic-entry', expectedTextSha256: sha('Original reply') };
  const snapshot = async (directory: string): Promise<Record<string, string>> => {
    const values: Record<string, string> = {};
    const visit = async (root: string) => { for (const entry of await fs.readdir(root, { withFileTypes: true })) { const file = path.join(root, entry.name); if (entry.isDirectory()) await visit(file); else if (entry.isFile()) values[path.relative(directory, file)] = sha(await fs.readFile(file)); } };
    await visit(directory); return values;
  };
  const before = await snapshot(f.root), controller = new AbortController();
  let release!: () => void, entered!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; }), ready = new Promise<void>(resolve => { entered = resolve; });
  const service = new SemanticContextService({ ...f.service.options, readSource: async () => { entered(); await pending; return { ref, title: 'Original reply', text: 'Original reply', sha256: ref.expectedTextSha256, status: 'available' }; } });
  const query = service.query(f.project.id, f.taskId, { action: 'read', target: { kind: 'source', source: ref } }, { signal: controller.signal });
  await ready; controller.abort(); release(); await assert.rejects(query, { name: 'AbortError' });
  assert.deepEqual(await snapshot(f.root), before, 'cancelled history queries must preserve all original bytes and create no native files');
});

test('L106: an unopened Case authority is unknown without being initialized or mislabeled as an owner refusal', async t => {
  const f = await fixture(t), target = { kind: 'case-choice' as const, caseStoreId: randomUUID(), caseId: randomUUID(), choiceId: randomUUID() };
  const result = await f.service.query(f.project.id, f.taskId, { action: 'read', target });
  assert.equal(result.items[0]?.state, 'unknown'); assert.equal(result.items[0]?.body, null);
  assert.equal(f.cases.getStatus().state, 'uninitialized');
  const found = await f.service.query(f.project.id, f.taskId, { action: 'find', kinds: ['case-choice'] });
  assert.ok(found.coverage.gaps.includes('case-directory-uninitialized'));
  assert.ok(found.coverage.gaps.includes('current-directories-not-complete-historical-snapshot'));
});
