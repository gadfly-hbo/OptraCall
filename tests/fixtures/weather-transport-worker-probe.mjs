// Adversarial connector stand-in, copied to the fixed worker path in an owned test tree.
import fs from 'node:fs';
import net from 'node:net';
import tls from 'node:tls';
import http from 'node:http';
import dns from 'node:dns';
import dgram from 'node:dgram';
import childProcess from 'node:child_process';

const cacheRoot = process.argv[process.argv.indexOf('--cache-root') + 1];
const settings = JSON.parse(fs.readFileSync(cacheRoot + '/fixture.json', 'utf8'));
const channel = new net.Socket({ fd: 3, readable: true, writable: true });
const url = 'https://archive-api.open-meteo.com/v1/archive?latitude=30&longitude=120&start_date=2025-10-01&end_date=2025-10-02&daily=temperature_2m_mean&timezone=Asia%2FShanghai';
const request = id => ({ version: 1, type: 'request', id, url });
const send = frame => channel.write(JSON.stringify(frame) + '\n');
const report = value => process.stdout.write(JSON.stringify(value) + '\n');

switch (settings.mode) {
  case 'unknown-keys': send({ ...request(1), extra: true }); break;
  case 'unknown-kind': send({ version: 1, type: 'arbitrary', id: 1 }); break;
  case 'duplicate-id': send(request(1)); send(request(1)); break;
  case 'oversized': channel.write('x'.repeat(64 * 1024 + 1)); break;
  case 'future-cancel': send({ version: 1, type: 'cancel', id: 9 }); break;
  case 'blocked-url': send({ ...request(1), url: url.replace('archive-api.open-meteo.com', 'blocked.invalid') }); break;
  case 'pending-limit': for (let id = 1; id <= 9; id++) send(request(id)); break;
  case 'body-limit': case 'retry-after': send(request(1)); break;
  case 'direct-network': {
    const errors = [];
    const check = async (name, action) => {
      try { await action(); errors.push({ name, error: 'ALLOWED' }); }
      catch (error) { errors.push({ name, error: error.code ?? error.cause?.code ?? error.name }); }
    };
    const lookup = (_host, options, callback) => options.all ? callback(null, [{ address: '127.0.0.1', family: 4 }]) : callback(null, '127.0.0.1', 4);
    const connect = (library, options) => new Promise((resolve, reject) => {
      const socket = library.connect(options);
      socket.once('connect', () => { socket.destroy(); resolve(); }); socket.once('error', reject);
    });
    // Non-allowlisted hostname uses an explicit synthetic resolver: never a real DNS query.
    await check('net', () => connect(net, { host: 'blocked.invalid', port: settings.port, lookup }));
    await check('tls', () => connect(tls, { host: 'blocked.invalid', port: settings.port, lookup }));
    await check('http', () => new Promise((resolve, reject) => http.get({ hostname: 'blocked.invalid', port: settings.port, lookup }, response => { response.resume(); resolve(); }).once('error', reject)));
    await check('fetch', () => fetch('http://127.0.0.1:' + settings.port));
    await check('unix', () => connect(net, { path: settings.socketPath }));
    if (!settings.seatbeltOnly) await check('dns', () => new Promise((resolve, reject) => dns.lookup('localhost', (error, address) => error ? reject(error) : resolve(address))));
    await check('udp', () => new Promise((resolve, reject) => {
      const socket = dgram.createSocket('udp4');
      socket.once('error', error => { socket.close(); reject(error); });
      try { socket.send('synthetic', settings.port, '127.0.0.1', error => { socket.close(); error ? reject(error) : resolve(); }); }
      catch (error) { socket.close(); reject(error); }
    }));
    await check('subprocess', () => {
      const script = 'require("node:net").connect({host:"127.0.0.1",port:' + settings.port + '})';
      const result = childProcess.spawnSync(process.execPath, ['-e', script], { timeout: 1000 });
      if (result.error) throw result.error;
      throw new Error('subprocess unexpectedly started');
    });
    report({ type: 'direct-network', errors }); break;
  }
  default: throw new Error('unknown test worker mode');
}
channel.on('data', chunk => process.stdout.write(chunk));
channel.on('error', () => {});
setInterval(() => {}, 1000);

process.stdin.once('end', () => process.exit(0));
process.stdin.resume();
