import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile, access, symlink } from 'node:fs/promises';
import path from 'node:path';
import { createHost } from '../src/host/server.ts';
import { createVerificationStore } from '../src/host/verification-store.ts';

async function until<T>(read: () => Promise<T>, done: (value: T) => boolean): Promise<T> {
  const end = Date.now() + 15_000;
  for (;;) { const value = await read(); if (done(value)) return value; if (Date.now() > end) assert.fail('Synthetic operation did not settle'); await new Promise(resolve => setTimeout(resolve, 10)); }
}

async function fixture(t: TestContext, input: { data?: Buffer; author?: string; verifierModel?: string } = {}) {
  const root = path.resolve('.local/semantic-verification/revision-closeout', randomUUID());
  const dataRoot = path.join(root, 'host-data'), projectsRoot = path.join(root, 'projects');
  await mkdir(root, { recursive: true });
  const requests: any[] = [], responses = new Set<ServerResponse>();
  let handler: (body: any, response: ServerResponse) => void = (_body, response) => reply(response, 'SYNTHETIC_REPORT');
  function chunk(response: ServerResponse, delta: object, finish: string | null = null) {
    if (!response.headersSent) response.writeHead(200, { 'content-type': 'text/event-stream' });
    response.write(`data: ${JSON.stringify({ id: 'synthetic-revision', object: 'chat.completion.chunk', created: 1, model: 'synthetic-revision', choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`);
  }
  function reply(response: ServerResponse, text: string) { chunk(response, { role: 'assistant', content: text }); chunk(response, {}, 'stop'); response.end('data: [DONE]\n\n'); }
  const provider = createServer(async (request, response) => {
    const chunks: Buffer[] = []; for await (const part of request) chunks.push(Buffer.from(part));
    const body = JSON.parse(Buffer.concat(chunks).toString()); requests.push(body);
    responses.add(response); response.once('close', () => responses.delete(response));
    handler(body, response);
  });
  await new Promise<void>(resolve => provider.listen(0, '127.0.0.1', resolve));
  const addr = provider.address(); assert.ok(addr && typeof addr !== 'string');
  let host = createHost({ cwd: process.cwd(), dataRoot, projectsRoot, uiPorts: [4183], transportVersion: 'synthetic-revision-preservation' });
  let baseUrl = '';
  async function listen() { await host.ready; await new Promise<void>(resolve => host.server.listen(0, '127.0.0.1', resolve)); const address = host.server.address(); assert.ok(address && typeof address !== 'string'); baseUrl = `http://127.0.0.1:${address.port}`; }
  await listen();
  async function request(route: string, method = 'GET', body?: object, status = 200): Promise<any> {
    const response = await fetch(baseUrl + route, { method, headers: { 'content-type': 'application/json', 'x-optracall-client': '1', origin: 'http://127.0.0.1:4183' }, ...(body ? { body: JSON.stringify(body) } : {}) });
    const value = await response.json(); assert.equal(response.status, status, JSON.stringify(value)); return value;
  }
  t.after(async () => { await host.close().catch(() => {}); for (const response of responses) response.destroy(); await new Promise<void>(resolve => { provider.close(() => resolve()); provider.closeAllConnections(); }); await writeFile(path.join(root, 'requests.json'), JSON.stringify(requests, null, 2)); });
  const config = { name: '合成修订模型', provider: 'openai-compatible', baseUrl: `http://127.0.0.1:${addr.port}/v1`, model: 'synthetic-revision', apiKey: 'synthetic-only-key' };
  await request('/api/configuration', 'PUT', config);
  const { project } = await request('/api/projects', 'POST', { name: '合成修订保全项目' }, 201);
  const { task } = await request(`/api/projects/${project.id}/tasks`, 'POST', { name: '原分析任务' }, 201);
  const taskRoute = `/api/projects/${project.id}/tasks/${task.id}`;
  await request(`/api/projects/${project.id}/files/upload`, 'POST', { directory: '020_clean', name: 'data.csv', content: Buffer.from('id,amount\na,10\n').toString('base64') }, 201);
  // Existing files may originate outside upload; use only this fixture's file
  // to exercise strict decoding rather than the uploader's own UTF-8 check.
  if (input.data) await writeFile(path.join(project.rootPath, '020_clean/data.csv'), input.data);
  await request(`/api/projects/${project.id}/files/save-report`, 'POST', { name: 'author.md', text: input.author ?? 'ORIGINAL_AUTHOR_TEXT' }, 201);
  // Materialize a real ordinary native history before creating the verification.
  const firstId = randomUUID(); await request(taskRoute + '/messages', 'POST', { requestId: firstId, text: '保留原任务历史。' }, 202);
  const original = await until(() => request(taskRoute), value => value.task.lastRun?.status === 'completed');
  const native = await readFile(original.task.sessionFile);
  const owner = { projectId: project.id, taskId: task.id, verificationId: randomUUID() };
  const route = taskRoute + '/verifications/' + owner.verificationId;
  const read = async () => (await request(route)).verification;
  const verifierConfiguration = input.verifierModel ? (await request('/api/configuration', 'PUT', { ...config, model: input.verifierModel, name: '另一核算Provider' })).configuration : undefined;
  await request(taskRoute + '/verifications', 'POST', { verificationId: owner.verificationId, question: '核对金额10，保留未知。', dataFiles: ['020_clean/data.csv'], authorFiles: ['060_reports/author.md'], businessContext: '金额单位是元，未知内容不要自行确认。', ...(verifierConfiguration ? { configurationId: verifierConfiguration.id } : {}) }, 202);
  await until(read, value => value.status === 'completed');
  return { root, dataRoot, projectsRoot, project, task, original, native, taskRoute, owner, route, read, request, config, requests, verifierConfiguration,
    get host() { return host; },
    setHandler: (next: typeof handler) => { handler = next; }, reply, chunk,
    reopen: async () => { if (host.server.listening) await host.close(); host = createHost({ cwd: process.cwd(), dataRoot, projectsRoot, uiPorts: [4183], transportVersion: 'synthetic-revision-preservation' }); await listen(); },
  };
}

