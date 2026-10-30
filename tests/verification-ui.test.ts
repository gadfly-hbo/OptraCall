import test from 'node:test';
import assert from 'node:assert/strict';
import { startTestHost } from './fixtures/host-process.ts';
import { startSyntheticProvider } from './fixtures/synthetic-provider.ts';
import { prepareJointContext, readJson } from './fixtures/joint-context.ts';
import { listVerifications, previewVerification, readSapProvision, readVerification, startVerification, verificationAction, verificationFiles, verificationInputError, VerificationRequestError, VerificationSubmissionUnknown, type VerificationInput, type VerificationRecord } from '../src/host/ui/verification-client.ts';

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
