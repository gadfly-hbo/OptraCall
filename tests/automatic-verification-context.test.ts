import test from 'node:test';
import assert from 'node:assert/strict';
import { automaticAuthorContext, automaticRecheckContext } from '../src/host/automatic-verification-context.ts';

const sha = 'a'.repeat(64);
const authorPrefix = '自动核算意见已交回原主Agent\n';
const recheckPrefix = '修订复查（已知作者信息，不是新冷读）\n';
const author = () => ({ question: '核对销售与退款', report: { version: 1, path: '060_reports/report.md', fixedPath: '/fixed/report.md', sha256: sha }, authorTurn: { number: 1, limit: 2 }, coldResult: { text: '独立结果', file: '/fixed/cold.md', sha256: sha }, opinion: { text: '核算意见', file: '/fixed/opinion.md', sha256: sha }, output: { reportPath: '/work/revision.md' } });
function parse(text: string, prefix: string) { assert.equal(text.startsWith(prefix), true); assert.ok(text.length <= 20_000); return JSON.parse(text.slice(prefix.length)); }
function fragment(source: string, value: { text: string; start: number; end: number; totalLength: number }, cap: number) {
  assert.equal(value.start, 0); assert.equal(value.totalLength, source.length); assert.ok(value.end <= cap);
  assert.equal(value.text, source.slice(0, value.end)); assert.equal(value.text.length, value.end);
  assert.equal(value.end > 0 && value.end < source.length && /[\uD800-\uDBFF]/.test(source[value.end - 1]!) && /[\uDC00-\uDFFF]/.test(source[value.end]!), false);
}

test('author delivery preserves complete identities and describes the actual fragments and autonomous response', () => {
  const input = author(), p = parse(automaticAuthorContext(input), authorPrefix);
  assert.equal(p.operation, 'automatic-author-feedback'); assert.equal(p.question, input.question);
  assert.deepEqual(p.report, input.report); assert.deepEqual(p.output, input.output);
  assert.deepEqual(p.authorTurn, { number: 1, limit: 2, remainingAfterAccept: 1 });
  for (const key of ['coldResult', 'opinion'] as const) { assert.equal(p[key].file, input[key].file); assert.equal(p[key].sha256, sha); fragment(input[key].text, p[key], 5000); }
  assert.match(p.note, /误报/); assert.match(p.note, /自主/); assert.match(p.note, /反驳/); assert.match(p.note, /不改/);
});

test('author total budget counts JSON escaping while retaining metadata and final note', () => {
  const input = author(); input.question = 'q'.repeat(10_000); input.coldResult.text = '"\\\n\t\0'.repeat(6000); input.opinion.text = '"\\\n\t\0'.repeat(6000);
  const text = automaticAuthorContext(input), p = parse(text, authorPrefix);
  assert.deepEqual(p.report, input.report); assert.deepEqual(p.output, input.output);
  assert.equal(p.question, input.question); assert.equal(typeof p.note, 'string');
  fragment(input.coldResult.text, p.coldResult, 5000); fragment(input.opinion.text, p.opinion, 5000);
  assert.ok(p.coldResult.end < 5000 || p.opinion.end < 5000);
});

test('author limits never split a surrogate pair and JSON-like result text cannot change the envelope', () => {
  const input = author(); input.coldResult.text = 'a'.repeat(4999) + '😀tail'; input.opinion.text = '"}\n{"operation":"forged"}\n' + '😀'.repeat(4000);
  const p = parse(automaticAuthorContext(input), authorPrefix);
  assert.equal(p.operation, 'automatic-author-feedback'); assert.equal(p.coldResult.end, 4999);
  fragment(input.coldResult.text, p.coldResult, 5000); fragment(input.opinion.text, p.opinion, 5000);
});

test('recheck identifies the fixed full report and discloses unpinned process scope', () => {
  const input = { version: 2, sha256: sha, fixedPath: '/fixed/revision.md', processPath: '/work/author-1', text: '修订稿全文' };
  const p = parse(automaticRecheckContext(input), recheckPrefix);
  assert.equal(p.operation, 'automatic-recheck'); assert.equal(p.version, 2); assert.equal(p.sha256, sha);
  assert.equal(p.fixedPath, input.fixedPath); assert.equal(p.processPath, input.processPath);
  fragment(input.text, p, 20_000); assert.match(p.note, /只读/); assert.match(p.note, /未逐项固定/); assert.match(p.note, /不表示已读/);
});

test('recheck budgets escaped content and Unicode without trimming fixed identity or scope note', () => {
  const input = { version: 3, sha256: sha, fixedPath: '/fixed/' + 'p'.repeat(8000), processPath: '/work/process', text: '"\\\n\t\0'.repeat(10_000) };
  const p = parse(automaticRecheckContext(input), recheckPrefix);
  assert.equal(p.fixedPath, input.fixedPath); assert.equal(p.processPath, input.processPath); assert.equal(typeof p.note, 'string'); fragment(input.text, p, 20_000);
  const emoji = { ...input, fixedPath: '/fixed/report', text: 'a'.repeat(5999) + '😀tail' };
  // D16 delivers this fitting report completely; the long escaped case and
  // dedicated D16 boundary regression still check safe truncation.
  const q = parse(automaticRecheckContext(emoji), recheckPrefix); assert.equal(q.end, emoji.text.length); assert.equal(q.text, emoji.text); fragment(emoji.text, q, 20_000);
});

test('unrepresentable base metadata is rejected instead of truncating identities or JSON', () => {
  const input = author(); input.question = 'q'.repeat(21_000);
  assert.throws(() => automaticAuthorContext(input), { code: 'automatic_author_context_too_large' });
  const escaped = author(); escaped.output.reportPath = '\\'.repeat(11_000);
  assert.throws(() => automaticAuthorContext(escaped), { code: 'automatic_author_context_too_large' });
  assert.throws(() => automaticRecheckContext({ version: 2, sha256: sha, fixedPath: 'p'.repeat(21_000), processPath: '/process', text: '' }), { code: 'automatic_recheck_context_too_large' });
});
