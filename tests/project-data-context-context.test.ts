import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { parseProjectDataSelections, projectDataRequestIdentity } from '../src/host/project-data-context-context.ts';

test('MC05: absent project data keeps the legacy request identity, while malformed or implicit-latest references are rejected', () => {
  assert.deepEqual(parseProjectDataSelections(undefined), []);
  assert.equal(projectDataRequestIdentity([]), undefined);
  const datasetId = randomUUID(), inputVersionId = randomUUID();
  for (const value of [null, {}, [{ datasetId, inputVersionId }], [{ datasetId, inputVersionId, descriptionRevisionId: null, path: '/other-project/private.csv' }]]) {
    assert.throws(() => parseProjectDataSelections(value), { code: 'data_context_invalid_selection' });
  }
});
