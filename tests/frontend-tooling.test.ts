import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { on, once } from 'node:events';
import { cp, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer, get } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';

const run = promisify(execFile);
const cli = path.resolve('scripts/frontend.mjs');
const stamp = path.resolve('scripts/stamp-build.mjs');

async function fixture(t: test.TestContext) {
  const cwd = await mkdtemp(path.join(tmpdir(), 'optracall-frontend-'));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  const ui = path.join(cwd, 'src/host/ui');
  await mkdir(ui, { recursive: true });
  await cp('index.html', path.join(cwd, 'index.html'));
  await cp('src/host/ui/favicon.svg', path.join(ui, 'favicon.svg'));
  await writeFile(path.join(ui, 'main.tsx'), "import './style.css'; document.title = 'synthetic fixture';");
  await writeFile(path.join(ui, 'style.css'), 'body { color: blue; }');
  return cwd;
}

async function start(t: test.TestContext, cwd: string, mode: string, hostPort: number) {
  const child = spawn(process.execPath, [cli, mode, '--host', '127.0.0.1', '--port', '0', '--strictPort'], {
    cwd, env: { ...process.env, OPTRACALL_HOST_PORT: String(hostPort) }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  const closed = once(child, 'close');
  t.after(async () => { child.kill(); await closed; });
  return new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Frontend startup timeout: ' + output)), 15_000);
    child.stderr.on('data', chunk => { output += chunk; });
    child.stdout.on('data', chunk => {
      output += chunk;
      const base = output.match(/http:\/\/127\.0\.0\.1:\d+\//)?.[0];
      if (base) { clearTimeout(timer); resolve(base); }
    });
    child.once('error', reject);
    child.once('close', () => { clearTimeout(timer); reject(new Error(output)); });
  });
}

for (const mode of ['dev', 'preview']) {
  test(`frontend ${mode} serves the UI, protects source paths and streams the API until cancellation`, { timeout: 30_000 }, async t => {
    const cwd = await fixture(t);
    if (mode === 'preview') {
      await run('git', ['init', '-q'], { cwd });
      await run('git', ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '--allow-empty', '-qm', 'fixture'], { cwd });
      await writeFile(path.join(cwd, 'package.json'), '{"version":"0.0.0"}');
      await run(process.execPath, [cli, 'build'], { cwd });
      await run(process.execPath, [stamp], { cwd });
      await writeFile(path.join(cwd, 'dist/private.json'), '"unstamped"');
    }
    let upstreamUrl, upstreamHost, upstreamOrigin, upstreamClient;
    const api = createServer(async (request, response) => {
      if (request.url === '/api/projects' && request.method === 'POST') {
        let body = '';
        for await (const chunk of request) body += chunk;
        response.writeHead(201, { 'content-type': 'application/json' });
        response.end(body);
        return;
      }
      upstreamUrl = request.url;
      upstreamHost = request.headers.host;
      upstreamOrigin = request.headers.origin;
      upstreamClient = request.headers['x-optracall-client'];
      response.writeHead(200, { 'content-type': 'text/event-stream' });
      response.write('data: first\n\n');
      response.once('close', () => api.emit('fixture-stream-closed'));
    });
    const disconnected = once(api, 'fixture-stream-closed');
    api.listen(0, '127.0.0.1'); await once(api, 'listening');
    t.after(() => { api.closeAllConnections(); api.close(); });
    const address = api.address(); assert.ok(address && typeof address === 'object');
    const base = await start(t, cwd, mode, address.port);
    const page = await (await fetch(base)).text();
    assert.match(page, /<div id="root">/);
    const script = page.match(/<script[^>]*src="([^"]+\.js)"/)?.[1];
    const css = page.match(/<link[^>]*href="([^"]+\.css)"/)?.[1];
    const icon = page.match(/<link[^>]*href="([^"]+\.svg)"/)?.[1];
    assert.ok(script && css && icon);
    assert.match(await (await fetch(new URL(script, base))).text(), /synthetic fixture/);
    assert.match(await (await fetch(new URL(css, base))).text(), /blue|#00f/);
    assert.match(await (await fetch(new URL(icon, base))).text(), /<svg/);
    assert.equal(await (await fetch(base + 'projects/example', { headers: { accept: 'text/html' } })).text(), page);
    for (const name of ['.env', 'package.json', 'src/host/ui/main.tsx', 'assets/missing.js', 'private.json']) {
      assert.equal((await fetch(base + name)).status, 404, name);
    }
    await assert.rejects(run(process.execPath, [cli, mode, '--port', new URL(base).port], { cwd }), /EADDRINUSE/);
    const foreign = await new Promise<number | undefined>((resolve, reject) => {
      get(base, { headers: { host: 'outside.example' } }, response => { response.resume(); resolve(response.statusCode); }).on('error', reject);
    });
    assert.equal(foreign, 403);
    const posted = await fetch(base + 'api/projects', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"name":"合成项目"}' });
    assert.equal(posted.status, 201);
    assert.deepEqual(await posted.json(), { name: '合成项目' });
    const controller = new AbortController();
    const response = await fetch(base + 'api/events?q=one', { signal: controller.signal, headers: { origin: new URL(base).origin, 'x-optracall-client': '1' } });
    assert.equal(response.headers.get('content-type'), 'text/event-stream');
    const reader = response.body!.getReader();
    assert.match(new TextDecoder().decode((await reader.read()).value), /data: first/);
    assert.equal(upstreamUrl, '/api/events?q=one');
    assert.equal(upstreamHost, '127.0.0.1:' + address.port);
    assert.equal(upstreamOrigin, new URL(base).origin);
    assert.equal(upstreamClient, '1');
    controller.abort();
    await disconnected;
  });
}

