import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';
import { parseArgs } from 'node:util';

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: { 'archive-root': { type: 'string', default: '.local' }, port: { type: 'string' } },
});
const manifest = JSON.parse(await readFile(new URL('../openspec/changes/remove-picomatch/demo-replay.json', import.meta.url), 'utf8'));
const [name] = positionals;
if (positionals.length !== 1 || !Object.hasOwn(manifest, name)) {
  throw new Error('Usage: node scripts/replay-v12-demo.mjs v12|pm01 [--archive-root=PATH] [--port=NUMBER]');
}
const demo = manifest[name];
const port = Number(values.port ?? demo.port);
if (!Number.isInteger(port) || port < 1024 || port > 65535 || [4173, 4174, 4175].includes(port)) {
  throw new Error('Choose an isolated demo port between 1024 and 65535, excluding 4173, 4174 and 4175.');
}

const contentTypes = { '.css': 'text/css', '.html': 'text/html', '.js': 'text/javascript' };
const files = new Map();
for (const [file, expected] of Object.entries(demo.files)) {
  const data = await readFile(path.join(values['archive-root'], demo.directory, file));
  if (createHash('sha256').update(data).digest('hex') !== expected) {
    throw new Error(`Archived demo file has changed: ${file}`);
  }
  const extension = path.extname(file);
  const asset = { data, type: contentTypes[extension] };
  files.set('/' + file, asset);
  if (extension === '.html') files.set('/', asset);
}

const server = createServer((request, response) => {
  response.setHeader('Content-Security-Policy', "connect-src 'self'; form-action 'none'; frame-src 'none'; object-src 'none'");
  response.setHeader('X-Content-Type-Options', 'nosniff');
  const pathname = URL.parse(request.url, 'http://127.0.0.1')?.pathname;
  if (pathname?.startsWith('/api')) {
    response.writeHead(503, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ code: 'archived_demo_no_host', synthetic: true }));
    return;
  }
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    response.writeHead(405, { Allow: 'GET, HEAD' }).end();
    return;
  }
  const asset = files.get(pathname);
  if (!asset) {
    response.writeHead(404).end();
    return;
  }
  response.writeHead(200, { 'Content-Type': asset.type + '; charset=utf-8' });
  response.end(request.method === 'HEAD' ? undefined : asset.data);
});

server.listen(port, '127.0.0.1', () => {
  console.log(`OptraCall ${name} archived demo: http://127.0.0.1:${port}/ (Ctrl+C to stop)`);
});
