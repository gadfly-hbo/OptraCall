import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createServer } from 'node:http';

const exec = promisify(execFile);
const evidence = path.resolve('.local/macbook-trial-delivery/update');
const moduleUrl = new URL('../scripts/trial-update.mjs', import.meta.url);
const update = async (options: Record<string, unknown>) => (await import(moduleUrl.href)).updateTrialCheckout(options);
async function command(cwd: string, ...args: string[]) { return (await exec('git', args, { cwd, env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' } })).stdout.trim(); }
async function fixture(t: test.TestContext) {
  await fs.mkdir(evidence, { recursive: true }); const root = await fs.mkdtemp(path.join(evidence, 'fixture-'));
  const upstream = path.join(root, 'publisher'), clone = path.join(root, 'consumer'), remote = path.join(root, 'remote.git');
  await fs.mkdir(upstream); await command(upstream, 'init', '--initial-branch=main'); await command(upstream, 'config', 'user.name', 'Synthetic'); await command(upstream, 'config', 'user.email', 'synthetic@example.invalid');
  await fs.writeFile(path.join(upstream, '.gitignore'), '/node_modules/\n/dist/\n');
  await fs.writeFile(path.join(upstream, 'package.json'), JSON.stringify({ name: 'optracall-update-fixture', version: '1.0.0', type: 'module', scripts: { build: 'node build.mjs' } }) + '\n');
  await fs.writeFile(path.join(upstream, 'package-lock.json'), JSON.stringify({ name: 'optracall-update-fixture', version: '1.0.0', lockfileVersion: 3, requires: true, packages: { '': { name: 'optracall-update-fixture', version: '1.0.0' } } }) + '\n');
  await fs.writeFile(path.join(upstream, 'build.mjs'), "import fs from 'node:fs/promises'; await fs.mkdir('dist',{recursive:true}); await fs.writeFile('dist/built.txt',await fs.readFile('app.txt'));\n");
  await fs.writeFile(path.join(upstream, 'app.txt'), 'old\n'); await command(upstream, 'add', '.'); await command(upstream, 'commit', '-m', 'fixture base');
  await command(root, 'clone', '--bare', upstream, remote); await command(root, 'clone', '--depth', '1', '--branch', 'main', '--single-branch', 'file://' + remote, clone);
  await command(clone, 'config', 'user.name', 'Synthetic'); await command(clone, 'config', 'user.email', 'synthetic@example.invalid'); await command(clone, 'remote', 'set-url', '--push', 'origin', 'DISABLED');
  const initial = await command(clone, 'rev-parse', 'HEAD');
  let responseBody: unknown; let requests = 0; let onRequest: (() => Promise<void> | void) | undefined; const urls: string[] = [];
  const server = createServer((request, response) => { void (async () => { requests++; urls.push(request.url ?? ''); await onRequest?.(); response.setHeader('content-type', 'application/json'); response.end(JSON.stringify(responseBody)); })().catch(error => { response.statusCode = 500; response.end(String(error)); }); });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve)); const address = server.address(); if (!address || typeof address === 'string') throw new Error('No fixture port');
  t.after(() => new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())));
  const api = `http://127.0.0.1:${address.port}`;
  const data = path.join(root, 'user-project'); await fs.mkdir(data); await fs.writeFile(path.join(data, 'session.jsonl'), 'synthetic history must remain\n');
  const options = { root: clone, expectedOrigin: 'file://' + remote, githubApiBase: api, assertStopped: async () => {} };
  async function publish(text = 'new\n') { await fs.writeFile(path.join(upstream, 'app.txt'), text); await command(upstream, 'add', '.'); await command(upstream, 'commit', '-m', 'fixture update'); await command(upstream, 'push', remote, 'main'); return command(upstream, 'rev-parse', 'HEAD'); }
  function success(sha: string, extra: Record<string, unknown> = {}) { return { id: 81, run_attempt: 1, name: 'Check', path: '.github/workflows/check.yml', head_sha: sha, head_branch: 'main', event: 'push', status: 'completed', conclusion: 'success', repository: { full_name: 'gadfly-hbo/OptraCall' }, head_repository: { full_name: 'gadfly-hbo/OptraCall' }, ...extra }; }
  return { root, upstream, clone, remote, initial, data, options, publish, success, setBody(value: unknown) { responseBody = value; }, whenCiRequested(action: () => Promise<void> | void) { onRequest = action; }, requests: () => requests, urls };
}

test('UPDATE-01: a trial copy on a development branch is refused without fetching or installing', async t => {
  const f = await fixture(t); await command(f.clone, 'switch', '-c', 'local-work');
  await assert.rejects(update(f.options), { code: 'trial_branch_not_main' });
  assert.equal(await command(f.clone, 'rev-parse', 'HEAD'), f.initial); assert.equal(f.requests(), 0);
  await assert.rejects(fs.access(path.join(f.clone, 'dist')));
});

