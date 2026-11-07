import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHash } from 'node:crypto';
import { studioQuestionContext } from '../extensions/business-plugins/studio/contracts.ts';
import type { StudioWorkItem } from '../extensions/business-plugins/studio/contracts.ts';
import { answerStudioQuestion, studioRequest, StudioRequestError } from '../src/host/ui/studio-api.ts';

test('Studio answer sends the opened question and original draft once even if refreshed question data changes during hashing', async () => {
  const previous = globalThis.fetch, opened: StudioWorkItem = { id: 'q1', topicId: 'topic-a', kind: 'question', title: '原题A', detail: '原题前提', impact: '用途A', nextStep: '等待', sources: [{ authority: 'enterprise', id: 'source-a', version: '1', sha256: 'a'.repeat(64) }], status: 'waiting', updatedAt: '2026-01-01T00:00:00.000Z' };
  const originalHash = createHash('sha256').update(studioQuestionContext(opened)).digest('hex'), draft = '给原题A的答复';
  const requests: { path: string; body: Record<string, unknown> }[] = [];
  globalThis.fetch = (async (url, options) => { requests.push({ path: String(url), body: JSON.parse(String(options?.body)) }); return new Response(JSON.stringify({ code: 'studio_question_changed' }), { status: 409 }); }) as typeof fetch;
  try {
    const operation = answerStudioQuestion('s1', 'answer-one', opened, draft);
    opened.title = '刷新后的新题B'; opened.sources[0]!.version = '2';
    await assert.rejects(operation, error => error instanceof StudioRequestError && error.code === 'studio_question_changed' && !error.uncertain && /未保存.*草稿和原题保持/.test(error.message));
    assert.deepEqual(requests, [{ path: '/api/studio/systems/s1/answers', body: { requestId: 'answer-one', workItemId: 'q1', answer: draft, expectedQuestionContextSha256: originalHash } }]);
  } finally { globalThis.fetch = previous; }
});

test('Studio reads use the established same-origin Host request contract', async () => {
  const previous = globalThis.fetch;
  let request: { url: string; options: RequestInit } | undefined;
  globalThis.fetch = (async (url, options) => {
    request = { url: String(url), options: options ?? {} };
    return new Response(JSON.stringify({ systems: [] }), { status: 200 });
  }) as typeof fetch;
  try {
    assert.deepEqual(await studioRequest('systems'), { systems: [] });
    assert.equal(request?.url, '/api/studio/systems');
    assert.equal(request?.options.mode, 'same-origin');
    assert.equal(request?.options.credentials, 'omit');
    assert.equal(request?.options.cache, 'no-store');
    assert.equal(new Headers(request?.options.headers).get('x-optracall-client'), '1');
  } finally { globalThis.fetch = previous; }
});

test('Studio mutation with a lost response is UNKNOWN and is never automatically replayed', async () => {
  const previous = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (async () => { calls++; throw new TypeError('connection closed after write'); }) as typeof fetch;
  try {
    await assert.rejects(studioRequest('systems/s1/assets', 'POST', { requestId: 'save-one', title: '退款映射' }), error => error instanceof StudioRequestError && error.uncertain && error.code === 'studio_result_unknown');
    assert.equal(calls, 1);
  } finally { globalThis.fetch = previous; }
});

test('Studio distinguishes a rejected write from an uncertain server write', async () => {
  const previous = globalThis.fetch;
  try {
    globalThis.fetch = (async () => new Response(JSON.stringify({ code: 'studio_read_only', message: '建设项目已归档。' }), { status: 409 })) as typeof fetch;
    await assert.rejects(studioRequest('systems/s1/assets', 'POST', {}), error => error instanceof StudioRequestError && !error.uncertain && error.code === 'studio_read_only' && error.status === 409);
    globalThis.fetch = (async () => new Response(JSON.stringify({ code: 'studio_write_failed', message: '保存响应未完成。' }), { status: 503 })) as typeof fetch;
    await assert.rejects(studioRequest('systems/s1/assets', 'POST', {}), error => error instanceof StudioRequestError && error.uncertain && error.status === 503);
  } finally { globalThis.fetch = previous; }
});

