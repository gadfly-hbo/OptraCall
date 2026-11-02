import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fork } from 'node:child_process';
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

test('SIM-STORE-05: accepted drafts run at the seven-day boundary and partial updates validate retained variants', async t => {
  const { service } = await fixture(t);
  const short = await service.createDraft({ name: '七天', parameters: { days: 7, promoStart: 1, promoEnd: 7 } });
  assert.equal((await service.runDraft(short.id)).results.split!.rows.length, 7);
  const long = await service.createDraft({ name: '缩短窗口' });
  await rejectsCode(service.updateDraft(long.id, { parameters: { days: 7, promoStart: 1, promoEnd: 7 } }, 1), 'invalid_variant');
  assert.equal((await service.getDraft(long.id)).revision, 1);
  await rejectsCode(service.createDraft({ name: '不支持退货', variants: [{ id: 'one', name: 'one', returnRate: 0.5 }] }), 'invalid_variant');
  await rejectsCode(service.createDraft({ name: '不支持日内规则', variants: [{ id: 'one', name: 'one', promoWindow: { start: 1, end: 7, hourly: true } }] }), 'invalid_variant');
});

test('SIM-STORE-06: freeze rechecks the draft revision at the atomic snapshot publication', async t => {
  const { service } = await fixture(t);
  const draft = await service.createDraft({ name: '固化竞态' }), run = await service.runDraft(draft.id);
  const original = service.store.getRun.bind(service.store);
  t.mock.method(service.store, 'getRun', async (id: string) => {
    await service.updateDraft(draft.id, { parameters: { demand: 999 } }, 1);
    return original(id);
  });
  await rejectsCode(service.freeze(draft.id, { runId: run.id, variantId: 'baseline', expectedRevision: 1 }), 'revision_conflict');
  assert.deepEqual(await service.listSnapshots(), []);
});

test('SIM-STORE-07: independent store instances never acknowledge two writes for one revision', async t => {
  const { root, service } = await fixture(t);
  const peer = new SimLabService(path.join(root, 'project'), PROJECT);
  const draft = await service.createDraft({ name: '两个写入者' });
  const results = await Promise.allSettled([
    service.updateDraft(draft.id, { parameters: { demand: 333 } }, 1),
    peer.updateDraft(draft.id, { parameters: { capacity: 444 } }, 1),
  ]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  const latest = await service.getDraft(draft.id);
  assert.equal(latest.revision, 2);
  assert.ok(latest.parameters.demand === 333 || latest.parameters.capacity === 444);
});

test('SIM-STORE-08: independent processes protect CAS, and orphan locks preserve unknown work', async t => {
  const { root, service } = await fixture(t);
  const draft = await service.createDraft({ name: '跨进程CAS' });
  const workerFile = path.join(root, 'worker.mjs');
  const storeModule = new URL('../extensions/business-plugins/sim-lab/storage/store.ts', import.meta.url).href;
  await fs.writeFile(workerFile, `import {SimLabStore} from ${JSON.stringify(storeModule)};
    const store=new SimLabStore(process.argv[2]);
    process.once('message', async ({id,field})=>{let result;try { const draft=await store.updateDraft(id,1,current=>({...current,parameters:{...current.parameters,[field]:777}}));result={ok:true,revision:draft.revision}; } catch(error){result={ok:false,code:error.code};}process.send(result,()=>process.disconnect());});process.send({ready:true});`);
  const workers = ['demand', 'capacity'].map(field => {
    const child = fork(workerFile, [path.join(root, 'project')], { stdio: ['ignore', 'ignore', 'pipe', 'ipc'] });
    t.after(() => { if (child.exitCode === null) child.kill('SIGTERM'); });
    let ready!: () => void, done!: (value: { ok: boolean; code?: string }) => void;
    const prepared = new Promise<void>(resolve => { ready = resolve; });
    const result = new Promise<{ ok: boolean; code?: string }>(resolve => { done = resolve; });
    child.on('message', value => { const message = value as { ready?: boolean; ok: boolean; code?: string }; if (message.ready) ready(); else done(message); });
    return { prepared, result, start: () => child.send({ id: draft.id, field }) };
  });
  await Promise.all(workers.map(worker => worker.prepared)); workers.forEach(worker => worker.start());
  const results = await Promise.all(workers.map(worker => worker.result));
  assert.equal(results.filter(result => result.ok).length, 1);
  assert.ok(results.filter(result => !result.ok).every(result => ['store_busy', 'revision_conflict'].includes(result.code!)));
  const file = path.join(root, 'project', 'drafts', draft.id + '.json'), before = await fs.readFile(file);
  await fs.mkdir(path.join(root, 'project', '.operation-lock'));
  await rejectsCode(service.updateDraft(draft.id, { name: '不得重放' }, 2), 'store_busy');
  assert.deepEqual(await fs.readFile(file), before);
});

test('SIM-STORE-09: snapshot readback resolves its original engine rules and preserves unknown versions', async t => {
  const { root, service } = await fixture(t);
  const draft = await service.createDraft({ name: '快照口径' }), run = await service.runDraft(draft.id);
  const snapshot = await service.freeze(draft.id, { runId: run.id, variantId: 'split', expectedRevision: 1 });
  const current = await service.getSnapshot(snapshot.id);
  assert.equal(current.model.status, 'known');
  assert.deepEqual(current.model.effective.promoWindow, { start: 8, end: 21 });
  assert.equal(current.model.effective.promoLift, 40);
  const file = path.join(root, 'project', 'snapshots', snapshot.id + '.json');
  for (const version of ['optracall-sim-1', 'unknown-future-engine']) {
    const bytes = JSON.stringify({ ...snapshot, engineVersion: version });
    await fs.writeFile(file, bytes);
    const reread = await service.getSnapshot(snapshot.id);
    assert.equal(reread.model.status, version === 'optracall-sim-1' ? 'known' : 'unknown');
    assert.equal(await fs.readFile(file, 'utf8'), bytes, 'read-time rules never rewrite historical evidence');
  }
});
