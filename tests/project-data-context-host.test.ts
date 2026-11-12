import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { readFile, writeFile, unlink } from 'node:fs/promises';
import path from 'node:path';
import { startTestHost, startLegacyTestHost } from './fixtures/host-process.ts';
import { readJson } from './fixtures/joint-context.ts';
import { sessionEvents } from './fixtures/session-events.ts';
import { providerMessageText, startToolProvider } from './fixtures/tool-provider.ts';

const digest = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
const base = (projectId: string) => `/api/projects/${projectId}/data-context`;

test('MC04/07 exact historical source status distinguishes disabled, missing and corrupt without changing references or starting an Agent', { timeout: 30_000 }, async t => {
  const provider = await startToolProvider(), host = await startTestHost();
  t.after(async () => { await host.close(); await provider.close(); });
  await readJson(await host.request('/api/configuration', 'PUT', { name: 'M2来源状态合成配置', provider: 'openai-compatible', baseUrl: provider.baseUrl, model: 'synthetic-m2', apiKey: 'synthetic-only' }));
  const { project } = await readJson(await host.request('/api/projects', 'POST', { name: 'M2来源状态' }), 201);
  const created = await readJson(await host.request('/api/enterprise-materials', 'POST', { title: '精确概念原稿', body: '原稿正文，不随新版替换' }), 201);
  const enabled = await readJson(await host.request(`/api/enterprise-materials/${created.material.id}/enable`, 'POST', { expectedVersion: created.material.version }));
  const ref = { storeId: enabled.storeId, materialId: created.material.id, revisionId: enabled.material.activeRevisionId };
  const sapText = (await readFile(new URL('../extensions/business-plugins/metric-factory/fixtures/membership-repurchase@1.0.0.draft.yaml', import.meta.url), 'utf8')).replaceAll('reviewed_by: huangbo', 'reviewed_by: synthetic-reviewer');
  await writeFile(path.join(project.rootPath, '020_clean/status.sap.yaml'), sapText);
  const publication = await readJson(await host.request('/api/metric-factory/publish', 'POST', { projectId: project.id, path: '020_clean/status.sap.yaml', publishedBy: 'synthetic-reviewer' }), 201);
  const sapRef = { packageId: publication.entry.id, version: publication.entry.version, metricName: publication.entry.metricNames[0], publishedHash: publication.entry.bytesSha256 };
  const status = async () => readJson(await host.request(`${base(project.id)}/source-status`, 'POST', { conceptRefs: [ref], sapRefs: [sapRef] }));
  const available = await status();
  assert.deepEqual(available.concepts, [{ ref, status: 'available' }]); assert.deepEqual(available.metrics, [{ ref: sapRef, status: 'available' }]);
  await readJson(await host.request(`/api/enterprise-materials/${created.material.id}/disable`, 'POST', { expectedVersion: enabled.material.version }));
  assert.equal((await status()).concepts[0].status, 'disabled');
  const index = JSON.parse(await readFile(path.join(host.dataRoot, 'enterprise-business-materials/index.json'), 'utf8'));
  const bodyId = index.materials.find((item: any) => item.id === ref.materialId).revisions.find((item: any) => item.revisionId === ref.revisionId).bodyFileId;
  const bodyPath = path.join(host.dataRoot, 'enterprise-business-materials/bodies', `${bodyId}.txt`), original = await readFile(bodyPath);
  await writeFile(bodyPath, 'corrupted exact bytes'); assert.equal((await status()).concepts[0].status, 'corrupt');
  await writeFile(bodyPath, original);
  const missingRef = { ...ref, revisionId: randomUUID() };
  const missing = await readJson(await host.request(`${base(project.id)}/source-status`, 'POST', { conceptRefs: [missingRef], sapRefs: [] }));
  assert.deepEqual(missing.concepts, [{ ref: missingRef, status: 'missing' }]);
  const publicationPath = path.join(host.dataRoot, 'metric-assets', sapRef.packageId, `${sapRef.version}.sap.yaml`);
  await writeFile(publicationPath, 'corrupted exact SAP bytes'); assert.equal((await status()).metrics[0].status, 'corrupt');
  await unlink(publicationPath); assert.equal((await status()).metrics[0].status, 'missing');
  await readJson(await host.request(`/api/projects/${project.id}/archive`, 'POST', {}));
  assert.equal((await status()).concepts[0].status, 'disabled', 'archived history remains readable');
  assert.equal((await readJson(await host.request(base(project.id)))).index, null);
  assert.equal(provider.requests.length, 0);
});
async function upload(host: Awaited<ReturnType<typeof startTestHost>>, projectId: string, name: string, text: string) {
  return readJson(await host.request(`/api/projects/${projectId}/files/upload`, 'POST', {
    directory: '020_clean', name, content: Buffer.from(text).toString('base64'),
  }), 201);
}

