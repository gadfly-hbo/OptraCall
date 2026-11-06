import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execute = promisify(execFile);

// Execute the unmodified adapter source against a wholly synthetic package tree.
// No loader hooks, real SDK modules, installation files or application roots are changed.
async function fixture(version: string, internalSource?: string) {
  const parent = path.resolve('.local/pi-sdk-adaptation-repair/implementation/r2/test-roots');
  await mkdir(parent, { recursive: true });
  const root = await mkdtemp(path.join(parent, 'mcp-loader-'));
  const adapter = path.join(root, 'src/agent/sdk.ts');
  const packageRoot = path.join(root, 'node_modules/@earendil-works/pi-coding-agent');
  await mkdir(path.dirname(adapter), { recursive: true });
  await mkdir(path.join(packageRoot, 'dist/extensions/mcp'), { recursive: true });
  await writeFile(path.join(root, 'package.json'), JSON.stringify({ type: 'module' }));
  await writeFile(adapter, await readFile(new URL('../src/agent/sdk.ts', import.meta.url)));
  await writeFile(path.join(packageRoot, 'package.json'), JSON.stringify({ name: '@earendil-works/pi-coding-agent', type: 'module', exports: { '.': './index.js' } }));
  await writeFile(path.join(packageRoot, 'index.js'), `export const VERSION = ${JSON.stringify(version)};\n`);
  if (internalSource !== undefined) await writeFile(path.join(packageRoot, 'dist/extensions/mcp/config.js'), internalSource);
  const probe = `
    import { pathToFileURL } from 'node:url';
    let stage = 'adapter_import';
    try {
      const sdk = await import(pathToFileURL(process.argv[1]).href);
      stage = 'loader_request';
      const loader = await sdk.getSdkMcpConfigLoader();
      stage = 'parser_execution';
      const result = loader({ agentDir: '/synthetic-agent', cwd: '/synthetic-work', projectTrusted: true });
      console.log(JSON.stringify({ stage: 'loaded', result }));
    } catch (error) {
      console.log(JSON.stringify({ stage, message: error.message, code: error.code }));
    }
  `;
  return {
    root,
    marker: path.join(packageRoot, 'dist/extensions/mcp/internal-evaluated'),
    async run() {
      const { stdout, stderr } = await execute(process.execPath, ['--input-type=module', '-e', probe, adapter], { timeout: 10_000 });
      assert.equal(stderr, '');
      const result = JSON.parse(stdout.trim());
      await writeFile(path.join(root, 'result.json'), JSON.stringify(result, null, 2) + '\n');
      return result;
    },
  };
}

test('R2: unsupported SDK version rejects before evaluating the fixed internal MCP module', async () => {
  const f = await fixture('1.4.1', `import { writeFileSync } from 'node:fs'; writeFileSync(new URL('./internal-evaluated', import.meta.url), 'evaluated'); export function loadMcpConfig() { return { servers: [], errors: [] }; }`);
  const result = await f.run();
  assert.deepEqual(result, { stage: 'loader_request', message: 'mcp_config_sdk_version_unsupported' });
  await assert.rejects(stat(f.marker), { code: 'ENOENT' }, 'the unsupported adapter must not evaluate its internal dependency');
});

test('R2: missing fixed internal MCP module reports a stable compatibility error when requested', async () => {
  const f = await fixture('1.4.0');
  assert.deepEqual(await f.run(), { stage: 'loader_request', message: 'mcp_config_sdk_loader_unavailable' });
});

test('R2: absent or non-function MCP loader exports are explicit compatibility failures', async () => {
  for (const source of ['export const unrelated = true;', 'export const loadMcpConfig = 42;']) {
    const f = await fixture('1.4.0', source);
    assert.deepEqual(await f.run(), { stage: 'loader_request', message: 'mcp_config_sdk_loader_unavailable' });
  }
});

test('R2: the fixed original parser receives unchanged options and preserves configuration errors', async () => {
  const f = await fixture('1.4.0', `export function loadMcpConfig(options) { return { servers: [{ name: 'ordinary-user-mcp' }], errors: ['synthetic original parser warning'], options }; }`);
  assert.deepEqual(await f.run(), { stage: 'loaded', result: { servers: [{ name: 'ordinary-user-mcp' }], errors: ['synthetic original parser warning'], options: { agentDir: '/synthetic-agent', cwd: '/synthetic-work', projectTrusted: true } } });
});

test('R2: actual parser execution failures retain their own error instead of becoming empty config', async () => {
  const f = await fixture('1.4.0', `export function loadMcpConfig() { throw new Error('synthetic_parser_execution_failed'); }`);
  assert.deepEqual(await f.run(), { stage: 'parser_execution', message: 'synthetic_parser_execution_failed' });
});
