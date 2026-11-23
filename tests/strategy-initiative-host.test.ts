import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdtemp} from 'node:fs/promises';
import {join} from 'node:path';
import os from 'node:os';
import {startTestHost} from './fixtures/host-process.ts';

const stores = {kind: 'department' as const, id: 'east-retail', name: '华东零售事业部', enterpriseId: 'ent-1'};
const ecommerce = {kind: 'department' as const, id: 'east-ecom', name: '华东电商业务', enterpriseId: 'ent-1'};

test('真实 Host：战略事项创建、幂等、改名与范围稳定身份', {timeout: 90_000}, async t => {
  const host = await startTestHost();
  t.after(async () => { await host.close(); });
  async function api(route: string, method = 'GET', input?: unknown, status = 200) {
    const response = await host.request(route, method, input), result = await response.json();
    assert.equal(response.status, status, JSON.stringify({route, result}));
    return result as Record<string, any>;
  }
  await api('/api/configuration', 'PUT', {
    name: '事项测试', provider: 'openai-compatible', baseUrl: 'http://127.0.0.1:14998/v1',
    model: 'synthetic', apiKey: 'synthetic-local',
  });

  assert.deepEqual((await api('/api/strategy/initiatives')).initiatives, []);
  const operationId = randomUUID();
  const createInput = {operationId, title: '华东门店增长战略', scopes: [stores, ecommerce]};
  const created = (await api('/api/strategy/initiatives', 'POST', createInput, 201)).initiative;
  assert.equal(created.id, operationId);
  assert.equal(created.title, '华东门店增长战略');
  assert.equal(created.revision, 1);
  assert.deepEqual(created.scopes, [stores, ecommerce]);

  const repeated = (await api('/api/strategy/initiatives', 'POST', createInput, 201)).initiative;
  assert.deepEqual(repeated, created);
  const conflict = await api('/api/strategy/initiatives', 'POST', {...createInput, title: '另一个战略'}, 409);
  assert.equal(conflict.code, 'strategy_initiative_operation_conflict');
  const badOperation = await api('/api/strategy/initiatives', 'POST', {operationId: 'not-a-uuid'}, 400);
  assert.equal(badOperation.code, 'invalid_strategy_initiative_id');

  assert.equal((await api('/api/strategy/initiatives')).initiatives.length, 1);
  assert.deepEqual((await api(`/api/strategy/initiatives/${operationId}`)).initiative, created);
  const missing = await api(`/api/strategy/initiatives/${randomUUID()}`, 'GET', undefined, 404);
  assert.equal(missing.code, 'strategy_initiative_not_found');

  const renamed = (await api(`/api/strategy/initiatives/${operationId}`, 'PATCH', {
    expectedRevision: 1, title: '华东门店增长战略（修订）',
    scopes: [{...stores, name: '华东零售事业部·更名'}, ecommerce],
  })).initiative;
  assert.equal(renamed.revision, 2);
  assert.equal(renamed.title, '华东门店增长战略（修订）');
  assert.equal(renamed.scopes[0].id, stores.id);
  assert.equal(renamed.scopes[0].kind, stores.kind);
  assert.equal(renamed.scopes[0].enterpriseId, stores.enterpriseId);
  assert.equal(renamed.scopes[0].name, '华东零售事业部·更名');
  const stale = await api(`/api/strategy/initiatives/${operationId}`, 'PATCH', {expectedRevision: 1, title: '过期修改'}, 409);
  assert.equal(stale.code, 'strategy_initiative_context_changed');
  const duplicateScope = await api(`/api/strategy/initiatives/${operationId}`, 'PATCH', {
    expectedRevision: 2, scopes: [stores, {...stores, name: '重复范围'}],
  }, 409);
  assert.equal(duplicateScope.code, 'strategy_initiative_scope_conflict');
  const unknownField = await api(`/api/strategy/initiatives/${operationId}`, 'PATCH', {expectedRevision: 2, configId: 'x'}, 400);
  assert.equal(unknownField.code, 'strategy_initiative_fields_invalid');
});

test('真实 Host：战略事项重启后按原身份读回', {timeout: 90_000}, async t => {
  const scratch = await mkdtemp(join(os.tmpdir(), 'optracall-initiative-'));
  const options = {dataRoot: join(scratch, 'host'), projectsRoot: join(scratch, 'projects')};
  let host = await startTestHost(options);
  t.after(async () => { await host.close(); });
  async function api(route: string, method = 'GET', input?: unknown, status = 200) {
    const response = await host.request(route, method, input), result = await response.json();
    assert.equal(response.status, status, JSON.stringify({route, result}));
    return result as Record<string, any>;
  }
  const operationId = randomUUID();
  const created = (await api('/api/strategy/initiatives', 'POST', {operationId, title: '重启事项', scopes: [stores]}, 201)).initiative;
  await host.close();
  host = await startTestHost(options);
  assert.deepEqual((await api(`/api/strategy/initiatives/${operationId}`)).initiative, created);
});