test('HTTP author revision cannot execute SDK write/delete tools and preserves the ordinary native session', { timeout: 40_000 }, async t => {
  const f = await fixture(t), author = path.join(f.project.rootPath, '060_reports/author.md'), data = path.join(f.project.rootPath, '020_clean/data.csv');
  let challenged = false;
  f.setHandler((body, response) => {
    if (!challenged) {
      challenged = true;
      const tools = [
        ['bash', { command: `printf CHANGED > '${author}'; rm '${data}'` }],
        ['write', { path: author, content: 'CHANGED' }], ['edit', { path: author, oldText: 'ORIGINAL', newText: 'CHANGED' }],
        ['codemode', { code: `await tools.bash({command: "rm '${data}'"})` }],
        ['tool_search', { query: 'write bash' }], ['mcp__synthetic__delete', { path: data }], ['deferred_write', { path: author }],
      ];
      f.chunk(response, { role: 'assistant', tool_calls: tools.map(([name, args], index) => ({ index, id: `blocked-${index}`, type: 'function', function: { name, arguments: JSON.stringify(args) } })) });
      f.chunk(response, {}, 'tool_calls'); response.end('data: [DONE]\n\n');
    } else f.reply(response, 'NEW_DRAFT_ONLY');
  });
  await f.request(f.route + '/author-revision', 'POST', {}, 202);
  const result = await until(f.read, value => value.revision?.status && value.revision.status !== 'running');
  await writeFile(path.join(f.root, 'readback.json'), JSON.stringify(result, null, 2));
  assert.equal(await readFile(author, 'utf8'), 'ORIGINAL_AUTHOR_TEXT', 'a model-requested write must not execute');
  assert.equal(await readFile(data, 'utf8'), 'id,amount\na,10\n', 'a model-requested delete must not execute');
  assert.equal(result.revision.status, 'completed');
  assert.equal(result.revision.text, 'NEW_DRAFT_ONLY');
  assert.notEqual(result.revision.sessionFile, f.original.task.sessionFile);
  assert.deepEqual((await f.request(f.taskRoute)).task, f.original.task);
  assert.deepEqual(await readFile(f.original.task.sessionFile), f.native, 'original native bytes must not be appended or replaced');
  assert.equal(await readFile(path.join(f.project.rootPath, result.revision.files[0]), 'utf8'), 'NEW_DRAFT_ONLY');
  const sent = f.requests.at(-1);
  assert.ok(sent.messages.some((message: any) => message.role === 'tool' && /not found|not available|unknown tool/i.test(JSON.stringify(message))), 'the real SDK must reject a requested unavailable tool');
  assert.equal(sent.messages.filter((message: any) => message.role === 'tool').length, 7);
  assert.equal(f.requests[3].tools?.length ?? 0, 0);
  await f.reopen(); assert.equal((await f.read()).revision.text, 'NEW_DRAFT_ONLY');
  assert.deepEqual((await f.request(f.taskRoute)).task, f.original.task);
  const store = createVerificationStore({ dataRoot: f.dataRoot });
  const record = await store.read(f.owner);
  await assert.rejects(store.update(f.owner, { authorRevision: { ...record.authorRevision!, sessionFile: f.original.task.sessionFile } }), { code: 'verification_native_scope_invalid' });
  assert.equal((await store.read(f.owner)).authorRevision!.sessionFile, result.revision.sessionFile);
});

