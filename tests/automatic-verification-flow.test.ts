import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { mkdir, readFile, writeFile, unlink } from 'node:fs/promises';
import path from 'node:path';
import { startTestHost } from './fixtures/host-process.ts';
import { readJson } from './fixtures/joint-context.ts';
import { AUTOMATIC_INITIAL_MARKER, AUTOMATIC_WARMUP_MARKER, startAutomaticProvider, type AutomaticSyntheticScenario, type AutomaticProviderRequest } from './fixtures/automatic-provider.ts';
import type { AutomaticChain, AutomaticSettingsInput } from '../src/host/automatic-verification-types.ts';
import { createAutomaticVerificationStore } from '../src/host/automatic-verification-store.ts';
import { OUTPUT_EVIDENCE_GUIDANCE } from '../src/agent/output-evidence.ts';
import { automaticAuthorContext } from '../src/host/automatic-verification-context.ts';
import { AUTOMATIC_FEEDBACK_EVIDENCE_GUIDANCE } from '../src/host/verification-context.ts';

const source = 'row,amount\n1,2120\n2,-140\n3,-80\n';
const author = '# 合成初稿\n\n退款反事实：2,120元。\n';
const sha = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex');
async function until<T>(read: () => Promise<T>, done: (value: T) => boolean, label: string, timeoutMs = 45000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) { const value = await read(); if (done(value)) return value; if (Date.now() >= deadline) assert.fail(`${label} did not settle: ${JSON.stringify(value)}`); await new Promise(resolve => setTimeout(resolve, 25)); }
}
async function requireAutomatic(t: any, f: Awaited<ReturnType<typeof fixture>>) {
  const capability = await readJson(await f.host.request(`${f.route}/capabilities`));
  if (!capability.supported) { t.skip(`NOT_RUN: ${capability.reason ?? 'automatic execution protection unavailable'}`); return false; }
  return true;
}
async function fixture(scenario: AutomaticSyntheticScenario = 'repair', caseName?: string, providerFactory: typeof startAutomaticProvider = startAutomaticProvider, presetId?: string, engineeringRoot = '.local/automatic-verification-revision/engineering-runs') {
  const runRoot = path.resolve(engineeringRoot, randomUUID());
  await mkdir(runRoot, { recursive: true });
  const provider = await providerFactory({ scenario });
  let host: Awaited<ReturnType<typeof startTestHost>>;
  try { host = await startTestHost({ dataRoot: path.join(runRoot, 'host'), projectsRoot: path.join(runRoot, 'projects') }); }
  catch (error) { await provider.close(); throw error; }
  const close = async () => {
    const results = await Promise.allSettled([host.close(), provider.close()]);
    await writeFile(path.join(runRoot, 'receipt.json'), JSON.stringify({
      scope: 'SYNTHETIC_REAL_SDK_ENGINEERING_ONLY', scenario, caseName, savedAt: new Date().toISOString(),
      runRoot, dataRoot: host.dataRoot, projectsRoot: host.projectsRoot,
      model: 'synthetic-model', requests: provider.requests.map(({ method, path, body, stage, toolReply, closedEarly, lastUser }) => ({ method, path, stage, toolReply, closedEarly, lastUserPreview: lastUser.slice(0, 400), lastUserSha256: sha(lastUser), messageRoles: body.messages?.map(value => value.role) })),
      modelRequestCount: provider.requests.length, shutdown: results.map(result => result.status),
      hostOutput: host.output(),
    }, null, 2));
    const failed = results.find(result => result.status === 'rejected'); if (failed?.status === 'rejected') throw failed.reason;
  };
  try {
  await readJson(await host.request('/api/configuration', 'PUT', { ...(presetId ? { id: presetId } : {}), name: '自动链合成模型', provider: presetId ? 'synthetic-preset' : 'openai-compatible', baseUrl: provider.baseUrl, model: 'synthetic-model', apiKey: 'synthetic-key' }));
  const { project } = await readJson(await host.request('/api/projects', 'POST', { name: '自动链合成项目' }), 201);
  const { task } = await readJson(await host.request(`/api/projects/${project.id}/tasks`, 'POST', { name: '原主Agent任务' }), 201);
  await readJson(await host.request(`/api/projects/${project.id}/files/upload`, 'POST', { directory: '020_clean', name: 'source.csv', content: Buffer.from(source).toString('base64') }), 201);
  const taskRoute = `/api/projects/${project.id}/tasks/${task.id}`, route = `${taskRoute}/automatic-verification`;
  const reportPath = path.join(project.rootPath, '060_reports', 'initial.md');
  const settings: AutomaticSettingsInput = { enabled: true, question: '核对退款反事实及报告中的新增主张。', dataFiles: ['020_clean/source.csv'], reportPath: '060_reports/initial.md', processFiles: [], maxAuthorTurns: 1 };
  const send = async (text: string) => { const requestId = randomUUID(); await readJson(await host.request(`${taskRoute}/messages`, 'POST', { requestId, text }), 202); return requestId; };
  const writeReport = (relativePath: string, text = author) => send(`${AUTOMATIC_INITIAL_MARKER}\n${JSON.stringify({ reportPath: path.join(project.rootPath, relativePath), content: text })}\n请通过原生write工具写入这份合成报告；不是由测试进程写文件。`);
  const writeInitial = (text = author) => writeReport('060_reports/initial.md', text);
  const readTask = () => host.request(taskRoute).then(readJson);
  const warmup = async () => { const id = await send(AUTOMATIC_WARMUP_MARKER); const value = await until(readTask, result => result.task.lastRun?.id === id && result.task.lastRun.status === 'completed', 'warmup'); await until(async () => readJson(await host.request(`${route}/status`)), value => !value.busy, 'warmup resource close'); return { native: value.task.sessionFile as string, bytes: await readFile(value.task.sessionFile) }; };
  const list = async () => (await readJson(await host.request(`${route}/chains`))).chains as AutomaticChain[];
  const readChain = async (id: string) => (await readJson(await host.request(`${route}/chains/${id}`))).chain as AutomaticChain;
  const completed = async (requestId?: string) => {
    const chains = await until(list, values => values.some(value => !requestId || value.requestId === requestId), 'chain creation');
    const chain = chains.find(value => !requestId || value.requestId === requestId)!;
    return until(() => readChain(chain.chainId), value => ['paused', 'completed', 'cancelled', 'failed', 'unknown'].includes(value.state), 'automatic chain');
  };
  return { provider, host, project, task, taskRoute, route, reportPath, settings, send, writeInitial, writeReport, readTask, warmup, list, readChain, completed, close };
  } catch (error) { await close(); throw error; }
}

for (const explicitConfiguration of [false, true]) test(`AV01 public preset configuration ID survives automatic settings, admission and the actual SDK chain (${explicitConfiguration ? 'explicit verifier' : 'selected default'})`, { timeout: 120000 }, async t => {
  // Keep the real preset identity, but use an isolated synthetic Provider so
  // this regression cannot send credentials or requests to its native route.
  const f = await fixture('retain', t.name, startAutomaticProvider, 'mimo-v26-flash'); t.after(() => f.close());
  if (!await requireAutomatic(t, f)) return;
  assert.equal(f.task.configuration.id, 'mimo-v26-flash');
  const saved = await readJson(await f.host.request(`${f.route}/settings`, 'PUT', { expectedRevision: 0, settings: { ...f.settings, ...(explicitConfiguration ? { configurationId: 'mimo-v26-flash' } : {}) } }));
  assert.equal(saved.settings.configurationId, explicitConfiguration ? 'mimo-v26-flash' : undefined);
  assert.equal(f.provider.requests.length, 0, 'saving and reading settings cannot dispatch a model');
  const requestId = await f.writeInitial();
  const chain = await f.completed(requestId);
  assert.equal(chain.state, 'completed', JSON.stringify(chain));
  assert.equal(chain.configuration.id, 'mimo-v26-flash');
  assert.equal(chain.verificationConfiguration.id, 'mimo-v26-flash');
  assert.equal(chain.settingsSnapshot.configurationId, explicitConfiguration ? 'mimo-v26-flash' : undefined);
  assert.deepEqual(chain.steps.map(step => step.phase), ['cold', 'compare', 'author']);
  const status = await readJson(await f.host.request(`${f.route}/status`));
  assert.equal(status.observation.requestId, requestId);
  assert.equal(status.observation.configuration.id, 'mimo-v26-flash');
  assert.equal(status.observation.verificationConfiguration.id, 'mimo-v26-flash');
  assert.ok(f.provider.requests.some(request => request.stage === 'ordinary'));
  assert.ok(f.provider.requests.some(request => request.stage === 'cold'));
  assert.equal(await readFile(f.reportPath, 'utf8'), author);
});

