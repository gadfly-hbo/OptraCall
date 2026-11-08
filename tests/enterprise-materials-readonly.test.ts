import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { EnterpriseMaterialsStore } from '../src/host/enterprise-materials-store.ts';

test('auxiliary semantic reads do not initialize an unused enterprise materials store', async () => {
  const root = path.resolve('.local/fourbase-modules/m7-l1-semantic-trace/implementation/enterprise-readonly', randomUUID());
  const store = new EnterpriseMaterialsStore(root);
  assert.equal(existsSync(root), false);
  await assert.rejects(() => store.referenceIndex({ readOnly: true }), { code: 'enterprise_source_missing' });
  assert.equal(existsSync(root), false, 'reading optional materials must not create a store or asset identity');
});
