import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {startTestHost} from './fixtures/host-process.ts';

const stores = {kind: 'department' as const, id: 'east-retail', name: '华东零售事业部', enterpriseId: 'ent-1'};
const kickoffFields = {
  horizon: '2027–2029', diagnosis: '缺口。',
  propositions: [{id: 'P1', question: 'q1', whyItMatters: 'w1'}, {id: 'P2', question: 'q2', whyItMatters: 'w2'}, {id: 'P3', question: 'q3', whyItMatters: 'w3'}],
  assumptions: '', evidenceGaps: '', followUp: '',
};

test('真实 Host：版本历史聚合新记录与旧讨论身份，旧发布不计当前有效', {timeout: 90_000}, async t => {
  const host = await startTestHost();
  t.after(async () => { await host.close(); });
  const req = async (route: string, method = 'GET', body?: unknown, status = 200): Promise<any> => {
    const r = await host.request(route, method, body);
    assert.equal(r.status, status, await r.clone().text());
    return r.json();
  };
  const initiativeId = randomUUID();
  await req('/api/configuration', 'PUT', {name: '历史测试', provider: 'openai-compatible', baseUrl: 'http://127.0.0.1:14998/v1', model: 'synthetic', apiKey: 'synthetic-local'});
  await req('/api/strategy/initiatives', 'POST', {operationId: initiativeId, title: '历史事项', scopes: [stores]}, 201);
  const base = `/api/strategy/initiatives/${initiativeId}`;
  const v1 = (await req(`${base}/reports`, 'POST', {operationId: randomUUID(), fields: kickoffFields, sources: []}, 201)).version;
  await req(`${base}/reports/1/lock`, 'POST', {operationId: randomUUID(), sha256: v1.contentSha256});
  const legacyId = randomUUID();
  await req('/api/strategy/discussions', 'POST', {operationId: legacyId, title: '旧战略讨论'}, 201);
  const mapId = randomUUID();
  await req(`/api/strategy/discussions/${legacyId}/maps`, 'POST', {
    mapId, operationId: randomUUID(), expectedVersion: 0, reason: '旧地图',
    draft: {title: '旧图', template: 'table', choice: '旧选择', excluded: '', assumptions: '', unknowns: '', nodes: [{id: 'S1', kind: 'strategy', title: '旧策略'}], edges: []},
  }, 201);
  await req(`/api/strategy/discussions/${legacyId}/maps/${mapId}/versions/1/publication`, 'POST', {operationId: randomUUID(), sha256: '0'.repeat(64)}, 409);

  const history = await req(`${base}/history`);
  assert.equal(history.reports.versions.length, 1);
  assert.equal(history.reports.versions[0].lock.fingerprint, v1.contentSha256);
  assert.deepEqual(history.candidates, []);
  assert.deepEqual(history.verifications, []);
  assert.deepEqual(history.publications, []);
  const legacy = history.legacy.discussions.find((d: any) => d.id === legacyId);
  assert.ok(legacy, 'legacy discussion keeps its identity');
  assert.equal(legacy.title, '旧战略讨论');
  assert.match(legacy.note, /不计为当前有效版/);
  assert.deepEqual((await req(`/api/strategy/discussions/${legacyId}/maps/${mapId}/publications`)).publications, []);
  const goals = await req('/api/strategy/goals');
  assert.equal(goals.goals.length, 0);
});