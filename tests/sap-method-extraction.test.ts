import test from 'node:test';
import assert from 'node:assert/strict';
import { parseSapMethodExtractionOutcome } from '../src/agent/sap-method-extraction.ts';

test('SAM04 rejects a title-only or unrecognized extraction instead of claiming a saved method', () => {
  assert.throws(() => parseSapMethodExtractionOutcome(JSON.stringify({ kind: 'method', title: '仅标题', content: { conditions: '', logic: '', judgment: '', limits: '' } })), /invalid_sap_method_extraction/);
  assert.throws(() => parseSapMethodExtractionOutcome(JSON.stringify({ kind: 'published', title: 'Agent cannot publish' })), /invalid_sap_method_extraction/);
});

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { createSapMethodSources } from '../src/host/sap-method-sources.ts';

async function sourceFixture(text = 'visible analysis ' + 'z'.repeat(100_000)) {
  const root = path.resolve('.local/sap-analysis-methods/implementation/runtime/sources', randomUUID());
  await mkdir(root, { recursive: true });
  const file = path.join(root, 'source.jsonl');
  const lines = [
    { type: 'session', version: 3, id: 'source-session', timestamp: '2026-11-04T10:00:00.000Z', cwd: root },
    { type: 'message', id: 'u1', parentId: null, timestamp: '2026-11-04T10:00:01.000Z', message: { role: 'user', content: '分析复购变化' } },
    { type: 'message', id: 'a1', parentId: 'u1', timestamp: '2026-11-04T10:00:02.000Z', message: { role: 'assistant', content: [{ type: 'thinking', thinking: 'HIDDEN_THINKING_MUST_NOT_BECOME_METHOD' }, { type: 'text', text }] } },
  ];
  const bytes = lines.map(line => JSON.stringify(line)).join('\n') + '\n';
  await writeFile(file, bytes);
  const input = { projectId: randomUUID(), taskId: randomUUID(), extractionId: randomUUID(), sessionFile: file, sessionDirectory: root, cwd: root };
  return { input, bytes, file };
}
const readContext = () => ({ signal: new AbortController().signal, requestId: 'request', sessionId: 'extraction-session', toolCallId: 'call', assertCurrent() {} });

test('SAM03/11 a long fixed Session is read in bounded pages instead of silently clipping or injecting it all', async () => {
  const fixture = await sourceFixture();
  const sources = await createSapMethodSources(fixture.input);
  const first = await sources.read('read-session', { start: 0, length: 1024 }, readContext());
  assert.equal(first.content[0]!.text.length, 1024);
  assert.equal((first.details as { continuation: number }).continuation, 1024);
  assert.ok(sources.sessionText.length > 65_536);
  assert.ok(!sources.sessionText.includes('HIDDEN_THINKING_MUST_NOT_BECOME_METHOD'));
  assert.equal(await readFile(fixture.file, 'utf8'), fixture.bytes, 'source native bytes are never rewritten');
});

test('SAM03 fixed source exposes precise identity, preserves incomplete limitation, and rejects later native changes', async () => {
  const fixture = await sourceFixture('Visible original answer.');
  const sources = await createSapMethodSources({ ...fixture.input, incomplete: true });
  assert.equal(sources.sessionIdentity.sessionId, 'source-session');
  assert.equal(sources.sessionIdentity.cutoffEntryId, 'a1');
  assert.equal(sources.sessionIdentity.incomplete, true);
  assert.match(sources.promptContext, /来源任务尚未完成/);
  assert.match(sources.sessionIdentity.nativeSha256, /^[a-f0-9]{64}$/);
  const replacement = fixture.bytes.replace('Visible original answer.', 'A changed original answer.');
  await writeFile(fixture.file, replacement);
  await assert.rejects(sources.assertUnchanged(), { code: 'sap_method_source_changed' });
  const old = await sources.read('read-session', {}, readContext());
  assert.ok(old.content[0]!.text.includes('Visible original answer.'));
  assert.ok(!old.content[0]!.text.includes('A changed original answer.'));
});

test('SAM04 read-only memory/method source delegates retain only actual read references and revoke late results', async () => {
  const fixture = await sourceFixture('Source for optional memories.');
  const memoryRef = { type: 'memory' as const, label: 'Known old memory', ref: 'retained:material-1:revision-3', version: 'revision-3', sha256: 'd'.repeat(64) };
  const calls: unknown[] = [];
  const sources = await createSapMethodSources({ ...fixture.input, personal: async (action, input, context) => { context.assertCurrent(); calls.push({ action, input }); return { content: [{ type: 'text', text: 'Old memory, not a current instruction.' }], details: { sources: [memoryRef] } }; } });
  await sources.read('find-memory', { input: { query: '观察窗口' } }, readContext());
  assert.equal(sources.references().length, 1, 'finding metadata cannot claim that memory body was read');
  await sources.read('read-memory', { input: { target: 'exact-original-target' } }, readContext());
  assert.deepEqual(sources.references(), [sources.sourceRef, memoryRef]);
  assert.deepEqual(calls, [{ action: 'find', input: { query: '观察窗口' } }, { action: 'read', input: { target: 'exact-original-target' } }]);
  const abort = new AbortController(); abort.abort();
  await assert.rejects(sources.read('read-session', { start: 0 }, { ...readContext(), signal: abort.signal }));
  assert.equal(calls.length, 2, 'aborted reads do not call another capability');
  await assert.rejects(sources.read('read-method', {}, readContext()), { code: 'sap_method_source_unavailable' });
  await assert.rejects(sources.read('read-session', { start: -1 }, readContext()), { code: 'invalid_sap_method_source_range' });
  await assert.rejects(sources.read('read-session', { start: 0, length: 30001 }, readContext()), { code: 'invalid_sap_method_source_range' });
});
