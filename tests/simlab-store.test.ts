import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { SimLabService } from '../extensions/business-plugins/sim-lab/service/simlab-service.ts';

const PROJECT = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const rejectsCode = async (promise: Promise<unknown>, code: string) => {
  await assert.rejects(promise, (error: unknown) => { assert.equal((error as { code?: string }).code, code); return true; });
};
async function fixture(t: { after: (fn: () => Promise<void>) => void }) {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'optracall-simlab-')));
  const service = new SimLabService(path.join(root, 'project'), PROJECT);
  t.after(async () => { await fs.rm(root, { recursive: true, force: true }); });
  return { root, service };
}

test('SIM-STORE-01: draft create/update with CAS and validation', async t => {
  const { service } = await fixture(t);
  const draft = await service.createDraft({ name: '  双十一备货对比  ' });
  assert.equal(draft.name, '双十一备货对比');
  assert.equal(draft.revision, 1);
  assert.equal(draft.projectId, PROJECT);
  assert.equal(draft.variants.length, 3);

  const updated = await service.updateDraft(draft.id, { parameters: { demand: 200 } }, 1);
  assert.equal(updated.revision, 2);
  assert.equal(updated.parameters.demand, 200);
  assert.equal(updated.parameters.price, draft.parameters.price);
  await rejectsCode(service.updateDraft(draft.id, { parameters: { demand: 300 } }, 1), 'revision_conflict');
  await rejectsCode(service.updateDraft(draft.id, { parameters: { unknownKey: 1 } }, 2), 'invalid_parameters');
  await rejectsCode(service.updateDraft(draft.id, { variants: [] }, 2), 'variant_limit');
  await rejectsCode(service.updateDraft(draft.id, { variants: Array.from({ length: 9 }, (_, i) => ({ id: `v${i}`, name: `v${i}` })) }, 2), 'variant_limit');
  await rejectsCode(service.updateDraft(draft.id, { variants: [{ id: 'x', name: 'x' }, { id: 'x', name: 'x2' }] }, 2), 'invalid_variant');
  await rejectsCode(service.createDraft({ name: '' }), 'invalid_name');
  await rejectsCode(service.getDraft('not-a-uuid'), 'draft_not_found');
});

test('SIM-STORE-02: run records persist and are deterministic across reopen', async t => {
  const { root, service } = await fixture(t);
  const draft = await service.createDraft({ name: 'run test' });
  const run = await service.runDraft(draft.id);
  assert.match(run.id, /^RUN-\d{4}$/);
  assert.equal(run.draftRevision, 1);
  assert.equal(Object.keys(run.results).length, 3);
  for (const result of Object.values(run.results)) assert.equal(result.conservation, true);

  const reopened = new SimLabService(path.join(root, 'project'), PROJECT);
  const again = await reopened.runDraft(draft.id);
  assert.notEqual(again.id, run.id);
  assert.equal(JSON.stringify(again.results), JSON.stringify(run.results));
  assert.equal((await reopened.listRuns(draft.id)).length, 2);
  assert.equal((await reopened.getDraft(draft.id)).name, 'run test');
});

test('SIM-STORE-03: stress returns deltas and flips, validates scope', async t => {
  const { service } = await fixture(t);
  const draft = await service.createDraft({ name: 'stress test' });
  const rows = await service.stress(draft.id, { perturbation: { demandMultiplier: 1.25 } });
  assert.equal(rows.length, 3);
  for (const row of rows) {
    assert.equal(row.perturbation.demandMultiplier, 1.25);
    assert.ok(row.after.demand > row.base.demand);
  }
  const scoped = await service.stress(draft.id, { perturbation: { leadTimeDelta: 3 }, variantIds: ['baseline'] });
  assert.equal(scoped.length, 1);
  assert.equal(scoped[0]!.variantId, 'baseline');
  await rejectsCode(service.stress(draft.id, { perturbation: { demandMultiplier: 0 } }), 'invalid_perturbation');
  await rejectsCode(service.stress(draft.id, { perturbation: { demandMultiplier: 1.1 }, variantIds: ['missing'] }), 'invalid_variant');
});

test('SIM-STORE-04: freeze enforces evidence discipline and snapshots are immutable', async t => {
  const { root, service } = await fixture(t);
  const draft = await service.createDraft({ name: 'freeze test' });
  const run = await service.runDraft(draft.id);
  await rejectsCode(service.freeze(draft.id, { runId: run.id, variantId: 'baseline', expectedRevision: 99 }), 'revision_conflict');
  await rejectsCode(service.freeze(draft.id, { runId: run.id, variantId: 'missing', expectedRevision: 1 }), 'invalid_variant');

  const snapshot = await service.freeze(draft.id, { runId: run.id, variantId: 'baseline', expectedRevision: 1 });
  assert.equal(snapshot.id, 'SNAP-0001');
  assert.equal(snapshot.runId, run.id);
  assert.equal(snapshot.result.conservation, true);
  assert.equal(snapshot.name, 'freeze test · 基线 · 常规补货');

  const second = await service.freeze(draft.id, { runId: run.id, variantId: 'advance', expectedRevision: 1 });
  assert.equal(second.id, 'SNAP-0002');
  assert.equal((await service.listSnapshots()).length, 2);

  // 草稿后续变化不回写快照：快照仍是当时口径与结果。
  await service.updateDraft(draft.id, { parameters: { demand: 999 } }, 1);
  const reread = await service.getSnapshot(snapshot.id);
  assert.equal(reread.parameters.demand, snapshot.parameters.demand);
  assert.equal(JSON.stringify(reread.result), JSON.stringify(snapshot.result));

  // 草稿已变：旧 run 不能再固化。
  await rejectsCode(service.freeze(draft.id, { runId: run.id, variantId: 'baseline', expectedRevision: 2 }), 'stale_run');
  const fresh = await service.runDraft(draft.id);
  const third = await service.freeze(draft.id, { runId: fresh.id, variantId: 'baseline', expectedRevision: 2, name: '新口径快照' });
  assert.equal(third.name, '新口径快照');
  assert.equal(third.parameters.demand, 999);

  // 快照文件为一次性写入：同 id 目标已存在时底层写入冲突，不覆盖。
  const file = path.join(root, 'project', 'snapshots', 'SNAP-0001.json');
  const before = await fs.readFile(file, 'utf8');
  await service.updateDraft(draft.id, { name: '改名不影响快照' }, 2);
  assert.equal(await fs.readFile(file, 'utf8'), before);
});