test('AV06 a UTF-8 BOM revision preserves exact author bytes in the saved report and fixed version through recheck', { timeout: 120000 }, async t => {
  const revised = '\uFEFF# 合成修订报告😀\r\n\r\n退款反事实：1,900元。\r\n', expected = Buffer.from(revised, 'utf8');
  const f = await fixture('repair', t.name, options => startAutomaticProvider({ ...options, revisedText: revised })); t.after(() => f.close());
  if (!await requireAutomatic(t, f)) return;
  await readJson(await f.host.request(`${f.route}/settings`, 'PUT', { expectedRevision: 0, settings: f.settings }));
  const chain = await f.completed(await f.writeInitial());
  assert.equal(chain.state, 'completed', JSON.stringify(chain));
  assert.equal(chain.reason, 'limit_reached');
  assert.deepEqual(chain.steps.map(step => step.phase), ['cold', 'compare', 'author', 'recheck']);
  assert.equal(chain.versions.length, 2);
  const revision = chain.versions[1]!;
  const work = path.join(f.host.dataRoot, 'automatic-verifications', f.project.id, f.task.id, 'chains', chain.chainId, 'work', 'author-1', 'work', 'report.md');
  assert.deepEqual(await readFile(work), expected, 'the actual SDK write tool authored the BOM, Unicode and CRLF bytes');
  const saved = await readFile(path.join(f.project.rootPath, revision.relativePath));
  assert.deepEqual(saved, expected, 'Host must not strip or rewrite the submitted report');
  assert.equal(revision.bytes, expected.length);
  assert.equal(revision.sha256, sha(expected));
  assert.equal(sha(saved), revision.sha256);
  const fixed = (await readJson(await f.host.request(`${f.route}/chains/${chain.chainId}/reports/2`))).report;
  assert.deepEqual(Buffer.from(fixed.contentBase64, 'base64'), expected);
  assert.equal(fixed.sha256, revision.sha256);
  assert.equal(fixed.text, revised);
  assert.equal(revision.recheckRequestId, chain.steps[3]!.requestId);
  assert.ok(f.provider.requests.some(request => request.stage === 'recheck' && !request.toolReply));
  assert.equal(await readFile(f.reportPath, 'utf8'), author, 'the prior report remains unchanged');
});

test('D15 protected author feedback receives the ordinary evidence standard through the actual Host and SDK request', { timeout: 120000 }, async t => {
  const f = await fixture('repair', t.name); t.after(() => f.close());
  if (!await requireAutomatic(t, f)) return;
  await readJson(await f.host.request(`${f.route}/settings`, 'PUT', { expectedRevision: 0, settings: f.settings }));
  const chain = await f.completed(await f.writeInitial());
  assert.equal(chain.state, 'completed', JSON.stringify(chain));
  assert.deepEqual(chain.steps.map(step => step.phase), ['cold', 'compare', 'author', 'recheck']);
  const contentText = (content: unknown): string => typeof content === 'string' ? content : Array.isArray(content)
    ? content.map(part => part && typeof part === 'object' && typeof part.text === 'string' ? part.text : '').join('\n') : '';
  const ordinary = f.provider.requests.find(request => request.stage === 'ordinary' && !request.toolReply);
  const revision = f.provider.requests.find(request => request.stage === 'author' && !request.toolReply);
  assert.ok(ordinary, 'the original public task reaches the synthetic Provider through Pi');
  assert.ok(revision, 'the protected author phase reaches the synthetic Provider through Pi');
  assert.ok(OUTPUT_EVIDENCE_GUIDANCE.length > 0, 'an empty shared standard cannot make this comparison pass');
  const ordinarySystem = ordinary.body.messages!.filter(message => message.role === 'system').map(message => contentText(message.content)).join('\n');
  assert.ok(ordinarySystem.includes(OUTPUT_EVIDENCE_GUIDANCE), 'the ordinary author actually receives the existing standard');
  const prefix = '自动核算意见已交回原主Agent\n';
  assert.equal(revision.lastUser.startsWith(prefix), true);
  const supplied = JSON.parse(revision.lastUser.slice(prefix.length));
  assert.equal(supplied.report.version, chain.versions[0]!.version);
  assert.equal(supplied.report.sha256, chain.versions[0]!.sha256);
  assert.equal(sha(await readFile(supplied.report.fixedPath)), supplied.report.sha256);
  assert.equal(supplied.output.reportPath.endsWith('/work/author-1/work/report.md'), true);
  assert.match(supplied.note, /误报/); assert.match(supplied.note, /不改稿/); assert.match(supplied.note, /反驳/);
  assert.equal(await readFile(f.reportPath, 'utf8'), author, 'the fixed correct-or-incorrect original is retained');
  const cold = f.provider.requests.find(request => request.stage === 'cold' && !request.toolReply);
  assert.ok(cold);
  assert.equal(cold.body.messages!.some(message => message.role === 'user' && contentText(message.content).includes(author)), false, 'the new author guidance cannot expose the author report before independent work');
  await writeFile(path.join(path.dirname(f.host.dataRoot), 'author-evidence-delivery.json'), JSON.stringify({
    scope: 'SYNTHETIC_REAL_HOST_SDK_DELIVERY_ONLY',
    ordinaryRequestBodySha256: sha(JSON.stringify(ordinary.body)),
    ordinarySuppliedGuidance: ordinarySystem.slice(ordinarySystem.indexOf(OUTPUT_EVIDENCE_GUIDANCE), ordinarySystem.indexOf(OUTPUT_EVIDENCE_GUIDANCE) + OUTPUT_EVIDENCE_GUIDANCE.length),
    protectedAuthorRequestBodySha256: sha(JSON.stringify(revision.body)),
    protectedAuthorLastUser: revision.lastUser,
    protectedAuthorMessageRoles: revision.body.messages!.map(message => message.role),
    coldAuthorReportAbsent: true,
  }, null, 2));
  assert.equal(supplied.outputEvidenceGuidance, OUTPUT_EVIDENCE_GUIDANCE,
    'the actual protected-author feedback must retain the same complete evidence standard as the ordinary author');
});

test('D15 author evidence guidance keeps the original 20k budget and rejects an unrepresentable encoded envelope', () => {
  const hash = 'a'.repeat(64), input = {
    question: 'q'.repeat(4000), report: { version: 1, path: '060_reports/report.md', fixedPath: '/fixed/report.md', sha256: hash },
    authorTurn: { number: 1, limit: 1 }, coldResult: { text: '😀'.repeat(8000), file: '/fixed/cold.md', sha256: hash },
    opinion: { text: 'opinion'.repeat(3000), file: '/fixed/opinion.md', sha256: hash }, output: { reportPath: '/work/report.md' },
  };
  const prefix = '自动核算意见已交回原主Agent\n', text = automaticAuthorContext(input), supplied = JSON.parse(text.slice(prefix.length));
  assert.ok(text.length <= 20_000);
  assert.equal(supplied.question, input.question, 'the normal public 4k question remains complete');
  assert.deepEqual(supplied.report, input.report); assert.deepEqual(supplied.output, input.output);
  assert.equal(supplied.outputEvidenceGuidance, OUTPUT_EVIDENCE_GUIDANCE);
  for (const key of ['coldResult', 'opinion'] as const) {
    assert.equal(supplied[key].file, input[key].file); assert.equal(supplied[key].sha256, hash);
    assert.equal(supplied[key].totalLength, input[key].text.length);
    assert.ok(supplied[key].end <= 5000); assert.equal(supplied[key].text, input[key].text.slice(0, supplied[key].end));
  }
  assert.equal(supplied.coldResult.end, 5000); assert.equal(supplied.opinion.end, 5000);
  // D15's shared standard already made this encoded base unrepresentable;
  // D16 also retains grounded-feedback guidance inside the same total limit.
  // Neither standard nor fixed identities may be sliced to make it fit.
  assert.throws(() => automaticAuthorContext({ ...input, question: '\0'.repeat(3060),
    coldResult: { ...input.coldResult, text: '' }, opinion: { ...input.opinion, text: '' } }), { code: 'automatic_author_context_too_large' });
});