test('Studio read rejects another project or task instead of displaying it as this construction session', async () => {
  const previous = globalThis.fetch;
  globalThis.fetch = (async () => new Response(JSON.stringify({ system: { id: 's1', projectId: 'p1', taskId: 't1' }, project: { id: 'p-other' }, task: { id: 't1' }, running: false }), { status: 200 })) as typeof fetch;
  try {
    const { readStudioWorkspace } = await import('../src/host/ui/studio-api.ts');
    await assert.rejects(readStudioWorkspace('s1'), error => error instanceof StudioRequestError && error.code === 'studio_response_mismatch');
  } finally { globalThis.fetch = previous; }
});

test('Studio only accepts the receipt for the original request, not an unrelated completed operation', async () => {
  const previous = globalThis.fetch;
  globalThis.fetch = (async () => new Response(JSON.stringify({ requestId: 'another-request', status: 'succeeded', systemId: 's1' }), { status: 200 })) as typeof fetch;
  try {
    const { readStudioOperation } = await import('../src/host/ui/studio-api.ts');
    await assert.rejects(readStudioOperation('original-request'), error => error instanceof StudioRequestError && error.code === 'studio_response_mismatch');
  } finally { globalThis.fetch = previous; }
});

test('Studio cancellation of a read preserves AbortError without claiming a write result', async () => {
  const previous = globalThis.fetch;
  const controller = new AbortController(); controller.abort();
  const error = new DOMException('cancelled', 'AbortError');
  globalThis.fetch = (async () => { throw error; }) as typeof fetch;
  try { await assert.rejects(studioRequest('systems', 'GET', undefined, controller.signal), value => value === error); }
  finally { globalThis.fetch = previous; }
});

test('Studio construction sends through the original message endpoint and carries only explicit context association', async () => {
  const previous = globalThis.fetch;
  let body: Record<string, unknown> = {};
  let url = '';
  globalThis.fetch = (async (target, init) => { url = String(target); body = JSON.parse(String(init?.body)); return new Response('{}', { status: 202 }); }) as typeof fetch;
  try {
    const { sendMessage } = await import('../src/host/ui/runtime-client.ts');
    await sendMessage('p1', 't1', '继续本轮建设', 'run-one', undefined, undefined, undefined, undefined, undefined, undefined, undefined, { systemId: 's1', purpose: 'construction' });
    assert.equal(url, '/api/projects/p1/tasks/t1/messages');
    assert.deepEqual(body.studioContext, { systemId: 's1', purpose: 'construction' });
    assert.equal(body.text, '继续本轮建设');
    assert.equal(body.requestId, 'run-one');
  } finally { globalThis.fetch = previous; }
});

test('Studio displays source qualification failures as business messages while preserving the diagnostic code', async () => {
  const previous = globalThis.fetch;
  globalThis.fetch = (async () => new Response(JSON.stringify({ code: 'studio_source_changed', message: 'studio_source_changed' }), { status: 409 })) as typeof fetch;
  try { await assert.rejects(studioRequest('systems/s1/preview', 'POST', {}), error => error instanceof StudioRequestError && error.code === 'studio_source_changed' && /来源.*变化/.test(error.message) && !error.uncertain); }
  finally { globalThis.fetch = previous; }
});

test('switching from a Studio deep link to ordinary analysis retains its task on reload', async () => {
  const { studioTaskUrl } = await import('../src/host/ui/studio-api.ts');
  const analysis = studioTaskUrl('http://127.0.0.1:9000/?studio=s1&project=p1&task=construction', 'p1', 'analysis');
  assert.equal(analysis.searchParams.has('studio'), false);
  assert.equal(analysis.searchParams.get('task'), 'analysis');
  const construction = studioTaskUrl(analysis.href, 'p1', 'construction', 's1');
  assert.equal(construction.searchParams.get('studio'), 's1');
  assert.equal(construction.searchParams.get('task'), 'construction');
});