test('MC04 a damaged unselected concept revision cannot invalidate or replace the healthy exact old revision', { timeout: 30_000 }, async t => {
  const provider = await startToolProvider(), host = await startTestHost();
  t.after(async () => { await host.close(); await provider.close(); });
  await readJson(await host.request('/api/configuration', 'PUT', { name: 'M2精确旧源合成配置', provider: 'openai-compatible', baseUrl: provider.baseUrl, model: 'synthetic-m2', apiKey: 'synthetic-only' }));
  const { project } = await readJson(await host.request('/api/projects', 'POST', { name: 'M2旧源与新源独立' }), 201);
  const created = await readJson(await host.request('/api/enterprise-materials', 'POST', { title: '旧概念修订', body: 'Healthy exact old concept' }), 201);
  const v1 = await readJson(await host.request(`/api/enterprise-materials/${created.material.id}/enable`, 'POST', { expectedVersion: created.material.version }));
  const ref = { storeId: v1.storeId, materialId: created.material.id, revisionId: v1.material.activeRevisionId };
  const updated = await readJson(await host.request(`/api/enterprise-materials/${created.material.id}`, 'PUT', { expectedVersion: v1.material.version, body: 'Unselected new concept body' }));
  const v2 = await readJson(await host.request(`/api/enterprise-materials/${created.material.id}/enable`, 'POST', { expectedVersion: updated.material.version }));
  const index = JSON.parse(await readFile(path.join(host.dataRoot, 'enterprise-business-materials/index.json'), 'utf8'));
  const newer = index.materials.find((item: any) => item.id === ref.materialId).revisions.find((item: any) => item.revisionId === v2.material.activeRevisionId);
  await writeFile(path.join(host.dataRoot, 'enterprise-business-materials/bodies', `${newer.bodyFileId}.txt`), 'damaged new bytes');
  const statuses = await readJson(await host.request(`${base(project.id)}/source-status`, 'POST', { conceptRefs: [ref], sapRefs: [] }));
  assert.deepEqual(statuses.concepts, [{ ref, status: 'available' }]);
  const source = await readJson(await host.request(`${base(project.id)}/concept-source`, 'POST', { ref }));
  assert.equal(source.storeId, ref.storeId); assert.equal(source.revision.revisionId, ref.revisionId); assert.equal(source.revision.body, 'Healthy exact old concept');
  const choices = await readJson(await host.request(`${base(project.id)}/references`));
  assert.ok(choices.concepts.some((item: any) => item.revisionId === ref.revisionId));
  assert.equal((await readJson(await host.request(base(project.id)))).index, null); assert.equal(provider.requests.length, 0);
});
function fixedInput(sourcePath: string, text: string, baseIndexRevision = 0, datasetId = randomUUID()) {
  const inputVersionId = randomUUID();
  return { operationId: inputVersionId, datasetId, inputVersionId, baseIndexRevision,
    name: '合成销售输入', sourcePath, expectedSha256: digest(text), expectedBytes: Buffer.byteLength(text) };
}

async function turn(host: Awaited<ReturnType<typeof startTestHost>>, projectId: string, taskId: string, input: Record<string, unknown>) {
  const stream = await sessionEvents(host, projectId, taskId);
  try {
    await readJson(await host.request(`/api/projects/${projectId}/tasks/${taskId}/messages`, 'POST', input), 202);
    const terminal = await stream.terminal;
    assert.equal(terminal.type, 'run.settled');
    if (terminal.type === 'run.settled') assert.equal(terminal.outcome, 'completed', JSON.stringify(terminal));
    return stream.events;
  } finally { await stream.close(); }
}
function descriptionInput(input: ReturnType<typeof fixedInput>, baseIndexRevision = 1) {
  const descriptionRevisionId = randomUUID();
  return { operationId: descriptionRevisionId, descriptionRevisionId, datasetId: input.datasetId,
    inputVersionId: input.inputVersionId, baseIndexRevision, baseDescriptionRevisionId: null,
    observation: { author: 'user', format: 'csv', encoding: 'UTF-8', recordRule: 'CSV logical records, header excluded',
      coverage: 'partial', scannedRows: null, totalRows: null, fields: [], limitations: '仅人工填写业务说明，尚未扫描记录',
      generatedAt: null, nativeEvidence: null, artifactEvidence: null },
    statements: [{ statementId: randomUUID(), scope: 'row-meaning', location: null,
      text: 'M2_FIXED_ROW：每行是一条合成销售；金额以元计，退款口径未知。', unit: null,
      provenance: 'agent-inference', confirmed: false, confirmedAt: null, confirmedBy: null }], mappings: [] as any[] };
}
async function eventually<T>(read: () => Promise<T>, done: (value: T) => boolean): Promise<T> {
  const deadline = Date.now() + 15_000;
  for (;;) {
    const value = await read(); if (done(value)) return value;
    if (Date.now() >= deadline) assert.fail('The isolated synthetic operation did not reach a terminal state');
    await new Promise(resolve => setTimeout(resolve, 20));
  }
}

