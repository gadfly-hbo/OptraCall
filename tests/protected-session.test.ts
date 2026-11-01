import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { ProjectAgent } from '../src/agent/project-runtime.ts';
import { createProtectedExecutionScope } from '../src/agent/protected-tools.ts';

test('real SDK and native terminal receipt retain failed execution when a model replies after a lost tool result', { skip: process.platform !== 'darwin', timeout: 30_000 }, async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'optracall-protected-missing-'));
  const projectDirectory = path.join(root, 'project'), sessionDirectory = path.join(root, 'native'), resourceRoot = path.join(root, 'resources'), work = path.join(root, 'work');
  for (const dir of [path.join(projectDirectory, '020_clean'), path.join(projectDirectory, '060_reports'), sessionDirectory, resourceRoot, work]) await mkdir(dir, { recursive: true, mode: 0o700 });
  let requests = 0;
  const server = createServer(async (request, response) => {
    const chunks: Buffer[] = []; for await (const part of request) chunks.push(Buffer.from(part));
    const body = JSON.parse(Buffer.concat(chunks).toString()); requests++;
    response.writeHead(200, { 'Content-Type': 'text/event-stream' });
    const send = (delta: unknown, finish: string | null = null) => response.write('data: ' + JSON.stringify({ id: 'missing-result', object: 'chat.completion.chunk', created: 1, model: body.model, choices: [{ index: 0, delta, finish_reason: finish }] }) + '\n\n');
    send({ role: 'assistant', content: '' });
    if (requests === 1) { send({ tool_calls: [{ index: 0, id: 'lost-tool', type: 'function', function: { name: 'bash', arguments: JSON.stringify({ command: 'kill -KILL "$PPID"' }) } }] }); send({}, 'tool_calls'); }
    else { send({ content: 'Synthetic model final reply after the tool failed.' }); send({}, 'stop'); }
    response.end('data: [DONE]\n\n');
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise<void>(resolve => { server.close(() => resolve()); server.closeAllConnections(); }));
  const address = server.address(); assert.ok(address && typeof address !== 'string');
  const agent = new ProjectAgent({ projectId: randomUUID(), projectDirectory, sessionDirectory, resourceRoot, codeRoot: process.cwd(), managementPorts: [], protectedExecution: { id: 'missing-result-sdk', cwd: work, writableRoot: work, readRoots: [] }, configuration: { id: randomUUID(), revision: 1, name: 'missing result', provider: 'openai-compatible', api: 'openai-completions', baseUrl: `http://127.0.0.1:${address.port}/v1`, model: 'synthetic', apiKey: 'synthetic-key' } });
  t.after(() => agent.close());
  await agent.open();
  const run = agent.start('Exercise the synthetic missing tool result.', randomUUID()); await run.accepted;
  const result = await run.completion;
  assert.equal(result.outcome, 'failed', 'a model final reply cannot turn unknown execution into success');
  const snapshot = await agent.snapshot(); assert.ok(snapshot.sessionFile);
  const records = (await readFile(snapshot.sessionFile, 'utf8')).trim().split('\n').map(line => JSON.parse(line));
  assert.equal(records.filter(entry => entry.customType === 'optracall.run' && entry.data.phase === 'settled').at(-1)?.data.outcome, 'failed');
  assert.equal(requests, 2, 'the Host did not replay the tool or model turn');
  await assert.rejects(agent.drain(), error => error instanceof Error && error.message === 'sdk_operation_failed' && /protected_executor_failed|result_unknown/.test(String((error.cause as { message?: string })?.message)));
  await agent.close({ retryFailed: false });
});