test('fixed-draft disables inherited resources while ordinary analysis retains real execution', { timeout: 40_000 }, async t => {
  const f = await fixture(t);
  const home = path.join(f.dataRoot, 'analysis-verifications', f.owner.projectId, f.owner.taskId, f.owner.verificationId);
  const resources = path.join(home, 'revision-resources'), sideEffect = path.join(f.root, 'extension-executed');
  await mkdir(path.join(resources, 'extensions'), { recursive: true });
  await writeFile(path.join(resources, 'extensions/unsafe.mjs'), `import fs from 'node:fs'; export default pi => { fs.writeFileSync(${JSON.stringify(sideEffect)}, 'unsafe'); pi.registerTool({name:'deferred_write',label:'write',description:'unsafe',parameters:{type:'object',properties:{}},execute:async()=>({content:[]})}); };`);
  await writeFile(path.join(f.dataRoot, 'AGENTS.md'), 'FORBIDDEN_INHERITED_CONTEXT');
  await writeFile(path.join(resources, 'SYSTEM.md'), 'FORBIDDEN_INHERITED_SYSTEM');
  const occupied = path.join(f.project.rootPath, `060_reports/verification-${f.owner.verificationId}-revision.md`);
  await writeFile(occupied, 'PREEXISTING_REPORT_MUST_REMAIN');
  await f.request(f.route + '/author-revision', 'POST', {}, 202);
  const completed = await until(f.read, value => value.revision?.status && value.revision.status !== 'running');
  assert.equal(completed.revision.status, 'completed');
  assert.equal(completed.revision.mode, 'fixed-draft');
  assert.equal(await readFile(occupied, 'utf8'), 'PREEXISTING_REPORT_MUST_REMAIN');
  assert.notEqual(path.join(f.project.rootPath, completed.revision.files[0]), occupied);
  await assert.rejects(access(sideEffect), { code: 'ENOENT' });
  assert.doesNotMatch(JSON.stringify(f.requests[3]), /FORBIDDEN_INHERITED_CONTEXT|FORBIDDEN_INHERITED_SYSTEM/);
  assert.match(JSON.stringify(f.requests[3]), /ORIGINAL_AUTHOR_TEXT/);
  assert.match(JSON.stringify(f.requests[3]), /id,amount/);
  assert.match(JSON.stringify(f.requests[3]), /金额单位是元/);
  const rawContent = f.requests[3].messages.at(-1).content;
  const content = typeof rawContent === 'string' ? rawContent : rawContent.map((part: any) => part.text ?? '').join('');
  const materials = JSON.parse(content.slice(content.indexOf('\n') + 1));
  assert.equal(materials.question, completed.question); assert.equal(materials.businessContext, completed.semantics.text);
  assert.equal(materials.independentResult, completed.coldResult.text); assert.equal(materials.verificationOpinion, completed.comparisonResult.text);
  assert.equal(materials.authorFiles[0].text, 'ORIGINAL_AUTHOR_TEXT'); assert.equal(materials.dataFiles[0].text, 'id,amount\na,10\n');
  const target = path.join(f.project.rootPath, '020_clean/ordinary-only.txt'); let challenged = false;
  f.setHandler((_body, response) => {
    if (!challenged) { challenged = true; f.chunk(response, { role: 'assistant', tool_calls: [{ index: 0, id: 'ordinary-bash', type: 'function', function: { name: 'bash', arguments: JSON.stringify({ command: `printf ORDINARY_TOOL_OK > '${target}'` }) } }] }); f.chunk(response, {}, 'tool_calls'); response.end('data: [DONE]\n\n'); }
    else f.reply(response, 'ORDINARY_FINISHED');
  });
  await f.request(f.taskRoute + '/messages', 'POST', { requestId: randomUUID(), text: '在原普通任务继续合成分析。' }, 202);
  await until(() => f.request(f.taskRoute), value => value.task.lastRun?.status === 'completed' && value.snapshot.messages.some((m: any) => JSON.stringify(m).includes('ORDINARY_FINISHED')));
  assert.equal(await readFile(target, 'utf8'), 'ORDINARY_TOOL_OK');
  assert.ok((await readFile(f.original.task.sessionFile)).subarray(0, f.native.length).equals(f.native));
});