test('MC01/04/05/06/07 SDK: append fixed data and exact sources to the original task, execute native tools, record distinct draft provenance and reopen', { timeout: 90_000 }, async t => {
  const provider = await startToolProvider(); let host = await startTestHost();
  t.after(async () => { await host.close(); await provider.close(); });
  await readJson(await host.request('/api/configuration', 'PUT', { name: 'M2原生工具合成配置', provider: 'openai-compatible',
    baseUrl: provider.baseUrl, model: 'synthetic-m2-tools', apiKey: 'synthetic-only-m2-tools' }));
  const { project } = await readJson(await host.request('/api/projects', 'POST', { name: 'M2制度追加数据' }), 201);
  const { task } = await readJson(await host.request(`/api/projects/${project.id}/tasks`, 'POST', { name: '原制度讨论任务' }), 201);
  const route = `/api/projects/${project.id}/tasks/${task.id}`;
  await turn(host, project.id, task.id, { requestId: randomUUID(), text: '先讨论合成制度，尚无明细表；不要求Case、RAP或SAP。' });
  assert.equal(provider.requests.length, 1);
  const policyState = await readJson(await host.request(route));
  const nativeFile = policyState.task.sessionFile;
  const nativePolicy = await readFile(nativeFile);
  assert.equal((await readJson(await host.request(base(project.id)))).index, null);

  const conceptV1Text = 'M2_CONCEPT_V1：销售记录为合成示例；别名为交易明细。金额单位为元，关系仅自然语言说明。';
  const concept = await readJson(await host.request('/api/enterprise-materials', 'POST', { title: '合成销售概念说明', body: conceptV1Text }), 201);
  const enabled = await readJson(await host.request(`/api/enterprise-materials/${concept.material.id}/enable`, 'POST', { expectedVersion: concept.material.version }));
  const conceptRef = { storeId: enabled.storeId, materialId: concept.material.id, revisionId: enabled.material.activeRevisionId };
  const changed = await readJson(await host.request(`/api/enterprise-materials/${concept.material.id}`, 'PUT', { expectedVersion: enabled.material.version, body: 'M2_CONCEPT_V2_NOT_SELECTED：新解释不得改写旧引用。' }));
  await readJson(await host.request(`/api/enterprise-materials/${concept.material.id}/enable`, 'POST', { expectedVersion: changed.material.version }));
  const sapSource = (await readFile(new URL('../extensions/business-plugins/metric-factory/fixtures/membership-repurchase@1.0.0.draft.yaml', import.meta.url), 'utf8')).replaceAll('reviewed_by: huangbo', 'reviewed_by: synthetic-reviewer');
  await writeFile(path.join(project.rootPath, '020_clean/m2.sap.yaml'), sapSource);
  const published = await readJson(await host.request('/api/metric-factory/publish', 'POST', { projectId: project.id, path: '020_clean/m2.sap.yaml', publishedBy: 'synthetic-reviewer' }), 201);
  await readJson(await host.request(`/api/metric-factory/projects/${project.id}/enable`, 'POST', { packageId: published.entry.id, version: '1.0.0' }));
  await writeFile(path.join(project.rootPath, '020_clean/m2-newer.sap.yaml'), sapSource.replace('version: 1.0.0', 'version: 1.1.0').replace('指定时间窗口内', 'M2_NEWER_SAP_ONLY 指定时间窗口内'));
  await readJson(await host.request('/api/metric-factory/publish', 'POST', { projectId: project.id, path: '020_clean/m2-newer.sap.yaml', publishedBy: 'synthetic-reviewer' }), 201);
  const choices = await readJson(await host.request(`${base(project.id)}/references`));
  const sapRef = choices.metrics.find((value: any) => value.packageId === published.entry.id && value.version === '1.0.0' && value.metricName === 'repurchase_rate');
  assert.ok(sapRef, 'The existing exact SAP publication is selectable without a prerequisite analysis');
  const source = 'id,amount\nsynthetic-a,10\nsynthetic-b,20\n';
  await upload(host, project.id, 'm2-sales.csv', source);
  const input = fixedInput('020_clean/m2-sales.csv', source);
  await readJson(await host.request(`${base(project.id)}/inputs`, 'POST', input), 201);
  const description = descriptionInput(input);
  description.mappings.push({ mappingId: randomUUID(), location: { kind: 'csv-column', columnIndex: 1 },
    conceptRefs: [conceptRef], sapRefs: [sapRef], provenance: 'agent-inference', dispute: '仅用于技术引用，不声称金额字段等同复购率。',
    confirmed: false, confirmedAt: null, confirmedBy: null });
  const savedDescription = await readJson(await host.request(`${base(project.id)}/descriptions`, 'POST', description), 201);
  assert.equal(savedDescription.record.observation.totalRows, null);
  assert.equal(savedDescription.record.statements[0].provenance, 'agent-inference');
  assert.equal(savedDescription.record.statements[0].confirmed, false);
  assert.deepEqual(savedDescription.record.mappings[0].conceptRefs, [conceptRef]);
  assert.equal(savedDescription.record.mappings[0].sapRefs[0].version, '1.0.0');
  const selection = { datasetId: input.datasetId, inputVersionId: input.inputVersionId, descriptionRevisionId: description.descriptionRevisionId };
  const { copy } = await readJson(await host.request(`${base(project.id)}/prepare`, 'POST', { datasetId: input.datasetId, inputVersionId: input.inputVersionId }));
  assert.match(copy.path, /^020_clean\//);
  assert.equal(await readFile(path.join(project.rootPath, copy.path), 'utf8'), source);
  assert.equal(provider.requests.length, 1, 'Registration, explanations, source mapping and preparation are read/write actions only');

  const reportPath = '060_reports/m2-report-v1.md', calculationPath = '020_clean/m2-calculation.json', codePath = '020_clean/m2-method.py';
  const method = 'import csv, json, sys\nfrom pathlib import Path\np = Path(sys.argv[1])\nrows = list(csv.DictReader(p.read_text().splitlines()))\nprint(json.dumps({"rows": len(rows), "total": sum(int(r["amount"]) for r in rows)}))\n';
  const program = [
    'from pathlib import Path', 'import csv, json, hashlib',
    `root = Path(${JSON.stringify(project.rootPath)})`, `source = root / ${JSON.stringify(copy.path)}`,
    'rows = list(csv.DictReader(source.read_text().splitlines()))', 'total = sum(int(row["amount"]) for row in rows)',
    `result = {"rows": len(rows), "total": total, "sourceSha256": hashlib.sha256(source.read_bytes()).hexdigest(), "inputVersionId": ${JSON.stringify(input.inputVersionId)}}`,
    `(root / ${JSON.stringify(codePath)}).write_text(${JSON.stringify(method)})`,
    `(root / ${JSON.stringify(calculationPath)}).write_text(json.dumps(result))`,
    `(root / ${JSON.stringify(reportPath)}).write_text('# 合成报告 V1\\n\\n合计：' + str(total) + ' 元。\\n计算产物：${calculationPath}\\n')`,
    'print(json.dumps(result))',
  ].join('\n');
  provider.setResponder(context => {
    if (!context.recentToolResults.length) {
      assert.ok(context.availableTools.includes('bash'));
      return { calls: [{ name: 'bash', arguments: { command: `python3 - <<'M2_SYNTHETIC'\n${program}\nM2_SYNTHETIC` } }] };
    }
    assert.match(providerMessageText(context.recentToolResults.at(-1)?.content), /"total": 30/);
    return { text: 'M2合成SDK工具已完成实际读取、核算与另存报告；此固定回复不证明模型专业理解。' };
  });
  const requestId = randomUUID(), message = { requestId, text: 'M2_APPEND：在同一任务按当前明确固定资料自主核算并保存合成稿。', projectData: [selection], enterpriseMaterials: [{ ...conceptRef, mode: 'full' }] };
  const events = await turn(host, project.id, task.id, message);
  assert.ok(events.some(event => event.type === 'native' && event.event.type === 'tool_execution_start'), 'The actual SDK must execute a tool, rather than Host computing the result');
  assert.deepEqual(JSON.parse(await readFile(path.join(project.rootPath, calculationPath), 'utf8')), { rows: 2, total: 30, sourceSha256: digest(source), inputVersionId: input.inputVersionId });
  const supplied = JSON.stringify(provider.requests[1].body.messages?.filter(value => value.role === 'user'));
  for (const expected of [input.inputVersionId, description.descriptionRevisionId, digest(source), description.statements[0].text, conceptV1Text, copy.path]) assert.ok(supplied.includes(expected), expected);
  assert.ok(!supplied.includes('M2_CONCEPT_V2_NOT_SELECTED'));
  assert.ok(!supplied.includes('synthetic-a,10'), 'CSV bytes are not silently inlined into the proactive context');
  const state = await readJson(await host.request(route));
  assert.equal(state.task.sessionFile, nativeFile); assert.equal(state.project.tasks.length, 1);
  const rows = (await readFile(nativeFile, 'utf8')).trim().split('\n').map(line => JSON.parse(line));
  const entry = rows.find(row => row.customType === 'optracall.run' && row.data.phase === 'started' && row.data.requestId === requestId);
  const receipt = entry.data.providedContext;
  assert.equal(receipt.claim, 'provided-not-adopted'); assert.equal(receipt.projectData.length, 1);
  assert.deepEqual(receipt.projectData[0].selection, selection); assert.equal(receipt.projectData[0].version.sha256, digest(source));
  assert.equal(receipt.projectData[0].description.descriptionRevisionId, description.descriptionRevisionId);
  assert.equal(receipt.projectData[0].analysisCopy.path, copy.path);
  assert.equal(receipt.projectData[0].version.evidencePath, undefined, 'Host metadata paths must not be supplied to ordinary or managed model contexts');
  const firstRun = rows.find(row => row.customType === 'optracall.run' && row.data.phase === 'started' && row.data.requestId !== requestId);
  assert.equal(firstRun.data.providedContext?.projectData, undefined, 'No later selection may be backfilled into the original no-data request');
  const callsBeforeRetry = provider.requests.length;
  await readJson(await host.request(`${route}/messages`, 'POST', message), 202);
  await readJson(await host.request(`${route}/messages`, 'POST', { ...message, projectData: [{ ...selection, descriptionRevisionId: null }] }), 409);
  await readJson(await host.request(`${route}/messages`, 'POST', { ...message, projectData: undefined }), 409);
  assert.equal(provider.requests.length, callsBeforeRetry, 'Identical retry reads accepted state; changing selected material conflicts');
  const report = await readFile(path.join(project.rootPath, reportPath));
  const attachment = await readFile(path.join(project.rootPath, calculationPath));
  const code = await readFile(path.join(project.rootPath, codePath));
  const citationId = randomUUID(), citation = { operationId: citationId, citationId, baseIndexRevision: 2,
    report: { path: reportPath, sha256: digest(report), bytes: report.length },
    attachments: [{ path: calculationPath, sha256: digest(attachment), bytes: attachment.length }, { path: codePath, sha256: digest(code), bytes: code.length }],
    selections: [selection], conceptRefs: [conceptRef], sapRefs: [sapRef], declarer: 'user', declaration: '用户明确声明此稿使用固定输入及所选计算、方法文件；未认证专业正确性。', nativeEvidence: null };
  const savedCitation = await readJson(await host.request(`${base(project.id)}/citations`, 'POST', citation), 201);
  assert.equal(savedCitation.record.sourcesDeclared, true); assert.equal(savedCitation.record.attachments.length, 2);
  assert.deepEqual(savedCitation.record.selections, [selection]); assert.equal(savedCitation.record.nativeEvidence, null);
  assert.deepEqual(Buffer.from(await (await host.request(`${base(project.id)}/citations/${citationId}/evidence`)).arrayBuffer()), report);
  assert.deepEqual(Buffer.from(await (await host.request(`${base(project.id)}/citations/${citationId}/evidence?attachmentIndex=0`)).arrayBuffer()), attachment);
  const revisedReportText = '# 合成报告 V2\n\n合计仍为30元；补充说明金额单位，退款口径未知。\n';
  await readJson(await host.request(`/api/projects/${project.id}/files/save-report`, 'POST', { name: 'm2-report-v2.md', text: revisedReportText }), 201);
  const revisedCitationId = randomUUID(), revisedCitation = { ...citation, operationId: revisedCitationId,
    citationId: revisedCitationId, baseIndexRevision: 3,
    report: { path: '060_reports/m2-report-v2.md', sha256: digest(revisedReportText), bytes: Buffer.byteLength(revisedReportText) },
    revisionReason: '用户显式修订解释，保留原稿与实际计算附件。' };
  const revised = await readJson(await host.request(`${base(project.id)}/citations`, 'POST', revisedCitation), 201);
  assert.notEqual(revised.record.citationId, savedCitation.record.citationId);
  assert.equal(revised.record.revisionReason, revisedCitation.revisionReason);
  assert.equal((await readJson(await host.request(base(project.id)))).citations.length, 2);
  await writeFile(path.join(project.rootPath, reportPath), '# 后来修订的工作文件，旧稿不得改写\n');
  await writeFile(path.join(project.rootPath, calculationPath), '{"total":999}');
  await writeFile(path.join(project.rootPath, input.sourcePath), 'id,amount\nsynthetic-a,999\n');
  const nativeBeforeReopen = await readFile(nativeFile), dataRoot = host.dataRoot, projectsRoot = host.projectsRoot;
  assert.ok(nativeBeforeReopen.subarray(0, nativePolicy.length).equals(nativePolicy));
  await host.close(); host = await startTestHost({ dataRoot, projectsRoot });
  const reopened = await readJson(await host.request(`${route}/open`, 'POST', {}));
  assert.equal(reopened.task.sessionFile, nativeFile); assert.equal(reopened.task.id, task.id);
  const receipts = await readJson(await host.request(`${route}/context-receipts`));
  assert.deepEqual(receipts.receipts.find((value: any) => value.requestId === requestId).providedContext.projectData, receipt.projectData);
  assert.equal(await (await host.request(`${base(project.id)}/datasets/${input.datasetId}/versions/${input.inputVersionId}/evidence`)).text(), source);
  assert.deepEqual(Buffer.from(await (await host.request(`${base(project.id)}/citations/${citationId}/evidence`)).arrayBuffer()), report);
  assert.deepEqual(Buffer.from(await (await host.request(`${base(project.id)}/citations/${citationId}/evidence?attachmentIndex=0`)).arrayBuffer()), attachment);
  assert.equal(await (await host.request(`${base(project.id)}/citations/${revisedCitationId}/evidence`)).text(), revisedReportText);
  assert.deepEqual((await readJson(await host.request(`${base(project.id)}/datasets/${input.datasetId}/descriptions/${description.descriptionRevisionId}`))).record, savedDescription.record);
  assert.equal(provider.requests.length, callsBeforeRetry, 'History/reopen/evidence readback cannot replay tools or models');
  assert.ok((await readFile(nativeFile)).subarray(0, nativeBeforeReopen.length).equals(nativeBeforeReopen));
  assert.deepEqual(provider.errors, []);
});

test('MC02/07 HTTP: explicitly fixed 020 input survives source edits and reopening without model execution', { timeout: 40_000 }, async t => {
  let host = await startTestHost(); t.after(() => host.close());
  await readJson(await host.request('/api/configuration', 'PUT', { name: 'M2无调用配置', provider: 'openai-compatible',
    baseUrl: 'http://127.0.0.1:1/v1', model: 'synthetic-m2', apiKey: 'synthetic-only-m2' }));
  const { project } = await readJson(await host.request('/api/projects', 'POST', { name: 'M2固定输入原项目' }), 201);
  const source = 'id,amount\nsynthetic-a,10\nsynthetic-b,20\n';
  await upload(host, project.id, 'sales.csv', source);
  const original = await readJson(await host.request(base(project.id)));
  assert.equal(original.index, null, 'Unselected projects must have no implicit data-context migration');
  assert.deepEqual(original.datasets, []);
  const input = fixedInput('020_clean/sales.csv', source);
  const saved = await readJson(await host.request(`${base(project.id)}/inputs`, 'POST', input), 201);
  assert.equal(saved.replayed, false); assert.equal(saved.indexRevision, 1);
  assert.equal(saved.record.projectId, project.id); assert.equal(saved.record.datasetId, input.datasetId);
  assert.equal(saved.record.inputVersionId, input.inputVersionId); assert.equal(saved.record.sha256, digest(source));
  assert.equal(saved.record.bytes, Buffer.byteLength(source)); assert.equal(saved.record.sourcePath, input.sourcePath);
  assert.deepEqual(saved.record.resultRef, { projectId: project.id, datasetId: input.datasetId, inputVersionId: input.inputVersionId });
  const route = `${base(project.id)}/datasets/${input.datasetId}/versions/${input.inputVersionId}`;
  assert.equal(await (await host.request(`${route}/evidence`)).text(), source);
  await writeFile(path.join(project.rootPath, input.sourcePath), 'id,amount\nsynthetic-a,999\n');
  assert.equal(await (await host.request(`${route}/evidence`)).text(), source, 'Historical fixed bytes cannot fall back to changed source');
  const replay = await readJson(await host.request(`${base(project.id)}/inputs`, 'POST', input));
  assert.equal(replay.replayed, true); assert.deepEqual(replay.record, saved.record);
  await readJson(await host.request(`${base(project.id)}/inputs`, 'POST', { ...input, name: 'changed intent' }), 409);
  const dataRoot = host.dataRoot, projectsRoot = host.projectsRoot;
  await host.close(); host = await startTestHost({ dataRoot, projectsRoot });
  assert.deepEqual((await readJson(await host.request(route))).record, saved.record);
  assert.equal(await (await host.request(`${route}/evidence`)).text(), source);
  assert.equal(await readFile(path.join(project.rootPath, input.sourcePath), 'utf8'), 'id,amount\nsynthetic-a,999\n');
  const summary = await readJson(await host.request(base(project.id)));
  assert.equal(summary.index.revision, 1); assert.equal(summary.datasets.length, 1);
});

test('MC03/04/08 HTTP: unknown observations, exact confirmations, concurrent CAS, foreign refs and archive preserve prior versions', { timeout: 40_000 }, async t => {
  const host = await startTestHost(); t.after(() => host.close());
  await readJson(await host.request('/api/configuration', 'PUT', { name: 'M2说明边界配置', provider: 'openai-compatible',
    baseUrl: 'http://127.0.0.1:1/v1', model: 'synthetic-m2-boundaries', apiKey: 'synthetic-only-m2-boundaries' }));
  const { project } = await readJson(await host.request('/api/projects', 'POST', { name: 'M2说明边界原项目' }), 201);
  const { project: other } = await readJson(await host.request('/api/projects', 'POST', { name: 'M2另一项目' }), 201);
  const source = 'id,amount\nsynthetic-a,10\n';
  await upload(host, project.id, 'boundaries.csv', source);
  const input = fixedInput('020_clean/boundaries.csv', source);
  await readJson(await host.request(`${base(project.id)}/inputs`, 'POST', input), 201);
  const badObservation = descriptionInput(input);
  await readJson(await host.request(`${base(project.id)}/descriptions`, 'POST', { ...badObservation,
    observation: { ...badObservation.observation, coverage: 'complete', scannedRows: 1, totalRows: 2 } }), 400);
  assert.equal((await readJson(await host.request(base(project.id)))).index.revision, 1, 'Invalid observation declarations cannot publish a pointer');
  const description = descriptionInput(input);
  const first = await readJson(await host.request(`${base(project.id)}/descriptions`, 'POST', description), 201);
  assert.deepEqual(first.record.observation, description.observation, 'Unknown counts and no fields cannot become a Host scan');
  assert.equal(first.record.statements[0].unit, null); assert.equal(first.record.statements[0].confirmedAt, null);
  await readJson(await host.request(`${base(project.id)}/descriptions`, 'POST', { ...description,
    statements: [{ ...description.statements[0], text: 'Same operation ID with different meaning' }] }), 409);
  const stale = descriptionInput(input, 1);
  await readJson(await host.request(`${base(project.id)}/descriptions`, 'POST', stale), 409);
  const left = descriptionInput(input, 2), right = descriptionInput(input, 2);
  const responses = await Promise.all([host.request(`${base(project.id)}/descriptions`, 'POST', left), host.request(`${base(project.id)}/descriptions`, 'POST', right)]);
  assert.deepEqual(responses.map(response => response.status).sort(), [201, 409], 'Two editors on one index revision cannot overwrite each other');
  const winner = await responses.find(response => response.status === 201)!.json() as any;
  const current = winner.record;
  const confirmId = randomUUID();
  const confirmation = await readJson(await host.request(`${base(project.id)}/descriptions`, 'POST', {
    operationId: confirmId, descriptionRevisionId: confirmId, datasetId: input.datasetId, inputVersionId: input.inputVersionId,
    baseIndexRevision: 3, baseDescriptionRevisionId: current.descriptionRevisionId, observation: current.observation,
    statements: current.statements, mappings: current.mappings, confirmStatementIds: [current.statements[0].statementId], confirmedBy: '合成用户',
  }), 201);
  assert.equal(confirmation.record.statements[0].confirmed, true);
  assert.match(confirmation.record.statements[0].confirmedAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(confirmation.record.statements[0].confirmedBy, '合成用户');
  assert.equal((await readJson(await host.request(`${base(project.id)}/datasets/${input.datasetId}/descriptions/${current.descriptionRevisionId}`))).record.statements[0].confirmed, false);
  const reviseId = randomUUID();
  const revised = await readJson(await host.request(`${base(project.id)}/descriptions`, 'POST', {
    operationId: reviseId, descriptionRevisionId: reviseId, datasetId: input.datasetId, inputVersionId: input.inputVersionId,
    baseIndexRevision: 4, baseDescriptionRevisionId: confirmId, observation: current.observation,
    statements: confirmation.record.statements, mappings: current.mappings,
  }), 201);
  assert.equal(revised.record.statements[0].confirmed, false, 'Saving another revision cannot silently inherit an old confirmation');
  assert.equal(revised.record.statements[0].confirmedAt, null);
  await readJson(await host.request(`${base(other.id)}/datasets/${input.datasetId}/versions/${input.inputVersionId}`), 404);
  await readJson(await host.request(`${base(other.id)}/prepare`, 'POST', { datasetId: input.datasetId, inputVersionId: input.inputVersionId }), 404);
  const badLink = descriptionInput(input, 5);
  badLink.mappings.push({ mappingId: randomUUID(), location: { kind: 'csv-column', columnIndex: 1 },
    conceptRefs: [{ storeId: randomUUID(), materialId: randomUUID(), revisionId: randomUUID() }], sapRefs: [],
    provenance: 'unknown', dispute: '来源尚不存在', confirmed: false, confirmedAt: null, confirmedBy: null });
  const wrongStore = await readJson(await host.request(`${base(project.id)}/descriptions`, 'POST', badLink), 409);
  assert.equal(wrongStore.code, 'data_context_concept_store_mismatch');
  const sourceStore = await readJson(await host.request('/api/enterprise-materials'));
  badLink.mappings[0].conceptRefs[0].storeId = sourceStore.storeId;
  badLink.operationId = badLink.descriptionRevisionId = randomUUID();
  const invalidLink = await readJson(await host.request(`${base(project.id)}/descriptions`, 'POST', badLink), 400);
  assert.equal(invalidLink.code, 'data_context_concept_unavailable');
  assert.equal((await readJson(await host.request(base(project.id)))).index.revision, 5);
  await readJson(await host.request(`/api/projects/${project.id}/archive`, 'POST', {}));
  await readJson(await host.request(`${base(project.id)}/inputs`, 'POST', fixedInput(input.sourcePath, source, 5, input.datasetId)), 409);
  await readJson(await host.request(`${base(project.id)}/prepare`, 'POST', { datasetId: input.datasetId, inputVersionId: input.inputVersionId }), 409);
  await readJson(await host.request(`${base(project.id)}/descriptions`, 'POST', descriptionInput(input, 5)), 409);
  assert.equal(await (await host.request(`${base(project.id)}/datasets/${input.datasetId}/versions/${input.inputVersionId}/evidence`)).text(), source);
  assert.deepEqual((await readJson(await host.request(`${base(project.id)}/datasets/${input.datasetId}/descriptions/${confirmId}`))).record, confirmation.record);
});

test('MC05/08 HTTP: a supplied description over 20,000 UTF-16 units refuses before dispatch while unselected and legacy requests remain compatible', { timeout: 40_000 }, async t => {
  const provider = await startToolProvider(), host = await startTestHost();
  t.after(async () => { await host.close(); await provider.close(); });
  await readJson(await host.request('/api/configuration', 'PUT', { name: 'M2附带说明边界', provider: 'openai-compatible',
    baseUrl: provider.baseUrl, model: 'synthetic-m2-limit', apiKey: 'synthetic-only-m2-limit' }));
  const { project } = await readJson(await host.request('/api/projects', 'POST', { name: 'M2附带说明超限' }), 201);
  const { task } = await readJson(await host.request(`/api/projects/${project.id}/tasks`, 'POST', { name: '原任务保持兼容' }), 201);
  const route = `/api/projects/${project.id}/tasks/${task.id}`;
  const source = 'id,amount\nsynthetic-a,10\n'; await upload(host, project.id, 'limit.csv', source);
  const input = fixedInput('020_clean/limit.csv', source); await readJson(await host.request(`${base(project.id)}/inputs`, 'POST', input), 201);
  const description = descriptionInput(input), marker = 'M2_UNSELECTED_DESCRIPTION_MUST_NOT_LEAK';
  description.statements[0].text = marker + 'a'.repeat(11_000);
  description.statements.push({ ...description.statements[0], statementId: randomUUID(), text: '😀'.repeat(5500) });
  await readJson(await host.request(`${base(project.id)}/descriptions`, 'POST', description), 201);
  await readJson(await host.request(`${base(project.id)}/prepare`, 'POST', { datasetId: input.datasetId, inputVersionId: input.inputVersionId }));
  const selection = { datasetId: input.datasetId, inputVersionId: input.inputVersionId, descriptionRevisionId: description.descriptionRevisionId };
  const oversized = await readJson(await host.request(`${route}/messages`, 'POST', { requestId: randomUUID(), text: '必须显式报错，不能剪掉说明后发送。', projectData: [selection] }), 413);
  assert.equal(oversized.code, 'data_context_materials_too_large');
  assert.equal(provider.requests.length, 0); assert.equal((await readJson(await host.request(route))).task.lastRun, undefined);
  const legacy = { requestId: randomUUID(), text: '未选择新说明时，保持原普通提问。' };
  await turn(host, project.id, task.id, legacy);
  assert.equal(provider.requests.length, 1);
  assert.ok(!JSON.stringify(provider.requests[0].body).includes(marker));
  await readJson(await host.request(`${route}/messages`, 'POST', legacy), 202);
  await readJson(await host.request(`${route}/messages`, 'POST', { ...legacy, projectData: [selection] }), 409);
  assert.equal(provider.requests.length, 1, 'Legacy retry cannot replay or silently add a new material selection');
  const detail = await readJson(await host.request(route));
  const rows = (await readFile(detail.task.sessionFile, 'utf8')).trim().split('\n').map(line => JSON.parse(line));
  const started = rows.find(value => value.customType === 'optracall.run' && value.data.phase === 'started' && value.data.requestId === legacy.requestId);
  assert.equal(started.data.providedContext?.projectData, undefined);
});

test('MC08 SDK: project descriptions stay out of independent cold and fixed-draft resources, cancellation cannot publish new provenance', { timeout: 60_000 }, async t => {
  const provider = await startToolProvider(), host = await startLegacyTestHost();
  t.after(async () => { await host.close(); await provider.close(); });
  await readJson(await host.request('/api/configuration', 'PUT', { name: 'M2冷读隔离配置', provider: 'openai-compatible',
    baseUrl: provider.baseUrl, model: 'synthetic-m2-cold', apiKey: 'synthetic-only-m2-cold' }));
  const { project } = await readJson(await host.request('/api/projects', 'POST', { name: 'M2资源边界原项目' }), 201);
  const { task } = await readJson(await host.request(`/api/projects/${project.id}/tasks`, 'POST', { name: '原作者任务' }), 201);
  const source = 'id,amount\nsynthetic-a,10\n'; await upload(host, project.id, 'cold.csv', source);
  const input = fixedInput('020_clean/cold.csv', source); await readJson(await host.request(`${base(project.id)}/inputs`, 'POST', input), 201);
  const description = descriptionInput(input), marker = 'M2_AUTHOR_PROJECT_DESCRIPTION_MUST_NOT_ENTER_COLD_OR_FIXED_DRAFT';
  description.statements[0].text = marker;
  await readJson(await host.request(`${base(project.id)}/descriptions`, 'POST', description), 201);
  await readJson(await host.request(`${base(project.id)}/prepare`, 'POST', { datasetId: input.datasetId, inputVersionId: input.inputVersionId }));
  const selection = { datasetId: input.datasetId, inputVersionId: input.inputVersionId, descriptionRevisionId: description.descriptionRevisionId };
  await turn(host, project.id, task.id, { requestId: randomUUID(), text: '只在原作者任务显式提供本轮说明。', projectData: [selection] });
  assert.ok(JSON.stringify(provider.requests[0].body).includes(marker));
  await readJson(await host.request(`/api/projects/${project.id}/files/save-report`, 'POST', { name: 'cold-author.md', text: '# 合成原稿\n合计10元。' }), 201);
  const route = `/api/projects/${project.id}/tasks/${task.id}`, verificationId = randomUUID(), verificationRoute = `${route}/verifications/${verificationId}`;
  const original = await readJson(await host.request(route));
  await readJson(await host.request(`${route}/verifications`, 'POST', { verificationId, question: '独立核对合成金额，未知可保留。',
    dataFiles: ['020_clean/cold.csv'], authorFiles: ['060_reports/cold-author.md'] }), 202);
  const verified = await eventually(async () => readJson(await host.request(verificationRoute)), value => ['completed', 'failed', 'cancelled', 'unknown'].includes(value.verification.status));
  assert.equal(verified.verification.status, 'completed');
  assert.equal(provider.requests.length, 3);
  for (const request of provider.requests.slice(1)) {
    const body = JSON.stringify(request.body);
    assert.ok(!body.includes(marker) && !body.includes(description.descriptionRevisionId), 'Independent resources cannot auto-inherit author dataset explanations');
  }
  await readJson(await host.request(`${verificationRoute}/author-revision`, 'POST', {}), 202);
  const revision = await eventually(async () => readJson(await host.request(verificationRoute)), value => value.verification.revision?.status && value.verification.revision.status !== 'running');
  assert.equal(revision.verification.revision.status, 'completed');
  assert.equal(revision.verification.revision.mode, 'fixed-draft');
  assert.equal(provider.requests.length, 4);
  assert.ok(!JSON.stringify(provider.requests[3].body).includes(marker));
  assert.ok(!JSON.stringify(provider.requests[3].body).includes(description.descriptionRevisionId));
  assert.deepEqual(provider.requests[3].body.tools ?? [], [], 'Fixed-draft keeps its existing empty executable-tool boundary');
  assert.deepEqual((await readJson(await host.request(route))).task, original.task);

  provider.setResponder(() => ({ text: '停止测试中保留的部分合成输出', hold: true }));
  const stream = await sessionEvents(host, project.id, task.id); t.after(() => stream.close());
  await readJson(await host.request(`${route}/messages`, 'POST', { requestId: randomUUID(), text: '带本轮资料执行停止路径。', projectData: [selection] }), 202);
  await provider.waitForRequests(5);
  await readJson(await host.request(`${route}/stop`, 'POST', {}));
  const stopped = await stream.terminal;
  assert.equal(stopped.type, 'run.settled'); if (stopped.type === 'run.settled') assert.equal(stopped.outcome, 'cancelled');
  const summary = await readJson(await host.request(base(project.id)));
  assert.equal(summary.index.revision, 2); assert.equal(summary.citations.length, 0, 'Cancellation and partial replies cannot fabricate report-source adoption');
  assert.equal((await readJson(await host.request(route))).task.sessionFile, original.task.sessionFile);
  assert.equal(await (await host.request(`${base(project.id)}/datasets/${input.datasetId}/versions/${input.inputVersionId}/evidence`)).text(), source);
  assert.deepEqual(provider.errors, []);
});
