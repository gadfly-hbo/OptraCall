import test from 'node:test';
import assert from 'node:assert/strict';
import { inspectSessionSource } from '../scripts/check-agent-session-boundary.mjs';

const plugin = 'extensions/business-plugins/example/session.ts';

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
