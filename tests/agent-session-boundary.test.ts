import test from 'node:test';
import assert from 'node:assert/strict';
import { inspectSessionSource } from '../scripts/check-agent-session-boundary.mjs';

test('SDK private installed paths remain confined to the sole reviewed SDK surface', () => {
  const privatePath = '../../../node_modules/@earendil-works/pi-coding-agent/dist/extensions/mcp/config.js';
  const source = `import { loadMcpConfig } from '${privatePath}';`;
  assert.ok(inspectSessionSource('extensions/business-plugins/example/entry.ts', source).length, 'relative node_modules paths must not bypass the SDK import boundary');
  assert.ok(inspectSessionSource('src/host/feature.ts', `import x from 'file:///example/node_modules/@earendil-works/pi-coding-agent/dist/index.js';`).length);
  assert.deepEqual(inspectSessionSource('src/agent/sdk.ts', `export async function getSdkMcpConfigLoader() { if (VERSION !== '1.4.0') throw new Error('unsupported'); const { loadMcpConfig } = await import('../../node_modules/@earendil-works/pi-coding-agent/dist/extensions/mcp/config.js'); return loadMcpConfig; }`), [], 'the fixed IN06 thin import stays behind the pinned check at the existing sole SDK surface');
});

test('R4: fixed SDK surface rejects unreviewed internal paths, early loading and direct Pi dependency imports', () => {
  for (const source of [
    `import { loadMcpConfig } from '../../node_modules/@earendil-works/pi-coding-agent/dist/extensions/mcp/config.js';`,
    `const config = await import('../../node_modules/@earendil-works/pi-coding-agent/dist/extensions/mcp/config.js');`,
    `export async function getSdkMcpConfigLoader() { return import('../../node_modules/@earendil-works/pi-coding-agent/dist/core/agent-session.js'); }`,
    `export async function getSdkMcpConfigLoader() { return import('../../node_modules/@earendil-works/pi-coding-agent/dist/extensions/mcp/config.js'); }`,
  ]) assert.ok(inspectSessionSource('src/agent/sdk.ts', source).length, source);
  for (const name of ['agent-core', 'ai', 'codemode', 'mcp', 'tui', 'telemetry']) {
    for (const source of [`import x from '@earendil-works/pi-${name}';`, `export * from '@earendil-works/pi-${name}';`, `const x = import('../../../node_modules/@earendil-works/pi-${name}/dist/index.js');`]) {
      assert.ok(inspectSessionSource(plugin, source).length, source);
    }
  }
});

test('R4: known SDK definition writes fail while new Host-owned definitions remain legal', () => {
  for (const mutation of [
    `definition.execute = wrapped;`, `definition['execute'] = wrapped;`,
    `const alias = definition; alias.execute = wrapped;`,
    `Object.assign(definition, { execute: wrapped });`,
    `Object.defineProperty(definition, 'execute', { value: wrapped });`,
    `Object.defineProperties(definition, { execute: { value: wrapped } });`,
    `Reflect.set(definition, 'execute', wrapped);`,
  ]) assert.ok(inspectSessionSource('src/agent/project-session.ts', `const definition = session.getToolDefinition(name); ${mutation}`).length, mutation);
  assert.ok(inspectSessionSource('src/agent/project-session.ts', `session.getToolDefinition(name).execute = wrapped;`).length);
  assert.deepEqual(inspectSessionSource('src/agent/tool-context-adapter.ts', `const owned = Object.create(Object.getPrototypeOf(original), Object.getOwnPropertyDescriptors(original)); owned.execute = wrapped;`), []);
});

test('R4 review regression: expression wrappers cannot hide a known SDK definition write', () => {
  for (const value of ['(session.getToolDefinition(name))', 'session.getToolDefinition(name)!', '(session.getToolDefinition(name) as ToolDefinition)', '(<ToolDefinition>session.getToolDefinition(name))', '(session.getToolDefinition(name) satisfies ToolDefinition)']) {
    assert.ok(inspectSessionSource('src/agent/project-session.ts', `${value}.execute = wrapped;`).length, value);
    assert.ok(inspectSessionSource('src/agent/project-session.ts', `Reflect.set(${value}, 'execute', wrapped);`).length, value);
  }
  for (const mutation of ['(definition.execute) = wrapped;', '(Object.assign)(definition, {execute: wrapped});', '(Reflect.set)(definition, "execute", wrapped);']) {
    assert.ok(inspectSessionSource('src/agent/project-session.ts', `const definition = session.getToolDefinition(name); ${mutation}`).length, mutation);
  }
});

