import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID, createHash} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {startTestHost} from './fixtures/host-process.ts';
import {startToolProvider} from './fixtures/tool-provider.ts';

const stores = {kind: 'department' as const, id: 'east-retail', name: '华东零售事业部', enterpriseId: 'ent-1'};
const textSha = (text: string) => createHash('sha256').update(text).digest('hex');
const kickoffFields = {
  horizon: '2027–2029',
  diagnosis: '华东门店客流企稳，增长缺口集中在新客首购后二次到店。',
  propositions: [
    {id: 'P1', question: '复购提升能否驱动存量门店增长？', whyItMatters: '决定资源投向。'},
    {id: 'P2', question: '导购触达能否用可控工时规模化？', whyItMatters: '决定试点推广。'},
    {id: 'P3', question: '会员投入与门店效率投入如何分配？', whyItMatters: '核心取舍。'},
  ],
  assumptions: '试点期间预算不变。',
  evidenceGaps: '自然复购待补证。',
  followUp: '候选须说明选择与放弃。',
};

test('真实 Host：开题限定修订白名单、原字节保留与负例', {timeout: 90_000}, async t => {
  const host = await startTestHost();
  t.after(async () => { await host.close(); });
  const req = async (route: string, method = 'GET', body?: unknown, status = 200): Promise<any> => {
    const r = await host.request(route, method, body);
    assert.equal(r.status, status, await r.clone().text());
    return r.json();
  };
  const initiativeId = randomUUID();
  await req('/api/strategy/initiatives', 'POST', {operationId: initiativeId, title: '修订事项', scopes: [stores]}, 201);
  const base = `/api/strategy/initiatives/${initiativeId}/reports`;
  const uploaded = (await req(`/api/strategy/initiatives/${initiativeId}/files`, 'POST', {operationId: randomUUID(), directory: '010_draw', name: '复盘.md', contentBase64: Buffer.from('合成复盘').toString('base64')}, 201)).file;
  const v1 = (await req(base, 'POST', {operationId: randomUUID(), fields: kickoffFields, sources: [{kind: 'file', ref: '010_draw/复盘.md', fileId: uploaded.fileId, sha256: uploaded.sha256}]}, 201)).version;
  await req(`${base}/1/lock`, 'POST', {operationId: randomUUID(), sha256: v1.contentSha256});
  await req(`${base}/1/apply`, 'POST', {operationId: randomUUID(), sha256: v1.contentSha256, scope: stores});

  const newDiagnosis = '华东门店客流企稳，增长缺口集中在会员二次到店与导购触达。';
  const operationId = randomUUID();
  const reviseInput = {operationId, baseSha256: v1.contentSha256, request: '把诊断补充导购触达。', patches: [{blockId: 'diagnosis', expectedOldSha256: textSha(kickoffFields.diagnosis), newText: newDiagnosis}]};
  const v2 = (await req(`${base}/1/revise`, 'POST', reviseInput, 201)).version;
  assert.equal(v2.no, 2);
  assert.equal(v2.parent, 1);
  assert.equal(v2.generation.kind, 'revision');
  assert.equal(v2.fields.diagnosis, newDiagnosis);
  assert.equal(v2.fields.horizon, kickoffFields.horizon);
  assert.deepEqual(v2.fields.propositions, kickoffFields.propositions);
  assert.equal(v2.lock, undefined);
  assert.deepEqual(v2.revision.patches, [{blockId: 'diagnosis', oldSha256: textSha(kickoffFields.diagnosis), newSha256: textSha(newDiagnosis)}]);
  const after = (await req(base)).versions;
  assert.equal(after[0].contentSha256, v1.contentSha256, 'base version bytes preserved');
  assert.equal(after[0].lock.fingerprint, v1.contentSha256);
  assert.deepEqual((await req(`${base}/1/revise`, 'POST', reviseInput, 201)).version, v2);
  assert.equal((await req(`${base}/1/revise`, 'POST', {...reviseInput, patches: [{...reviseInput.patches[0], newText: '另一段诊断'}]}, 409)).code, 'strategy_kickoff_operation_conflict');
  assert.equal((await req(`${base}/1/revise`, 'POST', {...reviseInput, operationId: randomUUID(), baseSha256: '0'.repeat(64)}, 409)).code, 'strategy_kickoff_version_conflict');
  assert.equal((await req(`${base}/1/revise`, 'POST', {...reviseInput, operationId: randomUUID(), patches: [{blockId: 'unknown', expectedOldSha256: textSha('x'), newText: 'y'}]}, 400)).code, 'strategy_kickoff_patch_target_invalid');
  assert.equal((await req(`${base}/1/revise`, 'POST', {...reviseInput, operationId: randomUUID(), patches: [{blockId: 'diagnosis', expectedOldSha256: textSha('错误旧值'), newText: 'y'}]}, 409)).code, 'strategy_kickoff_old_value_conflict');
  const propositionPatch = {operationId: randomUUID(), baseSha256: v1.contentSha256, request: '改命题问法。', patches: [{blockId: 'proposition:P1:question', expectedOldSha256: textSha(kickoffFields.propositions[0].question), newText: '复购提升能否驱动存量门店增长（含试点）？'}]};
  const v3 = (await req(`${base}/1/revise`, 'POST', propositionPatch, 201)).version;
  assert.equal(v3.no, 3);
  assert.equal(v3.fields.propositions[0].question, '复购提升能否驱动存量门店增长（含试点）？');
  assert.equal(v3.fields.propositions[1].question, kickoffFields.propositions[1].question);
  assert.equal((await req(`${base}/2/apply`, 'POST', {operationId: randomUUID(), sha256: v2.contentSha256, scope: stores}, 409)).code, 'strategy_kickoff_not_locked');
});

