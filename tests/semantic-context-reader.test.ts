import test from 'node:test';
import assert from 'node:assert/strict';
import { semanticPage } from '../extensions/business-plugins/semantic-context/reader.ts';
import type { SemanticItem } from '../extensions/business-plugins/semantic-context/types.ts';

const target = { kind: 'sap' as const, packageId: 'rule', version: '1.2.0' };
const item = (body: string, date: string | null = null): SemanticItem => ({ target, title: 'Original rule', state: 'available', sha256: 'a'.repeat(64), body, range: null, recordedAt: date ? { field: 'publishedAt', value: date } : null, businessTime: [], governance: null, declaration: null, relations: [], gaps: [] });

test('L106: exact UTF-16 fragments can be continued, and a changed original version cannot be spliced', () => {
  const body = 'a'.repeat(19_999) + '😀' + 'end';
  const input = { action: 'read' as const, target }, binding = { identity: 'real-owner-and-query', version: 'original-sha' };
  const first = semanticPage(input, [item(body)], binding, null);
  assert.ok(first.items[0]!.body!.length <= 20_000); assert.equal(first.items[0]!.body!.endsWith('\ud83d'), false);
  assert.equal(first.coverage.complete, false); assert.ok(first.coverage.continuation);
  const second = semanticPage({ ...input, continuation: first.coverage.continuation }, [item(body)], binding, null);
  assert.equal(first.items[0]!.body! + second.items[0]!.body!, body);
  assert.throws(() => semanticPage({ ...input, continuation: first.coverage.continuation }, [item(body)], { ...binding, version: 'changed' }, null), /stale/);
});

test('L106: large original metadata cannot bypass text bounds and is recoverable in exact continuations', () => {
  const original = { ...item('Short original body'), businessTime: [{ text: 'unparsed business time '.repeat(2000), source: 'effectiveTime' }] };
  const metadata = JSON.stringify({ title: original.title, businessTime: original.businessTime, governance: original.governance, declaration: original.declaration, relations: original.relations });
  const input = { action: 'read' as const, target }, binding = { identity: 'owner', version: 'version' };
  let result = semanticPage(input, [original], binding, null), recovered = '';
  for (let n = 0; n < 10; n++) {
    assert.ok(JSON.stringify(result).length < 25_000, 'large metadata must not leak beside the bounded source body');
    recovered += result.items[0]?.metadataFragment?.text ?? '';
    if (!result.coverage.continuation) break;
    result = semanticPage({ ...input, continuation: result.coverage.continuation }, [original], binding, null);
  }
  assert.equal(recovered, metadata); assert.equal(result.coverage.continuation, null);
});

test('L104: recorded-before uses qualified system instants and keeps unknown business dates separate', () => {
  const rows = [item('Old', '2026-10-10T01:00:00Z'), item('Later backdated notice', '2026-11-02T01:00:00Z'), item('Unknown system time')];
  rows[1]!.businessTime = [{ text: 'Effective since October 1', source: 'effectiveTime' }];
  const result = semanticPage({ action: 'find', recordedBefore: '2026-10-10T09:00:00+08:00' }, rows, { identity: 'query', version: 'v' }, null);
  assert.deepEqual(result.items.map(row => row.body), ['Old']); assert.deepEqual(result.unknownTime.map(row => row.body), ['Unknown system time']);
  assert.ok(result.coverage.gaps.includes('recorded-time-unknown-not-absence'));
  for (const recordedBefore of ['2026-10-10', '2026-10-10T00:00:00', '2026-02-30T00:00:00Z']) assert.throws(() => semanticPage({ action: 'find', recordedBefore }, rows, { identity: 'query', version: 'v' }, null), /recorded_before/);
});