test('D16 actual Host and Pi deliver grounded feedback and a fitting full fixed recheck tail', { timeout: 120000 }, async t => {
  const tail = '\nNEW_CLAIM_TAIL\n', revised = '正文'.repeat(6919) + tail;
  assert.equal(revised.length, 13_854);
  const evidenceRoot = process.env.OPTRACALL_D16_CONTEXT_EVIDENCE_ROOT ?? '.local/d16-context-engineering';
  const f = await fixture('repair', t.name, options => startAutomaticProvider({ ...options, revisedText: revised }), undefined, path.join(evidenceRoot, 'host-sdk'));
  t.after(() => f.close());
  if (!await requireAutomatic(t, f)) return;
  await readJson(await f.host.request(`${f.route}/settings`, 'PUT', { expectedRevision: 0, settings: f.settings }));
  const chain = await f.completed(await f.writeInitial());
  assert.equal(chain.state, 'completed', JSON.stringify(chain));
  assert.deepEqual(chain.steps.map(step => step.phase), ['cold', 'compare', 'author', 'recheck']);
  assert.equal(chain.versions.length, 2);
  const first = chain.versions[0]!, final = chain.versions[1]!;
  const cold = f.provider.requests.find(request => request.stage === 'cold' && !request.toolReply);
  const compare = f.provider.requests.find(request => request.stage === 'compare' && !request.toolReply);
  const authorRequest = f.provider.requests.find(request => request.stage === 'author' && !request.toolReply);
  const recheck = f.provider.requests.find(request => request.stage === 'recheck' && !request.toolReply);
  assert.ok(cold && compare && authorRequest && recheck);
  const coldUserText = cold.body.messages!.filter(message => message.role === 'user').map(message =>
    typeof message.content === 'string' ? message.content : Array.isArray(message.content)
      ? message.content.filter(part => part?.type === 'text').map(part => part.text).join('') : '').join('\n');
  assert.ok(coldUserText.includes('独立核算任务：'));
  for (const authorOnlyLine of ['# 合成初稿', '退款反事实：2,120元。']) {
    assert.equal(coldUserText.includes(authorOnlyLine), false,
      'decoded cold text blocks cannot disclose the author report, even as JSON-escaped multiline text');
  }
  assert.ok(compare.lastUser.includes(AUTOMATIC_FEEDBACK_EVIDENCE_GUIDANCE));
  assert.ok(compare.lastUser.length <= 20_000);
  const authorPacket = JSON.parse(authorRequest.lastUser.slice('自动核算意见已交回原主Agent\n'.length));
  assert.equal(authorPacket.feedbackEvidenceGuidance, AUTOMATIC_FEEDBACK_EVIDENCE_GUIDANCE);
  assert.equal(authorPacket.report.version, first.version); assert.equal(authorPacket.report.sha256, first.sha256);
  const recheckPacket = JSON.parse(recheck.lastUser.slice('修订复查（已知作者信息，不是新冷读）\n'.length));
  assert.ok(recheck.lastUser.length <= 20_000);
  assert.equal(recheckPacket.text, revised);
  assert.equal(recheckPacket.start, 0); assert.equal(recheckPacket.end, 13_854); assert.equal(recheckPacket.totalLength, 13_854);
  assert.equal(recheckPacket.text.endsWith(tail), true);
  assert.equal(recheckPacket.version, 2); assert.equal(recheckPacket.sha256, final.sha256);
  assert.equal(sha(await readFile(recheckPacket.fixedPath)), final.sha256);
  assert.equal(await readFile(f.reportPath, 'utf8'), author);
  const status = await readJson(await f.host.request(`${f.route}/status`));
  assert.equal(status.busy, false);
  const verification = (await readJson(await f.host.request(`${f.taskRoute}/verifications/${chain.firstVerification!.verificationId}`))).verification;
  assert.equal(verification.projectId, f.project.id); assert.equal(verification.taskId, f.task.id);
  assert.equal(verification.verificationId, chain.firstVerification!.verificationId);
  // The legacy manual evidence projection does not establish an automatic
  // protected-scope readback. Verify the registered native bytes themselves.
  const nativePaths = [...new Set([chain.native.sessionFile, verification.native?.sessionFile,
    ...chain.steps.map(step => step.sessionFile)].filter((file): file is string => typeof file === 'string'))];
  const nativeCopies: { path: string; bytes: number; sha256: string }[] = [];
  const nativeUsers: string[] = [];
  for (const file of nativePaths) {
    const bytes = await readFile(file);
    nativeCopies.push({ path: file, bytes: bytes.length, sha256: sha(bytes) });
    for (const line of bytes.toString('utf8').trim().split('\n')) {
      const entry = JSON.parse(line), message = entry.message;
      if (message?.role !== 'user') continue;
      nativeUsers.push(typeof message.content === 'string' ? message.content : message.content
        .filter((part: any) => part?.type === 'text').map((part: any) => part.text).join(''));
    }
  }
  assert.ok(nativeUsers.includes(compare.lastUser), 'the exact comparison request is retained by the actual native writer');
  assert.ok(nativeUsers.includes(authorRequest.lastUser), 'the exact author context is retained by the actual native writer');
  assert.ok(nativeUsers.includes(recheck.lastUser), 'the fitting tail is retained in the exact native recheck request');
  assert.equal(sha((await readFile(chain.native.sessionFile)).subarray(0, chain.native.bytes)), chain.native.sha256);
  const runRoot = path.dirname(f.host.dataRoot);
  await writeFile(path.join(runRoot, 'd16-provider-requests.json'), JSON.stringify(f.provider.requests, null, 2));
  await writeFile(path.join(runRoot, 'd16-context-delivery.json'), JSON.stringify({
    scope: 'ENGINEERING_CONTROLLED_PROVIDER_NOT_PROFESSIONAL_QUALITY',
    projectId: f.project.id, taskId: f.task.id, chainId: chain.chainId,
    first, final, coldAuthorAbsent: true,
    comparisonRequestSha256: sha(compare.lastUser), authorRequestSha256: sha(authorRequest.lastUser),
    recheckRequestSha256: sha(recheck.lastUser), recheckCharacters: recheckPacket.end,
    tailDelivered: true, originalReportUnchanged: true, busyAfterCompletion: false,
    providerBaseUrl: f.provider.baseUrl, provider: 'local synthetic only',
    legacyManualProvidedContextStatus: verification.contextEvidence.provided.status,
    registeredNativeCopies: nativeCopies,
  }, null, 2));
});

/** Test-only transport: the ordinary canned reply starts an actual owned
 * background Python process. All verifier replies retain the shared fixture. */
