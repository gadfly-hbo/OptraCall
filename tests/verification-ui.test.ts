import test from 'node:test';
import assert from 'node:assert/strict';
import { startTestHost } from './fixtures/host-process.ts';
import { startSyntheticProvider } from './fixtures/synthetic-provider.ts';
import { prepareJointContext, readJson } from './fixtures/joint-context.ts';
import { downloadVerificationAuthorFile, listVerifications, previewVerification, readSapProvision, readVerification, startVerification, verificationAction, verificationFiles, verificationInputError, VerificationRequestError, VerificationSubmissionUnknown, type VerificationInput, type VerificationRecord } from '../src/host/ui/verification-client.ts';

const id = 'f49f0bb1-20fb-4781-881c-74912c6ab1c0';
const input: VerificationInput = { verificationId: id, question: '核对会员人数', dataFiles: ['020_clean/member.csv'], authorFiles: ['060_reports/report.md'] };
const record: VerificationRecord = { id, projectId: 'project-a', taskId: 'task-a', question: input.question, selection: input, status: 'running', phase: 'cold', createdAt: '2026-10-30T12:00:00Z', updatedAt: '2026-10-30T12:00:00Z' };
const response = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });

test('SV04 submission transport failure only reads the same intent, never posts again', async t => {
  const calls: { url: string; method: string; body?: string }[] = [];
  t.mock.method(globalThis, 'fetch', async (url: string, init: RequestInit) => {
    calls.push({ url: String(url), method: init.method ?? 'GET', body: init.body as string | undefined });
    if (init.method === 'POST') throw new TypeError('connection lost after server accepted');
    return response({ verification: record });
  });
  const result = await startVerification('project-a', 'task-a', input);
  assert.equal(result.id, id);
  assert.deepEqual(calls.map(call => call.method), ['POST', 'GET']);
  assert.equal(calls[1]?.url, `/api/projects/project-a/tasks/task-a/verifications/${id}`);
  assert.equal(JSON.parse(calls[0]!.body!).verificationId, id);
});

test('SV04 uncertain submit preserves its intent when readback is unavailable', async t => {
  const methods: string[] = [];
  t.mock.method(globalThis, 'fetch', async (_url: string, init: RequestInit) => { methods.push(init.method ?? 'GET'); throw new TypeError('network unavailable'); });
  await assert.rejects(startVerification('project-a', 'task-a', input), (error: unknown) => error instanceof VerificationSubmissionUnknown && error.verificationId === id);
  assert.deepEqual(methods, ['POST', 'GET']);
});

test('SV06 another owner cannot be projected into the selected task', async t => {
  t.mock.method(globalThis, 'fetch', async () => response({ verification: { ...record, taskId: 'task-b' } }));
  await assert.rejects(readVerification('project-a', 'task-a', id), /归属或编号不一致/);
});

test('SV08 an input conflict is shown without retrying or hiding it behind a GET', async t => {
  const methods: string[] = [];
  t.mock.method(globalThis, 'fetch', async (_url: string, init: RequestInit) => { methods.push(init.method ?? 'GET'); return response({ code: 'verification_conflict', message: '原核算输入不同' }, 409); });
  await assert.rejects(startVerification('project-a', 'task-a', input), (error: unknown) => error instanceof VerificationRequestError && error.code === 'verification_conflict');
  assert.deepEqual(methods, ['POST']);
});

test('SV08 a server error after acceptance reads the same record once', async t => {
  const methods: string[] = [];
  t.mock.method(globalThis, 'fetch', async (_url: string, init: RequestInit) => { methods.push(init.method ?? 'GET'); return init.method === 'POST' ? response({ code: 'temporary_failure' }, 503) : response({ verification: record }); });
  assert.equal((await startVerification('project-a', 'task-a', input)).id, id);
  assert.deepEqual(methods, ['POST', 'GET']);
});