test('真实 Host+Pi：候选锁定指纹、编辑锁定版立新候选新会话', {timeout: 150_000}, async t => {
  const provider = await startToolProvider(), host = await startTestHost();
  t.after(async () => { await host.close(); await provider.close(); });
  const req = async (route: string, method = 'GET', body?: unknown, status = 200): Promise<any> => {
    const r = await host.request(route, method, body);
    assert.equal(r.status, status, await r.clone().text());
    return r.json();
  };
  await req('/api/configuration', 'PUT', {name: '锁定合成', provider: 'openai-compatible', baseUrl: provider.baseUrl, model: 'synthetic-lock', apiKey: 'synthetic-lock-only'});
  const initiativeId = randomUUID();
  await req('/api/strategy/initiatives', 'POST', {operationId: initiativeId, title: '锁定事项', scopes: [stores]}, 201);
  const base = `/api/strategy/initiatives/${initiativeId}`;
  const report = (await req(`${base}/reports`, 'POST', {operationId: randomUUID(), fields: kickoffFields, sources: []}, 201)).version;
  await req(`${base}/reports/1/lock`, 'POST', {operationId: randomUUID(), sha256: report.contentSha256});
  await req(`${base}/reports/1/apply`, 'POST', {operationId: randomUUID(), sha256: report.contentSha256, scope: stores});
  const blocks = [
    {id: 'B1', label: '战略定位与增长路径', text: '深耕现有门店，先验证再推广。'},
    {id: 'B2', label: '三年目标与里程碑', text: '2027 试点，2028 推广，2029 达成核心指标。'},
    {id: 'B3', label: '资源分配与明确不做', text: '优先配置试点工时，暂缓大规模开店。'},
  ];
  provider.setResponder(ctx => ctx.recentToolResults.length
    ? {text: '候选已保存。'}
    : {calls: [{name: 'strategy_goals', arguments: {action: 'initiative-save-candidate', operationId: randomUUID(), candidateBlocks: blocks}}]});
  const created = await req(`${base}/candidates`, 'POST', {operationId: randomUUID(), scope: stores, title: '会员复购优先', instruction: '形成方案。'}, 202);
  const cid = created.candidate.candidateId;
  let detail: any;
  for (let n = 0; n < 500; n++) { detail = await req(`${base}/candidates/${cid}/versions/1`); if (detail.candidate.lastRun?.status === 'completed') break; await delay(20); }
  assert.equal(detail.candidate.lastRun.status, 'completed');
  const sha = detail.candidate.contentSha256;

  assert.equal((await req(`${base}/candidates/${cid}/versions/1/lock`, 'POST', {operationId: randomUUID(), sha256: '0'.repeat(64)}, 409)).code, 'strategy_candidate_version_conflict');
  const lockInput = {operationId: randomUUID(), sha256: sha, operator: '决策者甲'};
  const locked = (await req(`${base}/candidates/${cid}/versions/1/lock`, 'POST', lockInput)).candidate;
  assert.equal(locked.lock.fingerprint, sha);
  assert.equal(locked.lock.operator, '决策者甲');
  assert.deepEqual((await req(`${base}/candidates/${cid}/versions/1/lock`, 'POST', lockInput)).candidate.lock, locked.lock);
  assert.equal((await req(`${base}/candidates/${cid}/versions/1/lock`, 'POST', {operationId: randomUUID(), sha256: sha}, 409)).code, 'strategy_candidate_already_locked');
  assert.equal((await req(`${base}/candidates/${cid}/versions/1/messages`, 'POST', {requestId: randomUUID(), text: '改一下。', expectedRevision: locked.revision}, 409)).code, 'strategy_candidate_locked');

  const newText = '深耕现有门店，以首购后分层回访带动二次到店；先验证成熟店。';
  const reviseInput = {operationId: randomUUID(), baseSha256: sha, request: '把定位补充回访机制。', patches: [{blockId: 'B1', expectedOldSha256: textSha(blocks[0].text), newText}]};
  const v2 = (await req(`${base}/candidates/${cid}/versions/1/revise`, 'POST', reviseInput, 201)).candidate;
  assert.equal(v2.no, 2);
  assert.deepEqual(v2.parent, {candidateId: cid, no: 1});
  assert.deepEqual(v2.anchor, locked.anchor);
  assert.equal(v2.blocks[0].text, newText);
  assert.equal(v2.blocks[1].text, blocks[1].text, 'unselected blocks keep original bytes');
  assert.equal(v2.blocks[2].text, blocks[2].text);
  assert.equal(v2.lock, undefined);
  assert.equal(v2.sessionFile, undefined);
  assert.deepEqual(v2.revisionMeta.patches, [{blockId: 'B1', oldSha256: textSha(blocks[0].text), newSha256: textSha(newText)}]);
  assert.deepEqual((await req(`${base}/candidates/${cid}/versions/1/revise`, 'POST', reviseInput, 201)).candidate, v2);
  assert.equal((await req(`${base}/candidates/${cid}/versions/1/revise`, 'POST', {...reviseInput, operationId: randomUUID(), baseSha256: '0'.repeat(64)}, 409)).code, 'strategy_candidate_version_conflict');
  assert.equal((await req(`${base}/candidates/${cid}/versions/1/revise`, 'POST', {...reviseInput, operationId: randomUUID(), patches: [{blockId: 'B9', expectedOldSha256: textSha('x'), newText: 'y'}]}, 400)).code, 'strategy_candidate_patch_target_invalid');
  assert.equal((await req(`${base}/candidates/${cid}/versions/1/revise`, 'POST', {...reviseInput, operationId: randomUUID(), patches: [{blockId: 'B1', expectedOldSha256: textSha('错误旧值'), newText: 'y'}]}, 409)).code, 'strategy_candidate_old_value_conflict');
  const v1After = (await req(`${base}/candidates/${cid}/versions/1`)).candidate;
  assert.equal(v1After.lock.fingerprint, sha, 'old lock preserved');
  assert.equal(v1After.blocks[0].text, blocks[0].text);

  provider.setResponder(() => ({text: '修订版会话已继续。'}));
  await req(`${base}/candidates/${cid}/versions/2/messages`, 'POST', {requestId: randomUUID(), text: '请核对修订后的成立条件。', expectedRevision: v2.revision}, 202);
  let d2: any;
  for (let n = 0; n < 500; n++) { d2 = await req(`${base}/candidates/${cid}/versions/2`); if (d2.candidate.lastRun?.status === 'completed') break; await delay(20); }
  assert.equal(d2.candidate.lastRun.status, 'completed');
  assert.ok(d2.snapshot.sessionFile);
  const d1 = await req(`${base}/candidates/${cid}/versions/1`);
  assert.notEqual(d2.snapshot.sessionFile, d1.snapshot.sessionFile, 'revision version owns a new persistent session');
  assert.deepEqual(provider.errors, []);
});