import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID, createHash} from 'node:crypto';
import {startTestHost} from './fixtures/host-process.ts';

const stores = {kind: 'department' as const, id: 'east-retail', name: '华东零售事业部', enterpriseId: 'ent-1'};
const fields = {
  horizon: '2027–2029',
  diagnosis: '华东门店客流企稳，增长缺口集中在新客首购后二次到店。',
  propositions: [
    {id: 'P1', question: '复购提升能否驱动存量门店增长？', whyItMatters: '决定资源投向会员还是开店。', evidence: '上期复盘 90 天二购率约 9%。', gaps: '自然复购对照缺失。'},
    {id: 'P2', question: '导购触达能否用可控工时规模化？', whyItMatters: '决定试点能否推广。'},
    {id: 'P3', question: '会员投入与门店效率投入如何分配？', whyItMatters: '预算固定时的核心取舍。'},
  ],
  assumptions: '试点期间预算不变；触达获得授权。',
  evidenceGaps: '门店工时与自然复购待补证。',
  followUp: '候选须说明选择与放弃、资源倾斜及成立条件。',
  priorReview: 'applicable' as const,
};
const sources = [{kind: 'file' as const, ref: '010_draw/上期经营复盘.pdf', title: '上期经营复盘', sha256: 'a'.repeat(64)}];

test('真实 Host：开题报告版本链、Schema 门禁、锁定与应用', {timeout: 90_000}, async t => {
  const host = await startTestHost();
  t.after(async () => { await host.close(); });
  async function api(route: string, method = 'GET', input?: unknown, status = 200) {
    const response = await host.request(route, method, input), result = await response.json();
    assert.equal(response.status, status, JSON.stringify({route, result}));
    return result as Record<string, any>;
  }
  const initiativeId = randomUUID();
  await api('/api/strategy/initiatives', 'POST', {operationId: initiativeId, title: '华东门店增长战略', scopes: [stores]}, 201);
  const uploaded = (await api(`/api/strategy/initiatives/${initiativeId}/files`, 'POST', {operationId: randomUUID(), directory: '010_draw', name: '上期经营复盘.pdf', contentBase64: Buffer.from('合成经营复盘').toString('base64')}, 201)).file;
  const sources = [{kind: 'file' as const, ref: '010_draw/上期经营复盘.pdf', title: '上期经营复盘', fileId: uploaded.fileId, sha256: uploaded.sha256}];
  const base = `/api/strategy/initiatives/${initiativeId}/reports`;

  assert.deepEqual((await api(base)).versions, []);
  const invalid = await api(base, 'POST', {operationId: randomUUID(), fields: {...fields, propositions: fields.propositions.slice(0, 2)}, sources}, 400);
  assert.equal(invalid.code, 'strategy_kickoff_schema_invalid');
  const badId = await api(base, 'POST', {operationId: randomUUID(), fields: {...fields, propositions: fields.propositions.map((p, i) => ({...p, id: i === 1 ? 'P1' : p.id}))}, sources}, 400);
  assert.equal(badId.code, 'strategy_kickoff_schema_invalid');

  const saveInput = {operationId: randomUUID(), fields, sources};
  const v1 = (await api(base, 'POST', saveInput, 201)).version;
  assert.equal(v1.no, 1);
  assert.match(v1.contentSha256, /^[a-f0-9]{64}$/);
  assert.equal(v1.lock, undefined);
  assert.deepEqual((await api(base, 'POST', saveInput, 201)).version, v1);
  const conflict = await api(base, 'POST', {...saveInput, fields: {...fields, diagnosis: '不同诊断'}}, 409);
  assert.equal(conflict.code, 'strategy_kickoff_operation_conflict');

  const wrongSha = await api(`${base}/1/lock`, 'POST', {operationId: randomUUID(), sha256: '0'.repeat(64)}, 409);
  assert.equal(wrongSha.code, 'strategy_kickoff_version_conflict');
  const lockInput = {operationId: randomUUID(), sha256: v1.contentSha256, operator: '决策者甲'};
  const locked = (await api(`${base}/1/lock`, 'POST', lockInput)).version;
  assert.equal(locked.lock.fingerprint, v1.contentSha256);
  assert.equal(locked.lock.operator, '决策者甲');
  assert.ok(locked.lock.at);
  assert.deepEqual((await api(`${base}/1/lock`, 'POST', lockInput)).version, locked);
  const relock = await api(`${base}/1/lock`, 'POST', {operationId: randomUUID(), sha256: v1.contentSha256}, 409);
  assert.equal(relock.code, 'strategy_kickoff_already_locked');

  const applyUnlocked = await api(base, 'POST', {operationId: randomUUID(), fields: {...fields, diagnosis: '第二版诊断'}, sources, parent: 1}, 201);
  const v2 = applyUnlocked.version;
  assert.equal(v2.no, 2);
  assert.equal(v2.parent, 1);
  const draftApply = await api(`${base}/2/apply`, 'POST', {operationId: randomUUID(), sha256: v2.contentSha256, scope: stores}, 409);
  assert.equal(draftApply.code, 'strategy_kickoff_not_locked');
  const unknownScope = await api(`${base}/1/apply`, 'POST', {operationId: randomUUID(), sha256: v1.contentSha256, scope: {...stores, id: 'other-dept'}}, 409);
  assert.equal(unknownScope.code, 'strategy_initiative_scope_unknown');

  const applyInput = {operationId: randomUUID(), sha256: v1.contentSha256, scope: stores};
  const applied = (await api(`${base}/1/apply`, 'POST', applyInput)).anchor;
  assert.equal(applied.reportNo, 1);
  assert.equal(applied.contentSha256, v1.contentSha256);
  assert.deepEqual((await api(`${base}/1/apply`, 'POST', applyInput)).anchor, applied);
  const staleApply = await api(`${base}/1/apply`, 'POST', {operationId: randomUUID(), sha256: '0'.repeat(64), scope: stores}, 409);
  assert.equal(staleApply.code, 'strategy_kickoff_version_conflict');

  await api(`${base}/2/lock`, 'POST', {operationId: randomUUID(), sha256: v2.contentSha256});
  const reanchor = (await api(`${base}/2/apply`, 'POST', {operationId: randomUUID(), sha256: v2.contentSha256, scope: stores})).anchor;
  assert.equal(reanchor.reportNo, 2);
  const view = await api(base);
  assert.equal(view.anchors['department:ent-1:east-retail'].reportNo, 2);
  assert.equal(view.versions.length, 2);
  assert.equal(view.versions[0].lock.fingerprint, v1.contentSha256);
});