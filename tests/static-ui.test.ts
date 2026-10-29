import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHash, randomUUID } from 'node:crypto';
import { createHost } from '../src/host/server.ts';

async function fixture(t: test.TestContext) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'optracall-static-'));
  const ui = path.join(root, 'dist'); await fs.mkdir(path.join(ui, 'assets'), { recursive: true });
  const contents = { 'index.html': '<!doctype html><title>OptraCall trial</title>\n', 'assets/app.js': 'globalThis.optracall=true;\n', 'assets/app.css': 'body{color:#222}\n' };
  for (const [name, value] of Object.entries(contents)) await fs.writeFile(path.join(ui, name), value);
  const build = { schema: 1, version: '0.1.0-test', commit: 'a'.repeat(40), tree: 'b'.repeat(40), builtAt: new Date().toISOString(), dirty: false,
    files: Object.entries(contents).map(([name, value]) => ({ path: name, bytes: Buffer.byteLength(value), sha256: createHash('sha256').update(value).digest('hex') })) };
  await fs.writeFile(path.join(ui, 'optracall-build.json'), JSON.stringify(build));
  const dataRoot = path.join(root, 'private'), projectsRoot = path.join(root, 'projects');
  return { root, ui, build, contents, dataRoot, projectsRoot };
}

test('TRIAL-STATIC-01: built UI and assets share the Host origin while API client checks remain', async t => {
  const f = await fixture(t), instanceId = randomUUID();
  const host = createHost({ cwd: process.cwd(), uiPorts: [4173], transportVersion: 'test', dataRoot: f.dataRoot, projectsRoot: f.projectsRoot, staticUiRoot: f.ui, instanceId });
  t.after(async () => { await host.close(); await fs.rm(f.root, { recursive: true, force: true }); }); await host.ready;
  await new Promise<void>(resolve => host.server.listen(0, '127.0.0.1', resolve));
  const address = host.server.address(); assert.ok(address && typeof address !== 'string'); const base = `http://127.0.0.1:${address.port}`;
  const page = await fetch(base); assert.equal(page.status, 200); assert.match(page.headers.get('content-type') ?? '', /text\/html/); assert.equal(await page.text(), f.contents['index.html']);
  const script = await fetch(base + '/assets/app.js'); assert.equal(script.status, 200); assert.match(script.headers.get('content-type') ?? '', /javascript/); assert.equal(await script.text(), f.contents['assets/app.js']);
  const head = await fetch(base + '/assets/app.css', { method: 'HEAD' }); assert.equal(head.status, 200); assert.equal(await head.text(), '');
  const route = await fetch(base + '/projects/example', { headers: { accept: 'text/html' } }); assert.equal(route.status, 200); assert.equal(await route.text(), f.contents['index.html']);
  assert.equal((await fetch(base + '/api/projects')).status, 403);
  assert.deepEqual(await (await fetch(base + '/api/projects', { headers: { 'x-optracall-client': '1' } })).json(), { projects: [] });
  const health = await (await fetch(base + '/api/health')).json(); assert.equal(health.runtime.instanceId, instanceId); assert.equal(health.runtime.commit, f.build.commit); assert.equal(health.runtime.pid, process.pid); assert.equal(health.runtime.codeRoot, process.cwd());
  for (const name of ['/assets/missing.js', '/%2e%2e%2fpackage.json', '/.env', '/src/host/server.ts']) assert.equal((await fetch(base + name)).status, 404, name);
  const foreign = await fetch(base + '/', { headers: { origin: 'https://example.invalid' } }); assert.equal(foreign.status, 403);
});

test('TRIAL-STATIC-02: changed or escaping build assets fail before opening user storage', async t => {
  for (const variant of ['changed', 'symlink'] as const) {
    const f = await fixture(t); t.after(() => fs.rm(f.root, { recursive: true, force: true }));
    if (variant === 'changed') await fs.writeFile(path.join(f.ui, 'assets/app.js'), 'Changed after build\n');
    else { const outside = path.join(f.root, 'private-code.js'); await fs.writeFile(outside, f.contents['assets/app.js']); await fs.unlink(path.join(f.ui, 'assets/app.js')); await fs.symlink(outside, path.join(f.ui, 'assets/app.js')); }
    const host = createHost({ cwd: process.cwd(), uiPorts: [4173], transportVersion: 'test', dataRoot: f.dataRoot, projectsRoot: f.projectsRoot, staticUiRoot: f.ui });
    await assert.rejects(host.ready); assert.equal(await fs.stat(f.dataRoot).then(() => true, () => false), false, 'An invalid UI build must not open the user store.');
  }
});

test('TRIAL-STATIC-03: a running Host keeps its original build bytes and identity', async t => {
  const f = await fixture(t); const host = createHost({ cwd: process.cwd(), uiPorts: [4173], transportVersion: 'test', dataRoot: f.dataRoot, projectsRoot: f.projectsRoot, staticUiRoot: f.ui });
  t.after(async () => { await host.close(); await fs.rm(f.root, { recursive: true, force: true }); }); await host.ready; await new Promise<void>(resolve => host.server.listen(0, '127.0.0.1', resolve));
  const address = host.server.address(); assert.ok(address && typeof address !== 'string'); const base = `http://127.0.0.1:${address.port}`;
  await fs.writeFile(path.join(f.ui, 'index.html'), '<title>A later disk build</title>'); await fs.writeFile(path.join(f.ui, 'optracall-build.json'), '{}');
  assert.equal(await (await fetch(base)).text(), f.contents['index.html']); assert.equal((await (await fetch(base + '/api/health')).json()).runtime.commit, f.build.commit);
});
