import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdir, mkdtemp, readFile, writeFile, rename, symlink } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { inspectPinnedSdkMaterials, checkPinnedSdk } from '../scripts/check-pi-sdk.mjs';

const names = ['pi-coding-agent', 'pi-agent-core', 'pi-ai', 'pi-codemode', 'pi-mcp', 'pi-tui', 'pi-telemetry'].map(name => '@earendil-works/' + name);
const sdk = '@earendil-works/pi-coding-agent';
const dependencies: Record<string, Record<string, string>> = {
  [sdk]: { '@earendil-works/pi-agent-core': '1.4.0', '@earendil-works/pi-ai': '1.4.0', '@earendil-works/pi-codemode': '1.4.0', '@earendil-works/pi-mcp': '1.4.0', '@earendil-works/pi-tui': '1.4.0', undici: '8.10.2' },
  '@earendil-works/pi-agent-core': { '@earendil-works/pi-ai': '1.4.0' },
  '@earendil-works/pi-ai': { '@earendil-works/pi-telemetry': '1.4.0' },
};
function materials() {
  const root = '/synthetic/pinned-sdk';
  const manifest = { dependencies: { [sdk]: '1.4.0', undici: '8.12.2' }, overrides: { undici: '8.12.2' } };
  const packages = [...names, 'undici'].map(name => {
    const version = name === 'undici' ? '8.12.2' : '1.4.0';
    const directory = path.join(root, 'node_modules', name);
    return { directory, realDirectory: directory, symlink: false, manifest: { name, version, dependencies: { ...dependencies[name] } } };
  });
  const lock: { lockfileVersion: number; packages: Record<string, { version?: string; resolved?: string; integrity?: string; dependencies: Record<string, string> }> } = { lockfileVersion: 3, packages: {
    '': { dependencies: { ...manifest.dependencies } },
    ...Object.fromEntries(packages.map(item => [path.relative(root, item.directory), { version: item.manifest.version, resolved: `https://registry.npmjs.org/${item.manifest.name}/-/${item.manifest.name.split('/').at(-1)}-${item.manifest.version}.tgz`, integrity: 'sha512-' + Buffer.alloc(64, 1).toString('base64'), dependencies: item.manifest.dependencies }])),
  } };
  const resolutions = packages.map(item => ({ from: root, name: item.manifest.name, directory: item.directory }));
  for (const item of packages) for (const name of Object.keys(item.manifest.dependencies)) resolutions.push({ from: item.directory, name, directory: path.join(root, 'node_modules', name) });
  return { root, manifest, lock, packages, resolutions, patchFiles: [] as { file: string; source: string }[] };
}

test('R4: approved pinned materials pass and a floating SDK declaration is rejected', () => {
  const original = materials();
  assert.deepEqual(inspectPinnedSdkMaterials(original), []);
  const changed = structuredClone(original);
  changed.manifest.dependencies[sdk] = '^1.4.0';
  assert.ok(inspectPinnedSdkMaterials(changed).some(item => /SDK dependency/.test(item.reason)));
});

test('R4: every official Pi lock entry requires its fixed official source and SHA-512 material', () => {
  for (const name of names) for (const field of ['version', 'resolved', 'integrity', 'missing'] as const) {
    const changed = materials(), key = 'node_modules/' + name;
    if (field === 'missing') delete changed.lock.packages[key];
    else changed.lock.packages[key][field] = field === 'version' ? '1.4.1' : field === 'resolved' ? 'https://private.invalid/pi.tgz' : 'sha512-invalid';
    assert.ok(inspectPinnedSdkMaterials(changed).some(item => item.file === 'package-lock.json'), `${name}: ${field}`);
  }
  const nested = materials();
  nested.lock.packages['node_modules/example/node_modules/@earendil-works/pi-ai'] = { ...nested.lock.packages['node_modules/@earendil-works/pi-ai']!, version: '1.4.1' };
  assert.ok(inspectPinnedSdkMaterials(nested).some(item => item.file === 'package-lock.json'), 'nested Pi installations cannot introduce another official SDK version');
});