test('SV06 list reads reject any record for another owner', async t => {
  const methods: string[] = [];
  t.mock.method(globalThis, 'fetch', async (_url: string, init: RequestInit) => { methods.push(init.method ?? 'GET'); return response({ verifications: [record, { ...record, projectId: 'other-project' }] }); });
  await assert.rejects(listVerifications('project-a', 'task-a'), /归属或编号不一致/);
  assert.deepEqual(methods, ['GET']);
});

test('SV05 source choices exclude 010 originals and author/source overlap is refused', () => {
  const choices = verificationFiles([{ kind: 'directory', name: '010_draw', path: '010_draw', children: [{ kind: 'file', name: 'original.csv', path: '010_draw/original.csv' }] }, { kind: 'directory', name: '020_clean', path: '020_clean', children: [{ kind: 'file', name: 'data.csv', path: '020_clean/data.csv' }] }, { kind: 'file', name: 'report.md', path: '060_reports/report.md' }]);
  assert.deepEqual(choices.data.map(file => file.path), ['020_clean/data.csv']);
  assert.deepEqual(choices.authors.map(file => file.path), ['020_clean/data.csv', '060_reports/report.md']);
  assert.match(verificationInputError({ ...input, authorFiles: input.dataFiles }) ?? '', /不能既作为源数据又作为作者产物/);
  assert.match(verificationInputError({ ...input, caseId: 'case-a', caseRevision: 2 }) ?? '', /事前信息/);
  assert.equal(verificationInputError({ ...input, caseId: 'case-a', caseRevision: 2, caseBackgroundIsPrior: true }), undefined);
});

test('SV07 an uncertain action is checked with GET and is never repeated', async t => {
  const methods: string[] = [];
  t.mock.method(globalThis, 'fetch', async (_url: string, init: RequestInit) => { methods.push(init.method ?? 'GET'); if (init.method === 'POST') throw new TypeError('response lost'); return response({ verification: { ...record, exportedFile: '060_reports/verification-report.md' } }); });
  const result = await verificationAction('project-a', 'task-a', id, 'export');
  assert.equal(result.exportedFile, '060_reports/verification-report.md');
  assert.deepEqual(methods, ['POST', 'GET']);
});

test('SV07 successful readback alone does not prove the requested export happened', async t => {
  const methods: string[] = [];
  t.mock.method(globalThis, 'fetch', async (_url: string, init: RequestInit) => { methods.push(init.method ?? 'GET'); if (init.method === 'POST') throw new TypeError('response lost'); return response({ verification: record }); });
  await assert.rejects(verificationAction('project-a', 'task-a', id, 'export'), VerificationSubmissionUnknown);
  assert.deepEqual(methods, ['POST', 'GET']);
});

test('SV04 client enforces the same question and business-context limits as Host', async t => {
  assert.match(verificationInputError({ ...input, question: '问'.repeat(4001) }) ?? '', /4000/);
  assert.match(verificationInputError({ ...input, businessContext: '背'.repeat(12001) }) ?? '', /12000/);
  assert.equal(verificationInputError({ ...input, question: '问'.repeat(4000), businessContext: '背'.repeat(12000) }), undefined);
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => { calls++; return response({ verification: record }); });
  await assert.rejects(startVerification('project-a', 'task-a', { ...input, question: '问'.repeat(4001) }), /4000/);
  assert.equal(calls, 0, 'invalid input must not be sent to Host');
});

test('SV03 preview only calls the preview route and preserves concrete unresolved content', async t => {
  const calls: { url: string; method: string }[] = [];
  const preview = { semantics: { text: '未决：退款按支付月还是退款月归属尚未确认。', sources: [{ kind: 'rap', id: 'rap-a', version: '1.0' }] }, configuration: { id: 'model-a', revision: 2, provider: 'synthetic', model: 'synthetic-model' }, note: '预览不启动模型；开始时重新固定输入' };
  t.mock.method(globalThis, 'fetch', async (url: string, init: RequestInit) => { calls.push({ url: String(url), method: init.method ?? 'GET' }); return response(preview); });
  const result = await previewVerification('project-a', 'task-a', input);
  assert.equal(result.semantics.text, preview.semantics.text);
  assert.deepEqual(calls, [{ url: '/api/projects/project-a/tasks/task-a/verifications/preview', method: 'POST' }]);
});