test('overlapping dev CSS edits keep the newest stylesheet and retain working styles on failure', { timeout: 30_000 }, async t => {
  const { EventSource } = await import('undici');
  const { runInNewContext } = await import('node:vm');
  const cwd = await fixture(t);
  const base = await start(t, cwd, 'dev', 1);
  const client = await (await fetch(new URL('assets/reload.js', base))).text();
  const changes = new EventSource(new URL('/esbuild', base));
  const watchEvents = on(changes, 'change', { signal: t.signal });
  const browserEvents = new EventTarget();
  try {
    await once(changes, 'open', { signal: t.signal });
    const stylesheet = path.join(cwd, 'src/host/ui/style.css');
    // Establish esbuild's initial watch snapshot before the two measured edits.
    await writeFile(stylesheet, 'body { color: orange; }');
    await watchEvents.next();
    // Drive the served client with the real watch stream; complete each CSS
    // request explicitly so the regression does not depend on network timing.
    class Link {
      href = new URL('assets/main.css', base).href;
      onload?: () => void;
      onerror?: () => void;
      cloneNode() { return new Link(); }
      after(next: Link) { links.splice(links.indexOf(this) + 1, 0, next); }
      remove() { const at = links.indexOf(this); if (at >= 0) links.splice(at, 1); }
    }
    const original = new Link(), links = [original];
    let reloads = 0;
    runInNewContext(client, {
      EventSource: class { constructor(url: string) { assert.equal(url, '/esbuild'); return browserEvents; } },
      document: { querySelectorAll: () => [...links] }, location: { reload() { reloads++; } },
      URL, Date: { now: () => 1234 },
    });
    const edit = async (color: string) => {
      await writeFile(stylesheet, 'body { color: ' + color + '; }');
      // A newly connected watcher may first announce all initial outputs.
      let event;
      do {
        const change = await watchEvents.next();
        assert.ok(!change.done, 'dev watch stream ended before the stylesheet changed');
        [event] = change.value;
      } while (JSON.parse(event.data).added.length);
      assert.deepEqual(JSON.parse(event.data).updated, ['/assets/main.css']);
      browserEvents.dispatchEvent(new MessageEvent('change', { data: event.data }));
      return links[1];
    };

    const first = await edit('red');
    const last = await edit('green');
    assert.deepEqual(links, [original, last], 'a superseded stylesheet must be detached');
    assert.notEqual(last.href, first.href, 'rapid updates must request distinct URLs');
    last.onload!();
    first.onload?.();
    first.onerror?.();
    assert.deepEqual(links, [last]);
    assert.equal(reloads, 0);

    const failed = await edit('black');
    failed.onerror!();
    assert.deepEqual(links, [last], 'a failed replacement must preserve the working stylesheet');
    const repaired = await edit('purple');
    repaired.onload!();
    assert.deepEqual(links, [repaired]);
    assert.equal(reloads, 0);
  } finally { changes.close(); }
});
