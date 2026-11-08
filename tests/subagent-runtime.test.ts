import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type ServerResponse } from 'node:http';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { ProjectAgent, type ProjectAgentOptions } from '../src/agent/project-runtime.ts';
import { createAgentSessionDomain } from '../src/host/agent-sessions.ts';

type RequestRecord = { body: any; authorization?: string; closedEarly: boolean; finished: boolean };
const contentText = (content: any): string => typeof content === 'string' ? content : Array.isArray(content) ? content.map(part => part.text ?? '').join('') : '';
const names = (body: any): string[] => (body.tools ?? []).map((tool: any) => tool.function?.name ?? tool.name);
const userText = (body: any): string => contentText(body.messages.filter((message: any) => message.role === 'user').at(-1)?.content);
const roleOf = (body: any): string | undefined => {
  const system = body.messages.filter((message: any) => message.role === 'system' || message.role === 'developer').map((message: any) => contentText(message.content)).join('\n');
  return system.includes('FIXTURE_ROLE_RESEARCHER') ? 'researcher' : system.includes('FIXTURE_ROLE_REVIEWER') ? 'reviewer' : undefined;
};
async function until(check: () => boolean, description: string, milliseconds = 8000) {
  const deadline = Date.now() + milliseconds;
  while (!check()) { assert.ok(Date.now() < deadline, description); await new Promise(resolve => setTimeout(resolve, 5)); }
}
function respond(response: ServerResponse, body: any, text?: string, tool?: { name: string; args: unknown; id?: string }, hold = false) {
  response.writeHead(200, { 'content-type': 'text/event-stream' });
  const send = (delta: unknown, finish: string | null = null) => response.write('data: ' + JSON.stringify({ id: 'subagent-fixture', object: 'chat.completion.chunk', created: 1, model: body.model, choices: [{ index: 0, delta, finish_reason: finish }] }) + '\n\n');
  send({ role: 'assistant', content: '' });
  if (hold) { send({ content: 'Synthetic child stream is waiting.' }); return; }
  if (tool) { send({ tool_calls: [{ index: 0, id: tool.id ?? randomUUID(), type: 'function', function: { name: tool.name, arguments: JSON.stringify(tool.args) } }] }); send({}, 'tool_calls'); }
  else { send({ content: text ?? 'SYNTHETIC_DONE' }); send({}, 'stop'); }
  response.end('data: [DONE]\n\n');
}

