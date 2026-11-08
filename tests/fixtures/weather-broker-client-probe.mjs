/** Portable, memory-only client protocol probes. Usage: node this-file.mjs [repoRoot]. */
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { Duplex } from 'node:stream';

const repoRoot = path.resolve(process.argv[2] ?? process.cwd());
import { createWeatherBrokerClient } from '../../src/agent/weather-worker.ts';
import { WEATHER_MAX_BODY_BYTES, WEATHER_MAX_FRAME_BYTES, WEATHER_MAX_PENDING } from '../../src/agent/weather-transport.ts';

function duplexPair() {
  let clientSide, hostSide;
  const side = peer => new Duplex({
    read() {},
    write(chunk, _encoding, callback) {
      const destination = peer();
      if (destination.destroyed) { callback(new Error('synthetic_peer_closed')); return; }
      destination.push(Buffer.from(chunk)); callback();
    },
    final(callback) { peer().push(null); callback(); },
  });
  clientSide = side(() => hostSide);
  hostSide = side(() => clientSide);
  return [clientSide, hostSide];
}

function setup(context) {
  const [channel, host] = duplexPair();
  let disconnects = 0, observed = '';
  const requests = [];
  host.on('data', chunk => {
    observed += chunk.toString('utf8');
    for (;;) {
      const end = observed.indexOf('\n');
      if (end < 0) return;
      const line = observed.slice(0, end); observed = observed.slice(end + 1);
      requests.push(JSON.parse(line));
    }
  });
  const client = createWeatherBrokerClient(channel, () => { disconnects++; });
  context.after(() => { client.close(); host.destroy(); channel.destroy(); });
  return {
    channel, host, client, requests,
    get disconnects() { return disconnects; },
    send(frame) { host.write(JSON.stringify({ version: 1, ...frame }) + '\n'); },
  };
}
const tick = () => new Promise(resolve => setImmediate(resolve));
const signal = () => new AbortController().signal;
const reply = (id, body = 'ok') => ({ type: 'response', id, status: 200, headers: {}, body });

test('fd client returns text and Retry-After without a Response object', async context => {
  const s = setup(context);
  const pending = s.client.fetch('synthetic', { signal: signal() });
  await tick();
  assert.deepEqual(s.requests[0], { version: 1, type: 'request', id: 1, url: 'synthetic' });
  s.send({ type: 'response', id: 1, status: 429, headers: { 'retry-after': '3' }, body: 'quota' });
  const response = await pending;
  assert.equal(response.status, 429);
  assert.equal(response.headers['retry-after'], '3');
  assert.equal(await response.text(), 'quota');
});

test('already-aborted request never dispatches', async context => {
  const s = setup(context), controller = new AbortController(); controller.abort();
  await assert.rejects(s.client.fetch('synthetic', { signal: controller.signal }), { name: 'AbortError' });
  await tick(); assert.equal(s.requests.length, 0);
});

test('cancel sends one id and a late result cannot revive the request', async context => {
  const s = setup(context), controller = new AbortController();
  const pending = s.client.fetch('synthetic', { signal: controller.signal });
  await tick(); controller.abort(); controller.abort();
  await assert.rejects(pending, { name: 'AbortError' }); await tick();
  assert.deepEqual(s.requests.map(frame => frame.type), ['request', 'cancel']);
  assert.equal(s.requests[1].id, 1);
  s.send(reply(1, 'late')); await tick(); assert.equal(s.disconnects, 0);
  const next = s.client.fetch('next', { signal: signal() }); await tick();
  s.send(reply(2, 'next')); assert.equal(await (await next).text(), 'next');
});

test('disconnect rejects every pending request', async context => {
  const s = setup(context);
  const pending = [s.client.fetch('a', { signal: signal() }), s.client.fetch('b', { signal: signal() })];
  const checked = pending.map(work => assert.rejects(work, /disconnected/));
  s.host.end(); await Promise.all(checked); assert.equal(s.disconnects, 1);
});

