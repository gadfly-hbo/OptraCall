// Copied into an owned test source tree. Only this trusted fixture replaces the upstream function.
import fs from 'node:fs';
import childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';

const cacheRoot = process.argv[2];
const settings = JSON.parse(fs.readFileSync(cacheRoot + '/fixture.json', 'utf8'));
if (settings.seatbeltOnly) {
  // Exercise the production Seatbelt profile even if the Node permission layer is bypassed.
  const spawn = childProcess.spawn;
  childProcess.spawn = (command, args, options) => spawn(command,
    args.filter(arg => arg !== '--permission' && !arg.startsWith('--allow-fs-')), options);
  syncBuiltinESMExports();
}
const { runWeatherTransport } = await import('./src/agent/weather-transport.ts');
const event = value => process.stderr.write('weather-test:' + JSON.stringify(value) + '\n');
let requests = 0;
try {
  await runWeatherTransport({ cacheRoot, upstreamFetch: async (input, { signal }) => {
    const url = new URL(input), id = ++requests;
    event({ type: 'request', id });
    if (settings.upstream === 'hold' || url.searchParams.get('latitude') === '55') {
      await new Promise((resolve, reject) => {
        let timer;
        const cancel = () => { clearTimeout(timer); event({ type: 'abort', id }); reject(new DOMException('cancelled', 'AbortError')); };
        signal.addEventListener('abort', cancel, { once: true });
        if (settings.upstream !== 'hold') timer = setTimeout(() => { signal.removeEventListener('abort', cancel); resolve(); }, 500);
      });
    }
    if (settings.upstream === 'large') return { status: 200, headers: {}, text: async () => 'x'.repeat(1024 * 1024 + 1) };
    if (settings.upstream === 'rate-limit') return { status: 429, headers: { 'retry-after': '3' }, text: async () => 'synthetic quota' };
    const time = [];
    for (let date = Date.parse(url.searchParams.get('start_date') + 'T00:00:00Z'), end = Date.parse(url.searchParams.get('end_date') + 'T00:00:00Z'); date <= end; date += 86_400_000) time.push(new Date(date).toISOString().slice(0, 10));
    const body = JSON.stringify({ daily: { time, temperature_2m_mean: time.map(() => 20), precipitation_sum: time.map(() => 1) } });
    return { status: 200, headers: {}, text: async () => body };
  } });
} catch (error) {
  process.stderr.write((error instanceof Error ? error.message : 'fixture_transport_failed') + '\n'); process.exitCode = 1;
}
