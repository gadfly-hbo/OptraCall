import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {rename} from 'node:fs/promises';
import {join} from 'node:path';
import * as XLSX from 'xlsx';
import {defaultSelection} from '../src/host/strategy-workbook-types.ts';
import {startTestHost} from './fixtures/host-process.ts';

test('真实 Host：战略地图正式发布按准确版本门禁目标承接并持久保留记录', {timeout: 90_000}, async t => {
  let host = await startTestHost();
  t.after(async () => { await host.close(); });
  async function api(route: string, method = 'GET', input?: unknown, status = 200) {
    const response = await host.request(route, method, input), result = await response.json();
    assert.equal(response.status, status, JSON.stringify({route, result}));
    return result as Record<string, any>;
  }
  await api('/api/configuration', 'PUT', {
    name: '地图发布测试', provider: 'openai-compatible', baseUrl: 'http://127.0.0.1:14998/v1',
    model: 'synthetic', apiKey: 'synthetic-local',
  });

  const discussionId = randomUUID(), mapId = randomUUID();
  await api('/api/strategy/discussions', 'POST', {operationId: discussionId, title: '会员战略发布'}, 201);
  const mapRoute = `/api/strategy/discussions/${discussionId}/maps`;
  const publicationRoute = `${mapRoute}/${mapId}/publications`;
  const versionPublicationRoute = (version: number) => `${mapRoute}/${mapId}/versions/${version}/publication`;
  const node = (title: string) => ({id: 'G1', kind: 'goal' as const, title, metric: '90天复购率', baseline: '9%', target: '12%'});
  const edge = {id: 'S1-G1', from: 'S1', to: 'G1', kind: 'supports' as const};
  const strategy = {id: 'S1', kind: 'strategy' as const, title: '首购后回访'};
  const save = (version: number, title: string) => api(mapRoute, 'POST', {
    mapId, operationId: randomUUID(), expectedVersion: version - 1, reason: `候选 ${version}`,
    draft: {title, template: 'table', choice: title, excluded: '', assumptions: '', unknowns: '',
      nodes: [node(`会员复购 v${version}`), strategy], edges: [edge]},
  }, 201);
  const v1 = (await save(1, '会员经营')).version;
  const v2 = (await save(2, '会员经营修订')).version;
  const v3 = (await save(3, '会员经营新候选')).version;
  const ref = (version: {mapId: string; version: number; contentSha256: string}, sha256 = version.contentSha256) =>
    ({discussionId, mapId: version.mapId, version: version.version, sha256});
  const dest = {scope: {kind: 'personal', id: 'self', name: '个人工作'}, perspective: 'personal'};

  assert.deepEqual((await api(publicationRoute)).publications, []);
  const denied = await api('/api/strategy/workbooks/handoff', 'POST', {map: ref(v2), selected: ['G1'], ...dest}, 409);
  assert.equal(denied.code, 'strategy_map_publication_required');
  assert.equal((await api('/api/strategy/goals')).goals.length, 0);
  assert.equal((await api(`${versionPublicationRoute(v1.version)}`, 'POST', {
    operationId: randomUUID(), sha256: '0'.repeat(64),
  }, 409)).code, 'strategy_map_version_conflict');

  const publishInput = {operationId: randomUUID(), sha256: v1.contentSha256};
  const first = (await api(`${versionPublicationRoute(v1.version)}`, 'POST', publishInput, 201)).publication;
  assert.equal(first.state, 'active');
  assert.equal(first.version, v1.version);
  assert.equal(first.contentSha256, v1.contentSha256);
  assert.deepEqual((await api(`${versionPublicationRoute(v1.version)}`, 'POST', publishInput, 201)).publication, first);

  const second = (await api(`${versionPublicationRoute(v2.version)}`, 'POST', {
    operationId: randomUUID(), sha256: v2.contentSha256,
  }, 201)).publication;
  const records = (await api(publicationRoute)).publications;
  assert.equal(second.state, 'active');
  assert.deepEqual(records.map((row: any) => [row.version, row.state]), [[v1.version, 'superseded'], [v2.version, 'active']]);
  assert.equal((await api('/api/strategy/workbooks/handoff', 'POST', {map: ref(v1), publicationId: first.publicationId, selected: ['G1'], ...dest}, 409)).code, 'strategy_map_not_published');
  assert.equal((await api('/api/strategy/workbooks/handoff', 'POST', {map: ref(v2), selected: ['G1'], ...dest}, 409)).code, 'strategy_map_publication_required');
  assert.equal((await api('/api/strategy/workbooks/handoff', 'POST', {map: ref(v2), publicationId: randomUUID(), selected: ['G1'], ...dest}, 409)).code, 'strategy_map_publication_conflict');
  const mismatchedPerspective = await api('/api/strategy/workbooks/handoff', 'POST', {
    map: ref(v2), publicationId: second.publicationId, selected: ['G1'], ...dest, perspective: 'nonprofit',
  }, 400);
  assert.equal(mismatchedPerspective.code, 'invalid_strategy_goal_perspective');
  assert.equal((await api('/api/strategy/goals')).goals.length, 0);

  const {goals} = await api('/api/strategy/workbooks/handoff', 'POST', {map: ref(v2), publicationId: second.publicationId, selected: ['G1'], ...dest});
  assert.equal(goals.length, 1);
  assert.deepEqual(goals[0].structured.map, ref(v2));
  const handoffs = (await api(`${mapRoute}/${mapId}/versions/${v2.version}/handoffs`)).goals;
  assert.equal(handoffs.length, 1);
  assert.equal(handoffs[0].publicationId, second.publicationId);
  assert.equal(handoffs[0].historical, false);
  assert.deepEqual((await api('/api/strategy/workbooks/handoff', 'POST', {map: ref(v2), publicationId: second.publicationId, selected: ['G1'], ...dest})).goals, goals);

  const withdrawInput = {operationId: randomUUID(), publicationId: second.publicationId, sha256: v2.contentSha256};
  const withdrawn = (await api(`${versionPublicationRoute(v2.version)}/withdraw`, 'POST', withdrawInput, 200)).publication;
  assert.equal(withdrawn.state, 'withdrawn');
  assert.ok(withdrawn.withdrawnAt);
  assert.deepEqual((await api(`${versionPublicationRoute(v2.version)}/withdraw`, 'POST', withdrawInput, 200)).publication, withdrawn);
  assert.equal((await api('/api/strategy/workbooks/handoff', 'POST', {map: ref(v2), publicationId: second.publicationId, selected: ['G1'], ...dest}, 409)).code, 'strategy_map_not_published');
  assert.equal((await api(`${versionPublicationRoute(v2.version)}`, 'POST', {operationId: randomUUID(), sha256: v2.contentSha256}, 409)).code, 'strategy_map_publication_already_published');
  const goalAfterWithdraw = (await api(`/api/strategy/goals/${goals[0].goalId}`)).goal;
  assert.equal(goalAfterWithdraw.currentVersion, 1);
  assert.deepEqual(goalAfterWithdraw.versions[0].structured.map, ref(v2));
  assert.deepEqual((await api(`${mapRoute}/${mapId}/versions/${v2.version}/handoffs`)).goals, handoffs);

  await host.close();
  {
    const {readFile,writeFile}=await import('node:fs/promises');
    const indexFile=join(host.dataRoot,'strategy-goals','index.json');
    const index=JSON.parse(await readFile(indexFile,'utf8')) as {tableReceipts:Record<string,{goalId:string;version:number;publication?:unknown}[]>};
    for(const refs of Object.values(index.tableReceipts)){
      for(const item of refs){
        if(item.goalId===goals[0].goalId&&item.version===goals[0].version)delete item.publication;
      }
    }
    await writeFile(indexFile,JSON.stringify(index));
  }
  host = await startTestHost({dataRoot: host.dataRoot, projectsRoot: host.projectsRoot});
  const reopened = (await api(publicationRoute)).publications;
  assert.deepEqual(reopened.map((row: any) => [row.version, row.state]), [[v1.version, 'superseded'], [v2.version, 'withdrawn']]);
  const legacyHandoffs = (await api(`${mapRoute}/${mapId}/versions/${v2.version}/handoffs`)).goals;
  assert.equal(legacyHandoffs.length, 1);
  assert.equal(legacyHandoffs[0].historical, true);
  assert.equal(legacyHandoffs[0].publicationId, undefined);
  const third = (await api(`${versionPublicationRoute(v3.version)}`, 'POST', {operationId: randomUUID(), sha256: v3.contentSha256}, 201)).publication;
  assert.equal(third.state, 'active');
  const carried = (await api('/api/strategy/workbooks/handoff', 'POST', {map: ref(v3), publicationId: third.publicationId, selected: ['G1'], ...dest, expected: {G1: {goalId: goals[0].goalId, version: goals[0].version}}})).goals;
  assert.equal(carried[0].structured.map.version, v3.version);

  const noGoalMapId = randomUUID(), noGoalRoute = `/api/strategy/discussions/${discussionId}/maps/${noGoalMapId}/versions/1/publication`;
  const noGoal = (await api(mapRoute, 'POST', {
    mapId: noGoalMapId, operationId: randomUUID(), expectedVersion: 0, reason: '无目标地图仍可发布',
    draft: {title: '策略说明', template: 'table', choice: '仅保留策略', excluded: '', assumptions: '', unknowns: '', nodes: [strategy], edges: []},
  }, 201)).version;
  const noGoalPublication = (await api(noGoalRoute, 'POST', {operationId: randomUUID(), sha256: noGoal.contentSha256}, 201)).publication;
  assert.equal(noGoalPublication.state, 'active');
  assert.equal(noGoalPublication.goalCount, 0);
  assert.equal((await api('/api/strategy/workbooks/handoff', 'POST', {map: ref(noGoal), publicationId: noGoalPublication.publicationId, selected: ['G1'], ...dest}, 400)).code, 'invalid_strategy_goal_selection');
});

