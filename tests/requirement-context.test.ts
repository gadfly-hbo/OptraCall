import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createRequirementStore, RequirementStoreFault } from '../extensions/business-plugins/requirements-elaboration/storage/store.ts';
import { composeRequirementContext } from '../extensions/business-plugins/requirements-elaboration/api/context.ts';
import { sampleInstance } from './fixtures/requirement-sample.ts';

const seeded = (store: ReturnType<typeof createRequirementStore>) => {
  const created = store.create({ title: '双11复购下滑归因', scene: 'topic' });
  const base = sampleInstance();
  const instance = { ...base, instance: { ...base.instance, id: created.instance.id, createdAt: created.instance.createdAt } };
  store.save(instance);
  store.confirm(store.read(created.instance.id), 'huangbo');
  return created.instance.id;
};
const fault = (error: unknown): RequirementStoreFault => { assert.ok(error instanceof RequirementStoreFault, `expected RequirementStoreFault, got ${String(error)}`); return error as RequirementStoreFault; };

test('RE-05: send context composes from a published release with its contract path', () => {
  const store = createRequirementStore(mkdtempSync(path.join(os.tmpdir(), 'requirement-context-')));
  const id = seeded(store);
  store.publish(id, '1.0.0', 'huangbo');
  const summary = composeRequirementContext(store, id, '1.0.0');
  assert.match(summary, /关联需求契约/);
  assert.match(summary, /目标：定位下滑主驱动因素/);
  assert.match(summary, /30日会员复购率/);
  assert.match(summary, /dwd_trade_order_di\(P0\)/);
  assert.match(summary, /open_questions ×3/);
  assert.match(summary, /不是执行指令/);
  assert.match(summary, new RegExp(`releases/${id}/1\\.0\\.0\\.rap\\.yaml`));
});

test('RE-05: send context composes from a confirmed instance without a release', () => {
  const store = createRequirementStore(mkdtempSync(path.join(os.tmpdir(), 'requirement-context-')));
  const id = seeded(store);
  const summary = composeRequirementContext(store, id);
  assert.match(summary, /已确认快照 sha256:/);
  assert.match(summary, /open_questions/);
  assert.match(summary, /dwd_trade_order_di\(P0\)/);
});

test('RE-05: unconfirmed, stale, or missing instances fail closed', () => {
  const store = createRequirementStore(mkdtempSync(path.join(os.tmpdir(), 'requirement-context-')));
  const created = store.create({ title: '门店销售下降', scene: 'daily' });
  assert.throws(() => composeRequirementContext(store, created.instance.id), error => { assert.equal(fault(error).code, 'REQ_SNAPSHOT_REQUIRED'); return true; });
  const id = seeded(store);
  const stale = structuredClone(store.read(id)) as never as { facts: string[] };
  stale.facts.push('确认后新增的事实');
  store.save(stale as never);
  assert.throws(() => composeRequirementContext(store, id), error => { assert.equal(fault(error).code, 'REQ_STALE_SNAPSHOT'); return true; });
  assert.throws(() => composeRequirementContext(store, 'req-missing'), error => { assert.equal(fault(error).code, 'REQ_STORE_NOT_FOUND'); return true; });
  assert.throws(() => composeRequirementContext(store, id, '9.9.9'), error => { assert.equal(fault(error).code, 'REQ_STORE_NOT_FOUND'); return true; });
});