async function fixture(t: TestContext, managed = false) {
  const evidence = path.resolve('.local/task-agent-capabilities/runtime');
  await mkdir(evidence, { recursive: true });
  const root = await mkdtemp(path.join(evidence, 'subagent-'));
  const projectDirectory = path.join(root, 'project'), resourceRoot = path.join(root, 'resources');
  const work = path.join(projectDirectory, '020_clean'), roleRoot = path.join(resourceRoot, 'skills', 'fixture', 'agents');
  for (const directory of [path.join(projectDirectory, '010_draw'), work, path.join(projectDirectory, '060_reports'), roleRoot, path.join(root, 'skill-snapshots')]) await mkdir(directory, { recursive: true, mode: 0o700 });
  await writeFile(path.join(resourceRoot, 'settings.json'), JSON.stringify({ retry: { enabled: false } }));
  await writeFile(path.join(resourceRoot, 'skills', 'fixture', 'SKILL.md'), '---\nname: fixture\ndescription: Synthetic task delegation contract fixture.\n---\nDelegate to the bundled researcher and reviewer roles when useful.\n');
  await writeFile(path.join(roleRoot, 'researcher.md'), '---\nname: researcher\ndescription: Synthetic researcher with local tools.\ntools: [read, bash, write]\n---\nFIXTURE_ROLE_RESEARCHER\n');
  await writeFile(path.join(roleRoot, 'reviewer.md'), '---\nname: reviewer\ndescription: Synthetic reviewer with read-only local tools.\ntools: read\n---\nFIXTURE_ROLE_REVIEWER\n');
  const source = path.join(work, 'source.txt'), destination = path.join(work, 'child-output.txt');
  await writeFile(source, 'SYNTHETIC_INPUT_42');
  await writeFile(path.join(work, 'alpha.txt'), 'SYNTHETIC_ALPHA_ONLY');
  await writeFile(path.join(work, 'beta.txt'), 'SYNTHETIC_BETA_ONLY');
  const credentials = path.join(resourceRoot, 'auth.json');
  await writeFile(credentials, JSON.stringify({ synthetic: 'SYNTHETIC_CREDENTIAL_BYTES' }));
  const requests: RequestRecord[] = [], events: unknown[] = [];
  let dispatch: Record<string, unknown> = { agent: 'fixture/researcher', task: 'CHILD_SINGLE' };
  let nativeFile = '';
  const server = createServer(async (request, response) => {
    try {
      const chunks: Buffer[] = []; for await (const chunk of request) chunks.push(Buffer.from(chunk));
      const body = JSON.parse(Buffer.concat(chunks).toString()), record: RequestRecord = { body, authorization: request.headers.authorization, closedEarly: false, finished: false };
      requests.push(record); response.on('finish', () => { record.finished = true; }); response.on('close', () => { record.closedEarly = !record.finished; });
      const role = roleOf(body), prompt = userText(body), messages = body.messages;
      const latestUser = messages.findLastIndex((message: any) => message.role === 'user');
      const results = messages.slice(latestUser + 1).filter((message: any) => message.role === 'tool');
      if (!role) {
        if (results.length) respond(response, body, 'PARENT_RESULT\n' + results.map((message: any) => contentText(message.content)).join('\n'));
        else respond(response, body, undefined, { name: 'subagent', args: dispatch });
      } else if (prompt.includes('CHILD_PROVIDER_ERROR')) { response.writeHead(401, { 'content-type': 'application/json' }); response.end(JSON.stringify({ error: { message: 'Synthetic delegated provider failure', type: 'authentication_error' } })); }
      else if (prompt.includes('CHILD_EMPTY')) respond(response, body, '');
      else if (prompt.includes('CHILD_HOLD')) respond(response, body, undefined, undefined, true);
      else if (prompt.includes('CHILD_COLLIDE')) {
        if (results.length === 0) respond(response, body, undefined, { name: 'read', id: 'provider-reused-call-id', args: { path: path.join(work, prompt.includes('ALPHA') ? 'alpha.txt' : 'beta.txt') } });
        else respond(response, body, 'COLLISION_RESULT\n' + results.map((message: any) => contentText(message.content)).join('\n'));
      } else if (prompt.includes('CHILD_MALICIOUS_WRITE')) {
        if (results.length === 0) respond(response, body, undefined, { name: 'write', args: { path: destination, content: 'FORGED_REVIEWER_WRITE' } });
        else respond(response, body, 'MALICIOUS_WRITE_RESULT\n' + results.map((message: any) => contentText(message.content)).join('\n'));
      } else if (prompt.includes('CHILD_INDIRECT_WRITE')) {
        const actions = [
          { name: 'codemode', args: { code: `text(await tools.read({path:${JSON.stringify(source)}}));` } },
          { name: 'codemode', args: { code: `text(await tools.write({path:${JSON.stringify(destination)},content:'FORGED_INDIRECT_WRITE'}));` } },
        ];
        if (results.length < actions.length) respond(response, body, undefined, actions[results.length]);
        else respond(response, body, 'INDIRECT_RESULTS\n' + results.map((message: any) => contentText(message.content)).join('\n'));
      } else if (prompt.includes('CHILD_FORBIDDEN')) {
        const actions = [{ name: 'read', args: { path: credentials } }, { name: 'read', args: { path: nativeFile } }, { name: 'write', args: { path: nativeFile, content: 'FORGED_NATIVE' } }, { name: 'write', args: { path: path.join(root, 'outside.txt'), content: 'FORGED_OUTSIDE' } }];
        if (results.length < actions.length) respond(response, body, undefined, actions[results.length]);
        else respond(response, body, 'FORBIDDEN_RESULTS\n' + results.map((message: any) => contentText(message.content)).join('\n'));
      } else if (prompt.includes('CHILD_LONG_BASH')) {
        if (results.length === 0) respond(response, body, undefined, { name: 'bash', args: { command: `printf '%s' "$$" > ${JSON.stringify(path.join(work, 'owned-bash.pid'))}; sleep 300` } });
        else respond(response, body, 'LONG_BASH_WAS_INTERRUPTED');
      } else if (prompt.includes('CHILD_LOST_EXECUTION')) {
        if (results.length === 0) respond(response, body, undefined, { name: 'bash', args: { command: 'kill -KILL "$PPID"' } });
        else respond(response, body, 'SYNTHETIC_MODEL_CLAIMS_SUCCESS_AFTER_EXECUTOR_LOSS');
      }
      else if (prompt.includes('CHILD_FILES')) {
        const actions = [{ name: 'read', args: { path: source } }, { name: 'bash', args: { command: "printf 'SYNTHETIC_BASH_42'" } }, { name: 'write', args: { path: destination, content: 'SYNTHETIC_WRITE_42' } }];
        if (results.length < actions.length) respond(response, body, undefined, actions[results.length]);
        else respond(response, body, 'CHILD_FILES_DONE\n' + results.map((message: any) => contentText(message.content)).join('\n'));
      } else if (prompt.includes('CHAIN_REVIEW')) respond(response, body, 'REVIEWED_CHAIN_SOURCE');
      else if (prompt.includes('CHAIN_SOURCE')) respond(response, body, 'CHAIN_SOURCE_RESULT');
      else if (prompt.includes('CHILD_SECRET')) respond(response, body, 'Synthetic accidental key: synthetic-subagent-only-key');
      else respond(response, body, `ROLE=${role};TASK=${prompt};USERS=${messages.filter((message: any) => message.role === 'user').length}`);
    } catch { response.writeHead(500); response.end('synthetic fixture failure'); }
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); assert.ok(address && typeof address !== 'string');
  const options: ProjectAgentOptions = { projectId: 'synthetic-subagent-project', projectDirectory, resourceRoot, sessionDirectory: path.join(root, 'sessions'), codeRoot: process.cwd(), managementPorts: [], configuration: { id: 'subagent-fixture', revision: 1, name: 'Synthetic delegation fixture', provider: 'synthetic', api: 'openai-completions', baseUrl: `http://127.0.0.1:${address.port}/v1`, model: 'synthetic-subagent-model', apiKey: 'synthetic-subagent-only-key' }, ...(managed ? { protectedExecution: { id: randomUUID(), profile: 'ordinary', cwd: work, writableRoot: work, writeRoots: [path.join(projectDirectory, '060_reports')], readRoots: [], skillRoot: path.join(root, 'skill-snapshots') } } : {}) };
  const agents: ProjectAgent[] = [];
  const create = (overrides: Partial<ProjectAgentOptions> = {}) => { const agent = new ProjectAgent({ ...options, ...overrides }); agents.push(agent); agent.subscribe(event => events.push(event)); return agent; };
  t.after(async () => { for (const agent of agents) await agent.close(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); await writeFile(path.join(root, 'requests.json'), JSON.stringify(requests, null, 2)); });
  return { create, options, root, work, source, destination, credentials, requests, events, dispatch: (value: Record<string, unknown>) => { dispatch = value; }, native: (value: string) => { nativeFile = value; } };
}

test('task SDK delegates single, parallel and chain with fresh role contexts and the frozen parent model', { timeout: 45_000 }, async t => {
  const f = await fixture(t), agent = f.create();
  const snapshot = await agent.open();
  assert.ok(snapshot.tools.includes('subagent'), 'ordinary project tasks expose the actual delegation tool');
  for (const [mode, input] of [
    ['single', { agent: 'fixture/researcher', task: 'CHILD_SINGLE' }],
    ['parallel', { tasks: [{ agent: 'fixture/researcher', task: 'CHILD_ALPHA' }, { agent: 'fixture/reviewer', task: 'CHILD_BETA' }] }],
    ['chain', { chain: [{ agent: 'fixture/researcher', task: 'CHAIN_SOURCE' }, { agent: 'fixture/reviewer', task: 'CHAIN_REVIEW {previous}' }] }],
  ] as const) {
    f.dispatch(input);
    const result = await agent.start(`PARENT_PRIVATE_${mode}`, randomUUID()).completion;
    assert.equal(result.outcome, 'completed', JSON.stringify(result));
    assert.match(result.text, mode === 'chain' ? /REVIEWED_CHAIN_SOURCE/ : /ROLE=researcher/);
  }
  const children = f.requests.filter(record => roleOf(record.body));
  assert.equal(children.length, 5, 'each delegation used a real SDK request');
  for (const record of f.requests) { assert.equal(record.body.model, 'synthetic-subagent-model'); assert.equal(record.authorization, 'Bearer synthetic-subagent-only-key'); }
  for (const record of children) {
    assert.equal(record.body.messages.filter((message: any) => message.role === 'user').length, 1, 'delegated contexts begin fresh');
    assert.doesNotMatch(JSON.stringify(record.body.messages), /PARENT_PRIVATE_/, 'parent conversation is not copied to children');
    assert.ok(!names(record.body).includes('subagent'), 'children cannot recursively create untracked sessions');
  }
  const reviewer = children.filter(record => roleOf(record.body) === 'reviewer');
  for (const record of reviewer) { assert.deepEqual(names(record.body), ['read']); }
  assert.match(userText(reviewer.at(-1)!.body), /CHAIN_SOURCE_RESULT/, 'chain explicitly passes only prior output');
  assert.doesNotMatch(userText(children.find(record => userText(record.body).includes('CHILD_ALPHA'))!.body), /CHILD_BETA/);
});

for (const managed of [false, true]) test(`delegated tools execute actual read/bash/write under ${managed ? 'ordinary managed' : 'ordinary'} task policy`, { skip: managed && process.platform !== 'darwin', timeout: 45_000 }, async t => {
  const f = await fixture(t, managed), agent = f.create();
  await agent.open(); f.dispatch({ agent: 'fixture/researcher', task: 'CHILD_FILES' });
  const result = await agent.start('PARENT_FILE_DELEGATION', randomUUID()).completion;
  assert.equal(result.outcome, 'completed', JSON.stringify(result));
  assert.match(result.text, /CHILD_FILES_DONE/); assert.match(result.text, /SYNTHETIC_INPUT_42/); assert.match(result.text, /SYNTHETIC_BASH_42/);
  assert.equal(await readFile(f.destination, 'utf8'), 'SYNTHETIC_WRITE_42');
  assert.equal(await readFile(f.source, 'utf8'), 'SYNTHETIC_INPUT_42');
  if (managed) await agent.drain();
});

test('parent cancellation aborts the actual child stream and reopening preserves the parent history without replay', { timeout: 45_000 }, async t => {
  const f = await fixture(t), agent = f.create(); await agent.open();
  f.dispatch({ tasks: [{ agent: 'fixture/researcher', task: 'CHILD_HOLD' }, { agent: 'fixture/reviewer', task: 'CHILD_HOLD' }] });
  const running = agent.start('PARENT_CANCEL', 'parent-cancel');
  await running.accepted;
  await until(() => f.requests.filter(record => roleOf(record.body) && userText(record.body).includes('CHILD_HOLD')).length === 2, 'both child streams must actually be in flight');
  await agent.stop();
  assert.equal((await running.completion).outcome, 'cancelled');
  await until(() => f.requests.filter(record => roleOf(record.body)).every(record => record.closedEarly), 'parent stop closes every child model transport');
  assert.equal(f.events.filter((event: any) => event.type === 'run.settled' && event.requestId === 'parent-cancel').length, 1);
  const snapshot = await agent.snapshot(); assert.ok(snapshot.sessionFile);
  await agent.close(); const bytes = await readFile(snapshot.sessionFile), requestCount = f.requests.length;
  const reopened = f.create({ sessionFile: snapshot.sessionFile }); const after = await reopened.open();
  assert.equal(after.sessionId, snapshot.sessionId); assert.deepEqual(after.lastRun, snapshot.lastRun);
  assert.deepEqual(await readFile(snapshot.sessionFile), bytes, 'opening does not rewrite the parent native evidence');
  assert.equal(f.requests.length, requestCount, 'opening does not replay cancelled child work');
  f.dispatch({ agent: 'fixture/researcher', task: 'CHILD_AFTER_REOPEN' });
  const next = await reopened.start('PARENT_NEW_EXPLICIT_TURN', randomUUID()).completion;
  assert.equal(next.outcome, 'completed'); assert.match(next.text, /CHILD_AFTER_REOPEN/);
});

test('delegated output is redacted before parent IPC and native persistence', { timeout: 30_000 }, async t => {
  const f = await fixture(t), agent = f.create(); await agent.open();
  f.dispatch({ agent: 'fixture/researcher', task: 'CHILD_SECRET' });
  const result = await agent.start('PARENT_REDACTION', randomUUID()).completion;
  assert.equal(result.outcome, 'completed');
  assert.equal(f.requests.filter(record => roleOf(record.body)).length, 1, 'redaction must cover an actual delegated reply');
  const snapshot = await agent.snapshot(); assert.ok(snapshot.sessionFile);
  for (const value of [JSON.stringify(f.events), JSON.stringify(snapshot), await readFile(snapshot.sessionFile, 'utf8')]) assert.ok(!value.includes('synthetic-subagent-only-key'), 'child output must not bypass the parent secret masker');
});

test('business workspaces, closed text resources and protected execution exclude the delegation tool', { timeout: 45_000 }, async t => {
  const f = await fixture(t);
  for (const mode of ['workspace', 'fixed-draft', 'text-only', ...(process.platform === 'darwin' ? ['protected'] : [])]) {
    const agent = f.create({ sessionDirectory: path.join(f.root, 'excluded', mode), ...(mode === 'protected' ? { protectedExecution: { id: randomUUID(), profile: 'protected', cwd: f.work, writableRoot: f.work, readRoots: [] } } : { workspace: { cwd: f.work, systemPrompt: ['Synthetic excluded resource.'], ...(mode === 'workspace' ? {} : { defaultTools: [], capabilityPolicy: mode as 'fixed-draft' | 'text-only' }) } }) });
    const snapshot = await agent.open();
    assert.ok(!snapshot.tools.includes('subagent'), `${mode} cannot acquire task delegation through default tools`);
    if (mode === 'fixed-draft' || mode === 'text-only') assert.deepEqual(snapshot.tools, []);
    await agent.close();
  }
  assert.equal(f.requests.length, 0, 'capability inspection does not call the model');
});

test('a role with read-only tools cannot execute a malicious write tool call', { timeout: 30_000 }, async t => {
  const f = await fixture(t), agent = f.create(); await agent.open();
  f.dispatch({ agent: 'fixture/reviewer', task: 'CHILD_MALICIOUS_WRITE' });
  const result = await agent.start('PARENT_READ_ONLY_REVIEW', randomUUID()).completion;
  assert.equal(result.outcome, 'completed'); assert.match(result.text, /Tool write not found/);
  await assert.rejects(readFile(f.destination), { code: 'ENOENT' });
  assert.equal(f.requests.filter(record => roleOf(record.body) === 'reviewer').length, 2, 'the actual child attempted the forbidden call and received its refusal');
});

test('a failed or empty child model result remains failed and stops the chain before the next role', { timeout: 30_000 }, async t => {
  const f = await fixture(t), agent = f.create(); await agent.open();
  for (const task of ['CHILD_PROVIDER_ERROR', 'CHILD_EMPTY']) {
    const before = f.requests.length;
    f.dispatch({ chain: [{ agent: 'fixture/researcher', task }, { agent: 'fixture/reviewer', task: 'MUST_NOT_START' }] });
    const result = await agent.start(`PARENT_FAILURE_${task}`, randomUUID()).completion;
    assert.equal(result.outcome, 'completed', 'the parent can explain its failed delegation without replaying it');
    assert.match(result.text, /"outcome":"failed"/, 'child success cannot be invented from a failed or empty response');
    const children = f.requests.slice(before).filter(record => roleOf(record.body));
    assert.equal(children.length, 1); assert.equal(roleOf(children[0].body), 'researcher');
  }
});

test('parallel managed children may reuse a supplier tool-call id without colliding or mixing results', { skip: process.platform !== 'darwin', timeout: 40_000 }, async t => {
  const f = await fixture(t, true), agent = f.create(); await agent.open();
  f.dispatch({ tasks: [{ agent: 'fixture/researcher', task: 'CHILD_COLLIDE_ALPHA' }, { agent: 'fixture/researcher', task: 'CHILD_COLLIDE_BETA' }] });
  const result = await agent.start('PARENT_COLLISION_CHECK', randomUUID()).completion;
  assert.equal(result.outcome, 'completed'); assert.doesNotMatch(result.text, /protected_duplicate_tool_call/);
  const data = JSON.parse(result.text.slice('PARENT_RESULT\n'.length));
  assert.equal(data.results.length, 2);
  assert.deepEqual(data.results.map((child: any) => child.outcome), ['completed', 'completed']);
  assert.match(data.results[0].text, /SYNTHETIC_ALPHA_ONLY/); assert.doesNotMatch(data.results[0].text, /SYNTHETIC_BETA_ONLY/);
  assert.match(data.results[1].text, /SYNTHETIC_BETA_ONLY/); assert.doesNotMatch(data.results[1].text, /SYNTHETIC_ALPHA_ONLY/);
  await agent.drain();
});

test('managed child tools cannot read credentials or native history or write beyond their scope', { skip: process.platform !== 'darwin', timeout: 40_000 }, async t => {
  const f = await fixture(t, true), agent = f.create(), opened = await agent.open();
  assert.ok(opened.sessionFile); f.native(opened.sessionFile);
  const nativeBefore = await readFile(opened.sessionFile), credentialsBefore = await readFile(f.credentials);
  f.dispatch({ agent: 'fixture/researcher', task: 'CHILD_FORBIDDEN' });
  const result = await agent.start('PARENT_BOUNDARY_CHECK', randomUUID()).completion;
  assert.match(result.text, /FORBIDDEN_RESULTS/); assert.doesNotMatch(result.text, /SYNTHETIC_CREDENTIAL_BYTES/);
  const childRequests = f.requests.filter(record => roleOf(record.body));
  const replies = childRequests.at(-1)!.body.messages.filter((message: any) => message.role === 'tool');
  assert.equal(replies.length, 4, 'all four prohibited operations reached the actual protected executor');
  for (const reply of replies) assert.match(contentText(reply.content), /denied|EPERM|EACCES|not permitted|Operation not permitted/i);
  assert.deepEqual(await readFile(f.credentials), credentialsBefore);
  const nativeAfter = await readFile(opened.sessionFile);
  assert.deepEqual(nativeAfter.subarray(0, nativeBefore.length), nativeBefore); assert.ok(!nativeAfter.toString().includes('FORGED_NATIVE'));
  await assert.rejects(readFile(path.join(f.root, 'outside.txt')), { code: 'ENOENT' });
  await agent.drain();
});

test('managed parent stop reclaims a child bash process before closing its execution journal', { skip: process.platform !== 'darwin', timeout: 40_000 }, async t => {
  const f = await fixture(t, true), agent = f.create(), opened = await agent.open(); assert.ok(opened.sessionFile);
  f.dispatch({ agent: 'fixture/researcher', task: 'CHILD_LONG_BASH' });
  const running = agent.start('PARENT_LONG_BASH', randomUUID()); await running.accepted;
  const pidFile = path.join(f.work, 'owned-bash.pid');
  let pid = 0;
  const deadline = Date.now() + 8000;
  while (!pid) { assert.ok(Date.now() < deadline, 'delegated bash must actually be running before cancellation'); try { pid = Number(await readFile(pidFile, 'utf8')); } catch {} if (!pid) await new Promise(resolve => setTimeout(resolve, 10)); }
  assert.ok(Number.isInteger(pid) && pid > 0); process.kill(pid, 0);
  await agent.stop({ retryFailed: false });
  assert.equal((await running.completion).outcome, 'cancelled'); assert.equal(agent.alive, false);
  assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' }, 'stop returns only after the owned child execution has ended');
  const native = (await readFile(opened.sessionFile, 'utf8')).trim().split('\n').map(line => JSON.parse(line));
  assert.equal(native.filter(entry => entry.customType === 'optracall.execution').at(-1)?.data.phase, 'closed');
  assert.equal(native.filter(entry => entry.customType === 'optracall.run' && entry.data.phase === 'settled').at(-1)?.data.outcome, 'cancelled');
});

test('a lost managed child execution result remains failed even after child and parent model success text', { skip: process.platform !== 'darwin', timeout: 40_000 }, async t => {
  const f = await fixture(t, true), agent = f.create(), opened = await agent.open(); assert.ok(opened.sessionFile);
  f.dispatch({ agent: 'fixture/researcher', task: 'CHILD_LOST_EXECUTION' });
  const result = await agent.start('PARENT_LOST_CHILD', randomUUID()).completion;
  assert.equal(result.outcome, 'failed', 'successful model prose cannot prove a missing execution receipt');
  assert.match(result.text, /"outcome":"failed"/, 'the child receipt also preserves failure');
  const native = (await readFile(opened.sessionFile, 'utf8')).trim().split('\n').map(line => JSON.parse(line));
  assert.equal(native.filter(entry => entry.customType === 'optracall.run' && entry.data.phase === 'settled').at(-1)?.data.outcome, 'failed');
  await assert.rejects(agent.drain());
  await agent.close({ retryFailed: false });
});

for (const managed of [false, true]) test(`a narrowed role retains codemode read but cannot invoke omitted write indirectly in ${managed ? 'managed' : 'unmanaged'} execution`, { skip: managed && process.platform !== 'darwin', timeout: 40_000 }, async t => {
  const f = await fixture(t, managed);
  await writeFile(path.join(f.options.resourceRoot, 'skills', 'fixture', 'agents', 'reviewer.md'), '---\nname: reviewer\ndescription: Synthetic read-only codemode role.\ntools: [read, codemode, tool_search]\n---\nFIXTURE_ROLE_REVIEWER\n');
  const agent = f.create(); await agent.open(); f.dispatch({ agent: 'fixture/reviewer', task: 'CHILD_INDIRECT_WRITE' });
  const result = await agent.start('PARENT_INDIRECT_CAPABILITY_CHECK', randomUUID()).completion;
  assert.equal(result.outcome, 'completed'); assert.match(result.text, /SYNTHETIC_INPUT_42/, 'the allowed codemode read remains functional');
  await assert.rejects(readFile(f.destination), { code: 'ENOENT' }, 'codemode cannot restore a tool the role omitted');
  const children = f.requests.filter(record => roleOf(record.body) === 'reviewer');
  const replies = children.at(-1)!.body.messages.filter((message: any) => message.role === 'tool');
  assert.equal(replies.length, 2, 'the actual child attempted both indirect calls');
  assert.match(contentText(replies[1].content), /write|not.*function|unavailable|unknown/i);
  assert.ok(!names(children[0].body).includes('write'));
  if (managed) await agent.drain();
});

test('ordinary public session owners retain failed child disposal until an explicit successful cleanup retry', { timeout: 40_000 }, async t => {
  const f = await fixture(t), codeRoot = path.join(f.root, 'fault-driver'), attemptsFile = path.join(f.root, 'child-dispose-attempts.jsonl'), permitFile = path.join(f.root, 'permit-child-dispose');
  await mkdir(path.join(codeRoot, 'scripts'), { recursive: true });
  const repository = process.cwd();
  await writeFile(path.join(codeRoot, 'scripts', 'project-entry.mjs'), `
    import { configureHttpTransport } from ${JSON.stringify(pathToFileURL(path.join(repository, 'scripts/http-transport.mjs')).href)};
    import { AgentSessionRuntime } from ${JSON.stringify(pathToFileURL(path.join(repository, 'src/agent/sdk.ts')).href)};
    import { appendFileSync, existsSync } from 'node:fs';
    const original = AgentSessionRuntime.prototype.dispose;
    AgentSessionRuntime.prototype.dispose = async function () {
      if (!this.session.sessionManager.getSessionFile()) {
        appendFileSync(${JSON.stringify(attemptsFile)}, JSON.stringify({ permitted: existsSync(${JSON.stringify(permitFile)}) }) + '\\n');
        if (!existsSync(${JSON.stringify(permitFile)})) throw new Error('synthetic_child_dispose_failure');
      }
      return original.call(this);
    };
    const transport = configureHttpTransport();
    process.prependListener('message', message => { if (message.method === 'open') message.input.codeRoot = ${JSON.stringify(repository)}; });
    const { runProjectSession } = await import(${JSON.stringify(pathToFileURL(path.join(repository, 'src/agent/project-session.ts')).href)});
    await runProjectSession(transport);
  `);
  const { configuration, ...baseOptions } = f.options;
  const domain = createAgentSessionDomain<string>({ name: 'synthetic-child-disposal', profile: { key: owner => owner, configuration: () => configuration, agentOptions: () => ({ ...baseOptions, codeRoot }) }, configurationSnapshot: () => configuration, mutate: async operation => operation(), isClosing: () => false });
  const ref = domain.ref('synthetic-project/task');
  t.after(async () => { await writeFile(permitFile, 'explicit test cleanup'); await domain.close(ref); });
  f.dispatch({ agent: 'fixture/researcher', task: 'CHILD_SINGLE' });
  const first = domain.start(ref, { text: 'FIRST_EXPLICIT_TURN', requestId: randomUUID() }); await first.accepted;
  await assert.rejects(first.completion, 'a failed attached-resource cleanup is exposed to the public operation');
  const attempts = async () => (await readFile(attemptsFile, 'utf8')).trim().split('\n').map(line => JSON.parse(line));
  assert.equal((await attempts()).length, 1, 'the failed dispose is attempted only once during automatic retirement');
  assert.equal(domain.busy(ref), true); assert.equal(domain.executionState(ref).mode, 'unknown');
  const requestCount = f.requests.length;
  assert.throws(() => domain.start(ref, { text: 'MUST_NOT_DISPATCH', requestId: randomUUID() }), { code: 'session_busy' });
  await domain.read(ref);
  await assert.rejects(domain.close(ref, { retryFailed: false }));
  await assert.rejects(domain.close(ref, { retryFailed: false }));
  assert.equal(domain.busy(ref), true); assert.equal(domain.executionState(ref).mode, 'unknown');
  assert.equal((await attempts()).length, 1, 'read and close(false) cannot silently retry an unknown child shutdown');
  assert.equal(f.requests.length, requestCount, 'quarantined owners cannot issue another parent or child model request');
  await writeFile(permitFile, 'explicit cleanup retry may now succeed');
  await domain.close(ref);
  assert.deepEqual(await attempts(), [{ permitted: false }, { permitted: true }]);
  assert.equal(domain.busy(ref), false); assert.equal(domain.executionState(ref).mode, 'none');
  f.dispatch({ agent: 'fixture/researcher', task: 'CHILD_AFTER_RECOVERY' });
  const next = await domain.start(ref, { text: 'NEW_EXPLICIT_TURN_AFTER_CLEANUP', requestId: randomUUID() }).completion;
  assert.equal(next.outcome, 'completed'); assert.match(next.text, /CHILD_AFTER_RECOVERY/); assert.equal(domain.busy(ref), false);
});

test('ordinary child model failure remains a result and does not quarantine a clean public owner', { timeout: 30_000 }, async t => {
  const f = await fixture(t), { configuration, ...baseOptions } = f.options;
  const domain = createAgentSessionDomain<string>({ name: 'synthetic-child-model-failure', profile: { key: owner => owner, configuration: () => configuration, agentOptions: () => baseOptions }, configurationSnapshot: () => configuration, mutate: async operation => operation(), isClosing: () => false });
  const ref = domain.ref('synthetic-project/model-failure'); t.after(() => domain.close(ref));
  f.dispatch({ agent: 'fixture/researcher', task: 'CHILD_PROVIDER_ERROR' });
  const failedChild = await domain.start(ref, { text: 'PARENT_EXPLAINS_CHILD_FAILURE', requestId: randomUUID() }).completion;
  assert.equal(failedChild.outcome, 'completed'); assert.match(failedChild.text, /"outcome":"failed"/);
  assert.equal(domain.busy(ref), false); assert.equal(domain.executionState(ref).mode, 'unmanaged');
  f.dispatch({ agent: 'fixture/researcher', task: 'CHILD_EXPLICIT_RETRY' });
  const next = await domain.start(ref, { text: 'PARENT_NEW_EXPLICIT_ATTEMPT', requestId: randomUUID() }).completion;
  assert.equal(next.outcome, 'completed'); assert.match(next.text, /CHILD_EXPLICIT_RETRY/); assert.equal(domain.busy(ref), false);
});