test('R4: actual Pi metadata, paths and SDK dependency resolutions cannot substitute another installation', () => {
  for (const mutate of [
    (value: ReturnType<typeof materials>) => { value.packages[2]!.manifest.name = 'private-sdk'; },
    (value: ReturnType<typeof materials>) => { value.packages[6]!.manifest.version = '1.4.1'; },
    (value: ReturnType<typeof materials>) => { value.packages[1]!.symlink = true; },
    (value: ReturnType<typeof materials>) => { value.packages[1]!.realDirectory = '/outside/pi-agent-core'; },
    (value: ReturnType<typeof materials>) => { value.packages.splice(6, 1); },
    (value: ReturnType<typeof materials>) => { value.resolutions.find(item => item.from !== value.root && item.name === '@earendil-works/pi-ai')!.directory = '/outside/pi-ai'; },
    (value: ReturnType<typeof materials>) => { value.packages[0]!.manifest.dependencies['@earendil-works/pi-ai'] = '^1.4.0'; },
    (value: ReturnType<typeof materials>) => { value.packages.at(-1)!.manifest.version = '8.10.2'; },
    (value: ReturnType<typeof materials>) => { value.manifest.overrides.undici = '8.10.2'; },
  ]) {
    const changed = materials(); mutate(changed);
    assert.ok(inspectPinnedSdkMaterials(changed).length > 0);
  }
});

test('R4: Pi aliases, overrides and known installation patch mechanisms are rejected without an approval flag', () => {
  for (const addition of [
    { overrides: { undici: '8.12.2', [sdk]: '1.4.0' } },
    { overrides: { undici: '8.12.2', example: { '@earendil-works/pi-ai': 'file:../private' } } },
    { devDependencies: { otherRuntime: 'npm:@earendil-works/pi-ai@1.4.0' } },
    { devDependencies: { 'patch-package': '8.0.0' }, scripts: { postinstall: 'patch-package @earendil-works/pi-ai' } },
    { pnpm: { patchedDependencies: { '@earendil-works/pi-mcp@1.4.0': 'patches/mcp.patch' } } },
    { resolutions: { '@earendil-works/pi-agent-core': '1.4.0' } },
    { scripts: { postinstall: "sed -i.bak 's/original/patched/' node_modules/@earendil-works/pi-coding-agent/dist/index.js" } },
    { scripts: { 'patch:pi': 'node scripts/patch-pi-coding-agent.mjs' }, approved: true },
  ]) {
    const changed = materials(); Object.assign(changed.manifest, addition);
    assert.ok(inspectPinnedSdkMaterials(changed).length > 0, JSON.stringify(addition));
  }
  const patched = materials();
  patched.patchFiles.push({ file: 'patches/custom-name.patch', source: 'diff --git a/node_modules/@earendil-works/pi-tui/dist/index.js b/node_modules/@earendil-works/pi-tui/dist/index.js' });
  assert.ok(inspectPinnedSdkMaterials(patched).length > 0);
  const unrelated = materials();
  Object.assign(unrelated.manifest, { devDependencies: { 'patch-package': '8.0.0' }, scripts: { test: 'node --test tests/*.test.ts', postinstall: 'patch-package' } });
  unrelated.patchFiles.push({ file: 'patches/unrelated.patch', source: 'diff --git a/node_modules/unrelated/index.js b/node_modules/unrelated/index.js' });
  assert.deepEqual(inspectPinnedSdkMaterials(unrelated), []);
});