for (const end of ['stop', 'clear', 'close'] as const) test(`fixed-draft ${end} retains original history and refuses late report saving`, { timeout: 40_000 }, async t => {
  const f = await fixture(t); let held: ServerResponse | undefined;
  f.setHandler((_body, response) => { held = response; f.chunk(response, { role: 'assistant', content: 'PARTIAL_NOT_A_REPORT' }); });
  await f.request(f.route + '/author-revision', 'POST', {}, 202);
  await until(async () => held, Boolean);
  await f.request(f.taskRoute + '/messages', 'POST', { requestId: randomUUID(), text: '此时原任务不能并发修改固定材料。' }, 409);
  if (end === 'stop') await f.request(f.route + '/stop', 'POST', {});
  else if (end === 'clear') await f.request('/api/configuration?provider=' + encodeURIComponent(f.original.task.configuration.provider), 'DELETE');
  else await f.host.close();
  if (!held!.destroyed) f.reply(held!, 'LATE_DRAFT_MUST_NOT_SAVE');
  if (end === 'close') await f.reopen();
  const result = await until(f.read, value => value.revision?.status && value.revision.status !== 'running');
  assert.ok(['cancelled', 'unknown', 'failed'].includes(result.revision.status), JSON.stringify(result.revision));
  assert.equal(result.revision.text, undefined); assert.equal(result.revision.files, undefined);
  assert.deepEqual((await f.request(f.taskRoute)).task, f.original.task);
  assert.deepEqual(await readFile(f.original.task.sessionFile), f.native);
  assert.equal(await readFile(path.join(f.project.rootPath, '060_reports/author.md'), 'utf8'), 'ORIGINAL_AUTHOR_TEXT');
  await f.request(f.route + '/author-revision', 'POST', {}, 409);
  assert.equal(f.requests.length, 4, 'cancel/close/reopen must not replay the original revision');
});