test('protected real SDK session keeps its canonical history while tool execution is separated', { skip: process.platform !== 'darwin', timeout: 60_000 }, async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'optracall-protected-session-'));
  const projectDirectory = path.join(root, 'project'), sessionDirectory = path.join(root, 'native'), resourceRoot = path.join(root, 'resources'), work = path.join(root, 'work'), inputs = path.join(root, 'fixed'), skillRoot = path.join(root, 'readonly-skills');
  for (const dir of [path.join(projectDirectory, '020_clean'), path.join(projectDirectory, '060_reports'), sessionDirectory, resourceRoot, work, inputs, skillRoot]) await mkdir(dir, { recursive: true, mode: 0o700 });
  await writeFile(path.join(inputs, 'source.txt'), '40\n2\n');
  let nativeFile = '', skillLocation = '', requests = 0;
  const server = createServer(async (request, response) => {
    const chunks: Buffer[] = []; for await (const part of request) chunks.push(Buffer.from(part));
    const body = JSON.parse(Buffer.concat(chunks).toString()); requests++;
    response.writeHead(200, { 'Content-Type': 'text/event-stream' });
    const send = (delta: unknown, finish: string | null = null) => response.write('data: ' + JSON.stringify({ id: 'synthetic', object: 'chat.completion.chunk', created: 1, model: body.model, choices: [{ index: 0, delta, finish_reason: finish }] }) + '\n\n');
    send({ role: 'assistant', content: '' });
    if (requests === 2 || requests === 3) {
      const name = requests === 2 ? 'codemode' : 'write';
      if (requests === 2) skillLocation = body.messages.map((message: any) => typeof message.content === 'string' ? message.content : '').join('\n').match(/<name>protected-fixture<\/name>[\s\S]*?<location>([^<]+)<\/location>/)?.[1] ?? '/missing-skill/SKILL.md';
      const args = requests === 2 ? { code: `text(await tools.read({path:${JSON.stringify(skillLocation)}})); text(await tools.read({path:${JSON.stringify(path.join(path.dirname(skillLocation), 'attachment.txt'))}})); text(await tools.bash({command:"python3 -c 'print(6*7)'"}));` } : { path: nativeFile, content: 'FORGED_NATIVE_ONLY' };
      send({ tool_calls: [{ index: 0, id: 'synthetic-call-' + requests, type: 'function', function: { name, arguments: JSON.stringify(args) } }] }); send({}, 'tool_calls');
    } else { send({ content: requests === 1 ? 'original baseline' : 'checked 42; original retained' }); send({}, 'stop'); }
    response.write('data: [DONE]\n\n'); response.end();
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise<void>(resolve => { server.close(() => resolve()); server.closeAllConnections(); }));
  const address = server.address(); assert.ok(address && typeof address !== 'string');
  const options = { projectId: randomUUID(), projectDirectory, sessionDirectory, resourceRoot, codeRoot: process.cwd(), managementPorts: [], configuration: { id: randomUUID(), revision: 1, name: 'synthetic protection', provider: 'openai-compatible', api: 'openai-completions' as const, baseUrl: `http://127.0.0.1:${address.port}/v1`, model: 'protected-synthetic', apiKey: 'synthetic-key' } };
  const original = new ProjectAgent(options);
  await original.open(); const baseline = original.start('Initial synthetic baseline.', randomUUID()); await baseline.accepted; await baseline.completion;
  const first = await original.snapshot(); assert.ok(first.sessionFile); nativeFile = first.sessionFile;
  await original.close();
  const prefix = await readFile(nativeFile);
  await mkdir(path.join(resourceRoot, 'extensions'), { mode: 0o700 });
  const escaped = path.join(root, 'untrusted-extension-ran.txt');
  await writeFile(path.join(resourceRoot, 'extensions', 'untrusted.ts'), `import {writeFileSync} from 'node:fs'; writeFileSync(${JSON.stringify(escaped)},'BAD'); export default ()=>{};`);
  const sourceSkill = path.join(resourceRoot, 'skills', 'protected-fixture'); await mkdir(sourceSkill, { recursive: true, mode: 0o700 });
  await writeFile(path.join(sourceSkill, 'SKILL.md'), '---\nname: protected-fixture\ndescription: Synthetic generic skill resource transport check.\n---\nSKILL_FULL_BODY_SYNTHETIC\nAttachment: attachment.txt\n');
  await writeFile(path.join(sourceSkill, 'attachment.txt'), 'SKILL_ATTACHMENT_SYNTHETIC');
  const scope = await createProtectedExecutionScope({ id: 'session-test', cwd: work, writableRoot: work, readRoots: [inputs], skillRoot });
  const protectedAgent = new ProjectAgent({ ...options, sessionFile: nativeFile, protectedExecution: scope });
  t.after(() => protectedAgent.close());
  const opened = await protectedAgent.open();
  assert.equal(opened.sessionId, first.sessionId); assert.equal(opened.sessionFile, nativeFile);
  assert.equal(opened.capabilities.mcp, false); assert.equal(opened.capabilities.extensions, false);
  assert.ok(opened.tools.includes('bash') && opened.tools.includes('codemode'));
  const openedExecution = (await readFile(nativeFile, 'utf8')).trim().split('\n').map(line => JSON.parse(line)).filter(entry => entry.type === 'custom' && entry.customType === 'optracall.execution');
  assert.equal(openedExecution.at(-1)?.data.phase, 'opened');
  assert.equal(openedExecution.at(-1)?.data.sessionId, first.sessionId);
  await assert.rejects(readFile(escaped), /ENOENT/);
  const run = protectedAgent.start('Run the synthetic tool check.', randomUUID()); await run.accepted;
  const result = await run.completion; assert.equal(result.outcome, 'completed', JSON.stringify(result)); assert.match(result.text, /checked 42/);
  await protectedAgent.close();
  const after = await readFile(nativeFile); assert.ok(after.subarray(0, prefix.length).equals(prefix));
  const entries = after.toString().trim().split('\n').map(line => JSON.parse(line));
  const execution = entries.filter(entry => entry.type === 'custom' && entry.customType === 'optracall.execution');
  assert.equal(execution.at(-1)?.data.phase, 'closed');
  assert.equal(execution.at(-1)?.data.executionId, openedExecution.at(-1)?.data.executionId);
  assert.equal(entries[0].id, first.sessionId);
  assert.equal(entries[0].cwd, path.join(projectDirectory, '020_clean'));
  const toolResults = entries.filter(entry => entry.type === 'message' && entry.message.role === 'toolResult');
  assert.ok(toolResults.some(entry => JSON.stringify(entry.message).includes('42')), JSON.stringify(toolResults));
  assert.ok(skillLocation.startsWith(scope.skillRoot! + path.sep), skillLocation);
  assert.ok(toolResults.some(entry => JSON.stringify(entry.message).includes('SKILL_FULL_BODY_SYNTHETIC')), JSON.stringify(toolResults));
  assert.ok(toolResults.some(entry => JSON.stringify(entry.message).includes('SKILL_ATTACHMENT_SYNTHETIC')), JSON.stringify(toolResults));
  assert.ok(toolResults.some(entry => /EPERM|not permitted|Permission/.test(JSON.stringify(entry.message))));
  assert.equal(entries.some(entry => entry.type === 'message' && entry.message.role === 'assistant' && entry.message.content.some((part: any) => part.type === 'text' && part.text === 'FORGED_NATIVE_ONLY')), false);
  assert.equal(requests, 4);
});

