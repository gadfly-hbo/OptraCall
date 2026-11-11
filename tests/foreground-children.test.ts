import test from 'node:test';
import assert from 'node:assert/strict';
import { createForegroundChildren } from '../src/agent/foreground-children.ts';

test('foreground cleanup UNKNOWN aborts the parent before rejection and waits for explicit retry', async () => {
  const parent = new AbortController();
  const events: string[] = [];
  const owner = createForegroundChildren(() => {
    events.push('abort-parent');
    parent.abort();
  });
  let closes = 0;
  const child = {
    session: { waitForIdle: async () => {} },
    async dispose() {
      closes++;
      if (closes === 1) throw new Error('synthetic-dispose-ack-unknown');
    },
  };
  owner.children.add(child);
  const retirement = owner.retire(child).catch(error => {
    events.push('retirement-rejected');
    throw error;
  });
  await assert.rejects(retirement, /dispose-ack-unknown/);
  assert.deepEqual(events, ['abort-parent', 'retirement-rejected']);
  assert.equal(parent.signal.aborted, true);
  assert.equal(owner.hasFailures(), true);
  assert.equal(owner.children.has(child), true);
  await assert.rejects(owner.retireAll(), /subagent_cleanup_unknown/);
  assert.equal(closes, 1, 'automatic drain and finally reuse the original failed retirement');
  await owner.retireAll(true);
  assert.equal(closes, 2);
  assert.equal(owner.hasFailures(), false);
  assert.equal(owner.children.size, 0);
});
