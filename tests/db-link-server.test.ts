import test from 'node:test';
import assert from 'node:assert/strict';
import { startTestHost } from './fixtures/host-process.ts';

test('DB01/15: db-link uses the existing Host transport boundary and private-root store', async t => {
  const host = await startTestHost(); t.after(() => host.close());
  const route = host.baseUrl + '/api/db-link/connections';
  assert.equal((await fetch(route)).status, 403);
  assert.equal((await fetch(route, { headers: { ...host.headers, origin: 'https://untrusted.example.invalid' } })).status, 403);
  const response = await host.request('/api/db-link/connections');
  assert.equal(response.status, 200, await response.clone().text());
  assert.deepEqual(await response.json(), { connections: [] });
  const untested = await host.request('/api/db-link/connections', 'POST', { configuration: {}, testReceiptId: 'not-host-issued' });
  assert.notEqual(untested.status, 200);
  assert.deepEqual(await (await host.request('/api/db-link/connections')).json(), { connections: [] });
});