test('fixed-draft failures save no accepted report and a changed selection cannot switch its captured model', { timeout: 40_000 }, async t => {
  const f = await fixture(t); let held: ServerResponse | undefined;
  f.setHandler((_body, response) => { held = response; });
  await f.request(f.route + '/author-revision', 'POST', {}, 202); await until(async () => held, Boolean);
  await f.request('/api/configuration', 'PUT', { ...f.config, model: 'different-selected-model', name: '另一个当前模型' });
  held!.writeHead(401, { 'content-type': 'application/json' }); held!.end(JSON.stringify({ error: { message: 'synthetic denied', type: 'authentication_error' } }));
  const result = await until(f.read, value => value.revision?.status && value.revision.status !== 'running');
  assert.equal(result.revision.status, 'failed'); assert.equal(result.revision.text, undefined);
  assert.equal(result.revision.configuration.model, 'synthetic-revision');
  assert.equal(f.requests[3].model, 'synthetic-revision');
  assert.deepEqual((await f.request(f.taskRoute)).task, f.original.task);
  assert.deepEqual(await readFile(f.original.task.sessionFile), f.native);
  assert.equal(f.requests.length, 4);
});

for (const invalid of ['large', 'binary'] as const) test(`fixed-draft ${invalid} materials are explicitly refused before reservation or SDK dispatch`, { timeout: 40_000 }, async t => {
  const f = await fixture(t, invalid === 'large' ? { author: '大'.repeat(20_000) } : { data: Buffer.from([0xff, 0xfe, 0x80]) });
  const before = f.requests.length;
  const error = await f.request(f.route + '/author-revision', 'POST', {}, 400);
  assert.equal(error.code, invalid === 'large' ? 'verification_revision_materials_too_large' : 'verification_revision_text_required');
  assert.match(error.message, /未启动修订模型/);
  const unchanged = await f.read(); assert.equal(unchanged.revision, undefined); assert.equal(unchanged.revisionCount ?? 0, 0);
  assert.equal(f.requests.length, before); assert.deepEqual((await f.request(f.taskRoute)).task, f.original.task);
});

test('fixed-draft refuses an unsafe attached workspace without creating files in its target', { timeout: 40_000 }, async t => {
  const f = await fixture(t), store = createVerificationStore({ dataRoot: f.dataRoot });
  const foreign = path.join(f.root, 'must-stay-untouched'); await mkdir(foreign); await writeFile(path.join(foreign, 'marker'), 'KEEP');
  await symlink(foreign, store.revisionWorkspace(f.owner));
  await f.request(f.route + '/author-revision', 'POST', {}, 202);
  const result = await until(f.read, value => value.revision?.status && value.revision.status !== 'running');
  assert.equal(result.revision.status, 'unknown'); assert.equal(result.revision.text, undefined);
  assert.equal(f.requests.length, 3); assert.equal(await readFile(path.join(foreign, 'marker'), 'utf8'), 'KEEP');
  await assert.rejects(access(path.join(foreign, '.tmp')), { code: 'ENOENT' });
  assert.deepEqual((await f.request(f.taskRoute)).task, f.original.task);
});

test('an active ordinary task refuses revision admission without consuming it, and can later create a separate draft', { timeout: 40_000 }, async t => {
  const f = await fixture(t); let held: ServerResponse | undefined;
  f.setHandler((_body, response) => { held = response; f.chunk(response, { role: 'assistant', content: 'ORDINARY_IN_PROGRESS' }); });
  await f.request(f.taskRoute + '/messages', 'POST', { requestId: randomUUID(), text: '普通任务仍在执行。' }, 202);
  await until(async () => held, Boolean);
  const before = await f.request(f.taskRoute);
  await f.request(f.route + '/author-revision', 'POST', {}, 409);
  assert.equal((await f.read()).revision, undefined); assert.equal((await f.read()).revisionCount ?? 0, 0);
  assert.equal(f.requests.length, 4);
  assert.deepEqual((await f.request(f.taskRoute)).task, before.task);
  await f.request(f.taskRoute + '/stop', 'POST', {});
  const stopped = await until(() => f.request(f.taskRoute), value => value.task.lastRun?.status === 'cancelled');
  const native = await readFile(stopped.task.sessionFile);
  f.setHandler((_body, response) => f.reply(response, 'SEPARATE_DRAFT_AFTER_STOP'));
  await f.request(f.route + '/author-revision', 'POST', {}, 202);
  const result = await until(f.read, value => value.revision?.status && value.revision.status !== 'running');
  assert.equal(result.revision.status, 'completed');
  assert.deepEqual((await f.request(f.taskRoute)).task, stopped.task);
  assert.deepEqual(await readFile(stopped.task.sessionFile), native);
});

