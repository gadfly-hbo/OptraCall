import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { validateWeatherUrl, isPublicIPv4, fetchWeatherUpstream } from '../src/agent/weather-egress.ts';

const VALID = 'https://archive-api.open-meteo.com/v1/archive?latitude=30.8671&longitude=120.1023&start_date=2025-10-01&end_date=2025-10-31&daily=temperature_2m_mean,precipitation_sum&timezone=Asia%2FShanghai';

test('WX05: real Host network implementation pins DNS/TLS and rejects redirects, overflow, cancellation and late DNS', () => {
  execFileSync(process.execPath, [path.resolve('tests/fixtures/weather-egress-probe.mjs')], { timeout: 15_000, stdio: 'pipe' });
});

test('WX05: Host accepts only the fixed weather origin, route and exact permitted query', async () => {
  const allowed = validateWeatherUrl(VALID);
  assert.equal(allowed.hostname, 'archive-api.open-meteo.com');
  const denied = [
    VALID.replace('archive-api.open-meteo.com', 'example.com'),
    VALID.replace('archive-api.open-meteo.com', 'archive-api.open-meteo.com.example.com'),
    VALID.replace('archive-api.open-meteo.com', 'archive-api.open-meteo.com.'),
    VALID.replace('https:', 'http:'),
    VALID.replace('archive-api.open-meteo.com', 'user:password@archive-api.open-meteo.com'),
    VALID.replace('archive-api.open-meteo.com', 'archive-api.open-meteo.com:444'),
    VALID.replace('/v1/archive?', '/v1/other?'),
    VALID + '&projectNotes=synthetic-note', VALID + '&latitude=31', VALID + '#fragment',
    VALID.replace('30.8671', 'NaN'), VALID.replace('120.1023', '181'),
    VALID.replace('2025-10-01', '2025-02-30'),
    VALID.replace('2025-10-31', '2025-09-30'),
    VALID.replace('temperature_2m_mean,precipitation_sum', 'not_a_weather_field'),
    VALID.replace('Asia%2FShanghai', 'UTC'),
    VALID.replace('2025-10-01', '2024-01-01').replace('2025-10-31', '2025-01-01'),
  ];
  for (const url of denied) {
    assert.throws(() => validateWeatherUrl(url), 'invalid egress must fail before resolving or connecting');
    await assert.rejects(fetchWeatherUpstream(url, { signal: new AbortController().signal }));
  }
  assert.ok(validateWeatherUrl(VALID.replace('2025-10-01', '2024-01-01').replace('2025-10-31', '2024-12-31')));
});

test('WX05: DNS addresses exclude private, local, special and malformed IPv4 targets', () => {
  for (const ip of ['1.1.1.1', '8.8.8.8']) assert.equal(isPublicIPv4(ip), true);
  for (const ip of ['0.0.0.0', '10.1.2.3', '100.64.0.1', '127.0.0.1', '169.254.169.254', '172.16.1.1', '192.168.0.1', '192.0.2.1', '192.88.99.1', '198.18.0.1', '198.51.100.1', '203.0.113.1', '224.0.0.1', '255.255.255.255', '256.1.1.1', '1.2.3', '::1']) assert.equal(isPublicIPv4(ip), false, ip);
});
