import assert from 'node:assert/strict';
import { test, mock } from 'node:test';
import dns from 'node:dns/promises';
import https from 'node:https';
import { rootCertificates } from 'node:tls';
import { syncBuiltinESMExports } from 'node:module';
import { EventEmitter } from 'node:events';
const calls = { dns: [], https: [], req: [], res: [] };
let mode = {};
mock.method(dns, 'lookup', async (host, options) => {
  calls.dns.push({ host, options });
  return mode.dnsWait ? await mode.dnsWait : (mode.addresses ?? [{ address: '8.8.8.8', family: 4 }]);
});
mock.method(https, 'request', (options, callback) => {
  calls.https.push(options);
  const req = new EventEmitter(); req.destroyed = false;
  req.destroy = () => { req.destroyed = true; return req; };
  req.end = () => queueMicrotask(() => {
    if (req.destroyed) return;
    const res = new EventEmitter(); res.statusCode = mode.status ?? 200; res.headers = mode.headers ?? {}; res.complete = false; res.destroyed = false;
    res.destroy = () => { res.destroyed = true; return res; };
    calls.res.push(res); callback(res);
    if (mode.stall || res.destroyed) return;
    for (const chunk of mode.chunks ?? [Buffer.from('{"daily":{}}')]) res.emit('data', chunk);
    if (mode.incomplete) { res.emit('aborted'); res.emit('close'); return; }
    res.complete = true; res.emit('end'); res.emit('close');
  });
  calls.req.push(req); return req;
});
syncBuiltinESMExports();
const { validateWeatherUrl, isPublicIPv4, fetchWeatherUpstream } = await import('../../src/agent/weather-egress.ts');
const base = 'https://archive-api.open-meteo.com/v1/archive?latitude=30&longitude=120&start_date=2025-01-01&end_date=2025-01-02&daily=temperature_2m_mean,precipitation_sum&timezone=Asia/Shanghai';
const reset = () => { for (const values of Object.values(calls)) values.length = 0; mode = {}; };
const urlWith = (key, value) => { const u = new URL(base); u.searchParams.set(key, value); return u.toString(); };
const signal = () => new AbortController().signal;
await test('URL policy accepts the fixed origin and reconstructs known values', () => {
  assert.equal(validateWeatherUrl(base).hostname, 'archive-api.open-meteo.com');
  assert.equal(validateWeatherUrl(base.replace('.com/', '.com:443/')).port, '');
  assert.equal(validateWeatherUrl(urlWith('latitude', '3e1')).searchParams.get('latitude'), '30');
});
await test('URL policy rejects host/credential/port/path/query/date/field bypasses before DNS', async () => {
  reset();
  const bad = [
    base.replace('https:', 'http:'), base.replace('.com/', '.com.evil.invalid/'),
    base.replace('.com/', '.com./'), base.replace('archive-api', 'archivｅ-api'),
    base.replace('https://', 'https://user:pass@'), base.replace('.com/', '.com:444/'),
    base.replace('/v1/archive?', '/v2/archive?'), base+'#', base+'&unexpected=private', base+'&latitude=1',
    urlWith('latitude','0x10'), urlWith('latitude','Infinity'), urlWith('latitude','91'), urlWith('longitude','-181'),
    urlWith('start_date','2025-02-30'), urlWith('end_date','2024-01-01'), urlWith('end_date','9999-01-01'),
    urlWith('daily',''), urlWith('daily','temperature_2m_mean,temperature_2m_mean'), urlWith('daily','wind_speed_10m_max'),
    urlWith('timezone','UTC'),
  ];
  const over = new URL(base); over.searchParams.set('start_date','2024-01-01'); over.searchParams.set('end_date','2025-01-01'); bad.push(over.toString());
  for (const u of bad) await assert.rejects(fetchWeatherUpstream(u,{signal:signal()}), /weather_egress_denied/);
  assert.equal(calls.dns.length,0); assert.equal(calls.https.length,0);
  over.searchParams.set('end_date','2024-12-31'); assert.ok(validateWeatherUrl(over.toString()));
});
await test('IPv4 public-only policy excludes local/private/reserved/mapped/IPv6 forms', () => {
  for (const ip of ['0.1.2.3','10.0.0.1','100.100.100.200','127.0.0.1','169.254.169.254','172.16.0.1','192.0.0.1','192.0.2.5','192.88.99.1','192.168.1.1','198.18.0.1','198.51.100.2','203.0.113.3','224.0.0.1','255.255.255.255','::1','::ffff:8.8.8.8','8.8.8.08']) assert.equal(isPublicIPv4(ip),false,ip);
  for (const ip of ['8.8.8.8','1.1.1.1','172.15.255.255','192.169.0.1','223.255.255.255']) assert.equal(isPublicIPv4(ip),true,ip);
});
await test('production HTTPS options pin one validated DNS result with bundled CA and fixed request surface', async () => {
  reset(); mode.headers={'retry-after':'120','set-cookie':'not-forwarded'};
  const response=await fetchWeatherUpstream(base,{signal:signal()});
  assert.equal(response.status,200); assert.equal(await response.text(),'{"daily":{}}'); assert.deepEqual(response.headers,{'retry-after':'120'});
  assert.equal(calls.dns.length,1); assert.deepEqual(calls.dns[0],{host:'archive-api.open-meteo.com',options:{all:true,family:4,verbatim:true}});
  assert.equal(calls.https.length,1); const opts=calls.https[0];
  assert.equal(opts.hostname,'archive-api.open-meteo.com'); assert.equal(opts.port,443); assert.equal(opts.servername,opts.hostname); assert.equal(opts.rejectUnauthorized,true); assert.deepEqual(opts.ca,[...rootCertificates]); assert.equal(opts.agent,false); assert.equal(opts.method,'GET'); assert.deepEqual(opts.headers,{accept:'application/json'}); assert.equal(opts.family,4);
  const found=[]; opts.lookup(opts.hostname,{},(...args)=>found.push(args)); opts.lookup(opts.hostname,{all:true},(...args)=>found.push(args));
  assert.deepEqual(found,[[null,'8.8.8.8',4],[null,[{address:'8.8.8.8',family:4}]]]); assert.equal(calls.dns.length,1);
});
await test('mixed public/private DNS and IPv6-only response never dial', async () => {
  for (const addresses of [[],[{address:'127.0.0.1',family:4}],[{address:'8.8.8.8',family:4},{address:'192.168.1.1',family:4}],[{address:'2001:4860:4860::8888',family:6}]]) {
    reset(); mode.addresses=addresses; await assert.rejects(fetchWeatherUpstream(base,{signal:signal()}),/weather_egress_denied/); assert.equal(calls.https.length,0);
  }
});
await test('redirect response is rejected after one request without following Location', async () => {
  reset(); mode.status=302; mode.headers={location:'http://127.0.0.1/private'};
  await assert.rejects(fetchWeatherUpstream(base,{signal:signal()}),/redirect_blocked/); assert.equal(calls.https.length,1); assert.equal(calls.req[0].destroyed,true);
});
await test('declared and streamed response overflow stop the same request', async () => {
  for (const next of [{headers:{'content-length':String(1024*1024+1)}},{chunks:[Buffer.alloc(1024*1024+1)]}]) {
    reset(); mode=next; await assert.rejects(fetchWeatherUpstream(base,{signal:signal()}),/body_too_large/); assert.equal(calls.req[0].destroyed,true);
  }
});
await test('cancel before DNS and during unresolved DNS cannot dial late', async () => {
  reset(); const first=new AbortController(); first.abort(); await assert.rejects(fetchWeatherUpstream(base,{signal:first.signal}),{name:'AbortError'}); assert.equal(calls.dns.length,0);
  let release; mode.dnsWait=new Promise(resolve=>release=resolve); const second=new AbortController(); const work=fetchWeatherUpstream(base,{signal:second.signal}); second.abort(); await assert.rejects(work,{name:'AbortError'}); release([{address:'8.8.8.8',family:4}]); await new Promise(setImmediate); assert.equal(calls.https.length,0);
});
await test('response cancellation destroys active request and ignores late success', async () => {
  reset(); mode.stall=true; const controller=new AbortController(); const work=fetchWeatherUpstream(base,{signal:controller.signal}); await new Promise(setImmediate); assert.equal(calls.res.length,1); controller.abort(); await assert.rejects(work,{name:'AbortError'}); assert.equal(calls.req[0].destroyed,true); assert.equal(calls.res[0].destroyed,true); calls.res[0].complete=true; calls.res[0].emit('end');
});
await test('incomplete response fails without retry', async () => {
  reset(); mode.incomplete=true; await assert.rejects(fetchWeatherUpstream(base,{signal:signal()}),/incomplete/); assert.equal(calls.https.length,1);
});
await test('Host deadline retains TimeoutError during unresolved DNS without dialing', async () => {
  reset(); mode.dnsWait=new Promise(()=>{}); mock.timers.enable({apis:['setTimeout']});
  try { const work=fetchWeatherUpstream(base,{signal:signal()}); mock.timers.tick(10_000); await assert.rejects(work,{name:'TimeoutError'}); assert.equal(calls.https.length,0); }
  finally { mock.timers.reset(); }
});
mock.restoreAll();
