import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { authorContext, authorPreview, contextEvidence, materialPreview } from '../src/host/verification-context.ts';
import type { VerificationRecord } from '../src/host/verification-store.ts';

const hash = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex');
const workspace = path.resolve('/synthetic-verification/workspace');
function source(relativePath: string, value: string | Uint8Array) {
  const bytes = typeof value === 'string' ? Buffer.from(value) : Buffer.from(value);
  return { relativePath, bytes, sha256: hash(bytes) };
}
function record(): VerificationRecord {
  const file = source('060_reports/report.md', 'Original fixed author text');
  return {
    formatVersion: 1, projectId: 'project', taskId: 'task', verificationId: 'verification',
    requestFingerprint: hash('selection'), question: 'Check the fixed material', selection: {},
    configuration: { id: 'synthetic', revision: 1, provider: 'synthetic', model: 'synthetic' },
    state: 'completed', phase: 'compare', createdAt: '2026-10-31T00:00:00.000Z', updatedAt: '2026-10-31T00:00:00.000Z',
    workspace, sessionDirectory: '/synthetic-verification/native', semantics: { text: '', sha256: hash(''), sources: [] },
    dataFiles: [], authorFiles: [{ relativePath: file.relativePath, bytes: file.bytes.length, sha256: file.sha256,
      snapshotPath: '/synthetic-verification/fixed/report.md', observedAt: '2026-10-31T00:00:00.000Z' }],
    independence: { status: 'unknown' }, comparisonResult: { text: 'Comparison', sha256: hash('Comparison'),
      file: '/synthetic-verification/comparison.md', savedAt: '2026-10-31T00:00:00.000Z', files: [],
      requestId: 'comparison-request', sessionFile: '/synthetic-verification/native/session.jsonl' },
  };
}
function native(text: string, digest = hash(text)) {
  return { sessionFile: '/synthetic-verification/native/session.jsonl', entries: [
    { type: 'session', id: 'native-session', cwd: workspace },
    { type: 'custom', customType: 'optracall.run', data: { sessionId: 'native-session', phase: 'started', requestId: 'comparison-request', providedContext: { version: 1, requestTextSha256: digest } } },
    { type: 'message', id: 'native-user-entry', message: { role: 'user', content: [{ type: 'text', text }] } },
    { type: 'custom', customType: 'optracall.run', data: { sessionId: 'native-session', phase: 'settled', requestId: 'comparison-request', outcome: 'completed' } },
  ] };
}

test('author delivery strictly decodes UTF-8 and preserves identity when no text can be supplied', () => {
  const invalid = source('020_clean/appendix.bin', new Uint8Array([0xff, 0x80, 0x41]));
  assert.deepEqual(materialPreview(invalid), { relativePath: invalid.relativePath, sha256: invalid.sha256, bytes: 3, textStatus: 'not-utf8' });
  const packet = authorContext([invalid], workspace);
  assert.match(packet, /not-utf8/);
  const r = record(); r.authorFiles = [{ relativePath: invalid.relativePath, sha256: invalid.sha256, bytes: 3, snapshotPath: '/synthetic/appendix.bin', observedAt: r.createdAt }];
  const evidence = contextEvidence(r, { native: native(packet), events: [] });
  assert.equal(evidence.provided.status, 'recorded');
  assert.deepEqual(evidence.provided.fragments[0], { relativePath: invalid.relativePath, sha256: invalid.sha256, bytes: 3,
    fixedPath: path.join(workspace, 'author', invalid.relativePath), textStatus: 'not-utf8', start: null, end: null, totalLength: null, text: null });
  assert.equal(authorPreview(invalid, workspace).text, '');
});

test('author preview identifies its actual UTF-16 range, retaining BOM and an intact Unicode boundary', () => {
  const text = '\ufeff' + 'a'.repeat(99_998) + '😀Z', file = source('060_reports/long.md', text);
  const preview = authorPreview(file, workspace);
  assert.equal(preview.text, '\ufeff' + 'a'.repeat(99_998));
  assert.equal(preview.start, 0); assert.equal(preview.end, 99_999); assert.equal(preview.totalLength, 100_002);
  assert.equal(preview.truncated, true); assert.equal(preview.bytes, file.bytes.length); assert.equal(preview.sha256, file.sha256);
});