test('UPDATE-01: a clean shallow consumer adopts the exact successful main CI commit, installs and builds, preserving user data', async t => {
  const f = await fixture(t), target = await f.publish(); f.setBody({ workflow_runs: [f.success(target)] });
  const result = await update(f.options);
  assert.deepEqual(result, { updated: true, from: f.initial, targetSha: target });
  assert.equal(await command(f.clone, 'rev-parse', 'HEAD'), target);
  assert.equal(await fs.readFile(path.join(f.clone, 'dist/built.txt'), 'utf8'), 'new\n');
  assert.equal(await fs.readFile(path.join(f.data, 'session.jsonl'), 'utf8'), 'synthetic history must remain\n');
  assert.equal(await command(f.clone, 'status', '--porcelain=v1'), '');
  assert.ok(f.urls[0].startsWith('/repos/gadfly-hbo/OptraCall/actions/workflows/check.yml/runs?'));
  assert.ok(f.urls[0].includes('head_sha=' + target));
  assert.equal(await command(f.clone, 'config', 'remote.origin.pushurl'), 'DISABLED');
});

test('UPDATE-01: modified, staged or untracked local work is preserved and blocks update before network', async t => {
  for (const kind of ['modified', 'staged', 'untracked']) await t.test(kind, async sub => {
    const f = await fixture(sub), file = path.join(f.clone, kind === 'untracked' ? 'local-note.txt' : 'app.txt');
    await fs.writeFile(file, 'user work must remain\n'); if (kind === 'staged') await command(f.clone, 'add', 'app.txt');
    await assert.rejects(update(f.options), { code: 'trial_checkout_dirty' });
    assert.equal(await command(f.clone, 'rev-parse', 'HEAD'), f.initial); assert.equal(await fs.readFile(file, 'utf8'), 'user work must remain\n'); assert.equal(f.requests(), 0);
  });
});

test('UPDATE-01: an unexpected fetch origin or running application is refused without changing the checkout', async t => {
  const f = await fixture(t);
  await assert.rejects(update({ ...f.options, expectedOrigin: 'https://different.example.invalid/source.git' }), { code: 'trial_origin_mismatch' });
  await assert.rejects(update({ ...f.options, assertStopped: async () => { throw Object.assign(new Error('active'), { code: 'trial_instance_running' }); } }), { code: 'trial_instance_running' });
  assert.equal(await command(f.clone, 'rev-parse', 'HEAD'), f.initial); assert.equal(f.requests(), 0);
});

test('UPDATE-01: local ahead and divergent histories are never reset or merged', async t => {
  for (const mode of ['ahead', 'diverged']) await t.test(mode, async sub => {
    const f = await fixture(sub); if (mode === 'diverged') await f.publish('remote version\n');
    await fs.writeFile(path.join(f.clone, 'app.txt'), 'local commit\n'); await command(f.clone, 'add', '.'); await command(f.clone, 'commit', '-m', 'local work'); const local = await command(f.clone, 'rev-parse', 'HEAD');
    await assert.rejects(update(f.options), { code: 'trial_local_ahead_or_diverged' });
    assert.equal(await command(f.clone, 'rev-parse', 'HEAD'), local); assert.equal(await fs.readFile(path.join(f.clone, 'app.txt'), 'utf8'), 'local commit\n'); assert.equal(f.requests(), 0);
  });
});

test('UPDATE-01: only the exact current successful official main push Check can admit a commit', async t => {
  const variants: Record<string, Record<string, unknown>> = {
    pending: { status: 'in_progress', conclusion: null }, failed: { conclusion: 'failure' },
    wrongSha: { head_sha: 'a'.repeat(40) }, pullRequest: { event: 'pull_request' }, wrongBranch: { head_branch: 'other' },
    wrongWorkflow: { path: '.github/workflows/unrelated.yml' }, wrongName: { name: 'unrelated' },
    otherRepo: { repository: { full_name: 'other/OptraCall' } }, fork: { head_repository: { full_name: 'other/OptraCall' } },
  };
  for (const [name, change] of Object.entries(variants)) await t.test(name, async sub => {
    const f = await fixture(sub), target = await f.publish(); f.setBody({ workflow_runs: [f.success(target, change)] });
    await assert.rejects(update(f.options), { code: 'trial_ci_not_passed' });
    assert.equal(await command(f.clone, 'rev-parse', 'HEAD'), f.initial); assert.equal(await fs.readFile(path.join(f.clone, 'app.txt'), 'utf8'), 'old\n');
    await assert.rejects(fs.access(path.join(f.clone, 'dist')));
  });
});

test('UPDATE-01: a newer failed run or same-run newer failed attempt defeats an older success', async t => {
  for (const newerAttempt of [false, true]) await t.test(String(newerAttempt), async sub => {
    const f = await fixture(sub), target = await f.publish(); f.setBody({ workflow_runs: [f.success(target), f.success(target, { id: newerAttempt ? 81 : 82, run_attempt: newerAttempt ? 2 : 1, conclusion: 'failure' })] });
    await assert.rejects(update(f.options), { code: 'trial_ci_not_passed' }); assert.equal(await command(f.clone, 'rev-parse', 'HEAD'), f.initial);
  });
});