test('R4: known filesystem mutations reject explicit Pi installation targets in callback, promise and Sync forms', async t => {
  const operations = ['writeFile', 'appendFile', 'truncate', 'copyFile', 'rename', 'unlink', 'write', 'writev', 'ftruncate', 'cp', 'rm'];
  for (const operation of [...operations.flatMap(name => [name, name + 'Sync']), 'createWriteStream']) await t.test(operation, () => {
    const base = operation.replace(/Sync$/, '');
    const receivers = ["require('node:fs')"];
    if (['writeFile', 'appendFile', 'truncate', 'copyFile', 'rename', 'unlink', 'cp', 'rm'].includes(operation)) receivers.push("require('node:fs/promises')");
    const command = (receiver: string, target: string) => {
      const fileDescriptor = ['write', 'writev', 'ftruncate'].includes(base);
      const prefix = `const fs=${receiver};` + (fileDescriptor ? `const fd=fs.openSync('${target}','w');` : '');
      const destination = fileDescriptor ? 'fd' : `'${target}'`;
      let args = ['copyFile', 'rename', 'cp'].includes(base) ? `'synthetic-input',${destination}` : ['writeFile', 'appendFile', 'write'].includes(base) ? `${destination},'synthetic'` : base === 'writev' ? `${destination},[Buffer.from('synthetic')]` : ['truncate', 'ftruncate'].includes(base) ? `${destination},0` : destination;
      if (!operation.endsWith('Sync') && operation !== 'createWriteStream' && !receiver.includes('promises')) args += ',()=>{}';
      return `node -e "${prefix}fs.${operation}(${args})"`;
    };
    for (const receiver of receivers) {
      const changed = materials();
      Object.assign(changed.manifest, { scripts: { postinstall: command(receiver, 'node_modules/@earendil-works/pi-coding-agent/dist/index.js') } });
      assert.ok(inspectPinnedSdkMaterials(changed).some(item => /installation patch mechanism/.test(item.reason)), operation);
      const unrelated = materials();
      Object.assign(unrelated.manifest, { scripts: { postinstall: command(receiver, 'node_modules/unrelated/index.js') } });
      assert.deepEqual(inspectPinnedSdkMaterials(unrelated), [], 'operations with no Pi target remain outside this gate');
    }
  });
  const readOnly = materials();
  Object.assign(readOnly.manifest, { scripts: { inspect: `node -e "require('node:fs').readFileSync('node_modules/@earendil-works/pi-coding-agent/dist/index.js')"` } });
  assert.deepEqual(inspectPinnedSdkMaterials(readOnly), [], 'reading Pi package material is not an installation mutation');
});

test('R4: explicit stdout and stderr output of read-only Pi bytes remains permitted', () => {
  const read = "require('node:fs').readFileSync('node_modules/@earendil-works/pi-coding-agent/dist/index.js','utf8')";
  for (const output of ['process.stdout.write', 'process.stderr.write', 'process.stdout.writev', 'process.stderr.writev', 'process . stderr . write', 'console.log']) {
    const value = materials();
    Object.assign(value.manifest, { scripts: { postinstall: `node -e "${output}(${output.endsWith('writev') ? '[' + read + ']' : read})"` } });
    assert.deepEqual(inspectPinnedSdkMaterials(value), [], output);
  }
});

test('R4: a standard stream callee does not hide nested filesystem modification of Pi', () => {
  const target = 'node_modules/@earendil-works/pi-coding-agent/dist/index.js';
  for (const output of ['process.stdout.write', 'process.stderr.writev']) for (const modify of [
    `require('node:fs').writeFileSync('${target}','synthetic')`,
    `require('node:fs').writeSync(require('node:fs').openSync('${target}','w'),'synthetic')`,
    `require('node:fs').appendFileSync('${target}','synthetic')`,
  ]) {
    const value = materials();
    Object.assign(value.manifest, { scripts: { postinstall: `node -e "${output}(${output.endsWith('writev') ? '[String(' + modify + ')]' : 'String(' + modify + ')'})"` } });
    assert.ok(inspectPinnedSdkMaterials(value).some(item => /installation patch mechanism/.test(item.reason)), modify);
  }
});

test('R4: the actual metadata reader resolves the pinned closure without executing package code and rejects a linked substitute', async () => {
  const parent = path.resolve('.local/pi-sdk-adaptation-repair/implementation/r4/material-test-roots');
  await mkdir(parent, { recursive: true });
  const root = await mkdtemp(path.join(parent, 'metadata-')), value = materials();
  await writeFile(path.join(root, 'package.json'), JSON.stringify(value.manifest));
  await writeFile(path.join(root, 'package-lock.json'), JSON.stringify(value.lock));
  for (const item of value.packages) {
    const directory = path.join(root, 'node_modules', item.manifest.name);
    await mkdir(directory, { recursive: true });
    await writeFile(path.join(directory, 'package.json'), JSON.stringify({ ...item.manifest, type: 'module', exports: './index.js' }));
    await writeFile(path.join(directory, 'index.js'), "throw new Error('SDK code must never execute during metadata inspection');\n");
  }
  assert.deepEqual(await checkPinnedSdk(root), []);
  const metadata = path.join(root, 'node_modules', sdk, 'package.json'), before = await readFile(metadata);
  const changed = JSON.parse(before.toString()); changed.version = '1.4.1';
  await writeFile(metadata, JSON.stringify(changed));
  assert.ok((await checkPinnedSdk(root)).length > 0);
  await writeFile(metadata, before);
  const installed = path.join(root, 'node_modules/@earendil-works/pi-agent-core');
  await rename(installed, installed + '-substitute'); await symlink(installed + '-substitute', installed, 'dir');
  assert.ok((await checkPinnedSdk(root)).length > 0, 'a same-version linked copy must not pass as the installed official package');
});

