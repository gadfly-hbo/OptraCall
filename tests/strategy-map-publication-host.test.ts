import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {startTestHost} from './fixtures/host-process.ts';

// Issue #120：旧地图发布与地图承接退出写入路径（Spec §5 兼容与失败边界）。
// 读取保留；新发布与承接统一走战略事项的锁定、双检验与人工发布路径。
test('真实 Host：旧地图发布与承接写入退役，读取保留且不创建目标', {timeout: 90_000}, async t => {
  let host = await startTestHost();
  t.after(() => host.close());
  async function api(route: string, method = 'GET', input?: unknown, status = 200) {
    const response = await host.request(route, method, input), result = await response.json();
    assert.equal(response.status, status, JSON.stringify({route, result}));
    return result as Record<string, any>;
  }
  await api('/api/configuration', 'PUT', {
    name: '地图发布退役测试', provider: 'openai-compatible', baseUrl: 'http://127.0.0.1:14998/v1',
    model: 'synthetic', apiKey: 'synthetic-local',
  });
  const discussionId = randomUUID(), mapId = randomUUID();
  await api('/api/strategy/discussions', 'POST', {operationId: discussionId, title: '旧地图测试'}, 201);
  const mapRoute = `/api/strategy/discussions/${discussionId}/maps`;
  const publicationRoute = `${mapRoute}/${mapId}/publications`;
  const versionPublicationRoute = (version: number) => `${mapRoute}/${mapId}/versions/${version}/publication`;
  const node = {id: 'G1', kind: 'goal' as const, title: '会员复购', metric: '90天复购率', baseline: '9%', target: '12%'};
  const strategy = {id: 'S1', kind: 'strategy' as const, title: '首购后回访'};
  const edge = {id: 'S1-G1', from: 'S1', to: 'G1', kind: 'supports' as const};
  const v1 = (await api(mapRoute, 'POST', {
    mapId, operationId: randomUUID(), expectedVersion: 0, reason: '旧地图版本',
    draft: {title: '会员经营', template: 'table', choice: '会员经营', excluded: '', assumptions: '', unknowns: '', nodes: [node, strategy], edges: [edge]},
  }, 201)).version;

  assert.deepEqual((await api(publicationRoute)).publications, []);
  const publish = await api(versionPublicationRoute(v1.version), 'POST', {operationId: randomUUID(), sha256: v1.contentSha256}, 409);
  assert.equal(publish.code, 'strategy_map_publication_retired');
  const withdraw = await api(`${versionPublicationRoute(v1.version)}/withdraw`, 'POST', {operationId: randomUUID(), publicationId: randomUUID(), sha256: v1.contentSha256}, 409);
  assert.equal(withdraw.code, 'strategy_map_publication_retired');
  const dest = {scope: {kind: 'personal', id: 'self', name: '个人工作'}, perspective: 'personal'};
  const handoff = await api('/api/strategy/workbooks/handoff', 'POST', {map: {discussionId, mapId, version: v1.version, sha256: v1.contentSha256}, publicationId: randomUUID(), selected: ['G1'], ...dest}, 409);
  assert.equal(handoff.code, 'strategy_workbook_handoff_retired');
  const noPubHandoff = await api('/api/strategy/workbooks/handoff', 'POST', {map: {discussionId, mapId, version: v1.version, sha256: v1.contentSha256}, selected: ['G1'], ...dest}, 409);
  assert.equal(noPubHandoff.code, 'strategy_workbook_handoff_retired');
  assert.deepEqual((await api(publicationRoute)).publications, []);
  assert.deepEqual((await api(`${mapRoute}/${mapId}/versions/${v1.version}/handoffs`)).goals, []);
  assert.equal((await api('/api/strategy/goals')).goals.length, 0);
  assert.ok((await api(`${mapRoute}/${mapId}/versions/${v1.version}/export`)).html, 'map document export read preserved');

  await host.close();
  host = await startTestHost({dataRoot: host.dataRoot, projectsRoot: host.projectsRoot});
  assert.deepEqual((await api(publicationRoute)).publications, []);
  assert.equal((await api(versionPublicationRoute(v1.version), 'POST', {operationId: randomUUID(), sha256: v1.contentSha256}, 409)).code, 'strategy_map_publication_retired');
  assert.equal((await api('/api/strategy/goals')).goals.length, 0);
});