test('unknown response kind fails closed', async context => {
  const s = setup(context), pending = s.client.fetch('a', { signal: signal() });
  await tick(); s.send({ type: 'arbitrary', id: 1 });
  await assert.rejects(pending, /disconnected/); assert.equal(s.disconnects, 1);
});

test('unknown response keys fail closed', async context => {
  const s = setup(context), pending = s.client.fetch('a', { signal: signal() });
  await tick(); s.send({ ...reply(1), extra: true });
  await assert.rejects(pending, /disconnected/); assert.equal(s.disconnects, 1);
});

test('future response id fails closed', async context => {
  const s = setup(context), pending = s.client.fetch('a', { signal: signal() });
  await tick(); s.send(reply(2));
  await assert.rejects(pending, /disconnected/); assert.equal(s.disconnects, 1);
});

test('body cap counts UTF-8 bytes before the adapter sees the response', async context => {
  const s = setup(context), pending = s.client.fetch('a', { signal: signal() });
  const body = '天'.repeat(Math.floor(WEATHER_MAX_BODY_BYTES / 3) + 1);
  assert.ok(body.length < WEATHER_MAX_BODY_BYTES);
  assert.ok(Buffer.byteLength(body) > WEATHER_MAX_BODY_BYTES);
  await tick(); s.send(reply(1, body));
  await assert.rejects(pending, /disconnected/); assert.equal(s.disconnects, 1);
});

test('pending bound rejects overflow without dispatching another request', async context => {
  const s = setup(context), pending = [];
  for (let index = 0; index < WEATHER_MAX_PENDING; index++) pending.push(s.client.fetch('a', { signal: signal() }));
  await assert.rejects(s.client.fetch('overflow', { signal: signal() }), /busy/);
  await tick(); assert.equal(s.requests.length, WEATHER_MAX_PENDING);
  const checked = pending.map(work => assert.rejects(work, /disconnected/));
  s.client.close(); await Promise.all(checked); assert.equal(s.disconnects, 1);
});

test('protocol timeout retains the AbortError expected by the existing adapter', async context => {
  const s = setup(context), pending = s.client.fetch('a', { signal: signal() });
  await tick(); s.send({ type: 'error', id: 1, code: 'timeout', message: 'weather_request_timeout' });
  await assert.rejects(pending, { name: 'AbortError' });
});

test('oversized frame without a newline fails closed', async context => {
  const s = setup(context), pending = s.client.fetch('a', { signal: signal() });
  await tick(); s.host.write(Buffer.alloc(WEATHER_MAX_FRAME_BYTES + 1, 0x61));
  await assert.rejects(pending, /disconnected/); assert.equal(s.disconnects, 1);
});

test('a completed response replay cannot settle a later request', async context => {
  const s = setup(context), first = s.client.fetch('first', { signal: signal() });
  await tick(); s.send(reply(1, 'first')); assert.equal(await (await first).text(), 'first');
  let adopted = false;
  const second = s.client.fetch('second', { signal: signal() }); second.then(() => { adopted = true; });
  await tick(); s.send(reply(1, 'replayed')); await tick();
  assert.equal(adopted, false); assert.equal(s.disconnects, 0);
  s.send(reply(2, 'second')); assert.equal(await (await second).text(), 'second');
});

test('cleanup is idempotent and closed clients never dispatch again', async context => {
  const s = setup(context), pending = s.client.fetch('a', { signal: signal() });
  const checked = assert.rejects(pending, /disconnected/);
  await tick(); s.client.close(); s.client.close(); s.channel.emit('end'); s.channel.emit('close');
  await checked; assert.equal(s.disconnects, 1); assert.equal(s.channel.destroyed, true);
  await assert.rejects(s.client.fetch('after-close', { signal: signal() }), /disconnected/);
  await tick(); assert.equal(s.requests.length, 1);
});
