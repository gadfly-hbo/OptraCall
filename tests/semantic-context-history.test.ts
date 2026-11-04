import test from 'node:test';
import assert from 'node:assert/strict';
import { semanticRecordsForAssistant } from '../src/host/ui/semantic-context-history.ts';

const input = { action: 'read', target: { kind: 'sap', packageId: 'old-rule', version: '1.0.0', metricName: 'limit' } };
const details = { schemaVersion: 1, type: 'optracall.semantic-context-result', action: 'read', state: 'available', indexRevision: 0, unknownTime: [], coverage: { complete: true, continuation: null, gaps: [] }, items: [{ target: input.target, title: 'Original rule', state: 'available', sha256: 'a'.repeat(64), body: 'OLD_RULE_5W_NOT_NEW_RULE_3W', range: null, recordedAt: { field: 'publishedAt', value: '2026-10-01T00:00:00Z' }, businessTime: [], governance: null, declaration: null, relations: [], gaps: [] }] };
const messages = [
  { role: 'user', content: [{ type: 'text', text: 'What rule did this report cite?' }] },
  { role: 'assistant', content: [{ type: 'toolCall', id: 'read-old', name: 'read_semantic_context', arguments: input }] },
  { role: 'toolResult', toolName: 'read_semantic_context', toolCallId: 'read-old', details, content: [{ type: 'text', text: 'Original exact version.' }] },
  { role: 'assistant', content: [{ type: 'text', text: 'The original report cited the old rule; correctness still unverified.' }] },
];
test('the answer can disclose its exact preceding semantic result and original query without fetching a latest version', () => {
  const rows = semanticRecordsForAssistant(messages, 3, 'native-session');
  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.result?.items[0]?.body, 'OLD_RULE_5W_NOT_NEW_RULE_3W');
  assert.deepEqual(rows[0]?.input, input);
  assert.equal(rows[0]?.native, undefined, 'no entry ID may be fabricated from an array position');
});

test('a preceding assistant explanation does not lose the original exact query arguments', () => {
  const withExplanation: Record<string, any>[] = structuredClone(messages);
  withExplanation[1]!.content.unshift({ type: 'text', text: 'I will inspect this exact historical version.' });
  const rows = semanticRecordsForAssistant(withExplanation, 3);
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0]?.input, input);
});

test('a new user turn cannot inherit a previous answer source panel', () => {
  const later = [...messages, { role: 'user', content: 'A different question without semantic lookup.' }, { role: 'assistant', content: 'An ordinary answer.' }];
  assert.deepEqual(semanticRecordsForAssistant(later, 5), []);
});

test('nested metadata preserves UNKNOWN and an optional exact read target, never inventing a child receipt', () => {
  const citationId = '00000000-0000-4000-8000-000000000001';
  const nested = [messages[0]!, { role: 'assistant', content: [{ type: 'toolCall', id: 'parent', name: 'codemode', arguments: { code: 'an actual nested invocation' } }] },
    { role: 'toolResult', toolName: 'codemode', toolCallId: 'parent', content: [{ type: 'text', text: JSON.stringify(details) }], nestedCalls: { calls: [{ id: 'nested-save', name: 'record_analysis_sources', status: 'ok', arguments: { citationId } }] } }, messages[3]!];
  const rows = semanticRecordsForAssistant(nested, 3, 'native-session', { projectId: 'current-project', taskId: 'current-task' });
  assert.equal(rows.length, 1); assert.match(rows[0]!.issue!, /UNKNOWN/);
  assert.equal(rows[0]!.receipt, undefined); assert.equal(rows[0]!.result, undefined);
  assert.deepEqual(rows[0]!.input, { action: 'read', target: { kind: 'data-citation', projectId: 'current-project', citationId } });
});

test('an unrelated tool payload cannot masquerade as a saved semantic result', () => {
  const other = structuredClone(messages); other[2]!.toolName = 'bash';
  assert.deepEqual(semanticRecordsForAssistant(other, 3), []);
});