test('SV03 preview failure never starts or looks up a verification intent', async t => {
  const calls: string[] = [];
  t.mock.method(globalThis, 'fetch', async (url: string) => { calls.push(String(url)); return response({ code: 'preview_unavailable' }, 503); });
  await assert.rejects(previewVerification('project-a', 'task-a', input), (error: unknown) => error instanceof VerificationRequestError && error.code === 'preview_unavailable');
  assert.deepEqual(calls, ['/api/projects/project-a/tasks/task-a/verifications/preview']);
});

test('CR02 start carries the reviewed preview as If-Match without changing the saved selection', async t => {
  const etag = '"' + 'a'.repeat(64) + '"';
  const calls: { headers: Headers; body: unknown }[] = [];
  t.mock.method(globalThis, 'fetch', async (_url: string, init: RequestInit) => {
    calls.push({ headers: new Headers(init.headers), body: JSON.parse(String(init.body)) });
    return response({ verification: record });
  });
  await startVerification('project-a', 'task-a', input, undefined, etag);
  assert.equal(calls.length, 1);
  assert.equal(calls[0]!.headers.get('if-match'), etag);
  assert.deepEqual(calls[0]!.body, input, 'preview identity belongs in the conditional request, not the durable selection');
});

test('CR02 a changed reviewed source is shown as conflict without retry or readback', async t => {
  const methods: string[] = [];
  t.mock.method(globalThis, 'fetch', async (_url: string, init: RequestInit) => {
    methods.push(init.method ?? 'GET');
    return response({ code: 'verification_preview_changed', message: '预览后的材料已变化，请重新预览。' }, 409);
  });
  await assert.rejects(startVerification('project-a', 'task-a', input, undefined, '"' + 'b'.repeat(64) + '"'), (error: unknown) => error instanceof VerificationRequestError && error.code === 'verification_preview_changed');
  assert.deepEqual(methods, ['POST']);
});

test('CR02 a start without prior preview keeps the original request contract', async t => {
  let observed: RequestInit | undefined;
  t.mock.method(globalThis, 'fetch', async (_url: string, init: RequestInit) => { observed = init; return response({ verification: record }); });
  assert.equal((await startVerification('project-a', 'task-a', input)).id, id);
  assert.equal(new Headers(observed?.headers).get('if-match'), null);
  assert.deepEqual(JSON.parse(String(observed?.body)), input);
});

test('CR05 fixed author download errors never save JSON or fall back to the current project file', async t => {
  const urls: string[] = [];
  let blobs = 0;
  t.mock.method(globalThis, 'fetch', async (url: string, init: RequestInit) => {
    urls.push(String(url));
    assert.equal(init.cache, 'no-store');
    assert.equal(init.credentials, 'omit');
    assert.equal(new Headers(init.headers).get('x-optracall-client'), '1');
    return response({ code: 'verification_fixed_file_changed' }, 409);
  });
  t.mock.method(Response.prototype, 'blob', async () => { blobs++; return new Blob(['ERROR_MUST_NOT_BE_SAVED']); });
  await assert.rejects(downloadVerificationAuthorFile('project-a', 'task-a', id, '060_reports/固定报告.md'), (error: unknown) => error instanceof VerificationRequestError && error.status === 409);
  assert.deepEqual(urls, [`/api/projects/project-a/tasks/task-a/verifications/${id}/author-file?path=060_reports%2F%E5%9B%BA%E5%AE%9A%E6%8A%A5%E5%91%8A.md`]);
  assert.equal(blobs, 0, 'an error response must not be presented as a downloaded fixed file');
});