test('真实 Host：发布操作按准确身份重试，失读时可撤销，旧候选不能接替新发布', {timeout: 90_000}, async t => {
  const host = await startTestHost();
  t.after(() => host.close());
  async function api(route: string, method = 'GET', input?: unknown, status = 200) {
    const response = await host.request(route, method, input), result = await response.json();
    assert.equal(response.status, status, JSON.stringify({route, result}));
    return result;
  }
  await api('/api/configuration', 'PUT', {
    name: '地图发布操作测试', provider: 'openai-compatible', baseUrl: 'http://127.0.0.1:14998/v1',
    model: 'synthetic', apiKey: 'synthetic-local',
  });
  const discussionId = randomUUID();
  await api('/api/strategy/discussions', 'POST', {operationId: discussionId, title: '同地图发布顺序'}, 201);
  const mapRoute = `/api/strategy/discussions/${discussionId}/maps`;
  const workbook = XLSX.utils.book_new();
  const sheet = XLSX.utils.aoa_to_sheet([['目标编号', '目标项', '指标', '基线', '目标值'], ['G1', '覆盖', '覆盖率', '30%', '50%']]);
  XLSX.utils.book_append_sheet(workbook, sheet, '目标表');
  const fileName = '合成覆盖地图.xlsx';
  async function importMap(title: string, base?: {discussionId: string; mapId: string; version: number; sha256: string}) {
    const bytes = XLSX.write(workbook, {bookType: 'xlsx', type: 'base64'}) as string;
    const {book} = await api('/api/strategy/workbooks/preview', 'POST', {fileName, bytes});
    return (await api('/api/strategy/workbooks/commit', 'POST', {
      fileName, bytes, target: 'map', discussionId, selection: defaultSelection(book, 'map'), title, ...(base&&{base}),
    })).version;
  }
  const first = await importMap('覆盖规划');
  sheet.E2.v = '55%';
  const second = await importMap('覆盖规划修订', {discussionId, mapId: first.mapId, version: first.version, sha256: first.contentSha256});
  assert.equal(second.mapId, first.mapId);
  const publicationRoute = (version: number) => `${mapRoute}/${first.mapId}/versions/${version}/publication`;
  const publicationsRoute = `${mapRoute}/${first.mapId}/publications`;
  const publishInput = {operationId: randomUUID(), sha256: second.contentSha256};
  const {publication} = await api(publicationRoute(second.version), 'POST', publishInput, 201);
  const withdrawInput = {operationId: randomUUID(), publicationId: publication.publicationId, sha256: second.contentSha256};
  const withdrawRoute = publicationRoute(second.version)+'/withdraw';
  const conflict = 'strategy_map_publication_operation_conflict';
  assert.equal((await api(withdrawRoute, 'POST', {...withdrawInput, operationId: publishInput.operationId}, 409)).code, conflict);
  assert.equal((await api(publicationRoute(first.version), 'POST', {...publishInput, sha256: first.contentSha256}, 409)).code, conflict);
  assert.deepEqual((await api(publicationsRoute)).publications, [publication]);
  assert.equal((await api(publicationRoute(first.version), 'POST', {
    operationId: randomUUID(), sha256: first.contentSha256,
  }, 409)).code, 'strategy_map_publication_version_outdated');

  const original = join(host.dataRoot, 'strategy-workbooks', 'discussion-'+discussionId, second.importSource.sha256+'.xlsx');
  await rename(original, original+'.unavailable');
  const sourceExport = await api(`${mapRoute}/${second.mapId}/versions/${second.version}/export`, 'GET', undefined, 409);
  assert.equal(sourceExport.code, 'strategy_workbook_source_unavailable');
  assert.equal((await api(publicationRoute(first.version)+'/withdraw', 'POST', withdrawInput, 409)).code, 'strategy_map_publication_conflict');
  assert.equal((await api(withdrawRoute, 'POST', {...withdrawInput, sha256: '0'.repeat(64)}, 409)).code, 'strategy_map_publication_conflict');
  const {publication: withdrawn} = await api(withdrawRoute, 'POST', withdrawInput);
  assert.equal(withdrawn.state, 'withdrawn');
  assert.deepEqual((await api(withdrawRoute, 'POST', withdrawInput)).publication, withdrawn);
  assert.deepEqual((await api(publicationRoute(second.version), 'POST', publishInput, 201)).publication, withdrawn);
  assert.equal((await api(publicationRoute(first.version)+'/withdraw', 'POST', withdrawInput, 409)).code, conflict);
  assert.equal((await api(publicationRoute(first.version), 'POST', {operationId: withdrawInput.operationId, sha256: first.contentSha256}, 409)).code, conflict);
  assert.equal((await api(publicationRoute(first.version), 'POST', {
    operationId: randomUUID(), sha256: first.contentSha256,
  }, 409)).code, 'strategy_map_publication_version_outdated');
  assert.deepEqual((await api(publicationsRoute)).publications, [withdrawn]);
  await rename(original+'.unavailable', original);
  const denied = await api('/api/strategy/workbooks/handoff', 'POST', {
    map: {discussionId, mapId: second.mapId, version: second.version, sha256: second.contentSha256},
    publicationId: publication.publicationId,
    selected: ['G1'],
    scope: {kind: 'personal', id: 'self', name: '个人工作'},
    perspective: 'personal',
  }, 409);
  assert.equal(denied.code, 'strategy_map_not_published');
  assert.equal((await api('/api/strategy/goals')).goals.length, 0);
});