test('R4 review regression: SDK provenance respects function/block/parameter shadowing and follows a real outer alias', () => {
  const file = 'src/agent/project-session.ts';
  for (const legal of [
    `function inspect() { const definition = session.getToolDefinition(name); return definition; }
     function own() { const definition = { execute: original }; definition.execute = wrapped; }`,
    `const definition = session.getToolDefinition(name); function own(definition) { definition.execute = wrapped; }`,
    `const definition = session.getToolDefinition(name); { const definition = { execute: original }; definition.execute = wrapped; }`,
    `const definition = session.getToolDefinition(name); function own({definition}) { definition.execute = wrapped; }`,
    `const definition = session.getToolDefinition(name); { const {definition} = hostOwned; definition.execute = wrapped; }`,
    `const definition = session.getToolDefinition(name); function own([definition]) { definition.execute = wrapped; }`,
  ]) assert.deepEqual(inspectSessionSource(file, legal), [], legal);
  assert.ok(inspectSessionSource(file, `const definition = session.getToolDefinition(name); function nested() { const alias = definition; alias.execute = wrapped; }`).length);
  assert.ok(inspectSessionSource(file, `function nested() { { var definition = session.getToolDefinition(name); } definition.execute = wrapped; }`).length);
  assert.ok(inspectSessionSource(file, `function inspect() { var definition = session.getToolDefinition(name); var definition; definition.execute = wrapped; }`).length);
});

const plugin = 'extensions/business-plugins/example/session.ts';

test('SAM11: the reviewed SAP Host registrar can bind a public domain but cannot own an SDK runtime', () => {
  const file = 'src/host/sap-method-sessions.ts';
  assert.deepEqual(inspectSessionSource(file, `import { createAgentSessionDomain } from './agent-sessions.ts';`), []);
  assert.ok(inspectSessionSource(plugin, `import { createAgentSessionDomain } from '../../../src/host/agent-sessions.ts';`).length > 0);
  assert.ok(inspectSessionSource(file, `import { ProjectAgent } from '../agent/project-runtime.ts'; new ProjectAgent(options);`).length > 0);
  assert.ok(inspectSessionSource(file, `import { createAgentSession } from '../agent/sdk.ts';`).length > 0);
});

test('a feature uses injected session types without importing a runtime or constructing a manager', () => {
  const source = `import type { SessionRef, SessionTurn } from '../../../src/host/agent-sessions.ts';
    import { ProjectRuntimeError, type ProjectSnapshot } from '../../../src/agent/project-runtime.ts';
    // import { createAgentSession } from '@earendil-works/pi-coding-agent';
    const documentation = "new ProjectAgent(); import('pi-ai')";
    export const run = (port, ref: SessionRef<string>, turn: SessionTurn) => port.start(ref, turn);`;
  assert.deepEqual(inspectSessionSource(plugin, source), []);
});

test('SDK imports, reexports, require and dynamic imports cannot bypass the shared port', () => {
  for (const source of [
    `import { createAgentSession as create } from '@earendil-works/pi-coding-agent';`,
    `export * from '@earendil-works/pi-coding-agent';`,
    `const sdk = require('@earendil-works/pi-coding-agent');`,
    `const sdk = module.require('@earendil-works/pi-coding-agent');`,
    `const sdk = await import('@earendil-works/pi-coding-agent');`,
    `const sdk = await import('@earendil-works/' + 'pi-coding-agent');`,
    `const sdk = await import(moduleName);`,
    `import { SessionManager } from '../../../src/agent/sdk.ts';`,
    `import { createAgentSession } from 'pi-agent-core';`,
    `import { createRequire as load } from 'module';`,
    `type Session = import('@earendil-works/pi-coding-agent').AgentSession;`,
  ]) assert.ok(inspectSessionSource(plugin, source).length > 0, source);
});

test('parser handles JSX, nested templates and regexes without treating their text as imports', () => {
  const source = "const markdown = (value) => `### ${value}\\n\\`\\`\\`text`; const view = <div>new ProjectAgent import('pi-ai') {markdown('ok')}</div>; const pattern = /import\\('pi-ai'\\)/;";
  assert.deepEqual(inspectSessionSource(plugin.replace('.ts', '.tsx'), source), []);
  assert.ok(inspectSessionSource(plugin, "const text = `value ${await import('pi-ai')}`;").length > 0);
});