test('author context honors the existing whole-message limit without cutting file identities or encoded characters', () => {
  const files = Array.from({ length: 8 }, (_, index) => source(`060_reports/control-${index}.md`, '\u0001'.repeat(5000)));
  const text = authorContext(files, workspace);
  assert.ok(text.length <= 20_000, 'Ordinary verification keeps the original 20k runtime input limit');
  for (const file of files) assert.ok(text.includes(file.relativePath), 'Every selected file remains located even after body budget is exhausted');
  const r = record(); r.authorFiles = files.map(file => ({ relativePath: file.relativePath, bytes: file.bytes.length,
    sha256: file.sha256, snapshotPath: '/synthetic/' + file.relativePath, observedAt: r.createdAt }));
  const evidence = contextEvidence(r, { native: native(text), events: [] });
  assert.equal(evidence.provided.status, 'recorded'); assert.equal(evidence.provided.fragments.length, 8);
  assert.ok(evidence.provided.fragments.reduce((sum, file) => sum + (file.end ?? 0), 0) < 12_000);
  const oversized = Array.from({ length: 32 }, (_, index) => source(`060_reports/${index}-${'x'.repeat(800)}.md`, ''));
  assert.throws(() => authorContext(oversized, workspace), { code: 'verification_author_context_too_large' });
});

test('a legacy native request is shown as actual text without reconstructing absent fragment ranges', () => {
  const text = 'Legacy author summary. Full fixed copy is in author/.';
  const before = record(), original = JSON.stringify(before);
  const evidence = contextEvidence(before, { native: native(text), events: [] });
  assert.equal(evidence.provided.status, 'unrecorded'); assert.equal(evidence.provided.requestText, text);
  assert.deepEqual(evidence.provided.fragments, []); assert.equal(JSON.stringify(before), original);
});

test('native text must match the actual request/session identity and digest before it is treated as supplied', () => {
  const file = source('060_reports/report.md', 'Original fixed author text'), text = authorContext([file], workspace), r = record();
  const good = contextEvidence(r, { native: native(text), events: [] });
  assert.equal(good.provided.status, 'recorded'); assert.equal(good.provided.messageId, 'native-user-entry');
  const wrongHash = contextEvidence(r, { native: native(text, hash('different request')), events: [] });
  assert.equal(wrongHash.provided.status, 'unrecorded'); assert.equal(wrongHash.provided.requestText, undefined);
  const foreign = native(text); foreign.entries[0] = { type: 'session', id: 'foreign-session', cwd: workspace };
  assert.equal(contextEvidence(r, { native: foreign, events: [] }).provided.status, 'unrecorded');
  const altered = authorContext([source('060_reports/report.md', 'Unrelated changed author bytes')], workspace);
  assert.equal(contextEvidence(r, { native: native(altered), events: [] }).provided.status, 'unrecorded');
});

test('read observations remain request/file limited, failure-aware and distinct from bash or understanding', () => {
  const r = record(), requestId = r.comparisonResult!.requestId!;
  const start = { type: 'native', requestId, event: { type: 'tool_execution_start', toolName: 'read', toolCallId: 'read-1', args: { path: path.join(workspace, 'author/060_reports/report.md'), offset: 4, limit: 8 } } };
  const end = { type: 'native', requestId, event: { type: 'tool_execution_end', toolName: 'read', toolCallId: 'read-1', isError: true } };
  const events = [start, end,
    { ...start, requestId: 'foreign-request' },
    { type: 'native', requestId, event: { type: 'tool_execution_start', toolName: 'bash', toolCallId: 'bash-1', args: { command: 'cat author/060_reports/report.md' } } },
    { type: 'native', requestId, event: { type: 'tool_execution_start', toolName: 'read', toolCallId: 'outside', args: { path: '../another-project/report.md' } } },
  ];
  const evidence = contextEvidence(r, { events });
  assert.equal(evidence.reads.status, 'observed'); assert.equal(evidence.reads.items.length, 1);
  assert.equal(evidence.reads.items[0]!.outcome, 'failed'); assert.equal(evidence.reads.items[0]!.offset, 4); assert.equal(evidence.reads.items[0]!.limit, 8);
  assert.equal(contextEvidence(r, { events: [] }).reads.status, 'unrecorded');
  assert.equal(contextEvidence(r, {}).reads.status, 'unavailable');
});

test('revision readback identifies the unique fixed draft and preserves unknown legacy associations', () => {
  const r = record(); r.revisionCount = 1;
  r.authorRevision = { requestId: 'revision-1', status: 'completed', mode: 'fixed-draft', reportText: 'Revised report', files: ['060_reports/revised.md'] };
  r.recheckResult = { ...r.comparisonResult!, requestId: 'recheck-1' }; r.recheckCount = 1;
  const current = contextEvidence(r, {});
  assert.equal(current.revisionAssociation.status, 'recorded'); assert.equal(current.revisionAssociation.revisionRequestId, 'revision-1');
  assert.equal(current.revisionAssociation.recheckRequestId, 'recheck-1');
  delete r.recheckResult.requestId;
  assert.equal(contextEvidence(r, {}).revisionAssociation.status, 'unknown');
  r.recheckResult.requestId = 'recheck-1';
  delete r.authorRevision.mode;
  assert.equal(contextEvidence(r, {}).revisionAssociation.status, 'unknown');
});
