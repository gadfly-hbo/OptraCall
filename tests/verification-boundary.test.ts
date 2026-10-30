import test from 'node:test';
import assert from 'node:assert/strict';
import { inspectSessionSource } from '../scripts/check-agent-session-boundary.mjs';

test('SV06: the reviewed verification Host adapter registers a shared domain but cannot create an SDK runtime', () => {
  assert.deepEqual(inspectSessionSource('src/host/verification-sessions.ts', "import { createAgentSessionDomain } from './agent-sessions.ts';"), []);
  assert.ok(inspectSessionSource('extensions/business-plugins/verification/index.ts', "import { createAgentSessionDomain } from '../../../src/host/agent-sessions.ts';").length);
  assert.ok(inspectSessionSource('src/host/verification-sessions.ts', "import { ProjectAgent } from '../agent/project-runtime.ts'; new ProjectAgent({});").length);
});