test('ProjectAgent aliases, namespaces and unbound construction remain prohibited in features', () => {
  for (const source of [
    `import { ProjectAgent as Agent } from '../../../src/agent/project-runtime.ts'; new Agent(options);`,
    `import * as runtime from '../../../src/agent/project-runtime.ts'; new runtime.ProjectAgent(options);`,
    `const runtime = await import('../../../src/agent/project-runtime.ts');`,
    `new ProjectAgent(options);`,
    `import { createAgentSessionDomain } from '../../../src/host/agent-sessions.ts';`,
    `import { AgentRuntime } from '../../../src/agent/runtime.ts';`,
  ]) assert.ok(inspectSessionSource(plugin, source).length > 0, source);
});

test('reviewed low-level paths are limited to their assigned capability', () => {
  assert.deepEqual(inspectSessionSource('src/host/agent-sessions.ts', `import { ProjectAgent } from '../agent/project-runtime.ts'; new ProjectAgent(options);`), []);
  assert.deepEqual(inspectSessionSource('src/host/project-history.ts', `import { SessionManager } from '../agent/sdk.ts';`), []);
  assert.ok(inspectSessionSource('src/host/project-history.ts', `import { createAgentSession } from '../agent/sdk.ts';`).length > 0);
  assert.ok(inspectSessionSource('src/host/server.ts', `import { ProjectAgent } from '../agent/project-runtime.ts';`).length > 0);
  assert.deepEqual(inspectSessionSource('src/host/server.ts', `import { AgentRuntime } from '../agent/runtime.ts';`), []);
  assert.deepEqual(inspectSessionSource('tests/project-runtime.test.ts', `import { ProjectAgent } from '../src/agent/project-runtime.ts'; new ProjectAgent(options);`), []);
  assert.ok(inspectSessionSource('tests/arbitrary-new-plugin.test.ts', `import { ProjectAgent } from '../src/agent/project-runtime.ts';`).length > 0);
});

test('unparseable source fails closed instead of silently passing the boundary check', () => {
  const result = inspectSessionSource(plugin, 'import {');
  assert.equal(result.length, 1);
  assert.match(result[0].reason, /syntax errors/);
});

test('simulation tool exception permits defineTool alone, without runtime capabilities', () => {
  const file = 'extensions/business-plugins/sim-lab/tools/simulation-tools.ts';
  const sdk = '../../../../src/agent/sdk.ts';
  assert.deepEqual(inspectSessionSource(file, `import { defineTool } from '${sdk}';`), []);
  for (const source of [
    `import { createAgentSessionServices } from '${sdk}';`,
    `import { defineTool, SessionManager } from '${sdk}';`,
    `import * as sdk from '${sdk}';`,
    `const sdk = await import('${sdk}');`,
    `import { defineTool } from '@earendil-works/pi-coding-agent';`,
  ]) assert.ok(inspectSessionSource(file, source).length, source);
});

test('protected execution utilities may use native tools but cannot become another SDK session owner', () => {
  const file = 'src/agent/protected-tool-process.ts';
  assert.deepEqual(inspectSessionSource(file, `import { createReadTool, createWriteTool, createCodemodeExtension } from './sdk.ts';`), []);
  for (const source of [
    `import { SessionManager } from './sdk.ts';`,
    `import { createAgentSessionServices } from './sdk.ts';`,
    `import * as sdk from './sdk.ts';`,
    `import { ProjectAgent } from './project-runtime.ts'; new ProjectAgent(options);`,
    `import { createAgentSessionDomain } from '../host/agent-sessions.ts';`,
  ]) assert.ok(inspectSessionSource(file, source).length, source);
  assert.ok(inspectSessionSource(plugin, `import { createReadTool } from '../../../src/agent/sdk.ts';`).length);
});

test('MP06 value-only model executor can import its encoded data module but no arbitrary module',()=>{
 const runner='src/host/model-pack-runner.mjs';
 const data="await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);";
 assert.deepEqual(inspectSessionSource(runner,data),[]);
 for(const file of [runner,plugin]) {
  assert.ok(inspectSessionSource(file,'await import(modulePath);').length);
  assert.ok(inspectSessionSource(file,'await import(`file://${modulePath}`);').length);
 }
 assert.ok(inspectSessionSource(plugin,data).length);
 assert.deepEqual(inspectSessionSource('src/agent/model-pack-tools.ts',"import { defineTool } from './sdk.ts';"),[]);
 assert.ok(inspectSessionSource('src/agent/model-pack-tools.ts',"import { SessionManager } from './sdk.ts';").length);
});