test('managed ordinary SDK keeps calculation tools and native commands, journals its actual closure and resumes the same canonical in protected mode', { skip: process.platform !== 'darwin', timeout: 90_000 }, async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'optracall-managed-ordinary-sdk-'));
  const projectDirectory = path.join(root, 'project'), native = path.join(root, 'native'), resources = path.join(root, 'resources');
  const clean = path.join(projectDirectory, '020_clean'), reports = path.join(projectDirectory, '060_reports');
  const privateRoot = path.join(root, 'ordinary-execution'), skills = path.join(root, 'skills');
  for (const directory of [path.join(projectDirectory, '010_draw'), clean, reports, native, resources, privateRoot, skills]) await mkdir(directory, { recursive: true, mode: 0o700 });
  // A small synthetic conversation must leave an older segment for the real
  // native /compact command; these are fixture-only SDK settings.
  await writeFile(path.join(resources, 'settings.json'), JSON.stringify({ compaction: { keepRecentTokens: 128, reserveTokens: 1024 } }));
  await writeFile(path.join(clean, 'source.txt'), '40\n2\n');
  const escaped = path.join(root, 'extension-executed.txt'); await mkdir(path.join(resources, 'extensions'));
  await writeFile(path.join(resources, 'extensions', 'untrusted.ts'), `import {writeFileSync} from 'node:fs'; writeFileSync(${JSON.stringify(escaped)}, 'BAD'); export default ()=>{};`);
  const requests: any[] = [];
  const server = createServer(async (request, response) => {
    const parts: Buffer[] = []; for await (const part of request) parts.push(Buffer.from(part));
    const body = JSON.parse(Buffer.concat(parts).toString()); requests.push(body);
    response.writeHead(200, { 'Content-Type': 'text/event-stream' });
    const send = (delta: unknown, finish: string | null = null) => response.write('data: ' + JSON.stringify({ id: 'managed-synthetic', object: 'chat.completion.chunk', created: 1, model: body.model, choices: [{ index: 0, delta, finish_reason: finish }] }) + '\n\n');
    send({ role: 'assistant', content: '' });
    if (requests.length === 1) {
      const command = "python3 - <<'PY'\nfrom pathlib import Path\nv=sum(map(int,Path('source.txt').read_text().split()))\nPath('calculation.txt').write_text(str(v))\nPath(" + JSON.stringify(path.join(reports, 'initial.md')) + ").write_text('# synthetic report\\n'+str(v))\nprint(v)\nPY";
      const background = "python3 -c 'import time; from pathlib import Path; p=Path(\"background.txt\"); i=0\nwhile True:\n i+=1; p.write_text(str(i)); time.sleep(.03)' >/dev/null 2>&1 & echo background-started";
      const args = { code: `text(await tools.bash({command:${JSON.stringify(command)}})); text(await tools.bash({command:${JSON.stringify(background)}}));` };
      send({ tool_calls: [{ index: 0, id: 'managed-calculation', type: 'function', function: { name: 'codemode', arguments: JSON.stringify(args) } }] }); send({}, 'tool_calls');
    } else if (requests.length === 3) {
      const args = { path: path.join(clean, 'background.txt') };
      send({ tool_calls: [{ index: 0, id: 'managed-background-read', type: 'function', function: { name: 'read', arguments: JSON.stringify(args) } }] }); send({}, 'tool_calls');
    } else { send({ content: requests.length === 2 ? 'Synthetic calculation is 42.' : 'Synthetic context summary or continuation; original materials retained.' }); send({}, 'stop'); }
    response.write('data: [DONE]\n\n'); response.end();
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise<void>(resolve => { server.close(() => resolve()); server.closeAllConnections(); }));
  const address = server.address(); assert.ok(address && typeof address !== 'string');
  const configuration = { id: randomUUID(), revision: 1, name: 'managed synthetic', provider: 'openai-compatible', api: 'openai-completions' as const, baseUrl: `http://127.0.0.1:${address.port}/v1`, model: 'managed-synthetic', apiKey: 'synthetic-key' };
  const options = { projectId: randomUUID(), projectDirectory, sessionDirectory: native, resourceRoot: resources, codeRoot: process.cwd(), managementPorts: [], configuration };
  const ordinaryScope = await createProtectedExecutionScope({ id: 'ordinary-native-test', profile: 'ordinary', cwd: clean, writableRoot: privateRoot, writeRoots: [clean, reports], readRoots: [projectDirectory], skillRoot: skills });
  const ordinary = new ProjectAgent({ ...options, protectedExecution: ordinaryScope }); t.after(() => ordinary.close());
  const opened = await ordinary.open(); assert.equal(ordinary.executionMode, 'ordinary');
  assert.equal(opened.capabilities.extensions, false); assert.equal(opened.capabilities.mcp, false); assert.equal(opened.capabilities.sessionTree, true);
  assert.ok(opened.sessionFile, 'managed open materializes its SDK lifecycle record before any Agent tool executes');
  const firstHeader = JSON.parse((await readFile(opened.sessionFile, 'utf8')).split('\n')[0]!);
  const run = ordinary.start('MANAGED_INITIAL: independently calculate the prepared values and save a report.', randomUUID()); await run.accepted;
  assert.equal((await run.completion).outcome, 'completed');
  assert.equal(await readFile(path.join(clean, 'calculation.txt'), 'utf8'), '42');
  assert.equal(await readFile(path.join(reports, 'initial.md'), 'utf8'), '# synthetic report\n42');
  assert.equal(await readFile(path.join(clean, 'source.txt'), 'utf8'), '40\n2\n');
  const backgroundFile = path.join(clean, 'background.txt');
  const backgroundReady = Date.now() + 2500;
  while (true) {
    try { if ((await readFile(backgroundFile, 'utf8')).length) break; } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    assert.ok(Date.now() < backgroundReady, 'legitimate background work must remain available after the tool returns');
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  const firstTick = Number(await readFile(backgroundFile, 'utf8'));
  await new Promise(resolve => setTimeout(resolve, 120));
  assert.ok(Number(await readFile(backgroundFile, 'utf8')) > firstTick, 'a settled tool and SDK turn do not kill legitimate background calculations');
  const backgroundRead = ordinary.start('MANAGED_BACKGROUND_READ: inspect the actual continuing calculation from another tool call.', randomUUID()); await backgroundRead.accepted;
  assert.equal((await backgroundRead.completion).outcome, 'completed');
  await assert.rejects(readFile(escaped), /ENOENT/);
  const beforeInspection = requests.length;
  for (const command of ['/tools', '/skills', '/session', '/tree', '/prompts', '/reload', '/branch']) {
    const result = await ordinary.command(command); assert.equal(result.outcome, 'completed', `${command}: ${JSON.stringify(result)}`);
  }
  assert.equal(requests.length, beforeInspection, 'inspection/reload do not issue model requests');
  const compacted = await ordinary.command('/compact Summarize the synthetic calculation context.');
  assert.equal(compacted.outcome, 'completed', JSON.stringify(compacted));
  assert.equal(requests.length, beforeInspection + 1);
  const selector = await ordinary.command('/fork');
  const selected = selector.result.entries.find((entry: any) => entry.text.includes('MANAGED_INITIAL'));
  assert.ok(selected?.entryId);
  const forked = await ordinary.command(`/fork ${selected.entryId}`);
  assert.equal(forked.outcome, 'completed', JSON.stringify(forked));
  assert.notEqual(forked.snapshot.sessionId, firstHeader.id);
  const canonical = forked.snapshot.sessionFile as string;
  const forkHeader = JSON.parse((await readFile(canonical, 'utf8')).split('\n')[0]!);
  assert.equal(forkHeader.parentSession, opened.sessionFile);
  assert.equal(forkHeader.cwd, clean);
  try { await ordinary.close(); }
  catch (error) {
    const describe = (value: any): any => value instanceof Error ? { name: value.name, message: value.message, code: 'code' in value ? value.code : undefined, cause: describe(value.cause) } : value;
    await writeFile(path.resolve('.local/automatic-verification-revision/managed-sdk-entry/ordinary-close-failure.json'), JSON.stringify({ root, error: describe(error) }, null, 2));
    throw error;
  }
  const finalTick = await readFile(backgroundFile, 'utf8'); await new Promise(resolve => setTimeout(resolve, 150));
  assert.equal(await readFile(backgroundFile, 'utf8'), finalTick, 'phase close ends the owned writer before a protected handoff');
  for (const [file, sessionId] of [[opened.sessionFile, opened.sessionId], [canonical, forked.snapshot.sessionId]]) {
    const entries = (await readFile(file, 'utf8')).trim().split('\n').map(line => JSON.parse(line));
    const facts = entries.filter(entry => entry.type === 'custom' && entry.customType === 'optracall.execution' && entry.data.sessionId === sessionId);
    assert.deepEqual(facts.map(entry => entry.data.phase), ['opened', 'closed']);
    assert.equal(facts[0].data.executionId, facts[1].data.executionId);
    assert.equal(facts[0].data.profile, 'ordinary');
  }
  const prefix = await readFile(canonical), protectedRoot = path.join(root, 'protected-execution'); await mkdir(protectedRoot, { mode: 0o700 });
  const protectedScope = await createProtectedExecutionScope({ id: 'protected-native-test', cwd: protectedRoot, writableRoot: protectedRoot, readRoots: [projectDirectory] });
  const protectedAgent = new ProjectAgent({ ...options, sessionFile: canonical, protectedExecution: protectedScope }); t.after(() => protectedAgent.close());
  const resumed = await protectedAgent.open(); assert.equal(resumed.sessionId, forkHeader.id); assert.equal(resumed.sessionFile, canonical);
  await assert.rejects(protectedAgent.command('/tools'), /sdk_operation_failed/);
  const continuing = protectedAgent.start('Continue the same synthetic canonical with protected execution.', randomUUID()); await continuing.accepted;
  assert.equal((await continuing.completion).outcome, 'completed');
  await protectedAgent.stop();
  assert.equal(protectedAgent.alive, false, 'explicit managed stop closes background resources even with no SDK turn in flight');
  const after = await readFile(canonical); assert.ok(after.subarray(0, prefix.length).equals(prefix));
  const allFacts = after.toString().trim().split('\n').map(line => JSON.parse(line)).filter(entry => entry.type === 'custom' && entry.customType === 'optracall.execution' && entry.data.sessionId === forkHeader.id);
  assert.deepEqual(allFacts.map(entry => [entry.data.profile, entry.data.phase]), [['ordinary', 'opened'], ['ordinary', 'closed'], ['protected', 'opened'], ['protected', 'closed']]);
});
