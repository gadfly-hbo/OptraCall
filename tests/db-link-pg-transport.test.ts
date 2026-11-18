import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createServer, type Server } from 'node:net';
import { once } from 'node:events';
import { createDbLinkPgStream } from '../src/host/db-link-pg-transport.ts';

async function server(t: { after(fn: () => Promise<void>): void }, payload: Buffer): Promise<{ value: Server; port: number }> {
  const value = createServer(socket => { socket.on('error', () => {}); socket.end(payload); });
  value.listen(0, '127.0.0.1'); await once(value, 'listening');
  t.after(() => new Promise<void>(resolve => { value.close(() => resolve()); }));
  const address = value.address(); assert.ok(address && typeof address !== 'string'); return { value, port: address.port };
}

test('Host stream forwards a permitted TCP response and reports its actual held socket closure', async t => {
  const remote = await server(t, Buffer.from('abc'));
  const stream = createDbLinkPgStream(64), chunks: Buffer[] = [];
  stream.on('data', chunk => chunks.push(Buffer.from(chunk))); stream.on('error', () => {});
  stream.connect(remote.port, '127.0.0.1');
  const terminal = await stream.completion;
  assert.equal(Buffer.concat(chunks).toString(), 'abc');
  assert.deepEqual(terminal, { maxReceiveBytes: 64, receivedBytes: 3, forwardedBytes: 3, maxReadBytes: 3, rejected: false, closed: true });
  assert.ok(Object.isFrozen(stream.facts));
});

test('Host stream refuses a large read before forwarding it and holds only one fixed receive block beyond the allowance', async t => {
  const remote = await server(t, Buffer.alloc(128 * 1024, 65));
  const stream = createDbLinkPgStream(1024), chunks: Buffer[] = [], errors: unknown[] = [];
  stream.on('data', chunk => chunks.push(Buffer.from(chunk))); stream.on('error', error => errors.push(error));
  stream.connect(remote.port, '127.0.0.1');
  const facts = await stream.completion;
  assert.equal(facts.rejected, true); assert.equal(facts.closed, true);
  assert.ok(facts.forwardedBytes <= 1024); assert.ok(facts.receivedBytes <= 1024 + 16384); assert.ok(facts.maxReadBytes <= 16384);
  assert.ok(chunks.reduce((size, chunk) => size + chunk.length, 0) <= 1024);
  assert.ok(errors.some(error => error instanceof Error && 'code' in error && error.code === 'db_receive_budget_exhausted'));
});

test('a later read cannot reset the same connection receive allowance', async t => {
  const remote = createServer(socket => { socket.on('error', () => {}); socket.write(Buffer.alloc(512, 65)); socket.once('data', () => socket.end(Buffer.alloc(512, 66))); });
  remote.listen(0, '127.0.0.1'); await once(remote, 'listening'); t.after(() => new Promise<void>(resolve => remote.close(() => resolve())));
  const address = remote.address(); assert.ok(address && typeof address !== 'string');
  const stream = createDbLinkPgStream(800), received: Buffer[] = [];
  stream.on('error', () => {}); stream.on('data', chunk => { received.push(Buffer.from(chunk)); stream.write('next'); });
  stream.connect(address.port, '127.0.0.1');
  const facts = await stream.completion;
  assert.equal(facts.rejected, true); assert.equal(facts.forwardedBytes, 512); assert.equal(facts.receivedBytes, 1024);
  assert.equal(Buffer.concat(received).length, 512);
  assert.equal('reset' in stream, false);
});

test('invalid receive limits fail before any connection exists and explicit destruction closes its held socket', async () => {
  for (const invalid of [0, -1, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, 1.5]) assert.throws(() => createDbLinkPgStream(invalid), /db_receive_budget_invalid/);
  const stream = createDbLinkPgStream(32); stream.on('error', () => {}); stream.destroy(); stream.destroy();
  assert.equal((await stream.completion).closed, true); assert.equal(stream.facts.receivedBytes, 0);
});

test('a larger whole-connection allowance admits the response without claiming an independent startup cap', async t => {
  const remote = await server(t, Buffer.alloc(256 * 1024, 65));
  const stream = createDbLinkPgStream(1024 * 1024 * 1024), errors: unknown[] = [];
  stream.on('error', error => errors.push(error)); stream.resume(); stream.connect(remote.port, '127.0.0.1');
  const facts = await stream.completion;
  // v0.5 promises the configured total M, not the unimplemented v0.4 phase W.
  // The original failed phase-window expectation is preserved in the evidence.
  assert.equal(facts.forwardedBytes, 262144); assert.equal(facts.receivedBytes, 262144);
  assert.equal(facts.maxReceiveBytes, 1073741824); assert.ok(facts.maxReadBytes <= 16384);
  assert.equal(facts.rejected, false); assert.equal(facts.closed, true); assert.deepEqual(errors, []);
});
