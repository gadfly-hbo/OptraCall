import test from 'node:test';
import assert from 'node:assert/strict';
import { startTestHost } from './fixtures/host-process.ts';

test('CASE-REL-HTTP-01: graph relation listing reads an initialized empty store without creating a relation', async t => {
  const host = await startTestHost(); t.after(() => host.close());
  assert.equal((await host.request('/api/cases/storage/initialize', 'POST', {})).status, 200);
  const response = await host.request('/api/case-relations');
  assert.equal(response.status, 200, await response.clone().text());
  const body = await response.json() as { items: unknown[]; continuation: string | null; hasMore: boolean };
  assert.deepEqual(body.items, []);
  assert.equal(body.continuation, null);
  assert.equal(body.hasMore, false);
});

test('CASE-REL-HTTP-02: a continued Case stores one versioned relation and leaves both original Cases untouched', async t => {
  const { randomUUID } = await import('node:crypto');
  const host = await startTestHost(); t.after(() => host.close());
  await host.request('/api/cases/storage/initialize', 'POST', {});
  const create = async (title: string) => (await (await host.request('/api/cases','POST',{operationId:randomUUID(),title})).json() as any).case;
  const source=await create('原业务问题'), target=await create('后续分析事项');
  const status=await (await host.request('/api/cases/storage')).json() as any;
  const command={operationId:randomUUID(),caseStoreId:status.storeId,fromCaseId:source.id,kind:'follows_up',expectedRelationRevision:0,explanation:'由原问题继续核对执行范围。'};
  const response=await host.request(`/api/cases/${target.id}/relations`,'POST',command);
  assert.equal(response.status,201,await response.clone().text());
  const first=await response.json() as any;
  assert.equal(first.revision.revision,1);assert.equal(first.revision.toCaseId,target.id);
  assert.equal(first.revision.fromCaseId,source.id);assert.equal(first.revision.origin.actorKind,'user');
  const listing=await (await host.request('/api/case-relations')).json() as any;
  assert.equal(listing.items.length,1);assert.equal(listing.items[0].relationId,first.revision.relationId);
  for(const original of [source,target])assert.deepEqual((await (await host.request(`/api/cases/${original.id}`)).json() as any).case,original);
});
