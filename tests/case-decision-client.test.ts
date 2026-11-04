import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { build } from 'rolldown';

const client = (async () => {
  const directory = new URL('../.local/fourbase-modules/m5/implementation/client-regression/', import.meta.url).pathname;
  await mkdir(directory, { recursive: true });
  await build({ input: new URL('../src/host/ui/case-decisions-client.ts', import.meta.url).pathname, output: { format: 'esm', file: `${directory}client.mjs` } });
  // @ts-expect-error Isolated client artifact is generated immediately above, never imported by the product.
  return import('../.local/fourbase-modules/m5/implementation/client-regression/client.mjs');
})();

for (const [code, action] of [
  ['case_decision_revision_conflict', /记录已更新.*当前输入保留/],
  ['case_choice_conflict', /策略已有新选择.*取舍与理由保留/],
  ['case_decision_archived', /已归档.*明确恢复/],
  ['case_decisions_disabled', /未开放.*写入.*记录保留/],
] as const) {
  test(`M5 client explains ${code} without replaying the user's request`, async () => {
    const api = await client;
    const original = globalThis.fetch;
    const calls: { url: string; init?: RequestInit }[] = [];
    const details = { expectedRevision: 1, currentRevision: 2 };
    globalThis.fetch = async (input, init) => {
      calls.push({ url: String(input), init });
      return new Response(JSON.stringify({ code, details }), { status: 409 });
    };
    try {
      await assert.rejects(() => api.readCaseDecisionRevision('case/id', 'record/id', 1), (error: unknown) => {
        assert.ok(error instanceof api.CaseDecisionRequestError);
        const failure = error as Error & { code: string; status: number; details: unknown };
        assert.equal(failure.code, code);
        assert.equal(failure.status, 409);
        assert.deepEqual(failure.details, details);
        assert.match(failure.message, action);
        return true;
      });
      assert.equal(calls.length, 1);
      assert.equal(calls[0]?.url, '/api/cases/case%2Fid/decisions/record%2Fid/revisions/1');
      assert.equal(calls[0]?.init?.method, 'GET');
    } finally { globalThis.fetch = original; }
  });
}
