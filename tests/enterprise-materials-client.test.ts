import test from 'node:test';
import assert from 'node:assert/strict';
import { EnterpriseMaterialsRequestError, readEnterpriseMaterial, saveEnterpriseDraft } from '../src/host/ui/enterprise-materials-client.ts';

test('EB02 client preserves the controlled resource error and readable import guidance', async context => {
  context.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify({ error: 'enterprise_source_not_utf8', message: '文件不是可读取的 UTF-8 文本，可改为仅登记原件。' }), { status: 400, headers: { 'content-type': 'application/json' } }));
  await assert.rejects(readEnterpriseMaterial('synthetic-material'), error => {
    assert.ok(error instanceof EnterpriseMaterialsRequestError);
    assert.equal(error.code, 'enterprise_source_not_utf8');
    assert.equal(error.status, 400);
    assert.equal(error.message, '文件不是可读取的 UTF-8 文本，可改为仅登记原件。');
    return true;
  });
});

test('EB03 client supplies the explicitly edited version and leaves conflicts visible', async context => {
  let sent: RequestInit | undefined;
  context.mock.method(globalThis, 'fetch', async (_url: string, init: RequestInit) => { sent = init; return new Response(JSON.stringify({ error: 'enterprise_material_conflict', message: '资料版本冲突，请重新读取。' }), { status: 409, headers: { 'content-type': 'application/json' } }); });
  await assert.rejects(saveEnterpriseDraft('synthetic-material', 7, { title: '合成说明', category: '', body: '背景原文', source: '', owner: '', scope: '', effectiveTime: '', sourceFileId: null }), error => error instanceof EnterpriseMaterialsRequestError && error.status === 409);
  assert.equal(sent?.method, 'PUT');
  assert.equal(JSON.parse(String(sent?.body)).expectedVersion, 7);
});
