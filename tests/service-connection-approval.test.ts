import assert from 'node:assert/strict';
import { test } from 'node:test';
import { answerServiceForm } from '../src/host/service-connection-approval.ts';
import type { ServiceConnectionCallContext } from '../src/agent/service-connection-tools.ts';
import type { GoogleElicitationRequest } from '../src/host/service-connection-google-transport.ts';

function context(overrides: Partial<ServiceConnectionCallContext> = {}) {
  const prompts: { type: string; title: string; options?: readonly string[] }[] = [], controller = new AbortController();
  const value: ServiceConnectionCallContext = {
    projectId: 'project', taskId: 'task', requestId: 'original-request', sessionId: 'session', toolCallId: 'call', signal: controller.signal,
    assertCurrent: () => {}, registerCleanup: () => {},
    confirm: async title => { prompts.push({ type: 'confirm', title }); return false; },
    input: async title => { prompts.push({ type: 'input', title }); return ''; },
    select: async (title, options) => { prompts.push({ type: 'select', title, options }); return options[0]!; },
    ...overrides,
  };
  return { value, prompts, controller };
}
function form(properties: Record<string, unknown>, required: string[] = []): GoogleElicitationRequest {
  return { key: 'synthetic-form', toolName: 'send_message', arguments: { to: ['receiver@example.invalid'], subject: 'Exact subject', body: 'Exact content' }, message: 'Synthetic service input request.', requestedSchema: { type: 'object', properties, required } };
}

test('once-only approval is reused exclusively for the original exact tool and canonical arguments', async () => {
  const request = form({ decision: { type: 'string', enum: ['ALLOW_ONCE', 'DENY_ONCE'] } }, ['decision']);
  const approved = { toolName: request.toolName, args: { body: 'Exact content', subject: 'Exact subject', to: ['receiver@example.invalid'] } };
  const same = context();
  assert.deepEqual(await answerServiceForm(request, same.value, approved), { action: 'accept', content: { decision: 'ALLOW_ONCE' } });
  assert.equal(same.prompts.length, 0);
  for (const candidate of [undefined, { ...approved, toolName: 'reply' }, { ...approved, args: { ...approved.args, body: 'Changed content' } }, { ...approved, args: { ...approved.args, to: ['different@example.invalid'] } }]) {
    const other = context();
    await answerServiceForm(request, other.value, candidate);
    assert.equal(other.prompts.length, 1);
  }
  const broad = context();
  await answerServiceForm(form({ decision: { type: 'string', enum: ['ALLOW_ONCE', 'DENY_ONCE', 'ALLOW_ALWAYS'] } }), broad.value, approved);
  assert.equal(broad.prompts.length, 1, 'broader consent never inherits the exact action approval');
});

test('credential requests fail before any normal task prompt', async () => {
  for (const key of ['password', 'client_secret', 'accessToken', 'refresh_token', 'authorizationCode', 'apiKey', 'credential', 'private_key']) {
    const ctx = context(); await assert.rejects(answerServiceForm(form({ [key]: { type: 'string' } }), ctx.value), /服务连接请求未能完成|(?:gmail|service)_form_unsupported/); assert.equal(ctx.prompts.length, 0);
  }
});

test('duplicate option titles remain unambiguous and original values are returned', async () => {
  const ctx = context({ select: async (_title, choices) => { assert.deepEqual(choices, ['相同标题 [1]', '相同标题 [2]']); return choices[1]!; } });
  assert.deepEqual(await answerServiceForm(form({ target: { type: 'string', oneOf: [{ const: 'A', title: '相同标题' }, { const: 'B', title: '相同标题' }] } }), ctx.value), { action: 'accept', content: { target: 'B' } });
});

test('an enum item named done never collides with finishing a multiple selection', async () => {
  let round = 0;
  const ctx = context({ select: async (_title, choices) => { round++; if (round === 1) { assert.equal(choices[1], '完成选择 [1]'); return choices[1]!; } return choices[0]!; } });
  assert.deepEqual(await answerServiceForm(form({ tags: { type: 'array', items: { type: 'string', enum: ['完成选择', 'second'] } } }), ctx.value), { action: 'accept', content: { tags: ['完成选择'] } });
  assert.equal(round, 2);
});

test('required numeric empty input never becomes zero while optional empty input stays absent', async () => {
  for (const type of ['number', 'integer']) {
    await assert.rejects(answerServiceForm(form({ amount: { type } }, ['amount']), context().value), /服务连接请求未能完成|service_form_response_invalid/);
    assert.deepEqual(await answerServiceForm(form({ amount: { type } }), context().value), { action: 'accept', content: {} });
  }
  const zero = context({ input: async () => '0' });
  assert.deepEqual(await answerServiceForm(form({ amount: { type: 'integer' } }, ['amount']), zero.value), { action: 'accept', content: { amount: 0 } });
});

test('stale or cancelled answers cannot complete a form, including its final optional blank field', async () => {
  for (const mode of ['stale', 'abort'] as const) {
    let current = true;
    const ctx = context({ assertCurrent: () => { if (!current) throw new Error('stale-original-invocation'); } });
    ctx.value.input = async () => { if (mode === 'stale') current = false; else ctx.controller.abort(); return ''; };
    await assert.rejects(answerServiceForm(form({ optionalValue: { type: 'string' } }), ctx.value), mode === 'stale' ? /stale-original-invocation/ : { name: 'AbortError' });
  }
});

test('nonblank prompt answers are checked after awaited selection and boolean confirmation', async () => {
  for (const kind of ['select', 'confirm'] as const) {
    let current = true;
    const ctx = context({ assertCurrent: () => { if (!current) throw new Error('stale-original-invocation'); } });
    ctx.value.select = async (_title, choices) => { current = false; return choices[0]!; };
    ctx.value.confirm = async () => { current = false; return true; };
    await assert.rejects(answerServiceForm(form({ answer: kind === 'select' ? { type: 'string', enum: ['yes', 'no'] } : { type: 'boolean' } }), ctx.value), /stale-original-invocation/);
  }
});

test('invalid schemas are rejected before prompting and answers obey the original finite schema', async () => {
  for (const field of [
    { type: 'object', properties: { nested: { type: 'string' } } },
    { type: 'number', enum: ['bad-number-enum'] },
    { type: 'string', enum: ['duplicate', 'duplicate'] },
    { type: 'string', minLength: 10, maxLength: 1 },
  ]) {
    const ctx = context(); await assert.rejects(answerServiceForm(form({ answer: field }), ctx.value)); assert.equal(ctx.prompts.length, 0);
  }
  for (const [field, answer] of [[{ type: 'integer', minimum: 1, maximum: 3 }, '4'], [{ type: 'string', minLength: 1, maxLength: 3 }, '']] as const) {
    const ctx = context({ input: async () => answer }); await assert.rejects(answerServiceForm(form({ answer: field }, ['answer']), ctx.value));
  }
  const required = form({ present: { type: 'string' } }); required.requestedSchema.required = ['missing'];
  const ctx = context(); await assert.rejects(answerServiceForm(required, ctx.value)); assert.equal(ctx.prompts.length, 0);
});