test('UPDATE-01: unavailable or malformed CI leaves source and user data untouched', async t => {
  const f = await fixture(t); await f.publish(); f.setBody({ unexpected: [] });
  await assert.rejects(update(f.options), { code: 'trial_ci_unavailable' }); assert.equal(await command(f.clone, 'rev-parse', 'HEAD'), f.initial);
  assert.equal(await fs.readFile(path.join(f.data, 'session.jsonl'), 'utf8'), 'synthetic history must remain\n');
});

test('UPDATE-01: the stopped/clean conditions are rechecked after CI latency before modifying files', async t => {
  for (const change of ['running', 'dirty']) await t.test(change, async sub => {
    const f = await fixture(sub), target = await f.publish(); let running = false; f.setBody({ workflow_runs: [f.success(target)] });
    f.whenCiRequested(async () => { if (change === 'running') running = true; else await fs.writeFile(path.join(f.clone, 'app.txt'), 'user edit during network\n'); });
    const assertStopped = async () => { if (running) throw Object.assign(new Error('active'), { code: 'trial_instance_running' }); };
    await assert.rejects(update({ ...f.options, assertStopped }), { code: change === 'running' ? 'trial_instance_running' : 'trial_checkout_dirty' });
    assert.equal(await command(f.clone, 'rev-parse', 'HEAD'), f.initial); await assert.rejects(fs.access(path.join(f.clone, 'dist')));
    if (change === 'dirty') assert.equal(await fs.readFile(path.join(f.clone, 'app.txt'), 'utf8'), 'user edit during network\n');
  });
});

test('UPDATE-01: a remote advance during CI does not substitute its later unverified commit', async t => {
  const f = await fixture(t), target = await f.publish('verified target\n'); let later = ''; f.setBody({ workflow_runs: [f.success(target)] });
  f.whenCiRequested(async () => { later = await f.publish('later unverified target\n'); });
  const result = await update(f.options); assert.equal(result.targetSha, target); assert.notEqual(later, target); assert.equal(await command(f.clone, 'rev-parse', 'HEAD'), target);
  assert.equal(await fs.readFile(path.join(f.clone, 'dist/built.txt'), 'utf8'), 'verified target\n');
});

test('UPDATE-01: explicit install ignores lifecycle hooks and does not run checkout hooks', async t => {
  const f = await fixture(t); const metadata = JSON.parse(await fs.readFile(path.join(f.upstream, 'package.json'), 'utf8')); metadata.scripts.postinstall = 'node postinstall.mjs'; await fs.writeFile(path.join(f.upstream, 'package.json'), JSON.stringify(metadata) + '\n'); await fs.writeFile(path.join(f.upstream, 'postinstall.mjs'), "import fs from 'node:fs';fs.writeFileSync('../must-not-run.txt','bad');\n");
  const hook = path.join(f.clone, '.git/hooks/post-merge'); await fs.writeFile(hook, '#!/bin/sh\nprintf bad > ../git-hook-must-not-run.txt\n'); await fs.chmod(hook, 0o755);
  const target = await f.publish(); f.setBody({ workflow_runs: [f.success(target)] }); await update(f.options);
  await assert.rejects(fs.access(path.join(f.root, 'must-not-run.txt'))); await assert.rejects(fs.access(path.join(f.root, 'git-hook-must-not-run.txt')));
});

test('UPDATE-01: installation failure keeps the approved source and user data, without a build or rollback', async t => {
  const f = await fixture(t); await fs.unlink(path.join(f.upstream, 'package-lock.json')); const target = await f.publish(); f.setBody({ workflow_runs: [f.success(target)] });
  await assert.rejects(update(f.options), { code: 'trial_install_failed' }); assert.equal(await command(f.clone, 'rev-parse', 'HEAD'), target);
  await assert.rejects(fs.access(path.join(f.clone, 'dist'))); assert.equal(await fs.readFile(path.join(f.data, 'session.jsonl'), 'utf8'), 'synthetic history must remain\n');
});

test('UPDATE-01: a failed build is preserved and the same approved commit can be repaired and retried', async t => {
  const f = await fixture(t); await fs.writeFile(path.join(f.upstream, 'build.mjs'), "import fs from 'node:fs/promises';try{await fs.access('../allow-build')}catch{process.exit(13)}await fs.mkdir('dist',{recursive:true});await fs.writeFile('dist/built.txt',await fs.readFile('app.txt'));\n"); const target = await f.publish(); f.setBody({ workflow_runs: [f.success(target)] });
  await assert.rejects(update(f.options), { code: 'trial_build_failed' }); assert.equal(await command(f.clone, 'rev-parse', 'HEAD'), target); await assert.rejects(fs.access(path.join(f.clone, 'dist')));
  await fs.writeFile(path.join(f.root, 'allow-build'), 'ready\n'); const result = await update(f.options); assert.deepEqual(result, { updated: false, from: target, targetSha: target });
  assert.equal(await fs.readFile(path.join(f.clone, 'dist/built.txt'), 'utf8'), 'new\n'); assert.equal(await fs.readFile(path.join(f.data, 'session.jsonl'), 'utf8'), 'synthetic history must remain\n');
});
