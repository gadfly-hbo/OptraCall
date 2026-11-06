import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { automaticAuthorContext, automaticRecheckContext } from '../src/host/automatic-verification-context.ts';
import { authorContext } from '../src/host/verification-context.ts';

const recheckPrefix = '修订复查（已知作者信息，不是新冷读）\n';
const fixed = { version: 2, sha256: 'a'.repeat(64), fixedPath: '/fixed/revision.md', processPath: '/work/author-1' };

test('D16 recheck carries a fitting 13854-character fixed report including its new-claim tail', () => {
  const tail = '\nNEW_CLAIM_TAIL\n', text = '正文'.repeat(6919) + tail;
  assert.equal(text.length, 13_854);
  const supplied = automaticRecheckContext({ ...fixed, text });
  assert.ok(supplied.length <= 20_000);
  const packet = JSON.parse(supplied.slice(recheckPrefix.length));
  assert.equal(packet.text, text, 'the fitting fixed report must reach recheck without another read');
  assert.equal(packet.end, 13_854);
  assert.equal(packet.totalLength, 13_854);
  assert.equal(packet.text.endsWith(tail), true);
  assert.equal(packet.fixedPath, fixed.fixedPath);
  assert.equal(packet.sha256, fixed.sha256);
});

test('D16 automatic comparison supplies grounded-disagreement expectations while ordinary comparison stays byte-compatible', () => {
  const bytes = Buffer.from('固定作者稿😀\n快照金额。');
  const files = [{ relativePath: '060_reports/report.md', bytes, sha256: createHash('sha256').update(bytes).digest('hex') }];
  const ordinary = authorContext(files, '/fixed-workspace');
  const automatic = authorContext(files, '/fixed-workspace', { automaticFeedback: true });
  assert.ok(automatic.length <= 20_000);
  assert.match(automatic, /重要分歧.*原句.*位置/);
  assert.match(automatic, /固定来源.*前提/);
  assert.match(automatic, /相反.*依据/);
  assert.match(automatic, /假设.*反事实.*建议/);
  assert.match(automatic, /不要求固定.*表格.*条数/);
  // Captured before this change from the ordinary public formatter, not
  // generated from the revised implementation during this test.
  assert.equal(createHash('sha256').update(ordinary).digest('hex'), '0269a79fba0bdef1486d44eab24aa35e706be426c80a84426df6a9a787faa622');
  assert.equal(authorContext(files, '/fixed-workspace', { automaticFeedback: false }), ordinary);
});

test('D16 automatic handoffs budget grounded feedback before encoded body fragments without dropping identities', () => {
  const text = '\u0000"\\\n😀'.repeat(10_000), bytes = Buffer.from(text);
  const files = Array.from({ length: 5 }, (_, index) => ({ relativePath: `060_reports/report-${index}.md`, bytes,
    sha256: createHash('sha256').update(bytes).digest('hex') }));
  const compared = authorContext(files, '/fixed-workspace', { automaticFeedback: true });
  const start = compared.indexOf('[OPTRACALL_AUTHOR_CONTEXT_V1]\n') + '[OPTRACALL_AUTHOR_CONTEXT_V1]\n'.length;
  const end = compared.indexOf('\n[/OPTRACALL_AUTHOR_CONTEXT_V1]', start);
  const comparison = JSON.parse(compared.slice(start, end));
  assert.ok(compared.length <= 20_000);
  assert.match(compared, /重要分歧.*固定来源/);
  for (const [index, fragment] of comparison.files.entries()) {
    assert.equal(fragment.relativePath, files[index]!.relativePath);
    assert.equal(fragment.sha256, files[index]!.sha256);
    assert.equal(fragment.totalLength, text.length);
    assert.equal(fragment.text, text.slice(0, fragment.end));
  }
  const feedback = automaticAuthorContext({ question: '问'.repeat(16_000),
    report: { version: 1, path: '060_reports/report.md', fixedPath: '/fixed/report.md', sha256: fixed.sha256 },
    authorTurn: { number: 1, limit: 1 }, coldResult: { file: '/fixed/cold.md', sha256: fixed.sha256, text },
    opinion: { file: '/fixed/opinion.md', sha256: fixed.sha256, text }, output: { reportPath: '/work/new.md' } });
  assert.ok(feedback.length <= 20_000);
  const packet = JSON.parse(feedback.slice('自动核算意见已交回原主Agent\n'.length));
  assert.match(packet.feedbackEvidenceGuidance, /重要分歧.*固定来源/);
  assert.ok(compared.includes(packet.feedbackEvidenceGuidance), 'both roles receive the same complete business guidance');
  assert.equal(packet.report.fixedPath, '/fixed/report.md');
  assert.equal(packet.opinion.file, '/fixed/opinion.md');
  assert.equal(packet.opinion.sha256, fixed.sha256);
  assert.equal(packet.coldResult.text, text.slice(0, packet.coldResult.end));
  assert.equal(packet.opinion.text, text.slice(0, packet.opinion.end));
});

test('D16 automatic recheck gives the largest serialized-budget prefix without slicing a Unicode scalar', () => {
  const text = '😀"\\\n\u0000'.repeat(80_000);
  const supplied = automaticRecheckContext({ ...fixed, text });
  const packet = JSON.parse(supplied.slice(recheckPrefix.length));
  assert.ok(supplied.length <= 20_000);
  assert.equal(packet.start, 0);
  assert.equal(packet.totalLength, text.length);
  assert.equal(packet.text, text.slice(0, packet.end));
  assert.ok(packet.end > 0 && packet.end < text.length);
  assert.equal(/[\uD800-\uDBFF]$/.test(packet.text), false);
  const nextLength = /[\uD800-\uDBFF]/.test(text[packet.end]!) ? 2 : 1;
  const enlarged = { ...packet, end: packet.end + nextLength, text: text.slice(0, packet.end + nextLength) };
  assert.ok((recheckPrefix + JSON.stringify(enlarged)).length > 20_000,
    'another complete scalar would exceed the actual envelope budget');
  assert.equal(packet.fixedPath, fixed.fixedPath); assert.equal(packet.sha256, fixed.sha256);
  assert.match(packet.note, /主动提供不表示已读或已核查全文/);
});

test('D16 automatic recheck rejects oversized metadata before sacrificing identity or scope', () => {
  assert.throws(() => automaticRecheckContext({ ...fixed, fixedPath: '\u0000'.repeat(4_000), text: 'small' }),
    { code: 'automatic_recheck_context_too_large' });
});