test('a rejected ordinary command leaves the original task and native completely unchanged during drafting', { timeout: 40_000 }, async t => {
  const f = await fixture(t); let held: ServerResponse | undefined;
  f.setHandler((_body, response) => { held = response; f.chunk(response, { role: 'assistant', content: '' }); });
  await f.request(f.route + '/author-revision', 'POST', {}, 202); await until(async () => held, Boolean);
  await f.request(f.taskRoute + '/commands', 'POST', { requestId: randomUUID(), text: '/reload' }, 409);
  assert.deepEqual((await f.request(f.taskRoute)).task, f.original.task, 'rejected command must not update lastRun or updatedAt');
  assert.deepEqual(await readFile(f.original.task.sessionFile), f.native);
  assert.equal(f.requests.length, 4);
  f.reply(held!, 'DRAFT_AFTER_REJECTED_COMMAND');
  const result = await until(f.read, value => value.revision?.status && value.revision.status !== 'running');
  assert.equal(result.revision.status, 'completed');
});

for (const cleared of ['verifier', 'draft'] as const) test(`clearing only the ${cleared} provider settles only its own captured stage`, { timeout: 40_000 }, async t => {
  const f = await fixture(t, { verifierModel: 'synthetic-verifier-B' }); let held: ServerResponse | undefined;
  const initial = await f.read(), originalProvider = f.original.task.configuration.provider;
  assert.notEqual(initial.configuration.provider, originalProvider);
  f.setHandler((_body, response) => { held = response; f.chunk(response, { role: 'assistant', content: '' }); });
  await f.request(f.route + '/author-revision', 'POST', {}, 202); await until(async () => held, Boolean);
  const started = await f.read(); assert.equal(started.revision.configuration.provider, originalProvider); assert.equal(f.requests[3].model, 'synthetic-revision');
  const provider = cleared === 'verifier' ? initial.configuration.provider : originalProvider;
  await f.request('/api/configuration?provider=' + encodeURIComponent(provider), 'DELETE');
  const after = await f.read();
  assert.equal(after.status, 'completed', 'a completed verifier stage must remain complete');
  assert.deepEqual(after.comparisonResult, initial.comparisonResult); assert.deepEqual(after.coldResult, initial.coldResult);
  assert.deepEqual((await f.request(f.taskRoute)).task, f.original.task); assert.deepEqual(await readFile(f.original.task.sessionFile), f.native);
  if (cleared === 'verifier') {
    assert.equal(after.revision.status, 'running', 'another provider clear must not settle this live draft');
    assert.equal(held!.destroyed, false);
    f.reply(held!, 'DRAFT_A_SURVIVES_B_CLEAR');
    const completed = await until(f.read, value => value.revision?.status && value.revision.status !== 'running');
    assert.equal(completed.revision.status, 'completed'); assert.equal(completed.revision.text, 'DRAFT_A_SURVIVES_B_CLEAR');
    assert.equal(await readFile(path.join(f.project.rootPath, completed.revision.files[0]), 'utf8'), 'DRAFT_A_SURVIVES_B_CLEAR');
  } else {
    assert.ok(['cancelled', 'unknown'].includes(after.revision.status)); assert.equal(after.revision.text, undefined); assert.equal(after.revision.files, undefined);
    if (!held!.destroyed) f.reply(held!, 'LATE_DRAFT_A_AFTER_A_CLEAR');
    assert.notEqual((await f.read()).revision.status, 'completed');
  }
  assert.equal(f.requests.length, 4, 'provider clearing never replays either stage');
});
