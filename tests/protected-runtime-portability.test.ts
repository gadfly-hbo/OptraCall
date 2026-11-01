import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdtemp, mkdir, symlink, writeFile, readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';

const cltPython = '/Library/Developer/CommandLineTools/usr/bin/python3';

test('managed tools support the selected Apple CLT Python while protecting private files and originals', {
  skip: process.platform !== 'darwin' || !existsSync(cltPython), timeout: 30_000,
}, async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'optracall-runtime-portability-'));
  const bin = path.join(root, 'bin'), work = path.join(root, 'work'), originals = path.join(root, 'originals'), privateRoot = path.join(root, 'private');
  for (const directory of [bin, work, originals, privateRoot]) await mkdir(directory, { mode: 0o700 });
  await symlink(process.execPath, path.join(bin, 'node'));
  await symlink(cltPython, path.join(bin, 'python3'));
  const input = path.join(originals, 'source.txt'), secret = path.join(privateRoot, 'auth.json');
  await writeFile(input, 'original'); await writeFile(secret, 'SYNTHETIC-PRIVATE');
  const program = `
    import assert from 'node:assert/strict';
    import { readFile } from 'node:fs/promises';
    import { createProtectedExecutionScope, createProtectedTools } from ${JSON.stringify(new URL('../src/agent/protected-tools.ts', import.meta.url).href)};
    // Only this isolated child sees the bin used to select the installed CLT
    // interpreter; no global PATH, binary or parent process is modified.
    process.execPath = ${JSON.stringify(path.join(bin, 'node'))};
    const scope = await createProtectedExecutionScope({ id: 'clt-portability', cwd: ${JSON.stringify(work)}, writableRoot: ${JSON.stringify(work)}, readRoots: [${JSON.stringify(originals)}] });
    const runtime = await createProtectedTools({ scope, codeRoot: ${JSON.stringify(process.cwd())}, forbiddenRoots: [${JSON.stringify(privateRoot)}] });
    try {
      const python = "import json,os,sys; print(json.dumps({'runtime':'clt-ready','prefix':sys.prefix,'sum':sum(range(11))}))";
      const result = await runtime.tools.find(tool => tool.name === 'bash').execute('clt-call', { command: 'python3 -I -S -c ' + JSON.stringify(python) });
      const text = JSON.stringify(result.content);
      assert.match(text, /clt-ready/); assert.match(text, /CommandLineTools/); assert.match(text, /55/);
      const read = runtime.tools.find(tool => tool.name === 'read');
      await assert.rejects(read.execute('private-denied', { path: ${JSON.stringify(secret)} }), /EPERM|EACCES|not permitted|Permission/i);
      const write = runtime.tools.find(tool => tool.name === 'write');
      await assert.rejects(write.execute('original-denied', { path: ${JSON.stringify(input)}, content: 'changed' }), /EPERM|EACCES|not permitted|Permission/i);
    } finally { await runtime.close(); }
    assert.equal(await readFile(${JSON.stringify(input)}, 'utf8'), 'original');
    assert.equal(await readFile(${JSON.stringify(secret)}, 'utf8'), 'SYNTHETIC-PRIVATE');
    console.log('clt-portability-complete');
  `;
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', program], { encoding: 'utf8', timeout: 25_000 });
  assert.equal(result.status, 0, result.stderr + result.stdout);
  assert.match(result.stdout, /clt-portability-complete/);
  assert.equal(await readFile(input, 'utf8'), 'original');
});