test('R4: archive comparison rejects altered installed bytes instead of printing a successful receipt', async () => {
  await mkdir(path.resolve('.local/pi-sdk-adaptation-repair/implementation/r4'), { recursive: true });
  const program = `
import io, pathlib, runpy, tarfile, tempfile
compare = runpy.run_path('scripts/verify-official-pi.py', run_name='verification_test')['compare_archive']
buffer = io.BytesIO()
with tarfile.open(fileobj=buffer, mode='w:gz') as archive:
    entry = tarfile.TarInfo('package/index.js'); data = b'original official bytes'; entry.size = len(data)
    archive.addfile(entry, io.BytesIO(data))
with tempfile.TemporaryDirectory(dir='.local/pi-sdk-adaptation-repair/implementation/r4') as directory:
    root = pathlib.Path(directory); (root/'index.js').write_bytes(data)
    assert compare(buffer.getvalue(), root)['ok'] is True
    (root/'index.js').write_bytes(b'changed installation')
    result = compare(buffer.getvalue(), root)
    assert result['ok'] is False, 'changed official bytes must fail verification'
    assert result['changed'] == ['index.js']
print('PASS')
`;
  const { stdout } = await promisify(execFile)('python3', ['-c', program], { timeout: 10_000 });
  assert.equal(stdout.trim(), 'PASS');
});

test('R4: archive verification fails missing, extra and linked files and refuses unsafe members without extracting them', async () => {
  await mkdir(path.resolve('.local/pi-sdk-adaptation-repair/implementation/r4'), { recursive: true });
  const program = `
import io, pathlib, runpy, tarfile, tempfile
compare = runpy.run_path('scripts/verify-official-pi.py', run_name='verification_test')['compare_archive']
def archive(name='package/index.js', kind=None):
    buffer = io.BytesIO()
    with tarfile.open(fileobj=buffer, mode='w:gz') as target:
        member = tarfile.TarInfo(name)
        if kind is not None:
            member.type = kind; member.linkname = '../outside'; target.addfile(member)
        else:
            member.size = 8; target.addfile(member, io.BytesIO(b'original'))
    return buffer.getvalue()
with tempfile.TemporaryDirectory(dir='.local/pi-sdk-adaptation-repair/implementation/r4') as directory:
    root = pathlib.Path(directory); package = root/'package'; package.mkdir()
    result = compare(archive(), package)
    assert result['ok'] is False and result['missing'] == ['index.js']
    (package/'index.js').write_bytes(b'original'); (package/'extra.js').write_bytes(b'extra')
    result = compare(archive(), package)
    assert result['ok'] is False and result['extraNonDependencyFiles'] == ['extra.js']
    (package/'extra.js').unlink(); (package/'index.js').unlink()
    outside = root/'outside'; outside.write_bytes(b'original'); (package/'index.js').symlink_to(outside.absolute())
    result = compare(archive(), package)
    assert result['ok'] is False and result['symlinks'] == ['index.js']
    linked_root = root/'linked-package'; linked_root.symlink_to(package.absolute(), target_is_directory=True)
    assert compare(archive(), linked_root)['ok'] is False
    for name, kind in [('package/../escaped',None),('/absolute',None),('package//escaped',None),('package/link',tarfile.SYMTYPE),('package/hardlink',tarfile.LNKTYPE)]:
        try:
            compare(archive(name, kind), package)
        except ValueError:
            pass
        else:
            raise AssertionError('unsafe archive member was accepted: ' + name)
    assert outside.read_bytes() == b'original'
    assert not (root/'escaped').exists()
print('PASS')
`;
  const { stdout } = await promisify(execFile)('python3', ['-c', program], { timeout: 10_000 });
  assert.equal(stdout.trim(), 'PASS');
});