test('CR10 known environment refusal explains the cause without treating admission as an unknown execution', async t => {
  const cases = [
    { code: 'verification_source_changed', reason: /原来源文件已变化/ },
    { code: 'verification_source_missing', reason: /原来源文件缺失/ },
    { code: 'verification_revision_materials_too_large', reason: /20,000 UTF-16/ },
    { code: 'verification_revision_text_required', reason: /UTF-8/ },
  ];
  let current = cases[0]!, calls = 0;
  t.mock.method(globalThis, 'fetch', async (_url: string, init: RequestInit) => {
    calls++; assert.equal(init.method, 'POST');
    return response({ code: current.code, message: '请求未完成，请检查输入或本地服务后重试。' }, 400);
  });
  for (const item of cases) {
    current = item;
    await assert.rejects(verificationAction('project-a', 'task-a', id, 'author-revision'), (error: unknown) => {
      assert.ok(error instanceof VerificationRequestError);
      assert.equal(error.code, item.code);
      assert.match(error.message, item.reason);
      assert.match(error.message, /保留/);
      assert.doesNotMatch(error.message, /是否已完成|结果尚未确认/);
      return true;
    });
  }
  assert.equal(calls, cases.length, 'known refusals make no query, replay or fallback request');
});

test('SV03 SAP display reads only supplied provenance and cannot fill unknowns from current enablement', () => {
  assert.equal(readSapProvision(undefined), undefined);
  assert.equal(readSapProvision({ sap: { currentEnabled: 'MUST_NOT_BACKFILL@2.0' } }), undefined);
  assert.equal(readSapProvision({ sap: { indexText: '' } }), undefined);
  const actual = { sap: { indexText: 'membership@1.0（实际资源版本）', sha256: 'a'.repeat(64), basis: 'runtime-initialization' }, currentEnabled: 'membership@2.0' };
  assert.deepEqual(readSapProvision(actual), actual.sap);
  assert.equal(readSapProvision({ sap: { indexText: '历史提供回执', sha256: 'not-a-sha', basis: 'historical-receipt' } })?.sha256, undefined);
});

test('SV03 preview through the real Host creates neither a model request nor a verification record', { timeout: 60_000 }, async t => {
  const host = await startTestHost(), provider = await startSyntheticProvider();
  t.after(async () => { await host.close(); await provider.close(); });
  const f = await prepareJointContext(host, provider.baseUrl);
  await readJson(await host.request(`/api/projects/${f.project.id}/files/save-report`, 'POST', { name: 'preview-author.md', text: 'PREVIEW_AUTHOR_ANSWER_NOT_SEMANTICS' }), 201);
  const nativeFetch = globalThis.fetch, calls: string[] = [];
  t.mock.method(globalThis, 'fetch', (url: string | URL | Request, init?: RequestInit) => {
    const route = String(url);
    if (!route.startsWith('/api/')) return nativeFetch(url, init);
    calls.push(route);
    const headers = new Headers(init?.headers); headers.set('origin', host.headers.origin);
    return nativeFetch(host.baseUrl + route, { ...init, headers });
  });
  const selection: VerificationInput = { verificationId: id, question: '预览核算的业务依据，不运行模型。', dataFiles: ['020_clean/joint-input.csv'], authorFiles: ['060_reports/preview-author.md'], requirementContext: f.requirementContext, businessContext: 'PREVIEW_UNRESOLVED：退款时间口径待业务确认。' };
  const result = await previewVerification(f.project.id, f.task.id, selection);
  assert.match(result.semantics.text, /RR07_RAP_1_9_GOAL/);
  assert.match(result.semantics.text, /PREVIEW_UNRESOLVED/);
  assert.ok(!result.semantics.text.includes('PREVIEW_AUTHOR_ANSWER_NOT_SEMANTICS'));
  assert.equal(result.configuration.model, 'synthetic-joint-context');
  assert.equal(provider.requests.length, 0);
  assert.deepEqual(await listVerifications(f.project.id, f.task.id), []);
  await assert.rejects(readVerification(f.project.id, f.task.id, id), (error: unknown) => error instanceof VerificationRequestError && error.status === 404);
  assert.equal(provider.requests.length, 0);
  assert.ok(calls[0]?.endsWith('/verifications/preview'));
  assert.equal(calls.filter(route => route.endsWith('/verifications/preview')).length, 1);
});
