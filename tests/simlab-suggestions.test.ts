import test from 'node:test';
import assert from 'node:assert/strict';
import { freezeSuggestionFor } from '../extensions/business-plugins/sim-lab/ui/task-suggestions.ts';

const projectId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', draftId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const suggestion = { projectId, draftId, draftRevision: 1, runId: 'RUN-0001', variantId: 'baseline', reason: '请核对后固化', engineVersion: 'optracall-sim-2', inputHash: 'a'.repeat(64) };
const call = { role: 'assistant', content: [{ type: 'toolCall', id: 'call-one', name: 'simulation_run', arguments: { draftId, suggestFreeze: { variantId: 'baseline', reason: suggestion.reason } } }] };
const result = { role: 'toolResult', toolName: 'simulation_run', toolCallId: 'call-one', content: [{ type: 'text', text: JSON.stringify({ status: 'succeeded', data: { runId: suggestion.runId, draftRevision: suggestion.draftRevision, engineVersion: suggestion.engineVersion, freezeSuggestion: suggestion } }) }] };

test('SIM-CARD-01: only an explicit matching successful Agent call/result projects a suggestion', () => {
  assert.deepEqual(freezeSuggestionFor([call, result], 1, projectId), suggestion);
  assert.equal(freezeSuggestionFor([call, result], 1, 'other-project'), undefined);
  for (const invalid of [{ ...result, isError: true }, { ...result, toolCallId: 'orphan' }, { ...result, role: 'user' }, { ...result, toolName: 'simulation_evidence' }]) assert.equal(freezeSuggestionFor([call, invalid], 1, projectId), undefined);
  const without = { ...call, content: [{ ...call.content[0]!, arguments: { draftId } }] };
  assert.equal(freezeSuggestionFor([without, result], 1, projectId), undefined);
  const failed = { ...result, content: [{ type: 'text', text: JSON.stringify({ status: 'rejected', data: { freezeSuggestion: suggestion } }) }] };
  assert.equal(freezeSuggestionFor([call, failed], 1, projectId), undefined);
});