async function startDelayedReportProvider(options: Parameters<typeof startAutomaticProvider>[0] = {}) {
  const normal = await startAutomaticProvider(options), marker = 'AUTOMATIC_DELAYED_BACKGROUND_REPORT';
  const server = createServer(async (request, response) => {
    try {
      const chunks: Buffer[] = []; for await (const chunk of request) chunks.push(Buffer.from(chunk));
      const body = JSON.parse(Buffer.concat(chunks).toString()) as AutomaticProviderRequest['body'];
      const content = body.messages?.filter(message => message.role === 'user').at(-1)?.content;
      const lastUser = typeof content === 'string' ? content : Array.isArray(content) ? content.map(part => part?.text ?? '').join('\n') : '';
      if (!lastUser.includes(marker)) {
        const upstream = await fetch(normal.baseUrl.replace(/\/v1$/, '') + request.url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
        response.writeHead(upstream.status, { 'Content-Type': upstream.headers.get('content-type') ?? 'text/event-stream' });
        if (upstream.body) for await (const bytes of upstream.body) response.write(bytes);
        response.end(); return;
      }
      const toolReply = body.messages?.at(-1)?.role === 'tool';
      const record: AutomaticProviderRequest = { method: request.method ?? '', path: request.url ?? '', body, stage: 'ordinary', lastUser, toolReply, closedEarly: false };
      normal.requests.push(record); response.on('close', () => { record.closedEarly = !response.writableEnded; });
      response.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store' });
      const send = (delta: unknown, finish: string | null = null) => response.write(`data: ${JSON.stringify({ id: `delayed-report-${normal.requests.length}`, object: 'chat.completion.chunk', created: 1, model: body.model, choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`);
      send({ role: 'assistant', content: '' });
      if (toolReply) { send({ content: '本轮SDK回复已完成，后台写报告仍在等待本操作内的协调输入。' }); send({}, 'stop'); }
      else {
        const payload = JSON.parse(lastUser.slice(lastUser.indexOf(marker) + marker.length).trim()) as { reportPath: string; readyPath: string; releasePath: string; content: string };
        const script = `import time\nfrom pathlib import Path\nPath(${JSON.stringify(payload.readyPath)}).write_text('ready')\nwhile not Path(${JSON.stringify(payload.releasePath)}).exists():\n time.sleep(.02)\ntime.sleep(.15)\nPath(${JSON.stringify(payload.reportPath)}).write_text(${JSON.stringify(payload.content)},encoding='utf-8')\n`;
        const quote = (value: string) => "'" + value.replaceAll("'", "'\\''") + "'";
        const command = `(python3 -c ${quote(script)}; background_exit_code=$?; printf '%s\\n' "$background_exit_code" > ${quote(payload.readyPath + '.exit')}) >/dev/null 2>${quote(payload.readyPath + '.stderr')} & echo background-started`;
        send({ tool_calls: [{ index: 0, id: 'delayed-report-background', type: 'function', function: { name: 'bash', arguments: JSON.stringify({ command }) } }] }); send({}, 'tool_calls');
      }
      response.write('data: [DONE]\n\n'); response.end();
    } catch (error) { response.destroy(error instanceof Error ? error : undefined); }
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('Delayed background provider address missing.');
  return { ...normal, baseUrl: `http://127.0.0.1:${address.port}/v1`, close: async () => { await new Promise<void>(resolve => { server.close(() => resolve()); server.closeAllConnections(); }); await normal.close(); } };
}

function backgroundVerifierProvider(stage: 'compare' | 'recheck', onHandoff: (closed: boolean) => void): typeof startAutomaticProvider {
  return async options => {
    const normal = await startAutomaticProvider(options), marker = stage === 'compare' ? '首次回复已保存。现在开放以下固定作者副本' : '修订复查（已知作者信息，不是新冷读）';
    const server = createServer(async (request, response) => {
      try {
        const chunks: Buffer[] = []; for await (const chunk of request) chunks.push(Buffer.from(chunk));
        const body = JSON.parse(Buffer.concat(chunks).toString()) as AutomaticProviderRequest['body'];
        const content = body.messages?.filter(message => message.role === 'user').at(-1)?.content;
        const lastUser = typeof content === 'string' ? content : Array.isArray(content) ? content.map(part => part?.text ?? '').join('\n') : '';
        if (!lastUser.includes(marker)) {
          const authorPrefix = '自动核算意见已交回原主Agent\n';
          if (lastUser.includes(authorPrefix) && body.messages?.at(-1)?.role !== 'tool') {
            const supplied = JSON.parse(lastUser.slice(lastUser.indexOf(authorPrefix) + authorPrefix.length));
            if (supplied.authorTurn.number === (stage === 'compare' ? 1 : 2)) {
              const record = JSON.parse(await readFile(path.join(path.dirname(path.dirname(supplied.coldResult.file)), 'record.json'), 'utf8'));
              const entries = (await readFile(record.native.sessionFile, 'utf8')).trim().split('\n').map(line => JSON.parse(line));
              const opened = entries.find(entry => entry.customType === 'optracall.execution' && entry.data?.phase === 'opened' && entry.data.scopeId.endsWith(stage === 'compare' ? '-compare' : '-recheck-1'));
              onHandoff(Boolean(opened && entries.some(entry => entry.customType === 'optracall.execution' && entry.data?.phase === 'closed' && entry.data.executionId === opened.data.executionId)));
            }
          }
          const upstream = await fetch(normal.baseUrl.replace(/\/v1$/, '') + request.url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
          response.writeHead(upstream.status, { 'Content-Type': upstream.headers.get('content-type') ?? 'text/event-stream' });
          if (upstream.body) for await (const bytes of upstream.body) response.write(bytes);
          response.end(); return;
        }
        const toolReply = body.messages?.at(-1)?.role === 'tool';
        const record: AutomaticProviderRequest = { method: request.method ?? '', path: request.url ?? '', body, stage, lastUser, toolReply, closedEarly: false };
        normal.requests.push(record); response.on('close', () => { record.closedEarly = !response.writableEnded; });
        response.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store' });
        const send = (delta: unknown, finish: string | null = null) => response.write(`data: ${JSON.stringify({ id: `background-${stage}-${normal.requests.length}`, object: 'chat.completion.chunk', created: 1, model: body.model, choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`);
        send({ role: 'assistant', content: '' });
        if (toolReply) { send({ content: '合成核算本轮回复已结束，后台材料仍待收尾；只验证技术交接。' }); send({}, 'stop'); }
        else {
          const script = "import time\nfrom pathlib import Path\nPath('handoff-ready').write_text('ready')\ndeadline=time.monotonic()+30\nwhile not Path('handoff-release').exists() and time.monotonic()<deadline:\n time.sleep(.02)\nPath('handoff-done').write_text('complete')\n";
          const command = "python3 -c '" + script.replaceAll("'", "'\\''") + "' >/dev/null 2>&1 & echo verifier-background-started";
          send({ tool_calls: [{ index: 0, id: `background-${stage}`, type: 'function', function: { name: 'bash', arguments: JSON.stringify({ command }) } }] }); send({}, 'tool_calls');
        }
        response.write('data: [DONE]\n\n'); response.end();
      } catch (error) { response.destroy(error instanceof Error ? error : undefined); }
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const address = server.address(); if (!address || typeof address === 'string') throw new Error('Background verifier address missing.');
    return { ...normal, baseUrl: `http://127.0.0.1:${address.port}/v1`, close: async () => { await new Promise<void>(resolve => { server.close(() => resolve()); server.closeAllConnections(); }); await normal.close(); } };
  };
}

for (const stage of ['compare', 'recheck'] as const) test(`AV06 ${stage} background work is drained and closed before the next author handoff`, { timeout: 120000 }, async t => {
  const handoffs: boolean[] = [], f = await fixture('repair', t.name, backgroundVerifierProvider(stage, closed => handoffs.push(closed))); t.after(() => f.close());
  if (!await requireAutomatic(t, f)) return;
  await readJson(await f.host.request(`${f.route}/settings`, 'PUT', { expectedRevision: 0, settings: { ...f.settings, maxAuthorTurns: 2 } }));
  const requestId = await f.writeInitial();
  const chains = await until(f.list, values => values.some(value => value.steps.some(step => step.phase === stage && step.status === 'completed')), `${stage} SDK reply completion`);
  const chain = chains.find(value => value.requestId === requestId)!;
  const work = path.join(f.host.dataRoot, 'automatic-verifications', f.project.id, f.task.id, 'chains', chain.chainId, 'work', stage === 'compare' ? 'compare' : 'recheck-1', 'work');
  const release = path.join(work, 'handoff-release');
  try {
    // Shell exit and SDK reply can precede the background interpreter's first
    // write. Wait for its actual handshake before testing the handoff barrier.
    assert.equal(await until(() => readFile(path.join(work, 'handoff-ready'), 'utf8').catch(error => {
      if (error?.code === 'ENOENT') return '';
      throw error;
    }), value => value === 'ready', `${stage} background verifier ready`), 'ready');
    await assert.rejects(readFile(path.join(work, 'handoff-done')), { code: 'ENOENT' });
    await new Promise(resolve => setTimeout(resolve, 150));
    assert.equal(f.provider.requests.filter(value => value.stage === 'author' && !value.toolReply).length, stage === 'compare' ? 0 : 1, 'a completed SDK reply cannot hand active background writers to another Agent');
    assert.equal((await readJson(await f.host.request(`${f.route}/status`))).busy, true);
    await writeFile(release, 'continue');
    const finished = await f.completed(requestId);
    assert.equal(finished.state, 'completed', JSON.stringify(finished));
    assert.equal(await readFile(path.join(work, 'handoff-done'), 'utf8'), 'complete');
    assert.deepEqual(finished.steps.map(step => step.phase), ['cold', 'compare', 'author', 'recheck', 'author']);
    assert.deepEqual(handoffs, [true], 'at the actual next-author request, the prior verifier execution must already have its matching SDK close receipt');
    const record = JSON.parse(await readFile(path.join(f.host.dataRoot, 'analysis-verifications', f.project.id, f.task.id, finished.firstVerification!.verificationId, 'record.json'), 'utf8'));
    const entries = (await readFile(record.native.sessionFile, 'utf8')).trim().split('\n').map(line => JSON.parse(line));
    const opened = entries.find(entry => entry.customType === 'optracall.execution' && entry.data?.phase === 'opened' && entry.data.scopeId.endsWith(stage === 'compare' ? '-compare' : '-recheck-1'));
    assert.ok(opened);
    assert.ok(entries.some(entry => entry.customType === 'optracall.execution' && entry.data?.phase === 'closed' && entry.data.executionId === opened.data.executionId));
    assert.equal(await readFile(f.reportPath, 'utf8'), author);
  } finally { await writeFile(release, 'continue').catch(() => {}); }
});

test('AV07 task GET and event snapshots stay busy through cold handoff and reliably return idle after the public lease finishes', { timeout: 120000 }, async t => {
  const f = await fixture('retain', t.name); t.after(() => f.close());
  if (!await requireAutomatic(t, f)) return;
  await readJson(await f.host.request(`${f.route}/settings`, 'PUT', { expectedRevision: 0, settings: f.settings }));
  const controller = new AbortController(), events: any[] = [];
  const response = await f.host.request(`${f.taskRoute}/events`, 'GET', undefined, controller.signal), reader = response.body!.getReader();
  const observing = (async () => {
    const decoder = new TextDecoder(); let pending = '';
    for (;;) { const chunk = await reader.read(); if (chunk.done) return; pending += decoder.decode(chunk.value, { stream: true }); const lines = pending.split('\n'); pending = lines.pop()!; for (const line of lines) if (line.startsWith('data: ')) events.push(JSON.parse(line.slice(6))); }
  })().catch(() => {});
  try {
    f.provider.holdCold(); const requestId = await f.writeInitial(); await f.provider.waitForStage('cold');
    assert.equal((await f.readTask()).snapshot.status, 'running');
    assert.equal((await readJson(await f.host.request(`${f.route}/status`))).busy, true);
    const boundary = events.length;
    await readJson(await f.host.request(`${f.taskRoute}/messages`, 'POST', { requestId: randomUUID(), text: 'Must remain busy until the original public operation ends.' }), 409);
    f.provider.releaseCold(); await f.completed(requestId);
    await until(f.readTask, value => value.snapshot.status === 'idle', 'public operation idle snapshot');
    await until(async () => events.slice(boundary), values => values.some(value => value.type === 'snapshot' && value.snapshot.status === 'idle'), 'final idle event after cold handoff');
    assert.equal((await readJson(await f.host.request(`${f.route}/status`))).busy, false);
  } finally { f.provider.releaseCold(); controller.abort(); await observing; }
});

test('AV03 managed background report created after the SDK turn settles is drained before automatic material observation', { timeout: 120000 }, async t => {
  const f = await fixture('retain', t.name, startDelayedReportProvider); t.after(() => f.close());
  if (!await requireAutomatic(t, f)) return;
  await readJson(await f.host.request(`${f.route}/settings`, 'PUT', { expectedRevision: 0, settings: f.settings }));
  const readyPath = path.join(f.project.rootPath, '020_clean', 'background-ready.txt'), releasePath = path.join(f.project.rootPath, '020_clean', 'background-release.txt');
  const report = '# 后台合成报告\n\n退款反事实：1,900元。\n';
  const requestId = await f.send(`AUTOMATIC_DELAYED_BACKGROUND_REPORT\n${JSON.stringify({ reportPath: f.reportPath, readyPath, releasePath, content: report })}`);
  const settled = await until(f.readTask, value => value.task.lastRun?.id === requestId && value.task.lastRun.status === 'completed', 'SDK turn completed before its background report');
  const readBackgroundText = async (file: string) => {
    try { return await readFile(file, 'utf8'); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error; }
  };
  // Shell completion does not acknowledge asynchronous Python startup. Keep
  // its diagnostics, then observe readiness without releasing its report gate.
  const background = await until(async () => ({
    ready: await readBackgroundText(readyPath),
    stderr: await readBackgroundText(readyPath + '.stderr'),
    exitCode: await readBackgroundText(readyPath + '.exit'),
  }), value => value.ready === 'ready' || Boolean(value.exitCode?.trim()), 'Python background readiness (null exitCode means no exit observed)');
  assert.equal(background.ready, 'ready', `the actual SDK bash tool must start the Python background process: ${JSON.stringify(background)}`);
  const nativeBeforeReport = await readFile(settled.task.sessionFile, 'utf8');
  assert.ok(nativeBeforeReport.trim().split('\n').map(line => JSON.parse(line)).some(entry => entry.customType === 'optracall.run' && entry.data?.requestId === requestId && entry.data.phase === 'settled' && entry.data.outcome === 'completed'));
  await assert.rejects(readFile(f.reportPath), { code: 'ENOENT' });
  assert.equal((await readJson(await f.host.request(`${f.route}/status`))).busy, true, 'the public lease must retain the still-running background writer');
  assert.deepEqual(await f.list(), []);
  assert.equal(f.provider.requests.filter(value => value.stage !== 'ordinary').length, 0);
  // This is only a coordination input in the isolated test project. Python,
  // reached through the real SDK bash tool, is the sole report author.
  await writeFile(releasePath, 'continue');
  const chain = await f.completed(requestId);
  assert.equal(chain.state, 'completed', JSON.stringify(chain)); assert.equal(chain.reason, 'no_new_report');
  assert.deepEqual(chain.steps.map(step => step.phase), ['cold', 'compare', 'author']);
  assert.equal(await readFile(f.reportPath, 'utf8'), report);
  assert.equal(chain.reportSha256, sha(report)); assert.equal(chain.versions[0]?.sha256, sha(report));
  const observation = (await readJson(await f.host.request(`${f.route}/status`))).observation;
  assert.equal(observation.before.exists, false); assert.equal(observation.after.sha256, sha(report));
  const closedPrefix = (await readFile(chain.native.sessionFile)).subarray(0, chain.native.bytes).toString();
  assert.ok(closedPrefix.trim().split('\n').map(line => JSON.parse(line)).some(entry => entry.customType === 'optracall.execution' && entry.data?.phase === 'closed' && entry.data.profile === 'ordinary'), 'the frozen native identity includes the real ordinary-scope close receipt');
  assert.equal(await readFile(path.join(f.project.rootPath, '020_clean/source.csv'), 'utf8'), source);
});

async function assertConcurrencyNonTrigger(f: Awaited<ReturnType<typeof fixture>>, requestId: string) {
  await until(f.readTask, value => value.task.lastRun?.id === requestId && value.task.lastRun.status === 'completed', 'ordinary completion during project concurrency');
  const status = await until(async () => readJson(await f.host.request(`${f.route}/status`)), value => value.observation?.requestId === requestId && value.observation.reason === 'external_change', 'project concurrency observation');
  assert.equal(status.observation.after.exists, true);
  assert.equal(status.observation.chainId, undefined, 'ambiguous shared-project ownership must stop before chain creation');
  assert.deepEqual(await f.list(), []);
  assert.equal(f.provider.requests.filter(value => value.stage !== 'ordinary').length, 0, 'no cold, compare, author or recheck request may be dispatched');
  const taskBefore = (await f.readTask()).task, nativeBefore = await readFile(taskBefore.sessionFile), count = f.provider.requests.length;
  await readJson(await f.host.request(`${f.route}/status`)); await f.list();
  assert.deepEqual((await f.readTask()).task, taskBefore, 'read-only observation cannot alter the completed ordinary request');
  assert.deepEqual(await readFile(taskBefore.sessionFile), nativeBefore, 'read-only observation cannot append a hidden Agent turn');
  assert.equal(f.provider.requests.length, count);
  return status.observation;
}

test('AV02 same-project task B overwriting the selected report prevents automatic dispatch while both ordinary requests complete', { timeout: 120000 }, async t => {
  const f = await fixture('repair', t.name); t.after(() => f.close());
  if (!await requireAutomatic(t, f)) return;
  const { task: otherTask } = await readJson(await f.host.request(`/api/projects/${f.project.id}/tasks`, 'POST', { name: '同项目并发作者B' }), 201);
  const otherRoute = `/api/projects/${f.project.id}/tasks/${otherTask.id}`;
  await readJson(await f.host.request(`${f.route}/settings`, 'PUT', { expectedRevision: 0, settings: f.settings }));
  await f.warmup();
  f.provider.holdOrdinaryReplies();
  const requestId = await f.writeInitial(); await f.provider.waitForStage('ordinary', 3);
  const otherText = '# 同项目任务B报告\n\n此文件由另一普通任务写入。\n', otherRequestId = randomUUID();
  await readJson(await f.host.request(`${otherRoute}/messages`, 'POST', { requestId: otherRequestId, text: `${AUTOMATIC_INITIAL_MARKER}\n${JSON.stringify({ reportPath: f.reportPath, content: otherText })}\n通过原生write工具写入任务B报告。` }), 202);
  await f.provider.waitForStage('ordinary', 5);
  assert.equal(await readFile(f.reportPath, 'utf8'), otherText, 'task B actually overwrote the selected shared path through the real SDK tool');
  f.provider.releaseOrdinaryReplies();
  await until(() => f.host.request(otherRoute).then(readJson), value => value.task.lastRun?.id === otherRequestId && value.task.lastRun.status === 'completed', 'other ordinary completion');
  await assertConcurrencyNonTrigger(f, requestId);
  assert.equal(await readFile(f.reportPath, 'utf8'), otherText);
  assert.equal(await readFile(path.join(f.project.rootPath, '020_clean/source.csv'), 'utf8'), source);
});

test('AV02 same-byte user replacement of a selected source through upload during the ordinary observation window prevents automatic dispatch', { timeout: 120000 }, async t => {
  const f = await fixture('repair', t.name); t.after(() => f.close());
  if (!await requireAutomatic(t, f)) return;
  await readJson(await f.host.request(`${f.route}/settings`, 'PUT', { expectedRevision: 0, settings: f.settings }));
  await f.warmup();
  f.provider.holdOrdinaryReplies();
  const requestId = await f.writeInitial(); await f.provider.waitForStage('ordinary', 3);
  const before = await readFile(path.join(f.project.rootPath, '020_clean/source.csv'));
  // Upload preserves existing names. Simulate an external user replacing this
  // isolated synthetic file, then use the real upload entry to restore exactly
  // the selected path; an unselected auto-renamed sibling is not this case.
  await unlink(path.join(f.project.rootPath, '020_clean/source.csv'));
  const uploaded = await readJson(await f.host.request(`/api/projects/${f.project.id}/files/upload`, 'POST', { directory: '020_clean', name: 'source.csv', content: before.toString('base64') }), 201);
  assert.equal(uploaded.file.path, '020_clean/source.csv', 'the actual user upload must occupy the selected path');
  assert.deepEqual(await readFile(path.join(f.project.rootPath, '020_clean/source.csv')), before, 'the overwrite deliberately preserves the SHA and bytes');
  assert.equal((await f.readTask()).task.lastRun.status, 'running', 'the user upload cannot cancel the ordinary Agent request');
  f.provider.releaseOrdinaryReplies();
  await assertConcurrencyNonTrigger(f, requestId);
  assert.equal(await readFile(f.reportPath, 'utf8'), author);
  assert.deepEqual(await readFile(path.join(f.project.rootPath, '020_clean/source.csv')), before);
});

test('AV02 an earlier running unmanaged project task prevents a new automatic request before model dispatch', { timeout: 120000 }, async t => {
  const f = await fixture('repair', t.name); t.after(() => f.close());
  if (!await requireAutomatic(t, f)) return;
  const { task: otherTask } = await readJson(await f.host.request(`/api/projects/${f.project.id}/tasks`, 'POST', { name: '跨准入窗口任务B' }), 201);
  const otherRoute = `/api/projects/${f.project.id}/tasks/${otherTask.id}`, otherRequestId = randomUUID();
  await readJson(await f.host.request(`${f.route}/settings`, 'PUT', { expectedRevision: 0, settings: f.settings }));
  const original = await f.warmup();
  f.provider.holdOrdinaryReplies();
  await readJson(await f.host.request(`${otherRoute}/messages`, 'POST', { requestId: otherRequestId, text: `${AUTOMATIC_INITIAL_MARKER}\n${JSON.stringify({ reportPath: path.join(f.project.rootPath, '060_reports/before-admission.md'), content: '# 任务B独立普通产物\n' })}` }), 202);
  await f.provider.waitForStage('ordinary', 3);
  const otherStarted = (await readJson(await f.host.request(otherRoute))).task.lastRun.startedAt;
  const requestId = randomUUID(), attemptedAt = new Date().toISOString(), count = f.provider.requests.length;
  const rejected = await readJson(await f.host.request(`${f.taskRoute}/messages`, 'POST', { requestId, text: 'An earlier unmanaged writer must prevent this automatic request.' }), 409);
  assert.equal(rejected.code, 'automatic_unmanaged_history');
  assert.ok(Date.parse(otherStarted) < Date.parse(attemptedAt));
  assert.equal(f.provider.requests.length, count);
  assert.equal((await readJson(await f.host.request(otherRoute))).task.lastRun.status, 'running', 'a blocked request cannot cancel the other owner');
  await readJson(await f.host.request(`${otherRoute}/stop`, 'POST', {}));
  const settled = await until(() => f.host.request(otherRoute).then(readJson), value => value.task.lastRun?.id === otherRequestId && value.task.lastRun.status !== 'running', 'earlier other task settlement');
  assert.ok(Date.parse(settled.task.lastRun.settledAt) >= Date.parse(attemptedAt));
  f.provider.releaseOrdinaryReplies();
  assert.deepEqual(await f.list(), []);
  assert.notEqual((await readJson(await f.host.request(`${f.route}/status`))).observation?.requestId, requestId, 'a refused request cannot invent an admission observation');
  assert.deepEqual(await readFile(original.native), original.bytes);
  assert.equal(f.provider.requests.filter(value => value.stage !== 'ordinary').length, 0);
});

test('AV02 known unmanaged project writers prevent enabling automation even after their ordinary request completed', { timeout: 120000 }, async t => {
  const f = await fixture('repair', t.name); t.after(() => f.close());
  if (!await requireAutomatic(t, f)) return;
  const { task: otherTask } = await readJson(await f.host.request(`/api/projects/${f.project.id}/tasks`, 'POST', { name: '已结束的未托管任务B' }), 201);
  const otherRoute = `/api/projects/${f.project.id}/tasks/${otherTask.id}`, otherRequestId = randomUUID();
  await readJson(await f.host.request(`${otherRoute}/messages`, 'POST', { requestId: otherRequestId, text: AUTOMATIC_WARMUP_MARKER }), 202);
  const prior = await until(() => f.host.request(otherRoute).then(readJson), value => value.task.lastRun?.status === 'completed', 'earlier unmanaged ordinary request');
  const capability = await readJson(await f.host.request(`${f.route}/capabilities`));
  assert.equal(capability.supported, false); assert.match(capability.reason, /项目/);
  const blocked = await readJson(await f.host.request(`${f.route}/settings`, 'PUT', { expectedRevision: 0, settings: f.settings }), 409);
  assert.equal(blocked.code, 'automatic_unmanaged_history');
  assert.equal((await readJson(await f.host.request(`${f.route}/settings`))).settings.enabled, false);
  const requestId = await f.writeInitial();
  await until(f.readTask, value => value.task.lastRun?.id === requestId && value.task.lastRun.status === 'completed', 'default-off ordinary analysis still runs');
  assert.deepEqual(await f.list(), []);
  assert.equal((await readJson(await f.host.request(`${f.route}/status`))).observation, undefined);
  assert.equal(f.provider.requests.filter(value => value.stage !== 'ordinary').length, 0);
  assert.equal(await readFile(f.reportPath, 'utf8'), author);
  assert.deepEqual((await readJson(await f.host.request(otherRoute))).task.lastRun, prior.task.lastRun, 'the blocker does not cancel or rewrite another owner');
});

test('AV08 complete-looking managed native receipts cannot self-certify automatic eligibility after Host restart', { timeout: 120000 }, async t => {
  const f = await fixture('repair', t.name); t.after(() => f.close());
  if (!await requireAutomatic(t, f)) return;
  await readJson(await f.host.request(`${f.route}/settings`, 'PUT', { expectedRevision: 0, settings: f.settings }));
  const original = await f.warmup(), nativeBefore = await readFile(original.native);
  assert.match(nativeBefore.toString(), /optracall.execution/);
  assert.match(nativeBefore.toString(), /"phase":"closed"/);
  await f.host.close();
  const reopened = await startTestHost({ dataRoot: f.host.dataRoot, projectsRoot: f.host.projectsRoot }); t.after(() => reopened.close());
  assert.equal((await readJson(await reopened.request(`${f.route}/capabilities`))).supported, false);
  const count = f.provider.requests.length;
  await readJson(await reopened.request(`${f.taskRoute}/messages`, 'POST', { requestId: randomUUID(), text: 'Do not promote unknown old execution from native JSON.' }), 409);
  assert.equal(f.provider.requests.length, count);
  assert.deepEqual(await readFile(original.native), nativeBefore);
  assert.equal((await readJson(await reopened.request(`${f.route}/settings`))).settings.enabled, true, 'restart preserves the setting rather than rewriting history');
});

test('AV02 a new task cannot enable automation by certifying unknown old owners of the same project after Host restart', { timeout: 120000 }, async t => {
  const f = await fixture('repair', t.name); t.after(() => f.close());
  if (!await requireAutomatic(t, f)) return;
  await f.host.close();
  const reopened = await startTestHost({ dataRoot: f.host.dataRoot, projectsRoot: f.host.projectsRoot }); t.after(() => reopened.close());
  const { task } = await readJson(await reopened.request(`/api/projects/${f.project.id}/tasks`, 'POST', { name: '重启后新受管任务A' }), 201);
  const taskRoute = `/api/projects/${f.project.id}/tasks/${task.id}`, route = `${taskRoute}/automatic-verification`;
  assert.equal((await readJson(await reopened.request(`${route}/capabilities`))).supported, false);
  const blocked = await readJson(await reopened.request(`${route}/settings`, 'PUT', { expectedRevision: 0, settings: f.settings }), 409);
  assert.equal(blocked.code, 'automatic_unmanaged_history');
  assert.equal((await readJson(await reopened.request(`${route}/status`))).observation, undefined);
  assert.deepEqual((await readJson(await reopened.request(`${route}/chains`))).chains, []);
  assert.equal(f.provider.requests.length, 0);
  assert.equal((await readJson(await reopened.request(f.taskRoute))).task.sessionFile, undefined, 'the old task is left intact; absence of native alone was not used as clearance');
});

test('AV01 default-off ordinary analysis writes its own report through the real native SDK without verification dispatch', { timeout: 60000 }, async t => {
  const f = await fixture('repair', t.name); t.after(() => f.close());
  const settings = await readJson(await f.host.request(`${f.route}/settings`));
  assert.equal(settings.settings.enabled, false);
  const id = await f.writeInitial();
  await until(f.readTask, value => value.task.lastRun?.id === id && value.task.lastRun.status === 'completed', 'ordinary report');
  assert.equal(await readFile(f.reportPath, 'utf8'), author);
  assert.equal(f.provider.requests.filter(value => value.stage === 'ordinary').length, 2);
  assert.equal(f.provider.requests.filter(value => value.stage !== 'ordinary').length, 0);
  assert.deepEqual(await f.list(), []);
  assert.equal(await readFile(path.join(f.project.rootPath, '020_clean/source.csv'), 'utf8'), source);
});

test('AV02 unsupported platforms refuse automatic protection rather than fall back to unrestricted execution', { timeout: 60000 }, async t => {
  const f = await fixture('repair', t.name); t.after(() => f.close());
  const capability = await readJson(await f.host.request(`${f.route}/capabilities`));
  if (capability.supported) { t.skip('This OS and fresh owner support the managed execution profile.'); return; }
  assert.equal(capability.supported, false);
  const response = await f.host.request(`${f.route}/settings`, 'PUT', { expectedRevision: 0, settings: f.settings });
  assert.ok(response.status >= 400, 'unsupported protection cannot enable automatic execution');
  assert.equal(f.provider.requests.length, 0);
  assert.deepEqual(await f.list(), []);
});

test('AV08 saved enabled settings cannot upgrade an already constructed unmanaged owner; disabling preserves ordinary analysis', { timeout: 60000 }, async t => {
  const f = await fixture('repair', t.name); t.after(() => f.close());
  const original = await f.warmup();
  const store = createAutomaticVerificationStore({ dataRoot: f.host.dataRoot });
  const saved = await store.saveSettings({ projectId: f.project.id, taskId: f.task.id }, f.settings, 0);
  await readJson(await f.host.request(`${f.taskRoute}/messages`, 'POST', { requestId: randomUUID(), text: 'Old enabled settings must not bypass unmanaged history.' }), 409);
  assert.equal((await readJson(await f.host.request(`${f.route}/settings`))).settings.revision, saved.revision);
  assert.deepEqual(await f.list(), []);
  assert.equal(f.provider.requests.length, 1); assert.ok(f.provider.requests.every(value => value.stage === 'ordinary'));
  assert.deepEqual((await readFile(original.native)).subarray(0, original.bytes.length), original.bytes);
  await readJson(await f.host.request(`${f.route}/settings`, 'PUT', { expectedRevision: 1, settings: f.settings }), 409);
  assert.equal((await readJson(await f.host.request(`${f.route}/settings`))).settings.revision, 1);
  await readJson(await f.host.request(`${f.route}/settings`, 'PUT', { expectedRevision: 1, settings: { enabled: false } }));
  assert.equal((await readJson(await f.host.request(`${f.route}/settings`))).settings.enabled, false);
  const id = await f.writeInitial();
  await until(f.readTask, value => value.task.lastRun?.id === id && value.task.lastRun.status === 'completed', 'disabled automatic setting restores ordinary analysis');
  assert.equal(await readFile(f.reportPath, 'utf8'), author);
  assert.equal(f.provider.requests.length, 3);
});

test('AV03–09 real SDK automatically cold-checks, returns to same main session, writes a new draft and rechecks its exact version', { timeout: 120000 }, async t => {
  const f = await fixture('repair', t.name); t.after(() => f.close());
  if (!await requireAutomatic(t, f)) return;
  const saved = await readJson(await f.host.request(`${f.route}/settings`, 'PUT', { expectedRevision: 0, settings: f.settings }));
  const original = await f.warmup(), header = JSON.parse(original.bytes.toString().split('\n')[0]!);
  assert.equal(saved.settings.revision, 1);
  const requestId = await f.writeInitial();
  const chain = await f.completed();
  assert.equal(chain.state, 'completed', JSON.stringify(chain));
  assert.equal(chain.reason, 'limit_reached');
  assert.equal(chain.requestId, requestId);
  assert.equal(chain.authorAccepted, 1);
  assert.deepEqual(chain.steps.map(step => step.phase), ['cold', 'compare', 'author', 'recheck']);
  assert.equal(chain.versions.length, 2);
  const revised = chain.versions[1]!;
  assert.equal(revised.recheckRequestId, chain.steps.find(step => step.phase === 'recheck')?.requestId);
  assert.equal(revised.requestId, chain.steps.find(step => step.phase === 'author')?.requestId);
  assert.notEqual(revised.relativePath, '060_reports/initial.md');
  const revisedText = await readFile(path.join(f.project.rootPath, revised.relativePath), 'utf8');
  assert.match(revisedText, /1,900/);
  assert.equal(sha(revisedText), revised.sha256);
  assert.equal(await readFile(f.reportPath, 'utf8'), author);
  assert.equal(await readFile(path.join(f.project.rootPath, '020_clean/source.csv'), 'utf8'), source);
  const after = await f.readTask();
  assert.equal(after.task.sessionFile, original.native);
  const native = await readFile(original.native);
  assert.deepEqual(native.subarray(0, original.bytes.length), original.bytes);
  assert.equal(JSON.parse(native.toString().split('\n')[0]!).id, header.id);
  assert.match(native.toString(), /automatic-author-feedback/);
  const cold = f.provider.requests.find(value => value.stage === 'cold')!;
  assert.ok(!JSON.stringify(cold.body.messages).includes('退款反事实：2,120元'), 'cold reader has no author answer');
  assert.ok(f.provider.requests.some(value => value.stage === 'author' && !value.toolReply && value.lastUser.includes('automatic-author-feedback')));
  assert.equal(f.provider.requests.filter(value => value.stage === 'recheck').length, 1);
  const beforeReads = f.provider.requests.length;
  await f.list(); await f.readChain(chain.chainId); await readJson(await f.host.request(`${f.route}/status`));
  assert.equal(f.provider.requests.length, beforeReads, 'GET only observes and cannot dispatch another turn');
});

test('AV05 a predefined main-agent rejection of a synthetic false positive preserves the correct draft without inventing a revision', { timeout: 120000 }, async t => {
  const f = await fixture('retain', t.name); t.after(() => f.close());
  if (!await requireAutomatic(t, f)) return;
  await readJson(await f.host.request(`${f.route}/settings`, 'PUT', { expectedRevision: 0, settings: f.settings }));
  await f.warmup();
  const correct = '# 合成原正确稿\n\n退款反事实：1,900元。\n';
  await f.writeInitial(correct);
  const chain = await f.completed();
  assert.equal(chain.state, 'completed', JSON.stringify(chain));
  assert.equal(chain.reason, 'no_new_report');
  assert.equal(chain.authorAccepted, 1);
  assert.equal(chain.versions.length, 1);
  assert.equal(await readFile(f.reportPath, 'utf8'), correct);
  assert.equal(f.provider.requests.filter(value => value.stage === 'recheck').length, 0);
  assert.ok(chain.steps.some(step => step.phase === 'author' && step.status === 'completed'));
});

test('AV07 stop during synthetic cold streaming revokes later author delivery; subsequent reads do not restart it', { timeout: 120000 }, async t => {
  const f = await fixture('repair', t.name); t.after(() => f.close());
  if (!await requireAutomatic(t, f)) return;
  await readJson(await f.host.request(`${f.route}/settings`, 'PUT', { expectedRevision: 0, settings: f.settings }));
  await f.warmup(); f.provider.holdCold();
  await f.writeInitial(); await f.provider.waitForStage('cold');
  const chains = await until(f.list, values => values.length > 0, 'cold chain');
  const stopped = await readJson(await f.host.request(`${f.route}/chains/${chains[0]!.chainId}/stop`, 'POST', {}));
  assert.equal(stopped.chain.state, 'cancelled');
  f.provider.releaseCold();
  await until(() => f.readChain(chains[0]!.chainId), value => value.state === 'cancelled', 'cancelled chain');
  const beforeReads = f.provider.requests.length;
  await f.readChain(chains[0]!.chainId); await f.list(); await readJson(await f.host.request(`${f.route}/status`));
  assert.equal(f.provider.requests.length, beforeReads);
  assert.equal(f.provider.requests.filter(value => value.stage === 'compare' || value.stage === 'author' || value.stage === 'recheck').length, 0);
  assert.equal(await readFile(f.reportPath, 'utf8'), author);
  assert.equal(await readFile(path.join(f.project.rootPath, '020_clean/source.csv'), 'utf8'), source);
});

test('AV02 changing automatic settings while ordinary analysis is in flight does not cancel that analysis or retroactively dispatch', { timeout: 120000 }, async t => {
  const f = await fixture('repair', t.name); t.after(() => f.close());
  if (!await requireAutomatic(t, f)) return;
  await readJson(await f.host.request(`${f.route}/settings`, 'PUT', { expectedRevision: 0, settings: f.settings }));
  await f.warmup();
  f.provider.holdOrdinaryReplies();
  const requestId = await f.writeInitial();
  await f.provider.waitForStage('ordinary', 3);
  const before = await f.readTask();
  assert.equal(before.task.lastRun.id, requestId);
  assert.equal(before.task.lastRun.status, 'running');
  await readJson(await f.host.request(`${f.route}/settings`, 'PUT', { expectedRevision: 1, settings: { ...f.settings, enabled: false } }));
  assert.equal((await f.readTask()).task.lastRun.status, 'running', 'saving automatic settings must not cancel the ordinary request');
  assert.equal(f.provider.requests.at(-1)?.closedEarly, false);
  f.provider.releaseOrdinaryReplies();
  await until(f.readTask, value => value.task.lastRun.id === requestId && value.task.lastRun.status === 'completed', 'ordinary completion after disabling automation');
  const status = await until(async () => readJson(await f.host.request(`${f.route}/status`)), value => value.observation?.reason === 'settings_changed', 'settings change observation');
  assert.equal(status.observation.settingsSnapshot.enabled, true, 'admission keeps original policy snapshot');
  assert.equal(status.observation.settingsSnapshot.revision, 1);
  assert.deepEqual(await f.list(), []);
  assert.equal(f.provider.requests.filter(value => value.stage !== 'ordinary').length, 0);
  assert.equal(await readFile(f.reportPath, 'utf8'), author);
});

test('AV07 changing settings during an active automatic cold check pauses that chain without another stage or replay', { timeout: 120000 }, async t => {
  const f = await fixture('repair', t.name); t.after(() => f.close());
  if (!await requireAutomatic(t, f)) return;
  await readJson(await f.host.request(`${f.route}/settings`, 'PUT', { expectedRevision: 0, settings: f.settings }));
  await f.warmup(); f.provider.holdCold();
  await f.writeInitial(); await f.provider.waitForStage('cold');
  const chains = await until(f.list, values => values.length > 0, 'active cold chain');
  await readJson(await f.host.request(`${f.route}/settings`, 'PUT', { expectedRevision: 1, settings: { ...f.settings, enabled: false } }));
  f.provider.releaseCold();
  const paused = await until(() => f.readChain(chains[0]!.chainId), value => value.state === 'paused', 'settings pause');
  assert.equal(paused.reason, 'settings_changed');
  const count = f.provider.requests.length;
  await f.list(); await f.readChain(paused.chainId); await readJson(await f.host.request(`${f.route}/status`));
  assert.equal(f.provider.requests.length, count);
  assert.equal(f.provider.requests.filter(value => value.stage === 'compare' || value.stage === 'author' || value.stage === 'recheck').length, 0);
  assert.equal(paused.settingsSnapshot.revision, 1);
  assert.equal(await readFile(f.reportPath, 'utf8'), author);
});

test('AV03 first analysis of a fresh task records completed native identity and can finish an automatic chain without warmup', { timeout: 120000 }, async t => {
  const f = await fixture('repair', t.name); t.after(() => f.close());
  if (!await requireAutomatic(t, f)) return;
  assert.equal((await f.readTask()).task.sessionFile, undefined);
  await readJson(await f.host.request(`${f.route}/settings`, 'PUT', { expectedRevision: 0, settings: f.settings }));
  const requestId = await f.writeInitial();
  const chain = await f.completed(requestId);
  assert.equal(chain.state, 'completed', JSON.stringify(chain));
  assert.equal(chain.reason, 'limit_reached');
  assert.deepEqual(chain.steps.map(step => step.phase), ['cold', 'compare', 'author', 'recheck']);
  const status = await readJson(await f.host.request(`${f.route}/status`));
  assert.equal(status.observation.requestId, requestId);
  assert.equal(status.observation.native, undefined, 'admission cannot invent a pre-existing native file');
  const task = (await f.readTask()).task;
  assert.equal(status.observation.completedNative.sessionFile, task.sessionFile);
  assert.deepEqual(chain.native, status.observation.completedNative, 'the newly created native prefix is the chain identity');
  const native = await readFile(task.sessionFile);
  assert.equal(JSON.parse(native.toString().split('\n')[0]!).id, chain.native.sessionId);
  assert.equal(sha(native.subarray(0, chain.native.bytes)), chain.native.sha256);
  assert.equal(await readFile(f.reportPath, 'utf8'), author);
  assert.equal(await readFile(path.join(f.project.rootPath, '020_clean/source.csv'), 'utf8'), source);
  assert.equal(f.provider.requests.filter(value => value.stage === 'ordinary').length, 2, 'no warmup request was used');
});

test('AV02 successive explicit report paths create separate immutable chains and ordinary tools recover after protected execution', { timeout: 120000 }, async t => {
  const f = await fixture('repair', t.name); t.after(() => f.close());
  if (!await requireAutomatic(t, f)) return;
  await readJson(await f.host.request(`${f.route}/settings`, 'PUT', { expectedRevision: 0, settings: f.settings }));
  const firstRequestId = await f.writeInitial();
  const first = await f.completed(firstRequestId);
  assert.equal(first.state, 'completed', JSON.stringify(first));
  const taskBefore = (await f.readTask()).task, nativeBefore = await readFile(taskBefore.sessionFile);
  const nativeId = JSON.parse(nativeBefore.toString().split('\n')[0]!).id;
  const secondPath = '060_reports/second-explicit.md';
  const secondText = '# 第二次合成初稿\n\n退款反事实：2,120元；独立新分析。\n';
  const firstAuthorWrite = f.provider.requests.find(value => value.stage === 'author' && value.toolReply)?.body.messages
    ?.flatMap(message => message.tool_calls ?? []).filter(call => call.function.name === 'write').at(-1);
  assert.ok(firstAuthorWrite, 'the protected author produced its draft through the actual native write tool');
  const firstProtectedPath: unknown = JSON.parse(firstAuthorWrite.function.arguments).path;
  assert.ok(typeof firstProtectedPath === 'string');
  assert.notEqual(path.dirname(path.join(f.project.rootPath, secondPath)), path.dirname(firstProtectedPath));
  const saved = await readJson(await f.host.request(`${f.route}/settings`, 'PUT', { expectedRevision: 1, settings: { ...f.settings, reportPath: secondPath } }));
  assert.equal(saved.settings.revision, 2);
  const beforeSecondRequests = f.provider.requests.length;
  const secondRequestId = await f.writeReport(secondPath, secondText);
  const second = await f.completed(secondRequestId);
  assert.equal(second.state, 'completed', JSON.stringify(second));
  assert.equal(second.reason, 'limit_reached');
  assert.notEqual(second.chainId, first.chainId);
  assert.equal(second.settingsSnapshot.revision, 2);
  assert.equal(second.settingsSnapshot.reportPath, secondPath);
  assert.equal(second.versions[0]!.relativePath, secondPath);
  assert.equal(await readFile(path.join(f.project.rootPath, secondPath), 'utf8'), secondText, 'ordinary native write again succeeds outside the previous protected output directory');
  assert.equal(await readFile(f.reportPath, 'utf8'), author);
  assert.equal(await readFile(path.join(f.project.rootPath, '020_clean/source.csv'), 'utf8'), source);
  const subsequent = f.provider.requests.slice(beforeSecondRequests);
  assert.deepEqual(subsequent.filter(value => value.stage !== 'compaction').map(value => value.stage), ['ordinary', 'ordinary', 'cold', 'compare', 'author', 'author', 'recheck']);
  for (const compact of subsequent.filter(value => value.stage === 'compaction')) {
    assert.ok(compact.lastUser.startsWith('<conversation>\n'));
    assert.equal(compact.body.tools?.length ?? 0, 0, 'SDK compaction is a summary request and cannot perform an extra report write');
  }
  assert.equal(subsequent[1]!.toolReply, true);
  const taskAfter = (await f.readTask()).task, nativeAfter = await readFile(taskAfter.sessionFile);
  assert.equal(taskAfter.sessionFile, taskBefore.sessionFile);
  assert.equal(JSON.parse(nativeAfter.toString().split('\n')[0]!).id, nativeId);
  assert.deepEqual(nativeAfter.subarray(0, nativeBefore.length), nativeBefore, 'the original session history is append-only across both chains');
  const requestCount = f.provider.requests.length;
  const { cleanup: _beforeCleanup, ...firstHistory } = first as typeof first & { cleanup?: unknown };
  const { cleanup: _afterCleanup, ...readHistory } = await f.readChain(first.chainId) as typeof first & { cleanup?: unknown };
  assert.deepEqual(readHistory, firstHistory, 'later settings and executions cannot rewrite the first chain or its result references; cleanup is a current read-only projection');
  assert.equal((await f.list()).length, 2);
  await f.readChain(second.chainId); await readJson(await f.host.request(`${f.route}/status`));
  assert.equal(f.provider.requests.length, requestCount, 'historical GETs cannot dispatch or replay either chain');
});
